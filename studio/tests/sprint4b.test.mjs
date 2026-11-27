import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { lookupReference as serverLookup } from '../reference-lookup.mjs';
import { lookupReference as browserLookup } from '../dist/core/browser-reference-lookup.mjs';
import { adaptLegacyMaterial, planCourseBlueprint } from '../dist/core/course-agent.mjs';
import { generateNativeDeck, createPageModule } from '../dist/core/deck-harness.mjs';
import { LECTURE_ARCHETYPES, lectureFrames } from '../dist/core/lecture-score.mjs';
import { requestStructuredCompletion, requestToolLoopCompletion } from '../dist/core/lesson-provider.mjs';
import { fetchSafeEmbeddedImage, isPublicMediaAddress } from '../media-search.mjs';
import { authoredPage, modelReply, modelRequest, toolReply, toolResult } from './support/course-model.mjs';
import { request, roomTestServer, startLoopbackServer } from './support/integration.mjs';

const primaryKey = 'fixture-primary-token-4b';
const rapidKey = 'fixture-rapid-token-4b';
const primary = {
  baseUrl: 'https://deepseek.fixture.example/v1', model: 'deepseek-reasoner', key: primaryKey,
};
const rapid = {
  baseUrl: 'https://openai.fixture.example/v1', model: 'gpt-5-mini', key: rapidKey,
};
const answerSchema = {
  type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false,
};
const noJsonMessages = [
  { role: 'system', content: '依照约定，给出一项结论。' },
  { role: 'user', content: '请回答六乘七。' },
];
const calculatorTools = [{
  type: 'function', function: {
    name: 'multiply', description: 'Multiply by seven.',
    parameters: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] },
  },
}];
const apiError = (status, message, properties = {}) => Response.json({ error: { message, ...properties } }, { status });
const jsonKeyword = body => body.messages.some(message => typeof message.content === 'string' && /json/iu.test(message.content));

function checkSecrets(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  assert(!serialized.includes(primaryKey), 'primary credential escaped its request header');
  assert(!serialized.includes(rapidKey), 'rapid credential escaped its request header');
}

function mockProvider(config, handler) {
  return {
    ...config,
    async fetchImpl(url, init) {
      assert.equal(init.headers.Authorization, 'Bearer ' + config.key);
      assert.equal(url.pathname, '/v1/chat/completions');
      const body = JSON.parse(init.body);
      checkSecrets(body);
      if (body.response_format?.type === 'json_object') assert(jsonKeyword(body));
      return handler(body, init);
    },
  };
}

test('JSON mode inserts a missing keyword and every mode extracts the same balanced object', async () => {
  const expected = { answer: 42, label: 'the characters } and { stay inside this string', nested: { ok: true } };
  const content = JSON.stringify(expected);
  const previous = structuredClone(noJsonMessages);
  for (const outputMode of ['json_object', 'json_schema', 'text']) {
    for (const framing of [
      '<think>{"answer":0}</think>\n结论如下\n```json\n' + content + '\n```\n以上。',
      '<think>核对公式。\n再检查取值。</think>\n格式示意 {不可解析}。结论 ' + content + '\n计算完毕。',
    ]) {
      const result = await requestStructuredCompletion({
        ...mockProvider(primary, body => {
          assert.equal(body.response_format?.type, outputMode === 'text' ? undefined : outputMode);
          if (outputMode === 'json_object') assert(jsonKeyword(body));
          return modelReply(framing, { reasoning: '另行计算六乘七。' });
        }),
        outputMode, schemaName: 'answer_fixture', schema: answerSchema, messages: noJsonMessages,
      });
      assert.deepEqual(JSON.parse(result), expected);
    }
  }
  assert.deepEqual(noJsonMessages, previous);
});

test('OpenAI token compatibility retries once on the indicated field and preserves unrelated 400 details', async () => {
  const bodies = [];
  const result = await requestStructuredCompletion({
    ...mockProvider({ ...rapid, model: 'o4-mini' }, body => {
      bodies.push(body);
      if (bodies.length === 1) return apiError(400,
        "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        { code: 'unsupported_parameter', param: 'max_tokens' });
      return modelReply({ answer: 42 });
    }),
    messages: noJsonMessages, maxTokens: 600,
  });
  assert.deepEqual(JSON.parse(result), { answer: 42 });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_tokens, 600);
  assert(!Object.hasOwn(bodies[1], 'max_tokens'));
  assert.equal(bodies[1].max_completion_tokens, 600);

  let rejected = 0;
  await assert.rejects(requestStructuredCompletion({
    ...mockProvider(rapid, () => {
      rejected++;
      return apiError(400, 'Unsupported response_format for this model', { param: 'response_format' });
    }),
    messages: noJsonMessages, maxTokens: 600,
  }), /HTTP 400.*response_format/u);
  assert.equal(rejected, 1);
});

