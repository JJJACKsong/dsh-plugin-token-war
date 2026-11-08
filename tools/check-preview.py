from playwright.sync_api import sync_playwright
from pathlib import Path
import json, argparse, shutil
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('html',type=Path);parser.add_argument('--screenshot',type=Path);args=parser.parse_args()
report={'scope':'Self-contained HTML rendered in local Chromium via set_content; file:// navigation is blocked by this runtime policy. Not a DSH integration or CPU/GPU benchmark.','cases':[],'errors':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium') or None,headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1120,'height':950},device_scale_factor=1)
 page.on('pageerror',lambda e:report['errors'].append(str(e)))
 requests=[];page.on('request',lambda req:requests.append(req.url))
 page.set_content(args.html.read_text(), wait_until='load')
 page.wait_for_function("document.querySelector('canvas').dataset.frame !== undefined")
 ids=page.locator('#character option').evaluate_all('(nodes)=>nodes.map(n=>n.value)')
 for cid in ids:
  page.select_option('#character',cid)
  page.wait_for_function('(id)=>document.querySelector("#status").textContent.toLowerCase().includes(id.toLowerCase())',arg={'chatgpt':'ChatGPT','doubao':'Seed / 豆包','qwen':'Qwen / 千问'}.get(cid,cid),timeout=3000) if cid not in ['doubao','qwen'] else page.wait_for_timeout(180)
  page.wait_for_timeout(70)
  alpha=page.evaluate('''()=>{const a=document.querySelector('canvas').getContext('2d').getImageData(0,0,192,192).data;let zero=0,nonzero=0;for(let i=3;i<a.length;i+=4){if(a[i])nonzero++;else zero++;}return {zero,nonzero};}''')
  assert alpha['zero']>0 and alpha['nonzero']>0,(cid,alpha)
 report['cases'].append({'name':'all_10_atlases_decode_with_visible_character_and_transparency','passed':True})
 page.select_option('#character','deepseek');page.select_option('#state','idle');page.click('#replay');page.wait_for_timeout(80)
 page.click('#pause');before=page.locator('canvas').get_attribute('data-draws');frame=page.locator('canvas').get_attribute('data-frame')
 page.wait_for_timeout(950);assert page.locator('canvas').get_attribute('data-draws')==before
 page.click('#pause');page.wait_for_timeout(80);assert page.locator('canvas').get_attribute('data-frame')==frame
 report['cases'].append({'name':'pause_halts_drawing_and_resume_does_not_skip_paused_time','passed':True})
 page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange')); ")
 before=page.locator('canvas').get_attribute('data-draws');page.wait_for_timeout(500);assert page.locator('canvas').get_attribute('data-draws')==before
 page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
 report['cases'].append({'name':'simulated_hidden_event_cancels_pending_drawing','passed':True})
 page.select_option('#state','attack');page.wait_for_timeout(720)
 assert '单次播放完成' in page.locator('#status').inner_text()
 before=page.locator('canvas').get_attribute('data-draws');page.wait_for_timeout(350);assert page.locator('canvas').get_attribute('data-draws')==before
 report['cases'].append({'name':'single_attack_recovers_and_stops_scheduling','passed':True})
 page.click('#step');assert page.locator('#pause').inner_text()=='继续'
 report['cases'].append({'name':'manual_frame_step_is_paused','passed':True})
 page.select_option('#character','claude');page.select_option('#state','attack');page.click('#replay');page.click('#step')
 if args.screenshot:page.screenshot(path=str(args.screenshot),full_page=True)
 report['networkRequests']=[u for u in requests if u.startswith(('http:','https:'))]
 assert not report['networkRequests']
 assert not report['errors']
 report['cases'].append({'name':'standalone_preview_needs_no_network','passed':True})
 browser.close()
report['passed']=True;(root/'docs/browser-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
