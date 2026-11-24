// These are the platform activities a teacher can attach to an imported page.
const patterns = [
  ['mzi', /马赫.{0,5}曾德|Mach.{0,4}Zehnder|\bMZI\b|干涉仪.{0,40}(?:端口|出口|分束|相位)/iu],
  ['rc', /\bRC\b.{0,40}(?:电路|充电|放电|暂态|时间常数|circuit|charg)|(?:一阶|电容).{0,30}(?:充放电|充电|放电|时间常数|换路)/iu],
  ['history', /史料互证|史料.{0,20}(?:来源|对照|核对)|(?:primary sources?).{0,28}(?:compar|corroborat)/iu],
  ['blackbox', /(?:数字|函数|数列|规则).{0,15}黑箱|(?:黑箱|black.box).{0,30}(?:输入|规则|input|rule)/iu],
  ['inquiry', /(?:思考题|课堂讨论|概念辨析|随堂测验|小组讨论|例题\s*\d|判断正误|下列(?:哪种|哪项|说法)|为什么[^。\n]{4,40}[？?]|conceptual\s+check|think.?pair.?share)/iu],
];
export const lecturePlanKinds = patterns.map(([kind]) => kind);
const modelPageLimit = 72;

const normalizeSpace = text => String(text ?? '').replace(/\s+/gu, ' ').trim();
const compactSpace = text => String(text ?? '').replace(/\s+/gu, '');

export function plannerPages(material) {
  return (material?.pages ?? []).filter(page => !page.hidden).map(page => ({
    number: page.number,
    title: String(page.title ?? '').slice(0, 160),
    text: String(page.text ?? '').slice(0, 550),
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
      if (kind === 'inquiry' && normalizeSpace(text).length < 24) continue;
      const match = text.match(pattern);
      if (!match) continue;
      suggestions.push({ pageNumber: page.number, kind, reason: '本页提到「' + match[0] + '」。' });
      break;
    }
  }
  return { source: 'local', suggestions, scannedPages: pages.length, totalPages: pages.length };
}

export function challengeForFrame(frame) {
  if (!frame) return null;
  if (frame.experiment?.kind) return frame.experiment.kind;
  const page = { number: frame.pageNumber, title: frame.title, text: (frame.body ?? []).join(' ') };
  const kind = localLecturePlan([page]).suggestions[0]?.kind;
  return kind === 'mzi' ? 'light' : kind === 'rc' ? 'rc' : kind === 'blackbox' ? 'blackbox' : null;
}

export function validatePlanSuggestions(raw, pages) {
  if (!Array.isArray(raw?.suggestions) || raw.suggestions.length > pages.length) throw Error('排课建议格式无效。');
  const seen = new Set();
  const accepted = [];
  for (const item of raw.suggestions) {
    const page = pages.find(row => row.number === item?.pageNumber);
    if (!page || seen.has(page.number) || !lecturePlanKinds.includes(item.kind)) continue;
    if (typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 96) continue;
    const source = page.title + ' ' + page.text;
    const compactQuote = compactSpace(item.quote);
    const matched = source.includes(item.quote)
      || normalizeSpace(source).includes(normalizeSpace(item.quote))
      || (compactQuote.length >= 4 && compactSpace(source).includes(compactQuote));
    if (!matched) continue;
    seen.add(page.number);
    accepted.push({ pageNumber: page.number, kind: item.kind, reason: '原页写有「' + item.quote.trim() + '」。' });
  }
  if (raw.suggestions.length > 0 && !accepted.length) throw Error('排课建议没有可核对的原页引文。');
  return accepted;
}
