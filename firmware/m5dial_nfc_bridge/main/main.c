/*
 * PULSE M5Dial bridge — application entry point.
 *
 * The M5Dial becomes a USB NFC card reader for the PULSE web game:
 *   - WS1850S (MFRC522-compatible) reads NTAG215 UID + PULSE identity NDEF
 *   - TinyUSB CDC (serial) speaks pcg.reader.v1 to the browser's Web Serial
 *   - the round LCD shows a READY / card-identity panel
 */
#include "esp_log.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "rc522.h"
#include "nfc_read.h"
#include "pcg_proto.h"
#include "usb_cdc.h"
#include "display_gc9a01.h"

static const char *TAG = "pcg_m5dial";

/* M5Dial internal I2C to the WS1850S NFC front-end. */
#define SDA_GPIO 11
#define SCL_GPIO 12

void app_main(void)
{
    ESP_LOGI(TAG, "PULSE M5Dial NFC bridge starting");

    esp_err_t e = nvs_flash_init();
    if (e == ESP_ERR_NVS_NO_FREE_PAGES || e == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    display_init();

    pcg_rc522_conf_t rc = { .sda = SDA_GPIO, .scl = SCL_GPIO, .freq = 400000 };
    bool nfc_ok = rc522_init(&rc);
    ESP_LOGI(TAG, "NFC init %s", nfc_ok ? "ok" : "failed");

    /* Capabilities = uid + ndef_read. This build reads a tag's PULSE identity
     * NDEF but does not rewrite tags, so ndef_write is NOT advertised and the
     * web page keeps its "写卡" button off — an honest read-only bridge. */
    pcg_proto_t proto;
    pcg_proto_init(&proto, "PULSE M5Dial NFC bridge", 1 | 2, NULL, NULL, NULL);
    pcg_proto_set_ready(&proto, nfc_ok);

    usb_cdc_start(&proto);
    nfc_read_start(&proto);

    ESP_LOGI(TAG, "ready: 刷 NTAG → Web（pcg.reader.v1 %s）",
             nfc_ok ? "NFC ok" : "NFC down");
    while (1) { vTaskDelay(pdMS_TO_TICKS(1000)); }
}