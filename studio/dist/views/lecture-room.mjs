import { fitLectureSlide, fitPresentationContent, renderLectureFrame } from './lecture-stage.mjs';
import { moduleHtml, bindModule } from './module-renderer.mjs';
import { cognitionReport } from '../core/cognition.mjs';
import { renderRichMathHtml } from '../core/math-render.mjs';
import { projectRoom } from '../core/transport.mjs';
import { buildStudentReviewHtml, downloadHtml } from '../core/report-export.mjs';
import { renderChallenge } from './challenge-lab.mjs';

const players = new WeakMap();
const presentations = new WeakMap();
const names = {'concept-diagnosis@1':'概念诊断','step-fault@1':'逐行找茬','param-explorer@1':'公式沙盒','evidence-weighing@1':'证据权衡'};
const publicPhases = new Set(['reveal', 'branch', 'closed']);
const phaseNames = {collect:'独立作答', reveal:'本轮结果', branch:'机制讨论', closed:'本页已完成'};
const companionLabels = {a:'👤 学生 A', b:'👤 学生 B', remote:'📱 手机遥控'};
const companionSwitchLabel = '🖥+📱 同屏演示';
const btn = (action, label, extra = '') => `<button type="button" data-inline-action="${action}" ${extra}>${label}</button>`;
const primary = (action, label) => btn(action, label, 'class="presenter-primary" aria-keyshortcuts="Enter"');
const reviewDownload = () => btn('downloadReview', '📥 保存我的本课复习单（HTML）', 'class="native-review-download"');
const disabled = condition => condition ? 'disabled' : '';
const roundCount = state => state.responseCount ?? state.responses.filter(r => r.round === state.round).length;

export function lectureTakeaways(state) {
  const cards = new Map((state.lectureTakeaways ?? []).map(s => [s.pageNumber, s]));
  for (const item of state.lectureArchive ?? []) {
    if (item.phase === 'closed') cards.set(item.pageNumber,
      {pageNumber:item.pageNumber, title:item.lesson.title, ...(item.lesson.takeaway ?? item.lesson.moduleConfig?.takeaway ?? {})});
  }
  if (state.lecture?.mode === 'activity' && state.phase === 'closed') cards.set(state.lecture.pageNumber,
    {pageNumber:state.lecture.pageNumber, title:state.lesson.title, ...(state.lesson.takeaway ?? state.lesson.moduleConfig?.takeaway ?? {})});
  return [...cards.values()].sort((a,b) => a.pageNumber - b.pageNumber);
}

export function takeawayDrawerHtml(state, e, includeDownload = false) {
  const cards = lectureTakeaways(state).filter(card => card.summary || card.formula || card.pitfall);
  if (!cards.length) return '';
  return `<details class="native-takeaways"><summary>本课速查（${cards.length}）</summary>${includeDownload ? reviewDownload() : ''}${cards.map(c => `<article>
    <h3>第 ${c.pageNumber} 页 · ${renderRichMathHtml(c.title)}</h3>
    ${c.formula ? '<div class="takeaway-formula">' + renderRichMathHtml(c.formula, {block:true}) + '</div>' : ''}
    ${c.summary ? '<p>' + renderRichMathHtml(c.summary) + '</p>' : ''}
    ${c.pitfall ? '<p class="takeaway-pitfall">' + renderRichMathHtml(c.pitfall) + '</p>' : ''}
  </article>`).join('')}</details>`;
}

function distributionHtml(state, report, e) {
  const secondRound = state.round === 2;
  const codeLines = state.lesson.activityId === 'step-fault@1';
  if (codeLines && !secondRound) return '';
  const percent = (tally, id) => tally.total ? Math.round((tally.counts[id] ?? 0) * 100 / tally.total) : 0;
  return `<div class="inline-distribution${secondRound ? ' inline-distribution--paired' : ''}">${state.lesson.options.map(option => {
    const first = percent(report.first, option.id), second = percent(report.second, option.id);
    if (!secondRound) return `<div><span>${e(option.id)} · ${renderRichMathHtml(option.label)}</span><b>${report.first.counts[option.id] ?? 0}</b><i style="width:${first}%" aria-hidden="true"></i></div>`;
    const difference = second - first;
    const label = codeLines ? e(option.id) : e(option.id) + ' · ' + renderRichMathHtml(option.label);
    return `<div class="inline-round-shift"><span>${label}</span>
      <b>首轮 ${first}% → 二轮 ${second}%（${difference > 0 ? '+' : difference < 0 ? '−' : ''}${Math.abs(difference)}pp）</b>
      <div class="inline-shift-tracks" aria-hidden="true"><div><span style="width:${first}%"></span></div><div><span style="width:${second}%"></span></div></div>
    </div>`;
  }).join('')}</div>`;
}

function excerptsHtml(state, e, currentOption) {
  const excerpts = state.analysis?.optionExcerpts;
  if (!excerpts) return '';
  const choices = state.lesson.options.filter(option => excerpts[option.id]?.length);
  if (!choices.length) return '';
  const selected = choices.some(option => option.id === currentOption) ? currentOption : choices[0].id;
  return `<section class="inline-excerpts" aria-label="选项代表原话">
    <div class="inline-excerpt-tabs"><b>选项原话</b>${choices.map(({id}) =>
      `<button type="button" data-inline-excerpt="${e(id)}" aria-pressed="${id === selected}">${e(id)}</button>`).join('')}</div>
    ${choices.map(({id}) => `<div class="inline-excerpt-quotes" data-excerpt-option="${e(id)}" ${id === selected ? '' : 'hidden'}>${excerpts[id].map(quote =>
      `<blockquote>${renderRichMathHtml(quote)}</blockquote>`).join('')}</div>`).join('')}
  </section>`;
}

