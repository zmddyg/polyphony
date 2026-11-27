import base64
import json
import os
import re
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, unquote, urlencode, urlsplit, urlunsplit

from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright


STUDIO = Path(__file__).resolve().parents[1]
SOURCE = STUDIO.parent
ROOT = SOURCE.parents[1] if SOURCE.name == 'source' and SOURCE.parent.name == '.polyphony-work' else SOURCE
PPTX = STUDIO / 'tests/fixtures/material-import-hidden.pptx'
QA = STUDIO / 'artifacts/sprint4b-qa'
PROJECTION = {'width': 1920, 'height': 1080}
PHONE = {'width': 375, 'height': 844}
LAPTOP = {'width': 1280, 'height': 660}
REVIEW_DOWNLOAD = '[data-inline-action="downloadReview"]'
DEMO_DECKS = ('deck-c-pointers', 'deck-optics', 'deck-english-seminar')


def launch_browser(playwright):
    chromium = playwright.chromium
    choices = ([{}] if Path(chromium.executable_path).is_file() else []) + [
        {'channel': 'chrome'}, {'channel': 'msedge'},
    ]
    errors = []
    for choice in choices:
        try:
            browser = chromium.launch(headless=True, **choice, args=['--disable-background-timer-throttling',
                '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'])
            return browser, choice.get('channel', 'chromium')
        except PlaywrightError as error:
            errors.append(str(error))
    raise RuntimeError('No installed Chromium, Chrome, or Edge could run: ' + '\n'.join(errors))


def button(page, name):
    return page.get_by_role('button', name=name, exact=True)


def room_view(url, role):
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    query['view'] = [role]
    return urlunsplit(parts._replace(query=urlencode(query, doseq=True)))


def answer(student, index, text):
    options = student.locator('[data-inline-response] input[name="optionId"]')
    expect(student.locator('[data-inline-response]')).to_be_visible()
    if options.count():
        options.nth(index).check()
    else:
        student.locator('[data-step-select]').nth(index).click()
    reason = student.locator('[data-reason]').first
    if reason.count():
        expect(student.locator('textarea[name="reason"]')).to_be_hidden()
        reason.click()
    field = student.locator('textarea[name="reason"]')
    if not field.is_visible():
        student.locator('[data-extra-reason] summary').click()
    field.fill(text)
    button(student, '提交').click()
    expect(student.get_by_text('已提交，公布前可修改。')).to_be_visible()


def download_review(page, trigger, destination):
    with page.expect_download() as pending:
        trigger.click()
    download = pending.value
    assert download.suggested_filename.endswith('.html'), download.suggested_filename
    download.save_as(str(destination))
    report = page.context.new_page()
    report.goto(destination.as_uri())
    expect(report.get_by_role('heading', level=1)).to_be_visible()
    assert report.locator('script, link[rel="stylesheet"]').count() == 0
    return report


def open_demo_drawer(page):
    toggle = page.locator('[data-demo-toggle]')
    if toggle.get_attribute('aria-expanded') == 'false':
        toggle.click()
    expect(page.locator('[data-demo-panel]')).to_be_visible()


def watch_offline(context, errors, network):
    def watch(page):
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('websocket', lambda socket: network.append(socket.url))
    context.on('page', watch)
    def watch_request(request):
        scheme = urlsplit(request.url).scheme
        if scheme in {'http', 'https', 'ws', 'wss'} or (scheme == 'file' and request.resource_type != 'document'):
            network.append(request.url)
    context.on('request', watch_request)


def assert_katex_bundle(target):
    html = target.read_text(encoding='utf-8')
    imports = json.loads(re.search(r'<script type="importmap">([^<]+)</script>', html)[1])['imports']
    module = imports['@polyphony/vendor/katex/katex.mjs'].split(',', 1)[1]
    assert b'0.19.1' in base64.b64decode(unquote(module), validate=True)
    fonts = re.findall(r'url\(["\']?data:font/woff2;base64,([^)"\']+)["\']?\)', html)
    assert len(fonts) == html.count('@font-face') == 20, len(fonts)
    assert all(base64.b64decode(unquote(font), validate=True).startswith(b'wOF2') for font in fonts)
    assert not re.search(r'url\(["\']?fonts/KaTeX_|format\(["\'](?:woff|truetype)["\']\)', html)
    return len(fonts)


def assert_katex_fonts_loaded(page):
    assert page.evaluate('''async () => {
      await document.fonts.ready;
      const faces = [...document.fonts].filter(face => face.family.replace(/["']/g,'').startsWith('KaTeX_'));
      return faces.length === 20 && (await Promise.all(faces.map(face => face.load())))
        .every(face => face.status === 'loaded');
    }'''), 'Expected all 20 embedded KaTeX fonts to load'


def verify_laptop(browser, target, errors, network):
    context = browser.new_context(viewport=LAPTOP, device_scale_factor=1.5, offline=True)
    watch_offline(context, errors, network)
    page = context.new_page()
    page.goto(target.as_uri())
    open_demo_drawer(page)
    page.locator('[data-demo-teach="1"]').click()
    button(page.locator('.native-split-stage'), '🖥+📱 同屏演示').click()
    picker = page.locator('[data-lecture-page]')
    picker.select_option('3')
    slide = page.locator('.native-canvas [data-native-slide]')
    expect(slide.locator('h2')).to_have_text('夫琅禾费单缝衍射与多缝光栅方程')
    expect(slide.locator('.katex').first).to_be_attached()
    expect(slide.locator('math[display="block"]').first).to_be_attached()
    expect(slide.locator('.katex-html').first).to_be_visible()
    expect(slide.get_by_text('查看原页文字', exact=True)).to_have_count(0)
    assert_katex_fonts_loaded(page)
    body = slide.locator('.slide-callout p').first
    metrics = body.evaluate('''node => {
      const font = parseFloat(getComputedStyle(node).fontSize);
      const zoom = node.currentCSSZoom ?? Number(getComputedStyle(node.closest('.lecture-frame')).zoom);
      const canvas = node.closest('.native-canvas').getBoundingClientRect();
      return {font, zoom, effective: font * zoom, width: canvas.width, height: canvas.height,
        dockBottom: document.querySelector('.presenter-dock').getBoundingClientRect().bottom,
        dpr: devicePixelRatio, horizontal: document.documentElement.scrollWidth <= innerWidth};
    }''')
    assert metrics['font'] >= 13 and metrics['effective'] >= 12.5, metrics
    assert metrics['zoom'] >= .85 and metrics['dpr'] == 1.5 and metrics['horizontal'], metrics
    assert abs(metrics['width'] / metrics['height'] - 16 / 9) < .02, metrics
    assert metrics['dockBottom'] <= LAPTOP['height'] + 2, metrics
    page.screenshot(path=str(QA / 'laptop-1280x660-optics.png'), scale='css')
    picker.select_option('4')
    expect(slide.locator('h2')).to_contain_text('页内公式沙盒')
    context.close()
    print(f"PASS: 1280×660 at 150% DPI, {metrics['width']:.0f}×{metrics['height']:.0f} canvas, "
          f"{metrics['font']:.2f}px computed body and {metrics['effective']:.2f}px after fit", flush=True)


