import assert from 'node:assert/strict';
import test from 'node:test';
import { getActivity } from '../dist/core/activities.mjs';
import { getLesson } from '../dist/core/catalog.mjs';
import { analyze, createRoom, reduceRoom } from '../dist/core/engine.mjs';
import { openSession, projectRoom } from '../dist/core/transport.mjs';

const apply = (room, type, payload) => reduceRoom(room, { type, payload });
const join = (room, id) => apply(room, 'join', { participantId: id, name: id });
const respond = (room, id, reason) => apply(room, 'respond', {
  participantId: id, optionId: 'dark', reason,
});

function mockBrowser(t, properties) {
  for (const [name, value] of Object.entries(properties)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
}

test('an answer submitted by an old round cannot become a revision', () => {
  let room = join(createRoom({lessonId:'mzi'}), 'student');
  room = respond(room, 'student', 'A 口变暗');
  room = apply(apply(room, 'reveal'), 'branch', { branchId: 'energy' });
  room = apply(room, 'revise');
  assert.throws(() => apply(room, 'respond', {
    participantId: 'student', optionId: 'dark', reason: '迟到的初答', expectedRound: 1, expectedLessonId: 'mzi',
  }), /轮次/);
  assert.equal(room.responses.length, 1);
});

test('draw uses accepted submitters once each across rounds and excludes join-only members', () => {
  let room = createRoom({ lessonId:'mzi', demo: true });
  room = join(join(join(room, 'one'), 'two'), 'observer');
  room = respond(respond(room, 'one', 'B 口会亮。'), 'two', 'B 口也不会亮。');
  room = apply(room, 'reveal');
  room = apply(room, 'branch', { branchId: 'energy' });
  room = apply(room, 'revise');
  room = respond(room, 'one', '我重新检查了两个出口的光强。');
  room = apply(apply(room, 'reveal'), 'close');

  const first = apply(room, 'draw', { random: 0.49 });
  const second = apply(first, 'draw', { random: 0.5 });
  assert.deepEqual(first.winner, { id: 'one', name: 'one', eligibleCount: 2, simulated: false });
  assert.equal(second.winner.id, 'two');
  assert.deepEqual(second.events.at(-1).detail, {
    participantId: 'two', simulated: false, eligibleCount: 2, eligibleSource: 'live',
    eligibleIds: ['one', 'two'],
  });
});

test('mutually exclusive live and simulated draw pools are labeled', () => {
  const noSubmissions = join(createRoom({lessonId:'mzi'}), 'observer');
  assert.throws(() => apply(noSubmissions, 'draw'));
  const rehearsal = join(createRoom({ lessonId:'mzi', demo: true }), 'observer');
  const drawn = apply(rehearsal, 'draw', { random: 0 });
  assert.equal(drawn.winner.simulated, true);
  assert.equal(drawn.winner.eligibleCount, rehearsal.responses.length);
  assert.equal(drawn.events.at(-1).detail.eligibleSource, 'simulated');
  assert.ok(drawn.events.at(-1).detail.eligibleIds.every((id) => id.startsWith('demo-')));
});

test('mixed evidence uses original live reasons and retains the decision across blind revision', () => {
  let room = createRoom({ lessonId:'mzi', demo: true });
  room = join(join(room, 'one'), 'two');
  room = respond(respond(room, 'one', 'B 口会亮。'), 'two', 'B 口也不会亮。');
  assert.throws(() => apply(room, 'analyze'));
  room = apply(apply(room, 'reveal'), 'analyze');
  assert.equal(room.analysis.evidence.length, 2);
  assert.ok(room.analysis.evidence.every(({ simulated }) => simulated === false));
  assert.ok(room.analysis.evidence.some(({ text }) => text.includes('B 口也不会亮。')));
  assert.throws(() => apply(room, 'analyze', {
    analysis: { evidence: [{ id: room.analysis.evidence[0].id, text: 'Edited quote' }] },
  }));
  room = apply(room, 'branch', { branchId: 'energy' });
  const evidenceIds = room.decision.evidenceIds;
  room = apply(room, 'revise');
  assert.equal(room.analysis, null);
  assert.deepEqual(analyze(room).evidence, []);
  assert.deepEqual(room.decision.evidenceIds, evidenceIds);
  assert.ok(evidenceIds.every((id) => room.responses.some((response) => response.id === id)));
  assert.match(room.revisionPrompt, /读数/u);
});

test('optics contrast requires two affirmative excerpts and does not classify negated loss as loss', () => {
  let room = join(join(createRoom({lessonId:'mzi'}), 'one'), 'two');
  room = respond(respond(room, 'one', '能量没有消失，流向 B 端。'), 'two', '知道 A 口暗，但不能确定是不是两个出口都暗。');
  let checked = analyze(room);
  assert.equal(checked.contrastEvidenceIds, undefined);
  assert.doesNotMatch(checked.headline, /对 B 口的预测不同/u);
  room = respond(room, 'two', '两个出口都没有光，光能消失了。');
  checked = analyze(room);
  assert.match(checked.headline, /对 B 口的预测不同/u);
  assert.deepEqual(checked.evidence.slice(0, 2).map(({ id }) => id), checked.contrastEvidenceIds);
  room = apply(room, 'reveal');
  room = apply(room, 'analyze', { analysis: { evidence: [{ id: checked.contrastEvidenceIds[1] }] } });
  assert.deepEqual(room.analysis.evidence.map(({ id }) => id), checked.contrastEvidenceIds);
});

test('optics rehearsal contains twelve labeled predictions over nine phases', () => {
  const room = createRoom({ lessonId:'mzi', demo: true });
  const samples = room.responses.map(({ sample }) => sample);
  assert.equal(new Set(samples.map(({ phaseIndex }) => phaseIndex)).size, 9);
  assert.ok(room.responses.every(({ simulated }) => simulated));
  assert.ok(samples.find(({ phaseIndex }) => phaseIndex === 4).power > 0 && samples.find(({ phaseIndex }) => phaseIndex === 4).power < 0.03);
  assert.equal(room.responses.length, 12);
  assert.match(analyze(room).headline, /物理机制却相反/u);
});

test('renamed imported optics lessons retain only their registered activity behavior', () => {
  const imported = { ...getLesson('mzi'), id: 'edited-light', title: '重新设计的光学课' };
  let room = apply(createRoom({lessonId:'mzi'}), 'loadLesson', { lesson: imported });
  assert.equal(room.lessonId, 'edited-light');
  assert.equal(room.lesson.activityId, 'mzi-phase@1');
  room = join(join(room, 'one'), 'two');
  room = apply(room, 'respond', {
    participantId: 'one', optionId: 'dark', reason: 'B 口会亮。',
    sample: { phaseIndex: 4, power: 0.1 },
  });
  assert.deepEqual(room.responses[0].sample, { phaseIndex: 4, power: 0.1 });
  room = respond(room, 'two', '两个出口都没有光。');
  assert.match(analyze(room).headline, /对 B 口的预测不同/u);
  assert.equal(apply(room, 'demoFill').responses.filter(r=>r.simulated).length,12);

  const changedIds = { ...imported, branches: [{ ...imported.branches[0], id: 'my-branch' }] };
  room = apply(room, 'loadLesson', { lesson: changedIds });
  room = respond(respond(room, 'one', 'B 口会亮。'), 'two', '两个出口都没有光。');
  assert.equal(analyze(room).contrastEvidenceIds, undefined);
  assert.equal(analyze(room).recommendedId, 'my-branch');

  assert.equal(getActivity({ id: 'mzi' }).id, 'mzi-phase@1');
  const oldCustom = { ...imported, activityId: undefined };
  room = apply(room, 'loadLesson', { lesson: oldCustom });
  assert.equal(room.lesson.activityId, 'choice@1');
  assert.throws(() => apply(room, 'respond', {
    participantId: 'one', optionId: 'dark', reason: 'B 口会亮。',
    sample: { phaseIndex: 4, power: 0.1 },
  }), /读数无效/u);
  assert.equal(getActivity({ ...imported, activityId: 'mzi-phase@2' }), undefined);
  assert.throws(() => apply(room, 'loadLesson', {
    lesson: { ...imported, activityId: 'mzi-phase@2' },
  }), /不支持/u);
});

test('local notifications converge on the saved version and skip duplicate reads and writes', async t => {
  const key = 'polyphony.v1.SHOW26';
  let room = createRoom({lessonId:'mzi'});
  const stored = new Map([[key, JSON.stringify(room)], [`${key}.teacher`, '1']]);
  const getItem = t.mock.fn(name => stored.get(name) ?? null);
  const setItem = t.mock.fn((name, value) => stored.set(name, value));
  let storageListener, channel;
  mockBrowser(t, {
    location: { protocol: 'file:' },
    localStorage: { getItem, setItem },
    navigator: { locks: { request: (name, callback) => { assert.equal(name, key); return callback(); } } },
    BroadcastChannel: class {
      constructor() { channel = this; }
      close() { this.closed = true; }
      postMessage = t.mock.fn();
    },
    addEventListener: (type, listener) => { if (type === 'storage') storageListener = listener; },
    removeEventListener: (type, listener) => { if (type === 'storage' && storageListener === listener) storageListener = undefined; },
  });
  const session = await openSession({ role: 'teacher', room: 'SHOW26' });
  try {
    const versions = [];
    session.subscribe(next => versions.push(next.version));
    getItem.mock.resetCalls();

    room = join(room, 'one');
    const first = JSON.stringify(room);
    stored.set(key, first);
    storageListener({ key, newValue: first });
    channel.onmessage({ data: room.version });

    room = join(room, 'two');
    const second = JSON.stringify(room);
    stored.set(key, second);
    channel.onmessage({ data: room.version });
    storageListener({ key, newValue: second });
    assert.equal(getItem.mock.callCount(), 2);
    assert.deepEqual(versions, [2, 3]);

    room = apply(room, 'reveal');
    stored.set(key, JSON.stringify(room));
    storageListener({ key, newValue: first });
    assert.equal(session.state.version, room.version);
    assert.deepEqual(versions, [2, 3, 4]);
    await session.command('reveal');
    assert.equal(setItem.mock.callCount(), 0);
    assert.equal(channel.postMessage.mock.callCount(), 0);
    assert.deepEqual(versions, [2, 3, 4]);
  } finally {
    session.close();
  }
  assert.equal(storageListener, undefined);
  assert.equal(channel.closed, true);
});

test('the stream skips already applied IDs and accepts events without an ID', async t => {
  const room = createRoom({lessonId:'mzi'});
  const projected = state => projectRoom(state, 'stage', null);
  let stream;
  mockBrowser(t, {
    location: new URL('https://classroom.invalid/?view=stage&room=SHOW26'),
    sessionStorage: { setItem() {} },
    EventSource: class {
      constructor() { stream = this; }
      close() {}
    },
  });
  t.mock.method(globalThis, 'fetch', async url => Response.json(url.pathname.endsWith('/status')
    ? { polyphony: true }
    : { room: projected(room), participantId: null }));
  const session = await openSession({ role: 'stage', room: 'SHOW26' });
  t.after(() => session.close());
  const parse = t.mock.method(JSON, 'parse');
  const next = join(room, 'one');
  const later = join(next, 'two');
  stream.onmessage({ lastEventId: String(room.version), data: JSON.stringify(projected(room)) });
  stream.onmessage({ lastEventId: String(next.version), data: JSON.stringify(projected(next)) });
  stream.onmessage({ lastEventId: String(next.version), data: JSON.stringify(projected(next)) });
  stream.onmessage({ data: JSON.stringify(projected(later)) });
  assert.equal(parse.mock.callCount(), 2);
  assert.equal(session.state.version, later.version);
});
