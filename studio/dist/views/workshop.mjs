import { lessons } from '../core/catalog.mjs';
import { getActivity } from '../core/activities.mjs';
import { composeLocally, rehearseComposition, REHEARSAL_INPUT } from '../core/lesson-composer.mjs';
import { exportScore, importScore } from '../core/score-package.mjs';

function createWorkshopState(options = {}) {
  const draft = {
    reference: lessons[0].id, topic: '', goal: '', material: '',
    score: null, source: 'local', trace: null, notice: '', edited: false,
    ...options.draft,
  };
  const state = { ...options, draft, operation: '', traceOpen: false, storageStatus: '草稿自动保存在当前浏览器' };
  if (state.storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(state.storageKey));
      if (saved) {
        Object.assign(draft, saved);
        state.storageStatus = '草稿已保存';
      }
    } catch {
      state.storageStatus = '草稿仅保留在当前页面';
    }
  }
  return state;
}

let standaloneWorkshop;

const compositionStages = [
  { id: 'prepare', title: '整理材料', stack: 'JavaScript ES Modules', description: '按参考课例整理目标与材料。' },
  { id: 'generate', title: '生成课谱', stack: 'Node.js HTTP · Chat Completions', description: '生成可编辑的题目和教学分支。' },
  { id: 'validate', title: '校验引用', stack: 'JSON Schema · JavaScript', description: '检查字段、选项和材料编号。' },
  { id: 'compile', title: '试运行', stack: 'ScorePackage v1 · 课堂状态机', description: '验证课谱回读、分支与两轮作答。' },
];
const stageLabels = { ok: '通过', skipped: '跳过', failed: '未通过', repaired: '修复后通过' };
const generationDetails = {
  local: { stack: '本地 JavaScript 模板', description: '按参考课例套用探究活动模板。' },
  rehearsal: { stack: '浏览器 · 模拟响应', description: '用固定回包演示校验与修复。' },
};
const sourceLabels = {
  provider: '模型编排',
  fallback: '本地模板 · 模型回退',
  local: '本地模板',
  rehearsal: '模拟编排',
  imported: '已导入课谱',
};
const operationLabels = {
  model: '正在编排课谱并校验材料引用…',
  local: '正在应用本地模板…',
  rehearsal: '正在运行备课演示…',
  import: '正在读取和校验课谱…',
  publish: '正在创建课堂…',
};
const stages = [
  { icon: 'list', title: '独立初答' },
  { icon: 'network', title: '检验分支' },
  { icon: 'replay', title: '二次作答' },
];

function workshopMount(state) {
  const mount = state.mount;
  if (mount?.root.isConnected && mount.root.firstElementChild?.classList.contains('pw-prep')) return mount;
}

function persist(state) {
  if (state.onChange) {
    state.onChange(state.draft);
    return;
  }
  clearTimeout(state.saveTimer);
  state.saveTimer = undefined;
  try {
    localStorage.setItem(state.storageKey, JSON.stringify(state.draft));
    updateStorageStatus(state, '草稿已保存');
  } catch {
    updateStorageStatus(state, '草稿仅保留在当前页面');
  }
}

function updateStorageStatus(state, status) {
  state.storageStatus = status;
  const label = workshopMount(state)?.root.querySelector('[data-draft-status]');
  if (label && label.textContent !== state.storageStatus) label.textContent = state.storageStatus;
}

function queueSave(state) {
  if (state.onChange) {
    persist(state);
    return;
  }
  if (state.saveTimer !== undefined) return;
  updateStorageStatus(state, '正在保存草稿…');
  state.saveTimer = setTimeout(() => persist(state), 360);
}

function feedback(root, message = '', error = false) {
  const status = root.querySelector('[data-workshop-feedback]');
  status.textContent = message;
  status.classList.toggle('pw-feedback-error', error);
}

function updateOperation(state) {
  const root = workshopMount(state)?.root;
  if (!root) return;
  root.querySelectorAll('[data-workshop-lock], .pw-inputs :is(select,input,textarea,button), .pw-score :is(input,textarea)').forEach(control => {
    control.disabled = Boolean(state.operation);
  });
  const message = state.operation === 'publish' && state.onAdopt ? '正在采用这份互动课谱…' : operationLabels[state.operation];
  feedback(root, message);
}

