#ifndef PCG_UI_RENDER_H
#define PCG_UI_RENDER_H
#include <stdint.h>
#include <stdbool.h>
typedef struct {char title[22],detail[22],uid[24],kind[16];bool nfc_ok,usb_open,sound;int progress;} ui_frame_t;
void ui_render(uint16_t *pixels,const uint8_t *background,const ui_frame_t *frame,unsigned tick);
#endif
