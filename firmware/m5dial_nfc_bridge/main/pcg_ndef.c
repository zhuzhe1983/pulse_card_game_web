#include "pcg_ndef.h"
#include <stdint.h>
#include <string.h>

#define PCG_MIME "application/vnd.pcg.identity+json"
#define PCG_MIME_LEN 33u

/* Extract the NDEF message from raw NTAG2 memory pages (4 bytes per page).
 * pages 0..3 UID/BCC/lock · page 4 = CC · page 5+ = NDEF TLV then 0xFE.
 */
size_t pcg_ndef_extract(const uint8_t *mem, size_t mem_len,
                        uint8_t *out, size_t out_len)
{
    size_t cc = 4 * 4;                  /* page 4 */
    if (mem_len < cc + 1) return 0;
    size_t i = cc;
    size_t end = cc + 64;
    if (end > mem_len) end = mem_len;

    for (; i < end; ) {
        uint8_t t = mem[i];
        if (t == 0xFE) return 0;        /* terminator before NDEF TLV */
        if (t == 0x03) {
            size_t j = i + 1;
            if (j >= mem_len) return 0;
            uint32_t n = mem[j++];
            if (n == 0xFF) {            /* extended 2-byte length */
                if (j + 2 > mem_len) return 0;
                n = ((uint32_t)mem[j]) << 8 | mem[j + 1];
                j += 2;
            }
            size_t w = 0;
            while (n > 0 && j < mem_len && w < out_len) {
                uint8_t b = mem[j++];
                --n;
                if (b == 0xFE) break;   /* terminator closes message */
                out[w++] = b;
            }
            return w;
        }
        ++i;
    }
    return 0;
}

/* Parse the first record of an NDEF message whose type is the PULSE identity
 * MIME; copy its payload bytes (the identity JSON) verbatim into out.
 *
 * Record header:
 *   flags[1]  (MB 0x80, ME 0x40, SR 0x10, IL 0x08, TNF low 3 bits)
 *   typeLen[1]
 *   payloadLen[ SR ? 1 : 2 ]
 *   [ idLen[1] if IL ]
 *   type[typeLen]
 *   [ id[idLen] if IL ]
 *   payload[payloadLen]
 */
bool pcg_ndef_parse_message(const uint8_t *msg, size_t len,
                            char *out, size_t out_len)
{
    if (len < 2) return false;
    uint8_t flags = msg[0];
    size_t tn = msg[1];
    bool sr = (flags & 0x10) != 0;
    bool il = (flags & 0x08) != 0;
    size_t off = sr ? 3 : 4;            /* past flags/typeLen/payloadLen */
    size_t plen;
    if (sr) {
        plen = len > 2 ? msg[2] : 0;
    } else {
        if (len < 4) return false;
        plen = ((size_t)msg[2]) << 8 | msg[3];
    }
    size_t idl = 0;
    if (il) {
        if (off >= len) return false;
        idl = msg[off];
        off += 1;
    }
    if (off + tn > len) return false;              /* need the type bytes */
    const uint8_t *tstart = msg + off;
    if (tn != PCG_MIME_LEN || memcmp(tstart, PCG_MIME, PCG_MIME_LEN) != 0)
        return false;
    off += tn;                                      /* past type */
    if (off + idl > len) return false;            /* id field */
    off += idl;
    if (off + plen > len) return false;           /* payload fits */
    size_t cp = (plen < out_len - 1) ? plen : (out_len - 1);
    memcpy(out, msg + off, cp);
    out[cp] = '\0';
    return true;
}

/* Lightweight field readers for the display layer: pull a quoted JSON string
 * value out of the payload. Cheap, dependency-free, stops at the closing
 * quote. No full JSON parser is needed to show skin/nickname.
 * JSON will contain ..."type":"player"... or "skin":"03". These scans handle
 * one key at a time and are strstr()-driven. */
bool pcg_ndef_json_string(const char *json, const char *key,
                          char *out, size_t out_len)
{
    size_t klen = strlen(key);
    const char *p = json;
    while ((p = strstr(p, key)) != NULL) {
        const char *q = p + klen;
        /* JSON key is `"key":` — the key byte itself was passed without
         * quotes, so after it must come a closing quote then a colon. */
        if (*q == '"' || *q == '\n' || *q == '\t' || *q == ' ' || *q == ':' ) {
            /* skip to the colon */
            while (*q && *q != ':') ++q;
            if (!*q) { p += klen; continue; }
            ++q;                                  /* past ':' */
            while (*q == ' ' || *q == '\t') ++q;
            if (*q == '"') {
                ++q;
                size_t w = 0;
                while (*q && *q != '"' && w < out_len - 1) {
                    if (*q == '\\' && *(q + 1) == '"') { out[w++] = '"'; q += 2; continue; }
                    if (*q == '\\' && *(q + 1) == '\\') { out[w++] = '\\'; q += 2; continue; }
                    out[w++] = *q++;
                }
                out[w] = '\0';
                return true;
            }
        }
        p += klen;
    }
    out[0] = '\0';
    return false;
}

/* Determine the PULSE object type for the dial label. */
bool pcg_identity_is_player(const char *json)
{
    char t[16];
    return pcg_ndef_json_string(json, "type", t, sizeof t) && strcmp(t, "player") == 0;
}