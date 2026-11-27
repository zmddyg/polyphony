"""Reproducible editable V4 decks; content comes from the classroom's COMBAT_DECKS.
Uses python-pptx native text/tables, PowerPoint for faithful rendering, PyMuPDF for QA/PDF.
Run from any directory. No network or personal identifiers are used.
"""
from pathlib import Path
import json, subprocess, shutil, math, re
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.xmlchemy import OxmlElement
import pymupdf as fitz
from PIL import Image,ImageDraw,ImageFont

STUDIO=Path(__file__).resolve().parents[1]; SOURCE=STUDIO.parent; ROOT=SOURCE.parent.parent if SOURCE.name=='source' and SOURCE.parent.name=='.polyphony-work' else SOURCE
OUT=STUDIO/'artifacts/v4-phase2';OUT.mkdir(parents=True,exist_ok=True)
NAMES=['01-软件技术基础-第6章指针与函数传址实战(12页).pptx','02-物理光学与光电调制-衍射干涉与调制实战(10页).pptx','03-大学英语Unit4-实证阅读与学术思辨实战(10页).pptx']
LEGACY='04-旧课件导入示例-软件技术基础第6章指针原稿(8页).pdf'
C={'navy':'13314A','teal':'087E87','ink':'203B50','muted':'526C7D','paper':'FFFFFF','pale':'EAF3F5','line':'CDDEE3','code':'142B41','white':'F3F8FC'}
def rgb(c):return RGBColor.from_string(C.get(c,c))
def rect(sl,x,y,w,h,color):
 s=sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h));s.fill.solid();s.fill.fore_color.rgb=rgb(color);s.line.fill.background();return s
def text(sl,x,y,w,h,content,size=16,color='ink',bold=False,font='Microsoft YaHei'):
 s=sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h));tf=s.text_frame;tf.word_wrap=True;tf.margin_left=tf.margin_right=Inches(.04);tf.margin_top=tf.margin_bottom=0
 for i,line in enumerate(str(content).split('\n')):
  p=tf.paragraphs[0] if i==0 else tf.add_paragraph();p.text=line;p.alignment=PP_ALIGN.LEFT;p.font.name=font;p.font.size=Pt(size);p.font.bold=bold;p.font.color.rgb=rgb(color);p.space_after=Pt(0);p.line_spacing=1.12
 return s
def unitlen(s):return sum(1 if ord(c)>255 else .53 for c in str(s))
def lines(s,w,fs):return sum(max(1,math.ceil(unitlen(t)/(w*72/fs))) for t in str(s).split('\n'))
def natural(b,w):
 t=b['type'];title=.35 if b.get('title') else 0
 if t=='table':
  cols=len(b['headers']);cw=(w-.25)/cols;return title+.20+sum(max(lines(s,cw,15) for s in row)*.25+.15 for row in [b['headers']]+b['rows'])
 if t=='code':return title+.40+len(b['code'].splitlines())*.34
 if t=='code-pair':return max(natural(b['left'],(w-.25)/2),natural(b['right'],(w-.25)/2))+.12
 if t=='mzi-diagram':return 1.65
 if t=='formula':return title+.25+sum(lines(i,w-.5,18)*.33 for i in b['items'])
 if t in ['bullets','steps']:return title+.2+sum(lines(i,w-.6,16)*.29+.12 for i in b['items'])
 return title+.24+lines(b.get('text',''),w-.5,15)*.28
