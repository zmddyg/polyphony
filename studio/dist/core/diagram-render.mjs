import { esc } from '../ui.mjs';
import { blockText, validateSlideBlocks } from './lecture-score.mjs';
import { renderRichMathHtml } from './math-render.mjs';

let markerSeq = 0;
const labelSize = 18;
const subSize = 15;
const edgeSize = 14;
const lineHeight = 23;
const subHeight = 19;
const cardPadding = 32;
const ink = '#274462';
const lineInk = '#617e9a';
const tones = {
  primary: ['#eef5ff', '#3978ba'],
  accent: ['#edf8f4', '#398779'],
  warn: ['#fff5e6', '#ad702c'],
  neutral: ['#f3f7fc', '#748ca6'],
};
const characterMap = (keys, values) => Object.fromEntries(Array.from(keys, (key, i) => [key, values[i]]));
const subscripts = characterMap('0123456789+-=()aehijklmnoprstuvx', '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ');
const superscripts = characterMap('0123456789+-=()in', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ');
const symbols = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
  Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', approx: '≈', neq: '≠', ne: '≠', le: '≤', leq: '≤',
  ge: '≥', geq: '≥', circ: '°', degree: '°', to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  infty: '∞', partial: '∂', nabla: '∇', ell: 'ℓ', hbar: 'ℏ', propto: '∝', perp: '⟂', left: '', right: '',
  sin: 'sin', cos: 'cos', tan: 'tan', sinc: 'sinc',
};
const diagramNames = { flow: '流程示意图', compare: '并列对比图', concept: '概念关系图' };

function diagramGlyphs(value) {
  const text = value.replace(/\$\$([^$]+)\$\$|\$([^$]+)\$/gu, '$1$2')
    .replace(/\\+[()[\]]/gu, '')
    .replace(/\\+frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/gu, '($1)/($2)')
    .replace(/\\+(?:mathrm|mathbf|mathit|text|operatorname)\s*\{([^{}]*)\}/gu, '$1')
    .replace(/\\+([A-Za-z]+)/gu, (_, name) => Object.hasOwn(symbols, name) ? symbols[name] : name)
    .replace(/\\+[,;: ]/gu, ' ').replace(/\\+!?/gu, '').replace(/\s+/gu, ' ').trim();
  return [...text.matchAll(/([_^])(?:\{([^{}]{1,30})\}|([+-]?\d+|[A-Za-z]+|\p{Script=Greek}))|./gu)].map(([whole, marker, grouped, plain]) => {
    if (!marker) return { text: whole };
    const scriptText = grouped ?? plain;
    const glyphs = Array.from(scriptText, char => (marker === '_' ? subscripts : superscripts)[char]);
    return glyphs.every(Boolean) ? { text: glyphs.join('') } : { text: scriptText, script: marker === '_' ? 'sub' : 'super' };
  });
}

function diagramPlainText(value) {
  return diagramGlyphs(value).map(({ text, script }) => script ? `${script === 'sub' ? '_' : '^'}{${text}}` : text).join('');
}

