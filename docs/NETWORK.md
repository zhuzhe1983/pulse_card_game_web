# WebRTC 对战与协议边界

本客户端用浏览器原生 `RTCPeerConnection` 和可靠、有序的 `RTCDataChannel` 传输对战消息。静态页面不需要游戏服务器或信令服务器，双方手动交换连接码。页面不会申请摄像头或麦克风权限。

## 如何连接

1. 双方各自在页面登录自己的玩家卡，选好牌组。
2. 房主创建邀请，将 `PCGRTC1.` 开头的完整邀请连接码发送给对方。
3. 对方粘贴邀请并生成回复，将完整回复连接码发送回房主。
4. 房主粘贴回复。双方保持页面打开，等待游戏通道连接。

连接码包含这次连接的 SDP、候选网络地址和临时会话标识。只发给本次对战的朋友。它不是可以反复使用的房间号。复制过程中可以有换行，但不能截断内容。回复与邀请必须属于同一次连接；旧房间的回复会被拒绝。

## 网络条件

默认使用 `stun:stun.l.google.com:19302` 查询可用的公网地址。STUN 不保存本游戏的玩家存档，也不承担对战转发；使用此设置会向该服务发送网络探测。将 `iceServers` 配置为 `[]` 可以只尝试本地候选地址，例如同一局域网里的设备。

纯静态页面可以建立很多跨网络连接，但不能保证穿透所有 NAT、防火墙和运营商网络。某些组合必须使用 TURN 中继。客户端接受标准 `iceServers` 配置，例如：

```js
new PCGRtc.PeerSession({
  iceServers: [
    { urls: 'stun:your-stun.example:3478' },
    {
      urls: 'turns:your-turn.example:5349',
      username: 'your-temporary-username',
      credential: 'your-temporary-password'
    }
  ],
  onMessage: packet => handleGameMessage(packet),
  onState: status => showStatus(status.message)
});
```

示例地址是占位符，需要换成真实服务。不要把长期 TURN 密钥写进公开 HTML。没有 TURN 时，失败应显示清楚原因并允许重建连接，不应伪装成已联网。首次网络地址收集默认最多等待 20 秒；连接建立超时会提示用户，但保留连接等待迟到的成功事件。

如果 ICE 已报告收集完成，但 SDP 中没有任何候选地址，页面返回 `NO_ICE_CANDIDATES`，不会生成不能提供地址信息的连接码。这可能由浏览器运行环境、网络限制或 ICE 服务不可用造成；可尝试普通浏览器、同一网络或自己的 TURN 配置，均不能保证一定成功。不要仅根据 ICE 的 `complete` 状态就判断能够连接。

## 版本与传输格式

这里的浏览器传输配置称为 `pcg.web.v1`。它在连接之上承载 `pcg.core.v1` 的游戏动作与玩家视图，**不是旧版二进制包的逐字节替代**。其他硬件客户端若要直接使用此网页的 WebRTC 连接，需要实现相同传输配置，或通过网关转换。

- DataChannel 标签：`pcg-v1`。
- `ordered: true`；不设置重传次数或寿命限制。
- 每条 DataChannel 消息是一条 UTF-8 JSON 文本，不拼接 JSON，不接受二进制包。
- 单条最大 65,536 字节；如果 SCTP 协商出的上限更小，使用更小值。
- 发送缓冲区上限 262,144 字节。超过时返回 `CHANNEL_BUSY`，不会无限堆积动作。
- JSON 只允许对象、数组、字符串、安全整数、布尔值及 `null`；最多嵌套 24 层。消息中的游戏字段还必须由上层逐项校验。

所有消息都有以下外层字段，其他字段由相应消息类型定义：

```json
{"protocol":"pcg.web.v1","type":"PING","sequence":1}
```

允许的类型为 `HELLO`、`READY`、`START`、`VIEW`、`ACTION`、`RESULT`、`RESYNC`、`ERROR`、`PING`、`PONG`。传输模块只验证外层与有界 JSON；游戏控制器负责验证 `ruleset_id`、精确 `content_hash`、匹配 ID、动作版本、玩家席位和字段集合。两个版本不匹配时必须停止开局，不自动忽略未知卡片或效果。

