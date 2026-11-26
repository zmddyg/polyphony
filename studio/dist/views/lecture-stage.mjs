import { isEmbeddedLectureImage, lectureFrame } from '../core/lecture-score.mjs';
import { esc } from '../ui.mjs';
import { formulaHtml } from '../core/formula-text.mjs';
import { renderScienceChart } from './material-science.mjs';
import { validateSlideBlocks } from '../core/lecture-score.mjs';

// Tokenize before escaping: generated text can never become an HTML attribute or tag.
export function highlightedCode(source) {
  const token=/(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:int|void|char|float|double|const|return|if|for|while|sizeof|NULL|struct|size_t)\b|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b)/g;
  let end=0,out='';
  for(const m of source.matchAll(token)) {out+=esc(source.slice(end,m.index));const type=m[0].startsWith('//')?'comment':/^["']/.test(m[0])?'string':/^\d/.test(m[0])?'number':'keyword';out+='<span class="syntax-'+type+'">'+esc(m[0])+'</span>';end=m.index+m[0].length;}
  return out+esc(source.slice(end));
}
export function renderSlideBlocks(blocks) {
  const snippet=b=>`<section class="slide-code"><h3>${esc(b.title)}</h3><pre><code>${highlightedCode(b.code)}</code></pre></section>`;
  return validateSlideBlocks(blocks).map(b=>{
    const title=b.title?`<h3>${esc(b.title)}</h3>`:'';
    if(b.type==='code')return snippet(b);
    if(b.type==='code-pair')return `<div class="slide-code-pair">${snippet(b.left)}${snippet(b.right)}</div>`;
    if(b.type==='table')return `<section class="slide-table">${title}<table><thead><tr>${b.headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')}</tr></thead><tbody>${b.rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')}</tbody></table></section>`;
    if(b.type==='callout')return `<aside class="slide-callout slide-callout--${b.tone}">${title}<p>${esc(b.text)}</p></aside>`;
    if(b.type==='formula')return `<section class="slide-formula">${title}${b.items.map(i=>'<p>'+formulaHtml(i)+'</p>').join('')}</section>`;
    if(b.type==='chart')return `<section class="slide-chart">${title}${renderScienceChart(b)}</section>`;
    if(b.type==='stat-grid')return `<section class="slide-stats">${b.items.map(i=>'<div><b>'+esc(i.value)+'</b><span>'+esc(i.label)+'</span></div>').join('')}</section>`;
    const tag=b.type==='steps'?'ol':'ul';
    return `<section class="slide-list">${title}<${tag}>${b.items.map(i=>'<li>'+esc(i)+'</li>').join('')}</${tag}></section>`;
  }).join('');
}

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
  const body = frame.body.length ? `<div class="lecture-frame-text">${frame.body.map(line => `<p>${formulaHtml(line)}</p>`).join('')}</div>` : '';
  const preview = isEmbeddedLectureImage(frame.preview);
  const images = preview ? '' : renderImages(frame.images);
  const plot = frame.series?.length || frame.points?.length ? renderScienceChart(frame) : '';
  const visual = images + plot;
  const content = preview && body ? `<details class="lecture-frame-transcript"><summary>查看原页文字</summary>${body}</details>` : body;
  const blocks=frame.blocks?.length?'<div class="slide-blocks">'+renderSlideBlocks(frame.blocks)+'</div>':'';
  const empty = !preview && !body && !visual && !blocks && !frame.omittedImages;

  root.innerHTML = `<article class="lecture-frame${compact ? ' lecture-frame--compact' : ''}">
    <header class="lecture-frame-head">
      <h2>${esc(frame.title)}</h2>
      <p class="lecture-frame-source">${esc(source)}</p>
    </header>
    ${preview ? `<figure class="lecture-frame-original"><img src="${esc(frame.preview)}" alt="${esc(`原稿第 ${frame.pageNumber} 页：${frame.title}`)}" decoding="async"></figure>` : ''}
    ${empty ? '<p class="lecture-frame-empty">这页没有可显示的内容。</p>' : ''}
    ${frame.omittedImages ? '<p class="lecture-frame-empty">这页有裁剪过的原稿图片，当前无法完整还原。</p>' : ''}
    ${blocks}
    ${content || visual ? `<div class="lecture-frame-layout${body && visual && !preview ? ' lecture-frame-layout--split' : ''}">
      ${content}
      ${visual ? `<div class="lecture-frame-visual">${visual}</div>` : ''}
    </div>` : ''}
  </article>`;
}

export function renderLectureStage(root, { lecture, index = 0, compact = false } = {}) {
  renderLectureFrame(root, lectureFrame(lecture, index), { compact });
}
