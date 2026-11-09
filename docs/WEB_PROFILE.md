# PULSE 网页运行配置 v1

本文描述随包客户端实际使用的数据与互通边界，供其他平台实现相同客户端或编写转换器。它不是对旧版二进制协议的隐式升级。中文名称、页面布局、卡面图片和按钮流程属于本客户端的表现层；跨平台互通应依赖以下标识、数据格式与规则，而不依赖屏幕布局。

## 1. 配置标识

| 层 | 标识/版本 | 含义 |
|---|---|---|
| 规则 | `pcg.core.v1` | 与原 Python reducer 保持一致的十张牌、两排、最多三局规则 |
| 内容包 | `m5.web.assets.v1` / `1.0.0` | 对应素材 10–22 的十三位角色与两张战术 |
| 内容 schema | `content_schema_version:1` | 卡片、抽取池、借用池、初始编队与外观配置 |
| 网页联网 | `pcg.web.v1` | 可靠、有序 WebRTC DataChannel 中的 JSON 消息 |
| NFC 桥 | `pcg.reader.v1` | USB/串口 JSON Lines 读卡桥 |
| NDEF 身份 | `game:"pcg",v:1` | `application/vnd.pcg.identity+json` MIME 记录 |
| 本地数据库 | `format:"pcg.web.local",schema_version:1` | localStorage 中的完整数据库 |
| 导出文件 | `format:"pcg.web.backup",schema_version:1` | 带内容哈希的 JSON 备份封装 |

当前 `content/pack.json` 的规范化 SHA-256 为：

```text
e12a690d772fbd3554a1cd114c8a59df836cc4e94982c5a64c8ab7bd43eb51cc
```

计算方式是 `PCGEngine.digest(pack)`，即 PCG-C14N-1 规范化 JSON 的 UTF-8 字节 SHA-256。对象键按规则排序；数组顺序保留；禁止浮点数、重复键、非法 Unicode 和不安全整数。哈希必须计算完整数值包，包括借用列表、初始编队、抽取权重与外观数值；它不包含 `presentation.json` 或 PNG 字节。修改数值或数组顺序都会改变兼容哈希。

双方只有在 **规则 ID 与精确内容哈希均相同** 时才能开局。只增加卡片也会改变内容哈希；当前网页没有自动下载卡包、协商子集或强制更新服务。要让新版和旧版对战，应给它们安装同一个冻结包，或另行实现明确的共同内容协商。

## 2. 玩法与当前内容包

每人十张不同模板，至少六张角色；全部起手，局间不补牌。每回合部署一张或 PASS，每局最多五次出牌。单位可用排由 `allowed_rows` 决定；战术牌 `row:null`，使用后立即进入弃牌。双方停牌后结算：胜者两分、平局各一分；达到四分或完成第三局后比较积分。详细 reducer 接口见 [ENGINE.md](ENGINE.md)。

01–09 仅用于玩家身份外观，不进入战斗模板目录。卡面编号不能取代随机玩家 UUID。

| 素材 | 模板 ID | 基础战力/位置 | 效果或特性 | 抽取权重 |
|---|---|---|---|---:|
| 10 CORE | `core_vanguard` | 5 / 前排 | 护盾 | 5 |
| 11 STICKC | `stickc_operator` | 4 / 后排 | 无 | 10 |
| 12 STICKV | `stickv_observer` | 2 / 后排 | 敌方目标 −2 | 10 |
| 13 UNIT | `unit_support` | 3 / 后排 | 己方目标 +2 | 10 |
| 14 MODULE | `module_link` | 3 / 任意排 | 另一排有友军时自身 +2 | 10 |
| 15 BASE | `base_guard` | 4 / 任意排 | 护盾 | 10 |
| 16 BALA | `bala_striker` | 3 / 前排 | 敌方目标 −2 | 10 |
| 17 HAT | `hat_relay` | 3 / 前排 | 己方目标 +2 | 10 |
| 18 ATOM | `atom_scout` | 4 / 前排 | 无 | 10 |
| 19 STICKC PLUS | `stickc_plus` | 4 / 任意排 | 护盾 | 10 |
| 20 CORE2 | `core2_anchor` | 5 / 前排 | 稳定 | 5 |
| 21 CORE INK | `coreink_link` | 3 / 后排 | 另一排有友军时自身 +2 | 5 |
| 22 M5PAPER | `paper_archive` | 5 / 后排 | 稳定 | 5 |
| 公共战术 | `signal_boost` | 0 / 无位置 | 己方目标 +2 | 不进抽取池 |
| 公共战术 | `signal_jam` | 0 / 无位置 | 敌方目标 −2 | 不进抽取池 |

