import { moduleHtml, bindModule } from './module-renderer.mjs';
import { getActivity } from '../core/activities.mjs';
import { assignedPhase, phaseLabel } from '../core/optics.mjs';
import { formulaHtml } from '../core/formula-text.mjs';

export function takeawayCard(state, participantId, esc) {
  if (state.phase !== 'closed') return '';
  const takeaway = state.lesson.takeaway ?? state.lesson.moduleConfig?.takeaway ?? { formula: '结论 = 模型假设 + 独立证据 + 适用边界', pitfall: '选对答案仍须说明机制；用独立测量核验解释。' };
  const own = (state.responses ?? []).filter(r => r.participantId === participantId);
  const label = round => {
    const answer = own.find(r => Number(r.round) === round);
    if (!answer) return '未提交';
    const index = state.lesson.options.findIndex(o => o.id === answer.optionId);
    return `${String.fromCharCode(65+index)} · ${answer.reason || state.lesson.options[index]?.label || answer.optionId}`;
  };
  return `<section class="ps-takeaway" aria-label="本页考前速查卡"><header><span>留给考前的你</span><h2>本页考前速查卡</h2></header><div class="ps-formula">${formulaHtml(takeaway.formula??takeaway.summary??'')}</div><h3>我的作答演进</h3><ol><li><span>第 1 轮</span><p>${esc(label(1))}</p></li><li><span>第 2 轮 →</span><p>${esc(label(2))}</p></li></ol><p class="ps-pitfall"><strong>工程 / 考试避坑</strong>${esc(takeaway.pitfall)}</p><footer>原页${state.lecture ? `第 ${esc(state.lecture.pageNumber)} 页 · ` : '要点 · '}可截屏带走</footer></section>`;
}

const mounted = new WeakMap();
const lessonStarts = new Set(['room', 'switchLesson', 'loadLesson','lectureInteract']);
const phases = {
  collect: { label: '作答进行中', icon: 'workshop' },
  reveal: { label: '结果已公布', icon: 'chart' },
  branch: { label: '课堂讨论中', icon: 'users' },
  closed: { label: '课堂已结束', icon: 'check' },
};

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
    name: participant?.name || '', optionId: response?.optionId || '', reason: response?.reason || '',
    power: Math.round((response?.sample?.power ?? .5) * 100), pending: false, edited: 0,
      dirty: false, error: '', quickReason: -1,
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

function progressCard(state, participant, ctx) {
  const { esc, icon } = ctx;
  const collecting = state.phase === 'collect';
  const closed = state.phase === 'closed';
  const progress = [
    { title: '课堂作答', complete: !collecting, current: collecting },
    { title: '查看全班结果', complete: state.phase === 'branch' || closed, current: state.phase === 'reveal' },
    ...(Number(state.round) === 1 && (!closed || state.decision)
      ? [{ title: '跟随课堂讨论', complete: closed && Boolean(state.decision), current: state.phase === 'branch' }] : []),
  ];
  return `<aside class="ps-side-card" aria-label="课堂进度">
    <div class="ps-side-title">${icon('list', 18)}<h2>第 ${esc(state.round ?? 1)} 轮进度</h2></div>
    <ol class="ps-progress">${progress.map(({ title, complete, current }) => `<li class="${complete ? 'is-complete' : current ? 'is-current' : ''}"${current ? ' aria-current="step"' : ''}><span aria-hidden="true">${complete ? icon('check', 13) : ''}</span>${title}</li>`).join('')}</ol>
    ${participant ? `<div class="ps-profile"><span class="ps-icon">${icon('user', 17)}</span><div><strong>${esc(participant.name)}</strong><span>已加入课堂</span></div></div>` : ''}
  </aside>`;
}

function results(state, current, response, ctx) {
  const { esc, icon } = ctx;
  const { options } = state.lesson;
  const count = state.responseCount ?? current.length;
  const simulated = state.simulatedResponseCount ?? current.filter(item => item.simulated).length;
  const bars = count ? options.map((option, index) => {
    const votes = current.filter(item => item.optionId === option.id).length;
    const percent = Math.round(votes * 100 / count);
    const isMine = response?.optionId === option.id;
    return `<li class="ps-result${isMine ? ' is-mine' : ''}"><div class="ps-result-name"><span class="ps-letter">${String.fromCharCode(65 + index)}</span><strong>${esc(option.label)}${isMine ? '<small>我的选择</small>' : ''}</strong><span class="ps-result-count"><b>${percent}%</b><span>${votes} 票</span></span></div><div class="ps-result-track" aria-hidden="true"><span style="width:${percent}%"></span></div></li>`;
  }) : [];
  return `<section class="ps-card ps-results" aria-labelledby="student-results-title">
    <div class="ps-card-heading"><span class="ps-icon">${icon('chart', 18)}</span><div><h2 id="student-results-title">全班作答</h2><p>${count} 份作答${simulated ? ` · 含 ${simulated} 份模拟` : ''}</p></div></div>
    ${count ? `<ul class="ps-result-list">${bars.join('')}</ul>` : '<p class="ps-empty">本轮没有收到作答。</p>'}
    ${state.decision?.title ? `<div class="ps-branch">${icon('network', 18)}<div><span>课堂讨论方向</span><strong>${esc(state.decision.title)}</strong></div></div>` : ''}
  </section>`;
}