def verify_slide_editor(browser, target, errors, network):
    context = browser.new_context(viewport={'width': 1440, 'height': 1080}, offline=True)
    watch_offline(context, errors, network)
    page = context.new_page()
    page.add_init_script('''(() => {
      window.revisionCalls = [];
      const fetchOriginal = globalThis.fetch;
      globalThis.fetch = (target, init) => {
        if (String(target) !== 'https://slide-revision.fixture.invalid/v1/chat/completions') {
          return fetchOriginal(target, init);
        }
        window.revisionCalls.push(JSON.parse(init.body));
        const content = JSON.stringify({
          title: '衍射强度的推导',
          blocks: [
            {type:'bullets', title:'条件', items:['观察距离足够远，采用夫琅禾费近似。']},
            {type:'formula', title:'归一化强度', items:['I/I_0=\\\\sinc^2(u)']},
          ],
        });
        return Promise.resolve(Response.json({choices:[{message:{content}}]}));
      };
    })()''')
    page.goto(target.as_uri())
    expect(button(page, '导入课件')).to_be_visible()
    markdown = r'''- 比较中央亮纹与旁瓣强度。

$$I=I_0\left(\frac{\sin u}{u}\right)^2$$

---

- 观察主极大的宽度。'''
    page.locator('[data-file]').set_input_files({
        'name': '衍射讲义.md', 'mimeType': 'text/markdown', 'buffer': markdown.encode('utf-8'),
    })
    preview = page.locator('.prep-slide-stage')
    editor = page.locator('[data-slide-editor]')
    expect(preview.locator('.katex-html').first).to_be_visible()
    assert_katex_fonts_loaded(page)
    expect(editor).to_be_attached()
    title = page.locator('[data-page-title]')
    if not title.is_visible():
        editor.locator('summary').click()
    title.fill('单缝衍射的推导')
    page.locator('[data-page-archetype]').select_option('derivation')
    page.locator('[data-block-type]').select_option('formula')
    page.locator('[data-add-block]').click()
    page.locator('[data-blocks] [data-block-item]').last.fill(r'\boxed{u=\pi a\sin\theta/\lambda}')
    expect(preview.locator('h2')).to_have_text('单缝衍射的推导')
    expect(preview.locator('math[display=block] annotation').last).to_contain_text(r'\boxed{u=')
    assert preview.evaluate('node => Math.abs(node.clientWidth / node.clientHeight - 16/9) < .02')
    page.locator('[data-save-slide]').click()
    expect(page.locator('[data-slide-status]')).to_contain_text('已保存')
    page.locator('.prep-slide').screenshot(path=str(QA / 'editor-blocks-preview.png'), scale='css',
                                          style='.shell-header { visibility: hidden !important; }')
    page.reload()
    button(page, '继续上次备课').click()
    expect(preview.locator('h2')).to_have_text('单缝衍射的推导')
    expect(preview.locator('math[display=block] annotation').last).to_contain_text(r'\boxed{u=')
    expect(page.locator('[data-page-archetype]')).to_have_value('derivation')
    page.locator('[data-page="1"]').click()
    expect(preview).to_contain_text('观察主极大的宽度')
    page.locator('[data-page="0"]').click()
    page.evaluate('''async () => {
      const {saveSessionProvider}=await import('@polyphony/core/provider-hub.mjs');
      saveSessionProvider({baseUrl:'https://slide-revision.fixture.invalid/v1',model:'editor-test',key:'qa-fixture-key'});
    }''')
    instruction = page.locator('[data-revise-instruction]')
    if not instruction.is_visible():
        editor.locator('summary').click()
    instruction.fill('改用 sinc 并明确近似条件。')
    page.locator('[data-revise-slide]').click()
    expect(preview.locator('h2')).to_have_text('衍射强度的推导')
    expect(preview.locator('math[display=block] annotation').last).to_contain_text(r'\sinc^2(u)')
    assert page.evaluate('revisionCalls.length') == 1
    context.close()
    print('PASS: 16:9 prepare preview, live edits, stored blocks after reopening, and in-browser one-line rewrite with a model fixture', flush=True)


def assert_projection_fits(page):
    overflow = page.locator('.native-canvas').evaluate('''canvas => {
      const fits = (outer, inner, canScrollVertically = false) => {
        const a = outer.getBoundingClientRect(), b = inner.getBoundingClientRect();
        return b.left >= a.left - 2 && b.right <= a.right + 2 &&
          (canScrollVertically || (b.top >= a.top - 2 && b.bottom <= a.bottom + 2));
      };
      const results = [];
      const canvasBounds = canvas.getBoundingClientRect();
      if (canvas.dataset.surfaceRole === 'stage' && (canvasBounds.top < 0 || canvasBounds.bottom > innerHeight + 2)) results.push('stage canvas');
      for (const [ownerSelector, targetSelector] of [
        ['[data-native-slide]', '.lecture-frame'], ['.native-inline', '.inline-content'],
        ['.lecture-frame', '.slide-diagram svg'], ['.lecture-frame', '.katex-display'],
      ]) {
        const owner = canvas.querySelector(ownerSelector);
        for (const target of owner?.querySelectorAll(targetSelector) ?? []) {
          const scroller = target.closest('[data-native-slide], .native-inline');
          const canScroll = !!scroller && ['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY) &&
            scroller.scrollHeight > scroller.clientHeight + 2 && fits(canvas, scroller);
          if (target.getBoundingClientRect().height && (!fits(owner, target, canScroll) || !fits(canvas, target, canScroll))) results.push(targetSelector);
        }
      }
      return results;
    }''')
    assert overflow == [], overflow
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


