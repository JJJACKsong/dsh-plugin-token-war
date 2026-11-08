#!/usr/bin/env python3
"""Mount the generated DSH bundle with an explicit React/slot test adapter.
This tests adapter wiring, not a real installed DSH host.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 pg=b.new_page(viewport={'width':1440,'height':1080});errors=[]
 pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.set_content('<html><body style="margin:0"><div id="host"></div></body></html>')
 pg.evaluate("""()=>{
  const data=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}});
  window.__ModuleLoader__={load:e=>window.__entry=e};
 }""")
 pg.evaluate((ROOT/'lib/client.js').read_text())
 pg.evaluate("""()=>{
  const effects=[],dispose=[],registered=[];
  const React={useRef:()=>({current:null}),useEffect:fn=>effects.push(fn),createElement:(type,props,...children)=>{
    if(typeof type==='function')return type(props||{});
    const el=document.createElement(type);for(const [k,v]of Object.entries(props||{})){if(k==='style')Object.assign(el.style,v);else if(k==='ref')v.current=el;else el.setAttribute(k,v);}
    for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)el.append(child instanceof Node?child:document.createTextNode(String(child)));return el;
  }};
  const plugin=window.__entry.factory(name=>{if(name!=='react')throw Error(name);return React;});
  const slots={inject:(name,fn)=>fn(),register:(meta,Component)=>{registered.push({meta,Component});return()=>{};}};
  plugin.apply({effect:fn=>dispose.push(fn()),slots,get:name=>name==='uiWorkspace'?{openSession:id=>window.__opened=id}:{selectPanel:()=>{}}});
  const Panel=registered.find(r=>r.meta.key==='dsh-token-war').Component;
  const el=Panel({useSessionStatus:()=>({'demo-session':{completionUnread:true}}),useSessions:()=>[{id:'demo-session',title:'视频脚本'}]});
  document.querySelector('#host').append(el);for(const fn of effects)dispose.push(fn());
  window.__dispose=()=>dispose.reverse().forEach(fn=>fn?.());window.__registered=registered.map(r=>r.meta);
 }""")
 pg.wait_for_timeout(1000)
 checks=[]
 def check(name,ok):
  checks.append({'name':name,'passed':bool(ok)});print(name,ok);assert ok
 check('both DSH slots registered',pg.evaluate('window.__registered.length')==2)
 check('game mounted through DSH adapter',pg.locator('.tw-app').count()==1)
 check('session notification reaches mounted game','视频脚本 已完成任务' in pg.locator('[data-role=session]').inner_text())
 pg.locator('[data-action=session]').click();check('session navigation passes exact ID',pg.evaluate('window.__opened')=='demo-session')
 pg.evaluate('window.__dispose()');check('adapter unmount disposes game',pg.locator('.tw-app').count()==0)
 check('no adapter script errors',not errors)
 (ROOT/'reports/dsh-adapter.json').write_text(json.dumps({'scope':'React/DSH slot adapter test double, NOT real DSH host','checks':checks,'errors':errors},ensure_ascii=False,indent=2))
 b.close()
