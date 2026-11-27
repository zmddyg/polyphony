// Original teaching material, aligned to the requested HUST chapter outline.
// The English datasets below are deliberately synthetic, not attributed research.
import { blockText } from '../dist/core/lecture-score.mjs';
export { blockText } from '../dist/core/lecture-score.mjs';
const table=(title,headers,rows)=>({type:'table',title,headers,rows});
const note=(title,text,tone='note')=>({type:'callout',title,text,tone});
const code=(title,code)=>({type:'code',title,language:'c',code});
const pair=(left,right)=>({type:'code-pair',left,right});
const formula=(title,...items)=>({type:'formula',title,items});
const tex=String.raw;
const diagram=(title,nodes,edges)=>({type:'diagram',title,kind:'flow',direction:'LR',nodes,edges});
const bullets=(title,...items)=>({type:'bullets',title,items});
const branches=(a,b)=>[
  {id:'mechanism',title:a,description:'逐项展开本页机制，用原页条件检验首轮理由。',revisionPrompt:'依据本页机制重新判断，写出支持你判断的具体条件。'},
  {id:'counterexample',title:b,description:'构造一个边界反例，检查哪些结论需要附加条件。',revisionPrompt:'用反例检验后改答，并指出原判断遗漏的条件。'},
];
function concept(id,title,prompt,options,correct,summary,pitfall,reasons,recapFormula) {
  return {id,activityId:'concept-diagnosis@1',title,subject:'大学课堂 · 双轮机制诊断',description:'先独立判断，再用证据修订。',prompt,
    options:options.map((label,i)=>({id:String.fromCharCode(65+i),label})),correctOptionId:correct,
    moduleConfig:{quickReasons:reasons,takeaway:{summary,pitfall,...(recapFormula&&{formula:recapFormula})}},branches:branches('展开机制与状态','检查边界与反例')};
}
function fault(id,title,prompt,lines,faultIndex,diagnosis,lang='code') {
  const steps=lines.map((content,i)=>({id:'S'+(i+1),line:String(i+1),content}));
  return {id,activityId:'step-fault@1',title,subject:'逐行推理审计',description:'定位首次不成立的步骤。',prompt,
    options:steps.map(s=>({id:s.id,label:'第 '+s.line+' 行 / 步'})),correctOptionId:steps[faultIndex].id,
    moduleConfig:{artifactTitle:title,artifactLang:lang,steps,faultStepId:steps[faultIndex].id,faultDiagnosis:diagnosis,
      quickReasons:lang==='code'?['定义指针本身已出错','首次解引用时没有有效对象','只交换局部副本，不改变实参']:['这一步改变了物理量的含义','数据并未支持这个因果推断','后续代数正确，但前提已错'],
      takeaway:{summary:diagnosis,pitfall:'找首次无效步骤；后续结果错误未必是第一处错误。'}},branches:branches('逐步追踪对象与量纲','比较错误推导和正确推导')};
}
const pointerSize=concept('c-stride','指针自身大小与所指对象步长','假定本课堂 ABI：指针均为 8B，int 为 4B，double 为 8B。p、q 分别指向对应数组中的有效元素且可前进。哪组数值正确？',
  ['sizeof(p)=8，sizeof(q)=8；p+1 偏移4B，q+1 偏移8B','二者均为8B，因此 p+1、q+1 都偏移8B','sizeof(p)=4，sizeof(q)=8；步长与变量名字有关','p+1 只增加1B，q+1 也只增加1B'],'A',
  'sizeof(指针)由 ABI 决定；p+1 的步长是 sizeof(*p)。','64位不由 C 标准保证所有指针均8B；不能对未初始化指针做算术。',
  ['步长由所指对象的基类型决定','指针存地址，8B就是所有算术步长','加1就是加一个字节'],
  tex`\text{相邻元素的字节间隔}=\operatorname{sizeof}(*p)`);
const swapBugLines=['void swap_bug(int *px, int *py)', '{', '    int *temp = NULL;', '    *temp = *px;', '    *px = *py;', '    *py = *temp;', '}'];
const swapBug=fault('c-swap-bug','swap_bug：首次无效操作在哪里？','假设 px、py 均指向有效 int。点击首次出现未定义行为的代码行，再选一个机制理由。',swapBugLines,3,
  '第4行 *temp = *px 首次解引用空指针。第3行定义并初始化空指针合法；改为 int temp = *px，再用 temp 保存整数值。');
const finalC=concept('c-final','二维寻址与后置自增','int a[2][3]={{1,3,5},{7,9,11}}; int *p=&a[0][0];\n先独立执行 int x=*(*(a+1)+1); 再执行 int y=*p++; x、y 与执行后 p 的指向分别是什么？',
  ['x=9，y=1，p 指向 a[0][1]','x=7，y=3，p 指向 a[0][1]','x=9，y=3，a[0][0] 变成2','x=5，y=1，p 指向 a[1][0]'],'A',
  'a+1 前进一整行；*(*(a+1)+1)=a[1][1]=9。*p++ 取旧地址的1，再将 p 前进一个 int。','把求值拆成两条语句；不要在一个 printf 中读取并修改同一个 p。',
  ['行指针先定位行，元素指针再定位列','后置++先把内容加一','所有地址加一都跳到下一行']);