全部十五张是标准借用卡；拥有收藏不是组牌门槛。四种 `hero` 收藏稀有度的角色权重为 5，其余 `ordinary` 为 10，总权重 110。稀有度只描述收藏，不增加数值。

`BOOST` 只能指定先前已在场的己方单位；`DAMAGE` 指定敌方在场单位。有合法候选目标时必须指定目标。没有候选目标时角色可以部署并跳过技能，战术不能空放。稳定单位是合法目标但不会变更战力；伤害优先检查稳定，再检查一次性护盾。零战力单位留场，也可触发另一排联结。

## 3. 身份与 NFC

玩家 UUID 是随机 v4，小写。它表示同一个游戏身份，但不提供加密身份认证。图片 01–09 可以重复使用。裸 UID 以 NFC-A 4/7/10 字节的十六进制表示，保留读卡字节顺序，不做十进制转换或大小端反转。

### 玩家身份记录

```json
{"game":"pcg","v":1,"type":"player","id":"10000000-0000-4000-8000-000000000001","skin":"01","name":"玩家一"}
```

| 字段 | 类型/约束 |
|---|---|
| `game` | 固定字符串 `pcg` |
| `v` | 整数 `1` |
| `type` | 固定字符串 `player` |
| `id` | UUID v4 |
| `skin` | `01`–`09` 字符串 |
| `name` | 可选字符串，最多 24 字；不能包含控制字符 |

整体 MIME 载荷最多 384 字节。网页只写入这条身份，不把完整玩家快照、收藏或当日账本挤进 NTAG215。写入时不触碰 UID、密码或永久锁位。读卡桥的字段、握手和写后读回要求见 [READERS.md](READERS.md)。

英雄 NDEF 将 `type` 设为 `hero`，并使用 `mode:"blind"` 或 `mode:"fixed"`；后者必需 `template_id`，前者禁止该字段。它也有独立 UUID。网页支持读取此记录，但玩家界面中的英雄登记仅在本机保存，不负责写入英雄 NDEF。

### 本机绑定

数据库 `bindings` 的键是 `uid:` 后跟原始 UID，或模拟卡的 `demo:` 键。值为以下二者之一：

```json
{"type":"player","player_id":"10000000-0000-4000-8000-000000000001"}
```

```json
{"type":"hero","mode":"fixed","template_id":"paper_archive"}
```

盲盒绑定使用 `mode:"blind",template_id:null`。同一本机绑定键不能同时是玩家卡和英雄卡，登记已有绑定不会静默覆盖。只读 UID 桥不能读取卡内 UUID；换设备应导入绑定或使用能读取 NDEF 的设备。

玩家卡内有身份时，登录查找该 UUID 的本机记录；本机已有进度会直接使用，不会被卡上的昵称、外观或空白资料覆盖。卡内没有存档时间或收藏，所以本版不存在“比较卡内完整存档时间后写回”的流程。迁移依据的是下一节 JSON 快照，而不是将身份误当作快照。

## 4. localStorage 数据库与 JSON 备份

localStorage 键固定为 **`pulse.cardgame.web.v1`**。同一来源包括协议、主机与端口；路径通常不隔离 localStorage。当前选中的玩家 ID 保存在本标签页 sessionStorage 的 **`pcg.selected`**，不包含密码。

数据库结构：

