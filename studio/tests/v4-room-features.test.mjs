import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { buildLectureScore } from '../dist/core/lecture-score.mjs';
import { openRoomStore } from '../room-store.mjs';

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'polyphony-room-features-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function roomHandler(path, passphrase, label) {
  const settings = { POLYPHONY_ROOM_FILE: path, POLYPHONY_STORAGE: 'json', POLYPHONY_TEACHER_PASSPHRASE: passphrase };
  const previous = Object.keys(settings).map(name => [name, process.env[name]]);
  try {
    Object.assign(process.env, settings);
    return (await import(`../server.mjs?${label}`)).serve;
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function requester(serve) {
  return async (url, body, headers = {}) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      url,
      method: body === undefined ? 'GET' : 'POST',
      headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
      socket: { localPort: 4188 },
    });
    const result = { headers: {} };
    await serve(req, {
      setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
      writeHead(status) { result.status = status; },
      end(payload) { result.body = JSON.parse(payload); },
    });
    return result;
  };
}

test('teacher passphrase protects creation and material ingress while a paired phone can control one room', async t => {
  const path = join(temporaryDirectory(t), 'rooms.json');
  const passphrase = '教师开课测试';
  const passphraseHeader = { 'x-polyphony-passphrase': `base64:${Buffer.from(passphrase).toString('base64')}` };
  const request = requester(await roomHandler(path, passphrase, 'protected-v4-rooms'));
  const status = await request('/api/status');
  assert.equal(status.body.passphraseRequired, true);
  assert.equal(status.body.storageBackend, 'json');
  assert.equal(JSON.stringify(status.body).includes(passphrase), false);

  const input = { demo: false, lessonId: 'four-spaces' };
  for (const headers of [{}, { 'x-polyphony-passphrase': 'incorrect' }]) {
    const denied = await request('/api/rooms', input, headers);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'teacher-passphrase-required');
  }
  const created = await request('/api/rooms', input, passphraseHeader);
  assert.equal(created.status, 201);
  const code = created.body.room.code;
  const roomPath = `/api/rooms/${code}`;
  const owner = { cookie: created.headers['set-cookie'].split(';')[0] };
  const lecture = buildLectureScore({
    name: '遥控翻页',
    pages: [
      { number: 1, title: '第一页', text: '首屏正文' },
      { number: 2, title: '第二页', text: '次屏正文', blocks: [{ type: 'bullets', items: ['原生内容'] }] },
    ],
  });
  const anotherRoom = await request('/api/rooms', { lecture }, passphraseHeader);
  assert.equal(anotherRoom.status, 201);
  const anotherPath = `/api/rooms/${anotherRoom.body.room.code}`;

  const materialPath = `${roomPath}/materials/import?name=test.pdf`;
  assert.equal((await request(materialPath, {}, passphraseHeader)).status, 403);
  const deniedImport = await request(materialPath, {}, owner);
  assert.equal(deniedImport.status, 403);
  assert.equal(deniedImport.body.code, 'teacher-passphrase-required');
  // With both credentials present, the upload reaches its usual content-type check.
  assert.equal((await request(materialPath, {}, { ...owner, ...passphraseHeader })).status, 415);

  assert.equal((await request(`${roomPath}/session`, { role: 'student' })).status, 200);
  const publicStage = await request(`${roomPath}/session`, { role: 'stage' });
  assert.equal(publicStage.status, 200);
  assert.ok(created.body.room.lesson.correctOptionId);
  assert.equal(publicStage.body.room.lesson.correctOptionId, undefined);
  assert.equal((await request(`${roomPath}/session`, { role: 'teacher' })).status, 403);
  assert.equal((await request(`${roomPath}/remote-pair`, {})).status, 403);

  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const paired = await request(`${roomPath}/remote-pair`, {}, owner);
  assert.equal(paired.status, 200);
  const { token, expiresAt } = paired.body;
  assert.match(token, /^[a-f0-9]{32}$/);
  assert.equal(expiresAt, now + 300_000);
  assert.equal((await request(`${anotherPath}/claim-teacher`, { token })).status, 403);
  assert.equal((await request(`${roomPath}/claim-teacher`, { token }, { origin: 'https://another.example' })).status, 403);

  const attempts = await Promise.all([1, 2].map(() => request(`${roomPath}/claim-teacher`, { token })));
  assert.deepEqual(attempts.map(attempt => attempt.status).sort(), [200, 403]);
  const claimed = attempts.find(attempt => attempt.status === 200);
  assert.equal(claimed.body.participantId, null);
  assert.equal(claimed.body.room.lesson.correctOptionId, created.body.room.lesson.correctOptionId);
  const phoneCookie = claimed.headers['set-cookie'];
  assert.ok(phoneCookie.includes(`Path=${roomPath}; HttpOnly; SameSite=Strict`));
  const phone = { cookie: phoneCookie.split(';')[0] };
  assert.equal((await request(`${roomPath}/session`, { role: 'teacher' }, phone)).status, 200);
  assert.equal((await request(`${roomPath}/commands`, { role: 'teacher', type: 'reveal' }, phone)).body.room.phase, 'reveal');
  assert.equal((await request(`${anotherPath}/session`, { role: 'teacher' }, phone)).status, 403);

  const lectureOwner = { cookie: anotherRoom.headers['set-cookie'].split(';')[0] };
  const lecturePair = await request(`${anotherPath}/remote-pair`, {}, lectureOwner);
  const lectureClaim = await request(`${anotherPath}/claim-teacher`, { token: lecturePair.body.token });
  const lecturePhone = { cookie: lectureClaim.headers['set-cookie'].split(';')[0] };
  const current = lectureClaim.body.room.lecture;
  assert.equal((await request(`${anotherPath}/frame?index=1`)).status, 409);
  const advanced = await request(`${anotherPath}/commands`, {
    role: 'teacher',
    type: 'lectureNavigate',
    payload: { index: 1, expectedLectureIndex: current.index, expectedLectureTurn: current.turn },
  }, lecturePhone);
  assert.equal(advanced.status, 200);
  assert.equal(advanced.body.room.lecture.index, 1);
  assert.deepEqual((await request(`${anotherPath}/frame?index=1`)).body.blocks, [{ type: 'bullets', items: ['原生内容'] }]);
  assert.equal((await request(`${anotherPath}/frame?index=0`)).status, 409);

  const pending = await request(`${roomPath}/remote-pair`, {}, owner);
  now = pending.body.expiresAt;
  assert.equal((await request(`${roomPath}/claim-teacher`, { token: pending.body.token })).status, 403);
  const stored = readFileSync(path, 'utf8');
  assert.equal(stored.includes(passphrase), false);
  assert.equal(stored.includes(token), false);
  assert.equal(stored.includes(pending.body.token), false);
});

