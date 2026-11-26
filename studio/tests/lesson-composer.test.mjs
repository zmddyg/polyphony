import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createRoom, reduceRoom } from '../dist/core/engine.mjs';
import { composeLocally, rehearseComposition, REHEARSAL_INPUT } from '../dist/core/lesson-composer.mjs';
import { exportScore, importScore } from '../dist/core/score-package.mjs';
import { composeLesson } from '../lesson-provider.mjs';

const input = {
  topic: '树荫是否影响气温',
  goal: '用同一时间的观测数据判断树荫的影响及证据限制',
  material: '上午十点，两处等高测点分别记录树荫处 26°C、日照处 30°C。下午未记录。',
  reference: 'rc-fault',
};

const provider = {
  baseUrl: 'https://provider.example/v1/',
  model: 'fixture-model',
  key: 'fixture-provider-credential',
};

function plan() {
  return {
    subject: '环境科学',
    prompt: '这组记录能支持关于树荫和气温的什么判断？',
    options: ['只支持上午十点树荫处更凉', '支持所有时间树荫处更凉', '现有记录无法比较'],
    branches: [
      { title: '计算温度差', description: '比较两个测点的读数。', revisionPrompt: '相差几度？这个差值支持哪项判断？', evidenceIds: ['M1'] },
      { title: '核对时间范围', description: '找出记录的测量时刻。', revisionPrompt: '这一份记录可以说明下午的情况吗？', evidenceIds: ['M1'] },
      { title: '设计追加观测', description: '设计多时段、同高度的测量。', revisionPrompt: '哪些新增观测会使你修改初答？', evidenceIds: ['M1'] },
    ],
  };
}

function chatResponse(value) {
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  return { choices: [{ message: { content } }] };
}

function mockProvider(...replies) {
  const requests = [];
  async function fetchImpl(url, init) {
    requests.push({ url: url.toString(), body: JSON.parse(init.body), headers: new Headers(init.headers) });
    const reply = replies[requests.length - 1];
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    return Response.json(chatResponse(reply));
  }
  return { requests, fetchImpl };
}

function assertStageTrace(trace) {
  assert.deepEqual(trace.stages.map(({ id }) => id), ['prepare', 'generate', 'validate', 'compile']);
  assert.equal(trace.activityId, 'choice@1');
  assert.deepEqual(trace.checks, { scoreRoundTrip: true, rounds: 2, testedBranches: 3 });
  for (const elapsedMs of [trace.elapsedMs, ...trace.stages.map(stage => stage.elapsedMs)]) {
    assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
  }
}

function assertRunnable(lesson, source) {
  assert.equal(lesson.title, source.topic);
  assert.equal(lesson.activityId, 'choice@1');
  assert.ok(lesson.prompt.includes(source.material.trim()));
  assert.equal(lesson.options.length, 3);
  assert.equal(lesson.branches.length, 3);
  assert.ok(lesson.branches.every(branch => branch.revisionPrompt.trim()));
  assert.deepEqual(importScore(exportScore(lesson)), lesson);
  const room = reduceRoom(createRoom(), { type: 'loadLesson', payload: { lesson } });
  assert.deepEqual(room.lesson, lesson);
  assert.equal(room.lessonId, lesson.id);
  assert.equal(room.round, 1);
}

function assertEvidence({ lesson, trace }) {
  assert.equal(trace.evidence.length, lesson.branches.length);
  const available = new Set(trace.materials.map(({ id }) => id));
  assert.deepEqual(new Set(trace.evidence.map(({ branchId }) => branchId)), new Set(lesson.branches.map(({ id }) => id)));
  for (const { materialIds } of trace.evidence) {
    assert.ok(materialIds.length > 0 && materialIds.every(id => available.has(id)));
  }
  assert.deepEqual(trace.coverage, {
    available: available.size,
    referenced: new Set(trace.evidence.flatMap(({ materialIds }) => materialIds)).size,
  });
}

test('local composition and recorded rehearsal produce runnable, distinctly labeled drafts', async () => {
  const local = composeLocally(input);
  assert.equal(local.source, 'local');
  assert.equal(local.trace.attempts, 0);
  assertStageTrace(local.trace);
  assertEvidence(local);
  assertRunnable(local.lesson, input);

  const rehearsal = await rehearseComposition();
  assert.equal(rehearsal.source, 'rehearsal');
  assert.equal(rehearsal.trace.attempts, 2);
  assert.equal(rehearsal.trace.issues.length, 1);
  assert.equal(rehearsal.trace.issues[0].attempt, 1);
  assert.ok(rehearsal.trace.stages.some(({ status }) => status === 'repaired'));
  assertStageTrace(rehearsal.trace);
  assertEvidence(rehearsal);
  assertRunnable(rehearsal.lesson, REHEARSAL_INPUT);
});

