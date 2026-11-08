import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {createGame,advance,totalPower,income,validateState} from '../lib/game.js';
import {format} from '../lib/amount.js';
const periods=[60,300,600,1800,3600,86400];
if(process.argv.includes('--long'))periods.push(7*86400,30*86400);
const s=createGame(),rows=[];let events=0;const begin=performance.now();
for(const sec of periods){
 const start=performance.now();let r;
 do{r=advance(s,sec*1000,{maxEvents:20000});events+=r.steps;}while(!r.done);
 validateState(s);
 const row={seconds:sec,generation:s.generation,maxStage:s.maxStage,currentStage:s.stage,models:s.models.length,activeTasks:s.tasks.filter(t=>t.level>0).length,training:s.training,coins:format(s.coins),income:format(income(s)),power:format(totalPower(s)),weights:format(s.weights),computeMs:Math.round((performance.now()-start)*100)/100};
 rows.push(row);console.log(row);
}
await writeFile(new URL('../reports/simulation.json',import.meta.url),JSON.stringify({gameVersion:'0.1.0',node:process.version,seed:20261107,events,wallMs:performance.now()-begin,rows},null,2));