export function inlineResultsHtml(state, e, currentOption) {
  const responses = (state.responses ?? []).filter(r => r.round === state.round);
  const count = state.responseCount ?? responses.length;
  const simulated = state.simulatedResponseCount ?? responses.filter(r => r.simulated).length;
  let html = `<div class="inline-live-count"><b>${count}</b> 份作答 · 第 ${state.round} 轮${simulated ? ` <span>含${simulated}份模拟</span>` : ''}</div>`;
  if (!publicPhases.has(state.phase)) return html;
  const report = cognitionReport(state);
  html += distributionHtml(state, report, e);
  const currentPair = state.analysis?.contrastPair;
  const pair = currentPair?.length ? currentPair : state.firstRoundAnalysis?.contrastPair ?? state.firstRoundContrastPair;
  if (state.analysis?.summary && !pair?.length) html += '<p class="inline-analysis-note">' + renderRichMathHtml(state.analysis.summary) + '</p>';
  if (pair?.length) html += `<div class="inline-reason-split">${pair.slice(0,2).map((p,i) =>
    `<article class="reason-${i ? 'blue' : 'red'}"><b>${renderRichMathHtml(p.sideLabel ?? '理由对照')}</b><p>${renderRichMathHtml(p.quote)}</p></article>`).join('')}</div>`;
  html += excerptsHtml(state, e, currentOption);
  if (state.round === 2) html += `<div class="inline-paired">${report.paired.changed} / ${report.paired.total} 人改了答案${report.paired.source === 'simulated' && report.paired.total ? '（模拟）' : ''}${report.secondCorrect != null ? ' · 本轮正确率 '+report.secondCorrect+'%' : ''}</div>`;
  if (state.phase === 'closed') html += `<div class="inline-feedback"><b>${state.lesson.correctOptionId ? '本页参考答案：'+e(state.lesson.correctOptionId) : '本页没有唯一标准立场'}</b><p>${renderRichMathHtml(state.lesson.takeaway?.summary ?? state.lesson.moduleConfig?.takeaway?.summary ?? '请用证据检验原判断。')}</p></div>`;
  return html;
}

function closeCompanion(mount) {
  const current = mount.companion;
  mount.companion = null;
  current?.offState?.();
  current?.offStatus?.();
  current?.dispose?.();
  current?.client?.close();
  mount.sideHost.replaceChildren();
}

async function showCompanion(mount) {
  const key = mount.selection;
  if (mount.companion?.key === key && !mount.companion.failed) return;
  closeCompanion(mount);
  const current = {key};
  mount.companion = current;
  mount.sideHost.innerHTML = '<p class="native-companion-status" role="status">正在连接同屏席位…</p>';
  try {
    const client = await mount.ctx.openCompanion(key);
    if (mount.companion !== current || !mount.root.isConnected) {
      client.close();
      return;
    }
    current.client = client;
    const paint = () => {
      if (mount.companion !== current) return;
      current.dispose = renderLectureRoom(mount.sideHost, client.context(), key === 'remote' ? 'teacher' : 'student');
    };
    current.offState = client.subscribe(paint);
    current.offStatus = client.subscribeStatus?.(paint);
    paint();
  } catch (error) {
    if (mount.companion !== current) return;
    closeCompanion(mount);
    mount.companion = {key, failed:true};
    mount.sideHost.innerHTML = `<p class="native-companion-status" role="alert">${mount.ctx.esc(error.message)} 请点上方标签重试。</p>`;
  }
}

function paintPresentation(mount) {
  const {ctx, main, side, layout} = mount;
  if (ctx.state.lecture.mode === 'ended') mount.split = false;
  layout.classList.toggle('is-split', mount.split);
  main.classList.toggle('native-split-stage', mount.split);
  side.hidden = !mount.split;
  mount.disposePlayer = renderPlayer(main, {...ctx, split:mount.split, toggleSplit:mount.toggleSplit}, 'teacher');
  if (!mount.split) {
    if (mount.companion) closeCompanion(mount);
    return;
  }
  for (const button of side.querySelectorAll('[data-companion-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.companionView === mount.selection));
  }
  if (!mount.companion) void showCompanion(mount);
}

export function renderLectureRoom(root, ctx, role) {
  if (role !== 'teacher' || ctx.remote || !ctx.openCompanion) return renderPlayer(root, ctx, role);
  let mount = presentations.get(root);
  if (!mount) {
    root.innerHTML = `<div class="native-presentation"><div data-native-main></div>
      <aside class="native-split-companion" hidden aria-label="同屏演示"><div class="native-companion-tabs" role="group" aria-label="演示席位">
        ${Object.entries(companionLabels).map(([key, label]) => `<button type="button" data-companion-view="${key}" aria-pressed="false">${label}</button>`).join('')}
      </div><div class="native-companion-screen" data-companion-screen></div></aside></div>`;
    const layout = root.firstElementChild;
    mount = {root, layout, main:layout.firstElementChild, side:layout.lastElementChild,
      sideHost:layout.querySelector('[data-companion-screen]'), selection:'a', split:Boolean(ctx.initialSplit)};
    presentations.set(root, mount);
    mount.toggleSplit = () => {
      mount.split = !mount.split;
      paintPresentation(mount);
    };
    mount.side.querySelector('.native-companion-tabs').addEventListener('click', event => {
      const key = event.target.closest('[data-companion-view]')?.dataset.companionView;
      if (!key || !mount.split) return;
      mount.selection = key;
      void showCompanion(mount);
      paintPresentation(mount);
    });
    mount.dispose = () => {
      if (presentations.get(root) !== mount) return;
      presentations.delete(root);
      closeCompanion(mount);
      mount.disposePlayer?.();
      layout.remove();
    };
  }
  mount.ctx = ctx;
  paintPresentation(mount);
  return mount.dispose;
}

function fullscreen(root, ctx) {
  if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
  const target = root.closest('#surface') ?? root;
  target.requestFullscreen?.().catch(() => ctx.toast('浏览器未能进入全屏。'));
}

function presenterControls(entry, active) {
  const {state, esc, modelAvailable, analysisAvailable = modelAvailable} = entry.ctx;
  if (!active) return state.lecture.hasInteraction && state.lecture.mode === 'slides' ? primary('interact', '开启本页互动') : '';
  if (state.phase === 'closed') return '';
  const first = state.round === 1;
  const collecting = state.phase === 'collect';
  const recommend = analysisAvailable && first
    ? btn('analyze', '✨ AI 深化推荐', disabled(collecting || !roundCount(state)) + (collecting ? ' title="公布结果后可深化"' : '')) : '';
  if (collecting) return primary('reveal', first ? '公布结果' : '公布二轮结果') + recommend;
  if (!first) return primary('close', '完成本页 · 发速查卡');

  const branches = state.lesson.branches;
  const preferred = entry.branchSelection ?? state.decision?.branchId ?? state.analysis?.recommendedId ?? branches[0]?.id;
  const selected = branches.some(branch => branch.id === preferred) ? preferred : branches[0]?.id;
  return `<label class="inline-branch-control">讨论分支<select data-inline-branch>
    ${branches.map(branch => `<option value="${esc(branch.id)}" ${branch.id === selected ? 'selected' : ''}>${esc(branch.title)}</option>`).join('')}
    </select></label>${primary('secondRound', '开启第二轮')}${recommend}`;
}

function presenterTools(state, active, remote) {
  const draw = btn('draw', '🎲 随机抽签', disabled(!active || !state.responses.length));
  if (remote) return draw;
  return `${btn('demoFill', '🧪 注入演练样本', disabled(!active || state.phase !== 'collect'))}
    ${btn('resetActivity', '🔄 重置本页互动', disabled(!state.lecture.hasInteraction || !['slides','activity'].includes(state.lecture.mode)))}
    ${draw}<div class="presenter-timer" role="group" aria-label="限时"><span>⏱ 限时</span>
    ${btn('timer60','60s')}${btn('timer90','90s')}${btn('timerClear','清除',disabled(!state.timer))}</div>`;
}

function readPageMarks(storageName, key) {
  try {
    const pages = JSON.parse(window[storageName].getItem(key));
    if (Array.isArray(pages)) return new Set(pages.filter(Number.isInteger));
  } catch { /* The controls still work when browser storage is restricted. */ }
  return new Set();
}

function savePageMarks(storageName, key, pages) {
  try { window[storageName].setItem(key, JSON.stringify([...pages])); }
  catch { /* Keep the current view usable if browser storage is full. */ }
}

function setMark(marks, page, active) {
  if (active) marks.add(page);
  else marks.delete(page);
}

function readReviewLog(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* The in-memory log still serves the current student view. */ }
  return {};
}

