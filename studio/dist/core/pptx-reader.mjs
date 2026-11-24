import { openPptxPackage, packageRelationshipsPart, resolvePackagePart } from './pptx-package.mjs';

const MB = 1024 * 1024;
const MAX_SLIDES = 1_000;
const MAX_XML_PART = 8 * MB;
const MAX_XML_TOTAL = 72 * MB;
const MAX_IMAGE_PART = 10 * MB;
const MAX_IMAGE_TOTAL = 32 * MB;
const MAX_VISIBLE_IMAGE_TOTAL = 12 * MB;
const MAX_PAGE_TEXT = 32_000;
const schema = 'http://schemas.openxmlformats.org/';
const strict = 'http://purl.oclc.org/ooxml/';
const both = (name, type) => [schema + name + '/2006/' + type, strict + name + '/' + type];
const ns = {
  p: both('presentationml', 'main'),
  a: both('drawingml', 'main'),
  m: both('officeDocument', 'math'),
  c: both('drawingml', 'chart'),
  dgm: both('drawingml', 'diagram'),
  r: both('officeDocument', 'relationships'),
  rel: [schema + 'package/2006/relationships', strict + 'package/relationships'],
  mc: [schema + 'markup-compatibility/2006'],
  a14: ['http://schemas.microsoft.com/office/drawing/2010/main'],
  cx: ['http://schemas.microsoft.com/office/drawing/2014/chartex'],
};
const understood = new Set(Object.values(ns).flat());
const warning = {
  format: 'PPTX 导入保留可读取的文字和原图。版式、图形叠放和动画请在原课件中查看。',
  entry: '课件的入口关系缺失或已损坏，已从标准位置读取。',
  missingSlide: '课件的这一页缺少对应的幻灯片部件，请在原课件中核对。',
  unreadableSlide: '这一页的幻灯片部件无法读取，请在原课件中核对。',
  relationships: '这一页的引用关系无法读取，部分图表或图片可能缺失。',
  layer: '这一页的版式部件无法读取，版式附带的文字或图片可能缺失。',
  math: '公式已按可读取的结构转写，完整的符号与排版请在原页核对。',
  chart: '图表已提取课件缓存的可读取内容，图形、坐标和图例请在原页核对。',
  chartMissing: '这一页含图表，课件缓存中未找到可读取的图表文字或数值。',
  diagram: 'SmartArt 已提取可读取的文字，图形及关联请在原页核对。',
  diagramMissing: '这一页含 SmartArt，请在原页查看图示内容。',
  drawing: '这一页含形状、图示或嵌入对象，请在原页查看完整内容。',
  external: '这一页含外链图片，请在原课件中核对。',
  raster: '这一页的部分图片无法预览，请在原页查看原图。',
  imageLimit: '这一页的部分图片超过预览大小，请在原页查看原图。',
  crop: '图片以嵌入原图显示，裁切位置请在原页核对。',
  textLimit: '这一页的可读取文字超过导入长度，详细内容请在原页核对。',
};

function is(element, kind, name) {
  return !!element && (!name || element.localName === name) && ns[kind].includes(element.namespaceURI);
}

function attribute(element, kind, name) {
  for (const namespace of ns[kind]) {
    const value = element?.getAttributeNS(namespace, name);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function alternateBranch(element) {
  const branches = [...element.children];
  const choices = branches.filter(branch => is(branch, 'mc', 'Choice'));
  return choices.find(choice => (choice.getAttribute('Requires') ?? '').split(/\s+/u)
    .every(prefix => understood.has(choice.lookupNamespaceURI(prefix)))) ??
    branches.find(branch => is(branch, 'mc', 'Fallback')) ?? choices[0];
}

function* children(element) {
  for (const node of element?.children ?? []) {
    if (is(node, 'mc', 'AlternateContent')) yield* children(alternateBranch(node));
    else yield node;
  }
}

function child(element, kind, name) {
  for (const node of children(element)) if (is(node, kind, name)) return node;
  return undefined;
}

function* descendants(element) {
  const stack = [[...children(element)].reverse()];
  while (stack.length) {
    const pending = stack.at(-1);
    if (!pending.length) {
      stack.pop();
      continue;
    }
    const node = pending.pop();
    yield node;
    if (node.children.length) stack.push([...children(node)].reverse());
  }
}

function matching(element, kind, name) {
  const result = [];
  for (const node of descendants(element)) if (is(node, kind, name)) result.push(node);
  return result;
}

function xmlRoot(bytes) {
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) encoding = 'utf-16le';
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) encoding = 'utf-16be';
  const xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error('课件部件包含不受支持的 XML 文档类型声明。');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (!document.documentElement || document.documentElement.localName === 'parsererror' ||
      document.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length) {
    throw new Error('课件的 XML 部件已损坏。');
  }
  return document.documentElement;
}

