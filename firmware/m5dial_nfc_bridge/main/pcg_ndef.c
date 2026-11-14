#include "pcg_ndef.h"
#include <stdint.h>
#include <string.h>

#define PCG_MIME "application/vnd.pcg.identity+json"
#define PCG_MIME_LEN 33u

/* Extract the NDEF message from NTAG user memory.
 * A full tag image has the TLV at page 4 (offset 16). A buffer that already
 * starts at page 4 begins with 0x03 / 0x00 / 0xFE and is scanned from byte 0.
 * CC itself lives on page 3 and is not required here.
 */
size_t pcg_ndef_extract(const uint8_t *mem, size_t mem_len,
                        uint8_t *out, size_t out_len)
{
    if (!mem || !out || !mem_len) return 0;
    size_t i = (mem[0] == 0 || mem[0] == 1 || mem[0] == 2 || mem[0] == 3 || mem[0] == 0xfd || mem[0] == 0xfe) ? 0 : 16;
    while (i < mem_len) {
        uint8_t type = mem[i++];
        if (type == 0) continue;
        if (type == 0xfe || i >= mem_len) return 0;
        size_t length = mem[i++];
        if (length == 0xff) {
            if (mem_len - i < 2) return 0;
            length = ((size_t)mem[i] << 8) | mem[i + 1]; i += 2;
        }
        if (length > mem_len - i) return 0;
        if (type == 3) {
            if (length > out_len) return 0;
            memcpy(out, mem + i, length);
            return length;
        }
        i += length;
    }
    return 0;
}

/* NDEF long records use a FOUR-byte payload length. Never truncate JSON. */
bool pcg_ndef_parse_message(const uint8_t *msg, size_t len, char *out, size_t out_len)
{
    if (!msg || !out || !out_len || len < 3) return false;
    size_t pos = 0, records = 0; bool found = false, ended = false;
    while (pos < len && !ended) {
        if (len - pos < 3) return false;
        uint8_t flags = msg[pos++]; size_t tn = msg[pos++];
        if (!!(flags & 0x80) != (records == 0) || (flags & 0x20) || (flags & 7) >= 6) return false;
        size_t plen = msg[pos++];
        if (!(flags & 0x10)) {
            if (len - pos < 3) return false;
            plen = (plen << 24) | ((size_t)msg[pos] << 16) | ((size_t)msg[pos+1] << 8) | msg[pos+2]; pos += 3;
        }
        size_t idlen = 0;
        if (flags & 8) { if (pos == len) return false; idlen = msg[pos++]; }
        if (tn > len - pos || idlen > len - pos - tn || plen > len - pos - tn - idlen) return false;
        if ((flags & 7) == 2 && tn == PCG_MIME_LEN && memcmp(msg + pos, PCG_MIME, tn) == 0) {
            if (found || !plen || plen >= out_len || memchr(msg + pos + tn + idlen, 0, plen)) return false;
            memcpy(out, msg + pos + tn + idlen, plen); out[plen] = 0; found = true;
        }
        pos += tn + idlen + plen; records++; ended = !!(flags & 0x40);
    }
    return ended && pos == len && found;
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