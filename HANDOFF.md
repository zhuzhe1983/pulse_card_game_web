# 回合战交接

这份说明按仓库里的代码和已发布页面核对。规则数字以 `content/clash/SOURCE.json` 指向的 prompt 提交和本仓库引擎为准。下面提到的矛盾，是文件里现在就写着的句子，不是新的设计。

## 1. 项目和线上地址

仓库是 [pulse_card_game_web](https://github.com/zhuzhe1983/pulse_card_game_web)。站点同时放着两套东西：

- 旧的 `pcg.core.v1` 触卡对决：十张牌、三局点数、读卡和 WebRTC。入口是大厅和 `dist/index.html`。
- 现在主要在做的 `pcg.clash.v0` 回合战：基地、供电、手牌、升星、第二排配件。入口是 `dist/clash/`。

线上地址：

- 大厅：<https://zhuzhe1983.github.io/pulse_card_game_web/>
- 牌桌：<https://zhuzhe1983.github.io/pulse_card_game_web/dist/clash/>
- 图鉴：<https://zhuzhe1983.github.io/pulse_card_game_web/wiki/>
- 费用曲线：<https://zhuzhe1983.github.io/pulse_card_game_web/wiki/curve.html>

规则仓库是 [pulse_card_game_prompt](https://github.com/zhuzhe1983/pulse_card_game_prompt)。规则先落在 prompt，再把对应提交同步进 web。当前绑定写在 `content/clash/SOURCE.json`：`prompt_commit` 是 `8a9acd2e221708835dab446d019a47dcd90896c6`，引擎 `src/clash/engine.js` 的 `SOURCE_COMMIT` 与它相同。prompt 的 PR 3 没有合并进 prompt 的 main。同步时只改 web 仓库里的规则副本、引擎和页面，不改 prompt 仓库，也不改本仓库的 `firmware/`。

交付以 Pages 上的预览地址为准。合进 `main` 之后还要把玩家能打开的文件推到 `gh-pages`。只给 PR 链接不算发布完成。

## 2. 目录、构建、测试、发布

| 路径 | 作用 |
|---|---|
| `index.html`、`shared/pulse.css` | 大厅。图鉴和牌桌都沿用这里的 PULSE 颜色和字体 |
| `src/clash/engine.js` | 回合战规则、模拟战牌组、公开信息 AI |
| `src/clash/app.js` | 牌桌界面、拖拽、动画、模式入口 |
| `src/clash/nfc.js` | Web NFC。构建时和 `app.js` 拼进同一段脚本 |
| `src/clash/style.css`、`src/clash/template.html` | 牌桌样式和页面壳 |
| `src/clash/scene/` | 拟物背景、卡框、卡背、灯、核心环。不是产品原图 |
| `content/clash/` | 从 prompt 抄来的牌表、教学局、服务牌和规则文档 |
| `wiki/` | 96 张图鉴。产品图在 `wiki/assets/`，设计数字在 `wiki/data/` |
| `dist/clash/index.html` | `tools/build_clash.py` 打出来的单页。线上牌桌就是这个文件 |
| `dist/index.html` | 旧点数对局。`tools/build.py` 生成，回合战构建不会改它 |
| `src/engine.js`、`src/app.js` | 旧 `pcg.core.v1`。不要把回合战规则写进这里 |
| `firmware/` | M5Dial USB NFC 桥。回合战任务不要改 |

本地从仓库根目录起服务，避开 8000 和 8001：

```bash
python3 -m http.server 8002 --bind 127.0.0.1
```

大厅是 <http://127.0.0.1:8002/>，牌桌是 <http://127.0.0.1:8002/dist/clash/>，图鉴是 <http://127.0.0.1:8002/wiki/>。只看图鉴时，`wiki/README.md` 用 8003。

改了 `src/clash/` 或 `content/clash/` 之后要重新打包牌桌：

```bash
python3 tools/build_clash.py
```

图鉴设计包：

```bash
python3 wiki/tools/build_design_pack.py \
  --roster wiki/data/clash_roster_96.json \
  --cards wiki/data/cards.json \
  --playtest content/clash/clash_playtest.json \
  --out wiki/data/design-pack.json
```

`wiki/data/clash_roster_96.json` 要和 `content/clash/clash_roster_96.json` 保持同一份牌表。旧点数页只有在改了 `src/engine.js`、`src/app.js` 或 `content/pack.json` 时才运行 `python3 tools/build.py`。

节点测试：

```bash
node tools/check.cjs
```

它依次跑 `tests/engine.test.cjs`、`store`、`readers`、`rtc`、`network-game`、`clash`、`clash_roster`、`clash_synergy`、`clash_ai`、`clash_sim`、`clash_mount`、`clash_nfc`、`wiki`。浏览器测试不在这条命令里，要另外跑，并且本机要有 Chrome：

```bash
node tests/clash_browser.cjs
node tests/clash_pointer_browser.cjs
```

前者占用 8002，后者占用 8018。它们用设备尺寸仿真，不是真机触摸记录。

发布没有单独脚本。`gh-pages` 分支的根目录就是站点。把本次改动的已构建文件拷进该分支再推送，至少包括玩家会打开的这些路径：`index.html`、`dist/clash/index.html`、`dist/clash/scene/` 里新增的图、`shared/pulse.css`、`wiki/` 下改过的页面和 `wiki/data/`。推送后用 `Cache-Control: no-cache` 打开线上地址，确认新句子已经出现，再把这个地址交给用户。

## 3. 牌桌怎么接在一起

`src/clash/app.js` 末尾的 `startScenario()` 决定开局：

- 地址没写参数：`begin('sim')`。玩家对 AI，两副各 30 张随机牌，界面显示种子。
- `?scenario=versus` 或 `?mode=versus`：固定教学，人机，用 `content/clash/clash_playtest.json` 的写死牌库。
- `?scenario=lesson`、`?mode=lesson` 或 `?mode=hotseat`：本地双人，同一套教学牌库。座位 0 在下方，座位 1 在上方，换人时遮罩写「请交给对方」。
- `scenario` 还可以是摆阵和组牌入口：`support-present`、`support-deploy`、`support-again`、`promote-stamp`、`grow`、`crowd`、`synergy`、`builder`。

页面上的三个模式按钮仍然可用：固定教学、模拟战、本地双人。AI 行动时横幅是「对方正在行动」。`planAi()` 只看 `aiView()` 放进视图的公开信息，先下付得起的主控，再考虑夺舍、伤害、供电、治疗和装得上的配件，然后攻击。

规则实现在 `src/clash/engine.js`。教学牌库、基地 20、供电上限 10、教学手牌上限 8 在 `content/clash/clash_playtest.json`，`balance` 是 `playtest_unverified`。96 张牌在 `content/clash/clash_roster_96.json`。服务牌在 `content/clash/clash_services.json`。

模拟战牌组由 `assembleSim()` 组出来。同名上限在 `copyLimit()`：`growth_kind === 'chain'` 且已是链顶（有星级、没有 `next_template_id`）最多 1 张，其余最多 2 张。配方是 5 张费用不超过 2 的主控、5 张 3 到 5 费主控、3 张不少于 6 费的主控，主控先补到 21 张，再各放 1 张积木开工、记一笔、说人话，再放 4 张牌组里已经有合法宿主的配件，最后用主控补到 30。当前牌池补得满时就是 23 张主控、4 张配件、3 张服务。起手先手 3 张、后手 4 张，后手另得 0 费备用电池，这张电池不占 30 张。模拟战手牌上限 10。`simPool()` 把三张服务牌加进图鉴候选；夺舍和树莓台不加进随机池。没有图鉴图的基线配件也不进随机池。

场上主控在第一排。配件在宿主旁的第二排，用线连着，牌面只显示 `+N`。对方的第二排排在他们自己主控的外侧。装配在 `attachmentRejection()`：Hat 只上 Stick，Module 只上 Core，Base 和 Unit 只上 Atom，Atom 接 Chain 要先有接上串（`atom_bus === 'to_chain'`）。装不上时引擎抛对应代码，页面画红圈和 ×，并写出文档里的那句原因。不扣电。

打击在 `profile()`。基础攻击加上已就绪配件和同类相邻，再加左邻同系、右邻同系、这台单位身上的来自上位的爱、以及说人话的 2。没有百分比，也没有最左主控加攻。攻击栏小于等于 0 时伤害是 0。主控数字高于印刷值用绿色，低于印刷值用红色。悬停和长按从基础值逐条写来源，同系邻居写成「左邻同系 +1/+1」「右邻同系 +1/+1」。Chain 打在宿主自己的第二排上；刚打出的配件本回合不加；打掉中间一节后，后面的加成断开。

来自上位的爱在 `upperLink()`，费用 1，只加在被连上的那一台。云服务是积木开工（抽 1）、记一笔（取回自己墓地顶）、说人话（下一次打击 +2，用掉就消失）。Burner 夺舍费用 7，把敌方主控连同配件移到己方最右，本回合不能攻击。

拖拽在 `app.js` 的 pointer 事件里。位移超过 10 像素才算拖。合法目标保持绿标；非法目标是红圈加 × 和短原因，松手在非法处或空白处取消，不扣电。结束回合前，如果还有能攻击的己方单位，会问「还有 N 个单位没攻击，确定结束？」，可以选择结束、继续，或本局不再提醒。AI 自己不弹这句。战斗动画用 `combat-lift` 等类把攻击、受击和飘字拉开；动画期间 `body` 的 `data-animating` 会挡住输入。

平放卡面是 `.slots` 的 `perspective` 加上 `.unit-col .minion` 的 `rotateX(46deg)`。角色图、卡框和数字都在同一个 `.minion` 里。手机 390 宽时标签和手牌的位置在 `style.css` 的窄屏规则里，标签是 `pointer-events: none`。

NFC 只在 Android Chrome、HTTPS、并且存在 `NDEFReader` 时启用「开始刷卡」。MIME 是 `application/vnd.pulse.card+json`。别的浏览器显示「这台浏览器不能刷卡，仍可用拖拽或点选出牌」。

每个页面左下角有固定句「这就是傻子 Grok Bot 做的网站」。大厅和图鉴用 `shared/pulse.css` 的 `.pulse-credit`。牌桌模板写在 `src/clash/template.html`，样式在 `src/clash/style.css`，不接点击。

## 4. 素材放哪里

产品原图在 `wiki/assets/`，按 rid 分成卡面和 char。`tools/build_clash.py` 只把图鉴路径写进 `PCGClashArt`，指向 `../../wiki/...`。不要用生成图覆盖 `wiki/assets/` 里的实体卡原图。

拟物件在 `src/clash/scene/`，构建时整目录复制到 `dist/clash/scene/`：

- 背景：`scene/pulse-arena-bg-16x9.webp`
- 手牌框、场上框、核心环、结束回合按钮、费用灯、攻击灯、耐久灯：`scene/ui/`
- 卡背：`scene/cardback/pulse-cardback-192x256.webp`
- 三张服务牌插画：`scene/cards/art-uiflow-service.jpg`、`art-ezdata-service.jpg`、`art-aiflow-service.jpg`

旧点数对局的 22 张卡图和 22 张角色图在 `asset/card/`、`asset/char/`。那是另一套素材，不要和 96 张图鉴混用。

## 5. 已经定下来的约束

这些句子在规则副本或代码里，后续不要自行改掉：

- Grove 是现实接口，不进入规则。`content/clash/01_GAMEPLAY.md` 和 `content/clash/19_SYNERGY_AND_SERVICES.md` 都写了「Grove 不进入规则」。
- 站在最左边不加攻击。`profile()` 没有最左加成。教学局结果是小印打 2、点阵哨反击 1，两台都留在场上，基地 19 对 20。
- 牌桌的手牌、核心、按钮和拖拽区域不能互相挡住。窄屏手牌用自己的横向滚动，标签不接收指针。
- 图鉴和牌桌沿用大厅的 PULSE 样式：`shared/pulse.css` 的纸色、墨色和薄荷色。图鉴页是 `wiki/wiki.css`，不是另一套皮肤。
- 教学组牌仍是 8 到 12 张。模拟战的 30 张只用于模拟战。
- 不发明 SKU，不把游戏角色反写成硬件结论。`clash_playtest.json` 的 `classification` 把游戏角色、硬件主控和美术 type 分开。
- 不改 `firmware/`，不把 prompt 仓库的 PR 合并进 prompt 的 main。

## 6. 已知问题和待办

数值仍是待试玩。`clash_playtest.json` 的 `balance` 是 `playtest_unverified`，图鉴设计状态是 `playtest_draft`。

`content/clash/18_ROSTER_AND_GROWTH.md` 第 0 节正文仍写轨上表一星攻击 2、耐久 2；同文件后面的表和 `clash_roster_96.json` 里 H036 是费用 2、攻击 3、耐久 2，H036a 是费用 3、攻击 4、耐久 2。引擎用的是 JSON。

`content/clash/SOURCE.json` 记录：prompt `8a9acd2` 的交接「局面」原文曾经写回百分比公式。本仓库的 `content/clash/WEB_IMPLEMENTATION_HANDOFF.md` 已改成整数。`docs/20` 开头仍有一句「Chain 百分比」，同文件后面的悬停规则已经是整数。不要把百分比加回 `profile()`。

`README.md` 开头和 `src/clash/PREVIEW_README.md` 还写着旧的 prompt 提交 `7ba58fb`。以 `SOURCE.json` 为准。`wiki/README.md` 仍写「引擎正在另行接入」，牌桌其实已经在用这 96 张里的可结算牌。

没有产品图的基线牌（链节、千里眼、护罩、补给包、干扰、回充、借一格电）只留在教学和扩展组牌，不进随机池。服务牌用的是生成插画，不是产品照片。图鉴美术状态仍是未验收。

浏览器测试用的是 Chrome 的窗口尺寸仿真。代码里没有真机触摸通过的记录。

## 7. 最近发布

`main` 上最近几次和对应的 `gh-pages`：

| main | gh-pages | 内容 |
|---|---|---|
| `1db147924321db531b8ac48b54057c67f7b56a42` | `250a31739857f8a402ded493eaeaab5f1ebac168` | 打开牌桌默认进入随机模拟战 |
| `6f447726d8ee26bbb28161484fb5af5a7d993223` | `54d73b204a95f8c891cbf337ba69d691b96b1056` | 全站左下角固定标签 |
| `41bad6bdb48efb29a7b1a6694dffecf9b69200a3` | `10fa8ffcb7b8cd5fba574ba61e8358c247894e1d` | 教学文案和悬停明细去掉最左加成 |
| `2cd2779db50e40ae590594e0bd7934ac4a910fe5` | `56f0f65a11f3b1fcffbe3e351a8eabc01172f013` | 第二排配件、整数加成、平放透视 |
| `725655fe5279a12ede78548dee9e0e4f69cce5f1` | `9e31b8bbf0ecbf8c9b467b78036d2f08fabbd620` | 按芯片档同步攻耐 |
| `14c67c4dac0ae24fc6d1bbcc241a0866bcaae9c7` | `70bf297f9c980a99e12deffc0d1b25c0320dc336` | 打击数字、战斗动画、结束回合提醒 |
