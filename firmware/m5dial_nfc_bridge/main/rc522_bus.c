#include "rc522_bus.h"
#include "driver/i2c_master.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
static i2c_master_dev_handle_t dev;
bool rc522_bus_init(const pcg_rc522_conf_t *cfg)
{
    i2c_master_bus_config_t bus_config = { .clk_source=I2C_CLK_SRC_DEFAULT, .i2c_port=I2C_NUM_0,
        .scl_io_num=cfg->scl, .sda_io_num=cfg->sda, .flags={.enable_internal_pullup=true} };
    i2c_master_bus_handle_t bus;
    if (i2c_new_master_bus(&bus_config,&bus) != ESP_OK) return false;
    i2c_device_config_t device_config = { .dev_addr_length=I2C_ADDR_BIT_LEN_7, .device_address=0x28,
        .scl_speed_hz=cfg->freq ? cfg->freq : 100000 };
    return i2c_master_bus_add_device(bus,&device_config,&dev) == ESP_OK;
}
bool rc522_bus_write(uint8_t reg, const uint8_t *data, size_t length)
{
    uint8_t bytes[65];
    if (!dev || length > 64) return false;
    bytes[0]=reg; memcpy(bytes+1,data,length);
    return i2c_master_transmit(dev,bytes,length+1,20) == ESP_OK;
}
bool rc522_bus_read(uint8_t reg, uint8_t *data, size_t length)
{
    if (!dev || !length) return false;
    /* Match M5Dial's register pointer write followed by read. */
    if (i2c_master_transmit(dev,&reg,1,20) != ESP_OK) return false;
    return i2c_master_receive(dev,data,length,20) == ESP_OK;
}
uint64_t rc522_bus_now_us(void) { return esp_timer_get_time(); }
void rc522_bus_delay_us(uint32_t us)
{
    if (us >= 1000) vTaskDelay(pdMS_TO_TICKS((us+999)/1000) ? pdMS_TO_TICKS((us+999)/1000) : 1);
    else esp_rom_delay_us(us);
}