def block(sl,b,x,y,w,h,scale):
 t=b['type'];fs=max(14,16*scale);titleh=.35*scale
 if t=='mzi-diagram':
  text(sl,x,y,w,.35,'推挽 MZM：两臂差分相移与相互作用长度 L',15,'teal',True)
  cy=y+.43;armh=h-.65;left=x+.8;right=x+w-.8;mid=(left+right)/2
  for ay in [cy,cy+armh]:rect(sl,left,ay,right-left,.035,'teal')
  rect(sl,left,cy,.04,armh,'teal');rect(sl,right,cy,.04,armh,'teal')
  rect(sl,left-.22,cy+armh/2-.13,.44,.26,'navy');rect(sl,right-.22,cy+armh/2-.13,.44,.26,'navy')
  text(sl,left+.45,cy+.06,4,.3,'上臂：+V/2 → +Δφ/2',14)
  text(sl,left+.45,cy+armh-.35,4,.3,'下臂：−V/2 → −Δφ/2',14)
  text(sl,mid-2.1,cy+armh/2-.15,6,.35,'Δφ = φ₁ − φ₂ = πV/Vπ ；L',16,'navy',True)
  text(sl,left-.5,cy+armh/2+.18,2,.3,'50:50 分束',12,'muted');text(sl,right-1,cy+armh/2+.18,2,.3,'相干合束',12,'muted')
  return
 if t=='code-pair':
  for j,k in enumerate(['left','right']):block(sl,b[k],x+j*(w+.25)/2,y,(w-.25)/2,h,scale)
  return
 bg='code' if t=='code' else 'pale'
 if t!='table':rect(sl,x,y,w,h,bg)
 if b.get('title'):text(sl,x+.14,y+.08,w-.28,titleh,b['title'],max(13,15*scale),'white' if t=='code' else 'teal',True)
 cy=y+(titleh+.13 if b.get('title') else .1)
 if t=='table':
  rows=[b['headers']]+b['rows'];n=len(b['headers']);ch=h-(cy-y)
  tb=sl.shapes.add_table(len(rows),n, Inches(x), Inches(cy), Inches(w), Inches(ch)).table
  # Give explanatory columns extra width where the first column is a short label.
  weights=[1]*n
  if n>=3:weights=[.85]+[1.075]*(n-1)
  for j,weight in enumerate(weights):tb.columns[j].width=Inches(w*weight/sum(weights))
  needs=[max(lines(s,w*weights[j]/sum(weights)-.20,fs*.94) for j,s in enumerate(row))+.65 for row in rows]
  for i,row in enumerate(rows):
   tb.rows[i].height=Inches(ch*needs[i]/sum(needs))
   for j,value in enumerate(row):
    cell=tb.cell(i,j);cell.text=str(value);cell.margin_left=cell.margin_right=Inches(.10);cell.margin_top=cell.margin_bottom=Inches(.055);cell.vertical_anchor=MSO_ANCHOR.MIDDLE;cell.fill.solid();cell.fill.fore_color.rgb=rgb('teal' if i==0 else 'pale' if i%2==0 else 'paper')
    for p in cell.text_frame.paragraphs:p.font.name='Microsoft YaHei';p.font.size=Pt(fs*.94);p.font.bold=i==0;p.font.color.rgb=rgb('white' if i==0 else 'ink');p.space_after=Pt(0);p.line_spacing=1.05
 elif t=='code':text(sl,x+.16,cy,w-.32,h-(cy-y)-.05,b['code'],max(14,17*scale),'white',font='Consolas')
 elif t=='formula':text(sl,x+.16,cy,w-.32,h-(cy-y)-.05,'\n'.join(b['items']),max(15,19*scale),'navy',font='Microsoft YaHei')
 elif t in ['bullets','steps']:
  content='\n'.join((str(i+1)+'. ' if t=='steps' else '• ')+v for i,v in enumerate(b['items']));text(sl,x+.16,cy,w-.32,h-(cy-y)-.05,content,fs)
 else:text(sl,x+.16,cy,w-.32,h-(cy-y)-.05,b.get('text',''),max(14,15.5*scale),'ink')

