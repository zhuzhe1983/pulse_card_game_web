#ifndef PCG_NFC_TRACK_H
#define PCG_NFC_TRACK_H

#include <stdint.h>

typedef struct {
    char uid[24];
    int present;
    uint32_t last_ms;
} nfc_track_t;

typedef enum {
    NFC_EVT_NONE = 0,
    NFC_EVT_NEW,
    NFC_EVT_HELD,
    NFC_EVT_GONE
} nfc_evt_t;

void nfc_track_reset(nfc_track_t *t);

/* seen=0: no tag this poll. A present tag is reported GONE once, after
 * grace_ms without a sighting. The same UID reports HELD, not NEW. */
nfc_evt_t nfc_track_step(nfc_track_t *t, int seen, const char *uid,
                         uint32_t now_ms, uint32_t grace_ms);

#endif
