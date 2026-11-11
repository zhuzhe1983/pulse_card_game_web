#!/usr/bin/env python3
"""Build the standalone pcg.clash.v0 page. Does not touch the old dist/index.html."""
import json
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
html = (root / 'src/clash/template.html').read_text()

def script(text):
    return text.replace('</script', '<\\/script')

def embed(path):
    text = json.dumps(json.loads((root / path).read_text()), ensure_ascii=False, separators=(',', ':'))
    return text.replace('<', '\\u003c')

def art_map():
    data = json.loads((root / 'wiki/data/cards.json').read_text())
    out = {}
    for card in data['cards']:
        web = card['assets']['web']
        out[card['rid']] = {
            'card': '../../wiki/' + web['card_webp']['path'],
            'char': '../../wiki/' + web['char_webp']['path'],
        }
    return json.dumps(out, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')

replacements = {
    '/*__CLASH_CSS__*/': (root / 'shared/pulse.css').read_text() + '\n' + (root / 'src/clash/style.css').read_text(),
    '/*__CLASH_CONTENT__*/': 'globalThis.PCGClashContent=' + embed('content/clash/clash_playtest.json') + ';\n',
    '/*__CLASH_CAPABILITIES__*/': 'globalThis.PCGClashCapabilities=' + embed('content/clash/capabilities.json') + ';\n',
    '/*__CLASH_ROSTER__*/': 'globalThis.PCGClashRoster=' + embed('content/clash/clash_roster_96.json') + ';\n' + 'globalThis.PCGClashServices=' + embed('content/clash/clash_services.json') + ';\n' + 'globalThis.PCGClashArt=' + art_map() + ';\n' + 'globalThis.PCGClashScene=' + embed('content/clash/scene_assets.json') + ';\n',
    '/*__CLASH_ENGINE__*/': script((root / 'src/clash/engine.js').read_text()),
    '/*__CLASH_APP__*/': script((root / 'src/clash/app.js').read_text()),
}
for marker, value in replacements.items():
    if marker not in html:
        raise SystemExit('missing ' + marker)
    html = html.replace(marker, value)
if 'pcg.core.v1' in html:
    raise SystemExit('clash page must not embed the old ruleset id')
out = root / 'dist/clash'
out.mkdir(parents=True, exist_ok=True)
(out / 'index.html').write_text(html)
readme = (root / 'src/clash/PREVIEW_README.md').read_text()
(out / 'README.md').write_text(readme)
scene_src = root / 'src/clash/scene'
scene_out = out / 'scene'
if scene_out.exists():
    shutil.rmtree(scene_out)
shutil.copytree(scene_src, scene_out)
print('Built dist/clash/index.html:', len(html.encode()), 'bytes')
