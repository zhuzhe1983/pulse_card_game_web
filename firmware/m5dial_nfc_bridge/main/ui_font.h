#ifndef PCG_UI_FONT_H
#define PCG_UI_FONT_H
#include <stdint.h>
typedef struct {uint32_t code;unsigned size,width,height,advance,offset;} ui_glyph_t;
extern const ui_glyph_t ui_glyphs[];
extern const unsigned ui_glyph_count;
extern const unsigned char ui_font_bits[];
#endif
