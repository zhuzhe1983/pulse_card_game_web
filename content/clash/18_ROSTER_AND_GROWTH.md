# 18 · 九十六张牌与升星

这是 `pcg.clash.v0` 的扩展牌表，状态 **playtest_draft**。数值没有经过对战验证。官方英文型号、美术 type、SKU 状态和芯片列表来自 2026-11-11 的 Wiki 美术交接，SKU 写着待核验的不填具体编号。中文名、费用、技能、阵营和星级是游戏设计，不是官方数据，也不是已经平衡的事实。

卡面标题仍用官方型号。这里的中文名给 Wiki 和牌面说明用。图片字节不在本表里。

全表：`content/clash_roster_96.json`。教学 12 张仍以 `content/clash_playtest.json` 为准。两边重合的模板用同一个 id，数值与技能相同。

## 1. 升星怎么打

星级是游戏设计，不是把版本号直接换成星星。v1.3 不会自动变成三星。册里没有的版本不编造，所以没有一条链凑满三星。最长是两星。

升星发生在你的主阶段：

1. 场上有这一星，手牌里有同一条链的下一星。
2. 先检查。不合法就不扣电、不移牌。
3. 费用是下一星的费用减去这一星的费用，最少 1 点。轨上表两星同为 3 费，所以升星付 1。
4. 没有降星。
5. 主控：旧配件先进入墓地，旧主控再进入墓地，并记「本回合升星退役」。新主控留在队伍里原来的顺序位置，按下一星的满耐久入场，不带配件，本回合不能攻击。冲锋也不能在升星当回合打人。战场没有固定座位数。
6. 配件：旧配件进墓地，新配件仍装在同一个宿主上。宿主的新入场和已攻击不变。若新配件要给护卫，而宿主自己印着护卫，升星失败且不扣电。
7. 不继承已损失的耐久、旧技能次数和已攻击。支援和旋钮的「本回合用过」按玩家计，升星不刷新。
8. 本回合升星退役的厚壳工控，不能马上被小印再支援回来。下回合开始，这道限制解除。
9. 组牌时每一星最多 1 张。一条链可以都带上，每张占牌库一张；也可以只带高星，直接付全费打出。

取舍：升星是换新型号，不是给旧机体回血，所以不继承残血和配件。差价最少 1，避免同费升星变成免费换牌。不做成三张合成，也不做付费抽卡。

## 2. 哪些是成长链

依据是同一产品的修订，芯片和用途还是那一款。

| 家族 | 一星 | 二星 | 为什么是一条链 |
|---|---|---|---|
| 二代壳 | H005 Core2 | H007 Core2 v1.3 | 同一主机的修订。没有 v1.1、v1.2，不补。游戏星级是 1 和 2，不是 3。 |
| 云壳 | H008 Core2 For AWS | H008a AWS v1.3 | 云服务用途，不并进普通二代壳。 |
| 点阵哨 | H027 Atom-Matrix | H027a v1.1 | 同一灯阵的修订。AtomS3 是另一代。 |
| 敲键 | H031 Cardputer | H032 v1.1 | 同一掌机的修订。 |
| 旋钮台 | H034 Dial | H034a v1.1 | 同一台表的修订。 |
| 轨上表 | H036 DinMeter | H036a v1.1 | 同一仪表的修订。二星同费，更肉、更不锋利。 |
| 气表 | H037 Air Quality | H037a v1.1 | 同一空气站的修订。 |
| 小印 | H038 Stamp-S3 | H038a Stamp-S3A | 同一邮票的修订，支援技能延续。 |
| 动座 | C004c Motion v1.1 | C004d v1.2 | 册内只有这两版，不发明 v1.0。 |

二星不是全面碾压。敲键改用攻击换耐久；旋钮改更利也更脆；轨上表改同费换肉。

## 3. 哪些是横向，不升星

