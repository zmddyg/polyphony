import assert from 'node:assert/strict';
import test from 'node:test';
import { getLesson } from '../dist/core/catalog.mjs';
import { buildLectureScore, lectureFrame, lectureFrames, validateLectureScore } from '../dist/core/lecture-score.mjs';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/1eEAAAAASUVORK5CYII=';
const source = {
  versionId: 'pptx:1234',
  name: '相位差与光强.pptx',
  title: '光的干涉',
  type: 'pptx',
  pages: [
    { number: 3, title: '归纳', text: '', preview: pixel },
    { number: 1, title: '观察光强', text: '观察光强\n\n比较两个输出端。\nΔφ = π', images: [{ src: pixel, alt: '原稿中标出了两条光路' }] },
    { number: 2, title: '备用页', text: '未公开的原稿内容', hidden: true },
  ],
};

test('the lecture follows source order, shows embedded graphics and keeps genuine page numbers', () => {
  const lecture = buildLectureScore(source);
  assert.deepEqual(lecture.source, { name: source.name, kind: 'pptx', versionId: 'pptx:1234' });
  assert.deepEqual(lecture.pages.map(({ number }) => number), [1, 3]);
  assert.deepEqual(lectureFrame(lecture, 0), {
    title: '观察光强', body: ['比较两个输出端。', 'Δφ = π'],
    source: { name: source.name, pageNumber: 1 },
    pageNumber: 1,
    images: [{ src: pixel, alt: '原稿中标出了两条光路' }],
  });
  assert.equal(lectureFrame(lecture, 1).preview, pixel);
  assert.deepEqual(lectureFrame(lecture, 1).body, []);
  assert.doesNotMatch(JSON.stringify(lecture), /未公开的原稿内容/u);
  assert.deepEqual(source.pages.map(({ number }) => number), [3, 1, 2]);
});

test('only the currently projected frame contains its content, including a supplemental chart', () => {
  const pointsA = [{ x: 0, y: 100 }, { x: 180, y: 0 }];
  const pointsB = [{ x: 0, y: 0 }, { x: 180, y: 100 }];
  const adopted = new Map([[1, { slides: [
    { title: '预测', body: ['相位差达到 180° 时，B 端会怎样？'], teacherNotes: '教师私人备注' },
    { title: '解释', body: ['两端总光强为 100%。'], xLabel: '相位差 (°)', yLabel: '归一化光强 (%)',
      series: [{ label: 'A 端', color: '#315be8', points: pointsA }, { label: 'B 端', color: '#0f766e', points: pointsB }], points: pointsA },
  ] }]]);
  const lesson = { ...getLesson('mzi'), privateComment: '下课后收集理由' };
  const lecture = buildLectureScore(source, adopted, { title: '观察光的干涉', interactionsByPage: new Map([[1, lesson]]) });

  assert.equal(lecture.title, '观察光的干涉');
  assert.equal(lecture.pages[0].interaction.id, lesson.id);
  assert.deepEqual(lectureFrames(lecture), [
    { pageIndex: 0, slideIndex: -1 }, { pageIndex: 0, slideIndex: 0 },
    { pageIndex: 0, slideIndex: 1 }, { pageIndex: 1, slideIndex: -1 },
  ]);
  const question = lectureFrame(lecture, 1);
  assert.equal(question.title, '预测');
  assert.equal(question.source.pageNumber, 1);
  assert.doesNotMatch(JSON.stringify(question), /100%|私人备注|下课后|versionId|interaction|adopted/u);
  const explanation = lectureFrame(lecture, 2);
  assert.equal(explanation.series.length, 2);
  assert.deepEqual(explanation.series[1].points, pointsB);
  assert.equal(explanation.xLabel, '相位差 (°)');
  assert.equal(explanation.points, undefined);
  assert.doesNotMatch(JSON.stringify(lecture), /私人备注|下课后/u);
  assert.deepEqual(validateLectureScore(JSON.parse(JSON.stringify(lecture))), lecture);
  for (const invalid of [-1, 4, 1.5, 'length']) assert.equal(lectureFrame(lecture, invalid), null);
});

test('invalid material, unsafe image links and non-finite chart data fail before use', () => {
  assert.throws(() => buildLectureScore({ ...source, pages: [source.pages[2]] }), /至少一页可放映/u);
  assert.throws(() => buildLectureScore({ ...source, pages: [source.pages[1], source.pages[1]] }), /每页只能出现一次/u);
  const lecture = buildLectureScore(source);
  assert.throws(() => validateLectureScore({ ...lecture, version: 2 }), /版本暂不可用/u);
  for (const src of ['https://example.com/figure.png', 'blob:https://example.com/chart', 'data:image/svg+xml;base64,PHN2Zz4=']) {
    assert.throws(() => buildLectureScore({ ...source, pages: [{ ...source.pages[0], preview: src }] }), /已嵌入的原稿图片/u);
  }
  assert.throws(
    () => buildLectureScore(source, new Map([[1, { slides: [{ title: '曲线', body: [], points: [{ x: 0, y: Infinity }] }] }]])),
    /有限数值/u,
  );
});

test('students get only the visible pixels of cropped illustrations', () => {
  const fullImage = 'data:image/png;base64,aW1hZ2U=';
  const figure = { src: fullImage, alt: '有裁边的原稿插图', cropped: true };
  const page = { ...source.pages[1], images: [figure, { ...figure, visibleSrc: pixel }] };
  const lecture = buildLectureScore({ ...source, pages: [page] });
  const frame = lectureFrame(lecture, 0);
  assert.deepEqual(frame.images, [{ src: pixel, alt: figure.alt }]);
  assert.equal(frame.omittedImages, true);
  assert.doesNotMatch(JSON.stringify(lecture), /aW1hZ2U=/u);
  assert.deepEqual(validateLectureScore(lecture), lecture);
});