function updatePersonalReview(entry, update) {
  const log = readReviewLog(entry.reviewKey);
  const participantId = entry.reviewParticipant;
  const saved = Object.hasOwn(log, participantId) ? log[participantId] : null;
  const current = !entry.reviewUnsaved && Array.isArray(saved?.records) && saved.titles ? saved : entry.personalReview;
  const next = update(current);
  entry.personalReview = next ?? current;
  if (!next) return;
  try {
    sessionStorage.setItem(entry.reviewKey, JSON.stringify({ ...log, [participantId]:next }));
    entry.reviewUnsaved = false;
  } catch { entry.reviewUnsaved = true; }
}

function rememberStudentAnswers(entry, state) {
  const { lecture, lesson } = state;
  if (!entry.reviewParticipant || lecture?.mode !== 'activity' || entry.reviewKey !== 'polyphony.mylog.' + state.code) return;
  const labelFor = id => lesson.options.find(option => option.id === id)?.label ?? '';
  const answers = (state.responses ?? []).filter(r => r.participantId === entry.reviewParticipant && !r.simulated)
    .map(({round,optionId,reason}) => ({round,optionId,reason,label:labelFor(optionId)}));
  if (!answers.length) return;
  updatePersonalReview(entry, current => {
    const { pageNumber } = lecture;
    const previous = current.records.find(record => record.pageNumber === pageNumber);
    if (previous?.version > state.version) return null;
    const takeaway = lesson.takeaway ?? lesson.moduleConfig?.takeaway;
    const correct = lesson.correctOptionId;
    const reference = publicPhases.has(state.phase) ? {
      optionId:correct, label:labelFor(correct),
      summary:takeaway?.summary ?? lesson.moduleConfig?.faultDiagnosis ?? (!correct ? '请结合课堂证据复核自己的立场。' : ''),
      formula:takeaway?.formula, pitfall:takeaway?.pitfall,
    } : state.round === 2 ? previous?.reference : undefined;
    const record = {pageNumber,title:lesson.title,prompt:lesson.prompt,revisionPrompt:state.revisionPrompt,answers,reference};
    const { version, ...previousContent } = previous ?? {};
    if (JSON.stringify(record) === JSON.stringify(previousContent)) return null;
    return {...current,records:[...current.records.filter(item => item.pageNumber !== pageNumber),{...record,version:state.version}]};
  });
}

function rememberMarkedTitle(entry, pageNumber) {
  const title = entry.pageTitle;
  if (!title || !(entry.bookmarks.has(pageNumber) || entry.muddy.has(pageNumber))) return;
  updatePersonalReview(entry, current => current.titles[pageNumber] === title ? null :
    {...current,titles:{...current.titles,[pageNumber]:title}});
}

function downloadPersonalReview(entry) {
  const { state } = entry.ctx;
  updatePersonalReview(entry, () => null);
  const { records, titles } = entry.personalReview;
  const takeaways = lectureTakeaways(state).filter(card => card.summary || card.formula || card.pitfall);
  const completed = new Map(takeaways.map(card => [card.pageNumber, card]));
  const pages = marks => [...marks].sort((a,b) => a-b).map(pageNumber => ({
    pageNumber, title:titles[pageNumber] ?? completed.get(pageNumber)?.title,
  }));
  const personalRecords = [...records].sort((a,b) => a.pageNumber-b.pageNumber).map(record => ({
    ...record, reference:record.reference ?? completed.get(record.pageNumber),
  }));
  const html = buildStudentReviewHtml({ title:state.lecture.title, code:state.code, takeaways, personalRecords,
    bookmarkedPages:pages(entry.bookmarks), muddyPages:pages(entry.muddy) });
  downloadHtml(html, `本课个人复习单-${state.code}.html`);
}

function privateTeachingTools() {
  return `<div class="private-triage" data-private-triage hidden>
    ${btn('quickTriage', '⚡ 快速诊断本页难点', 'class="private-triage-button"')}
    <span role="status" data-triage-status></span><ol data-triage-hints aria-live="polite"></ol>
  </div><p data-teacher-cue aria-live="polite" hidden></p>`;
}