def extra_blocks(p):
 blocks=json.loads(json.dumps(p['blocks'],ensure_ascii=False));lesson=p.get('showcaseLesson');n=p['number']
 if lesson and lesson['activityId']=='step-fault@1' and lesson['moduleConfig']['artifactLang']!='code':
  c=lesson['moduleConfig'];blocks.append({'type':'table','title':'五步推理审计 / Find the first invalid inference','headers':['步骤','待审计推理'], 'rows':[[s['line'],s['content']] for s in c['steps']]})
  if lesson['id']=='optics-er':
   t=blocks[-1];t['headers'].append('正确推导（取 3dB ≈ 功率减半）')
   correct=['T₂ = 10^(−3/10) ≈ 0.5','t₂ = √T₂ ≈ 0.707，不能令 t₂ = T₂','I(Δφ) = (1+t₂²+2t₂ cosΔφ)/4','Imax=(1+t₂)²/4；Imin=(1−t₂)²/4','ER≈33.97；10log₁₀ER≈15.31dB']
   for row,value in zip(t['rows'],correct):row.append(value)
 if lesson and lesson['id']=='c-swap-bug':
  blocks.insert(1,{'type':'table','title':'调用栈与对象关系（a=3，b=7）','headers':['调用者栈帧','swap_bug 栈帧','是否可解引用'], 'rows':[['a @ &a → 3','px = &a','*px 合法 → a'],['b @ &b → 7','py = &b','*py 合法 → b'],['未分配 temp 所指对象','temp = NULL','*temp 非法；不是 int 临时量']]})
 if lesson and lesson['id']=='english-blind-review':
  blocks.insert(1,{'type':'table','title':'Debate evidence matrix','headers':['Policy choice','Potential benefit','Cost / evidence gap'], 'rows':[['Initial blind screening','Reduce irrelevant identity cues','Masking cost; retain essential context'],['Pilot with audit','Measure fairness and workload','Define outcomes before comparison'],['Visible identity + audit','Preserve contextual evaluation','Reviewer expertise does not rule out bias']]})
 if lesson and lesson['id']=='c-stride':
  blocks[1]={'type':'table','title':'本页 ABI：64 位环境，int=4B，double=8B','headers':['表达式','本例结果','依据'], 'rows':[['sizeof(p) / sizeof(q)','8B / 8B','指针对象本身大小，由本页 ABI 指定'],['sizeof(*p) / sizeof(*q)','4B / 8B','所指元素的类型'],['p+1 / q+1','分别偏移 4B / 8B','每次前进一个所指类型元素']]}
  blocks.append({'type':'callout','title':'独立诊断','text':'同学说：“p 和 q 都占 8B，所以它们加 1 都移动 8B。”这一推断混淆了哪两个量？'})
 return blocks

def build(deck,name):
 prs=Presentation();prs.slide_width=Inches(17.777778);prs.slide_height=Inches(10)
 prs.core_properties.author='';prs.core_properties.title=deck['title'];prs.core_properties.subject='共演智课 V4.0 原创课堂讲义';prs.core_properties.keywords='V4; native; classroom'
 for p in deck['pages']:
  sl=prs.slides.add_slide(prs.slide_layouts[6]);rect(sl,0,0,17.7778,1.38,'navy')
  text(sl,.60,.17,15.8,.3,'HUST  /  大学课堂实战讲义  /  共演智课 V4.0',13,'white')
  title='第6章 指针变量、自增优先级与函数传址实战' if deck['id']=='deck-c-pointers' and p['number']==1 else p['title'];title_shape=text(sl,.60,.60,16.6,.65,title,30 if unitlen(title)<32 else 26,'white',True)
  ph=OxmlElement('p:ph');ph.set('type','title');title_shape._element.nvSpPr.nvPr.append(ph)
  blocks=extra_blocks(p)
  if deck['id']=='deck-optics' and p['number']==6:blocks.insert(1,{'type':'mzi-diagram'})
  w=16.55;available=7.65;gap=.20;scale=1.25
  for _ in range(4):
   natural_h=[natural(b,w/scale) for b in blocks];scale=min(scale,(available-gap*(len(blocks)-1))/sum(natural_h))
  natural_h=[natural(b,w/scale) for b in blocks];heights=[v*scale for v in natural_h];y=1.73
  for b,h in zip(blocks,heights):block(sl,b,.61,y,w,h,scale);y+=h+gap
  text(sl,.62,9.60,14.7,.25,'软件技术基础 · 第6章' if deck['id']=='deck-c-pointers' else '物理光学 · 干涉、衍射与电光调制' if deck['id']=='deck-optics' else 'Unit 4 · Original seminar / synthetic teaching datasets',11,'muted')
  text(sl,15.65,9.56,1.5,.3,f'{p["number"]:02d} / {len(deck["pages"]):02d}',13,'teal',True)
  sl.notes_slide.notes_text_frame.text=p.get('speakerNotes','')+'\n'+('互动：'+p['showcaseLesson']['prompt']+'\n参考解析：'+p['showcaseLesson']['moduleConfig'].get('faultDiagnosis',p['showcaseLesson']['moduleConfig'].get('takeaway',{}).get('summary','')) if p.get('showcaseLesson') else '')
 target=ROOT/'示例课件'/name;target.parent.mkdir(exist_ok=True);prs.save(target);(SOURCE/'示例课件').mkdir(exist_ok=True);shutil.copy2(target,SOURCE/'示例课件'/name)
 return target

