import {amount,format,ratio,compare,scale} from './amount.js';
import {TASKS,ROSTER,EVENTS,CATALOG} from './config.js';
import {createGame,advance,enemyHP,totalPower,vendorPowers,income,taskCost,taskReward,trainingCost,buyTask,buyModel,buyTraining,weightMultiplier,distillGain,canDistill,distill,currentEvent,makeSave,readSave,offlineElapsed,GAME_VERSION} from './game.js';
import {selectFrame,drawFrame} from './animation.js';
import {resolveClip} from './playback.js';
import {createStore,SAVE_KEY,LOCK_KEY,SIGNAL_KEY} from './storage.js';

const ENEMY_NAMES=['修复一个不存在的 Bug','需求方还有一点小修改','上下文溢出','无限重试','把按钮左移两个像素','最后一版_FINAL_v9'];
const VENDOR_LABELS={chatgpt:'OpenAI',deepseek:'DeepSeek',claude:'Anthropic',gemini:'Google',qwen:'Qwen'};
const VENDOR_COLORS={chatgpt:'#cfbbe9',deepseek:'#6ec5ff',claude:'#e3a06a',gemini:'#bc9df8',qwen:'#8fabed'};
const VENDOR_TEXT={chatgpt:'#E2C8FF',deepseek:'#7FD3FF',claude:'#FFB57C',gemini:'#D6B8FF',qwen:'#A9BEFF'};
const esc=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const timeLabel=ms=>ms>=86400000?(ms/86400000).toFixed(1)+' 天':ms>=3600000?(ms/3600000).toFixed(1)+' 小时':ms>=60000?Math.floor(ms/60000)+' 分钟':Math.floor(ms/1000)+' 秒';
const clockLabel=ms=>{const m=Math.floor(ms/60000),sec=Math.floor(ms%60000/1000);if(m>=1440)return (m/1440).toFixed(1)+'d';if(m>=1000)return Math.round(m/60)+'h';return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');};
const COMPACT_SUFFIXES=['','K','M','B','T','Qa','Qi'];
/** 行内专用压缩格式：尾数 ≤4 字符 + 单位（如 388Qa / 1.24Qa），仅影响显示。 */
const compact=value=>{
  if(!value||!value[0])return '0';
  const [m,e]=value;
  if(e<3){const n=m*10**e;return n<10?(+n.toFixed(2)).toString():n<1000?(+n.toFixed(1)).toString():String(Math.round(n));}
  const group=Math.floor(e/3),unit=COMPACT_SUFFIXES[group];
  if(!unit)return m.toFixed(1)+'e'+e;
  const mm=m*10**(e%3);
  const body=mm<10?(+mm.toFixed(2)).toString():mm<100?(+mm.toFixed(1)).toString():String(Math.round(mm));
  return body+unit;
};
/** 军团行按厂商分组展示（同厂商相邻），行内不再重复厂商标题。 */
const ARMY_MODELS=[...ROSTER.models].sort((a,b)=>ROSTER.enabledVendors.indexOf(a.vendor)-ROSTER.enabledVendors.indexOf(b.vendor)||a.unlockStage-b.unlockStage);
const TASK_ROW_H=36,ARMY_ROW_H=34,LOG_PAGE_SIZE=12;
const HELP_PAGES=[
  '<p><b>这是什么。</b>Token War 是等待 Agent 时打发时间的小游戏：任务自动循环产出 Token，自动投资任务、招募模型、训练军团并推关。默认全自动，不需要持续操作；点数几下的手动介入也随时可以。</p><p><b>为什么收益和画面无关。</b>Token、关卡、事件与蒸馏只由存档状态和经过的时间决定，画面帧率只影响绘制。切走面板或把页面放到后台后，本插件会停止绘制与经济定时器；回来时按同一套规则补算离开期间的成长（一次最多结算 30 天）。</p>',
  '<p><b>暂停与结算。</b>「暂停」暂停的是游戏时间，不是画面：暂停期间不产出也不推关。暂停状态会存档，刷新或切回面板后保持。</p><p><b>蒸馏。</b>蒸馏重置本代 Token、任务等级、关卡与本代训练，永久保留已招募模型、任务解锁、累计权重和世代编号，下一代从更强起点开始。自动蒸馏会先用有界试算确认收益再决定重启；手动蒸馏需要二次确认。</p>',
  '<p><b>存档。</b>进度只写本机 localStorage，每 10 秒、隐藏页面和关键操作时保存；多窗口时只有一个窗口可写，其他窗口只读，关闭写者后自动接管。切换入口（独立 HTML / DSH 面板）时用「导出存档 / 导入存档」转移进度。</p><p><b>隐私。</b>纯本地运行：不读取会话或工作区，不调用模型或付费 API，不发送网络请求，也不设置遥测。</p>'
];

/** One mount owns all game work; dispose/visibility fully stop scheduling. No remote calls. */
export function mountGame(root,{assetData={},hostNotice=null}={}) {
  root.classList.add('tw-app');
  const doc=root.ownerDocument,win=doc.defaultView;
  let local;try{local=win.localStorage;}catch{local={getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}};}
  const store=createStore(local),owner=win.crypto?.randomUUID?.()||String(Math.random());
  let s=createGame(),wall=Date.now(),held=false,disposed=false,acquiring=false,releaseWeb=null;
  let visible=true,intersecting=true,catching=false,epoch=0,tabW='tasks',lastRenderedStage=1;
  let taskPage=0,taskRows=6,armyPage=0,armyRows=5,armyOpen=false;
  let drawerOpen=false,drawerTab='save',logPage=0,helpPage=0,lastLogKey='';
  let noticeMessage='',dismissedSession='';
  let layout={w:0,h:0,size:'wide',tall:true,battleH:0};
  let cssW=0,cssH=0,dprCur=1,halftonePattern=null;
  let drawTimer=0,raf=0,logicTimer=0,catchTimer=0,lastSave=0,frameCounter=0,logicCounter=0,drawMs=0,drawMax=0;
  let animationTime=0,lastDrawAt=0,lastLease=0;
  let fps=win.matchMedia?.('(prefers-reduced-motion: reduce)').matches?6:12;
  const images=new Map(),loadPromises=new Map();
  let requestConfirm=null,pendingImport=null,storageWarning='';
  const renderStats={drawCount:0,logicCount:0,active:false,owner:false,catching:false,loadedAtlases:0,meanDrawMs:0,maxDrawMs:0};
  const taskRowsHtml=TASKS.map((q,i)=>`<div class="tw-task-row" data-task="${i}" data-testid="task-row" hidden><span class="tw-task-num">${String(i+1).padStart(2,'0')}</span><span class="tw-task-name" data-field="name" title="${esc(q.name)}">${esc(q.name)}</span><span class="tw-task-lv" data-field="level">待启动</span><span class="tw-task-bar" title="本周期进度"><i data-field="progress"></i></span><span class="tw-task-reward"><b data-field="reward">0</b><small>/${q.periodMs/1000}s</small></span><button class="tw-up" data-upgrade="${i}" title="升级"><span data-field="verb">启动</span><span data-field="cost">0</span></button></div>`).join('');
  const armyRowsHtml=ARMY_MODELS.map(m=>`<div class="tw-army-row" data-model="${m.id}" data-testid="army-row" hidden><span class="tw-vendor-badge" style="--vc:${VENDOR_COLORS[m.vendor]}">${m.vendor.slice(0,2).toUpperCase()}</span><span class="tw-army-name">${esc(m.name)}<small>${esc(m.tag)}</small></span><span class="tw-army-power" title="基础算力">${format(amount(m.power))}</span><button class="tw-army-btn" data-recruit="${m.id}">…</button></div>`).join('');
  root.dataset.size='wide';root.dataset.h='tall';
  root.innerHTML=`
    <header class="tw-statusbar" data-testid="status-bar">
      <div class="tw-metric tw-metric-coins"><span class="tw-metric-label">TOKEN 储备</span><strong class="tw-metric-value" data-value="coins" data-testid="token-balance">0</strong></div>
      <div class="tw-metric tw-metric-sm tw-income"><span class="tw-metric-label">收益 / 秒</span><strong class="tw-metric-value" data-value="income" data-testid="income-rate">0</strong></div>
      <div class="tw-metric tw-metric-sm tw-metric-stage"><span class="tw-metric-label">关卡</span><strong class="tw-metric-value" data-value="stage" data-testid="stage-value">1</strong><span class="tw-stage-track" title="当前关卡进度"><i data-field="stageProgress"></i></span></div>
      <div class="tw-status-actions">
        <span class="tw-run" data-role="status" data-state="running"><i class="tw-dot"></i><span data-role="statusText">自动运行</span></span>
        <button data-testid="run-toggle" data-action="pause" title="暂停 / 继续游戏时间">暂停</button>
        <button class="tw-btn-log" data-action="drawer" data-drawer="log" title="运行记录">记录</button>
        <button data-action="drawer" data-drawer="save" title="存档、设置与帮助">存档/设置</button>
      </div>
    </header>
    <div class="tw-notice-rail" data-testid="notice-rail">
      <div class="tw-rail-item" data-kind="agent" data-role="session" data-testid="agent-notice" hidden><span class="tw-rail-icon">●</span><span class="tw-rail-text" data-role="sessionText"></span><button class="tw-rail-btn primary" data-testid="agent-notice-open" data-action="session">返回会话</button><button class="tw-rail-x" data-action="dismiss-session" title="关闭提醒" aria-label="关闭提醒">×</button></div>
      <div class="tw-rail-item" data-kind="notice" data-role="notice" hidden><span class="tw-rail-icon">▲</span><span class="tw-rail-text" data-role="noticeText"></span><button class="tw-rail-btn" data-action="dismiss">知道了</button></div>
      <div class="tw-rail-item" data-kind="event" data-testid="event-label" data-role="eventLine"><span class="tw-rail-icon">◆</span><span class="tw-rail-text" data-role="eventText">自动运行中 · 暂无厂商事件</span></div>
    </div>
    <div class="tw-battlefield" data-testid="battlefield"><div class="tw-newsbar" data-testid="news-bar"><span class="tw-news-tag">要闻：</span><span class="tw-news-text" data-role="newsText">暂无厂商事件 · 军团正在自动推进</span></div><canvas class="tw-canvas" width="1024" height="300" aria-label="模型军团自动战斗画面"></canvas></div>
    <div class="tw-workspace" data-testid="workspace">
      <nav class="tw-ws-tabs" data-role="wsTabs" aria-label="信息区切换"><button data-wtab="tasks" class="active">任务</button><button data-wtab="army">军团</button><button data-wtab="distill">蒸馏</button></nav>
      <section class="tw-panel tw-tasks" data-testid="tasks-panel" data-role="tasksPanel">
        <div class="tw-panel-head"><span class="tw-panel-title">任务生产</span><span class="tw-panel-summary" data-testid="tasks-summary" data-value="tasksSummary">运行 1/20 · +0/s</span><label class="tw-toggle"><input type="checkbox" data-control="auto" data-testid="auto-toggle" checked>自动经营</label></div>
        <div class="tw-task-list" data-role="taskList">${taskRowsHtml}</div>
        <div class="tw-task-foot"><span class="tw-next" data-role="nextTask">下一项：…</span><div class="tw-pager"><button data-task-page="prev" data-testid="task-page-prev" title="上一页">‹</button><span class="tw-page-info" data-testid="task-page-info" data-value="taskPageInfo">1 / 1</span><button data-task-page="next" data-testid="task-page-next" title="下一页">›</button></div></div>
      </section>
      <div class="tw-side-col" data-role="sideCol">
        <section class="tw-panel tw-army" data-testid="army-panel" data-role="armyPanel" data-open="false">
          <div class="tw-panel-head"><span class="tw-panel-title">模型军团</span><span class="tw-panel-summary" data-testid="army-summary" data-value="armySummary">已招募 1/10 · 算力 5</span><button class="tw-panel-toggle" data-action="toggle-army" data-testid="army-expand" title="展开 / 收起军团">展开</button></div>
          <div class="tw-panel-body" data-role="armyBody" hidden>
            <div class="tw-army-bar"><span data-value="armyTraining">本代训练 Lv.0</span><button class="small" data-action="train" data-testid="train-button" title="用 Token 提升全军训练等级">全军训练</button></div>
            <div class="tw-army-list" data-role="armyList">${armyRowsHtml}</div>
            <div class="tw-task-foot"><span class="tw-next" data-role="armyFootText">同厂商共用角色 · 价格是游戏平衡值</span><div class="tw-pager"><button data-army-page="prev" data-testid="army-page-prev" title="上一页">‹</button><span class="tw-page-info" data-testid="army-page-info" data-value="armyPageInfo">1 / 1</span><button data-army-page="next" data-testid="army-page-next" title="下一页">›</button></div></div>
          </div>
        </section>
        <section class="tw-panel tw-distill" data-testid="distill-panel" data-role="distillPanel">
          <div class="tw-panel-head"><span class="tw-panel-title">蒸馏与传承</span><span class="tw-panel-summary" data-testid="distill-summary" data-value="distillSummary">第 1 代 · 自动开</span></div>
          <div class="tw-panel-body tw-distill-body" data-role="distillBody">
            <div class="tw-gen-line"><span class="tw-gen" data-value="gen">GEN 001</span><span class="tw-chip" data-value="multiplier">×1</span></div>
            <div class="tw-kv-row"><div class="tw-kv-cell"><span>累计权重</span><b data-value="weights">0</b></div><div class="tw-kv-cell"><span>本次可获</span><b data-value="gain">+0</b></div><div class="tw-kv-cell"><span>本代训练</span><b data-value="training">Lv.0</b></div></div>
            <div class="tw-kv-row"><div class="tw-kv-cell"><span>本代最高</span><b data-value="runMaxStage">0</b></div><div class="tw-kv-cell"><span>已蒸馏</span><b data-value="distillCount">0 次</b></div><div class="tw-kv-cell"><span>累计产出</span><b data-value="earned">0</b></div></div>
            <p class="tw-hint" data-value="distillHint">第 40 关起开放 · 本代至少运行 30 秒</p>
            <p class="tw-hint tw-distill-desc">蒸馏重置本代 Token、任务等级、关卡与本代训练；永久保留已招募模型、任务解锁、累计权重与世代编号。</p>
            <div class="tw-distill-actions"><label class="tw-toggle"><input type="checkbox" data-control="distill" data-testid="distill-auto-toggle" checked>自动蒸馏</label><button class="primary" data-action="distill" title="重置本代经济，保留模型与任务解锁">蒸馏到下一代</button></div>
            <div class="tw-distill-note">
              <div class="tw-side-line"><span class="tw-side-key">本代</span><span class="tw-side-text" data-value="runDuration">—</span><span class="tw-side-meta" data-value="nextEventHint">—</span></div>
              <div class="tw-side-line"><span class="tw-side-key">最近</span><span class="tw-side-text" data-value="lastLog">—</span></div>
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>
    <footer class="tw-footer"><span>v${GAME_VERSION}</span></footer>
    <div class="tw-drawer-backdrop" data-role="drawerBackdrop" hidden>
      <div class="tw-drawer" data-testid="drawer" role="dialog" aria-modal="true" aria-label="存档、设置、帮助与记录">
        <div class="tw-drawer-head">
          <nav class="tw-drawer-tabs" data-role="drawerTabs"><button data-drawer-tab="save" data-testid="tab-save">存档</button><button data-drawer-tab="settings" data-testid="tab-settings">设置</button><button data-drawer-tab="help" data-testid="tab-help">帮助</button><button data-drawer-tab="log" data-testid="tab-log">记录</button></nav>
          <button class="small" data-testid="drawer-close" data-action="close-drawer" title="关闭 (Esc)" aria-label="关闭">×</button>
        </div>
        <div class="tw-drawer-body">
          <div class="tw-drawer-pane" data-drawer-pane="save">
            <div class="tw-kv"><span>存档状态</span><b data-value="saveStatus">自动保存</b></div>
            <p class="tw-minihelp" data-value="saveHint">自动保存到本机浏览器；切换入口请用导出 / 导入。</p>
            <div class="tw-drawer-actions"><button class="primary" data-testid="save-export" data-action="save">导出存档</button><button data-testid="save-import" data-action="import">导入存档</button></div>
            <div class="tw-divider"></div>
            <div class="tw-kv"><span>游戏版本</span><b>v${GAME_VERSION}</b></div>
            <p class="tw-minihelp">重置只影响 Token War 本机进度，不影响 DSH 或任何工作文件；当前进度会保留在自动备份中。</p>
            <div class="tw-drawer-actions"><button class="danger" data-testid="reset-save" data-action="reset">重置本机存档</button><button data-action="takeover" data-role="takeover" hidden>接管运行权</button></div>
          </div>
          <div class="tw-drawer-pane" data-drawer-pane="settings" hidden>
            <label class="tw-toggle"><input type="checkbox" data-control="auto2" checked>自动经营（任务与军团自动投资）</label>
            <label class="tw-toggle"><input type="checkbox" data-control="distill2" checked>自动蒸馏（先有界试算，再决定重启）</label>
            <div class="tw-kv"><span>动画帧率</span><b><button class="small" data-testid="quality-toggle" data-action="quality">12 FPS · 节能</button></b></div>
            <p class="tw-minihelp">帧率只影响画面，不影响收益。系统开启「减少动效」时默认 6 FPS；隐藏面板会完全停止绘制与调度。</p>
            <p class="tw-minihelp">全部设置只保存在本机，不发送网络请求。</p>
          </div>
          <div class="tw-drawer-pane" data-drawer-pane="help" hidden>
            <div class="tw-help-text" data-role="helpText"></div>
            <div class="tw-pager tw-pager-right"><button data-help-page="prev" title="上一页">‹</button><span class="tw-page-info" data-value="helpPageInfo">1 / 3</span><button data-help-page="next" title="下一页">›</button></div>
          </div>
          <div class="tw-drawer-pane" data-drawer-pane="log" hidden>
            <div class="tw-log-list" data-role="logList"></div>
            <div class="tw-pager tw-pager-right"><button data-log-page="prev" title="上一页">‹</button><span class="tw-page-info" data-value="logPageInfo">1 / 1</span><button data-log-page="next" title="下一页">›</button></div>
          </div>
        </div>
      </div>
    </div>
    <div class="tw-modal" data-role="confirm" data-testid="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="tw-dialog-title" hidden><div class="tw-modal-box"><h3 id="tw-dialog-title"></h3><p data-role="confirmText"></p><div class="tw-modal-actions"><button data-action="cancel" data-testid="confirm-cancel">取消</button><button class="primary" data-action="confirm" data-testid="confirm-ok">确认</button></div></div></div>
    <div class="tw-modal tw-catchup" data-role="catchup" hidden><div class="tw-modal-box"><div class="tw-note-title">RESTORING PROGRESS</div><h3>军团正在汇报离线成果</h3><p data-role="catchupText">正在结算经过的时间…</p><div class="tw-progress"><i></i></div><p class="tw-minihelp">采用同一套规则分段计算；不会重播战斗动画。</p></div></div>
    <input type="file" accept="application/json,.json" data-role="file" hidden>`;
  const $=q=>root.querySelector(q);
  const canvas=$('canvas'),ctx=canvas.getContext('2d');
  const values={};
  for(const el of root.querySelectorAll('[data-value]')){(values[el.dataset.value]||(values[el.dataset.value]=[])).push(el);}
  const set=(k,v)=>{const list=values[k];if(!list)return;const t=String(v);for(const el of list)if(el.textContent!==t)el.textContent=t;};
  const UI={
    status:$('[data-role=status]'),statusText:$('[data-role=statusText]'),pauseBtn:$('[data-action=pause]'),
    session:$('[data-role=session]'),sessionText:$('[data-role=sessionText]'),notice:$('[data-role=notice]'),noticeText:$('[data-role=noticeText]'),eventLine:$('[data-role=eventLine]'),eventText:$('[data-role=eventText]'),
    battle:$('.tw-battlefield'),newsText:$('[data-role=newsText]'),tabs:$('[data-role=wsTabs]'),tasksPanel:$('[data-role=tasksPanel]'),sideCol:$('[data-role=sideCol]'),
    taskList:$('[data-role=taskList]'),nextTask:$('[data-role=nextTask]'),taskPrev:$('[data-testid=task-page-prev]'),taskNext:$('[data-testid=task-page-next]'),
    armyPanel:$('[data-role=armyPanel]'),armySummary:$('[data-testid=army-summary]'),armyToggle:$('[data-testid=army-expand]'),armyBody:$('[data-role=armyBody]'),armyList:$('[data-role=armyList]'),armyPrev:$('[data-testid=army-page-prev]'),armyNext:$('[data-testid=army-page-next]'),trainBtn:$('[data-action=train]'),
    distillPanel:$('[data-role=distillPanel]'),distillSummary:$('[data-testid=distill-summary]'),distillBody:$('[data-role=distillBody]'),distillBtn:$('[data-action=distill]'),
    backdrop:$('[data-role=drawerBackdrop]'),drawerTabs:$('[data-role=drawerTabs]'),helpText:$('[data-role=helpText]'),logList:$('[data-role=logList]'),logPrev:$('[data-log-page=prev]'),logNext:$('[data-log-page=next]'),
    confirm:$('[data-role=confirm]'),dialogTitle:$('#tw-dialog-title'),confirmText:$('[data-role=confirmText]'),
    catchup:$('[data-role=catchup]'),catchupText:$('[data-role=catchupText]'),takeover:$('[data-role=takeover]'),qualityBtn:$('[data-testid=quality-toggle]'),stageProgress:$('[data-field=stageProgress]')
  };
  const taskNodes=[...root.querySelectorAll('[data-task]')].map(el=>({el,level:el.querySelector('[data-field=level]'),reward:el.querySelector('[data-field=reward]'),cost:el.querySelector('[data-field=cost]'),verb:el.querySelector('[data-field=verb]'),progress:el.querySelector('[data-field=progress]'),button:el.querySelector('button')}));
  const armyNodes=[...root.querySelectorAll('[data-model]')].map(el=>({el,power:el.querySelector('.tw-army-power'),button:el.querySelector('button')}));

  function showNotice(text){noticeMessage=text||'';renderRail();}
  function renderRail(){
    const notice=hostNotice?.text&&hostNotice.text!==dismissedSession?hostNotice:null;
    UI.session.hidden=!notice;if(notice)UI.sessionText.textContent=notice.text;
    UI.notice.hidden=!!notice||!noticeMessage;if(noticeMessage)UI.noticeText.textContent=noticeMessage;
    UI.eventLine.hidden=!!notice||!!noticeMessage;
  }
  function showConfirm(title,text,callback){requestConfirm=callback;UI.confirm.hidden=false;UI.dialogTitle.textContent=title;UI.confirmText.textContent=text;UI.confirm.querySelector('[data-testid=confirm-cancel]').focus();}
  function closeConfirm(clearPending=true){requestConfirm=null;if(clearPending)pendingImport=null;UI.confirm.hidden=true;}
  function applyControl(fn){if(!held||catching)return;tick();if(catching)return;fn();s.actionAt=Math.min(s.actionAt,s.time+500);save(true);updateUI();draw(performance.now());}
  function save(force=false){
    if(!held)return false;
    if(!win.navigator.locks&&!store.owns(owner,Date.now())){deactivate(false);return false;}
    const now=performance.now();if(!force&&now-lastSave<10000)return true;
    lastSave=now;try{const ok=store.save(s,wall);if(!ok)storageWarning='临时存档，请导出备份';else if(store.available)storageWarning='';return ok;}catch(e){showNotice('存档未写入：'+e.message);return false;}
  }
  const bg=doc.createElement('canvas');bg.width=1024;bg.height=300;
  const b=bg.getContext('2d');
  const sky=b.createLinearGradient(0,0,0,300);sky.addColorStop(0,'#0F1116');sky.addColorStop(1,'#151821');b.fillStyle=sky;b.fillRect(0,0,1024,300);
  b.strokeStyle='#ffffff0e';b.lineWidth=1;for(let x=0;x<1024;x+=40){b.beginPath();b.moveTo(x,0);b.lineTo(x,300);b.stroke();}for(let y=0;y<300;y+=40){b.beginPath();b.moveTo(0,y);b.lineTo(1024,y);b.stroke();}
  for(let i=0;i<14;i++){const x=i*83-10,h=40+(i*37%72);b.fillStyle=i%2?'#1A1D24':'#1D2028';b.fillRect(x,235-h,61,h);b.strokeStyle='#8E887B';b.strokeRect(x,235-h,61,h);for(let j=0;j<3;j++){b.fillStyle='#ffffff08';b.fillRect(x+8,245-h+j*14,5,3);b.fillRect(x+18,245-h+j*14,33,3);}}
  b.fillStyle='#14161B';b.fillRect(0,238,1024,62);b.strokeStyle='#E9E3D6';b.beginPath();b.moveTo(0,238);b.lineTo(1024,238);b.stroke();b.strokeStyle='#ffffff12';for(let x=-100;x<1200;x+=90){b.beginPath();b.moveTo(512+(x-512)*.75,239);b.lineTo(x,300);b.stroke();}
  function loadCharacter(id){
    if(images.has(id)||loadPromises.has(id))return;
    const data=assetData[id];if(!data){showNotice('角色图集缺失：'+id);return;}
    const img=new win.Image();
    const promise=new Promise(resolve=>{img.onload=()=>{if(!disposed){images.set(id,img);renderStats.loadedAtlases=images.size;if(visible)draw(performance.now());}resolve();};img.onerror=()=>{showNotice('角色图集读取失败：'+id);resolve();};});
    loadPromises.set(id,promise);img.src=data;
  }
  function draw(now){
    if(disposed||!visible||!ctx||!cssW||!cssH)return;
    const begin=performance.now();
    if(lastDrawAt&&held&&!s.paused&&!catching)animationTime+=Math.max(0,now-lastDrawAt);lastDrawAt=now;
    const W=cssW,H=cssH;
    ctx.setTransform(dprCur,0,0,dprCur,0,0);
    // 16-bit Manual 纸面 + 网点 + 网格
    const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#0F1116');sky.addColorStop(1,'#151821');
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    if(!halftonePattern){const pc=root.ownerDocument.createElement('canvas');pc.width=6;pc.height=6;const px=pc.getContext('2d');px.fillStyle='#ffffff10';px.fillRect(1,1,1,1);halftonePattern=ctx.createPattern(pc,'repeat');}
    ctx.fillStyle=halftonePattern;ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#ffffff0e';ctx.lineWidth=1;
    for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    const groundY=Math.round(H-34),small=H>=150?12:11;
    // 背景建筑（少量，尺寸随区域）
    const blockW=Math.max(46,Math.min(76,W/9)),blockCount=Math.ceil(W/blockW);
    for(let i=0;i<blockCount;i++){
      const bx=i*blockW-4,bh=Math.min(groundY*0.52,16+((i*37)%Math.round(Math.max(10,groundY*0.42))));
      ctx.fillStyle=i%2?'#1A1D24':'#1D2028';ctx.fillRect(bx,groundY-bh,blockW-14,bh);
      ctx.strokeStyle='#8E887B';ctx.lineWidth=1;ctx.strokeRect(bx+.5,groundY-bh+.5,blockW-15,bh-1);
      ctx.fillStyle='#ffffff09';for(let wy=groundY-bh+5;wy<groundY-4;wy+=6)ctx.fillRect(bx+4,wy,Math.max(4,blockW-22),1);
    }
    // 地面 + 透视线
    ctx.fillStyle='#14161B';ctx.fillRect(0,groundY,W,H-groundY);
    ctx.strokeStyle='#E9E3D6';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,groundY+1);ctx.lineTo(W,groundY+1);ctx.stroke();
    ctx.strokeStyle='#ffffff12';ctx.lineWidth=1;
    for(let x=-100;x<W+200;x+=90){ctx.beginPath();ctx.moveTo(W*.5+(x-W*.5)*.75,groundY+1);ctx.lineTo(x,H);ctx.stroke();}
    const ev=currentEvent(s);
    ctx.textAlign='left';ctx.textBaseline='alphabetic';
    // 左侧 70%：最多 5 个角色，尺寸随战场高度
    const owned=ROSTER.enabledVendors.filter(v=>ROSTER.models.some(m=>m.vendor===v&&s.models.includes(m.id)));
    const leftW=W*0.70;
    const charH=Math.max(40,Math.min(H*0.64,groundY-14));
    const scaleC=charH/192;
    const slot=Math.max(56,Math.min(150,leftW/Math.max(1,owned.length)));
    const x0=(leftW-slot*owned.length)/2+slot/2;
    owned.forEach((id,i)=>{
      loadCharacter(id);
      const character=CATALOG.characters.find(c=>c.id===id),image=images.get(id),x=x0+i*slot;
      const t=(animationTime+i*550)%2800;
      const moving=!s.paused&&s.stage!==lastRenderedStage;
      const state=!held||s.paused?'idle':moving?'move':t<600?'attack':'idle';
      const clip=resolveClip(CATALOG,character,state);
      const frame=selectFrame(clip,state==='attack'?t:animationTime+i*350).frame;
      ctx.fillStyle='#00000066';ctx.beginPath();ctx.ellipse(x,groundY-2,Math.max(10,charH*.24),Math.max(2,charH*.05),0,0,Math.PI*2);ctx.fill();
      if(image)drawFrame(ctx,image,CATALOG,frame,x,groundY+1,scaleC);
      else{ctx.fillStyle=VENDOR_COLORS[id];ctx.fillRect(x-charH*.18,groundY-charH*.7,charH*.36,charH*.7);}
      ctx.save();ctx.shadowColor='#000000';ctx.shadowBlur=3;ctx.shadowOffsetY=1;
      ctx.textAlign='center';ctx.font="700 11px 'PingFang SC','Heiti SC',system-ui,sans-serif";ctx.fillStyle=VENDOR_TEXT[id]||VENDOR_COLORS[id];
      ctx.fillText(fitText(VENDOR_LABELS[id],slot-4),x,groundY+14);
      if(H>=112){
        const latest=ROSTER.models.filter(m=>m.vendor===id&&s.models.includes(m.id)).at(-1);
        ctx.globalAlpha=.86;ctx.font="10px 'PingFang SC','Heiti SC',system-ui,sans-serif";ctx.fillStyle=VENDOR_TEXT[id]||VENDOR_COLORS[id];
        ctx.fillText(fitText(latest?latest.name:'',slot-4),x,groundY+26);
        ctx.globalAlpha=1;
      }
      ctx.restore();
      if(ev?.vendor===id){
        ctx.font='11px system-ui,-apple-system,sans-serif';
        ctx.fillStyle=ev.powerMultiplier<1?'#FF8A7A':'#7D93FF';
        ctx.fillText(ev.powerMultiplier<1?'暂时受限':'算力提升',x,Math.max(30,groundY-charH-4));
      }
    });
    // 右侧 26%：敌人 / TODO 任务卡
    const cardW=Math.max(132,Math.round(W*0.26)),cardX=Math.round(W-cardW-12);
    const cardTop=Math.max(26,Math.round(H*0.16)),cardH=Math.max(38,groundY-cardTop-26);
    const boss=s.stage%10===0;
    ctx.save();ctx.shadowColor='#000000';ctx.shadowBlur=3;ctx.shadowOffsetY=1;
    ctx.textAlign='center';ctx.font="700 12px 'PingFang SC','Heiti SC',system-ui,sans-serif";ctx.fillStyle=boss?'#FF8A7A':'#F1EDE2';
    ctx.fillText(fitText(boss?'需求方还有一点小修改':ENEMY_NAMES[Math.floor(s.stage/10)%ENEMY_NAMES.length],cardW),cardX+cardW/2,cardTop-9);
    ctx.restore();
    ctx.fillStyle='#000000';ctx.fillRect(cardX+4,cardTop+4,cardW,cardH);
    ctx.fillStyle=boss?'#221A1A':'#1B1E26';ctx.fillRect(cardX,cardTop,cardW,cardH);
    ctx.strokeStyle='#E9E3D6';ctx.lineWidth=2;ctx.strokeRect(cardX+1,cardTop+1,cardW-2,cardH-2);
    const headerH=Math.min(20,Math.max(14,cardH*.3));
    ctx.fillStyle=boss?'#E74438':'#4D6BFE';ctx.fillRect(cardX+8,cardTop+8,cardW-16,headerH);
    ctx.textAlign='left';ctx.font="700 10px 'PingFang SC','Heiti SC',system-ui,sans-serif";ctx.fillStyle=boss?'#F1EDE2':'#0E0F12';
    ctx.fillText(boss?'FINAL_v9.md':'TODO.md',cardX+13,cardTop+8+headerH-5);
    const lineGap=Math.max(8,Math.round(cardH*.16));let ly=cardTop+8+headerH+lineGap;const lineBase=cardW-40;
    for(let j=0;j<4&&ly<cardTop+cardH-4;j++){
      ctx.fillStyle='#C9C4B7';ctx.fillRect(cardX+13,ly-4,4,4);
      ctx.fillStyle='#C9C4B735';ctx.fillRect(cardX+21,ly-3,Math.max(12,lineBase*(1-j*.15)),2);
      ly+=lineGap;
    }
    // HP / 关卡进度
    const hp=Math.max(0,Math.min(1,ratio(s.hp,enemyHP(s.stage))));
    const barY=cardTop+cardH+8,barH=5;
    ctx.fillStyle='#262932';ctx.fillRect(cardX,barY,cardW,barH);ctx.strokeStyle='#E9E3D6';ctx.lineWidth=1;ctx.strokeRect(cardX+.5,barY+.5,cardW-1,barH-1);
    ctx.fillStyle=boss?'#E74438':'#46E3D2';ctx.fillRect(cardX+1,barY+1,Math.max(0,(cardW-2)*hp),barH-2);
    const labelY=barY+barH+4,labelH=17;
    ctx.fillStyle='#17181D';ctx.fillRect(cardX,labelY,cardW,labelH);
    ctx.strokeStyle='#E9E3D6';ctx.lineWidth=1;ctx.strokeRect(cardX+.5,labelY+.5,cardW-1,labelH-1);
    ctx.textAlign='center';ctx.font="600 10px 'PingFang SC','Heiti SC',system-ui,sans-serif";ctx.fillStyle='#E9E3D6';
    ctx.fillText(`剩余工作量 ${Math.round(hp*100)}% · STAGE ${s.stage}`,cardX+cardW/2,labelY+12);
    lastRenderedStage=s.stage;
    if(s.paused||!held){
      ctx.fillStyle='#0E0F12E6';ctx.fillRect(0,0,W,H);
      ctx.textAlign='center';ctx.fillStyle='#F1EDE2';ctx.font="700 16px 'PingFang SC','Heiti SC',system-ui,sans-serif";
      const msg=s.paused?'已暂停 · 随时继续':'此页面只读 · 另一页面正在运行';
      const mw=ctx.measureText(msg).width;
      ctx.fillStyle='#17181D';ctx.fillRect(W/2-mw/2-14,H/2-24,mw+28,36);ctx.strokeStyle='#E9E3D6';ctx.lineWidth=2;ctx.strokeRect(W/2-mw/2-14,H/2-24,mw+28,36);
      ctx.fillStyle='#F1EDE2';ctx.fillText(msg,W/2,H/2+1);
      ctx.textAlign='left';
    }
    frameCounter++;drawMs+=performance.now()-begin;drawMax=Math.max(drawMax,performance.now()-begin);
    Object.assign(renderStats,{drawCount:frameCounter,meanDrawMs:drawMs/frameCounter,maxDrawMs:drawMax});
  }
  function updateUI(){
    if(disposed)return;
    // 防御：面板尺寸已变但 ResizeObserver 尚未回调（DSH 侧栏收起/窗口拖动/遮挡恢复）时强制重排
    const cw=root.clientWidth,ch=root.clientHeight;
    if(cw>0&&ch>0&&(cw!==layout.w||ch!==layout.h)){relayout();return;}
    const unlocked=s.tasks.reduce((n,q)=>n+(q.unlocked?1:0),0);
    const incomeValue=income(s),powerValue=totalPower(s),ev=currentEvent(s);
    set('coins',format(s.coins));set('income',format(incomeValue));set('stage',String(s.stage));
    const hpRatio=ratio(s.hp,enemyHP(s.stage));
    const frac=Number.isFinite(hpRatio)?Math.max(0,Math.min(1,1-hpRatio)):1;
    UI.stageProgress.style.width=(frac*100).toFixed(1)+'%';
    UI.statusText.textContent=!held?'只读':s.paused?'已暂停':'自动运行';
    UI.status.dataset.state=!held?'readonly':s.paused?'paused':'running';
    UI.pauseBtn.textContent=s.paused?'继续':'暂停';UI.pauseBtn.disabled=!held;
    const storageLabel=!held?'只读':storageWarning?'临时存档':'自动保存';
    set('saveStatus',storageLabel);set('saveShort',storageLabel);
    set('saveHint',!held?'只读页面：另一个页面正在运行，关闭后会自动接管。':storageWarning||'自动保存到本机浏览器；切换入口请用导出 / 导入。');
    if(UI.takeover)UI.takeover.hidden=held;
    // 任务生产：全部 20 行参与分页（未解锁行置灰、不可点），只改可见行、不改变面板高度
    const taskPages=Math.max(1,Math.ceil(TASKS.length/taskRows));
    if(taskPage>=taskPages)taskPage=taskPages-1;
    const tStart=taskPage*taskRows,tEnd=tStart+taskRows;
    set('tasksSummary',`运行 ${unlocked}/${TASKS.length} · +${format(incomeValue)}/s`);
    set('taskPageInfo',`${taskPage+1} / ${taskPages}`);
    UI.taskPrev.disabled=taskPage<=0;UI.taskNext.disabled=taskPage>=taskPages-1;
    taskNodes.forEach((n,i)=>{
      const q=s.tasks[i],show=i>=tStart&&i<tEnd;
      if(n.el.hidden===show)n.el.hidden=!show;
      if(!q.unlocked){
        n.el.dataset.locked='true';n.el.classList.add('tw-locked');
        n.level.textContent=`第${TASKS[i].unlockStage}关`;
        n.verb.textContent='未解锁';n.cost.textContent='';
        n.reward.textContent='—';n.reward.title='';
        n.progress.style.width='0%';
        n.button.disabled=true;
        n.button.title=`「${TASKS[i].name}」在第 ${TASKS[i].unlockStage} 关解锁`;
        return;
      }
      n.el.dataset.locked='false';n.el.classList.remove('tw-locked');
      const cost=taskCost(s,i),reward=taskReward(s,i);
      n.level.textContent=q.level?'Lv.'+q.level:'待启动';
      n.verb.textContent=q.level?'升级':'启动';
      n.reward.textContent='+'+compact(reward);
      n.reward.title=`每 ${TASKS[i].periodMs/1000} 秒 +${format(reward)}（完整值）`;
      n.cost.textContent=compact(cost);
      n.progress.style.width=(q.level?Math.min(100,q.phase/TASKS[i].periodMs*100):0)+'%';
      n.progress.parentElement.title=`本周期进度 ${(q.level?Math.min(100,q.phase/TASKS[i].periodMs*100):0).toFixed(0)}%`;
      n.button.disabled=!held||compare(s.coins,cost)<0;
      n.button.title=`${q.level?'升级':'启动'}「${TASKS[i].name}」· 花费 ${format(cost)}（完整值）`;
    });
    const nextIndex=TASKS.findIndex((q,i)=>!s.tasks[i].unlocked);
    const nextText=nextIndex<0?'全部 20 项任务已解锁':s.maxStage>=TASKS[nextIndex].unlockStage?`正在安排新任务：${TASKS[nextIndex].name}`:`下一项：${TASKS[nextIndex].name}　/　最高关卡 ${TASKS[nextIndex].unlockStage}`;
    if(UI.nextTask.textContent!==nextText){UI.nextTask.textContent=nextText;UI.nextTask.title=nextText;}
    // 模型军团
    const armyPages=Math.max(1,Math.ceil(ARMY_MODELS.length/armyRows));
    if(armyPage>=armyPages)armyPage=armyPages-1;
    const aStart=armyPage*armyRows,aEnd=aStart+armyRows;
    const armySummaryText=`${s.models.length}/${ROSTER.models.length} · 算力 ${compact(powerValue)}`;
    if(UI.armySummary.textContent!==armySummaryText)UI.armySummary.textContent=armySummaryText;
    UI.armySummary.title=`军团：已招募 ${s.models.length}/${ROSTER.models.length} · 总算力（含训练/权重/事件加成）${format(powerValue)}（完整值）`;
    set('armyTraining',`本代训练 Lv.${s.training}`);
    set('armyPageInfo',`${armyPage+1} / ${armyPages}`);
    UI.armyPrev.disabled=armyPage<=0;UI.armyNext.disabled=armyPage>=armyPages-1;
    UI.trainBtn.textContent='全军训练 '+compact(trainingCost(s));
    UI.trainBtn.title=`全会训练 +1 级 · 花费 ${format(trainingCost(s))}（完整值）`;
    UI.trainBtn.disabled=!held||compare(s.coins,trainingCost(s))<0;
    armyNodes.forEach((n,j)=>{
      const m=ARMY_MODELS[j],own=s.models.includes(m.id),locked=s.maxStage<m.unlockStage;
      const show=j>=aStart&&j<aEnd;
      if(n.el.hidden===show)n.el.hidden=!show;
      n.el.dataset.locked=String(locked&&!own);
      const btn=n.button;
      btn.textContent=own?'已加入':locked?`第 ${m.unlockStage} 关`:compact(amount(m.cost));
      btn.disabled=own||locked||!held||compare(s.coins,amount(m.cost))<0;
      btn.classList.toggle('tw-owned',own);
      btn.title=own?m.name+' 已加入军团':locked?m.name+` 在第 ${m.unlockStage} 关解锁`:`招募 ${m.name} · 花费 ${format(amount(m.cost))}（完整值）`;
      n.power.textContent=compact(amount(m.power));
      n.power.title=`基础算力 ${format(amount(m.power))}（完整值）`;
    });
    // 蒸馏与传承
    const genText='GEN '+String(s.generation).padStart(3,'0'),multText='×'+format(weightMultiplier(s)),gainText='+'+compact(distillGain(s));
    set('gen',genText);set('multiplier',multText);set('gain',gainText);set('weights',format(s.weights));set('training','Lv.'+s.training);
    set('runMaxStage',String(s.runMaxStage));set('distillCount',s.distillCount+' 次');set('earned',format(s.earned));
    const distillSummaryText=`第 ${s.generation} 代 · 自动${s.autoDistill?'开':'关'}`;
    if(UI.distillSummary.textContent!==distillSummaryText)UI.distillSummary.textContent=distillSummaryText;
    UI.distillSummary.title=`${genText} · 永久权重 ${multText} · 本次可获 ${gainText}（完整值）`;
    const can=canDistill(s);
    set('distillHint',can?'自动系统会先试算恢复速度，再决定是否蒸馏。':'第 40 关起开放 · 本代至少运行 30 秒');
    UI.distillBtn.disabled=!held||catching||!can;
    UI.distillBtn.title=can?'蒸馏到下一代：重置本代经济，保留模型与任务解锁':'当前还不能蒸馏';
    for(const c of root.querySelectorAll('[data-control]')){const isDistill=c.dataset.control.indexOf('distill')>=0;const want=isDistill?s.autoDistill:s.auto;if(c.checked!==want)c.checked=want;c.disabled=!held;}
    if(UI.qualityBtn)UI.qualityBtn.textContent=`${fps} FPS · ${fps===24?'流畅':'节能'}`;
    // 通知行 / 右列厂商动态与最近记录 / 底栏
    const evLeft=ev?Math.max(0,Math.ceil((s.event.until-s.time)/1000)):0;
    const newsText=ev?`${VENDOR_LABELS[ev.vendor]}「${ev.name}」 · 算力 ×${ev.powerMultiplier} · 收益 ×${ev.incomeMultiplier} · 剩余 ${evLeft} 秒`:`暂无厂商事件 · 军团正在自动推进 · 下一事件约 ${Math.max(0,Math.ceil((s.nextEventAt-s.time)/1000))} 秒后`;
    if(UI.newsText&&UI.newsText.textContent!==newsText)UI.newsText.textContent=newsText;
    const railText=!held?'只读页面 · 另一页面正在运行':s.paused?'已暂停 · 游戏计时冻结':`自动运行中 · 收益 +${format(incomeValue)}/s · 军团正在自动推进`;
    if(UI.eventText.textContent!==railText)UI.eventText.textContent=railText;
    const nextEventSec=Math.max(0,Math.ceil((s.nextEventAt-s.time)/1000));
    set('runDuration',timeLabel(Math.max(0,s.time-s.runStart)));
    set('nextEventHint',ev?'事件进行中':`下一事件约 ${nextEventSec} 秒`);
    const lastLog=s.logs[s.logs.length-1];
    set('lastLog',lastLog?`${clockLabel(lastLog.at)} · ${lastLog.text}`:'—');
    if(drawerOpen&&drawerTab==='log')renderLog();
    renderStats.owner=held;renderStats.active=visible&&held;renderStats.catching=catching;renderStats.logicCount=logicCounter;
  }
  function renderPanels(){
    const wide=layout.size==='wide';
    UI.tabs.hidden=wide;
    UI.tasksPanel.hidden=!wide&&tabW!=='tasks';
    UI.sideCol.hidden=!wide&&tabW==='tasks';
    UI.armyPanel.hidden=!wide&&tabW!=='army';
    const armyOpenNow=wide?armyOpen:true;
    UI.armyBody.hidden=!armyOpenNow;
    UI.armyPanel.dataset.open=String(armyOpenNow);
    UI.armyToggle.hidden=!wide;
    UI.armyToggle.textContent=armyOpen?'收起':'展开';
    // 宽容器：蒸馏与传承默认常驻展开；展开军团时右列临时聚焦军团，收起诉回蒸馏。
    UI.distillPanel.hidden=wide?armyOpenNow:tabW!=='distill';
    for(const btn of UI.tabs.querySelectorAll('button'))btn.classList.toggle('active',btn.dataset.wtab===tabW);
  }
  function measureLists(){
    if(!UI.tasksPanel.hidden&&UI.taskList.clientHeight>16){
      const rows=Math.max(3,Math.min(20,Math.floor((UI.taskList.clientHeight-2)/TASK_ROW_H)));
      if(rows!==taskRows)taskRows=rows;
    }
    if(!UI.armyBody.hidden&&UI.armyList.clientHeight>16){
      const rows=Math.max(2,Math.min(10,Math.floor((UI.armyList.clientHeight-2)/ARMY_ROW_H)));
      if(rows!==armyRows)armyRows=rows;
    }
  }
  function sizeCanvas(){
    const cw=Math.max(1,Math.round(canvas.clientWidth)),ch=Math.max(1,Math.round(canvas.clientHeight));
    const dpr=Math.max(1,Math.min(2,win.devicePixelRatio||1));
    const bw=Math.round(cw*dpr),bh=Math.round(ch*dpr);
    if(canvas.width!==bw)canvas.width=bw;
    if(canvas.height!==bh)canvas.height=bh;
    cssW=cw;cssH=ch;dprCur=dpr;
  }
  function fitText(text,maxW){
    const t=String(text||'');
    if(ctx.measureText(t).width<=maxW)return t;
    let out=t;
    while(out.length>1&&ctx.measureText(out+'…').width>maxW)out=out.slice(0,-1);
    return out+'…';
  }
  function relayout(){
    if(disposed||!root.isConnected)return;
    const w=root.clientWidth,h=root.clientHeight;
    if(!w||!h)return;
    const size=w>=880?'wide':'narrow',tall=h>=780;
    layout.w=w;layout.h=h;layout.size=size;layout.tall=tall;
    root.dataset.size=size;root.dataset.h=tall?'tall':'short';
    renderPanels();
    const battleH=Math.max(150,Math.min(210,Math.round(h*0.26)));
    if(battleH!==layout.battleH){layout.battleH=battleH;UI.battle.style.flex=`0 0 ${battleH}px`;}
    root.dataset.compact=String(w<720);
    sizeCanvas();measureLists();updateUI();
  }
  function renderHelp(){
    helpPage=Math.max(0,Math.min(HELP_PAGES.length-1,helpPage));
    UI.helpText.innerHTML=HELP_PAGES[helpPage];
    set('helpPageInfo',`${helpPage+1} / ${HELP_PAGES.length}`);
  }
  function renderLog(){
    const logs=s.logs.slice().reverse();
    const pages=Math.max(1,Math.ceil(logs.length/LOG_PAGE_SIZE));
    if(logPage>=pages)logPage=pages-1;
    const slice=logs.slice(logPage*LOG_PAGE_SIZE,logPage*LOG_PAGE_SIZE+LOG_PAGE_SIZE);
    const key=slice.map(l=>l.at+':'+l.kind+':'+l.text).join('|');
    if(key!==lastLogKey){lastLogKey=key;UI.logList.innerHTML=slice.map(l=>`<div class="tw-log-row" data-kind="${esc(l.kind)}"><time>${clockLabel(l.at)}</time><span>${esc(l.text)}</span></div>`).join('');}
    set('logPageInfo',`${logPage+1} / ${pages}`);
    UI.logPrev.disabled=logPage<=0;UI.logNext.disabled=logPage>=pages-1;
  }
  function renderDrawer(){
    UI.backdrop.hidden=!drawerOpen;
    if(!drawerOpen)return;
    for(const btn of UI.drawerTabs.querySelectorAll('[data-drawer-tab]'))btn.classList.toggle('active',btn.dataset.drawerTab===drawerTab);
    for(const pane of UI.backdrop.querySelectorAll('[data-drawer-pane]'))pane.hidden=pane.dataset.drawerPane!==drawerTab;
    if(drawerTab==='help')renderHelp();
    if(drawerTab==='log')renderLog();
  }
  function openDrawer(tab){drawerOpen=true;drawerTab=tab||'save';updateUI();renderDrawer();}
  function closeDrawer(){drawerOpen=false;UI.backdrop.hidden=true;}
  function scheduleDraw(){
    if(disposed||!visible||!held||s.paused||catching)return;
    drawTimer=win.setTimeout(()=>{drawTimer=0;raf=win.requestAnimationFrame(now=>{raf=0;draw(now);scheduleDraw();});},1000/fps);
  }
  function tick(){
    if(!held||!visible||catching||disposed)return;
    const now=Date.now(),dt=Math.max(0,now-wall);
    if(performance.now()-lastLease>5000){store.lease(owner,now);lastLease=performance.now();}
    if(s.paused){wall=Math.max(wall,now);save();return;}
    if(dt>5000){beginCatchup(dt);return;}
    advance(s,s.time+dt,{maxEvents:300});wall=Math.max(wall,now);logicCounter++;
    save();
  }
  function scheduleLogic(){
    if(disposed||!visible||!held||catching)return;
    logicTimer=win.setTimeout(()=>{logicTimer=0;tick();updateUI();scheduleLogic();},s.paused?5000:500);
  }
  function clearSchedules(){for(const id of [drawTimer,logicTimer,catchTimer])win.clearTimeout(id);win.cancelAnimationFrame(raf);drawTimer=logicTimer=catchTimer=raf=0;lastDrawAt=0;}
  function beginCatchup(delta){
    clearSchedules();const myEpoch=++epoch;catching=true;
    const dt=Math.min(delta,30*86400000),startTime=s.time,target=s.time+dt;
    const wallStart=Math.max(wall,Date.now()-dt);wall=wallStart;
    const startStage=s.maxStage,startGeneration=s.generation;
    UI.catchup.hidden=dt<3000;
    UI.catchupText.textContent=`离开 ${timeLabel(dt)}，自动经营、事件与蒸馏正在继续。`;
    function chunk(){
      if(disposed||!held||!visible||epoch!==myEpoch)return;
      let result;const started=performance.now();
      do{result=advance(s,target,{maxEvents:30});}while(!result.done&&performance.now()-started<8);
      wall=wallStart+(s.time-startTime);logicCounter+=result.steps;
      UI.catchup.querySelector('i').style.width=(dt?Math.min(100,(s.time-startTime)/dt*100):100)+'%';
      if(!result.done){catchTimer=win.setTimeout(()=>{catchTimer=0;chunk();},0);return;}
      catching=false;UI.catchup.hidden=true;save(true);updateUI();draw(performance.now());
      if(dt>=30000)showNotice(`离线 ${timeLabel(dt)}：最高关卡 ${startStage} → ${s.maxStage}，世代 ${startGeneration} → ${s.generation}。${delta>dt?'超过 30 天的时间按 30 天结算。':''}`);
      scheduleDraw();scheduleLogic();
    }
    catchTimer=win.setTimeout(()=>{catchTimer=0;chunk();},0);
  }
  async function claim(){
    if(disposed||held||acquiring||!visible)return;acquiring=true;
    const enter=()=>{
      if(disposed||!visible)return false;
      if(!store.lease(owner,Date.now()))return false;
      held=true;const loaded=store.load();
      if(loaded.state){s=loaded.state;wall=loaded.savedAt;}
      else if(!s.time){s=createGame();wall=Date.now();}
      if(loaded.error)showNotice(loaded.recovered?'主存档损坏，已恢复上一份自动备份。':'损坏存档已另存保留，已启动新进度。');
      if(!store.available){storageWarning='存储不可用，请定期导出存档';showNotice(storageWarning);}
      updateUI();
      if(s.paused){wall=Math.max(wall,Date.now());draw(performance.now());scheduleLogic();}
      else beginCatchup(offlineElapsed(wall,Date.now()));
      return true;
    };
    try{
      if(win.navigator.locks){
        await win.navigator.locks.request('token-war-save-owner',{ifAvailable:true},async lock=>{
          acquiring=false;
          if(!lock||!enter()){updateUI();draw(performance.now());return;}
          await new Promise(resolve=>{releaseWeb=resolve;});
        });
      }else{acquiring=false;if(!enter()){updateUI();draw(performance.now());}}
    }catch(e){acquiring=false;showNotice('无法取得存档写入锁：'+e.message);}
  }
  function deactivate(flush=true){
    if(held&&flush&&!catching)tick();
    ++epoch;clearSchedules();if(held&&flush)save(true);catching=false;UI.catchup.hidden=true;
    if(held)store.release(owner);held=false;renderStats.active=false;renderStats.owner=false;
    if(releaseWeb){const r=releaseWeb;releaseWeb=null;r();}
    if(!disposed)updateUI();
  }
  function visibility(){
    const next=!disposed&&doc.visibilityState!=='hidden'&&root.isConnected&&intersecting&&root.getClientRects().length>0;
    if(next===visible)return;
    visible=next;if(!next)deactivate(true);else{relayout();claim();}
  }
  function onStorage(e){
    if(disposed)return;
    if(e.key===LOCK_KEY&&held&&!win.navigator.locks&&!store.owns(owner,Date.now()))deactivate(false);
    if(!held&&e.key===SAVE_KEY){const load=store.load();if(load.state){s=load.state;updateUI();if(visible)draw(performance.now());}}
    if(!held&&visible&&(e.key===SIGNAL_KEY||(e.key===LOCK_KEY&&!e.newValue)))claim();
  }
  function onClick(e){
    const t=e.target.closest('button');if(!t||!root.contains(t))return;
    if(t.dataset.wtab){tabW=t.dataset.wtab;renderPanels();relayout();return;}
    if(t.dataset.drawerTab){drawerTab=t.dataset.drawerTab;renderDrawer();return;}
    if(t.dataset.taskPage){const dir=t.dataset.taskPage==='next'?1:-1;const pages=Math.max(1,Math.ceil(TASKS.length/taskRows));taskPage=Math.max(0,Math.min(pages-1,taskPage+dir));updateUI();return;}
    if(t.dataset.armyPage){const dir=t.dataset.armyPage==='next'?1:-1;const pages=Math.max(1,Math.ceil(ARMY_MODELS.length/armyRows));armyPage=Math.max(0,Math.min(pages-1,armyPage+dir));updateUI();return;}
    if(t.dataset.helpPage){helpPage=Math.max(0,Math.min(HELP_PAGES.length-1,helpPage+(t.dataset.helpPage==='next'?1:-1)));renderHelp();return;}
    if(t.dataset.logPage){const pages=Math.max(1,Math.ceil(s.logs.length/LOG_PAGE_SIZE));logPage=Math.max(0,Math.min(pages-1,logPage+(t.dataset.logPage==='next'?1:-1)));renderLog();return;}
    if(t.dataset.upgrade!==undefined)return applyControl(()=>buyTask(s,Number(t.dataset.upgrade),s.coins,1));
    if(t.dataset.recruit)return applyControl(()=>buyModel(s,t.dataset.recruit));
    const action=t.dataset.action;
    if(action==='pause')return applyControl(()=>{s.paused=!s.paused;wall=Math.max(wall,Date.now());clearSchedules();scheduleDraw();scheduleLogic();});
    if(action==='train')return applyControl(()=>buyTraining(s));
    if(action==='distill')return showConfirm('蒸馏到下一代？','Token、任务等级、关卡与本代训练将重置；模型、任务解锁与权重永久保留。',()=>applyControl(()=>distill(s)));
    if(action==='toggle-army'){armyOpen=!armyOpen;renderPanels();relayout();return;}
    if(action==='drawer'){openDrawer(t.dataset.drawer);return;}
    if(action==='close-drawer'){closeDrawer();return;}
    if(action==='save'){
      if(held)tick();try{const text=makeSave(s,wall),url=win.URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=doc.createElement('a');a.href=url;a.download='token-war-save.json';a.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);}catch(err){showNotice(err.message);}return;
    }
    if(action==='import'){if(!held)return showNotice('请先在当前页面取得运行权。');$('[data-role=file]').click();return;}
    if(action==='reset')return showConfirm('重置当前设备的游戏进度？','此操作只重置 Token War，不影响 DSH 或任何工作文件。当前进度会保留在自动备份中，建议先导出存档。',()=>applyControl(()=>{s=createGame();wall=Date.now();}));
    if(action==='cancel'){closeConfirm();return;}
    if(action==='confirm'){const callback=requestConfirm;closeConfirm(false);callback?.();return;}
    if(action==='quality'){fps=fps===12?24:fps===24?6:12;updateUI();return;}
    if(action==='dismiss'){showNotice('');return;}
    if(action==='dismiss-session'){dismissedSession=hostNotice?.text||'';renderRail();return;}
    if(action==='takeover'){claim();return;}
    if(action==='session'){hostNotice?.open?.();return;}
  }
  function onChange(e){
    const control=e.target.dataset.control;
    if(control)return applyControl(()=>{if(control.indexOf('distill')>=0)s.autoDistill=e.target.checked;else s.auto=e.target.checked;});
    if(e.target.dataset.role==='file'){
      const f=e.target.files[0];e.target.value='';if(!f)return;
      if(f.size>200000){showNotice('存档超过大小限制。');return;}
      f.text().then(text=>{
        if(disposed)return;const loaded=readSave(text);if(loaded.savedAt>Date.now()+300000)throw Error('存档时间明显在未来，请检查设备时钟。');
        pendingImport=loaded;showConfirm('导入存档？',`将切换到第 ${loaded.state.generation} 代、最高 ${loaded.state.maxStage} 关。当前存档会保留一份自动备份。`,()=>{
          if(!held||!pendingImport)return;clearSchedules();++epoch;s=pendingImport.state;wall=pendingImport.savedAt;pendingImport=null;catching=false;save(true);
          if(s.paused){wall=Math.max(wall,Date.now());updateUI();draw(performance.now());scheduleLogic();}else beginCatchup(offlineElapsed(wall,Date.now()));
        });
      }).catch(err=>showNotice('导入失败，原进度未改变：'+err.message));
    }
  }
  function onResize(){if(disposed)return;relayout();visibility();}
  function onKey(e){
    if(e.key!=='Escape')return;
    if(!UI.confirm.hidden){closeConfirm();return;}
    if(drawerOpen)closeDrawer();
  }
  function updateSessionNotice(notice){hostNotice=notice;renderRail();}
  root.addEventListener('click',onClick);root.addEventListener('change',onChange);doc.addEventListener('keydown',onKey);
  doc.addEventListener('visibilitychange',visibility);win.addEventListener('pagehide',deactivate);win.addEventListener('storage',onStorage);
  const observer=typeof win.IntersectionObserver==='function'?new win.IntersectionObserver(entries=>{intersecting=entries[0]?.isIntersecting!==false;visibility();}):null;observer?.observe(root);
  const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(()=>{relayout();visibility();}):null;resize?.observe(root);
  win.addEventListener('resize',onResize);
  // Expose read-only diagnostics useful for integration tests; no cheat controls.
  root.tokenWar={
    getSnapshot:()=>JSON.parse(makeSave(s,wall)),
    getDiagnostics:()=>({...renderStats,timers:[drawTimer,logicTimer,catchTimer,raf].filter(Boolean).length,fps,taskRows,armyRows}),
    getLayoutMetrics:()=>{const sc=doc.scrollingElement,aw=root.clientWidth,ah=root.clientHeight;return {
      appW:aw,appH:ah,appScrollW:root.scrollWidth,appScrollH:root.scrollHeight,
      docW:sc?sc.clientWidth:0,docH:sc?sc.clientHeight:0,docScrollW:sc?sc.scrollWidth:0,docScrollH:sc?sc.scrollHeight:0,
      overflowX:root.scrollWidth>root.clientWidth,overflowY:root.scrollHeight>root.clientHeight,
      /* 兼容旧字段；语义统一为插件根（不再混入 document） */ w:aw,h:ah,scrollW:root.scrollWidth,scrollH:root.scrollHeight,clientW:aw,clientH:ah,
      size:root.dataset.size,heightClass:root.dataset.h,battleH:layout.battleH,taskRows,armyRows}},
    updateSessionNotice
  };
  visible=doc.visibilityState!=='hidden'&&root.getClientRects().length>0;
  renderPanels();relayout();updateSessionNotice(hostNotice);draw(performance.now());if(visible)claim();
  return {updateSessionNotice,dispose(){if(disposed)return;deactivate(true);disposed=true;visible=false;observer?.disconnect();resize?.disconnect();root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);doc.removeEventListener('keydown',onKey);doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('pagehide',deactivate);win.removeEventListener('storage',onStorage);win.removeEventListener('resize',onResize);images.clear();loadPromises.clear();root.tokenWar=undefined;root.innerHTML='';root.classList.remove('tw-app');}};
}