@contextmanager
def classroom_server(directory):
    log_path = QA / 'online-browser-server.log'
    env = {name: value for name, value in os.environ.items() if not name.startswith('POLYPHONY_')}
    env.update(HOST='127.0.0.1', PORT='0', POLYPHONY_ROOM_FILE=str(directory / 'browser-rooms.json'),
               POLYPHONY_STORAGE='json')
    with log_path.open('w', encoding='utf-8') as output, subprocess.Popen(
        ['node', 'server.mjs'], cwd=STUDIO, env=env, stdout=output, stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    ) as server:
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and server.poll() is None:
                match = re.search(r'^Polyphony\s+(http://127\.0\.0\.1:\d+)', log_path.read_text(encoding='utf-8'), re.MULTILINE)
                if match:
                    yield match[1]
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('The test classroom failed to start. See ' + str(log_path))
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


QA.mkdir(parents=True, exist_ok=True)
sys.stdout.reconfigure(encoding='utf-8')
for path in (STUDIO / 'dist').rglob('*'):
    if path.suffix in {'.mjs', '.js', '.css', '.html', '.svg', '.json'} and path.is_file():
        content = path.read_text(encoding='utf-8-sig')
        assert not any(deck in content for deck in DEMO_DECKS), path
print('PASS: 0 competition deck IDs in dist/', flush=True)
bundle_names = ('共演智课-离线平台.html', '共演智课-单文件离线演示版.html')
for name in bundle_names:
    output = ROOT / name
    bundled_fonts = assert_katex_bundle(output)
    assert (SOURCE / name).read_bytes() == output.read_bytes()
    print(f'PASS: {name}, {output.stat().st_size:,} bytes, KaTeX 0.19.1 module and {bundled_fonts} inline WOFF2 fonts', flush=True)
