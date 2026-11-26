"""Build the V4 dual-source / inline-player diagram and two-page A4 protocol PDF."""
from pathlib import Path
from html import escape
import shutil
from playwright.sync_api import sync_playwright
import pymupdf as fitz
S=Path(__file__).resolve().parents[1];SOURCE=S.parent;ROOT=SOURCE.parent.parent if SOURCE.name=='source' and SOURCE.parent.name=='.polyphony-work' else SOURCE;OUT=S/'artifacts/v4-phase2';OUT.mkdir(parents=True,exist_ok=True)
parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1300" viewBox="0 0 1600 1300" role="img"><title>共演智课 V4.0 双源备课与页内原生流式播放器架构</title><rect width="1600" height="1300" rx="18" fill="#F3F7FA"/><g font-family="Microsoft YaHei,Arial,sans-serif">']
def txt(x,y,s,z=22,c='#1D3B54',bold=False):parts.append(f'<text x="{x}" y="{y}" font-size="{z}" fill="{c}" font-weight="{700 if bold else 400}">{escape(s)}</text>')
def box(x,y,w,h,c='#FFFFFF'):parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="13" fill="{c}" stroke="#CBDAE5"/>')
txt(48,54,'共演智课 · Polyphony V4.0',26,'#0A7D86',True);txt(48,106,'双源备课 → 五阶段 Harness → 声明式模组 → 同页融合课堂',35,bold=True)
box(48,145,1504,220);txt(74,185,'01  双源备课接入层  /  Dual-Source Authoring',26,'#087E87',True)
box(74,207,710,130,'#EAF4F5');box(805,207,720,130,'#EDF1FC')
for x,items in [(94,['📂 导入既有 .ppt / .pptx / .pdf 无损活化','保留老教师熟悉版式与讲授脉络','提取 M1..Mk 引文块 + 原页视觉预览']), (825,['✨ AI 从零根据专业需求生成原生课件','课程对象 + 核心重难点 + 课时规模','合成代码栏 / 表格 / 公式块 + 互动契约'])]:
 for j,line in enumerate(items):txt(x,240+j*35,line,22 if j else 24,bold=j==0)