test('room creation remains open with the optional passphrase disabled', async t => {
  const path = join(temporaryDirectory(t), 'rooms.json');
  const request = requester(await roomHandler(path, '', 'unprotected-v4-rooms'));
  assert.equal((await request('/api/status')).body.passphraseRequired, false);
  assert.equal((await request('/api/rooms', { demo: false })).status, 201);
});

test('SQLite uses WAL and reads the latest room state after a second connection writes and after restart', async t => {
  const dir = temporaryDirectory(t);
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (error) {
    if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
    t.skip('This Node runtime does not expose the optional SQLite module.');
    return;
  }
  const path = join(dir, 'rooms.sqlite3');
  const room = { room: { version: 1 }, owner: 'teacher', students: { student: 'p-1' } };
  const changed = { ...room, room: { version: 2 } };
  const store = openRoomStore(path);
  try {
    assert.equal(store.backend, 'sqlite');
    assert.equal(store.has('ABC246'), false);
    store.save('ABC246', room);
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
      assert.deepEqual(JSON.parse(observer.prepare('SELECT payload FROM rooms WHERE code = ?').get('ABC246').payload), room);
    } finally {
      observer.close();
    }
    const writer = openRoomStore(path);
    try {
      writer.save('ABC246', changed);
      assert.deepEqual(store.get('ABC246'), changed);
    } finally {
      writer.close();
    }
  } finally {
    store.close();
  }
  const reopened = openRoomStore(path);
  try {
    assert.deepEqual(reopened.get('ABC246'), changed);
    assert.equal(reopened.get('missing'), undefined);
  } finally {
    reopened.close();
  }
  const json = openRoomStore(join(dir, 'rooms.db'), { backend: 'json' });
  assert.equal(json.backend, 'json');
  json.save('ABC246', room);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'rooms.db'), 'utf8')), { ABC246: room });
});