`ACTION` 的动作对象应保持核心引擎的七字段格式；提交者的席位由主机根据连接绑定决定，不能相信来包自报的 `actor`。主机发送给客机的 `VIEW` 只包含该客机的手牌及对手手牌数量。只有权威状态留在主机内存中。`action_id` 和 `expected_revision` 用于幂等与过期动作拒绝；网络重试必须沿用同一动作 ID 和正文。

## 主机信任与断线

这是朋友间对战的主机裁决模式。主机浏览器持有完整对局状态，可以检查双方隐藏手牌；它不提供竞技服务器级防作弊保证。客机应只拿到自身的投影视图。玩家卡 UID 或 NDEF 身份也不构成加密身份验证。

网络短暂中断时保留页面，并显示断线状态。DataChannel 关闭后，需要创建新的 `PeerSession` 并重新交换连接码。单靠建立新连接不会自动恢复对局；上层必须持有匹配状态并重新校验双方身份、版本和匹配 ID，随后发送该玩家的最新投影视图。刷新页面、关闭浏览器或重新建房是否恢复，由上层存档流程决定；本传输模块不声称提供后台房间、自动重连或跨浏览器迁移。

## JavaScript API

`src/rtc.js` 是无依赖 IIFE，导出 `globalThis.PCGRtc`：

```js
const peer = new PCGRtc.PeerSession({
  onOpen() {},
  onMessage(packet) {},
  onState({ state, message, role }) {},
  onError(error) {},
  iceServers: [],
  gatherTimeoutMs: 20000,
  connectTimeoutMs: 60000
});
const invite = await peer.createOffer(); // 房主
// 另一端：const reply = await other.acceptOffer(invite);
// 房主：await peer.acceptAnswer(reply);
peer.send(PCGRtc.makeEnvelope('PING', { sequence: 1 }));
peer.close();
```

`isOpen`、`role`、`sessionId` 是只读 getter。`makeEnvelope(type, payload)` 添加协议版本；`validateEnvelope(packet)` 校验外层。信令编解码用 `encodeSignal`、`decodeSignal`。同步错误和异步操作错误会同时传给 `onError` 并抛出，调用方需要 `try/catch`；收到非法网络 JSON 时会报告错误并关闭通道。创建失败后，用新的 `PeerSession` 重试。

`onState` 的状态包括 `creating`、`gathering`、`offer-ready`、`answer-ready`、`connecting`、`connected`、`disconnected`、`failed`、`timeout`、`closed`。显示成功应以 `onOpen` / `isOpen` 为准，收到回复连接码本身不代表联网成功。

## 游戏会话控制器

`src/network-game.js` 实现 `PCGNet.GameSession`，封装上面的传输 API、握手、主机裁决、客机视图验证及当前连接内的重新同步。它在页面加载 `engine.js` 和 `rtc.js` 后使用：

```js
const game = new PCGNet.GameSession({
  pack: PCGContent.pack,
  local: {
    player_id: '11111111-1111-4111-8111-111111111111',
    name: '玩家一', skin: '01',
    deck: PCGContent.pack.starter_deck
  },
  onUpdate({ view, identities, events, result, seat }) {
    // view 只包含本方手牌；seat 为房主 0 或客机 1。
  },
  onState(status) {}, onError(error) {}, iceServers: []
});
```

提供相同的 `createOffer()`、`acceptOffer(code)`、`acceptAnswer(code)`、`close()`、`isOpen`、`role`。新增 `sendAction(command)`、`requestResync()` 和只读约定的 `view`、`identities`、`seat`、`pendingActionId` 属性。客机发送动作后返回 `{status:"pending",action_id}`；最终是否接受以 `onUpdate` 中的 `result` 为准。房主本地动作直接返回参考引擎的结果对象。

控制器的线上字段如下。每条消息仍包含 `protocol` 和 `type`，表中只列额外字段；不接受多余字段。

