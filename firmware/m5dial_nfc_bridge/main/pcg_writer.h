#ifndef PCG_WRITER_H
#define PCG_WRITER_H
#include "pcg_proto.h"
typedef struct {
    void *ctx;
    bool (*select)(void *ctx, char uid[24]);
    bool (*version)(void *ctx, uint8_t version[8]);
    size_t (*read)(void *ctx, uint32_t addr, uint8_t *dst, size_t len);
    int (*write_page)(void *ctx, uint8_t page, const uint8_t bytes[4]);
} pcg_tag_io_t;
/* Caller serializes the entire transaction against NFC polling. */
void pcg_write_blank_player(const pcg_tag_io_t *io, const char *uid, const char *json, pcg_write_result_t *out);
#endif
