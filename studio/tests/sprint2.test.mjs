import assert from 'node:assert/strict';
import test from 'node:test';
import { COURSE_BLUEPRINT_SCHEMA, planCourseBlueprint } from '../dist/core/course-agent.mjs';
import { createPageModule, generateNativeDeck, NATIVE_BLOCK_SCHEMA, NATIVE_OUTLINE_SCHEMA } from '../dist/core/deck-harness.mjs';
import { renderDiagramSvg } from '../dist/core/diagram-render.mjs';
import { applyRoomCommand, commandNeedsScore, createLectureRoom } from '../dist/core/lecture-room.mjs';
import { blockText, buildLectureScore, lectureFrame, validateSlideBlocks } from '../dist/core/lecture-score.mjs';
import { latexToMathML, renderRichMathHtml } from '../dist/core/math-render.mjs';
import { parseMarkdownDeck } from '../dist/core/slide-blocks.mjs';
import { openSession, projectRoom } from '../dist/core/transport.mjs';
import { renderLectureFrame } from '../dist/views/lecture-stage.mjs';
import { createPublicRoomEncoder } from '../room-broadcast.mjs';
import { authoredPage, modelReply, modelRequest } from './support/course-model.mjs';

function lectureFixture() {
  const first = { number: 1, title: '观察样品', text: '比较两种独立测量的结果。', speakerNotes: '只给教师的提示' };
  const second = { number: 2, title: '检查前提', text: '复核测量的边界。', speakerNotes: '下页提词' };
  const interactionsByPage = new Map([[1, createPageModule(first, 'evidence-weighing@1')], [2, createPageModule(second, 'concept-diagnosis@1')]]);
  return buildLectureScore({ name: '实验课', pages: [first, second] }, new Map(), { interactionsByPage });
}

function teachingCommands(score) {
  let state = createLectureRoom('SPRNT2', score);
  return {
    get state() { return state; },
    send(type, payload = {}) {
      state = applyRoomCommand(state, { type, payload: {
        expectedLectureIndex: state.lecture.index, expectedLectureTurn: state.lecture.turn, ...payload,
      } }, commandNeedsScore(type) ? score : undefined);
      return state;
    },
  };
}

function assertPublicEncoding(room, ids) {
  const encode = createPublicRoomEncoder(room);
  for (const id of [null, ...ids]) {
    const projected = projectRoom(room, id === null ? 'stage' : 'student', id);
    assert.deepEqual(JSON.parse(encode(id)), JSON.parse(JSON.stringify(projected)));
  }
}

