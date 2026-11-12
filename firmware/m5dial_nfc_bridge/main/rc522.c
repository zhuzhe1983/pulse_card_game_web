/*
 * PULSE M5Dial bridge — MFRC522-equivalent (WS1850S) driver over I2C.
 *
 * The M5Dial's onboard 13.56MHz NFC reader is a WS1850S, register/command
 * compatible with the NXP MFRC522 (M5 stack bundles the MFRC522 Arduino
 * library for it). It is wired on the internal I2C bus (M5Dial: SCL=G12,
 * SDA=G11, address 0x28) and supports ISO14443A / NFC-A.
 *
 * Faithful C port of the MFRC522 protocol as shipped by M5Stack, reduced to
 * what the PULSE bridge needs: init, REQA + cascaded UID selection, and NTAG
 * READ of whole pages (no authentication).
 */
#include "rc522.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "esp_err.h"
#include "esp_rom_sys.h"
#include <string.h>

static const char *TAG = "rc522";

/* ---- register map (M5 stack MFRC522 library) ---- */
#define REG_COMMAND       0x01
#define REG_COMIEN        0x02
#define REG_DIVIEN        0x03
#define REG_COMIRQ        0x04
#define REG_DIVIRQ        0x05
#define REG_ERROR         0x06
#define REG_STATUS1       0x07
#define REG_STATUS2       0x08
#define REG_FIFO_DATA     0x09
#define REG_FIFO_LEVEL    0x0A
#define REG_WATER_LEVEL   0x0B
#define REG_CONTROL       0x0C
#define REG_BIT_FRAMING   0x0D
#define REG_COLL          0x0E
#define REG_MODE          0x11
#define REG_TX_MODE       0x12
#define REG_RX_MODE       0x13
#define REG_TX_CONTROL    0x14
#define REG_TX_ASK        0x15
#define REG_TX_SEL        0x16
#define REG_RX_SEL        0x17
#define REG_RX_THRESHOLD  0x18
#define REG_DEMOD         0x19
#define REG_MF_TX         0x1C
#define REG_MF_RX         0x1D
#define REG_SERIAL_SPEED  0x1F
#define REG_CRC_RESULT_H  0x21
#define REG_CRC_RESULT_M  0x22
#define REG_CRC_RESULT_L  0x23
#define REG_MOD_WIDTH     0x24
#define REG_RF_CFG        0x26
#define REG_GS_N          0x27
#define REG_CW_GSP        0x28
#define REG_MOD_GSP       0x29
#define REG_T_MODE        0x2A
#define REG_T_PRESCALER   0x2B
#define REG_T_RELOAD_H    0x2C
#define REG_T_RELOAD_L    0x2D
#define REG_TC_COUNTER_H  0x2E
#define REG_TC_COUNTER_L  0x2F
#define REG_T_CONTROL     0x30
#define REG_VERSION       0x37

/* ---- PCD commands ---- */
#define PCD_IDLE       0x00
#define PCD_MEM        0x01
#define PCD_CALC_CRC   0x03
#define PCD_TRANSCEIVE 0x0E
#define PCD_SOFTRESET  0x0F

/* ---- PICC commands ---- */
#define CMD_REQA     0x26
#define CMD_WUPA     0x52
#define CMD_SEL_CL1  0x93
#define CMD_SEL_CL2  0x95
#define CMD_SEL_CL3  0x97
#define CMD_CT       0x88
#define CMD_MF_READ  0x30

/* ---- status (mirror M5 stack MFRC522) ---- */
enum { RC_OK=1, RC_ERROR=2, RC_COLLISION=3, RC_TIMEOUT=4, RC_NO_ROOM=5,
       RC_CRC_WRONG=8, RC_MIFARE_NACK=9 };

#define I2C_ADDR        0x28u   /* 7-bit MFRC522 address on M5Dial */

static i2c_master_dev_handle_t dev = NULL;

/* ---- transport: two-step reads mirror the Arduino TwoWire flow ---- */
static esp_err_t wreg(uint8_t reg, uint8_t val)
{
    uint8_t b[2] = { reg, val };
    return i2c_master_transmit(dev, b, sizeof b, 100);
}
static esp_err_t wreg_n(uint8_t reg, const uint8_t *data, size_t n)
{
    uint8_t buf[70];
    if (1 + n > sizeof buf) n = sizeof buf - 1;
    buf[0] = reg;
    memcpy(buf + 1, data, n);
    return i2c_master_transmit(dev, buf, 1 + n, 100);
}
static void rreg(uint8_t reg, uint8_t *out, size_t n)
{
    i2c_master_transmit(dev, &reg, 1, 100);
    i2c_master_receive(dev, out, n, 100);
}
static uint8_t rreg8(uint8_t reg) { uint8_t v; rreg(reg, &v, 1); return v; }
static void set_bits8(uint8_t reg, uint8_t mask)
{
    wreg(reg, rreg8(reg) | mask);
}
static void clear_bits8(uint8_t reg, uint8_t mask)
{
    wreg(reg, rreg8(reg) & ~mask);
}

