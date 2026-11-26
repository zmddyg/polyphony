import { pointerLesson, spaceLesson, gaussianLesson, mzmLesson, rcStepLesson, tflnLesson, ethicsLesson, privacyLesson } from './universal-lessons.mjs';
import { COMBAT_DECKS, combatMaterial } from './combat-decks.mjs';
export const DEMO_VERSION = 'sha256-5bf19c9eaa78270917f24d4e453df183a7544f46fe5c02c97e297ae83180ec56';
export const tflnSource = 'https://opg.optica.org/col/abstract.cfm?uri=col-19-6-060010';
const page = (number, title, text, interaction) => ({ number, title, text, images: [], ...(interaction && { showcaseLesson: interaction }) });
export const SHOWCASE_DECKS = [
  { id: 'deck-foundation', icon: '📘', label: 'C语言与线性代数', title: 'C 语言指针内存与线性代数空间精讲', pages: [
    page(1, '从内存寻址到线性变换', '本课程连接程序中的有效对象与数学中的有效映射。先建立几何直觉，再检查每一步的适用前提。'),
    page(2, pointerLesson.title, pointerLesson.moduleConfig.steps.map(s=>s.line+'. '+s.content).join('\n'), pointerLesson),
    page(3, 'Gilbert Strang：四个基本子空间', 'A 为 m×n 矩阵，秩为 r。列空间和行空间维数均为 r；零空间维数 n−r；左零空间维数 m−r。Ax=0 只有零解意味着 r=n，即列满秩；矩形矩阵不一定行满秩。', spaceLesson),
    page(4, '傅里叶高斯波包：时频尺度反比律', gaussianLesson.moduleConfig.formulaDisplay+'\n'+gaussianLesson.moduleConfig.insightNote+'\n时域 f(x)=exp(-a*x^2)；频域 F(w)=sqrt(pi/a)*exp(-w^2/(4*a))。', gaussianLesson),
    page(5, '本章小结与课后自检', '检查指针所指对象是否存在、是否存活；区分行满秩和列满秩；用参数变化检验时频尺度。'),
  ] },
  { id: 'deck-photonics', icon: '🔬', label: '光电调制与探测', title: '电光调制与高速光电探测链路', pages: [
    page(1, '相干光通信发射与接收信号链总览', '光源 → 电光调制 → 传输与滤波 → 光电探测 → 电路读出。每个器件指标都须回到完整链路检查。'),
    page(2, '非理想 MZM 干涉传输与消光比', mzmLesson.moduleConfig.formulaDisplay+'\n'+mzmLesson.moduleConfig.insightNote+' 单臂 3 dB 额外损耗时静态 ER 约为 15.3 dB。', mzmLesson),
    page(3, rcStepLesson.title, rcStepLesson.moduleConfig.steps.map(s=>s.line+'. '+s.content).join('\n'), rcStepLesson),
    page(4, 'TFLN：VπL 与带宽权衡', '增强电光重叠、增加电极长度可降低驱动电压，但行波微波衰减、阻抗匹配和光群速度失配仍限制频响。VπL 更小不必然意味着带宽更高。', tflnLesson),
    page(5, '光电链路工程避坑小结', '把功率损耗转换成振幅；先确定电容初值；同时检查调制效率、频响、损耗与链路预算。'),
  ] },
  { id: 'deck-seminar', icon: '💬', label: 'AI与工程伦理导论', title: '人工智能赋能与工程伦理思辨', pages: [
    page(1, '百人大课：当 AI 面临不确定性', '自动驾驶与医疗 AI 都需要处理不确定性。今天先独立作出判断，再用证据质询自己的取舍。'),
    page(2, '高风险场景 AI 决策权分配方案权衡', '医疗 AI 总体准确率 96%，罕见病例子群仅 78%；人工复核增加 2 分钟。系统可记录并审计每次决策。比较可靠性、责任与可申诉性、部署成本。', ethicsLesson),
    page(3, '训练数据脱敏与可解释性迷思', '删除姓名不等于完成匿名化。精确时间、位置、罕见诊断等准标识符可能组合重识别。可解释性和隐私保护属于不同性质。', privacyLesson),
    page(4, '研讨总结与行动清单', '标出每个方案的价值排序；检查子群表现、误判代价、责任归属与申诉路径。说明什么新证据会让你改答。'),
  ] },
];
const escape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
SHOWCASE_DECKS.push(...COMBAT_DECKS);
const diagrams = new Map();
for (const deck of SHOWCASE_DECKS) for (const p of deck.pages) {
  if(deck.native) continue;
  const lines = [...p.text.matchAll(/.{1,48}/gu)].map(m=>m[0]).slice(0,12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#101e36"/><g font-family="Microsoft YaHei, sans-serif"><text x="90" y="100" fill="#8da8ca" font-size="26">${escape(deck.title)}</text><text x="90" y="185" fill="#ffffff" font-size="38">${escape(p.title)}</text>${lines.map((line,i)=>`<text x="90" y="280" dy="${i*40}" fill="#dbe8f6" font-size="26">${escape(line)}</text>`).join('')}<text x="90" y="820" fill="#7cdbcd" font-size="25">共演智课 · 多学科教学示例 / P${p.number}</text></g></svg>`;
  diagrams.set(deck.id+'/'+p.number,'data:image/svg+xml;base64,'+btoa(String.fromCharCode(...new TextEncoder().encode(svg))));
}
const knownDiagrams = new Set(diagrams.values());
export const isDemoDiagram = src => knownDiagrams.has(src);
export function createDemoMaterial(id = 'deck-foundation') {
  if(COMBAT_DECKS.some(d=>d.id===id)) return combatMaterial(id);
  const deck = SHOWCASE_DECKS.find(d=>d.id===id);
  if (!deck) throw new Error('未知示范课程。');
  const versions={'deck-foundation':DEMO_VERSION,'deck-photonics':'sha256-79d6f063369efa298cb47655c4f13a3d95a0f9c470f4af52f2e370271956719e','deck-seminar':'sha256-eb7717e8ea09343627a1153357b6552f5fca9890188fc1c841bfbc5b45599ebf'};
  return { name: deck.title, title: deck.title, showcaseId: deck.id, versionId: versions[id], type: 'text', warnings: [], pages: structuredClone(deck.pages).map(p=>({...p,preview:diagrams.get(deck.id+'/'+p.number)})) };
}