const cPages=[
  ['第6章 指针导引：C 语言的灵魂与读程分水岭',[
    table('为什么需要指针？',['能力','直接收益','必须承担的约束'],[['间接访问','从地址定位对象','先有有效对象，再解引用'],['函数修改实参','通过地址改变调用者数据','形参仍是指针值的副本'],['数组高效遍历','统一元素寻址与迭代','限制在同一数组内'],['动态数据结构','按需分配链表、树与缓冲区','对象生存期与释放配对'],['共享与系统接口','减少大对象复制，访问底层数据','别名、const 与边界设计']]),
    note('本课闭卷检验','能解释地址与内容、能展开四种 ++ 表达式、能修复 swap、能写出原地逆序。','success'),
  ],'先抛出交换两个变量的任务，请大家说清函数里的赋值最终写进哪个对象。把对象、地址和生存期作为全章读程的三项检查。'],
  ['6.1 内存字节编址：地址与内容',[
    table('示意地址：非实机布局，不保证相邻变量排列',['起始地址','定义','内容','对象大小（本例）'],[['0x0B34E0','int a = 3','3','4 B'],['0x0B34E4',"char k1 = 'a'","'a' / 编码值","1 B"],['0x0B34E8','float f1 = 3.14159f','近似 3.14159','4 B']]),
    table('变量的五个基本特征',['特征','以 a 为例'],[['存储期','示例为块内自动对象（auto）'],['数据类型','int'],['变量名','a'],['内容','3，可被赋值修改'],['地址','&a，类型为 int *']]),
    note('字节编址','本例每个地址标识一个字节。C 规定 sizeof(char) 为 1，字节的位数由 CHAR_BIT 给出。打印地址用 printf("%p", (void *)&a)。'),
  ],'沿地址列指出 a 的起点和四字节范围，追问赋值 a=7 会改变哪一栏。提醒学生地址与对象大小是这里设定的示意条件。'],
  ['6.2 直接访问与间接访问',[
    code('同一个 int 对象，三条访问路径','int a = 3;\nint *p = &a;\n*p = 7;\nprintf("%d %d %d\\n", a, *(&a), *p); // 7 7 7'),
    table('名字 → 地址 → 对象',['表达式','类型','语义'],[['a','int','直接访问 a 的内容'],['&a','int *','取得 a 的地址'],['p','int *','保存 a 的地址'],['*p','int 左值','间接访问 a'],['*(&a)','int 左值','与 a 指定同一对象']]),
    note('NULL 与野指针','NULL 明确表示“不指向对象”，可以比较、不可解引用。未初始化自动指针是未确定值，连读取和比较都可能出问题。','warning'),
  ],'指着同一个 a 依次读 a、*(&a)、*p，请学生在对象框里执行 *p=7 后再预测三个输出。换成 NULL，让他们先指认有效对象再作答。'],
  ['6.2 指针基类型与算术步长辨析',[
    code('先初始化，再讨论 p+1','int a[3] = {3, 4, 5};\ndouble b[3] = {1.0, 2.0, 3.0};\nint *p = a;\ndouble *q = b;'),
    formula('在同一数组内前进一步',tex`\operatorname{sizeof}(p)=\operatorname{sizeof}(q)=8\,\text{B}`,
      tex`\operatorname{sizeof}(*p)=4\,\text{B},\quad \operatorname{sizeof}(*q)=8\,\text{B}`),
    note('本页 ABI 假设','这里指定了指针和元素的大小。p+1、q+1 各前进一个元素，字节距离由对应元素的类型决定。'),
  ],'请学生先给指针变量和数组元素分别写下类型，再作首轮判断。公布后用“同为 8 B 的指针，步长却不同”检查理由是否抓住基类型。',pointerSize],
  ['6.3 闭卷必考：指针与 ++ / -- 优先级',[
    table('每一行以 p 指向 arr[0] 独立开始',['表达式','等价机制','返回值','结束状态'],[['*p++','*(p++)；先取旧地址','10','p→arr[1]，arr不变'],['*++p','*(++p)；先前进','20','p→arr[1]，arr不变'],['(*p)++','对所指整数后置自增','10','p不变，arr[0]=11'],['++(*p)','对所指整数前置自增','11','p不变，arr[0]=11']]),
    table('连续执行的8行状态追踪',['行','语句','输出 / 状态'],[['1','int arr[]={10,20,30,40};','arr=[10,20,30,40]'],['2','int *p=arr;','p→arr[0]'],['3','int x=*p++;','x=10，p→arr[1]'],['4','int y=(*p)++;','y=20，arr[1]=21'],['5','int z=*++p;','z=30，p→arr[2]'],['6','int w=++(*p);','w=31，arr[2]=31'],['7','printf("%d %d %d %d",x,y,z,w);','10 20 30 31'],['8','printf("%d", *p);','31']]),
  ],'先把 *p++ 写成 *(p++)，再请大家用两列记录表达式的值和整条语句结束时的状态。顺着第二张表逐行更新上一步留下的 p 与数组。'],
  ['6.5 函数参数传递：值的副本与地址的副本',[
    pair(code('swap_wrong：只改局部形参','void swap_wrong(int x, int y) {\n    int temp = x;\n    x = y;\n    y = temp;\n}\n// 调用：swap_wrong(a, b);\n// 返回：a、b 没变'),code('swap_ok：用地址访问调用者对象','void swap_ok(int *x, int *y) {\n    int temp = *x;\n    *x = *y;\n    *y = temp;\n}\n// 调用：swap_ok(&a, &b);\n// 返回：a、b 已交换')),
    diagram('函数调用与对象访问（栈帧示意）',[
      {id:'caller',label:'调用者的 a、b',sub:'实参为 &a、&b',tone:'primary'},
      {id:'callee',label:'函数帧的 x、y',sub:'保存两个地址值',tone:'neutral'},
      {id:'write',label:'写回调用者对象',sub:'*x=*y，再 *y=temp',tone:'accent'},
    ],[{from:'caller',to:'callee',label:'复制地址'},{from:'callee',to:'write',label:'解引用'}]),
    table('跨调用边界发生了什么',['位置','传 int','传 int *'],[['调用时','复制 a、b 的数值','复制 &a、&b 两个地址'],['函数内','x、y 是独立局部对象','*x、*y 指定调用者对象'],['返回后','局部形参生存期结束','写入 a、b 的修改仍存在']]),
  ],'沿图追踪形参 x 中的地址副本，分别圈出 x 和 *x 的赋值目标。删去函数帧后请大家预计 a、b 的值，说明 C 的按值传参与栈帧示意各在解释什么。'],
  ['实战排错：指针交换与空指针解引用',[
    code('有意保留错误的完整7行函数',swapBugLines.join('\n')),
    note('输入契约','调用者已传入两个有效 int 的地址，NULL 由 <stddef.h> 提供。审计临时量及其所指对象。'),
    note('修复目标','写入两个原对象以交换数据。判断程序最早在哪一行访问了无效对象。','warning'),
  ],'先让学生独立点选第一处无效操作，收集“定义就错”和“解引用才错”两类理由。再追问临时量究竟需要保存地址还是整数值。',swapBug],
  ['6.7.1 一维数组等价寻址与形参退化',[
    table('条件：p=a，0≤i<n，且元素有效',['表达式','展开','对象'],[['a[i]','*(a+i)','第 i 个 int'],['*(a+i)','*(首地址+i)','第 i 个 int'],['*(p+i)','*(p 的值+i)','第 i 个 int'],['p[i]','*(p+i)','第 i 个 int']]),
    pair(code('调用者中是真数组','int a[10];\nsize_t n = sizeof(a)/sizeof(a[0]);\n// n=10\ninv(a, (int)n);'),code('参数声明会被调整','void inv(int x[], int n) {\n    // x 的参数类型实际是 int *\n    // sizeof(x) 是指针大小\n    // 必须单独传入长度 n\n}')),
    note('区分数组名与指针变量','a++ 不合法。p++ 受数组范围约束，尾后指针可以形成但不可解引用。a 转为首元素指针，&a 指向整个数组。','warning'),
  ],'在两个代码框中各圈出 sizeof 的操作数，叫学生先说出它的类型，再决定能不能求得元素个数。拿 a+i 和 p+i 对照，指出它们何时访问同一个元素。'],
  ['例6.7.2 完整工程实例：数组原地逆序',[
    pair(code('main.c · 与右栏合并即可编译','#include <stdio.h>\nvoid inv(int x[], int n);\nint main(void) {\n    int a[10]={3,7,9,11,0,6,7,5,4,2};\n    for(int k=0;k<10;k++) printf("%d ",a[k]);\n    puts("");\n    inv(a,10);\n    for(int k=0;k<10;k++) printf("%d ",a[k]);\n    puts("");\n    return 0;\n}'),code('inv · 双指针向中点收缩','void inv(int x[], int n) {\n    if (n <= 1) return;\n    int *i=x, *j=x+n-1;\n    int *p=x+(n-1)/2;\n    for (; i<=p && i<j; ++i,--j) {\n        int temp=*i;\n        *i=*j;\n        *j=temp;\n    }\n}')),
    note('输出与循环不变量','逆序后：2 4 5 7 6 0 11 9 7 3。每轮将最外侧未归位的一对元素放到最终位置；O(n) 时间，O(1) 辅助空间。','success'),
  ],'现场手推第一轮，把已经归位的外侧元素从待处理区划掉。请学生分别用 n=0、n=5、n=6 检查提前返回、中间元素与结束条件。'],
  ['6.7.2 二维数组传参：行指针与指针数组',[
    table('先看括号，再看 []：二者不能互换',['声明','原始含义','作为函数参数时'],[['int (*array)[10]','指向含10个int的数组的指针','仍为 int (*)[10]'],['int *array[10]','含10个 int* 元素的数组','调整为 int **'],['int a[2][10]','连续存储的两行数组','a 转为首行指针 int (*)[10]']]),
    pair(code('连续二维数组：整行步长','void Func(int (*array)[10]) {\n    array[1][2] = 42;\n}\nint a[2][10] = {{0}};\n// Func(a); // 类型匹配'),code('行地址表：各行可独立存储','void FuncRows(int *array[10]) {\n    array[1][2] = 42;\n}\nint r0[10]={0}, r1[10]={0};\nint *rows[2]={r0,r1};\n// FuncRows(rows);')),
    formula('连续二维数组的整行跨度',tex`\operatorname{sizeof}(a[0])=10\,\operatorname{sizeof}(a[0][0])`),
    note('sizeof 与行跨度','array+1 在左栏跨10个int；右栏跨一个int*。int** 不携带固定行宽，强制转换不能修复布局差异。','warning'),
  ],'让学生在黑板画出连续两行和两格行地址表，然后各走一次 array+1。对比解引用后的类型，解释为何 int ** 不能接收连续二维数组。'],
  ['期末闭卷综合读程：二维寻址 × 后置自增',[
    code('顺序明确，逐句执行','int a[2][3]={{1,3,5},{7,9,11}};\nint *p=&a[0][0];\nint x=*(*(a+1)+1);\nint y=*p++;\nprintf("%d %d\\n", x, y);'),
    table('先辨类型，再计算',['表达式','类型 / 步长'],[['a+1','指向第二行；跨3个int'],['*(a+1)+1','第二行中前进一个int'],['*p++','*(p++)；使用旧指针值']]),
    note('标准边界','这里 p 只在首行内前进；不要据此用 int* 跨越二维数组的各个子数组边界遍历。'),
  ],'首轮要求依次写下 a+1 的类型、*(a+1)+1 的位置和 *p++ 用的是哪个地址。二轮只让学生改动前一次推导中具体出错的一步。',finalC],
  ['第6章核心考点速查与编程规范',[
    table('闭卷检查表',['遇到的问题','最短可靠方法','常见失分点'],[['地址与内容','画对象表，标出 p 与 *p','把地址当内容、误认 NULL 定义非法'],['指针算术','先定基类型，再算字节步长','sizeof(p) 误当 sizeof(*p)'],['++ 与 *','先加括号，再拆成有顺序的语句','未定序读写、越界解引用'],['swap / 函数','传值副本；用 *p 访问原对象','把“传址”误解为引用传递'],['数组参数','调用处求长度，n独立传入','形参 sizeof(x) 当整数组'],['二维数组','区分 int (*)[N] 与 int **','类型强转掩盖行布局不兼容']]),
    note('提交前规范','指针先初始化；每次解引用核对有效性、边界与生存期；地址用 %p；保持 const 正确；用编译器警告与地址检查工具辅助。','success'),
  ],'请每人从速查卡选一条自己曾漏掉的边界，写成下次读程前会问的问题。收束时把未初始化、尾后和生存期结束的对象分别复述一遍。'],
];
const er=fault('optics-er','不等损耗双臂干涉：ER 推导审计','输入50:50分束与合束、两臂原先等强，仅第二臂多3dB功率损耗。哪一步首次混淆功率与振幅？',[
  '第二臂功率透射率 T₂=10^(−3/10)≈0.5（取3dB≈一半）。',
  '将第二臂振幅透射率写成 t₂=T₂=0.5。',
  '归一化 I(Δφ)=(1+t₂²+2t₂ cosΔφ)/4。',
  'Imax=(1+t₂)²/4；Imin=(1−t₂)²/4。',
  'ER=10log₁₀(Imax/Imin)=10log₁₀(9)≈9.5dB。',
],1,'第2步错误：t₂=√T₂≈0.707；ER=[(1+√0.5)/(1−√0.5)]²≈33.97，即15.31dB。严格3.00dB对应T₂≈0.5012，ER≈15.34dB。','math');
const diffraction={id:'optics-diffraction',activityId:'param-explorer@1',title:'单缝包络与多缝干涉因子',subject:'夫琅禾费衍射',description:'有限余弦和消除光栅因子的0/0奇点。',
  prompt:'固定缝距d，令 x=d sinθ/λ、r=a/d。增大缝宽比 r 时，单缝包络第一暗纹怎样变化？N取整数，对比2、4、6缝。',
  options:[{id:'A',label:'第一暗纹向中心靠近，包络变窄'},{id:'B',label:'第一暗纹远离中心，包络变宽'},{id:'C',label:'改变N才会移动包络第一暗纹'}],correctOptionId:'A',
  moduleConfig:{quickReasons:['首暗纹 r*x=±1，故 |x|=1/r','缝越宽，衍射角越大','N增大改变包络宽度'],takeaway:{
    formula:tex`\lvert x_{\mathrm{dark},1}\rvert=\frac{1}{r},\quad x=\frac{d\sin\theta}{\lambda},\quad r=\frac{a}{d}`,
    summary:'固定 d、λ 时，第一包络暗纹满足 |x|=1/r。增加 N 会收窄阵列因子的主峰。',pitfall:'缺级须同时满足 d sinθ=mλ、a sinθ=qλ，且 q≠0。'},
    formulaDisplay:tex`\frac{I}{I_0}=\operatorname{sinc}^2(\pi r x)\left[\frac{\sin(N\pi x)}{N\sin(\pi x)}\right]^2`,
    xAxis:{symbol:'x',label:'x = d sinθ / λ',min:-3,max:3},yAxis:{label:'归一化光强 I / I₀',min:0,max:1.05},
    sliders:[{symbol:'r',label:'缝宽比 a/d',min:0.2,max:0.9,step:0.05,defaultValue:0.5},{symbol:'N',label:'缝数 N（整数）',min:2,max:6,step:1,defaultValue:4}],
    curves:[{label:'衍射包络',expr:'sinc(r*x)^2'},{label:'多缝强度',expr:'sinc(r*x)^2*(N+2*((N-1)*cos(2*pi*x)+max(N-2,0)*cos(4*pi*x)+max(N-3,0)*cos(6*pi*x)+max(N-4,0)*cos(8*pi*x)+max(N-5,0)*cos(10*pi*x)))/N^2'}],
    insightNote:'公式用 sinc(u)=sin(u)/u。引擎用归一化 sinc(z)=sin(πz)/(πz) 及有限余弦和，整数 x 处直接取正确极限。r=0.5 时，非零偶数级缺级。'},branches:branches('用第一零点解释包络','对比N与缝宽的独立作用')};
