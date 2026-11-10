/*
 * PULSE M5Dial bridge — MFRC522-equivalent (WS1850S) driver over I2C.
 *
 * The M5Dial's onboard 13.56MHz reader is a WS1850S, register/command
 * compatible with the NXP MFRC522. It is wired on I2C (M5Dial: SDA=G11,
 * SCL=G12) and supports ISO14443A / NFC-A, which lets us read the UID of an
 * NTAG215 and its NDEF memory without authentication.
 *
 * This driver is intentionally small and follows the de-facto standard
 * MFRC522 register/command map. It exposes only what the bridge needs:
 *   - soft reset + version check + antenna/timing init
 *   - monotone field / ISO14443A REQA + cascaded UID selection (4/7/10 bytes)
 *   - NTAG READ (0x30) of arbitrary memory bytes (no auth)
 * No key author, crypto, or write helpers beyond what the identifier needs.
 */
#ifndef PCG_RC522_H
#define PCG_RC522_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    int sda;    /* I2C SDA gpio */
    int scl;    /* I2C SCL gpio */
    int freq;   /* I2C clock (Hz) */
} pcg_rc522_conf_t;

typedef struct {
    uint8_t uid[10];
    uint8_t uid_len;   /* 4, 7 or 10 */
} pcg_tag_id_t;

/*
 * Initialize the I2C bus and reset the reader. Returns true on success
 * (a compatible silicon version is present).
 */
bool rc522_init(const pcg_rc522_conf_t *cfg);

/* Poll for a tag in the field and, if present, return its unique ID. Blocks
 * up to max_ms for a tag to settle. Returns true when a tag was read. */
bool rc522_select(pcg_tag_id_t *out, uint32_t max_ms);

/*
 * Read `len` bytes starting at NTAG memory byte `addr`. NTAG READ command
 * returns 4 bytes per page-aligned read, so reading arbitrary N bytes may
 * need 0..3 reads. We keep each read aligned to a page for simplicity and
 * require addr be a multiple of 4. Returns bytes read (<= len), 0 on error.
 */
size_t rc522_read_memory(uint8_t *out, size_t out_len, uint32_t addr);

/* Program one 4-byte NTAG page with the Ultralight WRITE (0xA2) command.
 * Pages 0-2 (UID and static lock) and pages above 129 (dynamic lock / config)
 * are refused. Returns 0 on ACK. */
int rc522_write_page(uint8_t page, const uint8_t data[4]);

#endif /* PCG_RC522_H */