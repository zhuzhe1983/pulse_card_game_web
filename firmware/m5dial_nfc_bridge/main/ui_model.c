#include "ui_model.h"
#include <stdio.h>
#include <string.h>

static void put(char *dst, const char *src)
{
    size_t i = 0;
    if (!src) src = "";
    while (src[i] && i < 21) {
        char c = src[i];
        dst[i++] = (c >= 32 && c < 127) ? c : '?';
    }
    dst[i] = 0;
}

void ui_model_reset(ui_model_t *m)
{
    memset(m, 0, sizeof *m);
    snprintf(m->kind, sizeof m->kind, "boot");
}

static int cardish(const char *kind)
{
    return !strcmp(kind, "blank") || !strcmp(kind, "unformatted")
        || !strcmp(kind, "pulse") || !strcmp(kind, "foreign")
        || !strcmp(kind, "error") || !strcmp(kind, "unsupported");
}

ui_beep_t ui_model_apply(ui_model_t *m, int nfc_ok, int usb_open,
                         const char *kind, const char *uid,
                         char line1[22], char line2[22], char line3[22])
{
    char sig[48];
    const char *k = kind && kind[0] ? kind : "idle";
    snprintf(sig, sizeof sig, "%d|%d|%s|%s", nfc_ok, usb_open, k, uid ? uid : "");
    ui_beep_t beep = UI_BEEP_NONE;
    int changed = strcmp(m->sig, sig) != 0;
    if (changed && !strcmp(k, "error")) beep = UI_BEEP_ERR;
    else if (changed && nfc_ok && cardish(k) && strcmp(k, "error") != 0
             && strcmp(k, "unsupported") != 0) {
        if (!m->uid[0] || !uid || strcmp(m->uid, uid) != 0 || strcmp(m->kind, k) != 0)
            beep = UI_BEEP_OK;
    } else if (changed && !nfc_ok) beep = UI_BEEP_ERR;

    m->nfc_ok = nfc_ok;
    m->usb_open = usb_open;
    snprintf(m->kind, sizeof m->kind, "%s", k);
    snprintf(m->uid, sizeof m->uid, "%s", uid ? uid : "");
    snprintf(m->sig, sizeof m->sig, "%s", sig);

    if (!nfc_ok) {
        put(line1, "NFC FAIL");
        put(line2, "WS1850?");
        put(line3, "");
        return beep;
    }
    if (!strcmp(k, "blank")) {
        put(line1, "BLANK CARD");
        put(line2, uid && uid[0] ? uid : "");
        put(line3, "not inited");
    } else if (!strcmp(k, "unformatted")) {
        put(line1, "NO FORMAT");
        put(line2, uid && uid[0] ? uid : "");
        put(line3, "local bind");
    } else if (!strcmp(k, "pulse")) {
        put(line1, "PULSE NDEF");
        put(line2, uid && uid[0] ? uid : "");
        put(line3, "identity");
    } else if (!strcmp(k, "foreign")) {
        put(line1, "OTHER NDEF");
        put(line2, uid && uid[0] ? uid : "");
        put(line3, "ask first");
    } else if (!strcmp(k, "unsupported")) {
        put(line1, "NOT NTAG");
        put(line2, uid && uid[0] ? uid : "");
        put(line3, "uid only");
    } else if (!strcmp(k, "error")) {
        put(line1, "READ ERR");
        put(line2, uid && uid[0] ? uid : "");
        put(line3, "try again");
    } else if (!strcmp(k, "boot")) {
        char rst[22];
        snprintf(rst, sizeof rst, "RST %s", uid && uid[0] ? uid : "?");
        put(line1, "READY");
        put(line2, usb_open ? "PC open" : "USB wait");
        put(line3, rst);
    } else if (usb_open) {
        put(line1, "READY");
        put(line2, "PC open");
        put(line3, "tap card");
    } else {
        put(line1, "READY");
        put(line2, "USB wait");
        put(line3, "tap card");
    }
    return beep;
}
