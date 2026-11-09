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
test('expanded roster keeps the original ten ids and adds four models per vendor', async () => {
  const roster=await json('../data/roster.json');
  assert.equal(roster.enabledVendors.length,10);assert.equal(roster.models.length,41);assert.ok(roster.models.every(m=>m.apiPrice===null));
  assert.equal(roster.models[0].id,'dsv41flash');assert.equal(roster.models[0].name,'DeepSeek-V4.1-Flash');assert.equal(roster.models[0].vendor,'deepseek');
  const originalIds=['gpt35','dsv2','claude2','gemini15','qwen2','dsv41','gpt4o','gemini25','qwen3','fable5'];
  for(const id of originalIds) assert.ok(roster.models.some(m=>m.id===id),`missing original model ${id}`);
  for(const v of roster.enabledVendors) assert.ok(roster.models.filter(m=>m.vendor===v).length>=4,`${v} should have at least four models`);
  assert.equal(roster.maxVisibleCharacters,5);
  const events=await json('../data/events.json');
  assert.equal(events.status,'user_supplied_satire_not_verified_news');
  assert.equal(events.maxConcurrent,1);
  for(const v of roster.enabledVendors) assert.ok(events.events.some(e=>e.vendor===v),`missing event for ${v}`);
  assert.equal(events.events.length,20);
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
