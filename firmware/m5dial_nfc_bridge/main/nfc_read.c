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
#include "pcg_writer.h"
#include "session_gate.h"
#include "display_gc9a01.h"
#include "buzzer.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "nfc";

#define POLL_DELAY_MS      80
#define REMOVED_GRACE_MS  400

static pcg_proto_t *g_proto;
static nfc_track_t track;
static session_gate_t gate;
static pcg_card_t snap;
static int have_snap;
static SemaphoreHandle_t nfc_mu;
static SemaphoreHandle_t gate_mu;


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
static size_t read_bytes(void *ctx, uint32_t addr, uint8_t *dst, size_t length)
{
    (void)ctx;
    size_t copied = 0;
    while (copied < length) {
        size_t chunk = length - copied > 16 ? 16 : length - copied;
        if (rc522_read_memory(dst + copied,chunk,addr + copied) != chunk) break;
        copied += chunk;
    }
    return copied;
}
static size_t read_tag_memory(uint8_t *dst, size_t dst_len)
{
    if (dst_len < 508) return 0;
    return read_bytes(NULL,12,dst,508);
}

static bool read_selected_tag(pcg_card_t *card,const pcg_tag_id_t *id)
{
    uint8_t mem[PCG_NTAG_MAX_BYTES];
    char json[PCG_NDEF_MAX];
    size_t got;
    pcg_ndef_kind_t kind;
    memset(card, 0, sizeof *card);
    card->capacity = -1;
    card->writable = -1;
    uid_to_hex(id->uid, id->uid_len, card->uid);
    got = read_tag_memory(mem, sizeof mem);
    if (got < 508) {
        snprintf(card->ndef_kind, sizeof card->ndef_kind, "error");
        return true;
    }
    uint8_t page2[4], dyn[4];
    const uint8_t *lock2 = NULL, *dyn3 = NULL;
    pcg_tag_facts_t facts;
    if (rc522_read_memory(page2, 4, 8) == 4) lock2 = page2 + 2;
    if (rc522_read_memory(dyn, 4, 130u * 4u) == 4) dyn3 = dyn;
    pcg_ntag_facts(mem, got, 3, lock2, dyn3, &facts, json, sizeof json);
    kind = facts.kind;
    snprintf(card->ndef_kind, sizeof card->ndef_kind, "%s", pcg_ndef_kind_name(kind));
    snprintf(card->tag_type, sizeof card->tag_type, "%s", facts.type_name);
    snprintf(card->cc_hex, sizeof card->cc_hex, "%s", facts.cc_hex);
    card->capacity = facts.capacity;
    card->writable = facts.writable;
    snprintf(card->lock, sizeof card->lock, "%s", facts.lock);
    snprintf(card->ndef_hex, sizeof card->ndef_hex, "%s", facts.ndef_hex);
    card->ndef_hex_truncated = facts.ndef_hex_truncated;
    if (kind == PCG_NDEF_PULSE && json[0]) {
        snprintf(card->descriptor, sizeof card->descriptor, "%s", json);
        card->has_descriptor = true;
    }
    return true;
}

static bool read_tag(pcg_card_t *card)
{
 pcg_tag_id_t id;
 return rc522_select(&id,200) && read_selected_tag(card,&id);
}
static void feedback(const char *phase,const char *uid,int percent)
{
 display_note_progress(phase,uid,percent);
 pcg_proto_status(g_proto,phase,uid,percent);
}
static void on_feedback(pcg_proto_t *p,bool enabled){(void)p;buzzer_set_enabled(enabled);}
static void on_diag(pcg_proto_t *p,cJSON *o)
{
 (void)p;pcg_rc522_diag_t d;
 xSemaphoreTake(nfc_mu,portMAX_DELAY);rc522_diagnostics(&d);xSemaphoreGive(nfc_mu);
 cJSON *r=cJSON_AddObjectToObject(o,"reader");
 cJSON_AddNumberToObject(r,"version",d.version);cJSON_AddBoolToObject(r,"crc_ok",d.crc_ok);
 cJSON_AddNumberToObject(r,"polls",d.polls);cJSON_AddNumberToObject(r,"selected",d.selected);
 cJSON_AddNumberToObject(r,"io_errors",d.io_errors);cJSON_AddNumberToObject(r,"stage",d.stage);
 cJSON_AddNumberToObject(r,"last_rc",d.last_rc);cJSON_AddNumberToObject(r,"irq",d.irq);cJSON_AddNumberToObject(r,"error",d.error);
 cJSON_AddBoolToObject(o,"sound",buzzer_enabled());
}

static void publish(sg_evt_t ev)
{
    if (ev == SG_CARD && have_snap) pcg_proto_on_card(g_proto, &snap);
    else if (ev == SG_REMOVED) pcg_proto_on_removed(g_proto);
}

static sg_evt_t gate_call(sg_evt_t (*fn)(session_gate_t *), const char *uid)
{
    sg_evt_t ev;
    if (gate_mu) xSemaphoreTake(gate_mu, portMAX_DELAY);
    ev = uid ? session_gate_on_new(&gate, uid) : fn(&gate);
    if (gate_mu) xSemaphoreGive(gate_mu);
    return ev;
}

