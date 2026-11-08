import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPlaybackClock,resolveClip,nextPoseDelay} from '../lib/playback.js';
import {safeRelativePath,checkBytes,gifInfo} from '../tools/check-assets.mjs';

const catalog={animations:{idle:{frames:[0,1,2],durationsMs:[850,110,350],loop:true},attack:{frames:[6,7,8,0],durationsMs:[120,100,150,230],loop:false}}};
test('pause/resume does not count paused wall time',()=>{
  let now=0;const clock=createPlaybackClock(()=>now);clock.resume();now=250;clock.pause();
  now=5000;assert.equal(clock.read(),250);clock.resume();now=5050;assert.equal(clock.read(),300);
});
test('repeated pause/resume is idempotent',()=>{
  let now=0;const c=createPlaybackClock(()=>now);c.resume();now=10;c.resume();now=20;c.pause();c.pause();assert.equal(c.read(),20);
});
test('reset and seek work while running or paused',()=>{
  let now=0;const c=createPlaybackClock(()=>now);c.resume();now=100;c.reset();assert.equal(c.read(),0);c.pause();
  c.seek(400);assert.equal(c.read(),400);assert.throws(()=>c.seek(-1),RangeError);
});
test('character timing overrides are copied, not shared',()=>{
  const ch={idleDurationsMs:[800,200,110]};const clip=resolveClip(catalog,ch,'idle');clip.durationsMs[0]=1;
  assert.equal(ch.idleDurationsMs[0],800);assert.equal(catalog.animations.idle.durationsMs[0],850);
});
test('attack loops only when preview explicitly asks',()=>{
  assert.equal(resolveClip(catalog,{},'attack').loop,false);assert.equal(resolveClip(catalog,{},'attack',true).loop,true);
  assert.throws(()=>resolveClip(catalog,{},'not-a-state'),RangeError);
});
test('invalid per-character timing is rejected',()=>{
  assert.throws(()=>resolveClip(catalog,{idleDurationsMs:[100]},'idle'),TypeError);
});
test('sprite scheduler can wait until next actual pose',()=>{
  const c=resolveClip(catalog,{},'idle');assert.equal(nextPoseDelay(c,0),850);assert.equal(nextPoseDelay(c,800),50);
  assert.equal(nextPoseDelay(c,850),110);assert.equal(nextPoseDelay(c,1310),850);
  assert.equal(nextPoseDelay(catalog.animations.attack,600),null);
});
test('asset paths reject traversal, absolute and Windows paths',()=>{
  for(const p of ['../x','/x','a/../x','a//x','a\\x','C:/x','','./x'])assert.equal(safeRelativePath(p),false);
  assert.equal(safeRelativePath('assets/characters/deepseek/atlas.png'),true);
});
test('hash verification catches same-size content corruption',()=>{
  const good=Buffer.from('pixels');const entry={bytes:good.length,sha256:createHash('sha256').update(good).digest('hex')};
  checkBytes(good,entry);assert.throws(()=>checkBytes(Buffer.from('PixeLs'),entry),/SHA-256/);
  assert.throws(()=>checkBytes(Buffer.from('x'),entry),/size/);
});
test('truncated or non-GIF data is rejected',()=>{
  assert.throws(()=>gifInfo(Buffer.from('GIF89a')),/Truncated/);assert.throws(()=>gifInfo(Buffer.from('not an image')),/signature/);
});
