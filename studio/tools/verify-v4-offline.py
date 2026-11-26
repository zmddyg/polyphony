from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];DELIVERY=ROOT.parent if (ROOT.parent/'共演智课-单文件离线演示版.html').exists() else ROOT.parents[2]
report={'checks':[],'consoleErrors':[],'exceptions':[]}
(ROOT/'artifacts').mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,channel='msedge');c=b.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
    teacher=c.new_page()
    def track(page):
        page.on('pageerror',lambda e:report['exceptions'].append(str(e)))
        page.on('console',lambda m:report['consoleErrors'].append(m.text) if m.type=='error' else None)
    track(teacher)
    teacher.goto((DELIVERY/'共演智课-单文件离线演示版.html').as_uri());teacher.locator('[data-file]').wait_for(state='attached')
    teacher.locator('[data-file]').set_input_files(str(DELIVERY/'示例课件/V4原生实战课件/deck-c-pointers.json'))
    teacher.locator('[data-publish]').wait_for();assert teacher.locator('[data-page]').count()==12
    teacher.locator('[data-publish]').click();teacher.locator('.native-canvas .lecture-frame-head h2').wait_for()
    teacher.locator('[data-slide-index="3"]').click();teacher.locator('[data-inline-action=interact]').click()
    teacher.locator('[data-inline-action=demoFill]').click();teacher.locator('[data-inline-action=reveal]').click()
    assert teacher.locator('.native-canvas').count()==1
    teacher.evaluate('document.activeElement?.blur()');teacher.keyboard.press('Space')
    teacher.wait_for_function('document.querySelector(".native-player-bar p")?.textContent.includes("第 5 / 12")')
    teacher.keyboard.press('ArrowLeft');teacher.wait_for_function('document.querySelector(".native-player-bar p")?.textContent.includes("第 4 / 12")')
    teacher.locator('[data-inline-action=interact]').click();teacher.locator('[data-inline-action=close]').click()
    teacher.locator('[data-inline-action=next]').click()
    student=c.new_page();track(student);student.goto(teacher.url.replace('view=desk','view=student'));student.locator('.native-mobile-card .lecture-frame-head h2').wait_for()
    assert '第 5 / 12' in student.locator('.native-player-bar p').inner_text();assert '(1)' in student.locator('.native-takeaways summary').inner_text()
    assert teacher.evaluate('document.documentElement.scrollWidth<=innerWidth')
    student.set_viewport_size({'width':390,'height':844});assert student.evaluate('document.documentElement.scrollWidth<=innerWidth')
    report['checks']=['file:// native JSON import and validation','12-slide local publication','inline activation without replacing canvas','Space departure from active interaction','ArrowLeft return and archived results','accumulated takeaway on mobile stream','zero horizontal overflow']
    teacher.screenshot(path=str(ROOT/'artifacts/v4-offline-teacher.png'),full_page=False);student.screenshot(path=str(ROOT/'artifacts/v4-offline-mobile.png'),full_page=False)
    b.close()
(ROOT/'artifacts/v4-offline-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));assert not report['exceptions'] and not report['consoleErrors']
