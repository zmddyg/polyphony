"""Capture the seven exhibition views from the isolated offline exports at DPR 2."""

import argparse
from io import BytesIO
import json
from pathlib import Path
import re
from shutil import copy2, copyfile
import sys
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright


STUDIO = Path(__file__).resolve().parents[1]
SOURCE = STUDIO.parent
ROOT = SOURCE.parents[1] if SOURCE.name == 'source' and SOURCE.parent.name == '.polyphony-work' else SOURCE
OFFLINE = ['共演智课-离线平台.html', '共演智课-单文件离线演示版.html']
NAMES = [
    '01-双源AI备课中枢-从零生成原生课件与旧课件导入活化.png',
    '02-原生课件流式播放器-C语言实战讲义双栏代码与内存表.png',
    '03-页内原生融合互动-C代码逐行找茬就地热力图.png',
    '04-页内原生动态公式沙盒-物理光学多缝衍射实时调控.png',
    '05-大班翻转课堂页内思辨-大学英语实证阅读与盲盒AI辩友.png',
    '06-学生手机端单页流式跟随-讲义同步与页内点选及速查卡抽屉.png',
    '07-交互模组库与五阶段Harness架构协议总览.png',
]
VIEWPORT = {'width': 1920, 'height': 1080}
PHONE = {'width': 390, 'height': 844}
PIXELS = (3840, 2160)
DPR = 2
ARCHETYPES = ['cover', 'section', 'derivation', 'split-compare', 'example', 'summary']


