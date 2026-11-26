// Original teaching material, aligned to the requested HUST chapter outline.
// The English datasets below are deliberately synthetic, not attributed research.
import { blockText } from '../dist/core/lecture-score.mjs';
export { blockText } from '../dist/core/lecture-score.mjs';
const table=(title,headers,rows)=>({type:'table',title,headers,rows});
const note=(title,text,tone='note')=>({type:'callout',title,text,tone});
const code=(title,code)=>({type:'code',title,language:'c',code});
const pair=(left,right)=>({type:'code-pair',left,right});
const formula=(title,...items)=>({type:'formula',title,items});
const bullets=(title,...items)=>({type:'bullets',title,items});
const branches=(a,b)=>[
  {id:'mechanism',title:a,description:'逐项展开本页机制，用原页条件检验首轮理由。',revisionPrompt:'依据本页机制重新判断，写出支持你判断的具体条件。'},
  {id:'counterexample',title:b,description:'构造一个边界反例，检查哪些结论需要附加条件。',revisionPrompt:'用反例检验后改答，并指出原判断遗漏的条件。'},
];
function concept(id,title,prompt,options,correct,summary,pitfall,reasons) {
  return {id,activityId:'concept-diagnosis@1',title,subject:'大学课堂 · 双轮机制诊断',description:'先独立判断，再用证据修订。',prompt,
    options:options.map((label,i)=>({id:String.fromCharCode(65+i),label})),correctOptionId:correct,
    moduleConfig:{quickReasons:reasons,takeaway:{summary,pitfall}},branches:branches('展开机制与状态','检查边界与反例')};
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
  ['步长由所指对象的基类型决定','指针存地址，8B就是所有算术步长','加1就是加一个字节']);
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
  ]],
  ['6.1 内存字节编址：地址与内容',[
    table('示意地址：非实机布局，不保证相邻变量排列',['起始地址','定义','内容','对象大小（本例）'],[['0x0B34E0','int a = 3','3','4 B'],['0x0B34E4',"char k1 = 'a'","'a' / 编码值","1 B"],['0x0B34E8','float f1 = 3.14159f','近似 3.14159','4 B']]),
    table('变量的五个基本特征',['特征','以 a 为例'],[['存储类型 / 期','示例为块内自动对象（auto）'],['数据类型','int'],['变量名','a'],['内容','3，可被赋值修改'],['地址','&a；类型为 int *，不是整数3']]),
    note('字节编址','每个地址标识一个字节；多字节对象占一段存储。打印地址用 printf("%p", (void *)&a)。'),
  ]],
  ['6.2 直接访问与间接访问',[
    code('同一个 int 对象，三条访问路径','int a = 3;\nint *p = &a;\n*p = 7;\nprintf("%d %d %d\\n", a, *(&a), *p); // 7 7 7'),
    table('名字 → 地址 → 对象',['表达式','类型','语义'],[['a','int','直接访问 a 的内容'],['&a','int *','取得 a 的地址'],['p','int *','保存 a 的地址'],['*p','int 左值','间接访问 a'],['*(&a)','int 左值','与 a 指定同一对象']]),
    note('NULL 与野指针','NULL 明确表示“不指向对象”，可以比较、不可解引用。未初始化自动指针是未确定值，连读取和比较都可能出问题。','warning'),
  ]],
  ['6.2 指针基类型与算术步长辨析',[
    code('先初始化，再讨论 p+1','int a[3] = {3, 4, 5};\ndouble b[3] = {1.0, 2.0, 3.0};\nint *p = a;\ndouble *q = b;'),
    table('本页 ABI 假设',['比较对象','含义'],[['sizeof(p) / sizeof(q)','保存地址的指针对象占多少字节'],['sizeof(*p) / sizeof(*q)','int / double 元素占多少字节'],['p+1 / q+1','分别前进一个所指类型的元素']]),
  ],pointerSize],
  ['6.3 闭卷必考：指针与 ++ / -- 优先级',[
    table('每一行以 p 指向 arr[0] 独立开始',['表达式','等价机制','返回值','结束状态'],[['*p++','*(p++)；先取旧地址','10','p→arr[1]，arr不变'],['*++p','*(++p)；先前进','20','p→arr[1]，arr不变'],['(*p)++','对所指整数后置自增','10','p不变，arr[0]=11'],['++(*p)','对所指整数前置自增','11','p不变，arr[0]=11']]),
    table('连续执行的8行状态追踪',['行','语句','输出 / 状态'],[['1','int arr[]={10,20,30,40};','arr=[10,20,30,40]'],['2','int *p=arr;','p→arr[0]'],['3','int x=*p++;','x=10，p→arr[1]'],['4','int y=(*p)++;','y=20，arr[1]=21'],['5','int z=*++p;','z=30，p→arr[2]'],['6','int w=++(*p);','w=31，arr[2]=31'],['7','printf("%d %d %d %d",x,y,z,w);','10 20 30 31'],['8','printf("%d", *p);','31']]),
  ]],
  ['6.5 函数参数传递：值的副本与地址的副本',[
    pair(code('swap_wrong：只改局部形参','void swap_wrong(int x, int y) {\n    int temp = x;\n    x = y;\n    y = temp;\n}\n// 调用：swap_wrong(a, b);\n// 返回：a、b 没变'),code('swap_ok：用地址访问调用者对象','void swap_ok(int *x, int *y) {\n    int temp = *x;\n    *x = *y;\n    *y = temp;\n}\n// 调用：swap_ok(&a, &b);\n// 返回：a、b 已交换')),
    table('跨调用边界发生了什么',['位置','传 int','传 int *'],[['调用时','复制 a、b 的数值','复制 &a、&b 两个地址'],['函数内','x、y 是独立局部对象','*x、*y 指定调用者对象'],['返回后','局部形参生存期结束','写入 a、b 的修改仍存在']]),
    note('严格术语','C 只有传值。所谓“传址”是传递指针值，再解引用访问同一对象。栈帧是常见实现模型，非标准强制布局。'),
  ]],
  ['实战排错：指针交换与空指针解引用',[
    code('有意保留错误的完整7行函数',swapBugLines.join('\n')),
    note('输入契约','调用者已传入两个有效 int 的地址。需要审计的是临时变量的类型与对象生存性。'),
    note('修复目标','交换数据值，而不是交换局部指针；先判断哪一行首次访问了不存在的 int 对象。','warning'),
  ],swapBug],
  ['6.7.1 一维数组等价寻址与形参退化',[
    table('条件：p=a，0≤i<n，且元素有效',['表达式','展开','对象'],[['a[i]','*(a+i)','第 i 个 int'],['*(a+i)','*(首地址+i)','第 i 个 int'],['*(p+i)','*(p 的值+i)','第 i 个 int'],['p[i]','*(p+i)','第 i 个 int']]),
    pair(code('调用者中是真数组','int a[10];\nsize_t n = sizeof(a)/sizeof(a[0]);\n// n=10\ninv(a, (int)n);'),code('参数声明会被调整','void inv(int x[], int n) {\n    // x 的参数类型实际是 int *\n    // sizeof(x) 是指针大小\n    // 必须单独传入长度 n\n}')),
    note('数组名不是可修改指针变量','a++ 不合法；p++ 合法。a 与 &a 数值常相同，类型和加一的步长却不同。','warning'),
  ]],
  ['例6.7.2 完整工程实例：数组原地逆序',[
    pair(code('main.c · 与右栏合并即可编译','#include <stdio.h>\nvoid inv(int x[], int n);\nint main(void) {\n    int a[10]={3,7,9,11,0,6,7,5,4,2};\n    for(int k=0;k<10;k++) printf("%d ",a[k]);\n    puts("");\n    inv(a,10);\n    for(int k=0;k<10;k++) printf("%d ",a[k]);\n    puts("");\n    return 0;\n}'),code('inv · 双指针向中点收缩','void inv(int x[], int n) {\n    if (n <= 1) return;\n    int *i=x, *j=x+n-1;\n    int *p=x+(n-1)/2;\n    for (; i<=p && i<j; ++i,--j) {\n        int temp=*i;\n        *i=*j;\n        *j=temp;\n    }\n}')),
    note('输出与循环不变量','逆序后：2 4 5 7 6 0 11 9 7 3。每轮将最外侧未归位的一对元素放到最终位置；O(n) 时间，O(1) 辅助空间。','success'),
  ]],
  ['6.7.2 二维数组传参：行指针与指针数组',[
    table('先看括号，再看 []：二者不能互换',['声明','原始含义','作为函数参数时'],[['int (*array)[10]','指向含10个int的数组的指针','仍为 int (*)[10]'],['int *array[10]','含10个 int* 元素的数组','调整为 int **'],['int a[2][10]','连续存储的两行数组','a 转为首行指针 int (*)[10]']]),
    pair(code('连续二维数组：整行步长','void Func(int (*array)[10]) {\n    array[1][2] = 42;\n}\nint a[2][10] = {{0}};\n// Func(a); // 类型匹配'),code('行地址表：各行可独立存储','void FuncRows(int *array[10]) {\n    array[1][2] = 42;\n}\nint r0[10]={0}, r1[10]={0};\nint *rows[2]={r0,r1};\n// FuncRows(rows);')),
    note('sizeof 与行跨度','array+1 在左栏跨10个int；右栏跨一个int*。int** 不携带固定行宽，强制转换不能修复布局差异。','warning'),
  ]],
  ['期末闭卷综合读程：二维寻址 × 后置自增',[
    code('顺序明确，逐句执行','int a[2][3]={{1,3,5},{7,9,11}};\nint *p=&a[0][0];\nint x=*(*(a+1)+1);\nint y=*p++;\nprintf("%d %d\\n", x, y);'),
    table('先辨类型，再计算',['表达式','类型 / 步长'],[['a+1','指向第二行；跨3个int'],['*(a+1)+1','第二行中前进一个int'],['*p++','*(p++)；使用旧指针值']]),
    note('标准边界','这里 p 只在首行内前进；不要据此用 int* 跨越二维数组的各个子数组边界遍历。'),
  ],finalC],
  ['第6章核心考点速查与编程规范',[
    table('闭卷检查表',['遇到的问题','最短可靠方法','常见失分点'],[['地址与内容','画对象表，标出 p 与 *p','把地址当内容、误认 NULL 定义非法'],['指针算术','先定基类型，再算字节步长','sizeof(p) 误当 sizeof(*p)'],['++ 与 *','先加括号，再拆成有顺序的语句','未排序读写、越界解引用'],['swap / 函数','传值副本；用 *p 访问原对象','把“传址”误解为引用传递'],['数组参数','调用处求长度，n独立传入','形参 sizeof(x) 当整数组'],['二维数组','区分 int (*)[N] 与 int **','类型强转掩盖行布局不兼容']]),
    note('提交前规范','指针先初始化；每次解引用核对有效性、边界与生存期；地址用 %p；保持 const 正确；用编译器警告与地址检查工具辅助。','success'),
  ]],
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
  moduleConfig:{quickReasons:['首暗纹 r*x=±1，故 |x|=1/r','缝越宽，衍射角越大','N增大改变包络宽度'],takeaway:{summary:'固定d、λ时：第一包络暗纹 |x|=1/r；N增大主要使主极大更尖锐。',pitfall:'缺级须同时满足 d sinθ=mλ、a sinθ=qλ，且q≠0。'},
    formulaDisplay:'I/I₀ = sinc²(π r x) · [sin(Nπx)/(N sinπx)]²；sinc(u)=sin(u)/u',xAxis:{symbol:'x',label:'x = d sinθ / λ',min:-3,max:3},yAxis:{label:'归一化光强 I / I₀',min:0,max:1.05},
    sliders:[{symbol:'r',label:'缝宽比 a/d',min:0.2,max:0.9,step:0.05,defaultValue:0.5},{symbol:'N',label:'缝数 N（整数）',min:2,max:6,step:1,defaultValue:4}],
    curves:[{label:'衍射包络',expr:'sinc(r*x)^2'},{label:'多缝强度',expr:'sinc(r*x)^2*(N+2*((N-1)*cos(2*pi*x)+max(N-2,0)*cos(4*pi*x)+max(N-3,0)*cos(6*pi*x)+max(N-4,0)*cos(8*pi*x)+max(N-5,0)*cos(10*pi*x)))/N^2'}],
    insightNote:'图中以有限余弦和实现2–6整数缝数的精确阵列因子；引擎sinc(z)=sin(πz)/(πz)。x=整数处无需除以sinπx。r=0.5时偶数级主极大缺级。'},branches:branches('用第一零点解释包络','对比N与缝宽的独立作用')};
