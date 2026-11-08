#!/usr/bin/env python3
"""Chromium DOM regression using set_content; this environment blocks URL navigation.
Storage is an explicit in-memory adapter, not a claim of native-origin persistence.
"""
from pathlib import Path
import json, subprocess, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text()
KEY='dshtoken-war.save.v1'
results=[]
def record(name,passed,detail=None):
    results.append({'name':name,'passed':bool(passed),'detail':detail})
    print(('PASS ' if passed else 'FAIL ')+name, detail if detail is not None else '')
    assert passed,name

def seed_save(seconds=600):
    code=f"""import {{createGame,advance,makeSave}} from './lib/game.js';
const s=createGame();let r;do{{r=advance(s,{seconds*1000},{{maxEvents:10000}});}}while(!r.done);
console.log(makeSave(s,Date.now()));"""
    return subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,text=True).strip()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1080},device_scale_factor=1,accept_downloads=True)
    errors=[];requests=[]
    def newpage(saved=None,corrupt=False):
        pg=context.new_page()
        pg.on('pageerror',lambda e:errors.append(str(e)))
        pg.on('request',lambda req:requests.append(req.url) if req.url.startswith(('http:','https:')) else None)
        pg.evaluate("""({key,saved,corrupt})=>{
          const m=new Map();if(saved)m.set(key,saved);if(corrupt){m.set(key+'.backup',saved);m.set(key,'broken');}
          window.__store=m;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}});
          window.__vis='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__vis});
        }""",{'key':KEY,'saved':saved,'corrupt':corrupt})
        pg.set_content(HTML,wait_until='load')
        pg.wait_for_function("document.querySelector('#game').tokenWar?.getDiagnostics().owner")
        pg.wait_for_function("!document.querySelector('#game').tokenWar.getDiagnostics().catching")
        return pg
    snapshot=lambda pg:pg.evaluate("document.querySelector('#game').tokenWar.getSnapshot()")
    diag=lambda pg:pg.evaluate("document.querySelector('#game').tokenWar.getDiagnostics()")
    pg=newpage()
    pg.wait_for_timeout(2600)
    record('fresh autonomous task income',snapshot(pg)['state']['earned'][0]>0)
    pg.locator('[data-action=pause]').click();pg.wait_for_timeout(200)
    state=snapshot(pg)['state'];count=diag(pg)['drawCount'];pg.wait_for_timeout(800)
    record('pause freezes game and animation',snapshot(pg)['state']['time']==state['time'] and diag(pg)['drawCount']==count)
    pg.locator('[data-action=pause]').click();pg.wait_for_timeout(700)
    record('resume advances again',snapshot(pg)['state']['time']>state['time'])
    pg.evaluate("window.__vis='hidden';document.dispatchEvent(new Event('visibilitychange'))")
    pg.wait_for_timeout(200);c=diag(pg)['drawCount'];t=snapshot(pg)['state']['time'];pg.wait_for_timeout(900)
    record('hidden page cancels every game timer',diag(pg)['timers']==0 and diag(pg)['drawCount']==c)
    pg.evaluate("window.__vis='visible';document.dispatchEvent(new Event('visibilitychange'))")
    pg.wait_for_timeout(700)
    record('return from hidden catches elapsed time',snapshot(pg)['state']['time']>=t+900)
    # A fake corrupted upload must not replace the running save.
    before=snapshot(pg)['state']['generation']
    pg.locator('[data-role=file]').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{"format":"wrong"}'})
    pg.wait_for_timeout(100)
    record('invalid import preserves current progress',snapshot(pg)['state']['generation']==before and '导入失败' in pg.locator('[data-role=notice]').inner_text())
    with pg.expect_download(timeout=5000) as down:
        pg.locator('[data-action=save]').click()
    raw=Path(down.value.path()).read_text();record('export produces a valid save JSON',json.loads(raw)['format']=='token-war-save')
    # Accepted art is reused across all enabled vendors.
    mid=seed_save(1200);scene=newpage(mid);scene.wait_for_timeout(1000)
    record('all five enabled approved atlases load',diag(scene)['loadedAtlases']==5)
    scene.locator('[data-tab=army]').click()
    record('model roster is ten, not seventeen vendors',scene.locator('.tw-model').count()==10)
    scene.locator('[data-tab=tasks]').click()
    scene.screenshot(path=str(ROOT/'reports/gameplay-desktop.png'),full_page=True)
    scene.set_viewport_size({'width':390,'height':844});scene.wait_for_timeout(200)
    overflow=scene.evaluate('document.documentElement.scrollWidth>window.innerWidth')
    record('mobile layout has no horizontal overflow',not overflow)
    scene.screenshot(path=str(ROOT/'reports/gameplay-mobile.png'),full_page=True)
    scene.set_viewport_size({'width':1440,'height':1080})
    before=snapshot(scene)['state'];scene.locator('[data-action=distill]').click();scene.locator('[data-action=confirm]').click();scene.wait_for_timeout(300)
    after=snapshot(scene)['state']
    record('manual distillation keeps recruited models',after['generation']==before['generation']+1 and after['models']==before['models'] and after['weights'][0]>0)
    # Remount the same HTML with the saved storage adapter (not browser navigation).
    t=snapshot(scene)['state']['time'];scene.evaluate('window.tokenWarApp.dispose()');scene.set_content(HTML,wait_until='load');scene.wait_for_timeout(700)
    record('remount restores saved progress',snapshot(scene)['state']['time']>=t and snapshot(scene)['state']['generation']==after['generation'])
    rec=newpage(mid,corrupt=True)
    record('corrupt primary save restores backup','恢复上一份' in rec.locator('[data-role=notice]').inner_text())
    # A valid offline snapshot is replayed, not credited at the final production rate.
    off=json.loads(mid);off['savedAt']-=600000;offline=newpage(json.dumps(off));offline.wait_for_timeout(200)
    record('ten-minute offline growth completes',snapshot(offline)['state']['time']>=1800000 and '离线' in offline.locator('[data-role=notice]').inner_text())
    # Check detach and display:none panel transitions as well as document hiding.
    offline.evaluate("document.querySelector('#game').style.display='none'");offline.wait_for_timeout(250)
    record('hidden DSH-like panel stops work',diag(offline)['timers']==0)
    offline.evaluate("document.querySelector('#game').style.display=''");offline.wait_for_timeout(500)
    record('shown panel restarts without resetting',diag(offline)['owner'] and snapshot(offline)['state']['maxStage']>40)
    offline.evaluate("window.__diag=document.querySelector('#game').tokenWar.getDiagnostics;window.tokenWarApp.dispose()")
    record('dispose cleans all schedulers',offline.evaluate('window.__diag().timers')==0)
    # Inject a forged future timestamp and ensure rejection.
    future=json.loads(mid);future['savedAt']=int(time.time()*1000)+86400000
    pg.locator('[data-role=file]').set_input_files({'name':'future.json','mimeType':'application/json','buffer':json.dumps(future).encode()});pg.wait_for_timeout(100)
    record('future import is rejected','未来' in pg.locator('[data-role=notice]').inner_text())
    record('no runtime HTTP requests',len(requests)==0,requests)
    record('no browser script errors',not errors,errors)
    perf=diag(scene)
    context.close();browser.close()
    (ROOT/'reports/browser.json').write_text(json.dumps({'environment':'Chromium / set_content / in-memory localStorage adapter; no native DSH runtime','checks':results,'diagnostics':perf,'requests':requests,'errors':errors},ensure_ascii=False,indent=2))
