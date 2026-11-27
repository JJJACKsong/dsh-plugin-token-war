import test from 'node:test';
import assert from 'node:assert/strict';
import {amount,fromLog,format,log,add,subtract,multiply,divide,ratio,compare,valid,seriesCost,affordableLevels} from '../lib/amount.js';
import {createGame,advance,validateState,totalPower,vendorPowers,income,distillGain,distill,canDistill,buyTask,buyModel,buyTraining,taskCost,taskReward,makeSave,readSave,offlineElapsed,MAX_OFFLINE_MS,activeBonds,activeCombos,skillEffects,eventVendorMultiplier,unlockedTitles,playerTitle,TITLE_COUNT} from '../lib/game.js';
import {TASKS,ROSTER,EVENTS} from '../lib/config.js';
const run=(s,t,budget=10000)=>{let result;do{result=advance(s,t,{maxEvents:budget});}while(!result.done);return s;};
const close=(a,b,tolerance=1e-6)=>{if(!a[0]&&!b[0])return;assert.ok(Math.abs(log(a)-log(b))<tolerance,`${format(a)} != ${format(b)}`);};

test('scientific amounts work beyond floating-point range',()=>{
 const x=fromLog(1000),y=fromLog(998);assert.deepEqual(x,[1,1000]);assert.ok(valid(add(x,y)));close(subtract(add(x,y),y),x);close(divide(multiply(x,y),y),x);assert.equal(format(x),'1.00e1000');
});
test('amounts reject invalid inputs and division by zero',()=>{
 for(const n of [-1,Infinity,NaN])assert.throws(()=>amount(n));assert.throws(()=>divide(amount(1),amount(0)));assert.equal(valid([10,1]),false);assert.equal(valid([1,Infinity]),false);
});
test('geometric bulk purchases match enumerated costs',()=>{
 for(const n of [1,2,10,25,100]){let sum=0;for(let i=0;i<n;i++)sum+=35*1.15**i;close(seriesCost(amount(35),1.15,n),amount(sum));const count=affordableLevels(amount(35),1.15,amount(sum*1.000000001));assert.equal(count,n);}
});
test('exactly one task period pays once; fractional progress survives',()=>{
 const s=createGame();s.auto=false;s.autoDistill=false;run(s,1999);assert.equal(s.coins[0],0);run(s,2000);close(s.coins,amount(5));run(s,4500);close(s.coins,amount(10));assert.equal(s.tasks[0].phase,500);
});
test('idle task cycles batch into one long settlement',()=>{
 const s=createGame();s.auto=false;s.autoDistill=false;s.nextEventAt=1e9;run(s,60000);close(s.coins,amount(150));close(s.completedTasks,amount(30));
});
test('task costs increase and milestone income doubles',()=>{
 const s=createGame();const before=taskCost(s,0);s.coins=amount(1e9);assert.equal(buyTask(s,0),1);assert.ok(compare(taskCost(s,0),before)>0);const q=ratio(taskReward(s,0,25),taskReward(s,0,24));assert.ok(Math.abs(q-2*TASKS[0].rewardGrowth)<1e-10);
});
test('locked tasks and models cannot be purchased',()=>{
 const s=createGame();s.coins=amount(1e100);assert.equal(buyTask(s,10),0);assert.equal(buyModel(s,'fable5'),false);assert.equal(buyModel(s,'does-not-exist'),false);
});
test('models cannot be bought twice, training increases output',()=>{
 const s=createGame();s.maxStage=100;s.coins=amount(1e6);assert.equal(buyModel(s,'dsv2'),true);assert.equal(buyModel(s,'dsv2'),false);const d=totalPower(s);assert.ok(buyTraining(s));assert.ok(compare(totalPower(s),d)>0);
});
test('ten minutes of no-click play progresses economy and roster',()=>{
 const game=createGame();game.autoDistill=false;const s=run(game,600000);validateState(s);assert.ok(s.maxStage>40);assert.ok(s.models.length>=3);assert.ok(s.tasks.filter(t=>t.level>0).length>=2);assert.ok(s.training>0);
});
test('one-hour no-click run has autonomous distillation and continued growth',()=>{
 const s=run(createGame(),3600000);validateState(s);assert.ok(s.generation>1);assert.ok(s.maxStage>200);assert.ok(s.weights[0]>0);assert.ok(s.models.length<=ROSTER.models.length);assert.ok(s.logs.length<=60);
});
test('manual distillation preserves models and unlocks but resets current run',()=>{
 const s=run(createGame(),900000);const models=[...s.models],unlocks=s.tasks.map(t=>t.unlocked),best=s.maxStage,gen=s.generation;assert.ok(canDistill(s));assert.ok(distill(s));assert.deepEqual(s.models,models);assert.deepEqual(s.tasks.map(t=>t.unlocked),unlocks);assert.equal(s.maxStage,best);assert.equal(s.generation,gen+1);assert.equal(s.stage,1);assert.equal(s.training,0);assert.equal(s.tasks[0].level,1);assert.ok(income(s)[0]>0);assert.equal(canDistill(s),false);assert.equal(distill(s),false);validateState(s);
});
test('restart cannot immediately farm prestige weights',()=>{const s=createGame();assert.equal(distillGain(s)[0],0);assert.equal(distill(s),false);});
test('deterministic seed and resumable chunk budgets match',()=>{
 const a=run(createGame(77),3600000),b=run(createGame(77),3600000,3);assert.deepEqual(a,b);
});
test('short front-end updates and one offline catchup agree',()=>{
 const a=run(createGame(31),600000),b=createGame(31);for(let t=250;t<=600000;t+=250)run(b,t);
 assert.equal(a.generation,b.generation);assert.equal(a.maxStage,b.maxStage);assert.deepEqual(a.models,b.models);assert.deepEqual(a.tasks.map(t=>t.level),b.tasks.map(t=>t.level));close(a.coins,b.coins);close(totalPower(a),totalPower(b));
});
test('one-hour online and offline paths agree within floating point tolerance',()=>{
 const a=run(createGame(18),3600000),b=createGame(18);for(let t=1000;t<=3600000;t+=1000)run(b,t);
 assert.equal(a.generation,b.generation);assert.equal(a.maxStage,b.maxStage);assert.deepEqual(a.tasks.map(t=>t.level),b.tasks.map(t=>t.level));close(a.coins,b.coins);close(a.weights,b.weights);
});
test('an old save with the old starter gains the new starter and advances',()=>{
 const s=createGame();s.nextEventAt=1e9;s.auto=false;s.autoDistill=false;run(s,10000);
 const oldSave=JSON.parse(makeSave(s,Date.now()));oldSave.state.models=['gpt35'];
 const loaded=readSave(JSON.stringify(oldSave));
 assert.equal(loaded.state.models[0],ROSTER.models[0].id);
 assert.ok(loaded.state.models.includes('gpt35'));
 run(loaded.state,60000);validateState(loaded.state);
});
test('same-series bonds and cross-vendor meme combos activate',()=>{
 const s=createGame();s.models=['dsv41flash','dsv2'];
 assert.ok(activeBonds(s).some(b=>b.id==='ds-380-pound'));
 const base=skillEffects(s).vendor.deepseek;
 s.models.push('kimik3turbo','fable5');
 assert.ok(activeCombos(s).some(c=>c.id==='kimi-distill-claude'));
 assert.ok(activeCombos(s).some(c=>c.id==='kimi-dog-kick'));
 assert.ok(skillEffects(s).vendor.deepseek<base);
});
test('MiniMax score-farm bond raises speed but cuts income',()=>{
 const s=createGame();s.models=['dsv41flash','minimaxm3','minimaxm35'];
 assert.ok(activeBonds(s).some(b=>b.id==='minimax-score-farm'));
 assert.ok(skillEffects(s).vendor.minimax>1);
 assert.ok(skillEffects(s).income<1);
});
test('faction combos trade power against income',()=>{
 const s=createGame();
 s.models=['dsv41flash','dsv2','dsv41','dsv4pro','qwen2','qwen3','qwen3827b','kimik3','kimik3turbo','glm5'];
 const cn=skillEffects(s);
 assert.ok(activeCombos(s).some(c=>c.id==='no-gpu-savages'));
 assert.ok(cn.income>1);
 assert.ok(cn.vendor.deepseek<2);
 const f=createGame();
 f.models=['gpt35','gpt56turbo','sonnet46','opus46','gemini15','grokbuild','grok5','grok6'];
 const us=skillEffects(f);
 assert.ok(activeCombos(f).some(c=>c.id==='brute-force'));
 assert.ok(us.income<1);
 assert.ok(us.vendor.chatgpt>1.1);
});
test('negative vendor event only changes its vendor and expires',()=>{
 const s=createGame();s.models.push('dsv2');const baseline=totalPower(s);s.event={id:'ds-busy',until:30000};assert.ok(compare(totalPower(s),baseline)<0);s.auto=false;s.autoDistill=false;run(s,30001);assert.equal(s.event,null);close(totalPower(s),baseline);
});
test('new meme bonds and combos activate for Claude, GLM, and Gemini periodic table',()=>{
 const s=createGame();
 s.models=['dsv41flash','claude2','sonnet55','glm5','glm5air','gpt4o','gemini42ultra','gemini4flash','gemini4pro','gemini25','gemini4neon'];
 const bonds=activeBonds(s),combos=activeCombos(s);
 assert.ok(bonds.some(b=>b.id==='claude-a-chu'));
 assert.ok(bonds.some(b=>b.id==='glm-z-chu'));
 assert.ok(bonds.some(b=>b.id==='gemini-periodic-table'&&b.count===5));
 assert.ok(combos.some(c=>c.id==='a-chu-meets-z-chu'));
 assert.ok(combos.some(c=>c.id==='celebrate-ant-ipo-break'));
 assert.equal(playerTitle(s).name,'破发吃瓜首席');
});
test('Anthropic IPO break event cuts Claude power while boosting rival vendors and income',()=>{
 const s=createGame();s.models=['dsv41flash','claude2'];
 const basePower=vendorPowers(s),baseIncome=income(s);
 s.event={id:'claude-ipo-break',until:50000};
 const duringPower=vendorPowers(s),duringIncome=income(s);
 assert.ok(compare(duringPower.claude,basePower.claude)<0);
 assert.ok(compare(duringPower.deepseek,basePower.deepseek)>0);
 assert.ok(compare(duringIncome,baseIncome)>0);
 s.auto=false;s.autoDistill=false;run(s,50001);
 assert.equal(s.event,null);
 close(vendorPowers(s).claude,basePower.claude);
});
test('global industry events apply per-vendor multipliers and expire cleanly',()=>{
 const s=createGame();s.models=['dsv41flash','gpt35'];
 const base=vendorPowers(s);
 s.event={id:'all-export-ban',until:40000};
 const during=vendorPowers(s);
 assert.ok(compare(during.chatgpt,base.chatgpt)>0);
 assert.ok(compare(during.deepseek,base.deepseek)<0);
 assert.equal(eventVendorMultiplier({vendor:'all',powerMultiplier:1.38},'deepseek'),1.38);
 s.auto=false;s.autoDistill=false;run(s,40001);
 assert.equal(s.event,null);
});
test('save roundtrip resumes same deterministic history',()=>{
 const s=run(createGame(),600000),save=makeSave(s,1000000),loaded=readSave(save);assert.deepEqual(loaded.state,s);assert.equal(loaded.savedAt,1000000);run(s,900000);run(loaded.state,900000);assert.deepEqual(loaded.state,s);
});
test('malformed and excessively large saves are rejected',()=>{
 assert.throws(()=>readSave('{'));assert.throws(()=>readSave('x'.repeat(200001)));
 const s=createGame();s.coins=[Infinity,0];assert.throws(()=>makeSave(s,0));
 for(const mutate of [s=>s.models.push('evil'),s=>s.tasks.pop(),s=>s.training=-1,s=>s.tasks[0].level=0,s=>s.paused='yes',s=>s.event={id:'fake',until:10},s=>s.stage=1e12,s=>s.actionAt=-1]){const s=createGame();mutate(s);assert.throws(()=>validateState(s));}
});
test('offline policy handles pause, clock rollback and long gaps',()=>{
 assert.equal(offlineElapsed(100,50),0);assert.equal(offlineElapsed(0,500,true),0);assert.equal(offlineElapsed(0,90*86400000),MAX_OFFLINE_MS);assert.equal(offlineElapsed(100,600),500);
});
test('chunked replay saves intermediate progress safely',()=>{
 const s=createGame();const r=advance(s,86400000,{maxEvents:10});assert.equal(r.done,false);assert.ok(s.time<86400000);const restored=readSave(makeSave(s,1000+s.time)).state;run(restored,600000);const reference=run(createGame(),600000);close(restored.coins,reference.coins);assert.equal(restored.stage,reference.stage);
});
test('seenEvents records unique triggered events and survives distill',()=>{
 const s=createGame(42);s.auto=false;s.autoDistill=false;
 run(s,900000);
 assert.ok(s.seenEvents.length>=2);
 assert.equal(new Set(s.seenEvents).size,s.seenEvents.length);
 for(const id of s.seenEvents)assert.ok(EVENTS.some(e=>e.id===id));
 const seenBefore=[...s.seenEvents];
 s.runMaxStage=50;s.maxStage=Math.max(s.maxStage,50);
 assert.ok(distill(s));
 assert.deepEqual(s.seenEvents,seenBefore);
 validateState(s);
});
test('legacy saves without seenEvents migrate and invalid seenEvents are rejected',()=>{
 const s=createGame();s.nextEventAt=1e9;s.auto=false;s.autoDistill=false;run(s,10000);
 const raw=JSON.parse(makeSave(s,Date.now()));
 delete raw.state.seenEvents;
 const migratedEmpty=readSave(JSON.stringify(raw));
 assert.deepEqual(migratedEmpty.state.seenEvents,[]);
 raw.state.event={id:'ds-busy',until:25000};
 const migratedWithEvent=readSave(JSON.stringify(raw));
 assert.deepEqual(migratedWithEvent.state.seenEvents,['ds-busy']);
 for(const bad of ['not-array',null,['unknown-event'],['ds-busy','ds-busy'],[123],EVENTS.map(e=>e.id).concat('ds-busy')]){
  const invalid=createGame();invalid.seenEvents=bad;
  assert.throws(()=>validateState(invalid));
  const rawBad=JSON.parse(makeSave(createGame(),0));rawBad.state.seenEvents=bad;
  assert.throws(()=>readSave(JSON.stringify(rawBad)));
 }
});
test('new DeepSeek bonds and 2026-11 combos activate with expected effects',()=>{
 const s=createGame();
 s.models=['dsv41flash','dsv2','dsv41','dsv4pro','dsv41pro'];
 const bonds=activeBonds(s);
 assert.ok(bonds.some(b=>b.id==='ds-troll-culture'&&b.count===5));
 assert.ok(bonds.some(b=>b.id==='ds-not-secret'&&b.count===5));
 s.models.push('claude2','kimik3','gpt4o','glm5','gemini4pro','doubao2pro','grok5');
 const comboIds=new Set(activeCombos(s).map(c=>c.id));
 for(const id of ['ds-dario-fanclub','ds-not-troll-kimi','ds-inviting-astra','reset-bro-replaced','north-america-doubao','thunder-overthink','essay-vs-interesting','riemann-vs-13-eggs']){
  assert.ok(comboIds.has(id),`missing combo ${id}`);
 }
});
test('multi-vendor events apply per-vendor multipliers and expire cleanly',()=>{
 const cases=[
  {id:'ds-dario-fan',models:['dsv41flash','claude2','gpt35'],boosted:['deepseek','claude'],cut:[],untouched:['chatgpt']},
  {id:'ds-tang-astra',models:['dsv41flash','gpt35','glm5','claude2'],boosted:['deepseek'],cut:['chatgpt','glm'],untouched:['claude']},
  {id:'claude-dario-essay',models:['dsv41flash','claude2','grok5'],boosted:['grok'],cut:['claude'],untouched:['deepseek']},
  {id:'gemini-antigravity-reset',models:['dsv41flash','gemini15','gpt35'],boosted:['gemini'],cut:['chatgpt'],untouched:['deepseek']},
 ];
 for(const tc of cases){
  const s=createGame();s.models=tc.models;s.auto=false;s.autoDistill=false;s.nextEventAt=1e9;
  const baseP=vendorPowers(s),baseI=income(s);
  const ev=EVENTS.find(e=>e.id===tc.id);
  s.event={id:tc.id,until:ev.durationMs};
  const duringP=vendorPowers(s),duringI=income(s);
  for(const v of tc.boosted)assert.ok(compare(duringP[v],baseP[v])>0,`${tc.id} should boost ${v}`);
  for(const v of tc.cut)assert.ok(compare(duringP[v],baseP[v])<0,`${tc.id} should cut ${v}`);
  for(const v of tc.untouched)close(duringP[v],baseP[v]);
  assert.ok(compare(duringI,baseI)>0,`${tc.id} should boost income`);
  run(s,ev.durationMs+1);
  assert.equal(s.event,null);
  for(const v of tc.models.map(id=>ROSTER.models.find(m=>m.id===id).vendor))close(vendorPowers(s)[v],baseP[v]);
 }
});
test('unlockedTitles exposes all 15 titles in order and playerTitle respects preferredId',()=>{
 assert.equal(TITLE_COUNT,15);
 const fresh=createGame();
 assert.deepEqual(unlockedTitles(fresh).map(t=>t.id),['prompt-intern']);
 assert.equal(playerTitle(fresh).id,'prompt-intern');
 assert.equal(playerTitle(fresh,'agi-godfather').id,'prompt-intern');
 const full=createGame();
 full.models=ROSTER.models.map(m=>m.id);
 full.maxStage=500;
 const all=unlockedTitles(full);
 assert.equal(all.length,TITLE_COUNT);
 assert.equal(all[0].id,'ipo-gossip');
 assert.equal(all[0].name,'破发吃瓜首席');
 assert.equal(all[1].id,'ds-chief-troll');
 assert.equal(all[1].name,'d小子首席串子');
 assert.equal(all.at(-1).id,'prompt-intern');
 assert.equal(playerTitle(full).id,'ipo-gossip');
 assert.equal(playerTitle(full,'thunder-monk').id,'thunder-monk');
 assert.equal(playerTitle(full,'thunder-monk').name,'雷霆大思考禅师');
 assert.equal(playerTitle(full,'nonexistent').id,'ipo-gossip');
});
