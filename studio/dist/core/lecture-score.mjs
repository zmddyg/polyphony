import { exportScore } from './score-package.mjs';

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

export const isEmbeddedLectureImage = src => typeof src === 'string' && imagePrefix.test(src);

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
  const { title, body, preview, images, omittedImages, points, series, xLabel, yLabel } = slide;
  return {
    title,
    body,
    source: { name: lecture.source.name, pageNumber: page.number },
    pageNumber: page.number,
    ...(preview && { preview }),
    ...(images && { images }),
    ...(omittedImages && { omittedImages }),
    ...(points && { points }),
    ...(series && { series }),
    ...(xLabel && { xLabel }),
    ...(yLabel && { yLabel }),
  };
}