```json
{"format":"pcg.web.local","schema_version":1,"revision":0,"device_id":"20000000-0000-4000-8000-000000000001","profiles":{},"bindings":{},"saved_match":null}
```

| 字段 | 用途 |
|---|---|
| `revision` | 本地数据库事务递增计数，独立于战斗 revision |
| `device_id` | 此浏览器数据库的 UUID；导入不复制源设备身份 |
| `profiles` | 以 `player_id` 为键的玩家快照对象，最多 64 位 |
| `bindings` | 上述本机卡片绑定，最多 1024 条 |
| `saved_match` | `null` 或一场本地训练/双人对局；在线房间不保存在这里 |

### 玩家快照

`profiles[player_id]` 使用以下字段：

| 字段 | 类型/含义 |
|---|---|
| `save_schema_version` | 整数 `1` |
| `snapshot_id` | 当前快照 UUID v4 |
| `parent_snapshot_id` | 直接父快照 UUID 或 `null` |
| `history_tail` | 最近最多 16 个祖先 UUID，不含当前快照且不重复 |
| `player_id` | 玩家 UUID v4，与外层对象键相同 |
| `writer_device_id` | 最后提交这份快照的浏览器设备 UUID |
| `save_seq` | 从 0 开始的玩家变更计数 |
| `modified_at_ms` | 最后变更时间，UTC 毫秒；写入时至少比旧值多 1 |
| `game_calendar_offset_min` | 当前固定为 `480` |
| `nickname` | 本机玩家名称 |
| `collection` | 已拥有角色条目；按模板 ID 排序，每模板一项 |
| `decks` | 当前只编辑第一套 `main` 编队 |
| `wallet` | `{shards:非负安全整数}` |
| `day_ledger` | `{day_id:整数,claims:[领取条目]}`，每日最多 512 条 |
| `clock` | 日期/时间高水位与来源信息 |
| `extensions.web` | 卡面、模拟标记、统计和已结算比赛 ID |

收藏条目：

```json
{"template_id":"paper_archive","obtained_at_ms":1794240000000,"draw_count":1,"mastery":0,"skin_id":"base","unlocked_skins":["base"],"nickname":""}
```

`draw_count` 是累计获得次数，重复不生成第二份可同时出战的卡。外观为 `base` 或 `ink`；`mastery` 保留为 0，不参与战斗。

编队条目：

```json
{"deck_id":"main","name":"我的编队","template_ids":["core_vanguard","stickc_operator","stickv_observer","unit_support","module_link","base_guard","atom_scout","paper_archive","signal_boost","signal_jam"]}
```

网页扩展：

```json
{"skin":"01","simulated":true,"stats":{"played":0,"won":0,"drawn":0},"completed_matches":[]}
```

`completed_matches` 最多保留 128 个近期比赛 ID，用来避免重复结算统计。这不是永久可信的赛季排行榜。

### 原子变更

领取、修改编队和导入等操作先复制数据库、校验新状态，再用一次 `localStorage.setItem` 提交完整 JSON。支持 Web Locks 的浏览器会按同名键串行化事务。发生容量或写入错误时不给出“已保存”成功提示。无法解析的旧数据保留在原键，页面提供原始存档下载，不自动清空。

同源多标签页可以看到数据库更新，但本地进行中对局只有一个 `saved_match` 槽位。不要在多个标签页同时进行不同的训练或本地双人对局。没有 Web Locks 的浏览器不提供跨标签页事务锁，应限制为一个游戏标签页。

### 备份封装与合并

导出格式：

```json
{"format":"pcg.web.backup","schema_version":1,"content_hash":"e12a690d772fbd3554a1cd114c8a59df836cc4e94982c5a64c8ab7bd43eb51cc","exported_at_ms":1794240000000,"data":{"format":"pcg.web.local","schema_version":1,"revision":0,"device_id":"20000000-0000-4000-8000-000000000001","profiles":{},"bindings":{},"saved_match":null}}
```

`data` 是完整数据库；导入限制为 2 MiB，并要求当前精确内容哈希。导入只合并玩家与绑定，不替换目标的设备 ID，也不导入进行中对局槽位。

