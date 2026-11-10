/*
 * Host-side unit test for pcg_ndef.{c,h} — compile and run without ESP-IDF:
 *
 *   cc -std=c11 -I main main/pcg_ndef.c tests/test_pcg_ndef.c -o /tmp/t_pcg_ndef
 *   /tmp/t_pcg_ndef
 *
 * Builds an NDEF message the way the web app's NDEFReader.write() lays out a
 * single MIME record, then checks extract + parse + field readers round-trip.
 */
#include <stdio.h>
#include <string.h>
#include "pcg_ndef.h"

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { printf("FAIL: %s\n", msg); failures++; } else { printf("ok:  %s\n", msg); } } while (0)

/* Build a full NTAG215 page image (135 pages, 4 bytes each) with an NDEF
 * TLV + MIME record for the given identity JSON. */
static void build_ntag(uint8_t mem[135 * 4], const char *payload) {
    memset(mem, 0, 135 * 4);
    mem[0] = 0x04; mem[1] = 0xAA; mem[2] = 0x1B; mem[3] = 0x2C;   /* UID pages0 */
    mem[15] = 0x03;  /* ...lock bytes page */
    /* page 4 = Capability Container */
    mem[16] = 0xE1; mem[17] = 0x10; mem[18] = 0x6E; mem[19] = 0x00;
    /* page 5: NDEF TLV -> 0x03, len(1 byte), message... */
    const uint8_t *mime = (const uint8_t *)"application/vnd.pcg.identity+json";
    size_t plen = strlen(payload);
    uint8_t record[4 + 2 + 33 + plen];
    /* record header: MB|ME|SR|TNF(2) = 0xD2; we use short record since plen<256 */
    size_t r = 0;
    record[r++] = 0xD2;              /* MB|ME|SR | TNF=2 */
    record[r++] = 33;                /* type len */
    record[r++] = (uint8_t)plen;     /* payload len */
    memcpy(record + r, mime, 33); r += 33;
    memcpy(record + r, payload, plen); r += plen;
    /* NDEF TLV byte 0x03 + length + record */
    mem[20] = 0x03;
    mem[21] = (uint8_t)r;
    memcpy(&mem[22], record, r);
    /* terminator at end */
    mem[22 + r] = 0xFE;
}

int main(void) {
    const char *id = "{\"game\":\"pcg\",\"v\":1,\"type\":\"player\",\"id\":\"12345678-1234-4123-8123-123456789abc\",\"skin\":\"03\",\"name\":\"小明\"}";
    uint8_t pages[135 * 4];
    build_ntag(pages, id);

    /* stage 1: extract message */
    uint8_t msg[256];
    size_t mlen = pcg_ndef_extract(pages, sizeof pages, msg, sizeof msg);
    CHECK(mlen > 0, "extract returns non-zero length");
    printf("       extracted message len = %zu\n", mlen);

    /* stage 2: parse to JSON (must be the identity payload minus our record wrap) */
    char json[PCG_NDEF_MAX];
    bool ok = pcg_ndef_parse_message(msg, mlen, json, sizeof json);
    CHECK(ok, "parse_message returns true for valid identity");

    if (ok) {
        printf("  parsed json = %s\n", json);
        CHECK(strstr(json, "\"type\":\"player\"") != NULL, "json includes player type");
        CHECK(strstr(json, "\"skin\":\"03\"") != NULL, "json includes skin");
    }

    /* stage 3: field extraction used by the display layer */
    char skin[8] = {0}, name[32] = {0}, type[16] = {0};
    CHECK(pcg_ndef_json_string(ok ? json : "{}", "skin", skin, sizeof skin) && strcmp(skin, "03") == 0,
          "extract skin == 03");
    CHECK(pcg_ndef_json_string(ok ? json : "{}", "name", name, sizeof name),
          "extract name present");
    CHECK(pcg_ndef_json_string(ok ? json : "{}", "type", type, sizeof type) && strcmp(type, "player") == 0,
          "extract type == player");
    CHECK(pcg_identity_is_player(ok ? json : "{}"), "is_player true");

    /* negative: a non-identity message should not parse */
    const uint8_t other[] = "not an ndef record at all";
    CHECK(!pcg_ndef_parse_message(other, sizeof other - 1, json, sizeof json),
          "garbage message returns false");

    if (failures) { printf("\n%d failure(s)\n", failures); return 1; }
    printf("\nall tests passed\n");
    return 0;
}