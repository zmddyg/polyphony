import { MODULE_MANIFESTS } from './activities.mjs';
import {
  COURSE_AUTHORING_RULES, COURSE_DENSITIES, COURSE_PAGE_ROLES, COURSE_VISUAL_NEEDS,
  SOURCE_ADAPTATION_RULES, interactionBudget, suggestCourseLayout,
} from './agent-spec.mjs';
import {
  AUTHORING_TOOL_RULES, authoringFinalSchema, authoringPageSchemas, checkedFigure, createCourseTools, inspectAuthoredSlide, recordCourseMedia, safeQuery,
} from './course-tools.mjs';
import { HARNESS_STAGES, NATIVE_BLOCK_SCHEMA, detectPageActivity, numberEvidence, runDeckHarness } from './deck-harness.mjs';
import { LECTURE_ARCHETYPES, LECTURE_LAYOUTS, blockText, inferSlideArchetype, validateLectureScore, validateSlideBlocks } from './lecture-score.mjs';
import {
  describeLessonProvider, redactProviderError, rejectProviderSecrets, requestStructuredCompletion, requestToolLoopCompletion,
} from './lesson-provider.mjs';
import { resolveFastProvider } from './provider-hub.mjs';
import { inferBlocksFromPlainSlide } from './slide-blocks.mjs';

const activityIds = MODULE_MANIFESTS.map(module => module.id);
const pacingModes = ['stem-60s', 'seminar-3m', 'full-demo'];
const roles = {
  intro: '学习目标', concept: '概念与条件', derivation: '推导与依据',
  example: '实例与反例', checkpoint: '理解检测', summary: '迁移与小结',
};
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const text = { type: 'string' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
const choices = values => ({ type: 'string', enum: values });
const layout = choices(LECTURE_LAYOUTS);
const activity = choices(activityIds);
const pagePlanSchema = object({
  pageNumber: integer, chapterTitle: text, title: text, role: choices(COURSE_PAGE_ROLES),
  archetype: choices(LECTURE_ARCHETYPES), layoutHint: layout, visualNeed: choices(COURSE_VISUAL_NEEDS), imageQuery: text, interactionCandidate: boolean,
  recommendedActivityId: { type: ['string', 'null'], enum: [...activityIds, null] },
});
export const COURSE_BLUEPRINT_SCHEMA = object({
  title: text,
  notationConventions: array(text, 0, 12),
  chapters: array(object({ title: text, startPage: integer, endPage: integer }), 1, 12),
  pagePlans: array(pagePlanSchema, 6, 48),
});
const checkpointsSchema = object({ checkpoints: array(object({ pageNumber: integer, activityId: activity }), 0, 16) });
const mediaCharacterBudget = 28 * 1024 * 1024;

const normalizeText = value => typeof value === 'string' ? value.trim() : '';
const lines = value => String(value ?? '').split(/\r\n?|\n/u).map(line => line.trim()).filter(Boolean);
const unique = items => [...new Set(items)];
const titleLimit = 180;
const sourceTranscriptLimit = 90_000;
const photoSubject = /显微|实验装置|实验设备|光学实验|衍射图样|干涉条纹|实验照片|观测照片|microscop|apparatus|optical bench|diffraction pattern/iu;

function isStandaloneFormula(line) {
  return /^\$\$?[\s\S]+\$\$?$/u.test(line) ||
    /^(?:[A-Za-z\u0370-\u03ff][\w_]*(?:\([^()]{1,30}\))?)\s*[=≈≤≥]\s*[^。；;]+$/u.test(line);
}

function providedFormulas(text) {
  return unique([
    ...Array.from(text.matchAll(/\$\$([^$]+)\$\$|\$([^$\r\n]+)\$/gu), match => match[1] ?? match[2]),
    ...lines(text.replace(/[;；]/gu, '\n')).filter(isStandaloneFormula),
  ]).slice(0, 4);
}

function courseSpec(input, options) {
  const course = normalizeText(input?.course ?? input?.courseName);
  const topic = normalizeText(input?.topic ?? input?.topics);
  const pageCount = Number(input?.pageCount ?? 10);
  const pacingMode = options.pacingMode ?? input?.pacingMode ?? 'stem-60s';
  const density = options.density ?? input?.density ?? 'balanced';
  if (!course || course.length > 300 || !topic || topic.length > 8000) throw Error('请填写课程对象（最多 300 字）与核心重难点（最多 8000 字）。');
  if (!Number.isInteger(pageCount) || pageCount < 6 || pageCount > 48) throw Error('课件规模须为 6–48 页。');
  if (!pacingModes.includes(pacingMode) || !COURSE_DENSITIES.includes(density)) throw Error('课堂节奏或互动密度无效。');
  return { course, topic, pageCount, pacingMode, density, enableWebImages: (options.enableWebImages ?? input?.enableWebImages) === true };
}

function providerContext(options) {
  const configuredMain = options.provider ?? {};
  const decisionProvider = resolveFastProvider(configuredMain, options.fastProvider);
  const provider = configured(configuredMain) ? configuredMain : decisionProvider;
  return { ...options, provider, decisionProvider, credentials: [configuredMain, decisionProvider, options.fastProvider] };
}

function configured(provider) {
  return describeLessonProvider(provider).configured;
}

async function ask(provider, context, schemaName, schema, instructions, data, timeoutMs, issue) {
  context.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = context.signal ? AbortSignal.any([context.signal, deadline]) : deadline;
  const content = await requestStructuredCompletion({
    ...provider, signal, schemaName, schema, credentialProviders: context.credentials,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: JSON.stringify({ ...data, schema }) },
      ...(issue ? [{ role: 'user', content: '修正以下校验问题并返回完整 JSON。' + issue }] : []),
    ],
  });
  signal.throwIfAborted();
  if (!content) throw Error('模型未返回完整 JSON。');
  rejectProviderSecrets(content, ...context.credentials);
  return rejectProviderSecrets(JSON.parse(content), ...context.credentials);
}

function validTitle(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > titleLimit) throw Error(`${field}需要非空短标题。`);
  return value.trim();
}

function plannedArchetype(plan, first, last) {
  if (first) return 'cover';
  if (last) return 'summary';
  if (plan.role === 'derivation') return 'derivation';
  if (plan.role === 'checkpoint') return 'split-compare';
  if (plan.role === 'example') return 'example';
  return 'section';
}

function annotateArchetypes(pagePlans) {
  return pagePlans.map((page, index) => ({ ...page,
    archetype: page.archetype ?? plannedArchetype(page, index === 0, index === pagePlans.length - 1),
  }));
}

function validateBlueprint(raw, pageCount) {
  const title = validTitle(raw?.title, '课程');
  if (!Array.isArray(raw.notationConventions) || raw.notationConventions.length > 12 ||
      raw.notationConventions.some(value => typeof value !== 'string' || !value.trim() || value.length > 160)) throw Error('符号约定须为短文本。');
  if (!Array.isArray(raw.chapters) || !raw.chapters.length || raw.chapters.length > 12) throw Error('章节列表无效。');
  if (!Array.isArray(raw.pagePlans) || raw.pagePlans.length !== pageCount) {
    const actual = Array.isArray(raw.pagePlans) ? `实际为 ${raw.pagePlans.length} 页` : '缺少有效数组';
    throw Error(`蓝图 pagePlans 页数不符，${actual}，必须严格包含 ${pageCount} 页。`);
  }
  const chapters = raw.chapters.map(entry => ({
    title: validTitle(entry?.title, '章节'), startPage: entry.startPage, endPage: entry.endPage,
  }));
  const chapterTitles = new Set(chapters.map(chapter => chapter.title));
  const pagePlans = raw.pagePlans.map((page, index) => {
    const { pageNumber, chapterTitle, role, layoutHint, visualNeed, imageQuery, interactionCandidate } = page ?? {};
    if (pageNumber !== index + 1) {
      throw Error(`蓝图第 ${index + 1} 项的 pageNumber 应为 ${index + 1}，实际为 ${Number.isInteger(pageNumber) ? pageNumber : '无效值'}。`);
    }
    if (!chapterTitles.has(chapterTitle)) throw Error(`第 ${pageNumber} 页的 chapterTitle 未对应已声明的章节。`);
    const recommendedActivityId = page.recommendedActivityId || null;
    if (!COURSE_PAGE_ROLES.includes(role) || !LECTURE_LAYOUTS.includes(layoutHint) || !COURSE_VISUAL_NEEDS.includes(visualNeed) ||
        typeof imageQuery !== 'string' || imageQuery.length > 160 || typeof interactionCandidate !== 'boolean' ||
        (page.archetype !== undefined && !LECTURE_ARCHETYPES.includes(page.archetype)) ||
        (recommendedActivityId !== null && !activityIds.includes(recommendedActivityId))) throw Error(`第 ${index + 1} 页的蓝图字段无效。`);
    return { pageNumber, chapterTitle, title: validTitle(page.title, '页面'), role, layoutHint, visualNeed, imageQuery: imageQuery.trim(),
      interactionCandidate, recommendedActivityId, archetype: page.archetype };
  });
  return { title, notationConventions: unique(raw.notationConventions.map(value => value.trim())),
    chapters: alignBlueprintChapters(chapters, pagePlans), pagePlans: annotateArchetypes(pagePlans) };
}

