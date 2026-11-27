import { exportScore } from './score-package.mjs';
import { sha256WithoutWebCrypto } from './material-notebook.mjs';

const format = 'polyphony.lecture';
const version = 1;
const imagePrefix = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/u;
export const MAX_LECTURE_BYTES = 64 * 1024 * 1024;
export const DIAGRAM_KINDS = Object.freeze(['flow','compare','concept']);
export const DIAGRAM_DIRECTIONS = Object.freeze(['LR','TB']);
export const DIAGRAM_TONES = Object.freeze(['primary','accent','warn','neutral']);
export const LECTURE_LAYOUTS = Object.freeze(['auto', 'single', 'split-right', 'split-left', 'media-top', 'diagram-focus']);
export const LECTURE_ARCHETYPES = Object.freeze(['cover', 'section', 'derivation', 'split-compare', 'example', 'summary']);

export function normalizeLectureLayout(value) {
  if (value === undefined) return undefined;
  if (!LECTURE_LAYOUTS.includes(value)) throw new Error('课件页版式无效。');
  return value;
}

export function normalizeSlideArchetype(value) {
  if (value === undefined) return undefined;
  if (!LECTURE_ARCHETYPES.includes(value)) throw new Error('课件页视觉原型无效。');
  return value;
}

export function inferSlideArchetype(page, index = -1, total = 0) {
  if (LECTURE_ARCHETYPES.includes(page.archetype)) return page.archetype;
  if (isEmbeddedLectureImage(page.preview)) return undefined;

  const title = String(page.title ?? '').trim();
  const blocks = page.nativeBlocks ?? page.blocks ?? [];
  const contains = type => blocks.some(block => block.type === type);
  if (/总结|小结|回顾|速查|归纳|总表|\b(?:summary|checklist|recap)\b/iu.test(title)) return 'summary';
  if (/例题|实例|算例|案例|^例\s*\d|\b(?:worked example|case study|example)\b/iu.test(title)) return 'example';
  if (/对比|比较|异同|辨析|\b(?:compare|comparison|contrast)\b/iu.test(title) ||
      blocks.some(block => block.type === 'diagram' && block.kind === 'compare')) return 'split-compare';
  if (/推导|证明|\b(?:derivation|proof)\b/iu.test(title) || (contains('formula') && contains('steps') && index !== 0)) {
    return 'derivation';
  }
  if (/课程导读|课程概览|本讲导读|\b(?:course introduction|course overview)\b/iu.test(title) ||
      (index === 0 && total > 1 && blocks.length)) return 'cover';
  if (/^(?:第\s*[\d一二三四五六七八九十百]+\s*[章节篇部]|[一二三四五六七八九十]+、|(?:chapter|section|unit|part)\s+\d)/iu.test(title) &&
      blocks.length <= 1) return 'section';
  if (total > 2 && index === total - 1 && blocks.length) return 'summary';
  return undefined;
}

export function resolveLectureLayout(frame, { visualNeed } = {}) {
  if (frame.layout !== 'auto' && LECTURE_LAYOUTS.includes(frame.layout)) return frame.layout;
  const images = (frame.images ?? []).filter(figure => isEmbeddedLectureImage(figure?.src));
  if (isEmbeddedLectureImage(frame.preview)) {
    return images.some(figure => figure.accompanyPreview === true) ? 'split-right' : 'single';
  }
  const blocks = frame.nativeBlocks ?? frame.blocks ?? [];
  const hasText = frame.body?.length || frame.text?.trim() || blocks.length;
  if (images.length) return hasText || frame.archetype === 'cover' ? 'split-right' : 'media-top';
  const diagrams = blocks.filter(block => block.type === 'diagram');
  const wide = blocks.some(block => block.type === 'code-pair' ||
    (block.type === 'table' && block.headers?.length >= 4));
  if (wide || diagrams.some(block => block.direction !== 'TB')) return 'diagram-focus';
  if (diagrams.length) return diagrams.length < blocks.length ? 'split-right' : 'diagram-focus';
  if (blocks.length >= 2 && blocks.length <= 3) {
    const types = new Set(blocks.map(block => block.type));
    const hasExposition = ['bullets', 'steps', 'callout'].some(type => types.has(type));
    const hasData = types.has('chart') || types.has('table');
    if ((hasExposition && (hasData || types.has('formula'))) || (hasData && types.has('formula'))) return 'content-columns';
  }
  if (visualNeed === 'image-search' && !hasText) return 'media-top';
  return 'single';
}

