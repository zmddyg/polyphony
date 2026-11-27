import { renderCognitionReport } from './cognition.mjs';
import { createMaterialNotebook } from '../core/material-notebook.mjs';
import { projectRoom } from '../core/transport.mjs';
import { analyze } from '../core/engine.mjs';
import { HIGH_ERROR_ACCURACY, lectureReviewEpisodes, pilotResponses, wholeDeckPilotMetrics } from '../core/cognition.mjs';
import { buildTeacherReportHtml, downloadHtml } from '../core/report-export.mjs';
const review = { room: null, index: -1, query: '', group: 'all', pageNumber: null,
  memory: { busy: false, message: '', returnTarget: null } };
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
const activityLabels = {
  'concept-diagnosis@1': '概念诊断', 'step-fault@1': '逐行找茬',
  'param-explorer@1': '公式沙盒', 'evidence-weighing@1': '证据权衡',
};
const displayPercent = value => value == null ? '—' : `${value}%`;
const displayGain = value => value == null ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(value)} pp`;
const displaySource = source => source === 'live' ? '真实学生作答' : '模拟作答';
const samplePolicy = '互动提交者跨页去重，填写率按作答份数，正解率按可计分页等权平均，改答率按同页两轮配对。';

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

function pilotValues(metrics) {
  const { topMuddyPage: muddy } = metrics;
  return [
    ['participantCount', '参与总人数', `${metrics.participantCount} 人`],
    ['reasonFillRate', '作答理由填写率', displayPercent(metrics.reasonFillRate)],
    ['firstRoundAccuracy', '首轮平均正解率', displayPercent(metrics.firstRoundAccuracy)],
    ['secondRoundAccuracy', '二轮平均正解率', displayPercent(metrics.secondRoundAccuracy)],
    ['accuracyGainPp', '净跃迁百分点', displayGain(metrics.accuracyGainPp)],
    ['pairedRevisionRate', '配对改答率', displayPercent(metrics.pairedRevisionRate)],
    ['interactivePageCount', '互动页数', `${metrics.interactivePageCount} 页`],
    ['topMuddyPage', '最高存疑讲授页', muddy ? `第 ${muddy.pageNumber} 页 · ${muddy.count} 人` : '—', muddy?.title],
  ];
}

function pilotMarkdown(state, metrics) {
  const markdownText = text => String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\[\]<>*_`#|]/g, '\\$&');
  const date = eventDate(state.events?.[0]?.at)?.toLocaleDateString('zh-CN');
  const real = metrics.source === 'live';
  return [
    `## 课堂试点战报（${real ? '实测' : '模拟演练'}）`, '',
    `- 课件：${markdownText(state.lecture?.title ?? state.lesson?.title ?? '课堂记录')}`,
    `- 课堂码：${markdownText(state.code)}${date ? ` · 日期 ${date}` : ''}`,
    `- 作答来源：${displaySource(metrics.source)}${real ? '' : '（演练样本）'}`, '',
    '| 核心指标 | 结果 |', '| --- | --- |',
    ...pilotValues(metrics).map(([, label, value, detail]) => `| ${label} | ${value}${detail ? ` · ${markdownText(detail)}` : ''} |`),
    '', `口径：${samplePolicy}`, '',
  ].join('\n');
}

function pilotCard(metrics, esc) {
  return `<section class="pr-pilot" aria-labelledby="replay-pilot-title" data-pilot-kpis>
    <header class="pr-section-head"><div><h2 id="replay-pilot-title">📊 课堂实测核心指标汇总</h2>
      <p>${samplePolicy}</p></div><span class="pr-sample" data-pilot-source="${metrics.source}">${displaySource(metrics.source)}</span></header>
    <dl class="pr-pilot-values">${pilotValues(metrics).map(([key, label, value, detail]) => `<div><dt>${label}</dt>
      <dd data-pilot-value="${key}">${value}</dd>${detail ? `<dd class="pr-value-detail">${esc(detail)}</dd>` : ''}</div>`).join('')}</dl>
    <footer class="pr-actions"><button id="replay-copy-pilot" class="pr-button pr-primary" type="button" data-copy-pilot>📋 一键复制实测战报 Markdown</button>
      <button id="replay-teacher-report" class="pr-button" type="button" data-export-teacher-report>🖨 导出可打印教研复盘报告（HTML）</button></footer>
    <p class="pr-status-line" data-export-status role="status"></p>
    <textarea class="pr-markdown" data-pilot-markdown aria-label="战报 Markdown" readonly hidden></textarea>
  </section>`;
}

