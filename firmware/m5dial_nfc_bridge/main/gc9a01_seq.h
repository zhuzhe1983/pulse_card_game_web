#ifndef PCG_GC9A01_SEQ_H
#define PCG_GC9A01_SEQ_H

#include <stddef.h>
#include <stdint.h>

/* Packed GC9A01 init records: cmd, nbytes, delay_lo, delay_hi, payload[nbytes].
 * The vendor block is the M5GFX Panel_GC9A01 list. MADCTL 0x08, 16-bit color
 * and INVON are sent as well; M5Dial's round panel is used inverted.
 * Command 0x00 (NOP) is intentionally absent — that panel misbehaves on NOP.
 */
int gc9a01_walk(int (*cb)(uint8_t cmd, const uint8_t *data, uint8_t n,
                          uint16_t delay_ms, void *ctx),
                void *ctx);

/* Pixel window in inclusive coordinates. Returns byte count, or -1 if the
 * window leaves the 240x240 panel or is inverted. */
int gc9_window_bytes(int x0, int y0, int x1, int y1);

/* 0 when the sequence contains sleep-out, display-on, MADCTL, 16-bit pixel
 * format and INVON, and never issues NOP. */
int gc9a01_sequence_ok(void);

#endif
