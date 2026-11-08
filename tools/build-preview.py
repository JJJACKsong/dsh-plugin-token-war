#!/usr/bin/env python3
"""Build a self-contained local HTML preview; no network or image generation."""
import argparse, base64, json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('output',type=Path);args=p.parse_args()
catalog=json.loads((root/'assets/catalog.json').read_text())
payload={'catalog':catalog,'images':{c['id']:'data:image/png;base64,'+base64.b64encode((root/c['atlas']).read_bytes()).decode() for c in catalog['characters']}}
html=(root/'tools/preview.html').read_text().replace('<script id="asset-data" type="application/json">null</script>', '<script id="asset-data" type="application/json">'+json.dumps(payload,ensure_ascii=False).replace('<','\\u003c')+'</script>')
for source in ['animation','playback']:
 code=(root/f'lib/{source}.js').read_text().replace('export function ','function ')
 importline=next(line for line in html.splitlines() if line.startswith('import ') and f'lib/{source}.js' in line)
 html=html.replace(importline,code)
# Inline classic JS also runs from file://; the initializer keeps its async scope.
html=html.replace('<script type="module">','<script>\n(async()=>{').replace('</script></html>','})();\n</script></html>')
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(html)
print(args.output, args.output.stat().st_size, 'bytes')
