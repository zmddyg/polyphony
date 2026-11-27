import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { interactionBudget } from '../dist/core/agent-spec.mjs';
import { adaptLegacyMaterial, planCourseBlueprint, runCourseAuthoringAgent } from '../dist/core/course-agent.mjs';
import { createPageModule, generateNativeDeck } from '../dist/core/deck-harness.mjs';
import { renderDiagramSvg } from '../dist/core/diagram-render.mjs';
import { buildLectureScore, lectureFrame, lectureFrames, resolveLectureLayout, validateLectureScore } from '../dist/core/lecture-score.mjs';
import { rejectProviderSecrets } from '../dist/core/lesson-provider.mjs';
import { providerSummary, readSessionProvider, resolveConfiguredFastProvider, resolveFastProvider, saveSessionProvider } from '../dist/core/provider-hub.mjs';
import { renderLectureFrame } from '../dist/views/lecture-stage.mjs';
import { importMaterialFile } from '../material-import.mjs';
import { fetchSafeEmbeddedImage, searchAndEmbedMedia, searchMediaCandidates } from '../media-search.mjs';
import { authoredPage, modelReply, modelRequest, toolReply, toolResult } from './support/course-model.mjs';
import { integrationUnavailable, request, roomTestServer, startLoopbackServer } from './support/integration.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7i0AAAAASUVORK5CYII=';
const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const raster = { src: 'data:image/png;base64,' + png, alt: '原稿装置', credit: '实验室', license: 'CC BY 4.0' };
const originalPreview = 'data:image/gif;base64,' + gif;
const mainKey = 'test-primary-credential';
const fastKey = 'test-rapid-credential';
const fastModel = 'test-rapid-private-model';
const fastBaseUrl = 'https://rapid.fixture.example/v1';
const spec = { course: '大一统计推断', topic: '估计量；误差传播；置信区间', pageCount: 24 };
const diagram = direction => ({
  type: 'diagram', kind: 'flow', direction, nodes: [{ id: 'a', label: '测量' }, { id: 'b', label: '估计' }],
  edges: [{ from: 'a', to: 'b', label: '误差传播' }],
});
const concept = 'concept-diagnosis@1';
const note = (title, text) => ({ type: 'callout', title, text, tone: 'note' });
function modelFetch(handler) {
  return async (url, options) => {
    const request = JSON.parse(options.body);
    const { name, input } = modelRequest(request);
    const response = await handler(name, input, request, options.headers.Authorization, url);
    return response instanceof Response ? response : modelReply(response);
  };
}

function fixtureProvider(handler, fastHandler) {
  return {
    baseUrl: 'https://main.fixture.example/v1', model: 'deep-classroom', key: mainKey, outputMode: 'json_schema',
    fetchImpl: modelFetch(handler),
    ...(fastHandler && { fastModel, fastBaseUrl, fastKey, fastFetchImpl: modelFetch(fastHandler) }),
  };
}

function fixtureLesson(input) {
  const text = input.materials.map(item => item.text).join('\n');
  return createPageModule({ number: input.pageNumber, title: input.title, text }, concept);
}