static void on_session(pcg_proto_t *p)
{
    (void)p;
    xSemaphoreTake(nfc_mu, portMAX_DELAY);
    session_gate_reset(&gate);
    if (have_snap) gate_call(NULL,snap.uid);
    publish(gate_call(session_gate_on_hello, NULL));
    char phase[20];snprintf(phase,sizeof phase,"%s",p->phase[0]?p->phase:"idle");
    pcg_proto_status(p,phase,have_snap?snap.uid:"",p->progress);
    xSemaphoreGive(nfc_mu);
}

static void nfc_task(void *arg)
{
 (void)arg;nfc_track_reset(&track);uint32_t last_select_error=0;bool reported_select_error=false;bool sound_state=buzzer_enabled();
 xSemaphoreTake(nfc_mu,portMAX_DELAY);
 feedback(g_proto->nfc_ready?"idle":"error","",-1);
 xSemaphoreGive(nfc_mu);
 while(1){
  if(!g_proto->nfc_ready){vTaskDelay(pdMS_TO_TICKS(1000));continue;}
  xSemaphoreTake(nfc_mu,portMAX_DELAY);
  uint32_t now=(uint32_t)(xTaskGetTickCount()*portTICK_PERIOD_MS);
  bool sound_now=buzzer_enabled();
  if(sound_now!=sound_state){sound_state=sound_now;if(g_proto->session&&g_proto->status_events&&g_proto->send)g_proto->send(g_proto,sound_now?"{\"type\":\"feedback\",\"sound\":true}":"{\"type\":\"feedback\",\"sound\":false}");}
  pcg_tag_id_t id;
  if(rc522_select(&id,200)){
   reported_select_error=false;
   char uid[24];uid_to_hex(id.uid,id.uid_len,uid);
   nfc_evt_t ev=nfc_track_step(&track,1,uid,now,REMOVED_GRACE_MS);
   if(ev==NFC_EVT_NEW){
    feedback("reading",uid,-1);
    read_selected_tag(&snap,&id);have_snap=1;
    feedback(snap.ndef_kind,uid,100);
    publish(gate_call(NULL,uid));
    ESP_LOGI(TAG,"card %s ndef=%s type=%s",uid,snap.ndef_kind,snap.tag_type);
   }
  }else{
   pcg_rc522_diag_t d;rc522_diagnostics(&d);
   if(d.stage==2 || d.last_rc==2){
    last_select_error=now;
    if(!reported_select_error){feedback("error","",-1);reported_select_error=true;}
   }else if(reported_select_error && now-last_select_error>1000 && !have_snap){
    reported_select_error=false;feedback("idle","",-1);
   }
   nfc_evt_t ev=nfc_track_step(&track,0,NULL,now,REMOVED_GRACE_MS);
   if(ev==NFC_EVT_GONE){have_snap=0;feedback("idle","",-1);publish(gate_call(session_gate_on_gone,NULL));}
  }
  xSemaphoreGive(nfc_mu);
  vTaskDelay(pdMS_TO_TICKS(POLL_DELAY_MS));
 }
}

static bool select_card(void *ctx, char uid[24])
{
    (void)ctx;
    pcg_tag_id_t id;
    if (!rc522_select(&id,200)) return false;
    uid_to_hex(id.uid,id.uid_len,uid);
    return true;
}
static bool get_version(void *ctx, uint8_t version[8]) { (void)ctx; return rc522_get_version(version); }
static int write_page(void *ctx, uint8_t page, const uint8_t data[4]) { (void)ctx; return rc522_write_page(page,data); }
static void write_progress(void *ctx,const char *phase,int percent){feedback(phase,(const char*)ctx,percent);}
static bool write_card(pcg_proto_t *p, const char *request_id,
                       const char *expected_uid, bool overwrite,
                       const char *descriptor_json, pcg_write_result_t *out)
{
    (void)request_id;
    if (overwrite) { memset(out,0,sizeof *out); strcpy(out->error,"blank cards only"); return true; }
    const pcg_tag_io_t io = {(void*)expected_uid,select_card,get_version,read_bytes,write_page,write_progress};
    xSemaphoreTake(nfc_mu, portMAX_DELAY);
    feedback("writing",expected_uid,0);
    pcg_write_blank_player(&io,expected_uid,descriptor_json,out);
    if (out->ok) {
        have_snap = read_tag(&snap);
        snprintf(p->presence_ndef,sizeof p->presence_ndef,"pulse");
        feedback("write_ok",out->uid,100);
    } else feedback("write_error",expected_uid,-1);
    xSemaphoreGive(nfc_mu);
    return true;
}

void nfc_read_start(pcg_proto_t *proto)
{
    g_proto = proto;
    nfc_mu = xSemaphoreCreateMutex();
    configASSERT(nfc_mu);
    proto->write_card = write_card;
    proto->on_session = on_session;
    proto->on_feedback=on_feedback;proto->on_diag=on_diag;
    session_gate_reset(&gate);
    if (!gate_mu) gate_mu = xSemaphoreCreateMutex();
    xTaskCreatePinnedToCore(nfc_task, "nfc", 12288, NULL, 6, NULL, 0);
}