const harmonic=concept('optics-harmonic','谷底偏置：二倍频的机制','理想平衡MZM在谷底 φ₀=π，小信号相移 m cosΩt，平方律探测。为什么交流输出的最低阶是2Ω？',
  ['传输在谷底关于相移为偶函数；二次项 cos²Ωt 含2Ω','光电二极管只保留正半周，所以削波整流','相位改变了载波光频两倍，因此直接读出2Ω','电极把输入电信号频率自动乘二'],'A',
  'I/Iin≈m²(1+cos2Ωt)/8：去掉直流后最低阶为2Ω。','“纯二倍频”只在理想小信号最低阶成立；较大m有4Ω等偶次谐波，偏置误差会引入基频。',
  ['偶函数二次项与 cos² 恒等式','二极管削掉负半周','倍频来自电极长度增加'],
  tex`\frac{I_A}{I_{\mathrm{in}}}\approx\frac{m^2}{8}[1+\cos(2\Omega t)]`);
const opticsPages=[
  ['从复振幅叠加到高速片上电光调制',[
    {type:'steps',title:'一条物理链路',items:['复振幅：把振幅与相位装进一个量','相干叠加：交叉项让光强依赖相位差','孔径积分：单缝包络 × 多缝干涉因子','电光效应：电压调相位，干涉把相位变成功率','探测与读出：平方律、RC与行波匹配决定带宽']},
    formula('固定相位与传播方向的约定',
      tex`U(P,t)=A(P)\cos[\omega t-\varphi(P)],\quad \tilde{U}(P)=A(P)e^{i\varphi(P)}`,
      tex`U(P,t)=\Re\!\left\{\tilde{U}(P)e^{-i\omega t}\right\},\quad \tilde{U}(\mathbf{r})=U_0 e^{+i\mathbf{k}\cdot\mathbf{r}}`),
  ],'把时间因子先写在黑板右侧，请学生沿波矢方向追踪等相位面。保留同一符号约定，再依次问狭缝与调制器各在哪一步改变相位。'],
  ['1.1 单色光波复振幅与相干叠加',[
    diagram('相干叠加与平方律读出',[
      {id:'arm1',label:'光束 1',sub:'复振幅 Ũ₁',tone:'primary'},
      {id:'arm2',label:'光束 2',sub:'复振幅 Ũ₂',tone:'primary'},
      {id:'field',label:'同点复振幅相加',sub:'Ũ = Ũ₁ + Ũ₂',tone:'neutral'},
      {id:'power',label:'取模平方',sub:'强度含相位交叉项',tone:'accent'},
    ],[{from:'arm1',to:'field'},{from:'arm2',to:'field'},{from:'field',to:'power'}]),
    formula('同频、同偏振的标量模型',
      tex`I(P)=\tilde{U}^{*}(P)\tilde{U}(P)=A^2(P)`,
      tex`I=I_1+I_2+2\sqrt{I_1 I_2}\cos\Delta\varphi,\quad \Delta\varphi=\varphi_2-\varphi_1`,
      tex`V=\frac{2\sqrt{I_1 I_2}}{I_1+I_2}\le 1`),
    note('干涉的观测条件','同频相干、同点重合且偏振有重合分量。两束强度相同时条纹可见度最大。本讲的强度吸收了共同的介质比例常数。'),
  ],'沿图强调先加复振幅再取模平方，展开时让学生指出产生余弦项的两项。把两束相位差改成 π，追问两束各自发亮时为何能得到暗点。'],
  ['推导找茬：3dB 单臂损耗与静态消光比',[
    formula('审计的起点',
      tex`T_2=\frac{P_{2,\mathrm{out}}}{P_{2,\mathrm{in}}}\approx 0.5,\quad t_2=\left|\frac{\tilde{U}_{2,\mathrm{out}}}{\tilde{U}_{2,\mathrm{in}}}\right|`,
      tex`\mathrm{ER}=\frac{I_{\mathrm{max}}}{I_{\mathrm{min}}},\quad \mathrm{ER}_{\mathrm{dB}}=10\log_{10}(\mathrm{ER})`),
    note('请先独立审计右侧 5 步','前提是理想相干、等比分束与合束，只有一臂有额外损耗。每一步先核对量的定义，再检查代数。'),
  ],'让学生给 3 dB 所描述的量贴上功率或振幅标签，再挑出发生偷换的第一步。用“功率约减半，场振幅仍约七成”复核暗端残余。',er],
  ['夫琅禾费单缝衍射与多缝光栅方程',[
    formula('远场相干孔径积分',
      tex`\tilde{U}(\theta)\propto\int_{-a/2}^{a/2} e^{-iky\sin\theta}\,\mathrm{d}y=a\operatorname{sinc}(\beta)`,
      tex`\beta=\frac{\pi a\sin\theta}{\lambda},\quad \gamma=\frac{\pi d\sin\theta}{\lambda},\quad \operatorname{sinc}(u)=\frac{\sin u}{u}`,
      tex`\frac{I(\theta)}{I(0)}=\operatorname{sinc}^2(\beta)\frac{\sin^2(N\gamma)}{N^2\sin^2\gamma}`),
    table('包络与阵列的特征位置',['类型','条件','物理图像'],[['单缝暗纹','a sinθ=qλ，q=±1,±2,…','半波带两两抵消'],['阵列主极大','d sinθ=mλ','各缝同相，归一化阵列因子极限为 1'],['阵列零点','Nγ=ℓπ，γ 不是整数 π','有限阵列相消'],['缺级','m/d=q/a，q≠0','阵列主极大恰落在包络暗纹']]),
    note('适用边界','单色平面波正入射，等宽等距且等照明，观测于远场或透镜焦平面。传播相位 +kR 中，路径差近似 −y sinθ，且 |sinθ|≤1。'),
  ],'先让学生从路程近似 R−y sinθ 找出孔径积分的负号。再用两组相位匹配条件检验某级条纹是否缺失，并让他们解释 γ 为整数 π 时该取何种极限。'],
  ['页内公式沙盒：包络宽度、主极大与缺级',[
    formula('横坐标与两把标尺',
      tex`x=\frac{d\sin\theta}{\lambda},\quad r=\frac{a}{d}`,tex`\beta=\pi rx,\quad \gamma=\pi x`),
    table('独立改动一个参数',['操作','需要观察的位置'],[['r：0.40→0.50','包络首个零点离中心多远'],['N：2→4→6','阵列因子的中心主峰宽度'],['r=0.50，查看 x=2','阵列主极大附近的总光强']]),
  ],'先在 r=0.50、N=4 锁定对照，再分别只调 r 和 N，让学生指认暗纹位置与峰宽各随哪个量改变。用 x=2 检验对缺级的解释。',diffraction],
  ['MZM：电压 → 相位 → 输出功率',[
    diagram('电光驱动到输出端的传递链',[
      {id:'drive',label:'驱动电压 V',sub:'电极建立电场',tone:'primary'},
      {id:'arms',label:'两臂折射率变化',sub:'推挽时相移相反',tone:'neutral'},
      {id:'phase',label:'累积差分相移',sub:'Δφ = φ₂ − φ₁',tone:'neutral'},
      {id:'combine',label:'合束与功率读出',sub:'A 口在 Δφ=0 时最亮',tone:'accent'},
    ],[{from:'drive',to:'arms'},{from:'arms',to:'phase'},{from:'phase',to:'combine'}]),
    formula('相移定义与理想平衡输出',
      tex`\delta n_j\approx-\frac{1}{2}n_j^3 r_{\mathrm{eff}} E_j,\quad \delta\varphi_j=\frac{2\pi L}{\lambda_0}\delta n_j`,
      tex`\Delta\varphi=\Delta\varphi_0+\delta\varphi_2-\delta\varphi_1,\quad \frac{I_A}{I_{\mathrm{in}}}=\frac{1+\cos\Delta\varphi}{2}`),
    note('半波电压','λ₀ 为真空波长。在线性驱动区 Δφ=Δφ₀+πV/Vπ，Vπ 对应 π 的差分相移，报告 VπL 时需注明驱动接法。'),
  ],'从图中的单臂折射率变化推到两臂相减，明确推挽时两项为何同向贡献差分相移。请学生分别预测差分相位为 0 和 π 时 A 口的功率。'],
  ['直流偏置与小信号谐波展开',[
    formula('小信号差分相移与两种偏置',
      tex`\Delta\varphi(t)=\varphi_0+m\cos(\Omega t),\quad m\ll 1`,
      tex`\varphi_0=\frac{\pi}{2}:\quad \frac{I_A}{I_{\mathrm{in}}}\approx\frac12-\frac{m}{2}\cos(\Omega t)`,
      tex`\varphi_0=\pi:\quad \frac{I_A}{I_{\mathrm{in}}}\approx\frac{m^2}{8}[1+\cos(2\Omega t)]`),
    table('同一器件，两种用途',['偏置','最低阶交流项','用途 / 失真'],[['正交点','Ω，系数∝m','模拟线性调制；三阶项产生互调'],['谷底点','2Ω，系数∝m²','光子微波倍频；高阶有4Ω等'],['偏离谷底','重新出现Ω项','偏置漂移破坏基频抑制']]),
  ],'在功率传输曲线上标出正交点与谷底，请大家先看斜率，再决定泰勒展开从哪一阶开始。用同一个 m 比较两处输出的交流频率和量级。'],
  ['工程误区：谷底偏置为什么会二倍频？',[
    formula('半个驱动周期后相移扰动翻转',
      tex`\delta\varphi(t)=m\cos(\Omega t),\quad \delta\varphi\!\left(t+\frac{\pi}{\Omega}\right)=-\delta\varphi(t)`),
    note('检验机制','设读出端为理想线性功率读出，比较谷底两侧等幅相移对光强的影响，再判断最低阶交流项。'),
    note('适用条件','本题采用平衡双臂、谷底偏置和小信号近似。分析交流项时要去掉直流分量。','warning'),
  ],'公布首轮后，问同一驱动周期的正、负半周分别把工作点推到哪里。让学生对两侧等量偏移作比较，再用余弦平方恒等式说出最低阶频率。',harmonic],
  ['探测读出链路：RC 与 TFLN 行波速度匹配',[
    formula('两个可独立估算的带宽约束',
      tex`f_{\mathrm{RC}}\approx\frac{1}{2\pi R_{\mathrm{eq}}(C_j+C_{\mathrm{pad}}+C_{\mathrm{in}})}`,
      tex`\Delta\varphi_{\mathrm{RF}}\approx\frac{2\pi fL}{c}(n_m-n_g)`),
    table('指标无法单独优化',['改动','收益','代价 / 检查'],[['增大负载R','提高电压响应','RC带宽降低、噪声变化'],['缩小探测结面积','减小C_j','耦合容差、吸收效率'],['延长TFLN电极','降低驱动Vπ','微波损耗、失配累积'],['匹配n_m与n_g','减小走离','还需50Ω匹配与低衰减']]),
    note('研究讨论','VπL 很小不自动意味着带宽高。比较器件时同时列出波长、长度、驱动方式、插入损耗及3dB电光带宽。'),
  ],'先分开估算读出 RC 与调制器的走离：框出 R、C，再标出微波相位折射率和光群折射率。追问把电极加长后，驱动电压与高频响应各有什么变化。'],
  ['核心公式、符号约定与工程排障总表',[
    table('把公式与前提一起带走',['任务','核心关系','先排查'],[['复振幅','Ũ=Aeⁱφ；U=Re(Ũe⁻ⁱωt)','时间因子和相位符号一致'],['相干叠加','I=I₁+I₂+2√I₁I₂cosΔφ','偏振、相干性、归一化'],['损耗与ER','t=√T；ER=[(1+t)/(1−t)]²','功率dB用10log；振幅用20log'],['衍射 / 光栅','sinc²β × 阵列因子','中心极限、缺级、远场条件'],['MZM谐波','正交Ω；谷底最低阶2Ω','偏置、驱动幅度、高阶谐波'],['高速链路','RC + 传输线 + 渡越时间','不能拿一个指标代表全链路']]),
    note('阅读核对','复振幅符号按赵凯华、钟锡华《光学》的约定。远场衍射可对照 MIT 2.71 Optics 第 17 讲，调制谐波由本课的理想 MZM 传输式展开。','success'),
  ],'给出“暗端有残余、某一级缺失、谷底出现基频”三个观测，让学生各自配对一个排查条件。用一句话复述时间因子和正向空间因子的符号。'],
];
const hedge=concept('english-hedge','Hedging：结论强度与证据强度','Using the classroom survey in P2, which conclusion keeps the scope and uncertainty of the evidence?',
  ['The data suggest that social expectations may contribute to the observed group difference.','The survey proves that every member of group A shops more efficiently.','Biology alone determines all purchasing decisions.','These results demonstrate that group membership predicts individual ability with certainty.'],'A',
  'Use “suggest / may contribute to / in this sample” to calibrate a claim to observational evidence.','Hedging is evidence calibration, not adding “maybe” to an unsupported universal claim.',
  ['“may contribute” leaves room for alternative explanations','a large sample proves a universal claim','a group mean directly predicts each person']);
