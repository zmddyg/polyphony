"""Generate the embedded 1600×1300 architecture diagram and the two-page A4 protocol PDF."""

from html import escape
from pathlib import Path
from shutil import copy2

from playwright.sync_api import sync_playwright
import pymupdf


STUDIO = Path(__file__).resolve().parents[1]
SOURCE = STUDIO.parent
DELIVERY = SOURCE.parents[1] if SOURCE.name == 'source' and SOURCE.parent.name == '.polyphony-work' else SOURCE
QA = STUDIO / 'artifacts/sprint4b-qa/architecture'
PDF_NAME = '共演智课-系统架构与Harness协议.pdf'

STAGES = [
    ('01 解析与课程规划', '保留原稿 M1..Mk，或规划新课的章节、符号约定和逐页任务。'),
    ('02 节奏与卡点预算', '依据教师节奏和互动密度，在关键理解转折安排检测。'),
    ('03 页块与契约合成', '按章串行调用工具，提交讲义页，再按实际页面内容生成互动。'),
    ('04 核验与限次返修', '核对引文、KaTeX、页面密度与图形。全卷审查对重点页面定点修订。'),
    ('05 双轮沙箱预演', '隔离测试首轮、公布、分支、改答和结束。逐页返回校验回执。'),
]
TOOLS = [
    ('多源搜图', '开放许可图库的候选图保留作者、来源和许可，选用后内嵌。'),
    ('精确数值绘图', '用 safe-expr 解析声明式表达式并采样，形成可复核的图表数据。'),
    ('页面校验', '按结构、KaTeX、示意图与文字密度返回具体问题。'),
    ('参考查证', 'Wikipedia 与 OpenAlex 返回清洗过的摘要及来源。'),
    ('提交与修订', '校验后预览成稿，记录失败页与脱敏原因，可在原位重试。'),
]
ACTIVITIES = [
    ('concept-diagnosis@1', '提交判断和理由，公开同选异因。'),
    ('step-fault@1', '定位首次失效的代码或推导步骤，展示逐行热力。'),
    ('param-explorer@1', '拖动参数，观察数值曲线并检验预测。'),
    ('evidence-weighing@1', '权衡证据与立场，质询课堂 AI 辩友。'),
]


def build_diagram():
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1300" viewBox="0 0 1600 1300" role="img">',
        '<title>共演智课 · Polyphony V4.0 系统架构</title>',
        '<rect width="1600" height="1300" rx="18" fill="#F3F7FA"/>',
        '<g font-family="Microsoft YaHei,Arial,sans-serif">',
    ]

    def text(x, y, value, size=22, color='#1D3B54', *, bold=False):
        parts.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" '
                     f'font-weight="{700 if bold else 400}">{escape(value)}</text>')

    def box(x, y, width, height, fill='#FFFFFF'):
        parts.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="13" '
                     f'fill="{fill}" stroke="#CBDAE5"/>')

    text(48, 54, '共演智课 · Polyphony V4.0', 26, '#0A7D86', bold=True)
    text(48, 106, '双源备课、工具调用与同页课堂', 37, bold=True)
    box(48, 145, 1504, 202)
    text(74, 185, '01  双源备课接入', 26, '#087E87', bold=True)
    box(74, 207, 710, 115, '#EAF4F5')
    box(805, 207, 720, 115, '#EDF1FC')
    text(94, 245, '旧 PPT 与教材', 25, bold=True)
    text(94, 285, '原页活化、插入拓展页或重构并回用原稿插图')
    text(825, 245, '从教学目标生成原生课件', 25, bold=True)
    text(825, 285, '6–48 页统一规划，默认 10 页也由 Agent 编排')

    box(48, 367, 1504, 433, '#EAF4F5')
    text(74, 409, '02  教学编排 Agent 与五阶段 Harness', 27, '#087E87', bold=True)
    box(74, 428, 1452, 52, '#15354F')
    text(95, 463, '开放兼容主模型 + 快速决策模型  /  原生工具调用与 JSON Action', 23, '#FFFFFF', bold=True)
    for index, (name, detail) in enumerate(STAGES):
        y = 521 + index * 44
        text(96, y, name, 23, bold=True)
        text(366, y, detail, 22)
    box(74, 722, 1452, 52, '#FFFFFF')
    text(96, 756, '五项工具能力  /  多源搜图、精确数值绘图、页面校验、参考查证、提交与修订', 23, '#087E87', bold=True)

    box(48, 820, 1504, 148)
    text(74, 862, '03  可复用的页内互动契约', 26, '#087E87', bold=True)
    text(74, 903, 'concept-diagnosis@1    step-fault@1    param-explorer@1    evidence-weighing@1', 23, bold=True)
    text(74, 940, '以声明式 JSON 定义作答、公布、反馈与速查卡。', 21)

    box(48, 988, 1504, 241, '#15354F')
    text(74, 1030, '04  同页互动课件播放器', 26, '#FFFFFF', bold=True)
    lines = [
        '教室投影与教师播控共用 16:9 讲义，翻页后可回看该页学情。',
        '六种视觉原型涵盖封面、章节页、推导、对比、例题和总结。',
        '学生手机跟随原页作答，课后可保存离线个人复习单。',
    ]
    for index, line in enumerate(lines):
        text(94, 1077 + index * 44, line, 23, '#E1F2FB')
    text(48, 1271, '单文件内嵌 KaTeX 与 20 款字体，断网可翻页、排版公式、开展两轮互动。', 21, '#526C7D')
    parts.append('</g></svg>')
    return '\n'.join(parts)


