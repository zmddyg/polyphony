import { drawCandidates } from '../core/engine.mjs';
import { getActivity } from '../core/activities.mjs';
import { sceneGraphic } from './visuals.mjs';

const renderedDesks = new WeakMap();
const pendingDesks = new WeakMap();
const timeline = ['首轮作答', '公布证据', '分支讨论', '再次作答', '结课'];
const phaseLabels = { collect: '收集作答', reveal: '结果已公开', branch: '分支讨论', closed: '已结课' };
const eventSymbols = {
  room: 'radio', join: 'users', respond: 'list', reveal: 'layers',
  analyze: 'sparkles', branch: 'git-branch', revise: 'arrow-right',
  close: 'check', draw: 'shuffle', demoFill: 'users',
};
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

function analysisLabel(source) {
  return source === 'provider' ? '模型评议' : '本地规则评议';
}

function eventDetail(event) {
  const { detail } = event;
  if (typeof detail === 'string') return detail;
  if (!detail) return '';
  if (event.type === 'demoFill') return `第 ${detail.round} 轮 · ${detail.count} 份模拟作答`;
  if (event.type === 'branch') return detail.title;
  if (event.type === 'analyze' && detail.source) return analysisLabel(detail.source);
  if (event.type === 'draw' && detail.eligibleCount) {
    const source = detail.eligibleSource === 'simulated' ? '模拟' : '现场';
    return `${detail.eligibleCount} 位${source}答题者参与`;
  }
  if (['reveal', 'revise', 'close'].includes(event.type)) return `第 ${detail.round} 轮`;
  return '';
}

function eventTime(at) {
  if (!at || (typeof at === 'number' && at < 1e11)) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `<time datetime="${date.toISOString()}">${timeFormat.format(date)}</time>`;
}

function primaryAction(state, submitted) {
  const { phase, round, analysis } = state;
  if (phase === 'closed') return {
    id: 'replay', title: '课堂已结束', label: '查看课堂回顾', icon: 'replay',
    note: '回看每轮作答、学生理由和教师决策。',
  };
  if (phase === 'branch') return {
    id: 'revise', title: '组织分支讨论', label: '开启第二轮作答', icon: 'arrow-right',
    note: '讨论后，邀请学生根据新证据重新作答。',
  };
  if (phase === 'collect') return {
    id: 'reveal', title: round === 1 ? '收集首轮作答' : '收集第二轮作答',
    label: round === 1 ? '公开首轮作答' : '公开第二轮作答', icon: 'arrow-right',
    note: submitted ? '向全班公布选项分布，作答理由可在教师端查看。' : '本轮暂无作答。公开后将结束本轮提交。',
  };
  if (submitted && !analysis) return {
    id: 'analyze', title: '查看本轮证据', label: '整理作答证据', icon: 'sparkles',
    note: round === 1 ? '归纳学生的想法，辅助选择讨论分支。' : '整理学生的新判断，便于课堂回顾。',
  };
  if (round === 1) return {
    id: 'decisions', title: '确定讨论方向', label: '查看讨论分支', icon: 'arrow-right',
    note: submitted ? '结合选项分布和学生理由选择分支。' : '本轮暂无作答，可直接选择一个讨论分支。',
  };
  return {
    id: 'close', title: '回顾第二轮作答', label: '结束课堂', icon: 'check',
    note: '结合学生的改答回顾本次讨论。',
  };
}

function flowMarkup({ phase, round, decision }, icon) {
  const current = phase === 'closed' ? 4 : round === 2 ? 3 : ['collect', 'reveal', 'branch'].indexOf(phase);
  return timeline.map((label, index) => {
    const active = index === current;
    const skipped = phase === 'closed' && ((index === 2 && !decision) || (index === 3 && round === 1));
    const done = index < current && !skipped;
    const style = active ? 'is-current' : done ? 'is-done' : skipped ? 'is-skipped' : '';
    return `<li class="${style}"${active ? ' aria-current="step"' : ''}>
      <span class="desk-step-marker" aria-hidden="true">${icon(done || (active && index === 4) ? 'check' : 'circle', 14)}</span>
      <span>${label}${skipped ? '<span class="desk-sr-only">（已跳过）</span>' : ''}</span>
    </li>`;
  }).join('');
}

