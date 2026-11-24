import { isEmbeddedLectureImage, lectureFrame } from '../core/lecture-score.mjs';
import { esc } from '../ui.mjs';
import { renderScienceChart } from './material-science.mjs';

function renderImages(images) {
  const figures = (images ?? []).filter(({ src }) => isEmbeddedLectureImage(src));
  if (!figures.length) return '';
  return `<div class="lecture-frame-figures">${figures.map(({ src, alt }) =>
    `<img src="${esc(src)}" alt="${esc(alt)}" decoding="async">`).join('')}</div>`;
}

export function renderLectureFrame(root, frame, { compact = false } = {}) {
  if (!frame) {
    root.innerHTML = '';
    return;
  }

  const source = `${frame.source.name} · 第 ${frame.pageNumber} 页`;
  const body = frame.body.length ? `<div class="lecture-frame-text">${frame.body.map(line => `<p>${esc(line)}</p>`).join('')}</div>` : '';
  const preview = isEmbeddedLectureImage(frame.preview);
  const images = preview ? '' : renderImages(frame.images);
  const plot = frame.series?.length || frame.points?.length ? renderScienceChart(frame) : '';
  const visual = images + plot;
  const content = preview && body ? `<details class="lecture-frame-transcript"><summary>查看原页文字</summary>${body}</details>` : body;
  const empty = !preview && !body && !visual && !frame.omittedImages;

  root.innerHTML = `<article class="lecture-frame${compact ? ' lecture-frame--compact' : ''}">
    <header class="lecture-frame-head">
      <h2>${esc(frame.title)}</h2>
      <p class="lecture-frame-source">${esc(source)}</p>
    </header>
    ${preview ? `<figure class="lecture-frame-original"><img src="${esc(frame.preview)}" alt="${esc(`原稿第 ${frame.pageNumber} 页：${frame.title}`)}" decoding="async"></figure>` : ''}
    ${empty ? '<p class="lecture-frame-empty">这页没有可显示的内容。</p>' : ''}
    ${frame.omittedImages ? '<p class="lecture-frame-empty">这页有裁剪过的原稿图片，当前无法完整还原。</p>' : ''}
    ${content || visual ? `<div class="lecture-frame-layout${body && visual && !preview ? ' lecture-frame-layout--split' : ''}">
      ${content}
      ${visual ? `<div class="lecture-frame-visual">${visual}</div>` : ''}
    </div>` : ''}
  </article>`;
}

export function renderLectureStage(root, { lecture, index = 0, compact = false } = {}) {
  renderLectureFrame(root, lectureFrame(lecture, index), { compact });
}