function pageSwitcher(pages, selected, esc) {
  return `<section class="pr-switcher" data-replay-switcher aria-labelledby="replay-pages-title">
    <header class="pr-section-head"><h2 id="replay-pages-title">全卷页面学情切换条</h2></header>
    ${pages.length ? `<div class="pr-page-tabs" role="group" aria-label="选择复盘页">${pages.map(page => `<button type="button"
      class="pr-page-chip" data-replay-page="${page.pageNumber}" aria-pressed="${selected === page.pageNumber}">
      <span><strong>第 ${page.pageNumber} 页</strong><small>${activityLabels[page.activityId] ?? (page.kind === 'lecture' ? '讲授' : '互动')}</small></span>
      <span class="pr-page-name">${esc(page.title)}</span>
      <span class="pr-page-result">${page.kind === 'lecture' ? `🙋 ${page.muddyCount} 人存疑` : `${displayPercent(page.firstRoundAccuracy)} → ${displayPercent(page.secondRoundAccuracy)}${page.source === 'simulated' && page.participantCount ? ' · 模拟' : ''}`}</span>
    </button>`).join('')}</div>` : '<p class="pr-empty-line">本课还没有开启互动或收到讲授页的存疑标记。</p>'}
  </section>`;
}

function pageEvidence(state, episode, page) {
  const responses = pilotResponses(episode, page.source);
  const reportState = { ...state, ...episode, responses, round1Tallies: undefined, pairedRevisions: undefined,
    simulatedResponseCount: page.source === 'simulated' ? responses.length : 0 };
  if (!responses.length) return { reportState, diagnosis: null };
  const round = page.firstRoundCount ? 1 : 2;
  const analysis = analyze({ ...reportState, round });
  const { analysis: diagnosis } = projectRoom({ ...reportState, round, phase: 'reveal', analysis }, 'stage');
  return { reportState, diagnosis, round };
}

function pageReview(state, page, episode, branchEvent, ctx) {
  const { esc, icon } = ctx;
  const heading = page.pageNumber == null ? esc(page.title) : `第 ${page.pageNumber} 页 · ${esc(page.title)}`;
  if (page.kind === 'lecture') return `<header class="pr-section-head"><h2>${heading}</h2><span class="pr-sample">讲授页</span></header>
    <p class="pr-muddy-detail"><strong>🙋 ${page.muddyCount} 人存疑</strong><span>可在备课中枢回到这一页检查定义、推导或示例。</span></p>`;
  const { reportState, diagnosis, round } = pageEvidence(state, episode, page);
  const { decision } = reportState;
  const contrast = diagnosis?.contrastPair ?? [];
  return `<header class="pr-section-head"><div><h2>${heading}</h2>
      <p>${activityLabels[page.activityId] ?? '课堂互动'} · 首轮 ${page.firstRoundCount} 份 · 二轮 ${page.secondRoundCount} 份${page.muddyCount ? ` · ${page.muddyCount} 人存疑` : ''}</p></div>
      <span class="pr-sample" data-page-source="${page.source}">${displaySource(page.source)}</span></header>
    ${renderCognitionReport(reportState, esc) || `<p class="pr-empty-line">${page.participantCount ? `首轮正解率 ${displayPercent(page.firstRoundAccuracy)}。公布二轮结果后可查看两轮分布。` : '本页还没有收到作答。'}</p>`}
    <section class="pr-page-contrast" data-replay-contrast aria-label="典型红蓝对撞原话">
      <h3>典型红蓝对撞原话${round ? ` <small>第 ${round} 轮</small>` : ''}</h3>
      ${contrast.length ? `<div class="pr-quote-pair">${contrast.map(item => `<article class="${item.tone === 'alert' ? 'pr-quote-red' : 'pr-quote-blue'}">
        <strong>${esc(item.sideLabel)}</strong><blockquote>${esc(item.quote)}</blockquote></article>`).join('')}</div>` : `<p class="pr-empty-line">${diagnosis ? '本轮尚无可供对照的两条理由。' : '学生提交理由后可查看对照原话。'}</p>`}
    </section>
    ${decision ? `<section class="pr-highlight"><span class="pr-icon pr-icon--teaching">${icon('network', 18)}</span><div><h3>本页采用的靶向教学策略</h3><strong>${esc(decision.title ?? decision.branchId)}</strong></div>
      ${branchEvent ? `<button class="pr-text-button" id="replay-find-branch" type="button" data-find-branch>定位事件${icon('arrow-right', 15)}</button>` : ''}</section>` : ''}
    ${decision && !branchEvent ? `<details class="pr-archive-branch"><summary id="replay-branch-evidence">本页靶向教学策略的关联作答</summary>${citedResponses(decision.evidenceIds, state, true, ctx)}</details>` : ''}
    ${page.pageNumber == null ? '' : `<footer class="pr-actions"><button id="replay-save-page" class="pr-button" type="button" data-replay-memory${page.versionId && page.participantCount ? '' : ' data-memory-unavailable disabled'}>将复盘保存到第 ${page.pageNumber} 页</button>
      ${!page.versionId ? '<span>从备课版本开课后，可以把复盘保存到原页。</span>' : ''}</footer>`}`;
}