function alignBlueprintChapters(chapters, pagePlans) {
  let previousEnd = 0;
  const rangesMatch = chapters.every(({ title, startPage, endPage }) => {
    if (startPage !== previousEnd + 1 || !Number.isInteger(endPage) || endPage < startPage || endPage > pagePlans.length ||
        !pagePlans.slice(startPage - 1, endPage).every(page => page.chapterTitle === title)) return false;
    previousEnd = endPage;
    return true;
  });
  if (rangesMatch && previousEnd === pagePlans.length) return chapters;

  const aligned = [];
  for (const { chapterTitle, pageNumber } of pagePlans) {
    const chapter = aligned.at(-1);
    if (chapter?.title === chapterTitle) chapter.endPage = pageNumber;
    else aligned.push({ title: chapterTitle, startPage: pageNumber, endPage: pageNumber });
  }
  if (aligned.length !== chapters.length || !chapters.every(({ title, startPage, endPage }, index) => {
    const expected = aligned[index];
    return expected.title === title && Number.isInteger(startPage) && Number.isInteger(endPage) &&
      Math.abs(startPage - expected.startPage) <= 1 && Math.abs(endPage - expected.endPage) <= 1;
  })) throw Error('章节页段须按 pagePlans 的章节顺序连续覆盖指定页数，核对每章的 startPage 和 endPage。');
  return aligned;
}

function localBlueprint(spec, corpus) {
  const topics = unique(spec.topic.split(/[\n；;。]+/u).map(value => value.trim()).filter(Boolean));
  const subject = (topics[0] ?? spec.topic).slice(0, 72);
  const chapterCount = Math.min(8, Math.max(1, Math.ceil(spec.pageCount / 8)));
  const chapters = Array.from({ length: chapterCount }, (_, index) => {
    const startPage = Math.floor(index * spec.pageCount / chapterCount) + 1;
    const endPage = Math.floor((index + 1) * spec.pageCount / chapterCount);
    const label = corpus?.pages.get(startPage)?.blocks[0]?.sourceTitle ?? topics[Math.floor(index * topics.length / chapterCount)] ?? subject;
    const title = chapterCount === 1 ? label : `${label} · ${['建立基础', '细化依据', '展开推导', '检验应用', '比较方案', '连接章节', '综合判断', '回顾迁移'][Math.floor(index * 8 / chapterCount)]}`;
    return { title: title.slice(0, titleLimit), startPage, endPage };
  });
  const cycle = ['concept', 'derivation', 'example', 'checkpoint', 'derivation', 'example'];
  const formulas = providedFormulas(spec.topic);
  const pagePlans = chapters.flatMap(({ title: chapterTitle, startPage, endPage }) =>
    Array.from({ length: endPage - startPage + 1 }, (_, index) => {
      const pageNumber = startPage + index;
      const roleIndex = index - Number(startPage === 1);
      const role = pageNumber === 1 ? 'intro' : pageNumber === spec.pageCount ? 'summary' : cycle[roleIndex % cycle.length];
      const unit = corpus?.pages.get(pageNumber)?.blocks[0];
      const label = unit?.sourceTitle ?? (chapterCount > 1 ? chapterTitle : topics[Math.floor((pageNumber - 1) * topics.length / spec.pageCount)]) ?? subject;
      const wantsPhoto = !corpus && spec.enableWebImages && role === 'example' && roleIndex === 2 && photoSubject.test(label);
      const visualNeed = unit?.block.type === 'formula' || (role === 'derivation' && formulas.length)
        ? 'formula' : wantsPhoto ? 'image-search' : unit?.block.type === 'diagram' || role === 'example' ? 'diagram' : 'none';
      const roleLabel = role === 'derivation' && roleIndex === 4 ? '核对中间结论' : role === 'example' && roleIndex === 5 ? '改变条件再检验' : roles[role];
      return {
        pageNumber, chapterTitle, title: `${label.slice(0, 128)} · ${roleLabel}`, role,
        layoutHint: 'auto', visualNeed, imageQuery: wantsPhoto ? safeQuery(label) : '', interactionCandidate: role === 'checkpoint',
        recommendedActivityId: role === 'checkpoint' ? 'concept-diagnosis@1' : null,
      };
    }));
  const notationConventions = topics.filter(topic => /(?:\$.*\$|[A-Za-z\u0370-\u03ff]\s*(?:表示|代表|记为|=))/u.test(topic))
    .slice(0, 8).map(topic => topic.slice(0, 150));
  if (!notationConventions.length) notationConventions.push('沿用首次出现的变量、单位与术语，明确写出适用条件。');
  return { title: (corpus ? `${corpus.title} · 原生重构` : `${spec.course} · ${subject}`).slice(0, titleLimit),
    notationConventions, chapters, pagePlans: annotateArchetypes(pagePlans) };
}

function repairEntry(issue, details = {}) {
  return {
    ...details, status: 'repaired', issue,
    beforeSummary: issue,
    afterSummary: '结构复验通过。',
  };
}

async function prepareBlueprint(spec, context) {
  const { provider, signal, corpus } = context;
  signal?.throwIfAborted();
  if (!configured(provider)) return { blueprint: localBlueprint(spec, corpus), repairs: [] };
  let issue = '';
  const timeoutMs = 150_000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const schema = { ...COURSE_BLUEPRINT_SCHEMA, properties: { ...COURSE_BLUEPRINT_SCHEMA.properties,
    pagePlans: array(pagePlanSchema, spec.pageCount, spec.pageCount),
  } };
  const stageContext = { ...context, signal: signal ? AbortSignal.any([deadline, signal]) : deadline };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await ask(provider, stageContext, 'course_blueprint', schema,
        COURSE_AUTHORING_RULES + '\n规划符号表、连续的章节页段、每页教学任务、原型和互动候选。页码从 1 连续编号。' +
          `\nchapters 与 pagePlans 必须严格覆盖第 1 到第 ${spec.pageCount} 页，pagePlans 数组长度必须严格等于 ${spec.pageCount}，不得多页或少页！` +
          (corpus ? '\n' + SOURCE_ADAPTATION_RULES + '\n逐页任务沿用给定的原稿主题分配。' : ''),
        { spec, interactionBudget: interactionBudget(spec.pageCount, spec.density), ...(corpus && { sourceOutline: corpus.outline }) },
        timeoutMs, attempt === 1 ? issue : undefined);
      const blueprint = validateBlueprint(raw, spec.pageCount);
      const repairs = issue ? [repairEntry(issue)] : [];
      if (blueprint.chapters.some(({ startPage, endPage }, index) =>
        startPage !== raw.chapters[index].startPage || endPage !== raw.chapters[index].endPage)) {
        repairs.push(repairEntry('已按逐页蓝图对齐章节的页码边界。'));
      }
      return { blueprint, repairs };
    } catch (error) {
      signal?.throwIfAborted();
      issue = redactProviderError(error, ...context.credentials);
      if (deadline.aborted || ['http', 'length', 'network', 'timeout', 'refusal'].includes(error?.code)) break;
    }
  }
  return { blueprint: null, repairs: [], reason: issue };
}

export async function planCourseBlueprint(input, options = {}) {
  const spec = courseSpec(input, options);
  const context = providerContext(options);
  rejectProviderSecrets(spec, ...context.credentials);
  const { blueprint, reason } = await prepareBlueprint(spec, context);
  if (!blueprint) throw Error(reason);
  return blueprint;
}

function divideBatches(plans) {
  const batches = [];
  for (let offset = 0; offset < plans.length;) {
    const feasible = [5, 4, 3].filter(size => plans.length === offset + size || plans.length >= offset + size + 3);
    const size = feasible.find(size => plans[offset + size - 1].chapterTitle !== plans[offset + size]?.chapterTitle) ?? feasible[0] ?? plans.length - offset;
    const pagePlans = plans.slice(offset, offset + size);
    batches.push({ index: batches.length + 1, startPage: pagePlans[0].pageNumber, endPage: pagePlans.at(-1).pageNumber, pagePlans });
    offset += size;
  }
  return batches;
}

function teachingDiagram(plan, blocks, { fromSource = false } = {}) {
  const evidence = unique(blocks.flatMap(block => lines(blockText(block))))
    .filter(line => line !== plan.title && line !== plan.chapterTitle).slice(0, 2);
  const captions = [
    ['观察对象', evidence[0] ?? plan.title], ['核对依据', evidence[1] ?? '指出可观察的条件'],
    ['检验结论', '说明需要哪条证据'],
  ];
  return {
    type: 'diagram', title: fromSource ? '阅读原稿的检查路径' : '本页观察与验证路径', kind: 'flow', direction: 'TB',
    nodes: captions.map(([label, value], index) => ({ id: `n${index + 1}`, label, sub: value.slice(0, 72) })),
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  };
}

