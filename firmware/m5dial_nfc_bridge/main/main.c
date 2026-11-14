/*
 * PULSE M5Dial bridge — application entry point.
 *
 * The M5Dial becomes a USB NFC card reader for the PULSE web game:
 *   - WS1850S (MFRC522-compatible) reads NTAG215 UID + PULSE identity NDEF
 *   - TinyUSB CDC (serial) speaks pcg.reader.v1 to the browser's Web Serial
 *   - the round LCD shows a READY / card-identity panel
 */
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "rc522.h"
#include "nfc_read.h"
#include "pcg_proto.h"
#include "usb_cdc.h"
#include "display_gc9a01.h"
#include "buzzer.h"

static const char *TAG = "pcg_m5dial";

/* M5Dial internal I2C to the WS1850S NFC front-end. */
#define SDA_GPIO 11
#define SCL_GPIO 12

static const char *reset_name(void)
{
    switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_SW: return "sw";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "int_wdt";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_WDT: return "wdt";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_USB: return "usb";
    case ESP_RST_JTAG: return "jtag";
    case ESP_RST_CPU_LOCKUP: return "lockup";
    default: return "other";
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "PULSE M5Dial NFC bridge starting");

    esp_err_t e = nvs_flash_init();
    if (e == ESP_ERR_NVS_NO_FREE_PAGES || e == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    buzzer_init();
    if (display_init() != 0)
        ESP_LOGE(TAG, "display init failed");

    pcg_rc522_conf_t rc = { .sda = SDA_GPIO, .scl = SCL_GPIO, .freq = 400000 };
    bool nfc_ok = rc522_init(&rc);
    ESP_LOGI(TAG, "NFC init %s", nfc_ok ? "ok" : "failed");
    display_note_nfc(nfc_ok);

    /* uid + ndef_read + ndef_write. Writes still require overwrite:true from
     * the host, and the page planner refuses UID, lock and unformatted tags.
     * A read-only host that never sends write keeps the previous behavior. */
    static pcg_proto_t proto;
    pcg_proto_init(&proto, "PULSE M5Dial NFC bridge", 1 | 2 | 4, NULL, NULL, NULL);
    pcg_proto_set_reset(&proto, reset_name());
    pcg_proto_set_ready(&proto, nfc_ok);
    display_note_card("boot", reset_name());
    ESP_LOGI(TAG, "reset reason %s", reset_name());

    usb_cdc_start(&proto);
    nfc_read_start(&proto);

    ESP_LOGI(TAG, "ready: 刷 NTAG → Web（pcg.reader.v1 %s）",
             nfc_ok ? "NFC ok" : "NFC down");
    while (1) { vTaskDelay(pdMS_TO_TICKS(1000)); }
}