function refreshWorkshop(state, focus, message) {
  const mount = workshopMount(state);
  if (!mount) return;
  paintWorkshop(mount.root, mount.ctx, state);
  feedback(mount.root, message);
  mount.root.querySelector(focus)?.focus();
}

function formatDuration(elapsedMs) {
  if (elapsedMs < 1) return '小于 1 ms';
  if (elapsedMs < 1000) return Math.round(elapsedMs) + ' ms';
  return (elapsedMs / 1000).toFixed(1) + ' s';
}

function renderEvidence(trace, score, e) {
  if (!trace.evidence?.length || !trace.materials?.length) return '';
  const materials = new Map(trace.materials.map(({ id, text }) => [id, text]));
  const branchTitles = new Map(score.branches.map(({ id, title }) => [id, title]));
  return `<details class="pw-harness-evidence"><summary>生成时引用的材料 · ${trace.evidence.length} 条分支</summary>
    <ul>${trace.evidence.map(({ branchId, materialIds }) => `<li><strong>${e(branchTitles.get(branchId) ?? branchId)}</strong>
      ${materialIds.filter(id => materials.has(id)).map(id => `<blockquote><code>${e(id)}</code><span>${e(materials.get(id))}</span></blockquote>`).join('')}
    </li>`).join('')}</ul></details>`;
}

function renderChecks(trace, e) {
  if (!trace.checks || !trace.coverage) return '';
  return `<dl class="pw-harness-checks">
    <div><dt>活动接口</dt><dd><code>${e(trace.activityId)}</code></dd></div>
    <div><dt>课谱交换</dt><dd>${trace.checks.scoreRoundTrip ? '导出、回读通过' : '未通过'}</dd></div>
    <div><dt>课堂试跑</dt><dd>${e(trace.checks.testedBranches)} 条分支 × ${e(trace.checks.rounds)} 轮</dd></div>
    <div><dt>材料编号覆盖</dt><dd>${e(trace.coverage.referenced)} / ${e(trace.coverage.available)}</dd></div>
  </dl>`;
}

function renderHarness(state, e, icon, aiOutputMode, canCompose) {
  const { draft, traceOpen } = state;
  const { trace } = draft;
  const route = trace ? draft.source : canCompose ? 'provider' : 'local';
  const results = new Map((trace?.stages ?? []).map(stage => [stage.id, stage]));
  return `<details class="pw-harness" ${traceOpen ? 'open' : ''}>
    <summary id="pw-harness-title"><span class="pw-summary-label">${icon('network', 19)}<strong>编排与校验记录</strong></span>
      <span class="pw-summary-end"><span>${trace ? e(sourceLabels[draft.source] ?? sourceLabels.local) : '查看编排流程'}</span>${icon('chevron-down', 16)}</span>
    </summary>
    <div class="pw-harness-body">
      <ol class="pw-harness-stages" role="list">${compositionStages.map(definition => {
        const generation = definition.id === 'generate' && generationDetails[route];
        const { id, title, stack, description } = { ...definition, ...generation };
        const stage = results.get(id);
        const status = Object.hasOwn(stageLabels, stage?.status) ? stage.status : '';
        return `<li data-harness-stage="${id}"><h3>${title}</h3><p>${description}</p><code class="pw-harness-stack">${stack}</code>
          ${id === 'generate' && (trace?.outputMode || aiOutputMode) && !generation ? `<small>${trace?.outputMode ? '本次请求' : '服务端模式'} <code>${e(trace?.outputMode ?? aiOutputMode)}</code></small>` : ''}
          ${status ? `<div class="pw-harness-step-result"><span data-stage-status="${status}">${stageLabels[status]}</span><small>${formatDuration(stage.elapsedMs)}</small></div>` : ''}</li>`;
      }).join('')}</ol>
      ${trace ? `<div class="pw-harness-receipt" aria-label="本次编排记录">
        <div class="pw-harness-summary"><div><h3>${e(sourceLabels[draft.source] ?? sourceLabels.local)}</h3>
          <p>${trace.model ? e(trace.model) + ' · ' : ''}${trace.attempts > 0 ? (draft.source === 'rehearsal' ? '模拟调用 ' : '模型请求 ') + trace.attempts + ' 次 · ' : ''}耗时 ${formatDuration(trace.elapsedMs)}</p></div>
          <button type="button" class="pw-button" data-harness-preview data-workshop-lock>${icon('smartphone', 16)}学生预览</button>
        </div>
        <p class="pw-harness-edited" data-harness-edited ${draft.edited ? '' : 'hidden'}>课谱已由教师编辑。此处显示编排时的校验结果。</p>
        ${draft.notice ? `<p class="pw-harness-notice">${e(draft.notice)}</p>` : ''}
        ${trace.fallback?.validate === 'ok' && trace.fallback?.compile === 'ok' ? '<p class="pw-harness-notice">本地课谱已通过结构校验和课堂试跑。</p>' : ''}
        ${renderChecks(trace, e)}
        ${trace.issues?.length ? `<ul class="pw-harness-issues">${trace.issues.map(({ attempt, message }) => `<li>第 ${e(attempt)} 次尝试 · ${e(message)}</li>`).join('')}</ul>` : ''}
        ${renderEvidence(trace, draft.score, e)}
      </div>` : ''}
    </div>
  </details>`;
}