test('24-page authoring carries notation through serial batches and preserves all successful batches', async () => {
  const blueprint = await planCourseBlueprint(spec);
  blueprint.notationConventions = ['μ 表示总体均值', 'n 表示样本量'];
  const attempts = new Map(), contexts = new Map(), progress = [];
  let running = 0, maxRunning = 0, triage = 0, failedNumbers;
  const provider = fixtureProvider(async (name, input, request, authorization) => {
    assert.equal(authorization, 'Bearer ' + mainKey);
    if (name === 'course_blueprint') return blueprint;
    if (name === 'online_lesson_module') return fixtureLesson(input);
    assert.equal(name, 'course_slide_batch');
    const start = input.pagePlans[0].pageNumber;
    contexts.set(start, input);
    attempts.set(start, (attempts.get(start) ?? 0) + 1);
    maxRunning = Math.max(maxRunning, ++running);
    await setImmediate();
    running--;
    if (attempts.size === 2) {
      failedNumbers ??= input.pagePlans.map(page => page.pageNumber);
      return Response.json({ error: { message: 'rate limited' } }, { status: 429 });
    }
    return { pages: input.pagePlans.map(plan => authoredPage(plan, {
      title: '模型页 ' + plan.pageNumber, speakerNotes: '模型备注 ' + plan.pageNumber,
      blocks: [note('独立观测', 'μ 在本批次仍代表总体均值。')],
    })) };
  }, (name, input, request, authorization) => {
    if (name === 'course_review') return { done: true };
    assert.equal(name, 'course_checkpoint_triage');
    assert.equal(request.model, fastModel);
    assert.equal(authorization, 'Bearer ' + fastKey);
    assert.equal(input.budget, interactionBudget(spec.pageCount - failedNumbers.length));
    triage++;
    return { checkpoints: [{ pageNumber: input.candidates[0].pageNumber, activityId: concept }] };
  });
  const result = await generateNativeDeck(spec, { provider, onStage: receipt => progress.push(receipt) });
  assert.equal(triage, 1);
  assert.equal(maxRunning, 1);
  assert(attempts.size > 4 && [...attempts.values()].every(count => count === 1));
  const later = [...contexts.values()].at(-1);
  assert(later.coveredConcepts.some(value => JSON.stringify(value).includes('模型页 1')));
  assert(!later.coveredConcepts.some(value => JSON.stringify(value).includes('模型页 ' + failedNumbers[0])));
  for (const context of contexts.values()) assert.deepEqual(context.notationConventions, blueprint.notationConventions);
  for (const page of result.lectureScore.pages) {
    assert(!failedNumbers.includes(page.number));
    assert.equal(page.speakerNotes, '模型备注 ' + page.number);
  }
  assert.equal(result.lectureScore.pages.length, 24 - failedNumbers.length);
  assert.equal(result.harnessReceipt.dryRuns.length, interactionBudget(result.lectureScore.pages.length));
  assert(progress.some(receipt => receipt.longHorizon?.activeBatches.length === 1));
  assert(progress.every(receipt => (receipt.longHorizon?.activeBatches.length ?? 0) <= 1));
  assert.deepEqual(result.harnessReceipt.failures.flatMap(failure => failure.pageNumbers), failedNumbers);
  assert.match(result.harnessReceipt.failures[0].reason, /HTTP 429/u);
  assert(!JSON.stringify(result).includes(fastModel));
});

test('long authoring scales checkpoints, validates both page limits, and respects cancellation', async () => {
  for (const pageCount of [6, 8, 24, 48]) {
    const result = await generateNativeDeck({ ...spec, pageCount, density: 'balanced' });
    assert.equal(result.lectureScore.pages.length, pageCount);
    assert.equal(result.harnessReceipt.dryRuns.length, interactionBudget(pageCount));
    assert(result.harnessReceipt.dryRuns.every(run => run.round === 2));
  }
  assert(interactionBudget(24, 'sparse') < interactionBudget(24, 'balanced'));
  assert(interactionBudget(24, 'balanced') < interactionBudget(24, 'dense'));
  for (const pageCount of [5, 49]) await assert.rejects(generateNativeDeck({ ...spec, pageCount }), /6–48/u);
  const controller = new AbortController();
  await assert.rejects(runCourseAuthoringAgent(spec, {
    signal: controller.signal, onStage: receipt => { if (receipt.longHorizon.phase === 2) controller.abort(); },
  }), { name: 'AbortError' });
});

