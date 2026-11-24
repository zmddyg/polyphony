import { getActivity } from '../core/activities.mjs';
import { assignedPhase, phaseLabel } from '../core/optics.mjs';

const mounted = new WeakMap();
const NAME_STORAGE_KEY = 'polyphony.student.name';
const lessonStarts = new Set(['room', 'switchLesson', 'loadLesson', 'lectureInteract']);
const phases = {
  collect: { label: '作答进行中', icon: 'workshop' },
  reveal: { label: '结果已公布', icon: 'chart' },
  branch: { label: '课堂讨论中', icon: 'users' },
  closed: { label: '课堂已结束', icon: 'check' },
};

function readSavedName() {
  try { return localStorage.getItem(NAME_STORAGE_KEY) || ''; } catch { return ''; }
}
function saveStudentName(name) {
  try { if (name) localStorage.setItem(NAME_STORAGE_KEY, name); } catch { /* ignore */ }
}

function captureStudentFocus(root) {
  const active = document.activeElement;
  if (!root.contains(active) || !active.id) return () => {};
  const { id, selectionStart, selectionEnd, selectionDirection } = active;
  return () => {
    const field = document.getElementById(id);
    if (!field || !root.contains(field)) return;
    field.focus({ preventScroll: true });
    if (selectionStart != null) field.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  };
}

function responseDraft(participant, response) {
  return {
    name: participant?.name || readSavedName() || '',
    optionId: response?.optionId || '',
    reason: response?.reason || '',
    power: Math.round((response?.sample?.power ?? .5) * 100),
    pending: false, edited: 0, dirty: false, error: '',
  };
}

function promptFor(state) {
  const chosen = state.lesson.branches.find(branch => branch.id === state.decision?.branchId);
  const followup = Number(state.round) > 1 && chosen?.description;
  return state.revisionPrompt || (followup ? `${followup} ${state.lesson.prompt}` : state.lesson.prompt) || state.lesson.description;
}

function responseText(response, option, esc) {
  const sample = response.sample;
  return `<strong>${esc(option?.label ?? response.optionId)}</strong>${sample ? `<span>相位差 ${esc(phaseLabel(sample.phaseIndex))} · 预测光强 ${Math.round(sample.power * 100)}%</span>` : ''}`;
}

function responseReceipt(response, option, ctx, collecting) {
  if (!response) return '';
  return `<div class="ps-receipt"><span class="ps-icon ps-icon--success">${ctx.icon('check', 19)}</span><div>
    <b>本轮回答已提交</b>${responseText(response, option, ctx.esc)}
    ${!collecting && response.reason ? `<p>${ctx.esc(response.reason)}</p>` : ''}</div></div>`;
}

function previousAnswer(response, option, ctx, open) {
  if (!response) return '';
  return `<details class="ps-side-card ps-previous"${open ? ' open' : ''}>
    <summary id="student-previous">${ctx.icon('replay', 18)}<strong>第 ${ctx.esc(response.round)} 轮的回答</strong>${ctx.icon('chevron-down', 16)}</summary>
    <div>${responseText(response, option, ctx.esc)}${response.reason ? `<p>${ctx.esc(response.reason)}</p>` : ''}</div>
  </details>`;
}

