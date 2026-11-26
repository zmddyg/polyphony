import { renderCognitionReport } from './cognition.mjs';
import { createMaterialNotebook } from '../core/material-notebook.mjs';
import { projectRoom } from '../core/transport.mjs';
import { analyze } from '../core/engine.mjs';
import { cognitionReport } from '../core/cognition.mjs';
const review = { room: null, index: -1, query: '', group: 'all' };
const mounted = new WeakMap();
const groups = [
  ['all', '全部'], ['participation', '参与与作答'], ['teaching', '教学决定'], ['room', '课堂操作'],
];
const eventTypes = {
  room: { group: 'room', name: '课堂创建', icon: 'plus' },
  switchLesson: { group: 'room', name: '课程切换', icon: 'book' },
  loadLesson: { group: 'room', name: '互动配置发布', icon: 'book' },
  lectureNavigate: { group:'teaching',name:'讲义翻页',icon:'book' },
  lectureInteract: { group:'teaching',name:'原页互动',icon:'users' },
  lectureResume: { group:'teaching',name:'返回讲义',icon:'arrow-left' },
  lectureFinish: { group:'room',name:'讲义结课',icon:'check' },
  join: { group: 'participation', name: '加入课堂', icon: 'user' },
  respond: { group: 'participation', name: '学生作答', icon: 'workshop' },
  demoFill: { group: 'participation', name: '模拟作答', icon: 'users' },
  draw: { group: 'participation', name: '课堂抽签', icon: 'shuffle' },
  reveal: { group: 'teaching', name: '公布结果', icon: 'chart' },
  analyze: { group: 'teaching', name: '证据整理', icon: 'sparkles' },
  branch: { group: 'teaching', name: '靶向教学策略', icon: 'network' },
  revise: { group: 'teaching', name: '开启改答', icon: 'workshop' },
  close: { group: 'room', name: '结束课堂', icon: 'check' },
};
const phaseLabels = { collect: '收集中', reveal: '已公布', branch: '讨论中', closed: '已结束' };

function entryType(type) {
  return Object.hasOwn(eventTypes, type) ? eventTypes[type] : { group: 'room', name: '教学节点', icon: 'list' };
}

function eventRows(events) {
  let round = 1;
  let lessonStart = 0;
  return events.map((event, index) => {
    if (['room', 'switchLesson', 'loadLesson','lectureInteract'].includes(event.type)) {
      round = 1;
      lessonStart = index;
    }
    round = Number(event.detail?.round ?? event.round) || round;
    const category = entryType(event.type);
    const searchable = [event.label, event.type, event.id, category.name, `第 ${round} 轮`, `第${round}轮`, JSON.stringify(event.detail ?? {})].join(' ').toLowerCase();
    return { ...event, round, index, lessonStart, category, searchable, time: eventTime(event.at) };
  });
}

function eventDate(at) {
  if (typeof at === 'number' && at < 1e12) return null;
  if (typeof at !== 'string' && typeof at !== 'number') return null;
  const date = new Date(at);
  return Number.isNaN(+date) ? null : date;
}

function eventTime(at) {
  return eventDate(at)?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) || '';
}

function citedResponses(ids, state, currentLesson, ctx) {
  const { esc, icon } = ctx;
  if (!ids?.length) return '<p class="pr-evidence-empty">此事件未引用作答。</p>';
  return `<ul class="pr-evidence">${ids.map(id => {
    const archived = state.lectureArchive?.find(activity=>activity.responses.some(item=>item.id===id));
    const response = archived?.responses.find(item=>item.id===id) ?? ((currentLesson||state.lecture) ? state.responses?.find(item => item.id === id) : null);
    if (!response) return `<li><code>${esc(id)}</code><p>存档中保留了这条作答的引用编号。</p></li>`;
    const option = (archived?.lesson ?? state.lesson)?.options?.find(item => item.id === response.optionId);
    return `<li><div class="pr-evidence-meta"><span>${icon(response.simulated ? 'users' : 'user', 14)}${response.simulated ? '模拟作答' : '课堂作答'} · 第 ${esc(response.round)} 轮</span><code>${esc(id)}</code></div>
      <strong>${esc(option?.label ?? response.optionId)}</strong>${response.reason ? `<blockquote>${esc(response.reason)}</blockquote>` : '<p>未填写理由。</p>'}</li>`;
  }).join('')}</ul>`;
}

