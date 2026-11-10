# PULSE：读卡器、NTAG215 与玩家卡

## 已实现的接入方式

| 方式 | 能读什么 | 能写什么 | 使用条件 |
|---|---|---|---|
| 键盘 UID 读卡器 | NFC-A 卡的十六进制 UID | 不支持 | 将扫描结果输入页面的 UID 输入框；读卡器设为十六进制输出 |
| M5Dial·USB NFC 桥 | NFC-A/NTAG215 的 UID 与 PULSE 身份 NDEF | **只读**（本版不开写卡） | `firmware/m5dial_nfc_bridge` 固件 + Web Serial；网页“串口”按钮直接连接 |
| WebUSB PCG bridge | UID，可选 PULSE NDEF 描述 | 桥同时声明读写能力时，写入并读回核对玩家身份 | 固件实现下述 `pcg.reader.v1`；vendor-specific 接口，bulk IN/OUT |
| Web Serial PCG bridge | 与 WebUSB 相同 | 取决于桥声明的能力 | 串口固件实现同一 JSON 行协议；默认 115200 baud |
| Android Web NFC | NDEF 标签内的 PULSE 身份；浏览器返回 UID 时也读取 UID | 小型玩家身份 NDEF | 支持 Web NFC 的 Android Chrome、设备带 NFC、网页处于前台 |
| 模拟刷卡 | 网页内的演示卡 | 无物理写卡 | 用于先体验玩法和测试流程 |