function progressCard(state, participant, model, ctx) {
  const { esc, icon } = ctx;
  const collecting = state.phase === 'collect';
  const closed = state.phase === 'closed';
  const progress = [
    { title: '课堂作答', complete: !collecting, current: collecting },
    { title: '查看全班结果', complete: state.phase === 'branch' || closed, current: state.phase === 'reveal' },
    ...(Number(state.round) === 1 && (!closed || state.decision)
      ? [{ title: '跟随课堂讨论', complete: closed && Boolean(state.decision), current: state.phase === 'branch' }] : []),
  ];
  const profileBody = !participant ? '' : model.renaming
    ? `<form class="ps-rename-form" data-rename-form>
        <label class="visually-hidden" for="student-rename-input">新的课堂显示名</label>
        <input id="student-rename-input" name="name" maxlength="32" required value="${esc(model.renameValue ?? participant.name)}" placeholder="输入新名字">
        <div class="ps-rename-actions">
          <button type="submit" class="ps-mini-primary"${model.renamePending ? ' disabled' : ''}>${model.renamePending ? '保存中…' : '保存'}</button>
          <button type="button" class="ps-mini-plain" data-rename-cancel>取消</button>
        </div>
        ${model.renameError ? `<p class="ps-error" role="alert">${esc(model.renameError)}</p>` : ''}
      </form>`
    : `<div class="ps-profile">
        <span class="ps-icon">${icon('user', 17)}</span>
        <div><strong>${esc(participant.name)}</strong><span>已加入课堂</span></div>
        ${!closed ? '<button type="button" class="ps-rename-trigger" data-rename-open>改名</button>' : ''}
      </div>`;
  return `<aside class="ps-side-card" aria-label="课堂进度">
    <div class="ps-side-title">${icon('list', 18)}<h2>第 ${esc(state.round ?? 1)} 轮进度</h2></div>
    <ol class="ps-progress">${progress.map(({ title, complete, current }) => `<li class="${complete ? 'is-complete' : current ? 'is-current' : ''}"${current ? ' aria-current="step"' : ''}><span aria-hidden="true">${complete ? icon('check', 13) : ''}</span>${title}</li>`).join('')}</ol>
    ${profileBody}
  </aside>`;
}

function results(state, current, response, ctx) {
  const { esc, icon } = ctx;
  const { options } = state.lesson;
  const count = state.responseCount ?? current.length;
  const simulated = state.simulatedResponseCount ?? current.filter(item => item.simulated).length;
  const chosenBranch = state.decision && state.lesson.branches.find(branch => branch.id === state.decision.branchId);
  const bars = count ? options.map((option, index) => {
    const votes = current.filter(item => item.optionId === option.id).length;
    const percent = Math.round(votes * 100 / count);
    const isMine = response?.optionId === option.id;
    return `<li class="ps-result${isMine ? ' is-mine' : ''}"><div class="ps-result-name"><span class="ps-letter">${String.fromCharCode(65 + index)}</span><strong>${esc(option.label)}${isMine ? '<small>我的选择</small>' : ''}</strong><span class="ps-result-count"><b>${percent}%</b><span>${votes} 票</span></span></div><div class="ps-result-track" aria-hidden="true"><span style="width:${percent}%"></span></div></li>`;
  }) : [];
  const spotlight = Array.isArray(state.spotlight) && state.spotlight.length
    ? `<div class="ps-spotlight"><h3>课堂匿名观点对比</h3>${state.spotlight.slice(0, 2).map(item =>
      `<blockquote><span>${esc(item.optionLabel || '')}</span><p>${esc(item.text)}</p></blockquote>`).join('')}</div>`
    : '';
  return `<section class="ps-card ps-results" aria-labelledby="student-results-title">
    <div class="ps-card-heading"><span class="ps-icon">${icon('chart', 18)}</span><div><h2 id="student-results-title">全班作答</h2><p>${count} 份作答${simulated ? ` · 含 ${simulated} 份模拟` : ''}</p></div></div>
    ${count ? `<ul class="ps-result-list">${bars.join('')}</ul>` : '<p class="ps-empty">本轮没有收到作答。</p>'}
    ${state.decision?.title ? `<div class="ps-branch">${icon('network', 18)}<div><span>课堂讨论方向</span><strong>${esc(state.decision.title)}</strong>${chosenBranch?.description ? `<p>${esc(chosenBranch.description)}</p>` : ''}</div></div>` : ''}
    ${spotlight}
  </section>`;
}

function submitButton(label, draft, ctx) {
  return `<button class="ps-submit" id="student-submit" type="submit" data-submit-label="${label}"${draft.pending ? ' disabled' : ''}><span>${draft.pending ? '正在提交…' : label}</span>${ctx.icon('arrow-right', 18)}</button>`;
}

