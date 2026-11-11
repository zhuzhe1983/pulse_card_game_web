# 18 · 九十六张牌与升星

这是 `pcg.clash.v0` 的扩展牌表，状态 **playtest_draft**。数值没有经过对战验证。官方英文型号、美术 type、SKU 状态和芯片列表来自 2026-11-11 的 Wiki 美术交接，SKU 写着待核验的不填具体编号。中文名、费用、技能、阵营和星级是游戏设计，不是官方数据，也不是已经平衡的事实。

卡面标题仍用官方型号。这里的中文名给 Wiki 和牌面说明用。图片字节不在本表里。

全表：`content/clash_roster_96.json`。教学 12 张仍以 `content/clash_playtest.json` 为准。两边重合的模板用同一个 id，数值与技能相同。

## 0. 系列费用曲线

状态仍是 **playtest_draft**，这轮只重定费用和随费用一起动的攻击、耐久、技能，不改硬件结论。

1 费只给单独的 Stamp 小模块。Stamp-S3、S3A、两种针距、C3、C3U、C5、C6LoRa、P4 都是邮票本体。用 Stamp 拼出来的整机不收 1 费。StamPLC 是工控整机，6 费。StampFly 这种飞行器如果以后进牌表，按飞行器的体量定费，不进 1 费；这 96 张里没有 StampFly，不补一张。

Atom、Stick 同样只把核心本体放在系列基础档。摄像头、长焦、扩展座、语音款仍然是 Atom 大小，留在 2 费。这 96 张里没有单独的 Atom 套件主机，也没有 Stick 套装整机。核心本体的系列档这轮不动。

官方文档写明 DinMeter 的主控是 Stamp-S3，v1.1 换成 Stamp-S3A，所以它是邮票套装，不是邮票模块，也不是 Dial。一星 2 费，攻击 2、耐久 2。二星 3 费，攻击 1、耐久 4。依据：<https://docs.m5stack.com/en/core/DinMeter> 与 <https://docs.m5stack.com/en/core/DinMeter_v1.1>。

Air Quality 同样处理。商店名是 Air Quality Kit with M5StampS3，文档写由 StampS3 供电；v1.1 的商店名和文档都写主控换成 Stamp-S3A。一星 2 费，攻击 1、耐久 3。二星 3 费，攻击 2、耐久 3。依据：<https://docs.m5stack.com/en/core/Air_Quality> 与 <https://shop.m5stack.com/products/air-quality-kit-w-m5stamps3-sen55-scd40>。SKU 仍待核验，不编造编号。

Dial 仍是点名的 8 费整机档。StamPLC 仍是 6 费工控整机。StampFly 不在这 96 张里。

二星是该档再加 1，最少也是 1。差价计算公式不变：下一星费用减这一星费用，少于 1 就按 1。没有一档超过 10，因为供电上限是 10。

| 费用 | 系列核心 | 这 96 张里有哪些 |
|---:|---|---|
| 1 | Stamp 模块本体 | Stamp-S3、两种针距、C3、C3U、C5、C6LoRa、P4 |
| 2 | Atom 核心本体；Stamp 二星 | Atom-Matrix、AtomS3、S3R 及摄像头/长焦/扩展/语音、Stamp-S3A |
| 3 | Stick 核心本体；Atom 二星 | StickC-Plus2、Plus SE、StickS3、StickT2、Atom-Matrix v1.1 |
| 4 | Core 初代本体 | Fire v2.7。Basic、Gray 不在这 96 张里 |
| 5 | Core2 本体 | Core2、Core2 For AWS |
| 6 | CoreS3 本体；Core2 二星 | CoreS3-SE、Lite、Thread、两台 Core2 的二星 |
| 7 | Tough 本体 | Tough、ToughC5 |
| 8 | Dial 本体 | Dial |
| 9 | Cardputer 本体；Dial 二星 | Cardputer、Cardputer-Adv、Dial v1.1 |
| 10 | Tab5、上位 ARM；Cardputer 二星 | Tab5、CardputerZero、Cardputer v1.1 |

| 费用 | 系列组合整机 | 为什么不是核心档 |
|---:|---|---|
| 2 | DinMeter、Air Quality | 官方写成 Stamp-S3 / StampS3 套装。一星按 2 费曲线重配 |
| 3 | 这两台的二星、CoreMatrix | 套装二星 +1。灯墙按普通 Core 的 4 费减 1 |
| 5 | M5GO IoT Kit、PowerHub | 套件比 Fire 高 1 费。电枢纽是 S3，攻击 3，护卫胖墙耐久 7 |
| 6 | StamPLC | 工控整机。壳里有邮票，不按邮票模块收 1 费 |
| 10 | Cardputer Mesh Kit、CoreMP135 | 套件比掌机本体高 1 费。CoreMP135 是 Linux 整机，费用在最高档，仍然不能发动来自上位的爱 |