function paintPrivateTeachingTools(entry) {
  const { ctx, shell } = entry;
  const { lecture, round } = ctx.state;
  const canTriage = lecture.mode === 'slides' && lecture.muddyCount > 0 && Boolean(ctx.quickTriage);
  const notes = shell.querySelector('[data-speaker-content]');
  const noteText = lecture.speakerNotes || (ctx.remote && !canTriage ? '本页暂无提词。' : '');
  if (entry.paintedNote !== noteText) {
    entry.paintedNote = noteText;
    notes.innerHTML = renderRichMathHtml(noteText);
  }
  notes.hidden = !noteText;
  const cue = shell.querySelector('[data-teacher-cue]');
  const cueText = entry.teacherCue?.round === round && lecture.mode === 'activity' ? entry.teacherCue.text : '';
  if (entry.paintedCue !== cueText) {
    entry.paintedCue = cueText;
    cue.innerHTML = renderRichMathHtml(cueText);
  }
  cue.hidden = !cueText;
  const details = notes.closest('details');
  if (details) {
    details.hidden = !lecture.speakerNotes && !canTriage && !cueText;
    const title = canTriage ? `🗒 讲者提词 · ${lecture.muddyCount} 人存疑` : '🗒 讲者提词';
    if (details.firstElementChild.textContent !== title) details.firstElementChild.textContent = title;
  }
  const triage = shell.querySelector('[data-private-triage]');
  triage.hidden = !canTriage;
  triage.querySelector('button').disabled = Boolean(entry.triageController);
  const status = triage.querySelector('[data-triage-status]');
  const message = entry.triageController ? '正在读取本页证据…' : entry.triageMessage ?? '';
  if (status.textContent !== message) status.textContent = message;
  if (entry.paintedHints === entry.triageHints) return;
  entry.paintedHints = entry.triageHints;
  const hints = (entry.triageHints ?? []).map(text => {
    const item = document.createElement('li');
    item.innerHTML = renderRichMathHtml(text);
    return item;
  });
  triage.querySelector('[data-triage-hints]').replaceChildren(...hints);
}

async function requestQuickTriage(entry) {
  if (entry.role !== 'teacher' || entry.triageController || !entry.ctx.quickTriage) return;
  const controller = new AbortController();
  entry.triageController = controller;
  entry.triageHints = undefined;
  paintPrivateTeachingTools(entry);
  try {
    const result = await entry.ctx.quickTriage({ signal: controller.signal });
    if (controller.signal.aborted) return;
    entry.triageHints = result.hints;
    entry.triageMessage = result.source === 'provider' ? '快速决策模型' : '根据本页原文';
  } catch (error) {
    if (!controller.signal.aborted) entry.triageMessage = error.message;
  } finally {
    if (entry.triageController === controller) {
      entry.triageController = null;
      paintPrivateTeachingTools(entry);
    }
  }
}

function buildPlayer(root, ctx, role, key, notesOpen, previous) {
  const {state, esc:e, remote} = ctx, lecture = state.lecture;
  const teacher = role === 'teacher', student = role === 'student', stage = role === 'stage';
  const entry = {key, ctx, role, drafts:new Map()};
  players.set(root, entry);
  root.innerHTML = `<section data-native-player class="native-player native-player--${role}${remote ? ' native-player--remote' : ''}">
    <header class="native-player-bar"><div>
      ${stage ? '' : '<b>'+renderRichMathHtml(lecture.title)+'</b>'}
      <p>第 ${lecture.index+1} / ${lecture.total} 页${ctx.demonstration ? ' · 演示课堂' : ''}</p>
      ${remote ? '<h2 class="remote-page-title">'+renderRichMathHtml(lecture.filmstrip?.[lecture.index]?.title ?? '')+'</h2>' : ''}
    </div><div class="native-bar-actions"><output class="native-countdown" data-countdown aria-label="剩余时间" aria-live="off" hidden></output>
      ${teacher ? '<output class="native-draw-result" data-draw-result hidden></output>' : ''}
      ${remote ? '<span data-remote-status role="status"></span>' : teacher ?
        (ctx.toggleSplit ? btn('split', companionSwitchLabel, `aria-pressed="${ctx.split}" aria-keyshortcuts="S"`) : '') +
        btn('stage','打开投影') + btn('invite','邀请学生') + `<details class="presenter-more"><summary>更多</summary><div>
        ${ctx.remotePair ? btn('remote','手机遥控') : ''}${btn('fullscreen','全屏')}${btn('finish','结束上课')}</div></details>`
      : stage ? btn('fullscreen','全屏') : ''}
    </div></header>
    ${remote ? `<section class="remote-brief"><div class="remote-metrics">
        <span><b data-remote-responses>0</b> 本轮作答</span><span><b data-remote-muddy>0</b> 🙋 本页存疑</span></div>
        <article class="remote-notes" data-speaker-card><h3>🗒 讲者提词</h3><p data-speaker-content></p>${privateTeachingTools()}</article></section>` : ''}
    <div class="native-canvas${student ? ' native-mobile-card' : ''}" data-surface-role="${role}"><div class="native-layout">
      <div data-native-slide ${!student && !remote ? 'tabindex="0" aria-label="本页讲义"' : ''}><p role="status">正在载入课件…</p></div><aside data-inline-widget class="native-inline" hidden aria-label="本页互动"></aside>
    </div></div>
    ${teacher ? `<footer class="presenter-dock"><div class="presenter-pager">
      ${btn('previous',remote ? '◀ 上一页' : '上一页',disabled(lecture.index === 0))}
      ${remote ? '' : `<select data-lecture-page aria-label="跳转到课件页">
        ${Array.from({length:lecture.total}, (_, i) => `<option value="${i}" ${i === lecture.index ? 'selected' : ''}>第 ${i+1} 页${lecture.filmstrip?.[i]?.activityId ? ' · 互动' : ''}</option>`).join('')}</select>`}
      ${btn('next',remote ? '下一页 ▶' : '下一页',disabled(lecture.index === lecture.total-1))}
    </div><div class="presenter-controls" data-presenter-controls></div><div class="presenter-utility" data-presenter-tools></div>
    ${remote ? '' : `<nav class="native-filmstrip" data-filmstrip aria-label="课件胶片条"></nav>
      <details class="native-speaker-notes" ${notesOpen ? 'open' : ''}><summary>🗒 讲者提词</summary><p data-speaker-content></p>${privateTeachingTools()}</details>`}</footer>` : ''}
    ${stage ? '<div class="stage-filmstrip" data-filmstrip aria-label="课件进度"></div>' : ''}
    ${student ? `<div class="native-slide-tools" data-slide-tools hidden>
      ${btn('bookmark','⭐ 待复习','aria-pressed="false"')}${btn('slidePulse','🙋 本页有疑问','aria-pressed="false"')}
    </div><div data-takeaway-drawer></div>` : ''}</section>`;
  entry.shell = root.firstElementChild;
  entry.widget = entry.shell.querySelector('[data-inline-widget]');
  entry.perform = async operation => {
    if (entry.busy) return null;
    entry.busy = true;
    try { return await operation(entry.ctx.command); }
    catch (error) { entry.ctx.toast(error.message); return null; }
    finally { entry.busy = false; }
  };
  entry.execute = (type, payload) => entry.perform(send => send(type, payload));
  const pageSelect = entry.shell.querySelector('[data-lecture-page]');
  if (pageSelect) pageSelect.onchange = async () => {
    const changed = await entry.execute('lectureNavigate', {index:Number(pageSelect.value)});
    if (!changed) pageSelect.value = String(entry.ctx.state.lecture.index);
  };
  const listeners = new AbortController();
  const options = {signal:listeners.signal};
  entry.shell.addEventListener('click', event => handlePlayerClick(root, entry, event), options);
  entry.shell.addEventListener('load', event => {
    if (event.target.tagName === 'IMG' && event.target.closest('[data-native-slide]')) fitContent(entry);
  }, {...options, capture:true});
  entry.shell.addEventListener('change', event => {
    if (event.target.matches('[data-inline-branch]')) entry.branchSelection = event.target.value;
  }, options);
  entry.widget.addEventListener('moduleparamschange', event => {
    if (entry.widgetDraft) entry.widgetDraft.params = event.detail;
  }, options);
  if (student) {
    const studentKey = state.code + '.' + ctx.participantId;
    entry.bookmarkKey = 'polyphony.bookmarks.' + studentKey;
    entry.muddyKey = 'polyphony.muddy.' + studentKey;
    entry.bookmarks = readPageMarks('localStorage', entry.bookmarkKey);
    entry.muddy = readPageMarks('sessionStorage', entry.muddyKey);
    entry.reviewKey = 'polyphony.mylog.' + state.code;
    entry.reviewParticipant = ctx.participantId;
    const sameStudent = previous?.reviewKey === entry.reviewKey && previous?.reviewParticipant === ctx.participantId;
    entry.personalReview = sameStudent ? previous.personalReview : {records:[],titles:{}};
    entry.reviewUnsaved = sameStudent && previous.reviewUnsaved;
    updatePersonalReview(entry, () => null);
  }
  entry.dispose = () => {
    listeners.abort();
    entry.triageController?.abort();
    entry.triageController = null;
    entry.observer?.disconnect();
    entry.moduleDispose?.();
    clearInterval(entry.timerInterval);
  };
  return entry;
}