const ecology=fault('english-ecology','Critical Logic Check：生态谬误','Find the first inferential break. These are simulated classroom data, and group A/B are sample labels, not innate categories.',[
  'In the P2 sample, group A reported a lower average return rate than group B.',
  'The difference describes group averages in this sample.',
  'Therefore, every individual in group A has better decision-making ability than every individual in group B.',
  'Admissions committees should use group membership to rank individual applicants.',
  'No individual assessment or further evidence is necessary.',
],2,'Step3 commits an ecological fallacy: aggregate differences do not establish individual ability. Observational group comparisons also do not identify a causal mechanism.','flow');
const debate={id:'english-blind-review',activityId:'evidence-weighing@1',title:'Should anonymous blind review be mandatory?',subject:'Academic English · evidence-based seminar',description:'The AI peer is a deliberately partial classroom role, not an authority.',
  prompt:'Should anonymous blind review be mandatory in university admissions & hiring? Cite P2/P6, separate evidence from analogy, and name a cost or missing variable.',correctOptionId:null,
  options:[{id:'A',label:'Mandate it in the initial written screening stage'},{id:'B',label:'Pilot it with bias and cost audits before expansion'},{id:'C',label:'Keep identity visible but add independent bias audits'},{id:'D',label:'Decide by task; retain identity where context is essential'}],
  moduleConfig:{quickReasons:['P6 motivates a bias audit, but does not prove hiring effects','Administrative cost is relevant but not the only criterion','P2 group means cannot rank an individual applicant'],takeaway:{summary:'Claim → cited evidence → warrant → limitation → feasible policy.',pitfall:'P2/P6 are simulated studies from other domains; neither is causal proof that anonymization improves admissions.'},dimensions:['Bias & fairness','Administrative cost','Context & accountability'],
    aiPeer:{persona:'Blind-box AI peer · cost-only analyst',claim:'Blind review requires extra administration. Therefore universities should reject it everywhere; bias can be ignored because reviewers are professionals.',flawHint:'P6 raises a concern about representation and language patterns. Ask for effect sizes, causal identification and costs in the target setting; expose the omitted fairness criterion.'}},branches:branches('Compare policy costs with bias risks','Challenge transfer from reading data to hiring')};
