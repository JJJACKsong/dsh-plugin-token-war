import {amount,fromLog,log,add,subtract,multiply,scale,divide,power,numeric,ratio,compare,valid,seriesCost,affordableLevels} from './amount.js';
import {TASKS,ROSTER,EVENTS,SKILLS} from './config.js';

export const SAVE_VERSION = 1;
export const GAME_VERSION = '0.6.0';
export const MAX_OFFLINE_MS = 30 * 86400000;
const HP_GROWTH = 1.085;
const TRAIN_GROWTH = 1.15;
const EVENT_GAP = 240000;

export function createGame(seed = 20261107) {
  return {version:SAVE_VERSION,time:0,coins:amount(0),weights:amount(0),earned:amount(0),
    generation:1,stage:1,maxStage:0,runMaxStage:0,hp:enemyHP(1),training:0,
    models:[ROSTER.models[0].id],tasks:TASKS.map((q,i)=>({level:i===0?1:0,unlocked:i===0,phase:0})),
    auto:true,autoDistill:true,paused:false,actionAt:0,nextEventAt:180000,event:null,
    rng:(seed>>>0)||1,runStart:0,lastPrestigeCheck:0,lastProbeStage:0,lastProbeIncome:0,distillCount:0,completedTasks:amount(0),
    logs:[{at:0,kind:'start',text:'GPT-3.5 已上线。任务列表永远不会清空。'}],lastAction:'正在启动任务工厂'};
}
export function random(s) {
  let x=s.rng|0; x^=x<<13; x^=x>>>17; x^=x<<5; s.rng=x>>>0; return s.rng/4294967296;
}
export function record(s,kind,text) {
  s.logs.push({at:Math.round(s.time),kind,text}); if(s.logs.length>60)s.logs.splice(0,s.logs.length-60);
}
const caches = new WeakMap();
function cache(s) {
  let c=caches.get(s);
  const modelsKey=s.models.join(',');
  if(!c || c.weights!==s.weights || c.event!==s.event || c.modelsKey!==modelsKey) {
    c={weights:s.weights,event:s.event,modelsKey,weight:power(add(amount(1),scale(s.weights,.12)),.72),rewards:[],powers:null};
    caches.set(s,c);
  }
  return c;
}
const skillCaches = new WeakMap();
function ownedModels(s) {
  const owned=new Set(s.models);
  return ROSTER.models.filter(m=>owned.has(m.id));
}
export function activeBonds(s) {
  const owned=ownedModels(s),out=[];
  for(const b of SKILLS.bonds) {
    const count=owned.filter(m=>m.vendor===b.vendor&&m.series===b.series).length;
    const tier=[...b.tiers].reverse().find(t=>count>=t.count);
    if(tier)out.push({...b,tier,count});
  }
  return out;
}
export function activeCombos(s) {
  const owned=ownedModels(s);
  return SKILLS.combos.filter(c=>c.requires.every(r=>owned.some(m=>m.vendor===r.vendor&&(!r.series||m.series===r.series))));
}
export function activeSkills(s) {
  return {bonds:activeBonds(s),combos:activeCombos(s)};
}
export function skillEffects(s) {
  const key=s.models.join(',');
  const cached=skillCaches.get(s);
  if(cached&&cached.key===key)return cached.effects;
  const {bonds,combos}=activeSkills(s),vendor={};
  let income=1;
  for(const b of bonds) {
    vendor[b.vendor]=(vendor[b.vendor]||1)*b.tier.power;
    income*=b.tier.income;
  }
  for(const c of combos) {
    const per=c.vendorPower||{};
    for(const r of c.requires)vendor[r.vendor]=(vendor[r.vendor]||1)*(per[r.vendor]??c.power??1);
    income*=c.income??1;
  }
  const effects={bonds,combos,vendor,income};
  skillCaches.set(s,{key,effects});
  return effects;
}
export function weightMultiplier(s) { return cache(s).weight; }
export function enemyHP(stage) { return fromLog(Math.log10(18)+(stage-1)*Math.log10(HP_GROWTH)); }
export function currentEvent(s) { return s.event ? EVENTS.find(e=>e.id===s.event.id) : null; }
export function vendorPowers(s) {
  const c=cache(s);
  const modelsKey=s.models.join(',');
  if(c.powers&&c.training===s.training&&c.count===s.models.length&&c.powersKey===modelsKey)return c.powers;
  const event=currentEvent(s),out={},effects=skillEffects(s);
  const global=multiply(weightMultiplier(s),fromLog(s.training*Math.log10(1.095)));
  for(const m of ROSTER.models)if(s.models.includes(m.id))out[m.vendor]=add(out[m.vendor]||amount(0),amount(m.power));
  for(const v of Object.keys(out)) {
    out[v]=scale(multiply(out[v],global),event?.vendor===v?event.powerMultiplier:1);
    out[v]=scale(out[v],effects.vendor[v]||1);
  }
  c.powers=out;c.training=s.training;c.count=s.models.length;c.powersKey=modelsKey;
  return out;
}
export function totalPower(s) { return Object.values(vendorPowers(s)).reduce((a,b)=>add(a,b),amount(0)); }
export function taskCost(s,i) { const q=TASKS[i];return fromLog(Math.log10(q.baseCost)+s.tasks[i].level*Math.log10(q.costGrowth)); }
export function taskReward(s,i,level=s.tasks[i].level) {
  if(!level)return amount(0); const q=TASKS[i],c=cache(s);
  const prev=c.rewards[i];if(prev?.level===level)return prev.value;
  let value=scale(multiply(fromLog(Math.log10(q.baseReward)+(level-1)*Math.log10(q.rewardGrowth)+Math.floor(level/25)*Math.log10(2)),c.weight),currentEvent(s)?.incomeMultiplier||1);
  value=scale(value,skillEffects(s).income);
  c.rewards[i]={level,value};return value;
}
export function income(s) { return TASKS.reduce((acc,q,i)=>add(acc,scale(taskReward(s,i),1000/q.periodMs)),amount(0)); }
export function trainingCost(s) { return fromLog(Math.log10(35)+s.training*Math.log10(TRAIN_GROWTH)); }
export function spend(s,cost) { if(compare(s.coins,cost)<0)return false;s.coins=subtract(s.coins,cost);return true; }
export function unlock(s) {
  for(let i=0;i<TASKS.length;i++)if(!s.tasks[i].unlocked&&s.maxStage>=TASKS[i].unlockStage){
    s.tasks[i].unlocked=true;record(s,'unlock','新任务：'+TASKS[i].name);
  }
}
export function buyTask(s,i,budget=s.coins,max=1) {
  if(!Number.isInteger(i)||!s.tasks[i]?.unlocked)return 0;
  const q=TASKS[i],first=taskCost(s,i),n=affordableLevels(first,q.costGrowth,budget,Math.min(max,1000000-s.tasks[i].level));
  if(!n||!spend(s,seriesCost(first,q.costGrowth,n)))return 0;
  s.tasks[i].level+=n;s.lastAction=`升级「${q.name}」 +${n}`;return n;
}
export function buyTraining(s,budget=s.coins,max=1) {
  const first=trainingCost(s),n=affordableLevels(first,TRAIN_GROWTH,budget,Math.min(max,1000000-s.training));
  if(!n||!spend(s,seriesCost(first,TRAIN_GROWTH,n)))return 0;
  s.training+=n;s.lastAction=`全军训练 +${n}`;return n;
}
export function buyModel(s,id) {
  const m=ROSTER.models.find(m=>m.id===id);
  if(!m||s.models.includes(id)||s.maxStage<m.unlockStage||!spend(s,amount(m.cost)))return false;
  s.models.push(id);s.lastAction=`招募 ${m.name}`;record(s,'recruit',m.name+' 加入军团');return true;
}
export function distillGain(s) {
  return s.runMaxStage<40 ? amount(0) : fromLog(Math.log10(s.runMaxStage/20)+(s.runMaxStage-40)*.014);
}
export function canDistill(s) { return s.time-s.runStart>=30000 && distillGain(s)[0]>0; }
export function distill(s) {
  if(!canDistill(s))return false;
  const gain=distillGain(s);s.weights=add(s.weights,gain);s.generation++;s.distillCount++;
  s.coins=amount(0);s.stage=1;s.hp=enemyHP(1);s.runMaxStage=0;s.training=0;s.runStart=s.time;
  s.tasks=s.tasks.map((q,i)=>({unlocked:q.unlocked,level:i===0?1:0,phase:0}));
  s.actionAt=s.time+500;s.lastPrestigeCheck=s.time;s.lastProbeStage=0;s.lastProbeIncome=0;
  record(s,'distill',`第 ${s.generation} 代上线，模型与任务解锁全部保留`);
  s.lastAction='蒸馏完成，免费初始任务已启动';return true;
}