| 类型 | 方向 | 额外字段 |
|---|---|---|
| `HELLO` | 房主 → 客机 | `ruleset_id`, `content_hash`, `identity` |
| `HELLO` | 客机 → 房主 | 上述字段，加 `deck` |
| `START` | 房主 → 客机 | `view`, `view_hash`, `identities` |
| `ACTION` | 客机 → 房主 | `command` |
| `RESULT` | 房主 → 客机 | `result` |
| `VIEW` | 房主 → 客机 | `view`, `view_hash`, `events`, `result`（可为 `null`） |
| `RESYNC` | 客机 → 房主 | `match_id`, `revision` |
| `ERROR` | 任一方 | `code`, `message` |
| `PING` / `PONG` | 任一方 | 非负安全整数 `sequence` |

`identity` 只含 `player_id`（UUID v4）、`name`（1–24 个 Unicode 码点，不含控制字符或孤立代理项）和 `skin`（字符串 `01`–`09`）。两方身份必须不同。`deck` 是按实例编号排列的 10 个不同模板 ID，至少 6 张单位。房主不向客机发送自己的牌组，因为本游戏全部 10 张牌在开局时都进入手牌；把房主牌组放进握手会泄露整手牌。

`view_hash` 是对 `view` 按 `PCG-C14N-1` 规范序列化后计算的 SHA-256 小写十六进制值。`identities` 固定按房主、客机排序，且必须与握手一致。客机校验视图的规则、卡包、匹配、递增版本、席位、已知卡片、实例所属席位、己方开局牌组、手牌数量、牌总数、公开分数、回合积分和终局状态。含对手 `hand` 字段的视图即使摘要正确也会被拒绝。同版本不同正文会被拒绝，较旧视图不会覆盖新状态。

房主从连接角色绑定客机席位 1，不接受外传 `actor`。动作只含核心七字段，`action_id` 为 1–64 个可打印非空格 ASCII 字符，`expected_revision` 为非负整数。已处理动作以相同 ID 和相同正文重试只重发确认与最新视图；改变正文复用 ID 返回 `ACTION_ID_CONFLICT`。相同状态的重发和重新同步不会再次播放旧事件。

`RESULT.result` 保持参考引擎结果格式：`match_id`、`action_id`、`status`、`revision`、`error_code`、`events`、`snapshot_required`。正常不合法动作，例如不轮到自己、版本过期或目标无效，返回拒绝结果并继续连接。握手、角色、版本或消息结构错误会报告错误并关闭连接。`READY` 只由通用传输层识别，本游戏控制器不使用它，也不接受它作为自动准备指令。

`requestResync()` 只在现有已连接对局中恢复最新玩家视图。控制器把权威状态留在当前房主页面的内存中，不写浏览器持久存储，也不实现刷新后的会话恢复。

## 检查范围与资料

`tests/rtc.test.cjs` 使用可控的浏览器 API 模型检查信令状态、错误房间、ICE 等待/取消/超时、可靠通道约束、消息长度、发送队列、错误数据及连接状态回调。这些测试不代表已测试任意真实公网 NAT 或 TURN 服务；真实浏览器双端连接由整页验收检查。

`tests/network-game.test.cjs` 另外验证两端控制器的完整握手、完整对局与状态一致性、相同动作幂等、过期动作拒绝、精确版本拒绝、隐藏手牌隔离、身份和视图校验、恶意角色伪造拒绝，以及当前连接内的重新同步。

本次托管浏览器双标签页检查中，双方虽然完成 SDP 和 ICE 收集，但实际 SDP 都没有候选地址，未建立真实 DataChannel；不能据此声称真实端到端联网已通过。该观察促成上面的零候选地址错误处理。传输单元测试中的候选地址使用保留的 TEST-NET 地址 `192.0.2.1`，只用于 API 模型，不代表真实可达网络。普通浏览器与实际网络上的联机结果仍需用户本地验证。

原始 API 文档：

- [W3C WebRTC specification](https://www.w3.org/TR/webrtc/)
- [MDN: ICE gathering state](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceGatheringState)
- [MDN: WebRTC data channels](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)
- [MDN: RTCDataChannel.send()](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/send)
- [MDN: bufferedAmount](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount)
