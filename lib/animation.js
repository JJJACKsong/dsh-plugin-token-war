/** Pure animation helpers; caller owns visibility and frame scheduling. */
export function selectFrame(clip, elapsedMs) {
  if (!clip || !Array.isArray(clip.frames) || !clip.frames.length ||
      !Array.isArray(clip.durationsMs) || clip.frames.length !== clip.durationsMs.length ||
      clip.frames.some(n => !Number.isInteger(n) || n < 0) ||
      clip.durationsMs.some(n => !Number.isFinite(n) || n <= 0)) {
    throw new TypeError('Invalid animation clip');
  }
  const total = clip.durationsMs.reduce((a, b) => a + b, 0);
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (!clip.loop && elapsed >= total) return { frame: clip.frames.at(-1), done: true };
  let time = clip.loop ? elapsed % total : elapsed;
  for (let i = 0; i < clip.frames.length; i++) {
    if (time < clip.durationsMs[i]) return { frame: clip.frames[i], done: false };
    time -= clip.durationsMs[i];
  }
  return { frame: clip.frames.at(-1), done: !clip.loop };
}

export function drawFrame(ctx, image, layout, frame, x, y, scale = 1) {
  const [w, h] = layout.frameSize;
  if (!Number.isInteger(frame) || frame < 0 || frame >= layout.columns * layout.rows ||
      !Number.isFinite(scale) || scale <= 0) throw new RangeError('Invalid frame or scale');
  const previous = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  try {
    ctx.drawImage(image, (frame % layout.columns) * w, Math.floor(frame / layout.columns) * h,
      w, h, x - layout.anchorPx[0] * scale, y - layout.anchorPx[1] * scale, w * scale, h * scale);
  } finally { ctx.imageSmoothingEnabled = previous; }
}
