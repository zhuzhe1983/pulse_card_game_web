# PULSE · tactical-v1

当前网页构建：`pcg.clash.v0 / tactical-v1`。规则为 30 生命、7 台主控位、12 张技能、16/10/4 随机牌组。完整规格见仓库 `docs/TACTICAL_V1.md`。

从仓库根目录运行 `python3 tools/serve.py --port 8002`，打开 `http://127.0.0.1:8002/dist/clash/`。本目录需要根目录下的 wiki 图片与数据，不是可单独分发的离线包。

菜单可切换随机人机、固定教学、本地双人和技能演练。点选或拖拽出牌，Escape 取消选择。原点数游戏入口已经跳转新版，旧代码保存在 `archive/pre-tactical-20261113`。

已做自动规则与浏览器检查，尚待真人平衡试玩和实体手机/NFC 验证。
