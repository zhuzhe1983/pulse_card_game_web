#!/usr/bin/env python3
"""Build the standalone pcg.clash.v0 page. Does not touch the old dist/index.html."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
html = (root / 'src/clash/template.html').read_text()

def script(text):
    return text.replace('</script', '<\\/script')

content = json.dumps(json.loads((root / 'content/clash/clash_playtest.json').read_text()), ensure_ascii=False, separators=(',', ':'))
content = content.replace('<', '\\u003c')
replacements = {
    '/*__CLASH_CSS__*/': (root / 'src/clash/style.css').read_text(),
    '/*__CLASH_CONTENT__*/': 'globalThis.PCGClashContent=' + content + ';\n',
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
print('Built dist/clash/index.html:', len(html.encode()), 'bytes')
