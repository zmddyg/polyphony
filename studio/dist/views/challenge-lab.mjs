import { advanceChallenge, angularStep, blindAngles, challengeNames, diagnoses, fullCurveRms, initialSamples, lightAt, newChallenge, pointCount, presetTarget, probes, publicChallenge, rcReading, voteChoices } from '../core/challenge-lab.mjs';

const renderedChallenges = new WeakMap();
const percent = value => Number((100 * value).toFixed(1)) + '%';
const points = value => Number((100 * value).toFixed(1)) + ' 个百分点';
const primary = (action, label) => `<button type="button" class="cx-primary" data-cx-action="${action}">${label}</button>`;
const summary = (title, text) => `<p class="cx-summary"><b>${title}</b>${text}</p>`;
const plot = {left: 52, right: 642, top: 27, bottom: 229};
const plotX = degrees => plot.left + degrees / 360 * (plot.right - plot.left);
const plotY = value => plot.bottom - value * (plot.bottom - plot.top);
const modelName = model => model.order === 1 ? '单周期干涉仪' : '双周期干涉仪';
const trace = (count, sample) => Array.from({length: count + 1}, (_, i) =>
  `${i ? 'L' : 'M'}${plotX(360 * i / count).toFixed(2)} ${plotY(sample(i)).toFixed(2)}`).join(' ');
const targetTrace = target => trace(pointCount, i => target[i % pointCount]);
const presetLabels = {double: '双峰', single: '单谷', flat: '平顶脉冲'};
const canOperate = role => role === 'teacher' || role === 'solo';

function choices(items, action, state, role) {
  const ballots = role !== 'solo';
  const live = role !== 'stage';
  return `<div class="cx-choices">${items.map(({id, label}) => {
    const count = ballots ? `<span class="cx-count" data-cx-count="${id}">${state.counts[id] ?? 0} 票</span>` : '<span aria-hidden="true">↗</span>';
    const mark = role === 'student' ? `<span class="cx-picked"${state.myVote === id ? '' : ' hidden'}>已投</span>` : '';
    const content = `<span>${label}</span><span class="cx-choice-end">${mark}${count}</span>`;
    return live
      ? `<button type="button" data-cx-action="${role === 'student' ? 'vote' : action}" data-cx-value="${id}" ${role === 'student' ? 'aria-pressed="' + (state.myVote === id) + '"' : ''}>${content}</button>`
      : `<div class="cx-choice-static">${content}</div>`;
  }).join('')}</div>`;
}

function ballotHint(role) {
  if (role === 'student') return '<p class="cx-hint">点选即可投票。教师确认前可以改票。</p>';
  if (role === 'stage') return '<p class="cx-hint">在学生端投票，等教师确认全班的选择。</p>';
  if (role === 'teacher') return '<p class="cx-hint">学生端可投票。点一个选项，确定全班的选择。</p>';
  return '';
}

function rcCircuit(state) {
  const result = probes.find(item => item.id === state.probe);
  return `<figure class="cx-instrument">
    <figcaption><span>RC 故障台</span><span>理想阶跃 · 5 V</span></figcaption>
    <svg class="cx-circuit" viewBox="0 0 620 260" role="img" aria-label="5 伏阶跃电源串联标称 10 千欧电阻与 100 纳法电容；电容初始电压为零。">
      <g fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M105 112V66H234l7-10 10 20 10-20 10 20 10-20 10 20 7-10H458V129M458 145v61H105v-42"/>
        <circle cx="105" cy="138" r="26"/><path d="M97 128h16m-8-8v16m-8 15h16M434 129h48m-48 16h48"/>
      </g>
      <g fill="currentColor" font-family="inherit" font-size="17">
        <text x="264" y="36" text-anchor="middle">R · 标称 10 kΩ</text><text x="419" y="146" text-anchor="end">C · 标称 100 nF</text>
        <text x="105" y="239" text-anchor="middle">5 V</text>
      </g>
    </svg>
    <div class="cx-meter"><span>${result ? result.label : '仪表读数'}</span><strong>${result ? state.reading.toFixed(2) + ' ' + result.unit : '待测量'}</strong></div>
  </figure>`;
}

