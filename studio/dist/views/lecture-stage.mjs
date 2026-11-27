import {
  inferSlideArchetype, isEmbeddedLectureImage, lectureFrame, lectureSourceExcerpt, resolveLectureLayout, validateSlideBlocks,
} from '../core/lecture-score.mjs';
import { esc } from '../ui.mjs';
import { renderDiagramSvg } from '../core/diagram-render.mjs';
import { renderRichMathHtml } from '../core/math-render.mjs';
import { renderScienceChart } from './material-science.mjs';

// Tokenize before escaping: generated text can never become an HTML attribute or tag.
export function highlightedCode(source) {
  const token=/(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:int|void|char|float|double|const|return|if|for|while|sizeof|NULL|struct|size_t)\b|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b)/g;
  let end=0,out='';
  for(const m of source.matchAll(token)) {out+=esc(source.slice(end,m.index));const type=m[0].startsWith('//')?'comment':/^["']/.test(m[0])?'string':/^\d/.test(m[0])?'number':'keyword';out+='<span class="syntax-'+type+'">'+esc(m[0])+'</span>';end=m.index+m[0].length;}
  return out+esc(source.slice(end));
}
const rich = renderRichMathHtml;
const blockTitle = value => value ? `<h3>${rich(value)}</h3>` : '';
const snippet = block => `<section class="slide-code">${blockTitle(block.title)}<pre><code>${highlightedCode(block.code)}</code></pre></section>`;

function renderBlock(block) {
  const title = blockTitle(block.title);
  if (block.type === 'code') return snippet(block);
  if (block.type === 'code-pair') return `<div class="slide-code-pair">${snippet(block.left)}${snippet(block.right)}</div>`;
  if (block.type === 'table') {
    const headers = block.headers.map(header => `<th scope="col">${rich(header)}</th>`).join('');
    const rows = block.rows.map(row => `<tr>${row.map(cell => `<td>${rich(cell)}</td>`).join('')}</tr>`).join('');
    return `<section class="slide-table">${title}<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></section>`;
  }
  if (block.type === 'callout') return `<aside class="slide-callout slide-callout--${block.tone}">${title}<p>${rich(block.text)}</p></aside>`;
  if (block.type === 'formula') {
    return `<section class="slide-formula">${title}${block.items.map(item => `<p class="rich-math-line">${rich(item, { block: true })}</p>`).join('')}</section>`;
  }
  if (block.type === 'diagram') return renderDiagramSvg(block);
  if (block.type === 'chart') return `<section class="slide-chart">${title}${renderScienceChart(block)}</section>`;
  if (block.type === 'stat-grid') {
    const stats = block.items.map(item => `<div><b>${rich(item.value)}</b><span>${rich(item.label)}</span></div>`).join('');
    return `<section class="slide-stats">${title}<div class="slide-stats-grid">${stats}</div></section>`;
  }
  const steps = block.type === 'steps', tag = steps ? 'ol' : 'ul';
  const items = block.items.map(item => `<li>${rich(item)}</li>`).join('');
  return `<section class="slide-list${steps ? ' slide-list--steps' : ''}">${title}<${tag}>${items}</${tag}></section>`;
}

export function renderSlideBlocks(blocks) {
  return validateSlideBlocks(blocks).map(renderBlock).join('');
}

const sourceNames = { commons: 'Wikimedia Commons', wikipedia: 'Wikipedia', openverse: 'Openverse' };

function renderImages(images) {
  const figures = (images ?? []).filter(({ src }) => isEmbeddedLectureImage(src));
  if (!figures.length) return '';
  return `<div class="lecture-frame-figures">${figures.map(({ src, alt, credit, license, source }) => {
    const attribution = [credit, license].filter(Boolean).join(' · ');
    const provider = Object.hasOwn(sourceNames, source) ? sourceNames[source] : source;
    return `<figure class="lecture-frame-figure"><img src="${esc(src)}" alt="${esc(alt ?? '')}" decoding="async">
      ${alt || provider || attribution ? `<figcaption>${alt ? `<span>${rich(alt)}</span>` : ''}
        ${provider ? `<small class="lecture-frame-credit-source">${esc(provider)}</small>` : ''}
        ${attribution ? `<small>${esc(attribution)}</small>` : ''}</figcaption>` : ''}</figure>`;
  }).join('')}</div>`;
}

function blockGroup(blocks, modifier = '') {
  if (!blocks.length) return '';
  return `<div class="slide-blocks${modifier ? ` slide-blocks--${modifier}` : ''}">${blocks.map(renderBlock).join('')}</div>`;
}

function pageBlocks(blocks, archetype, layout, allowColumns) {
  const wide = blocks.some(block => block.type === 'code-pair' || (block.type === 'table' && block.headers.length >= 4));
  if (archetype === 'derivation') {
    const formulas = blocks.filter(block => block.type === 'formula');
    if (allowColumns && !wide && formulas.length && formulas.length < blocks.length) {
      return `<div class="lecture-derivation-grid">
        ${blockGroup(blocks.filter(block => block.type !== 'formula'))}${blockGroup(formulas)}</div>`;
    }
  }
  if (archetype === 'example') return blockGroup(blocks, 'example');
  if (archetype === 'summary') return blockGroup(blocks, allowColumns && !wide && blocks.length > 1 ? 'summary-grid' : 'summary');
  const paired = archetype === 'split-compare' || (archetype === 'cover' && layout === 'media-top');
  if (allowColumns && !wide && (layout === 'content-columns' || (paired && blocks.length > 1))) {
    return blockGroup(blocks, 'columns');
  }
  return blockGroup(blocks);
}

function textLines(lines) {
  const paragraphs = lines.filter(line => line.trim());
  if (!paragraphs.length) return '';
  return `<div class="lecture-frame-text">${paragraphs.map(line => `<p class="rich-math-line">${rich(line)}</p>`).join('')}</div>`;
}

export function renderLectureFrame(root, frame, { compact = false, index = -1, total = 0 } = {}) {
  if (!frame) {
    root.innerHTML = '';
    return;
  }

  const source = frame.source?.name ? `${frame.source.name} · 第 ${frame.pageNumber} 页` : '';
  const body = frame.body ?? [];
  const preview = isEmbeddedLectureImage(frame.preview);
  const original = preview ? `<figure class="lecture-frame-original"><img src="${esc(frame.preview)}" alt="${esc(`原稿第 ${frame.pageNumber} 页：${frame.title}`)}" decoding="async"></figure>` : '';
  const images = renderImages(preview ? frame.images?.filter(figure => figure?.accompanyPreview === true) : frame.images);
  const plot = frame.series?.length || frame.points?.length ? renderScienceChart(frame) : '';
  const archetype = inferSlideArchetype(frame, index, total);
  const layout = resolveLectureLayout({ ...frame, archetype });
  const split = layout === 'split-right' || layout === 'split-left';
  const coverSplit = archetype === 'cover' && split && Boolean(images);
  const blocks = validateSlideBlocks(frame.blocks ?? frame.nativeBlocks);
  const separateDiagram = block => block.type === 'diagram' &&
    (layout === 'diagram-focus' || layout === 'media-top' || (split && !images));
  const diagrams = blockGroup(blocks.filter(separateDiagram));
  const written = blocks.filter(block => !separateDiagram(block));
  const copyLayout = layout === 'diagram-focus' && diagrams ? resolveLectureLayout({ blocks: written }) : layout;
  const copyBlocks = pageBlocks(written, archetype, copyLayout, frame.layout !== 'single');
  const extra = lectureSourceExcerpt(frame);
  const transcript = textLines(preview && !blocks.length ? [...new Set([...body, ...extra])] : extra);
  const transcriptDetails = transcript ? `<details class="lecture-frame-transcript"><summary>查看原页文字</summary>${transcript}</details>` : '';
  const visibleBody = !preview && !blocks.length ? textLines(body) : '';
  const ordinal = frame.pageNumber ?? index + 1;
  const head = `<header class="lecture-frame-head">
    ${archetype === 'section' && ordinal > 0 ? `<span class="lecture-frame-ordinal" aria-hidden="true">${esc(String(ordinal).padStart(2, '0'))}</span>` : ''}
    <h2>${rich(frame.title)}</h2>
    ${source && !['cover', 'section'].includes(archetype) ? `<p class="lecture-frame-source">${esc(source)}</p>` : ''}
  </header>`;
  const content = (coverSplit ? head : '') + original + copyBlocks + visibleBody + transcriptDetails;
  const visual = images + plot + diagrams;
  const copy = content ? `<div class="lecture-frame-copy">${content}</div>` : '';
  const media = visual ? `<div class="lecture-frame-visual">${visual}</div>` : '';
  const mediaFirst = layout === 'media-top' || layout === 'diagram-focus' || layout === 'split-left';
  const empty = !content && !visual && !frame.omittedImages;

  root.innerHTML = `<article class="lecture-frame${compact ? ' lecture-frame--compact' : ''}" data-lecture-layout="${layout}"${archetype ? ` data-archetype="${archetype}"` : ''}>
    ${coverSplit ? '' : head}
    ${empty ? '<p class="lecture-frame-empty">这页没有可显示的内容。</p>' : ''}
    ${frame.omittedImages ? '<p class="lecture-frame-empty">这页有裁剪过的原稿图片，当前无法完整还原。</p>' : ''}
    ${copy || media ? `<div class="lecture-frame-layout${split && copy && media ? ' lecture-frame-layout--split' : ''}">
      ${mediaFirst ? media + copy : copy + media}
    </div>` : ''}
  </article>`;
}

export function renderLectureStage(root, { lecture, index = 0, compact = false } = {}) {
  renderLectureFrame(root, lectureFrame(lecture, index), { compact });
}

export function fitPresentationContent(content, available, minZoom = 0.85) {
  if (!content || available <= 0) return;
  content.style.zoom = '1';
  let zoom = 1;
  for (let pass = 0; pass < 4 && zoom > minZoom; pass++) {
    const height = content.getBoundingClientRect().height;
    if (height <= available) break;
    zoom = Math.max(minZoom, zoom * available / height * .98);
    content.style.zoom = String(zoom);
  }
}

export function fitLectureSlide(slide, minZoom = 0.85) {
  const frame = slide?.querySelector('.lecture-frame');
  if (!frame) return;
  const coverImages = frame.matches('[data-archetype="cover"][data-lecture-layout="media-top"]')
    ? frame.querySelectorAll('.lecture-frame-visual img') : [];
  if (coverImages.length) frame.style.removeProperty('--cover-image-max-block-size');
  const available = slide.clientHeight - 3;
  const bodySize = parseFloat(getComputedStyle(frame).fontSize);
  const readableZoom = Math.min(1, 13 / bodySize);
  fitPresentationContent(frame, available, Math.max(minZoom, readableZoom));
  if (!coverImages.length || available <= 0) return;
  const overflow = frame.getBoundingClientRect().height - available;
  if (overflow <= 0) return;
  const tallest = Math.max(...Array.from(coverImages, image => image.getBoundingClientRect().height));
  const imageLimit = Math.max(56, (tallest - overflow) / Number(frame.style.zoom));
  frame.style.setProperty('--cover-image-max-block-size', `${imageLimit}px`);
}
