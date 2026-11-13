#!/usr/bin/env python3
"""Build tactical Clash and its matching wiki data from the current profile."""
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
translations = json.loads((root / 'shared/locales/en.json').read_text())
(root / 'shared/locales/en.js').write_text('/* Generated from en.json by tools/build_clash.py. */\nglobalThis.PULSE_EN=' + json.dumps(translations, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c') + ';\n')
# Keep a new locale runtime and its catalog in sync for returning visitors.
assets = ['shared/locales/en.js', 'shared/i18n.js', 'shared/pulse.css',
          'wiki/wiki.js', 'wiki/catalog.js', 'wiki/wiki.css']
versions = {(root / path).resolve(): hashlib.sha256((root / path).read_bytes()).hexdigest()[:12]
            for path in assets}
for page, served_dir in [('index.html', '.'), ('wiki/index.html', 'wiki'),
                         ('wiki/curve.html', 'wiki'), ('src/clash/template.html', 'dist/clash')]:
    def version_asset(match):
        attribute, url = match.groups()
        path = url.split('?', 1)[0]
        version = versions.get((root / served_dir / path).resolve())
        return f'{attribute}="{path}?v={version}"' if version else match.group(0)
    source = root / page
    source.write_text(re.sub(r'(src|href)="([^"]+)"', version_asset, source.read_text()))
shutil.copyfile(root / 'content/clash/clash_tactics.json', root / 'wiki/data/clash_tactics.json')
subprocess.run([sys.executable, str(root / 'wiki/tools/build_design_pack.py'),
    '--roster', str(root / 'content/clash/clash_roster_96.json'),
    '--cards', str(root / 'wiki/data/cards.json'),
    '--playtest', str(root / 'content/clash/clash_playtest.json'),
    '--balance', str(root / 'content/clash/clash_balance.json'),
    '--out', str(root / 'wiki/data/design-pack.json')], check=True)
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
    '/*__CLASH_CSS__*/': '\n'.join((root / path).read_text() for path in ['shared/pulse.css', 'src/clash/style.css', 'src/clash/tactical.css', 'src/clash/raster.css']),
    '/*__CLASH_CONTENT__*/': 'globalThis.PCGClashContent=' + embed('content/clash/clash_playtest.json') + ';\n' + 'globalThis.PCGClashBalance=' + embed('content/clash/clash_balance.json') + ';\n' + 'globalThis.PCGClashTactics=' + embed('content/clash/clash_tactics.json') + ';\n',
    '/*__CLASH_CAPABILITIES__*/': 'globalThis.PCGClashCapabilities=' + embed('content/clash/capabilities.json') + ';\n',
    '/*__CLASH_ROSTER__*/': 'globalThis.PCGClashRoster=' + embed('content/clash/clash_roster_96.json') + ';\n' + 'globalThis.PCGClashServices=' + embed('content/clash/clash_services.json') + ';\n' + 'globalThis.PCGClashArt=' + art_map() + ';\n' + 'globalThis.PCGClashScene=' + embed('content/clash/scene_assets.json') + ';\n',
    '/*__CLASH_ENGINE__*/': script((root / 'src/clash/engine.js').read_text()),
    '/*__CLASH_APP__*/': script((root / 'src/clash/nfc.js').read_text() + '\n' + (root / 'src/clash/app.js').read_text()),
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
shutil.copytree(scene_src, scene_out, ignore=shutil.ignore_patterns('source'))
font_src = root / 'src/clash/fonts'
font_out = out / 'fonts'
if font_src.exists():
    if font_out.exists():
        shutil.rmtree(font_out)
    shutil.copytree(font_src, font_out)
print('Built dist/clash/index.html:', len(html.encode()), 'bytes')