test('authoring selects an embedded candidate and switches to a diagram when search is empty', async () => {
  const input = { ...spec, pageCount: 8, enableWebImages: true };
  const blueprint = await planCourseBlueprint(input);
  for (const pageNumber of [2, 6]) Object.assign(blueprint.pagePlans[pageNumber - 1], {
    visualNeed: 'image-search', imageQuery: 'laboratory setup', layoutHint: 'split-left',
  });
  const decisions = [];
  const provider = fixtureProvider((name, input, packet) => {
    if (name === 'course_blueprint') return blueprint;
    if (name === 'online_lesson_module') return fixtureLesson(input);
    assert.equal(name, 'course_slide_batch');
    const target = input.pagePlans.find(plan => [2, 6].includes(plan.pageNumber));
    const media = toolResult(packet, 'visual');
    if (target && !media) return toolReply('search_media', {
      query: target.pageNumber === 2 ? 'optical detector' : 'missing instrument',
    }, 'visual');
    return { pages: input.pagePlans.map(plan => authoredPage(plan, {
      blocks: plan.pageNumber === 6 ? [diagram('LR')] : [note('观察任务', '描述装置上的首个测量读数。')],
      ...(plan.pageNumber === 2 && { mediaIds: [media.candidates[1].id] }),
    })) };
  }, (name, _input, envelope) => {
    assert.equal(envelope.model, fastModel);
    decisions.push(name);
    if (name === 'course_review') return { done: true };
    assert.equal(name, 'course_checkpoint_triage');
    return { checkpoints: [] };
  });
  const result = await runCourseAuthoringAgent(input, {
    provider, searchEmbeddedMedia: async (query, { signal }) => {
      assert(!signal?.aborted);
      if (query === 'missing instrument') return { candidates: [] };
      assert.equal(query, 'optical detector');
      return { candidates: ['Generic', 'Calibrated detector'].map((title, index) => ({
        id: 'detector-' + index, title, width: 120, height: 60, license: raster.license,
        image: { ...raster, alt: title, src: index === 0 ? originalPreview : raster.src },
      })) };
    },
  });
  assert(decisions.includes('course_review') && decisions.includes('course_checkpoint_triage'));
  assert.equal(result.lectureScore.pages[1].images[0].src, raster.src);
  assert.equal(result.lectureScore.pages[1].layout, 'split-left');
  assert(result.lectureScore.pages[5].blocks.some(block => block.type === 'diagram'));
  assert(!result.lectureScore.pages[5].images?.length);
});

test('legacy migration preserves original image and order, inserts native supplements, and reuses figures in a rebuild', async () => {
  const material = { name: '统计实验.pdf', title: '估计量和方差', type: 'pdf', pages: [
    { number: 2, title: '样本方差推导', text: 'n 是样本量。\n使用独立观测进行推导。\n比较总体方差与样本方差。\ns^2 = sum / (n - 1)',
      preview: originalPreview, images: [raster], sourceBlocks: [{ type: 'formula', title: '原稿算式', items: ['s^2 = sum / (n - 1)'] }] },
    { number: 4, title: '总体均值', text: '总体均值记为 μ。' },
  ] };
  const preserved = await adaptLegacyMaterial(material);
  assert.deepEqual(preserved.lectureScore.pages.map(page => page.number), [2, 4]);
  assert.equal(preserved.lectureScore.pages[0].preview, originalPreview);
  assert.equal(preserved.lectureScore.pages[0].images[0].src, raster.src);
  assert.equal(lectureFrames(preserved.lectureScore).length, 2);
  const enhanced = await adaptLegacyMaterial(material, { adaptationMode: 'enhance' });
  assert.deepEqual(enhanced.lectureScore.pages.map(page => page.number), [2, 4]);
  assert.equal(enhanced.lectureScore.pages[0].preview, originalPreview);
  assert.equal(enhanced.lectureScore.pages[0].images[0].src, raster.src);
  assert.equal(lectureFrames(enhanced.lectureScore).length, 3);
  assert.match(lectureFrame(enhanced.lectureScore, 1).title, /原稿第 2 页拓展/u);
  const rebuilt = await adaptLegacyMaterial(material, { adaptationMode: 'rebuild', pageCount: 8, density: 'dense' });
  assert.equal(rebuilt.lectureScore.source.kind, 'native');
  assert.equal(rebuilt.lectureScore.pages.length, 8);
  assert(rebuilt.lectureScore.pages.some(page => page.images?.some(image => image.src === raster.src)));
  assert(rebuilt.lectureScore.pages.some(page => page.blocks.some(block => block.type === 'formula' && block.items.includes('s^2 = sum / (n - 1)'))));
});

function sourcePdf() {
  const image = 'B9324F'.repeat(32 * 32) + '>';
  const content = [
    'BT /F1 12 Tf 24 260 Td (x = y + 1) Tj ET', 'q 60 0 0 60 150 190 cm /Im0 Do Q',
    '0 G 20 60 160 80 re S 100 60 m 100 140 l S 20 100 m 180 100 l S',
    'BT /F1 12 Tf 30 115 Td (Sample) Tj 80 0 Td (Count) Tj ET',
    'BT /F1 12 Tf 30 75 Td (Group A) Tj 80 0 Td (12) Tj ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ['<< /Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8',
      '/Filter /ASCIIHexDecode /Length ' + image.length + ' >>\nstream\n' + image + '\nendstream'].join(' '),
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const xref = pdf.length;
  pdf += 'xref\n0 7\n0000000000 65535 f \n' + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += 'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf, 'ascii');
}

