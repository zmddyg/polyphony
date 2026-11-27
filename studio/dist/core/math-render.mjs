import katex from '../vendor/katex/katex.mjs';
import { esc } from '../ui.mjs';
import { formatFormulaHtml } from './formula-text.mjs';

const macros = Object.freeze({ '\\sinc': '\\operatorname{sinc}', '\\degree': '^\\circ' });
const delimiters = { '$': '$', '$$': '$$', '\\(': '\\)', '\\[': '\\]' };
const mathMarkers = new Set([...Object.keys(delimiters), ...Object.values(delimiters)]);
const han = /\p{Script=Han}/u;
const textCommand = /\\(?:text(?:normal|rm|sf|tt|bf|md|it|up)?|operatorname)\s*\{/u;
const mathSignal = /\\[A-Za-z]+|[_^=<>≤≥≠≈≡∝→⇒↔∈∑∏∫√±×÷₀-₉ₐ-ₜ⁰-⁹²³¹]|(?:^|[^\p{L}\d])(?:\d+(?:\.\d+)?|[\p{L})])\s*[-+*/−]\s*(?:\d+(?:\.\d+)?|[\p{L}(])(?![\p{L}\d])/u;
const mathAtom = /^(?:\p{L}|[+−-]?\d+(?:\.\d+)?)$/u;
const unsafeCommand = /(?:^|[^\\])(?:\\\\)*\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)(?![A-Za-z@])/u;
const controlLetters = { '\u000c': 'f', '\t': 't', '\u0008': 'b', '\r': 'r', '\n': 'n' };
const damagedCommand = /(?:\u000c(?:rac|orall)|\t(?:heta|imes|ext(?:normal|rm|sf|tt|bf|md|it|up)?|au|an|o|ilde|frac|riangle(?:q)?)|\u0008(?:eta|ar|egin|ig(?:g)?[lmr]?|inom|oldsymbol|oxed|f|m)|\r(?:ight(?:arrow|leftharpoons|rbrace|tharpoondown|tharpoonup)?|ho|m|ank)|\n(?:abla|e|eq|ot(?:in)?|u|in))(?![A-Za-z])/gu;

export function recoverJsonEscapedLatex(tex) {
  return String(tex ?? '').replace(damagedCommand, match => '\\' + controlLetters[match[0]] + match.slice(1));
}

function hasBareRowBreak(tex) {
  let groups = 0, environments = 0;
  const syntax = /\\(begin|end)\s*\{[A-Za-z*]+\}|\\\\|\\[{}]|[{}]/gu;
  for (const [token, environment] of tex.matchAll(syntax)) {
    if (environment) environments += environment === 'begin' ? 1 : -1;
    else if (token === '{') groups++;
    else if (token === '}') groups--;
    else if (token === '\\\\' && groups === 0 && environments === 0) return true;
  }
  return false;
}

function compile(tex, displayMode, implicit = false) {
  if (!tex) return { message: '公式为空。' };
  if (tex.length > 8192) return { message: '公式过长。' };
  if (unsafeCommand.test(tex)) return { message: '公式包含未允许的链接、图片或 HTML 命令。' };

  // Older formula blocks accept V_tot as shorthand for V_{tot}.
  const source = implicit && !/\\[A-Za-z]/u.test(tex)
    ? tex.replace(/_([A-Za-z]{2,})\b/gu, '_{$1}') : tex;
  const expression = displayMode && hasBareRowBreak(source)
    ? '\\begin{aligned}' + source + '\\end{aligned}' : source;
  try {
    return { html: katex.renderToString(expression, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
      macros: { ...macros },
    }) };
  } catch (error) {
    return { message: error.message };
  }
}

function literalDollars(text) {
  return text.replace(/(\\+)\$/gu, (_, slashes) => (slashes.length % 2 ? slashes.slice(1) : slashes) + '$');
}

const prose = text => formatFormulaHtml(literalDollars(text)).replace(
  /(\*\*|(?<!\*)\*)(?!\*)([^*\r\n]*?)\1(?!\*)/gu,
  (match, marks, value) => {
    if (!value || value.trim() !== value) return match;
    const tag = marks.length === 2 ? 'strong' : 'em';
    return '<' + tag + '>' + value + '</' + tag + '>';
  },
);

export function latexToMathML(tex, { display = false } = {}) {
  const source = String(tex ?? '');
  return compile(recoverJsonEscapedLatex(source).trim(), display).html ?? formatFormulaHtml(literalDollars(source));
}

function inlineDollarCandidate(tex) {
  const trimmed = tex.trim();
  if (/[\r\n]/u.test(tex) || (han.test(tex) && !textCommand.test(tex) && !mathSignal.test(tex))) return false;
  // A pair of literal currency markers can enclose prose with spaces.
  return tex === trimmed || mathSignal.test(tex) || /^[\p{L}\p{N}.]+$/u.test(trimmed) || textCommand.test(tex);
}