function exportArchive(state) {
  const archive = {
    room: state.code, lesson: state.lesson?.title, round: state.round, demo: state.demo,
    decision: state.decision, events: state.events,
    responses: state.responses?.map(({ id, round, optionId, reason, simulated }) => ({ id, round, optionId, reason, simulated })),
    options: state.lesson?.options,
    ...(state.lecture && {lecture:state.lecture,activities:(state.lectureArchive ?? []).map(item=>({
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
  const selector = active.id ? `#${active.id}` : active.dataset.event != null ? `[data-event="${active.dataset.event}"]`
    : active.dataset.replayPage != null ? `[data-replay-page="${active.dataset.replayPage}"]` : '';
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
  if (review.room !== state.code) Object.assign(review, {
    room: state.code, index: events.length - 1, query: '', group: 'all', pageNumber: null,
    memory: { busy: false, message: '', returnTarget: null },
  });
  const focus = captureReplayFocus(root);
  const oldList = root.querySelector('.pr-timeline');
  const lastScroll = oldList?.scrollTop ?? 0;
  const sameRoom = previousView?.room === state.code;
  const lastPageScroll = sameRoom ? root.querySelector('.pr-page-tabs')?.scrollLeft ?? 0 : 0;
  const keepBranchOpen = sameRoom && Boolean(root.querySelector('.pr-archive-branch')?.open);
  const metrics = wholeDeckPilotMetrics(state);
  const episodes = new Map(lectureReviewEpisodes(state));
  const responses = [...episodes.values()].flatMap(item => item.responses ?? []);
  const simulated = responses.filter(item => item.simulated).length;
  const highErrorPages = metrics.pages.filter(page => page.highError && page.versionId);
  const memory = review.memory;
  let selected = metrics.pages.find(page => page.pageNumber === review.pageNumber) ??
    metrics.pages.find(page => page.kind === 'interaction') ?? metrics.pages[0];
  review.pageNumber = selected?.pageNumber ?? null;
  root.innerHTML = `<div class="pr-review">
    <header class="pr-page-header"><div><h1>课后复盘</h1><p>${esc(state.lecture?.title ?? state.lesson?.title ?? '课堂记录')}</p>
      <div class="pr-class-meta"><span>课堂码 <b>${esc(state.code ?? '')}</b></span>
      ${phaseLabels[state.phase] ? `<span class="pr-status${state.phase === 'closed' ? ' is-closed' : ''}">${phaseLabels[state.phase]}</span>` : ''}
      <span>${responses.length - simulated} 份学生作答${simulated ? ` · ${simulated} 份模拟` : ''}</span></div></div>
      <div class="pr-page-actions"><button class="pr-button" id="replay-export" type="button"${events.length ? '' : ' disabled'}>${icon('download', 16)}导出记录</button>
      <button class="pr-button" id="replay-return" type="button">${icon('arrow-left', 16)}返回课堂</button></div></header>
    ${state.lecture ? pageSwitcher(metrics.pages, review.pageNumber, esc) : ''}
    ${pilotCard(metrics, esc)}
    ${state.lecture ? `<section class="pr-memory-rail" aria-label="课件记忆回流"><div class="pr-actions">
      <button id="replay-save-batch" class="pr-button" type="button" data-batch-memory${highErrorPages.length ? '' : ' data-memory-unavailable disabled'}>🧠 一键批量回流全部高错页至课件记忆库</button>
      <span>首轮正解率 &lt; ${HIGH_ERROR_ACCURACY}% · ${highErrorPages.length} 页可回流</span></div>
      <div class="pr-actions"><p class="pr-status-line" data-memory-status role="status"></p><button class="pr-text-button" id="replay-material-return" type="button" data-return-materials hidden>返回备课中枢${icon('arrow-right', 15)}</button></div></section>` : ''}
    <section class="pr-page-panel" data-replay-page-panel aria-label="本页教学复盘"${selected ? '' : ' hidden'}></section>
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
      </section>
    </div>
  </div>`;

  const switcher = root.querySelector('.pr-page-tabs');
  if (switcher) switcher.scrollLeft = lastPageScroll;
  const pagePanel = root.querySelector('[data-replay-page-panel]');
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
  root.querySelector('#replay-export').onclick = () => exportArchive(state);

  function updateMemoryControls() {
    if (mounted.get(root)?.room !== state.code) return;
    const status = root.querySelector('[data-memory-status]');
    if (!status) return;
    status.textContent = memory.message;
    const returnButton = root.querySelector('[data-return-materials]');
    returnButton.hidden = !memory.returnTarget;
    returnButton.disabled = memory.busy;
    for (const button of root.querySelectorAll('[data-replay-memory], [data-batch-memory]')) {
      button.disabled = memory.busy || button.hasAttribute('data-memory-unavailable');
    }
  }

  function paintSelectedPage(reopen = false) {
    if (!selected) return;
    const episode = episodes.get(selected.pageNumber);
    const branchId = episode?.decision?.branchId;
    const branchEvent = branchId && events.findLast(event => event.type === 'branch' && event.detail?.branchId === branchId &&
      (state.lecture ? (event.detail.lecturePageNumber ?? event.detail.pageNumber) === selected.pageNumber : event.lessonStart === latest?.lessonStart));
    pagePanel.innerHTML = pageReview(state, selected, episode, branchEvent, ctx);
    if (reopen && pagePanel.querySelector('.pr-archive-branch')) pagePanel.querySelector('.pr-archive-branch').open = true;
    const locate = pagePanel.querySelector('[data-find-branch]');
    if (locate) locate.onclick = () => {
      clearFilters();
      select(branchEvent.index);
      const heading = content.querySelector('h3');
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'nearest' });
    };
    updateMemoryControls();
  }

  switcher?.addEventListener('click', event => {
    const button = event.target.closest('[data-replay-page]');
    if (!button) return;
    const page = metrics.pages.find(item => String(item.pageNumber) === button.dataset.replayPage);
    if (!page || page === selected) return;
    selected = page;
    review.pageNumber = page.pageNumber;
    for (const chip of switcher.querySelectorAll('[data-replay-page]')) chip.setAttribute('aria-pressed', String(chip === button));
    paintSelectedPage();
  });
  switcher?.addEventListener('keydown', event => {
    const buttons = [...switcher.querySelectorAll('[data-replay-page]')];
    const current = buttons.indexOf(event.target);
    const moves = { ArrowLeft: buttons[current - 1], ArrowRight: buttons[current + 1], Home: buttons[0], End: buttons.at(-1) };
    if (current < 0 || !Object.hasOwn(moves, event.key)) return;
    event.preventDefault();
    moves[event.key]?.focus();
    moves[event.key]?.click();
  });

  async function saveMemories(pages) {
    if (!pages.length || memory.busy) return;
    memory.busy = true;
    memory.message = `正在写入 ${pages.length} 页课件记忆…`;
    updateMemoryControls();
    const saved = [];
    const failed = [];
    try {
      const notebook = createMaterialNotebook();
      for (const page of pages) {
        const { versionId, pageNumber } = page;
        try {
          const { diagnosis } = pageEvidence(state, episodes.get(pageNumber), page);
          const text = [page.title, diagnosis?.headline, diagnosis?.summary,
            ...(diagnosis?.contrastPair ?? []).map(item => `${item.sideLabel}：${item.quote}`),
            `两轮战报：正解率 ${displayPercent(page.firstRoundAccuracy)} → ${displayPercent(page.secondRoundAccuracy)}，配对改答 ${page.pairedChangedCount}/${page.pairedCount}。`,
            `样本来源：${displaySource(page.source)}。`].filter(Boolean).join('\n');
          await notebook.savePageNote(versionId, pageNumber, {
            id: `review-${state.code}-${pageNumber}`, kind: 'annotation', packet: { text },
            source: { type: 'classroom-review', room: state.code, pageNumber },
          });
          saved.push({ versionId, pageNumber });
        } catch (error) { failed.push(`第 ${pageNumber} 页：${error.message}`); }
      }
      if (saved.length) memory.returnTarget = saved[0];
      memory.message = `已回流 ${saved.length} 页${saved.length ? `（${saved.map(item => item.pageNumber).join('、')}）` : ''}${failed.length ? `。${failed.length} 页写入失败：${failed.join('，')}` : '至课件记忆库。'}`;
      if (saved.length && review.room === state.code) ctx.toast(`已回流 ${saved.length} 页课件记忆`);
    } catch (error) { memory.message = `课件记忆写入失败：${error.message}`; }
    finally { memory.busy = false; updateMemoryControls(); }
  }

  pagePanel.addEventListener('click', event => {
    if (event.target.closest('[data-replay-memory]')) void saveMemories([selected]);
  });
  root.querySelector('[data-batch-memory]')?.addEventListener('click', () => void saveMemories(highErrorPages));
  root.querySelector('[data-return-materials]')?.addEventListener('click', async () => {
    const target = memory.returnTarget;
    if (!target || memory.busy) return;
    memory.busy = true;
    updateMemoryControls();
    try {
      await createMaterialNotebook().setLastPage(target.versionId, target.pageNumber);
      try { sessionStorage.setItem('polyphony.material.return', JSON.stringify(target)); } catch { /* The last page is already saved. */ }
      ctx.go('materials');
    } catch (error) { memory.message = error.message; }
    finally { memory.busy = false; updateMemoryControls(); }
  });

  const exportStatus = root.querySelector('[data-export-status]');
  const markdownField = root.querySelector('[data-pilot-markdown]');
  root.querySelector('[data-copy-pilot]').onclick = async () => {
    const markdown = pilotMarkdown(state, metrics);
    if (await ctx.copy?.(markdown)) {
      markdownField.hidden = true;
      exportStatus.textContent = '战报 Markdown 已复制。';
    } else {
      markdownField.value = markdown;
      markdownField.hidden = false;
      markdownField.select();
      exportStatus.textContent = '战报已选中，可以手动复制。';
    }
  };
  root.querySelector('[data-export-teacher-report]').onclick = () => {
    downloadHtml(buildTeacherReportHtml(state, metrics), `教研复盘-${state.code || '课堂'}.html`);
    exportStatus.textContent = '已生成可打印教研复盘报告。';
  };
  paintSelectedPage(keepBranchOpen);
  updateMemoryControls();
  refresh({ reveal: !oldList, scroll: lastScroll });
  focus();
}