function taskProduction(s,dt) {
  for(let i=0;i<TASKS.length;i++){
    const q=s.tasks[i];if(!q.level)continue;
    const time=q.phase+dt,cycles=Math.floor((time+1e-7)/TASKS[i].periodMs);
    q.phase=Math.max(0,time-cycles*TASKS[i].periodMs);
    if(cycles){const earned=scale(taskReward(s,i),cycles);s.coins=add(s.coins,earned);s.earned=add(s.earned,earned);s.completedTasks=add(s.completedTasks,amount(cycles));}
  }
}
function advanceBattle(s,dt) {
  let dmg=scale(totalPower(s),dt/1000);if(!dmg[0])return;
  if(compare(dmg,s.hp)<0){s.hp=subtract(s.hp,dmg);return;}
  dmg=subtract(dmg,s.hp);s.stage++;
  // Sum a geometric run of enemy health, not thousands of individual attacks.
  const next=enemyHP(s.stage);
  let n=Math.max(0,Math.floor(log(add(amount(1),scale(divide(dmg,next),HP_GROWTH-1)))/Math.log10(HP_GROWTH)+1e-9));
  while(n>0&&compare(seriesCost(next,HP_GROWTH,n),dmg)>0)n--;
  dmg=subtract(dmg,seriesCost(next,HP_GROWTH,n));s.stage+=n;s.hp=subtract(enemyHP(s.stage),dmg);
  if(!s.hp[0]){s.stage++;s.hp=enemyHP(s.stage);}
  s.runMaxStage=Math.max(s.runMaxStage,s.stage-1);s.maxStage=Math.max(s.maxStage,s.runMaxStage);
}
function eventBoundary(s) {
  if(s.event&&s.time>=s.event.until){s.event=null;s.actionAt=Math.min(s.actionAt,s.time);}
  if(s.time>=s.nextEventAt){
    const owned=new Set(ROSTER.models.filter(m=>s.models.includes(m.id)).map(m=>m.vendor));
    const pool=EVENTS.filter(e=>owned.has(e.vendor));const event=pool[Math.floor(random(s)*pool.length)];
    s.event={id:event.id,until:s.time+event.durationMs};
    s.nextEventAt=s.time+EVENT_GAP+Math.floor(random(s)*120000);
    record(s,'event',event.name);s.actionAt=Math.min(s.actionAt,s.time);
  }
}
function findEconomicUpgrade(s) {
  let index=-1,bestScore=Infinity;
  for(let i=0;i<TASKS.length;i++) {
    const t=s.tasks[i],q=TASKS[i],l=t.level;
    if(!t.unlocked||l>=1000000)continue;
    const rewardLog=l===0?Math.log10(q.baseReward):Math.log10(q.baseReward)+(l-1)*Math.log10(q.rewardGrowth)+Math.floor(l/25)*Math.log10(2)+Math.log10(q.rewardGrowth*((l+1)%25===0?2:1)-1);
    const score=Math.log10(q.baseCost)+l*Math.log10(q.costGrowth)-rewardLog+Math.log10(q.periodMs/1000);
    if(score<bestScore){index=i;bestScore=score;}
  }
  return index<0?null:{i:index,score:bestScore,cost:taskCost(s,index)};
}
function planAuto(s) {
  // Recruit before optional upgrades; short savings horizons prevent starvation.
  const next=ROSTER.models.filter(m=>!s.models.includes(m.id)&&s.maxStage>=m.unlockStage).sort((a,b)=>a.cost-b.cost)[0];
  if(next){
    if(compare(s.coins,amount(next.cost))>=0)buyModel(s,next.id);
    else if(ratio(subtract(amount(next.cost),s.coins),income(s))<45){s.lastAction='正在攒钱招募 '+next.name;return amount(next.cost);}
  }
  const inactive=TASKS.map((q,i)=>({q,i})).filter(({i})=>s.tasks[i].unlocked&&!s.tasks[i].level)[0];
  if(inactive){
    const c=taskCost(s,inactive.i);
    if(compare(s.coins,c)>=0)buyTask(s,inactive.i,s.coins,1);
    else if(ratio(subtract(c,s.coins),income(s))<35){s.lastAction='正在启动「'+inactive.q.name+'」';return c;}
  }
  // Keep some savings when an expensive model is in view. The rest still grows production.
  const budget=next?scale(s.coins,.65):[...s.coins];
  const eco=findEconomicUpgrade(s);
  const slow=ratio(s.hp,totalPower(s))>3;
  if(eco)buyTask(s,eco.i,scale(budget,slow?.6:.85),10000);
  if(slow)buyTraining(s,scale(s.coins,.65),10000);
  const econ=findEconomicUpgrade(s);
  const econTarget=econ?scale(econ.cost,1/((slow?.6:.85)*(next?.65:1))):fromLog(300);
  const trainTarget=scale(trainingCost(s),1/.65);
  return slow&&compare(trainTarget,econTarget)<0?trainTarget:econTarget;
}
function considerDistill(s,options) {
  if(options.probe||!s.autoDistill||s.time-s.lastPrestigeCheck<120000||s.time-s.runStart<180000||!canDistill(s))return;
  s.lastPrestigeCheck=s.time;
  const future={...s,weights:add(s.weights,distillGain(s))};
  if(ratio(weightMultiplier(future),weightMultiplier(s))<1.2||ratio(s.hp,totalPower(s))<12)return;
  const incomeLog=log(income(s));
  if(s.runMaxStage<s.lastProbeStage+5&&incomeLog<s.lastProbeIncome+.12)return;
  s.lastProbeStage=s.runMaxStage;s.lastProbeIncome=incomeLog;
  // Evaluate an actual bounded rollout, not an assertion that resetting must help.
  const shadow=structuredClone(s),oldStage=s.runMaxStage;
  if(!distill(shadow))return;
  shadow.autoDistill=false;shadow.auto=true;
  const horizon=Math.min(3600000,(s.time-s.runStart)*.5);
  const result=advance(shadow,shadow.time+horizon,{probe:true,maxEvents:4000});
  if(shadow.runMaxStage>=oldStage+3&&compare(totalPower(shadow),totalPower(s))>0)distill(s);
}
function act(s,options) {
  unlock(s);considerDistill(s,options);
  let target=amount(1);
  if(s.auto)target=planAuto(s);
  // The next investment is an economic event. Never simulate every frame/second.
  const wait=ratio(subtract(target,s.coins),income(s))*1000;
  s.actionAt=s.time+(s.auto?Math.max(1000,Math.min(120000,Math.ceil(wait/100)*100||1000)):30000);
}
/** Mutates a snapshot deterministically. Resume until done; each call has a work budget. */
export function advance(s,target,{maxEvents=10000,probe=false}={}) {
  if(!Number.isFinite(target)||target<s.time)throw new RangeError('Cannot reverse game time');
  let steps=0;
  while(s.time<target||s.actionAt<=s.time){
    if(steps>=maxEvents)return {done:false,steps};
    eventBoundary(s);
    if(s.actionAt<=s.time){act(s,{probe});steps++;}
    if(s.time>=target)break;
    const end=Math.min(target,s.actionAt,s.nextEventAt,s.event?.until??Infinity);
    const dt=end-s.time;
    if(dt<=0)throw new Error('Scheduler failed to advance');
    taskProduction(s,dt);advanceBattle(s,dt);s.time=end;steps++;
  }
  return {done:true,steps};
}