box(48,388,1504,395,'#EAF4F5');txt(74,430,'02  五阶段 Agent Harness 编排引擎',27,'#087E87',True)
box(74,449,1452,51,'#15354F');txt(95,484,'开放模型 API Hub · 统一兼容网关 · 模型可替换 · 本地结构化回退有明确标注',23,'#FFFFFF',True)
stages=['01  原稿结构化 / 教学大纲规划','02  课堂节奏与卡点配额预算：60s 微卡点 / 3min 思辨破冰','03  并发合成结构化页块与交互契约','04  M1..Mk 引文硬溯源 + safe-expr 零 eval 算式校验 + 单次闭环自修复','05  双轮课堂状态机沙箱试跑：首轮 → 公布 → 分支 → 改答 → 收束']
for i,s in enumerate(stages):txt(97,540+i*47,s,23,bold=i==3)
box(48,806,1504,150);txt(74,850,'03  模块化交互能力插件总线  /  Modular Activity Protocol Bus',26,'#087E87',True)
txt(74,894,'concept-diagnosis@1  ·  step-fault@1  ·  param-explorer@1  ·  evidence-weighing@1',23,bold=True)
txt(74,932,'纯声明式 JSON 驱动 · 零硬编码学科仿真器 · 统一输入、公布、反馈与速查卡契约',21)
box(48,979,1504,258,'#15354F');txt(74,1024,'04  页内原生流式互动课件播放器  /  Native Inline Streaming Slide Player',26,'#FFFFFF',True)
for j,s in enumerate(['16:9 教室大屏同页融合：讲义上下文 + 页内实时互动组件，零弹窗','教师同页播控坞：自由翻页不卡死，互动状态逐页归档，底部连续缩略导航','学生手机单页流式同步：同页讲义 + 页内低摩擦作答 + 底部考前速查卡抽屉']):txt(92,1073+j*48,s,23,'#E1F2FB',j==0)
txt(48,1275,'真实运行边界：服务器导入保留 PDF / Office 原页视觉；单文件离线包内置原生实战课件与本地双轮课堂。',19,'#526C7D')
parts.append('</g></svg>');svg=''.join(parts);(S/'demo/architecture.svg').write_text(svg,encoding='utf8')
style='''@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;color:#17354e;font:12px/1.65 "Microsoft YaHei",sans-serif}.page{width:210mm;height:297mm;padding:14mm 15mm;page-break-after:always;background:#f7fafc}.page:last-child{page-break-after:auto}h1{font-size:24px;line-height:1.4;margin:8px 0 16px}h2{font-size:16px;color:#087e87;margin:17px 0 6px}p{margin:7px 0}.eyebrow{color:#087e87;font-weight:700;letter-spacing:1px}.diagram{width:100%;height:222mm;object-fit:contain}.foot{font-size:10px;color:#526c7d;margin-top:8px}table{border-collapse:collapse;width:100%;font-size:11px;line-height:1.6}th,td{border:1px solid #ccdae6;padding:7px 9px;text-align:left;vertical-align:top}th{background:#15354f;color:white}td{background:white}code,pre{font-family:Consolas,"Microsoft YaHei",monospace}pre{background:#15354f;color:#eaf6ff;padding:13px;font-size:11px;line-height:1.7;white-space:pre-wrap;border-radius:8px}.note{background:#e5f2ef;padding:10px 12px;border-radius:8px}'''
html=f'''<!doctype html><meta charset="utf-8"><style>{style}</style><section class="page"><div class="eyebrow">POLYPHONY V4.0 / ARCHITECTURE</div><h1>双源 AI 备课与原生流式课堂</h1><div class="diagram">{svg}</div><p class="foot">系统架构 / 01　两条备课路径共用可校验的 polyphony.lecture@1 课件与双轮状态机。</p></section><section class="page"><div class="eyebrow">POLYPHONY V4.0 / HARNESS CONTRACT</div><h1>可验证的课件、模组与课堂状态</h1><h2>01 · 五阶段编排的输入与验收</h2><table><tr><th>阶段</th><th>输入 → 输出 / 必须通过</th></tr>'''+''.join(f'<tr><td>{a}</td><td>{b}</td></tr>' for a,b in [('01 结构化 / 规划','原稿页 / 专业需求 → 页序、原页视觉、结构化教学块与 M1..Mk。'),('02 节奏预算','课程与页内容 → 60s / 3min 配额；非互动页保持完整。'),('03 并发合成','页上下文 → activityId、options、moduleConfig、branches。'),('04 护栏与修复','引文逐条锚定；safe-expr 白名单解析，零 eval；最多一次修复，失败明确回退。'),('05 双轮试跑','首轮收集 → 公布 → 分支 → 第二轮改答 → 收束；生成逐页回执。')])+'''</table><h2>02 · 统一数据契约与四类交互接口</h2><pre>{
  "schema": "polyphony.lecture@1",
  "pages": [{ "number": 7, "title": "逐行代码审计",
    "blocks": [{ "type": "code", "language": "c", "code": "..." }],
    "interaction": { "activityId": "step-fault@1",
      "correctOptionId": "S4",
      "moduleConfig": { "faultStepId": "S4", "steps": [],
        "quickReasons": [], "takeaway": {} }, "branches": [] }
  }]
}</pre><table><tr><th>接口</th><th>页内输入与输出</th></tr><tr><td>concept-diagnosis@1</td><td>概念选项 + 理由胶囊 → 分布 / 红蓝理由对照。</td></tr><tr><td>step-fault@1</td><td>逐行定位首次失效步骤 → 行级热力 / 机制纠错。</td></tr><tr><td>param-explorer@1</td><td>声明式 sliders / curves → SVG 实时曲线 + 预测检验。</td></tr><tr><td>evidence-weighing@1</td><td>立场、证据与限制 → 立场条 / 可质询盲盒 AI 辩友。</td></tr></table><h2>03 · 同页播放器的交互边界</h2><p>教师、投影和手机共享当前页与课堂轮次。自由翻页保存本页状态，返回时可恢复；过期页面 / 轮次提交被拒绝。手机同页作答，完成后的机制总结累积进入底部速查卡抽屉。</p><p class="note">证据与演示边界：模拟投票明确标注；英语两组数据为原创课堂模拟。静态离线包可在 file:/// 使用本机课堂；跨设备实时同步、PDF / Office 转换与外部模型调用需运行服务及相应本机组件。</p><p class="foot">Harness 协议 / 02　完整字段约束以源码验证器与实际回执为准；以上 JSON 为结构节选。</p></section>'''
# SVG in the first page participates in normal flow; assign a true fixed print box.
html=html.replace('<div class="diagram">','<div class="diagram" style="display:flex;align-items:center">').replace('<svg xmlns=', '<svg style="width:100%;height:100%" xmlns=',1)
path=OUT/'architecture-v4.html';path.write_text(html,encoding='utf8')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,channel='msedge');page=b.new_page();page.goto(path.as_uri());page.evaluate('document.fonts.ready');page.pdf(path=str(ROOT/'共演智课-系统架构与Harness协议.pdf'),print_background=True,prefer_css_page_size=True);b.close()
pdf=fitz.open(ROOT/'共演智课-系统架构与Harness协议.pdf');assert len(pdf)==2
for i,p in enumerate(pdf):p.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/f'architecture-v4-p{i+1}.png')
shutil.copy2(ROOT/'共演智课-系统架构与Harness协议.pdf',SOURCE/'共演智课-系统架构与Harness协议.pdf')
print('V4 SVG + 2-page A4 PDF built')
