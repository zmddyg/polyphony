import { isLectureImage, lectureFrame } from '../core/lecture-score.mjs';
import { isSafeMathML } from '../core/mathml.mjs';
import { esc } from '../ui.mjs';
import { renderScienceChart } from './material-science.mjs';

function renderImages(images) {
  const figures = (images ?? []).filter(({ src }) => isLectureImage(src));
  if (!figures.length) return '';
  return `<div class="lecture-frame-figures">${figures.map(({ src, alt }) =>
    `<img src="${esc(src)}" alt="${esc(alt)}" decoding="async">`).join('')}</div>`;
}

function renderFormulas(formulas) {
  const safe = (formulas ?? []).filter(isSafeMathML);
  if (!safe.length) return '';
  return `<div class="lecture-frame-formulas" aria-label="公式">${safe.map(math => `<div class="lecture-formula">${math}</div>`).join('')}</div>`;
}

export function renderLectureFrame(root, frame, { compact = false } = {}) {
  if (!frame) {
    root.innerHTML = '';
    return;
  }

  const source = `${frame.source.name} · 第 ${frame.pageNumber} 页`;
  const body = frame.body.length ? `<div class="lecture-frame-text">${frame.body.map(line => `<p>${esc(line)}</p>`).join('')}</div>` : '';
  const preview = isLectureImage(frame.preview);
  const formulas = preview ? '' : renderFormulas(frame.formulas);
  const images = preview ? '' : renderImages(frame.images);
  const plot = frame.series?.length || frame.points?.length ? renderScienceChart(frame) : '';
  const visual = images + plot;
  const mainBody = body + formulas;
  const content = preview && mainBody ? `<details class="lecture-frame-transcript"><summary>查看原页文字</summary>${mainBody}</details>` : mainBody;
  const empty = !preview && !mainBody && !visual && !frame.omittedImages;

  root.innerHTML = `<article class="lecture-frame${compact ? ' lecture-frame--compact' : ''}">
    <header class="lecture-frame-head">
      <h2>${esc(frame.title)}</h2>
      <p class="lecture-frame-source">${esc(source)}</p>
    </header>
    ${preview ? `<figure class="lecture-frame-original"><img src="${esc(frame.preview)}" alt="${esc(`原稿第 ${frame.pageNumber} 页：${frame.title}`)}" decoding="async"></figure>` : ''}
    ${empty ? '<p class="lecture-frame-empty">这页没有可显示的内容。</p>' : ''}
    ${frame.omittedImages ? '<p class="lecture-frame-empty">这页有裁剪过的原稿图片，当前无法完整还原。</p>' : ''}
    ${content || visual ? `<div class="lecture-frame-layout${mainBody && visual && !preview ? ' lecture-frame-layout--split' : ''}">
      ${content}
      ${visual ? `<div class="lecture-frame-visual">${visual}</div>` : ''}
    </div>` : ''}
  </article>`;
}

export function renderLectureStage(root, { lecture, index = 0, compact = false } = {}) {
  renderLectureFrame(root, lectureFrame(lecture, index), { compact });
}
