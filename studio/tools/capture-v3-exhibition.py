"""Capture live V3 surfaces and verify both standalone file:// exports offline.
Owns a temporary loopback server and always stops it, even after a failed check.
"""
from pathlib import Path
from io import BytesIO
import json,os,socket,subprocess,time,urllib.request
from PIL import Image,ImageDraw,ImageFont
from playwright.sync_api import sync_playwright,expect
STUDIO=Path(__file__).resolve().parents[1];ROOT=STUDIO.parents[2]
OUT=STUDIO/'artifacts/v3-phase-b';OUT.mkdir(parents=True,exist_ok=True)
NAMES=['01-Agent-Harness工作台与多学科课件接入.png','02-五阶段教案转化流水线与引文自修复回执.png','03-模型API接入网关与Harness架构图.png','04-交互模组库-四大标准化课堂交互协议与公式沙盒.png','05-教室大屏-代码与公式推导逐行找茬热力图.png','06-教室大屏-伪掌握红蓝对撞墙与两轮跃迁战报.png','07-学生手机端-低摩擦点选找茬与课后复习速查卡.png']
report={'checks':[],'consoleErrors':[],'pageErrors':[],'networkRequests':[],'layouts':[],'contrast':[]}
def check(name,condition=True):
 assert condition,name
 report['checks'].append(name);print(name,flush=True)
def watch(page):
 page.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
 page.on('console',lambda m:report['consoleErrors'].append(m.text) if m.type=='error' else None)
 return page
def ready(p):
 p.evaluate('document.fonts.ready');p.wait_for_timeout(200)
 p.evaluate('''async()=>{await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():i.decode()))}''')
def fit(p,name,vertical=False):
 q=p.evaluate('''()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight})''');report['layouts'].append({'name':name,**q});check(name+' width fits',q['sw']<=q['w']+1)
 if vertical:check(name+' height fits',q['sh']<=q['h']+1)
def shot(p,index,vertical=False):
 p.evaluate('scrollTo(0,0)');ready(p);fit(p,NAMES[index],vertical);audit_contrast(p,NAMES[index]);p.screenshot(path=str(ROOT/NAMES[index]),animations='disabled')
def audit_contrast(p,name):
 result=p.evaluate('''()=>{
 const rgba=s=>{const a=s.match(/[\\d.]+/g)?.map(Number)||[0,0,0,0];return [a[0],a[1],a[2],a[3]??1]},over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
 const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n,checked=0,min=100,failures=[];
 while(n=walker.nextNode()){
  const e=n.parentElement;if(!n.textContent.trim()||!e||e.namespaceURI!=='http://www.w3.org/1999/xhtml'||e.closest('script,style,template,:disabled,[hidden],.visually-hidden'))continue;
  const r=document.createRange();r.selectNodeContents(n);const rect=r.getBoundingClientRect(),cs=getComputedStyle(e);
  if(!rect.width||!rect.height||rect.bottom<0||rect.top>innerHeight||rect.left>innerWidth||cs.visibility==='hidden')continue;
  const chain=[];for(let a=e;a;a=a.parentElement)chain.unshift(a);let bg=[255,255,255],opacity=1;
  for(const a of chain){const s=getComputedStyle(a);bg=over(rgba(s.backgroundColor),bg);opacity*=Number(s.opacity)}
  let color=rgba(cs.color);color[3]*=opacity;const fg=over(color,bg),l=[lum(fg),lum(bg)].sort((a,b)=>a-b),ratio=(l[1]+.05)/(l[0]+.05);checked++;min=Math.min(min,ratio);
  if(ratio<4.5)failures.push({text:n.textContent.trim().slice(0,70),ratio:+ratio.toFixed(2),color:cs.color,bg:bg.map(Math.round),cls:e.className});
 }
 return {checked,min:+min.toFixed(2),failures};}''')
 report['contrast'].append({'name':name,**result})
def font(z,bold=False):return ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc',z)
def start():
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();env=os.environ.copy();env.update(HOST='127.0.0.1',PORT=str(port),POLYPHONY_ROOM_FILE=str(OUT/'capture-rooms.json'))
 for key in ['POLYPHONY_AI_KEY','POLYPHONY_AI_MODEL','POLYPHONY_JEV_KEY']:env.pop(key,None)
 log=open(OUT/'capture-server.log','w',encoding='utf-8');proc=subprocess.Popen(['node','server.mjs'],cwd=STUDIO,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW);url=f'http://127.0.0.1:{port}'
 for _ in range(100):
  try:
   with urllib.request.urlopen(url+'/api/status',timeout=1):return proc,log,url
  except Exception:time.sleep(.1)
 proc.terminate();proc.wait();log.close();raise RuntimeError('server did not start')
