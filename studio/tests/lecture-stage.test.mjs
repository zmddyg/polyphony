import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLectureScore, lectureFrame } from '../dist/core/lecture-score.mjs';
import { buildSciencePacket } from '../dist/core/teaching-science.mjs';
import { renderLectureFrame, renderLectureStage } from '../dist/views/lecture-stage.mjs';

const material = {
  name: '电学 & 波动.pdf', type: 'pdf', versionId: 'source-fixture',
  pages: [{ number: 1, title: '电学 <学习页>', text: '保留公式 0 < t < 2。' }],
};

test('the common rendering uses the current frame, escapes authored content and clears a stale frame', () => {
  const lecture = buildLectureScore(material, new Map([[1, { slides: [{ title: '教师采用的解答', body: ['当前不播放的内容'] }] }]]));
  const root = { innerHTML: '' };
  renderLectureStage(root, { lecture, index: 0, compact: true });
  assert.match(root.innerHTML, /lecture-frame--compact/u);
  assert.match(root.innerHTML, /电学 &amp; 波动\.pdf · 第 1 页/u);
  assert.match(root.innerHTML, /&lt;学习页&gt;/u);
  assert.match(root.innerHTML, /0 &lt; t &lt; 2/u);
  assert.doesNotMatch(root.innerHTML, /采用的解答|当前不播放的内容/u);
  renderLectureStage(root, { lecture, index: 10 });
  assert.equal(root.innerHTML, '');
});

test('a source preview offers an accessible transcript without repeating its embedded images', () => {
  const preview = 'data:image/jpeg;base64,AA==';
  const [page] = material.pages;
  const lecture = buildLectureScore({ ...material, pages: [{ ...page, preview, images: [{ src: preview, alt: '材料图片' }] }] });
  const root = { innerHTML: '' };
  const frame = lectureFrame(lecture, 0);
  assert.equal(frame.images, undefined);
  renderLectureFrame(root, frame);
  assert.equal(root.innerHTML.match(/<img /g).length, 1);
  assert.match(root.innerHTML, /alt="原稿第 1 页：电学 &lt;学习页&gt;"/u);
  assert.match(root.innerHTML, /<summary>查看原页文字<\/summary>/u);
  assert.match(root.innerHTML, /保留公式/u);
});

test('adopted model charts keep numeric axes and both interferometer output curves in the projection', () => {
  const anchor = { id: 'source-fixture:1', title: material.name, page: 1, materialId: material.versionId };
  for (const model of ['rc', 'mzi']) {
    const packet = buildSciencePacket({ model, anchor });
    const lecture = buildLectureScore(material, new Map([[1, packet]]));
    const index = packet.slides.findIndex(slide => slide.points?.length || slide.series?.length) + 1;
    assert.ok(index > 0);
    const root = { innerHTML: '' };
    const frame = lectureFrame(lecture, index);
    renderLectureFrame(root, frame);
    assert.match(root.innerHTML, /<svg/u);
    assert.ok(root.innerHTML.includes(frame.xLabel));
    assert.ok(root.innerHTML.includes(frame.yLabel));
    if (model === 'mzi') {
      assert.match(root.innerHTML, /A 端/u);
      assert.match(root.innerHTML, /B 端/u);
    }
  }
});