test('specific upstream failures remain visible and sanitize both credential values', async () => {
  for (const [status, summary, expected] of [
    [400, 'invalid parameter response_format', /HTTP 400.*response_format/u],
    [401, 'incorrect API key', /HTTP 401.*(?:密钥|key)/iu],
    [403, 'access denied to this model', /HTTP 403/u],
    [429, 'request rate exceeded', /HTTP 429.*限流/u],
  ]) {
    await assert.rejects(requestStructuredCompletion({
      ...mockProvider(primary, () => apiError(status, summary + ' ' + primaryKey + ' ' + rapidKey)),
      credentialProviders: [rapid], messages: noJsonMessages,
    }), error => {
      checkSecrets(error.message);
      return expected.test(error.message);
    });
  }
  for (const [respond, expected] of [
    [() => modelReply({ answer: 42 }, { finishReason: 'length' }), /输出被截断.*length/u],
    [() => { throw new TypeError('Failed to fetch ' + primaryKey + ' ' + rapidKey); }, /网络/u],
  ]) {
    await assert.rejects(requestStructuredCompletion({
      ...mockProvider(primary, respond), credentialProviders: [rapid], messages: noJsonMessages,
    }), error => {
      checkSecrets(error.message);
      return expected.test(error.message);
    });
  }
});

test('native tools preserve assistant reasoning and report the observation under its tool call ID', async () => {
  const requests = [], trace = [], calls = [];
  const reasoning = '先计算平方，再确认结果。';
  const result = await requestToolLoopCompletion({
    provider: mockProvider(primary, body => {
      requests.push(body);
      assert.deepEqual(body.tools, calculatorTools);
      assert.equal(body.tool_choice, 'auto');
      assert(!body.response_format);
      const seen = toolResult(body, 'math_call_1');
      if (!seen) return toolReply('multiply', { x: 6 }, 'math_call_1', reasoning);
      assert.deepEqual(seen, { answer: 42 });
      assert.equal(body.messages.find(message => message.tool_calls?.[0].id === 'math_call_1').reasoning_content, reasoning);
      return modelReply('结果：\n```json\n{"answer":42}\n```');
    }),
    fastProvider: rapid, messages: noJsonMessages, tools: calculatorTools, finalSchema: answerSchema,
    handlers: { multiply: ({ x }) => { calls.push(x); return { answer: x * 7 }; } },
    onToolEvent: event => trace.push(event),
  });
  assert.deepEqual(result, { answer: 42 });
  assert.equal(requests.length, 2);
  assert.deepEqual(calls, [6]);
  assert.equal(trace.length, 2);
  assert(trace.every(event => event.step === trace[0].step && event.tool === 'multiply'));
  assert.notEqual(trace[0].status, trace[1].status);
  checkSecrets(trace);
});

test('tool arguments, returned observations, model reasoning and hard errors redact both keys', async () => {
  for (const secret of [primaryKey, rapidKey]) {
    for (const boundary of ['arguments', 'observation', 'reasoning']) {
      let calls = 0;
      let attempts = 0;
      const events = [];
      const requestLoop = requestToolLoopCompletion({
        provider: mockProvider(primary, body => {
          attempts++;
          if (attempts > 1) return modelReply({ answer: 42 });
          const args = boundary === 'arguments' ? { x: 6, leak: secret } : { x: 6 };
          return toolReply('multiply', args, 'secret_test', boundary === 'reasoning' ? secret : undefined);
        }),
        fastProvider: rapid, messages: noJsonMessages, tools: calculatorTools, finalSchema: answerSchema,
        handlers: { multiply: () => { calls++; return { answer: 42, data: secret }; } },
        onToolEvent: event => events.push(event),
      });
      try { checkSecrets(await requestLoop); }
      catch (error) {
        checkSecrets(error.message);
        assert.match(error.message, /凭据|工具/u);
      }
      assert.equal(calls, boundary === 'observation' ? 1 : 0);
      checkSecrets(events);
    }
  }
  for (const status of [401, 403, 429]) {
    let calls = 0;
    await assert.rejects(requestToolLoopCompletion({
      provider: mockProvider(primary, () => {
        calls++;
        return apiError(status, 'tools denied ' + primaryKey + ' ' + rapidKey);
      }),
      fastProvider: rapid, messages: noJsonMessages, tools: calculatorTools, handlers: {},
    }), error => {
      checkSecrets(error.message);
      return error.message.includes('HTTP ' + status);
    });
    assert.equal(calls, 1);
  }
});

test('TUN fake IPv4 answers require a strict media hostname and never authorize private ranges', async () => {
  const allowedHost = 'commons.wikimedia.org';
  for (const address of ['198.18.0.0', '198.18.0.42', '198.19.255.255']) {
    assert.equal(isPublicMediaAddress(address, allowedHost), true, address);
    assert.equal(isPublicMediaAddress(address), false, address);
    for (const badHost of ['198.18.0.42', 'localhost', 'commons.wikimedia.org.example.test', 'example.test']) {
      assert.equal(isPublicMediaAddress(address, badHost), false, badHost);
    }
  }
  for (const address of ['0.1.1.1', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '192.168.1.1', '::1', 'fe80::1', 'fc00::1', '::ffff:198.18.0.42', '::ffff:127.0.0.1']) {
    assert.equal(isPublicMediaAddress(address, allowedHost), false, address);
  }
  for (const thumbnailUrl of ['https://198.18.0.42/image.png', 'https://commons.wikimedia.org.example.test/image.png']) {
    let contacted = false;
    const result = await fetchSafeEmbeddedImage({ thumbnailUrl, license: 'CC BY 4.0' }, {
      fetchImpl: async () => { contacted = true; return Response.json({}); },
    });
    assert.equal(contacted, false);
    assert.equal(result, null);
  }
});