function rcBody(state, role) {
  const operate = canOperate(role);
  let heading, body;
  if (state.step === 'measure') {
    heading = '这次测什么？';
    body = choices(probes, 'measure', state, role) + ballotHint(role);
  } else if (state.step === 'diagnose') {
    heading = '这条读数支持哪种判断？';
    body = choices(diagnoses, 'diagnose', state, role) + ballotHint(role);
  } else {
    const unit = probes.find(item => item.id === state.probe).unit;
    const selected = diagnoses.find(item => item.id === state.choice).label;
    const why = {
      early: '两台电路的时间常数都是 2 ms。即使把整条电容充电曲线都录下来，它们仍会重合。',
      steady: '充稳后电流降为零，两台的电容两端都是电源电压。这个读数留下了两个解释。',
      current: '刚接通时电容电压为零，初始电流由 5 V 除以电阻决定。这两个预测可以当场分开。',
    }[state.probe];
    heading = state.answer === state.choice ? '判断与读数相符' : '再看看另一台电路';
    body = `<p class="cx-copy">${role === 'solo' ? '你的判断' : '全班的判断'}是「${selected}」。把同一次测量放到两台候选电路上：</p>
      <table class="cx-table"><thead><tr><th>候选故障</th><th>预测读数</th><th>符合实测</th></tr></thead>
      <tbody>${diagnoses.slice(0, 2).map(item => `<tr><th>${item.label}</th><td>${rcReading(item.id, state.probe).toFixed(2)} ${unit}</td><td>${state.compatible.includes(item.id) ? '符合' : '排除'}</td></tr>`).join('')}</tbody></table>
      <p class="cx-copy">${why}</p>${operate ? primary('reset', '换一台电路') : ''}`;
  }
  return rcCircuit(state) + `<section class="cx-controls"><h3 tabindex="-1">${heading}</h3>${body}</section>`;
}

function graph(state, editable) {
  const model = state.model ?? state.firstModel;
  const samples = state.step === 'refit' ? [...initialSamples, state.angle / angularStep] : initialSamples;
  const axisText = (x, y, anchor, label) => `<text x="${x}" y="${y}" text-anchor="${anchor}">${label}</text>`;
  const marker = i => `<circle cx="${plotX(i * angularStep)}" cy="${plotY(state.target[i])}" r="5" class="cx-dot"/>`;
  const hasTest = state.angle !== undefined;
  return `<figure class="cx-instrument">
    <figcaption><span>A 口归一化光功率</span><span>扫描角度 θ</span></figcaption>
    <svg data-cx-plot viewBox="0 0 670 268" class="cx-chart${editable ? ' cx-editable' : ''}" role="img" aria-label="${editable ? '目标曲线，可用鼠标、触摸或下方的逐点编辑器修改。' : '目标与机器预测随扫描角度的曲线。'}">
      <g class="cx-grid">${[0,.25,.5,.75,1].map(v => `<path d="M${plot.left} ${plotY(v)}H${plot.right}"/>`).join('')}${[0,90,180,270,360].map(d => `<path d="M${plotX(d)} ${plot.top}V${plot.bottom}"/>`).join('')}</g>
      <g class="cx-axis">${[0,.5,1].map(v => axisText(plot.left-8, plotY(v)+4, 'end', percent(v))).join('')}${[0,90,180,270,360].map(d => axisText(plotX(d), 254, 'middle', d+'°')).join('')}</g>
      <path class="cx-target" data-cx-target d="${targetTrace(state.target)}"/>
      ${model ? `<path class="cx-model" d="${trace(180, i => lightAt(model, i * 2))}"/>` : ''}
      <g data-cx-dots>${samples.map(marker).join('')}</g>
      ${hasTest ? `<path class="cx-blind-line" d="M${plotX(state.angle)} ${plot.top}V${plot.bottom}"/><circle class="cx-observed" cx="${plotX(state.angle)}" cy="${plotY(state.observed)}" r="7"/>` : ''}
    </svg>
    <div class="cx-legend"><span><i class="cx-legend-target"></i>目标曲线</span>${model ? '<span><i class="cx-legend-model"></i>机器预测</span>' : ''}<span><i class="cx-legend-dot"></i>给机器的点</span></div>
  </figure>`;
}

