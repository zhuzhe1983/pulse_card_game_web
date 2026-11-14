/*
 * PULSE M5Dial bridge — TinyUSB CDC transport for pcg.reader.v1.
 *
 * Uses the esp_tinyusb component (the same one as IDF's tusb_serial_device
 * example, IDF 5.3). The M5Dial renders as a USB CDC serial device; the web
 * app opens it via Web Serial and exchanges pcg.reader.v1 JSON lines.
 */
#include "usb_cdc.h"
#include "display_gc9a01.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "tinyusb.h"
#include "tusb_cdc_acm.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "usbcdc";
static pcg_proto_t *g = NULL;

#define RX_CAP 4096
static QueueHandle_t rx_queue;
static volatile bool rx_overflow;
static TaskHandle_t proto_task;
static SemaphoreHandle_t tx_mu;

/* Keep protocol parsing and large replies off the TinyUSB callback stack. */
void tinyusb_cdc_rx_callback(int itf, cdcacm_event_t *event)
{
    uint8_t buf[64];
    size_t got = 0;
    (void)event;
    do {
        if (tinyusb_cdcacm_read(itf,buf,sizeof buf,&got) != ESP_OK) return;
        for (size_t i = 0; i < got; i++) {
            if (xQueueSend(rx_queue,buf+i,0) != pdTRUE) rx_overflow = true;
        }
    } while (got == sizeof buf);

    if (proto_task) xTaskNotifyGive(proto_task);
}

static void proto_task_fn(void *arg)
{
    static char line[PCG_PROTO_LINE_MAX];
    size_t n = 0;
    bool dropping = false;
    (void)arg;
    while (1) {
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(200));
        uint8_t c;
        while (xQueueReceive(rx_queue,&c,0) == pdTRUE) {
            if (rx_overflow) { dropping = true; n = 0; rx_overflow = false; }
            if (dropping) { if (c == '\n') dropping = false; continue; }
            if (c == '\n' || c == '\r') {
                if (n) {
                    line[n] = 0;
                    pcg_proto_on_line(g, line, n);
                    n = 0;
                }
            } else if (n + 1 < sizeof line) {
                line[n++] = (char)c;
            } else {
                n = 0; dropping = true;
            }
        }
    }
}

static void on_line_state(int itf, cdcacm_event_t *event)
{
    (void)itf;
    /* Opening the port asserts DTR. That is not a reset. USB-Serial-JTAG is
     * left disabled in sdkconfig so this edge cannot reboot the chip. */
    int open = event && event->line_state_changed_data.dtr;
    if (!open && g) g->session = false;
    display_note_usb(open);
    ESP_LOGI(TAG, "CDC DTR %s", open ? "open" : "closed");
}

static void cdc_send(pcg_proto_t *proto, const char *line)
{
    (void)proto;
    size_t n = strlen(line);
    if (tx_mu) xSemaphoreTake(tx_mu, portMAX_DELAY);
    size_t sent = 0;
    while (sent < n) {
        size_t queued = tinyusb_cdcacm_write_queue(TINYUSB_CDC_ACM_0, (const uint8_t *)line + sent, n - sent);
        if (!queued) break;
        sent += queued;
        if (tinyusb_cdcacm_write_flush(TINYUSB_CDC_ACM_0, pdMS_TO_TICKS(500)) != ESP_OK) break;
    }
    tinyusb_cdcacm_write_queue(TINYUSB_CDC_ACM_0, (const uint8_t *)"\n", 1);
    /* Short wait, and not from the USB callback. timeout 0 returns before
     * the endpoint is idle, which dropped the tail of the hello line. */
    tinyusb_cdcacm_write_flush(TINYUSB_CDC_ACM_0, pdMS_TO_TICKS(50));
    if (tx_mu) xSemaphoreGive(tx_mu);
}

int usb_cdc_start(pcg_proto_t *proto)
{
    g = proto;
    rx_queue = xQueueCreate(RX_CAP,1);
    if (!rx_queue) return -1;

    uint8_t mac[6];
    static char serial[13];
    static const char lang[] = { 0x09, 0x04 };
    static const char *strings[5];
    if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) {
        snprintf(serial, sizeof serial, "123456");
    } else {
        snprintf(serial, sizeof serial, "%02X%02X%02X%02X%02X%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }
    strings[0] = lang;
    strings[1] = "PULSE";
    strings[2] = "PULSE M5Dial NFC";
    strings[3] = serial;
    strings[4] = "PULSE M5Dial NFC";
    ESP_LOGI(TAG, "USB serial %s vid 303A pid 4001", serial);

    const tinyusb_config_t tusb_cfg = {
        .device_descriptor = NULL,
        .string_descriptor = strings,
        .string_descriptor_count = 5,
        .external_phy = false,
        .configuration_descriptor = NULL,
    };
    if (tinyusb_driver_install(&tusb_cfg) != ESP_OK)
        return -1;

    tinyusb_config_cdcacm_t acm_cfg = {
        .usb_dev = TINYUSB_USBDEV_0,
        .cdc_port = TINYUSB_CDC_ACM_0,
        .rx_unread_buf_sz = 512,
        .callback_rx = &tinyusb_cdc_rx_callback,
        .callback_rx_wanted_char = NULL,
        .callback_line_state_changed = on_line_state,
        .callback_line_coding_changed = NULL,
    };
    if (tusb_cdc_acm_init(&acm_cfg) != ESP_OK)
        return -1;

    tx_mu = xSemaphoreCreateMutex();
    proto->send = cdc_send;
    if (xTaskCreate(proto_task_fn, "pcg", 16384, NULL, 8, &proto_task) != pdPASS)
        return -1;

    ESP_LOGI(TAG, "CDC up; speak pcg.reader.v1");
    return 0;
}