def launch_browser(playwright):
    chromium = playwright.chromium
    choices = ([{}] if Path(chromium.executable_path).is_file() else []) + [
        {'channel': 'chrome'}, {'channel': 'msedge'},
    ]
    errors = []
    for choice in choices:
        try:
            browser = chromium.launch(
                headless=True, **choice, args=['--disable-background-timer-throttling',
                '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
            )
            return browser, choice.get('channel', 'chromium')
        except PlaywrightError as error:
            errors.append(str(error))
    raise RuntimeError('No installed Chromium, Chrome, or Edge could run: ' + '\n'.join(errors))


def watch(context, report):
    def watch_page(page):
        page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
        page.on('console', lambda message: report['consoleErrors'].append(message.text) if message.type == 'error' else None)
        page.on('websocket', lambda socket: report['offlineRequests'].append(socket.url))
        def guard_dialog(dialog):
            report['pageErrors'].append(f'Unexpected dialog: {dialog.message}')
            dialog.dismiss()
        page.on('dialog', guard_dialog)
    context.on('page', watch_page)
    def guard_request(request):
        scheme = urlsplit(request.url).scheme
        if scheme in {'http', 'https', 'ws', 'wss'} or (scheme == 'file' and request.resource_type != 'document'):
            report['offlineRequests'].append(request.url)
    context.on('request', guard_request)


def geometry(page, required, stage=False, top=True):
    page.bring_to_front()
    page.evaluate("document.activeElement?.blur()")
    if top:
        page.evaluate("scrollTo({top:0,behavior:'instant'})")
    page.evaluate("""async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].filter(image => image.getClientRects().length)
          .map(image => image.complete ? Promise.resolve() : image.decode()));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }""")
    g = page.evaluate("""({ required, stage }) => {
        const clipped = [], root = document.documentElement;
        const bounds = element => element?.getBoundingClientRect().toJSON() ?? null;
        const viewport = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
        const inside = (inner, outer) => inner && inner.height > 0 && outer &&
          inner.top >= outer.top - 3 && inner.left >= outer.left - 3 &&
          inner.bottom <= outer.bottom + 3 && inner.right <= outer.right + 3;
        for (const selector of required) {
          if (!inside(bounds(document.querySelector(selector)), viewport)) clipped.push(selector);
        }
        const canvas = document.querySelector('.native-canvas');
        const filmstrip = document.querySelector('.stage-filmstrip');
        if (stage) {
          for (const [owner, selector] of [
            ['[data-native-slide]', '.lecture-frame'], ['.native-inline', '.inline-content'],
            ['.lecture-frame', '.slide-diagram svg'], ['.lecture-frame', '.katex-display'],
            ['.inline-content', '[data-curve-plot]'], ['.inline-content', '.module-peer'],
          ]) {
            const section = canvas?.querySelector(owner);
            for (const element of section?.querySelectorAll(selector) ?? []) {
              const rect = bounds(element);
              if (rect.height > 0 && (!inside(rect, bounds(section)) || !inside(rect, bounds(canvas)))) clipped.push(selector);
            }
          }
          if (!inside(bounds(canvas), viewport)) clipped.push('.native-canvas');
          if (!inside(bounds(filmstrip), viewport)) clipped.push('.stage-filmstrip');
        }
        if (root.scrollWidth > innerWidth + 1) clipped.push('document width');
        return {
          viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
          scrollY, doc: [root.scrollWidth, root.scrollHeight],
          canvas: bounds(canvas), filmstrip: bounds(filmstrip), clipped,
          dialogs: document.querySelectorAll('dialog[open]').length,
          emptySourceTranscripts: [...document.querySelectorAll('.lecture-frame-transcript')]
            .filter(details => !details.querySelector('.lecture-frame-text')?.textContent.trim()).length,
        };
      }""", {'required': required, 'stage': stage})
    assert g['clipped'] == [] and g['dialogs'] == g['emptySourceTranscripts'] == 0 and g['dpr'] == DPR, g
    if top:
        assert g['scrollY'] == 0, g
    if stage:
        assert abs(g['canvas']['width'] / g['canvas']['height'] - 16 / 9) < .01, g
    return g


def shot(page, number, directory, report, *, required=(), stage=False):
    name = NAMES[number - 1]
    g = geometry(page, list(required), stage)
    assert g['viewport'] == [1920, 1080], g
    page.screenshot(path=str(directory / name), full_page=False, animations='disabled')
    report['geometry'].append({'name': name, **g})


def view_url(url, view):
    parsed = urlsplit(url)
    params = parse_qs(parsed.query)
    params['view'] = [view]
    return urlunsplit(parsed._replace(query=urlencode(params, doseq=True)))


def control(scope, action):
    return scope.locator(f'[data-inline-action="{action}"]')


def materials(page):
    expect(page.get_by_role('button', name='导入课件', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='AI 备课', exact=True)).to_be_visible()
    expect(page.locator('.harness-pipeline > li')).to_have_count(5)
    expect(page.get_by_role('heading', name='我的备课版本库')).to_be_visible()


def ensure_drawer(page):
    toggle = page.locator('[data-demo-toggle]')
    expect(toggle).to_be_visible()
    if toggle.get_attribute('aria-expanded') == 'false':
        toggle.click()
    expect(page.locator('[data-demo-panel]')).to_be_visible()


def launch_deck(page, index, expected_pages):
    ensure_drawer(page)
    page.locator(f'[data-demo-teach="{index}"]').click()
    main = page.locator('.native-split-stage')
    expect(main.locator('[data-lecture-page] option')).to_have_count(expected_pages)
    expect(page.locator('.native-split-companion [data-native-player]')).to_be_visible()
    expect(page.locator('[data-demo-panel]')).to_be_hidden()
    return main


def show_stage(teacher, projection, index, *, interactive=False):
    url = view_url(teacher.url, 'stage')
    if projection.url != url:
        projection.goto(url)
    expect(projection.locator('.native-player-bar p')).to_contain_text(re.compile(fr'第 {index + 1} / '))
    expect(projection.locator('.lecture-frame-head h2')).to_be_visible()
    if interactive:
        expect(projection.locator('.native-inline')).to_be_visible()


def choose_page(main, index, *, interact=False):
    picker = main.locator('[data-lecture-page]')
    picker.select_option(str(index))
    expect(picker).to_have_value(str(index))
    expect(main.locator('.lecture-frame-head h2')).to_be_visible()
    if interact:
        control(main, 'interact').click()
        expect(main.locator('.native-inline')).to_be_visible()


def finish_two_rounds(main):
    control(main, 'demoFill').click()
    expect(main.locator('.inline-live-count b')).not_to_have_text('0')
    control(main, 'reveal').click()
    expect(main.locator('.inline-reason-split article').first).to_be_visible()
    control(main, 'secondRound').click()
    expect(main.locator('.native-inline .inline-heading b')).to_contain_text('R2')
    control(main, 'demoFill').click()
    expect(main.locator('.inline-live-count b')).not_to_have_text('0')
    control(main, 'reveal').click()
    expect(main.locator('.inline-round-shift').first).to_be_visible()
    expect(main.locator('.inline-excerpts')).to_be_visible()
    control(main, 'close').click()
    expect(main.locator('.inline-feedback')).to_be_visible()


def do_student_step(main, phone, line, reason_index):
    form = phone.locator('[data-inline-response]')
    expect(form).to_be_visible()
    form.locator(f'[data-reason="{reason_index}"]').click()
    phone.locator(f'[data-step-select="{line}"]').click()
    form.locator('.inline-submit').click()
    expect(form.locator('.inline-submitted')).to_be_visible()
    expect(main.locator('.inline-live-count b')).to_have_text('1')


def mobile_capture(teacher, context, directory, report):
    main = launch_deck(teacher, 0, 12)
    choose_page(main, 3, interact=True)
    finish_two_rounds(main)
    choose_page(main, 5)

    phone = context.new_page()
    phone.set_viewport_size(PHONE)
    phone.goto(view_url(teacher.url, 'student'))
    control(phone, 'bookmark').click()
    control(phone, 'slidePulse').click()
    expect(main.locator('.native-filmstrip')).to_contain_text('?1')
    choose_page(main, 6, interact=True)
    phone.locator('[name=name]').fill('演示同学')
    phone.locator('[data-inline-join] button').click()
    expect(phone.locator('[data-step-select="S3"]')).to_be_visible()
    phone.locator('[data-step-select="S3"]').click()
    phone.locator('[data-reason="0"]').click()
    left_g = geometry(phone, ['.lecture-frame-head h2', '[data-step-select="S3"]', '[data-reason="0"]'])
    left = Image.open(BytesIO(phone.screenshot(full_page=False, animations='disabled'))).convert('RGB')

    do_student_step(main, phone, 'S3', 0)
    control(main, 'reveal').click()
    expect(main.locator('.inline-excerpts')).to_be_visible()
    control(main, 'secondRound').click()
    do_student_step(main, phone, 'S4', 1)
    control(main, 'reveal').click()
    expect(main.locator('.inline-round-shift').first).to_be_visible()
    expect(main.locator('.inline-excerpts')).to_be_visible()
    control(main, 'close').click()
    expect(phone.locator('.inline-feedback')).to_be_visible()
    main.locator('.presenter-more > summary').click()
    control(main, 'finish').click()
    expect(phone.locator('.lecture-ended')).to_be_visible()
    phone.locator('.native-takeaways summary').click()
    download = phone.locator('.lecture-ended > [data-inline-action="downloadReview"]')
    expect(download).to_be_visible()
    right_g = geometry(phone, ['.lecture-ended h1', '.lecture-ended > [data-inline-action="downloadReview"]',
                               '.native-takeaways summary', '.native-takeaways article:last-child'])
    right = Image.open(BytesIO(phone.screenshot(full_page=False, animations='disabled'))).convert('RGB')
    with phone.expect_download() as saved:
        download.click()
    review_path = directory / 'review.html'
    saved.value.save_as(str(review_path))

    printed = context.new_page()
    printed.set_viewport_size({'width': 650, 'height': PHONE['height']})
    printed.goto(review_path.as_uri())
    expect(printed.get_by_role('heading', level=1)).to_be_visible()
    expect(printed.locator('body')).to_contain_text('swap_bug')
    report_g = geometry(printed, ['h1'])
    review = Image.open(BytesIO(printed.screenshot(full_page=False, animations='disabled'))).convert('RGB')
    assert left.size == right.size == (780, 1688) and review.size == (1300, 1688)

    board = Image.new('RGB', PIXELS, '#eff4f8')
    drawing = ImageDraw.Draw(board)
    def font(size):
        for path in ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf']:
            if Path(path).is_file():
                return ImageFont.truetype(path, size)
        return ImageFont.load_default(size=size)
    drawing.text((208, 75), '学生手机跟随与个人复习单', font=font(64), fill='#17354f')
    items = [(208, left, '独立作答'), (1250, right, '结课速查与保存入口'), (2300, review, '离线个人复习单')]
    rectangles = []
    for x, panel, title in items:
        y = 300
        box = (x, y, x + panel.width, y + panel.height)
        assert 0 <= x < box[2] <= PIXELS[0] and 0 <= y < box[3] <= PIXELS[1]
        drawing.text((x, 205), title, font=font(42), fill='#087980')
        drawing.rectangle((x - 2, y - 2, box[2] + 1, box[3] + 1), outline='#b4c5d3', width=2)
        board.paste(panel, (x, y))
        rectangles.append({'title': title, 'pixels': panel.size, 'box': box})
    board.save(directory / NAMES[5])
    report['geometry'].append({
        'name': NAMES[5], 'viewport': [1920, 1080], 'dpr': DPR, 'clipped': [],
        'panels': rectangles, 'mobileGeometries': [left_g, right_g], 'reportGeometry': report_g,
    })
    report['checks'].append({'personalReviewHtml': True, 'mobileViewports': [left_g['viewport'], right_g['viewport']]})
    phone.close()
    printed.close()


def verify_archetypes(teacher, report):
    ensure_drawer(teacher)
    teacher.locator('[data-demo-preview="1"]').click()
    preview = teacher.locator('.prep-slide-stage .lecture-frame')
    expect(preview).to_have_attribute('data-archetype', 'cover')
    teacher.locator('.prep-page-list [data-page="1"]').click()
    chooser = teacher.locator('[data-page-archetype]')
    expect(chooser).to_be_visible()
    expect(chooser.locator('option')).to_have_count(1 + len(ARCHETYPES))
    for archetype in ARCHETYPES:
        chooser.select_option(archetype)
        expect(preview).to_have_attribute('data-archetype', archetype)
        expect(preview.locator('h2')).to_be_visible()
        expect(preview.locator('.lecture-frame-transcript')).to_have_count(0)
    report['checks'].append({'slideArchetypes': ARCHETYPES, 'emptySourceTranscripts': 0})


def capture(context, directory, report, bundle_directory):
    platform_file = directory / 'platform.html'
    demo_file = directory / 'demo.html'
    copyfile(bundle_directory / OFFLINE[0], platform_file)
    copyfile(bundle_directory / OFFLINE[1], demo_file)

    platform = context.new_page()
    platform.goto(platform_file.as_uri())
    materials(platform)
    expect(platform.locator('[data-demo-toggle]')).to_have_count(0)
    shot(platform, 1, directory, report, required=('.prep-entry', '.harness-pipeline', '[data-agent-tools]'))
    report['checks'].append({'bundle': OFFLINE[0], 'dualSource': True, 'demoDrawer': False, 'agentToolPanel': True})

    teacher = context.new_page()
    teacher.goto(demo_file.as_uri())
    materials(teacher)
    expect(teacher.locator('[data-demo-toggle]')).to_have_attribute('aria-expanded', 'false')
    expect(teacher.locator('[data-demo-panel]')).to_be_hidden()
    report['checks'].append({'bundle': OFFLINE[1], 'dualSource': True, 'demoDrawer': 'collapsed'})
    projection = context.new_page()

    main = launch_deck(teacher, 0, 12)
    choose_page(main, 5)
    show_stage(teacher, projection, 5)
    expect(projection.locator('.slide-code-pair')).to_be_visible()
    expect(projection.locator('.slide-diagram svg')).to_be_visible()
    shot(projection, 2, directory, report, required=('.slide-code-pair', '.slide-diagram svg'), stage=True)

    choose_page(main, 6, interact=True)
    finish_two_rounds(main)
    show_stage(teacher, projection, 6, interactive=True)
    expect(projection.locator('.inline-paired')).to_be_visible()
    expect(projection.locator('.inline-feedback')).to_be_visible()
    shot(projection, 3, directory, report, required=('.inline-paired', '.inline-feedback'), stage=True)
    report['checks'].append({'course': 'C', 'slides': 12, 'fiveBeatResults': True})

    main = launch_deck(teacher, 1, 10)
    choose_page(main, 4, interact=True)
    control(main, 'demoFill').click()
    expect(main.locator('.inline-live-count b')).not_to_have_text('0')
    control(main, 'reveal').click()
    show_stage(teacher, projection, 4, interactive=True)
    plot = projection.locator('[data-curve-plot]').first
    expect(plot).to_be_visible()
    expect(projection.locator('[data-native-slide] .katex-display .katex-html').first).to_be_visible()
    expect(projection.locator('[data-native-slide] math[display=block]').first).to_be_attached()
    assert projection.evaluate('''async () => {
        const fonts = [...document.fonts].filter(face => face.family.replace(/["']/g, '').startsWith('KaTeX_'));
        await Promise.all(fonts.map(face => face.load()));
        return fonts.length === 20 && fonts.every(face => face.status === 'loaded');
    }''')
    projection.get_by_role('button', name='📌 锁定对照曲线', exact=True).click()
    ghost = projection.locator('path[data-ghost-curve]').first
    curve = projection.locator('[data-curve="0"]').first
    expect(ghost).to_be_visible()
    frozen = ghost.get_attribute('d')
    projection.locator('[data-module-slider="0"]').fill('0.55')
    projection.locator('[data-module-slider="1"]').fill('6')
    expect(curve).not_to_have_attribute('d', frozen)
    expect(ghost).to_have_attribute('d', frozen)
    expect(ghost).to_have_attribute('stroke-dasharray', '7 5')
    shot(projection, 4, directory, report,
         required=('[data-curve-plot]', 'path[data-ghost-curve]', '[data-native-slide] .katex-display'), stage=True)
    report['checks'].append({'course': 'optics', 'slides': 10, 'offlineKaTeXFonts': 20, 'lockedComparison': True})

    main = launch_deck(teacher, 2, 10)
    choose_page(main, 7, interact=True)
    control(main, 'demoFill').click()
    expect(main.locator('.inline-live-count b')).not_to_have_text('0')
    control(main, 'reveal').click()
    expect(main.locator('.inline-reason-split article').first).to_be_visible()
    main.locator('[data-module-peer]').click()
    show_stage(teacher, projection, 7, interactive=True)
    expect(projection.locator('.module-peer')).to_be_visible()
    shot(projection, 5, directory, report,
         required=('.module-peer', '.slide-list'), stage=True)
    report['checks'].append({'course': 'English', 'slides': 10, 'evidencePeer': True})

    mobile_capture(teacher, context, directory, report)
    verify_archetypes(teacher, report)

    platform.locator('.shell-nav [data-nav=lab]').click()
    expect(platform.get_by_role('heading', name='交互模组库', exact=True)).to_be_visible()
    for i in range(4):
        platform.locator(f'[data-module-tab="{i}"]').click()
        expect(platform.locator('.v3-inspector pre')).to_contain_text('@1')
    platform.locator('[data-module-tab="0"]').click()
    platform.get_by_role('button', name='Harness 架构与契约同屏', exact=True).click()
    panel = platform.locator('.v4-architecture-panel img')
    expect(panel).to_be_visible()
    assert panel.evaluate('image => image.naturalWidth === 1600 && image.src.startsWith("data:")')
    shot(platform, 7, directory, report, required=('.v4-architecture-panel img', '.v3-inspector'))
    report['checks'].append({'galleryModules': 4, 'embeddedArchitecture': True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staging-only', action='store_true', help='Keep the verified captures in the QA folder.')
    parser.add_argument('--bundle-dir', type=Path, default=ROOT, help='Directory containing the two offline HTML files.')
    options = parser.parse_args()
    output = STUDIO / 'artifacts/sprint4b-qa/exhibition'
    output.mkdir(parents=True, exist_ok=True)
    report = {'consoleErrors': [], 'pageErrors': [], 'offlineRequests': [], 'checks': [], 'geometry': [], 'screenshots': []}
    try:
        with TemporaryDirectory(prefix='exhibition-', dir=output) as folder, sync_playwright() as playwright:
            temp = Path(folder)
            browser, channel = launch_browser(playwright)
            report['browser'] = f'{channel} {browser.version}'
            print(f'Browser: {report["browser"]}', flush=True)
            try:
                context = browser.new_context(viewport=VIEWPORT, device_scale_factor=DPR, reduced_motion='reduce',
                                              offline=True, accept_downloads=True)
                watch(context, report)
                capture(context, temp, report, options.bundle_dir)
                context.close()
            finally:
                browser.close()
            assert all(not report[key] for key in ['consoleErrors', 'pageErrors', 'offlineRequests']), report
            assert [g['name'] for g in report['geometry']] == NAMES and all(not g['clipped'] for g in report['geometry'])
            for name in NAMES:
                with Image.open(temp / name) as image:
                    assert image.size == PIXELS, (name, image.size)
                    image.verify()
                report['screenshots'].append({'name': name, 'pixels': list(PIXELS), 'dpr': DPR})
            for item in report['screenshots']:
                name = item['name']
                copy2(temp / name, output / name)
                if not options.staging_only:
                    for target in {ROOT, SOURCE}:
                        copy2(output / name, target / name)
                print(f'{name} | {PIXELS[0]}×{PIXELS[1]} | 1920×1080 @2x | clipped=[]', flush=True)
    finally:
        receipt = output / 'browser-report.json'
        receipt.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'PASS: 7/7 captures, 0 external requests, 0 console errors, 0 page errors. Receipt: {receipt}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