function localSlide(plan, blueprint, spec) {
  const { pageNumber, title, chapterTitle, role, visualNeed } = plan;
  const task = {
    intro: ['列出先修概念。', '指出本讲要判断的问题。'],
    concept: ['先用一个实例界定对象。', '记录定义中的必要条件。'],
    derivation: ['逐项标出已知量和待求量。', '说明每一步依据，并标记定义域。'],
    example: ['给出一个满足条件的实例。', '改变一个条件并检查结果。'],
    checkpoint: ['独立写出判断。', '用一条本页依据复核，必要时改答。'],
    summary: ['回到开头的学习问题。', '说明结论可用的场景和边界。'],
  }[role];
  const blocks = [
    { type: 'steps', title: roles[role], items: [`聚焦「${title}」。`, ...task] },
    { type: 'callout', title: '讲授依据', text: `从「${chapterTitle}」的教材段落、可复演操作或实例中补齐本页证据。`, tone: 'note' },
  ];
  if (role === 'intro') {
    blocks[1] = { type: 'bullets', title: '本讲路径', items: blueprint.chapters.map(chapter => chapter.title) };
  } else if (visualNeed === 'diagram' || visualNeed === 'image-search') {
    blocks[1] = teachingDiagram(plan, blocks);
  } else if (visualNeed === 'formula') {
    const formulas = providedFormulas(spec.topic);
    if (formulas.length) blocks[1] = { type: 'formula', title: '教师给出的原式', items: formulas.slice(0, 3) };
  }
  return toPage(pageNumber, title, blocks, `先提出「${title}」的问题，沿用约定的符号、单位与术语。让学生指出本页判断所需的具体依据。`);
}

function toPage(number, title, blocks, speakerNotes, images = []) {
  return { number, title, blocks, speakerNotes, text: evidenceText(blocks.map(blockText).join('\n'), title), images };
}

function evidenceText(value, title) {
  const material = lines(value);
  if (material[0] === title) material.shift();
  return material.join('\n');
}
function authoredPage(entry, plan, assets, previous) {
  if (typeof entry.speakerNotes !== 'string' || entry.speakerNotes.length > 4000) throw Error('请提供不超过 4000 字的讲者备注。');
  const title = validTitle(entry.title, '页面');
  const blocks = assets.materializeBlocks(entry.blocks, previous?.blocks);
  const { errors } = inspectAuthoredSlide({ title }, blocks);
  if (!blocks.some(block => blockText(block).trim())) errors.push('请提供实际授课内容。');
  if (errors.length) throw Error(errors.slice(0, 6).join(' '));
  const images = entry.mediaIds === undefined ? previous?.images ?? [] : assets.mediaImages(entry.mediaIds, previous?.images);
  return toPage(plan.pageNumber, title, blocks, entry.speakerNotes.trim(), images);
}

function layoutPage(page, plan, pages, { archetype, layout } = {}) {
  if (archetype !== undefined && !LECTURE_ARCHETYPES.includes(archetype)) throw Error('页面视觉原型无效。');
  if (layout !== undefined && !LECTURE_LAYOUTS.includes(layout)) throw Error('页面版式无效。');
  const number = page.number;
  const sameNeighbors = [[-2, -1], [-1, 1], [1, 2]].flatMap(([a, b]) => {
    const value = pages.get(number + a)?.archetype;
    return value && value === pages.get(number + b)?.archetype ? [value] : [];
  });
  const preferred = archetype ?? plan.archetype;
  const chosen = [preferred, inferSlideArchetype(page), plan.archetype, 'section', 'split-compare', 'example']
    .find(value => value && !sameNeighbors.includes(value));
  return { ...page, archetype: chosen,
    layout: suggestCourseLayout({ archetype: chosen, visualNeed: plan.visualNeed, layoutHint: layout ?? plan.layoutHint, blocks: page.blocks, images: page.images }),
  };
}

function previewPage({ number, title, blocks, archetype, layout, images }) {
  return { number, title, blocks, archetype, layout, imageCount: images.length };
}

function priorPagesContext(batch, committed) {
  const authored = [...committed.values()].filter(page => page.number < batch.startPage).sort((a, b) => a.number - b.number);
  return {
    coveredConcepts: authored.map(page => ({
      pageNumber: page.number, title: page.title,
      concepts: page.blocks.flatMap(block => lines(blockText(block))).slice(0, 3).map(line => line.slice(0, 105)),
    })),
    priorArchetypes: authored.map(page => ({ pageNumber: page.number, archetype: page.archetype })),
    priorNotation: unique(authored.flatMap(page => page.blocks.flatMap(block => block.type === 'formula'
      ? block.items : Array.from(blockText(block).matchAll(/\$([^$\r\n]+)\$/gu), match => match[1]))))
      .slice(-18).map(formula => formula.slice(0, 130)),
  };
}

function failure(stage, pageNumbers, reason, extra = {}) {
  return { stage, startPage: pageNumbers[0], endPage: pageNumbers.at(-1), pageNumbers, reason, ...extra };
}

function canFitImages(page, pages) {
  let length = page.images.reduce((size, image) => size + image.src.length, 0);
  for (const [number, earlier] of pages) {
    if (number !== page.number) length += earlier.images.reduce((size, image) => size + image.src.length, 0);
  }
  return length <= mediaCharacterBudget;
}

function groundedPage(entry, plan, assets, corpus, previous) {
  const existing = previous?.sourceSelection;
  const assigned = corpus.pages.get(plan.pageNumber);
  const sourceBlockIds = entry.sourceBlockIds ?? existing?.sourceBlockIds;
  const sourceImageIds = entry.sourceImageIds ?? existing?.sourceImageIds;
  const blocks = chooseSourceIds(sourceBlockIds, assigned.blocks, 1, 3);
  const selected = chooseSourceIds(sourceImageIds, assigned.images, 0, 2);
  const originals = selected.length ? selected : assigned.images.slice(0, 1);
  const page = sourceSlide(plan, blocks, originals, assigned.blocks);
  if (!originals.length) page.images = entry.mediaIds === undefined ? previous?.images ?? [] : assets.mediaImages(entry.mediaIds, previous?.images);
  return { ...page, sourceSelection: { sourceBlockIds, sourceImageIds } };
}

function extensionPage(entry, plan, assets, previous) {
  const ids = entry.evidenceIds ?? previous?.evidenceIds;
  const allowed = new Set(plan.materials.map(material => material.id));
  if (!Array.isArray(ids) || !ids.length || ids.length > 4 || new Set(ids).size !== ids.length || ids.some(id => !allowed.has(id))) {
    throw Error('请用本页实际原文的 M 编号锚定拓展。');
  }
  return { ...authoredPage(entry, plan, assets, previous), evidenceIds: ids };
}

