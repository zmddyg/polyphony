"""Audit the actual Phase 2 delivery and every mirrored byte identity."""
from pathlib import Path
import json,re,hashlib
from PIL import Image
from pptx import Presentation
import pymupdf as fitz
S=Path(__file__).resolve().parents[1];SOURCE=S.parent;ROOT=SOURCE.parent.parent;M=ROOT/'.polyphony-work/github-publish-20261124/polyphony';OUT=S/'artifacts/v4-phase2'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
browser=json.loads((OUT/'browser-report.json').read_text(encoding='utf8'));assert not any(browser[k] for k in ['consoleErrors','pageErrors','offlineRequests']);assert len(browser['screenshots'])==7 and len(browser['checks'])==9 and browser['serverStopped']
tap=(OUT/'full-tests.tap').read_text(encoding='utf8');counts={k:int(re.search(r'\b'+k+r' (\d+)',tap).group(1)) for k in ['tests','pass','fail','skipped','cancelled']};assert counts['fail']==counts['skipped']==counts['cancelled']==0 and counts['pass']==counts['tests']
validation=json.loads((OUT/'pptx-validation.json').read_text(encoding='utf8'));assert len(validation)==3 and all(v['status']=='VALID' and v['errors']==0 for v in validation)
samples=[]
for p,total in zip(sorted((ROOT/'示例课件').glob('*.pptx')),[12,10,10]):
 prs=Presentation(p);assert len(prs.slides)==total and abs(prs.slide_width/prs.slide_height-16/9)<.0001;assert all(sl.shapes.title and sl.shapes.title.text for sl in prs.slides)
 assert sha(p)==sha(SOURCE/'示例课件'/p.name)==sha(M/'示例课件'/p.name)
 samples.append({'file':p.name,'pages':total,'nativeTables':sum(sh.has_table for sl in prs.slides for sh in sl.shapes),'sha256':sha(p)})
p=next((ROOT/'示例课件').glob('04-*.pdf'));pdf=fitz.open(p);assert len(pdf)==8 and all(abs(page.rect.width/page.rect.height-16/9)<.0001 for page in pdf);assert sha(p)==sha(SOURCE/'示例课件'/p.name)==sha(M/'示例课件'/p.name);samples.append({'file':p.name,'pages':8,'sha256':sha(p)})
for place in [ROOT,SOURCE,M]:
 assert not any((place/n).exists() for n in ['共演智课-V4-Phase1交付包.zip','共演智课-V4原生互动课堂.html'])
 assert len(list(place.glob('0[1-7]-*.png')))==7
 assert len(list((place/'示例课件').glob('*.pptx')))==3
 assert not list((place/'示例课件').glob('01-C语言指针与线性代数空间精讲.pptx'))
shots=[]
for p in sorted(ROOT.glob('0[1-7]-*.png')):
 size=Image.open(p).size;expected=(2880,1800) if p.name[:2] in ['01','07'] else (1720,1900) if p.name[:2]=='06' else (3840,2160);assert size==expected
 assert sha(p)==sha(SOURCE/p.name)==sha(M/p.name);shots.append({'file':p.name,'pixels':list(size),'dpr':2,'sha256':sha(p)})
for name in ['共演智课-单文件离线演示版.html','共演智课-交互模组库独立版.html','共演智课-系统架构与Harness协议.pdf','README.md']:
 assert sha(ROOT/name)==sha(SOURCE/name)==sha(M/name)
architecture=fitz.open(ROOT/'共演智课-系统架构与Harness协议.pdf');assert len(architecture)==2 and all(abs(p.rect.width-595.28)<1 and abs(p.rect.height-841.89)<1 for p in architecture)
sync=json.loads((OUT/'sync-report.json').read_text(encoding='utf8'))
for name,digest in sync['sha256'].items():assert sha(SOURCE/name)==sha(M/name)==digest
assert not any(p.exists() for p in [M/'studio/artifacts',M/'studio/node_modules',M/'studio/.polyphony-rooms.json.lectures'])
report={'version':'4.0 / Phase 2','tests':counts,'pptxValidation':validation,'samples':samples,'architecture':{'pages':2,'paper':'A4','sha256':sha(ROOT/'共演智课-系统架构与Harness协议.pdf')},'offline':{'bundles':2,'completeDecksPerBundle':[12,10,10],'consoleErrors':0,'pageErrors':0,'networkRequests':0,'checks':browser['checks']},'screenshots':shots,'mirror':{'filesVerified':sync['filesVerified'],'location':str(M),'excluded':sync['excluded']},'temporaryPhase1RootFilesRemoved':True,'sourceV1BackupTouched':False}
(OUT/'release-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=False,indent=2))
