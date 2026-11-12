#ifndef PCG_BUZZER_H
#define PCG_BUZZER_H

#include "ui_model.h"

/* M5Dial onboard buzzer is GPIO3 (M5Unified speaker config: pin_data_out = 3,
 * buzzer = true). Official pin map column G3 is "beep". Idle is silent.
 * OK is one short tone. ERR is two short tones. Repeating the same card
 * does not call this again. */
void buzzer_init(void);
void buzzer_request(ui_beep_t kind);

#endif