async function writeBatch(batch, blueprint, spec, context, pages, onCommit, { phase = 'course_slide_batch' } = {}) {
  const { provider, signal, corpus, credentials, usedMediaKeys } = context;
  const { index, startPage, endPage, pagePlans } = batch;
  const details = { batchIndex: index, startPage, endPage };
  const source = phase === 'course_source_batch', enhance = phase === 'course_enhance_batch';
  const plans = new Map(pagePlans.map(plan => [plan.pageNumber, plan]));
  if (!configured(provider)) {
    for (const plan of pagePlans) {
      const raw = source ? localSourceSlide(plan, corpus) : localSlide(plan, blueprint, spec);
      const page = layoutPage(raw, plan, pages, { archetype: plan.archetype });
      while (page.images.length && !canFitImages(page, pages)) page.images.pop();
      pages.set(page.number, page);
      onCommit();
    }
    return { source: 'local', failures: [] };
  }

  const schemas = authoringPageSchemas(NATIVE_BLOCK_SCHEMA);
  const pageSchema = source ? schemas.grounded : enhance ? schemas.enhanced : schemas.authored;
  const issues = new Map();
  const build = (entry, assets, previous) => {
    const plan = plans.get(entry?.pageNumber);
    if (!plan) throw Error('提交页码不在本批范围内。');
    const raw = source ? groundedPage(entry, plan, assets, corpus, previous)
      : enhance ? extensionPage(entry, plan, assets, previous) : authoredPage(entry, plan, assets, previous);
    const page = layoutPage(raw, plan, pages, { archetype: entry.archetype, layout: entry.layout });
    if (!canFitImages(page, pages)) throw Error('课件图片已接近离线容量上限，请减少补图。');
    return rejectProviderSecrets(page, ...credentials);
  };
  const add = (entry, assets, previous) => {
    const page = build(entry, assets, previous);
    pages.set(page.number, page);
    assets.recordMedia(page.images);
    issues.delete(page.number);
    onCommit();
    return page;
  };
  function commit({ pages: entries }, assets) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 5) throw Error('请提交 1–5 张本批页面。');
    const committed = [], problems = [];
    let imageCount = 0;
    for (const entry of entries) {
      const number = entry?.pageNumber;
      if (plans.has(number) && pages.has(number)) continue;
      try {
        const page = add(entry, assets);
        committed.push(number);
        imageCount += page.images.length;
      } catch (error) {
        const reason = redactProviderError(error, ...credentials);
        if (plans.has(number)) issues.set(number, reason);
        problems.push({ pageNumber: Number.isInteger(number) ? number : null, reason });
      }
    }
    return { ok: !problems.length, committed, issues: problems,
      summary: `已提交 ${committed.length} 页${imageCount ? `，内嵌 ${imageCount} 张图片` : ''}`,
      detail: problems.length ? problems.map(({ pageNumber, reason }) => `第 ${pageNumber ?? '?'} 页：${reason}`).join(' ')
        : committed.length ? `第 ${committed.join('、')} 页` : '页面已提交',
    };
  }
  function revise({ pageNumber, patch }, assets) {
    const previous = pages.get(pageNumber);
    if (!previous || !plans.has(pageNumber)) throw Error('只能改写本批已提交页。');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw Error('需要提供页面改动。');
    add({ ...previous, ...patch, pageNumber }, assets, previous);
    return { ok: true, summary: `精修第 ${pageNumber} 页` };
  }
  const toolbox = createCourseTools({ context, spec, pageSchema, schemas, commit, revise, usedMediaKeys });
  const data = {
    phase, course: spec.course, topic: spec.topic, courseTitle: blueprint.title, pagePlans,
    notationConventions: blueprint.notationConventions, ...priorPagesContext(batch, pages),
    upcomingPages: blueprint.pagePlans.filter(plan => plan.pageNumber > endPage).slice(0, 2).map(plan => plan.title),
    ...(source && { sourcePages: sourceForBatch(corpus, batch) }),
  };
  const prompt = COURSE_AUTHORING_RULES + '\n' + AUTHORING_TOOL_RULES +
    '\n仅处理 given pagePlans 的页码。可以逐页或批量提交。互动另行合成。' +
    (source ? '\n' + SOURCE_ADAPTATION_RULES + '\n重构页用 sourceBlockIds 与 sourceImageIds 保留原稿，只为缺图页添加媒体编号。' : '') +
    (enhance ? '\n原稿材料是事实依据。从给出的 M 编号选择 1–4 条作为 evidenceIds。用原理图、推导、对照或可验算例题扩展本页，保留原式和适用条件。' : '');
  const timeoutMs = 270_000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const batchSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const pendingPlans = () => pagePlans.filter(plan => !pages.has(plan.pageNumber));
  let issue = '', repaired = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const missingPlans = pendingPlans();
    if (!missingPlans.length || deadline.aborted) break;
    const missingPages = missingPlans.map(plan => plan.pageNumber).join('、');
    try {
      const messages = [{ role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify({ ...data, pagePlans: missingPlans,
          ...(attempt === 1 && {
            validationFeedback: [...issues].map(([pageNumber, reason]) => ({ pageNumber, reason })), issue,
            completionFeedback: `你尚未调用 commit_slides 提交第 ${missingPages} 页，请按 pagePlans 立即补齐第 ${missingPages} 页后返回 {"done":true}。`,
          }) }) }];
      const final = await requestToolLoopCompletion({
        provider, fastProvider: context.decisionProvider, messages, tools: toolbox.tools, handlers: toolbox.handlers,
        finalSchema: authoringFinalSchema(pageSchema), maxSteps: attempt ? 8 : 14,
        signal: batchSignal, timeoutMs, requestTimeoutMs: 150_000,
        onToolEvent: event => context.onToolEvent?.({ ...event, ...details, scope: enhance ? 'enhance' : 'batch' }),
      });
      if (Array.isArray(final?.pages) && final.pages.length) {
        const submission = commit(final, toolbox);
        if (submission.committed.length || submission.issues.length) context.onToolEvent?.({
          step: 0, tool: 'commit_slides', status: submission.ok ? 'info' : 'error', summary: submission.summary,
          detail: submission.detail, ...details, scope: enhance ? 'enhance' : 'batch',
        });
      }
      const missing = pendingPlans();
      if (!missing.length) { repaired = attempt > 0; break; }
      issue = `模型未提交第 ${missing.map(plan => plan.pageNumber).join('、')} 页。`;
    } catch (error) {
      signal?.throwIfAborted();
      issue = redactProviderError(error, ...credentials);
      if (deadline.aborted || ['http', 'length', 'network', 'timeout', 'refusal'].includes(error?.code)) break;
    }
  }
  const missingNumbers = pagePlans.map(plan => plan.pageNumber).filter(number => !pages.has(number));
  const reasons = new Map();
  for (const number of missingNumbers) {
    const reason = issues.get(number) ? `${issue} ${issues.get(number)}` : issue;
    const failed = reasons.get(reason) ?? [];
    failed.push(number);
    reasons.set(reason, failed);
  }
  const failures = [...reasons].map(([reason, numbers]) => failure(enhance ? 'enhance' : 'batch', numbers, reason, { batchIndex: index }));
  if (issue && !failures.length && !repaired) context.onToolEvent?.({
    step: 0, tool: 'tool_protocol', status: 'info', summary: '成稿已保留', detail: issue, ...details,
  });
  return { source: 'provider', failures, ...(repaired && { repair: repairEntry(issue, details) }) };
}

export async function authorSlideBatches(blueprint, options = {}) {
  const spec = options.spec ?? courseSpec({ course: blueprint.title, topic: blueprint.title, pageCount: blueprint.pagePlans.length }, options);
  const context = providerContext({ ...options, usedMediaKeys: options.usedMediaKeys ?? new Set() });
  const { signal, corpus, usedMediaKeys } = context;
  const batches = divideBatches(blueprint.pagePlans);
  const targets = options.targetPages ?? new Set(blueprint.pagePlans.map(plan => plan.pageNumber));
  const pages = new Map((options.previousPages ?? []).map(page => [page.number, page]));
  for (const page of pages.values()) recordCourseMedia(usedMediaKeys, page.images ?? []);
  const progress = batches.map(({ index, startPage, endPage, pagePlans }) => ({
    index, startPage, endPage, status: pagePlans.some(plan => targets.has(plan.pageNumber)) ? 'pending'
      : pagePlans.every(plan => pages.has(plan.pageNumber)) ? 'complete' : 'failed',
  }));
  const repairs = [], failures = [];
  const emit = () => {
    signal?.throwIfAborted();
    context.onBatch?.(structuredClone(progress), structuredClone(repairs), [...pages.values()], structuredClone(failures));
  };
  emit();
  for (const batch of batches) {
    const pagePlans = batch.pagePlans.filter(plan => targets.has(plan.pageNumber));
    if (!pagePlans.length) continue;
    const state = progress[batch.index - 1];
    state.status = 'running';
    emit();
    const written = await writeBatch({ ...batch, pagePlans }, blueprint, spec, context, pages, emit,
      { phase: corpus ? 'course_source_batch' : 'course_slide_batch' });
    if (written.repair) repairs.push(written.repair);
    failures.push(...written.failures);
    Object.assign(state, { status: batch.pagePlans.every(plan => pages.has(plan.pageNumber)) ? 'complete' : 'failed', source: written.source });
    emit();
  }
  return { pages: [...pages.values()].sort((left, right) => left.number - right.number), batches: progress, repairs, failures };
}

function recommendedActivity(plan, page, pacingMode) {
  const detected = detectPageActivity(page, pacingMode);
  if (detected !== 'concept-diagnosis@1') return detected;
  if (page.blocks.some(block => block.type === 'code' || block.type === 'code-pair')) return 'step-fault@1';
  return plan.recommendedActivityId ?? detected;
}

async function courseCheckpoints(blueprint, pages, spec, context) {
  const budget = interactionBudget(pages.size, spec.density);
  const candidates = blueprint.pagePlans.flatMap(plan => {
    const page = pages.get(plan.pageNumber);
    if (!page?.text.trim() || ['intro', 'summary'].includes(plan.role)) return [];
    return [{ pageNumber: plan.pageNumber, title: page.title, role: plan.role, marked: plan.interactionCandidate,
      excerpt: page.text.slice(0, 220), blockTypes: page.blocks.map(block => block.type),
      activityId: recommendedActivity(plan, page, spec.pacingMode) }];
  });
  const suggested = new Map();
  if (candidates.length && describeLessonProvider(context.decisionProvider).configured) {
    try {
      const raw = await ask(context.decisionProvider, context, 'course_checkpoint_triage', checkpointsSchema,
        COURSE_AUTHORING_RULES + '\n为理解转折选出最多 budget 个互动页。仅使用所列页码与协议。兼顾章节分布，证据允许时选不同协议。',
        { budget, density: spec.density, pacingMode: spec.pacingMode, candidates }, 12_000);
      const allowed = new Set(candidates.map(item => item.pageNumber));
      for (const entry of Array.isArray(raw?.checkpoints) ? raw.checkpoints.slice(0, budget) : []) {
        if (allowed.has(entry?.pageNumber) && activityIds.includes(entry.activityId)) suggested.set(entry.pageNumber, entry.activityId);
      }
    } catch (error) {
      context.signal?.throwIfAborted();
      context.onToolEvent?.({ step: 0, tool: 'checkpoint_triage', status: 'error', summary: '快速模型未完成卡点选择',
        detail: redactProviderError(error, ...context.credentials) });
    }
  }
  // Choose within ordered intervals so a strong chapter cannot consume the entire budget.
  const count = Math.min(budget, candidates.length);
  const used = new Map(), selected = [];
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * candidates.length / count), end = Math.floor((index + 1) * candidates.length / count);
    const center = (start + end - 1) / 2;
    const choices = candidates.slice(start, end).map((item, offset) => {
      const activityId = suggested.get(item.pageNumber) ?? item.activityId;
      const score = Number(suggested.has(item.pageNumber)) * 6 + Number(item.marked) * 3 +
        Number(item.role === 'derivation' || item.role === 'example') -
        (used.get(activityId) ?? 0) * 1.5 - Math.abs(start + offset - center) -
        Number(selected.at(-1)?.pageNumber === item.pageNumber - 1) * 3;
      return { pageNumber: item.pageNumber, activityId, score };
    });
    const { pageNumber, activityId } = choices.sort((a, b) => b.score - a.score)[0];
    selected.push({ pageNumber, activityId });
    used.set(activityId, (used.get(activityId) ?? 0) + 1);
  }
  return selected;
}

