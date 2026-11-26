import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { castVote, newChallenge } from '../dist/core/challenge-lab.mjs';
import { createRoom, reduceRoom } from '../dist/core/engine.mjs';
import { buildLectureScore } from '../dist/core/lecture-score.mjs';
import { projectRoom } from '../dist/core/transport.mjs';
import { createPublicRoomEncoder } from '../room-broadcast.mjs';

test('the shared SSE encoding preserves the individual view across rounds, old responses and votes', () => {
  let room = createRoom({ lessonId:'mzi', demo: true });
  const apply = (type, payload) => { room = reduceRoom(room, { type, payload }); };
  const compare = snapshot => {
    const encode = createPublicRoomEncoder(snapshot);
    for (const [role, id] of [['stage', null], ['student', 'a'], ['student', 'b'], ['student', 'absent'], ['student', 'voter']]) {
      assert.deepEqual(JSON.parse(encode(id)), JSON.parse(JSON.stringify(projectRoom(snapshot, role, id))));
    }
  };
  apply('join', { participantId: 'a', name: '甲\n同学' });
  apply('join', { participantId: 'b', name: '乙同学' });
  apply('respond', { participantId: 'a', optionId: 'dark', reason: '首轮：A 口变暗', sample: { phaseIndex: 2, power: .4 } });
  apply('respond', { participantId: 'b', optionId: 'valley', reason: '首轮：两路等强' });
  compare(room);
  apply('reveal');
  apply('branch', { branchId: 'energy' });
  apply('draw', { random: 0 });
  compare(room);
  apply('revise');
  apply('respond', { participantId: 'a', optionId: 'peak', reason: '改答：还有 B 口' });
  compare(room);
  compare({ ...room, responses: room.responses.toReversed() });
  apply('reveal');
  const experiment = castVote(castVote(newChallenge('rc'), 'a', 'early'), 'voter', 'current');
  compare({ ...room, experiment, lecture: { index: 1, sourceVersion: 'private' }, lectureArchive: [{ note: 'private' }] });
});

class Reply extends EventEmitter {
  headers = new Headers();
  chunks = [];
  writableNeedDrain = false;

  setHeader(name, value) { this.headers.set(name, value); }
  writeHead(status, headers) {
    this.status = status;
    this.headersSent = true;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
  }
  write(chunk) {
    this.chunks.push(chunk);
    return !this.writableNeedDrain;
  }
  end(payload) { this.payload = payload; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
  get events() {
    return this.chunks.flatMap(chunk => {
      const data = chunk.split('\n').find(line => line.startsWith('data: '));
      return data ? [JSON.parse(data.slice(6))] : [];
    });
  }
}

test('SSE shares its heartbeat and sends the latest authorized snapshot after a slow connection drains', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'polyphony-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.POLYPHONY_ROOM_FILE;
  process.env.POLYPHONY_ROOM_FILE = join(dir, 'rooms.json');
  let serve;
  try { ({ serve } = await import('../server.mjs')); }
  finally {
    if (previous === undefined) delete process.env.POLYPHONY_ROOM_FILE;
    else process.env.POLYPHONY_ROOM_FILE = previous;
  }

  let tick;
  const handle = { unref() { return this; } };
  const set = t.mock.method(globalThis, 'setInterval', (callback, period) => {
    assert.equal(period, 15000);
    tick = callback;
    return handle;
  });
  const clear = t.mock.method(globalThis, 'clearInterval', timer => {
    assert.equal(timer, handle);
    tick = undefined;
  });
  const request = async (url, body, cookie) => {
    const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
      url, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie }, socket: {},
    });
    const res = new Reply();
    await serve(req, res);
    return res;
  };
  const json = response => JSON.parse(response.payload);
  const cookie = response => response.headers.get('set-cookie').split(';', 1)[0];
  const first = await request('/api/rooms', { demo: false, lessonId:'mzi' });
  const roomPath = '/api/rooms/' + json(first).room.code;
  const alice = cookie(await request(roomPath + '/session', { role: 'student' }));
  const bob = cookie(await request(roomPath + '/session', { role: 'student' }));
  const stage = await request(roomPath + '/events?role=stage');
  const slow = await request(roomPath + '/events?role=student', undefined, alice);
  const other = await request(roomPath + '/events?role=student', undefined, bob);
  const teacher = await request(roomPath + '/events?role=teacher', undefined, cookie(first));
  const lecture = buildLectureScore({ name: '讲义', pages: [{ number: 1, title: '第一页' }, { number: 2, title: '第二页' }] });
  const second = await request('/api/rooms', { lecture });
  const secondRoom = json(second).room;
  const secondPath = '/api/rooms/' + secondRoom.code;
  const secondStage = await request(secondPath + '/events?role=stage');
  t.after(() => [stage, slow, other, teacher, secondStage].forEach(response => response.destroy()));
  assert.equal(set.mock.callCount(), 1);

  slow.writableNeedDrain = true;
  tick();
  assert.equal(stage.chunks.at(-1), ': heartbeat\n\n');
  assert.notEqual(slow.chunks.at(-1), ': heartbeat\n\n');
  assert.equal((await request(roomPath + '/commands', { role: 'student', type: 'join', payload: { name: '甲同学' } }, alice)).status, 200);
  const response = await request(roomPath + '/commands', { role: 'student', type: 'respond', payload: { optionId: 'dark', reason: '我的首轮私密解释' } }, alice);
  assert.equal(response.status, 200);
  assert.equal(slow.events.length, 1);
  assert.equal(stage.events.at(-1).responses.length, 0);
  assert.equal(other.events.at(-1).responses.length, 0);
  assert.equal(teacher.events.at(-1).responses[0].reason, '我的首轮私密解释');
  slow.writableNeedDrain = false;
  slow.emit('drain');
  assert.equal(slow.events.length, 2);
  assert.deepEqual(slow.events.at(-1), json(response).room);

  const firstFrame = await request(secondPath + '/frame?index=0');
  assert.equal(firstFrame.headers.get('cache-control'), 'no-store');
  assert.equal(json(firstFrame).title, '第一页');
  assert.deepEqual(json(await request(secondPath + '/frame?index=0')), json(firstFrame));
  const flip = await request(secondPath + '/commands', { role: 'teacher', type: 'lectureNavigate', payload: {
    index: 1, expectedLectureIndex: 0, expectedLectureTurn: secondRoom.lecture.turn,
  } }, cookie(second));
  assert.equal(flip.status, 200);
  assert.equal((await request(secondPath + '/frame?index=0')).status, 409);
  assert.equal(json(await request(secondPath + '/frame?index=1')).title, '第二页');

  for (const stream of [stage, slow, other, teacher]) stream.destroy();
  assert.equal(slow.listenerCount('drain'), 0);
  assert.equal(clear.mock.callCount(), 0);
  secondStage.destroy();
  assert.equal(clear.mock.callCount(), 1);
});
