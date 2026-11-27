import assert from 'node:assert/strict';
import test from 'node:test';
import { createPageModule } from '../dist/core/deck-harness.mjs';
import { buildLectureScore } from '../dist/core/lecture-score.mjs';
import { request, roomTestServer } from './support/integration.mjs';

async function readJson(response, status = 200) {
  const result = await response.json();
  assert.equal(response.status, status, result.error);
  return result;
}

async function openEvents(t, origin, path, role, cookie, seat) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
  const query = new URLSearchParams({ role, ...(seat && { seat }) });
  const response = await request(origin, `${path}/events?${query}`, { cookie, signal });
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

test('student seats share a cookie jar but isolate SSE identities, answers and private lecture fields', { timeout: 30_000 }, async t => {
  const classroom = await roomTestServer(t);
  if (!classroom) return;
  const { origin } = classroom;
  const post = (path, data, cookie) => request(origin, path, { data, cookie });
  const note = '私下提醒教师先等十秒';
  const page = { number: 1, title: '比较两种测量', text: '核对各自证据与约束。', speakerNotes: note };
  const interaction = createPageModule(page, 'evidence-weighing@1');
  const lecture = buildLectureScore({ name: '课堂投影测试', pages: [page] }, new Map(), { interactionsByPage: new Map([[1, interaction]]) });
  const created = await post('/api/rooms', { lecture });
  let { room } = await readJson(created, 201);
  const path = '/api/rooms/' + room.code;
  const teacher = created.headers.get('set-cookie').split(';')[0];
  assert.equal(room.lecture.speakerNotes, note);
  assert.doesNotMatch(JSON.stringify(await readJson(await request(origin, `${path}/frame?index=0`))), /私下提醒教师|speakerNotes/);
  const openSeat = async (seat, name) => {
    const session = await post(path + '/session', { role: 'student', seat });
    const header = session.headers.get('set-cookie');
    assert.ok(header.startsWith(name + '='));
    assert.match(header, /; HttpOnly(?:;|$)/);
    const { participantId } = await readJson(session);
    return { participantId, cookie: header.split(';')[0] };
  };
  const a = await openSeat('a', 'polyphony_student_a');
  const b = await openSeat('b', 'polyphony_student_b');
  const ordinary = await openSeat(undefined, 'polyphony_student');
  assert.equal(new Set([a, b, ordinary].map(seat => seat.participantId)).size, 3);
  const jar = [a.cookie, b.cookie, ordinary.cookie].join('; ');
  assert.equal((await readJson(await post(path + '/session', { role: 'student', seat: 'a' }, jar))).participantId, a.participantId);
  assert.equal((await readJson(await post(path + '/session', { role: 'student', seat: 'b' }, jar))).participantId, b.participantId);
  assert.equal((await readJson(await post(path + '/session', { role: 'student' }, jar))).participantId, ordinary.participantId);
  await readJson(await post(path + '/session', { role: 'student', seat: 'a\n' }, jar), 400);
  await readJson(await post(path + '/commands', { role: 'student', seat: 'A', type: 'join' }, jar), 400);
  await readJson(await request(origin, path + '/events?role=student&seat=b%20', { cookie: jar }), 400);
  await readJson(await post(path + '/commands', { role: 'student', seat: 'b', type: 'join', payload: { name: '错误会话' } }, a.cookie.replace('student_a=', 'student_b=')), 403);

  const streams = await Promise.all([
    openEvents(t, origin, path, 'stage'), openEvents(t, origin, path, 'student', jar, 'a'),
    openEvents(t, origin, path, 'student', jar, 'b'), openEvents(t, origin, path, 'teacher', teacher),
  ]);
  async function readViews(version) {
    const [stage, alice, bob, owner] = await Promise.all(streams.map(stream => stream.version(version)));
    for (const projected of [stage, alice, bob]) {
      assert.doesNotMatch(JSON.stringify(projected), /私下提醒教师|speakerNotes|"muddy":/);
    }
    assert.equal(owner.lecture.speakerNotes, note);
    for (const student of [alice, bob]) assert.deepEqual(student.lecture, stage.lecture);
    return { stage, alice, bob, owner };
  }
  await readViews(room.version);
  const send = (role, type, payload = {}, seat, cookie = role === 'teacher' ? teacher : jar) => post(path + '/commands', {
    role, seat, type, payload: { expectedLectureIndex: room.lecture.index, expectedLectureTurn: room.lecture.turn, ...payload },
  }, cookie);
  async function apply(role, type, payload, seat) {
    const before = room.version;
    const result = await readJson(await send(role, type, payload, seat));
    assert.equal(result.room.version, before + 1);
    const views = await readViews(result.room.version);
    room = views.owner;
    return views;
  }

  const original = room;
  const pulse = await apply('student', 'slidePulse', { active: true }, 'a');
  assert.equal(pulse.stage.lecture.muddyCount, 1);
  assert.equal(pulse.stage.lecture.filmstrip[0].muddyCount, 1);
  assert.deepEqual(pulse.owner.participants, []);
  const timed = await apply('teacher', 'setTimer', { durationSec: 60 });
  assert.equal(timed.bob.timer.durationSec, 60);
  assert.equal(timed.owner.lecture.turn, original.lecture.turn);
  assert.deepEqual(timed.owner.events, original.events);
  const waiting = await apply('teacher', 'lectureInteract');
  for (const state of [waiting.stage, waiting.alice, waiting.bob]) assert.equal(state.lesson.moduleConfig.aiPeer, undefined);
  assert.ok(waiting.owner.lesson.moduleConfig.aiPeer);
  await apply('student', 'join', { name: '匿名测试甲' }, 'a');
  await apply('student', 'join', { name: '匿名测试乙' }, 'b');
  const [left, right] = room.lesson.options;
  await readJson(await send('student', 'respond', { optionId: left.id, participantId: b.participantId }, 'a'), 403);
  const answerA = '匿名测试甲认为还需要独立证据。';
  const answerB = '匿名测试乙认为已有充分证据。';
  await apply('student', 'respond', { optionId: left.id, reason: answerA }, 'a');
  const blind = await apply('student', 'respond', { optionId: right.id, reason: answerB }, 'b');
  assert.deepEqual(blind.stage.responses, []);
  assert.deepEqual(blind.alice.responses.map(r => r.reason), [answerA]);
  assert.deepEqual(blind.bob.responses.map(r => r.reason), [answerB]);
  const revealed = await apply('teacher', 'reveal');
  assert.equal(revealed.owner.analysis, null);
  const analyzed = await apply('teacher', 'analyze', { fastLocal: true });
  assert.equal(analyzed.stage.responses.length, 2);
  assert.ok(analyzed.stage.responses.every(response => !Object.hasOwn(response, 'reason')));
  assert.match(analyzed.stage.analysis.optionExcerpts[left.id][0], /〔匿名〕/);
  assert.doesNotMatch(JSON.stringify(analyzed.stage), /匿名测试甲|匿名测试乙|\bp-[\da-f]+\b/);
  assert.deepEqual(analyzed.alice.analysis, analyzed.stage.analysis);
  assert.deepEqual(analyzed.bob.analysis, analyzed.stage.analysis);
});