function requiredText(value, field) {
  const text = optionalText(value, field);
  if (!text) throw new Error(`请填写${field}。`);
  return text;
}

function optionalText(value, field) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(`${field}须为文本。`);
  return value.trim();
}

function paragraphs(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field}须由文本段落组成。`);
  return Array.from(value, line => {
    if (typeof line !== 'string') throw new Error(`${field}须由文本段落组成。`);
    return line.trim();
  }).filter(Boolean);
}

function validateDiagram(block, common, string) {
  const { kind = 'flow', direction = 'LR', nodes, edges } = block;
  if (!DIAGRAM_KINDS.includes(kind) || !DIAGRAM_DIRECTIONS.includes(direction)) {
    throw Error('示意图类型或方向无效。');
  }
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > 12) throw Error('示意图须包含 2–12 个节点。');
  if (!Array.isArray(edges) || edges.length > 18) throw Error('示意图须包含 0–18 条连线。');
  const ids = new Set();
  const checkedNodes = Array.from(nodes, node => {
    const id = string(node?.id, '示意图节点编号').trim();
    const label = string(node?.label, '示意图节点标签');
    if (!id || ids.has(id) || !label.trim()) throw Error('示意图节点须有唯一编号与非空标签。');
    ids.add(id);
    const checked = { id, label };
    if (node.sub != null) checked.sub = string(node.sub, '示意图节点说明');
    if (node.group != null) checked.group = string(node.group, '示意图分组').trim();
    if (node.tone != null) {
      if (!DIAGRAM_TONES.includes(node.tone)) throw Error('示意图节点色调无效。');
      checked.tone = node.tone;
    }
    return checked;
  });
  const checkedEdges = Array.from(edges, edge => {
    const from = string(edge?.from, '示意图连线起点').trim();
    const to = string(edge?.to, '示意图连线终点').trim();
    if (!ids.has(from) || !ids.has(to)) throw Error('示意图连线的起点和终点须引用已声明的节点编号。');
    return { from, to, ...(edge.label != null && { label: string(edge.label, '示意图连线标签') }) };
  });
  return { ...common, kind, direction, nodes: checkedNodes, edges: checkedEdges };
}

// Native slides are data, never authored HTML. Drop no content silently.
export function validateSlideBlocks(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw Error('课件 blocks 须为最多 16 个结构化区块。');
  const string = (v, name) => { if (typeof v !== 'string' || v.length > 16000) throw Error(name+' 须为有限长度文本。'); return v; };
  const strings = (v, name) => { if (!Array.isArray(v) || v.length > 80) throw Error(name+' 须为文本数组。'); return v.map(x=>string(x,name)); };
  const code = v => { if (!v || typeof v !== 'object') throw Error('代码栏无效。'); return {title:string(v.title??'','代码标题'),language:string(v.language??'c','语言'),code:string(v.code,'代码')}; };
  return value.map(b=>{
    if (!b || typeof b !== 'object') throw Error('课件区块无效。');
    const common = {type:b.type, ...(b.title !== undefined && {title:string(b.title,'区块标题')})};
    if (b.type==='code') return {...common,...code(b)};
    if (b.type==='code-pair') return {...common,left:code(b.left),right:code(b.right)};
    if (b.type==='table') {
      const headers=strings(b.headers,'表头');
      if (!headers.length || headers.length>8 || !Array.isArray(b.rows) || b.rows.length>40) throw Error('表格规模无效。');
      const rows=b.rows.map(r=>{const cells=strings(r,'单元格');if(cells.length!==headers.length)throw Error('表格列数不一致。');return cells;});
      return {...common,headers,rows};
    }
    if (b.type==='callout') return {...common,text:string(b.text,'提示'),tone:['note','warning','success'].includes(b.tone)?b.tone:'note'};
    if (['steps','bullets','formula'].includes(b.type)) return {...common,items:strings(b.items,'条目')};
    if (b.type==='diagram') return validateDiagram(b, common, string);
    if (b.type==='stat-grid') {
      if (!Array.isArray(b.items) || b.items.length>8) throw Error('统计区块无效。');
      return {...common,items:b.items.map(i=>({value:string(i?.value,'数值'),label:string(i?.label,'标签')}))};
    }
    if (b.type==='chart') {const plot=chart(b,'区块图表');if(!plot.points&&!plot.series)throw Error('图表区块须包含有限数值坐标。');return {...common,...plot};}
    throw Error('未知课件区块：'+b.type);
  });
}

// Preserve previously published SVG previews by content, without loading their original courses.
const legacyPreviewHashes = new Set([
  '1469a1122bc4152eeef57560c397e71d9a56aae99c7675438a08e9fa06be8c41',
  'db81632ca9f853a19f771b7f6f8ce6cd32f6bbfd5e74b45617fefcace384aa11',
  '12e21c0779d0f97e9c5c3176dd852f3c2fd0e4827e3d7f8d7bf3b1f36e6fa170',
  'aa672cc2f5f57df07d4a519d8f770ee1bbdcbf0aeefde60546d68151f1882244',
  '972ad8feb2074eb5f51a5038582c19fe42e324c64003877f9457de167adc2379',
  '89810546e82ed9c80c6cddc5f6a65f1a4a546725535913f71e320be035117147',
  'ec8a991ba4b6188d93aa192a0e0d943b6af1b71ea6fa87be53aa37a2709f41ff',
  '43b88e718e16709fc0d5f622caeae88a665976df10852fbd57606fdad772a44a',
  '04739bedaec2fe923db054c500f417257196f5d3cbc030842ab94e70e4987c46',
  'ef28913d49f291332ff729e419988838834e9342d7ea9e5f7315ff9a04e05f70',
  'e310c2a2771953155a2835a542447c793f08a1f7602c87f2c639e1ea13088fa4',
  '94c57528ea4774004c1e37361811e47d1811c2c81d126936482155ed59f6b273',
  'eac1621d6d9b120e2241f0dd61bceda6463ab618514080091aa5d9cb4bd0823a',
  '8975248d9d4bd4aadb1e82bb9d2c0cb3f332c937022e5587d3fd264a1e817996',
]);
export function isEmbeddedLectureImage(src) {
  return typeof src === 'string' && (imagePrefix.test(src) ||
    (src.length <= 1450 && src.startsWith('data:image/svg+xml;base64,') &&
      legacyPreviewHashes.has(sha256WithoutWebCrypto(new TextEncoder().encode(src)))));
}

export function blockText(block) {
  if (block.type === 'diagram') {
    return [block.title, ...(block.nodes ?? []).flatMap(node => [node.label, node.sub]),
      ...(block.edges ?? []).map(edge => edge.label)].filter(Boolean).join('\n');
  }
  if (block.type === 'chart') {
    return [block.title, block.xLabel, block.yLabel, ...(block.series ?? []).map(curve => curve.label)]
      .filter(Boolean).join('\n');
  }
  return [
    block.title, block.text, block.code, ...(block.headers ?? []), ...(block.rows ?? []).flat(),
    ...(block.items ?? []).map(item => typeof item === 'string' ? item : item.value + ' ' + item.label),
    ...(block.left ? [blockText(block.left), blockText(block.right)] : []),
  ].filter(Boolean).join('\n');
}

function transcriptLine(line) {
  return line.trim().replace(/^(?:[-*+]\s+|\d+[.)、]\s+|>\s*)/u, '')
    .replace(/^\$\$(.*)\$\$$/u, '$1').replace(/\s+/gu, ' ').trim();
}

export function lectureSourceExcerpt(page) {
  const blocks = page.nativeBlocks ?? page.blocks ?? [];
  const explicit = page.sourceExcerpt ?? [];
  if (!blocks.length) return explicit;
  const visible = new Set([page.title ?? '', ...blocks.map(blockText).join('\n').split(/\r\n?|\n/u)].map(transcriptLine));
  const body = page.body ?? page.text?.split(/\r\n?|\n/u) ?? [];
  const extra = body.filter(line => {
    const text = transcriptLine(line);
    if (!text || visible.has(text) || /^(?:`{3,}\w*|~{3,}\w*|\$\$|[|: -]+)$/u.test(text)) return false;
    const cells = text.replace(/^\||\|$/gu, '').split(/[|｜]/u).map(cell => cell.trim());
    return cells.length < 2 || !cells.every(cell => visible.has(cell));
  });
  return [...new Set([...explicit, ...extra])];
}