function editPanel() {
  return `<p class="cx-copy">在图上画一笔，或选一条现成的曲线。机器第一次只能得到 0°、120°、240° 的三个读数。</p>
    <div class="cx-presets">${Object.entries(presetLabels).map(([id,label]) => `<button type="button" data-cx-preset="${id}" aria-pressed="${id==='double'}">${label}</button>`).join('')}</div>
    <details class="cx-details"><summary>逐点编辑曲线</summary><div class="cx-point-editor"><label>角度 <select data-cx-index>${Array.from({length:pointCount},(_,i) => `<option value="${i}">${i * angularStep}°</option>`).join('')}</select></label>
    <label>光功率 <output data-cx-power></output><input type="range" data-cx-range min="0" max="100" step="1" aria-label="所选角度的目标光功率"></label></div></details>
    ${primary('fit','只给三个点，让机器拟合')}`;
}

function opticalBody(state, role) {
  const operate = canOperate(role);
  let title, body;
  if (state.step === 'draw') {
    title = operate ? '给机器出一道题' : '正在出题';
    body = operate ? editPanel() : '<p class="cx-copy">教师正在准备目标曲线。第一轮拟合后，你可以为机器选一个盲测点。</p>';
  } else if (state.step === 'blind') {
    title = '在哪儿验它一次？';
    body = summary(modelName(state.firstModel), '已锁定预测。三个已知点的均方根误差为 ' + points(state.firstModel.trainingRms) + '。') +
      '<p class="cx-copy">挑一个机器没见过的角度，让它报出光功率，再和你画的曲线核对。</p>' +
      choices(blindAngles.map(d => ({id:String(d), label:d+'°'})), 'test', state, role) + ballotHint(role);
  } else {
    const refit = state.step === 'refit';
    title = refit ? '加入第四个点之后' : state.angle + '° 的盲测结果';
    const miss = Math.abs(state.predicted - state.observed);
    body = `<dl class="cx-readings"><div><dt>原预测</dt><dd>${percent(state.predicted)}</dd></div><div><dt>目标</dt><dd>${percent(state.observed)}</dd></div></dl>`;
    if (!refit) {
      body += '<p class="cx-copy">在 ' + state.angle + '°，原预测与目标相差 <strong>' + points(miss) + '</strong>。</p>';
      if (operate) body += primary('refit', '给它第四个点，再拟合');
    } else {
      const model = state.model;
      body += summary(modelName(model), '重算后，在 ' + state.angle + '° 预测 ' + percent(lightAt(model, state.angle)) + '。') +
        '<p class="cx-copy">对照完整的 24 个目标点，均方根误差从 ' + points(fullCurveRms(state.firstModel, state.target)) + ' 变为 ' + points(fullCurveRms(model, state.target)) + '。</p>';
      if (operate) body += primary('reset', '再画一条曲线');
    }
  }
  const model = state.model ?? state.firstModel;
  const modelText = '<details class="cx-details"><summary>机器可以搭什么光路？</summary><p>一个理想等分干涉仪与一个衰减器。旋钮转过 θ，两臂相位差为 kθ + φ。机器比较 k = 1、2 和 360 个整度偏置 φ，对每组求最合适的透过率 η（0 至 1）。</p><p>A 口功率 P = η[1 + cos(kθ + φ)] / 2。已知点上平方误差相同时，优先选单周期。</p>' +
    (model ? '<p>本轮参数　k = ' + model.order + '，φ = ' + model.bias + '°，η = ' + model.gain.toFixed(3) + '。</p>' : '') + '</details>';
  return graph(state, operate && state.step === 'draw') + `<section class="cx-controls"><h3 tabindex="-1">${title}</h3>${body}${modelText}</section>`;
}