const referenceQuery = 'Mach–Zehnder interferometer';
const referenceTitle = 'Mach-Zehnder interferometer';
const referenceFixture = ({ wikiHost = 'en.wikipedia.org', calls = [] } = {}) => async (input, options) => {
  const url = new URL(input);
  calls.push({ url, signal: options.signal });
  if (url.hostname === wikiHost && url.pathname.includes('/page/summary/')) return Response.json({
    title: '<b>' + referenceTitle + '</b>',
    extract: '<p>Measures relative phase &amp; interference.</p> ' + '条纹验证条件。'.repeat(130),
    content_urls: { desktop: { page: 'https://' + wikiHost + '/wiki/Mach%E2%80%93Zehnder_interferometer' } },
  });
  if (url.hostname === 'api.openalex.org') return Response.json({ results: [{
    id: 'https://openalex.org/W123456789', display_name: 'Phase sensitivity in two-path interferometers',
    publication_year: 2024, abstract_inverted_index: { Phase: [0], measurement: [1], principle: [2] },
  }] });
  return Response.json({ error: 'endpoint fixture received an unexpected URL' }, { status: 404 });
};

test('browser and server references clean plain text and attribute Wikipedia and OpenAlex', async () => {
  for (const [lookup, lang] of [[serverLookup, 'en'], [browserLookup, 'zh']]) {
    const calls = [];
    const wikiHost = lang + '.wikipedia.org';
    const result = await lookup(referenceQuery, { lang, fetchImpl: referenceFixture({ wikiHost, calls }) });
    assert.equal(result.ok, true);
    assert.deepEqual(new Set(result.references.map(item => item.source)), new Set(['Wikipedia', 'OpenAlex']));
    const wiki = result.references.find(item => item.source === 'Wikipedia');
    const work = result.references.find(item => item.source === 'OpenAlex');
    assert.equal(wiki.title, referenceTitle);
    assert.match(wiki.summary, /phase & interference/u);
    assert(!/[<>]/u.test(wiki.summary));
    assert([...wiki.summary].length <= 600);
    assert.equal(new URL(wiki.sourceUrl).hostname, wikiHost);
    assert.match(work.summary, /Phase measurement principle/u);
    assert.equal(work.publicationYear, 2024);
    assert(calls.every(({ signal }) => signal instanceof AbortSignal));
    const openAlex = calls.find(({ url }) => url.hostname === 'api.openalex.org').url;
    assert.equal(openAlex.searchParams.get('search'), referenceQuery);
    assert.equal(openAlex.searchParams.get('per-page'), '3');
  }
});