function eventEvidence(event, state, currentLesson, ctx, searching) {
  const { esc, icon } = ctx;
  if (!event) return `<div class="pr-empty"><span class="pr-icon">${icon('replay', 24)}</span>
    <h3 id="replay-event-title" tabindex="-1">${searching ? '没有匹配的事件' : '暂无课堂记录'}</h3>
    <p>${searching ? '调整关键词或事件类型后再试。' : '课堂操作和作答会自动出现在时间线。'}</p>
    ${searching ? '<button class="pr-button" type="button" data-reset-filters>清除筛选</button>' : ''}</div>`;
  const details = event.detail ?? {};
  const authority = details.actor?.name ?? details.authorizedBy?.name ?? details.authorizedBy;
  const ids = details.evidenceIds ?? (details.responseId ? [details.responseId] : []);
  const timestamp = eventDate(event.at);
  const dateLine = timestamp ? `<time datetime="${timestamp.toISOString()}">${esc(timestamp.toLocaleString('zh-CN', { hour12: false }))}</time>` : '';
  const person = currentLesson && details.participantId && state.participants?.find(item => item.id === details.participantId);
  const explanation = {
    room: () => `<p>${details.demo ? '已创建用于模拟班级演示的课堂。' : '已创建课堂，学生可以通过课堂码加入。'}</p>`,
    switchLesson: () => `<p>课堂已切换到${currentLesson && state.lesson?.title ? `「${esc(state.lesson.title)}」` : '新的互动配置'}。</p>`,
    loadLesson: () => `<p>当前课堂已加载${currentLesson && state.lesson?.title ? `「${esc(state.lesson.title)}」` : '自定义互动配置'}。</p>`,
    join: () => person ? `<p>课堂显示名 <strong>${esc(person.name)}</strong></p>` : '',
    demoFill: () => `<p>此次加入 <strong>${esc(details.count ?? 0)}</strong> 份模拟作答。</p>`,
    reveal: () => '<p>全班可以查看本轮作答分布。</p>',
    analyze: () => details.source ? `<p>整理来源 <strong>${esc(({ local: '本地规则', provider: '已配置的模型服务' })[details.source] ?? details.source)}</strong></p>` : '',
    branch: () => `<div class="pr-event-callout"><span>老师选定的讨论方向</span><strong>${esc(details.title ?? details.branchId ?? '靶向教学策略')}</strong>${typeof authority === 'string' && authority ? `<small>由 ${esc(authority)} 批准</small>` : ''}</div>`,
    draw: () => details.eligibleCount == null ? '' : `<p>候选池有 <strong>${esc(details.eligibleCount)}</strong> 位${details.eligibleSource === 'simulated' ? '模拟同学' : '课堂参与者'}。${person ? `抽中 <strong>${esc(person.name)}</strong>。` : ''}</p>`,
    revise: () => details.revisionPrompt ? `<div class="pr-event-callout"><span>第二轮题目</span><strong>${esc(details.revisionPrompt)}</strong></div>` : '',
    close: () => '<p>课堂停止收集，记录可在此查看和导出。</p>',
  };
  return `<div class="pr-event-heading"><span class="pr-icon pr-icon--${event.category.group}">${icon(event.category.icon, 23)}</span><div>
    <div class="pr-event-meta"><span>${event.category.name}</span><span>第 ${event.round} 轮</span>${dateLine}</div>
    <h3 id="replay-event-title" tabindex="-1">${esc(event.label ?? event.category.name)}</h3>
    <code>${esc(event.id ?? '')}</code></div></div>
    ${state.lecture && (details.pageNumber||details.lecturePageNumber) ? `<p>讲义来源 · ${esc(state.lecture.sourceName)} · 第 ${esc(details.pageNumber||details.lecturePageNumber)} 页</p>` : ''}
    ${Object.hasOwn(explanation, event.type) ? `<div class="pr-event-copy">${explanation[event.type]()}</div>` : ''}
    ${ids.length || ['branch', 'analyze'].includes(event.type) ? `<section class="pr-evidence-section" aria-label="关联作答"><h4>关联作答</h4>${citedResponses(ids, state, currentLesson, ctx)}<p class="pr-evidence-note">同一份作答更新后，这里显示最新保存的内容。</p></section>` : ''}`;
}

