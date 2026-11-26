// These are the platform activities a teacher can attach to an imported page.
const patterns = [
  ['aliasing', /(?:滤波|光谱|谱线|谱形).{0,30}(?:稀疏|采样|欠采样|反演|盲测)|训练误差|谱.{0,12}混叠/iu],
  ['rc', /\bRC\b|(?:负载|电容|探测前级).{0,30}(?:暂态|带宽|时间常数|充电|放电)|\b(?:100|200)\s*pF\b/iu],
  ['mzi', /\bMZ[IM]\b|马赫.{0,5}曾德|Mach.{0,4}Zehnder|消光比|干涉仪.{0,40}(?:端口|出口|分束|相位)/iu],
  ['concept', /半波电压|V[πΠ]|行波电极|群折射率|带宽|损耗|衍射|色散|谐振|为什么|为何|如何变化|工程折中|折中|推导|公式|电磁|能带|量子|载流子|偏振|耦合|光栅|傅里叶|色差|激光|增益|噪声|阻抗|传输线/iu],
];
export const lecturePlanKinds = ['mzi', 'rc', 'aliasing', 'concept'];
const modelPageLimit = 72;

export function plannerPages(material) {
  return (material?.pages ?? []).filter(page => !page.hidden).map(page => ({
    number:page.number,title:String(page.title ?? '').slice(0,160),text:String(page.text ?? '').slice(0,550),
  }));
}

export function lectureModelPages(pages) {
  const withText = pages.filter(({ title, text }) => title.trim() || text.trim());
  if (withText.length <= modelPageLimit) return withText;
  // The local pass covers every page. Sample text-bearing pages across the full deck.
  return Array.from({ length: modelPageLimit }, (_, index) =>
    withText[Math.floor(index * (withText.length - 1) / (modelPageLimit - 1))]);
}

export function localLecturePlan(pages) {
  const suggestions = [];
  for (const page of pages) {
    const text = page.title + ' ' + page.text;
    if (/^(?:目录|课程目录|contents|课间休息)$/iu.test(page.title?.trim()) && !page.text?.trim()) continue;
    for (const [kind, pattern] of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const quote = text.slice(match.index, match.index + Math.min(80, text.length - match.index)).trim();
      suggestions.push({ pageNumber: page.number, kind, quote, reason: '原页写有「' + quote + '」。' });
      break;
    }
  }
  return {source:'local',suggestions,scannedPages:pages.length,totalPages:pages.length};
}

export function challengeForFrame(frame) {
  if (!frame) return null;
  const page = {number: frame.pageNumber, title: frame.title, text: (frame.body ?? []).join(' ')};
  const kind = localLecturePlan([page]).suggestions[0]?.kind;
  return kind === 'mzi' || kind === 'aliasing' ? 'light' : kind === 'rc' ? 'rc' : null;
}

export function validatePlanSuggestions(raw, pages) {
  if (!Array.isArray(raw?.suggestions) || raw.suggestions.length > pages.length) throw Error('诊断建议格式无效。');
  const seen = new Set();
  return raw.suggestions.map(item => {
    const page = pages.find(row => row.number === item?.pageNumber);
    if (!page || seen.has(page.number) || !lecturePlanKinds.includes(item.kind) ||
        typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length>96 ||
        !(page.title+' '+page.text).includes(item.quote)) throw Error('诊断建议没有可核对的原页引文。');
    seen.add(page.number);
    return {pageNumber:page.number, kind:item.kind, quote:item.quote, reason:'原页写有「'+item.quote+'」。'};
  });
}