function joinForm(draft, ctx) {
  return `<form class="ps-form" data-student-form aria-labelledby="student-form-title">
    <div class="ps-card-heading"><span class="ps-icon">${ctx.icon('user', 19)}</span><div><h2 id="student-form-title">加入课堂</h2><p id="student-name-note">老师将通过这个名字识别你的作答。</p></div></div>
    <div class="ps-input-group"><label for="student-name">课堂显示名</label><input id="student-name" name="name" autocomplete="nickname" required maxlength="32" placeholder="输入你的名字" aria-describedby="student-name-note" value="${ctx.esc(draft.name)}"></div>
    <p class="ps-error" data-form-message role="alert"${draft.error ? '' : ' hidden'}>${ctx.esc(draft.error)}</p>
    ${submitButton('加入课堂', draft, ctx)}
  </form>`;
}

function miniMziGraphic(powerPercent) {
  const a = Math.max(0, Math.min(100, Number(powerPercent) || 0));
  const b = 100 - a;
  return `<div class="ps-mzi-mini" aria-hidden="true">
    <svg viewBox="0 0 280 86" role="presentation">
      <path d="M12 43H56L92 18H164L200 43M56 43L92 68H164L200 43" fill="none" stroke="#9db2df" stroke-width="2.2" stroke-linecap="round"/>
      <path data-mzi-beam="a" d="M200 43L236 22H266" fill="none" stroke="#315be8" stroke-width="3.2" stroke-linecap="round" style="opacity:${(0.18 + 0.82 * a / 100).toFixed(2)}"/>
      <path data-mzi-beam="b" d="M200 43L236 64H266" fill="none" stroke="#0f766e" stroke-width="3.2" stroke-linecap="round" style="opacity:${(0.18 + 0.82 * b / 100).toFixed(2)}"/>
      <rect x="50" y="37" width="12" height="12" rx="2" fill="#e8efff" stroke="#4468cf" transform="rotate(45 56 43)"/>
      <rect x="194" y="37" width="12" height="12" rx="2" fill="#e8efff" stroke="#4468cf" transform="rotate(45 200 43)"/>
      <text x="128" y="13" text-anchor="middle" font-size="10" fill="#51627f">上臂</text>
      <text x="128" y="81" text-anchor="middle" font-size="10" fill="#51627f">下臂 (Δφ)</text>
      <text x="268" y="16" text-anchor="end" font-size="10.5" font-weight="700" fill="#2346ba">A 端 <tspan data-mzi-a>${a}%</tspan></text>
      <text x="268" y="80" text-anchor="end" font-size="10.5" font-weight="700" fill="#0f766e">B 端 <tspan data-mzi-b>${b}%</tspan></text>
    </svg>
  </div>`;
}

