#ifndef PCG_NTAG_LAYOUT_H
#define PCG_NTAG_LAYOUT_H

#include <stddef.h>
#include <stdint.h>

/* NTAG213/215/216, as used by the project for NTAG215 (504-byte user area):
 *   pages 0-2  UID and static lock — never programmed here
 *   page 3     capability container (E1 10 <size/8> 00)
 *   page 4+    NDEF TLV
 *   page 130   NTAG215 dynamic lock — never programmed here
 * NTAG215 CC size byte 0x3E means 496 bytes of NDEF room (0x3E * 8).
 */

#define PCG_NTAG_CC_215 0x3E
#define PCG_NTAG_MAX_BYTES 540

typedef enum {
    PCG_NDEF_BLANK = 0,
    PCG_NDEF_UNFORMATTED,
    PCG_NDEF_PULSE,
    PCG_NDEF_FOREIGN,
    PCG_NDEF_UNSUPPORTED,
    PCG_NDEF_ERROR
} pcg_ndef_kind_t;

const char *pcg_ndef_kind_name(pcg_ndef_kind_t kind);

/* mem[0] is page `base_page`. base_page is 0 (whole tag), 3 (from CC) or 4. */
pcg_ndef_kind_t pcg_ntag_classify(const uint8_t *mem, size_t len, int base_page,
                                  char *json, size_t json_len);

/* On success copies a modified image to out. Pages 0-2 and pages above 129
 * are unchanged. Page 3 is not rewritten (unformatted tags are refused
 * rather than guessed). Returns 0 or -1. */
int pcg_ntag_plan_write(const uint8_t *mem, size_t len, int base_page,
                        const char *json, int overwrite,
                        const char *expected_uid, const char *current_uid,
                        uint8_t *out, char *err, size_t err_len);

/* Lists 4-byte pages whose bytes differ. Returns the count, or -1 if a
 * forbidden page (UID, static lock, dynamic lock) would change. */
int pcg_ntag_dirty_pages(const uint8_t *before, const uint8_t *after, size_t len,
                         int base_page, uint8_t *pages, int max_pages);

#endif
