"""Headless end-to-end verification. Run through with_server.py to own server lifetime."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'v3-ui'
OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:4188'
report={'checks':[],'consoleErrors':[],'exceptions':[],'overflows':[]}

def track(page):
    page.on('pageerror',lambda error:report['exceptions'].append(str(error)))
    page.on('console',lambda msg:report['consoleErrors'].append(msg.text) if msg.type=='error' else None)

def check(page,name,shot=False):
    page.wait_for_timeout(120)
    page.evaluate('scrollTo(0,0)')
    overflow=page.evaluate('''() => ({width:innerWidth,documentWidth:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width&&s.display!=='none'&&s.position!=='absolute'&&(r.right>innerWidth+2||r.left < -2)}).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,70)}))})''')
    if overflow['documentWidth']>overflow['width']+1:report['overflows'].append({'check':name,**overflow})
    if name.startswith('stage-') and page.viewport_size['width']>=1000:
        try: page.wait_for_function('document.documentElement.scrollHeight<=innerHeight+1',timeout=2500)
        except Exception: pass
        actual_height=page.evaluate('document.documentElement.scrollHeight')
        if actual_height>page.viewport_size['height']+1:report['overflows'].append({'check':name,'stageHeight':actual_height,'viewportHeight':page.viewport_size['height']})
    report['checks'].append({'name':name,'width':page.viewport_size['width'],'documentWidth':overflow['documentWidth']})
    if shot:page.screenshot(path=str(OUT/(name+'.png')),full_page=True)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='msedge')
    for width,height in [(1440,900),(1920,1080),(390,844)]:
        context=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce')
        page=context.new_page();track(page)
        page.goto(BASE);page.wait_for_load_state('networkidle')
        check(page,f'home-{width}',True)
        assert page.locator('[data-showcase]').count()==3
        assert page.locator('[data-stage]').count()==5
        page.locator('[data-api-hub]').click()
        page.locator('dialog[open]').wait_for()
        check(page,f'api-dialog-{width}',True)
        page.locator('dialog[open] [name=preset]').select_option('deepseek')
        assert page.locator('dialog[open] [name=baseUrl]').input_value()=='https://api.deepseek.com'
        page.locator('dialog[open] [name=key]').fill('ui-fixture-secret')
        page.locator('dialog[open] [type=submit]').click()
        page.get_by_text('已保存；密钥不会写入课件。',exact=True).wait_for()
        api_status=context.request.get(BASE+'/api/status').json()
        assert api_status['providerSummary']['configured'] is True
        assert 'ui-fixture-secret' not in json.dumps(api_status)
        page.locator('[data-provider-clear]').click()
        page.get_by_text('配置已清除。',exact=True).wait_for()
        page.locator('[data-dismiss]').click()
        page.locator('[data-showcase="deck-foundation"]').click()
        page.locator('[data-run-harness]').click()
        page.locator('[data-publish]').wait_for(timeout=30000)
        assert page.locator('[data-stage][data-state=complete]').count()==5
        assert page.locator('[data-page]').count()==5
        check(page,f'harness-{width}',True)
        page.locator('[data-page="1"]').click()
        assert page.locator('.module-artifact li').count()==5
        check(page,f'page-step-preview-{width}')
        page.locator('[data-page="3"]').click()
        before=page.locator('[data-curve="0"]').get_attribute('d')
        page.locator('[data-module-slider="0"]').fill('2')
        page.wait_for_timeout(80)
        assert before!=page.locator('[data-curve="0"]').get_attribute('d')
        page.locator('[data-receipt]').click()
        assert 'M99' in page.locator('[data-receipt-dialog]').inner_text()
        check(page,f'harness-receipt-{width}')
        page.locator('[data-close-receipt]').click()
        # Publish the actual compiled deck, navigate original -> attached interaction.
        page.locator('[data-publish]').click()
        page.locator('[data-lecture-action=next]').wait_for()
        check(page,f'published-lecture-{width}')
        # Gallery tests use navigation URLs to retain teacher room cookie.
        page.goto(BASE+'/?view=lab');page.wait_for_load_state('networkidle')
        for i in range(4):
            page.locator(f'[data-module-tab="{i}"]').click()
            check(page,f'gallery-{i}-{width}',True)
            if i==2:
                for j in range(3):
                    page.locator(f'[data-subject="{j}"]').click()
                    old=page.locator('[data-curve="0"]').get_attribute('d')
                    slider=page.locator('[data-module-slider="0"]')
                    slider.fill(slider.get_attribute('max'));page.wait_for_timeout(80)
                    assert old!=page.locator('[data-curve="0"]').get_attribute('d')
                    check(page,f'formula-subject-{j}-{width}')
            if i==3:
                page.locator('[data-module-peer]').click();assert page.locator('.module-peer').count()==1
                check(page,f'gallery-ai-peer-{width}')
            page.locator('[data-next]').click()
            assert page.locator('.contrast-wall').count()==1
            check(page,f'gallery-conflict-{i}-{width}')
            page.locator('[data-next]').click();page.locator('[data-next]').click()
            assert page.locator('.cognition-report').count()==1
            check(page,f'gallery-round2-{i}-{width}')
        # Actual server rooms drive Stage and Student through all four modules.
        for lesson_id,kind in [('pointer-audit','step'),('gaussian-scales','param'),('ai-decision','evidence'),('four-spaces','concept')]:
            response=context.request.post(BASE+'/api/rooms',data={'lessonId':lesson_id,'demo':True})
            assert response.ok,response.text()
            room=response.json()['room'];code=room['code']
            stage=context.new_page();track(stage);stage.goto(BASE+f'/?view=stage&room={code}');stage.wait_for_load_state('networkidle')
            check(stage,f'stage-{kind}-collect-{width}',True)
            student=context.new_page();track(student);student.goto(BASE+f'/?view=student&room={code}');student.wait_for_load_state('networkidle')
            student.locator('[name=name]').fill('验证同学');student.locator('[type=submit]').click()
            student.locator('[name=optionId]').first.wait_for()
            if kind=='step':
                student.locator('[data-step-select=S3]').click();assert student.locator('[name=optionId]:checked').input_value()=='S3'
            else:student.locator('[name=optionId]').first.check()
            student.locator('[data-quick-reason]').first.click()
            student.locator('[type=submit]').click()
            student.wait_for_timeout(150)
            check(student,f'student-{kind}-{width}',True)
            desk=context.new_page();track(desk);desk.goto(BASE+f'/?view=desk&room={code}');desk.wait_for_load_state('networkidle')
            check(desk,f'desk-{kind}-{width}',True)
            other=browser.new_context()
            assert other.request.post(BASE+f'/api/rooms/{code}/session',data={'role':'student'}).ok
            assert other.request.post(BASE+f'/api/rooms/{code}/commands',data={'role':'student','type':'join','payload':{'name':'对照同学'}}).ok
            assert other.request.post(BASE+f'/api/rooms/{code}/commands',data={'role':'student','type':'respond','payload':{'optionId':room['lesson']['options'][1]['id'],'reason':room['lesson']['quickReasons'][-1]}}).ok
            def command(type,payload=None):
                r=context.request.post(BASE+f'/api/rooms/{code}/commands',data={'role':'teacher','type':type,'payload':payload or {}})
                assert r.ok,r.text()
                return r.json()['room']
            if kind=='evidence':
                desk.locator('[data-module-peer]').click();stage.locator('.module-peer').wait_for();assert '96%' in stage.locator('.module-peer').inner_text()
                stage.locator('[data-module-peer]').click();assert stage.locator('.module-peer').count()==0
                stage.locator('[data-module-peer]').click();assert stage.locator('.module-peer').count()==1
                check(stage,f'stage-ai-peer-{width}',True)
            command('reveal');command('analyze')
            stage.locator('.contrast-wall').wait_for()
            if kind=='step':assert stage.locator('.module-artifact .is-fault').count()==1;assert '怀疑此步' in stage.locator('.module-artifact').inner_text()
            if kind=='param':assert stage.locator('.module-curve').count()==1
            check(stage,f'stage-{kind}-conflict-{width}',True)
            command('branch',{'branchId':room['lesson']['branches'][0]['id']});command('revise');command('demoFill');command('reveal')
            stage.locator('.cognition-report').wait_for()
            check(stage,f'stage-{kind}-round2-{width}',True)
            command('close');student.locator('.ps-takeaway').wait_for()
            check(student,f'student-{kind}-takeaway-{width}')
            stage.close();student.close();desk.close();other.close()
        context.close()
    browser.close()
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:(len(v) if isinstance(v,list) else v) for k,v in report.items()},ensure_ascii=False))
assert not report['exceptions'],report['exceptions']
assert not report['consoleErrors'],report['consoleErrors']
assert not report['overflows'],report['overflows']