function pairedChange(state) {
  if (Number(state.round) !== 2 || !['reveal', 'closed'].includes(state.phase)) return null;
  const responses = state.responses ?? [];
  const first = new Map(responses.filter(item => Number(item.round) === 1).map(item => [item.participantId, item]));
  const pairs = responses.filter(item => Number(item.round) === 2 && first.get(item.participantId)?.simulated === item.simulated && first.has(item.participantId));
  const real = pairs.filter(item => !item.simulated);
  const sample = real.length ? real : pairs;
  if (!sample.length) return null;
  return { changed: sample.filter(item => first.get(item.participantId).optionId !== item.optionId).length, total: sample.length, live: Boolean(real.length) };
}

function exportArchive(state) {
  const archive = {
    room: state.code, lesson: state.lesson?.title, round: state.round, demo: state.demo,
    decision: state.decision, events: state.events,
    responses: state.responses?.map(({ id, round, optionId, reason, simulated }) => ({ id, round, optionId, reason, simulated })),
    options: state.lesson?.options,
    ...(state.lecture && {lecture:state.lecture,activities:state.lectureArchive.map(item=>({
      sourcePage:item.pageNumber,versionId:item.versionId,title:item.lesson.title,options:item.lesson.options,
      decision:item.decision,responses:item.responses.map(({id,round,optionId,reason,simulated})=>({id,round,optionId,reason,simulated})),
    }))}),
  };
  const href = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = `polyphony-${state.code || 'replay'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function captureReplayFocus(root) {
  const active = document.activeElement;
  if (!root.contains(active)) return () => {};
  const selector = active.id ? `#${active.id}` : active.dataset.event != null ? `[data-event="${active.dataset.event}"]` : '';
  const { selectionStart, selectionEnd } = active;
  return () => {
    if (!selector) return;
    const target = root.querySelector(selector);
    target?.focus({ preventScroll: true });
    if (selectionStart != null) target?.setSelectionRange(selectionStart, selectionEnd);
  };
}

function scrollToSelection(list) {
  const selected = list.querySelector('[aria-current="step"]');
  if (!selected) return;
  const item = selected.getBoundingClientRect();
  const panel = list.getBoundingClientRect();
  if (item.top < panel.top) list.scrollTop += item.top - panel.top - 5;
  if (item.bottom > panel.bottom) list.scrollTop += item.bottom - panel.bottom + 5;
}