async function composeWithModel(ctx, input) {
  try {
    const result = await ctx.compose(input);
    if (!result?.lesson || !['provider', 'fallback'].includes(result.source)) throw new Error('缺少课谱。');
    return result;
  } catch {
    return { ...composeLocally(input), notice: '未收到模型服务的编排结果，浏览器已生成本地课谱。' };
  }
}

function requestReplacement(state, root, message, action) {
  if (state.operation) return;
  if (!message) return action();
  const dialog = root.querySelector('[data-replace-dialog]');
  dialog.querySelector('p').textContent = message;
  dialog.querySelector('[value="replace"]').onclick = () => {
    dialog.close();
    action();
  };
  dialog.showModal();
}

async function runComposition(state, ctx, input, mode, compose) {
  if (state.operation) return;
  state.operation = mode;
  updateOperation(state);
  let result;
  let errorMessage;
  try {
    result = await compose(input);
    const { lesson, source, trace, notice = '' } = result;
    Object.assign(state.draft, input, { score: lesson, source, trace, notice, edited: false });
    persist(state);
  } catch (error) {
    errorMessage = error?.message || '编排失败，请重试。';
  } finally {
    state.operation = '';
    updateOperation(state);
  }
  if (errorMessage) {
    const root = workshopMount(state)?.root;
    if (root) {
      feedback(root, errorMessage, true);
      root.querySelector(mode === 'rehearsal' ? '[data-rehearse]' : mode === 'model' ? '[data-compose]' : '[data-local-compose]')?.focus({ preventScroll: true });
    } else ctx.toast(errorMessage);
    return;
  }
  state.traceOpen = mode === 'rehearsal';
  const success = {
    rehearsal: '备课演示完成，已生成可编辑的示例课谱。',
    fallback: '已切换到本地模板，可以继续编辑课谱。',
  };
  refreshWorkshop(state, mode === 'rehearsal' ? '#pw-harness-title' : '[data-score="title"]',
    result.notice || success[result.source] || '课谱已生成，可以编辑题目和教学分支。');
}

