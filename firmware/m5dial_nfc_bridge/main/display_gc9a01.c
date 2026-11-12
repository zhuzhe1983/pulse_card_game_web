/*
 * PULSE M5Dial bridge — GC9A01 round LCD (240x240) minimal driver + UI.
 *
 * M5Dial LCD: CS=G7, DC=G4, SCK=G6, MOSI=G5, RST=G8, BL=G9.
 * Minimal GETC9A01 init + a compact 5x7 font renders a status panel.
 * Pixels stream over SPI (no framebuffer).
 */
#include "display_gc9a01.h"
#include "gc9a01_seq.h"
#include "ui_model.h"
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
static void lcd_data16(uint16_t v)
{
    uint8_t b[2] = { (uint8_t)(v >> 8), (uint8_t)(v & 0xFF) };
    lcd_data(b, 2);
}
static void lcd_data2(uint8_t v0, uint8_t v1)
{
    uint8_t d[2] = { v0, v1 };
    lcd_data(d, 2);
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

static void fill_rect(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1, uint16_t color)
{
    set_window(x0, y0, x1, y1);
    uint32_t npix = (uint32_t)(x1 - x0 + 1) * (y1 - y0 + 1);
    uint8_t c[2] = { (uint8_t)(color >> 8), (uint8_t)(color & 0xFF) };
    gpio_set_level(PIN_DC, 1);
    static uint8_t *buf = 0;
    if (!buf) buf = (uint8_t*)malloc(4096);
    for (uint32_t i = 0; i < 4096; i += 2) { buf[i] = c[0]; buf[i+1] = c[1]; }
    uint32_t left = npix * 2;
    while (left) {
        uint32_t take = left > 4096 ? 4096 : left;
        spi_transaction_t t = { .length = take * 8, .tx_buffer = buf };
        spi_device_polling_transmit(spi, &t);
        left -= take;
    }
}

/* ---- compact 5x7 ASCII font (index 0..94 = ' '..'~') ---- */
static const uint8_t FONT5[95][5] = {
    {0,0,0,0,0},{0x5F,0,0,0,0},{0,7,0,7,0},{0x14,0x7F,0x14,0x7F,0x14},
    {0x24,0x2A,0x7F,0x2A,0x12},{0x23,0x13,0x08,0x64,0x62},{0x36,0x49,0x55,0x22,0x50},
    {0,0x05,3,0,0},{0,0x1C,0x22,0x41,0},{0,0x41,0x22,0x1C,0},
    {8,0x2A,0x1C,0x2A,8},{8,8,0x3E,8,8},{0,0x50,0x50,0,0},{8,8,8,8,8},
    {0,0x60,0x60,0,0},{0x20,0x10,8,4,2},{0x3E,0x51,0x49,0x45,0x3E},{0,0x42,0x7F,0x40,0},
    {0x42,0x61,0x51,0x49,0x46},{0x21,0x41,0x45,0x4B,0x31},{0x18,0x14,0x12,0x7F,0x10},
    {0x27,0x45,0x45,0x45,0x39},{0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36},{0x06,0x49,0x49,0x29,0x1E},{0,0x36,0x36,0,0},
    {0,0x56,0x36,0,0},{8,0x14,0x22,0x41,0},{0x14,0x14,0x14,0x14,0x14},
    {0,0x41,0x22,0x14,0x08},{0x02,0x01,0x51,0x09,0x06},{0x32,0x49,0x79,0x41,0x3E},
    {0x7E,0x11,0x11,0x11,0x7E},{0x7F,0x49,0x49,0x49,0x36},{0x3E,0x41,0x41,0x41,0x22},
    {0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},{0x7F,0x09,0x09,0x09,0x01},
    {0x3E,0x41,0x41,0x51,0x32},{0x7F,0x08,0x08,0x08,0x7F},{0,0x41,0x7F,0x41,0},
    {0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},{0x7F,0x40,0x40,0x40,0x40},
    {0x7F,0x02,0x0C,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},{0x3E,0x41,0x41,0x41,0x3E},
    {0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},{0x7F,0x09,0x19,0x29,0x46},
    {0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7F,0x01,0x01},{0x3F,0x40,0x40,0x40,0x3F},
    {0x1F,0x20,0x40,0x20,0x1F},{0x3F,0x40,0x38,0x40,0x3F},{0x63,0x14,0x08,0x14,0x63},
    {0x07,0x08,0x70,0x08,0x07},{0x61,0x51,0x49,0x45,0x43},{0,0x7F,0x41,0x41,0},
    {0x02,0x04,0x08,0x10,0x20},{0,0x41,0x41,0x7F,0},{0x04,0x02,0x01,0x02,0x04},
    {0x40,0x40,0x40,0x40,0x40},{0,0x03,0x05,0x09,0},{0x20,0x54,0x54,0x54,0x78},
    {0x7F,0x48,0x44,0x44,0x38},{0x38,0x44,0x44,0x44,0x20},{0x38,0x44,0x44,0x48,0x7F},
    {0x38,0x54,0x54,0x54,0x18},{0x08,0x7E,0x09,0x01,0x02},{0x0C,0x52,0x52,0x52,0x3E},
    {0x7F,0x08,0x04,0x04,0x78},{0,0x44,0x7D,0x40,0},{0x20,0x40,0x40,0x3D,0},
    {0x7F,0x10,0x28,0x44,0},{0,0x41,0x7F,0x40,0},{0x7C,0x04,0x18,0x04,0x78},
    {0x7C,0x08,0x04,0x04,0x78},{0x38,0x44,0x44,0x44,0x38},{0x7C,0x14,0x14,0x14,0x08},
    {0x08,0x14,0x14,0x18,0x7C},{0x7C,0x08,0x04,0x04,0x08},{0x48,0x54,0x54,0x54,0x24},
    {0x04,0x3F,0x44,0x40,0x20},{0x3C,0x40,0x40,0x20,0x7C},{0x1C,0x20,0x40,0x20,0x1C},
    {0x3C,0x40,0x30,0x40,0x3C},{0x44,0x28,0x10,0x28,0x44},{0x0C,0x50,0x50,0x50,0x3C},
    {0x44,0x64,0x54,0x4C,0x44},{0x14,0x14,0x14,0x14,0x14},{0,0x7B,0,0,0}
};

static void draw_char(uint16_t x, uint16_t y, char ch, uint16_t color)
{
    int idx = ch - 0x20;
    if (idx < 0 || idx > 94) idx = 0;
    if (gc9_window_bytes(x, y, x + 4, y + 6) < 0) return;
    set_window(x, y, x + 4, y + 6);
    gpio_set_level(PIN_DC, 1);
    /* FONT5 stores five column bytes. Bit 0 is the top row. */
    for (int row = 0; row < 7; row++) {
        for (int col = 0; col < 5; col++) {
            uint8_t bits = FONT5[idx][col];
            lcd_data16((bits & (1u << row)) ? color : 0x0000);
        }
    }
}
static void draw_text(uint16_t x, uint16_t y, const char *s, uint16_t color)
{
    while (*s && x + 5 <= LCD_W) { draw_char(x, y, (uint8_t)*s++, color); x += 6; }
}

static int emit_init(uint8_t cmd, const uint8_t *data, uint8_t n, uint16_t delay_ms, void *ctx)
{
    (void)ctx;
    lcd_cmd(cmd);
    if (n && data) lcd_data(data, n);
    if (delay_ms) vTaskDelay(pdMS_TO_TICKS(delay_ms));
    return 0;
}

static uint16_t bg_for(const char *kind, int nfc_ok)
{
    if (!nfc_ok) return 0x8000;
    if (!kind) return 0x0320;
    if (!strcmp(kind, "pulse")) return 0x0320;
    if (!strcmp(kind, "blank") || !strcmp(kind, "unformatted")) return 0x020C;
    if (!strcmp(kind, "foreign")) return 0xC300;
    if (!strcmp(kind, "error") || !strcmp(kind, "unsupported")) return 0xA000;
    return 0x0018;
}

static void paint(const char *a, const char *b, const char *c, const char *kind, int nfc_ok)
{
    uint16_t bg = bg_for(kind, nfc_ok);
    fill_rect(0, 0, LCD_W - 1, LCD_H - 1, 0xFFFF);
    fill_rect(6, 6, LCD_W - 7, LCD_H - 7, bg);
    draw_text(16, 70, a && a[0] ? a : "PULSE", 0xFFFF);
    draw_text(16, 92, b ? b : "", 0xFFE0);
    draw_text(16, 114, c ? c : "", 0xFFFF);
    draw_text(16, 160, "pcg.reader.v1", 0xC618);
}

typedef struct {
    char l1[22], l2[22], l3[22], kind[16];
    int nfc_ok;
} frame_t;

static QueueHandle_t frames;
static SemaphoreHandle_t mu;
static ui_model_t model;
static int cur_nfc = 1, cur_usb = 0;
static char cur_kind[16] = "idle";
static char cur_uid[24];

static void push_frame(void)
{
    frame_t f;
    char l1[22], l2[22], l3[22];
    ui_beep_t beep = ui_model_apply(&model, cur_nfc, cur_usb, cur_kind, cur_uid, l1, l2, l3);
    memset(&f, 0, sizeof f);
    snprintf(f.l1, sizeof f.l1, "%s", l1);
    snprintf(f.l2, sizeof f.l2, "%s", l2);
    snprintf(f.l3, sizeof f.l3, "%s", l3);
    snprintf(f.kind, sizeof f.kind, "%s", cur_kind);
    f.nfc_ok = cur_nfc;
    if (frames) xQueueOverwrite(frames, &f);
    buzzer_request(beep);
}

static void panel_task(void *arg)
{
    (void)arg;
    frame_t f;
    while (xQueueReceive(frames, &f, portMAX_DELAY) == pdTRUE)
        paint(f.l1, f.l2, f.l3, f.kind, f.nfc_ok);
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

    ui_model_reset(&model);
    snprintf(cur_kind, sizeof cur_kind, "idle");
    paint("BOOT", "lcd on", "USB wait", "idle", 1);
    gpio_set_level(PIN_BL, 1);

    mu = xSemaphoreCreateMutex();
    frames = xQueueCreate(1, sizeof(frame_t));
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
}

void display_note_nfc(int nfc_ok) { with_model(set_nfc, nfc_ok ? (void *)1 : NULL); }
void display_note_usb(int open) { with_model(set_usb, open ? (void *)1 : NULL); }
void display_note_card(const char *kind, const char *uid)
{
    const char *s[2] = { kind, uid };
    with_model(set_card, s);
}