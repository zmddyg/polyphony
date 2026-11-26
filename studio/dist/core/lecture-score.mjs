import { exportScore } from './score-package.mjs';
import { sha256WithoutWebCrypto } from './material-notebook.mjs';

const format = 'polyphony.lecture';
const version = 1;
const imagePrefix = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/u;
export const MAX_LECTURE_BYTES = 64 * 1024 * 1024;

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
  return [
    block.title, block.text, block.code, ...(block.headers ?? []), ...(block.rows ?? []).flat(),
    ...(block.items ?? []).map(item => typeof item === 'string' ? item : item.value + ' ' + item.label),
    ...(block.left ? [blockText(block.left), blockText(block.right)] : []),
  ].filter(Boolean).join('\n');
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

function visuals(page, field) {
  if (page.preview) return { preview: image(page.preview, `${field}预览`) };
  const result = {};
  if (page.omittedImages === true) result.omittedImages = true;
  if (page.images === undefined) return result;
  if (!Array.isArray(page.images)) throw new Error(`${field}图片格式无效。`);
  const images = [];
  for (const [index, figure] of page.images.entries()) {
    const src = figure?.cropped ? figure.visibleSrc : figure?.src;
    if (figure?.cropped && !isEmbeddedLectureImage(src)) {
      result.omittedImages = true;
      continue;
    }
    images.push({
      src: image(src, `${field}的图 ${index + 1}`),
      alt: optionalText(figure?.alt, '图片说明') || optionalText(figure?.name, '图片名称') || `原稿插图 ${index + 1}`,
    });
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
    };
  });
  const result = {
    id: `page-${number}`,
    number,
    title: requiredText(page.title, `${field}标题`),
    body: paragraphs(page.body, field),
    source: { name: source.name, pageNumber: number },
    ...visuals(page, field),
    adopted,
    ...(page.blocks && {blocks:validateSlideBlocks(page.blocks)}),
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
  const { title, body, preview, images, omittedImages, points, series, xLabel, yLabel, blocks } = slide;
  return {
    title,
    body,
    source: { name: lecture.source.name, pageNumber: page.number },
    pageNumber: page.number,
    ...(blocks && {blocks}),
    ...(preview && { preview }),
    ...(images && { images }),
    ...(omittedImages && { omittedImages }),
    ...(points && { points }),
    ...(series && { series }),
    ...(xLabel && { xLabel }),
    ...(yLabel && { yLabel }),
  };
}
