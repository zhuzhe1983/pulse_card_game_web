/*
 * PULSE M5Dial bridge — GC9A01 round LCD (240x240) minimal driver UI.
 *
 * M5Dial LCD pins: CS=G7, SCK=G6, MOSI=G5, DC(RS)=G4, RST=G8, BL=G9.
 * Renders a small status panel (title + a few text lines) using an embedded
 * 5x7 font, directly streaming pixels over SPI (no framebuffer required).
 */
#ifndef PCG_DISPLAY_GC9A01_H
#define PCG_DISPLAY_GC9A01_H

#include <stdbool.h>
#include <stdint.h>

/* Repaint to show a PULSE reader status / scanned identity. state 0=idle,
 * 1=card (has_identity), 2=no-identity card. */
void display_show_state(int state);
/* Provide an identity descriptor JSON to render skin/name/type on the dial. */
void display_set_identity(const char *json);
void display_init(void);

#endif /* PCG_DISPLAY_GC9A01_H */