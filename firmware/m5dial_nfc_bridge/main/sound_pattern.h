#ifndef PCG_SOUND_PATTERN_H
#define PCG_SOUND_PATTERN_H
#include "ui_model.h"
#include <stddef.h>
typedef struct {unsigned hz,ms;} sound_note_t;
/* Frequency 0 is an explicit rest. These timings are authored, never stretched. */
size_t sound_pattern(ui_beep_t kind,const sound_note_t **notes);
#define SOUND_WAIT_INTERVAL_MS 1600
#endif