function charWidth(char, size) {
  if (char === ' ') return size * .36;
  if (/\p{Mark}/u.test(char)) return 0;
  if (/[ilI.,'|!:;]/u.test(char)) return size * .48;
  if (/[MW@%]/u.test(char)) return size * 1.16;
  if (/[mw]/u.test(char)) return size * 1.01;
  if (/[A-Z]/u.test(char)) return size * .81;
  return size * (/^[\x00-\x7f]$/u.test(char) ? .71 : 1.15);
}

const glyphWidth = (glyph, size) => Array.from(glyph.text).reduce((width, char) => width + charWidth(char, size), 0) * (glyph.script ? .72 : 1);
const lineWidth = (glyphs, size) => glyphs.reduce((width, glyph) => width + glyphWidth(glyph, size), 0);

function wrapText(value, size, maxWidth, lineLimit) {
  const glyphs = diagramGlyphs(value);
  const lines = [];
  let index = 0;
  while (index < glyphs.length && lines.length < lineLimit) {
    const start = index;
    let width = 0, lastSpace = -1;
    while (index < glyphs.length && width + glyphWidth(glyphs[index], size) <= maxWidth) {
      if (glyphs[index].text === ' ') lastSpace = index;
      width += glyphWidth(glyphs[index++], size);
    }
    if (index < glyphs.length && lines.length === lineLimit - 1) {
      while (index > start && width + charWidth('…', size) > maxWidth) width -= glyphWidth(glyphs[--index], size);
      lines.push([...glyphs.slice(start, index), { text: '…', truncated: true }]);
      break;
    }
    if (index === start) {
      // A script remains one visual unit when possible.
      const glyph = glyphs[index++];
      const fit = Array.from(glyph.text).slice(0, Math.max(1, Math.floor(maxWidth / size) - 1)).join('');
      lines.push([{ ...glyph, text: `${fit}…`, truncated: true }]);
      continue;
    }
    if (index < glyphs.length && lastSpace > start && lastSpace - start >= (index - start) / 2) index = lastSpace;
    lines.push(glyphs.slice(start, index));
    while (glyphs[index]?.text === ' ') index++;
  }
  return lines;
}

function chunks(values, count) {
  const result = [];
  for (let index = 0; index < values.length; index += count) result.push(values.slice(index, index + count));
  return result;
}

function flowLevels(nodes, edges) {
  const incoming = new Map(nodes.map(node => [node.id, 0]));
  const adjacent = new Map(nodes.map(node => [node.id, []]));
  const levels = new Map(nodes.map(node => [node.id, 0]));
  for (const { from, to } of edges) {
    incoming.set(to, incoming.get(to) + 1);
    adjacent.get(from).push(to);
  }
  const queue = nodes.filter(node => !incoming.get(node.id)).map(node => node.id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const to of adjacent.get(id)) {
      levels.set(to, Math.max(levels.get(to), levels.get(id) + 1));
      incoming.set(to, incoming.get(to) - 1);
      if (!incoming.get(to)) queue.push(to);
    }
  }
  if (queue.length !== nodes.length) return nodes.map(node => [node]);
  const layers = [];
  for (const node of nodes) (layers[levels.get(node.id)] ??= []).push(node);
  return layers;
}

function flowLayout(nodes, edges, direction, { cardWidth, columnGap, rowGap, rowSlot }) {
  const horizontal = direction === 'LR';
  const layers = flowLevels(nodes, edges).flatMap(layer => chunks(layer, horizontal ? 3 : 4));
  const trackLength = horizontal ? 4 : 3;
  const columnSlot = cardWidth + columnGap;
  const trackSets = chunks(layers, trackLength);
  let start = 0;
  return trackSets.flatMap((track, trackIndex) => {
    const crossCount = Math.max(...track.map(layer => layer.length));
    const placed = track.flatMap((layer, index) => {
      const along = trackIndex % 2 ? trackLength - 1 - index : index;
      return layer.map((node, nodeIndex) => {
        const cross = start + nodeIndex + (crossCount - layer.length) / 2;
        return { ...node, x: (horizontal ? along : cross) * columnSlot,
          y: (horizontal ? cross : along) * rowSlot + (rowSlot - rowGap - node.h) / 2 };
      });
    });
    start += crossCount;
    return placed;
  });
}

function compareLayout(nodes, { cardWidth, columnGap, rowGap, rowSlot }) {
  const lanes = new Map();
  if (nodes.some(node => node.group)) {
    for (const node of nodes) {
      const label = node.group ?? '';
      if (!lanes.has(label)) lanes.set(label, []);
      lanes.get(label).push(node);
    }
  } else {
    const laneCount = nodes.length >= 6 ? 3 : 2;
    for (let i = 0; i < laneCount; i++) lanes.set(i, []);
    nodes.forEach((node, i) => lanes.get(Math.floor(i * laneCount / nodes.length)).push(node));
  }
  const groups = [], placed = [];
  let y = 0;
  for (const row of chunks([...lanes], 3)) {
    const laneData = row.map(([label, cards]) => {
      const columnCount = Math.ceil(cards.length / 4);
      return { label: typeof label === 'string' ? label : '', columns: chunks(cards, Math.ceil(cards.length / columnCount)) };
    });
    const header = laneData.some(lane => lane.label) ? 35 : 12;
    const height = Math.max(...laneData.map(lane => lane.columns[0].length)) * rowSlot - rowGap + header + 12;
    let x = 0;
    for (const { label, columns } of laneData) {
      const width = columns.length * (cardWidth + 24);
      groups.push({ x, y, width, height, label });
      columns.forEach((column, col) => column.forEach((node, index) => {
        placed.push({ ...node, x: x + 12 + col * (cardWidth + 24), y: y + header + index * rowSlot });
      }));
      x += width + columnGap;
    }
    y += height + rowGap;
  }
  return { nodes: placed, groups };
}

function conceptLayout([center, ...outer], { cardWidth, columnGap, rowSlot }) {
  const columns = Math.max(3, Math.ceil((outer.length - 2) / 2));
  const xSlots = Array.from({ length: columns }, (_, i) => i - (columns - 1) / 2);
  const ring = [[xSlots[0], 0], ...xSlots.map(x => [x, -1]), [xSlots.at(-1), 0], ...xSlots.toReversed().map(x => [x, 1])];
  const place = (node, [col, row]) => ({
    ...node, x: col * (cardWidth + columnGap) - cardWidth / 2, y: row * rowSlot - node.h / 2,
  });
  return [place(center, [0, 0]), ...outer.map((node, i) => place(node, ring[Math.floor(i * ring.length / outer.length)]))];
}

function hitsCard(points, cards, from, to, cardWidth) {
  return cards.some(card => card !== from && card !== to && points.slice(1).some(([bx, by], i) => {
    const [ax, ay] = points[i];
    return Math.max(ax, bx) >= card.x - 5 && Math.min(ax, bx) <= card.x + cardWidth + 5 &&
      Math.max(ay, by) >= card.y - 5 && Math.min(ay, by) <= card.y + card.h + 5;
  }));
}

function edgePoints(from, to, cards, preferHorizontal, spread, cardWidth) {
  const ax = from.x + cardWidth / 2, bx = to.x + cardWidth / 2;
  if (from === to) {
    const outer = from.x + cardWidth + 22 + spread * 7, top = from.y - 21 - spread * 7;
    return [[from.x + cardWidth + 1, from.y + from.h / 2], [outer, from.y + from.h / 2],
      [outer, top], [ax, top], [ax, from.y - 1]];
  }
  const ay = from.y + from.h / 2, by = to.y + to.h / 2;
  const xGap = Math.abs(ax - bx) - cardWidth, yGap = Math.abs(ay - by) - (from.h + to.h) / 2;
  const horizontal = xGap > 2 && (preferHorizontal || yGap <= 2);
  const sign = Math.sign(horizontal ? bx - ax : by - ay);
  const a = horizontal ? ax + sign * (cardWidth / 2 + 1) : ay + sign * (from.h / 2 + 1);
  const b = horizontal ? bx - sign * (cardWidth / 2 + 1) : by - sign * (to.h / 2 + 1);
  const c = (horizontal ? ay : ax) + spread * 12, d = (horizontal ? by : bx) + spread * 12;
  const point = (along, cross) => horizontal ? [along, cross] : [cross, along];
  const path = (pivot, endPivot = pivot, detour) => detour === undefined
    ? [point(a,c), point(pivot,c), point(pivot,d), point(b,d)]
    : [point(a,c), point(pivot,c), point(pivot,detour), point(endPivot,detour), point(endPivot,d), point(b,d)];
  const direct = path((a + b) / 2);
  if (!hitsCard(direct, cards, from, to, cardWidth)) return direct;

  const lower = Math.min(...cards.map(card => horizontal ? card.y : card.x)) - 20;
  const upper = Math.max(...cards.map(card => horizontal ? card.y + card.h : card.x + cardWidth)) + 20;
  const bands = [lower, upper].sort((x, y) => Math.abs(c-x) + Math.abs(d-x) - Math.abs(c-y) - Math.abs(d-y));
  for (const band of bands) {
    const inset = Math.min(11, Math.abs(a - b) / 3);
    const roundabout = path(a + sign * inset, b - sign * inset, band + spread * 9);
    if (!hitsCard(roundabout, cards, from, to, cardWidth)) return roundabout;
  }
  return direct;
}

function roundedPath(points) {
  const vertices = points.filter(([x, y], i) => !i || x !== points[i-1][0] || y !== points[i-1][1]);
  const path = ['M' + vertices[0].join(' ')];
  for (let i = 1; i < vertices.length - 1; i++) {
    const [x, y] = vertices[i];
    const [ax, ay] = vertices[i - 1], [bx, by] = vertices[i + 1];
    const radius = Math.min(7, Math.hypot(ax-x, ay-y) / 2, Math.hypot(bx-x, by-y) / 2);
    path.push(`L${x + Math.sign(ax-x)*radius} ${y + Math.sign(ay-y)*radius}Q${x} ${y} ${x + Math.sign(bx-x)*radius} ${y + Math.sign(by-y)*radius}`);
  }
  path.push('L' + vertices.at(-1).join(' '));
  return path.join('');
}

function labelSegments(points) {
  const vertices = points.filter(([x, y], i) => !i || x !== points[i - 1][0] || y !== points[i - 1][1]);
  // A straight connector can include a routing pivot at its midpoint.
  const turns = vertices.filter(([x, y], i) => {
    if (!i || i === vertices.length - 1) return true;
    const [ax, ay] = vertices[i - 1], [bx, by] = vertices[i + 1];
    return !(ay === y && by === y && (x - ax) * (bx - x) > 0) &&
      !(ax === x && bx === x && (y - ay) * (by - y) > 0);
  });
  return turns.slice(1).map(([bx, by], i) => {
    const [ax, ay] = turns[i];
    return { x: (ax + bx) / 2, y: (ay + by) / 2, length: Math.abs(ax - bx) + Math.abs(ay - by), horizontal: ay === by };
  }).sort((a, b) => b.length - a.length);
}

function edgeCapsule(label, points, cards, priorLabels, above, { cardWidth, edgeWidth }) {
  if (!label?.trim()) return null;
  const lines = wrapText(label, edgeSize, edgeWidth, 2);
  if (!lines.length) return null;
  const width = Math.max(...lines.map(line => lineWidth(line, edgeSize))) + 16;
  const height = lines.length === 1 ? 20 : 36;
  const segments = labelSegments(points);
  const makeBox = (x, y) => ({ x: x - width / 2, y: y - height / 2, width, height, lines, label });
  const occupied = [...cards.map(card => ({ x: card.x, y: card.y, width: cardWidth, height: card.h })), ...priorLabels];
  const overlaps = box => occupied.some(area => box.x < area.x + area.width + 3 && box.x + box.width > area.x - 3 &&
    box.y < area.y + area.height + 3 && box.y + box.height > area.y - 3);
  const horizontal = above ? segments.filter(segment => segment.horizontal) : [];
  const options = horizontal.length ? horizontal : segments;
  const offset = height / 2 + 7;
  for (const dy of horizontal.length ? [-offset, -offset - height - 5, -2 * (height + 8)] : [0, -offset, offset, -2 * offset, 2 * offset]) {
    for (const {x, y} of options) {
      const box = makeBox(x, y + dy);
      if (!overlaps(box)) return box;
    }
  }
  const x = options[0]?.x ?? points[0][0];
  return makeBox(x, Math.min(...occupied.map(area => area.y)) - height / 2 - 5);
}

function textAt(line, x, y, size, weight, anchor = 'middle') {
  const text = line.map(({ text, script }) => script
    ? `<tspan baseline-shift="${script}" font-size="72%">${esc(text)}</tspan>` : esc(text)).join('');
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central">${text}</text>`;
}

function nodeCard({ x, y, h, label, sub, labelLines, subLines, tone }, cardWidth) {
  const [fill, stripe] = tones[tone];
  const mid = x + cardWidth / 2;
  return `<g class="diagram-node"><title>${esc([label, sub].filter(Boolean).map(diagramPlainText).join('\n'))}</title>
    <rect x="${x}" y="${y}" width="${cardWidth}" height="${h}" rx="9" fill="${fill}" stroke="${stripe}"/>
    <rect x="${x + 6}" y="${y + 8}" width="4" height="${h - 16}" rx="2" fill="${stripe}"/>
    ${labelLines.map((line, i) => textAt(line, mid, y + 11 + lineHeight * (i + .5), labelSize, 650)).join('')}
    ${subLines.map((line, i) => textAt(line, mid, y + 13 + labelLines.length * lineHeight + subHeight * (i + .5), subSize, 450)).join('')}</g>`;
}

function laneShape({ x, y, width, height, label }) {
  const [caption] = wrapText(label, 15, width - 24, 1);
  return `<g class="diagram-lane"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="#eaf1f9" stroke="#cad9e9"/>
    ${caption ? textAt(caption, x + 13, y + 18, 15, 650, 'start') : ''}</g>`;
}

function layoutDiagram(block) {
  const [diagram] = validateSlideBlocks([{ ...block, type: 'diagram' }]);
  const cardWidth = Math.ceil(Math.min(228, Math.max(156, ...diagram.nodes.map(node => cardPadding + Math.max(
    lineWidth(diagramGlyphs(node.label), labelSize), lineWidth(diagramGlyphs(node.sub ?? ''), subSize),
  )))));
  const edgeWidth = Math.min(142, Math.max(0, ...diagram.edges.map(edge => lineWidth(diagramGlyphs(edge.label ?? ''), edgeSize))));
  const rowGap = edgeWidth > 110 ? 58 : 44;
  const measured = diagram.nodes.map((node, i) => {
    const subLines = wrapText(node.sub ?? '', subSize, cardWidth - cardPadding, 2);
    const labelLines = wrapText(node.label, labelSize, cardWidth - cardPadding, 2);
    return { ...node, labelLines, subLines, h: 22 + lineHeight * labelLines.length + (subLines.length ? subHeight * subLines.length + 2 : 0),
      tone: node.tone ?? (diagram.kind === 'concept' && i === 0 ? 'primary' : 'neutral') };
  });
  const metrics = { cardWidth, edgeWidth, rowGap, columnGap: Math.max(72, edgeWidth + 52),
    rowSlot: Math.max(...measured.map(node => node.h)) + rowGap };
  const { nodes, groups } = diagram.kind === 'compare' ? compareLayout(measured, metrics) : {
    nodes: diagram.kind === 'concept' ? conceptLayout(measured, metrics) : flowLayout(measured, diagram.edges, diagram.direction, metrics), groups: [],
  };
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pairKey = ({ from, to }) => JSON.stringify([from, to].sort());
  const totals = new Map(), used = new Map();
  for (const edge of diagram.edges) {
    const key = pairKey(edge);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const priorLabels = [];
  const labelAbove = diagram.kind === 'flow' && diagram.direction === 'LR';
  const links = diagram.edges.map(edge => {
    const key = pairKey(edge), index = used.get(key) ?? 0, total = totals.get(key);
    used.set(key, index + 1);
    const spread = total === 1 ? 0 : 2 * index / (total - 1) - 1;
    const points = edgePoints(byId.get(edge.from), byId.get(edge.to), nodes, diagram.direction === 'LR', spread, cardWidth);
    const capsule = edgeCapsule(edge.label, points, nodes, priorLabels, labelAbove, metrics);
    if (capsule) priorLabels.push(capsule);
    return { points, capsule, from: edge.from, to: edge.to };
  });
  return { diagram, nodes, groups, links, cardWidth };
}

export function validateDiagramTypography(block) {
  const { nodes, groups, links } = layoutDiagram(block);
  const truncated = lines => lines.some(line => line.some(glyph => glyph.truncated));
  const issues = [];
  for (const node of nodes) {
    if (truncated(node.labelLines)) issues.push(`节点 ${node.id} 的标签显示不全。`);
    if (truncated(node.subLines)) issues.push(`节点 ${node.id} 的说明显示不全。`);
  }
  for (const group of groups) {
    if (truncated(wrapText(group.label, 15, group.width - 24, 1))) issues.push(`分组「${group.label.slice(0, 24)}」的标签显示不全。`);
  }
  for (const { from, to, capsule } of links) {
    if (capsule && truncated(capsule.lines)) issues.push(`连线 ${from} → ${to} 的标签显示不全。`);
  }
  return issues;
}

export function renderDiagramSvg(block) {
  const { diagram, nodes, groups, links, cardWidth } = layoutDiagram(block);
  const boxes = [...nodes.map(node => ({ ...node, width: cardWidth, height: node.h })), ...groups];
  for (const { points, capsule } of links) {
    boxes.push(...points.map(([x, y]) => ({ x, y, width: 0, height: 0 })));
    if (capsule) boxes.push(capsule);
  }
  const left = Math.floor(Math.min(...boxes.map(box => box.x)) - 10);
  const top = Math.floor(Math.min(...boxes.map(box => box.y)) - 10);
  const width = Math.ceil(Math.max(...boxes.map(box => box.x + box.width)) - left + 10);
  const height = Math.ceil(Math.max(...boxes.map(box => box.y + box.height)) - top + 10);
  const marker = `diag-arrow-${++markerSeq}`;
  const name = diagram.title ? diagramPlainText(diagram.title) : diagramNames[diagram.kind];
  const caption = diagram.title ? `<figcaption class="slide-diagram-caption" title="${esc(name)}">${renderRichMathHtml(diagram.title)}</figcaption>` : '';
  const arrows = links.map(({ points }) => `<path d="${roundedPath(points)}" fill="none" stroke="${lineInk}" stroke-width="1.8" marker-end="url(#${marker})"/>`).join('');
  const capsules = links.flatMap(({ capsule }) => {
    if (!capsule) return [];
    const { x, y, width, height, lines, label } = capsule;
    return `<g class="diagram-edge-label"><title>${esc(diagramPlainText(label))}</title><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="#fff" stroke="#aac0d6"/>
      ${lines.map((line, i) => textAt(line, x + width / 2, y + height / 2 + (i - (lines.length - 1) / 2) * 16, edgeSize, 550)).join('')}</g>`;
  }).join('');
  return `<figure class="slide-diagram" data-diagram-kind="${diagram.kind}" data-diagram-direction="${diagram.direction}">${caption}
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(name)}" fill="${ink}" font-family="system-ui, sans-serif">
      <desc>${esc(blockText(diagram).split('\n').map(diagramPlainText).join('\n'))}</desc>
      <defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0 0L8 4L0 8Z" fill="${lineInk}"/></marker></defs>
      ${groups.map(laneShape).join('')}${arrows}${capsules}${nodes.map(node => nodeCard(node, cardWidth)).join('')}
    </svg></figure>`;
}
