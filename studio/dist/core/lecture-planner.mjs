// These are the platform activities a teacher can attach to an imported page.
const patterns = [
  ['mzi', /马赫.{0,5}曾德|Mach.{0,4}Zehnder|\bMZI\b|干涉仪.{0,40}(?:端口|出口|分束|相位)/iu],
  ['rc', /\bRC\b.{0,40}(?:电路|充电|放电|暂态|时间常数|circuit|charg)|(?:一阶|电容).{0,30}(?:充放电|充电|放电|时间常数|换路)/iu],
  ['history', /史料互证|史料.{0,20}(?:来源|对照|核对)|(?:primary sources?).{0,28}(?:compar|corroborat)/iu],
  ['blackbox', /(?:数字|函数|数列|规则).{0,15}黑箱|(?:黑箱|black.box).{0,30}(?:输入|规则|input|rule)/iu],
];
export const lecturePlanKinds = patterns.map(([kind]) => kind);
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
    for (const [kind, pattern] of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      suggestions.push({ pageNumber: page.number, kind, reason: '本页提到「' + match[0] + '」。' });
      break;
    }
  }
  return {source:'local',suggestions,scannedPages:pages.length,totalPages:pages.length};
}

export function challengeForFrame(frame) {
  if (!frame) return null;
  const page = {number: frame.pageNumber, title: frame.title, text: (frame.body ?? []).join(' ')};
  const kind = localLecturePlan([page]).suggestions[0]?.kind;
  return kind === 'mzi' ? 'light' : kind === 'rc' ? 'rc' : null;
}

export function validatePlanSuggestions(raw, pages) {
  if (!Array.isArray(raw?.suggestions) || raw.suggestions.length > pages.length) throw Error('排课建议格式无效。');
  const seen = new Set();
  return raw.suggestions.map(item => {
    const page = pages.find(row => row.number === item?.pageNumber);
    if (!page || seen.has(page.number) || !lecturePlanKinds.includes(item.kind) ||
        typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length>96 ||
        !(page.title+' '+page.text).includes(item.quote)) throw Error('排课建议没有可核对的原页引文。');
    seen.add(page.number);
    return {pageNumber:page.number, kind:item.kind, reason:'原页写有「'+item.quote+'」。'};
  });
}
