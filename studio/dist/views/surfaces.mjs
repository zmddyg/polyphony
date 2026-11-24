import { curveGraphic } from '../core/optics.mjs';
import { getActivity } from '../core/activities.mjs';

const phaseLabels = { collect: '收集中', reveal: '结果已公布', branch: '分支讨论', closed: '已结课' };
const chartColors = ['#92acff', '#73dfcd', '#f6c681', '#d8a7fd', '#a1d0ff'];
const renderedStages = new WeakMap();

function summarize(state, collecting) {
  if (collecting && state.responseCount != null && state.simulatedResponseCount != null) {
    return { count: state.responseCount, simulated: state.simulatedResponseCount };
  }
  const counts = new Map();
  let count = 0;
  let simulated = 0;
  for (const response of state.responses) {
    if (response.round !== state.round) continue;
    count++;
    if (response.simulated) simulated++;
    if (!collecting) counts.set(response.optionId, (counts.get(response.optionId) ?? 0) + 1);
  }
  return {
    count: state.responseCount ?? count,
    simulated: state.simulatedResponseCount ?? simulated,
    options: collecting ? [] : state.lesson.options.map(option => ({ ...option, count: counts.get(option.id) ?? 0 })),
  };
}

function choiceList(options, esc) {
  return `<ol class="stage-choices" aria-label="作答选项">${options.map((option, index) => `
    <li><span aria-hidden="true">${String.fromCharCode(65 + index)}</span><span>${esc(option.label)}</span></li>`).join('')}</ol>`;
}

function distribution({ count, options }, esc) {
  if (!count) return '<p class="stage-empty">本轮没有收到作答。</p>';
  return `<ol class="stage-distribution" aria-label="作答分布">${options.map((option, index) => {
    const percent = Math.round(option.count / count * 100);
    return `<li><span class="stage-option-letter" aria-hidden="true">${String.fromCharCode(65 + index)}</span>
      <div class="stage-option-result"><span>${esc(option.label)}</span>
      <div class="stage-result-track" aria-hidden="true"><span style="--ratio:${option.count / count * 100}%;--bar:${chartColors[index % chartColors.length]}"></span></div></div>
      <div class="stage-result-count"><strong>${percent}%</strong><small>${option.count} 票</small></div></li>`;
  }).join('')}</ol>`;
}

function participation(count, total, compact) {
  return `<div class="stage-response-count${compact ? ' is-compact' : ''}">
    <div><strong>${count}</strong><span> / ${total} 人已提交</span></div>
    ${total > 0 ? `<progress value="${count}" max="${total}" aria-label="本轮作答进度"></progress>` : '<p class="stage-empty">等待学生加入。</p>'}
  </div>`;
}

function stageCurve(state, collecting) {
  const showB = state.decision?.branchId === 'energy' && !collecting;
  const samples = state.samples ?? state.responses.filter(response => response.round === state.round && response.sample);
  const simulated = samples.filter(sample => sample.simulated).length;
  return `<figure class="stage-curve">
    <div class="stage-axis">归一化光强</div>
    ${curveGraphic(samples, { reveal: !collecting, showB, dark: true })}
    <div class="stage-axis stage-axis-x">相位差 Δφ</div>
    <figcaption>
      ${samples.length > simulated || !simulated ? `<span><i class="stage-plot-dot"></i>现场预测 ${samples.length - simulated}</span>` : ''}
      ${simulated ? `<span><i class="stage-plot-dot is-simulated"></i>模拟预测 ${simulated}</span>` : ''}
      ${collecting ? '' : '<span><i class="stage-plot-line"></i>A 端理论</span>'}
      ${showB ? '<span><i class="stage-plot-line is-b"></i>B 端理论</span>' : ''}
    </figcaption>
  </figure>`;
}