const commandActions = new Set(['reveal', 'analyze', 'branch', 'revise', 'close', 'confirm-close', 'draw', 'demoFill']);

function updatePending(root) {
  const pending = pendingDesks.get(root);
  for (const button of root.querySelectorAll('[data-desk-action]')) {
    const action = button.dataset.deskAction;
    if (!commandActions.has(action)) continue;
    const busy = pending?.action === action && pending.branchId === button.dataset.deskBranch;
    if (busy) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
    if (pending) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }
}

function paintDesk(root, scope, regions, dialog) {
  const previous = renderedDesks.get(root);
  const frame = root.querySelector(':scope > .desk-view');
  if (!frame || previous?.scope !== scope) {
    root.innerHTML = `<div class="desk-view">
      <header class="desk-heading" data-desk-region="heading">${regions.heading}</header>
      <div class="desk-grid">
        <section class="desk-scene" data-desk-region="scene" aria-labelledby="desk-scene-title">${regions.scene}</section>
        <section class="desk-panel desk-control" data-desk-region="control" aria-labelledby="desk-control-title">${regions.control}</section>
        <div class="desk-metrics" data-desk-region="metrics" role="group" aria-label="课堂统计">${regions.metrics}</div>
        <section class="desk-panel desk-tools" data-desk-region="tools" aria-labelledby="desk-tools-title">${regions.tools}</section>
        <section class="desk-panel desk-evidence" data-desk-region="evidence" aria-labelledby="desk-evidence-title">${regions.evidence}</section>
        <section class="desk-panel desk-decisions" data-desk-region="decisions" aria-labelledby="desk-decisions-title">${regions.decisions}</section>
        <section class="desk-panel desk-activity" data-desk-region="activity" aria-labelledby="desk-activity-title">${regions.activity}</section>
      </div>
      ${dialog}
    </div>`;
    return;
  }

  const focused = root.ownerDocument.activeElement;
  const restoreFocus = root.contains(focused) && (focused.dataset.deskAction || focused.dataset.deskFocus);
  const showPrompt = frame.querySelector('.desk-prompt')?.open;
  // Keep an unchanged control in place when a classroom update arrives between pointerdown and click.
  for (const [name, html] of Object.entries(regions)) {
    if (previous.regions[name] !== html) frame.querySelector(`[data-desk-region="${name}"]`).innerHTML = html;
  }
  if (showPrompt) frame.querySelector('.desk-prompt').open = true;
  if (restoreFocus && !root.contains(focused)) {
    const match = Array.from(frame.querySelectorAll('[data-desk-action], [data-desk-focus]')).find((candidate) =>
      candidate.dataset.deskAction === focused.dataset.deskAction &&
      candidate.dataset.deskBranch === focused.dataset.deskBranch &&
      candidate.dataset.deskFocus === focused.dataset.deskFocus &&
      !candidate.disabled,
    );
    (match ?? frame.querySelector('.desk-next'))?.focus({ preventScroll: true });
  }
}