function enableDrawing(root, target) {
  const svg = root.querySelector('[data-cx-plot]');
  const path = svg.querySelector('[data-cx-target]');
  const dots = svg.querySelector('[data-cx-dots]').children;
  const select = root.querySelector('[data-cx-index]');
  const slider = root.querySelector('[data-cx-range]');
  const power = root.querySelector('[data-cx-power]');
  const presets = Array.from(root.querySelectorAll('[data-cx-preset]'));
  const syncSlider = () => {
    const value = Math.round(target[Number(select.value)] * 100);
    slider.value = value;
    power.textContent = value + '%';
  };
  let frame = null;
  let preset;
  let paintedPreset = 'double';
  const redraw = nextPreset => {
    preset = nextPreset;
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!svg.isConnected) return;
      path.setAttribute('d', targetTrace(target));
      initialSamples.forEach((i, j) => {
        const position = String(plotY(target[i]));
        if (dots[j].getAttribute('cy') !== position) dots[j].setAttribute('cy', position);
      });
      if (preset !== paintedPreset) {
        presets.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cxPreset === preset)));
        paintedPreset = preset;
      }
      syncSlider();
    });
  };
  for (const b of presets) b.onclick = () => {
    target.splice(0, target.length, ...presetTarget(b.dataset.cxPreset));
    redraw(b.dataset.cxPreset);
  };
  select.onchange = syncSlider;
  slider.oninput = () => {target[Number(select.value)] = Number(slider.value) / 100; redraw();};
  let last, pointer;
  const move = (event, start = false) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const {x, y} = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    if (start && (x < plot.left-6 || x > plot.right+6 || y < plot.top-6 || y > plot.bottom+6)) return;
    const index = Math.round(Math.max(0, Math.min(1, (x-plot.left)/(plot.right-plot.left))) * pointCount);
    const value = Math.round(100 * Math.max(0, Math.min(1, (plot.bottom-y)/(plot.bottom-plot.top)))) / 100;
    if (start) {pointer = event.pointerId; svg.setPointerCapture(pointer);}
    if (last && last.index !== index) {
      const direction = Math.sign(index-last.index);
      for (let i = last.index+direction; i !== index; i += direction) {
        target[i % pointCount] = last.value + (value-last.value) * (i-last.index)/(index-last.index);
      }
    }
    target[index % pointCount] = value;
    select.value = String(index % pointCount);
    last = {index, value};
    redraw();
  };
  svg.onpointerdown = event => { if (event.button === 0 && pointer == null) move(event, true); };
  svg.onpointermove = event => { if (event.pointerId === pointer) move(event); };
  svg.onlostpointercapture = () => {pointer = null; last = null;};
  syncSlider();
}

function sameBallot(prior, state) {
  if (state.peer?.choice !== prior.peer?.choice || state.peer?.reason !== prior.peer?.reason) return false;
  if (state.step === 'measure') return true;
  if (state.step === 'diagnose') return state.probe === prior.probe && state.reading === prior.reading;
  if (state.step !== 'blind') return false;
  return state.target.length === prior.target.length &&
    state.target.every((value, index) => value === prior.target[index]) &&
    ['order', 'bias', 'gain', 'trainingRms'].every(key => state.firstModel[key] === prior.firstModel[key]);
}

function updateBallots(ballots, state) {
  for (const ballot of ballots) {
    const count = state.counts[ballot.id] ?? 0;
    if (count !== ballot.count) {
      ballot.count = count;
      ballot.label.textContent = count + ' 票';
    }
    const selected = state.myVote === ballot.id;
    const hidden = !selected;
    if (ballot.picked && ballot.picked.hidden !== hidden) {
      ballot.picked.hidden = hidden;
      ballot.button.setAttribute('aria-pressed', String(selected));
    }
  }
}