test('PDF ingestion keeps the original page and independent embedded figure available for a sourced rebuild', async t => {
  let material;
  try { material = await importMaterialFile({ name: '统计推导.pdf', bytes: sourcePdf() }); }
  catch (error) {
    if (error.status === 503) { integrationUnavailable(t, 'Python with PyMuPDF is unavailable'); return; }
    throw error;
  }
  const page = material.pages[0];
  assert.match(page.preview, /^data:image\/png;base64,/u);
  assert.match(page.images[0].src, /^data:image\/png;base64,/u);
  assert.notEqual(page.preview, page.images[0].src);
  assert(page.sourceBlocks.some(block => block.type === 'formula' && block.items.includes('x = y + 1')));
  const table = page.sourceBlocks.find(block => block.type === 'table');
  assert.deepEqual(table?.headers, ['Sample', 'Count']);
  assert.deepEqual(table?.rows, [['Group A', '12']]);
  const rebuilt = await adaptLegacyMaterial({ ...material, type: 'pdf' }, { adaptationMode: 'rebuild', pageCount: 8 });
  assert(rebuilt.lectureScore.pages.some(slide => slide.images?.some(image => image.src === page.images[0].src)));
});

const wikiImage = 'https://upload.wikimedia.org/example/fixture.png';
function commonsFixture(url = wikiImage, license = 'CC BY 4.0') {
  return { query: { pages: [{
    title: 'File:Optical_detector.png', ns: 6, pageid: 12, imageinfo: [{
      thumburl: url, thumbmime: 'image/png', thumbwidth: 1, thumbheight: 1,
      extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<b>Fixture &amp; Crew</b>' },
        ImageDescription: { value: '<p>Photo of a calibrated detector</p>' } },
    }],
  }] } };
}

test('Commons search uses File namespace and returns a screened, attributed base64 image', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal);
    if (url.hostname === 'commons.wikimedia.org') {
      assert.equal(url.pathname, '/w/api.php');
      assert.equal(url.searchParams.get('gsrnamespace'), '6');
      assert.equal(url.searchParams.get('iiurlwidth'), '960');
      return Response.json(commonsFixture());
    }
    if (url.href === wikiImage) return new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/png' } });
    return Response.json({});
  };
  const embedded = await searchAndEmbedMedia('optical detector', {
    fetchImpl, selectCandidate: candidates => {
      assert.equal(candidates[0].title, 'Optical detector.png');
      assert.equal(candidates[0].description, 'Photo of a calibrated detector');
      return candidates[0].id;
    },
  });
  assert.equal(requests.filter(url => url.hostname === 'commons.wikimedia.org').length, 1);
  assert.equal(requests.filter(url => url.href === wikiImage).length, 1);
  assert.equal(embedded.src, raster.src);
  assert.equal(embedded.license, 'CC BY 4.0');
  assert.match(embedded.credit, /Fixture & Crew.*commons\.wikimedia\.org/u);
  const rejected = await searchMediaCandidates('detector', {
    fetchImpl: async () => Response.json(commonsFixture(wikiImage, 'All rights reserved')),
  });
  assert.deepEqual(rejected.candidates, []);
  assert.equal(rejected.diagnostics.commons.status, 'no_hits');
});

test('image fetch denies disallowed hosts, redirects, forged media types, and both declared and streamed overflow', async () => {
  const candidate = { thumbnailUrl: wikiImage, license: 'CC0' };
  for (const thumbnailUrl of ['http://upload.wikimedia.org/a', 'https://example.test/img',
    'https://127.0.0.1/image', 'https://192.168.1.1/example', 'https://[::1]/image', 'https://upload.wikimedia.org.example.test/image']) {
    let called = false;
    assert.equal(await fetchSafeEmbeddedImage({ ...candidate, thumbnailUrl }, { fetchImpl: async () => { called = true; } }), null);
    assert(!called);
  }
  const fakeImage = new Uint8Array(1_500_001);
  for (const response of [
    Response.redirect(wikiImage, 302), new Response('not a picture', { headers: { 'content-type': 'text/html' } }),
    new Response('not a PNG', { headers: { 'content-type': 'image/png' } }),
    new Response('large header', { headers: { 'content-type': 'image/png', 'content-length': '1500001' } }),
    new Response(new ReadableStream({ start(controller) { controller.enqueue(fakeImage); controller.close(); } }), { headers: { 'content-type': 'image/png' } }),
  ]) {
    assert.equal(await fetchSafeEmbeddedImage(candidate, { fetchImpl: async () => response }), null);
  }
  assert.equal(await searchAndEmbedMedia('detector', { fetchImpl: async () => { throw Error('network unavailable'); } }), null);
});

