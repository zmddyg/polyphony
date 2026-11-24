import { challengeNames } from '../core/challenge-lab.mjs';

const review = { room: null, index: -1, query: '', group: 'all', includeNames: false };
const mounted = new WeakMap();
const groups = [
  ['all', '全部'], ['participation', '参与与作答'], ['teaching', '教学决定'], ['room', '课堂操作'],
];
const eventTypes = {
  room: { group: 'room', name: '课堂创建', icon: 'plus' },
  switchLesson: { group: 'room', name: '课程切换', icon: 'book' },
  loadLesson: { group: 'room', name: '课谱发布', icon: 'book' },
  lectureNavigate: { group: 'teaching', name: '讲义翻页', icon: 'book' },
  lectureInteract: { group: 'teaching', name: '原页互动', icon: 'users' },
  lectureResume: { group: 'teaching', name: '返回讲义', icon: 'arrow-left' },
  lectureFinish: { group: 'room', name: '讲义结课', icon: 'check' },
  lectureExperimentStart: { group: 'teaching', name: '开启课堂实验', icon: 'target' },
  experimentVote: { group: 'participation', name: '实验投票', icon: 'target' },
  lectureExperimentAct: { group: 'teaching', name: '实验操作', icon: 'lab' },
  experimentPeer: { group: 'teaching', name: 'AI 同桌作答', icon: 'sparkles' },
  lecturePulse: { group: 'participation', name: '学生困惑标记', icon: 'help' },
  join: { group: 'participation', name: '加入课堂', icon: 'user' },
  respond: { group: 'participation', name: '学生作答', icon: 'workshop' },
  demoFill: { group: 'participation', name: '模拟作答', icon: 'users' },
  draw: { group: 'participation', name: '课堂抽签', icon: 'shuffle' },
  spotlight: { group: 'teaching', name: '匿名原话投屏', icon: 'monitor' },
  spotlightWinner: { group: 'teaching', name: '大屏抽签展示', icon: 'users' },
  timer: { group: 'room', name: '讨论倒计时', icon: 'clock' },
  removeParticipant: { group: 'room', name: '清理未作答名单', icon: 'close' },
  reveal: { group: 'teaching', name: '公布结果', icon: 'chart' },
  analyze: { group: 'teaching', name: '证据整理', icon: 'sparkles' },
  branch: { group: 'teaching', name: '教学分支', icon: 'network' },
  revise: { group: 'teaching', name: '开启改答', icon: 'workshop' },
  close: { group: 'room', name: '结束课堂', icon: 'check' },
};
const phaseLabels = { collect: '收集中', reveal: '已公布', branch: '讨论中', closed: '已结束' };

function entryType(type) {
  return Object.hasOwn(eventTypes, type) ? eventTypes[type] : { group: 'room', name: '课堂事件', icon: 'list' };
}