只给攻击 +1、又不占链节标记的帽子和转接件留在 1 费。会改战斗规则的配件上调：只给护卫或普通链节标记到 3 费；护卫加链节、忽略护卫、攻击 +2 到 4 费；忽略护卫或攻击 +2 再加链节标记到 5 费。Chain 节点的硬件仍是辅助可编程单片机，游戏角色仍是配件。基线的链节留在 1 费，千里眼因为忽略护卫上调到 4 费，护罩仍是 1 费。

1 费邮票的费用不按芯片加价。入门 C3、C5、C6 攻击 1；S3 攻击 2、耐久 2；P4 大印攻击 3、耐久 1。打出去就是这个攻击数，站在最左边不再加。短印仍是冲锋，攻击 1、耐久 1。C6LoRa 仍没有入场伤害。Stamp-P4 的官方型号仍是一枚邮票，所以费用留在 1，攻击按高性能档抬高。

夺舍仍是 7 费。拿 1 费入门邮票是亏的；拿 1 费大印、6 费厚壳或 9 到 10 费的整机才值。积木开工、记一笔、说人话的费用不动。来自上位的爱仍是 1 费，光环仍是不叠加的 +1。

## 0.1 芯片档次

芯片型号抄官方规格，是硬件事实。下面的攻击和耐久是待试玩方案，试玩可以改，不改芯片栏。

同系列、同费用时，攻击按档次递增：入门（ESP32-C3、C5、C6、C61）低于 S3，S3 低于 P4。高档可以少给耐久、多给攻击，同一费用的身材预算大致对齐。经典 ESP32（LX6、PICO）单列，不冒充 S3。CoreMP135 和 CardputerZero 是 Cortex-A 或 STM32MP，不放进这三档，攻耐保持原案。

待试玩的裸身材，再按护卫减 1 攻、加 1 耐，冲锋或打出效果减 1 耐，攻击不超过 5。二星攻击至少比一星高 1，顶到 5 就不再加。电枢纽是例外：攻击按 S3 提到 3，耐久仍留在胖墙 7。

| 费用 | 入门 | S3 | P4 |
|---:|---|---|---|
| 1 | 1/2，冲锋再减耐 | 2/2 | 3/1 |
| 2 | 2/2 | 3/2 | 4/1 |
| 3 | 2/3 | 3/2 | 4/2 |
| 6 | 3/5 | 4/4 | 5/3 |
| 10 | 4/6 | 5/5 | 5/5，攻击到顶可以持平 |

1 费邮票的现案是：短印 1/1，直插印、快印、远印 1/2，小印和两种针距 2/2，大印 3/1。小印改是 2 费 S3，3/2，支援保留。

上一轮费用张数是 1 费 36、2 费 28、3 费 5、4 费 2、5 费 3、6 费 6、7 费 3、8 费 3、9 费 5、10 费 5。这一轮把强技能配件和几台组合整机补进中段之后，是 1 费 24、2 费 21、3 费 17、4 费 10、5 费 7、6 费 6、7 费 2、8 费 1、9 费 3、10 费 5。3 到 5 费合计 34。8 费只剩 Dial 本体。前三回合仍打 1 费邮票、2 费 Atom 和 3 费 Stick。

## 1. 升星怎么打

星级是游戏设计，不是把版本号直接换成星星。v1.3 不会自动变成三星。册里没有的版本不编造，所以没有一条链凑满三星。最长是两星。

升星发生在你的主阶段：

1. 场上有这一星，手牌里有同一条链的下一星。
2. 先检查。不合法就不扣电、不移牌。
3. 费用是下一星的费用减去这一星的费用，最少 1 点。主控二星比一星高 1 费，升星付 1。动座二星把攻击加成从 +1 改成 +2，费用从 1 到 3，升星付 2。
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
| 轨上表 | H036 DinMeter | H036a v1.1 | 同一邮票套装的修订。二星 3 费，攻击 4、耐久 2。 |
| 气表 | H037 Air Quality | H037a v1.1 | 同一邮票套装的修订。二星 3 费。 |
| 小印 | H038 Stamp-S3 | H038a Stamp-S3A | 同一邮票的修订，支援技能延续。 |
| 动座 | C004c Motion v1.1 | C004d v1.2 | 册内只有这两版，不发明 v1.0。 |