test('material numbering preserves overflow and local references resolve to real source blocks', () => {
  const lines = Array.from({ length: 15 }, (_, index) => '观测记录 ' + (index + 1));
  const source = { ...input, material: lines.join('\n') };
  const result = composeLocally(source);
  assert.equal(result.trace.materials.length, 12);
  assert.deepEqual(result.trace.materials.at(-1), { id: 'M12', text: lines.slice(11).join('\n') });
  assert.deepEqual(result.trace.evidence.map(({ materialIds }) => materialIds), [['M1'], ['M1', 'M12'], ['M12']]);
  assert.deepEqual(result.trace.coverage, { available: 12, referenced: 2 });
  assertEvidence(result);
  assertRunnable(result.lesson, source);
});

test('provider composition sends the configured Chat Completions request and compiles a grounded lesson', async () => {
  const { requests, fetchImpl } = mockProvider(plan());
  const result = await composeLesson(input, { ...provider, fetchImpl });
  assert.equal(result.source, 'provider');
  assert.equal(result.trace.model, provider.model);
  assert.equal(result.trace.attempts, 1);
  assert.deepEqual(result.trace.issues, []);
  assertStageTrace(result.trace);
  assertEvidence(result);
  assertRunnable(result.lesson, input);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://provider.example/v1/chat/completions');
  assert.equal(requests[0].headers.get('authorization'), 'Bearer ' + provider.key);
  assert.equal(requests[0].body.model, provider.model);
  assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });
  assert.ok(requests[0].body.messages.some(({ role, content }) => role === 'user' && content.includes(input.material)));
  assert.ok(!JSON.stringify(result).includes(provider.key));
});

test('invalid evidence can be repaired once with validation feedback', async () => {
  const invalid = plan();
  invalid.branches[1].evidenceIds = ['M999'];
  const { requests, fetchImpl } = mockProvider(invalid, plan());
  const result = await composeLesson(input, { ...provider, fetchImpl });
  assert.equal(result.source, 'provider');
  assert.equal(result.trace.attempts, 2);
  assert.equal(result.trace.issues.length, 1);
  assert.equal(result.trace.issues[0].attempt, 1);
  assert.ok(result.trace.issues[0].message.trim());
  assert.ok(result.trace.stages.some(({ status }) => status === 'repaired'));
  assert.equal(requests.length, 2);
  assert.notDeepEqual(requests[0].body.messages, requests[1].body.messages);
  assertEvidence(result);
  assertRunnable(result.lesson, input);
});