test('offline seats use independent sessionStorage IDs and update siblings in the same turn without browser notifications', async t => {
  const storage = () => {
    const values = new Map();
    return {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    };
  };
  const listeners = new Set();
  const globals = {
    location: new URL('file:///C:/offline.html'), localStorage: storage(), sessionStorage: storage(),
    BroadcastChannel: undefined, navigator: {},
    addEventListener(type, listener) { assert.equal(type, 'storage'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'storage'); assert.equal(listeners.delete(listener), true); },
  };
  const descriptors = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const sessions = new Set();
  t.after(() => {
    for (const session of sessions) session.close();
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const open = async options => {
    const session = await openSession(options);
    sessions.add(session);
    return session;
  };
  const teacher = await open({ role: 'teacher', demo: false });
  const options = { role: 'student', room: teacher.code };
  const a = await open({ ...options, seat: 'a' });
  const b = await open({ ...options, seat: 'b' });
  const normal = await open(options);
  assert.equal(new Set([a.participantId, b.participantId, normal.participantId]).size, 3);
  assert.equal(sessionStorage.getItem(`polyphony.v1.${teacher.code}.student.a`), a.participantId);
  assert.equal(sessionStorage.getItem(`polyphony.v1.${teacher.code}.student.b`), b.participantId);
  let notifications = 0;
  b.subscribe(() => notifications++);
  const first = a.command('join', { name: 'Seat Alpha' });
  assert.equal(notifications, 1);
  assert.equal(teacher.state.version, b.state.version);
  await first;
  await b.command('join', { name: 'Seat Beta' });
  const optionId = teacher.state.lesson.options[0].id;
  await a.command('respond', { optionId, reason: 'Seat Alpha first reason' });
  await b.command('respond', { optionId, reason: 'Seat Beta first reason' });
  assert.deepEqual(a.state.responses.map(r => r.participantId), [a.participantId]);
  assert.deepEqual(b.state.responses.map(r => r.participantId), [b.participantId]);
  assert.equal(teacher.state.responseCount, 2);
  await assert.rejects(b.command('respond', { optionId, participantId: a.participantId }));
  const previous = b.state.version;
  b.close();
  sessions.delete(b);
  await teacher.command('reveal');
  assert.equal(b.state.version, previous);
  const reopened = await open({ ...options, seat: 'b' });
  assert.equal(reopened.participantId, b.participantId);
  assert.equal(reopened.state.phase, 'reveal');
  assert.equal(listeners.size, sessions.size);
});

test('timer and pre-join slide pulse change only the snapshot version, with bounded private per-page markers', () => {
  const lecture = teachingCommands(lectureFixture());
  const before = lecture.state;
  const timer = lecture.send('setTimer', { at: 1000, durationSec: 90 });
  assert.deepEqual(timer.timer, { endsAt: 91000, durationSec: 90 });
  assert.equal(timer.version, before.version + 1);
  assert.equal(timer.lecture.turn, before.lecture.turn);
  assert.deepEqual(timer.events, before.events);

  const pulse = lecture.send('slidePulse', { participantId: 'not-joined', active: true });
  assert.deepEqual(pulse.participants, []);
  assert.equal(pulse.lecture.muddy[1]['not-joined'], true);
  assert.equal(pulse.version, timer.version + 1);
  assert.equal(pulse.lecture.turn, timer.lecture.turn);
  assert.deepEqual(pulse.events, timer.events);
  assertPublicEncoding(pulse, ['not-joined', 'unrelated']);
  for (const role of ['stage', 'student']) {
    const visible = projectRoom(pulse, role, 'not-joined');
    assert.equal(visible.lecture.muddyCount, 1);
    assert.equal(visible.lecture.muddy, undefined);
    assert.equal(visible.lecture.speakerNotes, undefined);
    assert.deepEqual(visible.lecture.filmstrip[0], {
      pageNumber: 1, activityId: 'evidence-weighing@1', muddyCount: 1,
    });
    assert.doesNotMatch(JSON.stringify(visible), /not-joined|只给教师的提示/);
  }
  assert.equal(projectRoom(pulse, 'teacher').lecture.speakerNotes, '只给教师的提示');
  assert.throws(() => lecture.send('slidePulse', { participantId: '', active: true }));
  assert.throws(() => lecture.send('slidePulse', { participantId: 'demo-fixture', active: true }));
  lecture.send('slidePulse', { participantId: 'not-joined', active: false });
  assert.equal(projectRoom(lecture.state, 'teacher').lecture.muddyCount, 0);
  const preClear = lecture.state;
  const cleared = lecture.send('setTimer', { at: 2000, durationSec: 0 });
  assert.equal(cleared.timer, null);
  assert.equal(cleared.version, preClear.version + 1);
  assert.equal(cleared.lecture.turn, preClear.lecture.turn);
  assert.deepEqual(cleared.events, preClear.events);

  for (let i = 0; i < 500; i++) lecture.send('slidePulse', { participantId: `seat-${i}`, active: true });
  assert.throws(() => lecture.send('slidePulse', { participantId: 'overflow', active: true }), /上限/);
  assert.equal(Object.keys(lecture.state.lecture.muddy[1]).length, 500);
  lecture.send('lectureNavigate', { index: 1 });
  const next = projectRoom(lecture.state, 'teacher').lecture;
  assert.equal(next.muddyCount, 0);
  assert.equal(next.filmstrip[0].muddyCount, 500);
  assert.equal(next.speakerNotes, '下页提词');
});

test('reset clears the current activity and its archive, keeps real students, and invalidates old submissions', () => {
  const lecture = teachingCommands(lectureFixture());
  lecture.send('join', { participantId: 'real', name: '真实同学' });
  const active = lecture.send('lectureInteract');
  lecture.send('demoFill');
  assert.equal(lecture.state.demo, true);
  assert.ok(lecture.state.participants.some(p => p.simulated));
  lecture.send('lectureNavigate', { index: 1 });
  lecture.send('lectureInteract');
  lecture.send('demoFill');
  lecture.send('lectureNavigate', { index: 0 });
  const before = lecture.state;
  assert.deepEqual(before.lectureArchive.map(item => item.pageNumber), [1, 2]);
  assert.ok(before.lectureArchive[0].responses.length);
  assert.equal(commandNeedsScore('resetActivity'), true);
  const reset = lecture.send('resetActivity');
  assert.equal(reset.version, before.version + 1);
  assert.equal(reset.lecture.turn, before.lecture.turn + 1);
  assert.equal(reset.lecture.mode, 'activity');
  assert.equal(reset.phase, 'collect');
  assert.equal(reset.round, 1);
  assert.equal(reset.lessonId, active.lessonId);
  assert.deepEqual(reset.responses, []);
  assert.deepEqual(reset.lectureArchive.map(item => item.pageNumber), [2]);
  assert.deepEqual(reset.participants.map(p => p.id), ['real']);
  assert.equal(reset.demo, false);
  assert.throws(() => lecture.send('respond', { participantId: 'real', optionId: reset.lesson.options[0].id, expectedLectureTurn: before.lecture.turn }), /切换/);
});

test('revealing leaves analysis as a separate event and public excerpts use anonymous text', () => {
  const lecture = teachingCommands(lectureFixture());
  lecture.send('lectureInteract');
  const [left, right] = lecture.state.lesson.options;
  assert.ok(lecture.state.lesson.moduleConfig.aiPeer);
  assertPublicEncoding(lecture.state, ['private-seat']);
  for (const role of ['stage', 'student']) assert.equal(projectRoom(lecture.state, role).lesson.moduleConfig.aiPeer, undefined);
  lecture.send('toggleAiPeer');
  assertPublicEncoding(lecture.state, ['private-seat']);
  for (const role of ['stage', 'student']) assert.ok(projectRoom(lecture.state, role).lesson.moduleConfig.aiPeer);
  lecture.send('toggleAiPeer');
  for (const [i, optionId, reason] of [
    [1, left.id, '真实名字1 private-seat-1 认为还需要独立证据。' + '测量'.repeat(90)],
    [2, left.id, '另一个解释'], [3, left.id, '本选项的第三条'], [4, right.id, '证据已经充分'], [5, right.id, ''],
  ]) {
    const participantId = `private-seat-${i}`;
    lecture.send('join', { participantId, name: `真实名字${i}` });
    lecture.send('respond', { participantId, optionId, reason });
  }
  const revealed = lecture.send('reveal');
  assert.equal(revealed.analysis, null);
  assert.equal(revealed.events.at(-1).type, 'reveal');
  const analyzed = lecture.send('analyze', { fastLocal: true });
  assert.equal(analyzed.version, revealed.version + 1);
  assert.equal(analyzed.events.at(-1).type, 'analyze');
  assert.deepEqual(analyzed.analysis.optionExcerpts[left.id].map(s => s.length <= 140), [true, true]);
  assert.deepEqual(analyzed.analysis.optionExcerpts[right.id], ['证据已经充分']);
  assertPublicEncoding(analyzed, ['private-seat-1', 'private-seat-2', 'unknown']);
  for (const [role, id] of [['stage', null], ['student', 'private-seat-2']]) {
    const view = projectRoom(analyzed, role, id);
    assert.doesNotMatch(JSON.stringify(view.analysis.optionExcerpts), /真实名字1|private-seat-1|本选项的第三条/);
    assert.match(view.analysis.optionExcerpts[left.id].join(' '), /〔匿名〕/);
    assert.ok(view.responses.filter(r => r.participantId !== id || id === null).every(r => r.reason === undefined));
    for (const quote of view.analysis.contrastPair) assert.deepEqual(Object.keys(quote).sort(), ['quote', 'sideLabel', 'tone']);
  }
});

test('native MathML compiles fractions, roots, scripts, operators, Greek letters and array structures', () => {
  const html = latexToMathML(String.raw`\frac{x_i^2}{\sqrt[n]{\alpha}}+\int_0^\infty e^{-x}\,dx+\sum_{i=1}^n \Delta_i`, { display: true });
  for (const tag of ['math', 'mfrac', 'mroot', 'msubsup']) assert.match(html, new RegExp(`<${tag}\\b`));
  assert.match(html, /display="block"/);
  assert.match(html, /α/);
  assert.match(html, /∫/);
  assert.match(html, /∑/);
  assert.match(html, /Δ/);
  assert.match(latexToMathML(String.raw`\sqrt{x}+\tilde{x}+\mathrm{Re}\left(\sin x\right)`), /<msqrt>.*<mover\b.*sin/s);
  for (const env of ['pmatrix', 'bmatrix', 'vmatrix', 'cases']) {
    const latex = `\\begin{${env}}a&b\\\\c&d\\end{${env}}`;
    const matrix = latexToMathML(latex);
    assert.match(matrix, /<mtable\b/);
    assert.equal([...matrix.matchAll(/<mtr\b/g)].length, 2);
    assert.equal([...matrix.matchAll(/<mtd\b/g)].length, 4);
  }
});

test('rich math handles delimiters, descriptions and malformed input with escaped text', () => {
  const text = String.raw`正文 $x^2$ 与 \(\theta\)。$$a=b$$ 再看 \[\frac{1}{2}\]。`;
  const html = renderRichMathHtml(text);
  assert.equal([...html.matchAll(/<math\b/g)].length, 4);
  assert.equal([...html.matchAll(/display="block"/g)].length, 2);
  assert.match(renderRichMathHtml(String.raw`定义：\frac{V}{R}=I`, { block: true }), /定义.*<math[^>]*display="block"/s);
  assert.doesNotMatch(renderRichMathHtml(String.raw`费用 \$5，单独的 $`), /<math\b/);
  assert.doesNotMatch(renderRichMathHtml('这是一行说明', { block: true }), /<math\b/);
  assert.doesNotMatch(renderRichMathHtml(String.raw`\frac{1}{`, { block: true }), /<math\b/);
  const attacked = renderRichMathHtml(String.raw`<img src=x onerror=alert(1)> $\text{<script>x</script>}$`);
  assert.match(attacked, /&lt;img/);
  assert.match(attacked, /&lt;script&gt;/);
  assert.doesNotMatch(attacked, /<script|<img/);
});

const graph = {
  type: 'diagram', title: '光路比较',
  nodes: [
    { id: 'source', label: '光源', sub: '初始电场 E₀', tone: 'primary', group: '甲' },
    { id: 'sample', label: '透镜', sub: '<script>', tone: 'accent', group: '乙' },
    { id: 'detector', label: '探测器', tone: 'neutral', group: '乙' },
  ],
  edges: [{ from: 'source', to: 'sample', label: '入射' }, { from: 'sample', to: 'detector', label: '出射' }],
};

test('structured diagrams validate references, escape visible text and use independent SVG IDs', () => {
  const [verified] = validateSlideBlocks([graph]);
  assert.equal(verified.kind, 'flow');
  assert.equal(verified.direction, 'LR');
  assert.equal(blockText(verified), '光路比较\n光源\n初始电场 E₀\n透镜\n<script>\n探测器\n入射\n出射');
  const ids = new Set();
  for (const kind of ['flow', 'compare', 'concept']) for (const direction of ['LR', 'TB']) {
    const svg = renderDiagramSvg({ ...verified, kind, direction });
    const id = svg.match(/id="(diag-arrow-\d+)"/)?.[1];
    assert.ok(id);
    assert.ok(!ids.has(id));
    ids.add(id);
    assert.ok(svg.includes(`url(#${id})`));
    assert.match(svg, /<figure class="slide-diagram"/);
    assert.match(svg, /&lt;script&gt;/);
    assert.doesNotMatch(svg, /<script|NaN|Infinity/);
  }
  const cycle = { ...verified, edges: [...verified.edges, { from: 'detector', to: 'source' }] };
  assert.doesNotMatch(renderDiagramSvg(cycle), /NaN|Infinity/);
  assert.throws(() => validateSlideBlocks([{ ...graph, edges: [{ from: 'source', to: 'unknown' }] }]));
  assert.throws(() => validateSlideBlocks([{ ...graph, nodes: [graph.nodes[0], graph.nodes[0]] }]));
  assert.throws(() => validateSlideBlocks([{ type: 'diagram', svg: '<svg></svg>' }]));
});

test('Markdown diagrams round trip into the stage and native authoring schema', () => {
  const raw = [
    '# 光路', '在焦平面处 $x=0$。', '```diagram', 'A[光源] -->|入射| B[透镜]', '```',
    '---', '## 采样', '```mermaid', 'flowchart TB', 'A[信号] --> B[采样]', 'A -->|比较| B', '```',
  ].join('\n');
  const material = parseMarkdownDeck('光路讲义', raw);
  assert.equal(material.pages.length, 2);
  for (const [index, page] of material.pages.entries()) {
    const block = page.blocks.find(b => b.type === 'diagram');
    assert.ok(block);
    assert.equal(block.kind, 'flow');
    assert.equal(block.direction, index ? 'TB' : 'LR');
    assert.equal(block.nodes.length, 2);
    assert.match(page.text, index ? /信号.*采样.*比较/s : /光源.*透镜.*入射/s);
  }
  const score = buildLectureScore(material);
  const root = { innerHTML: '' };
  renderLectureFrame(root, lectureFrame(score, 0));
  assert.match(root.innerHTML, /class="slide-diagram"/);
  assert.match(root.innerHTML, /<math\b/);
  assert.equal(NATIVE_OUTLINE_SCHEMA.properties.pages.items.properties.blocks.items, NATIVE_BLOCK_SCHEMA);
  assert.ok(NATIVE_BLOCK_SCHEMA.anyOf.some(block => block.properties.type.const === 'diagram'));
});

test('native authoring preserves a verified diagram and anchors its labels in the following model stage', async () => {
  const diagram = structuredClone(graph);
  diagram.nodes[1].sub = '折射后光路';
  diagram.nodes[2] = { ...diagram.nodes[2], sub: null, group: null, tone: null };
  const [validated] = validateSlideBlocks([diagram]);
  const spec = { course: '实验光学', topic: '光路与测量', pageCount: 8 };
  const blueprint = await planCourseBlueprint(spec);
  let anchored = false;
  const result = await generateNativeDeck(spec, { provider: {
    baseUrl: 'https://fixture.example/v1', key: 'fixture-key-sprint2', model: 'diagram-test', outputMode: 'json_schema',
    async fetchImpl(_url, request) {
      const body = JSON.parse(request.body);
      const { name, input } = modelRequest(body);
      if (name === 'course_blueprint') {
        const schema = structuredClone(COURSE_BLUEPRINT_SCHEMA);
        Object.assign(schema.properties.pagePlans, { minItems: spec.pageCount, maxItems: spec.pageCount });
        assert.deepEqual(body.response_format.json_schema.schema, schema);
        assert.match(body.messages[0].content, /LaTeX/);
        assert.match(body.messages[0].content, /diagram/);
        return modelReply(blueprint);
      }
      if (name === 'course_slide_batch') return modelReply({ pages: input.pagePlans.map(plan => authoredPage(plan, {
        ...(plan.pageNumber === 3 && { blocks: [diagram] }),
      })) });
      if (name === 'course_review') return modelReply({ done: true });
      if (name === 'course_checkpoint_triage') return modelReply({ checkpoints: [
        { pageNumber: 3, activityId: 'concept-diagnosis@1' },
      ] });
      assert.equal(name, 'online_lesson_module');
      if (input.pageNumber === 3) {
        assert.ok(input.materials.every((item, index) => item.id === `M${index + 1}`));
        for (const snippet of ['光源', '折射后光路', '出射']) assert.ok(input.materials.some(item => item.text.includes(snippet)));
        anchored = true;
      }
      const value = createPageModule({
        number: input.pageNumber, title: input.title, text: input.materials.map(item => item.text).join('\n'),
      }, 'concept-diagnosis@1');
      return modelReply(value);
    },
  } });
  assert.equal(result.source, 'provider');
  assert.equal(anchored, true);
  assert.deepEqual(result.lectureScore.pages[2].blocks[0], validated);
  assert.deepEqual(result.harnessReceipt.repairs, []);
});