test('validated layouts and captions round-trip while automatic and explicit rendering select the right columns', () => {
  const blocks = [note('目标', '测量样本的读数')];
  const pages = [{ number: 1, title: '测量', text: '测量样本的读数', blocks, images: [{
    ...raster, credit: '<b>实验室</b>' + 'x'.repeat(200), license: 'L'.repeat(100),
  }] }];
  const course = buildLectureScore({ name: '统计实验', pages });
  const frame = lectureFrame(validateLectureScore(JSON.parse(JSON.stringify(course))), 0);
  assert(frame.images[0].credit.length <= 160 && !frame.images[0].credit.includes('<'));
  assert.equal(frame.images[0].license.length, 80);
  assert.equal(resolveLectureLayout(frame), 'split-right');
  assert.equal(resolveLectureLayout({ blocks: [diagram('TB'), ...blocks] }), 'split-right');
  assert.equal(resolveLectureLayout({ blocks: [diagram('LR'), ...blocks] }), 'diagram-focus');
  assert.equal(resolveLectureLayout({ blocks: [{ type: 'table', headers: ['1', '2', '3', '4'] }] }), 'diagram-focus');
  const root = { innerHTML: '' };
  renderLectureFrame(root, { ...frame, layout: 'split-left' });
  assert.match(root.innerHTML, /data-lecture-layout="split-left"/u);
  assert(root.innerHTML.indexOf('lecture-frame-visual') < root.innerHTML.indexOf('lecture-frame-copy'));
  assert.match(root.innerHTML, /<figcaption>/u);
  assert.throws(() => buildLectureScore({ name: '统计实验', pages: [{ ...pages[0], layout: 'columns' }] }), /版式/u);
  assert.throws(() => buildLectureScore({ name: '统计实验', pages: [{ ...pages[0], images: [{ src: wikiImage }] }] }), /嵌入/u);
});

test('four-character labels are centered above horizontal connectors with room on both sides', () => {
  const svg = renderDiagramSvg(diagram('LR'));
  const rect = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/gu;
  const blocks = [...svg.matchAll(/class="diagram-node"[\s\S]*?<\/g>/gu)].map(node => {
    const match = [...node[0].matchAll(rect)][0];
    return match.slice(1).map(Number);
  });
  const capsule = [...svg.matchAll(rect)].find(match => Number(match[4]) === 20).slice(1).map(Number);
  const [left, right] = blocks;
  const [x, y, width, height] = capsule;
  const leftGap = x - (left[0] + left[2]), rightGap = right[0] - (x + width);
  assert(leftGap >= 16 && rightGap >= 16);
  assert(Math.abs(leftGap - rightGap) < 0.1);
  assert(y + height < left[1] + left[3] / 2);
});

test('fast settings inherit, can use independent credentials, stay in memory, and are scrubbed from summaries', t => {
  const provider = fixtureProvider(() => {});
  assert.equal(resolveFastProvider(provider), provider);
  const inherited = resolveFastProvider({ ...provider, fastModel });
  assert.equal(inherited.key, mainKey);
  assert.equal(inherited.baseUrl, provider.baseUrl);
  assert.equal(inherited.outputMode, 'json_schema');
  assert.equal(resolveConfiguredFastProvider({ ...provider, fastModel, fastBaseUrl }), null);
  const explicit = resolveFastProvider({ ...provider, fastModel, fastBaseUrl, fastKey, fastOutputMode: 'text' });
  assert.deepEqual([explicit.model, explicit.baseUrl, explicit.key, explicit.outputMode], [fastModel, fastBaseUrl, fastKey, 'text']);
  const records = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => records.get(key), setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key),
  } });
  t.after(() => {
    saveSessionProvider({ clear: true });
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else delete globalThis.sessionStorage;
  });
  records.set('polyphony.provider.session.v3', JSON.stringify(provider));
  assert.deepEqual(readSessionProvider(), {});
  assert.equal(records.size, 0);
  saveSessionProvider(provider);
  assert.equal(readSessionProvider().key, mainKey);
  assert.equal(records.size, 0);
  const saved = saveSessionProvider({ ...provider, fastModel, fastBaseUrl, fastKey });
  assert.equal(saved.fastConfigured, true);
  assert.equal(readSessionProvider().fastKey, fastKey);
  assert.equal(records.size, 0);
  const visible = providerSummary(readSessionProvider(), { includeFastModel: false });
  assert.equal(visible.fastBaseUrlHost, 'rapid.fixture.example');
  assert(!Object.hasOwn(visible, 'fastModel'));
  assert.throws(() => rejectProviderSecrets({ output: mainKey }, explicit), /凭据/u);
  assert.throws(() => rejectProviderSecrets({ output: fastKey }, explicit), /凭据/u);
});