同一 UUID 的两个玩家快照：

1. 内容摘要相同，视为重复导入。
2. 输入的祖先链能证明它在本机快照之后，且 `save_seq` 与 `modified_at_ms` 都更大，采用输入。
3. 本机祖先链能证明本机更晚，且两个计数一致支持这一关系，保留本机。
4. 分支、矛盾历史或不能证明先后，拒绝整个导入，不部分覆盖其他玩家或绑定。

这避免只按设备时钟碰巧更大就覆盖玩家收藏；祖先尾链截断后也可能无法证明先后，此时需要人工保留两份资料进行迁移处理。备份 JSON 是私有游戏数据，包含本机全部身份和可能存在的双方隐藏手牌，不能当成公开观战包。

## 5. 每日领取与确定性抽取

日期计算：

```text
day_id = floor((utc_ms + 28,800,000) / 86,400,000)
```

每日限制键为 `player_id + hero_card_id + day_id`。同一张卡可以被不同玩家各领取一次；同一玩家第二次领取同卡同日会拒绝，且不会更改快照。

有英雄 NDEF 时，英雄卡 ID 为 `issued:` 加描述 UUID。只有 UID 时使用：

```text
hero_card_id = "uid:" + SHA256_UTF8("pcg.hero.uid.v1\nnfc-a\n" + UPPERCASE_UID)
```

注意它和本机绑定键 `uid:原始UID` 是两个不同字段。跨驱动要保持一致的卡片识别策略；只读 UID 的设备无法凭空知道卡内的 issued UUID。若要混用这些驱动，应在未来迁移/别名层显式统一身份，不能把两种 ID 当成天然相同。

盲盒用 `m5.web.roles.v1` 抽取池。种子对象完整字段为：

```json
{"domain":"pcg.draw.v1","player_id":"10000000-0000-4000-8000-000000000001","hero_card_id":"issued:50000000-0000-4000-8000-000000000001","day_id":20767,"pool_id":"m5.web.roles.v1","pool_hash":"f7af69d1bf92e03beab8a6b648902495457086c1d053a243cb05d1fffa741b38"}
```

`pool_hash` 是抽取池完整对象的规范化摘要。算法把 canonical seed 的 UTF-8 字节与一个从 0 开始的 32 位大端计数器连接，计算 SHA-256，取前四字节为无符号大端整数；以 `floor(2^32/总权重)×总权重` 作拒绝采样上界，避免直接取模偏差，再按数组顺序累计权重选中模板。相同玩家、卡、游戏日和池会得到相同结果，保存失败后重刷不会随机换一个奖励。

`claim_id` 是以下对象的规范化摘要：`{domain:"pcg.claim.v1",player_id,hero_card_id,day_id}`。领取账本项包括 `hero_card_id`、`template_id`、`claim_id`、`claimed_at_ms`、`pool_id`、`pool_hash`。指定角色的 `pool_id` 为 `fixed`，其池摘要来自 `{mode:"fixed",template_id,content_hash}`。

首次获得增加收藏；重复使 `draw_count` 加一并增加 10 碎片；领取条目、收藏和钱包同时提交。新游戏日替换当天账本，收藏不清空。若设备日期早于已观察到的高水位日或账本日，则暂时拒绝领取。`clock` 记录 `high_water_utc_ms`、`high_water_day_id` 和 `last_source:"device"`。

客户端与设备时钟都不可信；这些规则提供本机一致性和朋友间的节奏约束，无法阻止修改存档、清空数据库或改写程序。

## 6. 战斗命令、状态与裁决

规则引擎与传输分离。裁判函数参数 `actor` 来自已经绑定的本地席位或连接，不放进玩家自报的动作对象。命令严格只有以下七字段：

```json
{"match_id":"30000000-0000-4000-8000-000000000001","action_id":"40000000-0000-4000-8000-000000000001","expected_revision":0,"kind":"play","card_instance_id":"p0:00","row":"front","target_instance_id":null}
```

