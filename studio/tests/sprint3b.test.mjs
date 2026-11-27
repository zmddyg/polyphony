import assert from 'node:assert/strict';
import test from 'node:test';
import { COMBAT_DECKS, combatMaterial } from '../demo/combat-decks.mjs';
import { wholeDeckPilotMetrics } from '../dist/core/cognition.mjs';
import { dryRunLesson, numberEvidence, runDeckHarness } from '../dist/core/deck-harness.mjs';
import { validateLectureScore } from '../dist/core/lecture-score.mjs';
import { buildStudentReviewHtml, buildTeacherReportHtml } from '../dist/core/report-export.mjs';

const moduleId = 'concept-diagnosis@1';
const lesson = {
  id: 'mechanism-check', title: '逐步推理', activityId: moduleId, correctOptionId: 'A',
  options: [{ id: 'A', label: '可成立' }, { id: 'B', label: '待验证' }],
};
const response = (participantId, round, optionId, reason = '', simulated = false) =>
  ({ participantId, round, optionId, reason, simulated });
const archived = (pageNumber, responses) =>
  ({ pageNumber, lesson, lessonId: lesson.id, round: 2, phase: 'closed', responses });

test('whole-deck metrics count real respondents once and combine edited pages with the live page', () => {
  const state = {
    lesson, lessonId: lesson.id, round: 2, phase: 'reveal',
    lecture: {
      mode: 'activity', pageNumber: 3, filmstrip: [
        { pageNumber: 1, title: '测量条件', activityId: moduleId },
        { pageNumber: 2, title: '演示样本', activityId: moduleId },
        { pageNumber: 3, title: '校验判据', activityId: moduleId },
      ],
    },
    lectureArchive: [
      archived(1, [
        response('a', 1, 'A', '从条件推出结论'), response('b', 1, 'B', '   '),
        response('a', 2, 'A'), response('b', 2, 'A', '按反例修正'),
        response('simulation', 1, 'A', '模拟理由', true),
      ]),
      archived(2, [
        response('simulation', 1, 'A', '模拟首轮', true),
        response('simulation', 2, 'B', '模拟二轮', true),
      ]),
    ],
    responses: [response('a', 1, 'B'), response('a', 2, 'A', '复核量纲')],
  };
  const metrics = wholeDeckPilotMetrics(state);
  const { source, participantCount, reasonFillRate, firstRoundAccuracy, secondRoundAccuracy,
    accuracyGainPp, pairedRevisionRate, interactivePageCount } = metrics;
  assert.deepEqual({ source, participantCount, reasonFillRate, firstRoundAccuracy, secondRoundAccuracy,
    accuracyGainPp, pairedRevisionRate, interactivePageCount }, {
    source: 'live', participantCount: 2, reasonFillRate: 50, firstRoundAccuracy: 25,
    secondRoundAccuracy: 100, accuracyGainPp: 75, pairedRevisionRate: 66.7, interactivePageCount: 3,
  });
  assert.deepEqual(metrics.pages.map(page => [page.pageNumber, page.source, page.firstRoundAccuracy]), [
    [1, 'live', 50], [2, 'simulated', 100], [3, 'live', 0],
  ]);
});

test('whole-deck metrics label simulations and keep rates without a denominator unavailable', () => {
  const partial = wholeDeckPilotMetrics({
    lecture: { mode: 'ended' },
    lectureArchive: [archived(2, [response('sample', 1, 'B', '', true)])],
  });
  assert.equal(partial.source, 'simulated');
  assert.equal(partial.participantCount, 1);
  assert.equal(partial.reasonFillRate, 0);
  assert.equal(partial.firstRoundAccuracy, 0);
  assert.equal(partial.secondRoundAccuracy, null);
  assert.equal(partial.accuracyGainPp, null);
  assert.equal(partial.pairedRevisionRate, null);
  assert.equal(wholeDeckPilotMetrics({ lectureArchive: [] }).participantCount, 0);
});

test('whole-deck metrics locate the lecture page with the most distinct questions', () => {
  const metrics = wholeDeckPilotMetrics({
    lecture: { mode: 'ended', pageNumber: 6, filmstrip: [
      { pageNumber: 1, title: '适用条件', muddyCount: 2 },
      { pageNumber: 2, title: '互动判别', activityId: moduleId, muddyCount: 7 },
      { pageNumber: 3, title: '量纲推导', muddyCount: 4 },
      { pageNumber: 3, title: '补充分解', muddyCount: 4 },
      { pageNumber: 6, title: '课堂小结', muddyCount: 0 },
    ] },
    lectureArchive: [archived(2, [response('a', 1, 'A')])],
  });
  assert.deepEqual(metrics.topMuddyPage, { pageNumber: 3, title: '量纲推导', count: 4 });
  assert.deepEqual(metrics.pages.map(page => [page.pageNumber, page.kind]), [
    [1, 'lecture'], [2, 'interaction'], [3, 'lecture'],
  ]);
});