test('eight-page authoring uses fast triage, audit and interaction repair with main-model drafts', async () => {
  const fastCalls = [], mainCalls = [];
  const blueprint = await planCourseBlueprint({ ...spec, pageCount: 8 });
  const provider = fixtureProvider((name, input) => {
    mainCalls.push(name);
    if (name === 'course_blueprint') return blueprint;
    if (name === 'course_slide_batch') return { pages: input.pagePlans.map(plan => authoredPage(plan, {
      blocks: [note('原文', '比较两种独立测量的估计值。')],
    })) };
    assert.equal(name, 'online_lesson_module');
    const lesson = fixtureLesson(input);
    return input.pageNumber === 3 ? { ...lesson, evidenceIds: ['M99'] } : lesson;
  }, (name, input, request, authorization) => {
    fastCalls.push(name);
    assert.equal(authorization, 'Bearer ' + fastKey);
    if (name === 'course_checkpoint_triage') return { checkpoints: [3, 6].map(pageNumber => ({ pageNumber, activityId: concept })) };
    if (name === 'course_review') return { done: true };
    assert.match(request.messages.at(-1).content, /M99/u);
    return fixtureLesson(input);
  });
  const result = await generateNativeDeck({ ...spec, pageCount: 8 }, { provider });
  assert.deepEqual(fastCalls.toSorted(), ['course_checkpoint_triage', 'course_review', 'online_lesson_module']);
  assert.deepEqual(mainCalls, ['course_blueprint', 'course_slide_batch', 'course_slide_batch', 'online_lesson_module', 'online_lesson_module']);
  assert.equal(result.harnessReceipt.repairs[0].status, 'repaired');
  assert.equal(result.harnessReceipt.repairs[0].pageNumber, 3);
  for (const secret of [mainKey, fastKey, fastBaseUrl, fastModel]) assert(!JSON.stringify(result).includes(secret));
});

async function openedRoom(origin, data) {
  const response = await request(origin, '/api/rooms', { data });
  assert.equal(response.status, 201);
  const { room } = await response.json();
  return { room, cookie: response.headers.get('set-cookie').split(';', 1)[0], path: '/api/rooms/' + room.code + '/' };
}

