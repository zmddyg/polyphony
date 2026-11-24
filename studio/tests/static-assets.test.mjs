import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createStaticHandler } from '../static-assets.mjs';

test('static asset compression, revalidation and invalidation agree across clients', async t => {
  const root = await mkdtemp(join(tmpdir(), 'polyphony-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'lesson.mjs');
  const source = 'export const name = "' + '讲义'.repeat(512) + '";';
  await writeFile(file, source);
  const serve = createStaticHandler(root);
  async function load(headers = {}, method = 'GET', path = '/lesson.mjs') {
    const res = new PassThrough();
    let status, resultHeaders;
    res.writeHead = (code, values) => { status = code; resultHeaders = values; };
    const body = buffer(res);
    await serve({ method, headers }, res, path);
    return { status, headers: resultHeaders, bytes: await body };
  }

  const acceptsGzip = { 'accept-encoding': 'br, gzip' };
  const [first, simultaneous, plain] = await Promise.all([load(acceptsGzip), load(acceptsGzip), load()]);
  assert.equal(first.status, 200);
  assert.deepEqual(gunzipSync(first.bytes), plain.bytes);
  assert.equal(plain.bytes.toString(), source);
  assert.deepEqual(simultaneous.bytes, first.bytes);
  assert.ok(first.bytes.length < plain.bytes.length);
  assert.equal(first.headers.Vary, 'Accept-Encoding');
  assert.equal(first.headers['Content-Length'], first.bytes.length);
  assert.notEqual(first.headers.ETag, plain.headers.ETag);

  const strongForm = first.headers.ETag.slice(2);
  const fresh = await load({ ...acceptsGzip, 'if-none-match': '"older", ' + strongForm });
  assert.equal(fresh.status, 304);
  assert.equal(fresh.bytes.length, 0);
  assert.equal(fresh.headers.ETag, first.headers.ETag);
  assert.equal((await load({ 'if-modified-since': plain.headers['Last-Modified'] })).status, 304);
  assert.equal((await load({ 'if-modified-since': plain.headers['Last-Modified'], 'if-none-match': '"other"' })).status, 200);
  const head = await load(acceptsGzip, 'HEAD');
  assert.equal(head.headers['Content-Encoding'], 'gzip');
  assert.equal(head.bytes.length, 0);
  assert.deepEqual((await load({ 'accept-encoding': 'gzip;q=0, *;q=1' })).bytes, plain.bytes);
  assert.deepEqual((await load({ 'accept-encoding': 'gzip;q=0.2, identity;q=1' })).bytes, plain.bytes);
  await assert.rejects(load({ 'accept-encoding': 'gzip;q=0, identity;q=0' }), { status: 406 });
  await assert.rejects(load({}, 'GET', '/%2e%2e%2fprivate'), { status: 404 });

  await writeFile(file, source + '\n// 第二版');
  const changed = await load({ ...acceptsGzip, 'if-none-match': first.headers.ETag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.ETag, first.headers.ETag);
  assert.equal(gunzipSync(changed.bytes).toString(), source + '\n// 第二版');
});
