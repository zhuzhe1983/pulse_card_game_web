# M5Dial NFC·USB 读卡桥 (ESP-IDF)

> 2026-11-14 状态更正：本文件早期「只读」说明已过期。`main.c` 声明 `uid/ndef_read/ndef_write`，`nfc_read.c` 已有旧玩家身份写入与读回代码，但这不等于通过实机验收。最后的 2026-11-11 烧录记录中，镜像验证成功，应用 CDC 未出现，实体卡读写未执行。当前网页通过 USB 读取游戏牌原始 NDEF，不向本固件发送游戏牌写入；用户初始化 UI 仍归档。详见 [读卡状态](../../docs/READERS.md)。

把 **M5Dial**（ESP32-S3 + 内置 WS1850S NFC 前端 + GC9A01 圆屏）变成一个给 PULSE 网页游戏用的 **USB NFC 刷卡器**：

- 刷到 NTAG215 卡 → 通过 USB 串口（TinyUSB CDC）输出 `pcg.reader.v1` JSON 行
- 网页端用 **Web Serial**（`dist/clash/` 里的“刷卡 → 连接 M5Dial（USB）”按钮）连接，读取卡号、原始 NDEF 与旧 PULSE 身份
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

## 屏幕、蜂鸣器和连接状态

官方引脚（[Dial](https://docs.m5stack.com/en/core/Dial) PinMap，以及 M5Unified 的 `board_M5Dial`）：

- GC9A01：RS/DC=G4，MOSI=G5，SCK=G6，CS=G7，RST=G8，BL=G9
- 蜂鸣器：G3，方波，空闲不响；新卡一声，读失败两声
- FT3267 触摸在同一条 I2C（0x38，INT=G14）。本读卡器不用触摸
- WS1850S：SDA=G11，SCL=G12，地址 0x28

顶栏圆点在代码里默认是灰的（`#a1a8a1`）。只有 `hello` 握手成功后的 `connected` / `reading` 才加上 `on`，变成绿色（`#4d9673`）。浏览器选择器里的「已配对」不是这个状态。

USB-Serial-JTAG 在这份配置里关掉。只打开串口、不发 `hello` 时设备可以保持连接；`hello` 应答本身很小。应答曾经在 TinyUSB 接收回调里放在 4096 字节的栈上，而 USB 任务栈也只有 4096，应答发出后任务被踩坏，大约一秒内 CDC 报 `Device not configured` 并重新枚举。协议处理现在在独立任务里，回复缓冲放在 BSS。`hello` 带 `reset` 字段，`diag` 可查询会话和当前卡。已经贴着的卡会在握手后补发一次 `card`，拿着不放不会重复刷卡。

网页用 115200 打开，不用 1200。

历史云端构建说明不作为验收记录；已保存烧录记录的限制见文首。

## 硬件与 Flash

原版 M5Dial（[Stamp-S3](https://docs.m5stack.com/en/core/Dial)）和 M5Dial v1.1（[Stamp-S3A](https://docs.m5stack.com/en/core/Dial_v1.1)）都是 **ESP32-S3FN8：8MB Quad Flash**。两份官方规格都没有列出 PSRAM，本固件不启用 PSRAM，也不假定板上有 8MB Octal PSRAM。

实机 `esptool` 识别为 8MB GigaDevice（JEDEC `c8/4017`，quad，3.3V），ESP32-S3 rev0.2。烧录参数固定为 **DIO、80MHz、8MB**：

- **DIO**：烧成 QIO 会进入启动看门狗循环（`rst:0x7 (TG0WDT_SYS_RST)`）。
- **8MB**：镜像头若写成更大容量，引导程序会报 `Detected size smaller than the size in the binary image header. Probe failed.`，因为芯片比头里写的小。

镜像头：byte2 `0x02` = DIO；byte3 `0x3f` = 80MHz（低 4 位 `0xf`）+ 8MB（高 4 位 `0x3`）。`sdkconfig.defaults` 和 `tools/build_dist.sh` 都钉死这组参数。`CMakeLists.txt` 会在生成出别的 Flash 容量、QIO 或 PSRAM 时直接让配置失败。

分区表 `partitions.csv` 与原先的单应用布局相同（nvs / phy_init / factory 1MB），工厂分区在 `0x110000` 结束，落在 8MB 以内。

## 烧录

M5Dial 原生 USB 走 **USB-Serial-JTAG**，直接 `idf.py flash` 即可；因为要用网页 flasher，建议烧 **merged 合并镜像**：

```bash
# 在已 export 的 ESP-IDF 5.3.x 环境里，从本目录生成 dist 镜像并自检
./tools/build_dist.sh
```

等价的手工合并（在 `build/` 下）：

```bash
esptool.py --chip esp32s3 merge_bin -o merged_dio.bin \
  --flash_mode dio --flash_freq 80m --flash_size 8MB \
  0x0 bootloader/bootloader.bin \
  0x8000 partition_table/partition-table.bin \
  0x10000 m5dial_nfc_bridge.bin
```

烧录（三件套）：
```bash
esptool.py --chip esp32s3 -p /dev/cu.usbmodemXXXX -b 460800 write_flash \
  --flash_mode dio --flash_freq 80m --flash_size 8MB \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0x10000 build/m5dial_nfc_bridge.bin
```

`elf2image` 会按 `sdkconfig` 写入 bootloader 和 app 两份头。`merge_bin` 的 `--flash_size` 只会改写地址 0 的 bootloader 头，所以 app 头的 8MB 必须来自这次编译，不能靠事后改一个字节冒充。

## 网页烧录器

`dist/flash.html`（与游戏同目录）用 `esptool-js` 0.7.1 走 Web Serial 烧 `dist/firmware/m5dial_nfc_bridge_merged_dio.bin`。页面把烧录参数固定为 `dio` / `80m` / `8MB`，并在烧录前检查合并镜像里 bootloader（0x0）和 app（0x10000）两份头。
- 需要 Chrome/Edge + 安全上下文（localhost 或 HTTPS）
- 连接后选 serial → 烧录。若列表空，重新插拔或按住复位再点刷新。

## 验证

从仓库根目录启动静态服务器，打开 `/dist/clash/`，点“刷卡 → 连接 M5Dial（USB）”。当前源码的握手能力为 `hello … capabilities ["uid","ndef_read","ndef_write"]`；是否能稳定握手仍需设备验证。刷一张 NTAG215（如已写 PULSE 身份）→ 收到 `card` 事件；没写身份 → 收到 `card {descriptor:null}`，屏幕显示“Card (no NDEF)”。

旧设计把完整进度存在浏览器，卡里只带身份 NDEF。当前固件的写卡路径仅针对旧身份格式，未完成实机验收；不能用它写当前游戏牌 MIME。网页目前只读取 M5Dial 返回的 UID 和完整原始 NDEF。

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