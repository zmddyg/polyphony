import { renderRichMathHtml } from '../core/math-render.mjs';
import { compileExpression, sampleDeclarativeCurve } from '../core/safe-expr.mjs';
import { esc } from '../ui.mjs';

const plot = { left: 55, right: 745, top: 30, bottom: 240, width: 690, height: 210 };
const colors = ['#45cebf', '#f2b45d'];
const svgNamespace = 'http://www.w3.org/2000/svg';
const cursorHint = '沿图移动或使用方向键读取坐标';
let clipSeq = 0;

const defaultParams = config => Object.fromEntries(config.sliders.map(s => [s.symbol, s.defaultValue]));
const fraction = (value, axis) => (value - axis.min) / (axis.max - axis.min);
const yOnPlot = (value, axis) => plot.bottom - fraction(value, axis) * plot.height;
const numberLabel = (value, digits = 6) => Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '—';
const axisStops = axis => [axis.min, axis.min / 2 + axis.max / 2, axis.max];
const axisLabel = axis => [axis.label, axis.unit].filter(Boolean).join(' · ');

function curvePaths(config, params) {
  const { xAxis: x, yAxis: y } = config;
  return config.curves.map(curve => {
    const points = sampleDeclarativeCurve({ expr: curve.expr, xVar: x.symbol, xMin: x.min, xMax: x.max, params, samples: 721 });
    return points.map((point, i) => {
      const px = plot.left + fraction(point.x, x) * plot.width;
      return `${i ? 'L' : 'M'}${px.toFixed(2)},${yOnPlot(point.y, y).toFixed(2)}`;
    }).join(' ');
  });
}

export function curveSvg(config, params = defaultParams(config)) {
  const { xAxis: x, yAxis: y } = config;
  const { left, right, top, bottom, width, height } = plot;
  const clipId = `curve-clip-${++clipSeq}`;
  const area = `x="${left}" y="${top}" width="${width}" height="${height}"`;
  const paths = curvePaths(config, params).map((d, i) => `<path data-curve="${i}" d="${d}" fill="none" stroke="${colors[i]}" stroke-width="3"${config.curves[i].style === 'dashed' ? ' stroke-dasharray="9 6"' : ''}/>`).join('');
  const xTicks = axisStops(x).map((value, i) => {
    const px = left + i * width / 2;
    return `<path d="M${px} ${top}V${bottom + 6}" stroke="#40516a"/><text x="${px}" y="263" text-anchor="${['start', 'middle', 'end'][i]}">${numberLabel(value, 4)}</text>`;
  }).join('');
  const yTicks = axisStops(y).map((value, i) => {
    const py = bottom - i * height / 2;
    const label = numberLabel(value, 4);
    const fit = label.length > 5 ? ' textLength="44" lengthAdjust="spacingAndGlyphs"' : '';
    return `<path d="M${left - 6} ${py}H${right}" stroke="#40516a"/><text x="${left - 8}" y="${py + 5}" text-anchor="end"${fit}>${label}</text>`;
  }).join('');
  const description = [config.formulaDisplay, axisLabel(x), axisLabel(y), cursorHint].join('。');
  return `<svg class="module-curve" viewBox="0 0 800 270" role="img" tabindex="0" aria-label="${esc(description)}">
    <defs><clipPath id="${clipId}"><rect ${area}/></clipPath></defs>
    <g fill="#b8c9e0" font-size="15">${xTicks}${yTicks}</g>
    <path d="M${left} ${top}V${bottom}H${right}" fill="none" stroke="#8093ad"/>
    <g clip-path="url(#${clipId})"><g data-curve-comparison></g>${paths}</g>
    <g data-curve-cursor visibility="hidden" pointer-events="none" aria-hidden="true">
      <path data-curve-guide fill="none" stroke="#d5e5f4" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
      ${config.curves.map((_, i) => `<circle data-curve-point="${i}" r="4.5" fill="${colors[i]}" stroke="#12233b" stroke-width="2"/>`).join('')}
    </g>
    <rect data-curve-plot ${area} fill="transparent"/>
  </svg>`;
}

