#ifndef PCG_SESSION_GATE_H
#define PCG_SESSION_GATE_H

/* Host-visible card edges.
 * A tag that is already present when hello completes is announced once.
 * Holding it there does not announce again. Removal is announced once,
 * and only if that presentation was announced. */
typedef struct {
    int session;
    int present;
    int announced;
    char uid[24];
} session_gate_t;

typedef enum {
    SG_NONE = 0,
    SG_CARD,
    SG_REMOVED
} sg_evt_t;

void session_gate_reset(session_gate_t *g);
sg_evt_t session_gate_on_new(session_gate_t *g, const char *uid);
sg_evt_t session_gate_on_held(session_gate_t *g);
sg_evt_t session_gate_on_gone(session_gate_t *g);
sg_evt_t session_gate_on_hello(session_gate_t *g);

#endif