test('the student HTML includes native math, both choices, analysis, and the two kinds of marks', () => {
  const html = buildStudentReviewHtml({
    title: '干涉与调制', code: 'ABC123',
    takeaways: [{ pageNumber: 2, title: '光强关系', formula: '$I = U^* U$', summary: '复振幅求模方', pitfall: '检查时间因子' }],
    personalRecords: [{
      pageNumber: 5, title: '干涉判断', prompt: '比较两路光',
      answers: [
        { round: 1, optionId: 'B', label: '相位未变', reason: '只检查了振幅' },
        { round: 2, optionId: 'A', label: '相位变化', reason: '复核了光程差' },
      ],
      reference: { optionId: 'A', label: '相位变化', summary: '保持同一相位约定', pitfall: '勿混用符号' },
    }],
    bookmarkedPages: [{ pageNumber: 7, title: '偏置点待复习' }],
    muddyPages: [{ pageNumber: 9, title: '行波电极有疑问' }],
  });
  for (const text of ['干涉与调制', 'ABC123', '复振幅求模方', '检查时间因子', '只检查了振幅', '复核了光程差',
    '保持同一相位约定', '偏置点待复习', '行波电极有疑问']) assert.ok(html.includes(text), text);
  assert.match(html, /<math[\s>]/);
  assert.match(html, /@media\s+print/);
});

const unsafe = '<script>REVIEW_MARKER</script><img src="https://example.invalid/pixel"><b>&自选</b>';
function assertStandaloneReport(html) {
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /<(?:script|img|iframe|link)\b|\b(?:src|href)="https?:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;&amp;自选&lt;\/b&gt;/);
}

test('the student report escapes text and math content from imports and student responses', () => {
  assertStandaloneReport(buildStudentReviewHtml({
    title: unsafe, code: unsafe,
    takeaways: [{ pageNumber: 1, title: unsafe, formula: unsafe, summary: unsafe, pitfall: unsafe }],
    personalRecords: [{ pageNumber: 2, title: unsafe, prompt: unsafe,
      answers: [{ round: 1, optionId: unsafe, label: unsafe, reason: unsafe }],
      reference: { optionId: unsafe, label: unsafe, summary: unsafe, pitfall: unsafe } }],
    bookmarkedPages: [{ pageNumber: 3, title: unsafe }],
    muddyPages: [{ pageNumber: 4, title: unsafe }],
  }));
});

test('the teacher report prints page-level KPIs, identifies the sample and omits private responses', () => {
  const state = {
    code: 'ABC123', lecture: { title: unsafe, mode: 'ended', filmstrip: [{ pageNumber: 2, title: unsafe, activityId: moduleId }] },
    lectureArchive: [archived(2, [response('hidden-participant', 1, 'B', 'private reasoning', true), response('hidden-participant', 2, 'A', '', true)])],
  };
  const html = buildTeacherReportHtml(state, wholeDeckPilotMetrics(state));
  assertStandaloneReport(html);
  for (const text of ['ABC123', '模拟', '100%', '50%', '正解率', '配对改答']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /hidden-participant|private reasoning/);
});

test('all 32 speaker cues are distinct and the original concept demonstrations carry structured visuals', () => {
  const pages = COMBAT_DECKS.flatMap(deck => deck.pages);
  assert.deepEqual(COMBAT_DECKS.map(deck => deck.pages.length), [12, 10, 10]);
  const notes = pages.map(page => page.speakerNotes?.trim());
  assert.ok(notes.every(Boolean));
  assert.equal(new Set(notes).size, 32);
  for (const deck of COMBAT_DECKS.slice(0, 2)) {
    const types = new Set(deck.pages.flatMap(page => page.blocks.map(block => block.type)));
    assert.ok(types.has('formula'), deck.id);
    assert.ok(types.has('diagram'), deck.id);
  }
});

test('all three native scores preserve nine checkpoints, validated citations and completed two-round dry runs', async () => {
  const checkpointPages = [[4, 7, 11], [3, 5, 8], [4, 7, 8]];
  for (const [index, deck] of COMBAT_DECKS.entries()) {
    const material = combatMaterial(deck.id);
    const result = await runDeckHarness(material, { pacingMode: 'full-demo' });
    const score = validateLectureScore(result.lectureScore);
    const checkpoints = score.pages.filter(page => page.interaction);
    assert.deepEqual(checkpoints.map(page => page.number), checkpointPages[index]);
    assert.deepEqual(score.pages.map(page => page.speakerNotes), deck.pages.map(page => page.speakerNotes));
    assert.ok(result.harnessReceipt.stages.every(stage => stage.status === 'complete'));
    assert.equal(result.harnessReceipt.repairs.length, 0);
    for (const { number, interaction } of checkpoints) {
      const raw = material.pages.find(page => page.number === number);
      const source = new Map(numberEvidence(raw.text).map(block => [block.id, block.text]));
      const quoted = new Set(interaction.sourceEvidence.map(evidence => evidence.id));
      for (const { id, quote } of interaction.sourceEvidence) assert.ok(source.get(id)?.includes(quote), id);
      for (const id of [...interaction.evidenceIds, ...interaction.branches.flatMap(branch => branch.evidenceIds)]) {
        assert.match(id, /^M[1-9]\d*$/);
        assert.ok(quoted.has(id), id);
      }
      const run = dryRunLesson(interaction);
      assert.deepEqual([run.round, run.phase, run.responses], [2, 'closed', 2]);
    }
  }
});
