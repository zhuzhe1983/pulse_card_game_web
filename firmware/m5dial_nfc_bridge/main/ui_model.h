#ifndef PCG_UI_MODEL_H
#define PCG_UI_MODEL_H
#include <stdint.h>
typedef struct { int nfc_ok,usb_open; char kind[16],uid[24],sig[72]; } ui_model_t;
typedef enum {UI_BEEP_NONE=0,UI_BEEP_OK,UI_BEEP_ERR,UI_BEEP_WAIT,UI_BEEP_READ,UI_BEEP_WRITE,UI_BEEP_VERIFY,UI_BEEP_DONE,UI_BEEP_STOP} ui_beep_t;
void ui_model_reset(ui_model_t *m);
ui_beep_t ui_model_apply(ui_model_t *m,int nfc_ok,int usb_open,const char *kind,const char *uid,char title[22],char detail[22],char id[22]);
#endif
