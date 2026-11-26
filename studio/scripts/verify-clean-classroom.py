from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from playwright.sync_api import expect, sync_playwright


STUDIO = Path(__file__).resolve().parents[1]
SOURCE = STUDIO.parent
ROOT = SOURCE.parents[1] if SOURCE.name == 'source' and SOURCE.parent.name == '.polyphony-work' else SOURCE
PPTX = STUDIO / 'tests/fixtures/material-import-hidden.pptx'


def button(page, name):
    return page.get_by_role('button', name=name, exact=True)


def room_view(url, role):
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    query['view'] = [role]
    return urlunsplit(parts._replace(query=urlencode(query, doseq=True)))


def answer(student):
    option = student.locator('[data-inline-response] input[name="optionId"]').first
    option.check()
    reason = student.locator('[data-reason]').first
    if reason.count():
        expect(student.locator('textarea[name="reason"]')).to_be_hidden()
        reason.click()
    button(student, '提交').click()
    expect(student.get_by_text('已提交，公布前可修改。')).to_be_visible()


with TemporaryDirectory(prefix='polyphony-platform-') as folder, sync_playwright() as p:
    target_dir = Path(folder)
    platform = target_dir / 'platform.html'
    copyfile(ROOT / '共演智课-离线平台.html', platform)
    assert len(list(target_dir.iterdir())) == 1
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1280, 'height': 850})
    teacher = context.new_page()
    teacher.goto(platform.as_uri())
    expect(button(teacher, '导入课件')).to_be_visible()
    expect(button(teacher, 'AI 备课')).to_be_visible()
    expect(button(teacher, '课堂记录')).to_have_count(0)
    expect(teacher.locator('[data-demo-deck], .harness-pipeline')).to_have_count(0)

    teacher.locator('[data-file]').set_input_files(PPTX)
    button(teacher, '开始上课').click()
    expect(teacher.locator('.native-canvas .lecture-frame-head')).to_be_visible()
    expect(button(teacher, '开始互动')).to_have_count(0)
    teacher.get_by_role('link', name='备课', exact=True).click()
    teacher.locator('.prep-menu > summary').click()
    button(teacher, '返回备课首页').click()

    button(teacher, 'AI 备课').click()
    teacher.get_by_label('课程和授课对象').fill('逻辑课 · 大一')
    teacher.get_by_label('本节课讲什么').fill('识别充分条件。用反例区分充分条件与必要条件。')
    expect(teacher.locator('[data-author-form] button[type=submit]')).to_have_count(1)
    button(teacher, '生成课件').click()
    expect(teacher.get_by_text('10 页 · 2 个互动')).to_be_visible()
    teacher.locator('.prep-menu > summary').click()
    button(teacher, '返回备课首页').click()
    teacher.reload()
    button(teacher, '继续上次备课').click()
    expect(teacher.get_by_text('10 页 · 2 个互动')).to_be_visible()

    button(teacher, '开始上课').click()
    expect(teacher.locator('[data-lecture-page]')).to_be_visible()
    teacher.locator('[data-lecture-page]').select_option('3')
    student = context.new_page()
    student.set_viewport_size({'width': 390, 'height': 844})
    student.goto(room_view(teacher.url, 'student'))
    projector = context.new_page()
    projector.goto(room_view(teacher.url, 'stage'))
    expect(projector.locator('.stage-filmstrip')).to_have_count(0)
    button(teacher, '开始互动').click()
    expect(button(teacher, '模拟作答')).to_have_count(0)
    expect(student.locator('details.native-takeaways')).to_have_count(0)
    student.get_by_label('课堂显示名').fill('验收同学')
    button(student, '加入并作答').click()
    answer(student)

    button(teacher, '公布结果').click()
    expect(button(teacher, '公布结果')).to_have_count(0)
    button(teacher, '讨论后再答').click()
    button(teacher, '开始第二轮').click()
    answer(student)
    button(teacher, '公布结果').click()
    button(teacher, '完成本页').click()
    expect(student.get_by_text('本课速查（1）')).to_be_visible()
    assert student.evaluate('document.documentElement.scrollWidth <= innerWidth')

    teacher.locator('.native-player-bar details > summary').click()
    button(teacher, '结束上课').click()
    button(teacher, '查看复盘').click()
    expect(teacher.get_by_role('heading', name='课后复盘')).to_be_visible()
    expect(teacher.get_by_text('2 份学生作答', exact=False)).to_be_visible()
    expect(teacher.locator('.pr-detail-toggle')).not_to_have_attribute('open', '')
    context.close()

    context = browser.new_context()
    demo = context.new_page()
    demo.goto((ROOT / '共演智课-单文件离线演示版.html').as_uri())
    expect(demo.locator('[data-demo-deck]')).to_have_count(3)
    demo.locator('[data-demo-deck]').first.click()
    expect(demo.locator('[data-lecture-page] option')).to_have_count(12)
    demo.locator('[data-lecture-page]').select_option('6')
    button(demo, '开始互动').click()
    button(demo, '模拟作答').click()
    expect(demo.locator('.inline-live-count')).to_contain_text('含12份模拟')
    demo.get_by_role('link', name='交互模组').click()
    button(demo, 'Harness 架构与契约同屏').click()
    expect(demo.locator('.v4-architecture-panel')).to_be_visible()
    context.close()
    browser.close()

print('Formal platform, offline PPTX, native draft, classroom/recap and separate demo passed.')