function longReceipt(phase, batches = [], message) {
  const activeBatches = batches.filter(batch => batch.status === 'running').map(({ index, startPage, endPage }) => ({ index, startPage, endPage }));
  const completedBatches = batches.filter(batch => batch.status === 'complete').length;
  const active = activeBatches[0];
  const detail = message ?? (active
    ? `正在编写第 ${active.index}/${batches.length} 批（第 ${active.startPage}–${active.endPage} 页）`
    : `已完成 ${completedBatches}/${batches.length} 批`);
  return {
    phase, totalPhases: 3, message: `阶段 ${phase}/3 · ${detail}`,
    batchCount: batches.length, completedBatches, activeBatches, batches,
  };
}

function reviewPages(pages) {
  return [...pages.values()].sort((a, b) => a.number - b.number).map(page => {
    const { errors, issues } = inspectAuthoredSlide(page, page.blocks);
    return {
      pageNumber: page.number, title: page.title, archetype: page.archetype, layout: page.layout,
      blocks: page.blocks.map(block => ({ type: block.type, excerpt: blockText(block).slice(0, 450) })),
      imageCount: page.images.length, issues: [...errors, ...issues].slice(0, 6),
      ...(page.evidenceIds && { evidenceIds: page.evidenceIds }),
    };
  });
}

