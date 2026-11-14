#ifndef PCG_BUZZER_H
#define PCG_BUZZER_H
#include <stdbool.h>
#include "ui_model.h"
void buzzer_init(void);
void buzzer_request(ui_beep_t kind);
void buzzer_set_enabled(bool enabled);
bool buzzer_enabled(void);
#endif