function image(src, field) {
  if (!isEmbeddedLectureImage(src)) throw new Error(`${field}须使用已嵌入的原稿图片。`);
  if (src.length > MAX_LECTURE_BYTES) throw new Error(`${field}过大，请压缩原稿图片后重试。`);
  const bytes = src.slice(src.indexOf(',') + 1);
  if (bytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(bytes)) {
    throw new Error(`${field}无法读取，请重新导入原稿。`);
  }
  return src;
}

function imageAttribution(value, field, limit) {
  return Array.from(optionalText(value, field)
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim()).slice(0, limit).join('');
}

function imageSourceUrl(value) {
  const text = imageAttribution(value, '图片出处', 500);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 500 ? url.href : '';
  } catch { return ''; }
}

function lectureImage(figure, src, field, index, accompanyPreview) {
  const credit = imageAttribution(figure?.credit, '图片来源', 160);
  const license = imageAttribution(figure?.license, '图片许可', 80);
  const source = imageAttribution(figure?.source, '图片图库', 80);
  const sourceUrl = imageSourceUrl(figure?.sourceUrl);
  return {
    src: image(src, `${field}的图 ${index + 1}`),
    alt: optionalText(figure?.alt, '图片说明') || optionalText(figure?.name, '图片名称') || `原稿插图 ${index + 1}`,
    ...(credit && { credit }),
    ...(license && { license }),
    ...(source && { source }),
    ...(sourceUrl && { sourceUrl }),
    ...(accompanyPreview && { accompanyPreview: true }),
  };
}

