// Zero-dependency safe MathML Core builder for OOXML OMML equations and science templates.

const formulaElements = new Set([
  'math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mfrac', 'msqrt', 'mroot', 'msub', 'msup',
  'msubsup', 'mmultiscripts', 'mprescripts', 'none', 'munder', 'mover', 'munderover',
  'mtable', 'mtr', 'mtd', 'mspace',
]);

function allowedFormulaAttributes(tag, source) {
  const attr = /\s+([a-z]+)\s*=\s*(["'])([^"'<>]*)\2/gy;
  const seen = new Set();
  let offset = 0;
  while (offset < source.length) {
    const match = attr.exec(source);
    if (!match) return !source.slice(offset).trim();
    const [, name, , value] = match;
    const allowed = (tag === 'math' && name === 'xmlns' && value === 'http://www.w3.org/1998/Math/MathML')
      || (tag === 'math' && name === 'display' && /^(?:block|inline)$/u.test(value))
      || (tag === 'mover' && name === 'accent' && /^(?:true|false)$/u.test(value))
      || (tag === 'mspace' && name === 'width' && /^\d+(?:\.\d+)?(?:em|ex|px)$/u.test(value));
    if (!allowed || seen.has(name)) return false;
    seen.add(name);
    offset = attr.lastIndex;
  }
  return true;
}

// Validate the same small MathML dialect at import and at both HTML renderers.
export function isSafeMathML(value) {
  if (typeof value !== 'string' || value.length > 8000) return false;
  const source = value.trim();
  if (!/^<math(?:\s|>)/u.test(source) || !source.endsWith('</math>')) return false;
  const tokens = /<\/?([a-z]+)\b([^<>]*)>|[^<]+/gy;
  const stack = [];
  let offset = 0;
  while (offset < source.length) {
    const token = tokens.exec(source);
    if (!token) return false;
    offset = tokens.lastIndex;
    const [raw, tag, tail] = token;
    if (!tag) {
      if (!stack.length) return false;
    } else if (raw.startsWith('</')) {
      if (tail.trim() || stack.pop() !== tag || (!stack.length && offset !== source.length)) return false;
    } else {
      if (!formulaElements.has(tag) || (tag === 'math') !== (stack.length === 0)) return false;
      const empty = tail.endsWith('/');
      if (!allowedFormulaAttributes(tag, empty ? tail.slice(0, -1) : tail)) return false;
      if (empty && tag === 'math') return false;
      if (!empty) stack.push(tag);
    }
  }
  return stack.length === 0;
}

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function token(text) {
  const value = String(text ?? '');
  if (!value) return '';
  if (/^\d+(?:\.\d+)?$/u.test(value.trim())) return `<mn>${esc(value.trim())}</mn>`;
  if (/^[+\-−=×·/(),[\]{}|<>≤≥≈≠±∞→]+$/u.test(value.trim())) return `<mo>${esc(value.trim())}</mo>`;
  if (/^[A-Za-zα-ωΑ-ΩΔφπλτρηΩµμ]+$/u.test(value.trim())) return `<mi>${esc(value.trim())}</mi>`;
  return `<mtext>${esc(value)}</mtext>`;
}

function renderOmmlNode(node, { is, child, children, on, mathProperty }) {
  const name = node.localName;
  if (name === 't') return token(node.textContent);
  const arg = part => {
    const el = child(node, 'm', part);
    return el ? renderOmmlNode(el, { is, child, children, on, mathProperty }) : '<mrow></mrow>';
  };
  const wrap = inner => inner ? `<mrow>${inner}</mrow>` : '<mrow></mrow>';
  if (name === 'f') return `<mfrac>${wrap(arg('num'))}${wrap(arg('den'))}</mfrac>`;
  if (name === 'sSub') return `<msub>${wrap(arg('e'))}${wrap(arg('sub'))}</msub>`;
  if (name === 'sSup') return `<msup>${wrap(arg('e'))}${wrap(arg('sup'))}</msup>`;
  if (name === 'sSubSup') return `<msubsup>${wrap(arg('e'))}${wrap(arg('sub'))}${wrap(arg('sup'))}</msubsup>`;
  if (name === 'sPre') return `<mmultiscripts>${wrap(arg('e'))}<mprescripts/>${wrap(arg('sub'))}${wrap(arg('sup'))}</mmultiscripts>`;
  if (name === 'rad') {
    const hideDeg = on(mathProperty(node, 'radPr', 'degHide', '0'));
    const deg = hideDeg ? '' : arg('deg');
    return deg ? `<mroot>${wrap(arg('e'))}${wrap(deg)}</mroot>` : `<msqrt>${wrap(arg('e'))}</msqrt>`;
  }
  if (name === 'nary') {
    const op = `<mo>${esc(mathProperty(node, 'naryPr', 'chr', '∫'))}</mo>`;
    const sub = on(mathProperty(node, 'naryPr', 'subHide', '0')) ? '' : arg('sub');
    const sup = on(mathProperty(node, 'naryPr', 'supHide', '0')) ? '' : arg('sup');
    const head = sub && sup ? `<msubsup>${op}${wrap(sub)}${wrap(sup)}</msubsup>`
      : sub ? `<msub>${op}${wrap(sub)}</msub>`
      : sup ? `<msup>${op}${wrap(sup)}</msup>` : op;
    return `<mrow>${head}${wrap(arg('e'))}</mrow>`;
  }
  if (name === 'd') {
    const begin = esc(mathProperty(node, 'dPr', 'begChr', '('));
    const end = esc(mathProperty(node, 'dPr', 'endChr', ')'));
    const sep = esc(mathProperty(node, 'dPr', 'sepChr', '|'));
    const items = [...children(node)].filter(el => is(el, 'm', 'e'))
      .map(el => renderOmmlNode(el, { is, child, children, on, mathProperty }));
    return `<mrow><mo>${begin}</mo>${items.join(`<mo>${sep}</mo>`)}<mo>${end}</mo></mrow>`;
  }
  if (name === 'func') return `<mrow>${wrap(arg('fName'))}<mo>&#x2061;</mo>${wrap(arg('e'))}</mrow>`;
  if (name === 'limLow') return `<munder>${wrap(arg('e'))}${wrap(arg('lim'))}</munder>`;
  if (name === 'limUpp') return `<mover>${wrap(arg('e'))}${wrap(arg('lim'))}</mover>`;
  if (name === 'bar') {
    const pos = mathProperty(node, 'barPr', 'pos', 'top');
    return pos === 'bot' ? `<munder>${wrap(arg('e'))}<mo>_</mo></munder>` : `<mover>${wrap(arg('e'))}<mo>‾</mo></mover>`;
  }
  if (name === 'acc') {
    const chr = esc(mathProperty(node, 'accPr', 'chr', '\u0302'));
    return `<mover accent="true">${wrap(arg('e'))}<mo>${chr}</mo></mover>`;
  }
  if (name === 'phant') return '';
  const values = [...children(node)]
    .filter(el => is(el, 'm') && !el.localName.endsWith('Pr'))
    .map(el => renderOmmlNode(el, { is, child, children, on, mathProperty }))
    .filter(Boolean);
  if (name === 'm') return `<mrow><mo>[</mo><mtable>${values.join('')}</mtable><mo>]</mo></mrow>`;
  if (name === 'mr') return `<mtr>${values.map(v => `<mtd>${v}</mtd>`).join('')}</mtr>`;
  return values.join('');
}

export function ommlToMathML(node, helpers) {
  const inner = renderOmmlNode(node, helpers).trim();
  if (!inner) return '';
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>${inner}</mrow></math>`;
}

export function rcFormulaMathML({ initial, final, finalNegative, tau }) {
  const diff = finalNegative
    ? `<mo>(</mo><mn>${esc(initial)}</mn><mo>−</mo><mo>(</mo><mn>${esc(final)}</mn><mo>)</mo><mo>)</mo>`
    : `<mo>(</mo><mn>${esc(initial)}</mn><mo>−</mo><mn>${esc(final)}</mn><mo>)</mo>`;
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>` +
    `<msub><mi>V</mi><mi>C</mi></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo>` +
    `<mn>${esc(final)}</mn><mo>+</mo>${diff}` +
    `<msup><mi>e</mi><mrow><mo>−</mo><mfrac><mi>t</mi><mrow><mn>${esc(tau)}</mn><mtext>&nbsp;ms</mtext></mrow></mfrac></mrow></msup>` +
    `<mtext>&nbsp;V</mtext></mrow></math>`;
}

export function mziFormulaMathML() {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>` +
    `<mfrac><msub><mi>P</mi><mi>A</mi></msub><msub><mi>P</mi><mtext>in</mtext></msub></mfrac><mo>=</mo>` +
    `<msup><mi>cos</mi><mn>2</mn></msup><mo>(</mo><mfrac><mrow><mi>Δ</mi><mi>φ</mi></mrow><mn>2</mn></mfrac><mo>)</mo>` +
    `<mo>,</mo><mspace width="0.8em"/>` +
    `<mfrac><msub><mi>P</mi><mi>B</mi></msub><msub><mi>P</mi><mtext>in</mtext></msub></mfrac><mo>=</mo>` +
    `<msup><mi>sin</mi><mn>2</mn></msup><mo>(</mo><mfrac><mrow><mi>Δ</mi><mi>φ</mi></mrow><mn>2</mn></mfrac><mo>)</mo>` +
    `</mrow></math>`;
}