| 字段 | 约束 |
|---|---|
| `match_id` | 当前比赛 UUID |
| `action_id` | 当前实现支持 1–64 位可打印非空格 ASCII；页面使用新 UUID |
| `expected_revision` | 客户端已知的当前比赛版本，必须与权威状态一致 |
| `kind` | `play` 或 `pass` |
| `card_instance_id` | `play` 指定己方手牌实例；PASS 为 `null` |
| `row` | 单位使用 `front/rear`；战术和 PASS 为 `null` |
| `target_instance_id` | 需要目标时指定实例；否则 `null` |

实例编号为 `p0:00`–`p0:09`、`p1:00`–`p1:09`，数字是初始牌组数组位置。模板 ID 表示卡型，实例 ID 表示这场比赛的一张具体牌。

每次接受动作将 revision 加一，包含由该动作引起的自动停牌、回合结算和整场结束。拒绝动作不改变状态。Authority 以 `[actor,action_id]` 为去重键：相同正文重试返回原 RESULT，相同 ID 不同正文拒绝 `ACTION_ID_CONFLICT`。重传必须保留原意图 ID，新动作才生成新 ID。

RESULT 结构：

```json
{"match_id":"30000000-0000-4000-8000-000000000001","action_id":"40000000-0000-4000-8000-000000000001","status":"accepted","revision":1,"error_code":null,"events":[],"snapshot_required":true}
```

上面为空事件的格式示例；实际接受部署/PASS 会带相应公开事件。拒绝时 `status:"rejected"`、`error_code` 为明确错误代码、`events:[]`。客户端以随后收到的玩家视图更新战场，不能只靠动画推断权威状态。

### 完整状态字段

| 字段 | 含义 |
|---|---|
| `ruleset_id`、`content_hash` | 精确规则与内容身份 |
| `match_id`、`revision` | 比赛身份及动作序号 |
| `round_index` | 1–3 |
| `phase` | `playing/finished` |
| `round_starter` | 当前局原始先手，0 或 1 |
| `turn_player` | 正在行动的席位；结束为 `null` |
| `players` | 两个玩家状态，顺序即席位 |
| `round_results` | 已结算各局的结果 |
| `winner` | 结束后的 0/1；平局或尚未结束为 `null` |
| `result_reason` | 结束为 `points`，否则 `null` |

玩家状态包含 `player_id`、`hand`、`board`、`discard`、`played_count`、`passed`、`match_points`。手牌和弃牌元素为 `{instance_id,template_id}`。战场元素额外包含 `row,base_power,power,shield,stable,deploy_order`；这些是当前效果结果，不能每次渲染再重新施加技能。

每局结果为 `{round_index,scores:[分数0,分数1],winner:0|1|null,awards:[分值0,分值1]}`。

玩家视图 `projectView(state,seat)` 增加 `viewer_seat` 与 `scores`；每位玩家增加 `hand_count`，并从对手对象中**移除 `hand` 字段**。不能用空数组冒充对手没有手牌，也不能向客机发送完整状态后只靠 UI 隐藏。本地交接屏同样只展示被当前玩家解锁的手牌。

本地 `saved_match` 保存 `{content_hash,mode,state,ledger,identities,logs}`，`mode` 为 `ai` 或 `hotseat`。`ledger` 是 Authority 的去重账本，须与 state 一同恢复。数据库只有一个本地对局槽位。

## 7. WebRTC 外层协议

DataChannel 标签 `pcg-v1`，可靠、有序。每条消息独立 UTF-8 JSON 文本；最大 65,536 字节，若 SCTP 上限更小则以协商值为准。缓冲上限 262,144 字节；无浮点数、最大嵌套 24 层。具体建立连接、超时和 TURN 配置见 [NETWORK.md](NETWORK.md)。

外层共有 `protocol:"pcg.web.v1"` 与 `type`；当前游戏控制器各类消息的其他字段必须严格匹配：

