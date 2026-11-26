import { buildSciencePacket, formatScienceNumber, reviewRcSolution, scienceModels } from '../core/teaching-science.mjs';
import { esc, icon } from '../ui.mjs';
import { formatFormulaHtml as formulaHtml, formulaPlain } from '../core/formula-text.mjs';

const curveColors = ['#0B4F6C', '#047857', '#92400E'];
const draftsByAnchor = new Map();
const sectionNames = ['题页', '解答', '数值曲线'];

function curveSeries(slide) {
  const items = Array.isArray(slide.series) && slide.series.length > 0
    ? slide.series
    : [{ points: slide.points }];
  return items.map((item, index) => ({
    label: item?.label,
    color: /^#[0-9a-f]{6}$/i.test(item?.color) ? item.color : curveColors[index % curveColors.length],
    points: (Array.isArray(item?.points) ? item.points : []).filter(point =>
      Number.isFinite(point?.x) && Number.isFinite(point?.y)),
  })).filter(item => item.points.length > 1);
}

function outsideTick(value) {
  if (value === 0) return 0;
  const quantum = 10 ** Math.floor(Math.log10(Math.abs(value)));
  const rounded = Math.sign(value) * Math.ceil(Math.abs(value) / quantum) * quantum;
  return Number.isFinite(rounded) ? rounded : value;
}

function chartScale(series, key, includeZero = false) {
  let lower = includeZero ? 0 : Infinity;
  let upper = includeZero ? 0 : -Infinity;
  for (const { points } of series) {
    for (const point of points) {
      lower = Math.min(lower, point[key]);
      upper = Math.max(upper, point[key]);
    }
  }
  if (includeZero) {
    lower = outsideTick(lower);
    upper = outsideTick(upper);
  }
  const unit = Math.max(Math.abs(lower), Math.abs(upper)) || 1;
  const from = lower / unit;
  const span = upper / unit - from || 1;
  return {
    at: value => (value / unit - from) / span,
    label: fraction => formatScienceNumber((from + fraction * span) * unit, 4),
  };
}

// Used by both the editing preview and projector. The coordinates are numeric
// and there is no interaction, image request, or document access here.
export function renderScienceChart(slide = {}) {
  const series = curveSeries(slide);
  if (!series.length) return '';
  const xScale = chartScale(series, 'x');
  const yScale = chartScale(series, 'y', true);
  const left = 84, right = 487, top = 12, bottom = 166;
  const chartX = fraction => left + (right - left) * fraction;
  const chartY = fraction => bottom - (bottom - top) * fraction;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const graph = ticks.map(fraction => {
    const x = chartX(fraction);
    const y = chartY(fraction);
    return `<path class="psci-grid" d="M${left} ${y}H${right}M${x} ${top}V${bottom}"/>
      <text x="${left - 10}" y="${y + 5}" text-anchor="end">${yScale.label(fraction)}</text>
      <text x="${x}" y="${bottom + 23}" text-anchor="middle">${xScale.label(fraction)}</text>`;
  }).join('');
  const plots = series.map(({ points, color }, index) => {
    const path = points.map(({ x, y }, at) =>
      `${at ? 'L' : 'M'}${chartX(xScale.at(x)).toFixed(2)} ${chartY(yScale.at(y)).toFixed(2)}`,
    ).join(' ');
    return `<path class="psci-series" d="${path}" stroke="${color}" ${index % 2 ? 'stroke-dasharray="8 5"' : ''}/>`;
  }).join('');
  const legend = series.map(({ label, color }, index) => label
    ? `<span><i ${index % 2 ? 'class="psci-dash"' : ''} style="border-color:${color}" aria-hidden="true"></i>${esc(label)}</span>`
    : '').join('');
  const description = formulaPlain([slide.title, slide.yLabel, slide.xLabel, ...series.map(item => item.label)].filter(Boolean).join(' · '));
  return `<figure class="psci-chart">
    <figcaption><span>${formulaHtml(slide.yLabel || '')}</span>${legend ? `<div class="psci-legend">${legend}</div>` : ''}</figcaption>
    <svg viewBox="0 0 530 201" role="img" aria-label="${esc(description || '数值曲线')}">
      ${graph}<path class="psci-axis" d="M${left} ${top}V${bottom}H${right}"/>${plots}
    </svg>
    ${slide.xLabel ? `<p class="psci-x-label">${formulaHtml(slide.xLabel)}</p>` : ''}
  </figure>`;
}

function fieldMarkup(field, values) {
  const bounds = field.min == null ? '' : `min="${field.min}" max="${field.max}"`;
  const label = ({resistanceKohm:'负载电阻 R_L',capacitancePf:'总电容 C_tot',initialV:'初始电压 V_0',finalV:'稳态电压 V∞'})[field.key] ?? field.label;
  return `<label class="psci-field"><span>${formulaHtml(label)}</span><span class="psci-value">
    <input type="number" required name="${field.key}" step="any" ${bounds} value="${esc(values[field.key])}">
    <span aria-hidden="true">${esc(field.unit)}</span><span class="visually-hidden">单位 ${esc(field.unit)}</span>
  </span></label>`;
}

