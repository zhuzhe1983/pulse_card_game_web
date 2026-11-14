#include "buzzer.h"
#include "sound_pattern.h"
#include "driver/ledc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
static QueueHandle_t q;
static volatile bool enabled=true;
void buzzer_set_enabled(bool value){enabled=value;}
bool buzzer_enabled(void){return enabled;}
static void tone(unsigned hz){if(hz)ledc_set_freq(LEDC_LOW_SPEED_MODE,LEDC_TIMER_0,hz);ledc_set_duty(LEDC_LOW_SPEED_MODE,LEDC_CHANNEL_0,hz&&enabled?192:0);ledc_update_duty(LEDC_LOW_SPEED_MODE,LEDC_CHANNEL_0);}
static void play(ui_beep_t k){const sound_note_t *notes;size_t n=sound_pattern(k,&notes);for(size_t i=0;i<n;i++){tone(notes[i].hz);for(unsigned elapsed=0;elapsed<notes[i].ms;elapsed+=10){if(!enabled)tone(0);vTaskDelay(pdMS_TO_TICKS(10));}tone(0);}}
static void task(void*arg){(void)arg;bool waiting=false;ui_beep_t k;while(1){if(xQueueReceive(q,&k,waiting?pdMS_TO_TICKS(SOUND_WAIT_INTERVAL_MS):portMAX_DELAY)==pdTRUE){waiting=k==UI_BEEP_WAIT;play(k);}else if(waiting&&enabled)play(UI_BEEP_WAIT);}}
void buzzer_init(void){
 ledc_timer_config_t t={.speed_mode=LEDC_LOW_SPEED_MODE,.duty_resolution=LEDC_TIMER_10_BIT,.timer_num=LEDC_TIMER_0,.freq_hz=2200,.clk_cfg=LEDC_AUTO_CLK};
 ledc_channel_config_t c={.gpio_num=3,.speed_mode=LEDC_LOW_SPEED_MODE,.channel=LEDC_CHANNEL_0,.intr_type=LEDC_INTR_DISABLE,.timer_sel=LEDC_TIMER_0,.duty=0,.hpoint=0};
 if(ledc_timer_config(&t)!=ESP_OK||ledc_channel_config(&c)!=ESP_OK)return;
 q=xQueueCreate(8,sizeof(ui_beep_t));if(q)xTaskCreate(task,"buzz",2048,NULL,4,NULL);
}
void buzzer_request(ui_beep_t k){if(!q||k==UI_BEEP_NONE)return;if(xQueueSend(q,&k,0)!=pdTRUE){xQueueReset(q);xQueueSend(q,&k,0);}}
