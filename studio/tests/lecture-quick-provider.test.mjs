import assert from 'node:assert/strict';
import test from 'node:test';
import { localLecturePlan } from '../dist/core/lecture-planner.mjs';
import { isLegacyPlannerConfigured, planLectureWithLegacyPlanner } from '../lecture-quick-provider.mjs';

const credential = 'test-quick-planner-key';
const labels = ['rc', 'mzi', 'aliasing', 'concept', 'none'];
const page = (number, title, text) => ({ number, title, text });
const payload = answers => ({
  model: 'fixture-model-1', answers, usage: { input_tokens: 340, output_tokens: 67 },
});
const choice = (kind, confidence = 0.84) => ({
  type: 'choice', choice: kind, confidence,
  probabilities: Object.fromEntries(labels.map(item => [item, item === kind ? 0.96 : 0.01])),
});

test('the quick planner sends the documented System One request and merges only accepted original-page choices', async () => {
  const pages = [
    page(3, '一阶 RC 电路', '电源接通后观察电容。'),
    {
      ...page(7, '理想等分光路', '两臂加入不同相移，再将它们重合，测定两出口的功率比例。'),
      fileName: 'presentation.ppt', preview: 'data:image/png;base64,HIDDEN_PREVIEW',
      images: [{ src: 'data:image/png;base64,HIDDEN_ASSET' }], bytes: [19, 42, 7],
    },
    page(8, '目录', '本章课程目录。'),
    page(12, '光子滤波器稀疏采样', '比较训练误差与盲测预测。'),
  ];
  let sent;
  const result = await planLectureWithLegacyPlanner({ pages, key: credential, model: 'fixture-model-1',
    fetchImpl: async (url, request) => {
      sent = { url, ...request, body: JSON.parse(request.body) };
      return Response.json(payload({
        page_3: choice('concept', 0.2),
        page_7: { ...choice('mzi'), reason: 'Untrusted provider text' },
        page_8: choice('none'),
        page_12: { ...choice('aliasing'), probabilities: { rc: 0.98 } },
        page_999: choice('rc'),
      }));
    },
  });
  assert.equal(sent.url, 'https://api.type' + 'safe.ai/v1/systemone');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.redirect, 'error');
  assert.ok(sent.signal instanceof AbortSignal);
  assert.equal(sent.headers.Authorization, 'Bearer ' + credential);
  assert.equal(sent.headers['Content-Type'], 'application/json');
  assert.deepEqual(Object.keys(sent.body), ['model', 'state', 'questions']);
  assert.equal(sent.body.model, 'fixture-model-1');
  assert.deepEqual(sent.body.state.pages, pages.map(({ number, title, text }) => ({ number, title, text })));
  assert.deepEqual(Object.keys(sent.body.questions), ['page_3', 'page_7', 'page_8', 'page_12']);
  assert.deepEqual(Object.keys(sent.body.questions.page_7.criteria), labels);
  assert.equal(sent.body.questions.page_7.type, 'choice');
  assert.match(sent.body.questions.page_7.instructions, /whose number is 7\./);
  assert.equal(result.source, '\u006aev');
  assert.equal(result.scannedPages, 4);
  assert.equal(result.totalPages, 4);
  assert.equal(result.modelPages, 2);
  assert.deepEqual(result.suggestions.map(({ pageNumber, kind }) => [pageNumber, kind]), [
    [3, 'rc'], [7, 'mzi'], [12, 'aliasing'],
  ]);
  assert.match(result.suggestions[0].reason, /原页写有/);
  assert.match(result.suggestions[1].reason, /原页写有/);
  assert.ok((pages[1].title + ' ' + pages[1].text).includes(result.suggestions[1].quote));
  assert.doesNotMatch(JSON.stringify(result), /Untrusted|confidence|probabilities/);
});

test('missing credentials or empty text uses the local planner without a provider call', async () => {
  const known = [page(1, '群折射率与行波电极', '比较两份记录。')];
  const empty = [page(1, '', '')];
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw Error('unexpected request'); };
  assert.equal(isLegacyPlannerConfigured({ key: '   ' }), false);
  assert.equal(isLegacyPlannerConfigured({ key: credential }), true);
  assert.deepEqual(await planLectureWithLegacyPlanner({ pages: known, key: ' ', fetchImpl }), localLecturePlan(known));
  assert.deepEqual(await planLectureWithLegacyPlanner({ pages: empty, key: credential, fetchImpl }), localLecturePlan(empty));
  assert.equal(calls, 0);
});

