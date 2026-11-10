#include "ntag_layout.h"
#include "pcg_ndef.h"
#include <stdio.h>
#include <string.h>

const char *pcg_ndef_kind_name(pcg_ndef_kind_t kind)
{
    switch (kind) {
    case PCG_NDEF_BLANK: return "blank";
    case PCG_NDEF_UNFORMATTED: return "unformatted";
    case PCG_NDEF_PULSE: return "pulse";
    case PCG_NDEF_FOREIGN: return "foreign";
    case PCG_NDEF_UNSUPPORTED: return "unsupported";
    case PCG_NDEF_ERROR: return "error";
    }
    return "error";
}

static int page_off(int base_page, int page)
{
    return (page - base_page) * 4;
}

static int cc_ok(const uint8_t cc[4], int *cap)
{
    if (cc[0] != 0xE1 || cc[1] != 0x10 || cc[3] != 0x00) return 0;
    if (cc[2] != 0x12 && cc[2] != PCG_NTAG_CC_215 && cc[2] != 0x6F) return 0;
    if (cap) *cap = (int)cc[2] * 8;
    return 1;
}

static int region_blank(const uint8_t *p, size_t n)
{
    size_t i;
    if (!n) return 1;
    if (p[0] == 0x00 || p[0] == 0xFE) {
        for (i = 0; i < n && i < 16; i++) {
            if (p[i] != 0x00 && p[i] != 0xFE) return 0;
        }
        return 1;
    }
    if (p[0] == 0x03 && n >= 2 && p[1] == 0x00) return 1;
    return 0;
}

pcg_ndef_kind_t pcg_ntag_classify(const uint8_t *mem, size_t len, int base_page,
                                  char *json, size_t json_len)
{
    int cc_at, ndef_at, cap = 0;
    uint8_t msg[512];
    char parsed[PCG_NDEF_MAX];
    size_t mlen;
    if (!mem || len < 4) return PCG_NDEF_ERROR;
    if (json && json_len) json[0] = 0;
    cc_at = page_off(base_page, 3);
    ndef_at = page_off(base_page, 4);
    if (ndef_at < 0 || (size_t)ndef_at >= len) return PCG_NDEF_ERROR;
    if (cc_at >= 0) {
        if ((size_t)cc_at + 4 > len) return PCG_NDEF_ERROR;
        if (!cc_ok(mem + cc_at, &cap)) {
            if (region_blank(mem + ndef_at, len - (size_t)ndef_at)
                && (mem[cc_at] == 0x00 || mem[cc_at] == 0xFF))
                return PCG_NDEF_UNFORMATTED;
            return PCG_NDEF_UNFORMATTED;
        }
    }
    if (region_blank(mem + ndef_at, len - (size_t)ndef_at))
        return PCG_NDEF_BLANK;
    mlen = pcg_ndef_extract(mem + ndef_at, len - (size_t)ndef_at, msg, sizeof msg);
    if (!mlen) {
        /* A 0x03 TLV that extract could not finish is a short/broken message. */
        if (mem[ndef_at] == 0x03) return PCG_NDEF_ERROR;
        return PCG_NDEF_FOREIGN;
    }
    if (pcg_ndef_parse_message(msg, mlen, parsed, sizeof parsed)) {
        if (json && json_len) snprintf(json, json_len, "%s", parsed);
        return PCG_NDEF_PULSE;
    }
    return PCG_NDEF_FOREIGN;
}

static int build_record(const char *json, uint8_t *rec, size_t rec_max, size_t *out_n)
{
    static const char mime[] = "application/vnd.pcg.identity+json";
    size_t plen, n;
    if (!json || !strstr(json, "\"game\":\"pcg\"")) return -1;
    plen = strlen(json);
    if (plen == 0 || plen > 384) return -1;
    n = 3 + 33 + plen;
    if (plen > 255) n += 1;
    if (n > rec_max) return -1;
    rec[0] = 0xD2;
    rec[1] = 33;
    if (plen <= 255) {
        rec[2] = (uint8_t)plen;
        memcpy(rec + 3, mime, 33);
        memcpy(rec + 36, json, plen);
    } else {
        return -1;
    }
    *out_n = n;
    return 0;
}

static void set_err(char *err, size_t n, const char *msg)
{
    if (err && n) snprintf(err, n, "%s", msg);
}

int pcg_ntag_plan_write(const uint8_t *mem, size_t len, int base_page,
                        const char *json, int overwrite,
                        const char *expected_uid, const char *current_uid,
                        uint8_t *out, char *err, size_t err_len)
{
    uint8_t tmp[PCG_NTAG_MAX_BYTES];
    uint8_t rec[430];
    size_t rec_n = 0, need, ndef_at, room;
    int cap = 0, cc_at;
    pcg_ndef_kind_t kind;
    if (!mem || !out || len < 8 || len > PCG_NTAG_MAX_BYTES) {
        set_err(err, err_len, "capacity");
        return -1;
    }
    if (expected_uid && current_uid && strcmp(expected_uid, current_uid) != 0) {
        set_err(err, err_len, "card removed");
        return -1;
    }
    if (!overwrite) {
        set_err(err, err_len, "overwrite required");
        return -1;
    }
    kind = pcg_ntag_classify(mem, len, base_page, NULL, 0);
    if (kind == PCG_NDEF_UNFORMATTED) {
        set_err(err, err_len, "unformatted");
        return -1;
    }
    if (kind == PCG_NDEF_ERROR || kind == PCG_NDEF_UNSUPPORTED) {
        set_err(err, err_len, "read error");
        return -1;
    }
    cc_at = page_off(base_page, 3);
    ndef_at = (size_t)page_off(base_page, 4);
    if (cc_at < 0 || (size_t)cc_at + 4 > len || ndef_at >= len) {
        set_err(err, err_len, "capacity");
        return -1;
    }
    if (!cc_ok(mem + cc_at, &cap)) {
        set_err(err, err_len, "unformatted");
        return -1;
    }
    if (build_record(json, rec, sizeof rec, &rec_n) != 0) {
        set_err(err, err_len, "capacity");
        return -1;
    }
    need = 2 + rec_n + 1; /* TLV type, short length, record, terminator */
    room = len - ndef_at;
    if (need > room || need > (size_t)cap) {
        set_err(err, err_len, "capacity");
        return -1;
    }
    memcpy(tmp, mem, len);
    memset(tmp + ndef_at, 0x00, room);
    tmp[ndef_at] = 0x03;
    tmp[ndef_at + 1] = (uint8_t)rec_n;
    memcpy(tmp + ndef_at + 2, rec, rec_n);
    tmp[ndef_at + 2 + rec_n] = 0xFE;
    if (pcg_ntag_classify(tmp, len, base_page, NULL, 0) != PCG_NDEF_PULSE) {
        set_err(err, err_len, "readback failed");
        return -1;
    }
    memcpy(out, tmp, len);
    set_err(err, err_len, "");
    return 0;
}

int pcg_ntag_dirty_pages(const uint8_t *before, const uint8_t *after, size_t len,
                         int base_page, uint8_t *pages, int max_pages)
{
    size_t pages_n, i;
    int count = 0;
    if (!before || !after || (len % 4) != 0) return -1;
    pages_n = len / 4;
    for (i = 0; i < pages_n; i++) {
        int page = base_page + (int)i;
        if (memcmp(before + i * 4, after + i * 4, 4) == 0) continue;
        if (page < 4 || page > 129) return -1;
        if (count < max_pages && pages) pages[count] = (uint8_t)page;
        count++;
    }
    return count;
}
