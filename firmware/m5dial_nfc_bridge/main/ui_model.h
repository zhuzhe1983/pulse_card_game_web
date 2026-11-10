#ifndef PCG_UI_MODEL_H
#define PCG_UI_MODEL_H

/* Dial status text and one-shot beep policy. No hardware. */

typedef struct {
    int nfc_ok;          /* 0 fail, 1 ok */
    int usb_open;        /* host has the CDC port open */
    char kind[16];       /* idle, blank, unformatted, pulse, foreign, error, unsupported */
    char uid[24];
    char sig[48];
} ui_model_t;

typedef enum {
    UI_BEEP_NONE = 0,
    UI_BEEP_OK,
    UI_BEEP_ERR
} ui_beep_t;

void ui_model_reset(ui_model_t *m);

/* Fills three ASCII lines of at most 21 characters. Returns the beep for
 * this transition only; repeating the same card does not beep again. */
ui_beep_t ui_model_apply(ui_model_t *m, int nfc_ok, int usb_open,
                         const char *kind, const char *uid,
                         char line1[22], char line2[22], char line3[22]);

#endif