export function validateState(s) {
  if(!s||s.version!==SAVE_VERSION)throw new Error('存档版本不受支持');
  for(const k of ['coins','weights','earned','hp','completedTasks'])if(!valid(s[k]))throw new Error('存档数值无效：'+k);
  for(const k of ['time','runStart','actionAt','nextEventAt','lastPrestigeCheck'])if(!Number.isFinite(s[k])||s[k]<0||s[k]>1e15)throw new Error('存档时间无效：'+k);
  for(const k of ['generation','stage','maxStage','runMaxStage','training','distillCount','rng'])if(!Number.isSafeInteger(s[k])||s[k]<0)throw new Error('存档计数无效：'+k);
  if(!Number.isSafeInteger(s.lastProbeStage)||s.lastProbeStage<0||!Number.isFinite(s.lastProbeIncome))throw new Error('蒸馏检查点无效');
  if(s.stage<1||s.generation<1||s.training>1000000||s.stage>1e9||s.maxStage>1e9||s.rng>4294967295)throw new Error('存档超出范围');
  if(s.actionAt<s.time||s.nextEventAt<s.time||s.runStart>s.time||s.lastPrestigeCheck>s.time||s.maxStage<s.runMaxStage||s.runMaxStage<s.stage-1)throw new Error('存档状态不一致');
  if(!Array.isArray(s.tasks)||s.tasks.length!==TASKS.length)throw new Error('任务清单不匹配');
  s.tasks.forEach((t,i)=>{if(!t||!Number.isInteger(t.level)||t.level<0||t.level>1000000||typeof t.unlocked!=='boolean'||!Number.isFinite(t.phase)||t.phase<0||t.phase>=TASKS[i].periodMs||(!t.unlocked&&t.level))throw new Error('任务状态无效');});
  if(!s.tasks[0].level||!s.tasks[0].unlocked)throw new Error('初始任务缺失');
  if(!Array.isArray(s.models)||s.models.length>ROSTER.models.length||new Set(s.models).size!==s.models.length||!s.models.includes(ROSTER.models[0].id)||s.models.some(id=>!ROSTER.models.some(m=>m.id===id)))throw new Error('军团清单无效');
  for(const k of ['auto','autoDistill','paused'])if(typeof s[k]!=='boolean')throw new Error('存档开关无效');
  if(s.event&&(!EVENTS.some(e=>e.id===s.event.id)||!Number.isFinite(s.event.until)||s.event.until<s.time||s.event.until>s.time+120000))throw new Error('事件状态无效');
  if(!Array.isArray(s.logs)||s.logs.length>60||s.logs.some(l=>!l||typeof l.text!=='string'||l.text.length>200||typeof l.kind!=='string'||!Number.isFinite(l.at)||l.at<0||l.at>s.time)||typeof s.lastAction!=='string'||s.lastAction.length>200)throw new Error('日志状态无效');
  return s;
}
export function makeSave(s,wallTime) {
  validateState(s);if(!Number.isFinite(wallTime)||wallTime<0)throw new Error('Invalid wall time');
  return JSON.stringify({format:'token-war-save',version:SAVE_VERSION,gameVersion:GAME_VERSION,savedAt:wallTime,state:s});
}
export function readSave(text) {
  if(typeof text!=='string'||text.length>200000)throw new Error('存档文件过大或无效');
  const o=JSON.parse(text);
  if(o.format!=='token-war-save'||o.version!==SAVE_VERSION||!Number.isFinite(o.savedAt)||o.savedAt<0)throw new Error('不是有效的 Token War 存档');
  // v0.5.0 changed the free starter from gpt35 to DeepSeek-V4.1-Flash.
  // Add the new starter to old rosters without touching any existing model.
  if(Array.isArray(o.state?.models)&&o.state.models.includes('gpt35')&&!o.state.models.includes(ROSTER.models[0].id))
    o.state.models.unshift(ROSTER.models[0].id);
  validateState(o.state);return o;
}
export function offlineElapsed(savedAt,now,paused=false) {
  if(!Number.isFinite(now)||!Number.isFinite(savedAt))return 0;
  return paused?0:Math.min(MAX_OFFLINE_MS,Math.max(0,now-savedAt));
}