test('unavailable, malformed, inconsistent, and low-confidence decisions fall back locally', async () => {
  const pages = [page(5, '一阶 RC 电路', '计算时间常数。')];
  let discarded = false;
  const examples = [
    () => new Response(new ReadableStream({ cancel() { discarded = true; } }), { status: 429 }),
    () => new Response('not JSON'),
    () => Response.json({ answers: { page_5: choice('concept') } }),
    () => Response.json(payload({ page_5: { type: 'noul', noul: 0.95 } })),
    () => Response.json(payload({ page_5: choice('concept', 0.05) })),
    () => Response.json(payload({ page_5: { ...choice('concept'), choice: 'mzi' } })),
    () => Response.json(payload({ page_5: { ...choice('concept'), probabilities: { ...choice('concept').probabilities, rc: 0.61 } } })),
    () => { throw new Error('fixture connection error'); },
  ];
  for (const respond of examples) {
    const actual = await planLectureWithLegacyPlanner({ pages, key: credential, fetchImpl: async () => respond() });
    assert.deepEqual(actual, localLecturePlan(pages));
  }
  assert.equal(discarded, true);
});

test('a shared timeout aborts unfinished batches and preserves decisions that arrived in time', async () => {
  const pages = Array.from({ length: 13 }, (_, index) => page(index + 1, '群折射率与行波电极', '核对来源。'));
  let callCount = 0;
  let signal;
  let model;
  const result = await planLectureWithLegacyPlanner({ pages, key: credential, model: '', timeoutMs: 30,
    fetchImpl: async (_url, request) => {
      signal = request.signal;
      const wire = JSON.parse(request.body);
      model = wire.model;
      callCount += 1;
      return wire.questions.page_1 ? Response.json(payload({ page_1: choice('rc') })) : new Promise(() => {});
    },
  });
  assert.equal(callCount, 2);
  assert.equal(model, '\u006aev-latest');
  assert.equal(signal.aborted, true);
  assert.equal(result.source, '\u006aev');
  assert.equal(result.modelPages, 1);
  assert.equal(result.suggestions[0].kind, 'rc');
  assert.equal(result.suggestions.at(-1).pageNumber, 13);
  assert.equal(result.suggestions.at(-1).kind, 'concept');
  const fallback = await planLectureWithLegacyPlanner({ pages, key: credential, timeoutMs: 12,
    fetchImpl: async () => new Promise(() => {}),
  });
  assert.deepEqual(fallback, localLecturePlan(pages));
});

test('caller cancellation aborts every quick planner batch and settles even if a transport ignores its signal', async () => {
  const pages = Array.from({ length: 13 }, (_, index) => page(index + 1, 'Experiment', 'Compare records.'));
  const controller = new AbortController();
  const signals = [];
  const planning = planLectureWithLegacyPlanner({ pages, key: credential, signal: controller.signal,
    fetchImpl: (_url, request) => {
      signals.push(request.signal);
      return new Promise(() => {});
    },
  });
  controller.abort();
  await assert.rejects(planning, error => error === controller.signal.reason);
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.reason === controller.signal.reason));
});

test('large decks use bounded text-only batches and the local pass still covers every page', async () => {
  const pages = Array.from({ length: 105 }, (_, index) => page(index + 1, '群折射率与行波电极', '核对来源。'));
  const sent = [];
  const result = await planLectureWithLegacyPlanner({ pages, key: credential,
    fetchImpl: async (_url, request) => {
      const { state, questions } = JSON.parse(request.body);
      sent.push(state.pages.map(({ number }) => number));
      return Response.json(payload(Object.fromEntries(Object.keys(questions).map(id => [id, choice('none')]))));
    },
  });
  assert.ok(sent.every(group => group.length <= 12));
  const modeled = new Set(sent.flat());
  assert.equal(modeled.size, 72);
  assert.ok(modeled.has(1) && modeled.has(pages.length));
  assert.equal(result.modelPages, 72);
  assert.equal(result.scannedPages, pages.length);
  assert.deepEqual(result.suggestions.map(({ pageNumber }) => pageNumber),
    pages.filter(({ number }) => !modeled.has(number)).map(({ number }) => number));
});