function answerForm(state, draft, response, phaseIndex, ctx) {
  const { esc } = ctx;
  const options = state.lesson.options.map((option, index) => `
    <label class="ps-option">
      <input type="radio" id="student-option-${index}" name="optionId" value="${esc(option.id)}" required${option.id === draft.optionId ? ' checked' : ''}>
      <span class="ps-letter" aria-hidden="true">${String.fromCharCode(65 + index)}</span><span>${esc(option.label)}</span><span class="ps-radio" aria-hidden="true"></span>
    </label>`);
  return `<form class="ps-form" data-student-form aria-labelledby="student-form-title">
    <fieldset><legend id="student-form-title">选择一个答案</legend><div class="ps-options">${options.join('')}</div></fieldset>
    ${phaseIndex === null ? '' : `<div class="ps-sample">
      ${miniMziGraphic(draft.power)}
      <div><label for="student-power">预测 A 端归一化光强</label><output for="student-power" data-power>${Number(draft.power)}%</output></div><span>分配给你的相位差为 ${esc(phaseLabel(phaseIndex))}。</span>
      <input id="student-power" name="power" type="range" min="0" max="100" step="1" value="${Number(draft.power)}" aria-valuetext="${Number(draft.power)}%"><p aria-hidden="true"><span>0%</span><span>100%</span></p></div>`}
    <div class="ps-input-group"><div><label for="student-reason">作答理由 <span>选填</span></label><span aria-hidden="true" data-reason-count>${draft.reason.length}/280</span></div>
      <textarea id="student-reason" name="reason" rows="3" maxlength="280" placeholder="哪条线索影响了你的选择？">${esc(draft.reason)}</textarea></div>
    <p class="ps-error" data-form-message role="alert"${draft.error ? '' : ' hidden'}>${esc(draft.error)}</p>
    <div class="ps-submit-row">${submitButton(response ? '更新回答' : '提交回答', draft, ctx)}<p data-form-note>${response && draft.dirty ? '你有尚未提交的修改。' : '老师结束收集前，你可以修改回答。'}</p></div>
  </form>`;
}

function updateFormStatus(form, draft, response) {
  const button = form.querySelector('[type=submit]');
  button.disabled = draft.pending;
  button.firstElementChild.textContent = draft.pending ? '正在提交…' : button.dataset.submitLabel;
  const message = form.querySelector('[data-form-message]');
  message.hidden = !draft.error;
  message.textContent = draft.error;
  const note = form.querySelector('[data-form-note]');
  if (note) note.textContent = response && draft.dirty ? '你有尚未提交的修改。' : '老师结束收集前，你可以修改回答。';
}

function wireRename(root, model, ctx, participant) {
  root.querySelector('[data-rename-open]')?.addEventListener('click', () => {
    model.renaming = true;
    model.renameValue = participant?.name || '';
    model.renameError = '';
    model.signature = '';
    renderStudent(root, ctx);
    root.querySelector('#student-rename-input')?.focus({ preventScroll: true });
  });
  root.querySelector('[data-rename-cancel]')?.addEventListener('click', () => {
    model.renaming = false;
    model.renameError = '';
    model.signature = '';
    renderStudent(root, ctx);
  });
  const renameForm = root.querySelector('[data-rename-form]');
  if (!renameForm) return;
  renameForm.addEventListener('input', ({ target }) => {
    if (target.name === 'name') {
      model.renameValue = target.value;
      model.renameError = '';
    }
  });
  renameForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (model.renamePending) return;
    const name = String(new FormData(renameForm).get('name') ?? '').trim();
    if (!name) {
      model.renameError = '请输入你的名字。';
      model.signature = '';
      renderStudent(root, ctx);
      return;
    }
    model.renamePending = true;
    model.renameError = '';
    model.signature = '';
    renderStudent(root, ctx);
    try {
      await ctx.command('join', { participantId: ctx.participantId, name });
      saveStudentName(name);
      model.renaming = false;
      ctx.toast('显示名已更新');
    } catch (error) {
      model.renameError = error?.message || '修改失败，请重试。';
    } finally {
      model.renamePending = false;
      model.signature = '';
      if (mounted.get(root) === model) renderStudent(root, ctx);
    }
  });
}

