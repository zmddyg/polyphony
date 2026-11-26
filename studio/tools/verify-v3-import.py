from pathlib import Path
import json,zipfile
from playwright.sync_api import sync_playwright
import pymupdf as fitz
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts'/'v3-import';OUT.mkdir(parents=True,exist_ok=True)
pdf=fitz.open()
for title,body in [('Gaussian packet','f(x)=exp(-a*x^2)\nIncreasing a narrows the time-domain pulse.'),('Wrap-up','Check assumptions and source evidence.')]:
 page=pdf.new_page(width=900,height=600);page.insert_text((70,90),title,fontsize=26);page.insert_text((70,160),body,fontsize=18)
pdf.save(OUT/'source.pdf');pdf.close()
report={'checks':[],'consoleErrors':[],'exceptions':[]}
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(viewport={'width':1440,'height':900});page=c.new_page()
 page.on('pageerror',lambda e:report['exceptions'].append(str(e)));page.on('console',lambda m:report['consoleErrors'].append(m.text) if m.type=='error' else None)
 page.goto('http://127.0.0.1:4188');page.wait_for_load_state('networkidle')
 for file in [ROOT/'tests/fixtures/material-import-basic.ppt',ROOT/'tests/fixtures/material-import-hidden.pptx',OUT/'source.pdf']:
  page.locator('[data-file]').set_input_files(str(file))
  page.locator('[data-page]').first.wait_for()
  page.wait_for_function("document.querySelector('.v3-deck h2')?.textContent.includes("+json.dumps(file.stem.split('-')[0])+ ") || document.querySelector('[data-harness-status]')?.textContent.includes('原稿已载入')")
  page.locator('[data-run-harness]').click();page.locator('[data-publish]').wait_for()
  assert page.locator('[data-stage][data-state=complete]').count()==5
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  report['checks'].append({'file':file.name,'visiblePages':page.locator('[data-page]').count()})
  page.screenshot(path=str(OUT/(file.suffix[1:]+'.png')),full_page=True)
 b.close()
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
assert not report['consoleErrors'] and not report['exceptions']