- 邮票 CPU：C3、C3U、C5、C6 LoRa、P4。代际和无线电不同。
- 小印改的两种针距：2.54 和 1.27。只是封装，没有支援。
- CoreS3 的简配、轻量和线程款。
- 小三的精简内存、摄像头、长焦、扩展和语音。
- 敲键进、敲键组、零键。Adv、套装和另一台电脑，不是敲键的下一星。
- 自带电、省电条、新细条、热眼睛。四种细条。
- 链上的按键、摇杆、测距等节点。不同传感器。它们带辅助可编程单片机，游戏角色是配件，这不是「无主控」。
- 回传、固定、空板、桥、接上串、串线舵机。不同零件。
- 各种小块底座。只有动座 v1.1 到 v1.2 升星。定位座写着 v2.0，但没有更早的版本在这 96 张里。
- 细条上的各种帽子。八舵帽写着 v1.1，没有上一版，所以是单张横向，不升星。
- 火头、套装、硬壳、硬壳远、大平板、灯墙、电枢纽、另一块板、厚壳工控、星座、测距眼。各只有一款，或和名字相近的机器不是同一产品。

厚壳工控没有下一星。小印支援它的规则与教学基线相同。

## 4. 和已定 12 张的关系

这五张图就是基线牌，模板 id 和数值不动：

| 图 | 基线 |
|---|---|
| H038 Stamp-S3 | 小印 `xiao_yin` |
| H041 StamPLC | 厚壳工控 `hou_ke` |
| H027 Atom-Matrix | 点阵哨 `dian_zhen` |
| H031 Cardputer | 敲键 `qiao_jian` |
| H034 Dial | 旋钮台 `xuan_niu` |

细条、链节、千里眼、护罩、补给包、干扰、回充、借一格电没有对应的这 96 张图，仍留在基线里。新细条、一节键、测距眼是别的牌，不复制它们的 id。

旧草案里 Core2 叫厚壳。那会和厚壳工控撞名，所以 Core2 改叫二代壳。旧的 `core2_guard` 只留在三局规则里。

## 5. 技能就这几样

主控可以有：护卫、冲锋、支援、旋钮、入场抽 1、入场对一台敌人造成 1 点伤害。配件只做三件事：攻击加 1 或加 2、给护卫、让宿主攻击时忽略护卫。

入场伤害不看护卫，没有反击。不指定目标也可以打出，那样就不造成伤害。指定了不存在的目标，整步取消，不扣电。

阵营只给图鉴用。首版结算不读阵营，也不读美术 type。

## 6. 全表