function downloadJSON(text, filename) {
  const href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function downloadScore(lesson, ctx) {
  try { downloadJSON(exportScore(lesson), 'polyphony-score-' + lesson.id + '.json'); }
  catch (error) { ctx.toast(error.message); }
}

function workshopEditor(score, e, icon) {
  if (!score) return `<div class="pw-editor-empty">
    <div class="pw-empty-art" aria-hidden="true"><span></span><span></span><span>${icon('workshop', 32)}</span></div>
    <h3>还没有课谱</h3><p>填写备课材料并编排课谱，或导入已有的课谱。</p>
    <ol aria-label="课堂作答流程">${stages.map(stage => `<li>${icon(stage.icon, 16)}${stage.title}</li>`).join('')}</ol>
  </div>`;
  return `<form class="pw-score" id="pw-score">
    <div class="pw-score-heading-fields">
      <label>课题名称<input data-score="title" value="${e(score.title)}" maxlength="100" required></label>
      <label>学科<input data-score="subject" value="${e(score.subject)}" maxlength="80"></label>
    </div>
    <label>学习目标<input data-score="description" value="${e(score.description)}" maxlength="500"></label>
    <fieldset><legend>初次作答</legend>
      <label>题目与材料<textarea data-score="prompt" rows="5" maxlength="2500" required>${e(score.prompt)}</textarea></label>
      <div class="pw-option-fields">${score.options.map((option, index) => `<label><span class="pw-option-index" aria-hidden="true">${String.fromCharCode(65 + index)}</span><span class="visually-hidden">选项 ${String.fromCharCode(65 + index)}</span><input data-option="${index}" value="${e(option.label)}" maxlength="240" required></label>`).join('')}</div>
    </fieldset>
    <fieldset><legend>教学分支</legend>${score.branches.map((branch, index) => `<details class="pw-branch" ${index === 0 ? 'open' : ''}>
      <summary><span class="pw-branch-index" aria-hidden="true">${index + 1}</span><span data-branch-label="${index}">${e(branch.title) || '分支 ' + (index + 1)}</span>${icon('chevron-down', 16)}</summary>
      <div class="pw-branch-fields">
        <label>分支标题<input data-branch="${index}" data-field="title" value="${e(branch.title)}" maxlength="120" required></label>
        <label>学生任务<textarea data-branch="${index}" data-field="description" rows="2" maxlength="700" required>${e(branch.description)}</textarea></label>
        <label>二次作答题目<span class="pw-field-note">留空时使用初答题目并提示学生结合新证据作答</span><textarea data-branch="${index}" data-field="revisionPrompt" rows="2" maxlength="700">${e(branch.revisionPrompt ?? '')}</textarea></label>
      </div>
    </details>`).join('')}</fieldset>
  </form>`;
}

function previewDialog(score, icon) {
  if (!score) return '';
  return `<dialog class="pw-preview" aria-labelledby="pw-preview-title">
    <form class="pw-dialog-dismiss" method="dialog"><button class="pw-icon-button" aria-label="关闭预览" autofocus>${icon('close', 20)}</button></form>
    <h2 id="pw-preview-title">学生预览</h2>
    <div class="pw-preview-tools">
      <div class="pw-preview-switch" role="group" aria-label="作答阶段">
        <button type="button" data-preview-round="1" aria-pressed="true">初次作答</button>
        <button type="button" data-preview-round="2" aria-pressed="false">二次作答</button>
      </div>
      <label data-preview-branch hidden>检验分支<select></select></label>
    </div>
    <div class="pw-preview-content" data-preview-content></div>
  </dialog>`;
}

function bindPreview(root, draft, e) {
  const dialog = root.querySelector('.pw-preview');
  const tools = dialog.querySelectorAll('[data-preview-round]');
  const branchLabel = dialog.querySelector('[data-preview-branch]');
  const select = branchLabel.querySelector('select');
  const content = dialog.querySelector('[data-preview-content]');
  function showRound(round) {
    const score = draft.score;
    const branch = round === 2 ? score.branches[Number(select.value)] : null;
    const task = branch ? `<aside><strong>检验任务</strong><p>${e(branch.description)}</p></aside>` : '';
    const prompt = branch ? (branch.revisionPrompt?.trim() || '完成「' + branch.title + '」后，结合新证据重新回答题目。' + score.prompt) : score.prompt;
    branchLabel.hidden = round === 1;
    tools.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.previewRound) === round)));
    content.innerHTML = `<h3>${e(score.title)}</h3>${task}<p class="pw-prompt">${e(prompt)}</p>
      <ol>${score.options.map((option, index) => `<li><span aria-hidden="true">${String.fromCharCode(65 + index)}</span>${e(option.label)}</li>`).join('')}</ol>`;
  }
  tools.forEach(button => { button.onclick = () => showRound(Number(button.dataset.previewRound)); });
  select.onchange = () => showRound(2);
  root.querySelectorAll('[data-preview], [data-harness-preview]').forEach(button => {
    button.onclick = () => {
      select.innerHTML = draft.score.branches.map((branch, index) => `<option value="${index}">${e(branch.title)}</option>`).join('');
      showRound(1);
      dialog.showModal();
    };
  });
}