function visuals(page, field) {
  const result = page.preview ? { preview: image(page.preview, `${field}预览`) } : {};
  if (!result.preview && page.omittedImages === true) result.omittedImages = true;
  const figures = page.images;
  if (figures === undefined || (result.preview && !Array.isArray(figures))) return result;
  if (!Array.isArray(figures)) throw new Error(`${field}图片格式无效。`);
  const images = [];
  for (const [index, figure] of figures.entries()) {
    const src = figure?.cropped ? figure.visibleSrc : figure?.src;
    // Imported assets can be reused later. The complete preview still covers this page.
    if (result.preview && figure?.accompanyPreview !== true) {
      try { images.push(lectureImage(figure, src, field, index, false)); }
      catch { /* The original remains available as a complete preview. */ }
      continue;
    }
    if (figure?.cropped && !isEmbeddedLectureImage(src)) {
      result.omittedImages = true;
      continue;
    }
    images.push(lectureImage(figure, src, field, index, Boolean(result.preview)));
  }
  if (images.length) result.images = images;
  return result;
}

function points(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field}的曲线坐标须为有限数值。`);
  return Array.from(value, point => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error(`${field}的曲线坐标须为有限数值。`);
    return { x: point.x, y: point.y };
  });
}

function chart(slide, field) {
  const result = {};
  if (slide.series !== undefined) {
    if (!Array.isArray(slide.series)) throw new Error(`${field}的图例格式无效。`);
    const series = Array.from(slide.series, curve => ({
      label: requiredText(curve?.label, '图例'),
      points: points(curve?.points, field),
      ...(/^#[\da-f]{6}$/iu.test(curve?.color) ? { color: curve.color } : {}),
    })).filter(curve => curve.points.length);
    if (series.length) result.series = series;
  }
  if (!result.series) {
    const samples = points(slide.points, field);
    if (samples.length) result.points = samples;
  }
  if (result.series || result.points) {
    if (slide.xLabel) result.xLabel = requiredText(slide.xLabel, '横轴标签');
    if (slide.yLabel) result.yLabel = requiredText(slide.yLabel, '纵轴标签');
  }
  return result;
}

function classMaterial(page, source) {
  const { number } = page;
  const field = `原稿第 ${number} 页`;
  if (!Array.isArray(page.adopted)) throw new Error(`${field}的补充讲解格式无效。`);
  const adopted = Array.from(page.adopted, (slide, index) => {
    const caption = `${field}的第 ${index + 1} 张补充页`;
    return {
      title: requiredText(slide?.title, `${caption}标题`),
      body: paragraphs(slide.body, caption),
      ...visuals(slide, caption),
      ...chart(slide, caption),
      ...(slide.blocks && {blocks:validateSlideBlocks(slide.blocks)}),
      ...(slide.layout !== undefined && { layout: normalizeLectureLayout(slide.layout) }),
      ...(slide.archetype !== undefined && { archetype: normalizeSlideArchetype(slide.archetype) }),
      ...(slide.speakerNotes && { speakerNotes: optionalText(slide.speakerNotes, '讲者备注') }),
      ...(slide.sourceExcerpt !== undefined && { sourceExcerpt: paragraphs(slide.sourceExcerpt, `${caption}原文摘录`) }),
    };
  });
  const result = {
    id: `page-${number}`,
    number,
    title: requiredText(page.title, `${field}标题`),
    body: paragraphs(page.body, field),
    source: { name: source.name, pageNumber: number },
    ...visuals(page, field),
    ...chart(page, field),
    adopted,
    ...(page.blocks && {blocks:validateSlideBlocks(page.blocks)}),
    ...(page.layout !== undefined && { layout: normalizeLectureLayout(page.layout) }),
    ...(page.archetype !== undefined && { archetype: normalizeSlideArchetype(page.archetype) }),
    ...(page.sourceExcerpt !== undefined && { sourceExcerpt: paragraphs(page.sourceExcerpt, `${field}原文摘录`) }),
    ...(page.speakerNotes && {speakerNotes:optionalText(page.speakerNotes,'讲者备注')}),
  };
  if (page.interaction !== undefined) result.interaction = JSON.parse(exportScore(page.interaction)).lesson;
  return result;
}

function exceedsLectureSize(lecture) {
  const json = JSON.stringify(lecture);
  let offset = 0;
  let remaining = MAX_LECTURE_BYTES;
  let scratch;
  let encoder;
  // One UTF-16 code unit takes at most three UTF-8 bytes. Most lectures fit the upper bound.
  while ((json.length - offset) * 3 > remaining) {
    if (json.length - offset > remaining) return true;
    encoder ??= new TextEncoder();
    scratch ??= new Uint8Array(64 * 1024);
    const { read, written } = encoder.encodeInto(json.slice(offset), scratch);
    offset += read;
    remaining -= written;
  }
  return false;
}

export function validateLectureScore(score) {
  if (score?.format !== format) throw new Error('请选择共演的授课课件。');
  if (score.version !== version) throw new Error('此授课课件版本暂不可用。');
  if (!Array.isArray(score.pages) || !score.pages.length) throw new Error('请选择至少一页可放映的原稿。');
  const source = {
    name: requiredText(score.source?.name, '原稿名称'),
    kind: optionalText(score.source?.kind, '原稿类型') || 'text',
  };
  const versionId = optionalText(score.source?.versionId, '原稿版本');
  if (versionId) source.versionId = versionId;
  let lastNumber = 0;
  const lecture = {
    format,
    version,
    title: requiredText(score.title, '授课课件标题'),
    source,
    pages: Array.from(score.pages, page => {
      if (!Number.isSafeInteger(page?.number) || page.number <= lastNumber) {
        throw new Error('授课页须按原稿页码依次排列，每页只能出现一次。');
      }
      lastNumber = page.number;
      return classMaterial(page, source);
    }),
  };
  if (exceedsLectureSize(lecture)) {
    throw new Error('课件超过 64 MB。请压缩原稿图片或拆分课件后重试。');
  }
  return lecture;
}

export function buildLectureScore(material, adoptedByPage = new Map(), { title, interactionsByPage = new Map() } = {}) {
  if (!Array.isArray(material?.pages) || !material.pages.length) throw new Error('请先导入有页码的原稿。');
  const name = material.name || material.title;
  const pages = [];
  for (const page of material.pages) {
    if (page?.hidden === true) continue;
    if (!Number.isSafeInteger(page?.number) || page.number < 1) throw new Error('原稿中有一页缺少有效页码。');
    const number = page.number;
    const field = `原稿第 ${number} 页`;
    const pageTitle = optionalText(page.title, `${field}标题`) || `第 ${number} 页`;
    const body = paragraphs(optionalText(page.text, `${field}正文`).split(/\r\n?|\n/u), field);
    if (body[0] === pageTitle) body.shift();
    pages.push({
      number,
      title: pageTitle,
      body,
      preview: page.preview,
      images: page.images,
      omittedImages: page.omittedImages,
      layout: page.layout,
      archetype: page.archetype,
      sourceExcerpt: page.sourceExcerpt,
      ...chart(page, field),
      adopted: adoptedByPage.get(number)?.slides ?? [],
      interaction: interactionsByPage.get(number),
      blocks: page.nativeBlocks ?? page.blocks,
      speakerNotes: page.speakerNotes,
    });
  }
  pages.sort((a, b) => a.number - b.number);
  return validateLectureScore({
    format,
    version,
    title: title || material.title || name,
    source: { name, kind: material.type, versionId: material.versionId },
    pages,
  });
}

export function lectureFrames(lecture) {
  return lecture?.pages.flatMap((page, pageIndex) => [
    { pageIndex, slideIndex: -1 },
    ...page.adopted.map((_, slideIndex) => ({ pageIndex, slideIndex })),
  ]) ?? [];
}

export function locateLectureFrame(lecture, index) {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  const pages = lecture?.pages;
  if (!pages) return null;
  let offset = index;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const length = 1 + pages[pageIndex].adopted.length;
    if (offset < length) return { pageIndex, slideIndex: offset - 1 };
    offset -= length;
  }
  return null;
}

export function lectureFrame(lecture, index) {
  const frame = locateLectureFrame(lecture, index);
  if (!frame) return null;
  const page = lecture.pages[frame.pageIndex];
  const slide = frame.slideIndex === -1 ? page : page.adopted[frame.slideIndex];
  const { title, body, preview, omittedImages, points, series, xLabel, yLabel, blocks, layout, sourceExcerpt } = slide;
  const archetype = frame.slideIndex === -1 ? inferSlideArchetype(slide, frame.pageIndex, lecture.pages.length) : inferSlideArchetype(slide);
  const images = preview ? slide.images?.filter(figure => figure.accompanyPreview === true) : slide.images;
  return {
    title,
    body,
    source: { name: lecture.source.name, pageNumber: page.number },
    pageNumber: page.number,
    ...(blocks && {blocks}),
    ...(layout && { layout }),
    ...(archetype && { archetype }),
    ...(sourceExcerpt?.length && { sourceExcerpt }),
    ...(preview && { preview }),
    ...(images?.length && { images }),
    ...(omittedImages && { omittedImages }),
    ...(points && { points }),
    ...(series && { series }),
    ...(xLabel && { xLabel }),
    ...(yLabel && { yLabel }),
  };
}