const englishPages=[
  ['Unit 4 · Beyond Stereotypes',[
    bullets('Reading Empirical Studies Critically','Read: distinguish observations, explanations and generalizations.','Write: calibrate claims with hedging and precise collocations.','Debate: cite evidence, challenge the warrant, acknowledge a limitation.'),
    {type:'steps',title:'Flipped-classroom agenda',items:['Before class: annotate one claim and its evidence.','In class: independent vote → reason capsule → targeted discussion → revised answer.','After class: write a compare-and-contrast paragraph using the unlocked review cards.']},
    note('数据来源声明','本套为原创 Unit 4 主题研讨材料，不冒充某版教材原文。P2的2,000人、P6的10,287篇及全部统计值均为课堂模拟，用于练习读表和论证。','warning'),
  ],'先让两位学生读出同一句观察和解释，请全班找出哪一句可直接从表里看到。提醒今天所有数字都是供练习的模拟样本。'],
  ['Reading 1 · Consumer Behaviour: What Do the Data Say?',[
    table('Simulated survey · N=2,000 (A:1,000 / B:1,000)',['Measure','Group A','Group B','What it cannot establish'],[['Median time per purchase','24 min','31 min','Innate ability / causal mechanism'],['Compared ≥3 sellers','62%','49%','Quality of each comparison'],['Self-reported return rate','8%','12%','Population-wide individual ranking']]),
    bullets('Describe, then qualify','In this sample, the median time was seven minutes lower in group A.','The proportion comparing at least three sellers was 13 percentage points higher.','Self-report, sampling, product mix and income may affect these estimates.'),
    note('Evidence boundary','Invented teaching dataset. No confidence intervals or random assignment are supplied; do not claim causation or statistical significance.'),
  ],'用 Compared ≥3 sellers 那行练习读出 62% 与 49% 的差值，请学生用 percentage points 口述 13 个百分点。接着问比较次数能回答关于比较质量的什么问题。'],
  ['Competing Frameworks · Hypothesis Is Not Evidence',[
    table('Two explanations to investigate',['Question','Evolutionary hypothesis','Social conditioning'],[['Proposed mechanism','Inherited tendencies shaped by selection','Norms, roles, incentives and learning'],['Prediction needed','Specify a measurable, falsifiable pattern','Predict change across contexts or training'],['Confounders','Culture, income, task and measurement','Selection, prior experience, institutions'],['Evidence required','Independent tests beyond the P2 table','Longitudinal / experimental comparisons']]),
    note('A disciplined response','The observed pattern is consistent with more than one explanation. It does not, by itself, identify the causal mechanism.'),
    note('Do not naturalize a stereotype','Treat these as competing hypotheses to test, not settled conclusions about any gender or group.','warning'),
  ],'从同一组差异出发，请两组各写一个理论能够预测且可被推翻的结果。交换检查文化或收入变化时预测是否仍成立。'],
  ['Academic Writing · Hedging in Empirical Claims',[
    table('Match grammatical certainty to empirical support',['Overclaim','Calibrated version'],[['The study proves biology determines behaviour.','The pattern may be consistent with several mechanisms.'],['All members of A make better decisions.','Group A had a lower average return rate in this sample.'],['This always works.','The intervention may help under the stated conditions.']]),
    note('Your task','Read four candidate conclusions. Choose the one whose scope fits the table, then explain why the others overreach.'),
  ],'投票前把 in this sample 写到黑板上。公布后让学生圈出 overclaim 的范围词，再挑一个与调查设计相称的审慎动词。',hedge],
  ['Academic Collocations & Discourse Markers',[
    table('Practice rewrites · original classroom sentences',['Expression','Contextual sentence','Function'],[['empirical evidence','We need empirical evidence to test this explanation.','distinguish data from intuition'],['in line with','The pattern is in line with, but does not prove, the hypothesis.','qualified agreement'],['subscribe to','Some reviewers subscribe to this framework.','state a position, not a fact'],['at the expense of','Efficiency should not be pursued at the expense of fairness.','name a trade-off'],['nevertheless / whereas','A was faster; nevertheless, quality was not measured.','concession / contrast']]),
    note('Micro rewrite','Replace “The table proves all A are superior” with a scoped description, an alternative explanation, and a limitation.','success'),
  ],'让学生用 in line with 连接观察与假设，再用 nevertheless 引出具体限制。请另一位学生用 at the expense of 说出一项可以检验的政策代价。'],
  ['Reading 2 · From Pen Names to Corpus Evidence',[
    table('Simulated corpus · 10,287 book reviews',['Period','Reviews','Coverage: women-authored books','“brilliant” odds ratio W/M'],[['1900–1949','2,100','24%','0.62'],['1950–1999','3,800','35%','0.78'],['2000–2024','4,387','47%','0.91'],['Total','10,287','Not an equal-period average','No pooled estimate supplied']]),
    bullets('Connect history to an empirical question','Nineteenth-century pen names motivate questions about identity and reception.','Coverage share and adjective odds measure different phenomena.','OR<1 indicates lower observed odds in this synthetic table, not causal proof of reviewer bias.'),
    note('Missing evidence','No actual corpus, publication mix, uncertainty intervals or controls are supplied. These simulated values cannot establish the effect of anonymity.'),
  ],'让学生分别解释 47% 的分母与 0.91 比较的是哪两组的 odds。追问若出版类型分布变化，现有表格能支持怎样的结论。'],
  ['Critical Logic Check · The Ecological Fallacy',[
    note('Aggregate → individual?','A group-level association is a starting point for inquiry. It is not a reliable rule for judging every person in that group.'),
    table('Two levels of evidence',['Level','Permitted claim'],[['Group averages','A and B differ on the recorded sample measure.'],['Individual ability','Requires individual, task-relevant evidence.'],['Causal mechanism','Requires a design that addresses alternative explanations.']]),
  ],'先按行标记推断对象，找出从 group average 换成 every individual 的第一处。改答时要求说清需要补哪类个体证据。',ecology],
  ['Seminar · Should Anonymous Blind Review Be Mandatory?',[
    bullets('Evidence bank on the same slide','P2: sample averages do not justify individual ranking.','P6: representation and language patterns motivate further audits.','Neither table tests an admissions or hiring intervention. Transfer requires an explicit warrant.'),
    note('Question the blind-box AI peer','Ask what criterion is missing, what evidence would change its mind, and which policy stage can be evaluated in a pilot.'),
  ],'先收齐每人自己的方案和一条证据，再打开盲盒辩友。请学生指出成本论证漏掉的一项准则，并设计能测量效果的小范围试点。',debate],
  ['Essay Workshop · Compare and Contrast',[
    table('Two valid paragraph architectures',['Structure','Sequence','Best use'],[['Point-by-point','Criterion1: A/B → Criterion2: A/B → synthesis','Directly compare the same criteria'],['Block','Framework A → Framework B → explicit synthesis','First explain unfamiliar frameworks']]),
    {type:'steps',title:'A paragraph you can defend',items:['Topic: Both frameworks address the pattern, but propose different mechanisms.','Evidence: In the simulated P2 sample, ...','Warrant: This is consistent with ..., although ...','Counterpoint: However, the design cannot rule out ...','Synthesis: Further evidence from ... would be needed.']},
    note('Workshop constraint','120–150 words; cite one table accurately, use two hedges, state one missing variable, and avoid individual stereotypes.','success'),
  ],'把同一条样本证据分别放进逐点对比和分块对比的大纲里。请同伴检查哪一句解释了数据如何支持主张，并改写含糊的一处。'],
  ['Unit 4 · Academic Language & Critical Reading Checklist',[
    table('Before submitting your paragraph',['Check','Ask yourself'],[['Scope','Did I say “in this sample” when appropriate?'],['Evidence','Did I separate observed data from a proposed explanation?'],['Hedging','Does my certainty match the design and uncertainty?'],['Logic','Did I infer individual ability from a group average?'],['Transfer','Why would evidence from reviews apply to admissions?'],['Policy','Did I name costs, fairness and a testable pilot?'],['Language','Are empirical evidence / in line with / at the expense of used correctly?']]),
    note('Exit sentence','The evidence suggests ___; however, ___ remains uncertain. I would revise my position if ___.','success'),
  ],'请每人交一句带证据范围和不确定性的退场句，再补一条愿意据以改判的新证据。抽两句复核主张、语气和证据的对应。'],
];
const make=(id,label,title,icon,raw)=>({
  id,label,title,icon,native:true,
  pages:raw.map(([title,blocks,speakerNotes,showcaseLesson],index)=>({
    number:index+1,title,blocks,text:blocks.map(blockText).join('\n'),images:[],speakerNotes,
    ...(showcaseLesson&&{showcaseLesson}),
  })),
});
export const COMBAT_DECKS=[
  make('deck-c-pointers','C语言 · 第6章指针实战','软件技术基础（C语言）：指针变量、自增优先级与函数传址实战','⌘',cPages),
  make('deck-optics','物理光学 · 干涉与电光调制','物理光学与光电子学：复振幅干涉、夫琅禾费衍射与电光调制实战','◉',opticsPages),
  make('deck-english-seminar','大学英语 · Unit 4翻转研讨','大学英语 Unit 4：实证阅读、学术审慎语与思辨交锋','Aa',englishPages),
];
export function combatMaterial(id) {
  const d=COMBAT_DECKS.find(d=>d.id===id);if(!d)throw Error('未知实战课件。');
  return {name:d.title,title:d.title,type:'native',showcaseId:d.id,pages:structuredClone(d.pages),warnings:[]};
}
