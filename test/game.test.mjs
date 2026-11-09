import test from 'node:test';
import assert from 'node:assert/strict';
import {amount,fromLog,format,log,add,subtract,multiply,divide,ratio,compare,valid,seriesCost,affordableLevels} from '../lib/amount.js';
import {createGame,advance,validateState,totalPower,income,distillGain,distill,canDistill,buyTask,buyModel,buyTraining,taskCost,taskReward,makeSave,readSave,offlineElapsed,MAX_OFFLINE_MS,activeBonds,activeCombos,skillEffects} from '../lib/game.js';
import {TASKS,ROSTER} from '../lib/config.js';
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
 assert.ok(activeBonds(s).some(b=>b.id==='deepseek-big-fish'));
 const base=skillEffects(s).vendor.deepseek;
 s.models.push('kimik3turbo','fable5');
 assert.ok(activeCombos(s).some(c=>c.id==='kimi-distill-claude'));
 assert.ok(activeCombos(s).some(c=>c.id==='cat-group-kick'));
 assert.ok(skillEffects(s).vendor.deepseek<base);
});
test('negative vendor event only changes its vendor and expires',()=>{
 const s=createGame();s.models.push('dsv2');const baseline=totalPower(s);s.event={id:'ds-busy',until:30000};assert.ok(compare(totalPower(s),baseline)<0);s.auto=false;s.autoDistill=false;run(s,30001);assert.equal(s.event,null);close(totalPower(s),baseline);
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
