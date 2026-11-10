#include "pcg_proto.h"
#include <stdio.h>
#include <string.h>

#define PCG_MASK_UID (1u << 0)
#define PCG_MASK_RD  (1u << 1)
#define PCG_MASK_WR  (1u << 2)

void pcg_proto_init(pcg_proto_t *p, const char *device_name, int capabilities,
                    pcg_send_fn send, pcg_write_fn write_card, void *user)
{
    memset(p, 0, sizeof *p);
    p->device_name = device_name ? device_name : "PULSE M5Dial NFC bridge";
    p->capabilities = capabilities;
    p->send = send;
    p->write_card = write_card;
    p->user = user;
    p->nfc_ready = false;
    p->session = false;
    p->card_present = false;
}

bool pcg_proto_has_read_ndef(pcg_proto_t *p) { return (p->capabilities & PCG_MASK_RD) != 0; }
bool pcg_proto_has_write_ndef(pcg_proto_t *p){ return (p->capabilities & PCG_MASK_WR) != 0; }

void pcg_proto_set_ready(pcg_proto_t *p, bool ready)
{
    p->nfc_ready = ready;
    if (!ready) { p->card_present = false; p->current_uid[0] = 0; }
}

/*
 * Crude but sufficient JSON string-field extractor: finds `"key"` then ':',
 * then either a quoted string (copied without the quotes) or a literal token
 * (copied verbatim). Copied into out (NUL-terminated). Returns true if found.
 */
static bool grab(const char *line, const char *key, char *out, size_t outlen)
{
    size_t kl = strlen(key);
    const char *p = strstr(line, key);
    if (!p) return false;
    const char *q = p + kl;
    while (*q && *q != ':') ++q;          /* slide to colon */
    if (!*q) return false;
    ++q;                                    /* past ':' */
    while (*q == ' ' || *q == '\t') ++q;
    if (*q == '"') {
        ++q;
        size_t w = 0;
        while (*q && *q != '"' && w < outlen - 1) {
            if (*q == '\\' && (*(q + 1) == '"' || *(q + 1) == '\\')) { q++; }
            out[w++] = *q++;
        }
        out[w] = '\0';
        return true;
    }
    /* unquoted literal (true/false/no similar) until comma or closing brace */
    size_t w = 0;
    while (*q && *q != ',' && *q != '}' && *q != '\n' && w < outlen - 1)
        out[w++] = *q++;
    out[w] = '\0';
    return w > 0;
}

void pcg_proto_on_card(pcg_proto_t *p, const pcg_card_t *card)
{
    if (!p->session || !p->nfc_ready) return;
    char line[PCG_PROTO_LINE_MAX + 128];
    const char *uid = (card && card->uid[0]) ? card->uid : "";
    const char *kind = (card && card->ndef_kind[0]) ? card->ndef_kind : "unknown";
    if (card && card->has_descriptor && card->descriptor[0]) {
        snprintf(line, sizeof line,
                 "{\"type\":\"card\",\"uid\":\"%s\",\"tech\":\"nfc-a\",\"descriptor\":%s,\"ndef\":\"%s\"}",
                 uid, card->descriptor, kind);
    } else {
        snprintf(line, sizeof line,
                 "{\"type\":\"card\",\"uid\":\"%s\",\"tech\":\"nfc-a\",\"descriptor\":null,\"ndef\":\"%s\"}",
                 uid, kind);
    }
    p->send(p, line);
    if (card && card->uid[0]) {
        strncpy(p->current_uid, card->uid, sizeof p->current_uid - 1);
        p->current_uid[sizeof p->current_uid - 1] = 0;
        p->card_present = true;
    }
}

void pcg_proto_on_removed(pcg_proto_t *p)
{
    if (!p->session || !p->nfc_ready) return;
    p->send(p, "{\"type\":\"removed\"}");
    p->card_present = false;
    p->current_uid[0] = 0;
}

static void emit_error(pcg_proto_t *p, const char *msg)
{
    char line[PCG_PROTO_LINE_MAX];
    snprintf(line, sizeof line, "{\"type\":\"error\",\"message\":\"%s\"}", msg);
    p->send(p, line);
}

void pcg_proto_on_line(pcg_proto_t *p, const char *line, size_t len)
{
    (void)len;
    char type[32], proto[64], request_id[64], expected[24], overwritebuf[12];

    if (!grab(line, "type", type, sizeof type)) { emit_error(p, "Invalid JSON"); return; }

    if (strcmp(type, "hello") == 0) {
        if (!grab(line, "protocol", proto, sizeof proto) ||
            strcmp(proto, "pcg.reader.v1") != 0) { emit_error(p, "Unsupported protocol"); return; }
        if (!p->nfc_ready) { emit_error(p, "NFC hardware not ready"); return; }
        p->session = true;
        char cap[64];
        if (pcg_proto_has_read_ndef(p) && pcg_proto_has_write_ndef(p))
            snprintf(cap, sizeof cap, "[\"uid\",\"ndef_read\",\"ndef_write\"]");
        else if (pcg_proto_has_read_ndef(p))
            snprintf(cap, sizeof cap, "[\"uid\",\"ndef_read\"]");
        else
            snprintf(cap, sizeof cap, "[\"uid\"]");
        char reply[PCG_PROTO_LINE_MAX];
        snprintf(reply, sizeof reply,
                 "{\"type\":\"hello\",\"protocol\":\"pcg.reader.v1\",\"device\":\"%s\",\"capabilities\":%s}",
                 p->device_name, cap);
        p->send(p, reply);
        return;
    }

    if (!p->session) { emit_error(p, "Reader not in session"); return; }

    if (strcmp(type, "write") == 0) {
        if (!p->write_card) { emit_error(p, "write not supported"); return; }
        grab(line, "request_id", request_id, sizeof request_id);
        grab(line, "expected_uid", expected, sizeof expected);
        grab(line, "overwrite", overwritebuf, sizeof overwritebuf);
        bool overwrite = (strcmp(overwritebuf, "true") == 0);
        /* descriptor: pass the substring beginning at `"descriptor":` */
        const char *ds = strstr(line, "\"descriptor\":");
        pcg_write_result_t res;
        res.ok = false; res.error[0] = 0;
        bool called = p->write_card(p, request_id,
                                    expected[0] ? expected : NULL,
                                    overwrite,
                                    ds ? ds : NULL, &res);
        if (!called) { snprintf(res.error, sizeof res.error, "write rejected"); }
        char rline[PCG_PROTO_LINE_MAX];
        if (res.ok) {
            snprintf(rline, sizeof rline,
                     "{\"type\":\"write_result\",\"request_id\":\"%s\",\"ok\":true,\"uid\":\"%s\"}",
                     request_id, p->current_uid);
        } else {
            snprintf(rline, sizeof rline,
                     "{\"type\":\"write_result\",\"request_id\":\"%s\",\"ok\":false,\"error\":\"%s\"}",
                     request_id, res.error[0] ? res.error : "write failed");
        }
        p->send(p, rline);
        return;
    }

    emit_error(p, "command unsupported");
}