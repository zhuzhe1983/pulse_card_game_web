#!/usr/bin/env python3
"""Rebuild the standalone HTML using only files inside this project. Stdlib only."""
from pathlib import Path
import base64
import hashlib
import json
root=Path(__file__).resolve().parents[1]
pack=json.loads((root/'content/pack.json').read_text())
presentation=json.loads((root/'content/presentation.json').read_text())
assets={}
for folder in ['card','char']:
    for path in sorted((root/'asset'/folder).glob('*.png')):
        assets[f'{folder}{path.name[:2]}']='data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode()
if len(assets)!=44:
    raise SystemExit('Expected 22 card PNGs and 22 character PNGs in asset/.')
(root/'src/assets.js').write_text('globalThis.PCGAssets='+json.dumps(assets,separators=(',',':'))+';\n')
(root/'src/content.js').write_text('globalThis.PCGContent='+json.dumps({'pack':pack,'presentation':presentation},ensure_ascii=False,separators=(',',':'))+';\n')
html=(root/'src/template.html').read_text()
for token,filename in [('STYLES','style.css'),('ASSETS','assets.js'),('CONTENT','content.js'),('ENGINE','engine.js'),('STORE','store.js'),('READERS','readers.js'),('RTC','rtc.js'),('NETWORK','network-game.js'),('APP','app.js')]:
    value=(root/'src'/filename).read_text()
    if filename.endswith('.js'):
        value=value.replace('</script','<\\/script')
    marker='/*__'+token+'__*/'
    if marker not in html:
        raise SystemExit('Missing bundle marker: '+marker)
    html=html.replace(marker,value)
(root/'dist').mkdir(exist_ok=True)
(root/'dist/index.html').write_text(html)
canonical=json.dumps(pack,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
manifest={'content_pack_id':pack['content_pack_id'],'ruleset_id':pack['ruleset_id'],'content_hash':hashlib.sha256(canonical).hexdigest(),'canonical_encoding':'PCG-C14N-1','web_protocol':'pcg.web.v1','client_version':'1.0.0','source_asset_commit':'091bba9113d4efb34231abf4b8b4bf77d3cfea04'}
(root/'content/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Built dist/index.html:',len(html.encode()),'bytes; content',manifest['content_hash'])