export function renderRcDualCharts(packet) {
  const { initialV, finalV } = packet.parameters;
  const tau = packet.solution.timeConstant.value;
  const time = { title:'时域电容充电',xLabel:'t (μs)',yLabel:'V_C (V)', points:Array.from({length:81},(_,i)=>({x:i*tau/16,y:finalV+(initialV-finalV)*Math.exp(-i/16)})) };
  const frequency = { title:'频域电压波特图',xLabel:'log₁₀ f (Hz)',yLabel:'|H(f)| (dB)',points:Array.from({length:81},(_,i)=>{const x=3+i/20;return {x,y:-10*Math.log10(1+(2*Math.PI*10**x*tau*1e-6)**2)};}) };
  return `<section class="psci-dual" aria-label="RC 时域与频域同构"><div><h4>时域充电 · 初值连续</h4>${renderScienceChart(time)}</div><div><h4>电压波特图 · τ 唯一决定</h4>${renderScienceChart(frequency)}</div></section>`;
}

function reviewMarkup(checks) {
  return `<dl class="psci-check-list">${checks.map(({ label, passed, expected, observed }) => `<div>
    <dt>${formulaHtml(label)}</dt><dd>${observed && observed !== expected
      ? `<span>解答 ${formulaHtml(observed)}</span><span>题设要求 ${formulaHtml(expected)}</span>`
      : formulaHtml(expected)}</dd>
    <dd class="psci-check-state" data-passed="${passed}">${passed ? '通过' : '未通过'}</dd>
  </div>`).join('')}</dl>`;
}

function oldSolutionMarkup(packet, previous) {
  if (!previous || packet.model !== 'rc') return '';
  const checks = reviewRcSolution(packet.parameters, previous.solution);
  const failed = checks.filter(check => !check.passed);
  return `<aside class="psci-previous" data-failed="${Boolean(failed.length)}">
    <strong>${failed.length ? '旧解未通过校验' : '旧解仍符合当前题设'}</strong>
    ${failed.length ? `<ul>${failed.map(({ label, observed, expected }) =>
      `<li>${formulaHtml(label)}应为 ${formulaHtml(expected)}，旧解给出 ${formulaHtml(observed)}。</li>`).join('')}</ul>` : ''}
    <details>
      <summary>复核旧解的四项条件</summary>
      <p class="psci-formula">${formulaHtml(previous.formula)}</p>
      ${reviewMarkup(checks)}
    </details>
  </aside>`;
}

function sameParameters(first, second) {
  return first.model === second?.model &&
    Object.entries(first.parameters).every(([key, value]) => value === second.parameters?.[key]);
}

function retainedPacket(adoptedPacket, anchor, model) {
  return adoptedPacket?.kind === 'science' && adoptedPacket.anchor?.id === anchor.id &&
    adoptedPacket.model === model && adoptedPacket.parameters
    ? adoptedPacket : null;
}