function paintSlideTools(entry) {
  const tools = entry.shell.querySelector('[data-slide-tools]');
  if (!tools) return;
  const {mode, pageNumber} = entry.ctx.state.lecture;
  tools.hidden = mode !== 'slides';
  tools.querySelector('[data-inline-action=bookmark]').setAttribute('aria-pressed', String(entry.bookmarks.has(pageNumber)));
  tools.querySelector('[data-inline-action=slidePulse]').setAttribute('aria-pressed', String(entry.muddy.has(pageNumber)));
}

async function toggleMuddy(entry, page) {
  if (entry.busy) return;
  const active = !entry.muddy.has(page);
  setMark(entry.muddy, page, active);
  paintSlideTools(entry);
  const next = await entry.execute('slidePulse', {active});
  if (!next) {
    setMark(entry.muddy, page, !active);
    paintSlideTools(entry);
    return;
  }
  savePageMarks('sessionStorage', entry.muddyKey, entry.muddy);
  rememberMarkedTitle(entry, page);
}

function handlePlayerClick(root, entry, event) {
  const target = event.target.closest('[data-inline-action], [data-inline-excerpt]');
  if (!target || target.closest('[data-native-player]') !== entry.shell || players.get(root) !== entry) return;
  const {ctx, execute} = entry, {state} = ctx, lecture = state.lecture;
  if (target.hasAttribute('data-inline-excerpt')) {
    entry.excerptOption = target.dataset.inlineExcerpt;
    const excerpts = target.closest('.inline-excerpts');
    for (const button of excerpts.querySelectorAll('[data-inline-excerpt]')) button.setAttribute('aria-pressed', String(button === target));
    for (const panel of excerpts.querySelectorAll('[data-excerpt-option]')) panel.hidden = panel.dataset.excerptOption !== entry.excerptOption;
    return fitContent(entry);
  }
  switch (target.dataset.inlineAction) {
    case 'split': return ctx.toggleSplit?.();
    case 'stage': return ctx.open('stage');
    case 'invite': return ctx.invite();
    case 'remote': return ctx.remotePair?.();
    case 'review': return ctx.go('replay');
    case 'fullscreen': return fullscreen(root, ctx);
    case 'jump': return execute('lectureNavigate', {index:Number(target.dataset.pageIndex)});
    case 'previous': return execute('lectureNavigate', {index:lecture.index-1});
    case 'next': return execute('lectureNavigate', {index:lecture.index+1});
    case 'finish': return execute('lectureFinish');
    case 'interact': return execute('lectureInteract');
    case 'reveal': return entry.perform(async send => {
      const published = await send('reveal');
      if (published.round === 2 || roundCount(published) > 0) await send('analyze', {fastLocal:true});
    });
    case 'secondRound': {
      const branchId = entry.shell.querySelector('[data-inline-branch]').value;
      return entry.perform(async send => {
        await send('branch', {branchId});
        return send('revise');
      });
    }
    case 'retry':
      entry.frameError = false;
      return loadFrame(root, entry);
    case 'timer60': return execute('setTimer', {durationSec:60});
    case 'timer90': return execute('setTimer', {durationSec:90});
    case 'timerClear': return execute('setTimer', {durationSec:0});
    case 'bookmark':
      setMark(entry.bookmarks, lecture.pageNumber, !entry.bookmarks.has(lecture.pageNumber));
      savePageMarks('localStorage', entry.bookmarkKey, entry.bookmarks);
      rememberMarkedTitle(entry, lecture.pageNumber);
      return paintSlideTools(entry);
    case 'slidePulse': return toggleMuddy(entry, lecture.pageNumber);
    case 'downloadReview': return downloadPersonalReview(entry);
    case 'quickTriage': return requestQuickTriage(entry);
    case 'analyze': return execute('analyze').then(result => {
      if (!result?.teacherCue || players.get(root) !== entry || entry.ctx.state.lecture.turn !== lecture.turn ||
          entry.ctx.state.round !== state.round) return;
      entry.teacherCue = { text: result.teacherCue, round: result.round };
      paintPrivateTeachingTools(entry);
      const details = entry.shell.querySelector('.native-speaker-notes');
      if (details) details.open = true;
    });
    case 'demoFill':
    case 'resetActivity':
    case 'draw':
    case 'close': return execute(target.dataset.inlineAction);
  }
}