function wireForm(root, model, ctx, participant, response, phaseIndex) {
  const form = root.querySelector('[data-student-form]');
  if (!form) return;
  const { draft } = model;
  form.addEventListener('compositionstart', () => { model.composing = true; });
  form.addEventListener('compositionend', () => {
    model.composing = false;
    queueMicrotask(() => {
      const pending = model.waiting;
      model.waiting = null;
      if (pending && mounted.get(root) === model) renderStudent(root, pending);
    });
  });
  form.addEventListener('input', ({ target }) => {
    if (!['name', 'optionId', 'reason', 'power'].includes(target.name)) return;
    draft[target.name] = target.value;
    draft.dirty = true;
    draft.edited++;
    draft.error = '';
    if (target.name === 'power') {
      const a = Math.max(0, Math.min(100, Number(draft.power) || 0));
      const b = 100 - a;
      form.querySelector('[data-power]').value = `${a}%`;
      target.setAttribute('aria-valuetext', `${a}%`);
      const mziA = form.querySelector('[data-mzi-a]');
      const mziB = form.querySelector('[data-mzi-b]');
      const beamA = form.querySelector('[data-mzi-beam="a"]');
      const beamB = form.querySelector('[data-mzi-beam="b"]');
      if (mziA) mziA.textContent = `${a}%`;
      if (mziB) mziB.textContent = `${b}%`;
      if (beamA) beamA.style.opacity = (0.18 + 0.82 * a / 100).toFixed(2);
      if (beamB) beamB.style.opacity = (0.18 + 0.82 * b / 100).toFixed(2);
    }
    if (target.name === 'reason') form.querySelector('[data-reason-count]').textContent = `${draft.reason.length}/280`;
    updateFormStatus(form, draft, response);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (draft.pending) return;
    const values = new FormData(form);
    const edited = draft.edited;
    const returnFocus = form.contains(document.activeElement);
    draft.pending = true;
    draft.error = '';
    updateFormStatus(form, draft, response);
    try {
      if (participant) {
        const sample = phaseIndex === null ? {} : { sample: { phaseIndex, power: Number(values.get('power')) / 100 } };
        await ctx.command('respond', { participantId: ctx.participantId, optionId: values.get('optionId'), reason: String(values.get('reason') ?? '').trim(), ...sample });
      } else {
        const name = String(values.get('name') ?? '').trim();
        if (!name) throw new Error('请输入你的名字。');
        await ctx.command('join', { participantId: ctx.participantId, name });
        saveStudentName(name);
      }
      if (draft.edited === edited) draft.dirty = false;
    } catch (error) {
      const message = error?.message;
      draft.error = message && !/fetch|network|load failed/i.test(message)
        ? message : '暂时无法连接课堂，请稍后重试。';
    } finally {
      draft.pending = false;
      const currentForm = root.querySelector('[data-student-form]');
      if (mounted.get(root) !== model) return;
      if (currentForm && model.formKind === (participant ? 'answer' : 'join')) {
        updateFormStatus(currentForm, draft, model.response);
      }
      if (returnFocus && document.activeElement === document.body) {
        const target = participant || model.formKind === 'join' ? '#student-submit' : '#student-option-0';
        (root.querySelector(target) ?? root.querySelector('#student-lesson-title'))?.focus({ preventScroll: true });
      }
    }
  });
}

