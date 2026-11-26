const branch = (id, title, description) => ({ id, title, description, revisionPrompt: '用原页证据重新检验你的判断，说明适用条件。', evidenceIds: ['M1'] });
const branches = [branch('boundary', '寻找反例与边界', '用一组边界输入检验刚才的解释，逐项核对原页证据。'), branch('compare', '比较竞争解释', '比较两个相同结论背后的不同理由，指出可区分它们的证据。')];
const takeaway = (summary, pitfall, formula) => ({ summary, pitfall, ...(formula && { formula }) });
export const gaussianConfig = {
  formulaDisplay: 'f(x)=exp(−a·x²)；F(ω)=√(π/a)·exp(−ω²/4a)',
  xAxis: { symbol: 'x', label: '位置 x / 角频率 ω（共用数值横轴）', min: -6, max: 6 },
  yAxis: { label: '时域幅度 / 频域幅度', min: 0, max: 4 },
  sliders: [{ symbol: 'a', label: '高斯展宽参数 a', min: 0.25, max: 4, step: 0.05, defaultValue: 1 }],
  curves: [{ label: '时域 f(x)', expr: 'exp(-a*x^2)' }, { label: '频域 F(ω)，横轴 x 代表 ω', expr: 'sqrt(pi/a)*exp(-x^2/(4*a))', style: 'dashed' }],
  insightNote: '采用 F(ω)=∫f(x)exp(−iωx)dx。增大 a，时域收窄、频域展宽；两条曲线的幅度量纲不同。',
  quickReasons: ['a 增大使时宽按 1/√a 缩小，频宽按 √a 增大', '我认为两条曲线会一起变窄', '应比较宽度，而非仅比较峰高'],
  takeaway: takeaway('高斯波包的时频尺度反比。', '宽度变化与峰高变化是两个问题；先固定傅里叶变换约定。', 'Δx ∝ 1/√a；Δω ∝ √a'),
};
export const mzmConfig = {
  formulaDisplay: 'P(φ)=[1+10^(−loss/10)+2√(10^(−loss/10))cos((φ+bias)π/180)]/4',
  xAxis: { symbol: 'phi', label: '扫描相位 φ', min: 0, max: 360, unit: '°' },
  yAxis: { label: '归一化输出功率', min: 0, max: 1 },
  sliders: [{ symbol: 'loss', label: '单臂额外损耗', min: 0, max: 12, step: 0.1, defaultValue: 3, unit: 'dB' }, { symbol: 'bias', label: '相位偏置', min: -180, max: 180, step: 1, defaultValue: 0, unit: '°' }],
  curves: [{ label: 'A 端传输', expr: '(1+10^(-loss/10)+2*sqrt(10^(-loss/10))*cos((phi+bias)*pi/180))/4' }],
  insightNote: '两只理想 50:50 耦合器，仅一臂增加功率损耗。振幅不平衡使谷底无法完全相消。',
  quickReasons: ['损耗改变两臂振幅差，抬高谷底', '偏置平移曲线，不能补偿振幅差', '我认为损耗只等比例缩小曲线'],
  takeaway: takeaway('相位扫描与振幅平衡共同决定消光比。', '功率损耗换成振幅时须开平方。', 'ER=[(1+√T)/(1−√T)]²'),
};
export const diffractionConfig = {
  formulaDisplay: 'I(x)=sinc²(a·x)，sinc(u)=sin(πu)/(πu)',
  xAxis: { symbol: 'x', label: '归一化远场位置', min: -5, max: 5 }, yAxis: { label: '归一化光强', min: 0, max: 1.05 },
  sliders: [{ symbol: 'a', label: '归一化狭缝宽度', min: 0.4, max: 3, step: 0.05, defaultValue: 1 }],
  curves: [{ label: '单缝夫琅禾费衍射', expr: 'sinc(a*x)^2' }], insightNote: '固定波长与观察距离，增大缝宽会缩窄中央主瓣。横轴采用小角度归一化。',
  quickReasons: ['第一暗纹满足 a·x=±1', '缝宽增大时主瓣变窄', '我认为缝越宽光斑越宽'],
  takeaway: takeaway('空间尺度与衍射角尺度反比。', '此处为远场、小角度近似。', 'sinθ₁=λ/a'),
};
function lesson(id, activityId, title, subject, prompt, labels, config, correctOptionId = 'A') {
  return { id, activityId, title, subject, prompt, description: prompt, options: labels.map((label, i) => ({ id: String.fromCharCode(65 + i), label })), correctOptionId, moduleConfig: config, quickReasons: config.quickReasons, takeaway: config.takeaway, branches: structuredClone(branches), skills: ['证据推理', '边界检验'], steps: ['独立判断', '比较理由', '基于证据改答'] };
}
const pointerConfig = {
  artifactTitle: 'C 语言结构体指针初始化片段', artifactLang: 'code',
  steps: [
    { id: 'S1', line: '1', content: 'typedef struct { int value; } Node;' },
    { id: 'S2', line: '2', content: 'Node *p = NULL;' },
    { id: 'S3', line: '3', content: 'p->value = 42;', tag: '写入成员' },
    { id: 'S4', line: '4', content: 'printf("%d", p->value);' },
    { id: 'S5', line: '5', content: 'return 0;' },
  ], faultStepId: 'S3', faultDiagnosis: '第 3 行首次解引用空指针。p 没有指向有效 Node 对象；应先分配并检查内存，或让 p 指向存活的局部对象。第 4 行同样依赖这一前提。',
  quickReasons: ['第 3 行首次解引用 NULL，尚未分配对象', '我认为赋值为 NULL 的第 2 行已经出错', '我认为只有读取并打印的第 4 行才出错'],
  takeaway: takeaway('指针变量与它指向的对象必须分别检查。', 'NULL 指针解引用是未定义行为；malloc 后也须判空并正确释放。'),
};
export const pointerLesson = lesson('pointer-audit', 'step-fault@1', '五行 C 代码：首次非法访问在哪里？', 'C 语言 · 指针与内存', '已包含所需头文件，代码位于 main 内。点击首次产生未定义行为的一行，并解释它缺少的前提。', [], pointerConfig, 'S3');
pointerLesson.options = pointerConfig.steps.map(s => ({ id: s.id, label: `第 ${s.line} 行：${s.content}` }));
const rcConfig = {
  artifactTitle: '一阶 RC 暂态初值推导', artifactLang: 'math',
  steps: [{ id: 'S1', line: '1', content: 't<0 时电容已充至 2 V；t=0 后接入 5 V 阶跃。' }, { id: 'S2', line: '2', content: 'RC·dVc/dt + Vc = 5，通解 Vc=5+K·exp(−t/RC)。' }, { id: 'S3', line: '3', content: '电源跳变，所以 Vc(0⁺)=0，得到 K=−5。' }, { id: 'S4', line: '4', content: '代入得到 Vc(t)=5−5·exp(−t/RC)。' }],
  faultStepId: 'S3', faultDiagnosis: '有限电流下电容电压连续，Vc(0⁺)=Vc(0⁻)=2 V；因此 K=−3，正确响应为 5−3 exp(−t/RC)。',
  quickReasons: ['电容电压不能在有限电流下突变', '初值来自切换前的储能状态', '我认为输入跳变会把电容初值清零'],
  takeaway: takeaway('先确定初值，再代入通解。', '输入阶跃不等于电容电压跳变。', 'Vc(t)=5−3exp(−t/RC)'),
};
export const rcStepLesson = lesson('rc-step-audit', 'step-fault@1', 'RC 初值连续性：哪一步偷换了前提？', '电路基础 · 微分方程', '已知切换前电容电压为 2 V。找出以下推导首次失效的一步。', [], rcConfig, 'S3');
rcStepLesson.options = rcConfig.steps.map(s => ({ id: s.id, label: `第 ${s.line} 步` }));
export const spaceLesson = lesson('four-spaces', 'concept-diagnosis@1', 'Ax=0 只有零解：究竟哪一种满秩？', '线性代数 · 四个基本子空间', 'A 为 m×n 矩阵，Ax=0 只有零解。哪项判断在所有情形下成立？', ['r=n，列满秩，零空间维数 n−r=0', '必有 r=m，因此行满秩', '必有 m=n，所以 A 可逆', '只要 r>0 就没有非零解'], { quickReasons: ['秩—零度定理给出 dim N(A)=n−r', '我把满秩理解成行列数一定相等', '要先区分行满秩和列满秩'], takeaway: takeaway('零解唯一说明列向量线性无关。', '矩形矩阵也可列满秩；r=n 不保证 r=m。', 'dim N(A)=n−r；dim N(Aᵀ)=m−r') });
export const gaussianLesson = lesson('gaussian-scales', 'param-explorer@1', '拖动 a：时宽和频宽如何变化？', '数学物理 · 傅里叶变换', '保持傅里叶变换约定不变，增大 a，预测两域宽度的变化。', ['时域变窄，频域变宽', '两域都变窄', '两域都变宽', '只有峰高变化，宽度不变'], gaussianConfig);
export const mzmLesson = lesson('mzm-declarative', 'param-explorer@1', '损耗抬高谷底：相位能补回来吗？', '光电子学 · 电光调制', '单臂额外损耗从 0 增至 3 dB，扫描完整相位范围，谷底会怎样？', ['谷底抬高，消光比降低', '谷底保持零，曲线仅缩放', '总输出不变', '只要移动偏置即可恢复零谷底'], mzmConfig);
export const diffractionLesson = lesson('single-slit', 'param-explorer@1', '单缝更宽，中央主瓣会更宽吗？', '大学物理 · 波动光学', '固定波长与观察距离，增大狭缝宽度，预测中央主瓣宽度。', ['变窄', '变宽', '不变', '无法由远场模型判断'], diffractionConfig);
export const tflnLesson = lesson('tfln-tradeoff', 'concept-diagnosis@1', 'VπL 更小是否一定带来更高带宽？', '光电器件 · TFLN', '减小 VπL 或增加电极长度能否保证高速链路性能同步改善？', ['不能，须同时检查损耗、阻抗与速度匹配', '能，低电压必然高带宽', '只需看直流半波电压', '增加长度没有任何代价'], { quickReasons: ['相互作用增强不保证行波速度匹配', '更长电极增加微波衰减与失配积累', '我把低驱动电压等同于高带宽'], takeaway: takeaway('器件指标须在链路约束下权衡。', '不能用单一静态指标代替频响验证。', 'VπL 与带宽受不同约束共同影响') });
export const ethicsLesson = lesson('ai-decision', 'evidence-weighing@1', '高风险 AI：谁拥有最终决策权？', '通识导论 · 工程伦理', '医疗 AI 总体准确率 96%，罕见病例子群仅 78%；人工复核增加 2 分钟，系统可记录并审计每次决策。你选择怎样的部署方案？本题无唯一标准答案。', ['AI 筛查，低置信度与高风险案例强制人工复核', '全部由 AI 自动决策，以总体准确率为唯一标准', 'AI 仅展示建议，每例都由人决定', '暂不部署，先补齐子群验证与申诉机制'], { dimensions: ['实时可靠性', '责任与可申诉性', '部署成本'], aiPeer: { persona: '盲盒 AI 辩友 · 激进效率派', claim: '总体准确率已达 96%，应立即取消人工复核，所有患者都会获益。', flawHint: '原页给出罕见病例子群仅 78%；总体平均数无法证明每个子群都受益，还须考虑误判代价与申诉。' }, quickReasons: ['总体准确率掩盖子群风险', '人工复核应与置信度及风险等级联动', '我优先部署速度，愿意承担误判代价', '先明确谁为不可逆决策负责'], takeaway: takeaway('把价值排序、证据强弱和适用边界分别说清。', '方案偏好没有唯一标准答案；AI 观点是一份待质询的论证。') }, null);
export const privacyLesson = lesson('privacy-myth', 'concept-diagnosis@1', '删掉姓名就完成数据脱敏了吗？', '人工智能 · 隐私与可解释性', '数据集去掉姓名，但保留精确时间、位置和罕见诊断。能否据此保证匿名？', ['不能，准标识符组合仍可能重识别', '能，没有姓名就无法定位个人', '只要模型可解释就不会泄露隐私', '只要加密存储就可以任意公开'], { quickReasons: ['准标识符组合可能重新关联个人', '可解释性与隐私保护不是同一性质', '我觉得不含姓名就已经匿名'], takeaway: takeaway('脱敏须考虑关联攻击与使用场景。', '移除直接标识符不是匿名性的充分条件。') });
export const universalLessons = [pointerLesson, spaceLesson, gaussianLesson, mzmLesson, rcStepLesson, tflnLesson, ethicsLesson, privacyLesson, diffractionLesson];