function submitButton(label, draft, ctx) {
  return `<button class="ps-submit" id="student-submit" type="submit" data-submit-label="${label}"${draft.pending ? ' disabled' : ''}><span>${draft.pending ? '正在提交…' : label}</span>${ctx.icon('arrow-right', 18)}</button>`;
}

function joinForm(draft, ctx) {
  return `<form class="ps-form" aria-labelledby="student-form-title">
    <div class="ps-card-heading"><span class="ps-icon">${ctx.icon('user', 19)}</span><div><h2 id="student-form-title">加入课堂</h2><p id="student-name-note">老师将通过这个名字识别你的作答。</p></div></div>
    <div class="ps-input-group"><label for="student-name">课堂显示名</label><input id="student-name" name="name" autocomplete="nickname" required maxlength="32" placeholder="输入你的名字" aria-describedby="student-name-note" value="${ctx.esc(draft.name)}"></div>
    <p class="ps-error" data-form-message role="alert"${draft.error ? '' : ' hidden'}>${ctx.esc(draft.error)}</p>
    ${submitButton('加入课堂', draft, ctx)}
  </form>`;
}

function answerForm(state, draft, response, phaseIndex, ctx, reasonFocus = false) {
  const { esc } = ctx;
  const options = state.lesson.options.map((option, index) => `
    <label class="ps-option">
      <input type="radio" id="student-option-${index}" name="optionId" value="${esc(option.id)}" required${option.id === draft.optionId ? ' checked' : ''}>
      <span class="ps-letter" aria-hidden="true">${String.fromCharCode(65 + index)}</span><span>${esc(option.label)}</span><span class="ps-radio" aria-hidden="true"></span>
    </label>`);
  return `<form class="ps-form" aria-labelledby="student-form-title">
    <fieldset ${state.lesson.activityId==='step-fault@1'?'class="visually-hidden"':''}><legend id="student-form-title">选择一个答案</legend><div class="ps-options">${options.join('')}</div></fieldset>
    ${phaseIndex === null ? '' : `<div class="ps-sample"><div><label for="student-power">预测 A 端归一化光强</label><output for="student-power" data-power>${Number(draft.power)}%</output></div><span>分配给你的相位差为 ${esc(phaseLabel(phaseIndex))}。</span>
      <input id="student-power" name="power" type="range" min="0" max="100" step="1" value="${Number(draft.power)}" aria-valuetext="${Number(draft.power)}%"><p aria-hidden="true"><span>0%</span><span>100%</span></p></div>`}
    ${state.lesson.quickReasons?.length ? `<fieldset class="ps-quick-reasons"><legend>理由快选 · 说清判断依据</legend><button type="button" class="ps-reason-focus-button" data-reason-focus aria-pressed="${reasonFocus}">${reasonFocus ? '返回完整题面' : '专注作答理由'}</button>${state.lesson.quickReasons.map((reason, i) => `<button type="button" data-quick-reason="${i}" aria-pressed="${draft.quickReason === i || draft.reason === reason}">${esc(reason)}</button>`).join('')}<small>点选即填入，可继续编辑补充</small></fieldset>` : ''}
    ${state.lesson.activityId==='step-fault@1'?'<details class="ps-extra-reason"><summary>补充理由（选填）</summary>':''}<div class="ps-input-group"><div><label for="student-reason">作答理由 <span>选填</span></label><span aria-hidden="true" data-reason-count>${draft.reason.length}/280</span></div>
      <textarea id="student-reason" name="reason" rows="3" maxlength="280" placeholder="哪条线索影响了你的选择？">${esc(draft.reason)}</textarea></div>${state.lesson.activityId==='step-fault@1'?'</details>':''}
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

function wireForm(root, model, ctx, participant, response, phaseIndex) {
  const form = root.querySelector('form');
  if (!form) return;
  const { draft } = model;
  const focusReason = form.querySelector('[data-reason-focus]');
  if (focusReason) focusReason.onclick = () => {
    model.reasonFocus = !model.reasonFocus;
    root.querySelector('.ps-student').classList.toggle('ps-reason-focus',model.reasonFocus);
    focusReason.setAttribute('aria-pressed',String(model.reasonFocus));
    focusReason.textContent = model.reasonFocus ? '返回完整题面' : '专注作答理由';
    window.scrollTo(0,0);
  };
  form.querySelectorAll('[data-quick-reason]').forEach(button => button.onclick = () => {
    const field = form.querySelector('[name="reason"]');
    draft.quickReason = Number(button.dataset.quickReason);
    field.value = ctx.state.lesson.quickReasons[Number(button.dataset.quickReason)];
    field.dispatchEvent(new Event('input', { bubbles: true }));
    form.querySelectorAll('[data-quick-reason]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  });
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
      form.querySelector('[data-power]').value = `${draft.power}%`;
      target.setAttribute('aria-valuetext', `${draft.power}%`);
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
      }
      if (draft.edited === edited) draft.dirty = false;
    } catch (error) {
      const message = error?.message;
      draft.error = message && !/fetch|network|load failed/i.test(message)
        ? message : '暂时无法连接课堂，请稍后重试。';
    } finally {
      draft.pending = false;
      const currentForm = root.querySelector('form');
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
    model = { key, draft: responseDraft(participant, response) };
    mounted.set(root, model);
  }
  const { draft } = model;
  const collecting = state.phase === 'collect';
  const closed = state.phase === 'closed';
  const current = collecting ? null : responses.filter(item => Number(item.round) === round);
  const signature = JSON.stringify([state.phase, state.demo, participant, response, previous, state.decision, current, ctx.mode, ctx.connected]);
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
  root.innerHTML = `<div class="ps-student${model.reasonFocus && collecting ? ' ps-reason-focus' : ''}">
    <header class="ps-top"><div class="ps-top-inner"><div class="ps-brand"><img src="./assets/mark.svg" width="34" height="34" alt=""><strong>共演智课</strong><span>学生端</span></div><div class="ps-room"><span>课堂码</span><strong>${esc(state.code)}</strong></div></div></header>
    <div class="ps-body">
      ${reconnecting ? `<p class="ps-network" role="status">${icon('radio', 17)}正在恢复实时课堂连接。</p>` : ''}
      <header class="ps-hero"><div class="ps-hero-meta"><span>${esc(lesson.subject || '课堂互动')}</span><span aria-hidden="true"></span><span>第 ${round} 轮</span>${state.demo ? '<span aria-hidden="true"></span><span>模拟班级演示</span>' : ''}</div>
        <div class="ps-hero-title"><h1 id="student-lesson-title" tabindex="-1">${esc(lesson.title)}</h1><span class="ps-phase ps-phase--${esc(state.phase)}">${icon(phase.icon, 15)}${phase.label}</span></div></header>
       ${takeawayCard(state, participantId, esc)}
       ${closed ? '<details class="ps-closed-details"><summary>查看本轮题目、全班结果与课堂记录</summary>' : ''}
       <div class="ps-columns"><div class="ps-main-column"><section class="ps-card ps-task" aria-labelledby="student-question-title">
        <div class="ps-question"><p>${icon('book', 17)}<span id="student-question-title">本轮问题</span></p><div>${esc(promptFor(state))}</div></div>
        ${moduleHtml(lesson,state,{readonly:true,selectable:collecting&&joined,selectedId:draft.optionId})}${responseReceipt(response, optionFor(response), ctx, collecting)}
        ${model.formKind === 'join' ? joinForm(draft, ctx) : ''}
         ${model.formKind === 'answer' ? answerForm(state, draft, response, phaseIndex, ctx, model.reasonFocus) : ''}
        ${closed && !response ? `<p class="ps-closed">${icon('clock', 17)}你在本轮没有提交回答。</p>` : ''}
      </section>${current && (joined || closed) ? results(state, current, response, ctx) : ''}</div>
      <div class="ps-side-column">${progressCard(state, participant, ctx)}${previousAnswer(previous, optionFor(previous), ctx, keepPreviousOpen)}</div></div>
       ${closed ? '</details>' : ''}
    </div>
  </div>`;
  bindModule(root,lesson,ctx);
  root.querySelectorAll('[data-step-select]').forEach(button=>button.onclick=()=>{
    const radio=[...root.querySelectorAll('[name="optionId"]')].find(r=>r.value===button.dataset.stepSelect);
    if(radio){radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));draft.optionId=radio.value;draft.dirty=true;root.querySelectorAll('[data-step-select]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}
  });
  wireForm(root, model, ctx, participant, response, phaseIndex);
  focus();
}