test('two invalid model results fall back without exposing raw output', async () => {
  const rawText = 'raw-provider-output-do-not-show';
  const { requests, fetchImpl } = mockProvider(rawText, { subject: '字段不完整' });
  const result = await composeLesson(input, { ...provider, fetchImpl });
  assert.equal(result.source, 'fallback');
  assert.equal(result.trace.attempts, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(result.trace.issues.map(({ attempt }) => attempt), [1, 2]);
  assert.deepEqual(result.trace.fallback, { validate: 'ok', compile: 'ok' });
  assert.equal(result.trace.stages.find(({ id }) => id === 'validate').status, 'failed');
  assert.equal(result.trace.stages.find(({ id }) => id === 'compile').status, 'skipped');
  assert.ok(!JSON.stringify(result).includes(rawText));
  assertStageTrace(result.trace);
  assertEvidence(result);
  assertRunnable(result.lesson, input);
});

test('provider errors skip repair, and invalid input never reaches the provider', async () => {
  for (const failure of [new Error('network-failure'), new Response(null, { status: 401 })]) {
    const { requests, fetchImpl } = mockProvider(failure);
    const result = await composeLesson(input, { ...provider, fetchImpl });
    assert.equal(result.source, 'fallback');
    assert.equal(result.trace.attempts, 1);
    assert.equal(requests.length, 1);
    assertRunnable(result.lesson, input);
  }
  const { requests, fetchImpl } = mockProvider(plan());
  await assert.rejects(composeLesson({ ...input, material: '   ' }, { ...provider, fetchImpl }));
  await assert.rejects(composeLesson({ ...input, reference: 'unknown-reference' }, { ...provider, fetchImpl }));
  assert.equal(requests.length, 0);
});

test('a refused or content-filtered reply falls back without sending the source again', async () => {
  for (const refusal of [
    { message: { refusal: 'provider-only decline', content: null } },
    { finish_reason: 'content_filter', message: { content: null } },
  ]) {
    const { requests, fetchImpl } = mockProvider(Response.json({ choices: [refusal] }));
    const result = await composeLesson(input, { ...provider, fetchImpl });
    assert.equal(result.source, 'fallback');
    assert.equal(result.trace.attempts, 1);
    assert.equal(requests.length, 1);
    assert.equal(result.trace.stages.find(({ id }) => id === 'generate').status, 'failed');
    assert.doesNotMatch(JSON.stringify(result), /provider-only decline/);
    assertRunnable(result.lesson, input);
  }
});

test('a provider deadline falls back after one attempt', async () => {
  let timeout;
  let calls = 0;
  let aborted = false;
  const fetchImpl = (_url, { signal }) => new Promise((_, reject) => {
    calls++;
    timeout = setTimeout(() => reject(new Error('Fetch was not aborted')), 1000);
    signal.addEventListener('abort', () => {
      aborted = true;
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
  try {
    const result = await composeLesson(input, { ...provider, fetchImpl, timeoutMs: 15 });
    assert.equal(result.source, 'fallback');
    assert.equal(result.trace.attempts, 1);
    assert.equal(calls, 1);
    assert.equal(aborted, true);
    assertRunnable(result.lesson, input);
  } finally {
    clearTimeout(timeout);
  }
});

async function postTo(serve, path, body, cookie, onResponse) {
  const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    url: path,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
    socket: {},
  });
  const response = Object.assign(new EventEmitter(), {
    headers: new Headers(),
    setHeader(name, value) { this.headers.set(name, value); },
    writeHead(status, headers) {
      this.status = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(payload) { this.payload = payload; },
  });
  onResponse?.(response);
  await serve(request, response);
  assert.equal(response.listenerCount('close'), 0);
  if (response.destroyed) {
    assert.equal(response.status, undefined);
    return;
  }
  return new Response(response.payload, { status: response.status, headers: response.headers });
}

test('teacher-only compose returns a draft that opens through the normal room command', async t => {
  const tempDir = await mkdtemp(join(tmpdir(), 'polyphony-composer-test-'));
  const roomFile = join(tempDir, 'rooms.json');
  t.after(async () => {
    await rm(roomFile, { force: true });
    await rmdir(tempDir);
  });

  const { requests, fetchImpl } = mockProvider(plan());
  const abortedRequests = [];
  let disconnect;
  t.mock.method(globalThis, 'fetch', (url, init) => {
    if (!disconnect) return fetchImpl(url, init);
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        abortedRequests.push(init.signal.reason);
        reject(init.signal.reason);
      }, { once: true });
      disconnect();
      disconnect = undefined;
    });
  });
  const overrides = {
    POLYPHONY_AI_BASE_URL: provider.baseUrl,
    POLYPHONY_AI_MODEL: provider.model,
    POLYPHONY_AI_KEY: provider.key,
    POLYPHONY_ROOM_FILE: roomFile,
  };
  const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
  let serve;
  try {
    Object.assign(process.env, overrides);
    ({ serve } = await import('../server.mjs'));
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const post = (path, body, cookie) => postTo(serve, path, body, cookie);
  const opened = await post('/api/rooms', {});
  assert.equal(opened.status, 201);
  const { room } = await opened.json();
  const cookie = opened.headers.get('set-cookie').split(';', 1)[0];
  const roomPath = '/api/rooms/' + room.code;

  const denied = await post(roomPath + '/compose', input);
  assert.equal(denied.status, 403);
  assert.equal(requests.length, 0);

  const invalid = await post(roomPath + '/compose', { ...input, reference: 'unknown-reference' }, cookie);
  assert.equal(invalid.status, 400);
  assert.equal(requests.length, 0);

  const composed = await post(roomPath + '/compose', input, cookie);
  assert.equal(composed.status, 200);
  const result = await composed.json();
  assert.equal(result.source, 'provider');
  assert.equal(requests.length, 1);
  assertEvidence(result);
  assertRunnable(result.lesson, input);

  for (const [route, payload] of [['compose', input], ['lecture-plan', {
    pages: [{ number: 1, title: '一阶 RC 电路', text: '计算时间常数。' }],
  }]]) {
    await postTo(serve, roomPath + '/' + route, payload, cookie, response => {
      disconnect = () => {
        response.destroyed = true;
        response.emit('close');
      };
    });
  }
  assert.equal(abortedRequests.length, 2);
  assert.ok(abortedRequests.every(reason => reason.name === 'AbortError'));
  assert.equal(requests.length, 1);

  const beforePublish = await post(roomPath + '/session', { role: 'teacher' }, cookie);
  assert.equal(beforePublish.status, 200);
  assert.equal((await beforePublish.json()).room.lessonId, room.lessonId);
  const published = await post(roomPath + '/commands', {
    role: 'teacher', type: 'loadLesson', payload: { lesson: result.lesson },
  }, cookie);
  assert.equal(published.status, 200);
  assert.equal((await published.json()).room.lessonId, result.lesson.id);
});