function readRelationships(root, source, archive) {
  if (!is(root, 'rel', 'Relationships')) throw new Error('课件的部件关系已损坏。');
  const result = new Map();
  for (const item of children(root)) {
    if (!is(item, 'rel', 'Relationship')) continue;
    const id = item.getAttribute('Id');
    if (!id) continue;
    if (result.has(id)) throw new Error('课件的部件关系包含重复编号。');
    const kind = item.getAttribute('Type')?.split('/').at(-1);
    const external = item.getAttribute('TargetMode')?.toLowerCase() === 'external';
    const part = external ? null : resolvePackagePart(source, item.getAttribute('Target'));
    result.set(id, { kind, external, path: archive.part(part)?.path ?? part });
  }
  return result;
}

function relatedPart(relationships, kind) {
  for (const item of relationships?.values() ?? []) if (item.kind === kind) return item;
  return undefined;
}

function jpegSize(bytes, data) {
  let offset = 2;
  while (offset < bytes.length && bytes[offset++] === 0xff) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
    const length = data.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (length >= 7 && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { mime: 'image/jpeg', width: data.getUint16(offset + 5), height: data.getUint16(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function rasterInfo(bytes) {
  if (bytes.length < 13) return null;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const starts = signature => signature.every((byte, index) => bytes[index] === byte);
  const tag = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (starts([0xff, 0xd8, 0xff])) return jpegSize(bytes, data);
  if (bytes.length >= 33 && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && tag(12, 4) === 'IHDR') {
    return { mime: 'image/png', width: data.getUint32(16), height: data.getUint32(20) };
  }
  if (['GIF87a', 'GIF89a'].includes(tag(0, 6))) {
    return { mime: 'image/gif', width: data.getUint16(6, true), height: data.getUint16(8, true) };
  }
  if (bytes.length >= 26 && tag(0, 2) === 'BM') {
    const headerSize = data.getUint32(14, true);
    if (headerSize === 12) return { mime: 'image/bmp', width: data.getUint16(18, true), height: data.getUint16(20, true) };
    if (headerSize >= 40 && bytes.length >= 14 + headerSize) {
      return { mime: 'image/bmp', width: data.getInt32(18, true), height: Math.abs(data.getInt32(22, true)) };
    }
  }
  if (bytes.length >= 30 && tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') {
    const type = tag(12, 4);
    if (type === 'VP8X') {
      const size = offset => 1 + bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
      return { mime: 'image/webp', width: size(24), height: size(27) };
    }
    if (type === 'VP8L' && bytes[20] === 0x2f) {
      const sizes = data.getUint32(21, true);
      return { mime: 'image/webp', width: 1 + (sizes & 0x3fff), height: 1 + ((sizes >>> 14) & 0x3fff) };
    }
    if (type === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { mime: 'image/webp', width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff };
    }
  }
  return null;
}

function dataUrl(mime, bytes) {
  if (typeof bytes.toBase64 === 'function') return 'data:' + mime + ';base64,' + bytes.toBase64();
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  }
  return 'data:' + mime + ';base64,' + btoa(binary);
}

async function croppedDataUrl(asset, edges) {
  if (typeof Image !== 'function' || typeof createImageBitmap !== 'function' ||
      asset.width * asset.height > 16_000_000 || !edges.every(Number.isFinite)) return undefined;
  const image = new Image();
  image.src = asset.src;
  await image.decode();
  const source = await createImageBitmap(image);
  try {
    const [left, top, right, bottom] = edges;
    const x = Math.ceil(Math.max(0, left) * source.width);
    const y = Math.ceil(Math.max(0, top) * source.height);
    const width = Math.floor(Math.min(1, 1 - right) * source.width) - x;
    const height = Math.floor(Math.min(1, 1 - bottom) * source.height) - y;
    if (width <= 0 || height <= 0) return undefined;
    // Crop at integer coordinates before scaling so interpolation cannot sample pixels outside the clip.
    const cropped = await createImageBitmap(source, x, y, width, height);
    try {
      const scale = Math.min(1, 1_600 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      context.imageSmoothingQuality = 'high';
      context.drawImage(cropped, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } finally {
      cropped.close();
    }
  } finally {
    source.close();
  }
}

function presentationParts(archive) {
  const xmlCache = new Map();
  const relationshipCache = new Map();
  const inheritedLayers = { slideLayout: new Map(), slideMaster: new Map() };
  const imageCache = new Map();
  const cropCache = new Map();
  let xmlBytes = 0;
  let imageBytes = 0;
  let croppedBytes = 0;
  async function xml(path, cache = true) {
    const entry = archive.part(path);
    if (!entry) throw new Error('在课件中找不到所需部件。');
    if (cache && xmlCache.has(entry.path)) return xmlCache.get(entry.path);
    if (entry.length > MAX_XML_PART || xmlBytes + entry.length > MAX_XML_TOTAL) {
      throw new Error('课件内的 XML 部件超过支持大小。');
    }
    xmlBytes += entry.length;
    const root = xmlRoot(await archive.read(entry.path, MAX_XML_PART));
    if (cache) xmlCache.set(entry.path, root);
    return root;
  }
  const parts = {
    archive,
    xml,
    relationships(path) {
      if (!relationshipCache.has(path)) {
        const rels = packageRelationshipsPart(path);
        const links = archive.part(rels)
          ? xml(rels, false).then(root => readRelationships(root, path, archive))
          : Promise.resolve(new Map());
        relationshipCache.set(path, links);
      }
      return relationshipCache.get(path);
    },
    async inheritedLayer(links, kind, warnings) {
      const relation = relatedPart(links, kind);
      if (!relation) return null;
      const cache = inheritedLayers[kind];
      if (!cache.has(relation.path)) {
        let layer = null;
        const layerWarnings = new Set();
        try {
          const root = await xml(relation.path);
          if (!is(root, 'p', kind === 'slideLayout' ? 'sldLayout' : 'sldMaster')) throw new Error();
          const inherited = slideLayer(root, relation.path, await pageRelationships(parts, relation.path, layerWarnings));
          layer = { ...inherited, placeholderKinds: placeholderKinds(inherited) };
        } catch {
          layerWarnings.add(warning.layer);
        }
        cache.set(relation.path, { layer, layerWarnings });
      }
      const { layer, layerWarnings } = cache.get(relation.path);
      for (const notice of layerWarnings) warnings.add(notice);
      return layer;
    },
    async image(path) {
      const entry = archive.part(path);
      if (!entry) return { warning: warning.raster };
      if (imageCache.has(entry.path)) return imageCache.get(entry.path);
      let result;
      if (entry.length > MAX_IMAGE_PART || imageBytes + entry.length > MAX_IMAGE_TOTAL) {
        result = { warning: warning.imageLimit };
      } else {
        imageBytes += entry.length;
        try {
          const bytes = await archive.read(entry.path, MAX_IMAGE_PART);
          const info = rasterInfo(bytes);
          if (!info || info.width < 1 || info.height < 1) result = { warning: warning.raster };
          else if (info.width > 16_384 || info.height > 16_384 || info.width * info.height > 48_000_000) {
            result = { warning: warning.imageLimit };
          } else result = { ...info, src: dataUrl(info.mime, bytes) };
        } catch {
          result = { warning: warning.raster };
        }
      }
      imageCache.set(entry.path, result);
      return result;
    },
    async visibleCrop(path, asset, edges) {
      const key = path + '\n' + edges.join(',');
      if (cropCache.has(key)) return cropCache.get(key);
      let src;
      if (croppedBytes < MAX_VISIBLE_IMAGE_TOTAL) {
        try {
          const candidate = await croppedDataUrl(asset, edges);
          if (candidate?.startsWith('data:image/png;base64,') && candidate.length <= 2 * MB &&
              croppedBytes + candidate.length <= MAX_VISIBLE_IMAGE_TOTAL) {
            src = candidate;
            croppedBytes += src.length;
          }
        } catch {
          // Keep the embedded original available for local review.
        }
      }
      cropCache.set(key, src);
      return src;
    },
  };
  return parts;
}

function on(value) {
  return value === '1' || value === 'true';
}

function off(value) {
  return value === '0' || value === 'false';
}

function nonVisual(shape) {
  for (const node of children(shape)) if (is(node, 'p') && node.localName.startsWith('nv')) return node;
  return undefined;
}

function placeholder(shape) {
  return child(child(nonVisual(shape), 'p', 'nvPr'), 'p', 'ph');
}

const shapeNames = new Set(['sp', 'pic', 'cxnSp', 'graphicFrame', 'contentPart']);

function* shapes(container, grouped = false, fallback = false) {
  for (const node of container?.children ?? []) {
    if (is(node, 'mc', 'AlternateContent')) {
      const active = alternateBranch(node);
      yield* shapes(active, grouped, fallback);
      if (!fallback && is(active, 'mc', 'Choice') && matching(active, 'm', 'oMath').length) {
        const original = [...node.children].find(branch => is(branch, 'mc', 'Fallback'));
        yield* shapes(original, grouped, true);
      }
    } else if (is(node, 'p') && !on(child(nonVisual(node), 'p', 'cNvPr')?.getAttribute('hidden'))) {
      if (node.localName === 'grpSp') yield* shapes(node, true, fallback);
      else if (shapeNames.has(node.localName)) yield { node, grouped, fallback };
    }
  }
}

function slideLayer(root, path, relationships) {
  const common = child(root, 'p', 'cSld');
  return { root, path, common, relationships, shapes: [...shapes(child(common, 'p', 'spTree'))] };
}

async function pageRelationships(parts, path, warnings) {
  try {
    return await parts.relationships(path);
  } catch {
    warnings.add(warning.relationships);
    return new Map();
  }
}

function placeholderKinds(layer) {
  const kinds = new Map();
  for (const { node } of layer?.shapes ?? []) {
    const definition = placeholder(node);
    const kind = definition?.getAttribute('type');
    if (kind) kinds.set(Number(definition.getAttribute('idx') ?? 0), kind);
  }
  return kinds;
}

function isTitlePlaceholder(node, layoutKinds, masterKinds) {
  const definition = placeholder(node);
  if (!definition) return false;
  const index = Number(definition.getAttribute('idx') ?? 0);
  const kind = definition.getAttribute('type') || layoutKinds?.get(index) || masterKinds?.get(index);
  return kind === 'title' || kind === 'ctrTitle';
}

function mathProperty(node, propertyGroup, property, fallback) {
  return attribute(child(child(node, 'm', propertyGroup), 'm', property), 'm', 'val') ?? fallback;
}

function mathText(node) {
  const name = node.localName;
  if (name === 't') return node.textContent;
  const arg = part => {
    const element = child(node, 'm', part);
    return element ? mathText(element) : '';
  };
  const script = (part, mark) => {
    const text = arg(part);
    return text ? mark + '(' + text + ')' : '';
  };
  if (name === 'f') return '(' + arg('num') + ')/(' + arg('den') + ')';
  if (name === 'sSub' || name === 'sSup' || name === 'sSubSup') return arg('e') + script('sub', '_') + script('sup', '^');
  if (name === 'sPre') return script('sub', '_') + script('sup', '^') + arg('e');
  if (name === 'rad') {
    const degree = on(mathProperty(node, 'radPr', 'degHide', '0')) ? '' : arg('deg');
    return '√' + (degree ? '[' + degree + ']' : '') + '(' + arg('e') + ')';
  }
  if (name === 'nary') {
    const operator = mathProperty(node, 'naryPr', 'chr', '∫');
    const lower = on(mathProperty(node, 'naryPr', 'subHide', '0')) ? '' : script('sub', '_');
    const upper = on(mathProperty(node, 'naryPr', 'supHide', '0')) ? '' : script('sup', '^');
    return operator + lower + upper + ' ' + arg('e');
  }
  if (name === 'd') {
    const begin = mathProperty(node, 'dPr', 'begChr', '(');
    const end = mathProperty(node, 'dPr', 'endChr', ')');
    const separator = mathProperty(node, 'dPr', 'sepChr', '|');
    return begin + [...children(node)].filter(element => is(element, 'm', 'e')).map(mathText).join(separator) + end;
  }
  if (name === 'func') return arg('fName') + '(' + arg('e') + ')';
  if (name === 'limLow' || name === 'limUpp') {
    return arg('e') + (name === 'limLow' ? '_(' : '^(') + arg('lim') + ')';
  }
  if (name === 'bar') {
    return (mathProperty(node, 'barPr', 'pos', 'top') === 'bot' ? 'underline(' : 'overline(') + arg('e') + ')';
  }
  if (name === 'acc') return arg('e') + mathProperty(node, 'accPr', 'chr', '\u0302');
  if (name === 'groupChr') return '(' + arg('e') + ')' + mathProperty(node, 'groupChrPr', 'chr', '⏟');
  if (name === 'phant') return '';
  const values = [...children(node)]
    .filter(element => is(element, 'm') && !element.localName.endsWith('Pr'))
    .map(mathText);
  if (name === 'm') return '[' + values.join(' ｜ ') + ']';
  if (name === 'mr') return values.join(', ');
  return values.join(['oMathPara', 'eqArr'].includes(name) ? '\n' : '');
}

function inlineText(node, warnings) {
  if (is(node, 'a', 't')) return node.textContent;
  if (is(node, 'a', 'br')) return '\n';
  if (is(node, 'a', 'tab')) return '\t';
  if (is(node, 'm', 'oMath') || is(node, 'm', 'oMathPara')) {
    warnings.add(warning.math);
    return mathText(node);
  }
  if (is(node, 'a14', 'm') || is(node, 'a', 'p') || is(node, 'a', 'r') || is(node, 'a', 'fld')) {
    return [...children(node)].map(element => inlineText(element, warnings)).join('');
  }
  return '';
}

function richText(element, warnings) {
  return [...children(element)].filter(node => is(node, 'a', 'p'))
    .map(node => inlineText(node, warnings)).join('\n').trim();
}

function tableText(table, warnings) {
  const rows = [...children(table)].filter(row => is(row, 'a', 'tr')).map(row => {
    const cells = [...children(row)].filter(cell => is(cell, 'a', 'tc')).map(cell => {
      if (on(cell.getAttribute('hMerge')) || on(cell.getAttribute('vMerge'))) return '';
      return richText(child(cell, 'a', 'txBody'), warnings).replace(/\n/gu, ' / ');
    });
    return cells.some(Boolean) ? cells.join(' ｜ ').trim() : '';
  }).filter(Boolean);
  return rows.length ? '表格\n' + rows.join('\n') : '';
}

function chartPoints(container) {
  const points = new Map();
  for (const point of matching(container, 'c', 'pt')) {
    const index = Number(point.getAttribute('idx') ?? -1);
    const value = child(point, 'c', 'v')?.textContent.trim();
    if (!value || !Number.isSafeInteger(index) || index < 0) continue;
    points.set(index, points.has(index) ? points.get(index) + ' / ' + value : value);
  }
  return points;
}

function chartLabel(container, warnings) {
  return matching(container, 'c', 'rich').map(rich => richText(rich, warnings)).filter(Boolean).join('\n') ||
    [...chartPoints(container).values()].join(' / ') || child(container, 'c', 'v')?.textContent.trim() || '';
}

function chartSeries(series, warnings) {
  const label = chartLabel(child(series, 'c', 'tx'), warnings);
  const categories = chartPoints(child(series, 'c', 'cat') ?? child(series, 'c', 'xVal'));
  const values = chartPoints(child(series, 'c', 'val') ?? child(series, 'c', 'yVal'));
  const indexes = [...new Set([...categories.keys(), ...values.keys()])].sort((first, second) => first - second);
  const data = indexes.map(index => {
    const category = categories.get(index);
    const value = values.get(index);
    return category && value ? category + ' = ' + value : value || category;
  }).join(' ｜ ');
  return [label, data].filter(Boolean).join('\n');
}

async function readChart(node, parts, relationships, warnings) {
  const reference = attribute(node, 'r', 'id');
  let sections = [];
  try {
    const link = relationships.get(reference);
    if (link?.kind !== 'chart' && link?.kind !== 'chartEx') throw new Error();
    const root = await parts.xml(link.path);
    if (is(root, 'c', 'chartSpace')) {
      sections = [
        ...matching(root, 'c', 'title').map(title => chartLabel(title, warnings)),
        ...matching(root, 'c', 'ser').map(series => chartSeries(series, warnings)),
      ];
    } else if (is(root, 'cx', 'chartSpace')) {
      sections = matching(root, 'a', 'p').map(paragraph => inlineText(paragraph, warnings).trim());
    }
  } catch {
    // The slide remains available if a chart's separate part is missing or damaged.
  }
  sections = sections.filter(Boolean);
  warnings.add(sections.length ? warning.chart : warning.chartMissing);
  return sections.length ? '图表（课件缓存）\n' + sections.join('\n') : '';
}

async function readDiagram(node, parts, relationships, warnings) {
  let paragraphs = [];
  try {
    const link = relationships.get(attribute(node, 'r', 'dm'));
    if (link?.kind !== 'diagramData') throw new Error();
    const root = await parts.xml(link.path);
    if (!is(root, 'dgm', 'dataModel')) throw new Error();
    paragraphs = matching(root, 'dgm', 't').map(text => richText(text, warnings)).filter(Boolean);
  } catch {
    // The original slide remains the reference for graphics with unavailable data.
  }
  warnings.add(paragraphs.length ? warning.diagram : warning.diagramMissing);
  return paragraphs.length ? 'SmartArt\n' + paragraphs.join('\n') : '';
}

async function readShape(node, parts, relationships, warnings) {
  const text = richText(child(node, 'p', 'txBody'), warnings);
  const drawing = is(node, 'p', 'sp') && !text && !placeholder(node) && !matching(node, 'a', 'blip').length;
  if (drawing || is(node, 'p', 'cxnSp') || is(node, 'p', 'contentPart')) {
    warnings.add(warning.drawing);
  }
  if (!is(node, 'p', 'graphicFrame')) return text;
  const blocks = [];
  for (const item of descendants(node)) {
    if (is(item, 'a', 'tbl')) blocks.push(tableText(item, warnings));
    if (is(item, 'c', 'chart') || is(item, 'cx', 'chart')) blocks.push(await readChart(item, parts, relationships, warnings));
    if (is(item, 'dgm', 'relIds')) blocks.push(await readDiagram(item, parts, relationships, warnings));
  }
  if (!blocks.length) warnings.add(warning.drawing);
  return blocks.filter(Boolean).join('\n');
}

function cropEdges(rect) {
  const edges = ['l', 't', 'r', 'b'].map(edge => {
    const value = rect?.getAttribute(edge)?.trim();
    if (!value) return 0;
    return value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value) / 100_000;
  });
  return edges.some(value => value !== 0) ? edges : null;
}

function shapeMask(shape) {
  const properties = child(shape, 'p', 'spPr');
  const geometry = child(properties, 'a', 'prstGeom')?.getAttribute('prst');
  return (!!geometry && geometry !== 'rect') || !!child(properties, 'a', 'custGeom');
}

async function collectImages(element, parts, links, warnings, images) {
  let original;
  for (const blip of matching(element, 'a', 'blip')) {
    const id = attribute(blip, 'r', 'embed') ?? attribute(blip, 'r', 'link');
    const link = links.get(id);
    if (link?.external) {
      warnings.add(warning.external);
      continue;
    }
    if (!link?.path || link.kind !== 'image') {
      warnings.add(warning.raster);
      continue;
    }
    const asset = await parts.image(link.path);
    if (asset.warning) {
      warnings.add(asset.warning);
      continue;
    }
    const name = link.path.split('/').at(-1);
    const metadata = child(nonVisual(element), 'p', 'cNvPr');
    const alt = metadata?.getAttribute('descr') || metadata?.getAttribute('title') || metadata?.getAttribute('name') || name;
    const fill = blip.parentElement;
    const stretch = child(fill, 'a', 'stretch');
    const sourceEdges = cropEdges(child(fill, 'a', 'srcRect'));
    const fillEdges = cropEdges(child(stretch, 'a', 'fillRect'));
    const masked = shapeMask(element) || !!fillEdges?.some(value => !Number.isFinite(value) || value < 0);
    const cropped = !!sourceEdges || masked;
    const record = images.get(link.path) ?? { name, alt, src: asset.src, sourcePath: link.path, cropped };
    if (!cropped) {
      record.cropped = false;
      delete record.visibleSrc;
    } else {
      warnings.add(warning.crop);
      if (record.cropped && !record.visibleSrc && sourceEdges && !masked && stretch && is(element, 'p', 'pic')) {
        const visibleSrc = await parts.visibleCrop(link.path, asset, sourceEdges);
        if (visibleSrc) record.visibleSrc = visibleSrc;
      }
    }
    images.set(link.path, record);
    original ??= { ...asset, blip };
  }
  return original;
}

function fullPageRaster(shape, asset, slideSize) {
  if (!asset || !slideSize || !is(shape.node, 'p', 'pic') || shape.grouped || shape.fallback) return false;
  const paint = child(shape.node, 'p', 'spPr');
  const transform = child(paint, 'a', 'xfrm');
  const offset = child(transform, 'a', 'off');
  const extent = child(transform, 'a', 'ext');
  if (!offset || !extent || Number(transform.getAttribute('rot')) || on(transform.getAttribute('flipH')) ||
      on(transform.getAttribute('flipV'))) return false;
  if (Number(offset.getAttribute('x')) !== 0 || Number(offset.getAttribute('y')) !== 0 ||
      Number(extent.getAttribute('cx')) !== slideSize.width || Number(extent.getAttribute('cy')) !== slideSize.height) return false;
  const line = child(paint, 'a', 'ln');
  if (shapeMask(shape.node) ||
      child(paint, 'a', 'effectLst')?.children.length || child(paint, 'a', 'effectDag') ||
      (line && !child(line, 'a', 'noFill'))) return false;
  const fill = asset.blip.parentElement;
  const stretch = child(fill, 'a', 'stretch');
  const fillRect = child(stretch, 'a', 'fillRect');
  if (!stretch || cropEdges(child(fill, 'a', 'srcRect')) || cropEdges(fillRect) ||
      [...children(asset.blip)].some(node => !is(node, 'a', 'extLst'))) return false;
  return Math.abs(asset.width / asset.height / (slideSize.width / slideSize.height) - 1) < 0.02;
}

function shorten(value, length) {
  return value.slice(0, length).replace(/[\uD800-\uDBFF]$/u, '').trimEnd();
}

function pageTitle(layer, candidate, number) {
  const title = candidate?.split('\n').map(line => line.trim()).filter(Boolean).join(' ') ||
    layer.common?.getAttribute('name')?.trim() || '第 ' + number + ' 页';
  return title.length > 240 ? shorten(title, 239) + '…' : title;
}

function unavailablePage(number, sourcePath, reason) {
  return { number, title: '第 ' + number + ' 页', text: '', sourcePath, hidden: false, images: [], warnings: [reason] };
}

async function readPage(number, sourcePath, slideSize, parts) {
  if (!parts.archive.part(sourcePath)) return unavailablePage(number, sourcePath, warning.missingSlide);
  let root;
  try {
    root = await parts.xml(sourcePath, false);
    if (!is(root, 'p', 'sld') || !child(child(root, 'p', 'cSld'), 'p', 'spTree')) throw new Error();
  } catch {
    return unavailablePage(number, sourcePath, warning.unreadableSlide);
  }
  const warnings = new Set();
  const slide = slideLayer(root, sourcePath, await pageRelationships(parts, sourcePath, warnings));
  const layout = await parts.inheritedLayer(slide.relationships, 'slideLayout', warnings);
  const master = await parts.inheritedLayer(layout?.relationships, 'slideMaster', warnings);
  const visibleMaster = !off(root.getAttribute('showMasterSp')) && !off(layout?.root.getAttribute('showMasterSp'));
  const text = [];
  const images = new Map();
  let title;
  let namedTitle;
  let preview;
  const background = [slide, layout, master].find(layer => child(layer?.common, 'p', 'bg'));
  if (background) await collectImages(child(background.common, 'p', 'bg'), parts, background.relationships, warnings, images);
  for (const layer of [slide, layout, visibleMaster ? master : null]) {
    for (const shape of layer?.shapes ?? []) {
      if (layer !== slide && placeholder(shape.node)) continue;
      const original = await collectImages(shape.node, parts, layer.relationships, warnings, images);
      if (layer === slide && slide.shapes.length === 1 && fullPageRaster(shape, original, slideSize)) preview = original.src;
      if (shape.fallback) continue;
      const block = await readShape(shape.node, parts, layer.relationships, warnings);
      if (!block) continue;
      text.push(block);
      if (layer === slide && !title && isTitlePlaceholder(shape.node, layout?.placeholderKinds, master?.placeholderKinds)) {
        title = block;
      }
      if (layer === slide && !namedTitle && is(shape.node, 'p', 'sp')) {
        const label = child(nonVisual(shape.node), 'p', 'cNvPr')?.getAttribute('name');
        if (/^(?:title|标题|標題)(?:\s|[0-9]|$)/iu.test(label ?? '')) namedTitle = block;
      }
    }
  }
  const body = text.join('\n\n');
  if (body.length > MAX_PAGE_TEXT) warnings.add(warning.textLimit);
  return {
    number, sourcePath, title: pageTitle(slide, title || namedTitle, number), text: shorten(body, MAX_PAGE_TEXT),
    hidden: off(root.getAttribute('show')), images: [...images.values()], warnings: [...warnings],
    ...(preview && { preview }),
  };
}

async function presentationPath(parts, warnings) {
  try {
    const location = relatedPart(await parts.relationships(''), 'officeDocument')?.path;
    if (parts.archive.part(location)) return location;
  } catch {
    // The standard OPC location also works with older or partially damaged packaging.
  }
  const standard = parts.archive.part('ppt/presentation.xml')?.path;
  if (standard) {
    warnings.add(warning.entry);
    return standard;
  }
  throw new Error('该文件中找不到 PowerPoint 课件入口。请检查文件或另存为 .pptx。');
}

export async function readPptx(file) {
  const archive = await openPptxPackage(file);
  if (typeof DOMParser !== 'function') throw new Error('此环境无法读取 .pptx 的 XML 部件，请使用新版浏览器。');
  const parts = presentationParts(archive);
  const warnings = new Set([warning.format]);
  const path = await presentationPath(parts, warnings);
  const presentation = await parts.xml(path);
  if (!is(presentation, 'p', 'presentation')) throw new Error('该文件的内容不是 PowerPoint 课件。');
  const slides = [...children(child(presentation, 'p', 'sldIdLst'))].filter(node => is(node, 'p', 'sldId'));
  if (!slides.length) throw new Error('课件没有可读取的幻灯片顺序。请检查原课件或导出 PDF。');
  if (slides.length > MAX_SLIDES) throw new Error('课件超过 1000 页。请拆分后导入。');
  const relationships = await parts.relationships(path);
  if (!relatedPart(relationships, 'slide')) throw new Error('课件的页序引用无法读取。请重新保存原课件或导出 PDF。');
  const pageSize = child(presentation, 'p', 'sldSz');
  const width = Number(pageSize?.getAttribute('cx'));
  const height = Number(pageSize?.getAttribute('cy'));
  const slideSize = width > 0 && height > 0 ? { width, height } : null;
  const pages = [];
  for (const slide of slides) {
    const reference = relationships.get(attribute(slide, 'r', 'id'));
    const sourcePath = reference?.kind === 'slide' ? reference.path ?? '' : '';
    const number = pages.length + 1;
    try {
      pages.push(await readPage(number, sourcePath, slideSize, parts));
    } catch {
      pages.push(unavailablePage(number, sourcePath, warning.unreadableSlide));
    }
  }
  return { name: typeof file.name === 'string' && file.name ? file.name : '课件.pptx', pages, warnings: [...warnings] };
}
