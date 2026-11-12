#include "session_gate.h"
#include <stdio.h>
#include <string.h>

void session_gate_reset(session_gate_t *g)
{
    memset(g, 0, sizeof *g);
}

sg_evt_t session_gate_on_new(session_gate_t *g, const char *uid)
{
    snprintf(g->uid, sizeof g->uid, "%s", uid ? uid : "");
    g->present = 1;
    g->announced = 0;
    if (!g->session || !g->uid[0]) return SG_NONE;
    g->announced = 1;
    return SG_CARD;
}

sg_evt_t session_gate_on_held(session_gate_t *g)
{
    (void)g;
    return SG_NONE;
}

sg_evt_t session_gate_on_gone(session_gate_t *g)
{
    int told = g->announced;
    g->present = 0;
    g->announced = 0;
    g->uid[0] = 0;
    return (g->session && told) ? SG_REMOVED : SG_NONE;
}

sg_evt_t session_gate_on_hello(session_gate_t *g)
{
    g->session = 1;
    if (g->present && g->uid[0] && !g->announced) {
        g->announced = 1;
        return SG_CARD;
    }
    return SG_NONE;
}