export function renderChallenge(root, state, {role = 'solo', turn = 0, action, vote, askPeer, report} = {}) {
  const prior = renderedChallenges.get(root);
  const editable = state.step === 'draw' && canOperate(role);
  const handlers = {action, vote, askPeer, report};
  if (prior && prior.shell === root.firstElementChild && prior.turn === turn && prior.role === role &&
      prior.state.kind === state.kind && prior.state.step === state.step) {
    if (editable) {
      prior.handlers = handlers;
      return;
    }
    if (prior.ballots.length && Boolean(prior.handlers.askPeer) === Boolean(askPeer) && sameBallot(prior.state, state)) {
      prior.handlers = handlers;
      updateBallots(prior.ballots, state);
      prior.state = state;
      return;
    }
  }
  const previousButton = root.contains(document.activeElement) ? document.activeElement.dataset : null;
  const draft = editable ? [...state.target] : null;
  const rc = state.kind === 'rc';
  const note = rc ? '电阻或电容有一个变成了标称值的两倍。电容从 0 V 开始充电，全班只有一次测量机会。' :
    '你决定想要的光强。机器用三个点搭一台干涉仪，再由你挑一个没给过它的点验收。';
  root.innerHTML = `<article class="cx-shell"><header class="cx-heading"><h2>${challengeNames[state.kind]}</h2><p>${note}</p></header>
    <div class="cx-grid-layout">${rc ? rcBody(state, role) : opticalBody(state, role)}</div></article>`;
  const ballots = Array.from(root.querySelectorAll('[data-cx-count]'), label => {
    const id = label.dataset.cxCount;
    const button = role === 'student' ? label.closest('button') : null;
    return {id, label, button, picked: button?.querySelector('.cx-picked'), count: state.counts[id] ?? 0};
  });
  const rendered = {turn, role, state, handlers, ballots, shell: root.firstElementChild};
  renderedChallenges.set(root, rendered);
  if (draft) enableDrawing(root, draft);
  const options = voteChoices(state);
  if (state.peer && options.length) {
    const note = document.createElement('aside');
    note.className='cx-peer';
    const label=document.createElement('strong');
    const words=document.createElement('p');
    label.textContent='AI 同桌选了「'+options.find(item=>item.id===state.peer.choice).label+'」';
    words.textContent=state.peer.reason;
    note.append(label,words);
    root.querySelector('.cx-controls').append(note);
  } else if (role === 'teacher' && askPeer && options.length) {
    const button = document.createElement('button');
    button.type='button';
    button.className='cx-peer-button';
    button.textContent='让 AI 同桌也选一次';
    button.onclick=async()=>{
      button.disabled=true;
      button.textContent='AI 同桌正在作答…';
      try {await rendered.handlers.askPeer();}
      catch(error){rendered.handlers.report?.(error.message);}
      finally {button.disabled=false;button.textContent='让 AI 同桌也选一次';}
    };
    root.querySelector('.cx-controls').append(button);
  }
  root.querySelectorAll('[data-cx-action]').forEach(button => {
    button.onclick = () => {
      const {cxAction, cxValue} = button.dataset;
      if (cxAction === 'vote') return rendered.handlers.vote?.(cxValue);
      return rendered.handlers.action?.({action: cxAction, value: cxValue, ...(cxAction === 'fit' ? {target: [...draft]} : {})});
    };
  });
  if (previousButton?.cxAction) {
    const same = Array.from(root.querySelectorAll('[data-cx-action]')).find(b => b.dataset.cxAction === previousButton.cxAction && b.dataset.cxValue === previousButton.cxValue);
    (same ?? root.querySelector('.cx-controls h3'))?.focus({preventScroll: true});
  }
}

export function renderSoloChallenge(root, kind) {
  let state = newChallenge(kind);
  let turn = 0;
  function paint() {
    renderChallenge(root, publicChallenge(state), {turn, action(payload) {
      state = advanceChallenge(state, payload);
      turn++;
      paint();
    }});
  }
  paint();
}
