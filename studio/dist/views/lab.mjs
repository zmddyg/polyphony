import { getLesson } from '../core/catalog.mjs';
import { icon } from '../ui.mjs';
import { renderSoloChallenge } from './challenge-lab.mjs';
import { buildLectureScore } from '../core/lecture-score.mjs';

const hypotheses = [
  { name: '平方规则', formula: 'x²', predict: (x) => x * x },
  { name: '倍增规则', formula: '2x', predict: (x) => 2 * x },
];
const choices = [-2, -1, 0, 1, 2, 3, 4];
const shared = [{ x: 0, y: 0 }, { x: 2, y: 4 }];
const phases = [0, 90, 180, 270, 360];
const experiments = [
  { id: 'blackbox', label: '数字黑箱', icon: 'target', lesson: 'blackbox' },
  { id: 'optics', label: '光路干涉', icon: 'network', lesson: 'mzi' },
  { id: 'rc', label: '只准测一次', icon: 'lab', topic: '一阶 RC 电路', question: '电容从零开始充电，电阻或电容有一个翻倍。只有一次仪表读数，怎么选？' },
  { id: 'light', label: '曲线挑战', icon: 'target', topic: '马赫–曾德尔干涉仪', question: '根据三个角度的光功率，能确定干涉仪在哪些角度会变暗吗？' },
];

const powerAt = (phase) => Math.cos(phase * Math.PI / 360) ** 2;
const plotX = (phase) => 38 + phase;
const plotY = (power) => 130 - 108 * power;
const formatInput = (value) => value < 0 ? '−' + Math.abs(value) : value;

let classroomLaunch;

function button(label, action, { primary = false, disabled = false, glyph = '' } = {}) {
  return `<button type="button" class="lab-button${primary ? ' lab-primary' : ''}" data-lab-action="${action}" ${disabled ? 'disabled' : ''}>
    ${glyph ? icon(glyph, 16) : ''}<span>${label}</span>
  </button>`;
}

function predictionsAgree(input) {
  return hypotheses[0].predict(input) === hypotheses[1].predict(input);
}

function opticalDiagram() {
  return `<svg class="lab-optical-diagram" viewBox="0 0 564 204" role="img" aria-label="光经过两个分束器，分别沿两臂传播，合束后到达 A 口与 B 口">
    <g class="lab-beam-guides" fill="none">
      <path d="M38 104H131L190 51H351L411 104M131 104l59 53h161l60-53"/>
      <path d="M411 104l55-39h53m-108 39 55 39h53"/>
    </g>
    <g class="lab-beam-input" fill="none">
      <path d="M38 104H131L190 51H351L411 104M131 104l59 53h161l60-53"/>
    </g>
    <g fill="none">
      <path data-lab-beam="a" d="M411 104l55-39h53"/>
      <path data-lab-beam="b" d="M411 104l55 39h53"/>
    </g>
    <g class="lab-couplers">
      <rect x="122" y="95" width="18" height="18" rx="3" transform="rotate(45 131 104)"/>
      <rect x="402" y="95" width="18" height="18" rx="3" transform="rotate(45 411 104)"/>
    </g>
    <circle class="lab-source-light" cx="38" cy="104" r="4"/>
    <circle data-lab-detector="a" cx="519" cy="65" r="5"/>
    <circle data-lab-detector="b" cx="519" cy="143" r="5"/>
    <g class="lab-diagram-labels" font-size="14">
      <text x="38" y="133" text-anchor="middle">入射光</text>
      <text x="270" y="34" text-anchor="middle">上臂</text>
      <text x="270" y="181" text-anchor="middle">下臂</text>
      <text x="519" y="46" text-anchor="middle">A 口</text>
      <text x="519" y="170" text-anchor="middle">B 口</text>
    </g>
  </svg>`;
}

let opticalCurves;