export function paramExplorerHtml(config, { readonly = false } = {}) {
  const controls = readonly ? '' : `<button type="button" data-curve-pin aria-pressed="false">📌 锁定对照曲线</button><button type="button" data-curve-reset>复位默认参数</button>`;
  const sliders = readonly ? '' : `<div class="module-sliders">${config.sliders.map((s, i) => `<label>
    <span><span>${renderRichMathHtml(s.label)}</span><output data-slider-value="${i}"><span>${esc(s.defaultValue)}</span>${s.unit ? ` ${renderRichMathHtml(s.unit)}` : ''}</output></span>
    <input type="range" data-module-slider="${i}" aria-label="${esc(s.label)}" min="${esc(s.min)}" max="${esc(s.max)}" step="${esc(s.step)}" value="${esc(s.defaultValue)}">
  </label>`).join('')}</div>`;
  return `<section class="module-param">
    <div class="module-formula">${renderRichMathHtml(config.formulaDisplay, { block: true })}</div>
    <div data-curve-host>${curveSvg(config)}<p class="module-axis-label">${renderRichMathHtml(axisLabel(config.xAxis))}</p></div>
    <div class="module-legend">${config.curves.map((c, i) => `<span style="--curve:${colors[i]}">${renderRichMathHtml(c.label)}</span>`).join('')}<small>${renderRichMathHtml(axisLabel(config.yAxis))}</small></div>
    <div class="module-curve-tools">${controls}<output data-curve-readout aria-label="曲线坐标" aria-live="off">${cursorHint}</output></div>
    ${sliders}<p class="module-insight">${renderRichMathHtml(config.insightNote)}</p><p data-curve-error class="module-error" role="status"></p>
  </section>`;
}