export function renderStage(root, ctx) {
  const { state, esc, icon } = ctx;
  if (!state?.lesson) return;
  const { lesson } = state;
  const round = Number(state.round) || 1;
  const collecting = state.phase === 'collect';
  const isInterference = getActivity(lesson)?.scene === 'mzi';
  const result = summarize(state, collecting);
  const selectedBranch = state.decision && lesson.branches.find(branch => branch.id === state.decision.branchId);
  const prompt = state.revisionPrompt || (round > 1 && selectedBranch ? `${selectedBranch.description}\n${lesson.prompt}` : lesson.prompt) || lesson.description;
  const joining = collecting && !result.count;
  const footer = result.simulated
    ? `本轮 ${result.count - result.simulated} 份现场作答 · ${result.simulated} 份模拟作答`
    : joining ? (ctx.mode === 'local' ? '请教师在同一浏览器打开学生端。' : '可扫码或凭课堂码加入。') : `本轮共收到 ${result.count} 份作答`;
  const reconnecting = ctx.mode === 'server' && ctx.connected === false;
  const regions = {
    topic: `<div class="stage-meta"><span>${esc(lesson.subject || '课堂互动')}</span><span>第 ${round} 轮</span>${state.demo ? '<span class="stage-rehearsal">样本排练</span>' : ''}</div>
        <h1 id="stage-lesson">${esc(lesson.title)}</h1>
        <p class="stage-prompt">${esc(prompt)}</p>
        ${collecting ? choiceList(lesson.options, esc) : ''}
        ${selectedBranch ? `<div class="stage-decision"><span>讨论方向</span><strong>${esc(selectedBranch.title)}</strong>${state.phase === 'branch' ? `<p>${esc(selectedBranch.description)}</p>` : ''}</div>` : ''}`,
    heading: `<h2 id="stage-panel-title">${isInterference ? '全班干涉曲线' : collecting ? '作答进度' : '作答分布'}</h2>
        <span class="stage-phase" data-phase="${esc(state.phase)}"><i aria-hidden="true"></i>${phaseLabels[state.phase] || ''}</span>`,
    plot: isInterference ? stageCurve(state, collecting) : '',
    result: (isInterference && !collecting ? '<h3 class="stage-distribution-title">选项分布</h3>' : '') +
      (collecting ? participation(result.count, state.participants.length, isInterference) : distribution(result, esc)),
    footer,
  };
  let stage = renderedStages.get(root.firstElementChild);
  if (!stage || stage.code !== state.code) {
    root.innerHTML = `
      <div class="stage-page">
        <header class="stage-header">
          <div class="stage-brand"><img src="./assets/mark.svg" alt=""><strong>共演</strong><span>课堂投影</span></div>
          <div class="stage-actions">
            <div class="stage-room"><span>课堂码</span><strong>${esc(state.code)}</strong></div>
            <button type="button" class="stage-control" data-invite data-focus="stage-invite" aria-label="邀请学生" title="邀请学生">${icon('scan', 19)}<span>邀请学生</span></button>
            <button type="button" class="stage-control" data-fullscreen data-focus="stage-fullscreen">${icon('maximize', 19)}<span>全屏</span></button>
          </div>
        </header>
        <p class="stage-connection" role="status"${reconnecting ? '' : ' hidden'}>正在连接课堂 · 画面将在连接恢复后更新</p>
        <div class="stage-body${isInterference ? ' stage-interference' : ''}">
          <section class="stage-topic" data-stage-region="topic" aria-labelledby="stage-lesson">${regions.topic}</section>
          <section class="stage-panel" aria-labelledby="stage-panel-title">
            <header class="stage-panel-head" data-stage-region="heading">${regions.heading}</header>
            <div data-stage-region="plot" style="display:contents">${regions.plot}</div>
            <div data-stage-region="result" style="display:contents">${regions.result}</div>
            <footer class="stage-foot" data-stage-region="footer">${regions.footer}</footer>
          </section>
        </div>
      </div>`;
    const fullscreen = root.querySelector('[data-fullscreen]');
    const fullscreenLabel = fullscreen.querySelector('span');
    const paintFullscreen = () => {
      const label = document.fullscreenElement ? '退出全屏' : '全屏';
      if (fullscreen.title === label) return;
      fullscreenLabel.textContent = label;
      fullscreen.setAttribute('aria-label', label);
      fullscreen.title = label;
    };
    stage = {
      code: state.code,
      body: root.querySelector('.stage-body'),
      connection: root.querySelector('.stage-connection'),
      nodes: Object.fromEntries(Object.keys(regions).map(name => [name, root.querySelector(`[data-stage-region="${name}"]`)])),
      regions,
      paintFullscreen,
      cleanup: () => document.removeEventListener('fullscreenchange', paintFullscreen),
    };
    renderedStages.set(root.firstElementChild, stage);
    root.querySelector('[data-invite]').onclick = () => stage.ctx.invite();
    fullscreen.onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        stage.ctx.toast('当前浏览器无法进入全屏。');
      }
    };
  } else {
    for (const [name, html] of Object.entries(regions)) {
      if (stage.regions[name] !== html) stage.nodes[name].innerHTML = html;
    }
    const hideConnection = !reconnecting;
    if (stage.connection.hidden !== hideConnection) stage.connection.hidden = hideConnection;
    stage.body.classList.toggle('stage-interference', isInterference);
    stage.regions = regions;
  }
  stage.ctx = ctx;
  stage.paintFullscreen();
  document.addEventListener('fullscreenchange', stage.paintFullscreen);
  return stage.cleanup;
}
