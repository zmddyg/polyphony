import assert from 'node:assert/strict';
import test from 'node:test';
import { openSession } from '../dist/core/transport.mjs';

test('the teacher transport carries access credentials and opens the phone pairing link', async t => {
  const previous = Object.fromEntries(['location','sessionStorage','EventSource','fetch'].map(key => [key, globalThis[key]]));
  t.after(() => {
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });

  globalThis.location = new URL('http://127.0.0.1:4188/?view=desk');
  globalThis.sessionStorage = new Map();
  sessionStorage.setItem = sessionStorage.set.bind(sessionStorage);
  sessionStorage.getItem = sessionStorage.get.bind(sessionStorage);
  globalThis.EventSource = class { close() {} };

  const room = 'V4ROOM';
  const token = 'a'.repeat(32);
  const passphrase = '教师口令';
  const accessHeader = 'base64:' + Buffer.from(passphrase).toString('base64');
  const calls = [];
  globalThis.fetch = async (url, { headers, body } = {}) => {
    const route = url.pathname;
    calls.push(route);
    if (route === '/api/status') return Response.json({ polyphony:true, passphraseRequired:true, publicOrigin:'http://10.0.0.20:4188' });
    if (route === '/api/rooms' && headers['X-Polyphony-Passphrase'] !== accessHeader) {
      return Response.json({ error:'需要教师口令', code:'teacher-passphrase-required' }, { status:403 });
    }
    if (route.endsWith('/remote-pair')) return Response.json({ token, expiresAt:1000 });
    if (route.endsWith('/materials/import')) {
      assert.equal(headers['X-Polyphony-Passphrase'], accessHeader);
      return Response.json({ pages:[] });
    }
    if (route.endsWith('/claim-teacher')) assert.deepEqual(JSON.parse(body), { token });
    return Response.json({ room:{ code:room, version:0 } });
  };

  await assert.rejects(openSession({ role:'teacher' }), { code:'teacher-passphrase-required' });
  const teacher = await openSession({ role:'teacher', passphrase });
  assert.equal(teacher.passphraseRequired, true);
  assert.deepEqual(await teacher.importMaterial(new File(['sample'], '材料.pdf')), { pages:[] });
  (await teacher.newRoom({ demo:false })).close();
  const pair = await teacher.createRemotePair();
  const link = new URL(pair.url);
  assert.equal(link.origin, 'http://10.0.0.20:4188');
  assert.equal(link.search, '?view=remote&room=V4ROOM');
  assert.equal(link.hash, '#claim=' + token);
  assert.equal(pair.expiresAt, 1000);
  const phone = await openSession({ role:'teacher', room, remote:true, claim:token });
  assert.equal(phone.code, teacher.code);
  assert.equal(calls.at(-1), '/api/rooms/V4ROOM/claim-teacher');
  await assert.rejects(openSession({ role:'student', room, claim:token }), /手机遥控链接无效/);
  phone.close();
  teacher.close();
});
