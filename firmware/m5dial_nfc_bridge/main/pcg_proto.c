#include "pcg_proto.h"
#include "pcg_identity.h"
#include <ctype.h>
#include <stdio.h>
#include <string.h>

void pcg_proto_init(pcg_proto_t *p, const char *device, int capabilities,
                   pcg_send_fn send, pcg_write_fn write, void *user)
{
    memset(p, 0, sizeof *p);
    p->device_name = device ? device : "PULSE M5Dial NFC bridge";
    p->capabilities = capabilities; p->send = send; p->write_card = write; p->user = user;
    strcpy(p->reset_reason, "unknown");
}
void pcg_proto_set_reset(pcg_proto_t *p, const char *reason) { snprintf(p->reset_reason,sizeof p->reset_reason,"%s",reason ? reason : "unknown"); }
bool pcg_proto_has_read_ndef(pcg_proto_t *p) { return !!(p->capabilities & 2); }
bool pcg_proto_has_write_ndef(pcg_proto_t *p) { return !!(p->capabilities & 4); }
void pcg_proto_set_ready(pcg_proto_t *p, bool ready) { p->nfc_ready = ready; if (!ready) { p->card_present = false; p->current_uid[0] = 0; } }

/* Separate output buffers: card polling and command replies run on different tasks. */
static char card_line[PCG_PROTO_LINE_MAX], reply_line[PCG_PROTO_LINE_MAX];
static void send_json(pcg_proto_t *p, cJSON *value, char *buffer)
{
    if (value && p->send && cJSON_PrintPreallocated(value,buffer,PCG_PROTO_LINE_MAX,false)) p->send(p,buffer);
    cJSON_Delete(value);
}
static cJSON *message(const char *type) { cJSON *o = cJSON_CreateObject(); if (o) cJSON_AddStringToObject(o,"type",type); return o; }
static void error(pcg_proto_t *p, const char *text) { cJSON *o = message("error"); cJSON_AddStringToObject(o,"message",text); send_json(p,o,reply_line); }
static const char *string(const cJSON *o, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o,key);
    return cJSON_IsString(v) ? v->valuestring : NULL;
}
static bool same(const char *a, const char *b) { return a && b && strcmp(a,b) == 0; }
static bool uid_ok(const char *uid) {
    if (!uid) return false;
    size_t n = strlen(uid); if (n != 8 && n != 14 && n != 20) return false;
    for (size_t i = 0; i < n; i++) if (!isxdigit((unsigned char)uid[i])) return false;
    return true;
}
void pcg_proto_on_card(pcg_proto_t *p, const pcg_card_t *card)
{
    if (!p->session || !p->nfc_ready || !card || !uid_ok(card->uid)) return;
    cJSON *o = message("card"), *tag = cJSON_AddObjectToObject(o,"tag");
    cJSON_AddStringToObject(o,"uid",card->uid); cJSON_AddStringToObject(o,"tech","nfc-a");
    cJSON_AddStringToObject(o,"ndef",card->ndef_kind);
    cJSON *descriptor = card->has_descriptor ? cJSON_ParseWithOpts(card->descriptor,NULL,true) : NULL;
    cJSON_AddItemToObject(o,"descriptor",descriptor ? descriptor : cJSON_CreateNull());
    cJSON_AddStringToObject(tag,"type",card->tag_type); cJSON_AddStringToObject(tag,"cc",card->cc_hex);
    cJSON_AddNumberToObject(tag,"capacity",card->capacity);
    cJSON_AddItemToObject(tag,"writable",card->writable < 0 ? cJSON_CreateNull() : cJSON_CreateBool(card->writable));
    cJSON_AddStringToObject(tag,"lock",card->lock); cJSON_AddStringToObject(tag,"ndef_hex",card->ndef_hex);
    cJSON_AddBoolToObject(tag,"ndef_hex_truncated",card->ndef_hex_truncated);
    snprintf(p->current_uid,sizeof p->current_uid,"%s",card->uid);
    snprintf(p->presence_ndef,sizeof p->presence_ndef,"%s",card->ndef_kind);
    p->card_present = true;
    send_json(p,o,card_line);
}
void pcg_proto_on_removed(pcg_proto_t *p)
{
    p->card_present = false; p->current_uid[0] = p->presence_ndef[0] = 0;
    if (p->session && p->nfc_ready && p->send) p->send(p,"{\"type\":\"removed\"}");
}
static bool duplicate_fields(const cJSON *o)
{
    for (const cJSON *a = o->child; a; a = a->next)
        for (const cJSON *b = a->next; b; b = b->next)
            if (a->string && b->string && same(a->string,b->string)) return true;
    return false;
}
void pcg_proto_on_line(pcg_proto_t *p, const char *line, size_t len)
{
    if (!line || (len && len != strlen(line)) || strlen(line) >= PCG_PROTO_LINE_MAX || strstr(line,"\\u0000")) { error(p,"Invalid JSON line"); return; }
    cJSON *input = cJSON_ParseWithOpts(line,NULL,true);
    if (!cJSON_IsObject(input) || duplicate_fields(input)) { cJSON_Delete(input); error(p,"Invalid JSON object"); return; }
    const char *type = string(input,"type");
    if (same(type,"hello")) {
        if (!same(string(input,"protocol"),"pcg.reader.v1")) error(p,"Unsupported protocol");
        else if (!p->nfc_ready) error(p,"NFC hardware not ready");
        else {
            cJSON *o = message("hello"), *caps = cJSON_AddArrayToObject(o,"capabilities");
            cJSON_AddStringToObject(o,"protocol","pcg.reader.v1"); cJSON_AddStringToObject(o,"device",p->device_name);
            cJSON_AddStringToObject(o,"reset",p->reset_reason); cJSON_AddStringToObject(o,"firmware",PCG_FIRMWARE_VERSION);
            cJSON_AddItemToArray(caps,cJSON_CreateString("uid"));
            if (pcg_proto_has_read_ndef(p)) cJSON_AddItemToArray(caps,cJSON_CreateString("ndef_read"));
            if (pcg_proto_has_write_ndef(p)) { cJSON_AddItemToArray(caps,cJSON_CreateString("ndef_write")); cJSON_AddStringToObject(o,"write_mode",PCG_WRITE_MODE); }
            bool new_session = !p->session;
            p->session = true; send_json(p,o,reply_line);
            if (new_session && p->on_session) p->on_session(p);
        }
    } else if (same(type,"diag")) {
        cJSON *o = message("diag"); cJSON_AddStringToObject(o,"reset",p->reset_reason);
        cJSON_AddStringToObject(o,"firmware",PCG_FIRMWARE_VERSION);
        cJSON_AddBoolToObject(o,"session",p->session); cJSON_AddBoolToObject(o,"nfc_ready",p->nfc_ready);
        cJSON_AddBoolToObject(o,"card_present",p->card_present); cJSON_AddStringToObject(o,"uid",p->current_uid);
        cJSON_AddStringToObject(o,"ndef",p->presence_ndef); send_json(p,o,reply_line);
    } else if (same(type,"write")) {
        pcg_write_result_t result = {0};
        char descriptor[PCG_NDEF_MAX], uid[24] = "", actual[PCG_NDEF_MAX];
        const char *request = string(input,"request_id"), *expected = string(input,"expected_uid");
        const char *reason = NULL;
        if (!request || !*request || strlen(request) > 64) reason = "request_id invalid";
        else if (!p->session || !p->nfc_ready || !pcg_proto_has_write_ndef(p) || !p->write_card) reason = "write not available";
        else if (!uid_ok(expected)) reason = "expected_uid invalid";
        else if (!same(string(input,"mime"),PCG_IDENTITY_MIME)) reason = "player identity MIME required";
        else if (!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(input,"confirm"))) reason = "confirmation required";
        else if (!cJSON_IsFalse(cJSON_GetObjectItemCaseSensitive(input,"overwrite"))) reason = "blank cards only";
        else if (!pcg_player_object(cJSON_GetObjectItemCaseSensitive(input,"descriptor"),descriptor,sizeof descriptor)) reason = "invalid player identity";
        if (!reason) {
            for (size_t i = 0; expected[i]; i++) uid[i] = (char)toupper((unsigned char)expected[i]);
            if (!p->write_card(p,request,uid,false,descriptor,&result) || !result.ok) reason = result.error[0] ? result.error : "write failed";
            else if (!same(result.uid,uid) || !pcg_player_json(result.descriptor,actual,sizeof actual) || !same(actual,descriptor)) reason = "readback failed";
        }
        cJSON *o = message("write_result"); cJSON_AddStringToObject(o,"request_id",request ? request : "");
        cJSON_AddBoolToObject(o,"ok",!reason);
        if (reason) cJSON_AddStringToObject(o,"error",reason);
        else {
            cJSON_AddBoolToObject(o,"verified",true); cJSON_AddStringToObject(o,"uid",result.uid);
            cJSON_AddItemToObject(o,"descriptor",cJSON_Parse(actual));
        }
        send_json(p,o,reply_line);
    } else error(p,"command unsupported");
    cJSON_Delete(input);
}
