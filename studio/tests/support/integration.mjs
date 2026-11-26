import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export function integrationUnavailable(context, reason) {
  if (process.env.POLYPHONY_REQUIRE_INTEGRATION === '1') assert.fail(reason);
  context.skip(reason);
}

export async function startLoopbackServer(context, listener) {
  const host = '127.0.0.1';
  const server = createServer(listener);
  context.after(async () => {
    if (!server.listening) return;
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  try {
    const listening = once(server, 'listening');
    server.listen(0, host);
    await listening;
    const { port } = server.address();
    const socket = connect(port, host);
    try {
      await once(socket, 'connect', { signal: AbortSignal.timeout(3_000) });
    } finally {
      socket.destroy();
    }
    return `http://${host}:${port}`;
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
    integrationUnavailable(context, `The environment denied loopback HTTP (${error.code})`);
    return null;
  }
}

export async function roomTestServer(context) {
  const tempRoot = resolve(tmpdir());
  const prefix = 'polyphony-room-test-';
  const directory = await mkdtemp(join(tempRoot, prefix));
  context.after(async () => {
    assert.equal(dirname(resolve(directory)), tempRoot);
    assert.ok(basename(directory).startsWith(prefix));
    await rm(directory, { recursive: true, force: true, maxRetries: 2 });
  });
  const snapshot = join(directory, 'rooms.json');
  const isolatedKeys = ['POLYPHONY_AI_KEY', 'POLYPHONY_AI_BASE_URL', 'POLYPHONY_AI_MODEL', 'POLYPHONY_AI_OUTPUT_MODE', 'POLYPHONY_TEACHER_PASSPHRASE', 'POLYPHONY_STORAGE'];
  const keys = [...isolatedKeys, 'POLYPHONY_ROOM_FILE'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  let serve;
  try {
    for (const key of isolatedKeys) delete process.env[key];
    process.env.POLYPHONY_ROOM_FILE = snapshot;
    const module = new URL('../../server.mjs', import.meta.url);
    module.searchParams.set('test', randomUUID());
    ({ serve } = await import(module.href));
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const origin = await startLoopbackServer(context, serve);
  return origin && { origin, snapshot };
}

export function request(origin, path, { data, cookie, signal = AbortSignal.timeout(12_000) } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST', headers, signal,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
