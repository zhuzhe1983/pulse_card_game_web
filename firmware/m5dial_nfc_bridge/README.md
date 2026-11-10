# M5Dial NFC·USB 读卡桥 (ESP-IDF)

把 **M5Dial**（ESP32-S3 + 内置 WS1850S NFC 前端 + GC9A01 圆屏）变成一个给 PULSE 网页游戏用的 **USB NFC 刷卡器**：

- 刷到 NTAG215 卡 → 通过 USB 串口（TinyUSB CDC）输出 `pcg.reader.v1` JSON 行
- 网页端用 **Web Serial**（`dist/` 里的“串口”按钮）连接，零改动读取卡号与 PULSE 身份 NDEF
- 圆屏显示 READY / 卡上有无身份

> 出厂 M5Dial 的读卡器是 **WS1850S**（与 NXP MFRC522 寄存器/指令兼容），走内部 I2C：**SCL=G12, SDA=G11**，地址 `0x28`。详见 `main/rc522.c`。`docs/READERS.md` 有摄像头协议约定。

## 依赖

- ESP-IDF **v5.3.x**（本工程按 5.3.2 开发）
- 会用 ESP-IDF 组件管理器拉取 `espressif/esp_tinyusb`（首次编译需联网）

## 构建

```bash
cd firmware/m5dial_nfc_bridge
idf.py set-target esp32s3
idf.py build
```

## 烧录

M5Dial 原生 USB 走 **USB-Serial-JTAG**，直接 `idf.py flash` 即可；因为要用网页 flasher，建议烧 **merged 合并镜像**：

```bash
# 生成单个合并文件（供网页 flasher 用）
cd build
esptool.py --chip esp32s3 merge_bin -o merged_dio.bin \
  --flash_mode dio --flash_freq 80m --flash_size 32MB \
  0x0 bootloader/bootloader.bin \
  0x8000 partition_table/partition-table.bin \
  0x10000 m5dial_nfc_bridge.bin
```

烧录（三件套）：
```bash
esptool.py --chip esp32s3 -p /dev/cu.usbmodemXXXX -b 460800 write_flash \
  --flash_mode dio --flash_freq 80m --flash_size 32MB \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0x10000 build/m5dial_nfc_bridge.bin
```

**务必用 `dio`**：M5Dial 出厂固件就是 SPI **DIO 80MHz / 32MB**，header 里存了 `0x02`（DIO）。烧成 QIO 会导致启动看门狗循环（`rst:0x7 (TG0WDT_SYS_RST)`）。

> 本机一次演示的固件头：`e9 04 02 5f` → byte2=`0x02`=DIO，byte3 低取 80MHz、大 flash。

## 网页烧录器

`dist/flash.html`（与游戏同目录）用 `esptool-js` 走 Web Serial 烧 `dist/firmware/m5dial_nfc_bridge_merged_dio.bin`。
- 需要 Chrome/Edge + 安全上下文（localhost 或 HTTPS）
- 连接后选 serial → 烧录。若列表空，重新插拔或按住复位再点刷新。

## 验证

进入 `dist/` 起静态服务器，浏览器打开游戏，点“串口”连接 M5Dial，应看到握手 `hello … capabilities ["uid","ndef_read"]`。刷一张 NTAG215（如已写 PULSE 身份）→ 收到 `card` 事件；没写身份 → 收到 `card {descriptor:null}`，屏幕显示“Card (no NDEF)”。

固件把完整进度存在浏览器，卡里只带身份 NDEF（与 `docs/READERS.md` 一致）；本固件**只读**，不写卡（`ndef_write` 未开放）。

## 目录

| 文件 | 作用 |
|---|---|
| `main/main.c` | 入口，装配 |
| `main/rc522.c/h` | WS1850R(MFRC522)/I2C 驱动：REQA、级联选卡拿 UID、NTAG page 读取 |
| `main/pcg_ndef.c/h` | NTAG NDEF→PULSE 身份 JSON（无硬件可单测） |
| `main/pcg_proto.c/h` | `pcg.reader.v1` 协议端点（hello/card/removed/write） |
| `main/nfc_read.c/h` | 轮询任务：去抖、读 UID+NDEF、上报 |
| `main/usb_cdc.c/h` | TinyUSB CDC 传输 |
| `main/display_gc9a01.c/h` | GC9A01 圆屏最小 UI |
| `main/*.test.c / test_*` | 无硬件单测（NDEF、协议 FSM）；host 用 `cc` 编译跑 |

## 说明

`backup_original/` 保存了这台 M5Dial 出厂时读回的 flash 备份（boot 区），如需还原用 esptool 写回即可。