with TemporaryDirectory(prefix='offline-', dir=QA) as folder, sync_playwright() as p:
    target_dir = Path(folder)
    platform = target_dir / 'platform.html'
    copyfile(ROOT / '共演智课-离线平台.html', platform)
    assert len(list(target_dir.iterdir())) == 1
    browser, channel = launch_browser(p)
    print(f'Browser: {channel} {browser.version}', flush=True)
    context = browser.new_context(viewport=PROJECTION, offline=True, permissions=['clipboard-read', 'clipboard-write'])
    errors, network = [], []
    watch_offline(context, errors, network)
    teacher = context.new_page()
    teacher.goto(platform.as_uri())
    expect(button(teacher, '导入课件')).to_be_visible()
    expect(button(teacher, 'AI 备课')).to_be_visible()
    expect(button(teacher, '课堂记录')).to_be_visible()
    expect(button(teacher, '课堂码')).to_be_visible()
    expect(teacher.locator('[data-api-status]')).to_contain_text('未配密钥')
    teacher.locator('[data-api-hub]').click()
    for name in ['fastModel', 'fastBaseUrl', 'fastKey', 'fastOutputMode']:
        expect(teacher.locator(f'.v3-provider-form [name="{name}"]')).to_be_visible()
    expect(teacher.locator('[name=fastKey]')).to_have_attribute('type', 'password')
    expect(button(teacher, '测试快速模型连通性')).to_be_visible()
    provider_form = teacher.locator('.v3-provider-form')
    provider_form.locator('[name=preset]').select_option('deepseek')
    expect(provider_form.locator('[name=baseUrl]')).to_have_value('https://api.deepseek.com/v1')
    expect(provider_form.locator('[name=model]')).to_have_value('deepseek-v4-pro')
    provider_form.locator('[name=model]').fill('deepseek-custom')
    expect(provider_form.locator('[name=model]')).to_have_value('deepseek-custom')
    teacher.get_by_role('button', name='关闭对话框').click()
    assert teacher.locator('.shell-nav-group [data-nav]').evaluate_all('(links) => links.map(a => a.dataset.nav)') == ['materials','desk','lab','replay']
    expect(teacher.locator('[data-nav=system]')).to_be_visible()
    expect(teacher.locator('[data-demo-toggle], [data-demo-panel]')).to_have_count(0)
    expect(teacher.locator('.harness-pipeline > li')).to_have_count(5)
    expect(teacher.get_by_role('heading', name='我的备课版本库')).to_be_visible()
    teacher.locator('[data-nav=lab]').click()
    expect(teacher.get_by_role('heading', name='交互模组库', exact=True)).to_be_visible()
    expect(button(teacher, '独立单题快闪设计')).to_be_visible()
    teacher.locator('.shell-nav [data-nav=materials]').click()

    teacher.locator('[data-file]').set_input_files(PPTX)
    for mode in ['preserve', 'enhance', 'rebuild']:
        expect(teacher.locator(f'[data-adaptation-mode="{mode}"]')).to_be_visible()
    button(teacher, '开始上课').click()
    expect(teacher.locator('.native-canvas .lecture-frame-head')).to_be_visible()
    expect(button(teacher, '开启本页互动')).to_have_count(0)
    teacher.get_by_role('link', name='课件活化', exact=True).click()
    teacher.locator('.prep-menu > summary').click()
    button(teacher, '返回备课首页').click()

    button(teacher, 'AI 备课').click()
    assert teacher.locator('[data-author-form] [name=pageCount] option').evaluate_all(
        '(options) => options.map(option => option.value)') == list(map(str, range(6, 49)))
    expect(teacher.locator('[data-author-form] [name=pageCount]')).to_have_value('10')
    expect(teacher.locator('[data-author-form] [name=density]')).to_have_value('balanced')
    expect(teacher.locator('[data-author-form] [name=enableWebImages]')).to_be_checked()
    teacher.locator('[data-author-form] [name=density]').select_option('sparse')
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

    print('PASS: shell, library, imports and native draft', flush=True)
    interactive_pages = teacher.locator('.prep-page-list [data-page]').filter(has=teacher.locator('[aria-label="有互动"]'))
    expect(interactive_pages).to_have_count(2)
    first_index = int(interactive_pages.first.get_attribute('data-page'))
    first_page = first_index + 1
    interactive_pages.first.click()
    teacher.locator('[data-page-layout]').select_option('split-left')
    expect(teacher.locator('[data-page-preview] [data-lecture-layout]')).to_have_attribute('data-lecture-layout', 'split-left')
    expect(teacher.locator('[data-media-search]')).to_be_visible()
    teacher.locator('[data-speaker-notes]').fill('教师精修备注：核对条件与反例。')
    teacher.locator('[data-swap]').select_option('step-fault@1')
    teacher.locator('[data-speaker-notes]').fill('教师精修备注：核对条件与反例。')
    teacher.locator('[data-edit="moduleConfig.steps.1.content"]').fill('新增精修步骤：比较本页前提。')
    teacher.locator('[data-fault]').nth(1).check()
    button(teacher, '验证并保存本页').click()
    expect(teacher.locator('[data-speaker-notes]')).to_have_value('教师精修备注：核对条件与反例。')
    expect(teacher.locator('[data-ai-instruction]')).to_be_visible()
    print('PASS: visual editor', flush=True)
    version_id = teacher.evaluate("""async pageNumber => {
      const {createMaterialNotebook,makeMaterialVersionId}=await import('@polyphony/core/material-notebook.mjs');
      const n=createMaterialNotebook();const v=(await n.listVersions())[0];
      const doc=await n.getVersion(v.versionId);
      if(doc.draft.speakerNotes[pageNumber]!=='教师精修备注：核对条件与反例。')throw Error('speakerNotes not persisted');
      await n.savePageNote(v.versionId,pageNumber,{id:'prior-mistake',kind:'annotation',packet:{reason:'把充分条件错当成必要条件'}});
      const temporary=await makeMaterialVersionId({bytes:'temporary browser deletion fixture'});
      await n.saveVersion({versionId:temporary,name:'待删除',pages:[{number:1,title:'临时页',text:'临时内容'}]});
      await n.savePageNote(temporary,1,{id:'annotation',kind:'annotation',packet:{reason:'临时记忆'}});
      await n.deleteVersion(temporary);
      if(await n.getVersion(temporary)!==null||(await n.listNotes(temporary)).length)throw Error('deleteVersion incomplete');
      sessionStorage.setItem('polyphony.material.return',JSON.stringify({versionId:v.versionId,pageNumber}));return v.versionId;
    }""", first_page)
    teacher.reload()
    expect(teacher.locator('[data-speaker-notes]')).to_have_value('教师精修备注：核对条件与反例。')
    expect(teacher.locator('[data-page-layout]')).to_have_value('split-left')
    expect(teacher.locator('.page-memory')).to_contain_text('充分条件')
    expect(teacher.locator('.prep-page-list [aria-current=page]')).to_contain_text('往届记忆')
    assert teacher.evaluate("sessionStorage.getItem('polyphony.material.return')") is None
    button(teacher, '开始上课').click()
    expect(teacher.locator('[data-lecture-page]')).to_be_visible()
    print('PASS: real IndexedDB persistence, deletion and memory return', flush=True)

    lecture_url = teacher.url
    projector = context.new_page()
    projector.goto(room_view(lecture_url, 'stage'))
    expect(projector.locator('.stage-filmstrip')).to_be_visible()
    teacher.locator('[data-lecture-page]').select_option('0')
    teacher.evaluate('document.activeElement.blur()')
    teacher.keyboard.press('s')
    main = teacher.locator('.native-split-stage')
    companion = teacher.locator('.native-split-companion')
    expect(main).to_be_visible()
    expect(companion).to_be_visible()
    assert companion.evaluate('node => !node.closest("[data-native-player]") && !!node.parentElement.querySelector(":scope > .native-split-stage")')
    expect(main.locator('.native-filmstrip')).to_be_visible()
    tab = lambda seat: companion.locator(f'[data-companion-view="{seat}"]')
    tab('a').click()
    bookmark = companion.locator('[data-inline-action=bookmark]')
    pulse = companion.locator('[data-inline-action=slidePulse]')
    bookmark.click()
    expect(bookmark).to_have_attribute('aria-pressed', 'true')
    pulse.click()
    expect(pulse).to_have_attribute('aria-pressed', 'true')
    expect(projector.locator('.stage-filmstrip')).to_contain_text('?1')
    tab('b').click()
    expect(bookmark).to_have_attribute('aria-pressed', 'false')
    expect(pulse).to_have_attribute('aria-pressed', 'false')
    tab('a').click()
    expect(pulse).to_have_attribute('aria-pressed', 'true')
    pulse.click()
    expect(projector.locator('.stage-filmstrip')).not_to_contain_text('?1')
    pulse.click()
    expect(projector.locator('.stage-filmstrip')).to_contain_text('?1')
    summary = main.locator('.native-speaker-notes summary')
    expect(summary).to_contain_text('1 人存疑')
    summary.click()
    private_button = '⚡ 快速诊断本页难点'
    button(main, private_button).click()
    expect(main.locator('[data-triage-hints] li')).to_have_count(2)
    private_hint = main.locator('[data-triage-hints] li').first.inner_text()
    expect(companion.get_by_text(private_hint, exact=True)).to_have_count(0)
    expect(projector.get_by_text(private_hint, exact=True)).to_have_count(0)
    expect(projector.locator('[data-private-triage]')).to_have_count(0)
    summary.click()
    tab('remote').click()
    button(companion, private_button).click()
    expect(companion.locator('[data-triage-hints] li')).to_have_count(2)
    tab('a').click()
    expect(companion.locator('[data-private-triage]')).to_have_count(0)
    print('PASS: same-page split and pre-join slide pulse', flush=True)

    notes = '教师精修备注：核对条件与反例。'
    main.locator('[data-lecture-page]').select_option(str(first_index))
    tab('remote').click()
    expect(companion.locator('[data-speaker-card]')).to_contain_text(notes)
    button(companion, '◀ 上一页').click()
    expect(main.locator('[data-lecture-page]')).to_have_value(str(first_index - 1))
    button(companion, '下一页 ▶').click()
    expect(main.locator('[data-lecture-page]')).to_have_value(str(first_index))
    expect(companion.locator('[data-speaker-card]')).to_contain_text(notes)
    expect(main.locator('.native-speaker-notes summary')).to_be_visible()
    main.locator('.native-speaker-notes summary').click()
    expect(main.get_by_text(notes, exact=True)).to_be_visible()
    expect(projector.get_by_text(notes, exact=True)).to_have_count(0)
    expect(projector.locator('.stage-filmstrip')).to_contain_text('?1')
    button(companion, '开启本页互动').click()
    expect(button(main, '公布结果')).to_be_visible()
    expect(button(main, '🧪 注入演练样本')).to_be_enabled()
    expect(button(main, '🔄 重置本页互动')).to_be_enabled()
    expect(companion.locator('[data-speaker-card]')).to_contain_text(notes)
    tab('a').click()
    expect(companion.get_by_text(notes, exact=True)).to_have_count(0)
    companion.get_by_label('课堂显示名').fill('验收甲同学')
    button(companion, '加入并作答').click()
    answer(companion, 0, '验收甲同学认为首轮前提支持这个结论。')
    tab('b').click()
    expect(companion.locator('[data-inline-join]')).to_be_visible()
    companion.get_by_label('课堂显示名').fill('验收乙同学')
    button(companion, '加入并作答').click()
    answer(companion, 1, '验收乙同学认为还需要独立反例验证。')
    expect(main.locator('.inline-live-count b')).to_have_text('2')
    assert teacher.evaluate('''() => {
      const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
      return ids.length === new Set(ids).size;
    }''')

    main.locator('[data-inline-action=timer60]').click()
    expect(main.locator('[data-countdown]')).to_be_visible()
    expect(companion.locator('[data-countdown]')).to_be_visible()
    expect(projector.locator('[data-countdown]')).to_be_visible()
    main.locator('[data-inline-action=timer90]').click()
    main.locator('[data-inline-action=timerClear]').click()
    expect(companion.locator('[data-countdown]')).to_be_hidden()
    tab('remote').click()
    expect(companion.locator('[data-remote-responses]')).to_have_text('2')
    button(companion, '🎲 随机抽签').click()
    expect(main.locator('[data-draw-result]')).to_be_visible()
    expect(projector.locator('[data-draw-result]')).to_have_count(0)
    tab('b').click()
    expect(companion.get_by_text('已提交，公布前可修改。')).to_be_visible()

    teacher.evaluate('document.activeElement.blur()')
    teacher.keyboard.press('Enter')
    expect(main.locator('[data-inline-branch]')).to_be_visible()
    expect(button(main, '开启第二轮')).to_be_visible()
    expect(projector.locator('.inline-reason-split article')).to_have_count(2)
    excerpts = projector.locator('.inline-excerpts')
    expect(excerpts).to_be_visible()
    expect(excerpts).not_to_contain_text('验收甲同学')
    expect(excerpts).not_to_contain_text('验收乙同学')
    excerpt_b = excerpts.locator('[data-inline-excerpt]').nth(1)
    excerpt_b.click()
    expect(excerpt_b).to_have_attribute('aria-pressed', 'true')
    expect(excerpts.get_by_text('独立反例', exact=False)).to_be_visible()
    assert_projection_fits(projector)

    main.locator('[data-inline-branch]').select_option(index=1)
    button(main, '开启第二轮').click()
    expect(button(main, '公布二轮结果')).to_be_visible()
    answer(companion, 1, '复核反例后，我保留判断。')
    tab('a').click()
    answer(companion, 1, '复核了条件，我调整结论。')
    expect(main.locator('.inline-live-count b')).to_have_text('2')
    button(main, '公布二轮结果').click()
    expect(projector.locator('.inline-round-shift').first).to_contain_text('首轮')
    expect(projector.locator('.inline-round-shift').first).to_contain_text('二轮')
    expect(projector.locator('.inline-round-shift').first).to_contain_text('pp')
    expect(projector.locator('.inline-paired')).to_contain_text('1 / 2')
    assert_projection_fits(projector)
    button(main, '完成本页 · 发速查卡').click()
    expect(companion.get_by_text('本课速查（1）')).to_be_visible()

    student = context.new_page()
    student.set_viewport_size(PHONE)
    student.goto(room_view(lecture_url, 'student'))
    expect(student.get_by_text('本课速查（1）')).to_be_visible()
    expect(student.get_by_text(notes, exact=True)).to_have_count(0)
    assert student.evaluate('document.documentElement.scrollWidth <= innerWidth')

    second_index = main.locator('[data-lecture-page] option').evaluate_all('''(options, first) => Number(
      options.find(item => item.value !== first && item.textContent.includes('互动'))?.value)''', str(first_index))
    assert isinstance(second_index, int) and second_index != first_index, second_index
    main.locator('[data-lecture-page]').select_option('0')
    student.locator('[data-inline-action=bookmark]').click()
    student.locator('[data-inline-action=slidePulse]').click()
    expect(projector.locator('.stage-filmstrip')).to_contain_text('?2')
    main.locator('[data-lecture-page]').select_option(str(second_index))
    button(main, '开启本页互动').click()
    expect(button(main, '公布结果')).to_be_visible()
    room_code = parse_qs(urlsplit(lecture_url).query)['room'][0]
    second_lesson = teacher.evaluate('''code => JSON.parse(localStorage.getItem('polyphony.v1.' + code)).lesson''', room_code)
    choices = [option['id'] for option in second_lesson['options']]
    correct = choices.index(second_lesson['correctOptionId'])
    wrong = [index for index in range(len(choices)) if index != correct]
    student.get_by_label('课堂显示名').fill('验收丙同学')
    button(student, '加入并作答').click()
    own_a_second = '我的跨页轨迹甲：我对第二个机制提出一个条件。'
    own_c_second = '我的跨页轨迹丙：先看看边界是否会改变。'
    answer(companion, wrong[0], own_a_second)
    answer(student, wrong[-1], own_c_second)
    button(main, '🧪 注入演练样本').click()
    expect(main.locator('.inline-live-count')).to_contain_text('模拟')
    button(main, '公布结果').click()
    expect(main.locator('.inline-excerpts')).to_be_visible()
    button(main, '开启第二轮').click()
    answer(companion, correct, '复核页内证据，甲修订第二个初判。')
    answer(student, correct, '复核页内证据，丙修订第二个初判。')
    button(main, '🧪 注入演练样本').click()
    expect(main.locator('.inline-live-count')).to_contain_text('模拟')
    button(main, '公布二轮结果').click()
    expect(main.locator('.inline-round-shift').first).to_be_visible()
    expect(main.locator('.inline-excerpts')).to_be_visible()
    button(main, '完成本页 · 发速查卡').click()
    expect(companion.get_by_text('本课速查（2）')).to_be_visible()

    companion.locator('.native-takeaways summary').click()
    a_report = download_review(teacher, companion.locator(f'.native-takeaways {REVIEW_DOWNLOAD}'), target_dir / 'seat-a.html')
    expect(a_report.locator('body')).to_contain_text('验收甲同学认为首轮前提支持这个结论。')
    expect(a_report.locator('body')).to_contain_text(own_a_second)
    expect(a_report.locator('body')).not_to_contain_text('验收乙同学认为还需要独立反例验证。')
    expect(a_report.locator('body')).not_to_contain_text(own_c_second)
    for keyword in ['首轮', '二轮', '待复习', '有疑问']:
        expect(a_report.locator('body')).to_contain_text(keyword)
    a_report.close()

    button(main, '🖥+📱 同屏演示').click()
    expect(companion).to_be_hidden()
    expect(companion.locator('[data-native-player]')).to_have_count(0)
    teacher.locator('.native-player-bar .presenter-more > summary').click()
    button(teacher, '结束上课').click()
    ended_review = download_review(student, student.locator(f'.lecture-ended > {REVIEW_DOWNLOAD}'), target_dir / 'ended-student.html')
    expect(ended_review.locator('body')).to_contain_text(own_c_second)
    expect(ended_review.locator('body')).to_contain_text('复核页内证据，丙修订第二个初判。')
    expect(ended_review.locator('body')).not_to_contain_text(own_a_second)
    expect(ended_review.locator('body')).not_to_contain_text('验收甲同学认为首轮前提支持这个结论。')
    ended_review.close()
    assert student.evaluate('''async code => {
      const {openSession}=await import('@polyphony/core/transport.mjs');
      const publicSession=await openSession({role:'student',room:code});
      try {return !Object.hasOwn(publicSession.state,'lectureArchive') && publicSession.state.lectureTakeaways.length===2;}
      finally {publicSession.close();}
    }''', room_code), 'Student transport exposed the archive or omitted completed takeaways'
    print('PASS: five beats, two isolated split seats, remote notes, anonymous excerpts, and personal HTML from the drawer and lesson end', flush=True)

    button(teacher, '查看复盘').click()
    expect(teacher.get_by_role('heading', name='课后复盘')).to_be_visible()
    expect(teacher.locator('.pr-detail-toggle')).to_have_count(0)
    kpis = teacher.locator('[data-pilot-kpis]')
    expect(kpis).to_be_visible()
    expect(teacher.locator('[data-pilot-source="live"]')).to_be_visible()
    for field, value in {
        'participantCount': '3', 'reasonFillRate': '100%', 'firstRoundAccuracy': '25%',
        'secondRoundAccuracy': '100%', 'accuracyGainPp': '+75',
        'pairedRevisionRate': '75%', 'interactivePageCount': '2',
    }.items():
        expect(kpis.locator(f'[data-pilot-value="{field}"]')).to_contain_text(value)
    expect(kpis.locator('[data-pilot-value="topMuddyPage"]')).to_contain_text('2')
    page_panel = teacher.locator('[data-replay-page-panel]')
    for number in [first_page, second_index+1]:
        entry = teacher.locator(f'[data-replay-page="{number}"]')
        entry.click()
        expect(entry).to_have_attribute('aria-pressed', 'true')
        expect(page_panel.locator('[data-replay-contrast]')).to_be_visible()
        expect(page_panel.locator('[data-replay-memory]')).to_be_visible()
        heading = page_panel.get_by_role('heading', level=2).first.inner_text()
        assert str(number) in heading, heading
    muddy_page = teacher.locator('[data-replay-page="1"]')
    expect(muddy_page).to_contain_text('存疑')
    muddy_page.click()
    expect(muddy_page).to_have_attribute('aria-pressed', 'true')
    expect(page_panel).to_contain_text('2')
    teacher.locator('[data-copy-pilot]').click()
    clipboard = teacher.evaluate('navigator.clipboard.readText()')
    for label in ['课堂试点战报（实测）', '作答理由填写率', '25%', '100%', '+75', '75%']:
        assert label in clipboard, clipboard
    teacher_report = download_review(teacher, teacher.locator('[data-export-teacher-report]'), target_dir / 'teacher-report.html')
    for label in ['25%', '100%', '+75', '75%', '首轮', '二轮', '存疑']:
        expect(teacher_report.locator('body')).to_contain_text(label)
    teacher_report.close()
    teacher.locator('[data-batch-memory]').click()
    expect(teacher.locator('[data-memory-status]')).to_contain_text('2')
    return_link = teacher.locator('[data-return-materials]')
    expect(return_link).to_be_visible()
    saved_pages = teacher.evaluate('''async ([version, code]) => {
      const {createMaterialNotebook}=await import('@polyphony/core/material-notebook.mjs');
      return (await createMaterialNotebook().listNotes(version))
        .filter(note => note.source?.room === code).map(note => note.pageNumber).sort((a,b)=>a-b);
    }''', [version_id, room_code])
    assert saved_pages == sorted([first_page, second_index+1]), saved_pages
    return_link.click()
    expect(teacher.locator('.page-memory')).to_be_visible()
    print(f'PASS: live KPI sample 3 participants, 25% → 100% (+75pp), 75% paired, two pages, muddy P1; Markdown, teacher HTML and {len(saved_pages)} memory writes', flush=True)

    teacher.locator('.shell-nav [data-nav=materials]').click()
    markdown = r'''# 一阶 RC 的响应
电容电压满足 $V_C(0^+)=V_C(0^-)$，随后逐渐逼近稳态。

$$\frac{dV_C}{dt}=\frac{V_\infty-V_C}{RC}$$

```diagram
A[输入阶跃] -->|驱动| B[电阻限流]
B -->|电荷积累| C[电容电压]
```

---
## 采样路径
```mermaid
flowchart TB
A[采集] -->|采样| B[记录]
```
'''
    teacher.locator('[data-file]').set_input_files({'name': 'RC讲义.md', 'mimeType': 'text/markdown', 'buffer': markdown.encode('utf-8')})
    expect(teacher.locator('.slide-diagram svg')).to_be_visible()
    expect(teacher.locator('[data-page-preview] [data-lecture-layout]')).to_have_attribute('data-lecture-layout', 'diagram-focus')
    expect(teacher.locator('math[display=block] mfrac')).not_to_have_count(0)
    button(teacher, '开始上课').click()
    expect(teacher.locator('.native-canvas .slide-diagram svg')).to_be_visible()
    button(teacher, '🖥+📱 同屏演示').click()
    arrows = teacher.locator('.slide-diagram marker')
    expect(arrows).to_have_count(2)
    assert arrows.nth(0).get_attribute('id') != arrows.nth(1).get_attribute('id')
    button(teacher.locator('.native-split-stage'), '🖥+📱 同屏演示').click()
    projector.goto(room_view(teacher.url, 'stage'))
    expect(projector.locator('.slide-diagram svg')).to_be_visible()
    expect(projector.locator('math[display=block] mfrac')).not_to_have_count(0)
    assert_projection_fits(projector)
    teacher.locator('[data-lecture-page]').select_option('1')
    expect(projector.locator('.slide-diagram svg')).to_contain_text('采样')
    expect(projector.locator('[data-lecture-layout]')).to_have_attribute('data-lecture-layout', 'split-right')
    assert_projection_fits(projector)
    print('PASS: Markdown editor preview, native MathML and both diagram fences at 1080p', flush=True)

    teacher.locator('.shell-nav [data-nav=materials]').click()
    button(teacher, 'AI 备课').click()
    teacher.get_by_label('课程和授课对象').fill('大学统计 · 一年级')
    teacher.get_by_label('本节课讲什么').fill('样本估计；抽样误差；置信区间')
    teacher.locator('[data-author-form] [name=pageCount]').select_option('48')
    teacher.locator('[data-author-form] [name=density]').select_option('balanced')
    button(teacher, '生成课件').click()
    expect(teacher.get_by_text('48 页 · 10 个互动')).to_be_visible()
    expect(teacher.locator('[data-long-horizon]')).to_contain_text('阶段 3/3')
    print('PASS: 48-page authoring, adaptive layouts, layout persistence and teacher-only diagnostics', flush=True)
    context.close()

    context = browser.new_context(viewport=PROJECTION, offline=True)
    watch_offline(context, errors, network)
    demo = context.new_page()
    demo_file = target_dir / 'demo.html'
    copyfile(ROOT / '共演智课-单文件离线演示版.html', demo_file)
    demo.goto(demo_file.as_uri())
    expect(button(demo, '导入课件')).to_be_visible()
    expect(button(demo, 'AI 备课')).to_be_visible()
    expect(demo.get_by_role('heading', name='我的备课版本库')).to_be_visible()
    expect(demo.locator('.harness-pipeline > li')).to_have_count(5)
    toggle = demo.locator('[data-demo-toggle]')
    expect(toggle).to_have_text(re.compile('示范课与导览'))
    expect(toggle).to_have_attribute('aria-expanded', 'false')
    expect(demo.locator('[data-demo-panel]')).to_be_hidden()
    demo.keyboard.press('d')
    expect(demo.locator('[data-demo-panel]')).to_be_visible()
    demo.keyboard.press('d')
    expect(demo.locator('[data-demo-panel]')).to_be_hidden()
    open_demo_drawer(demo)
    demo.locator('[data-demo-source]').click()
    expect(demo.locator('[data-page]')).to_have_count(8)
    expect(demo.locator('[data-demo-panel]')).to_be_hidden()
    expect(demo.locator('[data-adaptation-mode=preserve]')).to_be_visible()
    demo.locator('[data-run-harness]').click()
    expect(demo.locator('.harness-pipeline [data-state=complete]')).to_have_count(5)
    demo.locator('.prep-preview').get_by_text('生成详情', exact=True).click()
    demo.locator('[data-receipt]').click()
    expect(demo.locator('dialog[open]')).to_contain_text('M99')
    expect(demo.locator('dialog[open]')).to_contain_text('"simulated": true')
    demo.keyboard.press('Escape')
    expect(demo.locator('dialog[open]')).to_have_count(0)
    print('PASS: demo starts in the full materials workspace, D toggles the drawer, and raw 8-page activation completes five stages with a citation repair', flush=True)

    slides_checked = interactions_checked = 0
    for index, deck in enumerate(DEMO_DECKS):
        pages = json.loads((ROOT / '示例课件/V4原生实战课件' / f'{deck}.json').read_text(encoding='utf-8'))['pages']
        assert len(pages) == [12, 10, 10][index]
        open_demo_drawer(demo)
        demo.locator(f'[data-demo-preview="{index}"]').click()
        expect(demo.locator('.prep-preview [data-page]')).to_have_count(len(pages))
        expect(demo.locator('[data-demo-panel]')).to_be_hidden()
        open_demo_drawer(demo)
        demo.locator(f'[data-demo-teach="{index}"]').click()
        main = demo.locator('.native-split-stage')
        side = demo.locator('.native-split-companion [data-native-player]')
        picker = main.locator('[data-lecture-page]')
        expect(picker.locator('option')).to_have_count(len(pages))
        expect(side).to_be_visible()
        expect(demo.locator('[data-demo-panel]')).to_be_hidden()
        for slide_index, slide in enumerate(pages):
            picker.select_option(str(slide_index))
            expect(main.locator('.lecture-frame-head h2')).to_have_text(slide['title'])
            expect(side.locator('.lecture-frame-head h2')).to_have_text(slide['title'])
            slides_checked += 1
            if slide.get('interaction'):
                button(main, '开启本页互动').click()
                expect(side.locator('.native-inline')).to_be_visible()
                expect(side.locator('.native-inline .inline-heading b')).to_contain_text('R1')
                interactions_checked += 1
    assert (slides_checked, interactions_checked) == (32, 9)
    print(f'PASS: 3 demo previews, 3 one-click split launches, {slides_checked} teacher/student page pairs and {interactions_checked} page-embedded interactions', flush=True)

    open_demo_drawer(demo)
    demo.locator('[data-demo-highlight="0"]').click()
    main = demo.locator('.native-split-stage')
    expect(main.locator('[data-lecture-page]')).to_have_value('6')
    expect(main.locator('.native-inline')).to_be_visible()
    expect(main.locator('[data-inline-step-artifact]')).to_contain_text('swap_bug')
    button(main, '🧪 注入演练样本').click()
    expect(main.locator('.inline-live-count')).to_contain_text('含12份模拟')
    button(main, '🔄 重置本页互动').click()
    expect(main.locator('.inline-live-count b')).to_have_text('0')
    demo.get_by_role('link', name='交互模组库', exact=True).click()
    button(demo, 'Harness 架构与契约同屏').click()
    expect(demo.locator('.v4-architecture-panel')).to_be_visible()

    open_demo_drawer(demo)
    demo.locator('[data-demo-highlight="1"]').click()
    expect(demo.locator('.native-split-stage [data-lecture-page]')).to_have_value('4')
    curves = demo.locator('.module-curve clipPath')
    expect(curves).to_have_count(2)
    assert curves.nth(0).get_attribute('id') != curves.nth(1).get_attribute('id')
    button(demo.locator('.native-split-stage'), '🖥+📱 同屏演示').click()
    plot = demo.locator('[data-curve-plot]').first
    expect(plot).to_be_visible()
    button(demo, '📌 锁定对照曲线').click()
    ghost = demo.locator('path[data-ghost-curve]').first
    expect(ghost).to_be_visible()
    frozen = ghost.get_attribute('d')
    slider = demo.locator('[data-module-slider]').first
    default_value = slider.input_value()
    slider.press('End')
    expect(slider).not_to_have_value(default_value)
    expect(ghost).to_have_attribute('d', frozen)
    plot.hover()
    expect(demo.locator('[data-curve-readout]').first).to_contain_text(re.compile(r'\(-?\d[^,]*, -?\d'))
    button(demo, '复位默认参数').click()
    expect(slider).to_have_value(default_value)
    button(demo, '清除对照').click()
    expect(demo.locator('path[data-ghost-curve]')).to_have_count(0)
    assert_projection_fits(demo)

    open_demo_drawer(demo)
    demo.locator('[data-demo-highlight="2"]').click()
    expect(demo.locator('.native-split-stage [data-lecture-page]')).to_have_value('7')
    expect(demo.locator('.native-split-stage .module-peer')).to_be_visible()
    open_demo_drawer(demo)
    demo.locator('[data-demo-highlight="3"]').click()
    expect(demo.get_by_role('heading', name='课后复盘')).to_be_visible(timeout=20000)
    expect(demo.locator('[data-pilot-source="simulated"]')).to_be_visible()
    expect(demo.locator('[data-pilot-value="interactivePageCount"]')).to_contain_text('3')
    print('PASS: 4 highlights, sample reset, locked diffraction comparison, same-page AI peer and simulated full-deck replay', flush=True)
    context.close()
    verify_laptop(browser, demo_file, errors, network)
    verify_slide_editor(browser, platform, errors, network)
    assert errors == [], errors
    assert network == [], network

    with classroom_server(target_dir) as origin:
        live = browser.new_context(viewport=PHONE)
        page = live.new_page()
        live_errors = []
        page.on('pageerror', lambda error: live_errors.append(str(error)))
        page.goto(origin + '/?view=materials')
        button(page, 'AI 备课').click()
        web_images = page.get_by_label('允许联网配图（开源科普图库）')
        expect(web_images).to_be_visible()
        expect(web_images).to_be_checked()
        web_images.uncheck()
        expect(web_images).not_to_be_checked()
        web_images.check()
        expect(web_images).to_be_checked()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.set_viewport_size(PROJECTION)
        originals = sorted((ROOT / '示例课件').glob('04-*.pdf'))
        assert len(originals) == 1, originals
        page.locator('[data-file]').set_input_files(originals[0])
        expect(page.locator('.prep-preview [data-page]')).to_have_count(8, timeout=45000)
        expect(page.locator('.prep-preview .lecture-frame-original img')).to_be_visible()
        button(page, '开始上课').click()
        expect(page.locator('.native-canvas .lecture-frame-original img')).to_be_visible()
        expect(page.locator('[data-lecture-page] option')).to_have_count(8)
        assert live_errors == [], live_errors
        live.close()
    print('PASS: teacher media controls default to on and toggle at 375px; eight imported PDF pages retain their original images', flush=True)
    browser.close()

print('PASS: 0 external or adjacent-file resource requests and 0 browser console errors across the two offline exports.')
