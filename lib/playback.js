/** Pausable elapsed time, separate from wall-clock gameplay time. */
export function createPlaybackClock(now = () => performance.now()) {
  let elapsed = 0, started = null;
  const timestamp = () => {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('Invalid clock');
    return value;
  };
  const read = () => elapsed + (started === null ? 0 : Math.max(0, timestamp() - started));
  return {
    read,
    get running() { return started !== null; },
    pause() { elapsed = read(); started = null; },
    resume() { if (started === null) started = timestamp(); },
    reset() { elapsed = 0; if (started !== null) started = timestamp(); },
    seek(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Invalid elapsed time');
      elapsed = ms;
      if (started !== null) started = timestamp();
    },
  };
}

/** Resolve per-character timing without modifying the shared catalog. */
export function resolveClip(catalog, character, state, previewLoop = false) {
  const source = catalog?.animations?.[state];
  if (!source) throw new RangeError('Unknown animation state');
  const clip = {...source, frames: [...source.frames], durationsMs: [...source.durationsMs]};
  if (state === 'idle' && character?.idleDurationsMs) {
    clip.durationsMs = [...character.idleDurationsMs];
  }
  if (clip.frames.length !== clip.durationsMs.length ||
      clip.durationsMs.some(ms => !Number.isFinite(ms) || ms <= 0)) {
    throw new TypeError('Invalid animation timing');
  }
  if (previewLoop) clip.loop = true;
  return clip;
}

/** Time until the next pose; a sprite-only preview need not redraw at 30/60 Hz. */
export function nextPoseDelay(clip, elapsedMs) {
  const total = clip.durationsMs.reduce((a, b) => a + b, 0);
  if (!clip.loop && elapsedMs >= total) return null;
  let t = Math.max(0, elapsedMs) % total;
  for (const duration of clip.durationsMs) {
    if (t < duration) return Math.max(1, duration - t);
    t -= duration;
  }
  return 1;
}