export function renderDesk(root, ctx) {
  const { state, esc, icon } = ctx;
  const { lesson, phase, round, analysis, decision, participants, events, winner } = state;
  const scene = getActivity(lesson)?.scene || 'choice';
  const scope = `${state.code}:${lesson.id}`;
  const previous = renderedDesks.get(root);
  const sceneKey = `${scene}:${phase === 'collect'}`;
  const art = previous?.sceneKey === sceneKey ? previous.art : sceneGraphic(scene, { hideExample: phase === 'collect' });
  const responses = state.responses.filter((response) => response.round === round);
  const submitted = new Set(responses.map((response) => response.participantId)).size;
  const simulatedResponses = responses.filter((response) => response.simulated).length;
  const samples = responses.filter((response) => response.sample).length;
  const reasons = responses.filter((response) => response.reason?.trim());
  const simulatedReasons = reasons.filter((response) => response.simulated).length;
  const simulatedCount = participants.filter((person) => person.simulated).length;
  const participantCount = participants.length;
  const percentage = participantCount ? Math.round(submitted / participantCount * 100) : 0;
  const candidates = drawCandidates(state);
  const candidateCount = candidates.length;
  const winnerSimulated = winner?.simulated ?? participants.some((person) => person.id === winner?.id && person.simulated);
  const roundLabel = `第 ${round} 轮`;
  const canChoose = round === 1 && phase === 'reveal';
  const canFill = phase === 'collect' && state.demo && ['mzi', 'history', 'blackbox'].includes(state.lessonId) && !simulatedResponses;
  const decisionBranch = lesson.branches.find((branch) => branch.id === decision?.branchId);
  const canOpenExperiment = scene === 'mzi' && decisionBranch?.id === 'energy';
  const primary = primaryAction(state, submitted);
  const canClose = (phase === 'reveal' || phase === 'branch') && primary.id !== 'close';

  function button(action, label, { symbol, style = '', disabled = false, branchId, accessible, autofocus = false } = {}) {
    return `<button type="button" class="desk-button ${style}" data-desk-action="${action}"
      ${branchId ? `data-desk-branch="${esc(branchId)}"` : ''}
      ${accessible ? `aria-label="${esc(accessible)}"` : ''}${disabled ? ' disabled' : ''}${autofocus ? ' autofocus' : ''}>
      ${symbol ? icon(symbol, 16) : ''}<span>${esc(label)}</span>
    </button>`;
  }

  const heading = `<div class="desk-heading-title">
    <h1>课堂控制台</h1>
    ${state.demo ? '<span class="desk-mode">样本排练</span>' : ''}
  </div><div class="desk-heading-actions">
    ${button('stage', '打开投影', { symbol: 'monitor', style: 'desk-outline' })}
    ${phase !== 'closed' ? button('invite', '邀请学生', { symbol: 'scan', style: 'desk-tint' }) : ''}
  </div>`;

  const hero = `<div class="desk-scene-art" aria-hidden="true">${art}</div>
    <div class="desk-scene-content">
      <div class="desk-scene-meta">${icon('book', 16)}<span>${esc(lesson.subject || '当前课谱')}</span></div>
      <h2 id="desk-scene-title">${esc(lesson.title)}</h2>
      ${lesson.description ? `<p>${esc(lesson.description)}</p>` : ''}
    </div>
    <div class="desk-scene-bottom"><span>课堂码 <b>${esc(state.code)}</b></span>
      ${button('student', '预览学生端', { symbol: 'arrow-up-right', style: 'desk-scene-link' })}
    </div>`;

  const control = `<div class="desk-panel-heading">
      <h2 id="desk-control-title">课堂流程</h2><span class="desk-status" role="status"><i></i>${phaseLabels[phase]}</span>
    </div>
    <ol class="desk-flow" aria-label="授课进度">${flowMarkup(state, icon)}</ol>
    <div class="desk-command">
      <div><h3>${primary.title}</h3><p>${primary.note}</p></div>
      <div class="desk-command-actions">
        ${button(primary.id, primary.label, { symbol: primary.icon, style: 'desk-next' })}
        ${canClose ? button('close', '结课', { style: 'desk-outline desk-close', accessible: '结束课堂' }) : ''}
      </div>
    </div>`;

  const metrics = `<section>
      <span>${icon('users', 16)}已加入</span><strong>${participantCount}</strong>
      <small>${simulatedCount ? `${participantCount - simulatedCount} 位现场 · ${simulatedCount} 位模拟` : '本课堂参与人数'}</small>
    </section>
    <section>
      <span>${icon('check', 16)}本轮已提交</span><strong>${submitted}<small> / ${participantCount}</small></strong>
      <div class="desk-rate"><progress value="${percentage}" max="100" aria-label="本轮提交率"></progress><small>${percentage}%</small></div>
    </section>
    <section>
      <span>${icon('list', 16)}本轮作答理由</span><strong>${reasons.length}</strong>
      <small>${simulatedReasons ? `${reasons.length - simulatedReasons} 份现场 · ${simulatedReasons} 份模拟` : `${roundLabel} 课堂记录`}</small>
    </section>`;

  const drawDescription = candidateCount
    ? `${candidateCount} 位${candidates[0].simulated ? '模拟' : '现场'}答题者 · 每人 ${candidateCount === 1 ? '100%' : '1/' + candidateCount}`
    : '已提交作答的学生可参与';
  const tools = `<div class="desk-panel-heading"><h2 id="desk-tools-title">互动工具</h2>
      ${canFill ? button('demoFill', '添加模拟作答', { symbol: 'plus', style: 'desk-text-button' }) : ''}
    </div>
    <div class="desk-draw">
      ${button('draw', '随机抽签', { symbol: 'shuffle', style: 'desk-outline', disabled: !candidateCount })}
      <div><span>${drawDescription}</span>
        ${winner ? `<strong role="status">上次抽中 ${esc(winner.name)}${winnerSimulated ? ' · 模拟学生' : ''}</strong>` : ''}
      </div>
    </div>`;

  let options = '';
  let quotes = [];
  if (phase !== 'collect' && submitted) {
    const optionCounts = new Map();
    for (const { optionId } of responses) optionCounts.set(optionId, (optionCounts.get(optionId) ?? 0) + 1);
    options = lesson.options.map((option, index) => {
      const count = optionCounts.get(option.id) ?? 0;
      const share = Math.round(count / submitted * 100);
      return `<li class="desk-option">
      <span class="desk-option-code">${String.fromCharCode(65 + index)}</span><div>
        <strong>${esc(option.label)}</strong>
        <div class="desk-bar" aria-hidden="true"><span style="width:${share}%"></span></div>
      </div><span class="desk-option-count"><b>${share}%</b><small>${count} 票</small></span>
    </li>`;
    }).join('');
    quotes = analysis?.evidence?.length
      ? analysis.evidence.slice(0, 4).map((entry) => entry.text)
      : reasons.slice(0, 3).map((response) => response.reason + (response.simulated ? ' · 模拟作答' : ''));
  }
  const scopeNote = simulatedResponses ? `${submitted - simulatedResponses} 份现场作答 · ${simulatedResponses} 份模拟作答` : '';
  const evidenceDetail = phase === 'collect'
    ? `<div class="desk-result-empty"><span class="desk-result-icon">${icon('layers', 22)}</span><div>
        <strong>${submitted ? '正在收集课堂作答' : '等待学生提交'}</strong>
        <p>公开作答后查看选项分布和理由。${samples ? `已记录 ${samples} 份光强预测。` : ''}</p>
      </div></div>`
    : submitted ? `<ul class="desk-options" aria-label="本轮选项分布">${options}</ul>
      ${scopeNote ? `<p class="desk-evidence-scope">${scopeNote}</p>` : ''}
      ${quotes.length ? `<div class="desk-reasons"><h3>${analysis?.evidence?.length ? '评议引用的作答' : '学生作答理由'}</h3>
        ${quotes.map((quote) => `<blockquote>${esc(quote)}</blockquote>`).join('')}
      </div>` : ''}`
    : `<div class="desk-result-empty"><span class="desk-result-icon">${icon('list', 22)}</span><div>
        <strong>本轮暂无作答</strong><p>${canChoose ? '可从备选分支中选择讨论方向。' : '课堂回顾中可查看已记录的轮次。'}</p>
      </div></div>`;
  const evidence = `<div class="desk-panel-heading"><h2 id="desk-evidence-title">本轮证据</h2><span class="desk-caption">${roundLabel}</span></div>
    <details class="desk-prompt">
      <summary data-desk-focus="prompt">${icon('book', 15)}<span>${round === 2 ? '查看再次作答题目' : '查看本轮题目'}</span>${icon('chevron-down', 14)}</summary>
      <p>${esc(round === 2 && state.revisionPrompt ? state.revisionPrompt : lesson.prompt)}</p>
    </details>${evidenceDetail}`;

  const branches = lesson.branches.map((branch) => {
    const recommended = branch.id === analysis?.recommendedId;
    const selected = branch.id === decision?.branchId;
    const choice = analysis?.branches?.find((item) => item.id === branch.id);
    return `<li class="desk-branch${selected ? ' is-selected' : ''}">
      <span class="desk-branch-icon">${icon(selected ? 'check' : 'git-branch', 16)}</span>
      <div><div class="desk-branch-title"><strong>${esc(branch.title)}</strong>
        ${selected ? '<span>已选</span>' : recommended && !decisionBranch ? '<span>评议建议</span>' : ''}
      </div><p>${esc(choice?.description || branch.description)}</p></div>
      ${canChoose ? button('branch', '选择', { branchId: branch.id, style: 'desk-tint', accessible: '选择 ' + branch.title }) : ''}
    </li>`;
  }).join('');
  const decisions = `<div class="desk-panel-heading"><h2 id="desk-decisions-title" tabindex="-1" data-desk-focus="decisions">教学分支</h2>
      <span class="desk-caption">${decisionBranch ? '已选定' : canChoose ? '可选分支' : '课谱预设'}</span>
    </div>
    ${analysis?.headline && phase !== 'collect' ? `<div class="desk-analysis">
      ${icon(analysis.source === 'provider' ? 'sparkles' : 'list', 17)}<div>
        <span>${analysisLabel(analysis.source)}</span><strong>${esc(analysis.headline)}</strong>
        ${analysis.summary ? `<p>${esc(analysis.summary)}</p>` : ''}
      </div>
    </div>` : ''}
    <ul class="desk-branches">${branches}</ul>
    ${canOpenExperiment ? `<div class="desk-branch-tools">
      ${button('experiment', '查看双端口实验', { symbol: 'arrow-up-right', style: 'desk-text-button' })}
    </div>` : ''}`;

  const eventList = events.slice(-4).reverse().map((entry) => {
    const detail = eventDetail(entry);
    return `<li><span class="desk-event-icon">${icon(eventSymbols[entry.type] || 'circle', 15)}</span>
      <div><strong>${esc(entry.label || '课堂状态更新')}</strong>${detail ? `<p>${esc(detail)}</p>` : ''}</div>${eventTime(entry.at)}
    </li>`;
  }).join('');
  const activity = `<div class="desk-panel-heading"><h2 id="desk-activity-title">课堂动态</h2>
    ${button('replay', '查看课堂记录', { symbol: 'arrow-up-right', style: 'desk-text-button' })}
    </div>${eventList ? `<ul class="desk-events">${eventList}</ul>` : '<p class="desk-empty-activity">学生加入、提交和教师操作将显示在这里。</p>'}`;

  const dialog = `<dialog class="desk-confirm" aria-labelledby="desk-confirm-title">
    <span class="desk-confirm-icon">${icon('check', 21)}</span>
    <h2 id="desk-confirm-title">结束这堂课？</h2>
    <p>学生端将停止接收作答。课后可在课堂回顾中查看本次记录。</p>
    <div class="desk-confirm-actions">
      ${button('cancel-close', '返回课堂', { style: 'desk-outline', autofocus: true })}
      ${button('confirm-close', '确认结课', { style: 'desk-next' })}
    </div>
  </dialog>`;

  const regions = { heading, scene: hero, control, metrics, tools, evidence, decisions, activity };
  paintDesk(root, scope, regions, dialog);
  renderedDesks.set(root, { scope, regions, sceneKey, art });
  if (pendingDesks.has(root)) updatePending(root);

  async function click(event) {
    const target = event.target.closest('[data-desk-action]');
    if (!target || target.disabled) return;
    const { deskAction: action, deskBranch: branchId } = target.dataset;
    if (action === 'invite') return ctx.invite();
    if (action === 'stage' || action === 'student') return ctx.open(action);
    if (action === 'replay') return ctx.go(action);
    if (action === 'experiment') return ctx.go('lab', 'mzi');
    if (action === 'decisions') {
      const heading = root.querySelector('#desk-decisions-title');
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'nearest' });
      return;
    }

    const confirm = root.querySelector('.desk-confirm');
    if (action === 'cancel-close') return confirm.close();
    if (pendingDesks.has(root)) return;
    if (action === 'close') return confirm.showModal();
    if (action === 'confirm-close') confirm.close();

    const type = action === 'confirm-close' ? 'close' : action;
    pendingDesks.set(root, { action: type, branchId });
    updatePending(root);
    try {
      const payload = branchId ? { branchId, at: Date.now() } : { at: Date.now() };
      await ctx.command(type, payload);
    } catch (error) {
      ctx.toast(error?.message || '操作未完成，请重试。');
    } finally {
      pendingDesks.delete(root);
      updatePending(root);
    }
  }

  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}
