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
#include "tinyusb.h"
#include "tusb_cdc_acm.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "usbcdc";
static pcg_proto_t *g = NULL;

#define RX_CAP 2048
static char rx[RX_CAP];
static size_t rx_len = 0;

void tinyusb_cdc_rx_callback(int itf, cdcacm_event_t *event)
{
    (void)event;
    uint8_t buf[128];
    size_t got = 0;
    esp_err_t r = tinyusb_cdcacm_read(itf, buf, sizeof buf, &got);
    if (r != ESP_OK) return;
    for (size_t i = 0; i < got; i++) {
        uint8_t c = buf[i];
        if (c == '\n' || c == '\r') {
            if (rx_len) {
                rx[rx_len] = 0;
                pcg_proto_on_line(g, rx, rx_len);
                rx_len = 0;
            }
        } else if (rx_len < RX_CAP - 1) {
            rx[rx_len++] = (char)c;
        }
    }
}

static void on_line_state(int itf, cdcacm_event_t *event)
{
    (void)itf;
    /* Opening the port asserts DTR. That is not a reset. USB-Serial-JTAG is
     * left disabled in sdkconfig so this edge cannot reboot the chip. */
    int open = event && event->line_state_changed_data.dtr;
    display_note_usb(open);
    ESP_LOGI(TAG, "CDC DTR %s", open ? "open" : "closed");
}

static void cdc_send(pcg_proto_t *proto, const char *line)
{
    (void)proto;
    size_t n = strlen(line);
    tinyusb_cdcacm_write_queue(TINYUSB_CDC_ACM_0, (const uint8_t *)line, n);
    tinyusb_cdcacm_write_queue(TINYUSB_CDC_ACM_0, (const uint8_t *)"\n", 1);
    tinyusb_cdcacm_write_flush(TINYUSB_CDC_ACM_0, 0);
}

int usb_cdc_start(pcg_proto_t *proto)
{
    g = proto;

    uint8_t mac[6];
    static char serial[13];
    static const char lang[] = { 0x09, 0x04 };
    const char *strings[5];
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
        .rx_unread_buf_sz = 64,
        .callback_rx = &tinyusb_cdc_rx_callback,
        .callback_rx_wanted_char = NULL,
        .callback_line_state_changed = on_line_state,
        .callback_line_coding_changed = NULL,
    };
    if (tusb_cdc_acm_init(&acm_cfg) != ESP_OK)
        return -1;

    /* The protocol layer emits reply lines through proto->send. */
    proto->send = cdc_send;

    ESP_LOGI(TAG, "CDC up; speak pcg.reader.v1");
    return 0;
}