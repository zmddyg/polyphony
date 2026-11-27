import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPOSITION_PLAN_SCHEMA, REHEARSAL_INPUT } from '../dist/core/lesson-composer.mjs';
import { composeLesson, describeLessonProvider, planLecture, requestStructuredCompletion } from '../lesson-provider.mjs';

const provider = {
  baseUrl: 'https://provider.example/v1/',
  model: 'example-model',
  key: 'example-credential',
};

const messages = [{ role: 'user', content: 'Return JSON with the answer.' }];
const payload = { answer: 'ok' };
const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

function reply(content, choice = {}, message = {}) {
  return Response.json({ choices: [{ ...choice, message: { ...message, content } }] });
}

test('provider status exposes validated capabilities without disclosing the endpoint or credentials', () => {
  assert.deepEqual(describeLessonProvider(provider), {
    configured: true, protocol: 'chat-completions', outputMode: 'json_object',
  });
  assert.deepEqual(describeLessonProvider({ ...provider, outputMode: 'json_schema' }), {
    configured: true, protocol: 'chat-completions', outputMode: 'json_schema',
  });
  assert.deepEqual(describeLessonProvider({ ...provider, outputMode: 'invalid' }), {
    configured: false, protocol: 'chat-completions', outputMode: null,
  });
  for (const baseUrl of ['file:///provider/v1', 'https://user:pass@provider.example/v1', 'https://provider.example/v1?q=key']) {
    assert.equal(describeLessonProvider({ ...provider, baseUrl }).configured, false);
  }
});

test('completion requests select exactly one output mode and normalize fenced JSON in every mode', async () => {
  const source = '```json\r\n' + JSON.stringify(payload) + '\r\n```';
  for (const [outputMode, format] of [
    ['json_object', { type: 'json_object' }],
    ['json_schema', { type: 'json_schema', json_schema: { name: 'example', strict: true, schema } }],
    ['text', undefined],
  ]) {
    const result = await requestStructuredCompletion({
      ...provider,
      outputMode,
      schemaName: 'example',
      schema,
      messages,
      fetchImpl: async (url, init) => {
        assert.equal(url.href, 'https://provider.example/v1/chat/completions');
        assert.equal(init.redirect, 'error');
        assert.deepEqual(JSON.parse(init.body), {
          model: provider.model, messages, ...(format && { response_format: format }),
        });
        return reply(source);
      },
    });
    assert.equal(result, JSON.stringify(payload));
  }
});

test('native lesson requests reuse the composer schema and the deadline across validation repair', async () => {
  const signals = [];
  const result = await composeLesson(REHEARSAL_INPUT, {
    ...provider,
    outputMode: 'json_schema',
    fetchImpl: async (_url, init) => {
      signals.push(init.signal);
      const { response_format } = JSON.parse(init.body);
      assert.deepEqual(response_format, {
        type: 'json_schema',
        json_schema: { name: 'polyphony_lesson_plan', strict: true, schema: COMPOSITION_PLAN_SCHEMA },
      });
      return reply('{}');
    },
  });
  assert.equal(result.source, 'fallback');
  assert.equal(signals.length, 2);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.equal(signals[0], signals[1]);
});

test('completion identifies refusals, truncation and invalid envelopes before domain validation', async () => {
  const content = JSON.stringify(payload);
  for (const response of [
    new Response('invalid JSON'),
    Response.json({ choices: { 0: { message: { content } } } }),
    reply('   '),
    reply(content, { finish_reason: 'content_filter' }),
    reply(content, {}, { refusal: 'endpoint-only refusal' }),
  ]) {
    const result = await requestStructuredCompletion({ ...provider, messages, fetchImpl: async () => response });
    assert.equal(result, undefined);
  }
  await assert.rejects(requestStructuredCompletion({
    ...provider, messages, fetchImpl: async () => reply(content, { finish_reason: 'length' }),
  }), /length/u);
});

test('the chat lecture planner scans every page locally and sends only pages with title or text', async () => {
  const pages = Array.from({ length: 72 }, (_, index) => ({
    number: index + 1, title: index % 3 === 0 ? 'Experiment' : '', text: ' ', preview: 'private-preview',
  }));
  const batches = [];
  const options = { ...provider, fetchImpl: async (_url, init) => {
    const { messages } = JSON.parse(init.body);
    batches.push(JSON.parse(messages[1].content));
    return reply('{"suggestions":[]}');
  } };
  const result = await planLecture(pages, options);
  const visiblePages = pages.filter(({ title }) => title).map(({ number, title, text }) => ({ number, title, text }));
  assert.deepEqual(batches, [visiblePages]);
  assert.equal(result.scannedPages, pages.length);
  assert.equal(result.modelPages, visiblePages.length);
  assert.equal(result.source, 'provider');

  const local = await planLecture(pages.filter(({ title }) => !title), options);
  assert.equal(local.source, 'local');
  assert.equal(batches.length, 1);
});

test('completion transport errors distinguish throttling, direct network failure and deadline', async () => {
  let discarded = false;
  const body = new ReadableStream({ cancel() { discarded = true; } });
  await assert.rejects(requestStructuredCompletion({
    ...provider, messages, fetchImpl: async () => new Response(body, { status: 429 }),
  }), /HTTP 429/u);
  assert.equal(discarded, true);

  await assert.rejects(requestStructuredCompletion({
    ...provider, messages,
    fetchImpl: async () => { throw new Error('endpoint-only details'); },
  }), error => /网络|跨域/u.test(error.message) && !error.message.includes('endpoint-only'));

  const reason = new DOMException('test deadline', 'TimeoutError');
  await assert.rejects(requestStructuredCompletion({
    ...provider, messages,
    signal: AbortSignal.abort(reason),
    fetchImpl: async () => { assert.fail('expired deadline reached provider'); },
  }), /超时/u);
});
