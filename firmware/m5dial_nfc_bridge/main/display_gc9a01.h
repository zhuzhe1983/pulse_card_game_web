#ifndef PCG_DISPLAY_GC9A01_H
#define PCG_DISPLAY_GC9A01_H

/* GC9A01 on the M5Dial: DC/RS=G4, MOSI=G5, SCK=G6, CS=G7, RST=G8, BL=G9.
 * Official pin map: https://docs.m5stack.com/en/core/Dial
 * Touch FT3267 (0x38) shares I2C G11/G12 and uses INT G14; this reader does
 * not drive the touch controller.
 * Returns 0 when the panel init sequence was sent and a colored frame painted.
 * Backlight is turned on only after that paint, not before. */
int display_init(void);

/* Each call updates one part of the status and repaints. Safe from other tasks. */
void display_note_nfc(int nfc_ok);
void display_note_usb(int open);
void display_note_card(const char *kind, const char *uid);

#endif
