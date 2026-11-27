"""V4 end-to-end and geometry audit. Run with run-v3-browser-tests.py (owned PID)."""
from pathlib import Path
from urllib.parse import urlparse,parse_qs
import json,math
from playwright.sync_api import sync_playwright
import pymupdf as fitz

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'v4-ui';OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:4188'
report={'checks':[],'consoleErrors':[],'exceptions':[],'popups':[],'overflows':[],'decks':[],'imports':[]}

def track(page):
    page.on('pageerror',lambda e:report['exceptions'].append(str(e)))
    page.on('console',lambda m:report['consoleErrors'].append(m.text) if m.type=='error' else None)
    page.on('dialog',lambda d:(report['popups'].append(d.message),d.dismiss()))

def check(page,name,shot=False,stage=False):
    page.wait_for_timeout(70)
    geometry=page.evaluate('''() => ({width:innerWidth,documentWidth:document.documentElement.scrollWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight,
      clipped:[...document.querySelectorAll('.native-canvas:not(.native-mobile-card) [data-native-slide], .native-canvas:not(.native-mobile-card) [data-inline-widget]')].filter(e=>{if(e.hidden||!e.clientHeight)return false;const child=e.querySelector('.inline-content')??e.firstElementChild;if(!child)return false;const a=e.getBoundingClientRect(),b=child.getBoundingClientRect();return b.bottom>a.bottom+2||b.right>a.right+2;}).map(e=>({part:e.hasAttribute('data-inline-widget')?'interaction':'content',bounds:e.getBoundingClientRect().toJSON(),content:(e.querySelector('.inline-content')??e.firstElementChild).getBoundingClientRect().toJSON()})),
      ratio:document.querySelector('.native-canvas:not(.native-mobile-card)')?(()=>{let r=document.querySelector('.native-canvas').getBoundingClientRect();return r.width/r.height;})():null})''')
    if geometry['documentWidth']>geometry['width']+1 or geometry['clipped'] or (geometry['ratio'] and abs(geometry['ratio']-16/9)>.015):report['overflows'].append({'name':name,**geometry})
    if stage and geometry['width']>=1000 and geometry['documentHeight']>geometry['height']+2:report['overflows'].append({'name':name,'stageViewport':geometry})
    report['checks'].append({'name':name,**geometry})
    (OUT/'report-in-progress.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if shot:
        page.evaluate("scrollTo({top:0,behavior:'instant'})");page.screenshot(path=str(OUT/(name+'.png')),full_page=True)

def result(response):
    assert response.ok,(response.status,response.text()[:400]);return response.json()

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='msedge')
    for width,height in [(1440,900),(1920,1080),(390,844)]:
        teacher_context=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce',accept_downloads=True)
        teacher=teacher_context.new_page();track(teacher)
        teacher.goto(BASE);teacher.wait_for_load_state('networkidle');check(teacher,f'import-home-{width}',True)
        assert teacher.locator('[data-showcase]').count()==3
        teacher.locator('[data-source-mode=native]').click()
        check(teacher,f'native-author-form-{width}',True)
        assert teacher.locator('[data-author-form]').is_visible()
        teacher.locator('[data-author-form] button:not([type=button])').click()
        teacher.locator('[data-publish]').wait_for(timeout=45000)
        assert teacher.locator('[data-author-form]').is_visible()
        assert teacher.locator('[data-page]').count()==12
        check(teacher,f'native-author-complete-{width}',True)
        with teacher.expect_download() as download:
            teacher.locator('[data-export-deck]').click()
        path=OUT/f'exported-c-{width}.json';download.value.save_as(path)
        score=json.loads(path.read_text(encoding='utf-8'));assert len(score['pages'])==12
        teacher.locator('[data-publish]').click();teacher.locator('.native-canvas .lecture-frame-head h2').wait_for()
        code=parse_qs(urlparse(teacher.url).query)['room'][0]

        def state():return result(teacher_context.request.post(BASE+f'/api/rooms/{code}/session',data={'role':'teacher'}))['room']
        def command(kind,payload=None):
            s=state();payload={**(payload or {}),'expectedLectureIndex':s['lecture']['index'],'expectedLectureTurn':s['lecture']['turn'],'expectedRound':s['round'],'expectedLessonId':s['lessonId']}
            return result(teacher_context.request.post(BASE+f'/api/rooms/{code}/commands',data={'role':'teacher','type':kind,'payload':payload}))['room']

        specs=[('deck-c-pointers',None),('deck-optics',{'course':'物理光学与光电子学','topic':'干涉；衍射；MZM调制','pageCount':10}),('deck-english-seminar',{'course':'大学英语','topic':'Unit 4；Hedging；盲审研讨','pageCount':10})]
        for deck_id,spec in specs:
            if spec:
                generated=result(teacher_context.request.post(BASE+f'/api/rooms/{code}/author-deck',data={'spec':spec}))
                score=generated['lectureScore'];assert len(score['pages'])==10
                opened=result(teacher_context.request.post(BASE+'/api/rooms',data={'lecture':score}));code=opened['room']['code']
                teacher.goto(BASE+f'/?view=desk&room={code}');teacher.locator('.lecture-frame-head h2').wait_for()
            stage=teacher_context.new_page();track(stage);stage.goto(BASE+f'/?view=stage&room={code}');stage.locator('.lecture-frame-head h2').wait_for()
            mobile_context=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce');mobile=mobile_context.new_page();track(mobile)
            mobile.goto(BASE+f'/?view=student&room={code}');mobile.locator('.lecture-frame-head h2').wait_for()
            peer_context=browser.new_context()
            peer_session=result(peer_context.request.post(BASE+f'/api/rooms/{code}/session',data={'role':'student'}))
            def peer_command(kind,extra):
                s=state();payload={**extra,'expectedLectureIndex':s['lecture']['index'],'expectedLectureTurn':s['lecture']['turn'],'expectedRound':s['round'],'expectedLessonId':s['lessonId']}
                return result(peer_context.request.post(BASE+f'/api/rooms/{code}/commands',data={'role':'student','type':kind,'payload':payload}))
            urls=[teacher.url,stage.url,mobile.url];completed=0
            for index,slide in enumerate(score['pages']):
                if index:
                    # Exercise the HTTP navigation command, including departure from closed inline activities.
                    teacher.evaluate('document.activeElement?.blur()')
                    command('lectureNavigate',{'index':index})
                for page in [teacher,stage,mobile]:
                    page.wait_for_function('(title)=>document.querySelector(".lecture-frame-head h2")?.textContent===title',arg=slide['title'])
                check(teacher,f'{deck_id}-teacher-p{index+1}-{width}',index in [0,5,8])
                check(stage,f'{deck_id}-stage-p{index+1}-{width}',index in [0,5,8],True)
                check(mobile,f'{deck_id}-mobile-p{index+1}-{width}',width==390 and index in [0,5,8])
                lesson=slide.get('interaction')
                if not lesson:continue
                teacher.evaluate('window.__nativeCanvas=document.querySelector(".native-canvas")')
                teacher.locator('[data-inline-action=interact]').click()
                for page in [teacher,stage,mobile]:page.locator('[data-inline-widget]:not([hidden])').wait_for()
                assert teacher.evaluate('window.__nativeCanvas===document.querySelector(".native-canvas")')
                assert [teacher.url,stage.url,mobile.url]==urls
                assert teacher.locator('dialog[open]').count()==0
                if mobile.locator('[data-inline-join]').count():
                    mobile.locator('[name=name]').fill('课堂实测同学')
                    mobile.locator('[data-inline-join] button').click()
                mobile.locator('[data-inline-response]').wait_for()
                mobile.locator('[name=reason]').fill('草稿保留：先检查定义和边界。')
                command('demoFill')
                mobile.wait_for_function('document.querySelector(".inline-live-count b")?.textContent==="12"')
                assert mobile.locator('[name=reason]').input_value()=='草稿保留：先检查定义和边界。'
                for round_no in [1,2]:
                    chosen=lesson['options'][0]['id'] if round_no==1 else (lesson.get('correctOptionId') or lesson['options'][1]['id'])
                    if lesson['activityId']=='step-fault@1':mobile.locator(f'[data-step-select="{chosen}"]').click()
                    else:mobile.locator(f'[name=optionId][value="{chosen}"]').check()
                    if lesson['activityId']=='param-explorer@1':
                        target=mobile.locator('[data-module-slider="0"]');before=mobile.locator('[data-curve="0"]').get_attribute('d');target.fill('0.7')
                        mobile.wait_for_timeout(90);assert before!=mobile.locator('[data-curve="0"]').get_attribute('d')
                    mobile.locator('[data-reason="0"]').click()
                    mobile.locator('[data-inline-response] button.inline-submit').click()
                    mobile.locator('.inline-submitted').wait_for()
                    if round_no==1:
                        peer_command('join',{'name':'独立对照同学'})
                        peer_command('respond',{'optionId':lesson['options'][1]['id'],'reason':lesson['moduleConfig']['quickReasons'][1]})
                    command('reveal')
                    if round_no==1:
                        command('analyze')
                        teacher.locator('.inline-reason-split').wait_for()
                        check(stage,f'{deck_id}-reason-split-p{index+1}-{width}',True,True)
                        if lesson['activityId']=='evidence-weighing@1':
                            command('toggleAiPeer');mobile.locator('.module-peer').wait_for();check(mobile,f'blind-peer-mobile-{width}',True)
                        command('branch',{'branchId':lesson['branches'][0]['id']})
                        command('revise')
                        mobile.locator('[data-inline-response]').wait_for()
                        command('demoFill')
                    else:
                        mobile.locator('.inline-paired').wait_for()
                        command('close')
                        mobile.locator('.inline-feedback').wait_for()
                        completed+=1
                        assert f'({completed})' in mobile.locator('.native-takeaways summary').inner_text()
                check(teacher,f'{deck_id}-inline-p{index+1}-{width}',True)
                check(stage,f'{deck_id}-inline-stage-p{index+1}-{width}',True,True)
                check(mobile,f'{deck_id}-inline-mobile-p{index+1}-{width}',True)
                assert [teacher.url,stage.url,mobile.url]==urls
            assert completed==3
            mobile.locator('.native-takeaways summary').click();assert mobile.locator('.native-takeaways article').count()==3
            check(mobile,f'{deck_id}-takeaway-drawer-{width}',True)
            assert len(state()['lectureArchive'])==3
            report['decks'].append({'id':deck_id,'viewport':[width,height],'pages':len(score['pages']),'completedInteractions':completed})
            stage.close();mobile_context.close();peer_context.close()
        # Both backward keys work while the final slide remains in the same player.
        for key in ['ArrowLeft','PageUp']:
            before=state()['lecture']['index'];teacher.evaluate('document.activeElement?.blur()');teacher.keyboard.press(key)
            teacher.wait_for_function('(i)=>document.querySelector(".native-player-bar p")?.textContent.includes("第 "+i+" / ")',arg=before)
        command('lectureFinish');teacher.get_by_text('本节课已结束',exact=True).wait_for()
        teacher_context.close()

    # Actual import UI: PDF pixels and PowerPoint pixels, then Harness and native playback.
    c=browser.new_context(viewport={'width':1440,'height':900});page=c.new_page();track(page)
    pdf=fitz.open()
    for i in range(3):
        pdf_page=pdf.new_page(width=960,height=540);pdf_page.insert_text((60,80),f'Wave optics page {i+1}',fontsize=30);pdf_page.insert_text((60,150),'I = I1 + I2 + 2 sqrt(I1 I2) cos(phi)',fontsize=20)
    pdf.save(OUT/'original.pdf');pdf.close()
    for path in [OUT/'original.pdf',ROOT/'tests/fixtures/material-import-basic.ppt',ROOT/'tests/fixtures/material-import-hidden.pptx']:
        page.goto(BASE);page.wait_for_load_state('networkidle')
        page.locator('[data-file]').set_input_files(str(path));page.locator('[data-page]').first.wait_for(timeout=60000)
        assert page.locator('.v3-source-preview>img').count()==1
        page.locator('[data-run-harness]').click();page.locator('[data-publish]').wait_for(timeout=30000)
        pages=page.locator('[data-page]').count();page.locator('[data-publish]').click();page.locator('.lecture-frame-original img').wait_for()
        check(page,'legacy-'+path.suffix[1:],True)
        report['imports'].append({'file':path.name,'visiblePages':pages,'originalPreview':True})
    c.close();browser.close()

(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v if k!='checks' else len(v) for k,v in report.items()},ensure_ascii=False))
assert not report['consoleErrors'] and not report['exceptions'] and not report['popups'] and not report['overflows']