| 类型 | 方向 | 附加字段与含义 |
|---|---|---|
| `HELLO` | 房主→客机 | `ruleset_id,content_hash,identity` |
| `HELLO` | 客机→房主 | 上述字段加 `deck`；房主需要客机编队进行裁决 |
| `START` | 房主→客机 | `view,view_hash,identities`，初始 revision 为 0 |
| `ACTION` | 客机→房主 | `command`，即上述七字段命令；房主固定按席位 1 提交 |
| `RESULT` | 房主→客机 | `result`，动作裁决 |
| `VIEW` | 房主→客机 | `view,view_hash,events,result`；`result` 可为 `null` |
| `RESYNC` | 客机→房主 | `match_id,revision`，请求当前视图 |
| `ERROR` | 任一端 | `code,message`，本实现结束不兼容/非法会话 |
| `PING/PONG` | 任一端 | `sequence`，非负安全整数 |

`identity` 严格为 `{player_id,name,skin}`。`simulated` 不上网；`deck` 是十个模板 ID 数组。`identities` 为席位顺序的两个 identity。房主的 HELLO 不携带其十张初始牌组，否则会提前泄露全部手牌。

传输模块的类型集合保留 `READY`，但当前游戏控制器没有对应阶段，收到后会拒绝；不要把这个保留名称当作已实现功能。

示例：

```json
{"protocol":"pcg.web.v1","type":"HELLO","ruleset_id":"pcg.core.v1","content_hash":"e12a690d772fbd3554a1cd114c8a59df836cc4e94982c5a64c8ab7bd43eb51cc","identity":{"player_id":"10000000-0000-4000-8000-000000000001","name":"玩家一","skin":"01"}}
```

`view_hash` 是 `PCGEngine.digest(view)`。客机会检查哈希、匹配身份、己方牌组、实例数量、公开得分和版本；同版本不同视图视为冲突，较旧视图不覆盖新视图。摘要提供一致性检查，不是服务器签名：恶意房主能够修改状态及摘要。

手动连接码为 `PCGRTC1.` 前缀加不带 padding 的 base64url UTF-8 JSON。解码对象严格四字段：

```json
{"v":1,"session":"32位小写十六进制随机值","type":"offer","sdp":"浏览器生成的完整SDP"}
```

上例是字段说明，实际 `session` 必须匹配 32 个 `[a-f0-9]` 字符，`type` 为 `offer/answer`。回复必须对应同一 session，SDP 仅包含 application 数据通道，不允许 audio/video；本游戏不申请摄像头或麦克风。

当前 WebRTC 对局只活在打开的页面会话中。短暂网络中断时暂停出牌，连接仍有效时可以请求同步；通道关闭或页面刷新后重新交换连接码会建立新比赛，不恢复旧在线对局，也不自动判负。

## 8. 移植与旧版兼容结论

可以复用的部分是规则 reducer、规范化摘要、动作/状态模型、确定性抽取以及冻结内容包。原 Python 黄金向量保留在 `tests/reference`，用于检验同一输入的状态、事件和摘要。

本版新增或替换的部分是素材卡包、玩家卡轻量 NDEF、本地 JSON 数据库，以及网页 WebRTC 外层。它没有实现旧版 PCSV 二进制完整卡存档编码，也没有把旧射频/ESP-NOW 字节流直接映射成浏览器连接。旧包 `m5.core.v1` 与新包 `m5.web.assets.v1` 不能仅凭模板名称有交集就混打。

ESP32、Android、iOS 原生客户端可以围绕相同 reducer 编写各自 UI，并选择相同 JSON 外层、WebRTC 或显式协议网关；采用其他链路时也须保持动作授权、幂等、版本检查和私有手牌投影。浏览器 WebRTC 本身不等同于已经支持 ESP-NOW、RF 或所有硬件直连。

后续升级应先定义存档迁移与版本协商，再更改现有数据。未实现的功能包括云账号、可信日历、后台房间、自动更新、竞技防作弊、旧版二进制存档导入以及断线房间恢复。页面中的演示入口、动画和布局不改变这些协议约束。