static void soft_reset(void)
{
    wreg(REG_COMMAND, PCD_SOFTRESET);
    esp_rom_delay_us(50000);
    for (int i = 0; i < 20; i++) {
        if (!(rreg8(REG_COMMAND) & (1 << 4))) break;
        esp_rom_delay_us(1000);
    }
}

static int calc_crc(const uint8_t *data, uint8_t len, uint8_t res2[2])
{
    wreg(REG_COMMAND, PCD_IDLE);
    wreg(REG_DIVIRQ, 0x04);
    set_bits8(REG_FIFO_LEVEL, 0x80);
    wreg_n(REG_FIFO_DATA, data, len);
    wreg(REG_COMMAND, PCD_CALC_CRC);
    int got = RC_TIMEOUT;
    for (int i = 0; i < 5000; i++) {
        if (rreg8(REG_DIVIRQ) & 0x04) { got = RC_OK; break; }
    }
    wreg(REG_COMMAND, PCD_IDLE);
    res2[0] = rreg8(REG_CRC_RESULT_L);
    res2[1] = rreg8(REG_CRC_RESULT_H);
    return got;
}

static int transceive(uint8_t *sendData, uint8_t sendLen,
                      uint8_t *backData, uint8_t *backLen,
                      uint8_t *validBits, uint8_t rxAlign, bool checkCRC)
{
    uint8_t txLastBits = validBits ? *validBits : 0;
    uint8_t bitFraming = (rxAlign << 4) + txLastBits;

    wreg(REG_COMMAND, PCD_IDLE);
    wreg(REG_COMIRQ, 0x7F);
    set_bits8(REG_FIFO_LEVEL, 0x80);
    wreg_n(REG_FIFO_DATA, sendData, sendLen);
    wreg(REG_BIT_FRAMING, bitFraming);
    wreg(REG_COMMAND, PCD_TRANSCEIVE);
    set_bits8(REG_BIT_FRAMING, 0x80);          /* StartSend */

    int status = RC_TIMEOUT;
    for (int i = 2000; i > 0; i--) {
        uint8_t irq = rreg8(REG_COMIRQ);
        if (irq & 0x30) { status = RC_OK; break; }   /* RxIRq|IdleIRq */
        if (irq & 0x01) break;                        /* timer */
    }
    if (status != RC_OK) return status;

    uint8_t errv = rreg8(REG_ERROR);
    if (errv & 0x13) return RC_ERROR;

    if (backData && backLen) {
        uint8_t n = rreg8(REG_FIFO_LEVEL);
        if (n > *backLen) return RC_NO_ROOM;
        *backLen = n;
        rreg(REG_FIFO_DATA, backData, n);
        uint8_t valid = rreg8(REG_CONTROL) & 0x07;
        if (validBits) *validBits = valid;
    }

    if (errv & 0x08) return RC_COLLISION;

    if (backData && backLen && checkCRC) {
        if (validBits && *backLen == 1 && *validBits == 4) return RC_MIFARE_NACK;
        if ((validBits && *backLen < 2) || (validBits && *validBits != 0)) return RC_CRC_WRONG;
        uint8_t cmp[2];
        if (calc_crc(backData, *backLen - 2, cmp) != RC_OK) return RC_ERROR;
        if (backData[*backLen-2] != cmp[0] || backData[*backLen-1] != cmp[1])
            return RC_CRC_WRONG;
    }
    return status;
}

static int request_reqa(uint8_t atqa[2])
{
    uint8_t cmd = CMD_REQA;
    uint8_t vb = 7, size = 2;
    clear_bits8(REG_COLL, 0x80);
    int rc = transceive(&cmd, 1, atqa, &size, &vb, 0, false);
    if (rc != RC_OK) return rc;
    if (size != 2 || vb != 0) return RC_ERROR;
    return RC_OK;
}

