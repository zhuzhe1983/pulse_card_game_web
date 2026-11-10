#include "nfc_track.h"
#include <stdio.h>
#include <string.h>

void nfc_track_reset(nfc_track_t *t)
{
    memset(t, 0, sizeof *t);
}

nfc_evt_t nfc_track_step(nfc_track_t *t, int seen, const char *uid,
                         uint32_t now_ms, uint32_t grace_ms)
{
    if (seen && uid && uid[0]) {
        t->last_ms = now_ms;
        if (!t->present || strcmp(t->uid, uid) != 0) {
            snprintf(t->uid, sizeof t->uid, "%s", uid);
            t->present = 1;
            return NFC_EVT_NEW;
        }
        return NFC_EVT_HELD;
    }
    if (t->present && (uint32_t)(now_ms - t->last_ms) > grace_ms) {
        t->present = 0;
        t->uid[0] = 0;
        return NFC_EVT_GONE;
    }
    return NFC_EVT_NONE;
}
