/*
 * PULSE M5Dial bridge — NFC polling task glue.
 */
#include "nfc_read.h"
#include "rc522.h"
#include "pcg_ndef.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "nfc";

#define POLL_DELAY_MS      60
#define REMOVED_GRACE_MS  400

static pcg_proto_t *g_proto;
static char last_uid[24] = "";
static uint32_t last_seen_ms = 0;

static const char hexd[] = "0123456789ABCDEF";

static void uid_to_hex(const uint8_t *uid, uint8_t len, char *out)
{
    for (int i = 0; i < len; i++) {
        out[i*2]   = hexd[uid[i] >> 4];
        out[i*2+1] = hexd[uid[i] & 0x0F];
    }
    out[len*2] = 0;
}

/* Read NTAG user memory starting at page 4 into a flat byte array. Stops at
 * the first 0xFE terminator or when dst fills. Returns bytes written. */
static size_t read_ndef_region(uint8_t *dst, size_t dst_len)
{
    size_t out = 0;
    uint8_t block[16];
    /* NTAG215 pages come in 4-page (16-byte) READ blocks. Start at page 4. */
    for (uint8_t page = 4; page < 120 && out < dst_len; page += 4) {
        uint32_t byte_addr = (uint32_t)page * 4;
        if (rc522_read_memory(block, sizeof block, byte_addr) != 16)
            break;
        for (int i = 0; i < 16 && out < dst_len; i++) {
            uint8_t b = block[i];
            dst[out++] = b;
            if (b == 0xFE) return out;
        }
    }
    return out;
}

static bool read_tag(pcg_card_t *card)
{
    pcg_tag_id_t id;
    if (!rc522_select(&id, 200)) return false;

    uid_to_hex(id.uid, id.uid_len, card->uid);

    uint8_t mem[512];
    uint8_t msg[512];
    size_t got = read_ndef_region(mem, sizeof mem);
    size_t mlen = pcg_ndef_extract(mem, got, msg, sizeof msg);
    card->has_descriptor = false;
    card->descriptor[0] = 0;
    if (mlen) {
        char json[PCG_NDEF_MAX];
        if (pcg_ndef_parse_message(msg, mlen, json, sizeof json)) {
            snprintf(card->descriptor, sizeof card->descriptor, "%s", json);
            card->has_descriptor = true;
        }
    }
    return true;
}

static void nfc_task(void *arg)
{
    (void)arg;
    while (1) {
        uint32_t now = (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS);
        pcg_card_t card;
        memset(&card, 0, sizeof card);
        if (read_tag(&card)) {
            if (strcmp(card.uid, last_uid) != 0) {
                snprintf(last_uid, sizeof last_uid, "%s", card.uid);
                pcg_proto_on_card(g_proto, &card);
            }
            last_seen_ms = now;
        } else if (last_uid[0] && (now - last_seen_ms > REMOVED_GRACE_MS)) {
            pcg_proto_on_removed(g_proto);
            last_uid[0] = 0;
        }
        vTaskDelay(POLL_DELAY_MS / portTICK_PERIOD_MS);
    }
}

void nfc_read_start(pcg_proto_t *proto)
{
    g_proto = proto;
    xTaskCreatePinnedToCore(nfc_task, "nfc", 4096, NULL, 6, NULL, 0);
}