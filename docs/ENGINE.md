# JavaScript 规则核心

`src/engine.js` 是仓库 Python 参考实现 `reference/battle.py` 的 JavaScript 移植，保持 `pcg.core.v1` 规则。它可以作为普通 `<script>` 引入，也可以在 Node 中 `require()`；没有运行时依赖。

## API

浏览器中的入口是 `globalThis.PCGEngine`。

| 方法 | 返回值与用途 |
| --- | --- |
| `canonical(value)` | 返回 PCG-C14N-1 JSON 字符串。需要字节时使用 `new TextEncoder().encode(...)`。 |
| `digest(value)` | 对 canonical JSON 的 UTF-8 字节执行 SHA-256，返回小写十六进制字符串。 |
| `sha256(stringOrBytes)` | 对 UTF-8 文本或字节数组执行同步 SHA-256。 |
| `parseJSON(input, maxBytes=65536)` | 严格、有限长度的 JSON 解析；拒绝重复字段、浮点数、非法 UTF-8、非法 Unicode、超范围整数。 |
| `parseCanonical(input, maxBytes=65536)` | 在严格解析之上要求输入已经是 canonical 格式。 |
| `heroIdFromUID(technology, uidHex)` | 使用原协议构造 `uid:` 英雄卡标识；保留 UID 字节顺序。 |
| `validatePack(pack)` | 校验已支持的规则、效果、特性，返回以模板 ID 为键的目录。 |
| `newMatch(pack, matchId, playerIds, decks, seedUint32)` | 返回完整权威状态。两个不同玩家、每人十张不同模板、至少六张角色。 |
| `applyAction(pack, state, actor, command)` | 返回 `{state, events}`；不修改传入状态；非法操作抛出带 `code` 的 `PCGError`。 |
| `projectView(state, viewer)` | 返回某个座位的状态视图；其他座位的手牌只保留 `hand_count`。传 `null` 得到旁观视图。 |
| `legalCommands(pack, stateOrOwnView, actor, actionId)` | 返回该玩家当前所有合法动作，包含 PASS。动作必须使用同一意图 ID；玩家选择新意图时生成新 ID。 |
| `boardScores(stateOrView)` | 返回 `[座位0分数, 座位1分数]`。 |
| `new Authority(pack, state, results={})` | 带幂等处理的权威核心。最新状态在 `.state`。 |
| `authority.submit(actor, command)` | 返回协议 RESULT；相同动作 ID 和相同内容重复提交返回先前结果；同 ID 不同内容抛出 `ACTION_ID_CONFLICT`。 |
| `authority.exportLedger()` | 返回可 JSON 序列化的动作去重账本；重启时连同 state 传入 Authority 构造函数。 |
| `chooseAction(pack, stateOrOwnView, actor, actionId?)` | 电脑对手选择合法动作；只读取自己的手牌和公开信息；考虑保留手牌、低成本拿下已 PASS 的对手、弃局。 |
| `newActionId()` | UI/电脑对手生成新动作 ID。该辅助函数使用浏览器随机 UUID，降级时使用时间与递增计数；不属于确定性 reducer。 |

状态字段、命令字段和 RESULT 字段使用原协议的 snake_case。API 方法名使用 camelCase。

## 权威与隐私边界

先由 transport 确认消息来自哪个座位，再将这个座位作为 `actor` 传入 `submit()`。不要相信对端消息里自称的 actor。完整状态只属于裁判端；发送给玩家的快照必须经过 `projectView()`。

`Authority` 不负责浏览器存储。应用必须把 `.state` 与 `.exportLedger()` 一起持久化，或者明确将该对局限定为当前会话。

这套协议支持朋友之间信任房主的对局，不能防止房主通过开发者工具查看完整状态或改写应用。完整状态不得直接当作客机快照发送。

## 验证

运行：

```sh
node tests/engine.test.cjs
```

测试包括原 Python 参考对局的全部 20 步。每一步比较状态、公开事件、SHA-256 状态摘要和两个玩家的私有视图摘要；此外覆盖跨行联动、护盾、稳定、零战力留场、不可撤销的 PASS、每局五次出牌上限、平局计分、手牌耗尽、非法操作不修改状态、重传幂等和电脑对手不读取对方手牌。

原参考卡包只用作兼容性测试。网页的素材卡包有独立 content hash。相同规则不代表不同卡包可以直接对战；联网握手必须同时检查 ruleset 与 content hash。

测试参考数据位于 `tests/reference/` 时优先使用该目录；在开发工作区里也可以使用相邻的 `pulse_source/` 原仓库。