def command(ctx,url,code,kind,payload=None):
 r=ctx.request.post(url+f'/api/rooms/{code}/commands',data={'role':'teacher','type':kind,'payload':payload or {}});assert r.ok,r.text();return r.json()['room']
proc,log,url=start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch(channel='msedge',headless=True)
  c=b.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce');page=watch(c.new_page());page.goto(url);page.wait_for_load_state('networkidle');expect(page.locator('[data-showcase]')).to_have_count(3);shot(page,0)
  page.locator('[data-showcase=deck-foundation]').click();page.locator('[data-run-harness]').click();page.locator('[data-publish]').wait_for();check('five completed stages',page.locator('[data-stage][data-state=complete]').count()==5);check('repair receipt cites actual intercepted M99','M99' in page.locator('.v3-repair-receipt').inner_text());shot(page,1)
  page.goto(url+'/?view=system');page.wait_for_load_state('networkidle');expect(page.locator('.v3-architecture-diagram img')).to_be_visible();ready(page);check('architecture SVG decoded',page.locator('.v3-architecture-diagram img').evaluate('i=>i.naturalWidth===1600'));shot(page,2)
  page.goto(url+'/?view=lab');page.wait_for_load_state('networkidle');page.locator('[data-module-tab="2"]').click();before=page.locator('[data-curve="0"]').get_attribute('d');page.locator('[data-module-slider="0"]').fill('2');page.wait_for_timeout(100);check('live declarative curve changes',before!=page.locator('[data-curve="0"]').get_attribute('d'));check('contract inspector updates','"defaultValue": 2' in page.locator('.v3-inspector pre').inner_text());shot(page,3)
  r=c.request.post(url+'/api/rooms',data={'lessonId':'pointer-audit','demo':True});assert r.ok;r=r.json()['room'];code=r['code']
  command(c,url,code,'reveal');stage=watch(c.new_page());stage.set_viewport_size({'width':1920,'height':1080});stage.goto(url+f'/?view=stage&room={code}');stage.wait_for_load_state('networkidle');expect(stage.locator('.module-diagnosis')).to_be_visible();check('realistic C sample shares',all(t in stage.locator('.module-artifact').inner_text() for t in ['42%','33%','25%']));shot(stage,4,True)
  command(c,url,code,'analyze');stage.locator('.contrast-wall').wait_for();ready(stage);audit_contrast(stage,'stage conflict wall');wall_text=stage.locator('.contrast-wall').inner_text();check('rose flawed intuition','第 2 行' in stage.locator('.is-alert blockquote').inner_text());check('cyan sound mechanism','首次解引用 NULL' in stage.locator('.is-insight blockquote').inner_text());wall=Image.open(BytesIO(stage.locator('.contrast-wall').screenshot())).convert('RGB');wall.save(OUT/'conflict-wall-live.png')
  command(c,url,code,'branch',{'branchId':r['lesson']['branches'][0]['id']});command(c,url,code,'revise');command(c,url,code,'demoFill');command(c,url,code,'reveal');stage.locator('.cognition-report').wait_for();ready(stage);fit(stage,'two-round stage',True);battle=Image.open(BytesIO(stage.locator('.cognition-report').screenshot())).convert('RGB');battle.save(OUT/'cognition-report-live.png');check('two round sample report','42%' in stage.locator('.cognition-report').inner_text() and '92%' in stage.locator('.cognition-report').inner_text())
  spread=Image.new('RGB',(1920,1080),'#060B16');draw=ImageDraw.Draw(spread);draw.text((54,24),'共演智课 · 匿名推理对撞与两轮认知跃迁',font=font(30,True),fill='#F1F5F9');draw.text((54,73),'同一课堂 / C 指针内存机制 / 12 位模拟同学 / 上：第一轮理由对照  下：第二轮配对战报',font=font(18),fill='#B8C9E0')
  y=125;available=900;scale=min(1,1792/max(wall.width,battle.width),available/(wall.height+battle.height+30))
  for im in [wall,battle]:
   im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS);spread.paste(im,((1920-im.width)//2,y));y+=im.height+28
  spread.save(ROOT/NAMES[5]);check('conflict / battle composite 1920x1080',spread.size==(1920,1080))
  r=c.request.post(url+'/api/rooms',data={'lessonId':'pointer-audit','demo':False}).json()['room'];mobile_code=r['code']
  mc=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,reduced_motion='reduce');phone=watch(mc.new_page());phone.goto(url+f'/?view=student&room={mobile_code}');phone.wait_for_load_state('networkidle');phone.locator('[name=name]').fill('课堂同学');phone.locator('[type=submit]').click();phone.locator('[data-step-select=S3]').click();phone.locator('[data-quick-reason="0"]').click();phone.evaluate('scrollTo(0,0)');ready(phone);fit(phone,'phone round 1');audit_contrast(phone,'phone round 1');left=Image.open(BytesIO(phone.screenshot())).convert('RGB');left.save(OUT/'phone-round1-2x.png');phone.locator('[type=submit]').click()
  command(c,url,mobile_code,'reveal');command(c,url,mobile_code,'analyze');command(c,url,mobile_code,'branch',{'branchId':r['lesson']['branches'][0]['id']});command(c,url,mobile_code,'revise');phone.locator('[data-step-select=S3]').wait_for();phone.locator('[data-step-select=S3]').click();phone.locator('[data-quick-reason="0"]').click();phone.locator('[type=submit]').click();command(c,url,mobile_code,'reveal');command(c,url,mobile_code,'close');phone.locator('.ps-takeaway').wait_for();phone.evaluate('scrollTo(0,0)');ready(phone);fit(phone,'phone takeaway');audit_contrast(phone,'phone takeaway');right=Image.open(BytesIO(phone.screenshot())).convert('RGB');right.save(OUT/'phone-takeaway-2x.png')
  spread=Image.new('RGB',(1720,1880),'#F6F8FA');draw=ImageDraw.Draw(spread);draw.text((40,25),'学生手机端 · 点选找茬与本页考前速查卡',font=font(40,True),fill='#0B1526');draw.text((40,94),'第 1 轮：定位代码行，点选理由',font=font(25),fill='#0B4F6C');draw.text((900,94),'下课后：回看两轮作答与机制',font=font(25),fill='#0B4F6C');spread.paste(left,(35,150));spread.paste(right,(905,150));spread.save(ROOT/NAMES[6]);check('two native DPR2 phone screenshots',left.size==right.size==(780,1688));mc.close();c.close()
  # Both exports: deny all HTTP(S); exercise every module, all presets and SVG.
  for name in ['共演智课-单文件离线演示版.html','共演智课-交互模组库独立版.html']:
   oc=b.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
   def block(route):report['networkRequests'].append(route.request.url);route.abort()
   oc.route('http://**',block);oc.route('https://**',block);op=watch(oc.new_page());op.goto((ROOT/name).as_uri());op.wait_for_load_state('networkidle')
   if '独立版' not in name:op.locator('[data-nav=lab]').first.click()
   for i in range(4):
    op.locator(f'[data-module-tab="{i}"]').click()
    if i==1:op.locator('[data-step-select=S3]').click();check(name+' step input selected',op.locator('[data-step-select=S3]').get_attribute('aria-pressed')=='true')
    if i==2:
     for j in range(3):
      op.locator(f'[data-subject="{j}"]').click();old=op.locator('[data-curve="0"]').get_attribute('d');slider=op.locator('[data-module-slider="0"]');slider.fill(slider.get_attribute('max'));op.wait_for_timeout(80);check(name+f' formula preset {j}',old!=op.locator('[data-curve="0"]').get_attribute('d'))
    if i==3:op.locator('[data-module-peer]').click();expect(op.locator('.module-peer')).to_be_visible()
    op.locator('[data-next]').click();expect(op.locator('.contrast-wall')).to_be_visible();op.locator('[data-next]').click();op.locator('[data-next]').click();expect(op.locator('.cognition-report')).to_be_visible();check(name+f' module {i} complete two rounds')
   op.locator('[data-nav=system]').first.click();expect(op.locator('.v3-architecture-diagram img')).to_be_visible();ready(op);check(name+' inline SVG offline',op.locator('.v3-architecture-diagram img').evaluate('i=>i.naturalWidth===1600&&i.src.startsWith("data:")'))
   oc.close()
  b.close()
 check('visible HTML text contrast at least 4.5:1',all(not r['failures'] for r in report['contrast']));check('zero console errors',not report['consoleErrors']);check('zero uncaught page errors',not report['pageErrors']);check('zero HTTP(S) offline requests',not report['networkRequests'])
finally:
 proc.terminate()
 try:proc.wait(timeout=10)
 except subprocess.TimeoutExpired:proc.kill();proc.wait()
 log.close();report['serverStopped']=proc.poll() is not None
 report['screenshots']=[{'name':n,'bytes':(ROOT/n).stat().st_size} for n in NAMES if (ROOT/n).exists()]
 (OUT/'exhibition-offline-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'checks':len(report['checks']),'consoleErrors':report['consoleErrors'],'pageErrors':report['pageErrors'],'serverStopped':report['serverStopped']},ensure_ascii=False))
