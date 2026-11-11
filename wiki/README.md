# PULSE 卡牌图鉴

独立静态页面。96 张待验收美术、官方硬件资料，以及 `pcg.clash.v0` 的 96 条玩法设计都在这里。设计状态是 **playtest_draft / 待试玩**：中文名、阵营、费用、技能和星级不是官方规格，也不是网页对战里已经实现的 96 张实战。引擎正在另行接入，以实际版本为准。

没有后端，也没有新的第三方服务。资源都用相对路径。

## 预览

用 8003，避开 8000、8001、8002：

```bash
cd wiki
python3 -m http.server 8003 --bind 127.0.0.1
```

打开 http://127.0.0.1:8003/ 。

从仓库根目录同时看游戏和图鉴：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

游戏是 http://127.0.0.1:8000/dist/ ，图鉴是 http://127.0.0.1:8000/wiki/ 。`dist/index.html` 只有一个「卡牌图鉴」链接，不加载图鉴图片。

打包：

```bash
python3 wiki/tools/pack_preview.py --wiki wiki --out pulse-card-wiki-preview.zip
```

解压后在该目录执行上面的 8003 命令。

## 页面上有什么

- 搜索中文名、官方型号、rid、游戏阵营和家族 id。旧名「厚壳」仍能找到已经改名的二代壳。
- 筛选：硬件 typeA / typeB、官方系列、型号前缀、九条升星链、横向家族、星级。星级只有 1 和 2，另有「无星级」，没有三星按钮。
- 详情分三块：游戏角色（主控才显示攻和耐，配件只显示效果）、成长（升星链或同族不同用途）、官方硬件。
- Tab5（H015）仍标明用户选择的官方背面。H050 的官方系列仍是未归类。
- 美术全部是 `preview_not_accepted`。下载只有包内 WebP 展示图。

设计来源是 prompt 仓库提交 `704411fcb6138a05f9fdf8c168a366b7a2bb8237`，与附件 `HEAD.txt` 一致。映射按 rid 对齐 `wiki/data/cards.json`，官方型号不改。

## 数据和图片怎么更新

硬件与 WebP：

```bash
python3 wiki/tools/prepare_catalog.py --cards path/to/cards.json --assets path/to/assets --out wiki
```

设计包：

```bash
python3 wiki/tools/build_design_pack.py \
  --roster wiki/data/clash_roster_96.json \
  --cards wiki/data/cards.json \
  --playtest path/to/clash_playtest.json \
  --out wiki/data/design-pack.json
```

脚本拒绝缺字段、把版本号猜成三星、成长链成环，以及工作机绝对路径。不要用旧的 22 张图或冻结包替换这 96 张。

## 和游戏页的共享改动

- `src/app.js` 与 `dist/index.html`：大厅增加「卡牌图鉴」链接
- `tools/check.cjs`：把图鉴测试加进原有检查
- 仓库 `README.md`：说明图鉴位置

没有改玩法引擎、固件、NFC 或串口。