export function renderStudent(root, ctx) {
  const { state, participantId, esc, icon } = ctx;
  if (!state?.lesson) return;
  const round = Number(state.round) || 1;
  const { participants, responses, lesson } = state;
  const participant = participants.find(person => person.id === participantId);
  const response = responses.find(item => item.participantId === participantId && Number(item.round) === round);
  const previous = responses.reduce((latest, item) => item.participantId === participantId && Number(item.round) < round
    && (!latest || Number(item.round) > Number(latest.round)) ? item : latest, null);
  const lessonEvent = state.events?.findLast(event => lessonStarts.has(event.type))?.id;
  const key = JSON.stringify([state.code, lessonEvent, state.lessonId || lesson.id, participantId, round]);
  let model = mounted.get(root);
  if (model?.composing && model.key === key) {
    model.waiting = ctx;
    return;
  }
  if (model?.key !== key) {
    model = { key, draft: responseDraft(participant, response), renaming: false, renamePending: false, renameError: '' };
    mounted.set(root, model);
  }
  const { draft } = model;
  const collecting = state.phase === 'collect';
  const closed = state.phase === 'closed';
  const current = collecting ? null : responses.filter(item => Number(item.round) === round);
  const signature = JSON.stringify([
    state.phase, state.demo, participant, response, previous, state.decision, state.spotlight, state.timer,
    current, ctx.mode, ctx.connected, model.renaming, model.renamePending, model.renameError,
  ]);
  if (model.signature === signature && root.firstElementChild?.classList.contains('ps-student')) return;
  const focus = captureStudentFocus(root);
  const keepPreviousOpen = model.signature && Boolean(root.querySelector('.ps-previous')?.open);
  model.signature = signature;
  model.response = response;
  // A live update may bring an accepted submission while a newer draft is still being edited.
  if (!draft.dirty) Object.assign(draft, responseDraft(participant, response), { pending: draft.pending, error: draft.error });
  const phase = Object.hasOwn(phases, state.phase) ? phases[state.phase] : phases.collect;
  const phaseIndex = getActivity(lesson)?.input === 'phase-power' ? assignedPhase(participantId || '') : null;
  const optionFor = item => lesson.options.find(option => option.id === item?.optionId);
  const joined = Boolean(participant);
  const reconnecting = ctx.mode === 'server' && ctx.connected === false;
  model.formKind = !joined && !closed ? 'join' : joined && collecting ? 'answer' : '';
  root.innerHTML = `<div class="ps-student">
    <header class="ps-top"><div class="ps-top-inner"><div class="ps-brand"><img src="./assets/mark.svg" width="34" height="34" alt=""><strong>共演</strong><span>学生端</span></div><div class="ps-top-right">${state.timer?.endsAt ? `<span class="ps-timer" data-student-timer>${icon('clock', 14)}<b></b></span>` : ''}<div class="ps-room"><span>课堂码</span><strong>${esc(state.code)}</strong></div></div></div></header>
    <div class="ps-body">
      ${reconnecting ? `<p class="ps-network" role="status">${icon('radio', 17)}正在恢复实时课堂连接。</p>` : ''}
      <header class="ps-hero"><div class="ps-hero-meta"><span>${esc(lesson.subject || '课堂互动')}</span><span aria-hidden="true"></span><span>第 ${round} 轮</span>${state.demo ? '<span aria-hidden="true"></span><span>样本排练</span>' : ''}</div>
        <div class="ps-hero-title"><h1 id="student-lesson-title" tabindex="-1">${esc(lesson.title)}</h1><span class="ps-phase ps-phase--${esc(state.phase)}">${icon(phase.icon, 15)}${phase.label}</span></div></header>
      <div class="ps-columns"><div class="ps-main-column"><section class="ps-card ps-task" aria-labelledby="student-question-title">
        <div class="ps-question"><p>${icon('book', 17)}<span id="student-question-title">本轮问题</span></p><div>${esc(promptFor(state))}</div></div>
        ${responseReceipt(response, optionFor(response), ctx, collecting)}
        ${model.formKind === 'join' ? joinForm(draft, ctx) : ''}
        ${model.formKind === 'answer' ? answerForm(state, draft, response, phaseIndex, ctx) : ''}
        ${closed && !response ? `<p class="ps-closed">${icon('clock', 17)}你在本轮没有提交回答。</p>` : ''}
      </section>${current && (joined || closed) ? results(state, current, response, ctx) : ''}</div>
      <div class="ps-side-column">${progressCard(state, participant, model, ctx)}${previousAnswer(previous, optionFor(previous), ctx, keepPreviousOpen)}</div></div>
    </div>
  </div>`;
  wireForm(root, model, ctx, participant, response, phaseIndex);
  wireRename(root, model, ctx, participant);
  focus();

  let timerInterval = null;
  if (state.timer?.endsAt) {
    const paint = () => {
      const target = root.querySelector('[data-student-timer] b');
      if (!target) return;
      const rem = Math.max(0, Math.ceil((state.timer.endsAt - Date.now()) / 1000));
      target.textContent = rem > 0 ? `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}` : '时间到';
    };
    paint();
    timerInterval = setInterval(paint, 500);
  }
  return () => { if (timerInterval) clearInterval(timerInterval); };
}
