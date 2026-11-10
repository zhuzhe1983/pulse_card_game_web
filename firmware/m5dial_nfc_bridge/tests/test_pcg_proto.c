/* Host-side unit test for pcg_proto.{c,h}. Build:
 *   cc -std=c11 -Wall -I main main/pcg_proto.c main/test_pcg_proto.c -o /tmp/t_pcg_proto
 *   /tmp/t_pcg_proto
 */
#include <stdio.h>
#include <string.h>
#include "pcg_proto.h"

static char emitted[8][512];
static size_t nout;

static void send_cb(pcg_proto_t *p, const char *line)
{
    (void)p;
    if (nout < 8) { snprintf(emitted[nout], sizeof emitted[nout], "%s", line); }
    nout++;
}

static bool write_cb(pcg_proto_t *p, const char *request_id,
                     const char *expected_uid, bool overwrite,
                     const char *descriptor_json, pcg_write_result_t *out)
{
    (void)p; (void)request_id; (void)expected_uid; (void)descriptor_json;
    if (!overwrite) { out->ok = false; snprintf(out->error, sizeof out->error, "overwrite required"); return true; }
    out->ok = true;
    return true;
}

static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { printf("FAIL: %s\n", m); failures++; } else printf("ok:  %s\n", m); } while (0)

int main(void)
{
    pcg_proto_t P;
    pcg_proto_init(&P, "M5Dial Test", 1|2|4, send_cb, write_cb, NULL);
    pcg_proto_set_ready(&P, true);

    /* hello not yet completed: send hello */
    memset(emitted, 0, sizeof emitted); nout = 0;
    pcg_proto_on_line(&P, "{\"type\":\"hello\",\"protocol\":\"pcg.reader.v1\"}", 0);
    CHECK(nout >= 1 && strstr(emitted[0], "\"type\":\"hello\"") , "hello reply emitted");
    CHECK(nout >= 1 && strstr(emitted[0], "ndef_write") , "hello advertises ndef_write");
    printf("  hello -> %s\n", emitted[0]);

    /* card with a descriptor */
    memset(emitted, 0, sizeof emitted); nout = 0;
    pcg_card_t c; memset(&c, 0, sizeof c);
    snprintf(c.uid, sizeof c.uid, "04AA1B2C3D4E5F");
    c.has_descriptor = true;
    snprintf(c.descriptor, sizeof c.descriptor,
             "{\"game\":\"pcg\",\"v\":1,\"type\":\"player\",\"id\":\"abc\",\"skin\":\"01\"}");
    pcg_proto_on_card(&P, &c);
    CHECK(nout >= 1 && strstr(emitted[0], "\"type\":\"card\"") , "card event");
    CHECK(nout >= 1 && strstr(emitted[0], "\"descriptor\":{") , "card includes descriptor object");
    printf("  card -> %s\n", emitted[0]);

    /* removed */
    memset(emitted, 0, sizeof emitted); nout = 0;
    pcg_proto_on_removed(&P);
    CHECK(strstr(emitted[0], "\"type\":\"removed\"") , "removed event");

    /* write without overwrite -> refused (write callback returns error) */
    memset(emitted, 0, sizeof emitted); nout = 0;
    pcg_proto_on_line(&P,
        "{\"type\":\"write\",\"request_id\":\"r1\",\"expected_uid\":\"04AA1B2C3D4E5F\",\"overwrite\":false,\"descriptor\":{\"x\":1}}", 0);
    CHECK(strstr(emitted[0], "\"ok\":false") , "write refused without overwrite");
    printf("  write(non-overwrite) -> %s\n", emitted[0]);

    /* write with overwrite true */
    memset(emitted, 0, sizeof emitted); nout = 0;
    pcg_proto_on_line(&P,
        "{\"type\":\"write\",\"request_id\":\"r2\",\"expected_uid\":\"04AA1B2C3D4E5F\",\"overwrite\":true,\"descriptor\":{\"game\":\"pcg\"}}", 0);
    CHECK(strstr(emitted[0], "\"ok\":true") , "write ok with overwrite");
    printf("  write(overwrite) -> %s\n", emitted[0]);

    if (failures) { printf("\n%d failure(s)\n", failures); return 1; }
    printf("\nall proto tests passed\n");
    return 0;
}