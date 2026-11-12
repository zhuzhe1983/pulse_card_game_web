#include "buzzer.h"
#include "driver/ledc.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

/* Official M5Dial buzzer pin. Not the LCD backlight and not the encoder. */
#define BUZZER_GPIO 3

static const char *TAG = "buzz";
static QueueHandle_t q;

static void tone(int on)
{
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, on ? 512 : 0);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}

static void buzz_task(void *arg)
{
    (void)arg;
    ui_beep_t kind;
    while (xQueueReceive(q, &kind, portMAX_DELAY) == pdTRUE) {
        if (kind == UI_BEEP_OK) {
            tone(1);
            vTaskDelay(pdMS_TO_TICKS(50));
            tone(0);
        } else if (kind == UI_BEEP_ERR) {
            tone(1);
            vTaskDelay(pdMS_TO_TICKS(35));
            tone(0);
            vTaskDelay(pdMS_TO_TICKS(50));
            tone(1);
            vTaskDelay(pdMS_TO_TICKS(35));
            tone(0);
        } else {
            tone(0);
        }
    }
}

void buzzer_init(void)
{
    ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = 2700,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ledc_channel_config_t ch = {
        .gpio_num = BUZZER_GPIO,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_0,
        .duty = 0,
        .hpoint = 0,
    };
    if (ledc_timer_config(&timer) != ESP_OK || ledc_channel_config(&ch) != ESP_OK) {
        ESP_LOGW(TAG, "buzzer pwm unavailable; screen still runs");
        return;
    }
    q = xQueueCreate(1, sizeof(ui_beep_t));
    if (q) xTaskCreate(buzz_task, "buzz", 2048, NULL, 4, NULL);
}

void buzzer_request(ui_beep_t kind)
{
    if (!q || kind == UI_BEEP_NONE) return;
    xQueueOverwrite(q, &kind);
}