export function renderReplay(root, ctx) {
  const { state, esc, icon } = ctx;
  const previousView = mounted.get(root);
  if (previousView?.room === state.code && previousView.composing) {
    previousView.waiting = ctx;
    return;
  }
  const view = { room: state.code, composing: false, waiting: null };
  mounted.set(root, view);
  const events = eventRows(state.events ?? []);
  const latest = events.at(-1);
  if (review.room !== state.code) Object.assign(review, { room: state.code, index: events.length - 1, query: '', group: 'all' });
  const focus = captureReplayFocus(root);
  const oldList = root.querySelector('.pr-timeline');
  const lastScroll = oldList?.scrollTop ?? 0;
  const keepBranchOpen = Boolean(root.querySelector('.pr-archive-branch')?.open);
  const responses = [...(state.responses ?? []),...(state.lectureArchive ?? []).flatMap(item=>item.responses)];
  const simulated = responses.filter(item => item.simulated).length;
  const episode = Number(state.round) === 2 ? state
    : state.lectureArchive?.findLast(item => Number(item.round) === 2) ?? state.lectureArchive?.at(-1) ?? state;
  const reportState = { ...state, ...episode };
  const change = pairedChange(reportState);
  const decision = reportState.decision;
  const versionId = episode.versionId ?? state.lecture?.sourceVersion;
  const pageNumber = episode.pageNumber ?? state.lecture?.pageNumber;
  const branchEvent = events.findLast(event => event.type === 'branch' && event.lessonStart === latest?.lessonStart && event.detail?.branchId === decision?.branchId);
  const contrast = reportState.analysis?.contrastPair ?? reportState.firstRoundAnalysis?.contrastPair ?? [];
  const mistake = contrast[0]?.quote;
  root.innerHTML = `<div class="pr-review">
    <header class="pr-page-header"><div><h1>课后复盘</h1><p>${esc(state.lecture?.title ?? state.lesson?.title ?? '课堂记录')}</p></div>
      <button class="pr-button" id="replay-return" type="button">${icon('arrow-left', 16)}返回课堂</button></header>
    <section class="pr-activity-summary" aria-label="本课结果">
      <h2>本课作答</h2>
      <p>${responses.length - simulated} 份学生作答${simulated ? ' · ' + simulated + ' 份模拟' : ''}${change ? ' · ' + change.changed + ' / ' + change.total + ' 人改答' : ''}</p>
      ${mistake ? '<p><b>值得回看的理由</b> · '+esc(mistake)+'</p>' : ''}
      ${versionId && pageNumber && episode.responses?.length ? `<button type="button" class="pr-button" data-replay-memory>将复盘保存到第 ${esc(pageNumber)} 页</button><p data-memory-status role="status"></p>` : ''}
    </section>
    <details class="pr-detail-toggle"><summary>查看完整记录</summary>
    <div class="pr-detail-actions"><button class="pr-button" id="replay-export" type="button"${events.length ? '' : ' disabled'}>${icon('download', 16)}导出记录</button></div>
    ${renderCognitionReport(reportState, esc)}
    <section class="pr-overview" aria-label="课堂概览">
      <div class="pr-class"><span class="pr-class-icon">${icon('book', 26)}</span><div><div class="pr-class-meta"><span>课堂码 <b>${esc(state.code ?? '')}</b></span><span>第 ${esc(state.round ?? 1)} 轮</span>${phaseLabels[state.phase] ? `<span class="pr-status${state.phase === 'closed' ? ' is-closed' : ''}">${phaseLabels[state.phase]}</span>` : ''}${state.demo ? '<span>模拟班级演示</span>' : ''}</div><h2>${esc(state.lesson?.title ?? '课堂存档')}</h2></div></div>
      <dl class="pr-stats"><div><dt>教学节点</dt><dd>${events.length}</dd></div><div><dt>本课真实作答</dt><dd>${responses.length - simulated}</dd></div><div><dt>本课模拟作答</dt><dd>${simulated}</dd></div></dl>
    </section>
    ${decision || change ? `<div class="pr-highlights">
      ${decision ? `<section class="pr-highlight"><span class="pr-icon pr-icon--teaching">${icon('network', 18)}</span><div><h2>本课采用的靶向教学策略</h2><strong>${esc(decision.title ?? decision.branchId)}</strong></div>${branchEvent ? `<button class="pr-text-button" id="replay-find-branch" type="button">定位事件${icon('arrow-right', 15)}</button>` : ''}</section>` : ''}
      ${change ? `<section class="pr-highlight"><span class="pr-icon">${icon('chart', 18)}</span><div><h2>${change.live ? '两轮均提交的学生' : '两轮模拟作答'}</h2><strong>${change.changed} / ${change.total} 位更换了选项</strong></div></section>` : ''}
    </div>` : ''}
    <div class="pr-columns">
      <section class="pr-card pr-list-panel" aria-labelledby="replay-timeline-title">
        <div class="pr-panel-header"><h2 id="replay-timeline-title">课堂演化轨迹</h2><span class="pr-match-count" data-match-count role="status"></span></div>
        <div class="pr-query"><label class="pr-sr-only" for="replay-search">搜索事件、分支或作答编号</label><input id="replay-search" type="search" placeholder="搜索事件、分支或作答编号" value="${esc(review.query)}" autocomplete="off"></div>
        <div class="pr-filters" aria-label="筛选事件类型">${groups.map(([key, title]) => `<button type="button" id="replay-filter-${key}" data-filter="${key}" aria-pressed="${key === review.group}">${title}</button>`).join('')}</div>
        <ul class="pr-timeline" aria-label="教学节点"></ul>
      </section>
      <section class="pr-card pr-detail-panel" aria-labelledby="replay-detail-title">
        <div class="pr-panel-header"><h2 id="replay-detail-title">事件详情</h2><div class="pr-stepper"><button class="pr-button" type="button" id="replay-before" aria-label="上一条">${icon('chevron-right', 16)}<span>上一条</span></button><span data-counter aria-live="polite"></span><button class="pr-button" type="button" id="replay-after" aria-label="下一条"><span>下一条</span>${icon('chevron-right', 16)}</button></div></div>
        <div class="pr-entry-content"></div>
        ${decision && !branchEvent ? `<details class="pr-archive-branch"${keepBranchOpen ? ' open' : ''}><summary id="replay-branch-evidence">本课靶向教学策略的关联作答</summary>${citedResponses(decision.evidenceIds, state, true, ctx)}</details>` : ''}
      </section>
    </div>
    </details>
  </div>`;

  const list = root.querySelector('.pr-timeline');
  const search = root.querySelector('#replay-search');
  const content = root.querySelector('.pr-entry-content');
  const filter = root.querySelector('.pr-filters');
  const matchCount = root.querySelector('[data-match-count]');
  const counter = root.querySelector('[data-counter]');
  const before = root.querySelector('#replay-before');
  const after = root.querySelector('#replay-after');
  let matches = [];

  function refresh({ reveal = false, scroll = list.scrollTop } = {}) {
    const query = review.query.trim().toLowerCase();
    const filtered = Boolean(query || review.group !== 'all');
    matches = events.filter(event => (review.group === 'all' || event.category.group === review.group) && event.searchable.includes(query));
    if (!matches.some(event => event.index === review.index)) review.index = matches.at(-1)?.index ?? -1;
    const position = matches.findIndex(event => event.index === review.index);
    const selected = matches[position];
    list.innerHTML = matches.map(item => `<li><button class="pr-event-item" type="button" data-event="${item.index}"${item.index === review.index ? ' aria-current="step"' : ''}><span class="pr-icon pr-icon--${item.category.group}">${icon(item.category.icon, 16)}</span><span><strong>${esc(item.label ?? item.category.name)}</strong><small>第 ${item.round} 轮${item.time ? ` · ${esc(item.time)}` : ''}</small></span>${icon('chevron-right', 15)}</button></li>`).join('');
    list.hidden = !matches.length;
    list.scrollTop = scroll;
    if (reveal) scrollToSelection(list);
    matchCount.textContent = `${matches.length} 条`;
    counter.textContent = matches.length ? `${position + 1} / ${matches.length}` : '0 / 0';
    before.disabled = position <= 0;
    after.disabled = position < 0 || position >= matches.length - 1;
    for (const button of filter.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === review.group));
    content.innerHTML = eventEvidence(selected, state, selected?.lessonStart === latest?.lessonStart, ctx, filtered);
  }

  function select(index, moveFocus = false) {
    review.index = index;
    refresh({ reveal: true });
    if (moveFocus) list.querySelector('[aria-current="step"]')?.focus({ preventScroll: true });
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-event]');
    if (!button) return;
    select(Number(button.dataset.event), true);
    const detail = root.querySelector('.pr-detail-panel');
    if (event.detail && matchMedia('(max-width: 820px)').matches && detail.getBoundingClientRect().top > innerHeight * .65) {
      content.querySelector('h3').focus({ preventScroll: true });
      detail.scrollIntoView({ block: 'start' });
    }
  });
  list.addEventListener('keydown', event => {
    const index = Number(event.target.closest('[data-event]')?.dataset.event);
    const position = matches.findIndex(item => item.index === index);
    const destinations = { ArrowUp: matches[position - 1], ArrowDown: matches[position + 1], Home: matches[0], End: matches.at(-1) };
    if (position < 0 || !Object.hasOwn(destinations, event.key)) return;
    event.preventDefault();
    const destination = destinations[event.key];
    if (destination) select(destination.index, true);
  });
  const handleSearch = () => { review.query = search.value; refresh({ reveal: true }); };
  search.addEventListener('compositionstart', () => { view.composing = true; });
  search.addEventListener('input', event => { if (!event.isComposing) handleSearch(); });
  search.addEventListener('compositionend', () => {
    view.composing = false;
    handleSearch();
    if (view.waiting) queueMicrotask(() => {
      if (search.isConnected && mounted.get(root) === view) renderReplay(root, view.waiting);
    });
  });
  filter.addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    review.group = button.dataset.filter;
    refresh({ reveal: true });
  });
  function clearFilters() {
    review.query = '';
    review.group = 'all';
    search.value = '';
  }
  content.addEventListener('click', event => {
    if (!event.target.closest('[data-reset-filters]')) return;
    clearFilters();
    refresh({ reveal: true });
    search.focus();
  });
  function step(offset, button) {
    const position = matches.findIndex(item => item.index === review.index);
    const destination = matches[position + offset];
    if (!destination) return;
    select(destination.index);
    if (button.disabled) content.querySelector('h3')?.focus({ preventScroll: true });
  }
  before.onclick = () => step(-1, before);
  after.onclick = () => step(1, after);
  root.querySelector('#replay-return').onclick = () => ctx.go('desk');
  root.querySelector('[data-replay-memory]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const status = root.querySelector('[data-memory-status]');
    if (!versionId || !pageNumber) { status.textContent = '请在课件活化中打开原 PPT，在对应页开启互动后再回流。'; return; }
    button.disabled = true;
    try {
      const notebook = createMaterialNotebook();
      const diagnosis = analyze({ ...reportState, round: 1 });
      const visible = projectRoom({ ...reportState, analysis: diagnosis }, 'stage', null);
      const report = cognitionReport(reportState);
      const text = [reportState.lesson.title, visible.analysis?.headline, visible.analysis?.summary,
        ...(visible.analysis?.contrastPair ?? []).map(p => `${p.sideLabel}：${p.quote}`),
        `两轮战报：正解 ${report.firstCorrect ?? '待判定'}% → ${report.secondCorrect ?? '待判定'}%；配对改选 ${report.paired.changed}/${report.paired.total}。`,
        reportState.responses.some(r => r.simulated) ? '本课含已标记模拟作答，用于演练。' : '本课现场作答诊断。'].filter(Boolean).join('\n');
      await notebook.savePageNote(versionId, pageNumber, { id: `review-${state.code}-${pageNumber}`, kind: 'annotation', packet: { text }, source: { type: 'classroom-review', room: state.code, pageNumber } });
      await notebook.setLastPage(versionId, pageNumber);
      sessionStorage.setItem('polyphony.material.return', JSON.stringify({ versionId, pageNumber }));
      ctx.toast('典型误区已回流并锚定原页');
      ctx.go('materials');
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  });
  root.querySelector('#replay-export').onclick = () => exportArchive(state);
  const findBranch = root.querySelector('#replay-find-branch');
  if (findBranch) findBranch.onclick = () => {
    clearFilters();
    select(branchEvent.index);
    const heading = content.querySelector('h3');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'nearest' });
  };
  refresh({ reveal: !oldList, scroll: lastScroll });
  focus();
}