| rid | 中文名 | 官方英文 | 角色 | 费 | 攻 | 耐 | 效果 | 成长 | 星 |
|---|---|---|---|---:|---:|---:|---|---|---:|
| A001 | 数模帽 | Hat DAC2 | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| A002 | 小喇叭 | Hat SPK2 | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| A006 | 小摇杆 | Hat Mini JoyC | attachment | 1 | 0 | 0 | 给护卫 | lateral | — |
| A007 | 小旋帽 | Hat Mini EncoderC | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| A009 | 大摇杆 | Hat JoyC | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| A011a | 热帽 | Hat NCIR | attachment | 2 | 0 | 0 | 忽略护卫 | lateral | — |
| A012 | 舵机帽 | Hat Servo | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| A012a | 八舵帽 | Hat 8Servos v1.1 | attachment | 2 | 0 | 0 | 攻击+2 | lateral | — |
| A012b | 驱动帽 | Hat CBack Driver | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| A013b | 震帽 | Hat Vibrator | attachment | 1 | 0 | 0 | 给护卫 | lateral | — |
| A014 | 细条小屏 | Display 1.14 For StickS3 | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C001a | 摇杆节 | Chain Joystick | attachment | 1 | 0 | 0 | 给护卫 | lateral | — |
| C001b | 编码节 | Chain Encoder | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C001c | 角度节 | Chain Angle | attachment | 2 | 0 | 0 | 忽略护卫 | lateral | — |
| C001d | 测距节 | Chain ToF | attachment | 2 | 0 | 0 | 忽略护卫 | lateral | — |
| C001e | 红外节 | Chain PIR | attachment | 1 | 0 | 0 | 给护卫 | lateral | — |
| C001f | 开关节 | Chain Switch | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C001g | 麦节 | Chain MIC | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C001h | 蜂鸣节 | Chain Buzzer | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C001i | 彩灯节 | Chain RGB | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C001j | 单声节 | Chain Mono | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C001z | 一节键 | Chain Key | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C002a | 回传节 | Chain Return | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C002b | 固定节 | Chain Mount | attachment | 1 | 0 | 0 | 给护卫 | lateral | — |
| C002c | 空节 | Chain Blank | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C002z | 桥节 | Chain Bridge | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C003 | 接上串 | Atomic ToChain Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004a | 转接口座 | Atomic ToUnit Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004b | 三口座 | Atomic Port ABC Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004c | 动座 | Atomic Motion Base v1.1 | attachment | 1 | 0 | 0 | 攻击+1 | chain | 1 |
| C004d | 动座改 | Atomic Motion Base v1.2 | attachment | 2 | 0 | 0 | 攻击+2 | chain | 2 |
| C004e | 定位座 | Atomic GPS Base v2.0 | attachment | 2 | 0 | 0 | 忽略护卫 | lateral | — |
| C004g | 网电座 | Atomic PoE Base | attachment | 2 | 0 | 0 | 给护卫 | lateral | — |
| C004h | 显示座 | Atomic Display Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004i | 电池座 | Atomic Battery Base | attachment | 1 | 0 | 0 | 给护卫 | lateral | — |
| C004j | 总线座 | Atomic CAN Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004k | 脉宽座 | Atomic PWM Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004l | 扫码座 | Atomic QRCode2 Base | attachment | 1 | 0 | 0 | 忽略护卫 | lateral | — |
| C004m | 串口座 | Atomic RS232 Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004n | 座喇叭 | Atomic SPK Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004o | 步进座 | Atomic Stepmotor Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004p | 存储座 | Atomic TFCard Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004q | 驱动座 | Atomic HDriver Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004r | 耳麦座 | Atomic Audio-3.5 Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004z | 响座 | Atomic Voice Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C005 | 串线舵机 | Unit 8Servos2-Chain | attachment | 2 | 0 | 0 | 攻击+2 | lateral | — |
| H003 | 火头 | Fire v2.7 | main | 3 | 3 | 3 | 冲锋 | solo | — |
| H004 | 套装 | M5GO IoT Kit v2.7 | main | 4 | 2 | 5 | 护卫 | solo | — |
| H005 | 二代壳 | Core2 | main | 4 | 3 | 5 | 护卫 | chain | 1 |
| H007 | 二代壳改 | Core2 v1.3 | main | 5 | 3 | 6 | 护卫 | chain | 2 |
| H008 | 云壳 | Core2 For AWS | main | 4 | 4 | 3 | 无 | chain | 1 |
| H008a | 云壳改 | Core2 For AWS v1.3 | main | 5 | 3 | 4 | 无 | chain | 2 |
| H010 | 简配三 | CoreS3-SE | main | 4 | 3 | 4 | 无 | lateral | — |
| H011 | 轻三 | CoreS3-Lite | main | 3 | 3 | 3 | 无 | lateral | — |
| H012 | 线三 | CoreS3 Thread BR | main | 5 | 3 | 4 | 入场抽1 | lateral | — |
| H013 | 硬壳 | Tough | main | 4 | 2 | 6 | 护卫 | solo | — |
| H014 | 硬壳远 | ToughC5 | main | 5 | 3 | 5 | 无 | solo | — |
| H015 | 大平板 | Tab5 | main | 6 | 3 | 6 | 入场抽1 | solo | — |
| H016 | 灯墙 | CoreMatrix | main | 5 | 2 | 6 | 护卫 | solo | — |
| H017 | 电枢纽 | PowerHub | main | 4 | 2 | 5 | 无 | solo | — |
| H018 | 另一块板 | CoreMP135 | main | 6 | 4 | 5 | 无 | solo | — |
| H022 | 自带电 | StickC-Plus2 | main | 3 | 2 | 4 | 无 | lateral | — |
| H023 | 省电条 | StickC-Plus SE | main | 2 | 2 | 2 | 无 | lateral | — |
| H024 | 新细条 | StickS3 | main | 3 | 2 | 3 | 无 | lateral | — |
| H025 | 热眼睛 | StickT2 | main | 3 | 1 | 3 | 入场伤害1 | lateral | — |
| H027 | 点阵哨 | Atom-Matrix | main | 3 | 2 | 4 | 护卫 | chain | 1 |
| H027a | 点阵改 | Atom-Matrix v1.1 | main | 4 | 2 | 5 | 护卫 | chain | 2 |
| H028 | 小三 | AtomS3 | main | 3 | 3 | 3 | 无 | lateral | — |
| H029 | 小三精 | AtomS3R | main | 4 | 3 | 3 | 无 | lateral | — |
| H029a | 小三眼 | AtomS3R-CAM | main | 4 | 2 | 3 | 入场伤害1 | lateral | — |
| H029b | 小三长焦 | AtomS3R-M12 | main | 4 | 3 | 2 | 无 | lateral | — |
| H029c | 小三扩 | AtomS3R-Ext | main | 4 | 2 | 4 | 无 | lateral | — |
| H030a | 小三话 | Atom VoiceS3R | main | 3 | 2 | 3 | 无 | lateral | — |
| H031 | 敲键 | Cardputer | main | 4 | 4 | 3 | 无 | chain | 1 |
| H032 | 敲键改 | Cardputer v1.1 | main | 5 | 3 | 5 | 无 | chain | 2 |
| H033 | 敲键进 | Cardputer-Adv | main | 5 | 5 | 3 | 无 | lateral | — |
| H033a | 敲键组 | Cardputer Mesh Kit | main | 6 | 4 | 4 | 入场抽1 | lateral | — |
| H034 | 旋钮台 | Dial | main | 3 | 1 | 3 | 旋钮 | chain | 1 |
| H034a | 旋钮改 | Dial v1.1 | main | 4 | 2 | 2 | 旋钮 | chain | 2 |
| H036 | 轨上表 | DinMeter | main | 3 | 2 | 3 | 无 | chain | 1 |
| H036a | 轨上表改 | DinMeter v1.1 | main | 3 | 1 | 5 | 无 | chain | 2 |
| H037 | 气表 | Air Quality | main | 3 | 1 | 4 | 无 | chain | 1 |
| H037a | 气表改 | Air Quality v1.1 | main | 4 | 2 | 3 | 无 | chain | 2 |
| H038 | 小印 | Stamp-S3 | main | 2 | 2 | 2 | 支援 | chain | 1 |
| H038a | 小印改 | Stamp-S3A | main | 3 | 2 | 3 | 支援 | chain | 2 |
| H038b | 宽脚印 | Stamp-S3A PIN2.54 | main | 2 | 1 | 3 | 无 | lateral | — |
| H038c | 密脚印 | Stamp-S3A PIN1.27 | main | 2 | 3 | 1 | 无 | lateral | — |
| H039a | 短印 | Stamp-C3 | main | 1 | 2 | 1 | 冲锋 | lateral | — |
| H039b | 直插印 | Stamp-C3U | main | 2 | 1 | 3 | 无 | lateral | — |
| H039c | 快印 | Stamp-C5 | main | 3 | 3 | 2 | 无 | lateral | — |
| H039e | 远印 | Stamp C6LoRa | main | 3 | 2 | 3 | 入场伤害1 | lateral | — |
| H039f | 大印 | Stamp-P4 | main | 5 | 4 | 4 | 无 | lateral | — |
| H041 | 厚壳工控 | StamPLC | main | 5 | 3 | 6 | 护卫 | solo | — |
| H050 | 零键 | CardputerZero | main | 5 | 4 | 4 | 无 | lateral | — |
| S001a | 星座 | Module GPS v2.1 | attachment | 2 | 0 | 0 | 忽略护卫 | solo | — |
| U002a | 测距眼 | Unit ToF4M | attachment | 2 | 0 | 0 | 忽略护卫 | solo | — |

待平衡的是整表的费用和攻击耐久，不是缺字段。要改先改 JSON，再改这条说明和测试。
