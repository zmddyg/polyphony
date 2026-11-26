import assert from 'node:assert/strict';
import test from 'node:test';
import { request, roomTestServer } from './support/integration.mjs';

async function readJson(response, status = 200) {
  const result = await response.json();
  assert.equal(response.status, status, result.error);
  return result;
}

async function openEvents(t, origin, path, role, cookie) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
  const response = await request(origin, `${path}/events?role=${role}`, { cookie, signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream\b/);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let previous = 0;
  return {
    close: () => controller.abort(),
    async version(target) {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) {
          const { value, done } = await reader.read();
          assert.equal(done, false, `SSE ended before version ${target}`);
          buffer += value;
          continue;
        }
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (!data) continue;
        const room = JSON.parse(data);
        const eventId = Number(frame.match(/^id: (\d+)$/m)?.[1]);
        assert.equal(eventId, room.version);
        assert.ok(eventId > previous, `${role} SSE version ${eventId} followed ${previous}`);
        previous = eventId;
        if (eventId >= target) {
          assert.equal(eventId, target);
          return room;
        }
      }
    },
  };
}

test('V4 native lecture reaches two independent students and a stage through real HTTP and SSE', { timeout: 30_000 }, async t => {
  const classroom = await roomTestServer(t);
  if (!classroom) return;
  const { origin } = classroom;
  const post = (path, data, cookie) => request(origin, path, { data, cookie });
  const create = async data => {
    const response = await post('/api/rooms', data);
    const { room } = await readJson(response, 201);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return { room, cookie, path: '/api/rooms/' + room.code };
  };
  const blank = await create({ demo: false });
  const spec = { course: 'Linear algebra', topic: 'Rank and the null space', pageCount: 8 };
  const authored = await readJson(await post(blank.path + '/author-deck', { spec }, blank.cookie));
  assert.equal(authored.source, 'local');
  assert.equal(authored.lectureScore.pages.length, 8);
  assert.ok(authored.harnessReceipt.stages.every(({ status }) => status === 'complete'));
  const { room: initial, cookie: teacher, path } = await create({ lecture: authored.lectureScore });
  const openStudent = async (cookie) => {
    const response = await post(path + '/session', { role: 'student' }, cookie);
    const session = await readJson(response);
    return { ...session, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie };
  };
  const [alice, bob] = await Promise.all([openStudent(), openStudent()]);
  assert.notEqual(alice.cookie, bob.cookie);
  assert.notEqual(alice.participantId, bob.participantId);
  const send = (client, type, payload = {}) => post(path + '/commands', { role: client.role, type, payload }, client.cookie);
  const studentA = { role: 'student', cookie: alice.cookie };
  const studentB = { role: 'student', cookie: bob.cookie };
  const teach = { role: 'teacher', cookie: teacher };
  const [stage, streamA, streamB] = await Promise.all([
    openEvents(t, origin, path, 'stage'),
    openEvents(t, origin, path, 'student', alice.cookie),
    openEvents(t, origin, path, 'student', bob.cookie),
  ]);
  const allView = version => Promise.all([stage.version(version), streamA.version(version), streamB.version(version)]);
  const initialViews = await allView(initial.version);
  assert.ok(initialViews.every(room => room.lecture.mode === 'slides'));

  await readJson(await send(studentA, 'join', { name: 'Alice Fixture' }));
  await readJson(await send(studentB, 'join', { name: 'Bob Fixture' }));
  let current = initial;
  const position = () => ({ expectedLectureIndex: current.lecture.index, expectedLectureTurn: current.lecture.turn });
  const teachingCommand = async (type, payload) => {
    ({ room: current } = await readJson(await send(teach, type, { ...position(), ...payload })));
    return allView(current.version);
  };
  const pages = authored.lectureScore.pages;
  const activity = pages.findIndex(page => typeof page.interaction?.correctOptionId === 'string');
  assert.ok(activity >= 0);
  const index = pages.slice(0, activity).reduce((count, page) => count + 1 + page.adopted.length, 0);
  await teachingCommand('lectureNavigate', { index });
  const frame = await readJson(await request(origin, `${path}/frame?index=${index}`));
  assert.ok(frame.blocks.length);
  const blindViews = await teachingCommand('lectureInteract');
  assert.ok(blindViews.every(room => room.lesson.correctOptionId === undefined));
  const validReply = { ...position(), expectedRound: 1, expectedLessonId: current.lessonId, optionId: current.lesson.options[0].id };
  await readJson(await send(studentA, 'respond', { ...validReply, reason: 'Impersonation fixture', participantId: bob.participantId }), 403);
  await readJson(await send({ role: 'stage' }, 'reveal', position()), 403);
  const first = await readJson(await send(studentA, 'respond', { ...validReply, reason: 'First private reason.' }));
  const second = await readJson(await send(studentB, 'respond', { ...validReply, reason: 'Second private reason.' }));
  assert.ok(first.room.version < second.room.version);
  const [blindStage, ownA, ownB] = await allView(second.room.version);
  assert.equal(blindStage.responseCount, 2);
  assert.deepEqual(blindStage.responses, []);
  assert.deepEqual(ownA.responses.map(response => response.reason), ['First private reason.']);
  assert.deepEqual(ownB.responses.map(response => response.reason), ['Second private reason.']);

  const [revealed] = await teachingCommand('reveal');
  assert.equal(revealed.lesson.correctOptionId, current.lesson.correctOptionId);
  assert.equal(revealed.responses.length, 2);
  assert.doesNotMatch(JSON.stringify(revealed.responses), /private reason/);
  for (const identity of [alice.participantId, bob.participantId, 'Alice Fixture', 'Bob Fixture']) {
    assert.ok(!JSON.stringify(revealed).includes(identity));
  }

  const rejoined = await openStudent(alice.cookie);
  assert.equal(rejoined.participantId, alice.participantId);
  streamA.close();
  const reconnected = await openEvents(t, origin, path, 'student', rejoined.cookie);
  const resumed = await reconnected.version(current.version);
  assert.equal(resumed.phase, 'reveal');
  assert.ok(resumed.responses.some(response => response.reason === 'First private reason.'));
});