二星不是全面碾压。敲键二星把耐久从 4 补到 5，攻击停在 5。旋钮二星攻击升到 5、耐久降到 4。轨上表和气表都是 S3，二星贵 1 费，攻击再高 1，耐久仍是 2。

## 3. 哪些是横向，不升星

- 邮票 CPU：C3、C3U、C5、C6 LoRa、P4。代际和无线电不同。
- 小印改的两种针距：2.54 和 1.27。只是封装，没有支援。
- CoreS3 的简配、轻量和线程款。
- 小三的精简内存、摄像头、长焦、扩展和语音。
- 敲键进、敲键组、零键。Adv、套装和另一台电脑，不是敲键的下一星。
- 自带电、省电条、新细条、热眼睛。四台 Stick，不是同一条升星链。占位牌细条已退役，不在这四台里。
- 链上的按键、摇杆、测距等节点。不同传感器。它们带辅助可编程单片机，游戏角色是配件，这不是「无主控」。
- 回传、固定、空板、桥、接上串、串线舵机。不同零件。
- 各种小块底座。只有动座 v1.1 到 v1.2 升星。定位座写着 v2.0，但没有更早的版本在这 96 张里。
- Stick 上的各种帽子。八舵帽写着 v1.1，没有上一版，所以是单张横向，不升星。
- 火头、套装、硬壳、硬壳远、大平板、灯墙、电枢纽、另一块板、厚壳工控、星座、测距眼。各只有一款，或和名字相近的机器不是同一产品。

厚壳工控没有下一星。小印支援它的规则与教学基线相同。

## 4. 和已定 12 张的关系

这五张图就是基线牌，模板 id 相同，费用和数值跟基线一起改：

| 图 | 基线 |
|---|---|
| H038 Stamp-S3 | 小印 `xiao_yin` |
| H041 StamPLC | 厚壳工控 `hou_ke` |
| H027 Atom-Matrix | 点阵哨 `dian_zhen` |
| H031 Cardputer | 敲键 `qiao_jian` |
| H034 Dial | 旋钮台 `xuan_niu` |

占位牌细条已退役，不再留在基线里。教学局改用 H024 新细条，模板 id 是 `art_h024`。链节、千里眼、护罩、补给包、干扰、回充、借一格电没有对应的这 96 张图，仍留在基线里。一节键、测距眼是别的牌，不复制它们的 id。

旧草案里 Core2 叫厚壳。那会和厚壳工控撞名，所以 Core2 改叫二代壳。旧的 `core2_guard` 只留在三局规则里。

## 5. 技能就这几样

主控可以有：护卫、冲锋、支援、旋钮、入场抽 1、入场对一台敌人造成 1 点伤害。配件只做三件事：攻击加 1 或加 2、给护卫、让宿主攻击时忽略护卫。

入场伤害不看护卫，没有反击。不指定目标也可以打出，那样就不造成伤害。指定了不存在的目标，整步取消，不扣电。

阵营只给图鉴用。首版结算不读阵营，也不读美术 type。

## 6. 全表

费用按第 0 节。攻击和耐久按第 0.1 节的芯片档次，状态仍是待试玩。芯片型号仍是官方事实。

