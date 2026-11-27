import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, reduceRoom, analyze } from '../dist/core/engine.mjs';
import { lessons, getLesson } from '../dist/core/catalog.mjs';
import { getActivity } from '../dist/core/activities.mjs';
import { exportScore, importScore } from '../dist/core/score-package.mjs';
const send = (state, type, payload = {}) => reduceRoom(state, { type, payload });
test('legacy and universal modules pair twelve simulated students across two rounds', () => {
  assert.ok(lessons.length>=7);
  for (const lesson of lessons) {
    let state = createRoom({ lessonId: lesson.id, demo: true });
    assert.equal(state.participants.length, 12); assert.equal(state.responses.length, 12);
    assert.strictEqual(send(state, 'demoFill'), state);
    const first = structuredClone(state.responses);
    const correct = state.responses.filter(r => r.optionId === (lesson.correctOptionId||lesson.options[0].id));
    if (lesson.id === 'mzi') { assert.equal(correct.length, 8); assert.equal(correct.filter(r => /二极管|半波|削波|能量凭空/.test(r.reason)).length, 4); }
    const diagnosis = analyze(state);
    assert.equal(diagnosis.contrastPair.length, 2);
    assert.deepEqual(diagnosis.contrastPair.map(p => p.tone), ['alert', 'insight']);
    assert.ok(diagnosis.contrastPair.every(p => first.some(r => r.reason === p.quote)));
    state = send(send(state, 'reveal'), 'branch', { branchId: lesson.branches[0].id });
    state = send(send(state, 'revise'), 'demoFill');
    const second = state.responses.filter(r => r.round === 2);
    assert.equal(second.length, 12); assert.equal(second.filter(r => r.optionId === (lesson.correctOptionId||lesson.options[0].id)).length, 11);
    assert.deepEqual(state.responses.filter(r => r.round === 1), first);
    assert.deepEqual(second.map(r => r.participantId), first.map(r => r.participantId));
    assert.strictEqual(send(state, 'demoFill'), state);
    const changed = { ...state, responses: state.responses.map(r => r === second[0] ? { ...r, reason:'尚未纠正的模拟解释',optionId:lesson.options[1].id } : r) };
    const refreshed = send(changed,'demoFill');
    assert.equal(refreshed.responses.filter(r => r.round === 2 && r.optionId === (lesson.correctOptionId||lesson.options[0].id)).length,11);
    assert.equal(send(send(state, 'reveal'), 'close').phase, 'closed');
    const roundtrip = importScore(exportScore(lesson));
    assert.deepEqual(roundtrip.quickReasons, lesson.quickReasons); assert.deepEqual(roundtrip.takeaway, lesson.takeaway);
  }
});

test('an old saved MZI question cannot receive nonexistent new option IDs', () => {
  const state = createRoom({lessonId:'mzi'});
  const old = { ...state, lesson: { ...state.lesson, options: [{id:'dark',label:'A'},{id:'half',label:'B'},{id:'a',label:'C'}] } };
  assert.throws(() => send(old,'demoFill'), /旧版题目/);
  assert.deepEqual(analyze(old).evidence,[]);
});
test('generic teacher-authored questions expose only actual opposing anonymous quotes', () => {
  const base = getLesson('rc-fault');
  let state = send(createRoom({lessonId:'mzi'}), 'loadLesson', { lesson: { ...base, id: 'custom-front-end', activityId: 'choice@1' } });
  for (const [id, optionId, reason] of [['one','current','先测独立约束。'],['two','bode','我想再看扫频。']]) {
    state = send(state, 'join', { participantId: id, name: '真实姓名' + id });
    state = send(state, 'respond', { participantId: id, optionId, reason });
  }
  const pair = analyze(state).contrastPair;
  assert.equal(pair.length, 2); assert.deepEqual(pair.map(r => r.quote), ['先测独立约束。','我想再看扫频。']);
  assert.ok(!JSON.stringify(pair).includes('真实姓名'));
  for (const activityId of ['source-critique@1', 'number-blackbox@1']) {
    assert.equal(getActivity({ activityId }).id, 'choice@1');
    assert.equal(importScore(exportScore({ ...base, id: 'old-archive', activityId })).activityId, 'choice@1');
  }
});
