#ifndef PCG_RC522_BUS_H
#define PCG_RC522_BUS_H
#include "rc522.h"
bool rc522_bus_init(const pcg_rc522_conf_t *cfg);
bool rc522_bus_write(uint8_t reg, const uint8_t *data, size_t length);
bool rc522_bus_read(uint8_t reg, uint8_t *data, size_t length);
uint64_t rc522_bus_now_us(void);
void rc522_bus_delay_us(uint32_t us);
#endif
