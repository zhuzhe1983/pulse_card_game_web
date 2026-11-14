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
    size_t i = 0;
    while (i < n && p[i] == 0) i++;
    if (i == n || p[i] == 0xfe) return 1;
    if (n - i >= 2 && p[i] == 3 && p[i+1] == 0) return 1;
    /* A standard empty NDEF record, as returned by Android's blank tags. */
    return n - i >= 5 && p[i] == 3 && p[i+1] == 3 && p[i+2] == 0xd0 && p[i+3] == 0 && p[i+4] == 0;
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
    size_t plen = json ? strlen(json) : 0;
    if (!plen || plen > 384) return -1;
    size_t header = plen <= 255 ? 3 : 6;
    size_t n = header + sizeof(mime) - 1 + plen;
    if (n > rec_max) return -1;
    rec[0] = plen <= 255 ? 0xd2 : 0xc2;
    rec[1] = sizeof(mime) - 1;
    if (plen <= 255) rec[2] = (uint8_t)plen;
    else { rec[2] = rec[3] = 0; rec[4] = (uint8_t)(plen >> 8); rec[5] = (uint8_t)plen; }
    memcpy(rec + header, mime, sizeof(mime) - 1);
    memcpy(rec + header + sizeof(mime) - 1, json, plen);
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
    size_t tlv_header = rec_n >= 255 ? 4 : 2;
    need = tlv_header + rec_n + 1; /* TLV type, short length, record, terminator */
    room = len - ndef_at;
    if (need > room || need > (size_t)cap) {
        set_err(err, err_len, "capacity");
        return -1;
    }
    memcpy(tmp, mem, len);
    if (room < (size_t)cap) { set_err(err, err_len, "incomplete memory"); return -1; }
    memset(tmp + ndef_at, 0x00, (size_t)cap);
    tmp[ndef_at] = 0x03;
    tmp[ndef_at + 1] = rec_n >= 255 ? 255 : (uint8_t)rec_n;
    if (tlv_header == 4) { tmp[ndef_at + 2] = (uint8_t)(rec_n >> 8); tmp[ndef_at + 3] = (uint8_t)rec_n; }
    memcpy(tmp + ndef_at + tlv_header, rec, rec_n);
    tmp[ndef_at + tlv_header + rec_n] = 0xFE;
    if (pcg_ntag_classify(tmp, len, base_page, NULL, 0) != PCG_NDEF_PULSE) {
        set_err(err, err_len, "readback failed");
        return -1;
    }
    memcpy(out, tmp, len);
    set_err(err, err_len, "");
    return 0;
}

static void hex_encode(const uint8_t *src, size_t n, char *dst, size_t dst_len, int *truncated)
{
    static const char hex[] = "0123456789ABCDEF";
    size_t i, limit;
    if (truncated) *truncated = 0;
    if (!dst || dst_len == 0) return;
    limit = (dst_len - 1) / 2;
    if (n > limit) {
        n = limit;
        if (truncated) *truncated = 1;
    }
    for (i = 0; i < n; i++) {
        dst[i * 2] = hex[src[i] >> 4];
        dst[i * 2 + 1] = hex[src[i] & 0x0F];
    }
    dst[n * 2] = 0;
}

void pcg_ntag_facts(const uint8_t *mem, size_t len, int base_page,
                    const uint8_t *lock2, const uint8_t *dyn3,
                    pcg_tag_facts_t *out, char *json, size_t json_len)
{
    int cc_at, ndef_at, cap = 0;
    uint8_t msg[512];
    size_t mlen;
    memset(out, 0, sizeof *out);
    out->capacity = -1;
    out->writable = -1;
    snprintf(out->type_name, sizeof out->type_name, "unknown");
    snprintf(out->lock, sizeof out->lock, "unknown");
    out->kind = pcg_ntag_classify(mem, len, base_page, json, json_len);
    cc_at = page_off(base_page, 3);
    ndef_at = page_off(base_page, 4);
    if (mem && cc_at >= 0 && (size_t)cc_at + 4 <= len) {
        const uint8_t *cc = mem + cc_at;
        hex_encode(cc, 4, out->cc_hex, sizeof out->cc_hex, NULL);
        if (cc_ok(cc, &cap)) {
            out->capacity = cap;
            if (cc[2] == 0x12) snprintf(out->type_name, sizeof out->type_name, "NTAG213");
            else if (cc[2] == PCG_NTAG_CC_215) snprintf(out->type_name, sizeof out->type_name, "NTAG215");
            else if (cc[2] == 0x6F) snprintf(out->type_name, sizeof out->type_name, "NTAG216");
            if ((cc[3] & 0x0F) == 0) {
                out->writable = 1;
                snprintf(out->lock, sizeof out->lock, "open");
            } else {
                out->writable = 0;
                snprintf(out->lock, sizeof out->lock, "cc");
            }
        }
    }
    if (lock2 && (lock2[0] || lock2[1])) {
        out->writable = 0;
        snprintf(out->lock, sizeof out->lock, "static");
    }
    if (dyn3 && (dyn3[0] || dyn3[1] || dyn3[2])) {
        out->writable = 0;
        snprintf(out->lock, sizeof out->lock, "dynamic");
    }
    if (mem && ndef_at >= 0 && (size_t)ndef_at < len) {
        mlen = pcg_ndef_extract(mem + ndef_at, len - (size_t)ndef_at, msg, sizeof msg);
        if (mlen) hex_encode(msg, mlen, out->ndef_hex, sizeof out->ndef_hex, &out->ndef_hex_truncated);
    }
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
        if (count >= max_pages) return -1;
        if (pages) pages[count] = (uint8_t)page;
        count++;
    }
    return count;
}