function paintWorkshop(root, ctx, state) {
  state.mount = { root, ctx };
  const { esc: e, icon } = ctx;
  const { draft, onAdopt } = state;
  const canCompose = ctx.modelAvailable && typeof ctx.compose === 'function';
  const { score } = draft;
  const currentActivity = score && getActivity(score);
  root.innerHTML = `<div class="pw-view pw-prep">
    <header class="pw-heading">
      <div><h1>${onAdopt ? '这一页的互动课谱' : 'AI 备课'}</h1><p class="pw-lead">${onAdopt ? e(state.pageLabel) : '把教学材料编排成可直接开课的互动课谱。'}</p></div>
      <div class="pw-header-actions">
        ${onAdopt ? '' : `<p class="pw-save-line">${icon('check', 15)}<span data-draft-status>${e(state.storageStatus)}</span></p>`}
        <div class="pw-actions">
          ${onAdopt ? `<button class="pw-button" type="button" data-material-back>${icon('arrow-left', 16)}返回讲义备课</button>` : `
            <button class="pw-button" type="button" data-material-link>${icon('book', 16)}讲义备课</button>
            <button class="pw-button" type="button" data-rehearse data-workshop-lock>${icon('play', 16)}运行备课演示</button>`}
          <button class="pw-button" type="button" data-import data-workshop-lock>${icon('download', 16)}导入课谱</button>
          <input type="file" accept=".json,application/json" data-score-file hidden>
        </div>
      </div>
    </header>
    <div class="pw-feedback" role="status" aria-live="polite" data-workshop-feedback></div>
    <div class="pw-columns">
      <section class="pw-panel" aria-labelledby="pw-material-title">
        <header class="pw-panel-heading"><span class="pw-panel-icon">${icon('book', 20)}</span><h2 id="pw-material-title">备课材料</h2></header>
        <form class="pw-inputs">
          <label>参考课例<select name="reference">${lessons.map(lesson => `<option value="${e(lesson.id)}" ${lesson.id === draft.reference ? 'selected' : ''}>${e(lesson.subject)}</option>`).join('')}</select></label>
          <label>课题<input name="topic" maxlength="100" required value="${e(draft.topic)}" placeholder="例如，城市里哪里更凉快？"></label>
          <label>学习目标<input name="goal" maxlength="180" required value="${e(draft.goal)}" placeholder="例如，用观测数据判断树荫是否影响气温"></label>
          <label>课堂材料<textarea name="material" rows="6" maxlength="2200" required placeholder="粘贴学生可直接阅读的记录、数据或文本">${e(draft.material)}</textarea></label>
          <p class="pw-character-count"><span data-material-length>${draft.material.length}</span> / 2200</p>
          <div class="pw-compose-actions">
            <button class="pw-button ${canCompose ? '' : 'pw-primary'}" type="submit" data-local-compose>${icon('layers', 17)}${canCompose ? '使用本地模板' : '本地生成课谱'}</button>
            ${canCompose ? `<button class="pw-button pw-primary" type="submit" data-compose>${icon('sparkles', 17)}使用模型编排</button>` : ''}
          </div>
          <p class="pw-field-note">${canCompose ? '使用模型时，课题、目标与材料会发送到已配置的模型服务。' : '本地模板可离线编排。连接已配置模型的课堂服务后，可使用模型编排。'}</p>
        </form>
      </section>
      <section class="pw-panel pw-editor-panel" aria-labelledby="pw-editor-title">
        <header class="pw-panel-heading"><span class="pw-panel-icon">${icon('workshop', 20)}</span><div><h2 id="pw-editor-title">课堂课谱</h2>
          <p>${score ? e(sourceLabels[draft.source] ?? sourceLabels.local) + ' · ' + score.options.length + ' 个选项 · ' + score.branches.length + ' 条分支' : '教师编辑与学生预览'}</p></div></header>
        ${score ? `<div class="pw-score-tools">
          <button class="pw-button pw-primary" type="submit" form="pw-score" data-workshop-lock>${onAdopt ? '加到讲授这一页' + icon('plus', 17) : '开设新课堂' + icon('arrow-up-right', 17)}</button>
          <button class="pw-button" type="button" data-preview data-workshop-lock>${icon('smartphone', 16)}学生预览</button>
          <button class="pw-button" type="button" data-score-export data-workshop-lock>${icon('download', 16)}下载课谱</button>
        </div>
        <div class="pw-editor-meta">${currentActivity ? `<span>${icon('layers', 14)}${e(currentActivity.title)}</span>` : ''}
          ${draft.trace ? '<button class="pw-text-button" type="button" data-review-trace>查看编排记录</button>' : ''}</div>` : ''}
        ${workshopEditor(score, e, icon)}
      </section>
    </div>
    ${renderHarness(state, e, icon, ctx.aiOutputMode, canCompose)}
    ${onAdopt ? '' : `<section class="pw-template-library" aria-labelledby="pw-templates-title">
      <header><h2 id="pw-templates-title">内置课例</h2><p>可直接开课，也可下载课谱后导入编辑。</p></header>
      <div class="pw-catalog">${lessons.map(lesson => `<article>
        <p class="pw-template-subject">${icon('book', 16)}${e(lesson.subject)}</p><h3>${e(lesson.title)}</h3><p>${e(lesson.description)}</p>
        <div class="pw-actions"><button class="pw-button" type="button" data-builtin="${e(lesson.id)}" data-workshop-lock>开设这节课${icon('arrow-up-right', 16)}</button>
          <button class="pw-icon-button" type="button" data-builtin-export="${e(lesson.id)}" aria-label="下载「${e(lesson.title)}」课谱" title="下载课谱">${icon('download', 18)}</button></div>
      </article>`).join('')}</div>
    </section>`}
    ${previewDialog(score, icon)}
    <dialog class="pw-replace-dialog" data-replace-dialog aria-labelledby="pw-replace-title">
      <h2 id="pw-replace-title">替换当前草稿？</h2><p></p>
      <form method="dialog" class="pw-actions">
        <button class="pw-button" value="cancel" autofocus>继续编辑</button>
        <button class="pw-button pw-primary" type="button" value="replace">替换草稿</button>
      </form>
    </dialog>
  </div>`;

  const launch = async lesson => {
    if (state.operation) return;
    state.operation = 'publish';
    updateOperation(state);
    try {
      if (onAdopt) await onAdopt(importScore(exportScore(lesson)), structuredClone(draft));
      else await ctx.startLesson(lesson);
    }
    catch (error) { ctx.toast(error?.message || (onAdopt ? '采用课谱失败，请重试。' : '开设课堂失败，请重试。')); }
    finally {
      state.operation = '';
      updateOperation(state);
    }
  };
  root.querySelector('[data-material-link]')?.addEventListener('click', () => ctx.go('materials'));
  root.querySelector('[data-material-back]')?.addEventListener('click', () => state.onBack());
  const harness = root.querySelector('.pw-harness');
  harness.ontoggle = () => { if (harness.isConnected) state.traceOpen = harness.open; };
  root.querySelector('[data-rehearse]')?.addEventListener('click', () => {
    const hasDraft = draft.score || [draft.topic, draft.goal, draft.material].some(value => value.trim());
    requestReplacement(state, root, hasDraft ? '运行备课演示会用示例材料和课谱替换当前备课内容。' : '',
      () => runComposition(state, ctx, REHEARSAL_INPUT, 'rehearsal', rehearseComposition));
  });
  root.querySelector('[data-review-trace]')?.addEventListener('click', () => {
    harness.open = true;
    harness.querySelector('summary').focus();
  });
  root.querySelectorAll('[data-builtin]').forEach(button => {
    button.onclick = () => launch(lessons.find(lesson => lesson.id === button.dataset.builtin));
  });
  root.querySelectorAll('[data-builtin-export]').forEach(button => {
    button.onclick = () => downloadScore(lessons.find(lesson => lesson.id === button.dataset.builtinExport), ctx);
  });
  const fileInput = root.querySelector('[data-score-file]');
  root.querySelector('[data-import]').onclick = () => { if (!state.operation) fileInput.click(); };
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file || state.operation) return;
    fileInput.value = '';
    state.operation = 'import';
    updateOperation(state);
    let lesson;
    let errorMessage;
    try {
      if (file.size > 384000) throw new Error('课谱文件超过大小限制。');
      lesson = importScore(await file.text());
      if (lessons.some(item => item.id === lesson.id)) lesson.id = 'custom-' + lesson.id + '-' + Date.now().toString(36);
    } catch (error) {
      errorMessage = error.message;
    } finally {
      state.operation = '';
      updateOperation(state);
    }
    if (!fileInput.isConnected) return;
    if (errorMessage) {
      feedback(root, errorMessage, true);
      root.querySelector('[data-import]').focus({ preventScroll: true });
      return;
    }
    requestReplacement(state, root, draft.score ? '导入「' + lesson.title + '」会替换当前编辑的课谱。' : '', () => {
      Object.assign(draft, { score: lesson, source: 'imported', trace: null, notice: '', edited: false });
      state.traceOpen = false;
      persist(state);
      refreshWorkshop(state, '[data-score="title"]', '课谱已导入，可以预览或继续编辑。');
    });
  };
  const source = root.querySelector('.pw-inputs');
  source.oninput = ({ target }) => {
    if (!target.name) return;
    draft[target.name] = target.value;
    if (target.name === 'material') source.querySelector('[data-material-length]').textContent = target.value.length;
    queueSave(state);
  };
  source.onsubmit = event => {
    event.preventDefault();
    if (state.operation) return;
    if (![draft.topic, draft.goal, draft.material].every(value => value.trim())) {
      ctx.toast('请填写课题、学习目标和课堂材料。');
      return;
    }
    const useModel = event.submitter?.hasAttribute('data-compose') && canCompose;
    const input = { topic: draft.topic, goal: draft.goal, material: draft.material, reference: draft.reference };
    requestReplacement(state, root, draft.score ? '重新编排会替换现有题目、选项与教学分支。' : '', () =>
      runComposition(state, ctx, input, useModel ? 'model' : 'local', useModel ? values => composeWithModel(ctx, values) : composeLocally));
  };
  updateOperation(state);

  const editor = root.querySelector('.pw-score');
  if (!editor) return;
  editor.addEventListener('invalid', event => {
    const branch = event.target.closest('.pw-branch');
    if (branch) branch.open = true;
  }, true);
  editor.oninput = ({ target }) => {
    const { score, option, branch, field } = target.dataset;
    if (score) {
      draft.score[score] = target.value;
      if (score === 'description' && draft.source !== 'imported') draft.score.skills = target.value.trim() ? [target.value.slice(0, 180)] : [];
    }
    if (option != null) draft.score.options[option].label = target.value;
    if (branch != null) {
      draft.score.branches[branch][field] = field === 'revisionPrompt' && !target.value.trim() ? '' : target.value;
      if (field === 'title') editor.querySelector('[data-branch-label="' + branch + '"]').textContent = target.value || '分支 ' + (Number(branch) + 1);
    }
    if (draft.trace && !draft.edited) {
      draft.edited = true;
      root.querySelector('[data-harness-edited]').hidden = false;
    }
    queueSave(state);
  };
  editor.onsubmit = event => {
    event.preventDefault();
    const fields = [score.title, score.prompt, ...score.options.map(option => option.label),
      ...score.branches.flatMap(branch => [branch.title, branch.description])];
    if (fields.some(value => !value.trim())) return ctx.toast('请填写课谱中的全部题目、选项和分支。');
    if (new Set(score.options.map(option => option.label.trim())).size !== score.options.length) {
      return ctx.toast('请为初答编写互不相同的选项。');
    }
    launch(JSON.parse(JSON.stringify(score)));
  };
  root.querySelector('[data-score-export]').onclick = () => downloadScore(draft.score, ctx);
  bindPreview(root, draft, e);
}

export function renderWorkshop(root, ctx) {
  const state = standaloneWorkshop ??= createWorkshopState({ storageKey: 'polyphony.workshop.draft' });
  paintWorkshop(root, ctx, state);
  const flush = () => {
    if (state.saveTimer !== undefined) persist(state);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    flush();
    if (state.mount?.root === root) state.mount = undefined;
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export function renderMaterialWorkshop(root, ctx, options) {
  paintWorkshop(root, ctx, createWorkshopState(options));
}
