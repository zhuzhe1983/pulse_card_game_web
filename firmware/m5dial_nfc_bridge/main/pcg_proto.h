/*
 * PULSE M5Dial bridge — pcg.reader.v1 protocol endpoint.
 *
 * Transport-agnostic: the caller injects send/write callbacks; this module
 * implements the JSON-Lines FSM the web app expects (docs/READERS.md). It is
 * deterministic and host-testable with the same fixtures the web side uses.
 */
#ifndef PCG_PROTO_H
#define PCG_PROTO_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "pcg_ndef.h"

#define PCG_FIRMWARE_VERSION "2026.11.14-feedback.2"
#define PCG_WRITE_MODE "blank-player-v1"
#define PCG_PROTO_LINE_MAX 4096   /* matches the web JSON-line cap */

typedef struct pcg_proto pcg_proto_t;
struct cJSON;

/* A presented card, possibly with an identity descriptor. */
typedef struct {
    char uid[24];            /* uppercase hex, NUL-terminated */
    bool has_descriptor;     /* true when descriptor follows */
    char descriptor[PCG_NDEF_MAX];
    /* blank, unformatted, pulse, foreign, unsupported, error, or empty. */
    char ndef_kind[16];
    char tag_type[12];
    char cc_hex[12];
    int capacity;            /* -1 when unknown */
    int writable;            /* 1, 0, or -1 */
    char lock[12];
    char ndef_hex[481];
    int ndef_hex_truncated;
} pcg_card_t;

/* Result of one host-initiated write request. */
typedef struct {
    bool ok;
    char error[64];
    char uid[24];
    char descriptor[PCG_NDEF_MAX];
} pcg_write_result_t;

typedef void (*pcg_send_fn)(pcg_proto_t *p, const char *line);
typedef bool (*pcg_write_fn)(pcg_proto_t *p, const char *request_id,
                             const char *expected_uid, bool overwrite,
                             const char *descriptor_json,
                             pcg_write_result_t *out);

struct pcg_proto {
    pcg_send_fn send;
    pcg_write_fn write_card;
    void *user;

    const char *device_name;
    bool nfc_ready;      /* NFC hardware initialized */
    bool session;        /* hello completed */
    int  capabilities;   /* bitmask: 1=uid 2=ndef_read 4=ndef_write */

    char current_uid[24];    /* last reported UID (for removal suppression) */
    bool card_present;
    char presence_ndef[16];
    char reset_reason[16];
    void (*on_session)(struct pcg_proto *p);
    bool status_events;
    void (*on_feedback)(struct pcg_proto *p,bool sound);
    void (*on_diag)(struct pcg_proto *p,struct cJSON *response);
    char phase[20];
    int progress;
};

void pcg_proto_init(pcg_proto_t *p, const char *device_name,
                    int capabilities,
                    pcg_send_fn send, pcg_write_fn write_card, void *user);

/* Number of capabilities bits; used by protocol dispatch. */
bool pcg_proto_has_read_ndef(pcg_proto_t *p);
bool pcg_proto_has_write_ndef(pcg_proto_t *p);

/* Set/clear the NFC-ready flag. */
void pcg_proto_set_ready(pcg_proto_t *p, bool ready);
void pcg_proto_set_reset(pcg_proto_t *p, const char *reason);

/* Handle one complete JSON line received from the host (after a '\n'). */
void pcg_proto_on_line(pcg_proto_t *p, const char *line, size_t len);

/* Reader-thread events. The caller owns repeat suppression and passes
 * descriptor as-is (e.g. null when the tag has no identity). */
void pcg_proto_on_card(pcg_proto_t *p, const pcg_card_t *card);
void pcg_proto_on_removed(pcg_proto_t *p);

void pcg_proto_status(pcg_proto_t *p,const char *phase,const char *uid,int progress);
#endif /* PCG_PROTO_H */
