#!/usr/bin/env python3
"""Strict local binary-asset check. Missing files are a failure, never a skip."""
from pathlib import Path
from PIL import Image, ImageSequence
import json, hashlib
root=Path(__file__).resolve().parents[1]
catalog=json.loads((root/'assets/catalog.json').read_text())
provenance=json.loads((root/'art/sources.json').read_text())
errors=[]; checked=[]
for item in provenance['generatedSources']+[provenance['referenceArchive']]:
    p=root/item['path']
    if not p.is_file(): errors.append(f'Missing {item["path"]}'); continue
    if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']: errors.append(f'Hash mismatch {p.name}')
for c in catalog['characters']:
    base=root/'assets/characters'/c['id']
    for name in ['atlas.png','portrait.png','idle.gif','move.gif','attack.gif']:
        p=base/name
        if not p.is_file(): errors.append(f'Missing {p.relative_to(root)}'); continue
        try:
            with Image.open(p) as im:
                assert im.format==('PNG' if p.suffix=='.png' else 'GIF')
                assert im.size==((576,576) if name=='atlas.png' else (192,192))
                if p.suffix=='.gif':
                    assert im.n_frames>=3
                    for frame in ImageSequence.Iterator(im):
                        assert frame.convert('RGBA').getchannel('A').getextrema()[0]==0
                else: assert im.mode=='RGBA'
            checked.append(str(p.relative_to(root)))
        except Exception as e: errors.append(f'{p.relative_to(root)}: {e!r}')
report={'passed':not errors,'characters':len(catalog['characters']), 'checkedRuntimeFiles':len(checked),
        'gifCount':sum(x.endswith('.gif') for x in checked),'errors':errors,
        'scope':'Local asset file structure, transparency and source hashes only. Not gameplay, visual perfection or DSH integration.'}
(root/'art/validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(1 if errors else 0)
