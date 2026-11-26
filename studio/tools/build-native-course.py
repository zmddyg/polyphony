"""Three native editable course decks; no raster images."""
from pathlib import Path
from math import exp,pi,cos,sqrt
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE,MSO_CONNECTOR
from pptx.chart.data import XyChartData
from pptx.enum.chart import XL_CHART_TYPE,XL_LEGEND_POSITION
from pptx.oxml.xmlchemy import OxmlElement
DEST=Path(__file__).resolve().parents[2]/'示例课件'
C={'ink':'0B1526','blue':'0B4F6C','green':'047857','muted':'475569','line':'D8E1EB','bg':'F6F8FA','white':'FFFFFF','rose':'9F1239'}
def rgb(v):return RGBColor.from_string(C.get(v,v))
def tx(s,x,y,w,h,t,z=20,c='ink',bold=False,font='Microsoft YaHei'):
 q=s.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h));q.name='Title' if z==32 else 'Native editable text';f=q.text_frame;f.word_wrap=True;f.margin_left=f.margin_right=f.margin_top=f.margin_bottom=0
 for i,line in enumerate(t.split('\n')):
  p=f.paragraphs[0] if i==0 else f.add_paragraph();p.space_after=Pt(10);r=p.add_run();r.text=line;r.font.name=font;r.font.size=Pt(z);r.font.bold=bold;r.font.color.rgb=rgb(c)
 return q
def box(s,x,y,w,h,fill='white'):
 q=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(x),Inches(y),Inches(w),Inches(h));q.fill.solid();q.fill.fore_color.rgb=rgb(fill);q.line.color.rgb=rgb('line');return q
def arrow(s,x,y,x2,y2):
 q=s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,Inches(x),Inches(y),Inches(x2),Inches(y2));q.line.color.rgb=rgb('blue');q.line.width=Pt(2);e=OxmlElement('a:tailEnd');e.set('type','triangle');q.line._get_or_add_ln().append(e)
def deck(title,n,tag):
 p=Presentation();p.slide_width=Inches(13.333333);p.slide_height=Inches(7.5);p.core_properties.title=title;p.core_properties.subject='共演智课 · Polyphony V3.0 多学科教学示例';p.core_properties.author='共演智课';return p,n,tag
def slide(d,title,sub):
 p,n,tag=d;s=p.slides.add_slide(p.slide_layouts[6]);s.background.fill.solid();s.background.fill.fore_color.rgb=rgb('bg');tx(s,.55,.33,12,.35,'华中科技大学 · 教学情境示例 / '+tag,12,'blue',True);tx(s,.55,.98,12.2,1.12,title,32,'ink',True);tx(s,.55,2.12,12.1,.65,sub,16,'muted');tx(s,.55,7.03,11.5,.3,'共演智课 · Polyphony V3.0 | 原页可编辑 · 问题须核对前提与证据',10,'muted');tx(s,12.1,7.03,.7,.3,f'{len(p.slides):02} / {n:02}',10,'blue',True);return s
def card(s,x,y,w,h,title,body,c='blue'):
 box(s,x,y,w,h);tx(s,x+.22,y+.2,w-.44,.5,title,22,c,True);tx(s,x+.22,y+.95,w-.44,h-1.02,body,18)
def cards(s,items):
 for i,(a,b) in enumerate(items):card(s,.7+i*4.15,3.1,3.6,3.05,a,b)
def chart(s,x,y,w,h,series,xmin,xmax,ymin,ymax):
 data=XyChartData()
 for label,points in series:
  a=data.add_series(label)
  for xx,yy in points:a.add_data_point(xx,yy)
 c=s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER_SMOOTH_NO_MARKERS,Inches(x),Inches(y),Inches(w),Inches(h),data).chart;c.has_legend=True;c.legend.position=XL_LEGEND_POSITION.BOTTOM;c.legend.font.size=Pt(11)
 for ax,lo,hi in [(c.category_axis,xmin,xmax),(c.value_axis,ymin,ymax)]:ax.minimum_scale=lo;ax.maximum_scale=hi;ax.tick_labels.font.size=Pt(11)
 for i,a in enumerate(c.series):a.format.line.color.rgb=rgb(['blue','green'][i]);a.format.line.width=Pt(2.3)
def table(s,rows):
 t=s.shapes.add_table(len(rows),len(rows[0]),Inches(.75),Inches(3),Inches(11.8),Inches(3)).table
 for i,row in enumerate(rows):
  for j,v in enumerate(row):
   cell=t.cell(i,j);cell.text=v;cell.fill.solid();cell.fill.fore_color.rgb=rgb('blue' if i==0 else 'white')
   for p in cell.text_frame.paragraphs:
    for r in p.runs:r.font.name='Microsoft YaHei';r.font.size=Pt(17);r.font.bold=i==0;r.font.color.rgb=rgb('white' if i==0 else 'ink')
def save(d,name):
 path=DEST/name;d[0].save(path);print(path.name,path.stat().st_size)
