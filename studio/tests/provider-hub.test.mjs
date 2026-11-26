import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPageModule } from '../dist/core/deck-harness.mjs';
import { createDemoMaterial } from '../demo/demo-lesson.mjs';
import { createRoom, reduceRoom } from '../dist/core/engine.mjs';
import { projectRoom } from '../dist/core/transport.mjs';
import { ethicsLesson, pointerLesson } from '../dist/core/universal-lessons.mjs';
import { request, roomTestServer, startLoopbackServer } from './support/integration.mjs';

test('teacher-only provider and Harness use real Chat Completions HTTP with safe fallback', { timeout: 25_000 }, async t => {
  const classroom = await roomTestServer(t);
  if (!classroom) return;
  const { origin, snapshot } = classroom;
  const fixtureKey = 'never-export-this-fixture-key';
  const material = createDemoMaterial();
  material.pages = [material.pages[2]];
  const providerPrompt = 'Explain the rank statement using one source excerpt.';
  const providerLesson = { ...createPageModule(material.pages[0], 'concept-diagnosis@1'), prompt: providerPrompt };
  const requests = [];
  const synthesisStarted = Promise.withResolvers();
  const releaseSynthesis = Promise.withResolvers();
  let unavailable = false;
  const modelOrigin = await startLoopbackServer(t, async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization, contentType: req.headers['content-type'], body });
      if (unavailable) {
        res.writeHead(503).end();
        return;
      }
      const ping = body.response_format?.json_schema?.name === 'connection_ping';
      if (!ping) {
        synthesisStarted.resolve();
        await releaseSynthesis.promise;
      }
      const content = JSON.stringify(ping ? { ok: true } : providerLesson);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch {
      res.writeHead(400).end();
    }
  });
  if (!modelOrigin) return;

  const opened = await request(origin, '/api/rooms', { data: { demo: false, lessonId: 'four-spaces' } });
  assert.equal(opened.status, 201);
  const cookie = opened.headers.get('set-cookie').split(';')[0];
  const { room } = await opened.json();
  const path = '/api/rooms/' + room.code;
  const config = { baseUrl: modelOrigin + '/v1', model: 'hub-test', key: fixtureKey, outputMode: 'json_schema' };
  const post = (route, data) => request(origin, path + route, { data, cookie });
  const status = async () => (await request(origin, '/api/status')).json();
  for (const [route, data] of [['/provider', config], ['/harness', { material }]]) {
    assert.equal((await request(origin, path + route, { data })).status, 403);
  }
  assert.equal((await request(origin, path + '/harness')).status, 403);
  assert.equal((await post('/provider', { ...config, baseUrl: 'javascript:bad' })).status, 400);
  assert.equal((await post('/provider', config)).status, 200);

  const active = await status();
  assert.equal(active.assistedHarness, true);
  assert.equal(active.providerSummary.source, 'runtime');
  assert.equal(active.providerSummary.model, 'hub-test');
  assert.equal(active.providerSummary.baseUrlHost, new URL(modelOrigin).host);
  const privateSetting = /never-export-this-fixture-key|Bearer/;
  assert.doesNotMatch(JSON.stringify(active), privateSetting);
  for (const role of ['student', 'stage']) {
    const response = await request(origin, path + '/session', { data: { role } });
    assert.equal(response.status, 200);
    assert.doesNotMatch(JSON.stringify(await response.json()), /never-export-this-fixture-key|providerSummary/);
  }
  assert.doesNotMatch(await readFile(snapshot, 'utf8'), /never-export-this-fixture-key|hub-test|providerSummary/);

  const cleared = await post('/provider', { clear: true });
  assert.equal((await cleared.json()).providerSummary.configured, false);
  const rehearsed = await post('/harness', { material: createDemoMaterial(), pacingMode: 'full-demo', mode: 'demo-replay' });
  assert.equal(rehearsed.status, 200);
  const replay = await rehearsed.json();
  assert.equal(replay.lectureScore.format, 'polyphony.lecture');
  assert.equal(replay.harnessReceipt.stages.length, 5);
  assert.ok(replay.harnessReceipt.stages.every(s => s.status === 'complete'));
  assert.doesNotMatch(JSON.stringify(replay), privateSetting);

  const tested = await post('/provider', { ...config, test: true, testOnly: true });
  assert.equal(tested.status, 200);
  assert.equal((await tested.json()).tested, true);
  assert.equal(requests.length, 1);
  assert.equal((await status()).providerSummary.configured, false);

  assert.equal((await post('/provider', config)).status, 200);
  const pending = post('/harness', { material, pacingMode: 'full-demo' });
  try {
    await Promise.race([synthesisStarted.promise, pending.then(() => assert.fail('Harness ended before contacting the provider'))]);
    const progress = await (await request(origin, path + '/harness', { cookie })).json();
    assert.equal(progress.running, true);
    assert.equal(progress.harnessReceipt.stages.find(s => s.id === 'synthesize').status, 'running');
  } finally {
    releaseSynthesis.resolve();
  }
  const assisted = await pending;
  assert.equal(assisted.status, 200);
  const built = await assisted.json();
  assert.equal(built.lectureScore.pages[0].interaction.prompt, providerPrompt);
  assert.deepEqual(built.harnessReceipt.repairs, []);
  assert.equal((await (await request(origin, path + '/harness', { cookie })).json()).running, false);

  unavailable = true;
  const failed = await post('/harness', { material, pacingMode: 'full-demo' });
  assert.equal(failed.status, 200);
  const fallback = await failed.json();
  assert.deepEqual(fallback.harnessReceipt.repairs.map(({ status }) => status), ['fallback']);
  assert.equal(fallback.lectureScore.pages[0].interaction.activityId, 'concept-diagnosis@1');
  assert.notEqual(fallback.lectureScore.pages[0].interaction.prompt, providerPrompt);
  assert.doesNotMatch(JSON.stringify([built, fallback]), privateSetting);

  assert.deepEqual(requests.map(r => r.body.response_format.json_schema.name), [
    'connection_ping', 'online_lesson_module', 'online_lesson_module', 'online_lesson_module',
  ]);
  for (const { method, path, authorization, contentType, body } of requests) {
    assert.equal(method, 'POST');
    assert.equal(path, '/v1/chat/completions');
    assert.equal(authorization, 'Bearer ' + fixtureKey);
    assert.equal(contentType, 'application/json');
    assert.equal(body.model, config.model);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.type, 'object');
  }
  assert.match(requests[0].body.messages[0].content, /"ok":true/);
});

test('public projections hide answer keys and teacher-controlled AI card until reveal', () => {
  let room = reduceRoom(createRoom(), { type: 'loadLesson', payload: { lesson: { ...pointerLesson, id: 'test-audit' } } });
  for (const role of ['student', 'stage']) {
    const projected = projectRoom(room, role, null);
    assert.equal(projected.lesson.correctOptionId, undefined);
    assert.equal(projected.lesson.moduleConfig.faultStepId, undefined);
    assert.equal(projected.lesson.moduleConfig.faultDiagnosis, undefined);
  }
  room = reduceRoom(room, { type: 'reveal' });
  assert.equal(projectRoom(room, 'stage').lesson.moduleConfig.faultStepId, 'S3');
  room = reduceRoom(room, { type: 'loadLesson', payload: { lesson: { ...ethicsLesson, id: 'test-ethics' } } });
  assert.equal(projectRoom(room, 'student').lesson.moduleConfig.aiPeer, undefined);
  room = reduceRoom(room, { type: 'toggleAiPeer' });
  assert.equal(projectRoom(room, 'stage').lesson.moduleConfig.aiPeer.claim, ethicsLesson.moduleConfig.aiPeer.claim);
});
