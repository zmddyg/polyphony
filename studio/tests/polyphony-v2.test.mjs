import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import {
  advanceChallenge, blackboxReading, castVote, newChallenge, normalizeRcParams, rcProbes, rcReading,
} from '../dist/core/challenge-lab.mjs';
import {
  analysisCandidates, createRoom, reduceRoom,
} from '../dist/core/engine.mjs';
import { localLecturePlan, validatePlanSuggestions } from '../dist/core/lecture-planner.mjs';
import { applyRoomCommand, createLectureRoom } from '../dist/core/lecture-room.mjs';
import { buildLectureScore, lectureOutline } from '../dist/core/lecture-score.mjs';
import { runComposition } from '../dist/core/lesson-composer.mjs';
import { createMaterialNotebook, makeMaterialVersionId } from '../dist/core/material-notebook.mjs';
import { exportScore, importScore } from '../dist/core/score-package.mjs';
import { buildSciencePacket } from '../dist/core/teaching-science.mjs';
import { projectRoom } from '../dist/core/transport.mjs';
import { composeLesson as composeWithProvider, requestStructuredCompletion } from '../lesson-provider.mjs';
import { createPublicRoomEncoder } from '../room-broadcast.mjs';
import { openRoomStore } from '../room-store.mjs';
import { createStaticHandler } from '../static-assets.mjs';