function paintFilmstrip(entry) {
  const strip = entry.shell.querySelector('[data-filmstrip]');
  if (!strip) return;
  const {state, esc:e} = entry.ctx;
  const completed = new Set(lectureTakeaways(state).map(card => card.pageNumber));
  const items = state.lecture.filmstrip ?? [];
  const html = items.map(({pageNumber, activityId, muddyCount, title}, index) => {
    const label = names[activityId] ?? '讲授';
    const done = completed.has(pageNumber);
    const warning = muddyCount ? `<em aria-label="${muddyCount} 人存疑">?${muddyCount}</em>` : '';
    const status = done ? '<i aria-label="已完成">✓</i>' : '';
    const current = index === state.lecture.index ? ' aria-current="page"' : '';
    const detail = `<b>${pageNumber}</b><small>${label}</small>${status || warning ? '<span>'+status+warning+'</span>' : ''}`;
    if (entry.role === 'stage') return `<span${current}>${detail}</span>`;
    return btn('jump', detail, `data-page-index="${index}" title="${e(title ?? label)}"${current}`);
  }).join('');
  if (entry.filmstripHtml === html) return;
  entry.filmstripHtml = html;
  const focused = strip.contains(document.activeElement) ? document.activeElement.dataset.pageIndex : null;
  const scroll = strip.scrollLeft;
  strip.innerHTML = html;
  strip.scrollLeft = scroll;
  const current = strip.querySelector('[aria-current=page]');
  const bounds = strip.getBoundingClientRect(), chip = current?.getBoundingClientRect();
  if (chip && (chip.left < bounds.left || chip.right > bounds.right)) strip.scrollLeft += chip.left - bounds.left;
  if (focused != null) strip.querySelector(`[data-page-index="${focused}"]`)?.focus({preventScroll:true});
}

function paintCountdown(entry) {
  const clock = entry.shell.querySelector('[data-countdown]');
  const endsAt = entry.ctx.state.timer?.endsAt ?? null;
  if (entry.timerEnd === endsAt) return;
  entry.timerEnd = endsAt;
  clearInterval(entry.timerInterval);
  clock.hidden = endsAt == null;
  if (clock.hidden) return;
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    clock.classList.toggle('is-expired', seconds === 0);
    clock.textContent = seconds ? `⏱ ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}` : '⏱ 时间到';
    if (!seconds) clearInterval(entry.timerInterval);
  };
  tick();
  if (endsAt > Date.now()) entry.timerInterval = setInterval(tick, 1000);
}

function fitContent(entry) {
  if (entry.role === 'student' || entry.ctx.remote) return;
  const slide = entry.shell.querySelector('[data-native-slide]');
  const frame = slide?.firstElementChild;
  if (!frame) return;
  const {state} = entry.ctx, inline = entry.widget;
  const original = frame.querySelector('.slide-code');
  const moved = frame.querySelector('[data-inline-step-artifact]');
  const onCode = original && state.lesson.activityId === 'step-fault@1' && state.lecture.mode === 'activity';
  if (onCode) {
    const artifact = inline.querySelector('.module-artifact');
    if (artifact) {
      moved?.remove();
      original.hidden = true;
      artifact.dataset.inlineStepArtifact = '';
      original.after(artifact);
    }
  } else if (moved && original) {
    moved.remove();
    original.hidden = false;
  }
  const minZoom = 0.85;
  fitLectureSlide(slide, minZoom);
  if (!inline.hidden) {
    const style = getComputedStyle(inline);
    fitPresentationContent(inline.querySelector('.inline-content'), inline.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 4, minZoom);
  }
}

function loadFrame(root, entry) {
  if (entry.framePending || entry.frameLoaded || entry.frameError) return;
  entry.framePending = true;
  const slot = entry.shell.querySelector('[data-native-slide]');
  entry.ctx.getFrame(entry.ctx.state.lecture.index).then(frame => {
    if (players.get(root) !== entry || !root.isConnected) return;
    entry.frameLoaded = true;
    if (entry.role === 'student') {
      entry.pageTitle = frame.title;
      rememberMarkedTitle(entry, frame.pageNumber);
    }
    renderLectureFrame(slot, frame, {compact:entry.role === 'student'});
    fitContent(entry);
    if (entry.role !== 'student') void document.fonts?.ready.then(() => {
      if (players.get(root) === entry) fitContent(entry);
    });
  }).catch(error => {
    if (players.get(root) !== entry) return;
    entry.frameError = true;
    slot.innerHTML = '<p role="alert">' + entry.ctx.esc(error.message) + '</p>' + btn('retry','重新载入');
  }).finally(() => { entry.framePending = false; });
}