def render(path):
 dest=OUT/(path.stem+'.pdf')
 cmd=['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(STUDIO/'tools/material-import-powerpoint.ps1'),'-InputFile',str(path),'-OutputFile',str(dest),'-PageLimit','100','-ExpectedPages','0','-MaxBytes','67108864']
 result=subprocess.run(cmd,capture_output=True,text=True,encoding='utf-8');assert dest.exists(),result.stdout+result.stderr
 doc=fitz.open(dest);imgs=[]
 for i,page in enumerate(doc):
  pix=page.get_pixmap(matrix=fitz.Matrix(1,1));im=Image.frombytes('RGB',[pix.width,pix.height],pix.samples);im.save(OUT/f'{path.stem}-p{i+1:02d}.png');im.thumbnail((640,360));imgs.append(im)
 sheet=Image.new('RGB',(1280,math.ceil(len(imgs)/2)*390),'#d6e1e6');draw=ImageDraw.Draw(sheet)
 for i,im in enumerate(imgs):x=(i%2)*640;y=(i//2)*390;sheet.paste(im,(x,y));draw.text((x+8,y+362),f'P{i+1}',fill='#13314a')
 sheet.save(OUT/(path.stem+'-contact.png'));return dest

def main():
 data=subprocess.check_output(['node','--input-type=module','-e',"import{COMBAT_DECKS}from'./dist/core/combat-decks.mjs';console.log(JSON.stringify(COMBAT_DECKS))"],cwd=STUDIO);decks=json.loads(data)
 rendered=[]
 for deck,name in zip(decks,NAMES):rendered.append(render(build(deck,name)));print(name,flush=True)
 src=fitz.open(rendered[0]);legacy=fitz.open()
 for i in [0,1,2,4,5,6,7,8]:legacy.insert_pdf(src,from_page=i,to_page=i)
 # Keep exactly eight original visual pages, with legacy-handout page numbers.
 for i,p in enumerate(legacy):
  p.draw_rect(fitz.Rect(p.rect.width-160,p.rect.height-37,p.rect.width-30,p.rect.height-7),color=None,fill=(1,1,1));p.insert_text((p.rect.width-110,p.rect.height-17),f'{i+1:02d} / 08',fontname='helv',fontsize=13,color=(.03,.49,.53))
 legacy.set_metadata({'title':'软件技术基础第6章指针原稿','author':'','subject':'匿名旧课件导入示例'});legacy.save(ROOT/'示例课件'/LEGACY);shutil.copy2(ROOT/'示例课件'/LEGACY,SOURCE/'示例课件'/LEGACY)
 print(LEGACY,flush=True)
if __name__=='__main__':main()