function eventRows(events) {
  let round = 1;
  let lessonStart = 0;
  return events.map((event, index) => {
    if (['room', 'switchLesson', 'loadLesson', 'lectureInteract'].includes(event.type)) {
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
    const archived = state.lectureArchive?.find(activity => activity.responses.some(item => item.id === id));
    const response = archived?.responses.find(item => item.id === id) ?? ((currentLesson || state.lecture) ? state.responses?.find(item => item.id === id) : null);
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
  const person = (currentLesson || state.lecture) && details.participantId && state.participants?.find(item => item.id === details.participantId);
  const explanation = {
    room: () => `<p>${details.demo ? '已创建用于样本排练的课堂。' : '已创建课堂，学生可以通过课堂码加入。'}</p>`,
    switchLesson: () => `<p>课堂已切换到${currentLesson && state.lesson?.title ? `「${esc(state.lesson.title)}」` : '新的课谱'}。</p>`,
    loadLesson: () => `<p>当前课堂已加载${currentLesson && state.lesson?.title ? `「${esc(state.lesson.title)}」` : '自定义课谱'}。</p>`,
    join: () => person ? `<p>课堂显示名 <strong>${esc(person.name)}</strong></p>` : '',
    demoFill: () => `<p>此次加入 <strong>${esc(details.count ?? 0)}</strong> 份模拟作答。</p>`,
    reveal: () => '<p>全班可以查看本轮作答分布。</p>',
    analyze: () => details.source ? `<p>整理来源 <strong>${esc(({ local: '本地规则', provider: '已配置的模型服务' })[details.source] ?? details.source)}</strong></p>` : '',
    branch: () => `<div class="pr-event-callout"><span>老师选定的讨论方向</span><strong>${esc(details.title ?? details.branchId ?? '教学分支')}</strong>${typeof authority === 'string' && authority ? `<small>由 ${esc(authority)} 批准</small>` : ''}</div>`,
    draw: () => details.eligibleCount == null ? '' : `<p>候选池有 <strong>${esc(details.eligibleCount)}</strong> 位${details.eligibleSource === 'simulated' ? '模拟同学' : '课堂参与者'}。${person ? `抽中 <strong>${esc(person.name)}</strong>。` : ''}</p>`,
    spotlight: () => `<p>${details.count ? `教师审核并向大屏匿名投屏了 <strong>${esc(details.count)}</strong> 条学生原话。` : '教师清空了大屏匿名投屏原话。'}</p>`,
    spotlightWinner: () => `<p>${details.visible ? '教师已将抽签结果公布到大屏。' : '教师隐藏了大屏抽签高亮。'}</p>`,
    timer: () => `<p>${details.seconds ? `开启了 <strong>${esc(details.seconds)}</strong> 秒课堂讨论倒计时。` : '提前结束了课堂倒计时。'}</p>`,
    removeParticipant: () => `<p>移除了未提交作答的占位成员 <strong>${esc(details.name ?? details.participantId ?? '')}</strong>。</p>`,
    lectureExperimentStart: () => `<p>在原稿第 ${esc(details.pageNumber ?? '?')} 页开启了课堂实验 <strong>${esc(challengeNames[details.kind] ?? details.kind ?? '')}</strong>。</p>`,
    experimentVote: () => `<p>学生在实验中投票选择了 <strong>${esc(details.choice ?? '')}</strong>。</p>`,
    lectureExperimentAct: () => `<p>教师执行了实验操作 <strong>${esc(details.action ?? '')}</strong>${details.value != null ? `（参数：${esc(details.value)}）` : ''}。</p>`,
    experimentPeer: () => `<div class="pr-event-callout"><span>AI 同桌观点</span><strong>选择：${esc(details.choice ?? '')}</strong>${details.reason ? `<small>${esc(details.reason)}</small>` : ''}</div>`,
    lecturePulse: () => `<p>学生${details.confused ? '标记' : '取消标记'}原稿第 ${esc(details.pageNumber ?? '?')} 页有疑问（当前页累计 ${esc(details.count ?? 0)} 人）。</p>`,
    revise: () => details.revisionPrompt ? `<div class="pr-event-callout"><span>第二轮题目</span><strong>${esc(details.revisionPrompt)}</strong></div>` : '',
    close: () => '<p>课堂停止收集，记录可在此查看和导出。</p>',
  };
  return `<div class="pr-event-heading"><span class="pr-icon pr-icon--${event.category.group}">${icon(event.category.icon, 23)}</span><div>
    <div class="pr-event-meta"><span>${event.category.name}</span><span>第 ${event.round} 轮</span>${dateLine}</div>
    <h3 id="replay-event-title" tabindex="-1">${esc(event.label ?? event.category.name)}</h3>
    <code>${esc(event.id ?? '')}</code></div></div>
    ${state.lecture && (details.pageNumber || details.lecturePageNumber) ? `<p>讲义来源 · ${esc(state.lecture.sourceName)} · 第 ${esc(details.pageNumber || details.lecturePageNumber)} 页</p>` : ''}
    ${Object.hasOwn(explanation, event.type) ? `<div class="pr-event-copy">${explanation[event.type]()}</div>` : ''}
    ${ids.length || ['branch', 'analyze', 'spotlight'].includes(event.type) ? `<section class="pr-evidence-section" aria-label="关联作答"><h4>关联作答</h4>${citedResponses(ids, state, currentLesson, ctx)}<p class="pr-evidence-note">同一份作答更新后，这里显示最新保存的内容。</p></section>` : ''}`;
}

function pairedChangeFor(responses, round, phase) {
  if (Number(round) < 2 || (phase && !['reveal', 'closed', 'branch'].includes(phase))) return null;
  const list = responses ?? [];
  const first = new Map(list.filter(item => Number(item.round) === 1).map(item => [item.participantId, item]));
  const pairs = list.filter(item => Number(item.round) === 2 && first.get(item.participantId)?.simulated === item.simulated && first.has(item.participantId));
  const real = pairs.filter(item => !item.simulated);
  const sample = real.length ? real : pairs;
  if (!sample.length) return null;
  return { changed: sample.filter(item => first.get(item.participantId).optionId !== item.optionId).length, total: sample.length, live: Boolean(real.length) };
}

function pairedChange(state) {
  return pairedChangeFor(state.responses, state.round, state.phase);
}

function allLectureActivities(state) {
  const archived = state.lectureArchive ?? [];
  if (!state.lecture) return [];
  const list = [...archived];
  if (state.lecture.mode === 'activity' && state.lesson && !list.some(item => item.pageNumber === state.lecture.pageNumber)) {
    list.push({
      pageNumber: state.lecture.pageNumber,
      versionId: state.lecture.sourceVersion,
      lesson: state.lesson,
      round: state.round,
      phase: state.phase,
      decision: state.decision,
      responses: state.responses ?? [],
    });
  }
  return list.sort((a, b) => a.pageNumber - b.pageNumber);
}

function downloadFile(content, filename, mime) {
  const href = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function csvCell(value) {
  const raw = String(value ?? '');
  const text = /^(?:[\t\r\n]|\s*[=+\-@])/u.test(raw) ? "'" + raw : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportArchive(state) {
  const archive = {
    room: state.code, lesson: state.lesson?.title, round: state.round, demo: state.demo,
    decision: state.decision, events: state.events,
    responses: state.responses?.map(({ id, round, optionId, reason, simulated }) => ({ id, round, optionId, reason, simulated })),
    options: state.lesson?.options,
    ...(state.lecture && {
      lecture: state.lecture,
      activities: allLectureActivities(state).map(item => ({
        sourcePage: item.pageNumber, versionId: item.versionId, title: item.lesson.title, options: item.lesson.options,
        decision: item.decision, responses: item.responses.map(({ id, round, optionId, reason, simulated }) => ({ id, round, optionId, reason, simulated })),
      })),
      experiments: state.experimentArchive ?? [],
      pulseCounts: state.pulseCounts ?? {},
    }),
  };
  downloadFile(JSON.stringify(archive, null, 2), `polyphony-${state.code || 'replay'}.json`, 'application/json');
}

function exportCsv(state, includeNames) {
  const participantMap = new Map((state.participants ?? []).map((p, idx) => [p.id, { name: p.name || `学生 ${idx + 1}`, anon: `S${String(idx + 1).padStart(3, '0')}` }]));
  const rows = [['课堂码', '来源页', '课题', '轮次', includeNames ? '学生显示名' : '匿名编号', '来源类型', '选项编号', '选项内容', '作答理由', '光强预测']];
  const emit = (lesson, pageNumber, responses) => {
    const optIndex = new Map((lesson?.options ?? []).map((opt, idx) => [opt.id, { letter: String.fromCharCode(65 + idx), label: opt.label }]));
    for (const r of responses ?? []) {
      const person = participantMap.get(r.participantId);
      const who = includeNames ? (person?.name ?? r.participantId ?? '') : (person?.anon ?? '匿名');
      const opt = optIndex.get(r.optionId) ?? { letter: '', label: r.optionId };
      const sample = r.sample ? `${r.sample.phaseIndex * 45}°:${Math.round(r.sample.power * 100)}%` : '';
      rows.push([
        state.code ?? '', pageNumber ? `第 ${pageNumber} 页` : '', lesson?.title ?? '',
        `第 ${r.round} 轮`, who, r.simulated ? '模拟' : '现场',
        opt.letter, opt.label, r.reason ?? '', sample,
      ]);
    }
  };
  if (state.lecture) {
    for (const act of allLectureActivities(state)) emit(act.lesson, act.pageNumber, act.responses);
  } else {
    emit(state.lesson, null, state.responses);
  }
  const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  downloadFile(csv, `polyphony-${state.code || 'replay'}-${includeNames ? 'named' : 'anon'}.csv`, 'text/csv;charset=utf-8');
}

function exportMarkdown(state, includeNames) {
  const participantMap = new Map((state.participants ?? []).map((p, idx) => [p.id, { name: p.name || `学生 ${idx + 1}`, anon: `匿名同学 #${idx + 1}` }]));
  const lines = [];
  const title = state.lecture?.title || state.lesson?.title || '课堂复盘报告';
  lines.push(`# 共演课堂复盘报告：${title}`, '');
  lines.push(`- **课堂码**：\`${state.code ?? ''}\``);
  lines.push(`- **导出时间**：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`- **参与人数**：${(state.participants ?? []).length} 人`);
  lines.push(`- **隐私模式**：${includeNames ? '包含学生显示名' : '已匿名脱敏'}`, '');

  const appendActivity = (heading, lesson, responses, round, phase, decision) => {
    lines.push(`## ${heading}`, '');
    if (lesson?.prompt) lines.push(`> ${lesson.prompt.replace(/\n/g, '\n> ')}`, '');
    const rounds = [...new Set((responses ?? []).map(r => Number(r.round) || 1))].sort((a, b) => a - b);
    for (const rNum of rounds) {
      const subset = (responses ?? []).filter(r => (Number(r.round) || 1) === rNum);
      lines.push(`### 第 ${rNum} 轮分布（共 ${subset.length} 份）`, '');
      lines.push('| 选项 | 票数 | 占比 |', '| --- | ---: | ---: |');
      for (const [idx, opt] of (lesson?.options ?? []).entries()) {
        const count = subset.filter(r => r.optionId === opt.id).length;
        const pct = subset.length ? Math.round(count / subset.length * 100) : 0;
        lines.push(`| ${String.fromCharCode(65 + idx)}. ${opt.label.replace(/\|/g, '\\|')} | ${count} | ${pct}% |`);
      }
      lines.push('');
    }
    const shift = pairedChangeFor(responses, round ?? Math.max(1, ...rounds), phase ?? 'closed');
    if (shift) lines.push(`- **两轮认知迁移**：${shift.total} 位完成两轮作答，其中 **${shift.changed} 位**改变了选择。`);
    if (decision?.title) lines.push(`- **教师选定教学分支**：${decision.title}`);
    const reasons = (responses ?? []).filter(r => r.reason?.trim() && !r.simulated);
    if (reasons.length) {
      lines.push('', '### 现场学生理由摘录', '');
      for (const r of reasons.slice(0, 20)) {
        const person = participantMap.get(r.participantId);
        const who = includeNames ? (person?.name ?? '学生') : (person?.anon ?? '匿名同学');
        const opt = lesson?.options?.find(o => o.id === r.optionId)?.label ?? r.optionId;
        lines.push(`- **[第 ${r.round} 轮 · ${opt}] ${who}**：${r.reason.replace(/\n/g, ' ')}`);
      }
    }
    lines.push('');
  };

  if (state.lecture) {
    const acts = allLectureActivities(state);
    if (acts.length) {
      for (const act of acts) {
        appendActivity(`原稿第 ${act.pageNumber} 页 · ${act.lesson?.title ?? '互动'}`, act.lesson, act.responses, act.round, act.phase, act.decision);
      }
    }
    const exps = state.experimentArchive ?? [];
    if (exps.length) {
      lines.push('## 课堂实验记录', '');
      for (const exp of exps) {
        lines.push(`- **原稿第 ${exp.pageNumber} 页 · ${challengeNames[exp.kind] ?? exp.kind}**：阶段 \`${exp.step}\`${exp.choice ? `，全班判断 \`${exp.choice}\`` : ''}${exp.answer ? `（实际：\`${exp.answer}\`）` : ''}`);
      }
      lines.push('');
    }
    const pulses = Object.entries(state.pulseCounts ?? {}).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    if (pulses.length) {
      lines.push('## 学生困惑热页（重点复习建议）', '');
      for (const [page, count] of pulses) {
        lines.push(`- **原稿第 ${page} 页**：${count} 位学生标记有疑问`);
      }
      lines.push('');
    }
  } else {
    appendActivity(state.lesson?.title ?? '课堂互动', state.lesson, state.responses, state.round, state.phase, state.decision);
  }
  downloadFile(lines.join('\n'), `polyphony-${state.code || 'replay'}-report.md`, 'text/markdown;charset=utf-8');
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

function renderLectureSummary(state, esc, icon) {
  if (!state.lecture) return '';
  const activities = allLectureActivities(state);
  const experiments = state.experimentArchive ?? [];
  const pulseHotspots = Object.entries(state.pulseCounts ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!activities.length && !experiments.length && !pulseHotspots.length) return '';
  return `<section class="pr-lecture-summary" aria-label="讲义课堂教学汇总">
    ${activities.length ? `<div class="pr-summary-card">
      <header>${icon('network', 17)}<h3>原页互动汇总（${activities.length} 项）</h3></header>
      <ul class="pr-summary-list">${activities.map(act => {
        const shift = pairedChangeFor(act.responses, act.round ?? 2, act.phase);
        const liveCount = (act.responses ?? []).filter(r => !r.simulated).length;
        return `<li>
          <div><strong>第 ${act.pageNumber} 页 · ${esc(act.lesson?.title ?? '课堂互动')}</strong>
            <small>${liveCount} 份现场作答${act.decision?.title ? ` · 分支：${esc(act.decision.title)}` : ''}</small></div>
          ${shift ? `<span class="pr-badge-shift">${shift.changed}/${shift.total} 改答</span>` : ''}
        </li>`;
      }).join('')}</ul>
    </div>` : ''}
    ${experiments.length ? `<div class="pr-summary-card">
      <header>${icon('lab', 17)}<h3>课堂实验归档（${experiments.length} 次）</h3></header>
      <ul class="pr-summary-list">${experiments.map(exp => `<li>
        <div><strong>第 ${exp.pageNumber} 页 · ${esc(challengeNames[exp.kind] ?? exp.kind)}</strong>
          <small>阶段：${esc(exp.step)}${exp.choice ? ` · 判断：${esc(exp.choice)}` : ''}${exp.peer ? ' · 含 AI 同桌' : ''}</small></div>
      </li>`).join('')}</ul>
    </div>` : ''}
    ${pulseHotspots.length ? `<div class="pr-summary-card">
      <header>${icon('help', 17)}<h3>学生困惑热页</h3></header>
      <ul class="pr-summary-list">${pulseHotspots.map(([page, count]) => `<li>
        <div><strong>原稿第 ${esc(page)} 页</strong><small>建议课后重点答疑或下节课回顾</small></div>
        <span class="pr-badge-pulse">${count} 人有疑问</span>
      </li>`).join('')}</ul>
    </div>` : ''}
  </section>`;
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
  const responses = [...(state.responses ?? []), ...(state.lectureArchive ?? []).flatMap(item => item.responses)];
  const simulated = responses.filter(item => item.simulated).length;
  const change = pairedChange(state);
  const decision = state.decision;
  const branchEvent = events.findLast(event => event.type === 'branch' && event.lessonStart === latest?.lessonStart && event.detail?.branchId === decision?.branchId);
  root.innerHTML = `<div class="pr-review">
    <header class="pr-page-header"><div><h1>课堂回顾</h1><p>查看课堂事件、教学决定、实验归档与关联作答。</p></div><div class="pr-page-actions">
      <label class="pr-name-toggle"><input type="checkbox" id="replay-include-names"${review.includeNames ? ' checked' : ''}><span>导出含姓名</span></label>
      <button class="pr-button" id="replay-return" type="button">${icon('arrow-left', 16)}返回控制台</button>
      <button class="pr-button" id="replay-export-csv" type="button"${responses.length ? '' : ' disabled'}>${icon('download', 16)}导出 CSV</button>
      <button class="pr-button" id="replay-export-md" type="button"${events.length ? '' : ' disabled'}>${icon('book', 16)}复盘报告 (.md)</button>
      <button class="pr-button pr-primary" id="replay-export" type="button"${events.length ? '' : ' disabled'}>${icon('download', 16)}导出 JSON</button>
    </div></header>
    <section class="pr-overview" aria-label="课堂概览">
      <div class="pr-class"><span class="pr-class-icon">${icon('book', 26)}</span><div><div class="pr-class-meta"><span>课堂码 <b>${esc(state.code ?? '')}</b></span><span>第 ${esc(state.round ?? 1)} 轮</span>${phaseLabels[state.phase] ? `<span class="pr-status${state.phase === 'closed' ? ' is-closed' : ''}">${phaseLabels[state.phase]}</span>` : ''}${state.demo ? '<span>样本排练</span>' : ''}</div><h2>${esc(state.lecture?.title || state.lesson?.title || '课堂存档')}</h2></div></div>
      <dl class="pr-stats"><div><dt>课堂事件</dt><dd>${events.length}</dd></div><div><dt>本课真实作答</dt><dd>${responses.length - simulated}</dd></div><div><dt>本课模拟作答</dt><dd>${simulated}</dd></div></dl>
    </section>
    ${decision || change ? `<div class="pr-highlights">
      ${decision ? `<section class="pr-highlight"><span class="pr-icon pr-icon--teaching">${icon('network', 18)}</span><div><h2>本课采用的教学分支</h2><strong>${esc(decision.title ?? decision.branchId)}</strong></div>${branchEvent ? `<button class="pr-text-button" id="replay-find-branch" type="button">定位事件${icon('arrow-right', 15)}</button>` : ''}</section>` : ''}
      ${change ? `<section class="pr-highlight"><span class="pr-icon">${icon('chart', 18)}</span><div><h2>${change.live ? '两轮均提交的学生' : '两轮模拟作答'}</h2><strong>${change.changed} / ${change.total} 位更换了选项</strong></div></section>` : ''}
    </div>` : ''}
    ${renderLectureSummary(state, esc, icon)}
    <div class="pr-columns">
      <section class="pr-card pr-list-panel" aria-labelledby="replay-timeline-title">
        <div class="pr-panel-header"><h2 id="replay-timeline-title">事件时间线</h2><span class="pr-match-count" data-match-count role="status"></span></div>
        <div class="pr-query"><label class="pr-sr-only" for="replay-search">搜索事件、分支或作答编号</label><input id="replay-search" type="search" placeholder="搜索事件、分支或作答编号" value="${esc(review.query)}" autocomplete="off"></div>
        <div class="pr-filters" aria-label="筛选事件类型">${groups.map(([key, title]) => `<button type="button" id="replay-filter-${key}" data-filter="${key}" aria-pressed="${key === review.group}">${title}</button>`).join('')}</div>
        <ul class="pr-timeline" aria-label="课堂事件"></ul>
      </section>
      <section class="pr-card pr-detail-panel" aria-labelledby="replay-detail-title">
        <div class="pr-panel-header"><h2 id="replay-detail-title">事件详情</h2><div class="pr-stepper"><button class="pr-button" type="button" id="replay-before" aria-label="上一条">${icon('chevron-right', 16)}<span>上一条</span></button><span data-counter aria-live="polite"></span><button class="pr-button" type="button" id="replay-after" aria-label="下一条"><span>下一条</span>${icon('chevron-right', 16)}</button></div></div>
        <div class="pr-entry-content"></div>
        ${decision && !branchEvent ? `<details class="pr-archive-branch"${keepBranchOpen ? ' open' : ''}><summary id="replay-branch-evidence">本课教学分支的关联作答</summary>${citedResponses(decision.evidenceIds, state, true, ctx)}</details>` : ''}
      </section>
    </div>
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
  root.querySelector('#replay-include-names').onchange = event => { review.includeNames = event.target.checked; };
  root.querySelector('#replay-return').onclick = () => ctx.go('desk');
  root.querySelector('#replay-export').onclick = () => exportArchive(state);
  root.querySelector('#replay-export-csv').onclick = () => exportCsv(state, review.includeNames);
  root.querySelector('#replay-export-md').onclick = () => exportMarkdown(state, review.includeNames);
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