function renderPlayer(root, ctx, role) {
  const {state, remote, esc:e} = ctx, lecture = state.lecture;
  const teacher = role === 'teacher', student = role === 'student';
  const key = [state.code, remote ? 'remote' : role, student && ctx.participantId, lecture.index, lecture.mode === 'ended'].join('-');
  let entry = players.get(root);
  if (!entry || entry.key !== key || !entry.shell.isConnected) {
    const notesOpen = entry?.shell.querySelector('.native-speaker-notes')?.open;
    entry?.dispose();
    entry = buildPlayer(root, ctx, role, key, notesOpen, entry);
  }
  const dispose = () => {
    if (players.get(root) !== entry) return;
    players.delete(root);
    entry.dispose();
  };
  entry.ctx = ctx;
  const shell = entry.shell;
  if (lecture.mode === 'ended') {
    shell.innerHTML = `<section class="lecture-ended"><h1>本节课已结束</h1><p>${renderRichMathHtml(lecture.title)}</p>
      ${teacher && !remote ? btn('review','查看复盘','class="action-primary"') : student ? reviewDownload() + takeawayDrawerHtml(state,e) : ''}</section>`;
    return dispose;
  }

  const active = lecture.mode === 'activity';
  const experiment = lecture.mode === 'experiment' && state.experiment;
  if (entry.turn !== lecture.turn) {
    entry.branchSelection = null;
    entry.triageController?.abort();
    entry.triageController = entry.triageHints = entry.triageMessage = entry.teacherCue = null;
    entry.turn = lecture.turn;
  }
  shell.dataset.inlineActivity = active ? state.lesson.activityId : '';
  shell.dataset.lectureMode = lecture.mode;
  shell.dataset.phase = state.phase;
  if (!remote) loadFrame(root, entry);
  if (teacher) {
    shell.querySelector('[data-inline-action=split]')?.setAttribute('aria-pressed', String(ctx.split));
    paintPrivateTeachingTools(entry);
    const winner = shell.querySelector('[data-draw-result]');
    winner.hidden = !state.winner;
    const draw = state.winner ? `🎲 抽中 ${state.winner.name}${state.winner.simulated ? '（模拟）' : ''}` : '';
    if (winner.textContent !== draw) winner.textContent = draw;
  }
  if (remote) {
    shell.querySelector('[data-remote-status]').textContent = ctx.connected ? '已连接' : '正在连接…';
    shell.querySelector('[data-remote-responses]').textContent = active ? roundCount(state) : '0';
    shell.querySelector('[data-remote-muddy]').textContent = lecture.muddyCount ?? 0;
  }

  shell.querySelector('.native-layout').classList.toggle('has-inline-interaction', active || Boolean(experiment));
  const widget = entry.widget;
  widget.hidden = !(active || experiment);
  if (active && !remote) {
    if (student) rememberStudentAnswers(entry, state);
    paintInteraction(widget, entry, role);
  }
  else {
    if (entry.widgetMode && (!experiment || entry.widgetMode === 'activity')) {
      entry.moduleDispose?.();
      entry.moduleDispose = entry.widgetSignature = entry.moduleKey = entry.widgetMode = null;
      widget.replaceChildren();
    }
    if (experiment) {
      entry.widgetMode = 'experiment';
      renderChallenge(widget, experiment, {
        role, turn:lecture.turn, action:p=>entry.execute('lectureExperimentAct',p),
        vote:choice=>entry.execute('experimentVote',{choice}), askPeer:ctx.askPeer, report:ctx.toast,
      });
    }
  }

  const controls = shell.querySelector('[data-presenter-controls]');
  if (controls) {
    const html = presenterControls(entry, active);
    if (html !== entry.controlsHtml) {
      entry.controlsHtml = html;
      controls.innerHTML = html;
    }
    const utility = shell.querySelector('[data-presenter-tools]');
    const tools = presenterTools(state, active, remote);
    if (tools !== entry.toolsHtml) {
      entry.toolsHtml = tools;
      utility.innerHTML = tools;
    }
  }
  const drawer = shell.querySelector('[data-takeaway-drawer]');
  if (drawer) {
    const cards = takeawayDrawerHtml(state,e,true);
    if (cards !== entry.drawerHtml) {
      entry.drawerHtml = cards;
      const open = drawer.querySelector('details')?.open;
      drawer.innerHTML = cards;
      if (open && drawer.querySelector('details')) drawer.querySelector('details').open = true;
    }
  }
  paintSlideTools(entry);
  paintFilmstrip(entry);
  paintCountdown(entry);

  if (!remote && !student) {
    // Background projector tabs can throttle animation frames, so fit here as well.
    fitContent(entry);
    requestAnimationFrame(() => { if (players.get(root) === entry) fitContent(entry); });
    if (!entry.observer && typeof ResizeObserver !== 'undefined') {
      entry.observer = new ResizeObserver(() => fitContent(entry));
      entry.observer.observe(shell.querySelector('[data-native-slide]'));
    }
  }
  return dispose;
}

