# 当前主线交接 · tactical-v1

只维护单局回合战，用户已授权本轮玩法、数值和 UI 改版。旧版在 `archive/pre-tactical-20261113`，不要恢复 PASS、三小局或旧收藏/联网入口。按 2026-11-14 用户补充要求，现已单独恢复轻量玩家身份卡创建/识别，不包含旧收藏契约。规格读 `docs/TACTICAL_V1.md`，诊断数据和待测风险读 `docs/REVIEW_20261113.md`。

## 实现位置

- `content/clash/clash_balance.json`：当前规则和主控数值覆盖层。
- `content/clash/clash_tactics.json`：12 张技能；`clash_roster_96.json` 保留设备映射。
- `src/clash/engine.js`：唯一网页裁判、构筑与公开信息 AI。prompt 的 `reference/clash.js` 是其同步副本，两者必须字节一致。
- `shared/i18n.js` / `shared/locales/en.json`：中英文显示层与词库；构建生成 en.js，详见 `docs/I18N.md`。不要翻译引擎数据或卡牌标识符。
- `src/clash/app.js`：操作、模式、AI 时序和测试状态；`nfc.js`：当前 NFC 会话、写后校验与串口原始 NDEF 分类。
- `src/clash/raster.css`：电子工作台位图皮肤；`tactical.css` 承载布局，`style.css` 承载结构、目标标记和动画。
- `src/clash/scene/raster-v1/`：ImageGen 生成的 6 个界面组件和 12 张技能插画；manifest 保留提示词，source/ 保留 PNG 原稿。构建仅复制运行资产，不复制 source/。
- `wiki/data/design-pack.json`：基线牌表加 balance 覆盖的生成结果；产品原图不改。
- `dist/clash/`：生成页面；需要根目录下的 `wiki/`、`shared/` 配套资源。
- `src/readers.js`、`firmware/`、`dist/flash.html`：硬件资产；`2026.11.14-feedback.2` 固件现支持空白 NTAG215 玩家身份写入并自动读回。网页按 hello.write_mode=blank-player-v1 启用按钮，旧固件仅能读。固件已编译、主机与模拟硬件浏览器测试通过；用户本轮不便接设备，实机烧录/读写待验收。

`content/clash/` 内原教学数据和规则副本属于 baseline 回归，不覆盖本版数值。`SOURCE.json` 区分历史来源和当前 profile。固定教学的当前短牌库在 app.js，不等于旧 fixture 的 20 生命教学局。

## 开发与验证

```bash
python3 tools/build_clash.py
node tools/check.cjs
python3 tools/serve.py --port 8026
# 另一个终端；本机需可加载 playwright
PULSE_TEST_URL=http://127.0.0.1:8026 node tests/tactical.browser.cjs
PULSE_TEST_URL=http://127.0.0.1:8026 node tests/i18n.browser.cjs
PULSE_TEST_URL=http://127.0.0.1:8026 node tests/nfc.browser.cjs
PULSE_TEST_URL=http://127.0.0.1:8026 node tests/flasher.browser.cjs
node tools/audit_clash.cjs > docs/review/clash-tactical-v1.json
```

未安装本地 Playwright 时可通过 `PLAYWRIGHT_MODULE_PATH` 指定模块路径。浏览器测试自行关闭 browser；CLI 自动化用 Codex Playwright wrapper，并关闭自己创建的 session。截图写 `output/playwright/`，不提交运行输出。

改配置或引擎后同步 prompt 的 content/、reference/clash.js 与行为测试，再运行其 `python3 -m unittest discover -s tests`。不要把未跟踪的美术目录批量加入提交。

`?scenario=tactics` 是技能演练；`versus` 固定人机；`lesson` 本地双人；无参数为 `sim`。组牌是短牌库练习。NFC 写卡需明确点击 UI，规则测试不代替真机验证。

## 发布边界

构建不自动发布 GitHub Pages。发布需要更新 gh-pages 的完整站点文件并验证线上版本；不能只复制 dist/clash 而遗漏 wiki 数据。此次本地改版的交付状态以最终汇报为准，不把已构建称为已上线。

2026-11-14 feedback.2：用户实测 NTAG215 无响应，定位生产驱动 Transceive=0x0E/CRC low=0x23 两个错误并改为官方 0x0C/0x22。新增 rc522_bus 隔离硬件传输，以虚拟寄存器执行生产驱动做回归；启动硬件 CRC 自检。image_gen 生成 round workbench 底图，中文字形及状态由 ui_render.c 实时绘制，声音由 sound_pattern.c 定义并在独立任务播放。网页协商 status_events 后接收进度/诊断/静音状态。见 docs/M5DIAL_FEEDBACK.md；实体设备升级需手动进 ROM 下载模式，不能把构建或模拟测试写成实机验收。