const harmonic=concept('optics-harmonic','谷底偏置：二倍频的机制','理想平衡MZM在谷底 φ₀=π，小信号相移 m cosΩt，平方律探测。为什么交流输出的最低阶是2Ω？',
  ['传输在谷底关于相移为偶函数；二次项 cos²Ωt 含2Ω','光电二极管只保留正半周，所以削波整流','相位改变了载波光频两倍，因此直接读出2Ω','电极把输入电信号频率自动乘二'],'A',
  'I/Iin≈m²(1+cos2Ωt)/8：去掉直流后最低阶为2Ω。','“纯二倍频”只在理想小信号最低阶成立；较大m有4Ω等偶次谐波，偏置误差会引入基频。',
  ['偶函数二次项与 cos² 恒等式','二极管削掉负半周','倍频来自电极长度增加']);
const opticsPages=[
  ['从复振幅叠加到高速片上电光调制',[
    {type:'steps',title:'一条物理链路',items:['复振幅：把振幅与相位装进一个量','相干叠加：交叉项让光强依赖相位差','孔径积分：单缝包络 × 多缝干涉因子','电光效应：电压调相位，干涉把相位变成功率','探测与读出：平方律、RC与行波匹配决定带宽']},
    note('本讲约定','按题设采用 U(P,t)=A(P)cos[ωt−φ(P)]，Ũ(P)=A(P)eⁱφ(P)，时间因子e⁻ⁱωt；归一化强度吸收介质常数。'),
  ]],
  ['1.1 单色光波复振幅与相干叠加',[
    formula('统一符号，避免相位符号相互抵消','U(P,t)=Re{Ũ(P)e⁻ⁱωt}=A(P)cos[ωt−φ(P)]','Ũ(P)=A(P)eⁱφ(P)；I(P)=Ũ*(P)Ũ(P)=A²(P)','Ũ=Ũ₁+Ũ₂；I=(Ũ₁*+Ũ₂*)(Ũ₁+Ũ₂)','I=I₁+I₂+2√(I₁I₂)cosΔφ；Δφ=φ₂−φ₁'),
    table('交叉项出现的条件',['条件','不满足时'],[['同频 / 足够相干','探测时间平均可能抹去干涉'],['偏振有重合分量','正交偏振时交叉项为零'],['空间重合且相位稳定','条纹可见度下降'],['不等臂强度','V=2√(I₁I₂)/(I₁+I₂)≤1']]),
  ]],
  ['推导找茬：3dB 单臂损耗与静态消光比',[
    formula('审计的起点','T₂=P₂,out/P₂,in≈0.5；t₂=E₂,out/E₂,in','ER=Imax/Imin；ERdB=10log₁₀(ER)'),
    note('请先独立审计右侧5步','前提是理想相干、等比分束合束、仅一臂额外损耗。每一步先核对量的定义，再检查代数。'),
  ],er],
  ['夫琅禾费单缝衍射与多缝光栅方程',[
    formula('远场相干孔径积分','Ũ(θ) ∝ ∫₋ₐ/₂ᵃ/₂ exp(−ik y sinθ)dy = a sincβ','β=πa sinθ/λ；γ=πd sinθ/λ；sincβ=sinβ/β','I(θ)/I₀ = sinc²β · sin²(Nγ)/(N²sin²γ)'),
    table('先分清“哪一种零点”',['类型','条件','物理图像'],[['单缝暗纹','a sinθ=qλ，q=±1,±2,…','半波带两两抵消；中心不是暗纹'],['光栅主极大','d sinθ=mλ','各缝同相叠加，因子极限为1'],['干涉零点','Nγ=lπ，且γ不是整数π','有限阵列相消'],['缺级','m d⁻¹=q a⁻¹；q≠0','主极大恰落在包络暗纹']]),
    note('适用边界','远场 / 透镜焦平面、单色平面波、等宽等距等照明。光栅公式同时要求 |sinθ|≤1。'),
  ]],
  ['页内公式沙盒：包络宽度、主极大与缺级',[
    formula('把变量无量纲化','x=d sinθ/λ；r=a/d；β=πrx，γ=πx','包络第一暗纹 x=±1/r；主极大 x=m','f(x)=sinc(r*x)^2'),
    table('三次可证伪预测',['操作','先预测，再拖动'],[['r：0.25→0.5','首暗纹从±4移到±2'],['N：2→4→6','主极大位置不变，峰宽变窄'],['r=0.5，查看x=2','包络为零，第2级主极大缺级']]),
  ],diffraction],
  ['MZM：电压 → 相位 → 输出功率',[
    formula('泡克耳斯效应与推挽驱动','Δn≈−(1/2)n³r_eff E；Δφ=(2π/λ)Δn L','差分相移约定：Δφ=πV/Vπ；I_A/Iin=[1+cosΔφ]/2','VπL：达到π差分相移所需的电压–长度积'),
    table('结构与指标',['部件','作用','工程约束'],[['输入/输出耦合器','把相位差转换为功率差','分束比、额外损耗'],['推挽电极','两臂相移方向相反','Vπ约定须说明驱动端口'],['较长相互作用区','降低Vπ','传播损耗与微波衰减增加'],['行波电极','延长高速电光同步作用','阻抗与速度匹配']]),
  ]],
  ['直流偏置与小信号谐波展开',[
    formula('相移 φ(t)=φ₀+m cosΩt；m≪1','I/Iin=[1+cos(φ₀+m cosΩt)]/2','正交点φ₀=π/2：I/Iin≈1/2−(m/2)cosΩt','谷底点φ₀=π：I/Iin≈m²cos²Ωt/4=m²[1+cos2Ωt]/8'),
    table('同一器件，两种用途',['偏置','最低阶交流项','用途 / 失真'],[['正交点','Ω，系数∝m','模拟线性调制；三阶项产生互调'],['谷底点','2Ω，系数∝m²','光子微波倍频；高阶有4Ω等'],['偏离谷底','重新出现Ω项','偏置漂移破坏基频抑制']]),
  ]],
  ['工程误区：谷底偏置为什么会二倍频？',[
    formula('要解释的是机制，不只是记住结论','cos(π+δ)=−cosδ；在δ=0附近为偶函数','cos²Ωt=(1+cos2Ωt)/2'),
    note('反事实检验','如果把光电探测器换成理想线性功率读出，强度中的2Ω项仍在；因此“二极管削波”并非本题的成因。'),
    note('审慎结论','理想、小信号、去除直流、最低非零阶：可近似得到单一2Ω交流项。','warning'),
  ],harmonic],
  ['探测读出链路：RC 与 TFLN 行波速度匹配',[
    formula('先画等效模型，再谈带宽','f_RC≈1/[2πR_eq(C_j+C_pad+C_in)]','Δφ_RF≈2πfL(n_m−n_g)/c；速度失配累积使响应抵消'),
    table('指标无法单独优化',['改动','收益','代价 / 检查'],[['增大负载R','提高电压响应','RC带宽降低、噪声变化'],['缩小探测结面积','减小C_j','耦合容差、吸收效率'],['延长TFLN电极','降低驱动Vπ','微波损耗、失配累积'],['匹配n_m与n_g','减小走离','还需50Ω匹配与低衰减']]),
    note('研究讨论','VπL 很小不自动意味着带宽高。比较器件时同时列出波长、长度、驱动方式、插入损耗及3dB电光带宽。'),
  ]],
  ['核心公式、符号约定与工程排障总表',[
    table('把公式与前提一起带走',['任务','核心关系','先排查'],[['复振幅','Ũ=Aeⁱφ；U=Re(Ũe⁻ⁱωt)','时间因子和相位符号一致'],['相干叠加','I=I₁+I₂+2√I₁I₂cosΔφ','偏振、相干性、归一化'],['损耗与ER','t=√T；ER=[(1+t)/(1−t)]²','功率dB用10log；振幅用20log'],['衍射 / 光栅','sinc²β × 阵列因子','中心极限、缺级、远场条件'],['MZM谐波','正交Ω；谷底最低阶2Ω','偏置、驱动幅度、高阶谐波'],['高速链路','RC + 传输线 + 渡越时间','不能拿一个指标代表全链路']]),
    note('阅读核对','定义依题设；衍射条件参照 MIT 波动光学讲义；MZM 倍频参照光子微波研究中的偏置机制。所有数值由本页模型计算。','success'),
  ]],
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
  ]],
  ['Reading 1 · Consumer Behaviour: What Do the Data Say?',[
    table('Simulated survey · N=2,000 (A:1,000 / B:1,000)',['Measure','Group A','Group B','What it cannot establish'],[['Median time per purchase','24 min','31 min','Innate ability / causal mechanism'],['Compared ≥3 sellers','62%','49%','Quality of each comparison'],['Self-reported return rate','8%','12%','Population-wide individual ranking']]),
    bullets('Describe, then qualify','In this sample, the median time was seven minutes lower in group A.','The proportion comparing at least three sellers was 13 percentage points higher.','Self-report, sampling, product mix and income may affect these estimates.'),
    note('Evidence boundary','Invented teaching dataset. No confidence intervals or random assignment are supplied; do not claim causation or statistical significance.'),
  ]],
  ['Competing Frameworks · Hypothesis Is Not Evidence',[
    table('Two explanations to investigate',['Question','Evolutionary hypothesis','Social conditioning'],[['Proposed mechanism','Inherited tendencies shaped by selection','Norms, roles, incentives and learning'],['Prediction needed','Specify a measurable, falsifiable pattern','Predict change across contexts or training'],['Confounders','Culture, income, task and measurement','Selection, prior experience, institutions'],['Evidence required','Independent tests beyond the P2 table','Longitudinal / experimental comparisons']]),
    note('A disciplined response','The observed pattern is consistent with more than one explanation. It does not, by itself, identify the causal mechanism.'),
    note('Do not naturalize a stereotype','Treat these as competing hypotheses to test, not settled conclusions about any gender or group.','warning'),
  ]],
  ['Academic Writing · Hedging in Empirical Claims',[
    table('Match grammatical certainty to empirical support',['Overclaim','Calibrated version'],[['The study proves biology determines behaviour.','The pattern may be consistent with several mechanisms.'],['All members of A make better decisions.','Group A had a lower average return rate in this sample.'],['This always works.','The intervention may help under the stated conditions.']]),
    note('Your task','Read four candidate conclusions. Choose the one whose scope fits the table, then explain why the others overreach.'),
  ],hedge],
  ['Academic Collocations & Discourse Markers',[
    table('Practice rewrites · original classroom sentences',['Expression','Contextual sentence','Function'],[['empirical evidence','We need empirical evidence to test this explanation.','distinguish data from intuition'],['in line with','The pattern is in line with, but does not prove, the hypothesis.','qualified agreement'],['subscribe to','Some reviewers subscribe to this framework.','state a position, not a fact'],['at the expense of','Efficiency should not be pursued at the expense of fairness.','name a trade-off'],['nevertheless / whereas','A was faster; nevertheless, quality was not measured.','concession / contrast']]),
    note('Micro rewrite','Replace “The table proves all A are superior” with a scoped description, an alternative explanation, and a limitation.','success'),
  ]],
  ['Reading 2 · From Pen Names to Corpus Evidence',[
    table('Simulated corpus · 10,287 book reviews',['Period','Reviews','Coverage: women-authored books','“brilliant” odds ratio W/M'],[['1900–1949','2,100','24%','0.62'],['1950–1999','3,800','35%','0.78'],['2000–2024','4,387','47%','0.91'],['Total','10,287','Not an equal-period average','No pooled estimate supplied']]),
    bullets('Connect history to an empirical question','Nineteenth-century pen names motivate questions about identity and reception.','Coverage share and adjective odds measure different phenomena.','OR<1 indicates lower observed odds in this synthetic table, not causal proof of reviewer bias.'),
    note('Missing evidence','No actual corpus, publication mix, uncertainty intervals or controls are supplied. These simulated values cannot establish the effect of anonymity.'),
  ]],
  ['Critical Logic Check · The Ecological Fallacy',[
    note('Aggregate → individual?','A group-level association is a starting point for inquiry. It is not a reliable rule for judging every person in that group.'),
    table('Two levels of evidence',['Level','Permitted claim'],[['Group averages','A and B differ on the recorded sample measure.'],['Individual ability','Requires individual, task-relevant evidence.'],['Causal mechanism','Requires a design that addresses alternative explanations.']]),
  ],ecology],
  ['Seminar · Should Anonymous Blind Review Be Mandatory?',[
    bullets('Evidence bank on the same slide','P2: sample averages do not justify individual ranking.','P6: representation and language patterns motivate further audits.','Neither table tests an admissions or hiring intervention. Transfer requires an explicit warrant.'),
    note('Question the blind-box AI peer','Ask what criterion is missing, what evidence would change its mind, and which policy stage can be evaluated in a pilot.'),
  ],debate],
  ['Essay Workshop · Compare and Contrast',[
    table('Two valid paragraph architectures',['Structure','Sequence','Best use'],[['Point-by-point','Criterion1: A/B → Criterion2: A/B → synthesis','Directly compare the same criteria'],['Block','Framework A → Framework B → explicit synthesis','First explain unfamiliar frameworks']]),
    {type:'steps',title:'A paragraph you can defend',items:['Topic: Both frameworks address the pattern, but propose different mechanisms.','Evidence: In the simulated P2 sample, ...','Warrant: This is consistent with ..., although ...','Counterpoint: However, the design cannot rule out ...','Synthesis: Further evidence from ... would be needed.']},
    note('Workshop constraint','120–150 words; cite one table accurately, use two hedges, state one missing variable, and avoid individual stereotypes.','success'),
  ]],
  ['Unit 4 · Academic Language & Critical Reading Checklist',[
    table('Before submitting your paragraph',['Check','Ask yourself'],[['Scope','Did I say “in this sample” when appropriate?'],['Evidence','Did I separate observed data from a proposed explanation?'],['Hedging','Does my certainty match the design and uncertainty?'],['Logic','Did I infer individual ability from a group average?'],['Transfer','Why would evidence from reviews apply to admissions?'],['Policy','Did I name costs, fairness and a testable pilot?'],['Language','Are empirical evidence / in line with / at the expense of used correctly?']]),
    note('Exit sentence','The evidence suggests ___; however, ___ remains uncertain. I would revise my position if ___.','success'),
  ]],
];
const make=(id,label,title,icon,raw)=>({id,label,title,icon,native:true,pages:raw.map(([title,blocks,showcaseLesson],i)=>({number:i+1,title,blocks,text:blocks.map(blockText).join('\n'),images:[],speakerNotes:'先讲解本页结构，再让学生独立判断。保留条件与适用范围；双轮改答后总结机制。',...(showcaseLesson&&{showcaseLesson})}))});
export const COMBAT_DECKS=[
  make('deck-c-pointers','C语言 · 第6章指针实战','软件技术基础（C语言）：指针变量、自增优先级与函数传址实战','⌘',cPages),
  make('deck-optics','物理光学 · 干涉与电光调制','物理光学与光电子学：复振幅干涉、夫琅禾费衍射与电光调制实战','◉',opticsPages),
  make('deck-english-seminar','大学英语 · Unit 4翻转研讨','大学英语 Unit 4：实证阅读、学术审慎语与思辨交锋','Aa',englishPages),
];
export function combatMaterial(id) {
  const d=COMBAT_DECKS.find(d=>d.id===id);if(!d)throw Error('未知实战课件。');
  return {name:d.title,title:d.title,type:'native',showcaseId:d.id,pages:structuredClone(d.pages),warnings:[]};
}
