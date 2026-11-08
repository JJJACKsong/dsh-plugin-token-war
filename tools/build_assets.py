#!/usr/bin/env python3
"""Normalize existing image-generated animation frames. No generation or API calls."""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageSequence

CELL = 192
ANCHOR = (96, 176)


def anchor(frame):
    a = np.asarray(frame)[:, :, 3] > 0
    y, x = np.where(a)
    if not len(y):
        raise ValueError('Empty frame')
    bottom = int(y.max()) + 1
    _, feet = np.where(a[max(0, bottom - 24):bottom])
    return float(np.median(feet)), bottom


def gif(frames, indices, durations, output):
    strip = Image.new('RGB', (CELL * len(frames), CELL))
    for i, f in enumerate(frames):
        strip.paste(f.convert('RGB'), (i * CELL, 0))
    p = strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    palette = p.getpalette()[:765] + [0, 0, 0]
    ref = Image.new('P', (1, 1)); ref.putpalette(palette)
    encoded = []
    for i in indices:
        q = frames[i].convert('RGB').quantize(palette=ref, dither=Image.Dither.NONE)
        a = np.asarray(q).copy()
        a[np.asarray(frames[i])[:, :, 3] < 128] = 255
        q = Image.fromarray(a).convert('P'); q.putpalette(palette)
        encoded.append(q)
    encoded[0].save(output, format='GIF', save_all=True, append_images=encoded[1:],
                    duration=durations, loop=0, transparency=255, disposal=2, optimize=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    catalog = json.loads((root / 'assets/catalog.json').read_text())
    report = []
    for c in catalog['characters']:
        source = root / c['source']
        with Image.open(source) as image:
            frames = [f.convert('RGBA') for f in ImageSequence.Iterator(image)]
        if len(frames) != 9:
            raise ValueError(f'{c["id"]}: expected 9 source poses, got {len(frames)}')
        bounds = [f.getbbox() for f in frames]
        feet = [anchor(f) for f in frames]
        ground = [max(a[1] for a in feet[i:i+3]) for i in (0, 3, 6)]
        left = max(feet[i][0] - b[0] for i, b in enumerate(bounds))
        right = max(b[2] - feet[i][0] for i, b in enumerate(bounds))
        height = max(ground[i//3] - b[1] for i, b in enumerate(bounds))
        idle_height = max(b[3] - b[1] for b in bounds[:3])
        scale = min(156 / idle_height, 88 / left, 88 / right, 168 / height)
        target = root / 'assets/characters' / c['id']; target.mkdir(parents=True, exist_ok=True)
        normalized = []
        for i, f in enumerate(frames):
            f = f.resize((round(f.width * scale), round(f.height * scale)), Image.Resampling.NEAREST)
            canvas = Image.new('RGBA', (CELL, CELL))
            canvas.alpha_composite(f, (round(ANCHOR[0]-feet[i][0]*scale), round(ANCHOR[1]-ground[i//3]*scale)))
            bb = canvas.getbbox()
            if not bb or min(bb[:2]) < 4 or max(bb[2:]) > CELL - 4:
                raise ValueError(f'{c["id"]}: clipped normalized pose {i}: {bb}')
            normalized.append(canvas)
        atlas = Image.new('RGBA', (CELL*3, CELL*3))
        for i, f in enumerate(normalized):
            atlas.alpha_composite(f, (i % 3 * CELL, i // 3 * CELL))
        atlas.save(target / 'atlas.png', optimize=True)
        normalized[0].save(target / 'portrait.png', optimize=True)
        for state, clip in catalog['animations'].items():
            durations = c.get('idleDurationsMs', clip['durationsMs']) if state == 'idle' else clip['durationsMs']
            gif(normalized, clip['frames'], durations, target / f'{state}.gif')
        report.append({'id':c['id'], 'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                       'uniqueSourcePoses':9, 'normalizationScale':scale,
                       'atlasSize':[CELL*3,CELL*3], 'transparent':True,
                       'sourceEffectTouchesEdge':any(b[0]<=2 or b[2]>=frames[i].width-2 for i,b in enumerate(bounds[6:],6))})
        print(f'Built {c["id"]}: atlas + portrait + 3 GIF previews')
    (root/'art/build-report.json').write_text(json.dumps({'characters':report,'newPosesGenerated':False},ensure_ascii=False,indent=2)+'\n')

if __name__ == '__main__':
    main()