test('teacher-only media and adaptation routes retain validated data and enforce room-local candidate IDs', async t => {
  let mediaCalls = 0;
  const classroom = await roomTestServer(t, {
    mediaOptions: { fetchImpl: async url => {
      if (url.hostname === 'commons.wikimedia.org') {
        mediaCalls++;
        return Response.json(commonsFixture());
      }
      if (url.href === wikiImage) {
        mediaCalls++;
        return new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/png' } });
      }
      return Response.json({});
    } },
  });
  if (!classroom) return;
  const { origin } = classroom;
  const a = await openedRoom(origin, { demo: false }), b = await openedRoom(origin, { demo: false });
  const search = { action: 'search', query: 'optical detector' };
  assert.equal((await request(origin, a.path + 'search-media', { data: search })).status, 403);
  assert.equal(mediaCalls, 0);
  const searched = await request(origin, a.path + 'search-media', { data: search, cookie: a.cookie });
  assert.equal(searched.status, 200);
  const { candidates: [candidate], diagnostics } = await searched.json();
  assert.equal(candidate.preview, raster.src);
  assert.equal(candidate.license, 'CC BY 4.0');
  assert.equal(candidate.source, 'commons');
  assert(diagnostics.commons);
  assert(!Object.hasOwn(candidate, 'thumbnailUrl'));
  const choose = { action: 'embed', candidate: { id: candidate.id, license: 'spoofed', thumbnailUrl: 'https://example.test/' } };
  const foreign = await request(origin, b.path + 'search-media', { data: choose, cookie: b.cookie });
  assert.equal((await foreign.json()).image, null);
  const chosen = await request(origin, a.path + 'search-media', { data: choose, cookie: a.cookie });
  const { image } = await chosen.json();
  assert.equal(image.src, raster.src);
  assert.equal(image.license, candidate.license);
  assert.equal(mediaCalls, 2);
  const data = { adaptationMode: 'rebuild', pageCount: 8, material: {
    name: '统计讲义.md', type: 'markdown', pages: [{ number: 1, title: '误差', text: '请区分随机误差与系统误差。', images: [image] }],
  } };
  assert.equal((await request(origin, a.path + 'adapt-material', { data, cookie: b.cookie })).status, 403);
  const adapted = await request(origin, a.path + 'adapt-material', { data, cookie: a.cookie });
  assert.equal(adapted.status, 200);
  const result = await adapted.json();
  assert.equal(result.lectureScore.pages.length, 8);
  assert(result.lectureScore.pages.some(page => page.images?.some(figure => figure.src === image.src)));
  assert.equal(result.harnessReceipt.adaptationMode, 'rebuild');
  assert.equal(result.harnessReceipt.longHorizon.phase, 3);
});