/* ---- cascaded UID selection (PICC_Select port) ---- */
static int select_uid(uint8_t uid[10], uint8_t *uidLen)
{
    int cascade = 1;
    bool complete = false;

    while (!complete) {
        uint8_t sel;
        int uidIdx;
        switch (cascade) {
            case 1: sel = CMD_SEL_CL1; uidIdx = 0; break;
            case 2: sel = CMD_SEL_CL2; uidIdx = 3; break;
            case 3: sel = CMD_SEL_CL3; uidIdx = 6; break;
            default: return RC_ERROR;
        }

        uint8_t buf[9];
        buf[0] = sel;
        int knownBits = 0;
        bool done = false;
        while (!done) {
            if (knownBits >= 32) {
                /* SELECT with CRC */
                buf[1] = 0x70;
                buf[6] = buf[2] ^ buf[3] ^ buf[4] ^ buf[5];
                uint8_t crc[2];
                if (calc_crc(buf, 7, crc) != RC_OK) return RC_ERROR;
                buf[7] = crc[0]; buf[8] = crc[1];
                uint8_t resp[3], rl = 3, txb = 0;
                int rc = transceive(buf, 9, resp, &rl, &txb, 0, false);
                if (rc != RC_OK) return rc;
                if (rl != 3 || txb != 0) return RC_ERROR;
                uint8_t sak = resp[0];
                uint8_t src = (buf[2] == CMD_CT) ? 3 : 2;
                uint8_t nb  = (buf[2] == CMD_CT) ? 3 : 4;
                for (uint8_t i = 0; i < nb; i++) uid[uidIdx + i] = buf[src + i];
                if (sak & 0x04) cascade++;
                else complete = true;
                done = true;
            } else {
                /* ANTICOLLISION */
                uint8_t nvb = 2 + knownBits / 8;
                uint8_t txb = knownBits % 8;
                buf[1] = (nvb << 4) + txb;
                uint8_t used = nvb + (txb ? 1 : 0);
                uint8_t rl = sizeof buf - used;
                uint8_t txb2 = txb;
                int rc = transceive(buf, used, &buf[used], &rl, &txb2, txb, false);
                if (rc == RC_COLLISION) {
                    uint8_t coll = rreg8(REG_COLL);
                    if (coll & 0x20) return RC_COLLISION;
                    uint8_t pos = coll & 0x1F;
                    if (pos == 0) pos = 32;
                    if (pos <= (uint8_t)knownBits) return RC_ERROR;
                    knownBits = pos;
                    uint8_t bit = (pos - 1) % 8;
                    uint8_t idx = 1 + pos / 8 + (bit ? 1 : 0);
                    buf[idx] |= (1 << bit);
                } else if (rc == RC_OK) {
                    knownBits = 32;
                } else {
                    return rc;
                }
            }
        }
    }
    *uidLen = 3 * cascade + 1;
    return RC_OK;
}

/* ---- read 16 bytes from a page (4 pages) ---- */
static int read_ntag_page(uint8_t page, uint8_t blockOut[16])
{
    uint8_t cmd[2] = { CMD_MF_READ, page };
    uint8_t crc[2];
    if (calc_crc(cmd, 2, crc) != RC_OK) return RC_ERROR;
    uint8_t buf[4] = { cmd[0], cmd[1], crc[0], crc[1] };
    uint8_t len = 18, vb = 0;
    int rc = transceive(buf, 4, blockOut, &len, &vb, 0, true);
    if (rc != RC_OK) return rc;
    if (len < 16) return RC_ERROR;
    return RC_OK;
}

static void antenna_on(void)
{
    uint8_t v = rreg8(REG_TX_CONTROL);
    if ((v & 0x03) != 0x03) wreg(REG_TX_CONTROL, v | 0x03);
}

bool rc522_init(const pcg_rc522_conf_t *cfg)
{
    i2c_master_bus_config_t bcfg = {
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .i2c_port = I2C_NUM_0,
        .scl_io_num = cfg->scl,
        .sda_io_num = cfg->sda,
        .flags = { .enable_internal_pullup = true },
    };
    i2c_master_bus_handle_t bus;
    if (i2c_new_master_bus(&bcfg, &bus) != ESP_OK) return false;

    i2c_device_config_t dcfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = I2C_ADDR,
        .scl_speed_hz = cfg->freq ? cfg->freq : 100000,
    };
    if (i2c_master_bus_add_device(bus, &dcfg, &dev) != ESP_OK) return false;

    soft_reset();
    wreg(REG_T_MODE, 0x80);
    wreg(REG_T_PRESCALER, 0xA9);
    wreg(REG_T_RELOAD_H, 0x03);
    wreg(REG_T_RELOAD_L, 0xE8);
    wreg(REG_TX_ASK, 0x40);
    wreg(REG_MODE, 0x3D);
    antenna_on();

    uint8_t ver = rreg8(REG_VERSION);
    ESP_LOGI(TAG, "MFRC522/WS1850S version=0x%02x", ver);
    return ver != 0xFF && ver != 0x00;
}

bool rc522_select(pcg_tag_id_t *out, uint32_t max_ms)
{
    (void)max_ms;
    uint8_t atqa[2];
    if (request_reqa(atqa) != RC_OK) return false;
    if (select_uid(out->uid, &out->uid_len) != RC_OK) return false;
    return out->uid_len == 4 || out->uid_len == 7 || out->uid_len == 10;
}

int rc522_write_page(uint8_t page, const uint8_t data[4])
{
    uint8_t buf[8], crc[2], resp[2];
    uint8_t rl = sizeof resp, vb = 0;
    if (!data || page < 3 || page > 129) return -1;
    buf[0] = 0xA2;
    buf[1] = page;
    memcpy(buf + 2, data, 4);
    if (calc_crc(buf, 6, crc) != RC_OK) return -1;
    buf[6] = crc[0];
    buf[7] = crc[1];
    if (transceive(buf, 8, resp, &rl, &vb, 0, false) != RC_OK) return -1;
    if (vb == 4 && (resp[0] & 0x0F) != 0x0A) return -1;
    return 0;
}

size_t rc522_read_memory(uint8_t *out, size_t out_len, uint32_t addr)
{
    uint8_t page = (uint8_t)(addr / 4);
    uint8_t block[16];
    if (read_ntag_page(page, block) != RC_OK) return 0;
    uint32_t off = addr % 4;
    size_t n = 16 - off;
    if (n > out_len) n = out_len;
    memcpy(out, block + off, n);
    return n;
}