function explicitParts(source, block = false) {
  // The escaped tokens shield literal dollars and backticks. The next-token
  // pointers let an earlier math delimiter or code span take precedence.
  const markers = [...source.matchAll(/\\[()[\]$\\\x60]|\x60+|\$+/gu)]
    .filter(([token]) => token === '\x60' || mathMarkers.has(token));
  let nextMath, nextCode;
  const following = new Array(markers.length);
  for (let i = markers.length - 1; i >= 0; i--) {
    if (markers[i][0] === '\x60') {
      following[i] = nextCode;
      nextCode = i;
    } else {
      following[i] = nextMath;
      nextMath = i;
    }
  }
  const parts = [];
  const contentStart = block ? source.search(/\S/u) : -1;
  const contentEnd = block ? source.trimEnd().length : -1;
  let cursor = 0;
  const add = (start, end, part) => {
    if (start > cursor) parts.push({ kind: 'text', value: source.slice(cursor, start) });
    parts.push(part);
    cursor = end;
  };
  for (let i = 0; i < markers.length; i++) {
    const [opening] = markers[i];
    const start = markers[i].index;
    if (start < cursor) continue;
    const right = markers[following[i]];
    if (opening === '\x60') {
      if (!right) continue;
      const value = source.slice(start + 1, right.index);
      if (value && !/[\r\n]/u.test(value)) {
        add(start, right.index + 1, { kind: 'code', value });
        i = following[i];
      }
      continue;
    }
    const closing = delimiters[opening];
    if (!closing) {
      add(start, start + opening.length, { kind: 'math', tex: '', raw: opening, message: '公式缺少开启定界符。' });
      continue;
    }
    if (right?.[0] !== closing) {
      const end = right?.index ?? source.length;
      const tex = recoverJsonEscapedLatex(source.slice(start + opening.length, end)).trim();
      const likelyMath = mathSignal.test(tex) || /^\p{L}$/u.test(tex);
      if (opening !== '$' || (likelyMath && (block || inlineDollarCandidate(tex)))) {
        add(start, end, { kind: 'math', tex, raw: source.slice(start, end), message: '公式缺少闭合定界符。' });
      }
      continue;
    }

    const end = right.index + closing.length;
    const sourceTex = recoverJsonEscapedLatex(source.slice(start + opening.length, right.index));
    const display = opening === '$$' || opening === '\\[' || (start === contentStart && end === contentEnd);
    const message = opening === '$' && !display && !inlineDollarCandidate(sourceTex)
      ? '行内公式定界符之间的内容无效。' : undefined;
    add(start, end, { kind: 'math', tex: sourceTex.trim(), raw: source.slice(start, end), display, message });
    // Consume the closing delimiter even if this expression cannot compile.
    i = following[i];
  }
  if (cursor < source.length) parts.push({ kind: 'text', value: source.slice(cursor) });
  return parts;
}

function splitBlockProse(text) {
  const caption = /^([^:\r\n：$\\{}]+[:：])([\s\S]+)$/u.exec(text);
  const prefix = caption && han.test(caption[1]) ? caption[1] : '';
  // Start with the original leading characters so JSON control escapes at
  // the beginning of the expression survive until recovery.
  const source = (prefix ? caption[2] : text).trimEnd();
  const end = source.replace(/[。；.!?！？]+$/u, '').length - 1;
  const close = source[end];
  const open = { '）': '（', ')': '(' }[close];
  if (!open) return { prefix, source, suffix: '' };
  let depth = 0;
  for (let i = end; i > 0; i--) {
    if (source[i] === close) depth++;
    else if (source[i] === open && --depth === 0) {
      const suffix = source.slice(i);
      const expression = source.slice(0, i).trimEnd();
      if (han.test(suffix) && expression) return { prefix, source: expression, suffix };
      break;
    }
  }
  return { prefix, source, suffix: '' };
}

function mathParts(text, block) {
  const value = String(text ?? '');
  if (!block) return explicitParts(value);
  const { prefix, source, suffix } = splitBlockProse(value);
  let parts = explicitParts(source, true);
  if (!parts.some(part => part.kind === 'math')) {
    const tex = recoverJsonEscapedLatex(source).trim();
    const htmlTag = /<\/?[A-Za-z][\w-]*(?:\s[^>]{0,500})?\/?>/u.test(tex);
    if (parts.some(part => part.kind === 'code') || (!mathSignal.test(tex) && !mathAtom.test(tex)) ||
        ((han.test(tex) || htmlTag) && !textCommand.test(tex))) {
      return explicitParts(value);
    }
    parts = [{ kind: 'math', tex, raw: source, display: true, implicit: true }];
  }
  return [
    ...(prefix ? [{ kind: 'caption', value: prefix }] : []),
    ...parts,
    ...(suffix ? [{ kind: 'caption', value: suffix, suffix: true }] : []),
  ];
}

const compilePart = part => part.message ? { message: part.message } : compile(part.tex, part.display, part.implicit);

export function validateMathSource(text, { block = false } = {}) {
  const errors = [];
  const parts = mathParts(text, block).flatMap(part => part.kind === 'caption' ? explicitParts(part.value) : [part]);
  for (const part of parts) {
    if (part.kind !== 'math') continue;
    const { message } = compilePart(part);
    if (message) errors.push({ tex: part.tex, message });
  }
  return { ok: errors.length === 0, errors };
}

export function renderRichMathHtml(text, { block = false } = {}) {
  return mathParts(text, block).map(part => {
    if (part.kind === 'code') return '<code class="inline-code">' + esc(part.value) + '</code>';
    if (part.kind === 'caption') {
      const style = part.suffix ? ' math-caption--suffix' : '';
      return '<span class="math-caption' + style + '">' + renderRichMathHtml(part.value) + '</span>';
    }
    if (part.kind === 'math') return compilePart(part).html ?? (part.implicit ? prose(part.raw) : esc(part.raw));
    return prose(part.value);
  }).join('');
}