const STUDIO_DIR = fileURLToPath(new URL('..', import.meta.url));
const PNG_1X1_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function createMemoryIndexedDB() {
  const dbs = new Map();
  const keyStr = key => JSON.stringify(key);
  const extractKey = (value, keyPath) => Array.isArray(keyPath)
    ? keyPath.map(part => value[part])
    : value[keyPath];
  const makeRequest = work => {
    const req = {};
    queueMicrotask(() => {
      try {
        req.result = work();
        req.onsuccess?.();
      } catch (error) {
        req.error = error;
        req.onerror?.();
      }
    });
    return req;
  };
  return {
    open(name) {
      const req = {};
      queueMicrotask(() => {
        let stores = dbs.get(name);
        const created = !stores;
        if (!stores) {
          stores = new Map();
          dbs.set(name, stores);
        }
        const db = {
          createObjectStore(storeName, { keyPath }) {
            const store = { keyPath, records: new Map(), indexes: new Map() };
            stores.set(storeName, store);
            return {
              createIndex(indexName, indexPath) {
                store.indexes.set(indexName, indexPath);
              },
            };
          },
          transaction(storeNames) {
            const tx = {
              objectStore(storeName) {
                const store = stores.get(storeName);
                return {
                  get: key => makeRequest(() => structuredClone(store.records.get(keyStr(key)))),
                  getAll: () => makeRequest(() => [...store.records.values()].map(v => structuredClone(v))),
                  put: value => makeRequest(() => {
                    const key = extractKey(value, store.keyPath);
                    store.records.set(keyStr(key), structuredClone(value));
                    return key;
                  }),
                  add: value => makeRequest(() => {
                    const key = extractKey(value, store.keyPath);
                    const k = keyStr(key);
                    if (store.records.has(k)) throw new Error('ConstraintError');
                    store.records.set(k, structuredClone(value));
                    return key;
                  }),
                  delete: key => makeRequest(() => { store.records.delete(keyStr(key)); }),
                  index(indexName) {
                    const indexPath = store.indexes.get(indexName);
                    return {
                      getAll: match => makeRequest(() => [...store.records.values()]
                        .filter(item => keyStr(extractKey(item, indexPath)) === keyStr(match))
                        .map(v => structuredClone(v))),
                    };
                  },
                };
              },
              abort() {},
            };
            queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
            return tx;
          },
          close() {},
        };
        req.result = db;
        if (created) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

test('Polyphony 2.0 engine commands: spotlight, spotlightWinner, timer, removeParticipant, roundShift & SSE parity', () => {
  let room = createRoom({ code: 'V2TEST', demo: false, at: 1000 });
  const run = (type, payload = {}) => { room = reduceRoom(room, { type, payload: { at: 2000, ...payload } }); };
  const assertParity = snapshot => {
    const encode = createPublicRoomEncoder(snapshot);
    for (const [role, id] of [['stage', null], ['student', 's1'], ['student', 's2'], ['student', 'ghost']]) {
      assert.deepEqual(JSON.parse(encode(id)), JSON.parse(JSON.stringify(projectRoom(snapshot, role, id))));
    }
  };

  run('join', { participantId: 's1', name: '张同学' });
  run('join', { participantId: 's2', name: '李同学' });
  run('join', { participantId: 'ghost', name: '误触占位' });
  run('respond', { participantId: 's1', optionId: 'dark', reason: 'A 口相消后能量可能去了 B 口。' });
  run('respond', { participantId: 's2', optionId: 'half', reason: '两个出口应该均分入射光强。' });

  // Safe ghost participant removal
  run('removeParticipant', { participantId: 'ghost' });
  assert.equal(room.participants.length, 2);
  assert.throws(() => run('removeParticipant', { participantId: 's1' }), /已提交作答/);

  // Timer validation & activation
  assert.throws(() => run('timer', { seconds: 5 }), /15 至 1800/);
  run('timer', { seconds: 120, at: 5000 });
  assert.equal(room.timer.endsAt, 125_000);

  run('reveal');
  const [r1, r2] = room.responses;
  run('spotlight', { responseIds: [r1.id, r2.id] });
  assert.equal(room.spotlight.length, 2);

  // Privacy: public projection shows spotlight text without author names
  const stageView = projectRoom(room, 'stage', null);
  assert.equal(stageView.spotlight.length, 2);
  assert.equal(stageView.spotlight[0].text, 'A 口相消后能量可能去了 B 口。');
  assert.ok(!JSON.stringify(stageView.spotlight).includes('张同学'));
  assert.ok(!JSON.stringify(stageView.spotlight).includes('s1'));

  // Winner spotlight toggle
  run('draw', { random: 0 });
  assert.equal(projectRoom(room, 'stage', null).winnerDisplay, undefined);
  run('spotlightWinner', { visible: true });
  assert.equal(projectRoom(room, 'stage', null).winnerDisplay.name, '张同学');
  assertParity(room);

  // Branch & Round 2 conceptual shift
  run('branch', { branchId: 'energy' });
  run('revise');
  assert.deepEqual(room.spotlight, []);
  run('respond', { participantId: 's1', optionId: 'dark', reason: '确认能量从 B 口输出。' });
  run('respond', { participantId: 's2', optionId: 'dark', reason: 'B 口确实变亮了，改选 A 暗。' });
  run('reveal');
  const stageRound2 = projectRoom(room, 'stage', null);
  assert.deepEqual(stageRound2.roundShift, { paired: 2, changed: 1 });
  assertParity(room);

  run('timer', { seconds: 0 });
  assert.equal(room.timer, null);
});

test('Stratified 48-candidate sampling and verified AI viewpoint clusters', () => {
  let room = createRoom({ code: 'CLUST1', demo: false });
  const options = room.lesson.options.map(o => o.id);
  for (let i = 0; i < 60; i++) {
    const id = `stu-${i}`;
    room = reduceRoom(room, { type: 'join', payload: { participantId: id, name: `同学${i}` } });
    room = reduceRoom(room, {
      type: 'respond',
      payload: {
        participantId: id,
        optionId: options[i % options.length],
        reason: i % 10 === 0 ? '' : `这是第 ${i} 号同学基于选项 ${options[i % options.length]} 的推理说明。`,
      },
    });
  }
  room = reduceRoom(room, { type: 'reveal', payload: {} });
  const candidates = analysisCandidates(room, 48);
  assert.equal(candidates.length, 48);
  const byId = new Map(room.responses.map(r => [r.id, r]));
  const perOption = new Map();
  for (const c of candidates) {
    const optId = byId.get(c.id)?.optionId;
    perOption.set(optId, (perOption.get(optId) ?? 0) + 1);
  }
  for (const optId of options) assert.ok((perOption.get(optId) ?? 0) >= 12);

  const analyzed = reduceRoom(room, {
    type: 'analyze',
    payload: {
      analysis: {
        recommendedId: room.lesson.branches[0].id,
        headline: '全班在能量去向与相位差上出现明显分化',
        summary: '48 份理由集中在两类典型模型。',
        evidence: [{ id: candidates[0].id }, { id: candidates[1].id }],
        clusters: [
          { label: 'B 口能量守恒派', summary: '认为 A 暗时能量转入 B 口', evidenceIds: [candidates[0].id, 'hallucinated-id'] },
          { label: '等分衰减派', summary: '认为两臂光强固定平分', evidenceIds: [candidates[1].id] },
          { label: '无效聚类', summary: '全部引用均不存在', evidenceIds: ['nope-1'] },
        ],
      },
    },
  });
  const validated = analyzed.analysis;

  assert.equal(validated.source, 'provider');
  assert.equal(validated.clusters.length, 2);
  assert.deepEqual(validated.clusters[0].evidenceIds, [candidates[0].id]);
  assert.deepEqual(validated.clusters[1].evidenceIds, [candidates[1].id]);
});

test('Challenge Lab custom RC params, blackbox challenge, experimentArchive, and lecturePulse', () => {
  const customParams = normalizeRcParams({ resistanceKohm: 20, capacitanceNf: 50, initialV: 1, finalV: 9 });
  const probesList = rcProbes(customParams);
  assert.match(probesList[0].label, /2 ms/u);
  const rc = newChallenge('rc', { random: 0.1, params: customParams });
  assert.equal(rc.fault, 'r');
  assert.equal(rcReading('r', 'current', customParams), (9 - 1) / (2 * 20));
  assert.equal(rcReading('c', 'current', customParams), (9 - 1) / 20);

  // Blackbox challenge: distinguishing x = 3 vs indistinguishable x = 2
  let bb = newChallenge('blackbox', { random: 0.9 });
  assert.equal(bb.fault, 'double');
  bb = castVote(bb, 'stu-1', '3');
  assert.equal(bb.votes.length, 1);
  bb = advanceChallenge(bb, { action: 'probe', value: '3' });
  assert.equal(bb.step, 'diagnose');
  assert.equal(bb.reading, blackboxReading('double', 3));
  bb = advanceChallenge(bb, { action: 'diagnose', value: 'double' });
  assert.equal(bb.step, 'solved');
  assert.equal(bb.answer, 'double');
  assert.deepEqual(bb.compatible, ['double']);

  // Lecture room: explicit blackbox experiment + archive + student confusion pulse
  const score = buildLectureScore(
    { name: '科学方法讲义', versionId: 'sha256-' + 'a'.repeat(64), pages: [{ number: 1, title: '规则检验', text: '检验假设' }] },
    new Map(),
    { experimentsByPage: new Map([[1, { kind: 'blackbox' }]]) },
  );
  assert.equal(lectureOutline(score)[0].experiment.kind, 'blackbox');

  let room = createLectureRoom('LEC200', score);
  const lectureCmd = (type, payload = {}) => applyRoomCommand(room, {
    type,
    payload: { expectedLectureIndex: room.lecture.index, expectedLectureTurn: room.lecture.turn, ...payload },
  }, score);
  room = applyRoomCommand(room, { type: 'join', payload: { participantId: 's1', name: '小明' } });
  const turnBeforePulse = room.lecture.turn;
  room = applyRoomCommand(room, { type: 'lecturePulse', payload: { participantId: 's1', confused: true } });
  assert.equal(room.lecture.turn, turnBeforePulse);
  assert.equal(projectRoom(room, 'teacher', null).pulseCounts['1'], 1);
  assert.equal(projectRoom(room, 'student', 's1').myPulse, true);
  assert.equal(projectRoom(room, 'stage', null).myPulse, false);
  const encode = createPublicRoomEncoder(room);
  assert.deepEqual(JSON.parse(encode('s1')), JSON.parse(JSON.stringify(projectRoom(room, 'student', 's1'))));

  room = lectureCmd('lectureExperimentStart', { random: 0.1 });
  assert.equal(room.lecture.mode, 'experiment');
  assert.equal(room.experiment.kind, 'blackbox');
  room = lectureCmd('lectureExperimentAct', { action: 'probe', value: '3' });
  room = lectureCmd('lectureExperimentAct', { action: 'diagnose', value: 'square' });
  room = lectureCmd('lectureResume');
  assert.equal(room.experimentArchive.length, 1);
  assert.equal(room.experimentArchive[0].kind, 'blackbox');
  assert.equal(room.experimentArchive[0].choice, 'square');
  assert.equal(projectRoom(room, 'stage', null).experimentArchive, undefined);
});

test('Universal inquiry planner, whitespace quote tolerance, and per-item validation filtering', () => {
  const pages = [
    { number: 1, title: '封面', text: '课程导言' },
    { number: 2, title: '热力学悖论讨论', text: '为什么理想气体自由膨胀后温度不变，但熵却增加了？请比较不同观点的依据并讨论。' },
  ];
  const local = localLecturePlan(pages);
  assert.equal(local.suggestions.length, 1);
  assert.equal(local.suggestions[0].kind, 'inquiry');
  assert.equal(local.suggestions[0].pageNumber, 2);

  const validated = validatePlanSuggestions({
    suggestions: [
      { pageNumber: 2, kind: 'inquiry', quote: '为什么理想气体\n  自由膨胀后温度不变' },
      { pageNumber: 1, kind: 'mzi', quote: '根本不存在的引文' },
    ],
  }, pages);
  assert.equal(validated.length, 1);
  assert.equal(validated[0].kind, 'inquiry');
});

test('AI composer assistant-turn repair context, flexible 4-option/2-branch plan, persisted materials & <think> stripping', async () => {
  const recordedReplies = [];
  const makePlan = firstEvidence => JSON.stringify({
    subject: '力学 · 浮力',
    prompt: '同体积铁块和木块完全浸没在水中时，哪一个所受浮力更大？',
    options: ['两者一样大', '铁块受到的浮力更大', '木块受到的浮力更大', '取决于沉浮状态无法判断'],
    branches: [
      {
        title: '检验排开体积假设',
        description: '比较两者完全浸没时排开水的体积与观测一的关系。',
        revisionPrompt: '结合排开液体体积，重新判断两者浮力大小。',
        evidenceIds: [firstEvidence],
      },
      {
        title: '检验液体密度假设',
        description: '分析换用盐水后浮力变化与物体密度的区别。',
        revisionPrompt: '区分液体密度与物体密度后，你是否修改原判断？',
        evidenceIds: ['M3'],
      },
    ],
  });
  const composed = await runComposition(
    {
      topic: '浮力与排开液体体积',
      goal: '区分物体密度与排开液体体积对浮力的影响',
      material: '观测一：同体积铁块和木块浸没水中所受浮力相同。\n观测二：铁块沉底而木块漂浮。\n观测三：改变盐水密度后浮力增大。',
      reference: 'mzi',
    },
    {
      model: 'test-model',
      async requestPlan(_prepared, repair, lastReply) {
        recordedReplies.push({ repair, lastReply });
        return makePlan(repair ? 'M1' : 'M99');
      },
    },
  );
  assert.equal(composed.source, 'provider');
  assert.equal(recordedReplies.length, 2);
  assert.match(recordedReplies[1].lastReply, /M99/u);
  assert.equal(composed.lesson.options.length, 4);
  assert.equal(composed.lesson.branches.length, 2);
  assert.equal(composed.lesson.materials.length, 3);
  assert.deepEqual(composed.lesson.branches[0].evidenceIds, ['M1']);
  // ScorePackage v1 round-trip preserves persisted materials & evidenceIds
  const reloaded = importScore(exportScore(composed.lesson));
  assert.equal(reloaded.materials.length, 3);
  assert.deepEqual(reloaded.branches[0].evidenceIds, ['M1']);

  // Provider adapter strips <think>...</think> in text mode and omits temperature when unset
  const seenBodies = [];
  const fakeFetch = async (_url, init) => {
    seenBodies.push(JSON.parse(init.body));
    const content = '<think>先检查材料编号</think>\n下面是 JSON：\n```json\n{"ok":true,"n":1}\n```';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const stripped = await requestStructuredCompletion({
    baseUrl: 'https://llm.test/v1',
    model: 'r1-test',
    key: 'k',
    outputMode: 'text',
    fetchImpl: fakeFetch,
    messages: [{ role: 'user', content: 'Return JSON' }],
  });
  assert.deepEqual(JSON.parse(stripped), { ok: true, n: 1 });
  assert.equal(seenBodies[0].temperature, undefined);

  // Verify repair turn includes assistant message in composeWithProvider
  const repairBodies = [];
  let attempt = 0;
  const repairFetch = async (_url, init) => {
    repairBodies.push(JSON.parse(init.body));
    attempt++;
    const payload = {
      subject: '物理 · 探究',
      prompt: '根据两则观测材料，哪种解释最合理？',
      options: ['解释甲更符合材料', '解释乙更符合材料', '现有材料仍无法区分'],
      branches: [
        { title: '核对第一则材料', description: '检查材料一支持的推论。', revisionPrompt: '结合材料一重新判断。', evidenceIds: [attempt === 1 ? 'M99' : 'M1'] },
        { title: '对照第二则材料', description: '检查材料二是否排除另一解释。', revisionPrompt: '结合材料二再次作答。', evidenceIds: ['M2'] },
      ],
    };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const providerComposed = await composeWithProvider(
    { topic: '测试', goal: '目标', material: '材料一\n材料二', reference: 'mzi' },
    { baseUrl: 'https://llm.test/v1', model: 'test-model', key: 'k', outputMode: 'json_object', fetchImpl: repairFetch },
  );
  assert.equal(providerComposed.source, 'provider');
  assert.equal(repairBodies.length, 2);
  assert.ok(repairBodies[1].messages.some(m => m.role === 'assistant' && m.content.includes('M99')));
});

test('Science packets attach native MathML formulas while preserving plain-text formulas', () => {
  const anchor = { id: 'doc:1', title: '电磁讲义', page: 1 };
  const rc = buildSciencePacket({ model: 'rc', anchor, parameters: { resistanceKohm: 10, capacitanceNf: 100, initialV: 0, finalV: 5 } });
  const mzi = buildSciencePacket({ model: 'mzi', anchor, parameters: { phaseDeg: 180 } });
  assert.match(rc.slides[1].formulas[0], /^<math[^>]*>.*<mfrac>.*<\/math>$/u);
  assert.match(mzi.slides[1].formulas[0], /^<math[^>]*>.*<msup>.*cos.*<\/math>$/u);
});

test('Material notebook supports in-place preview upgrade, experiment kind, exportNotebook/importNotebook, and deleteVersion', async () => {
  const idb = createMemoryIndexedDB();
  const notebook = createMaterialNotebook({ indexedDB: idb });
  const versionId = await makeMaterialVersionId({ bytes: 'deck-bytes-v2' });
  await notebook.saveVersion({
    versionId, name: '光学.pptx', title: '光学', type: 'pptx',
    pages: [{ number: 1, title: '第一页', text: '干涉原理', images: [] }],
  });
  await notebook.savePageNote(versionId, 1, { id: 'annotation', kind: 'annotation', packet: { text: '先让学生猜' } });
  await notebook.savePageNote(versionId, 1, { id: 'experiment', kind: 'experiment', packet: { kind: 'blackbox', title: '数字黑箱' } }, { adopt: true });

  // Upgrade preview without losing notes/adoptions
  const upgraded = await notebook.updateDocumentPages(versionId, [
    { number: 1, title: '第一页', text: '干涉原理', preview: PNG_1X1_DATA },
  ]);
  assert.equal(upgraded.pages[0].preview, PNG_1X1_DATA);
  const adopted = await notebook.listAdopted(versionId);
  assert.equal(adopted.length, 1);
  assert.equal(adopted[0].kind, 'experiment');

  // Export -> Delete -> Import round-trip
  const bundle = await notebook.exportNotebook(versionId);
  assert.equal(bundle.format, 'polyphony.notebook');
  assert.equal(bundle.notes.length, 2);

  await notebook.deleteVersion(versionId);
  assert.equal(await notebook.getVersion(versionId), null);
  assert.deepEqual(await notebook.listVersions(), []);

  const restored = await notebook.importNotebook(bundle);
  assert.equal(restored.pageCount, 1);
  assert.equal(restored.noteCount, 2);
  const loaded = await notebook.getVersion(versionId);
  assert.equal(loaded.pages[0].preview, PNG_1X1_DATA);
  const loadedNotes = await notebook.getPageNotes(versionId, 1);
  assert.equal(loadedNotes.length, 2);
});

test('Room store supports native node:sqlite WAL persistence, delete, and TTL pruning alongside JSON mode', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'polyphony-store-v2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const dbPath = join(dir, 'rooms.db');
  const store1 = openRoomStore(dbPath);
  assert.equal(store1.backend, 'sqlite');
  const oldRoom = createRoom({ code: 'OLD001', at: 1000 });
  const freshRoom = createRoom({ code: 'NEW001', at: Date.now() });
  store1.save('OLD001', { owner: 't1', students: {}, room: oldRoom, updatedAt: 1000 });
  store1.save('NEW001', { owner: 't2', students: {}, room: freshRoom, updatedAt: Date.now() });
  assert.deepEqual(store1.codes().sort(), ['NEW001', 'OLD001']);
  store1.close();

  // Reopen from disk to confirm WAL durability
  const store2 = openRoomStore(dbPath);
  assert.equal(store2.get('OLD001').room.code, 'OLD001');
  assert.equal(store2.get('NEW001').room.code, 'NEW001');
  const pruned = [];
  const count = store2.prune(3600_000, code => pruned.push(code));
  assert.equal(count, 1);
  assert.deepEqual(pruned, ['OLD001']);
  assert.equal(store2.has('OLD001'), false);
  assert.equal(store2.has('NEW001'), true);
  assert.equal(store2.delete('NEW001'), true);
  assert.deepEqual(store2.codes(), []);
  store2.close();
});

test('Static assets handler supports Brotli when explicitly preferred while keeping gzip default parity', async () => {
  const serveStatic = createStaticHandler(join(STUDIO_DIR, 'dist'));
  const callStatic = async acceptEncoding => {
    const res = Object.assign(new EventEmitter(), {
      headers: new Map(),
      status: 0,
      payload: null,
      writeHead(status, headers) {
        this.status = status;
        for (const [k, v] of Object.entries(headers)) this.headers.set(k.toLowerCase(), v);
      },
      end(buf) { this.payload = buf; },
    });
    await serveStatic({ method: 'GET', headers: { 'accept-encoding': acceptEncoding } }, res, '/app.mjs');
    return res;
  };
  const brOnly = await callStatic('br');
  assert.equal(brOnly.status, 200);
  assert.equal(brOnly.headers.get('content-encoding'), 'br');
  assert.match(brotliDecompressSync(brOnly.payload).toString('utf8'), /openSession/u);

  const gzipAndBr = await callStatic('br, gzip');
  assert.equal(gzipAndBr.headers.get('content-encoding'), 'gzip');
  assert.match(gunzipSync(gzipAndBr.payload).toString('utf8'), /openSession/u);
});

async function startLiveServer(t, extraEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'polyphony-e2e-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: STUDIO_DIR,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      POLYPHONY_ROOM_FILE: join(dir, 'rooms.db'),
      POLYPHONY_STORAGE: 'sqlite',
      POLYPHONY_RATE_LIMIT: '0',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
  });
  let output = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server failed to start: ' + output)), 8000);
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      const match = /Polyphony\s+(http:\/\/[^\s]+)/u.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited early (${code}): ${output}`)); });
  });
  return { origin, child, dir };
}

test('Live HTTP/SSE server: externalized assets, teacher prefetch vs student 409, outline, remote pairing, analyze+join concurrency, Last-Event-ID, and passphrase', async t => {
  // Mock slow OpenAI-compatible server for concurrent analyze + student join test
  let llmRequests = 0;
  const mockLlm = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    llmRequests++;
    await new Promise(resolve => setTimeout(resolve, 150));
    const userMsg = body.messages.find(m => m.role === 'user')?.content ?? '';
    const parsedUser = JSON.parse(userMsg);
    const ids = (parsedUser.evidence ?? []).map(item => item.id);
    const payload = {
      recommendedId: 'energy',
      headline: '两类观点聚焦 B 口能量去向',
      summary: '全班正在检验能量守恒与衰减解释。',
      evidence: ids.slice(0, 2).map(id => ({ id })),
      clusters: ids.length ? [{ label: '能量守恒假设', summary: '认为光从另一端口出射', evidenceIds: [ids[0]] }] : [],
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
  });
  await new Promise(resolve => mockLlm.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => mockLlm.close(resolve)));
  const llmPort = mockLlm.address().port;

  const { origin } = await startLiveServer(t, {
    POLYPHONY_TEACHER_PASSPHRASE: 'teach-secret',
    POLYPHONY_AI_BASE_URL: `http://127.0.0.1:${llmPort}/v1`,
    POLYPHONY_AI_MODEL: 'mock-gpt',
    POLYPHONY_AI_KEY: 'sk-test',
  });

  // 1. Passphrase protection on POST /api/rooms
  const blocked = await fetch(`${origin}/api/rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: false }),
  });
  assert.equal(blocked.status, 403);

  // 2. Create lecture room with embedded base64 PNG -> externalized asset URL
  const lecture = buildLectureScore({
    name: '光学课件',
    pages: [
      { number: 1, title: '第一页', text: '首页内容', preview: PNG_1X1_DATA },
      { number: 2, title: '第二页', text: '剧透页内容' },
    ],
  });
  const created = await fetch(`${origin}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-polyphony-passphrase': 'teach-secret' },
    body: JSON.stringify({ lecture }),
  });
  assert.equal(created.status, 201);
  const teacherCookie = created.headers.get('set-cookie').split(';', 1)[0];
  const { room } = await created.json();
  const code = room.code;

  // 3. Teacher gets outline (200), student/unauth gets 403
  const outlineOk = await fetch(`${origin}/api/rooms/${code}/outline`, { headers: { cookie: teacherCookie } });
  assert.equal(outlineOk.status, 200);
  const outlineData = await outlineOk.json();
  assert.equal(outlineData.items.length, 2);
  const outlineDenied = await fetch(`${origin}/api/rooms/${code}/outline`);
  assert.equal(outlineDenied.status, 403);

  // 4. Externalized image asset & caching (200 immutable + 304 If-None-Match)
  const frame0Res = await fetch(`${origin}/api/rooms/${code}/frame?index=0`, { headers: { cookie: teacherCookie } });
  assert.equal(frame0Res.status, 200);
  const frame0 = await frame0Res.json();
  assert.match(frame0.preview, new RegExp(`^\\./api/rooms/${code}/assets/[0-9a-f]{64}\\.png$`));

  const assetUrl = new URL(frame0.preview, `${origin}/`).href;
  const assetRes = await fetch(assetUrl);
  assert.equal(assetRes.status, 200);
  assert.equal(assetRes.headers.get('content-type'), 'image/png');
  assert.match(assetRes.headers.get('cache-control'), /immutable/u);
  const etag = assetRes.headers.get('etag');
  assert.ok(etag);
  const notModified = await fetch(assetUrl, { headers: { 'if-none-match': etag } });
  assert.equal(notModified.status, 304);

  // 5. Teacher prefetch frame 1 succeeds (200), student/stage blocked with 409 spoiler lock!
  const teacherPrefetch = await fetch(`${origin}/api/rooms/${code}/frame?index=1`, { headers: { cookie: teacherCookie } });
  assert.equal(teacherPrefetch.status, 200);
  assert.equal((await teacherPrefetch.json()).title, '第二页');
  const stageSpoiler = await fetch(`${origin}/api/rooms/${code}/frame?index=1`);
  assert.equal(stageSpoiler.status, 409);

  // 6. Mobile remote pairing: one-time token -> second device claims teacher -> replay rejected
  const pairRes = await fetch(`${origin}/api/rooms/${code}/remote-pair`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: teacherCookie }, body: '{}',
  });
  assert.equal(pairRes.status, 200);
  const pair = await pairRes.json();
  assert.ok(pair.token && pair.expiresAt > Date.now());

  const claimRes = await fetch(`${origin}/api/rooms/${code}/claim-teacher`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: pair.token }),
  });
  assert.equal(claimRes.status, 200);
  const phoneCookie = claimRes.headers.get('set-cookie').split(';', 1)[0];

  // Reusing same token fails 403
  const replayClaim = await fetch(`${origin}/api/rooms/${code}/claim-teacher`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: pair.token }),
  });
  assert.equal(replayClaim.status, 403);

  // Phone can navigate slides with claimed teacher cookie
  const navRes = await fetch(`${origin}/api/rooms/${code}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: phoneCookie },
    body: JSON.stringify({ role: 'teacher', type: 'lectureNavigate', payload: { index: 1, expectedLectureIndex: 0, expectedLectureTurn: 0 } }),
  });
  assert.equal(navRes.status, 200);
  assert.equal((await navRes.json()).room.lecture.index, 1);

  // 7. Concurrent student join during slow AI analyze does NOT 409!
  const stdCreated = await fetch(`${origin}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-polyphony-passphrase': 'teach-secret' },
    body: JSON.stringify({ demo: false, lessonId: 'mzi' }),
  });
  const stdTeacher = stdCreated.headers.get('set-cookie').split(';', 1)[0];
  const stdCode = (await stdCreated.json()).room.code;

  const s1Sess = await fetch(`${origin}/api/rooms/${stdCode}/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'student' }),
  });
  const s1Cookie = s1Sess.headers.get('set-cookie').split(';', 1)[0];
  const { participantId: s1Id } = await s1Sess.json();
  await fetch(`${origin}/api/rooms/${stdCode}/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: s1Cookie },
    body: JSON.stringify({ role: 'student', type: 'join', payload: { participantId: s1Id, name: '先答同学' } }),
  });
  await fetch(`${origin}/api/rooms/${stdCode}/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: s1Cookie },
    body: JSON.stringify({ role: 'student', type: 'respond', payload: { participantId: s1Id, optionId: 'dark', reason: '另一出口应当亮起。' } }),
  });
  await fetch(`${origin}/api/rooms/${stdCode}/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: stdTeacher },
    body: JSON.stringify({ role: 'teacher', type: 'reveal', payload: {} }),
  });

  // Launch slow analyze and concurrently join a late student while LLM is in flight
  const s2Sess = await fetch(`${origin}/api/rooms/${stdCode}/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'student' }),
  });
  const s2Cookie = s2Sess.headers.get('set-cookie').split(';', 1)[0];
  const { participantId: s2Id } = await s2Sess.json();

  const analyzePromise = fetch(`${origin}/api/rooms/${stdCode}/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: stdTeacher },
    body: JSON.stringify({ role: 'teacher', type: 'analyze', payload: {} }),
  });
  await new Promise(resolve => setTimeout(resolve, 40));
  const lateJoinRes = await fetch(`${origin}/api/rooms/${stdCode}/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: s2Cookie },
    body: JSON.stringify({ role: 'student', type: 'join', payload: { participantId: s2Id, name: '中途加入同学' } }),
  });
  assert.equal(lateJoinRes.status, 200);
  const analyzeRes = await analyzePromise;
  assert.equal(analyzeRes.status, 200);
  const analyzedRoom = (await analyzeRes.json()).room;
  assert.equal(llmRequests, 1);
  assert.equal(analyzedRoom.analysis.source, 'provider');
  assert.equal(analyzedRoom.analysis.clusters.length, 1);
  assert.equal(analyzedRoom.participants.length, 2);

  // 8. SSE Last-Event-ID skips redundant snapshot for the already-received version
  const ac = new AbortController();
  const sseRes = await fetch(`${origin}/api/rooms/${stdCode}/events?role=stage`, {
    headers: { 'last-event-id': String(analyzedRoom.version) },
    signal: ac.signal,
  });
  assert.equal(sseRes.status, 200);
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let sseText = '';
  while (!sseText.includes(': synced')) {
    const { value, done } = await reader.read();
    if (done) break;
    sseText += decoder.decode(value, { stream: true });
  }
  assert.match(sseText, /: synced/u);
  assert.doesNotMatch(sseText, /^data:/mu);
  ac.abort();
});