function plotCurves() {
  const samples = Array.from({ length: 73 }, (_, step) => powerAt(step * 5));
  const path = other => samples.map((power, index) =>
    `${index ? 'L' : 'M'}${plotX(index * 5)} ${plotY(other ? 1 - power : power).toFixed(2)}`).join(' ');
  return { a: path(false), b: path(true) };
}

function renderOpticalPlot() {
  opticalCurves ??= plotCurves();
  return `<figure class="lab-pane lab-plot">
    <figcaption><h3>光强与相位差</h3>
      <div class="lab-plot-legend"><span data-port="a">A 口 <code>cos²(Δφ/2)</code></span><span data-port="b">B 口 <code>sin²(Δφ/2)</code></span></div>
    </figcaption>
    <svg viewBox="0 0 422 158" role="img" aria-label="归一化光强曲线。相位差为 0 到 360 度时，A 口由 100% 降至 0% 后回升，B 口与它互补。">
      <g class="lab-plot-grid">
        ${[0, .5, 1].map((power) => `<line x1="38" x2="398" y1="${plotY(power)}" y2="${plotY(power)}"/>`).join('')}
        ${phases.map((phase) => `<line x1="${plotX(phase)}" x2="${plotX(phase)}" y1="22" y2="130"/>`).join('')}
      </g>
      <g class="lab-plot-labels" font-size="12">
        ${[0, .5, 1].map((power) => `<text x="32" y="${plotY(power) + 4}" text-anchor="end">${100 * power}%</text>`).join('')}
        ${phases.map((phase) => `<text x="${plotX(phase)}" y="150" text-anchor="middle">${phase}°</text>`).join('')}
      </g>
      <path class="lab-curve lab-curve-a" d="${opticalCurves.a}"/>
      <path class="lab-curve lab-curve-b" d="${opticalCurves.b}"/>
      <g data-lab-plot-marker transform="translate(38 0)">
        <line class="lab-plot-cursor" x1="0" x2="0" y1="16" y2="132"/>
        <circle class="lab-point-a" data-lab-point="a" cx="0" cy="22" r="4"/>
        <circle class="lab-point-b" data-lab-point="b" cx="0" cy="130" r="4"/>
      </g>
    </svg>
  </figure>`;
}

function portMeter(port, name) {
  return `<div class="lab-port" data-port="${port}">
    <label for="lab-meter-${port}">${name} 口</label><strong data-lab-power="${port}" aria-hidden="true"></strong>
    <meter id="lab-meter-${port}" min="0" max="100" value="0"></meter>
  </div>`;
}

function opticalControls(root) {
  return {
    slider: root.querySelector('#lab-phase'),
    angle: root.querySelector('#lab-phase-value'),
    marker: root.querySelector('[data-lab-plot-marker]'),
    presets: new Map(Array.from(root.querySelectorAll('[data-lab-phase]'),
      preset => [Number(preset.dataset.labPhase), preset])),
    ports: ['a', 'b'].map(port => ({
      power: root.querySelector(`[data-lab-power="${port}"]`),
      meter: root.querySelector(`#lab-meter-${port}`),
      beam: root.querySelector(`[data-lab-beam="${port}"]`),
      detector: root.querySelector(`[data-lab-detector="${port}"]`),
      point: root.querySelector(`[data-lab-point="${port}"]`),
    })),
  };
}