export function mountMaterialScience(root, { anchor, onAdopt, adoptedPacket, model } = {}) {
  let validated;
  try {
    validated = buildSciencePacket({ anchor });
  } catch (error) {
    root.innerHTML = `<p class="psci-feedback" data-error="true">${esc(error.message)}</p>`;
    return;
  }
  const original = validated.anchor;
  let draft = draftsByAnchor.get(original.id);
  if (!draft) {
    const savedModel = adoptedPacket?.anchor?.id === original.id && Object.hasOwn(scienceModels, adoptedPacket.model)
      ? adoptedPacket.model : 'rc';
    draft = { model: savedModel, runs: new Map() };
    draftsByAnchor.set(original.id, draft);
  }
  if (Object.hasOwn(scienceModels, model)) draft.model = model;

  function render(focus, message = '') {
    const { model, runs } = draft;
    const fields = scienceModels[model].fields;
    let run = runs.get(model);
    if (!run) {
      const saved = retainedPacket(adoptedPacket, original, model);
      let packet;
      try {
        packet = model === 'rc' && !saved ? validated
          : buildSciencePacket({ model, anchor: original, parameters: saved?.parameters });
      } catch {
        packet = buildSciencePacket({ model, anchor: original });
      }
      run = { packet, previous: null, selected: 0 };
      runs.set(model, run);
    } else if (run.packet.anchor.title !== original.title || run.packet.anchor.page !== original.page ||
      run.packet.anchor.materialId !== original.materialId) {
      run.packet = buildSciencePacket({ model, anchor: original, parameters: run.packet.parameters });
    }
    const { packet } = run;
    const allPassed = packet.checks.every(check => check.passed);
    root.innerHTML = `<section class="psci" aria-label="理工科例题">
      <div class="psci-guardrail">🛡️ 确定性物理内核驱动 · 四维量纲与守恒律硬核验</div>
      <header class="psci-header">
        <div><h3>可验算物理例题</h3><p>${icon('book', 15)}<span>${formulaHtml(packet.slides[0].source)}</span></p></div>
        <label class="psci-model"><span>例题模板</span><select data-science-model>
          ${Object.entries(scienceModels).map(([id, item]) => `<option value="${id}" ${id === model ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}
        </select></label>
        <button type="button" class="plain-button" data-science-focus>审计总览 / 返回原页</button>
      </header>
      <form class="psci-settings" data-science-settings novalidate>
        <div class="psci-fields">${fields.map(field => fieldMarkup(field, packet.parameters)).join('')}</div>
        <div class="psci-actions">
          <button class="plain-button" data-science-calculate>重新计算</button>
          ${model === 'rc' ? `<button type="button" class="plain-button" data-science-demo>⚡ 演示防错审计：初值改为 ${packet.parameters.initialV === 2 ? '0' : '2'} V（拦截过时旧解）</button>` : ''}
        </div>
        <p class="psci-feedback" data-science-feedback role="status" aria-live="polite">${formulaHtml(message)}</p>
      </form>
      ${oldSolutionMarkup(packet, run.previous)}
      <details class="psci-audit">
        <summary>${icon(allPassed ? 'check' : 'circle', 17)}当前解答 · ${packet.checks.filter(check => check.passed).length} / ${packet.checks.length} 项通过</summary>
        ${reviewMarkup(packet.checks)}
      </details>
      <div class="psci-result">
        <div class="psci-sections" role="group" aria-label="例题预览">${sectionNames.map((name, index) =>
          `<button type="button" data-science-section="${index}" aria-pressed="false">${name}</button>`).join('')}</div>
        <div class="psci-slide" data-science-slide></div>
      </div>
      ${model === 'rc' ? renderRcDualCharts(packet) : ''}
      ${typeof onAdopt === 'function' ? `<div class="psci-footer">
        <button type="button" class="action-primary" data-science-adopt>${icon('plus', 17)}采用到当前讲义页</button>
      </div>` : ''}
    </section>`;

    const form = root.querySelector('[data-science-settings]');
    root.querySelector('[data-science-focus]').onclick = () => root.closest('.mw-workspace')?.classList.toggle('mw-audit-focus');
    const modelPicker = root.querySelector('[data-science-model]');
    const status = root.querySelector('[data-science-feedback]');
    const calculate = form.querySelector('[data-science-calculate]');
    const demo = root.querySelector('[data-science-demo]');
    const use = root.querySelector('[data-science-adopt]');
    const previews = root.querySelectorAll('[data-science-section]');
    const slideHost = root.querySelector('[data-science-slide]');
    const slideMarkup = [];
    let shown = -1;
    let dirty = false;
    let adopting = false;

    function showFeedback(text, error = false) {
      if (status.textContent !== text) status.innerHTML = formulaHtml(text);
      if (status.dataset.error !== String(error)) status.dataset.error = String(error);
    }

    function updateControls() {
      modelPicker.disabled = adopting;
      calculate.disabled = adopting;
      if (demo) demo.disabled = dirty || adopting;
      if (use) use.disabled = dirty || adopting || !allPassed;
    }

    function showSlide() {
      const index = run.selected;
      if (shown === index) return;
      previews[shown]?.setAttribute('aria-pressed', 'false');
      previews[index].setAttribute('aria-pressed', 'true');
      const slide = packet.slides[index];
      slideMarkup[index] ??= `<h4>${formulaHtml(slide.title)}</h4>
        ${slide.body.map(line => `<p>${formulaHtml(line)}</p>`).join('')}${renderScienceChart(slide)}`;
      slideHost.innerHTML = slideMarkup[index];
      shown = index;
    }

    function commit(values, focusTarget) {
      if (adopting) return;
      try {
        const next = buildSciencePacket({ model, anchor: original, parameters: values });
        if (!sameParameters(packet, next)) {
          run.previous = packet;
          run.packet = next;
        }
        run.selected = 1;
        render(focusTarget, '已按当前参数重新计算。');
      } catch (error) {
        showFeedback(error.message, true);
      }
    }

    modelPicker.addEventListener('change', event => {
      draft.model = event.target.value;
      render('[data-science-model]');
    });
    form.addEventListener('input', () => {
      const changed = fields.some(field => form.elements.namedItem(field.key).value !== String(packet.parameters[field.key]));
      if (dirty !== changed) {
        dirty = changed;
        updateControls();
      }
      showFeedback(dirty ? '参数已编辑，重新计算后即可采用。' : '');
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      commit(Object.fromEntries(new FormData(form)), '[data-science-calculate]');
    });
    demo?.addEventListener('click', () => commit({
      ...packet.parameters, initialV: packet.parameters.initialV === 2 ? 0 : 2,
    }, '[data-science-demo]'));
    previews.forEach(button => button.addEventListener('click', () => {
      run.selected = Number(button.dataset.scienceSection);
      showSlide();
    }));
    use?.addEventListener('click', async () => {
      if (use.disabled) return;
      adopting = true;
      updateControls();
      try {
        if (await onAdopt(packet) === false) return;
        showFeedback('题页、解答和数值曲线已采用到当前讲义页。');
      } catch (error) {
        showFeedback(error?.message || '当前讲义页采用失败。', true);
      } finally {
        adopting = false;
        updateControls();
      }
    });
    showSlide();
    updateControls();
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
  }

  render();
}
