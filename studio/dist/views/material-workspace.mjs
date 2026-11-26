import { readPptx } from '../core/pptx-reader.mjs';
import { readLegacySlides } from '../core/legacy-ppt.mjs';
import { makeMaterialVersionId, createMaterialNotebook } from '../core/material-notebook.mjs';
import { createPageModule, dryRunLesson } from '../core/deck-harness.mjs';
import { MODULE_MANIFESTS } from '../core/activities.mjs';
import { blockText, buildLectureScore, validateLectureScore } from '../core/lecture-score.mjs';
import { moduleHtml, bindModule } from './module-renderer.mjs';
import { renderLectureFrame } from './lecture-stage.mjs';

const labels = {
  'concept-diagnosis@1': '概念题',
  'step-fault@1': '逐行找错',
  'param-explorer@1': '参数实验',
  'evidence-weighing@1': '证据讨论',
};
const stages = {
  ingest: '正在读取课件…', triage: '正在选择适合互动的页面…', synthesize: '正在生成课件内容…',
  verify_repair: '正在检查题目与引用…', dryrun_compile: '正在试跑互动…',
};
const blankSpec = () => ({ course: '', topic: '', pageCount: 10, pacingMode: 'stem-60s' });
const workspace = { material: null, result: null, index: 0, mode: 'import', spec: blankSpec(), message: '' };
let pendingSave = Promise.resolve();

function materialFromScore(score, versionId) {
  return {
    name: score.source.name, title: score.title, type: score.source.kind, versionId,
    pages: score.pages.map(page => ({ ...page, text: page.blocks?.map(blockText).join('\n') ?? page.body.join('\n') })),
  };
}

function fromDraft(material, draft) {
  if (!draft) return null;
  return {
    lectureScore: buildLectureScore(material, new Map(draft.adopted), {
      title: draft.title, interactionsByPage: new Map(draft.interactions),
    }),
    harnessReceipt: draft.harnessReceipt,
    source: draft.source,
  };
}

