# PULSE 卡牌图鉴

当前页面展示 96 张设备卡与 12 张技能。设备图片和官方型号保留原始来源；游戏数字使用 `tactical-v1` 覆盖层，与牌桌同步。美术仍未正式验收，数值仍待真人试玩。

从仓库根目录运行 `python3 tools/serve.py --port 8002`，访问 `/wiki/`。`python3 tools/build_clash.py` 同时重新生成设计数据，避免图鉴与引擎数字分叉。

`data/cards.json` 是硬件/美术索引，`data/clash_roster_96.json` 是设备基线，`data/design-pack.json` 是加上 `content/clash/clash_balance.json` 的生成结果。`data/clash_tactics.json` 同步 12 张技能。技能不对应真实硬件 SKU；游戏效果不是官方产品功能。

图片导入仍可用 `tools/prepare_catalog.py`，不要用新生成图片覆盖官方产品原图。旧宣传卡图保留作素材，不再作为旧点数游戏入口。
