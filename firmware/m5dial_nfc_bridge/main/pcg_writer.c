#include "pcg_writer.h"
#include "pcg_identity.h"
#include "ntag_layout.h"
#include <stdio.h>
#include <string.h>

static bool same_card(const pcg_tag_io_t *io, const char *expected)
{
    char uid[24] = "";
    return io->select(io->ctx,uid) && strcmp(expected,uid) == 0;
}
void pcg_write_blank_player(const pcg_tag_io_t *io, const char *uid, const char *json, pcg_write_result_t *out)
{
    /* page 3 CC + pages 4..129 user data. Never include lock/config in this image. */
    uint8_t memory[508], planned[508], check[508], page2[4], config[12], version[8], pages[126];
    char normalized[PCG_NDEF_MAX], readback[PCG_NDEF_MAX], reason[64];
    static const uint8_t ntag215[] = {0,4,4,2,1,0,0x11,3};
    memset(out,0,sizeof *out);
#define REJECT(text) do { snprintf(out->error,sizeof out->error,"%s",text); return; } while (0)
    if (!io || !io->select || !io->version || !io->read || !io->write_page || !uid || !*uid || !pcg_player_json(json,normalized,sizeof normalized)) REJECT("invalid player identity");
    if (!same_card(io,uid)) REJECT("card removed or changed");
    if (!io->version(io->ctx,version) || memcmp(version,ntag215,8)) REJECT("NTAG215 required");
    if (io->read(io->ctx,8,page2,4) != 4 || io->read(io->ctx,520,config,12) != 12 || io->read(io->ctx,12,memory,sizeof memory) != sizeof memory) REJECT("incomplete memory");
    if (page2[2] || page2[3] || config[0] || config[1] || config[2] || config[7] <= 129 || (config[4] & 0xc0)) REJECT("card locked or protected");
    if (memcmp(memory,"\xe1\x10\x3e\x00",4)) REJECT("standard NTAG215 CC required");
    if (pcg_ntag_classify(memory,sizeof memory,3,NULL,0) != PCG_NDEF_BLANK) REJECT("card is not blank");
    if (pcg_ntag_plan_write(memory,sizeof memory,3,normalized,1,uid,uid,planned,reason,sizeof reason)) REJECT(reason);
    int count = pcg_ntag_dirty_pages(memory,planned,sizeof memory,3,pages,sizeof pages);
    if (count < 0) REJECT("invalid write plan");
    if(io->progress)io->progress(io->ctx,"writing",0);
    /* Invalidate NDEF first; commit its first page only after the body is durable. */
    const uint8_t empty[4] = {3,0,0xfe,0};
    if (!same_card(io,uid)) REJECT("card removed or changed");
    if (io->write_page(io->ctx,4,empty)) REJECT("page write failed");
    for (int i = 0; i < count; i++) {
        if (pages[i] == 4) continue;
        if (!same_card(io,uid)) REJECT("card removed or changed");
        if (io->write_page(io->ctx,pages[i],planned + (pages[i]-3)*4)) REJECT("page write failed");
        if(io->progress)io->progress(io->ctx,"writing",(i+1)*100/(count+1));
    }
    if (!same_card(io,uid)) REJECT("card removed or changed");
    if (io->write_page(io->ctx,4,planned + 4)) REJECT("page write failed");
    if (!same_card(io,uid)) REJECT("card removed or changed");
    if(io->progress)io->progress(io->ctx,"verifying",100);
    if (io->read(io->ctx,12,check,sizeof check) != sizeof check || memcmp(check,planned,sizeof check)) REJECT("readback failed");
    if (pcg_ntag_classify(check,sizeof check,3,readback,sizeof readback) != PCG_NDEF_PULSE || strcmp(readback,normalized)) REJECT("readback failed");
    snprintf(out->uid,sizeof out->uid,"%s",uid);
    snprintf(out->descriptor,sizeof out->descriptor,"%s",readback);
    out->ok = true;
#undef REJECT
}