test('fast connection, quick diagnosis, and assisted analysis keep credentials and teaching hints private', { timeout: 20_000 }, async t => {
  const classroom = await roomTestServer(t);
  if (!classroom) return;
  const { origin, snapshot } = classroom;
  const office = process.env.POLYPHONY_SOFFICE;
  process.env.POLYPHONY_SOFFICE = snapshot + '.fixture-without-office';
  t.after(() => {
    if (office === undefined) delete process.env.POLYPHONY_SOFFICE;
    else process.env.POLYPHONY_SOFFICE = office;
  });
  const calls = [];
  const cue = '请各取一条依据，再用边界条件区分两种解释。';
  const hint = '先请同学用 n 对应原文中的样本量。';
  let echo, analyzeStarted, releaseAnalysis;
  const gateway = await startLoopbackServer(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const outbound = JSON.parse(Buffer.concat(chunks));
    const name = outbound.response_format?.json_schema.name;
    calls.push({ name, model: outbound.model, key: req.headers.authorization, path: req.url });
    let answer = { ok: true };
    if (name === 'quick_page_triage') {
      const { evidence } = JSON.parse(outbound.messages[1].content);
      assert(evidence.every(item => /^M\d+$/u.test(item.id)));
      answer = { hints: [
        { evidenceId: evidence[0].id, text: echo || hint },
        { evidenceId: evidence[1].id, text: '再请一位同学说出独立观测这个前提。' },
      ] };
    }
    if (name === 'classroom_evidence') {
      const { evidence, branches } = JSON.parse(outbound.messages[1].content);
      answer = { evidence: [{ id: evidence[0].id }], recommendedId: branches[0].id, teacherCue: cue };
      analyzeStarted.resolve();
      await releaseAnalysis.promise;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
  });
  if (!gateway) return;
  const settings = { baseUrl: gateway + '/main', model: 'deep-classroom', key: mainKey, outputMode: 'json_schema',
    fastModel, fastBaseUrl: gateway + '/decision', fastKey };
  const lecture = buildLectureScore({ name: '样本估计实验', pages: [
    { number: 1, title: '样本与均值', text: 'n 表示样本量。\n计算之前请核对独立观测这一前提。' },
    { number: 2, title: '方差', text: '使用单位相同的观测量。' },
  ] });
  const classroomPage = await openedRoom(origin, { lecture });
  const command = (target, type, cookie, payload = {}, role = 'teacher') =>
    request(origin, target.path + 'commands', { cookie, data: { type, role, payload } });
  const diagnostics = cookie => request(origin, classroomPage.path + 'quick-triage', { data: { index: 0, turn: 0 }, cookie });
  const studentSession = await request(origin, classroomPage.path + 'session', { data: { role: 'student' } });
  const student = studentSession.headers.get('set-cookie').split(';', 1)[0];
  assert.equal((await diagnostics(student)).status, 403);
  assert.equal((await diagnostics(classroomPage.cookie)).status, 409);
  const pulse = await command(classroomPage, 'slidePulse', student, { expectedLectureIndex: 0, expectedLectureTurn: 0, active: true }, 'student');
  assert.equal(pulse.status, 200);
  assert.equal((await (await diagnostics(classroomPage.cookie)).json()).source, 'local');

  const changed = await request(origin, classroomPage.path + 'provider', { data: settings, cookie: classroomPage.cookie });
  assert.equal(changed.status, 200);
  const configured = await changed.json();
  assert.equal(configured.providerSummary.fastConfigured, true);
  assert(!Object.hasOwn(configured.providerSummary, 'fastModel'));
  const test = await request(origin, classroomPage.path + 'provider', {
    data: { test: true, testOnly: true, testTier: 'fast' }, cookie: classroomPage.cookie,
  });
  assert.equal(test.status, 200);
  assert.equal((await test.json()).tested, true);
  const result = await (await diagnostics(classroomPage.cookie)).json();
  assert.equal(result.source, 'provider');
  assert.equal(result.hints.length, 2);
  assert.equal(result.hints[0], hint);
  const status = await (await request(origin, '/api/status')).json();
  for (const secret of [mainKey, fastKey, fastModel, settings.fastBaseUrl]) {
    assert(!JSON.stringify([configured, status]).includes(secret));
  }
  for (echo of [mainKey, fastKey]) {
    const rejected = await (await diagnostics(classroomPage.cookie)).json();
    assert.equal(rejected.source, 'local');
    assert(!JSON.stringify(rejected).includes(echo));
  }
  const modelCalls = calls.filter(call => call.name === 'quick_page_triage' || call.name === 'connection_ping');
  assert.equal(modelCalls.length, 4);
  assert(modelCalls.every(call => call.path === '/decision/chat/completions' && call.model === fastModel && call.key === 'Bearer ' + fastKey));

  const discussion = await openedRoom(origin, { demo: true, lessonId: 'mzi' });
  const revealed = await command(discussion, 'reveal', discussion.cookie);
  assert.equal(revealed.status, 200);
  analyzeStarted = Promise.withResolvers();
  releaseAnalysis = Promise.withResolvers();
  const pending = command(discussion, 'analyze', discussion.cookie);
  await analyzeStarted.promise;
  const joined = await request(origin, discussion.path + 'session', { data: { role: 'student' } });
  const joinedCookie = joined.headers.get('set-cookie').split(';', 1)[0];
  assert.equal((await command(discussion, 'join', joinedCookie, { name: '并发加入者' }, 'student')).status, 200);
  releaseAnalysis.resolve();
  const analyzed = await pending;
  assert.equal(analyzed.status, 200);
  const payload = await analyzed.json();
  assert.equal(payload.room.analysis.source, 'provider');
  assert(payload.room.participants.some(participant => participant.name === '并发加入者'));
  assert.equal(payload.teacherCue, cue);
  assert.equal(calls.at(-1).model, fastModel);
  assert(!JSON.stringify(payload.room).includes(cue));
  for (const target of [discussion, classroomPage]) {
    for (const role of ['stage', 'student']) {
      const view = await request(origin, target.path + 'session', { data: { role } });
      const state = await view.text();
      assert(!state.includes(cue) && !state.includes(hint) && !state.includes('teacherCue'));
    }
    const response = await request(origin, target.path + 'events?role=stage');
    const stream = response.body.getReader();
    let events = '';
    try {
      while (!events.includes('\ndata: ')) {
        const next = await stream.read();
        if (next.done) break;
        events += Buffer.from(next.value).toString();
      }
      assert(events.includes('\ndata: '));
      assert(!events.includes(cue) && !events.includes(hint) && !events.includes('teacherCue'));
    } finally { await stream.cancel(); }
  }
  const disk = await readFile(snapshot, 'utf8');
  assert([cue, hint, mainKey, fastKey, fastModel, settings.fastBaseUrl].every(value => !disk.includes(value)));
  const navigated = await command(classroomPage, 'lectureNavigate', classroomPage.cookie,
    { index: 1, expectedLectureIndex: 0, expectedLectureTurn: 0 });
  assert.equal(navigated.status, 200);
  assert.equal((await diagnostics(classroomPage.cookie)).status, 409);
});