| rid | 中文名 | 官方英文 | 角色 | 费 | 攻 | 耐 | 效果 | 成长 | 星 |
|---|---|---|---|---:|---:|---:|---|---|---:|
| A001 | 数模帽 | Hat DAC2 | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| A002 | 小喇叭 | Hat SPK2 | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| A006 | 小摇杆 | Hat Mini JoyC | attachment | 3 | 0 | 0 | 给护卫 | lateral | — |
| A007 | 小旋帽 | Hat Mini EncoderC | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| A009 | 大摇杆 | Hat JoyC | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| A011a | 热帽 | Hat NCIR | attachment | 4 | 0 | 0 | 忽略护卫 | lateral | — |
| A012 | 舵机帽 | Hat Servo | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| A012a | 八舵帽 | Hat 8Servos v1.1 | attachment | 4 | 0 | 0 | 攻击+2 | lateral | — |
| A012b | 驱动帽 | Hat CBack Driver | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| A013b | 震帽 | Hat Vibrator | attachment | 3 | 0 | 0 | 给护卫 | lateral | — |
| A014 | 细条小屏 | Display 1.14 For StickS3 | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C001a | 摇杆节 | Chain Joystick | attachment | 4 | 0 | 0 | 给护卫 | lateral | — |
| C001b | 编码节 | Chain Encoder | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C001c | 角度节 | Chain Angle | attachment | 5 | 0 | 0 | 忽略护卫 | lateral | — |
| C001d | 测距节 | Chain ToF | attachment | 5 | 0 | 0 | 忽略护卫 | lateral | — |
| C001e | 红外节 | Chain PIR | attachment | 4 | 0 | 0 | 给护卫 | lateral | — |
| C001f | 开关节 | Chain Switch | attachment | 3 | 0 | 0 | 攻击+1 | lateral | — |
| C001g | 麦节 | Chain MIC | attachment | 3 | 0 | 0 | 攻击+1 | lateral | — |
| C001h | 蜂鸣节 | Chain Buzzer | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C001i | 彩灯节 | Chain RGB | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C001j | 单声节 | Chain Mono | attachment | 3 | 0 | 0 | 攻击+1 | lateral | — |
| C001z | 一节键 | Chain Key | attachment | 3 | 0 | 0 | 攻击+1 | lateral | — |
| C002a | 回传节 | Chain Return | attachment | 3 | 0 | 0 | 攻击+1 | lateral | — |
| C002b | 固定节 | Chain Mount | attachment | 4 | 0 | 0 | 给护卫 | lateral | — |
| C002c | 空节 | Chain Blank | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C002z | 桥节 | Chain Bridge | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C003 | 接上串 | Atomic ToChain Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004a | 转接口座 | Atomic ToUnit Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004b | 三口座 | Atomic Port ABC Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004c | 动座 | Atomic Motion Base v1.1 | attachment | 1 | 0 | 0 | 攻击+1 | chain | 1 |
| C004d | 动座改 | Atomic Motion Base v1.2 | attachment | 3 | 0 | 0 | 攻击+2 | chain | 2 |
| C004e | 定位座 | Atomic GPS Base v2.0 | attachment | 4 | 0 | 0 | 忽略护卫 | lateral | — |
| C004g | 网电座 | Atomic PoE Base | attachment | 2 | 0 | 0 | 给护卫 | lateral | — |
| C004h | 显示座 | Atomic Display Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004i | 电池座 | Atomic Battery Base | attachment | 3 | 0 | 0 | 给护卫 | lateral | — |
| C004j | 总线座 | Atomic CAN Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004k | 脉宽座 | Atomic PWM Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004l | 扫码座 | Atomic QRCode2 Base | attachment | 4 | 0 | 0 | 忽略护卫 | lateral | — |
| C004m | 串口座 | Atomic RS232 Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004n | 座喇叭 | Atomic SPK Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004o | 步进座 | Atomic Stepmotor Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004p | 存储座 | Atomic TFCard Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004q | 驱动座 | Atomic HDriver Base | attachment | 2 | 0 | 0 | 攻击+1 | lateral | — |
| C004r | 耳麦座 | Atomic Audio-3.5 Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C004z | 响座 | Atomic Voice Base | attachment | 1 | 0 | 0 | 攻击+1 | lateral | — |
| C005 | 串线舵机 | Unit 8Servos2-Chain | attachment | 5 | 0 | 0 | 攻击+2 | lateral | — |
| H003 | 火头 | Fire v2.7 | main | 4 | 3 | 2 | 冲锋 | solo | — |
| H004 | 套装 | M5GO IoT Kit v2.7 | main | 5 | 2 | 5 | 护卫 | solo | — |
| H005 | 二代壳 | Core2 | main | 5 | 2 | 5 | 护卫 | chain | 1 |
| H007 | 二代壳改 | Core2 v1.3 | main | 6 | 3 | 6 | 护卫 | chain | 2 |
| H008 | 云壳 | Core2 For AWS | main | 5 | 3 | 4 | 无 | chain | 1 |
| H008a | 云壳改 | Core2 For AWS v1.3 | main | 6 | 4 | 5 | 无 | chain | 2 |
| H010 | 简配三 | CoreS3-SE | main | 6 | 4 | 4 | 无 | lateral | — |
| H011 | 轻三 | CoreS3-Lite | main | 6 | 4 | 4 | 无 | lateral | — |
| H012 | 线三 | CoreS3 Thread BR | main | 6 | 4 | 3 | 入场抽1 | lateral | — |
| H013 | 硬壳 | Tough | main | 7 | 2 | 7 | 护卫 | solo | — |
| H014 | 硬壳远 | ToughC5 | main | 7 | 3 | 6 | 无 | solo | — |
| H015 | 大平板 | Tab5 | main | 10 | 5 | 4 | 入场抽1 | solo | — |
| H016 | 灯墙 | CoreMatrix | main | 3 | 1 | 4 | 护卫 | solo | — |
| H017 | 电枢纽 | PowerHub | main | 5 | 3 | 7 | 护卫 | solo | — |
| H018 | 另一块板 | CoreMP135 | main | 10 | 4 | 6 | 无 | solo | — |
| H022 | 自带电 | StickC-Plus2 | main | 3 | 2 | 3 | 无 | lateral | — |
| H023 | 省电条 | StickC-Plus SE | main | 3 | 2 | 3 | 无 | lateral | — |
| H024 | 新细条 | StickS3 | main | 3 | 3 | 2 | 无 | lateral | — |
| H025 | 热眼睛 | StickT2 | main | 3 | 2 | 2 | 入场伤害1 | lateral | — |
| H027 | 点阵哨 | Atom-Matrix | main | 2 | 1 | 4 | 护卫 | chain | 1 |
| H027a | 点阵改 | Atom-Matrix v1.1 | main | 3 | 2 | 4 | 护卫 | chain | 2 |
| H028 | 小三 | AtomS3 | main | 2 | 3 | 2 | 无 | lateral | — |
| H029 | 小三精 | AtomS3R | main | 2 | 3 | 2 | 无 | lateral | — |
| H029a | 小三眼 | AtomS3R-CAM | main | 2 | 3 | 1 | 入场伤害1 | lateral | — |
| H029b | 小三长焦 | AtomS3R-M12 | main | 2 | 3 | 2 | 无 | lateral | — |
| H029c | 小三扩 | AtomS3R-Ext | main | 2 | 3 | 2 | 无 | lateral | — |
| H030a | 小三话 | Atom VoiceS3R | main | 2 | 3 | 2 | 无 | lateral | — |
| H031 | 敲键 | Cardputer | main | 9 | 5 | 4 | 无 | chain | 1 |
| H032 | 敲键改 | Cardputer v1.1 | main | 10 | 5 | 5 | 无 | chain | 2 |
| H033 | 敲键进 | Cardputer-Adv | main | 9 | 5 | 4 | 无 | lateral | — |
| H033a | 敲键组 | Cardputer Mesh Kit | main | 10 | 5 | 4 | 入场抽1 | lateral | — |
| H034 | 旋钮台 | Dial | main | 8 | 4 | 5 | 旋钮 | chain | 1 |
| H034a | 旋钮改 | Dial v1.1 | main | 9 | 5 | 4 | 旋钮 | chain | 2 |
| H036 | 轨上表 | DinMeter | main | 2 | 3 | 2 | 无 | chain | 1 |
| H036a | 轨上表改 | DinMeter v1.1 | main | 3 | 4 | 2 | 无 | chain | 2 |
| H037 | 气表 | Air Quality | main | 2 | 3 | 2 | 无 | chain | 1 |
| H037a | 气表改 | Air Quality v1.1 | main | 3 | 4 | 2 | 无 | chain | 2 |
| H038 | 小印 | Stamp-S3 | main | 1 | 2 | 2 | 支援 | chain | 1 |
| H038a | 小印改 | Stamp-S3A | main | 2 | 3 | 2 | 支援 | chain | 2 |
| H038b | 宽脚印 | Stamp-S3A PIN2.54 | main | 1 | 2 | 2 | 无 | lateral | — |
| H038c | 密脚印 | Stamp-S3A PIN1.27 | main | 1 | 2 | 2 | 无 | lateral | — |
| H039a | 短印 | Stamp-C3 | main | 1 | 1 | 1 | 冲锋 | lateral | — |
| H039b | 直插印 | Stamp-C3U | main | 1 | 1 | 2 | 无 | lateral | — |
| H039c | 快印 | Stamp-C5 | main | 1 | 1 | 2 | 无 | lateral | — |
| H039e | 远印 | Stamp C6LoRa | main | 1 | 1 | 2 | 无 | lateral | — |
| H039f | 大印 | Stamp-P4 | main | 1 | 3 | 1 | 无 | lateral | — |
| H041 | 厚壳工控 | StamPLC | main | 6 | 3 | 5 | 护卫 | solo | — |
| H050 | 零键 | CardputerZero | main | 10 | 4 | 7 | 无 | lateral | — |
| S001a | 星座 | Module GPS v2.1 | attachment | 4 | 0 | 0 | 忽略护卫 | solo | — |
| U002a | 测距眼 | Unit ToF4M | attachment | 4 | 0 | 0 | 忽略护卫 | solo | — |

待试玩。要改费用先改 JSON，再改第 0 节和测试。
