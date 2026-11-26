"""V4 Phase 2: real UI captures at DPR2, offline verification and geometry receipts.
Every exhibition source is a viewport screenshot (full_page=False).
Only the two-phone layout is composited, from two unmodified mobile viewport captures.
"""
from pathlib import Path
from io import BytesIO
from urllib.parse import urlparse,parse_qs
import json,os,socket,subprocess,time,shutil,urllib.request
from PIL import Image,ImageDraw,ImageFont
from playwright.sync_api import sync_playwright,expect
S=Path(__file__).resolve().parents[1];SOURCE=S.parent;ROOT=SOURCE.parent.parent if SOURCE.name=='source' and SOURCE.parent.name=='.polyphony-work' else SOURCE;OUT=S/'artifacts/v4-phase2';OUT.mkdir(parents=True,exist_ok=True)
NAMES=['01-双源AI备课中枢-从零生成原生课件与旧课件导入活化.png','02-原生课件流式播放器-C语言实战讲义双栏代码与内存表.png','03-页内原生融合互动-C代码逐行找茬就地热力图.png','04-页内原生动态公式沙盒-物理光学多缝衍射实时调控.png','05-大班翻转课堂页内思辨-大学英语实证阅读与盲盒AI辩友.png','06-学生手机端单页流式跟随-讲义同步与页内点选及速查卡抽屉.png','07-交互模组库与五阶段Harness架构协议总览.png']
report={'consoleErrors':[],'pageErrors':[],'offlineRequests':[],'checks':[],'geometry':[],'screenshots':[]}
FORBIDDEN=['课谱','总谱','排练','Playlab','史料','数字黑箱','夜校','TypeSafe','光电探究台','确定性物理数值引擎']
def watch(page):
 page.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
 page.on('console',lambda m:report['consoleErrors'].append(m.text) if m.type=='error' else None)
 page.on('dialog',lambda d:(_ for _ in ()).throw(AssertionError('Unexpected popup: '+d.message)))
 return page
def ready(page):
 page.evaluate('document.fonts.ready');page.wait_for_timeout(200)
 page.evaluate('''async()=>{await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():i.decode()))}''')
def shot(page,index,stage=False):
 page.evaluate("document.activeElement?.blur();scrollTo({top:0,behavior:'instant'})");ready(page)
 g=page.evaluate('''()=>({viewport:[innerWidth,innerHeight],scrollY,doc:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
  canvas:document.querySelector('.native-canvas')?.getBoundingClientRect().toJSON(),filmstrip:document.querySelector('.stage-filmstrip')?.getBoundingClientRect().toJSON(),
  skipFocused:document.activeElement?.classList.contains('shell-skip'),dialogs:document.querySelectorAll('dialog[open]').length,
  clipped:[...document.querySelectorAll('.native-canvas [data-native-slide],.native-canvas [data-inline-widget]:not([hidden])')].filter(e=>{let c=e.querySelector('.inline-content')??e.firstElementChild;return c&&c.getBoundingClientRect().bottom>e.getBoundingClientRect().bottom+3}).map(e=>e.className)})''')
 assert g['doc'][0]<=g['viewport'][0]+1 and not g['skipFocused'] and g['dialogs']==0,g
 if stage:
  assert g['scrollY']==0 and g['canvas']['top']>=0 and g['canvas']['bottom']<1080 and g['filmstrip']['bottom']<=1080 and not g['clipped'],g
  assert abs(g['canvas']['width']/g['canvas']['height']-16/9)<.01,g
 text=page.locator('body').inner_text();assert not any(v.lower() in text.lower() for v in FORBIDDEN)
 report['geometry'].append({'name':NAMES[index],**g});page.screenshot(path=str(OUT/NAMES[index]),full_page=False,animations='disabled')
 print('Captured '+NAMES[index],flush=True)
