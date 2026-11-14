# M5Dial 读卡修复、声音与圆屏反馈

版本：`2026.11.14-feedback.2`。在电脑 Chrome/Edge 打开 [固件烧录页](https://zhuzhe1983.github.io/pulse_card_game_web/dist/flash.html) 升级，随后回到 [牌桌](https://zhuzhe1983.github.io/pulse_card_game_web/dist/clash/?lang=zh-CN) 连接 M5Dial。网站更新不能替换设备内部固件。

## NTAG215 无响应的原因

旧版 USB 握手成功，但驱动把 `PCD_Transceive` 写成 `0x0E`，正确值是 `0x0C`；CRC 低字节寄存器写成 `0x23`，正确值是 `0x22`。这两个地址/命令错误使射频选卡无法正常完成。已对照 [M5Stack 官方 MFRC522 定义](https://github.com/m5stack/M5Dial/blob/master/src/utility/MFRC522.h) 修正，并运行生产驱动的寄存器级测试，覆盖 UID 级联、BCC、SAK CRC、READ、写入 ACK、通信失败和超时。

本版启动时以 `30 04 → 26 EE` 做硬件 CRC 自检；失败时显示读卡器异常。网页「检查读卡器」能显示自检、轮询数、选卡数和 I2C 错误数，避免把 USB 已连接误当成已经读到卡。I2C 使用官方驱动相同的 100 kHz。持续放置的同一张卡不重复读整片存储、不重复响完成音；移开后再放才触发下一次。

M5Stack 说明过：尺寸小于 Dial 外圈的 RFID 标签可能无法识别或通讯不稳，建议银行卡大小的卡片。尺寸可能影响感应，但不能代替修复上述固件错误。[官方卡片说明](https://docs.m5stack.com/en/core/Dial#rfid-card)

## 声音与屏幕

| 状态 | 提示音 | 圆屏 |
|---|---|---|
| 等待卡片 | 1800 Hz、55 ms，每 1.6 秒间隔循环 | 青色状态环、等待卡片、放卡提示 |
| 开始读取 | 2200 Hz、260 ms 长音 | 琥珀色环、读取中 |
| 已读到卡 | 2400 → 3100 Hz 上扬双音 | 空白卡／玩家身份／其他卡片、UID |
| 开始写入 | 两声 2000 Hz、各 90 ms | 写入进度、请勿移开 |
| 正在校验 | 2700 Hz、45 ms 短音 | 读回校验、进度 |
| 写入并校验成功 | 2100 → 2700 → 3400 Hz 三音 | 绿色勾、身份卡制作完成 |
| 读取或写入失败 | 1100 → 800 Hz 下降双音 | 红色叉、失败和重刷提示 |

声音任务与 NFC、显示任务分开，蜂鸣不会阻塞读写。等待音可用网页「提示音」按钮或 M5Dial 正面按键静音；网页会同步物理按键的静音状态。底部显示 USB 与声音状态。声调和时值由 `main/sound_pattern.c` 直接定义，没有拉伸或变速处理。

主题与当前游戏一致：银白 ABS/铝合金边框、深蓝灰面板、绿色 PCB 和少量铜线。底图用内置 image_gen 生成，原图、完整提示词、来源和编码信息在 `firmware/m5dial_nfc_bridge/assets/`；中文使用 SIL OFL 的 Noto Sans CJK 子集。文字、图标和进度由实际固件实时绘制，预览使用同一绘图函数。[九种状态预览](../dist/firmware/m5dial-ui-preview.png)

## 协议和兼容

网页 hello 增加 `status_events:true`，新固件 hello 返回 `feedback:true`。只有明确请求状态事件的客户端才收到 `status {phase,uid,progress}`，旧网页仍可用原 card/removed 消息。`feedback {sound:false}` 静音；`diag` 返回读卡器自检和计数。写卡仍要求 `confirm:true,overwrite:false`，只写空白可写 NTAG215；只有实际读回成功的 write_result 才会保存玩家身份。状态动画或提示音不能单独作为写卡成功依据。

## 验证边界

固件编译、生产驱动寄存器测试、主机写卡/协议测试、渲染检查、网页模拟设备测试已覆盖本版。之前实机只验证了旧固件握手成功且没有 card 事件；新版硬件验收结果须另记，不能用模拟器结果替代实体射频读写。烧录器要求设备进入下载模式：断电后按住背面 Stamp-S3 的 G0，接 USB 数据线，通电后松开。若仍停留在下载模式，按 RST 或重新插拔再连接牌桌。
