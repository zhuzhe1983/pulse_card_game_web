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
    snprintf(p->reset_reason, sizeof p->reset_reason, "unknown");
}

void pcg_proto_set_reset(pcg_proto_t *p, const char *reason)
{
    snprintf(p->reset_reason, sizeof p->reset_reason, "%s", reason && reason[0] ? reason : "unknown");
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

/* BSS, not stack: the USB task that used to call this only has a 4096-byte
 * stack, and one 4096-byte local was enough to smash it after hello. */
static char card_line[PCG_PROTO_LINE_MAX];

void pcg_proto_on_card(pcg_proto_t *p, const pcg_card_t *card)
{
    if (!p->session || !p->nfc_ready) return;
    const char *uid = (card && card->uid[0]) ? card->uid : "";
    const char *kind = (card && card->ndef_kind[0]) ? card->ndef_kind : "unknown";
    const char *writable = "null";
    if (card && card->writable == 0) writable = "false";
    else if (card && card->writable > 0) writable = "true";
    if (card && card->has_descriptor && card->descriptor[0]) {
        snprintf(card_line, sizeof card_line,
                 "{\"type\":\"card\",\"uid\":\"%s\",\"tech\":\"nfc-a\",\"descriptor\":%s,\"ndef\":\"%s\","
                 "\"tag\":{\"type\":\"%s\",\"cc\":\"%s\",\"capacity\":%d,\"writable\":%s,\"lock\":\"%s\","
                 "\"ndef_hex\":\"%s\",\"ndef_hex_truncated\":%s}}",
                 uid, card->descriptor, kind,
                 card->tag_type[0] ? card->tag_type : "unknown",
                 card->cc_hex,
                 card->capacity,
                 writable,
                 card->lock[0] ? card->lock : "unknown",
                 card->ndef_hex,
                 card->ndef_hex_truncated ? "true" : "false");
    } else {
        snprintf(card_line, sizeof card_line,
                 "{\"type\":\"card\",\"uid\":\"%s\",\"tech\":\"nfc-a\",\"descriptor\":null,\"ndef\":\"%s\","
                 "\"tag\":{\"type\":\"%s\",\"cc\":\"%s\",\"capacity\":%d,\"writable\":%s,\"lock\":\"%s\","
                 "\"ndef_hex\":\"%s\",\"ndef_hex_truncated\":%s}}",
                 uid, kind,
                 (card && card->tag_type[0]) ? card->tag_type : "unknown",
                 card ? card->cc_hex : "",
                 card ? card->capacity : -1,
                 writable,
                 (card && card->lock[0]) ? card->lock : "unknown",
                 card ? card->ndef_hex : "",
                 (card && card->ndef_hex_truncated) ? "true" : "false");
    }
    p->send(p, card_line);
    if (card && card->ndef_kind[0])
        snprintf(p->presence_ndef, sizeof p->presence_ndef, "%s", card->ndef_kind);
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
    p->presence_ndef[0] = 0;
}

static char reply_line[PCG_PROTO_LINE_MAX];

static void emit_error(pcg_proto_t *p, const char *msg)
{
    snprintf(reply_line, sizeof reply_line, "{\"type\":\"error\",\"message\":\"%s\"}", msg);
    p->send(p, reply_line);
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
        char cap[80];
        if (pcg_proto_has_read_ndef(p) && pcg_proto_has_write_ndef(p))
            snprintf(cap, sizeof cap, "[\"uid\",\"ndef_read\",\"ndef_write\"]");
        else if (pcg_proto_has_read_ndef(p))
            snprintf(cap, sizeof cap, "[\"uid\",\"ndef_read\"]");
        else
            snprintf(cap, sizeof cap, "[\"uid\"]");
        snprintf(reply_line, sizeof reply_line,
                 "{\"type\":\"hello\",\"protocol\":\"pcg.reader.v1\",\"device\":\"%s\",\"capabilities\":%s,\"reset\":\"%s\"}",
                 p->device_name, cap, p->reset_reason[0] ? p->reset_reason : "unknown");
        p->send(p, reply_line);
        if (p->on_session) p->on_session(p);
        return;
    }

    if (strcmp(type, "diag") == 0) {
        if (!p->session) { emit_error(p, "Reader not in session"); return; }
        snprintf(reply_line, sizeof reply_line,
                 "{\"type\":\"diag\",\"reset\":\"%s\",\"session\":true,\"nfc_ready\":%s,\"card_present\":%s,\"uid\":\"%s\",\"ndef\":\"%s\"}",
                 p->reset_reason[0] ? p->reset_reason : "unknown",
                 p->nfc_ready ? "true" : "false",
                 p->card_present ? "true" : "false",
                 p->current_uid,
                 p->presence_ndef);
        p->send(p, reply_line);
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
        if (res.ok) {
            snprintf(reply_line, sizeof reply_line,
                     "{\"type\":\"write_result\",\"request_id\":\"%s\",\"ok\":true,\"uid\":\"%s\"}",
                     request_id, p->current_uid);
        } else {
            snprintf(reply_line, sizeof reply_line,
                     "{\"type\":\"write_result\",\"request_id\":\"%s\",\"ok\":false,\"error\":\"%s\"}",
                     request_id, res.error[0] ? res.error : "write failed");
        }
        p->send(p, reply_line);
        return;
    }

    emit_error(p, "command unsupported");
}