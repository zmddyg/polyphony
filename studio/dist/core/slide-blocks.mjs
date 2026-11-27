import { blockText, validateSlideBlocks } from './lecture-score.mjs';

const cells = line => line.trim().replace(/^\|\s*|\s*\|$/g, '').split(/\s*[|｜]\s*/);
const fence = line => /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
const list = line => /^\s*(?:(\d+)[.)、]\s+|([-+*])\s+)(.*)$/.exec(line);
const tableRule = line => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const graphNode = String.raw`([\p{L}\p{N}_][\p{L}\p{N}_.-]*)(?:\s*\[([^\]]*)\])?`;
const nodeLine = new RegExp(`^${graphNode}$`, 'u');
const edgeLine = new RegExp(String.raw`^${graphNode}\s*-->\s*(?:\|([^|]*)\|\s*)?${graphNode}$`, 'u');

function readDiagram(lines) {
  const nodes = new Map(), edges = [];
  let direction = 'LR', title;
  const label = value => value?.trim().replace(/^"(.*)"$/u, '$1').trim();
  const node = (id, text) => {
    const existing = nodes.get(id);
    nodes.set(id, { id, label: label(text) || existing?.label || id });
  };
  for (const raw of lines) {
    const line = raw.trim().replace(/;\s*$/u, '').trim();
    if (!line || line.startsWith('%%')) continue;
    const header = /^(?:(?:flowchart|graph|direction)\s+)?(LR|TB|TD)$/iu.exec(line);
    if (header) { direction = header[1].toUpperCase() === 'LR' ? 'LR' : 'TB'; continue; }
    const caption = /^title\s*[:：]\s*(.+)$/iu.exec(line);
    if (caption) { title = caption[1]; continue; }
    const connection = edgeLine.exec(line);
    if (connection) {
      const [, from, fromLabel, edgeLabel, to, toLabel] = connection;
      node(from, fromLabel);
      node(to, toLabel);
      edges.push({ from, to, ...(edgeLabel && { label: label(edgeLabel) }) });
      continue;
    }
    const declaration = nodeLine.exec(line);
    if (!declaration) return null;
    node(declaration[1], declaration[2]);
  }
  return nodes.size < 2 ? null : { type: 'diagram', kind: 'flow', direction, ...(title && { title }), nodes: [...nodes.values()], edges };
}

function readBlocks(raw, plain = false) {
  const source = raw.replace(/\r\n?/g, '\n').split('\n'), blocks = [];
  let i = 0;
  while (i < source.length) {
    const line = source[i];
    if (!line.trim()) { i++; continue; }
    const opening = fence(line);
    if (opening) {
      const code = [], marker = opening[1]; i++;
      while (i < source.length && !source[i].trim().startsWith(marker)) code.push(source[i++]);
      if (i < source.length) i++;
      const language = opening[2].trim();
      const diagram = /^(?:diagram|mermaid)$/iu.test(language) ? readDiagram(code) : null;
      if (diagram) { blocks.push(diagram); continue; }
      const column = { title: '', language, code: code.join('\n') };
      const previous = blocks.at(-1);
      if (previous?.type === 'code') blocks.splice(-1, 1, { type: 'code-pair', left: { title: previous.title, language: previous.language, code: previous.code }, right: column });
      else blocks.push({ type: 'code', ...column });
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      const items = []; let content = line.trim().slice(2); i++;
      if (content.endsWith('$$')) content = content.slice(0, -2);
      else {
        while (i < source.length && !source[i].includes('$$')) content += '\n' + source[i++];
        if (i < source.length) content += '\n' + source[i++].split('$$')[0];
      }
      items.push(content.trim()); blocks.push({ type: 'formula', items }); continue;
    }
    if ((line.includes('|') && tableRule(source[i + 1] ?? '')) || (plain && line.trim() === '表格' && /[|｜]/.test(source[i + 1] ?? ''))) {
      const title = plain && line.trim() === '表格' ? source[i++].trim() : '';
      const headers = cells(source[i++]), rows = [];
      if (tableRule(source[i] ?? '')) i++;
      while (i < source.length && /[|｜]/.test(source[i]) && source[i].trim()) {
        const row = cells(source[i]);
        if (row.length !== headers.length) break;
        rows.push(row); i++;
      }
      blocks.push({ type: 'table', title, headers, rows }); continue;
    }
    if (plain && /^(?: {4}|\t)\S?/.test(line)) {
      const code = [];
      while (i < source.length && /^(?: {4}|\t)/.test(source[i])) code.push(source[i++].replace(/^(?: {4}|\t)/, ''));
      blocks.push({ type: 'code', title: '', language: '', code: code.join('\n') }); continue;
    }
    const item = list(line);
    if (item) {
      const ordered = Boolean(item[1]), items = [];
      while (i < source.length) { const next = list(source[i]); if (!next || Boolean(next[1]) !== ordered) break; items.push(next[3]); i++; }
      blocks.push({ type: ordered ? 'steps' : 'bullets', items }); continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < source.length && /^\s*>\s?/.test(source[i])) quote.push(source[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'callout', text: quote.join('\n'), tone: 'note' }); continue;
    }
    const previous = blocks.at(-1);
    if (previous?.type === 'callout' && previous.title === '') previous.text += '\n' + line;
    else blocks.push({ type: 'callout', title: '', text: line, tone: 'note' });
    i++;
  }
  return validateSlideBlocks(blocks);
}

export function parseMarkdownDeck(title, rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) throw Error('请填写讲义正文。');
  const sections = []; let current = [], heading = '', inFence = null, inFormula = false;
  const flush = () => { if (current.some(line => line.trim())) sections.push({ heading, raw: current.join('\n') }); current = []; heading = ''; };
  for (const line of rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const marker = fence(line);
    if (marker) { if (!inFence) inFence = marker[1]; else if (marker[1][0] === inFence[0] && marker[1].length >= inFence.length) inFence = null; }
    if (!inFence && !marker && /^\s*\$\$/.test(line) && (line.match(/\$\$/g)?.length ?? 0) % 2) inFormula = !inFormula;
    const pageHeading = !inFence && !inFormula && /^(#{1,2})\s+(.+)$/.exec(line);
    if (!inFence && !inFormula && !marker && /^\s*---\s*$/.test(line)) { flush(); continue; }
    if (pageHeading) { flush(); heading = pageHeading[2].trim(); current.push(heading); }
    else current.push(line);
  }
  flush();
  const pages = sections.map((section, i) => {
    const blocks = readBlocks(section.raw);
    return { number: i + 1, title: section.heading || (i ? `${title} · ${i + 1}` : title), blocks, text: blocks.map(blockText).join('\n'), images: [], speakerNotes: '' };
  });
  return { name: title, title, type: 'markdown', pages };
}

export function inferBlocksFromPlainSlide(page) {
  const copy = structuredClone(page);
  if (page.preview || page.images?.length || page.blocks?.length || !page.text?.trim()) return copy;
  // Keep the source transcript byte-for-byte; inferred blocks only change its presentation.
  copy.blocks = readBlocks(page.text, true);
  return copy;
}