function paintInteraction(host, entry, role) {
  const {state, esc:e, participantId, toast} = entry.ctx, lesson = state.lesson, student = role === 'student';
  const participant = state.participants.find(p => p.id === participantId);
  const mine = state.responses.find(r => r.participantId === participantId && r.round === state.round);
  const moduleKey = lesson.id + '-' + state.lecture.turn;
  const key = moduleKey + '-' + state.round;
  const signature = JSON.stringify([key,state.phase,state.responses,state.responseCount,state.analysis,state.aiPeerRevealed,Boolean(participant),state.decision]);
  if (entry.widgetSignature === signature) return;
  entry.widgetSignature = signature;
  entry.widgetMode = 'activity';
  if (entry.moduleKey !== moduleKey) {
    entry.moduleDispose?.();
    entry.moduleDispose = null;
    entry.excerptOption = null;
    entry.drafts.clear();
    entry.moduleKey = moduleKey;
    host.innerHTML = `<div class="inline-content">
      <header class="inline-heading"><span>${e(names[lesson.activityId] ?? '课堂互动')}</span><b></b></header>
      <p class="inline-prompt"></p><div data-inline-module></div><div data-inline-body></div>
    </div>`;
  }
  const moduleHost = host.querySelector('[data-inline-module]');
  const retained = lesson.activityId === 'param-explorer@1' && moduleHost.firstElementChild;
  let draft = entry.drafts.get(key);
  if (!draft) {
    draft = {optionId:mine?.optionId ?? '', reason:mine?.reason ?? '', name:'', params:retained ? entry.widgetDraft?.params : null};
    entry.drafts.set(key, draft);
  }
  entry.widgetDraft = draft;
  const focused = host.contains(document.activeElement) ? document.activeElement : null;
  const focusName = focused?.getAttribute('name');
  const selection = focused?.selectionStart;
  const collecting = state.phase === 'collect';
  const reasons = lesson.quickReasons ?? lesson.moduleConfig?.quickReasons ?? [];
  const reasonOpen = host.querySelector('[data-extra-reason]')?.open || focusName === 'reason';
  const stepFault = lesson.activityId === 'step-fault@1';
  const visibleResults = role === 'teacher' && !collecting ? projectRoom(state,'stage') : state;
  host.querySelector('.inline-heading b').textContent = `${phaseNames[state.phase]} · R${state.round}`;
  host.querySelector('.inline-prompt').innerHTML = renderRichMathHtml(state.revisionPrompt ?? lesson.prompt);
  if (!retained) {
    entry.moduleDispose?.();
    moduleHost.innerHTML = moduleHtml(lesson,state,{teacher:role === 'teacher', selectable:student && collecting && Boolean(participant),selectedId:draft.optionId});
    entry.moduleDispose = bindModule(moduleHost, lesson, {command:entry.execute});
  }
  host.querySelector('[data-inline-body]').innerHTML = `
    ${!student && collecting && !stepFault ? '<div class="inline-choice-list">'+lesson.options.map(o => '<div><b>'+e(o.id)+'</b> '+renderRichMathHtml(o.label)+'</div>').join('')+'</div>' : ''}
    ${student && collecting ? participant ? `<form data-inline-response><div class="inline-options">${stepFault ? '' : lesson.options.map(o =>
      `<label><input type="radio" name="optionId" value="${e(o.id)}" ${draft.optionId === o.id ? 'checked' : ''} required><span>${renderRichMathHtml(o.label)}</span></label>`).join('')}</div>
      ${reasons.length ? `<div class="inline-capsules" aria-label="选择理由">${reasons.map((reason,i) => `<button type="button" data-reason="${i}" aria-pressed="${draft.reason === reason}">${renderRichMathHtml(reason)}</button>`).join('')}</div>` : ''}
      <details data-extra-reason ${reasonOpen || !reasons.length ? 'open' : ''}><summary>补充理由</summary><label class="inline-reason"><span class="visually-hidden">你的理由</span><textarea name="reason" rows="2" maxlength="1000">${e(draft.reason)}</textarea></label></details>
      <button class="inline-submit">${mine ? '更新答案' : '提交'}</button>${mine ? '<p class="inline-submitted">已提交，公布前可修改。</p>' : ''}</form>`
      : `<form data-inline-join><label>课堂显示名<input name="name" value="${e(draft.name)}" required maxlength="48" autocomplete="nickname"></label><button class="inline-submit">加入并作答</button></form>` : ''}
    ${student && collecting ? '' : inlineResultsHtml(visibleResults,e,entry.excerptOption)}
    ${student && !collecting && mine ? '<p class="inline-my-answer">我的答案 · '+e(mine.optionId)+' · '+renderRichMathHtml(mine.reason)+'</p>' : ''}
    ${state.decision ? '<p class="inline-branch">讨论方向 · '+renderRichMathHtml(state.decision.title)+'</p>' : ''}`;

  host.querySelectorAll('[data-step-select]').forEach(button => button.onclick = () => {
    draft.optionId = button.dataset.stepSelect;
    host.querySelectorAll('[data-step-select]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  });
  host.querySelectorAll('[name=optionId]').forEach(input => input.onchange = () => { draft.optionId = input.value; });
  host.querySelector('[name=reason]')?.addEventListener('input', event => { draft.reason = event.target.value; });
  host.querySelector('[name=name]')?.addEventListener('input', event => { draft.name = event.target.value; });
  host.querySelectorAll('[data-reason]').forEach(button => button.onclick = () => {
    draft.reason = reasons[Number(button.dataset.reason)];
    host.querySelector('[name=reason]').value = draft.reason;
    host.querySelectorAll('[data-reason]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  });
  host.querySelector('[data-inline-response]')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!draft.optionId) return toast('请先选择一个选项或代码行。');
    const payload = {participantId, optionId:draft.optionId, reason:draft.reason};
    if (draft.params) payload.reason = (payload.reason+'\n沙盒参数：'+Object.entries(draft.params).map(([k,v])=>k+'='+v).join(', ')).slice(0,1000);
    const submitted = await entry.execute('respond',payload);
    if (submitted) rememberStudentAnswers(entry, submitted);
  });
  host.querySelector('[data-inline-join]')?.addEventListener('submit', event => {
    event.preventDefault();
    void entry.execute('join',{participantId,name:draft.name});
  });
  if (focusName) {
    const input = host.querySelector(`[name="${focusName}"]`);
    input?.focus({preventScroll:true});
    if (selection != null && input?.setSelectionRange && input.type !== 'radio') input.setSelectionRange(selection,selection);
  }
}

export function lectureKeyboard(event, ctx, root) {
  const lecture = ctx.state.lecture, target = event.target;
  if (!lecture || lecture.mode === 'ended' || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
      document.querySelector('dialog[open]') || target?.closest?.('input,textarea,select,[contenteditable],.module-curve')) return;
  const main = root?.querySelector('[data-native-main]') ?? root;
  const key = event.key;
  const toggleSplit = key.toLowerCase() === 's';
  if (!toggleSplit && target?.closest?.('.native-split-companion')) return;
  if (key === 'Enter' || toggleSplit) {
    if (key === 'Enter' && target?.matches?.('button:focus-visible,a:focus-visible,summary:focus-visible')) return;
    const button = main?.querySelector(key === 'Enter' ? '.presenter-primary' : '[data-inline-action=split]');
    if (!button) return;
    event.preventDefault();
    if (!event.repeat) button.click();
    return;
  }
  if (key === ' ' && target?.closest?.('button,a,summary')) return;
  const scrollable = target?.closest?.('[data-native-slide]');
  if (scrollable?.scrollHeight > scrollable?.clientHeight && [' ', 'PageUp', 'PageDown'].includes(key)) return;
  const offsets = {ArrowRight:1,PageDown:1,' ':1,ArrowLeft:-1,PageUp:-1};
  if (!Object.hasOwn(offsets,key)) return;
  event.preventDefault();
  if (event.repeat) return;
  const index = lecture.index + offsets[key];
  if (index < 0 || index >= lecture.total) return;
  const button = main?.querySelector(`[data-inline-action=${offsets[key] > 0 ? 'next' : 'previous'}]`);
  if (button) button.click();
  else ctx.command('lectureNavigate',{index}).catch(error => ctx.toast(error.message));
}
