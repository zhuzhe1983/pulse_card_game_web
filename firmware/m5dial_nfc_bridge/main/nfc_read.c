/*
 * PULSE M5Dial bridge — NFC polling task glue.
 * Cards are reported once per presentation. The screen updates even when
 * the USB host has not finished hello; the protocol still waits for a session.
 */
#include "nfc_read.h"
#include "rc522.h"
#include "pcg_ndef.h"
#include "ntag_layout.h"
#include "nfc_track.h"
#include "display_gc9a01.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "nfc";

#define POLL_DELAY_MS      80
#define REMOVED_GRACE_MS  400

static pcg_proto_t *g_proto;
static nfc_track_t track;
static volatile int hold;
static char last_uid[24];

static const char hexd[] = "0123456789ABCDEF";

static void uid_to_hex(const uint8_t *uid, uint8_t len, char *out)
{
    for (int i = 0; i < len; i++) {
        out[i * 2] = hexd[uid[i] >> 4];
        out[i * 2 + 1] = hexd[uid[i] & 0x0F];
    }
    out[len * 2] = 0;
}

/* Buffer starts at page 3 (CC). Returns bytes copied. */
static size_t read_tag_memory(uint8_t *dst, size_t dst_len)
{
    size_t out = 0;
    for (uint8_t page = 3; page < 130 && out + 16 <= dst_len; page = (uint8_t)(page + 4)) {
        if (rc522_read_memory(dst + out, 16, (uint32_t)page * 4) != 16) break;
        out += 16;
    }
    return out;
}

static bool read_tag(pcg_card_t *card)
{
    pcg_tag_id_t id;
    uint8_t mem[PCG_NTAG_MAX_BYTES];
    char json[PCG_NDEF_MAX];
    size_t got;
    pcg_ndef_kind_t kind;
    memset(card, 0, sizeof *card);
    if (!rc522_select(&id, 200)) return false;
    uid_to_hex(id.uid, id.uid_len, card->uid);
    got = read_tag_memory(mem, sizeof mem);
    if (got < 8) {
        snprintf(card->ndef_kind, sizeof card->ndef_kind, "error");
        return true;
    }
    kind = pcg_ntag_classify(mem, got, 3, json, sizeof json);
    snprintf(card->ndef_kind, sizeof card->ndef_kind, "%s", pcg_ndef_kind_name(kind));
    if (kind == PCG_NDEF_PULSE && json[0]) {
        snprintf(card->descriptor, sizeof card->descriptor, "%s", json);
        card->has_descriptor = true;
    }
    return true;
}

static void nfc_task(void *arg)
{
    (void)arg;
    nfc_track_reset(&track);
    while (1) {
        uint32_t now;
        pcg_card_t card;
        nfc_evt_t ev;
        if (hold) {
            vTaskDelay(pdMS_TO_TICKS(POLL_DELAY_MS));
            continue;
        }
        now = (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS);
        memset(&card, 0, sizeof card);
        if (read_tag(&card)) {
            ev = nfc_track_step(&track, 1, card.uid, now, REMOVED_GRACE_MS);
            if (ev == NFC_EVT_NEW) {
                snprintf(last_uid, sizeof last_uid, "%s", card.uid);
                display_note_card(card.ndef_kind, card.uid);
                pcg_proto_on_card(g_proto, &card);
                ESP_LOGI(TAG, "card %s ndef=%s", card.uid, card.ndef_kind);
            }
        } else {
            ev = nfc_track_step(&track, 0, NULL, now, REMOVED_GRACE_MS);
            if (ev == NFC_EVT_GONE) {
                last_uid[0] = 0;
                display_note_card("idle", "");
                pcg_proto_on_removed(g_proto);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_DELAY_MS));
    }
}

static bool write_card(pcg_proto_t *p, const char *request_id,
                       const char *expected_uid, bool overwrite,
                       const char *descriptor_json, pcg_write_result_t *out)
{
    uint8_t mem[PCG_NTAG_MAX_BYTES], planned[PCG_NTAG_MAX_BYTES], check[PCG_NTAG_MAX_BYTES];
    uint8_t pages[40];
    char err[64] = "", json[384];
    size_t got, json_n;
    int dirty, i;
    const char *ds;
    (void)p; (void)request_id;
    out->ok = false;
    out->error[0] = 0;
    if (!expected_uid || !last_uid[0] || strcmp(expected_uid, last_uid) != 0) {
        snprintf(out->error, sizeof out->error, "card removed");
        return true;
    }
    ds = descriptor_json ? strstr(descriptor_json, "{") : NULL;
    if (!ds) {
        snprintf(out->error, sizeof out->error, "descriptor missing");
        return true;
    }
    json_n = 0;
    while (ds[json_n] && ds[json_n] != '}' && json_n + 1 < sizeof json) json_n++;
    if (ds[json_n] != '}') {
        snprintf(out->error, sizeof out->error, "descriptor truncated");
        return true;
    }
    memcpy(json, ds, json_n + 1);
    json[json_n + 1] = 0;

    hold = 1;
    vTaskDelay(pdMS_TO_TICKS(POLL_DELAY_MS + 20));
    got = read_tag_memory(mem, sizeof mem);
    if (got < 20 || pcg_ntag_plan_write(mem, got, 3, json, overwrite ? 1 : 0,
                                        expected_uid, last_uid, planned, err, sizeof err) != 0) {
        snprintf(out->error, sizeof out->error, "%s", err[0] ? err : "write rejected");
        hold = 0;
        return true;
    }
    dirty = pcg_ntag_dirty_pages(mem, planned, got, 3, pages, 40);
    if (dirty < 0) {
        snprintf(out->error, sizeof out->error, "refusing lock or uid write");
        hold = 0;
        return true;
    }
    for (i = 0; i < dirty; i++) {
        const uint8_t *bytes = planned + (size_t)(pages[i] - 3) * 4;
        if (rc522_write_page(pages[i], bytes) != 0) {
            snprintf(out->error, sizeof out->error, "page write failed");
            hold = 0;
            return true;
        }
    }
    got = read_tag_memory(check, sizeof check);
    if (got < 20 || memcmp(check + 4, planned + 4, got - 4) != 0) {
        snprintf(out->error, sizeof out->error, "readback failed");
        hold = 0;
        return true;
    }
    hold = 0;
    out->ok = true;
    return true;
}

void nfc_read_start(pcg_proto_t *proto)
{
    g_proto = proto;
    proto->write_card = write_card;
    xTaskCreatePinnedToCore(nfc_task, "nfc", 8192, NULL, 6, NULL, 0);
}
