# PULSE · 脉冲对决

当前主线是 `pcg.clash.v0 / tactical-v1`：以 M5 设备为角色的单局回合卡牌战。30 点核心生命，7 台主控位，技能控场、主控进攻、配件装配。随机牌组为 16 主控、10 技能、4 配件；12 张技能已接入引擎与 AI。

```bash
python3 tools/build_clash.py
node tools/check.cjs
python3 tools/serve.py --port 8002
```

打开 <http://127.0.0.1:8002/>。牌桌在 `/dist/clash/`，图鉴在 `/wiki/`。必须从仓库根目录提供完整站点，牌桌使用图鉴资源；不需要 npm 才能游玩。

点牌后选择目标，或拖拽到合法目标；无目标技能点“打出”。点己方主控再点敌方主控/核心可以攻击。菜单可切换随机人机、固定教学、本地双人、技能演练和组牌练习。随机战可重放种子，本地双人交接后当前玩家在下方。当前版不提供联网对战、账号收藏或跨设备存档。

规则与数值见 [新版规格](docs/TACTICAL_V1.md)，复审依据见 [评估报告](docs/REVIEW_20261113.md)，实现入口和测试见 [HANDOFF.md](HANDOFF.md)。规格仓库是隔壁 `pulse_card_game_prompt`，两边的战术配置和参考引擎保持一致。当前状态为已实现、待真人试玩，不代表竞技平衡完成。

旧昆特式点数游戏已移出主线，保存在本地分支 `archive/pre-tactical-20261113`。旧 `/dist/` 入口跳转新版。独立读卡器适配器与 M5Dial 固件仍保留，但不等于已经与当前牌桌全部打通或通过实机验证；边界见 [READERS.md](docs/READERS.md)。