def table(columns, rows):
    header = ''.join(f'<th>{escape(column)}</th>' for column in columns)
    body = ''.join(f'<tr><th scope="row">{escape(name)}</th><td>{escape(detail)}</td></tr>' for name, detail in rows)
    return f'<table><thead><tr>{header}</tr></thead><tbody>{body}</tbody></table>'


def build_html(svg):
    diagram = svg.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ', 1)
    css = '''
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; color: #17354e; font: 12px/1.62 "Microsoft YaHei", sans-serif; }
.page { width: 210mm; height: 296.8mm; padding: 13mm 15mm; break-after: page; background: #f7fafc; }
.page:last-child { break-after: auto; }
header { color: #087e87; font-weight: 700; letter-spacing: 1px; }
h1 { font-size: 26px; line-height: 1.25; margin: 8px 0 18px; }
h2 { font-size: 16px; color: #087e87; margin: 15px 0 6px; }
p { margin: 8px 0; }
.diagram { height: 176mm; }
.note { padding: 10px 13px; border-radius: 8px; background: #e5f2ef; }
footer { font-size: 10px; color: #526c7d; margin-top: 14px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ccdae6; padding: 5px 8px; text-align: left; vertical-align: top; }
thead th { background: #15354f; color: white; }
tbody th { width: 25%; white-space: nowrap; background: #edf4f8; }
tbody td { background: white; }
'''
    return f'''<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>共演智课系统架构与 Harness 协议</title>
<style>{css}</style>
<section class="page">
  <header>POLYPHONY V4.0</header>
  <h1>双源备课与同页课堂架构</h1>
  <div class="diagram">{diagram}</div>
  <p class="note">开放兼容主模型起草讲义，快速决策模型优先筛选卡点并审查全卷。两层可搭配 OpenAI、DeepSeek、Qwen、Gemini 或校园网关。教师可查看工具轨迹和逐页预览，失败页可单独重试。</p>
  <p>单机课堂在 file:/// 下使用本地备课框架、完整公式和课堂互动。服务端可跨设备同步，并转换 PDF 和 Office 原页。可在教师设置中启用联网模型和开放许可配图。</p>
  <footer>系统架构 / 01</footer>
</section>
<section class="page">
  <header>POLYPHONY V4.0</header>
  <h1>课件编排与课堂校验契约</h1>
  <h2>五阶段 Harness</h2>
  {table(('阶段', '输入与验收'), STAGES)}
  <h2>Agent 工具</h2>
  {table(('能力', '工具结果'), TOOLS)}
  <h2>页内互动协议</h2>
  {table(('协议', '课堂行为'), ACTIVITIES)}
  <p class="note">老师、投影和手机共享页位与课堂轮次。翻回前页先恢复该页状态。学生作答经页位与轮次校验，完成后可从速查抽屉导出个人复习单。模拟作答在课堂统计中标注来源。</p>
  <footer>Harness 协议 / 02　课件 JSON 使用 polyphony.lecture 格式（版本 1）。</footer>
</section>
</html>
'''


def main():
    QA.mkdir(parents=True, exist_ok=True)
    svg = build_diagram()
    html = QA / 'architecture-v4.html'
    pdf = QA / PDF_NAME
    html.write_text(build_html(svg), encoding='utf-8')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel='msedge')
        page = browser.new_page(offline=True)
        page.goto(html.as_uri())
        page.evaluate('document.fonts.ready')
        page.pdf(path=str(pdf), print_background=True, prefer_css_page_size=True)
        browser.close()
    with pymupdf.open(pdf) as document:
        assert len(document) == 2
        for number, page in enumerate(document, 1):
            assert abs(page.rect.width - 595.28) < 1 and abs(page.rect.height - 841.89) < 1, page.rect
            text = page.get_text()
            assert '\ufffd' not in text and f'/ 0{number}' in text and 'POLYPHONY V4.0' in text
            page.get_pixmap(dpi=130).save(QA / f'architecture-v4-p{number}.png')
    (STUDIO / 'dist/assets/architecture.svg').write_text(svg, encoding='utf-8')
    for destination in {DELIVERY, SOURCE}:
        copy2(pdf, destination / PDF_NAME)
    print(f'Built embedded architecture SVG and verified 2 A4 PDF pages ({pdf.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