test('reference lookup degrades cleanly when routes are blocked or rate-limited', async () => {
  for (const lookup of [serverLookup, browserLookup]) {
    let requests = 0;
    const fetchImpl = async url => {
      requests++;
      if (new URL(url).hostname === 'api.openalex.org') return apiError(429, 'slow down');
      throw new TypeError('browser is offline');
    };
    const result = await lookup('光路分束条件', { lang: 'zh', fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(typeof result.reason, 'string');
    assert(requests >= 1 && requests <= 3);
  }
});

const topic = { course: '物理光学', topic: '双光束干涉，复振幅与光强，适用条件' };
const concept = 'concept-diagnosis@1';
const finalAction = result => modelReply({ action: 'final', result });
const callAction = (tool, args) => modelReply({ action: 'call_tool', tool, args });
const completionError = (status = 429) => apiError(status, 'provider diagnostic ' + primaryKey + ' ' + rapidKey);

function interactionReply(input) {
  return modelReply(createPageModule({
    number: input.pageNumber, title: input.title, text: input.materials.map(item => item.text).join('\n'),
  }, input.activityId));
}

function fastDecisions(handler) {
  return mockProvider(rapid, body => {
    const { name, input } = modelRequest(body);
    if (handler) {
      const result = handler(name, input, body);
      if (result) return result;
    }
    if (name === 'course_review') return modelReply({ done: true });
    if (name === 'course_checkpoint_triage') return modelReply({ checkpoints: [] });
    if (name === 'online_lesson_module') return interactionReply(input);
    assert.fail('unexpected decision phase: ' + name);
  });
}

test('a default ten-page DeepSeek course uses JSON Action after tools 400 and OpenAI for decisions', async () => {
  const spec = { ...topic, pacingMode: 'seminar-3m' };
  const blueprint = await planCourseBlueprint(spec);
  const primaryPhases = [], rapidPhases = [], fallbackTurns = [], stages = [];
  const provider = mockProvider(primary, body => {
    const { name, input } = modelRequest(body);
    primaryPhases.push(name);
    if (name === 'course_blueprint') {
      assert.equal(input.spec.pageCount, 10);
      assert.equal(input.spec.pacingMode, 'seminar-3m');
      return modelReply('<think>只制定编排方案。</think>\n蓝图\n```json\n' + JSON.stringify(blueprint) + '\n```');
    }
    if (name === 'online_lesson_module') return interactionReply(input);
    assert.equal(name, 'course_slide_batch');
    const pages = input.pagePlans.map(plan => authoredPage(plan));
    const start = pages[0].pageNumber;
    if (body.tools) {
      if (start === 1 || toolResult(body, 'before_fallback')) {
        return apiError(400, 'This reasoner endpoint does not support tools', { param: 'tools' });
      }
      return toolReply('validate_math_and_diagram', { slide: pages[0] }, 'before_fallback');
    }
    assert.equal(body.response_format.type, 'json_object');
    const turn = body.messages.filter(message => message.role === 'assistant').length;
    fallbackTurns.push({ start, turn });
    if (start > 1) {
      const observations = body.messages.filter(message =>
        message.role === 'user' && message.content.includes('"kind":"tool_observation"')).map(message => JSON.parse(message.content));
      assert.equal(observations.filter(entry => entry.tool === 'validate_math_and_diagram').length, 1);
      assert.equal(observations[0].result.ok, true);
    }
    if (turn === 0) return callAction('validate_math_and_diagram', { slide: pages[0] });
    if (turn === 1) return callAction('commit_slides', { pages });
    return finalAction({ done: true });
  });
  const result = await generateNativeDeck(spec, {
    provider,
    fastProvider: fastDecisions(name => { rapidPhases.push(name); }),
    onStage: receipt => stages.push(receipt),
  });
  assert.equal(result.source, 'provider');
  assert.equal(result.lectureScore.pages.length, 10);
  assert.equal(result.harnessReceipt.pacingMode, 'seminar-3m');
  assert.equal(result.harnessReceipt.spec.pacingMode, 'seminar-3m');
  assert.deepEqual(result.harnessReceipt.failures, []);
  assert(primaryPhases.includes('course_blueprint'));
  assert(!primaryPhases.includes('native_deck_outline'));
  assert(rapidPhases.includes('course_checkpoint_triage') && rapidPhases.includes('course_review'));
  assert(fallbackTurns.some(({ start, turn }) => start > 1 && turn === 1));
  assert(fallbackTurns.some(({ turn }) => turn >= 2));
  assert(stages.some(receipt => receipt.previewPages?.length > 0 && receipt.previewPages.length < 10));
  assert(stages.some(receipt => receipt.toolEvents?.some(event => event.tool === 'commit_slides')));
  checkSecrets([result, stages]);
});

const raster = {
  src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7i0AAAAASUVORK5CYII=',
  alt: '双光束干涉仪', credit: '光学实验室', license: 'CC BY 4.0',
  source: 'commons', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Interferometer.png',
};
const mediaRecord = {
  id: 'optic-image-1', title: 'Dual-path interferometer', width: 1200, height: 800,
  description: 'A laboratory two-path setup', license: 'CC BY 4.0', source: 'commons', image: raster,
};
const plotConfig = {
  title: '单缝衍射强度', xLabel: '归一化横坐标', yLabel: '强度比', xMin: -1, xMax: 1, samples: 101,
  curves: [{ label: '理想狭缝', expr: 'sinc(x)^2' }],
};

test('the five authoring capabilities validate and commit real chart, media, math and reference data, then review a targeted page', async () => {
  const spec = { ...topic, pageCount: 6, enableWebImages: true };
  const blueprint = await planCourseBlueprint(spec);
  const searched = [], verified = [], progress = [], observed = new Map();
  let firstBatch = true;
  const provider = mockProvider(primary, body => {
    const { name, input } = modelRequest(body);
    if (name === 'course_blueprint') return modelReply(blueprint);
    if (name === 'online_lesson_module') return interactionReply(input);
    assert.equal(name, 'course_slide_batch');
    const pages = input.pagePlans.map((plan, index) => authoredPage(plan, {
      archetype: LECTURE_ARCHETYPES[plan.pageNumber - 1],
      ...(index === 0 && { title: '复振幅叠加的条件' }),
    }));
    if (pages[0].pageNumber !== 1) {
      firstBatch = false;
      assert(input.coveredConcepts.some(value => JSON.stringify(value).includes('复振幅叠加的条件')));
      assert(input.priorArchetypes.some(page => page.archetype === 'cover'));
      return modelReply({ pages });
    }
    const picture = toolResult(body, 'image');
    if (!picture) return toolReply('search_media', {
      query: 'two arm optical setup', fallbackQueries: ['Mach-Zehnder interferometer'],
    }, 'image');
    observed.set('image', picture);
    const chart = toolResult(body, 'chart');
    if (!chart) return toolReply('plot_math_chart', plotConfig, 'chart');
    observed.set('chart', chart);
    const invalid = toolResult(body, 'bad_math');
    const formula = items => ({ type: 'formula', title: '复振幅', items });
    if (!invalid) return toolReply('validate_math_and_diagram', { slide: authoredPage(input.pagePlans[1], {
      blocks: [formula(['\\frac{1}{'])],
    }) }, 'bad_math');
    observed.set('bad_math', invalid);
    const goodFormula = formula(['\\tilde{U}=A e^{i\\varphi}', 'I=\\tilde{U}^{*}\\tilde{U}']);
    const valid = toolResult(body, 'good_math');
    if (!valid) return toolReply('validate_math_and_diagram', { slide: authoredPage(input.pagePlans[1], {
      blocks: [goodFormula],
    }) }, 'good_math');
    observed.set('good_math', valid);
    const reference = toolResult(body, 'reference');
    if (!reference) return toolReply('lookup_reference', { query: referenceQuery, lang: 'en' }, 'reference');
    observed.set('reference', reference);
    const committed = toolResult(body, 'commit');
    if (!committed) return toolReply('commit_slides', { pages: [
      { ...pages[0], blocks: [...pages[0].blocks, { type: 'chart', chartId: chart.chartId }], mediaIds: [picture.candidates[0].id] },
      { ...pages[1], blocks: [goodFormula] },
      ...pages.slice(2),
    ] }, 'commit');
    observed.set('commit', committed);
    return modelReply({ done: true });
  });
  const auditTitle = '复振幅的共轭与强度';
  const fastProvider = fastDecisions((name, _input, body) => {
    if (name !== 'course_review') return null;
    for (const pageNumber of [2, 3, 4, 5]) {
      const id = 'audit_' + pageNumber;
      const revised = toolResult(body, id);
      const title = pageNumber === 2 ? auditTitle : '自审核对第 ' + pageNumber + ' 页';
      if (!revised) return toolReply('revise_slide', { pageNumber, patch: { title } }, id);
      observed.set(id, revised);
    }
    return modelReply({ done: true });
  });
  const built = await generateNativeDeck(spec, {
    provider, fastProvider,
    async searchEmbeddedMedia(query, { limit, signal }) {
      searched.push(query);
      assert(limit <= 4);
      assert(signal instanceof AbortSignal);
      return { candidates: query === 'Mach-Zehnder interferometer' ? [mediaRecord] : [], diagnostics: {} };
    },
    async lookupReference(query, { lang, signal }) {
      verified.push({ query, lang });
      assert(signal instanceof AbortSignal);
      return { ok: true, references: [{
        source: 'Wikipedia', title: referenceTitle, summary: 'A two-path interferometer.',
        sourceUrl: 'https://en.wikipedia.org/wiki/Mach%E2%80%93Zehnder_interferometer',
      }] };
    },
    onStage: receipt => progress.push(receipt),
  });
  for (const phase of ['image', 'chart', 'bad_math', 'good_math', 'reference', 'commit', 'audit_2', 'audit_3', 'audit_4']) {
    assert.equal(observed.get(phase)?.ok, phase !== 'bad_math', phase);
  }
  assert.equal(observed.get('audit_5')?.ok, false);
  assert.match(observed.get('audit_5').reason, /最多.*三张/u);
  assert.equal(firstBatch, false);
  assert.deepEqual(searched, ['two arm optical setup', 'Mach-Zehnder interferometer']);
  assert.deepEqual(verified, [{ query: referenceQuery, lang: 'en' }]);
  assert.equal(observed.get('image').candidates[0].license, raster.license);
  assert.equal(observed.get('image').candidates[0].aspectRatio, 1.5);
  assert.doesNotMatch(JSON.stringify(observed.get('image')), /base64,/u);
  assert.match(JSON.stringify(observed.get('bad_math').issues), /公式|KaTeX/u);
  assert.deepEqual(built.harnessReceipt.failures, []);
  const [first, second] = built.lectureScore.pages;
  assert.equal(first.images[0].src, raster.src);
  assert.equal(second.title, auditTitle);
  assert.notEqual(built.lectureScore.pages[4].title, '自审核对第 5 页');
  const chart = first.blocks.find(block => block.type === 'chart');
  const points = chart.series?.[0].points ?? chart.points;
  assert.equal(points.length, 101);
  assert.deepEqual(points[50], { x: 0, y: 1 });
  assert(Math.abs(points[75].y - 4 / Math.PI ** 2) < 1e-12);
  assert.deepEqual(points, observed.get('chart').block.series?.[0].points ?? observed.get('chart').block.points);
  const tools = new Set(built.harnessReceipt.toolEvents.map(event => event.tool));
  for (const tool of ['search_media', 'plot_math_chart', 'validate_math_and_diagram', 'lookup_reference', 'commit_slides', 'revise_slide']) {
    assert(tools.has(tool), tool);
  }
  assert(progress.some(receipt => receipt.previewPages?.some(page => page.number === 2 && page.title === auditTitle)));
  checkSecrets([built, progress, [...observed.values()]]);
});

test('an invalid diagram, excessive visible text and manually invented chart data cannot be committed', async () => {
  const blueprint = await planCourseBlueprint({ ...topic, pageCount: 6 });
  const rejected = [];
  const provider = mockProvider(primary, body => {
    const { name, input } = modelRequest(body);
    if (name === 'course_blueprint') return modelReply(blueprint);
    if (name === 'online_lesson_module') return interactionReply(input);
    if (name === 'course_review') return modelReply({ done: true });
    if (name === 'course_checkpoint_triage') return modelReply({ checkpoints: [] });
    const pages = input.pagePlans.map(plan => authoredPage(plan));
    if (pages[0].pageNumber !== 1) return modelReply({ pages });
    const faults = [
      { type: 'diagram', kind: 'flow', direction: 'LR', title: '光路',
        nodes: [{ id: 'a', label: '光源' }, { id: 'b', label: '屏' }],
        edges: [{ from: 'a', to: 'unknown', label: '无效连线' }] },
      { type: 'diagram', kind: 'flow', direction: 'LR', title: '光路',
        nodes: [{ id: 'a', label: '超长图中节点'.repeat(11) }, { id: 'b', label: '屏' }],
        edges: [{ from: 'a', to: 'b', label: '传播' }] },
      { type: 'callout', title: '过密', text: '五字密度测量'.repeat(85), tone: 'note' },
      { type: 'chart', title: '随意编的数据', xLabel: 'x', yLabel: 'y', points: [{ x: 0, y: 3 }, { x: 1, y: 12 }] },
    ];
    for (const [index, block] of faults.entries()) {
      const id = 'fault_' + index;
      const response = toolResult(body, id);
      if (!response) return toolReply('commit_slides', { pages: [
        { ...pages[0], blocks: [block] }, ...pages.slice(1),
      ] }, id);
      rejected[index] = response;
    }
    return modelReply({ pages });
  });
  const result = await generateNativeDeck({ ...topic, pageCount: 6 }, { provider });
  assert.equal(result.lectureScore.pages.length, 6);
  assert.deepEqual(result.harnessReceipt.failures, []);
  assert.equal(rejected.length, 4);
  assert(rejected.every(entry => entry.ok === false));
  assert.match(JSON.stringify(rejected[0]), /边|连线|引用|节点/u);
  assert.match(JSON.stringify(rejected[1]), /标签显示不全/u);
  assert.match(JSON.stringify(rejected[2]), /字数|密度|320/u);
  assert.match(JSON.stringify(rejected[3]), /曲线|图表|plot_math_chart/u);
});

test('a failed authored batch retains successful pages and retries just one requested failed page in place', async () => {
  const spec = { ...topic, pageCount: 10 };
  const blueprint = await planCourseBlueprint(spec);
  const retried = [], initialBatches = [];
  let retry = false;
  const provider = mockProvider(primary, body => {
    const { name, input } = modelRequest(body);
    if (name === 'course_blueprint') return modelReply(blueprint);
    if (name === 'online_lesson_module') return interactionReply(input);
    if (name === 'course_review') return modelReply({ done: true });
    if (name === 'course_checkpoint_triage') return modelReply({ checkpoints: [] });
    assert.equal(name, 'course_slide_batch');
    const numbers = input.pagePlans.map(page => page.pageNumber);
    if (retry) retried.push(numbers);
    else {
      initialBatches.push(numbers);
      if (numbers[0] > 1) return completionError();
    }
    return modelReply({ pages: input.pagePlans.map(plan => authoredPage(plan)) });
  });
  const fastProvider = fastDecisions();
  const partial = await generateNativeDeck(spec, { provider, fastProvider });
  const kept = partial.lectureScore.pages.map(page => page.number);
  assert.deepEqual(kept, initialBatches[0]);
  assert(kept.length > 0 && kept.length < 10);
  assert(partial.harnessReceipt.failures.length >= 1);
  assert(partial.harnessReceipt.failures.every(failure => /HTTP 429/u.test(failure.reason)));
  assert.doesNotMatch(partial.generationNote, /本地生成/u);
  const missed = partial.harnessReceipt.failures.flatMap(failure => failure.pageNumbers);
  assert.deepEqual(new Set(missed), new Set(Array.from({ length: 10 }, (_, index) => index + 1).filter(page => !kept.includes(page))));
  const pageNumber = missed.at(-1);
  retry = true;
  const patch = await generateNativeDeck(spec, {
    provider, fastProvider, retry: { ...partial.retry, lectureScore: partial.lectureScore, pageNumbers: [pageNumber] },
  });
  assert.deepEqual(retried, [[pageNumber]]);
  assert.deepEqual(patch.lectureScore.pages.filter(page => kept.includes(page.number)), partial.lectureScore.pages);
  assert(patch.lectureScore.pages.some(page => page.number === pageNumber));
  assert(!patch.harnessReceipt.failures.flatMap(failure => failure.pageNumbers).includes(pageNumber));
  const complete = await generateNativeDeck(spec, {
    provider, fastProvider, retry: { ...patch.retry, lectureScore: patch.lectureScore },
  });
  assert.deepEqual(complete.lectureScore.pages.map(page => page.number), Array.from({ length: 10 }, (_, index) => index + 1));
  assert.deepEqual(complete.harnessReceipt.failures, []);
  checkSecrets([partial, patch, complete]);
});

test('authorization failure before a blueprint returns retry metadata and no fabricated deck', async () => {
  const provider = mockProvider(primary, () => completionError(401));
  const spec = { ...topic, pageCount: 6 };
  const result = await generateNativeDeck(spec, { provider, fastProvider: fastDecisions() });
  assert.equal(result.lectureScore, null);
  assert(result.retry?.failures.length);
  assert(result.harnessReceipt.failures.every(failure => failure.reason.includes('HTTP 401')));
  checkSecrets(result);
  const blueprint = await planCourseBlueprint(spec);
  const restored = await generateNativeDeck(spec, {
    longHorizon: false, retry: { ...result.retry, lectureScore: null },
    fastProvider: fastDecisions((name, input) => {
      if (name === 'course_blueprint') return modelReply(blueprint);
      if (name === 'course_slide_batch') return modelReply({ pages: input.pagePlans.map(plan => authoredPage(plan)) });
    }),
  });
  assert.equal(restored.lectureScore.pages.length, 6);
  assert.deepEqual(restored.harnessReceipt.failures, []);
  checkSecrets(restored);
});

const material = {
  name: '复振幅讲义.pdf', title: '复振幅与光强', type: 'pdf', pages: [
    { number: 1, title: '复振幅推导', text: '采用时间因子 $e^{-i\\omega t}$。\n根据复振幅及其共轭求光强。\n比较测量量与场。', images: [raster],
      sourceBlocks: [{ type: 'formula', title: '复振幅', items: ['\\tilde{U}=A e^{i\\varphi}'] }] },
    { number: 2, title: '光强测量', text: '比较两臂的相位。\n指出相干性假设的适用范围。' },
  ],
};

test('model-enhanced imported pages preserve originals and add a source-anchored plotted supplement', async () => {
  let called = false;
  let observation;
  let audited;
  const provider = mockProvider(primary, body => {
    const { name, input } = modelRequest(body);
    if (name === 'online_lesson_module') return interactionReply(input);
    if (['classroom_checkpoint_triage', 'course_checkpoint_triage'].includes(name)) return modelReply({ checkpoints: [] });
    if (name === 'course_review') {
      const pageNumber = input.editablePages[0];
      const sources = input.sourcePages.find(page => page.pageNumber === pageNumber).materials;
      assert(sources.some(item => item.id === 'M1'));
      audited = toolResult(body, 'enhance_review');
      return audited ? modelReply({ done: true }) : toolReply('revise_slide', {
        pageNumber, patch: { title: '从定义推出强度极值的条件' },
      }, 'enhance_review');
    }
    assert.equal(name, 'course_enhance_batch');
    called = true;
    assert.match(JSON.stringify(input), /M1/u);
    observation = toolResult(body, 'enhance_chart');
    if (!observation) return toolReply('plot_math_chart', plotConfig, 'enhance_chart');
    return modelReply({ pages: input.pagePlans.map(plan => authoredPage(plan, {
      title: '从定义推出强度极值',
      blocks: [
        { type: 'formula', title: '光强的定义', items: ['I=\\tilde{U}^{*}\\tilde{U}'] },
        { type: 'chart', chartId: observation.chartId },
      ],
      evidenceIds: ['M1'],
    })) });
  });
  const result = await adaptLegacyMaterial(material, { adaptationMode: 'enhance', provider });
  assert.equal(called, true);
  assert.equal(observation?.ok, true);
  assert.equal(audited?.ok, true);
  assert.equal(result.harnessReceipt.adaptationMode, 'enhance');
  assert.deepEqual(result.lectureScore.pages.map(page => page.number), [1, 2]);
  assert.deepEqual(result.lectureScore.pages[0].images[0], raster);
  assert(lectureFrames(result.lectureScore).length > material.pages.length);
  const supplements = result.lectureScore.pages.flatMap(page => page.adopted);
  const extension = supplements.find(slide => slide.title === '从定义推出强度极值的条件');
  assert(extension);
  assert.match(extension.speakerNotes, /原文依据 M1/u);
  const chart = supplements.flatMap(slide => slide.blocks).find(block => block.type === 'chart');
  assert.equal((chart?.points ?? chart?.series?.[0].points)?.length, 101);
  assert(result.harnessReceipt.toolEvents.some(event => event.tool === 'plot_math_chart'));
  checkSecrets(result);
});

test('a rebuild reuses the original image and searches a supplemental figure only with web images enabled', async () => {
  const blueprint = await planCourseBlueprint({ ...topic, pageCount: 6 });
  const newRaster = { ...raster, src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
  let searched = 0;
  const permission = [];
  const provider = mockProvider(primary, body => {
    const { name, input } = modelRequest(body);
    if (name === 'course_blueprint') {
      permission.push(input.spec.enableWebImages);
      return modelReply(blueprint);
    }
    if (name === 'online_lesson_module') return interactionReply(input);
    if (name === 'course_review') return modelReply({ done: true });
    if (name === 'course_checkpoint_triage') return modelReply({ checkpoints: [] });
    assert.equal(name, 'course_source_batch');
    const available = input.sourcePages;
    const needsFigure = available.find(page => !page.images.length);
    const image = toolResult(body, 'supplemental_photo');
    if (permission.at(-1) && needsFigure && !image) return toolReply('search_media', { query: 'two-path detector' }, 'supplemental_photo');
    return modelReply({ pages: available.map(page => ({
      pageNumber: page.pageNumber,
      sourceBlockIds: [page.blocks[0].id], sourceImageIds: page.images.map(value => value.id),
      ...(image?.candidates?.length && needsFigure?.pageNumber === page.pageNumber && { mediaIds: [image.candidates[0].id] }),
    })) });
  });
  const options = {
    adaptationMode: 'rebuild', pageCount: 6, provider,
    async searchEmbeddedMedia(query) {
      assert.equal(query, 'two-path detector');
      searched++;
      return { candidates: [{ ...mediaRecord, image: newRaster }] };
    },
  };
  const off = await adaptLegacyMaterial(material, { ...options, enableWebImages: false });
  assert.equal(searched, 0);
  const on = await adaptLegacyMaterial(material, { ...options, enableWebImages: true });
  assert(searched > 0);
  assert.deepEqual(permission, [false, true]);
  for (const result of [off, on]) {
    assert.equal(result.lectureScore.pages.length, 6);
    assert(result.lectureScore.pages.some(page => page.images?.some(image => image.src === raster.src)));
    assert.deepEqual(result.harnessReceipt.failures, []);
  }
  assert(on.lectureScore.pages.some(page => page.images?.some(image => image.src === newRaster.src)));
  assert(!off.lectureScore.pages.some(page => page.images?.some(image => image.src === newRaster.src)));
});

async function openClassroom(origin) {
  const created = await request(origin, '/api/rooms', { data: { demo: false } });
  assert.equal(created.status, 201);
  const { room } = await created.json();
  return { cookie: created.headers.get('set-cookie').split(';', 1)[0], path: '/api/rooms/' + room.code };
}

test('only teacher sessions can request references, and the route uses the server adapter', async t => {
  const calls = [];
  const classroom = await roomTestServer(t, { referenceOptions: { fetchImpl: referenceFixture({ calls }) } });
  if (!classroom) return;
  const { origin } = classroom;
  const { path, cookie } = await openClassroom(origin);
  const endpoint = path + '/lookup-reference';
  const data = { query: referenceQuery, lang: 'en' };
  assert.equal((await request(origin, endpoint, { data })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await request(origin, endpoint, { cookie, data: { query: '', lang: 'fr' } })).status, 400);
  const response = await request(origin, endpoint, { cookie, data });
  assert.equal(response.status, 200);
  const references = await response.json();
  assert.equal(references.ok, true);
  assert(references.references.some(item => item.source === 'Wikipedia'));
});

test('server authoring streams tools and committed previews to the teacher without publishing credentials or trace', { timeout: 20_000 }, async t => {
  const spec = { ...topic, pageCount: 6 };
  const blueprint = await planCourseBlueprint(spec);
  const classroom = await roomTestServer(t);
  if (!classroom) return;
  const { origin, snapshot } = classroom;
  const { path, cookie } = await openClassroom(origin);
  const committing = Promise.withResolvers(), release = Promise.withResolvers();
  let gatewayError;
  const gateway = await startLoopbackServer(t, async (req, res) => {
    try {
      const requestBody = [];
      for await (const chunk of req) requestBody.push(chunk);
      const body = JSON.parse(Buffer.concat(requestBody).toString('utf8'));
      checkSecrets(body);
      const { name, input } = modelRequest(body);
      let response;
      if (name === 'course_blueprint') response = modelReply(blueprint);
      else if (name === 'course_review') response = modelReply({ done: true });
      else if (name === 'course_checkpoint_triage') response = modelReply({ checkpoints: [] });
      else if (name === 'online_lesson_module') response = interactionReply(input);
      else {
        assert.equal(name, 'course_slide_batch');
        if (toolResult(body, 'live_commit')) {
          committing.resolve();
          await release.promise;
          response = modelReply({ done: true });
        } else response = toolReply('commit_slides', {
          pages: input.pagePlans.map(plan => authoredPage(plan)),
        }, 'live_commit');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(await response.text());
    } catch (error) {
      gatewayError = error;
      res.writeHead(500).end();
    }
  });
  if (!gateway) return;
  const config = {
    baseUrl: gateway + '/v1', model: primary.model, key: primaryKey,
    fastBaseUrl: gateway + '/v1', fastModel: rapid.model, fastKey: rapidKey,
  };
  assert.equal((await request(origin, path + '/provider', { cookie, data: config })).status, 200);
  const pending = request(origin, path + '/author-deck', { cookie, data: { spec } });
  try {
    await Promise.race([committing.promise, pending.then(() => assert.fail('authoring completed before a tool observation'))]);
    const endpoint = path + '/harness-progress';
    assert.equal((await request(origin, endpoint)).status, 403);
    const response = await request(origin, endpoint, { cookie });
    assert.equal(response.status, 200);
    const progress = await response.json();
    assert.equal(progress.running, true);
    assert(progress.toolEvents.some(event => event.tool === 'commit_slides'));
    assert(progress.harnessReceipt.previewPages.some(page => page.number === 1));
    checkSecrets(progress);
  } finally { release.resolve(); }
  const response = await pending;
  assert.equal(gatewayError, undefined);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.lectureScore.pages.length, 6);
  assert((await (await request(origin, path + '/harness-progress', { cookie })).json()).running === false);
  checkSecrets(result);
  const diskState = await readFile(snapshot, 'utf8');
  checkSecrets(diskState);
  assert.doesNotMatch(diskState, /toolEvents|harnessReceipt/u);
});