export function renderMaterialWorkspace(root, ctx) {
  const { esc: e } = ctx;
  const notebook = createMaterialNotebook();
  let stopped = false;
  let busy = false;
  let recent = null;
  let failure = '';

  function announce(message) {
    const status = root.querySelector('[data-prep-progress]');
    if (status && !stopped) status.textContent = message;
  }

  function progress(receipt) {
    const stage = receipt.stages.find(item => item.status === 'running');
    if (stage) announce(stages[stage.id]);
  }

  function persist() {
    const { material, result } = workspace;
    if (!material || !material.versionId || ctx.demonstration) return;
    const draft = result ? {
      title: result.lectureScore.title, source: result.source, harnessReceipt: result.harnessReceipt,
      adopted: result.lectureScore.pages.filter(page => page.adopted.length).map(page => [page.number, { slides: page.adopted }]),
      interactions: result.lectureScore.pages.filter(page => page.interaction).map(page => [page.number, page.interaction]),
    } : null;
    const snapshot = { ...material, draft };
    recent = { versionId: material.versionId, title: material.title };
    pendingSave = pendingSave.then(async () => {
      await notebook.saveVersion(snapshot);
      const notes = await notebook.listNotes(material.versionId);
      material.pageMemories = {};
      for (const note of notes) {
        (material.pageMemories[note.pageNumber] ??= []).push({ id: note.id, kind: note.kind, packet: note.packet });
      }
    }).catch(() => { /* The current deck stays available if browser storage cannot save it. */ });
  }

  function showMaterial(material, result = null, message = '') {
    Object.assign(workspace, { material, result, index: 0, message });
    persist();
  }

  async function task(message, action) {
    if (busy) return;
    busy = true;
    failure = '';
    paint();
    announce(message);
    try {
      await action();
    } catch (error) {
      failure = error.message;
    } finally {
      busy = false;
      if (!stopped) paint();
    }
  }

  function options(selectValue, name) {
    return `<label>互动节奏<select name="${name}" ${busy ? 'disabled' : ''}>
      <option value="stem-60s" ${selectValue === 'stem-60s' ? 'selected' : ''}>短互动 · 约 1 分钟</option>
      <option value="seminar-3m" ${selectValue === 'seminar-3m' ? 'selected' : ''}>讨论 · 约 3 分钟</option>
    </select></label>`;
  }

  function startScreen() {
    const spec = workspace.spec;
    const canUseModel = ctx.providerSummary?.configured;
    const resume = recent ? `<div class="prep-recent"><button type="button" class="plain-button" data-resume-draft ${busy ? 'disabled' : ''}>继续上次备课</button><small>${e(recent.title)}</small></div>` : '';
    if (workspace.mode === 'native') {
      return `<section class="prep-card"><div class="prep-card-head"><h2>AI 备课</h2><button class="text-button" data-source-mode="import" ${busy ? 'disabled' : ''}>改用导入课件</button></div>
        <form class="prep-form" data-author-form>
          <label>课程和授课对象<input name="course" placeholder="例如：大一软件技术基础" value="${e(spec.course)}" maxlength="300" required ${busy ? 'disabled' : ''}></label>
          <label>本节课讲什么<textarea name="topic" rows="4" placeholder="填写主题、重难点或想讨论的问题" maxlength="8000" required ${busy ? 'disabled' : ''}>${e(spec.topic)}</textarea></label>
          ${canUseModel ? '' : '<p class="prep-note">当前可生成本地备课框架。<button type="button" class="text-button" data-prep-provider>连接模型</button></p>'}
          <details class="prep-options"><summary>更多选项</summary><div class="prep-settings-grid">
            <label>页数<select name="pageCount" ${busy ? 'disabled' : ''}>${[8, 10, 12].map(n => `<option ${spec.pageCount === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            ${options(spec.pacingMode, 'pacingMode')}
          </div></details>
          <button class="action-primary prep-primary" type="submit" ${busy ? 'disabled' : ''}>生成课件</button>
        </form></section>`;
    }
    return `<section class="prep-card prep-entry" data-upload-zone>
      <div class="prep-entry-actions">
        <button class="action-primary prep-primary" type="button" data-upload ${busy ? 'disabled' : ''}>导入课件</button>
        <button class="plain-button prep-primary" type="button" data-source-mode="native" ${busy ? 'disabled' : ''}>AI 备课</button>
      </div>
      <p class="prep-note">拖入 PPT、PPTX、PDF 或共演课件，也可以<button type="button" class="text-button" data-paste ${busy ? 'disabled' : ''}>粘贴讲义</button>。</p>
      ${resume}
    </section>`;
  }

  function receiptDetails(result) {
    const receipt = result?.harnessReceipt;
    if (!receipt) return '';
    return `<details class="prep-options"><summary>生成详情</summary><ul>
      ${receipt.stages.map(stage => `<li>${e(stage.title)}${stage.status === 'complete' ? ' · 完成' : ''}</li>`).join('')}
      ${receipt.repairs.map(repair => `<li>${repair.pageNumber ? '第 ' + repair.pageNumber + ' 页 · ' : ''}${repair.status === 'fallback' ? '已使用本地方案' : '已修复'} · ${e(repair.issue)}</li>`).join('')}
    </ul></details>`;
  }

  function previewScreen() {
    const { material, result, index } = workspace;
    const pages = material.pages.filter(page => !page.hidden);
    const interactions = new Map(result?.lectureScore.pages.filter(page => page.interaction).map(page => [page.number, page.interaction]) ?? []);
    const page = pages[index];
    const lesson = interactions.get(page?.number);
    const generation = !result && material.type !== 'native' ? `<form class="prep-compose" data-compose-deck>
      <button type="submit" class="plain-button" data-run-harness ${busy ? 'disabled' : ''}>生成互动</button>
      <details class="prep-options"><summary>更多选项</summary>${options(workspace.spec.pacingMode, 'pacingMode')}</details>
    </form>` : '';
    return `<section class="prep-card prep-preview">
      <header class="prep-preview-head"><div><h2>${e(result?.lectureScore.title ?? material.title)}</h2>
        <p class="prep-note">${pages.length} 页${interactions.size ? ' · ' + interactions.size + ' 个互动' : ''}</p></div>
        <div class="prep-preview-actions"><button class="action-primary prep-primary" type="button" data-publish ${busy ? 'disabled' : ''}>开始上课</button>
        <details class="prep-menu"><summary>更多</summary><div>
          <button class="plain-button" type="button" data-export-deck ${busy ? 'disabled' : ''}>下载共演课件</button>
          <button class="plain-button" type="button" data-new-draft ${busy ? 'disabled' : ''}>返回备课首页</button>
        </div></details></div>
      </header>
      ${generation}
      ${workspace.message ? '<p class="prep-note">' + e(workspace.message) + '</p>' : ''}
      ${receiptDetails(result)}
      <div class="prep-preview-grid">
        <nav class="prep-page-list" aria-label="课件页">${pages.map((entry, i) => `<button type="button" data-page="${i}" aria-current="${i === index ? 'page' : 'false'}" ${busy ? 'disabled' : ''}><span>${entry.number}</span><span>${e(entry.title)}</span>${interactions.has(entry.number) ? '<i aria-label="有互动"></i>' : ''}</button>`).join('')}</nav>
        <div class="prep-slide">
          <div data-page-preview></div>
          ${page ? `<details class="prep-options"><summary>${lesson ? '本页互动 · ' + e(labels[lesson.activityId] ?? '互动题') : '给本页添加互动'}</summary>
            <label>互动类型<select data-swap ${busy ? 'disabled' : ''}><option value="">无互动</option>
              ${MODULE_MANIFESTS.map(item => `<option value="${item.id}" ${lesson?.activityId === item.id ? 'selected' : ''}>${e(labels[item.id])}</option>`).join('')}
            </select></label>
            ${lesson ? `<h3>${e(lesson.prompt)}</h3><div data-module-preview>${moduleHtml(lesson,{phase:'reveal',round:1,responses:[]},{standalone:true})}</div>` : ''}
          </details>` : ''}
        </div>
      </div>
    </section>`;
  }

  function paint() {
    const { material } = workspace;
    root.innerHTML = `<section class="prep-workspace"><h1 class="prep-title">备课</h1>
      <p class="prep-progress" data-prep-progress role="status"></p>
      ${failure ? `<p class="shell-entry-error" role="alert">${e(failure)}</p>` : ''}
      ${material ? previewScreen() : startScreen()}
      <input type="file" accept=".ppt,.pptx,.pdf,.json" data-file hidden>
      <dialog class="overlay-dialog" data-paste-dialog aria-labelledby="paste-title"><form class="prep-form">
        <h2 id="paste-title">粘贴讲义</h2>
        <label>标题<input name="title" maxlength="100" required></label>
        <label>讲义正文<textarea name="text" rows="6" required></textarea></label>
        <div class="prep-entry-actions"><button type="submit" class="action-primary">预览讲义</button><button type="button" class="plain-button" data-cancel>取消</button></div>
      </form></dialog></section>`;
    if (material) {
      const page = material.pages.filter(item => !item.hidden)[workspace.index];
      if (page) renderLectureFrame(root.querySelector('[data-page-preview]'), {
        ...page, body: page.body ?? page.text?.split(/\r?\n/) ?? [],
        pageNumber: page.number, source: { name: material.name },
      }, { compact: true });
      const lesson = workspace.result?.lectureScore.pages.find(item => item.number === page?.number)?.interaction;
      if (lesson) bindModule(root.querySelector('[data-module-preview]'), lesson);
    }
    wire();
  }

  async function importFile(file) {
    await task('正在读取课件…', async () => {
      const extension = file.name.split('.').at(-1).toLowerCase();
      if (extension === 'json') {
        if (file.size > 64 * 1024 * 1024) throw new Error('课件超过 64 MB。');
        const lectureScore = validateLectureScore(JSON.parse(await file.text()));
        for (const { interaction } of lectureScore.pages) if (interaction) dryRunLesson(interaction);
        const versionId = await makeMaterialVersionId({ bytes: JSON.stringify(lectureScore) });
        showMaterial(materialFromScore(lectureScore, versionId), { lectureScore, source: 'json-import' });
        return;
      }
      if (!['ppt', 'pptx', 'pdf'].includes(extension)) throw new Error('请选择 PPT、PPTX、PDF 或共演课件。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const versionId = await makeMaterialVersionId({ bytes });
      let data;
      if (ctx.mode === 'server' && (extension !== 'pptx' || ctx.materialRendering)) {
        try { data = await ctx.importMaterial(file); }
        catch (error) { if (extension === 'pdf') throw error; }
      }
      if (!data && extension === 'pptx') data = await readPptx(file);
      if (!data && extension === 'ppt') data = await readLegacySlides(bytes);
      if (!data) throw new Error('PDF 导入需要课堂服务。也可以粘贴讲义继续备课。');
      showMaterial({ ...data, name: file.name, title: data.title || file.name, type: extension, versionId },
        null, data.warnings?.join(' ') ?? '');
    });
  }

  function updateLesson(page, id) {
    const { material, result } = workspace;
    const next = id ? createPageModule(page, id) : null;
    const map = new Map(result?.lectureScore.pages.filter(item => item.interaction).map(item => [item.number, item.interaction]) ?? []);
    if (next) {
      dryRunLesson(next);
      map.set(page.number, next);
    } else {
      map.delete(page.number);
    }
    const adopted = new Map((result?.lectureScore.pages ?? []).map(item => [item.number, { slides: item.adopted }]));
    workspace.result = { ...result, lectureScore: buildLectureScore(material, adopted, { interactionsByPage: map }) };
    if (next && next.activityId !== id) workspace.message = '本页内容适合先用概念题检查理解。';
    persist();
  }

  function wire() {
    const click = (selector, action) => root.querySelector(selector)?.addEventListener('click', action);
    click('[data-upload]', () => root.querySelector('[data-file]').click());
    root.querySelector('[data-file]').onchange = event => {
      const file = event.target.files[0];
      if (file) void importFile(file);
    };
    const upload = root.querySelector('[data-upload-zone]');
    if (upload) {
      upload.ondragover = event => event.preventDefault();
      upload.ondrop = event => {
        event.preventDefault();
        if (event.dataTransfer.files[0]) void importFile(event.dataTransfer.files[0]);
      };
    }
    root.querySelectorAll('[data-source-mode]').forEach(button => button.onclick = () => {
      workspace.mode = button.dataset.sourceMode;
      failure = '';
      paint();
      root.querySelector(workspace.mode === 'native' ? '[name=course]' : '[data-upload]')?.focus();
    });
    click('[data-prep-provider]', () => ctx.configureModel(paint));
    const author = root.querySelector('[data-author-form]');
    const saveSpec = () => {
      const data = Object.fromEntries(new FormData(author));
      workspace.spec = { ...data, pageCount: Number(data.pageCount) };
    };
    author?.addEventListener('input', saveSpec);
    author?.addEventListener('submit', event => {
      event.preventDefault();
      saveSpec();
      void task('正在生成课件…', async () => {
        const result = await ctx.authorDeck(workspace.spec, { onStage: progress });
        const versionId = result.harnessReceipt.contentDigest ??
          await makeMaterialVersionId({ bytes: JSON.stringify(result.lectureScore) });
        showMaterial(materialFromScore(result.lectureScore, versionId), result, result.generationNote);
      });
    });
    root.querySelector('[data-compose-deck]')?.addEventListener('submit', event => {
      event.preventDefault();
      workspace.spec.pacingMode = new FormData(event.currentTarget).get('pacingMode');
      void task('正在生成互动…', async () => {
        await pendingSave;
        workspace.result = await ctx.runHarness(workspace.material, {
          pacingMode: workspace.spec.pacingMode, mode: 'auto', onStage: progress,
        });
        persist();
      });
    });
    root.querySelectorAll('[data-page]').forEach(button => button.onclick = () => {
      workspace.index = Number(button.dataset.page);
      paint();
      root.querySelector(`[data-page="${workspace.index}"]`)?.focus({ preventScroll: true });
    });
    root.querySelector('[data-swap]')?.addEventListener('change', event => {
      try {
        updateLesson(workspace.material.pages.filter(page => !page.hidden)[workspace.index], event.target.value);
        failure = '';
      } catch (error) {
        failure = error.message;
      }
      paint();
      const select = root.querySelector('[data-swap]');
      select.closest('details').open = true;
      select.focus({ preventScroll: true });
    });
    click('[data-new-draft]', () => {
      Object.assign(workspace, { material: null, result: null, index: 0, mode: 'import', message: '' });
      failure = '';
      paint();
    });
    click('[data-resume-draft]', () => void task('正在打开上次备课…', async () => {
      const material = await notebook.getVersion(recent.versionId);
      if (!material) throw new Error('找不到上次保存的课件。');
      showMaterial(material, fromDraft(material, material.draft));
      workspace.index = Math.max(0, material.pages.filter(page => !page.hidden).findIndex(page => page.number === material.lastPage));
    }));
    click('[data-publish]', () => void task('正在开课…', () =>
      ctx.startLecture(workspace.result?.lectureScore ?? buildLectureScore(workspace.material))));
    click('[data-export-deck]', () => {
      try {
        const score = workspace.result?.lectureScore ?? buildLectureScore(workspace.material);
        const url = URL.createObjectURL(new Blob([JSON.stringify(score, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = '共演-' + score.title.slice(0, 60).replace(/[\\/:*?"<>|]/g, '_') + '.json';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        failure = error.message;
        paint();
      }
    });
    const paste = root.querySelector('[data-paste-dialog]');
    click('[data-paste]', () => paste.showModal());
    click('[data-cancel]', () => paste.close());
    paste.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const title = String(data.get('title')).trim();
      const text = String(data.get('text')).trim();
      if (!title || !text) return;
      paste.close();
      void task('正在读取讲义…', async () => {
        const versionId = await makeMaterialVersionId({ bytes: title + '\n' + text });
        showMaterial({ name: title, title, type: 'text', versionId, pages: [{ number: 1, title, text, images: [] }] });
      });
    };
  }

  paint();
  if (!ctx.demonstration && !workspace.material) {
    void notebook.listVersions().then(items => {
      if (!stopped && !busy && !workspace.material && workspace.mode === 'import' && items[0]) {
        recent = items[0];
        paint();
      }
    }).catch(() => {});
  }
  return () => { stopped = true; };
}
