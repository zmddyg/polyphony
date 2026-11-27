import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createRoom, reduceRoom } from '../dist/core/engine.mjs';
import {
  createMaterialNotebook, makeMaterialVersionId, materialClassroomReasons, materialClassroomReference,
} from '../dist/core/material-notebook.mjs';

test('source versions hash the original bytes across filenames, slices, and browsers without Web Crypto', async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 2000]) {
    const sample = Uint8Array.from({ length: size + 4 }, (_, i) => i % 211).subarray(2, size + 2);
    const expected = 'sha256-' + createHash('sha256').update(sample).digest('hex');
    assert.equal(await makeMaterialVersionId({ name: '讲义.pdf', bytes: sample }, { subtle: null }), expected);
    assert.equal(await makeMaterialVersionId({ name: '换个文件名.pdf', bytes: new Blob([sample]) }), expected);
  }
  const oldVersion = await makeMaterialVersionId({ name: '讲义.pptx', bytes: '原来的英文 slide 1' });
  const newVersion = await makeMaterialVersionId({ name: '讲义.pptx', bytes: '新的英文 slide 1' });
  assert.notEqual(oldVersion, newVersion);
});

test('unavailable browser storage reports a failure instead of reporting empty records', async () => {
  const notebook = createMaterialNotebook({ indexedDB: null });
  await assert.rejects(notebook.listVersions(), /无法保存/u);
  await assert.rejects(notebook.listVersions(), /无法保存/u);
});

test('a bound ended classroom contributes only real reason text with matching replay events', async () => {
  const versionId = await makeMaterialVersionId({ bytes: '课堂讲义' });
  const pageNumber = 1;
  const command = (room, type, payload = {}) => reduceRoom(room, { type, payload: { ...payload, at: room.version + 10 } });
  let room = createRoom({ lessonId:'mzi', code: 'ROOM01', demo: true, at: 100 });
  room = command(room, 'join', { participantId: 'student-one', name: '姓名' });
  room = command(room, 'join', { participantId: 'student-two', name: '姓名' });
  room = command(room, 'respond', { participantId: 'student-one', optionId: 'dark', reason: '需要同时测两个输出。' });
  room = command(room, 'respond', { participantId: 'student-one', optionId: 'dark', reason: '两端读数应该一起比较。' });
  room = command(room, 'respond', { participantId: 'student-two', optionId: 'dark' });
  const lastUpdated = room.events.findLast(item => item.detail?.responseId === room.responses.find(item => item.participantId === 'student-one').id);
  assert.equal(materialClassroomReference(room, versionId, pageNumber), null);
  room = command(command(room, 'reveal'), 'close');
  const binding = { ...materialClassroomReference(room, versionId, pageNumber), versionId, pageNumber };
  assert.deepEqual(materialClassroomReasons(room, null), []);
  const reasons = materialClassroomReasons(room, binding);
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].reason, '两端读数应该一起比较。');
  assert.equal(reasons[0].source.eventId, lastUpdated.id);
  assert.equal(reasons[0].source.responseId, lastUpdated.detail.responseId);
  assert.ok(!JSON.stringify(reasons).includes('student-one'));
  assert.deepEqual(materialClassroomReasons({ ...room, code: 'ROOM02' }, binding), []);
  const reusedCode = { ...room, events: [{ ...room.events[0], at: 200 }, ...room.events.slice(1)] };
  assert.deepEqual(materialClassroomReasons(reusedCode, binding), []);
  const sameLessonAgain = command(command(room, 'switchLesson', { lessonId: 'rc-fault' }), 'switchLesson', { lessonId: 'mzi' });
  assert.deepEqual(materialClassroomReasons({ ...sameLessonAgain, phase: 'closed' }, binding), []);
});

test('lecture evidence is identified by source version, original page, room, and student response', async () => {
  const versionId = await makeMaterialVersionId({ bytes: '课件初版' });
  const newVersionId = await makeMaterialVersionId({ bytes: '第二版调换了第 2 页' });
  const lesson = { id: 'activity-two', title: '第二页互动', options: [{ id: 'a', label: '选项 A' }] };
  const pageNumber = 2;
  const response = {
    id: 'response-3', optionId: 'a', round: 1, reason: '这组观测结果支持我的判断。',
    simulated: false, lectureVersionId: versionId, lecturePageNumber: pageNumber,
  };
  const respondEvent = {
    id: 'event-3', type: 'respond', at: 300, detail: {
      responseId: response.id, round: 1, lectureVersionId: versionId, lecturePageNumber: pageNumber,
    },
  };
  const room = {
    code: 'ROOM01', lesson, lessonId: lesson.id, phase: 'reveal', responses: [response],
    lecture: { sourceVersion: versionId, mode: 'activity', pageNumber },
    events: [
      { id: 'event-1', type: 'room', at: 100 },
      { id: 'event-2', type: 'lectureInteract', at: 200, detail: { pageNumber, lessonId: lesson.id } },
      respondEvent,
    ],
  };
  const binding = { ...materialClassroomReference(room, versionId, pageNumber), versionId, pageNumber };
  assert.equal(materialClassroomReference(room, newVersionId, pageNumber), null);
  assert.equal(materialClassroomReference(room, versionId, 1), null);
  assert.equal(materialClassroomReasons(room, binding)[0].source.eventId, respondEvent.id);
  const archived = {
    ...room, responses: [], lecture: { ...room.lecture, mode: 'ended', pageNumber: 3 }, lectureArchive: [{
      versionId, pageNumber, lesson, lessonId: lesson.id, phase: 'collect',
      responses: [response, { ...response, id: 'no-replay-event' }],
    }],
  };
  assert.deepEqual(materialClassroomReasons(archived, binding), materialClassroomReasons(room, binding));
  const changedEvent = { ...respondEvent, detail: { ...respondEvent.detail, lecturePageNumber: 3 } };
  assert.deepEqual(materialClassroomReasons({ ...room, events: [...room.events.slice(0, -1), changedEvent] }, binding), []);
  const wrongPage = { ...room, responses: [{ ...response, lecturePageNumber: 3 }] };
  assert.deepEqual(materialClassroomReasons(wrongPage, binding), []);
  const wrongVersion = { ...room, responses: [{ ...response, lectureVersionId: newVersionId }] };
  assert.deepEqual(materialClassroomReasons(wrongVersion, binding), []);
  const reopened = {
    ...room, events: [...room.events, { id: 'event-8', type: 'lectureInteract', at: 800, detail: { pageNumber, lessonId: lesson.id } }],
  };
  assert.deepEqual(materialClassroomReasons(reopened, binding), materialClassroomReasons(room, binding));
});