export function renderLab(root, ctx) {
  let tab = ctx.tab === 'mzi' ? 'optics' : experiments.find(item => item.id === ctx.tab)?.id ?? 'blackbox';
  let source = 0;
  let input = 3;
  let registered = false;
  let observedOutput = null;
  let showSource = false;
  let phase = 0;
  let optics;
  let rows = [];
  let message = '';

  const view = document.createElement('div');
  const announcements = document.createElement('div');
  announcements.className = 'lab-announcer';
  announcements.setAttribute('role', 'status');
  announcements.setAttribute('aria-atomic', 'true');
  root.replaceChildren(view, announcements);

  function render() {
    view.innerHTML = `
      <section class="lab-screen" aria-labelledby="lab-title">
        <header class="lab-heading">
          <div><h1 id="lab-title">学科实验</h1><p>先试做实验，再将活动带入课堂。</p></div>
          ${button('带入课堂', 'teach', { primary: true, glyph: 'arrow-up-right' })}
        </header>
        <nav class="lab-tabs" aria-label="切换实验">
          ${experiments.map(({ id, label, icon: glyph }) => `<button type="button" data-lab-action="${id}" aria-pressed="${tab === id}" aria-controls="lab-experiment">${icon(glyph, 17)}${label}</button>`).join('')}
        </nav>
        ${tab === 'blackbox' ? renderBlackbox() : tab === 'optics' ? renderOptics() : '<section id="lab-experiment"></section>'}
      </section>`;
    syncClassroomControl();
    optics = tab === 'optics' ? opticalControls(view) : undefined;
    if (optics) updatePhase(phase);
    if (tab === 'rc' || tab === 'light') renderSoloChallenge(view.querySelector('#lab-experiment'), tab);
  }

  function renderBlackbox() {
    const candidates = hypotheses.filter(({ predict }) => rows.every(({ x, y }) => predict(x) === y));
    return `<section id="lab-experiment" class="lab-grid" aria-labelledby="lab-experiment-title">
      <div class="lab-pane lab-control">
        <h2 id="lab-experiment-title">盒子里是哪条规则？</h2>
        <p class="lab-intro">表中的两组初始观测符合两条规则。选择输入并登记预测，再运行机器。</p>
        <fieldset class="lab-inputs">
          <legend>输入数字</legend>
          ${choices.map((choice) => `<label><input type="radio" name="lab-input" value="${choice}" ${choice === input ? 'checked' : ''}><span>${formatInput(choice)}</span></label>`).join('')}
        </fieldset>
        <div class="lab-predictions" role="group" aria-label="两条规则的预测">
          ${hypotheses.map((hypothesis) => {
            const matches = candidates.includes(hypothesis);
            return `<div class="lab-prediction" data-eliminated="${!matches}">
              <div class="lab-hypothesis"><span>${hypothesis.name}</span><code>${hypothesis.formula}</code></div>
              <strong>${registered ? formatInput(hypothesis.predict(input)) : '<span aria-hidden="true">—</span><span class="lab-announcer">等待登记预测</span>'}</strong>
              <span class="lab-hypothesis-status">${matches ? (candidates.length === 1 ? '与观测相符' : '待验证') : '已排除'}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="lab-actions">
          ${button('登记预测', 'predict', { primary: !registered })}
          ${button('运行机器', 'run', { primary: registered, disabled: !registered, glyph: 'play' })}
        </div>
        ${message ? `<p class="lab-feedback">${message}</p>` : ''}
      </div>
      <div class="lab-evidence">
        <section class="lab-instrument" aria-label="黑箱实时输出">
          <header><h3>黑箱运行</h3><span class="lab-instrument-status">${observedOutput === null ? '等待运行' : '已运行'}</span></header>
          <div class="lab-flow">
            <div class="lab-terminal"><span>输入 <i>x</i></span><strong>${formatInput(input)}</strong></div>
            <span class="lab-flow-arrow" aria-hidden="true">${icon('arrow-right', 20)}</span>
            <div class="lab-machine" aria-hidden="true">${icon('layers', 26)}<span>黑箱</span></div>
            <span class="lab-flow-arrow" aria-hidden="true">${icon('arrow-right', 20)}</span>
            <div class="lab-terminal lab-terminal-output"><span>机器输出</span><strong>${observedOutput === null ? '—' : formatInput(observedOutput)}</strong></div>
          </div>
        </section>
        ${renderObservations()}
      </div>
    </section>`;
  }

  function renderObservations() {
    return `<section class="lab-pane lab-records" aria-labelledby="lab-records-title">
      <header><h3 id="lab-records-title">观测记录</h3><span>${shared.length + rows.length} 条</span></header>
      <div class="lab-table-wrap" role="region" aria-labelledby="lab-records-title" tabindex="0">
        <table aria-labelledby="lab-records-title">
          <thead><tr><th scope="col">输入 x</th><th scope="col">机器输出</th><th scope="col">x²</th><th scope="col">2x</th><th scope="col">能否区分</th></tr></thead>
          <tbody>${[...shared, ...rows].map(({ x, y }, index) => `<tr${index < shared.length ? ' class="lab-seed"' : ''}>
            <th scope="row">${formatInput(x)}</th><td class="lab-actual">${formatInput(y)}</td>
            ${hypotheses.map(({ predict }) => {
              const prediction = predict(x);
              const mismatch = prediction !== y;
              return `<td${mismatch ? ' class="lab-mismatch"' : ''}>${formatInput(prediction)}${mismatch ? ' <span aria-label="与观测不符">×</span>' : ''}</td>`;
            }).join('')}
            <td>${predictionsAgree(x) ? '否' : '能'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="lab-record-actions">
        <button class="lab-text-button" type="button" data-lab-action="source" aria-controls="lab-source" aria-expanded="${showSource}">${showSource ? '隐藏机器规则' : '查看机器规则'}${icon('chevron-down', 14)}</button>
        <button class="lab-text-button" type="button" data-lab-action="reset">${icon('replay', 15)}重置实验</button>
      </div>
      <p id="lab-source" class="lab-feedback" ${showSource ? '' : 'hidden'}>机器当前使用${hypotheses[source].name} <code>${hypotheses[source].formula}</code>。重置后将切换规则。</p>
    </section>`;
  }

  function renderOptics() {
    return `<section id="lab-experiment" class="lab-grid" aria-labelledby="lab-experiment-title">
      <div class="lab-pane lab-control">
        <h2 id="lab-experiment-title">光路干涉</h2>
        <p class="lab-intro">改变马赫–曾德尔干涉仪两臂的相位差，观察两个出口的光强。</p>
        <div class="lab-phase">
          <div class="lab-phase-label"><label for="lab-phase">两臂相位差 Δφ</label><span id="lab-phase-value"></span></div>
          <input type="range" id="lab-phase" min="0" max="360" step="1" value="${phase}">
          <div class="lab-presets" role="group" aria-label="预设相位差">
            ${phases.map((angle) => `<button type="button" data-lab-phase="${angle}" aria-label="${angle} 度" aria-pressed="${phase === angle}">${angle}°</button>`).join('')}
          </div>
        </div>
        <div class="lab-ports" role="group" aria-label="出口光强">${portMeter('a', 'A')}${portMeter('b', 'B')}</div>
        <p class="lab-model-note">理想无损模型中，两个出口的光强之和等于入射光强。</p>
      </div>
      <div class="lab-evidence">
        <section class="lab-instrument lab-optical-instrument" aria-labelledby="lab-optical-title">
          <header><h3 id="lab-optical-title">干涉仪光路</h3></header>
          ${opticalDiagram()}
        </section>
        ${renderOpticalPlot()}
      </div>
    </section>`;
  }

  function updatePhase(nextPhase) {
    const { slider, angle, marker, presets, ports } = optics;
    if (phase !== nextPhase) {
      presets.get(phase)?.setAttribute('aria-pressed', 'false');
      presets.get(nextPhase)?.setAttribute('aria-pressed', 'true');
    }
    phase = nextPhase;
    slider.value = phase;
    slider.setAttribute('aria-valuetext', `${phase} 度`);
    angle.textContent = `${phase}°`;
    marker.setAttribute('transform', `translate(${plotX(phase)} 0)`);

    const powerA = powerAt(phase);
    const displayedA = Math.round(powerA * 1000) / 10;
    const displayedB = Math.round((100 - displayedA) * 10) / 10;
    for (const [{ power, meter, beam, detector, point }, ratio, percent] of
      [[ports[0], powerA, displayedA], [ports[1], 1 - powerA, displayedB]]) {
      power.textContent = `${percent}%`;
      meter.value = percent;
      beam.style.opacity = ratio;
      detector.style.opacity = .3 + .7 * ratio;
      point.setAttribute('cy', plotY(ratio));
    }
  }

  function syncClassroomControl() {
    const control = view.querySelector('[data-lab-action="teach"]');
    control.disabled = Boolean(classroomLaunch);
    control.querySelector('span').textContent = classroomLaunch ? '正在创建课堂…' : '带入课堂';
  }

  async function launchClassroom(trigger) {
    if (classroomLaunch) return;
    const experiment = experiments.find(({ id }) => id === tab);
    const hadFocus = trigger === document.activeElement;
    classroomLaunch = Promise.resolve()
      .then(() => {
        if (experiment.lesson) return ctx.startLesson(getLesson(experiment.lesson));
        return ctx.startLecture(buildLectureScore({name:experiment.label, kind:'text', pages:[
          {number:1, title:experiment.topic, text:experiment.question},
        ]}));
      })
      .catch(() => ctx.toast('无法创建实验课堂，请重试。'))
      .finally(() => { classroomLaunch = undefined; });
    syncClassroomControl();
    announcements.textContent = '正在创建实验课堂。';
    await classroomLaunch;
    if (!view.isConnected) return;
    syncClassroomControl();
    if (hadFocus && document.activeElement === document.body) trigger.focus();
  }

  render();
  classroomLaunch?.then(() => { if (view.isConnected) syncClassroomControl(); });
  view.addEventListener('input', (event) => {
    if (event.target.id === 'lab-phase') updatePhase(Number(event.target.value));
  });
  view.addEventListener('change', (event) => {
    if (event.target.name !== 'lab-input') return;
    input = Number(event.target.value);
    registered = false;
    observedOutput = null;
    message = '';
    announcements.textContent = '';
    render();
    view.querySelector(`input[name="lab-input"][value="${input}"]`)?.focus();
  });
  view.addEventListener('click', (event) => {
    const preset = event.target.closest('[data-lab-phase]');
    if (preset) {
      updatePhase(Number(preset.dataset.labPhase));
      return;
    }
    const trigger = event.target.closest('[data-lab-action]');
    if (!trigger) return;
    const action = trigger.dataset.labAction;
    switch (action) {
      case 'teach':
        void launchClassroom(trigger);
        return;
      case 'blackbox':
      case 'optics':
      case 'rc':
      case 'light':
        if (tab === action) return;
        tab = action;
        break;
      case 'predict':
        registered = true;
        message = predictionsAgree(input) ? '两条规则的预测相同。还可以试试其他输入。' : '两条规则的预测不同。运行机器，比较实际输出。';
        break;
      case 'run': {
        if (!registered) return;
        observedOutput = hypotheses[source].predict(input);
        if (![...shared, ...rows].some(({ x }) => x === input)) rows.push({ x: input, y: observedOutput });
        message = predictionsAgree(input)
          ? `机器输出 ${formatInput(observedOutput)}。这次观测不能区分两条规则。`
          : `机器输出 ${formatInput(observedOutput)}。结果符合${hypotheses[source].name}，排除了另一条规则。`;
        break;
      }
      case 'source':
        showSource = !showSource;
        break;
      case 'reset':
        source = 1 - source;
        rows = [];
        registered = false;
        observedOutput = null;
        showSource = false;
        input = 3;
        message = '实验已重置。请选择输入，重新检验两条规则。';
        break;
      default:
        return;
    }
    render();
    if (['predict', 'run', 'reset'].includes(action)) announcements.textContent = message;
    const focusAction = action === 'predict' ? 'run' : action;
    view.querySelector(`[data-lab-action="${focusAction}"]`)?.focus();
  });
}