def build():
 DEST.mkdir(exist_ok=True,parents=True)
 d=deck('C语言指针与线性代数空间精讲',5,'公共理工基础课')
 s=slide(d,'从内存寻址到线性空间','大一核心课最易踩坑的三处隐含条件：对象有效性、维数约束与变换约定')
 cards(s,[('有效对象','指针存储地址\n对象必须存在且存活'),('有效映射','A：Rⁿ → Rᵐ\n先辨输入与输出维数'),('有效尺度','固定傅里叶约定\n区分峰高与波包宽度')]);arrow(s,4.4,4.4,4.75,4.4);arrow(s,8.55,4.4,8.9,4.4);tx(s,.85,6.35,11.6,.5,'共同方法：每跨一步，先问“这一操作依赖的前提还成立吗？”',21,'green',True)
 s=slide(d,'C 语言结构体与指针传参','5 行代码里的未初始化 / 越界隐患：本例初始化为 NULL，请定位首次非法访问')
 bg=box(s,.65,3,8,2.8,'ink');q=tx(s,1.25,3.3,7.05,2.35,'typedef struct { int value; } Node;\nNode *p = NULL;\np->value = 42;\nprintf("%d", p->value);\nreturn 0;',21,'white',font='Consolas');tree=s.shapes._spTree;tree.remove(bg._element);tree.insert(2,bg._element);tree.remove(q._element);tree.insert(3,q._element)
 tx(s,.83,3.3,.35,2.35,'1\n2\n3\n4\n5',21,'white',font='Consolas');card(s,9,3,3.6,2.8,'三个不同问题','NULL 赋值合法\n首次解引用才失效\n越界须另查对象范围');tx(s,.8,6.2,11.8,.6,'头文件已包含，片段位于 main；传入指针只复制地址，不自动分配结构体对象。',18,'green');s.notes_slide.notes_text_frame.text='step-fault@1：第3行首次解引用空指针，产生未定义行为，不保证崩溃。第2行初始化本身合法。本例不是未初始化指针或数组越界。'
 s=slide(d,'Gilbert Strang：四个基本子空间','A ∈ Rᵐˣⁿ，秩为 r；Ax=0 只有零解意味着列满秩，不意味着矩阵必为方阵')
 table(s,[['基本子空间','所在空间','维数'],['列空间 C(A)','Rᵐ','r'],['行空间 C(Aᵀ)','Rⁿ','r'],['零空间 N(A)','Rⁿ','n−r'],['左零空间 N(Aᵀ)','Rᵐ','m−r']]);tx(s,.85,6.35,11.5,.5,'反例：A=[1 0; 0 1; 0 0]，r=n=2，但 r≠m=3。',22,'green',True)
 s=slide(d,'傅里叶变换尺度性质：高斯波包','采用 F(ω)=∫ f(x)exp(−iωx)dx；时宽按 1/√a 缩小，频宽按 √a 展宽')
 tx(s,.75,2.95,5.8,1.1,'f(x)=exp(-a*x^2)\nF(ω)=√(π/a) exp(−ω²/4a)',23,'blue',True);xs=[-5+i*.1 for i in range(101)]
 chart(s,.65,4.05,5.9,2.5,[(f'时域 a={a}',[(x,exp(-a*x*x)) for x in xs]) for a in [1,4]],-5,5,0,1.1);chart(s,6.8,3,5.85,3.55,[(f'频域 a={a}',[(x,sqrt(pi/a)*exp(-x*x/(4*a))) for x in xs]) for a in [1,4]],-5,5,0,2)
 s=slide(d,'本章核心概念自检与跨课联系','从“会套公式”转为“能说出成立条件，并构造一个反例”');cards(s,[('程序执行','p非空是否充分？还须检查对象生命周期与访问范围。'),('线性映射','n−r=0说明什么？给出一个列满秩的非方阵。'),('尺度检验','a变为4a后，两域特征宽度分别乘以多少？')]);save(d,'01-C语言指针与线性代数空间精讲.pptx')
 d=deck('光电调制与探测链路精选',5,'光电学院专业课')
 s=slide(d,'高速相干光通信：发射与探测链路','从驱动电压到复光场，再到电信号；各环节都有独立的适用条件')
 for i,label in enumerate(['激光源','IQ / MZM','光纤信道','光混合 + 本振','平衡探测 + TIA']):
  x=.65+i*2.54;box(s,x,3.25,2.15,1.2);tx(s,x+.12,3.62,1.91,.65,label,19,'blue',True)
  if i<4:arrow(s,x+2.16,3.85,x+2.5,3.85)
 card(s,.75,5,5.65,1.7,'调制端','干涉把相位差映射成幅度变化。');card(s,6.9,5,5.65,1.7,'接收端','相干接收需要本振与光混合。')
 s=slide(d,'非理想 MZM：传输曲线与消光比极限','两只理想 50:50 耦合器，一臂额外功率损耗 loss；T=10^(−loss/10)')
 q=tx(s,.75,2.95,5.65,1.9,'P(x)=(1+t+2*sqrt(t)*cos(x))/4\nt = 10^(−loss/10)\nER = [(1+√T)/(1−√T)]²',21,'blue',True);tree=s.shapes._spTree;tree.remove(q._element);tree.insert(2,q._element)
 tx(s,.8,5.35,5.5,1.3,'loss=3 dB → ER≈15.34 dB\n偏置平移曲线，不能修复振幅失衡。',20,'green',True);xx=list(range(0,361,5));t=10**(-.3);chart(s,6.65,3,6,3.6,[('理想',[(x,(1+cos(x*pi/180))/2) for x in xx]),('单臂3 dB',[(x,(1+t+2*sqrt(t)*cos(x*pi/180))/4) for x in xx])],0,360,0,1)
 s=slide(d,'光电探测前级：一阶 RC 初值连续性','4 步推导含一处跳步陷阱；等效阶跃模型省略运放与高阶寄生参数')
 for i,line in enumerate(['1. t<0 时 Vc=2 V；t=0 后接入 5 V 阶跃。','2. RC·dVc/dt+Vc=5，通解 Vc=5+K·exp(−t/RC)。','3. 输入跳变，所以 Vc(0+)=0，K=−5。','4. 因此 Vc(t)=5−5·exp(−t/RC)。']):box(s,.75,3+i*.69,11.8,.57);tx(s,.95,3.08+i*.69,11.4,.45,line,20)
 tx(s,.85,6.2,11.6,.55,'验证：电容电压连续性 → 积分常数 → 初值 / 终值 / 单位 / 时间常数。',19,'green',True);s.notes_slide.notes_text_frame.text='第3步首次错误：有限电流下Vc(0+)=2 V，K=−3。'
 s=slide(d,'薄膜铌酸锂 TFLN：VπL 与带宽折中','辨析：降低半波电压或延长电极，不能保证电光带宽同步提高')
 table(s,[['设计变量','可能收益','须检查的代价'],['增强光电重叠','降低 VπL','光损耗、金属吸收'],['延长行波电极','降低 Vπ','微波衰减、速度失配'],['优化电极阻抗','减小反射','工艺约束、驱动匹配']]);tx(s,.85,6.35,11.5,.5,'两款器件 VπL 相同，是否必然有相同的 3 dB 带宽？还缺哪些测量？',20,'green',True)
 s=slide(d,'链路工程设计避坑清单','把局部器件指标还原成链路可测量的约束');cards(s,[('振幅与功率','功率衰减转成场振幅时开平方；损耗dB不等于ER。'),('初值与动态','先确认储能状态，再求积分常数；用边界值检验解。'),('效率与频响','联合评估VπL、带宽、插损、驱动与接收噪声。')]);save(d,'02-光电调制与探测链路精选.pptx')
 d=deck('人工智能与工程伦理导论研讨',4,'百人通识 / 导论大班')
 s=slide(d,'百人大课破冰：当 AI 遭遇边界样本','医疗辅助诊断与自动驾驶：哪一步判断交给机器？以下数据为虚构教学情境')
 card(s,.75,3.1,5.65,2.9,'医疗辅助诊断','总体准确率96%，罕见病例子群78%。\n人工复核增加2分钟；谁承担漏诊后果？');card(s,6.9,3.1,5.65,2.9,'自动驾驶','常规路况可靠，施工临时标志含糊。\n接管窗口缩短；怎样分配控制权？');tx(s,.85,6.35,11.5,.5,'先独立选择，再给出可质询的理由；不以人数多少代替证据。',21,'green',True)
 s=slide(d,'高风险 AI：决策权如何分配？','多维权衡：效率、可解释性与责任归属；方案偏好无唯一标准答案')
 table(s,[['方案','可能收益','风险 / 责任'],['全部自动化','响应快、成本低','子群风险与申诉困难'],['分级人工复核','兼顾吞吐与高风险拦截','需设计阈值和责任边界'],['逐例人工决策','保留人工决策权','延迟与自动化偏见']]);tx(s,.85,6.2,11.5,.65,'AI 辩友：“总体96%，所有患者必然获益，应取消复核。”\n质询：78%的子群表现是否支持“所有患者”？',17,'rose',True)
 s=slide(d,'数据脱敏：“匿名化即绝对安全”吗？','概念辨析：删除直接标识符，只是风险控制的一环');cards(s,[('删除姓名','仍须核对时间、位置与罕见诊断等准标识符。'),('关联识别','准标识符组合，可能与外部数据重新关联。'),('使用边界','按目的最小化数据，评估权限、粒度与攻击模型。')]);tx(s,.85,6.35,11.6,.5,'自检：加密存储、模型可解释性、匿名性是否是同一个性质？',22,'green',True)
 s=slide(d,'研讨共识沉淀与行动准则','把本轮选择写成可执行、可审计、可申诉的规则');table(s,[['议题','行动准则','需补充的证据'],['适用边界','高风险人工接管条件','子群性能、失效样本'],['责任归属','记录版本与复核责任','可追溯决策日志'],['数据使用','目的限定与最小化','关联攻击风险评估'],['课堂回看','基于新证据改答','两轮理由与选择变化']]);save(d,'03-人工智能与工程伦理导论研讨.pptx')
if __name__=='__main__':build()