async function auditCourse(blueprint, pages, spec, context, checkpoints, editable, onCommit) {
  if (!configured(context.decisionProvider) || !editable.size) return undefined;
  const { signal, decisionProvider, credentials, corpus, usedMediaKeys } = context;
  const plans = new Map(blueprint.pagePlans.map(plan => [plan.pageNumber, plan]));
  const revisedPages = [];
  const status = { reviewedPages: pages.size, revisedPages, status: 'complete',
    tier: decisionProvider === context.provider ? 'main' : 'fast' };
  const announce = (state, summary, detail = '') => context.onToolEvent?.({
    step: 0, tool: 'course_review', status: state, scope: 'review', summary, detail,
  });
  const revise = ({ pageNumber, patch }, assets) => {
    if (!editable.has(pageNumber) || revisedPages.includes(pageNumber) || revisedPages.length >= 3) {
      throw Error('自审最多定点精修三张可改写页，每页一次。');
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw Error('请提供可核对的改动。');
    const previous = pages.get(pageNumber), plan = plans.get(pageNumber);
    if (corpus && Object.keys(patch).some(key => !['sourceBlockIds', 'sourceImageIds', 'mediaIds', 'archetype', 'layout'].includes(key))) {
      throw Error('重构自审可调整原稿项、版式与配图，原稿的事实与式子保持完整。');
    }
    const entry = { ...previous, ...patch };
    const raw = corpus ? groundedPage(patch, plan, assets, corpus, previous)
      : plan.materials ? extensionPage(entry, plan, assets, previous) : authoredPage(entry, plan, assets, previous);
    const revised = layoutPage(raw, plan, pages, { archetype: patch.archetype ?? previous.archetype, layout: patch.layout ?? previous.layout });
    if (!canFitImages(revised, pages)) throw Error('图片超过离线容量余量。');
    rejectProviderSecrets(revised, ...credentials);
    pages.set(pageNumber, revised);
    assets.recordMedia(revised.images);
    revisedPages.push(pageNumber);
    onCommit();
    return { ok: true, summary: `精修第 ${pageNumber} 页` };
  };
  announce('running', `正在自审 ${pages.size} 页`);
  try {
    const schemas = authoringPageSchemas(NATIVE_BLOCK_SCHEMA);
    const toolbox = createCourseTools({ spec, context, schemas, revise, usedMediaKeys });
    const final = await requestToolLoopCompletion({
      provider: decisionProvider, fastProvider: context.provider, tools: toolbox.tools, handlers: toolbox.handlers,
      signal, finalSchema: authoringFinalSchema(), maxSteps: 8, timeoutMs: 90_000, requestTimeoutMs: 45_000,
      messages: [
        { role: 'system', content: COURSE_AUTHORING_RULES + '\n' +
          '自审全卷符号和条件、原型节奏、KaTeX、图文平衡、互动卡点分布。各页提交时已完成校验且 pages[].issues 已给出全部问题，无需逐页重复调用 validate_math_and_diagram。需要时直接用 revise_slide 精修最薄弱的 1–3 张可改写页（每页一次），无明显缺陷则直接返回 JSON {"done":true}。' +
          '只更新必要字段，完整改写 blocks 时须保留原稿依据与有效公式。已有图表位于页内，更新其它内容时可保留 blocks。完成返回 JSON {"done":true}。' +
          (corpus ? '\n' + SOURCE_ADAPTATION_RULES : '') +
          (blueprint.pagePlans.some(plan => plan.materials) ? '\n拓展页继续沿用给定 M 编号、原式与条件。' : '') },
        { role: 'user', content: JSON.stringify({
          phase: 'course_review', notationConventions: blueprint.notationConventions, chapters: blueprint.chapters,
          pages: reviewPages(pages), checkpoints, pacingMode: spec.pacingMode, density: spec.density, editablePages: [...editable], maxRevisions: 3,
          ...(corpus && { sourcePages: sourceForBatch(corpus, { pagePlans: blueprint.pagePlans }).map(page => ({ ...page, blocks: page.blocks.slice(0, 4) })) }),
          ...(!corpus && blueprint.pagePlans.some(plan => plan.materials) && { sourcePages: blueprint.pagePlans.map(({ pageNumber, materials }) => ({ pageNumber, materials })) }),
        }) },
      ],
      onToolEvent: event => context.onToolEvent?.({ ...event, scope: 'review' }),
    });
    if (final?.done !== true) throw Error('自审未返回完成确认。');
    announce('success', revisedPages.length ? `已精修第 ${revisedPages.join('、')} 页` : '全卷自审完成');
    return status;
  } catch (error) {
    signal?.throwIfAborted();
    const reason = redactProviderError(error, ...credentials);
    announce('error', '自审未完成，已提交成稿可用', reason);
    return { ...status, status: 'failed', reason };
  }
}

function restoreRetry(retry, pageNumbers, context) {
  if (!retry) return { previous: null, targeted: [], retained: [] };
  if (!configured(context.provider)) throw Error('请先重新连接模型，再重试失败页。');
  rejectProviderSecrets(retry, ...context.credentials);
  const allowed = new Set(pageNumbers);
  if (!Array.isArray(retry.failures) || !retry.failures.length ||
      retry.failures.some(item => !item?.pageNumbers?.length || !Array.isArray(item.pageNumbers) ||
        item.pageNumbers.some(number => !allowed.has(number)) || !['blueprint', 'batch', 'enhance', 'interaction'].includes(item.stage))) {
    throw Error('失败页记录无效，请重新开始编排。');
  }
  const eligible = new Set(retry.failures.flatMap(item => item.pageNumbers));
  const requested = retry.pageNumbers ?? [...eligible];
  if (!Array.isArray(requested) || !requested.length || requested.some(number => !eligible.has(number))) throw Error('请选择有效的失败页。');
  const selected = new Set(requested);
  const filter = include => retry.failures.flatMap(({ stage, pageNumbers: numbers, reason, batchIndex, activityId }) => {
    const subset = unique(numbers.filter(number => selected.has(number) === include)).sort((a, b) => a - b);
    return subset.length ? [failure(stage, subset, redactProviderError(reason, ...context.credentials),
      { ...(Number.isInteger(batchIndex) && { batchIndex }), ...(activityIds.includes(activityId) && { activityId }) })] : [];
  });
  return { previous: retry.lectureScore ? validateLectureScore(retry.lectureScore) : null,
    targeted: filter(true), retained: filter(false) };
}

function previousCoursePages(lecture, pageCount, omissions = []) {
  if (!lecture) return [];
  if (!Array.isArray(omissions) || omissions.length > 48 || omissions.some(item =>
    !Number.isSafeInteger(item?.pageNumber) || !Number.isSafeInteger(item.count) || item.count < 0)) throw Error('已有原稿摘录回执无效。');
  const omitted = new Map(omissions.map(({ pageNumber, count }) => [pageNumber, count]));
  return lecture.pages.map(page => {
    if (page.number > pageCount || !page.blocks?.length) throw Error('已有成稿与待重试课件不匹配。');
    return { number: page.number, title: page.title, blocks: page.blocks, text: page.body.join('\n'),
      images: page.images ?? [], layout: page.layout, archetype: page.archetype, speakerNotes: page.speakerNotes ?? '',
      ...(page.sourceExcerpt && { sourceExcerpt: page.sourceExcerpt }),
      ...(omitted.has(page.number) && { transcriptOmissions: omitted.get(page.number) }),
    };
  });
}

function retainedInteractions(previous) {
  return new Map((previous?.pages ?? []).filter(page => page.interaction).map(page => [page.number, page.interaction]));
}

function selectedRetryCheckpoints(targeted, pages, pacingMode) {
  return targeted.filter(item => item.stage === 'interaction').flatMap(({ pageNumbers, activityId }) =>
    pageNumbers.flatMap(pageNumber => pages.has(pageNumber)
      ? [{ pageNumber, activityId: activityId ?? detectPageActivity(pages.get(pageNumber), pacingMode) }] : []));
}

function authoringProgress(context, fields = {}) {
  const { signal, onStage, credentials } = context;
  const initial = {
    ...fields, stages: HARNESS_STAGES.map(stage => ({ ...stage, status: stage.id === 'ingest' ? 'running' : 'pending' })),
    repairs: [], failures: [], toolEvents: [], previewPages: [],
  };
  let horizon = longReceipt(1, [], '正在规划课程蓝图');
  const receipt = (harness = {}) => rejectProviderSecrets({
    ...initial, ...harness, repairs: [...initial.repairs, ...(harness.repairs ?? [])],
    failures: [...initial.failures, ...(harness.failures ?? [])], longHorizon: horizon,
  }, ...credentials);
  const emit = (phase, batches, message, harness) => {
    signal?.throwIfAborted();
    if (phase) horizon = longReceipt(phase, batches, message);
    if (onStage) onStage(structuredClone(receipt(harness)));
    signal?.throwIfAborted();
  };
  const event = input => {
    const safe = rejectProviderSecrets(input, ...credentials);
    initial.toolEvents.push(safe);
    emit();
  };
  const previews = pages => {
    initial.previewPages = [...pages].sort((a, b) => a.number - b.number).map(previewPage);
  };
  return { initial, receipt, emit, event, previews };
}

function retryDescriptor(harnessReceipt, blueprint, pages = []) {
  if (!harnessReceipt.failures.length) return {};
  const sourceTranscriptOmissions = pages.filter(page => page.transcriptOmissions).map(page => ({ pageNumber: page.number, count: page.transcriptOmissions }));
  return { retry: { ...(blueprint && { blueprint }), failures: harnessReceipt.failures,
    ...(sourceTranscriptOmissions.length && { sourceTranscriptOmissions }),
  } };
}

export async function runCourseAuthoringAgent(input, options = {}) {
  const context = providerContext({ ...options, usedMediaKeys: new Set() });
  const { signal, corpus, credentials } = context;
  const spec = courseSpec(input, context);
  rejectProviderSecrets(spec, ...credentials);
  const allNumbers = Array.from({ length: spec.pageCount }, (_, index) => index + 1);
  const retry = restoreRetry(context.retry, allNumbers, context);
  const targetPages = new Set(context.retry ? retry.targeted
    .filter(item => ['blueprint', 'batch'].includes(item.stage)).flatMap(item => item.pageNumbers) : allNumbers);
  const progress = authoringProgress(context, { authoring: 'course', spec, pacingMode: spec.pacingMode,
    ...(corpus && { adaptationMode: 'rebuild' }),
  });
  const { initial, emit } = progress;
  context.onToolEvent = progress.event;
  initial.failures = retry.retained;
  emit(1, [], context.retry ? '正在恢复已提交成稿' : '正在规划课程蓝图');
  const planned = context.retry?.blueprint
    ? { blueprint: validateBlueprint(context.retry.blueprint, spec.pageCount), repairs: [] }
    : await prepareBlueprint(spec, context);
  const { blueprint } = planned;
  if (!blueprint) {
    initial.failures = [...retry.retained, failure('blueprint', [...targetPages], planned.reason)];
    initial.stages[0].status = 'failed';
    const generationNote = `课程蓝图未完成。${planned.reason}`;
    emit(1, [], generationNote);
    const harnessReceipt = progress.receipt({ source: 'provider' });
    return { lectureScore: null, harnessReceipt, source: 'provider', generationNote, ...retryDescriptor(harnessReceipt) };
  }
  const previousPages = previousCoursePages(retry.previous, spec.pageCount, context.retry?.sourceTranscriptOmissions);
  initial.repairs = planned.repairs;
  const { pages: authoredPages, batches, repairs, failures } = await authorSlideBatches(blueprint, {
    ...context, spec, targetPages, previousPages,
    onBatch: (batchProgress, batchRepairs, draftPages, batchFailures) => {
      progress.previews(draftPages);
      initial.repairs = [...planned.repairs, ...batchRepairs];
      initial.failures = [...retry.retained, ...batchFailures];
      emit(2, batchProgress);
    },
  });
  const pages = new Map(authoredPages.map(page => [page.number, page]));
  initial.repairs = [...planned.repairs, ...repairs];
  initial.failures = [...retry.retained, ...failures];
  initial.stages[0].status = pages.size ? 'complete' : 'failed';
  if (!pages.size) {
    const generationNote = '当前暂无通过校验的成稿。';
    emit(2, batches, generationNote);
    const harnessReceipt = progress.receipt({ source: 'provider' });
    return rejectProviderSecrets({ lectureScore: null, blueprint, harnessReceipt, source: 'provider', generationNote,
      ...retryDescriptor(harnessReceipt, blueprint) }, ...credentials);
  }
  initial.stages[1].status = 'running';
  emit(3, batches, '正在选择理解检测与互动协议');
  const preservedInteractions = retainedInteractions(retry.previous);
  const fresh = new Set([...targetPages].filter(number => pages.has(number) && !previousPages.some(page => page.number === number)));
  const plannedCheckpoints = context.retry
    ? [...selectedRetryCheckpoints(retry.targeted, pages, spec.pacingMode),
      ...(fresh.size ? (await courseCheckpoints(blueprint, pages, spec, context)).filter(item => fresh.has(item.pageNumber)) : [])]
    : await courseCheckpoints(blueprint, pages, spec, context);
  if (pages.size === spec.pageCount) {
    emit(3, batches, '正在复核全卷符号、原型及互动分布');
    initial.review = await auditCourse(blueprint, pages, spec, context,
      [...preservedInteractions].map(([pageNumber, lesson]) => ({ pageNumber, activityId: lesson.activityId })).concat(plannedCheckpoints),
      fresh, () => { progress.previews(pages.values()); emit(); });
  }
  const ordered = [...pages.values()].sort((a, b) => a.number - b.number);
  const name = corpus?.name ?? spec.course;
  const title = corpus ? `${corpus.title} · 原生重构`.slice(0, titleLimit) : blueprint.title;
  const result = await runDeckHarness({ name, title, type: 'native', pages: ordered }, {
    provider: context.provider, fastProvider: context.fastProvider, signal, plannedCheckpoints, preservedInteractions,
    pacingMode: spec.pacingMode, reportModelFailures: true,
    onStage: receipt => {
      const current = receipt.stages.find(stage => stage.status === 'running');
      emit(3, batches, current?.title ?? '已确认当前环节', receipt);
    },
  });
  result.source = configured(context.provider) ? 'provider' : 'local';
  const failedPages = spec.pageCount - pages.size;
  const failedInteractions = result.harnessReceipt.failures?.length ?? 0;
  result.generationNote = corpus
    ? `已按原稿依据重组 ${pages.size} 页。`
    : result.source === 'provider'
      ? `已完成 ${pages.size} 页编排。请复核讲授内容与推导条件。`
      : `本地生成的备课框架已按 ${pages.size} 页编排。请核对并补充学科内容。`;
  if (failedPages) result.generationNote += ` ${failedPages} 页可原地重试。`;
  if (failedInteractions) result.generationNote += ` ${failedInteractions} 页互动可原地重试。`;
  if (corpus) {
    const transcriptOmissions = ordered.reduce((count, page) => count + (page.transcriptOmissions ?? 0), 0);
    const reusedImages = ordered.reduce((count, page) => count + page.images.filter(image =>
      corpus.pages.get(page.number).images.some(({ figure }) => figure.src === image.src)).length, 0);
    result.harnessReceipt.sourceCorpus = {
      originalPageCount: corpus.originalPageCount, sourceBlockCount: corpus.sourceBlockCount,
      originalImageCount: corpus.originalImageCount, reusedImages, transcriptOmissions,
    };
    if (reusedImages) result.generationNote += `已在适合的页面复用 ${reusedImages} 张原稿图片。`;
    if (transcriptOmissions) result.generationNote += `有 ${transcriptOmissions} 处摘录超出单页容量，请参阅原稿。`;
  }
  emit(3, batches, failedPages || failedInteractions ? '成稿已保留，部分页面待重试' : '课堂护栏验证完成', result.harnessReceipt);
  result.harnessReceipt = progress.receipt(result.harnessReceipt);
  return rejectProviderSecrets({ ...result, blueprint, ...retryDescriptor(result.harnessReceipt, blueprint, ordered) }, ...credentials);
}

function visibleSourcePages(material) {
  if (!Array.isArray(material?.pages) || !material.pages.length || material.pages.length > 1500) throw Error('请导入 1–1500 页原稿。');
  const pages = material.pages.filter(page => page?.hidden !== true).map(page => ({
    ...page, title: normalizeText(page?.title) || `第 ${page?.number} 页`,
    text: typeof page?.text === 'string' ? page.text : Array.isArray(page?.body) ? page.body.join('\n') : '',
  })).sort((a, b) => a.number - b.number);
  if (!pages.length || pages.some(page => !Number.isSafeInteger(page.number) || page.number < 1 || page.text.length > 100_000) ||
      new Set(pages.map(page => page.number)).size !== pages.length) throw Error('原稿页码或正文无效。');
  return pages;
}

function chunks(items, size) {
  const groups = [];
  for (let offset = 0; offset < items.length; offset += size) groups.push(items.slice(offset, offset + size));
  return groups;
}

function sourceBlocks(page) {
  const blocks = page.nativeBlocks ?? page.blocks;
  const extracted = validateSlideBlocks(page.sourceBlocks);
  const prepared = validateSlideBlocks(blocks);
  let inferred = [];
  if (!prepared.length && page.text.trim()) {
    try { inferred = inferBlocksFromPlainSlide({ text: page.text }).blocks ?? []; } catch { /* Use the original paragraphs below. */ }
  }
  const distinct = new Map([...prepared, ...extracted, ...inferred].map(block => [JSON.stringify(block), block]));
  const structured = [...distinct.values()].flatMap(block => {
    if (block.type !== 'callout') return [block];
    const content = lines(block.text);
    const formulas = content.filter(isStandaloneFormula);
    if (!formulas.length) return [block];
    const remaining = content.filter(line => !isStandaloneFormula(line));
    return [
      { type: 'formula', title: '原稿表达式', items: formulas },
      ...(remaining.length ? [{ ...block, text: remaining.join('\n') }] : []),
    ];
  });
  const represented = new Set(structured.flatMap(block => lines(blockText(block))));
  const remainder = lines(page.text).filter(line => !represented.has(line) && line !== page.title)
    .flatMap(line => line.match(/[\s\S]{1,900}/gu) ?? []);
  const plain = chunks(remainder, 5).map(items => ({ type: 'bullets', title: '原稿摘录', items }));
  const source = [...structured, ...plain];
  if (!source.length) return [{ type: 'callout', title: '原稿观察', text: `查看「${page.title}」的原稿图版，圈出可直接观察的细节。`, tone: 'note' }];
  return source.flatMap(block => {
    if (block.type === 'table') return chunks(block.rows, 6).map(rows => ({ ...block, rows })).concat(block.rows.length ? [] : [block]);
    if (['steps', 'bullets', 'formula'].includes(block.type)) return chunks(block.items, block.type === 'formula' ? 3 : 5).map(items => ({ ...block, items }));
    if (block.type !== 'callout' || block.text.length <= 900) return [block];
    return (block.text.match(/[\s\S]{1,900}/gu) ?? []).map(text => ({ ...block, text }));
  }).filter(block => blockText(block).trim());
}

function sourceFigures(page) {
  const figures = (Array.isArray(page.images) ? page.images : []).map(figure => checkedFigure({
    ...figure, src: figure?.cropped ? figure.visibleSrc : figure?.src,
    credit: normalizeText(figure?.credit) || `原稿第 ${page.number} 页`,
  })).filter(Boolean);
  if (figures.length) return figures;
  const preview = checkedFigure({ src: page.preview, alt: `原稿第 ${page.number} 页图版`, credit: `原稿第 ${page.number} 页` });
  return preview ? [preview] : [];
}

function buildCorpus(material, source, targetPages) {
  const title = normalizeText(material.title) || normalizeText(material.name) || '导入讲义';
  const name = normalizeText(material.name) || title;
  const items = source.flatMap(page => sourceBlocks(page).map((block, index) => ({
    id: `P${page.number}B${index + 1}`, sourcePage: page.number, sourceTitle: page.title, block,
  })));
  if (!items.length) throw Error('原稿没有可用于重构的内容。');
  const pages = new Map(Array.from({ length: targetPages }, (_, index) => {
    const start = Math.floor(index * items.length / targetPages);
    const end = Math.max(start + 1, Math.floor((index + 1) * items.length / targetPages));
    return [index + 1, { blocks: items.slice(start, end), images: [] }];
  }));
  const seen = new Set();
  for (const page of source) {
    const related = [...pages.values()].filter(entry => entry.blocks.some(block => block.sourcePage === page.number));
    for (const [index, figure] of sourceFigures(page).entries()) {
      if (seen.has(figure.src)) continue;
      seen.add(figure.src);
      const destination = related.filter(entry => entry.images.length < 2)
        .sort((a, b) => a.images.length - b.images.length)[0];
      if (!destination) continue;
      destination.images.push({ id: `P${page.number}I${index + 1}`, sourcePage: page.number, figure });
    }
  }
  const outline = [...pages].map(([pageNumber, entry]) => ({
    pageNumber,
    originalPages: unique(entry.blocks.map(item => item.sourcePage)),
    topics: unique(entry.blocks.map(item => item.sourceTitle.slice(0, 90))).slice(0, 6),
    blockTypes: unique(entry.blocks.map(item => item.block.type)), availableImages: entry.images.length,
  }));
  return {
    name, title, pages, outline,
    originalPageCount: source.length, sourceBlockCount: items.length, originalImageCount: seen.size,
  };
}

function sourceForBatch(corpus, batch) {
  return batch.pagePlans.map(({ pageNumber }) => {
    const entry = corpus.pages.get(pageNumber);
    return {
      pageNumber,
      blocks: entry.blocks.map(({ id, sourcePage, sourceTitle, block }) => ({
        id, sourcePage, sourceTitle: sourceTitle.slice(0, 150), type: block.type,
        excerpt: blockText(block).slice(0, Math.min(420, Math.max(35, Math.floor(5200 / entry.blocks.length)))),
      })),
      images: entry.images.map(({ id, sourcePage, figure }) => ({ id, sourcePage, alt: figure.alt })),
    };
  });
}

function sourceSlide(plan, blocks, images, assignedBlocks) {
  const sources = unique([...blocks, ...images].map(item => item.sourcePage)).sort((a, b) => a - b);
  const title = `${blocks[0].sourceTitle.slice(0, 126)} · ${roles[plan.role]}`;
  const content = [];
  let available = 320 - title.length;
  for (const { block } of blocks) {
    const excerpt = fitSourceBlock(block, available);
    if (!excerpt || inspectAuthoredSlide({}, [excerpt]).errors.length) continue;
    content.push(excerpt);
    available -= blockText(excerpt).length;
  }
  if (!content.length) content.push({ type: 'callout', title: '原稿观察',
    text: `参照原稿第 ${sources.join('、')} 页的摘录或图版，核对定义、条件与结论。`, tone: 'note' });
  const page = toPage(plan.pageNumber, title, content, `参照原稿第 ${sources.join('、')} 页。请学生指出原文的条件或图中可观察的依据。`, images.map(item => item.figure));
  const transcript = new Set(lines(page.text));
  let length = page.text.length, transcriptOmissions = 0;
  for (const item of assignedBlocks) {
    const linesToAdd = lines(blockText(item.block)).filter(line => !transcript.has(line));
    const size = linesToAdd.reduce((sum, line) => sum + line.length + 1, 0);
    if (length + size > sourceTranscriptLimit) {
      transcriptOmissions++;
      continue;
    }
    linesToAdd.forEach(line => transcript.add(line));
    length += size;
  }
  return { ...page, text: evidenceText([...transcript].join('\n'), title), transcriptOmissions };
}

function fitSourceBlock(block, available) {
  if (blockText(block).length <= available) return block;
  const field = block.type === 'table' ? 'rows' : ['bullets', 'steps', 'formula'].includes(block.type) ? 'items' : null;
  if (!field) return null;
  for (let count = block[field].length - 1; count > 0; count--) {
    const excerpt = { ...block, [field]: block[field].slice(0, count) };
    if (blockText(excerpt).length <= available) return excerpt;
  }
  return null;
}

function localSourceSlide(plan, corpus) {
  const { blocks, images } = corpus.pages.get(plan.pageNumber);
  const prominent = blocks.find(item => !['callout', 'bullets'].includes(item.block.type));
  const selected = unique([...blocks.slice(0, 2), ...(prominent ? [prominent] : [])]).slice(0, 3);
  return sourceSlide(plan, selected, images, blocks);
}

function chooseSourceIds(ids, items, minimum, maximum) {
  if (!Array.isArray(ids) || ids.length < minimum || ids.length > maximum || new Set(ids).size !== ids.length) throw Error('原稿片段编号不完整或重复。');
  const map = new Map(items.map(item => [item.id, item]));
  if (ids.some(id => !map.has(id))) throw Error('请选择当前新页可核对的原稿编号。');
  return ids.map(id => map.get(id));
}

function existingSupplemental(pages) {
  return new Map(pages.filter(page => Array.isArray(page.adopted) && page.adopted.length)
    .map(page => [page.number, { slides: page.adopted.slice() }]));
}

function enhanceCandidates(pages, useModel) {
  const ranked = pages.filter(page => page.text.trim()).map(page => {
    const blocks = sourceBlocks(page);
    const principal = blocks.find(block => ['formula', 'diagram', 'table', 'code', 'code-pair'].includes(block.type));
    const text = lines(page.text).filter(line => line !== page.title);
    const score = Number(Boolean(principal)) * 5 + Math.min(6, text.length) +
      Number(/推导|条件|证明|原理|比较|derivation/iu.test(page.title + page.text.slice(0, 240))) * 3 +
      Number(page.text.length >= 110) * 3;
    return { page, blocks, principal, text, score };
  }).sort((a, b) => b.score - a.score || a.page.number - b.page.number);
  const strong = ranked.filter(candidate => candidate.score >= 4);
  return (strong.length || !useModel ? strong : ranked.slice(0, 1))
    .slice(0, Math.min(12, Math.max(1, Math.ceil(pages.length / 4))))
    .sort((a, b) => a.page.number - b.page.number);
}

function enhanceLocally(candidates, adoptedByPage) {
  for (const { page, blocks, principal, text } of candidates) {
    const title = `原稿第 ${page.number} 页拓展 · ${page.title.slice(0, 110)}`;
    const review = { type: 'callout', title: '检查理解', text: '指出原文中一个必要条件，并说出条件改变后哪一步需要重新检验。', tone: 'note' };
    const focused = principal ?? (text.length >= 2 && /比较|相同|差异|versus/iu.test(page.text)
      ? { type: 'table', title: '原文要点对照', headers: ['原稿要点', '课堂检查'], rows: text.slice(0, 3).map(line => [line.slice(0, 110), '指出适用条件']) }
      : teachingDiagram({ title, chapterTitle: page.title }, blocks, { fromSource: true }));
    const slide = {
      title, body: [`依据原稿第 ${page.number} 页。`], blocks: validateSlideBlocks([focused, review]),
      layout: suggestCourseLayout({ blocks: [focused, review] }),
    };
    adoptedByPage.set(page.number, { slides: [...(adoptedByPage.get(page.number)?.slides ?? []), slide] });
  }
}

function enhancementPlans(candidates) {
  return candidates.map(({ page, principal, blocks }, index) => {
    const evidence = numberEvidence(page.text);
    const relevant = new Set(principal ? lines(blockText(principal)) : []);
    const materials = unique([...evidence.slice(0, 24), ...evidence.filter(item => relevant.has(item.text)).slice(0, 8)]);
    return {
      pageNumber: page.number, chapterTitle: page.title, title: `原稿第 ${page.number} 页拓展 · ${page.title.slice(0, 110)}`,
      role: principal?.type === 'formula' ? 'derivation' : 'example',
      archetype: principal?.type === 'formula' ? 'derivation' : principal?.type === 'table' ? 'split-compare' : ['example', 'split-compare'][index % 2],
      layoutHint: 'auto', visualNeed: principal?.type === 'formula' ? 'formula' : 'diagram',
      materials: materials.map(item => ({ ...item, text: item.text.slice(0, 450) })),
      originalBlockTypes: unique(blocks.map(block => block.type)),
    };
  });
}

async function enhanceWithAgent(candidates, name, title, adoptedByPage, retry, context, progress) {
  const spec = courseSpec({ course: name.slice(0, 300), topic: title.slice(0, 8000), pageCount: Math.max(6, candidates.length) }, context);
  const pagePlans = enhancementPlans(candidates);
  const blueprint = { title, pagePlans, chapters: [], notationConventions: [] };
  const targets = new Set(context.retry ? retry.targeted.filter(item => item.stage === 'enhance').flatMap(item => item.pageNumbers)
    : pagePlans.map(plan => plan.pageNumber));
  const assembled = new Map();
  for (const { slides } of adoptedByPage.values()) {
    for (const slide of slides) recordCourseMedia(context.usedMediaKeys, slide.images ?? []);
  }
  const batches = divideBatches(pagePlans.filter(plan => targets.has(plan.pageNumber)));
  const states = batches.map(({ index, startPage, endPage }) => ({ index, startPage, endPage, status: 'pending' }));
  const update = () => {
    progress.previews(assembled.values());
    progress.emit(2, states, '正在按原文依据编排拓展页');
  };
  for (const batch of batches) {
    const state = states[batch.index - 1];
    state.status = 'running';
    update();
    const result = await writeBatch(batch, blueprint, spec, context, assembled, update, { phase: 'course_enhance_batch' });
    if (result.repair) progress.initial.repairs.push(result.repair);
    progress.initial.failures.push(...result.failures);
    Object.assign(state, { status: result.failures.length ? 'failed' : 'complete', source: result.source });
    update();
  }
  if (assembled.size && assembled.size === targets.size) {
    progress.emit(3, states, '正在复核拓展页的原文依据与公式');
    progress.initial.review = await auditCourse(blueprint, assembled, spec, context, [], new Set(assembled.keys()),
      () => { progress.previews(assembled.values()); progress.emit(); });
  }
  for (const page of assembled.values()) {
    const { number, title: slideTitle, blocks, layout, archetype, images, speakerNotes, evidenceIds } = page;
    const slides = adoptedByPage.get(number)?.slides ?? [];
    const notes = `原稿第 ${number} 页，原文依据 ${evidenceIds.join('、')}。${speakerNotes}`;
    adoptedByPage.set(number, { slides: [...slides, { title: slideTitle, blocks, layout, archetype, images, speakerNotes: notes }] });
  }
  return states;
}

export async function adaptLegacyMaterial(material, options = {}) {
  const adaptationMode = options.adaptationMode ?? 'preserve';
  if (!['preserve', 'enhance', 'rebuild'].includes(adaptationMode)) throw Error('请选择有效的原稿迁移方式。');
  options.signal?.throwIfAborted();
  const context = providerContext({ ...options, usedMediaKeys: new Set() });
  rejectProviderSecrets(material, ...context.credentials);
  const pages = visibleSourcePages(material);
  const title = normalizeText(material.title) || normalizeText(material.name) || '导入讲义';
  const name = normalizeText(material.name) || title;
  if (adaptationMode === 'rebuild') {
    const pageCount = Number(options.pageCount ?? Math.max(8, Math.min(48, pages.length)));
    if (!Number.isInteger(pageCount) || pageCount < 6 || pageCount > 48) throw Error('重构页数须为 6–48 页。');
    const corpus = buildCorpus(material, pages, pageCount);
    const topic = pages.map(page => page.title).join('；').slice(0, 8000);
    return runCourseAuthoringAgent({ course: title.slice(0, 300), topic, pageCount }, { ...options, corpus });
  }
  const retry = restoreRetry(options.retry, pages.map(page => page.number), context);
  const startup = existingSupplemental(pages);
  const adoptedByPage = retry.previous ? existingSupplemental(retry.previous.pages) : existingSupplemental(pages);
  const progress = authoringProgress(context, { authoring: 'course', adaptationMode });
  progress.initial.failures = retry.retained;
  context.onToolEvent = progress.event;
  let states = [];
  if (adaptationMode === 'enhance') {
    const useModel = configured(context.provider);
    const candidates = enhanceCandidates(pages, useModel);
    if (useModel) states = await enhanceWithAgent(candidates, name, title, adoptedByPage, retry, context, progress);
    else enhanceLocally(candidates, adoptedByPage);
  }
  const adaptedPages = pages.map(page => page.number).filter(number =>
    (adoptedByPage.get(number)?.slides.length ?? 0) > (startup.get(number)?.slides.length ?? 0));
  const { versionId, ...original } = material;
  const derivative = adaptedPages.length > 0;
  const prepared = { ...original, name, title: derivative ? `${title} · 原稿拓展` : title, pages, ...(!derivative && { versionId }) };
  progress.initial.adaptedPages = adaptedPages;
  const result = await runDeckHarness(prepared, {
    ...options, provider: context.provider, adoptedByPage,
    reportModelFailures: adaptationMode === 'enhance', preservedInteractions: retainedInteractions(retry.previous),
    ...(options.retry && { plannedCheckpoints: selectedRetryCheckpoints(retry.targeted, new Map(pages.map(page => [page.number, page])), options.pacingMode ?? 'stem-60s') }),
    ...(options.density !== undefined && { checkpointBudget: interactionBudget(pages.length, options.density) }),
    onStage: receipt => progress.emit(3, states, receipt.stages.find(stage => stage.status === 'running')?.title ?? '正在核对原页互动', receipt),
  });
  progress.emit(3, states, '原稿和拓展页已验证', result.harnessReceipt);
  result.harnessReceipt = progress.receipt(result.harnessReceipt);
  result.generationNote = derivative
    ? `已保留原页，并在 ${adaptedPages.length} 处插入原稿拓展页。`
    : adaptationMode === 'enhance' ? '已保留原页，当前内容适合直接活化。' : '已保留原页画面与顺序，互动已逐页验证。';
  const failed = result.harnessReceipt.failures.filter(item => item.stage === 'enhance').flatMap(item => item.pageNumbers);
  if (failed.length) result.generationNote = `已保留原页${adaptedPages.length ? `及 ${adaptedPages.length} 张拓展页` : ''}，第 ${failed.join('、')} 页的拓展可重试。`;
  return rejectProviderSecrets({ ...result, ...retryDescriptor(result.harnessReceipt) }, ...context.credentials);
}
