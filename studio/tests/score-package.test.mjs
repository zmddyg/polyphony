import assert from 'node:assert/strict';
import test from 'node:test';
import { getActivity } from '../dist/core/activities.mjs';
import { lessons } from '../dist/core/catalog.mjs';
import { createRoom, reduceRoom } from '../dist/core/engine.mjs';
import { exportScore, importScore } from '../dist/core/score-package.mjs';

test('built-in scores round-trip through the portable package', () => {
  for (const lesson of lessons) assert.deepEqual(importScore(exportScore(lesson)), lesson);
});

test('an edited score retains its material, slot IDs, and revision prompt', () => {
  const edited = structuredClone(lessons[0]);
  edited.id = 'custom-portable';
  edited.title = 'Compare the two classrooms';
  edited.prompt += '\n\nMaterial: room A measured 26 degrees and room B measured 30 degrees.';
  edited.branches[1].revisionPrompt = 'Explain how your thinking changed.';
  assert.deepEqual(importScore(exportScore(edited)), edited);
});

test('score import rejects unsupported versions and malformed records', () => {
  const portable = JSON.parse(exportScore(lessons[0]));
  assert.throws(() => importScore(JSON.stringify({ ...portable, version: 2 })), /课谱版本/);
  assert.throws(() => importScore(JSON.stringify({ ...portable, lesson: { ...portable.lesson, options: [] } })), /校验/);
  assert.throws(() => importScore('alert(1)'), /JSON/);
  assert.throws(() => importScore(' '.repeat(128001)), /大小/);
});

test('legacy optical scores retain their activity when edited and opened in a new room', () => {
  const original = lessons.find(lesson => lesson.id === 'mzi');
  const legacy = JSON.parse(exportScore(original));
  delete legacy.lesson.activityId;
  const draft = importScore(JSON.stringify(legacy));
  const lesson = { ...draft, id: 'custom-optics', title: 'Edited optics score' };
  const room = reduceRoom(createRoom(), { type: 'loadLesson', payload: { lesson } });
  assert.equal(getActivity(room.lesson).id, getActivity(original).id);
  assert.deepEqual(room.lesson.options.map(({ id }) => id), original.options.map(({ id }) => id));
  assert.deepEqual(room.lesson.branches.map(({ id }) => id), original.branches.map(({ id }) => id));
  legacy.lesson.activityId = 'unknown-activity';
  assert.throws(() => importScore(JSON.stringify(legacy)), /校验/);
});
