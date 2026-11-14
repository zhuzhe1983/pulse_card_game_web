#!/usr/bin/env bash
# Uses exactly the production renderer. Run from the repository root.
set -euo pipefail
FW="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-output/m5dial-feedback}"
mkdir -p "$OUT"
cc -std=c11 -Wall -Wextra -Werror -I "$FW/main" "$FW/main/ui_render.c" "$FW/main/ui_font.c" "$FW/main/ui_model.c" "$FW/main/sound_pattern.c" "$FW/tests/render_ui.c" -o "$OUT/render-ui"
"$OUT/render-ui" "$FW/assets/dial-workbench-v2.rgb565" "$OUT"