这些是实际不同的驱动入口。**WebUSB 按钮不是通用 USB NFC 驱动。** 常见 CCID 智能卡接口属于 USB class `0x0B`，是普通网页 WebUSB 受保护的接口类别；因此不能承诺插入 ACR122U 就直接读取。键盘模拟型读卡器应走 UID 输入框；带串口固件的 ESP32 应走 Web Serial；vendor bridge 才走 WebUSB。[WebUSB 规范](https://usb.spec.whatwg.org/#has-a-protected-interface-class)

USB、串口和 NFC 功能均按浏览器能力检测。请在桌面 Chrome/Edge 上通过 `http://localhost:8000` 运行；从另一台设备访问普通 `http://192.168.x.x` 不等同于 localhost，相关能力可能被禁用。手机访问应使用可信 HTTPS。iPhone/iPad 网页不能假设具备上述外设接口，仍可使用模拟卡与对战功能。[Chrome USB 文档](https://developer.chrome.com/docs/capabilities/usb) · [Chrome 设备连接说明](https://support.google.com/chrome/answer/12576972)

## 01–09 与 NTAG215

01–09 是九种**玩家卡外观**，不是九个固定账号。创建玩家时生成独立 UUID；两个人选择相同的卡面，仍是两个不同玩家。读卡器无法从 UID 自动推断纸面上的图片编号，首次绑定时由玩家选择卡面。10–22 作为英雄卡素材，英雄卡可在本地绑定成盲盒或指定角色。

NTAG215 有 504 字节用户读写存储。32 位密码可以限制读写，但不等于加密身份认证；可复制的身份记录和 UID 不适合作为安全登录凭证。本项目用于朋友之间的游戏。它不会设置密码、永久锁位或试图写入厂商 UID 区。[NXP NTAG213/215/216 数据手册](https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf)

网页完整进度存在浏览器本地存储。身份卡只带下面的小型描述，不含英雄收藏、每日扫描账本或完整存档。将身份卡拿到另一台设备不等于迁移进度；需要导出并导入网页存档。只读 UID 桥只能查询本机的 UID 绑定，不能读取卡内 UUID。

### 玩家身份 NDEF

单条 MIME 记录，类型 `application/vnd.pcg.identity+json`，UTF-8，载荷最多 384 字节，给 NTAG215 的 NDEF 与 TLV 开销留出空间。

```json
{"game":"pcg","v":1,"type":"player","id":"12345678-1234-4123-8123-123456789abc","skin":"01","name":"小明"}
```

`id` 必须是 UUID v4；`skin` 为 `01`–`09`；`name` 可省略，最多 24 字。字段严格验证，未知版本不会被静默当作兼容版本。

可选的英雄描述：

```json
{"game":"pcg","v":1,"type":"hero","id":"98765432-1234-4123-8123-123456789abc","mode":"blind"}
```

指定角色使用 `"mode":"fixed"`，并增加 `"template_id":"已安装内容包中的英雄ID"`。是否存在该英雄及是否允许领取，由游戏层验证。

### 写卡流程

网页必须由玩家明确按下写卡按钮。`writePlayer(descriptor)` 默认 `overwrite:false`，避免覆盖已有 NDEF；玩家明确同意覆盖后，调用 `writePlayer(descriptor,{overwrite:true})`。不要把已有其他用途的标签当作空白卡。

Web NFC 写入成功返回 `{verified:false,uid:null,descriptor}`，表示浏览器已完成写入，页面应请玩家再次刷卡核对。Web NFC 是 NDEF API，不提供本项目所需的 NTAG 密码配置或任意底层 NFC 指令。[Chrome Web NFC 文档](https://developer.chrome.com/docs/capabilities/nfc)

PCG bridge 必须验证目标 UID 没有变化，写入、重新读取 NDEF 后才报告成功；浏览器再次比较 UID 和描述内容，得到 `{verified:true,uid,descriptor}`。无实际硬件时不能把这条软件协议当作已完成硬件验证。

## `pcg.reader.v1` 桥协议

### 传输

UTF-8 JSON Lines；每条一个 JSON 对象，末尾 `\n`，接收端也接受 `\r\n`。每行最多 4096 字节，不允许混入日志。USB 数据包与 JSON 行不要求一一对应，网页会处理任意分片及跨包 UTF-8 字符。串口默认为 115200、8N1。串口的读写功能是浏览器原生 API。[Chrome Web Serial 文档](https://developer.chrome.com/docs/capabilities/serial)

WebUSB 固件须提供 class `0xFF` 的接口，至少一个 bulk IN 和一个 bulk OUT。网页自动发现接口和端点；它不发送通用串口初始化、CCID APDU 或 PN532 原始帧。桥自己负责 Grove/I2C/SPI/UART 读卡器驱动。

浏览器发起握手，5 秒内须收到回答：

```json
{"type":"hello","protocol":"pcg.reader.v1"}
```

```json
{"type":"hello","protocol":"pcg.reader.v1","device":"My PN532 bridge","capabilities":["uid","ndef_read","ndef_write"]}
```

只会读 UID 的桥必须仅返回 `["uid"]`。`ndef_write` 必须与 `ndef_read` 同时提供才能启用网页写卡。不能通过虚报能力打开按钮。

卡片进入感应区后发出：

```json
{"type":"card","uid":"04AA1B2C3D4E5F","tech":"nfc-a","descriptor":null}
```

有合法 PULSE NDEF 时，`descriptor` 为上文的身份对象。UID 按字节顺序输出大写十六进制，4、7 或 10 字节；NTAG215 通常为 7 字节。移开卡后发出：

```json
{"type":"removed"}
```

同卡留在感应区的重复事件会被抑制；`removed` 后再次进入才算新一次刷卡。连接中断不会生成扫描或奖励。

写卡命令仅在玩家明确操作后发出：

```json
{"type":"write","request_id":"request-unique-id","expected_uid":"04AA1B2C3D4E5F","mime":"application/vnd.pcg.identity+json","descriptor":{"game":"pcg","v":1,"type":"player","id":"12345678-1234-4123-8123-123456789abc","skin":"01"},"overwrite":false}
```

固件必须在写入前重新读取 UID；与 `expected_uid` 不同则拒绝。如果已有 NDEF 且 `overwrite:false`，拒绝。写入后再读取标签内容，并返回真实读回结果：

```json
{"type":"write_result","request_id":"request-unique-id","ok":true,"uid":"04AA1B2C3D4E5F","descriptor":{"game":"pcg","v":1,"type":"player","id":"12345678-1234-4123-8123-123456789abc","skin":"01"}}
```

失败返回 `{"type":"write_result","request_id":"request-unique-id","ok":false,"error":"reason"}`。网页等待最多 20 秒，不自动重试写卡，不把超时当成功。桥自身异常可返回 `{"type":"error","message":"reason"}`。

## PN532 桥固件示例

`firmware/pcg_pn532_bridge/pcg_pn532_bridge.ino` 提供完整的 **UID 只读** Arduino 示例。默认使用 USB 串口，可以把装了 PN532 读卡器的 ESP32 作为本游戏的 USB 外接读卡桥。库为 [Seeed-Studio/PN532](https://github.com/Seeed-Studio/PN532) 与 ArduinoJson。根据设备修改 SDA/SCL 引脚，并将 PN532 切到 I2C 模式；Grove 是连接方式，不代表所有 Grove NFC 模块都采用相同芯片或协议。

有原生 USB 且 Arduino core 支持 Adafruit TinyUSB 的开发板可尝试 `PCG_USE_WEBUSB=1`，启用 vendor bulk 接口。此实现直接调用 TinyUSB vendor 数据传输，因此不需要 CDC line-state 请求。普通 ESP32 的 CP210x/CH340 USB 转串口芯片不会因为修改宏就变成原生 WebUSB 设备；这种板继续使用 Web Serial。[Adafruit TinyUSB WebUSB 示例](https://github.com/adafruit/Adafruit_TinyUSB_Arduino/tree/master/examples/WebUSB)

**固件示例尚未编译或连接真实板卡测试。** 不应直接宣称它兼容每个 M5Stack/Grove 组合。网页协议和读卡适配器已通过无硬件单元测试；具体开发板、USB 栈、NFC 模块及其电气连接仍须实测。

## JavaScript API

```js
const reader = new PCGReaders.ReaderManager({
  onCard: ({uid, source, descriptor, tech}) => handleCard(uid, descriptor),
  onStatus: ({state, source, message, canWrite}) => showStatus(message)
});
await reader.connectUSB();          // 来自用户点击；PCG vendor bridge
await reader.connectSerial();       // 来自用户点击；PCG serial bridge
await reader.startWebNFC();         // Android，来自用户点击
reader.feedKeyboard('04AA1B2C3D4E5F');
await reader.writePlayer(playerDescriptor); // 显式写入，默认不覆盖
await reader.disconnect();
```

一次只保持一种连接。`feedKeyboard` 不在后台捕获键盘，页面在扫描输入框收到回车时显式调用。`PCGReaders.capabilities()` 返回 `secure/webusb/serial/webnfc/keyboard`。`normalizeUID`、`parseDescriptor`、`encodeDescriptor` 均会对不合法数据抛出带 `code` 的 `ReaderError`。

执行软件测试：`node tests/readers.test.cjs`。覆盖 UID 规范化、身份校验、分片与错误编码、过长消息、键盘去重、USB 端点发现/握手、写后读回、断开取消。测试使用假 USB 设备，不代替硬件验收。
