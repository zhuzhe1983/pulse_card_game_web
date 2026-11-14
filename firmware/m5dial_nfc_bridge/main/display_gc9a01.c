/*
 * PULSE M5Dial bridge — GC9A01 round LCD (240x240) minimal driver + UI.
 *
 * M5Dial LCD: CS=G7, DC=G4, SCK=G6, MOSI=G5, RST=G8, BL=G9.
 * Generated electronics-workbench skin, OFL Chinese bitmap font and live states.
 * One RGB565 framebuffer in internal RAM; one display task owns SPI.
 */
#include "display_gc9a01.h"
#include "gc9a01_seq.h"
#include "ui_model.h"
#include "ui_render.h"
#include "esp_heap_caps.h"
#include "buzzer.h"
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "lcd";

#define LCD_W 240
#define LCD_H 240

#define PIN_CS   7
#define PIN_DC   4
#define PIN_SCK  6
#define PIN_MOSI 5
#define PIN_RST  8
#define PIN_BL   9

static spi_device_handle_t spi;

static void lcd_cmd(uint8_t c)
{
    gpio_set_level(PIN_DC, 0);
    spi_transaction_t t = { .length = 8 };
    t.tx_buffer = &((uint8_t){ c });
    spi_device_polling_transmit(spi, &t);
}
static void lcd_data(const uint8_t *d, size_t n)
{
    gpio_set_level(PIN_DC, 1);
    while (n) {
        size_t take = n > 2000 ? 2000 : n;
        spi_transaction_t t = { .length = take * 8, .tx_buffer = d };
        spi_device_polling_transmit(spi, &t);
        d += take; n -= take;
    }
}
static void set_window(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1)
{
    uint8_t d[4];
    lcd_cmd(0x2A);
    d[0]=x0>>8; d[1]=x0&0xFF; d[2]=x1>>8; d[3]=x1&0xFF; lcd_data(d,4);
    lcd_cmd(0x2B);
    d[0]=y0>>8; d[1]=y0&0xFF; d[2]=y1>>8; d[3]=y1&0xFF; lcd_data(d,4);
    lcd_cmd(0x2C);
}

static int emit_init(uint8_t cmd, const uint8_t *data, uint8_t n, uint16_t delay_ms, void *ctx)
{
    (void)ctx;
    lcd_cmd(cmd);
    if (n && data) lcd_data(data, n);
    if (delay_ms) vTaskDelay(pdMS_TO_TICKS(delay_ms));
    return 0;
}

extern const uint8_t ui_bg[] asm("_binary_dial_workbench_v2_rgb565_start");
static uint16_t *pixels;
static QueueHandle_t frames;
static SemaphoreHandle_t mu;
static ui_model_t model;
static int cur_nfc=1,cur_usb=0,cur_progress=-1;
static char cur_kind[16]="boot",cur_uid[24];
static ui_frame_t current;
static void push_frame(void)
{
 ui_frame_t f={0};
 ui_beep_t beep=ui_model_apply(&model,cur_nfc,cur_usb,cur_kind,cur_uid,f.title,f.detail,f.uid);
 snprintf(f.kind,sizeof f.kind,"%s",cur_kind);f.nfc_ok=cur_nfc;f.usb_open=cur_usb;f.sound=buzzer_enabled();f.progress=cur_progress;
 if(frames)xQueueOverwrite(frames,&f);
 buzzer_request(beep);
}
static void paint(const ui_frame_t *f,unsigned tick)
{
 if(!pixels)return;
 ui_render(pixels,ui_bg,f,tick);
 for(int i=0;i<240*240;i++)pixels[i]=(pixels[i]>>8)|(pixels[i]<<8);
 set_window(0,0,239,239);lcd_data((uint8_t*)pixels,240*240*2);
}
static void panel_task(void *arg)
{
 (void)arg;unsigned tick=0;
 while(1){xQueueReceive(frames,&current,pdMS_TO_TICKS(160));current.sound=buzzer_enabled();paint(&current,tick++);}
}

int display_init(void)
{
    gpio_config_t io = { 0 };
    /* CS is owned by the SPI peripheral. Driving it as a GPIO as well holds
     * the panel deselected, which leaves the backlight on and the glass black. */
    io.mode = GPIO_MODE_OUTPUT;
    io.pin_bit_mask = (1ULL << PIN_DC) | (1ULL << PIN_RST) | (1ULL << PIN_BL);
    gpio_config(&io);
    gpio_set_level(PIN_DC, 1);
    gpio_set_level(PIN_RST, 1);
    gpio_set_level(PIN_BL, 0);

    spi_bus_config_t bus = {
        .mosi_io_num = PIN_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = PIN_SCK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 4096,
    };
    if (spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO) != ESP_OK) {
        ESP_LOGE(TAG, "SPI bus failed; backlight left off");
        return -1;
    }
    spi_device_interface_config_t dev = {
        .clock_speed_hz = 20 * 1000 * 1000,
        .mode = 0,
        .spics_io_num = PIN_CS,
        .queue_size = 1,
    };
    if (spi_bus_add_device(SPI2_HOST, &dev, &spi) != ESP_OK) {
        ESP_LOGE(TAG, "SPI device failed; backlight left off");
        return -1;
    }

    gpio_set_level(PIN_RST, 0); vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(PIN_RST, 1); vTaskDelay(pdMS_TO_TICKS(120));
    if (gc9a01_walk(emit_init, NULL) != 0) {
        ESP_LOGE(TAG, "panel init sequence failed");
        return -1;
    }

    pixels=heap_caps_malloc(240*240*2,MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT);
    if(!pixels)return -1;
    ui_model_reset(&model);
    snprintf(cur_kind,sizeof cur_kind,"boot");
    ui_model_apply(&model,1,0,"boot","",current.title,current.detail,current.uid);
    strcpy(current.kind,"boot");current.nfc_ok=true;current.sound=true;current.progress=-1;
    paint(&current,0);
    gpio_set_level(PIN_BL, 1);

    mu = xSemaphoreCreateMutex();
    frames = xQueueCreate(1, sizeof(ui_frame_t));
    if (frames) xTaskCreate(panel_task, "lcd", 4096, NULL, 3, NULL);
    ESP_LOGI(TAG, "GC9A01 frame painted, backlight on");
    return 0;
}

static void with_model(void (*fn)(void *), void *arg)
{
    if (mu) xSemaphoreTake(mu, portMAX_DELAY);
    fn(arg);
    push_frame();
    if (mu) xSemaphoreGive(mu);
}

static void set_nfc(void *arg) { cur_nfc = arg ? 1 : 0; }
static void set_usb(void *arg) { cur_usb = arg ? 1 : 0; }
static void set_card(void *arg)
{
    const char *const *s = arg;
    snprintf(cur_kind, sizeof cur_kind, "%s", s[0] && s[0][0] ? s[0] : "idle");
    snprintf(cur_uid, sizeof cur_uid, "%s", s[1] ? s[1] : "");
    cur_progress=-1;
}

void display_note_nfc(int nfc_ok) { with_model(set_nfc, nfc_ok ? (void *)1 : NULL); }
void display_note_usb(int open) { with_model(set_usb, open ? (void *)1 : NULL); }
void display_note_card(const char *kind, const char *uid)
{
    const char *s[2] = { kind, uid };
    with_model(set_card, s);
}
void display_note_progress(const char *kind,const char *uid,int percent)
{
 if(mu)xSemaphoreTake(mu,portMAX_DELAY);
 const char *s[2]={kind,uid};set_card(s);cur_progress=percent;push_frame();
 if(mu)xSemaphoreGive(mu);
}
