import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { selectFrame, drawFrame } from '../lib/animation.js';
import { apply } from '../lib/index.js';
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const catalog = await json('../assets/catalog.json');

test('idle loops and handles exact boundaries', () => {
  const c = { frames: [0, 1], durationsMs: [100, 200], loop: true };
  assert.deepEqual(selectFrame(c, 0), {frame:0,done:false});
  assert.equal(selectFrame(c, 99).frame, 0);
  assert.equal(selectFrame(c, 100).frame, 1);
  assert.equal(selectFrame(c, 300).frame, 0);
  assert.equal(selectFrame(c, -50).frame, 0);
  assert.equal(selectFrame(c, NaN).frame, 0);
});
test('attack stops at the recovery pose', () => {
  const c = catalog.animations.attack;
  assert.equal(c.loop, false);
  assert.deepEqual(selectFrame(c, 1e6), {frame:0,done:true});
  assert.equal(selectFrame(c, c.hitAtMs).frame, 8);
});
test('invalid clips fail explicitly', () => {
  for (const c of [null, {}, {frames:[],durationsMs:[]}, {frames:[0],durationsMs:[0]},
    {frames:[-1],durationsMs:[100]}, {frames:[0],durationsMs:[100,100]}]) {
    assert.throws(() => selectFrame(c, 0), TypeError);
  }
});
test('drawing uses the atlas cell and ground anchor', () => {
  let call; const context={ imageSmoothingEnabled: true, drawImage(...args) {call=args;} };
  const image={}; drawFrame(context, image, catalog, 4, 96, 176);
  assert.deepEqual(call,[image,192,192,192,192,0,0,192,192]);
  assert.equal(context.imageSmoothingEnabled, true);
  assert.throws(()=>drawFrame(context,image,catalog,9,0,0),RangeError);
});
test('asset catalog covers all ten characters in the 2026-11 roster', () => {
  assert.equal(catalog.characters.length,10);
  const ids = catalog.characters.map(c=>c.id); assert.equal(new Set(ids).size,10);
  for (const c of catalog.characters) {
    assert.equal(c.releaseRoster,'2026-11');
    assert.deepEqual(c.states,['idle','move','attack']);
    assert.ok(c.atlas.startsWith('assets/characters/'));
    for (const p of [c.source,c.atlas]) assert.ok(!p.includes('..') && !p.startsWith('/'));
    for (const clip of Object.values(catalog.animations)) assert.ok(selectFrame(clip,250).frame<9);
    assert.ok(Array.isArray(c.renderBounds)&&c.renderBounds.length===4,`${c.id} needs renderBounds`);
    assert.ok(c.renderBounds[3]>c.renderBounds[1],`${c.id} renderBounds height`);
  }
});
test('task memes and explicit prototype balance are retained', async () => {
  const data=await json('../data/tasks.json');
  const names=data.tasks.map(t=>t.name);
  for (const name of ['上传用户的 repo','解救 Claude','构建 AGI']) assert.ok(names.includes(name));
  assert.equal(new Set(data.tasks.map(t=>t.id)).size,data.tasks.length);
  assert.ok(data.tasks.every(t=>t.baseCost>0 && t.baseReward>0 && t.periodMs>0));
  assert.equal(data.balanceStatus,'prototype_v0.1_game_values_not_real_costs');
});
test('roster uses real model lineups and keeps legacy ids', async () => {
  const roster=await json('../data/roster.json');
  assert.equal(roster.enabledVendors.length,10);assert.equal(roster.models.length,59);assert.ok(roster.models.every(m=>m.apiPrice===null));
  assert.equal(roster.models[0].id,'dsv41flash');assert.equal(roster.models[0].name,'DeepSeek-V4.1-Flash');assert.equal(roster.models[0].vendor,'deepseek');
  const originalIds=['gpt35','dsv2','claude2','gemini15','qwen2','dsv41','gpt4o','gemini25','qwen3','fable5'];
  for(const id of originalIds) assert.ok(roster.models.some(m=>m.id===id),`missing original model ${id}`);
  for(const v of roster.enabledVendors) assert.ok(roster.models.filter(m=>m.vendor===v).length>=5,`${v} should have at least five models`);
  for(const m of roster.models){assert.ok(m.series,`model ${m.id} needs a series for bonds`);assert.ok(Number.isInteger(m.tier)&&m.tier>=1&&m.tier<=6,`model ${m.id} tier`);}
  assert.equal(roster.maxVisibleCharacters,10);
  const events=await json('../data/events.json');
  assert.equal(events.status,'user_supplied_satire_not_verified_news');
  assert.equal(events.maxConcurrent,1);
  for(const v of roster.enabledVendors) assert.ok(events.events.some(e=>e.vendor===v),`missing event for ${v}`);
  assert.equal(events.events.length,21);
  const skills=await json('../data/skills.json');
  assert.equal(skills.bonds.length,5);assert.equal(skills.combos.length,9);
  for(const b of skills.bonds) assert.ok(b.author&&b.desc,`bond ${b.id} needs author/desc`);
  for(const c of skills.combos) assert.ok(c.author&&c.desc,`combo ${c.id} needs author/desc`);
  assert.ok(skills.combos.some(c=>c.debuff&&c.vendorPower?.deepseek<1));
  assert.ok(skills.bonds.some(b=>b.debuff&&b.tiers.some(t=>t.income<1&&t.power>1)));
  const series=new Set(roster.models.map(m=>m.series));
  for(const b of skills.bonds) assert.ok(series.has(b.series),`unknown bond series ${b.series}`);
  for(const c of skills.combos) assert.ok(c.requires.length>=2);
});
test('private package and inert host', async () => {
  const pkg=await json('../package.json');
  assert.equal(pkg.private,false); assert.equal(pkg.name,'dsh-plugin-token-war');
  assert.equal(apply(),undefined);
});
test('client registers and disposes both slots using a host mock', async () => {
  let entry; const registered=[]; const disposers=[];
  vm.runInNewContext(await readFile(new URL('../lib/client.js',import.meta.url),'utf8'),
    {window:{__ModuleLoader__:{load(value){entry=value;}}}});
  assert.equal(entry.id,'dsh-plugin-token-war');
  const plugin=entry.factory(name=>{
    assert.equal(name,'react'); return {createElement:(...args)=>args,useRef:()=>({current:null}),useEffect:()=>{}};
  });
  let disposed=0;
  plugin.apply({ effect(fn){disposers.push(fn());}, slots:{
    inject(name,fn){return fn();},
    register(meta,component){registered.push(meta);assert.ok(component());return ()=>disposed++;},
  }});
  assert.equal(registered.length,2); assert.equal(registered[0].id,'dsh-token-war');
  assert.equal(registered[1].key,'dsh-token-war');
  for(const dispose of disposers)dispose(); assert.equal(disposed,2);
});
