#include <stdio.h>
#include <string.h>
#include "gc9a01_seq.h"
#include "nfc_track.h"
#include "session_gate.h"
#include "ui_model.h"
#include "ntag_layout.h"
#include "pcg_ndef.h"

static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { printf("FAIL: %s\n", m); failures++; } else printf("ok:  %s\n", m); } while (0)

static void put_cc(uint8_t *mem, int page, uint8_t size)
{
    int o = page * 4;
    mem[o] = 0xE1; mem[o + 1] = 0x10; mem[o + 2] = size; mem[o + 3] = 0x00;
}

int main(void)
{
    CHECK(gc9a01_sequence_ok(), "gc9a01 init has sleep-out, display-on, no NOP");
    CHECK(gc9_window_bytes(0, 0, 239, 239) == 240 * 240 * 2, "full frame is 115200 bytes");
    CHECK(gc9_window_bytes(0, 0, 240, 10) < 0, "x past 239 is rejected");
    CHECK(gc9_window_bytes(5, 5, 4, 6) < 0, "inverted window is rejected");

    nfc_track_t tr;
    nfc_track_reset(&tr);
    CHECK(nfc_track_step(&tr, 0, NULL, 1000, 400) == NFC_EVT_NONE, "no card stays idle");
    CHECK(nfc_track_step(&tr, 0, NULL, 5000, 400) == NFC_EVT_NONE, "still no card");
    CHECK(nfc_track_step(&tr, 1, "04AA", 6000, 400) == NFC_EVT_NEW, "first sight is new");
    CHECK(nfc_track_step(&tr, 1, "04AA", 6100, 400) == NFC_EVT_HELD, "same uid is not a new card");
    CHECK(nfc_track_step(&tr, 0, NULL, 6300, 400) == NFC_EVT_NONE, "brief gap is not removal");
    CHECK(nfc_track_step(&tr, 0, NULL, 6800, 400) == NFC_EVT_GONE, "grace expiry removes once");
    CHECK(nfc_track_step(&tr, 0, NULL, 8000, 400) == NFC_EVT_NONE, "removal is not repeated");
    CHECK(nfc_track_step(&tr, 1, "04AA", 8100, 400) == NFC_EVT_NEW, "return is a new presentation");

    ui_model_t ui;
    char a[22], b[22], c[22];
    ui_model_reset(&ui);
    CHECK(ui_model_apply(&ui, 1, 0, "idle", "", a, b, c) == UI_BEEP_NONE, "ready does not beep");
    CHECK(strcmp(a, "READY") == 0 && strcmp(b, "USB wait") == 0, "disconnected screen says USB wait");
    CHECK(ui_model_apply(&ui, 1, 1, "idle", "", a, b, c) == UI_BEEP_NONE, "host open does not beep");
    CHECK(strcmp(b, "PC open") == 0, "open port is shown");
    CHECK(ui_model_apply(&ui, 1, 1, "blank", "04AA", a, b, c) == UI_BEEP_OK, "blank card beeps once");
    CHECK(strcmp(a, "BLANK CARD") == 0, "blank card is labeled");
    CHECK(ui_model_apply(&ui, 1, 1, "blank", "04AA", a, b, c) == UI_BEEP_NONE, "same blank card does not beep again");
    CHECK(ui_model_apply(&ui, 1, 1, "error", "04AA", a, b, c) == UI_BEEP_ERR, "read error beeps");
    CHECK(ui_model_apply(&ui, 1, 1, "idle", "", a, b, c) == UI_BEEP_NONE, "removal does not beep");

    uint8_t mem[256];
    uint8_t out[256];
    char err[64];
    char json[PCG_NDEF_MAX];
    memset(mem, 0, sizeof mem);
    put_cc(mem, 0, PCG_NTAG_CC_215); /* base page 3: offset 0 is CC */
    CHECK(pcg_ntag_classify(mem, sizeof mem, 3, json, sizeof json) == PCG_NDEF_BLANK, "formatted empty user area is blank");
    mem[0] = 0x00;
    CHECK(pcg_ntag_classify(mem, sizeof mem, 3, json, sizeof json) == PCG_NDEF_UNFORMATTED, "missing CC is unformatted");
    put_cc(mem, 0, PCG_NTAG_CC_215);
    const char *id = "{\"game\":\"pcg\",\"v\":1,\"type\":\"player\",\"id\":\"12345678-1234-4123-8123-123456789abc\",\"skin\":\"01\",\"name\":\"A\"}";
    CHECK(pcg_ntag_plan_write(mem, sizeof mem, 3, id, 0, "04AA", "04AA", out, err, sizeof err) != 0, "blank write without confirm is refused");
    CHECK(pcg_ntag_plan_write(mem, sizeof mem, 3, id, 1, "04AA", "04BB", out, err, sizeof err) != 0, "uid change is card removed");
    CHECK(strcmp(err, "card removed") == 0, "removed error text");
    CHECK(pcg_ntag_plan_write(mem, sizeof mem, 3, id, 1, "04AA", "04AA", out, err, sizeof err) == 0, "confirmed blank init plans a write");
    CHECK(pcg_ntag_classify(out, sizeof out, 3, json, sizeof json) == PCG_NDEF_PULSE, "planned image reads back as pulse");
    CHECK(strstr(json, "\"skin\":\"01\"") != NULL, "readback keeps the identity");
    {
        uint8_t pages[64];
        int n = pcg_ntag_dirty_pages(mem, out, sizeof mem, 3, pages, 64);
        int i, bad = 0;
        CHECK(n > 0, "init dirties user pages");
        for (i = 0; i < n; i++) if (pages[i] < 4 || pages[i] > 129) bad = 1;
        CHECK(!bad, "dirty pages stay inside the user area");
        CHECK(memcmp(mem, out, 4) == 0, "capability container is not rewritten for a blank formatted tag");
    }
    memset(mem, 0, sizeof mem);
    CHECK(pcg_ntag_plan_write(mem, sizeof mem, 3, id, 1, "04AA", "04AA", out, err, sizeof err) != 0, "unformatted tag is not guessed or formatted");
    CHECK(strcmp(err, "unformatted") == 0, "unformatted error text");

    put_cc(mem, 0, PCG_NTAG_CC_215);
    mem[4] = 0x03; mem[5] = 3; mem[6] = 'a'; mem[7] = 'b'; mem[8] = 'c'; mem[9] = 0xFE;
    CHECK(pcg_ntag_classify(mem, sizeof mem, 3, json, sizeof json) == PCG_NDEF_FOREIGN, "non-PULSE NDEF is foreign");
    CHECK(pcg_ntag_plan_write(mem, sizeof mem, 3, id, 0, "04AA", "04AA", out, err, sizeof err) != 0, "foreign content is not overwritten quietly");
    CHECK(pcg_ntag_plan_write(mem, sizeof mem, 3, id, 1, "04AA", "04AA", out, err, sizeof err) == 0, "explicit overwrite of foreign content is allowed");

    char huge[400];
    memset(huge, 'x', sizeof huge);
    memcpy(huge, "{\"game\":\"pcg\",\"v\":1,\"name\":\"", 28);
    huge[399] = 0;
    CHECK(pcg_ntag_plan_write(mem, sizeof mem, 3, huge, 1, "04AA", "04AA", out, err, sizeof err) != 0, "oversized payload is refused");

    session_gate_t sg;
    session_gate_reset(&sg);
    CHECK(session_gate_on_new(&sg, "04AA") == SG_NONE, "card seen before hello is not announced");
    CHECK(session_gate_on_held(&sg) == SG_NONE, "holding the card does not announce");
    CHECK(session_gate_on_hello(&sg) == SG_CARD, "hello reports the card already on the reader");
    CHECK(session_gate_on_hello(&sg) == SG_NONE, "another hello does not fake a new tap");
    CHECK(session_gate_on_gone(&sg) == SG_REMOVED, "announced card removal is one event");
    CHECK(session_gate_on_gone(&sg) == SG_NONE, "removal is not repeated");
    CHECK(session_gate_on_new(&sg, "04AA") == SG_CARD, "a real new presentation after removal is announced");

    {
        uint8_t tag[32];
        pcg_tag_facts_t facts;
        uint8_t open_lock[2] = {0, 0};
        uint8_t static_lock[2] = {0xFF, 0};
        memset(tag, 0, sizeof tag);
        put_cc(tag, 0, PCG_NTAG_CC_215);
        pcg_ntag_facts(tag, sizeof tag, 3, open_lock, NULL, &facts, NULL, 0);
        CHECK(facts.kind == PCG_NDEF_BLANK, "facts see a blank NTAG215");
        CHECK(strcmp(facts.type_name, "NTAG215") == 0, "CC 0x3E is NTAG215");
        CHECK(facts.capacity == 496, "NTAG215 NDEF budget is 496");
        CHECK(facts.writable == 1 && strcmp(facts.lock, "open") == 0, "open CC and clear static lock are writable");
        CHECK(strcmp(facts.cc_hex, "E1103E00") == 0, "CC bytes are recoverable");
        pcg_ntag_facts(tag, sizeof tag, 3, static_lock, NULL, &facts, NULL, 0);
        CHECK(facts.writable == 0 && strcmp(facts.lock, "static") == 0, "static lock is reported and not cleared");
    }

    if (failures) { printf("\n%d failure(s)\n", failures); return 1; }
    printf("\nall dial logic tests passed\n");
    return 0;
}