def result(r):assert r.ok,(r.status,r.text()[:600]);return r.json()
def start():
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();env=os.environ.copy()
 for key in list(env):
  if key.startswith('POLYPHONY_AI_'):env.pop(key,None)
 env.update(HOST='127.0.0.1',PORT=str(port),POLYPHONY_ROOM_FILE=str(OUT/'capture-rooms.json'))
 log=open(OUT/'capture-server.log','w',encoding='utf8');proc=subprocess.Popen(['node',str(S/'server.mjs')],cwd=S,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
 url=f'http://127.0.0.1:{port}'
 for _ in range(150):
  try:
   with urllib.request.urlopen(url+'/api/status',timeout=1):return proc,log,url
  except Exception:time.sleep(.1)
 raise RuntimeError('server unavailable')
def cmd(c,url,code,kind,payload=None):
 s=result(c.request.post(url+f'/api/rooms/{code}/session',data={'role':'teacher'}))['room']
 payload={**(payload or {}),'expectedLectureIndex':s['lecture']['index'],'expectedLectureTurn':s['lecture']['turn'],'expectedRound':s['round'],'expectedLessonId':s['lessonId']}
 return result(c.request.post(url+f'/api/rooms/{code}/commands',data={'role':'teacher','type':kind,'payload':payload}))['room']
def loadscore(id):return json.loads((ROOT/'示例课件/V4原生实战课件'/f'{id}.json').read_text(encoding='utf8'))
def room(c,url,id):return result(c.request.post(url+'/api/rooms',data={'lecture':loadscore(id)}))['room']['code']
def setpage(c,url,code,index):cmd(c,url,code,'lectureNavigate',{'index':index})
def activate(c,url,code,index):setpage(c,url,code,index);return cmd(c,url,code,'lectureInteract')
def rounds(c,url,code):
 s=cmd(c,url,code,'demoFill');cmd(c,url,code,'reveal');cmd(c,url,code,'analyze');cmd(c,url,code,'branch',{'branchId':s['lesson']['branches'][0]['id']});cmd(c,url,code,'revise');cmd(c,url,code,'demoFill');cmd(c,url,code,'reveal');return cmd(c,url,code,'close')
def stage(page,url,code,number):
 page.goto(url+f'/?view=stage&room={code}');page.locator('.lecture-frame-head h2').wait_for();page.wait_for_function('(n)=>document.querySelector(".native-player-bar p")?.textContent.includes("第 "+n+" / ")',arg=number);ready(page)

def offline(browser):
 for name in ['共演智课-单文件离线演示版.html','共演智课-交互模组库独立版.html']:
  c=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce');page=watch(c.new_page())
  def deny(route):report['offlineRequests'].append(route.request.url);route.abort()
  c.route('http://**',deny);c.route('https://**',deny);base=(ROOT/name).as_uri();page.goto(base);page.wait_for_load_state('networkidle')
  if '独立版' in name:
   page.locator('[data-nav=materials]').first.click()
  assert page.locator('[data-source-mode=import]').is_visible() and page.locator('[data-source-mode=native]').is_visible()
  page.locator('[data-source-mode=native]').click();page.locator('[data-author-preset="1"]').click();assert '物理光学' in page.locator('[name=course]').input_value();page.locator('[data-source-mode=import]').click()
  for id,total in [('deck-c-pointers',12),('deck-optics',10),('deck-english-seminar',10)]:
   page.goto(base+'?view=materials');page.locator(f'[data-showcase="{id}"]').click();page.locator('[data-pacing]').select_option('full-demo');page.locator('[data-run-harness]').click();page.locator('[data-publish]').wait_for();assert page.locator('[data-page]').count()==total
   assert page.locator('[data-stage][data-state=complete]').count()==5
   page.locator('[data-publish]').click();page.locator('.native-canvas .lecture-frame-head h2').wait_for();teacher_url=page.url
   mobile=watch(c.new_page());mobile.set_viewport_size({'width':390,'height':844});mobile.goto(teacher_url.replace('view=desk','view=student'));mobile.locator('.native-mobile-card').wait_for()
   for i,p in enumerate(loadscore(id)['pages']):
    page.bring_to_front()
    page.locator(f'[data-slide-index="{i}"]').click();page.wait_for_function('(n)=>document.querySelector(".native-player-bar p")?.textContent.includes("第 "+n+" / ")',arg=i+1)
    page.wait_for_function('(t)=>document.querySelector(".lecture-frame-head h2")?.textContent===t',arg=p['title'])
    mobile.wait_for_function('(n)=>document.querySelector(".native-player-bar p")?.textContent.includes("第 "+n+" / ")',arg=i+1,polling=100)
    if not p.get('interaction'):continue
    page.locator('[data-inline-action=interact]').click();page.locator('[data-inline-widget]:not([hidden])').wait_for();mobile.locator('[data-inline-widget]:not([hidden])').wait_for()
    mobile.bring_to_front()
    if mobile.locator('[data-inline-join]').count():mobile.locator('[name=name]').fill('离线课堂同学');mobile.locator('[data-inline-join] button').click()
    mobile.locator('[data-inline-response]').wait_for()
    lesson=p['interaction'];choice=lesson.get('correctOptionId') or lesson['options'][0]['id']
    if lesson['activityId']=='step-fault@1':mobile.locator(f'[data-step-select="{choice}"]').click()
    else:mobile.locator(f'[name=optionId][value="{choice}"]').check()
    mobile.locator('[data-reason="0"]').click();mobile.locator('.inline-submit').click();mobile.locator('.inline-submitted').wait_for()
    page.bring_to_front()
    page.locator('[data-inline-action=demoFill]').click();page.locator('[data-inline-action=reveal]').click();page.locator('[data-inline-action=analyze]').click()
    if lesson['activityId']=='param-explorer@1':
     page.bring_to_front();curve=page.locator('[data-curve="0"]');before=curve.get_attribute('d');page.locator('[data-module-slider="0"]').fill('0.7');page.wait_for_function('(d)=>document.querySelector("[data-curve]").getAttribute("d")!==d',arg=before)
    if lesson['activityId']=='evidence-weighing@1':page.locator('[data-inline-action=toggleAiPeer]').click();page.locator('.module-peer').wait_for()
    page.locator('[data-inline-action=branch]').click();page.locator('[data-inline-action=revise]').click();page.locator('[data-inline-action=demoFill]').click();page.locator('[data-inline-action=reveal]').click();page.locator('[data-inline-action=close]').click();mobile.locator('.inline-feedback').wait_for()
    assert page.locator('dialog[open]').count()==0
   mobile.locator('.native-takeaways summary').click();assert mobile.locator('.native-takeaways article').count()==3;mobile.close()
   report['checks'].append({'bundle':name,'deck':id,'pages':total,'inlineInteractions':3,'mobileStream':True});print('Offline deck verified: '+name+' / '+id,flush=True)
  page.goto(base+'?view=lab')
  for i in range(4):page.locator(f'[data-module-tab="{i}"]').click();assert page.locator('.v3-inspector pre').inner_text().find('@1')>=0
  page.locator('[data-protocol-overview]').click();ready(page);assert page.locator('.v4-architecture-panel img').evaluate('i=>i.naturalWidth===1600&&i.src.startsWith("data:")')
  report['checks'].append({'bundle':name,'dualSource':True,'galleryModules':4,'embeddedArchitecture':True});c.close()
  print('Offline verified: '+name,flush=True)

proc,log,url=start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,channel='msedge',args=['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'])
  c=browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=2,reduced_motion='reduce');page=watch(c.new_page());page.goto(url);page.wait_for_load_state('networkidle');page.locator('[data-source-mode=native]').click();page.locator('[data-author-form]>button').click();page.locator('[data-publish]').wait_for(timeout=45000);shot(page,0)
  pc=browser.new_context(viewport={'width':1920,'height':1080},device_scale_factor=2,reduced_motion='reduce');projection=watch(pc.new_page())
  code=room(c,url,'deck-c-pointers');setpage(c,url,code,5);stage(projection,url,code,6);shot(projection,1,True)
  activate(c,url,code,6);rounds(c,url,code);projection.wait_for_function('document.querySelector(".inline-paired")?.textContent.includes("92%")');stage(projection,url,code,7);shot(projection,2,True)
  optic=room(c,url,'deck-optics');activate(c,url,optic,4);cmd(c,url,optic,'demoFill');cmd(c,url,optic,'reveal');stage(projection,url,optic,5);projection.locator('[data-module-slider="0"]').fill('0.55');projection.locator('[data-module-slider="1"]').fill('6');shot(projection,3,True)
  english=room(c,url,'deck-english-seminar');activate(c,url,english,7);cmd(c,url,english,'demoFill');cmd(c,url,english,'reveal');cmd(c,url,english,'toggleAiPeer');stage(projection,url,english,8);projection.locator('.module-peer').wait_for();shot(projection,4,True)
  # Separate classroom keeps the mobile capture's independent first vote intact.
  mobile_code=room(c,url,'deck-c-pointers');activate(c,url,mobile_code,3);rounds(c,url,mobile_code);activate(c,url,mobile_code,6)
  mc=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,reduced_motion='reduce');phone=watch(mc.new_page());phone.goto(url+f'/?view=student&room={mobile_code}');phone.locator('[name=name]').fill('课堂同学');phone.locator('[data-inline-join] button').click();phone.locator('[data-step-select=S3]').click();phone.locator('[data-reason="0"]').click();phone.evaluate('document.activeElement?.blur();scrollTo(0,0)');ready(phone);left=Image.open(BytesIO(phone.screenshot(full_page=False))).convert('RGB');left.save(OUT/'phone-left-2x.png')
  phone.locator('[data-inline-response] .inline-submit').click();s=cmd(c,url,mobile_code,'demoFill');cmd(c,url,mobile_code,'reveal');cmd(c,url,mobile_code,'analyze');cmd(c,url,mobile_code,'branch',{'branchId':s['lesson']['branches'][0]['id']});cmd(c,url,mobile_code,'revise');phone.locator('[data-step-select=S4]').click();phone.locator('[data-reason="1"]').click();phone.locator('[data-inline-response] .inline-submit').click();cmd(c,url,mobile_code,'demoFill');cmd(c,url,mobile_code,'reveal');cmd(c,url,mobile_code,'close');phone.locator('.inline-feedback').wait_for();phone.locator('.native-takeaways summary').click();ready(phone);phone.evaluate('document.activeElement?.blur();scrollTo({top:0,behavior:"instant"})');phone.wait_for_timeout(100);right=Image.open(BytesIO(phone.screenshot(full_page=False))).convert('RGB');right.save(OUT/'phone-right-2x.png')
  assert left.size==right.size==(780,1688)
  im=Image.new('RGB',(1720,1900),'#F0F5F9');d=ImageDraw.Draw(im);font=lambda n:ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',n)
  d.text((48,24),'学生单页流式跟随 · 讲义、作答与速查卡同页贯通',font=font(38),fill='#17354F');d.text((48,90),'R1 · 同步第 7 / 12 页：点选代码行与三秒直觉',font=font(23),fill='#087E87');d.text((900,90),'R2 · 页内反馈与已解锁考前速查卡',font=font(23),fill='#087E87');im.paste(left,(40,155));im.paste(right,(900,155));im.save(OUT/NAMES[5]);mc.close()
  page.goto(url+'/?view=lab');page.locator('[data-module-tab="0"]').click();page.locator('[data-protocol-overview]').click();shot(page,6)
  # Real legacy PDF through Tab 1, retaining every visual page before publishing.
  page.goto(url+'/?view=materials');page.locator('[data-source-mode=import]').click();page.locator('[data-file]').set_input_files(str(next((ROOT/'示例课件').glob('04-*.pdf'))));page.locator('[data-page]').first.wait_for(timeout=60000);assert page.locator('[data-page]').count()==8;page.locator('[data-run-harness]').click();page.locator('[data-publish]').wait_for();page.locator('[data-publish]').click();page.locator('.lecture-frame-original img').wait_for();report['checks'].append({'legacyPdfUi':True,'originalVisualPages':8})
  offline(browser);browser.close()
 assert not report['consoleErrors'] and not report['pageErrors'] and not report['offlineRequests'],report
 for n in NAMES:
  im=Image.open(OUT/n);report['screenshots'].append({'name':n,'pixels':list(im.size),'dpr':2});shutil.copy2(OUT/n,ROOT/n);shutil.copy2(OUT/n,SOURCE/n)
finally:
 proc.terminate()
 try:proc.wait(timeout=8)
 except subprocess.TimeoutExpired:proc.kill();proc.wait()
 log.close();report['serverStopped']=proc.poll() is not None;(OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