const bindings = new WeakMap();
export function bindParamExplorer(root, config) {
  if (!root) return;
  const existing = bindings.get(root);
  if (existing) return existing;
  const { xAxis: x, yAxis: y } = config;
  const params = defaultParams(config);
  const svg = root.querySelector('.module-curve');
  const hitArea = svg.querySelector('[data-curve-plot]');
  const comparison = svg.querySelector('[data-curve-comparison]');
  const activePaths = [...svg.querySelectorAll('[data-curve]')];
  const cursor = svg.querySelector('[data-curve-cursor]');
  const guide = cursor.querySelector('[data-curve-guide]');
  const markers = [...cursor.querySelectorAll('[data-curve-point]')];
  const readout = root.querySelector('[data-curve-readout]');
  const errorStatus = root.querySelector('[data-curve-error]');
  const pin = root.querySelector('[data-curve-pin]');
  const stop = new AbortController();
  const listeners = { signal: stop.signal };
  const evaluators = config.curves.map(curve => compileExpression(curve.expr, [x.symbol, ...Object.keys(params)]).evaluate);
  let frame = 0, cursorX = null, plottedParams = { ...params };

  function readAt(px) {
    cursorX = px;
    const value = x.min + (px - plot.left) / plot.width * (x.max - x.min);
    const variables = { ...plottedParams, [x.symbol]: value };
    const readings = evaluators.map(evaluate => evaluate(variables));
    let line = `M${px} ${plot.top}V${plot.bottom}`;
    const guideIndex = readings.findIndex(reading => reading >= y.min && reading <= y.max);
    readings.forEach((reading, i) => {
      const marker = markers[i];
      const inRange = reading >= y.min && reading <= y.max;
      marker.setAttribute('visibility', inRange ? 'visible' : 'hidden');
      if (inRange) {
        const py = yOnPlot(reading, y);
        marker.setAttribute('cx', px);
        marker.setAttribute('cy', py);
        if (i === guideIndex) line += `M${plot.left} ${py}H${plot.right}`;
      }
    });
    guide.setAttribute('d', line);
    cursor.setAttribute('visibility', 'visible');
    readout.textContent = readings.map(reading => `(${numberLabel(value)}, ${numberLabel(reading)})`).join('  ·  ');
  }

  function hideCursor() {
    cursorX = null;
    cursor.setAttribute('visibility', 'hidden');
    markers.forEach(marker => marker.setAttribute('visibility', 'hidden'));
    readout.textContent = cursorHint;
  }

  function readPointer(event) {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const { x: px } = point.matrixTransform(matrix.inverse());
    if (Number.isFinite(px)) readAt(Math.max(plot.left, Math.min(plot.right, px)));
  }

  function updatePlot() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    try {
      const paths = curvePaths(config, params);
      paths.forEach((d, i) => activePaths[i].setAttribute('d', d));
      plottedParams = { ...params };
      if (cursorX !== null) readAt(cursorX);
      errorStatus.textContent = '';
      root.dispatchEvent(new CustomEvent('moduleparamschange', { bubbles: true, detail: { ...plottedParams } }));
      return true;
    } catch (error) {
      errorStatus.textContent = '当前参数被数值护栏拦截：' + error.message;
      return false;
    }
  }

  function setSlider(input, value) {
    const i = Number(input.dataset.moduleSlider), slider = config.sliders[i];
    params[slider.symbol] = value;
    root.querySelector(`[data-slider-value="${i}"] > span`).textContent = String(value);
  }

  root.addEventListener('input', event => {
    const input = event.target.closest('[data-module-slider]');
    if (!input) return;
    setSlider(input, Number(input.value));
    if (!frame) frame = requestAnimationFrame(updatePlot);
  }, listeners);
  pin?.addEventListener('click', () => {
    const pinned = pin.getAttribute('aria-pressed') === 'true';
    if (pinned) comparison.replaceChildren();
    else {
      if ((frame && !updatePlot()) || errorStatus.textContent) return;
      const ghosts = activePaths.map((path, i) => {
        const ghost = document.createElementNS(svgNamespace, 'path');
        ghost.setAttribute('data-ghost-curve', i);
        ghost.setAttribute('d', path.getAttribute('d'));
        ghost.setAttribute('fill', 'none');
        ghost.setAttribute('stroke', colors[i]);
        ghost.setAttribute('stroke-width', '3');
        ghost.setAttribute('stroke-dasharray', '7 5');
        ghost.setAttribute('opacity', '.55');
        return ghost;
      });
      comparison.replaceChildren(...ghosts);
    }
    pin.setAttribute('aria-pressed', String(!pinned));
    pin.textContent = pinned ? '📌 锁定对照曲线' : '清除对照';
  }, listeners);
  root.querySelector('[data-curve-reset]')?.addEventListener('click', () => {
    root.querySelectorAll('[data-module-slider]').forEach((input, i) => {
      const value = config.sliders[i].defaultValue;
      input.value = value;
      setSlider(input, value);
    });
    updatePlot();
  }, listeners);
  hitArea.addEventListener('pointermove', readPointer, listeners);
  hitArea.addEventListener('pointerdown', readPointer, listeners);
  hitArea.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse') hideCursor();
  }, listeners);
  svg.addEventListener('keydown', event => {
    const px = cursorX ?? plot.left + plot.width / 2;
    const step = plot.width / 100;
    const positions = { ArrowLeft: Math.max(plot.left, px - step), ArrowRight: Math.min(plot.right, px + step), Home: plot.left, End: plot.right };
    if (!Object.hasOwn(positions, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    readAt(positions[event.key]);
  }, listeners);
  svg.addEventListener('blur', hideCursor, listeners);

  const dispose = () => {
    if (bindings.get(root) !== dispose) return;
    cancelAnimationFrame(frame);
    stop.abort();
    bindings.delete(root);
  };
  bindings.set(root, dispose);
  return dispose;
}

export function stepFaultHtml(lesson,state={}, {selectable=false,selectedId=''}={}) {
  const c=lesson.moduleConfig, reveal=['reveal','branch','closed'].includes(state.phase);
  const responses=(state.responses??[]).filter(r=>r.round===state.round);
  const total=responses.length;
  const first=(state.responses??[]).filter(r=>r.round===1);
  return `<section class="module-artifact" data-artifact-lang="${esc(c.artifactLang)}"><header><strong>${renderRichMathHtml(c.artifactTitle)}</strong><span>${selectable?'点击你认为存在漏洞的那一步':'逐行证据审计'}</span></header><ol>${c.steps.map(s=>{
    const share=total?Math.round(responses.filter(r=>r.optionId===s.id).length/total*100):0;
    const prior=first.length?Math.round(first.filter(r=>r.optionId===s.id).length/first.length*100):0;
    const correct=reveal && s.id===c.faultStepId;
    const content = c.artifactLang === 'code' ? `<code>${esc(s.content)}</code>`
      : `<span class="module-step-copy">${renderRichMathHtml(s.content, { block: c.artifactLang === 'math' })}</span>`;
    return `<li class="${correct?'is-fault':''}" style="--share:${reveal?share:0}%"><${selectable?'button':'div'} ${selectable?`type="button" data-step-select="${esc(s.id)}" aria-pressed="${selectedId===s.id}"`:''} class="module-step"><b>${esc(s.line)}</b>${content}${reveal?`<em>${state.round===2?prior+'% → ':''}${share}% 怀疑此步${correct?' · 漏洞定位':''}</em>`:''}</${selectable?'button':'div'}></li>`;
  }).join('')}</ol>${reveal?`<p class="module-diagnosis">${renderRichMathHtml(c.faultDiagnosis??'')}</p>`:''}</section>`;
}
export function aiPeerHtml(lesson,state={}, {teacher=false,standalone=false}={}) {
  const c=lesson.moduleConfig;
  const shown=standalone || state.aiPeerRevealed;
  return `<section class="module-evidence"><div class="module-dimensions">${c.dimensions.map(d=>`<span>${renderRichMathHtml(d)}</span>`).join('')}</div>${teacher?`<button type="button" class="module-peer-toggle" data-module-peer aria-pressed="${shown}">🤖 ${shown?'收起':'亮出'}盲盒 AI 辩友观点（供全班质询证伪）</button>`:''}${shown&&c.aiPeer?`<article class="module-peer"><header>🤖 ${renderRichMathHtml(c.aiPeer.persona)} <small>待质询观点</small></header><blockquote>${renderRichMathHtml(c.aiPeer.claim)}</blockquote><details><summary>查看原页证伪线索</summary><p>${renderRichMathHtml(c.aiPeer.flawHint)}</p></details></article>`:''}</section>`;
}
export function moduleHtml(lesson,state={},options={}) {
  if(!lesson.moduleConfig) return '';
  if(lesson.activityId==='param-explorer@1') return paramExplorerHtml(lesson.moduleConfig,options);
  if(lesson.activityId==='step-fault@1') return stepFaultHtml(lesson,state,options);
  if(lesson.activityId==='evidence-weighing@1') return aiPeerHtml(lesson,state,options);
  return '';
}
export function bindModule(root,lesson,ctx={}) {
  const disposers=[];
  if(lesson.activityId==='param-explorer@1') root.querySelectorAll('.module-param').forEach(el=>disposers.push(bindParamExplorer(el,lesson.moduleConfig)));
  root.querySelectorAll('[data-module-peer]').forEach(button=>{
    const toggle=()=>ctx.command?.('toggleAiPeer');
    button.onclick=toggle;
    disposers.push(()=>{if(button.onclick===toggle)button.onclick=null;});
  });
  return ()=>disposers.forEach(dispose=>dispose?.());
}
