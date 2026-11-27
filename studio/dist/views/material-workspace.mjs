import { readPptx } from '../core/pptx-reader.mjs';
import { readLegacySlides } from '../core/legacy-ppt.mjs';
import { makeMaterialVersionId, createMaterialNotebook } from '../core/material-notebook.mjs';
import { HARNESS_STAGES, createPageModule, dryRunLesson } from '../core/deck-harness.mjs';
import { MODULE_MANIFESTS } from '../core/activities.mjs';
import {
  blockText, buildLectureScore, isEmbeddedLectureImage, lectureFrame, lectureSourceExcerpt, validateLectureScore,
} from '../core/lecture-score.mjs';
import { renderRichMathHtml } from '../core/math-render.mjs';
import { redactProviderError } from '../core/lesson-provider.mjs';
import { moduleHtml, bindModule } from './module-renderer.mjs';
import { fitLectureSlide, fitPresentationContent, renderLectureFrame } from './lecture-stage.mjs';
import { parseMarkdownDeck, inferBlocksFromPlainSlide } from '../core/slide-blocks.mjs';
import { renderPageEditor, normalizeEditedLesson, normalizeEditedSlide, reanchorEditedLesson } from './page-editor.mjs';
import { universalLessons } from '../core/universal-lessons.mjs';

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
const pageCounts = Array.from({ length: 43 }, (_, index) => index + 6);
const toolBadges = {
  search_media: ['🔎', 'search_media'],
  plot_math_chart: ['📈', 'plot_math_chart'],
  validate_math_and_diagram: ['∑', 'validate_math_and_diagram'],
  lookup_reference: ['↗', 'lookup_reference'],
  commit_slides: ['✓', 'commit_slides'],
  revise_slide: ['✎', 'revise_slide'],
  course_review: ['✨', '全卷自审'],
  tool_protocol: ['⇄', '工具协议'],
};
const toolStatuses = { running: '调用中', success: '完成', error: '待修正', info: '记录' };
const densities = [
  ['sparse', '紧凑'],
  ['balanced', '标准'],
  ['dense', '高频'],
];
const adaptationModes = [
  ['preserve', '原页无损活化', '保留原页画面与顺序，在合适的页内加入互动。'],
  ['enhance', '原页升级 + 插拓展页', '保留原页，在难点后插入公式梳理、流程图或诊断页。'],
  ['rebuild', '重构为平台原生课件', '用原稿文字、公式、表格与关键插图重新编排。'],
];
const legacyKinds = new Set(['ppt', 'pptx', 'pdf', 'markdown', 'md', 'txt', 'text']);
const defaultSettings = { pageCount: 10, density: 'balanced', pacingMode: 'stem-60s', enableWebImages: true };
const workspace = {
  material: null, result: null, index: 0, mode: 'import', message: '',
  spec: { course: '', topic: '', ...defaultSettings },
  adaptation: { ...defaultSettings },
  retryPlan: null,
  unfinishedRun: null,
  visualEdits: {},
  contentEdits: {},
};
let pendingSave = Promise.resolve();

function materialFromScore(score, versionId) {
  return {
    name: score.source.name, title: score.title, type: score.source.kind, versionId,
    pages: score.pages.map(({ adopted, interaction, ...page }) => ({
      ...page, text: page.body.length ? page.body.join('\n') : page.blocks?.map(blockText).join('\n') ?? '',
    })),
  };
}

function fromDraft(material, draft) {
  if (!draft) return null;
  for (const page of material.pages) {
    page.speakerNotes = draft.speakerNotes?.[page.number] ?? page.speakerNotes ?? '';
    Object.assign(page, draft.visuals?.[page.number]);
    const content = draft.content?.[page.number];
    if (content) Object.assign(page, content, {nativeBlocks: undefined, body: undefined});
  }
  return {
    lectureScore: buildLectureScore(material, new Map(draft.adopted), {
      title: draft.title, interactionsByPage: new Map(draft.interactions),
    }),
    harnessReceipt: draft.harnessReceipt,
    source: draft.source,
    retry: draft.retry,
  };
}

function mergePptxSources(rendered, original) {
  if (!rendered) return original;
  if (!original || original.pages.length !== rendered.pages.length) return rendered;
  const originalPages = new Map(original.pages.map(page => [page.number, page]));
  return {
    ...rendered,
    pages: rendered.pages.map(page => {
      const source = originalPages.get(page.sourcePageNumber ?? page.number);
      const hasVisibleImage = source?.images?.some(image => isEmbeddedLectureImage(image.cropped ? image.visibleSrc : image.src));
      return {
        ...page,
        ...(source?.text.trim() && { text: source.text }),
        ...(hasVisibleImage && { images: source.images }),
        ...(!page.preview && isEmbeddedLectureImage(source?.preview) && { preview: source.preview }),
      };
    }),
  };
}

function previewEntries() {
  const compiled = new Map(workspace.result?.lectureScore.pages.map(page => [page.number, page.adopted]));
  return (workspace.material?.pages ?? []).filter(page => !page.hidden).sort((a,b) => a.number-b.number).flatMap(page => [
    { page },
    ...(compiled.get(page.number) ?? []).map((supplement, supplementIndex) => ({ page, supplement, supplementIndex })),
  ]);
}

const slideKey = ({page, supplementIndex}) => `${page.number}/${supplementIndex ?? ''}`;

function adoptedSlides(result) {
  return new Map(result?.lectureScore.pages.map(page => [page.number, { slides: page.adopted }]));
}

function pageInteractions(result) {
  return new Map(result?.lectureScore.pages.filter(page => page.interaction).map(page => [page.number, page.interaction]));
}

export function renderMaterialWorkspace(root, ctx) {
  const { esc: e } = ctx;
  const notebook = createMaterialNotebook();
  let stopped = false;
  let busy = false;
  let recent = null;
  let failure = '';
  let versions = [], receipt = null;
  let activeWork, disposeEditor, disposePreview, paintFrame, paintedMaterial;
  let streamPage, streamStamp, traceStamp, failuresStamp;
  const contentDrafts = new Map(), activityPreviews = new Set();
  let returnTarget = null;
  try {const value=sessionStorage.getItem('polyphony.material.return');sessionStorage.removeItem('polyphony.material.return');if(value)returnTarget=JSON.parse(value);}catch {}

  function announce(message) {
    const status = root.querySelector('[data-prep-progress]');
    if (status && !stopped) status.textContent = message;
  }

  function progress(nextReceipt) {
    if (stopped || activeWork?.signal.aborted) return;
    receipt = nextReceipt;
    const heading = root.querySelector('[data-harness-heading]');
    if (heading) heading.innerHTML = harnessHeading();
    const panel = root.querySelector('[data-harness-status]');
    if (panel) panel.innerHTML = pipeline();
    refreshAgentTools();
    const stage = receipt.stages?.find(item => item.status === 'running');
    const message = receipt.longHorizon?.message ?? (stage && stages[stage.id]);
    if (message) announce(message);
  }

  function persist(repaintLibrary = true) {
    const { material, result } = workspace;
    if (!material || !material.versionId || ctx.demonstration) return Promise.resolve();
    const { material: originalForRetry, ...retryPlan } = workspace.retryPlan ?? {};
    const draft = result ? {
      title: result.lectureScore.title, source: result.source, harnessReceipt: result.harnessReceipt,
      adopted: result.lectureScore.pages.filter(page => page.adopted.length).map(page => [page.number, { slides: page.adopted }]),
      speakerNotes: Object.fromEntries(material.pages.map(page=>[page.number,page.speakerNotes ?? ''])),
      interactions: result.lectureScore.pages.filter(page => page.interaction).map(page => [page.number, page.interaction]),
      ...(result.retry && retryPlan.kind && { retry: result.retry, retryPlan }),
      ...(Object.keys(workspace.visualEdits).length && { visuals: workspace.visualEdits }),
      ...(Object.keys(workspace.contentEdits).length && { content: workspace.contentEdits }),
    } : null;
    const snapshot = { ...material, pages: material.pages.map(page => ({...page})), draft };
    recent = { versionId: material.versionId, title: material.title };
    const saved = pendingSave.then(() => notebook.saveVersion(snapshot));
    pendingSave = saved.then(async () => {
      const notes = await notebook.listNotes(material.versionId);
      material.pageMemories = structuredClone(material.pageMemories ?? {});
      for (const note of notes) {
        const memories=material.pageMemories[note.pageNumber] ??= [];
        if(!memories.some(item=>item.id===note.id))memories.push({ id: note.id, kind: note.kind, packet: note.packet });
      }
      await refreshLibrary(repaintLibrary);
    }).catch(() => { /* The current deck stays available if browser storage cannot save it. */ });
    return saved;
  }

  function showMaterial(material, result = null, message = '', retryPlan = null) {
    material = {...material, pages: material.pages.map(page => material.draft?.content?.[page.number]
      ? page : inferBlocksFromPlainSlide(page))};
    const visibleCount = material.pages.filter(page => !page.hidden).length;
    const pageCount = Math.max(6, Math.min(48, visibleCount));
    Object.assign(workspace, {
      material, result, index: 0, message,
      adaptation: { ...defaultSettings, pageCount },
      retryPlan, unfinishedRun: null,
      visualEdits: material.draft?.visuals ?? {},
      contentEdits: material.draft?.content ?? {},
    });
    contentDrafts.clear();
    activityPreviews.clear();
    receipt=result?.harnessReceipt ?? null;
    persist();
  }

  async function task(message, action, { cancellable = false, restoreFocus } = {}) {
    if (busy) return;
    const previousReceipt = receipt;
    if (cancellable) {
      activeWork = new AbortController();
      receipt = null;
      streamPage = undefined;
    }
    busy = true;
    failure = '';
    paint();
    announce(message);
    if (cancellable) root.querySelector('[data-cancel-authoring]')?.focus();
    let cancelled = false;
    try {
      await action(activeWork?.signal);
      cancelled = Boolean(activeWork?.signal.aborted);
    } catch (error) {
      cancelled = Boolean(activeWork?.signal.aborted);
      if (!cancelled) failure = redactProviderError(error);
    } finally {
      busy = false;
      activeWork = undefined;
      if (cancelled) receipt = previousReceipt;
      if (!stopped) {
        paint();
        if (cancelled) {
          announce('已取消编排。');
          if (restoreFocus) root.querySelector(restoreFocus)?.focus();
        } else if (cancellable && !failure) {
          const failed = currentReceipt()?.failures?.length ?? 0;
          announce(failed ? `有 ${failed} 个编排环节待重试。` : '课件已编排完成。');
        }
      }
    }
  }

  function options(selectValue, name) {
    return `<label>互动节奏<select name="${name}" ${busy ? 'disabled' : ''}>
      <option value="stem-60s" ${selectValue === 'stem-60s' ? 'selected' : ''}>短互动 · 约 1 分钟</option>
      <option value="seminar-3m" ${selectValue === 'seminar-3m' ? 'selected' : ''}>讨论 · 约 3 分钟</option>
    </select></label>`;
  }

  function authorSettings(spec, allowMedia = true) {
    return `<div class="prep-settings-grid prep-author-settings">
      <label>页数<select name="pageCount" ${busy ? 'disabled' : ''}>${pageCounts.map(n =>
        `<option value="${n}" ${spec.pageCount === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>互动密度<select name="density" ${busy ? 'disabled' : ''}>${densities.map(([value, label]) =>
        `<option value="${value}" ${spec.density === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      ${options(spec.pacingMode, 'pacingMode')}
      ${allowMedia ? `<label class="prep-web-images">
        <input type="checkbox" name="enableWebImages" ${spec.enableWebImages ? 'checked' : ''} ${busy ? 'disabled' : ''}>
        <span>允许联网配图（开源科普图库）</span></label>` : ''}
    </div>`;
  }

  function readSettings(form) {
    const data = new FormData(form);
    return {
      pageCount: Number(data.get('pageCount')),
      density: data.get('density'),
      pacingMode: data.get('pacingMode'),
      enableWebImages: data.has('enableWebImages'),
    };
  }

  function longHorizon(progress) {
    if (!progress?.message) return '';
    const { batches = [], completedBatches = 0, batchCount = 0, message } = progress;
    const labels = { pending: '等待', running: '编写中', complete: '已完成', fallback: '本地补全', failed: '待重试' };
    return `<div class="harness-long-progress" data-long-horizon>
      <p>${e(message)}</p>
      ${batchCount ? `<progress value="${e(completedBatches)}" max="${e(batchCount)}" aria-label="写页批次完成进度"></progress>` : ''}
      ${batches.length ? `<ol class="harness-batches">${batches.map(batch => {
        const state = batch.fallback ? 'fallback' : batch.status;
        const range = `${batch.startPage}–${batch.endPage} 页`;
        const title = state === 'complete' && batch.source === 'local' ? '本地编排完成' : labels[state] ?? labels.pending;
        return `<li data-batch-state="${e(state)}" title="${e(title)}"><span>${e(range)}</span></li>`;
      }).join('')}</ol>` : ''}
    </div>`;
  }

  function currentReceipt() {
    if (receipt || activeWork) return receipt;
    if (workspace.unfinishedRun) return workspace.unfinishedRun.result?.harnessReceipt;
    return workspace.result?.harnessReceipt;
  }

  function retryTarget() {
    if (workspace.unfinishedRun) return workspace.unfinishedRun;
    if (workspace.retryPlan && workspace.result?.retry) return { plan: workspace.retryPlan, result: workspace.result };
    return null;
  }

  function agentFailures(active) {
    const failures = active?.failures ?? [];
    const retry = retryTarget();
    const error = busy ? '' : workspace.unfinishedRun?.error;
    if (!failures.length && !error) return '';
    const chapterRetry = !busy && Boolean(retry?.result?.retry);
    return `<section class="prep-agent-failures" data-agent-failures aria-labelledby="agent-failures-title">
      <header><h2 id="agent-failures-title">${failures.length ? '有页面待重试' : '编排请求失败'}</h2>
        <button type="button" class="plain-button" data-retry-failed ${busy || !retry ? 'disabled' : ''}>${failures.length ? '🔄 重试失败页' : '🔄 重试编排'}</button></header>
      ${error ? `<p role="alert">${e(error)}</p>` : ''}
      ${failures.length ? `<ul>${failures.map(item => {
        const numbers = item.pageNumbers ?? [];
        const first = item.startPage ?? numbers.at(0);
        const last = item.endPage ?? numbers.at(-1);
        const label = first && last && first !== last ? `第 ${first}–${last} 页` : first ? `第 ${first} 页` : '当前编排';
        const stageName = { blueprint: '规划蓝图', batch: '编写页面', enhance: '编写拓展页', interaction: '合成互动' }[item.stage];
        return `<li><b>${e(stageName ? label + ' · ' + stageName : label)}</b><span>${e(item.reason)}</span>
          ${chapterRetry && numbers.length && failures.length > 1 ? `<button type="button" class="text-button" data-retry-range="${e(numbers.join(','))}">${numbers.length === 1 ? '重试此页' : '重试此页段'}</button>` : ''}</li>`;
      }).join('')}</ul>` : ''}
    </section>`;
  }

  function renderToolTrace(events) {
    return `<header><h3>Agent 工具调用轨迹</h3>${events.length ? `<small>${events.length} 条</small>` : ''}</header>
      ${events.length ? `<ol data-tool-log tabindex="0" aria-label="工具调用详情">${events.toReversed().map(event => {
        const [mark, tool] = Object.hasOwn(toolBadges, event.tool) ? toolBadges[event.tool] : ['·', event.tool];
        const status = Object.hasOwn(toolStatuses, event.status) ? event.status : 'info';
        return `<li data-tool-status="${status}"><span aria-hidden="true">${mark}</span><div>
          <b>${e(tool)}</b>${event.detail ? `<small>${e(event.detail)}</small>` : ''}
          <p>${e(event.summary)}</p></div><span class="harness-tool-state">${toolStatuses[status]}</span></li>`;
      }).join('')}</ol>` : '<p class="harness-tool-empty">调用工具后在此显示查证、配图、绘图与校验结果。</p>'}`;
  }

  function refreshAgentTools() {
    const active = currentReceipt();
    const events = active?.toolEvents ?? [];
    const trace = root.querySelector('[data-agent-tools]');
    const traceKey = JSON.stringify(events);
    if (trace && traceKey !== traceStamp) {
      const previous = trace.querySelector('[data-tool-log]');
      const scrollTop = previous?.scrollTop ?? 0;
      const scrollHeight = previous?.scrollHeight ?? 0;
      const focused = document.activeElement === previous;
      trace.innerHTML = renderToolTrace(events);
      const log = trace.querySelector('[data-tool-log]');
      if (focused) log?.focus({ preventScroll: true });
      if (log && scrollTop) log.scrollTop = scrollTop + log.scrollHeight - scrollHeight;
      traceStamp = traceKey;
    }
    const failures = root.querySelector('[data-agent-failure-slot]');
    const markup = agentFailures(active);
    if (failures && markup !== failuresStamp) {
      failures.innerHTML = markup;
      failuresStamp = markup;
    }
    const slot = root.querySelector('[data-agent-preview-slot]');
    const pages = activeWork || active?.failures?.length ? active?.previewPages ?? [] : [];
    const selected = pages.find(page => page.number === streamPage) ?? pages.at(-1);
    const streamKey = JSON.stringify([pages, selected?.number]);
    if (!slot || streamKey === streamStamp) return;
    streamStamp = streamKey;
    slot.innerHTML = selected ? `<section class="prep-card prep-streaming" data-agent-live-pages>
      <header><h2>已成稿预览</h2><span>${pages.length} 页</span></header>
      <nav aria-label="已成稿页">${pages.map(page => `<button type="button" data-agent-preview-page="${e(page.number)}"
        aria-label="第 ${e(page.number)} 页 ${e(page.title)}" aria-current="${page === selected ? 'page' : 'false'}">${e(page.number)}</button>`).join('')}</nav>
      <div class="prep-stream-frame" data-agent-preview-frame></div>
      ${selected.imageCount ? `<p class="prep-note">已内嵌 ${e(selected.imageCount)} 张配图，编排完成后可查看。</p>` : ''}
    </section>` : '';
    if (selected) renderLectureFrame(slot.querySelector('[data-agent-preview-frame]'),
      { ...selected, pageNumber: selected.number }, { compact: true });
  }

  function memoriesFor(page) { return page.pageMemories ?? workspace.material?.pageMemories?.[page.number] ?? []; }
  function memoryText(memory) {const data=memory.packet ?? memory;return String(data.reason ?? data.summary ?? data.note ?? data.misconception ?? JSON.stringify(data)).slice(0,500);}
  function harnessHeading() {
    const active = currentReceipt();
    const waiting = active?.failures?.length || workspace.unfinishedRun?.error;
    return `<div class="harness-head"><span class="harness-orbit">◉</span><div><h2>Agent Harness</h2><p>五阶段实时编排看板</p></div>
      <span class="harness-ready">${activeWork ? '编排进行中' : waiting ? '待重试' : '准备就绪'}</span></div>
      ${longHorizon(active?.longHorizon)}`;
  }

  function pipeline() {
    const active = currentReceipt();
    const compiled = workspace.result?.lectureScore.pages;
    const pageTotal = compiled?.reduce((count, page) => count + 1 + page.adopted.length, 0);
    const statuses = { complete: '验证通过', running: '正在处理', failed: '待重试' };
    return `<ol class="harness-pipeline">${HARNESS_STAGES.map((stage, index) => {
        const state = active?.stages?.find(entry => entry.id === stage.id)?.status ?? 'pending';
        const repairs = stage.id === 'verify_repair' ? active?.repairs ?? [] : [];
        return `<li data-stage="${stage.id}" data-state="${e(state)}"><span>${state === 'complete' ? '✓' : String(index + 1).padStart(2, '0')}</span>
          <div><b>${e(stage.title)}</b><small>${statuses[state] ?? '等待编排'}</small>
          ${repairs.map(r => `<p class="harness-repair">P${e(r.pageNumber ?? '—')} · ${e(r.beforeSummary ?? r.issue)} → ${e(r.afterSummary ?? '完成复验')}</p>`).join('')}</div><i></i></li>`;
      }).join('')}</ol><div class="harness-summary">
      <b>${compiled ? pageTotal + ' 页讲义 · ' + compiled.filter(page => page.interaction).length + ' 个互动' : '从任意课程出发'}</b>
      <span>来源可追溯 · 单页容错 · 双轮预演</span></div>`;
  }
  function library() {
    return `<section class="prep-card version-library" data-prep-library><h2>我的备课版本库</h2>${versions.length?versions.map(v=>`<div class="version-row"><div><b>${renderRichMathHtml(v.title || v.name)}</b><small>${v.pageCount} 页 · ${v.memoryCount ?? 0} 条记忆</small></div><button class="text-button" type="button" data-open-version="${e(v.versionId)}" ${busy?'disabled':''}>继续打开</button><button class="text-button" type="button" data-delete-version="${e(v.versionId)}" ${busy?'disabled':''}>删除版本</button></div>`).join(''):'<p class="prep-note">导入或生成课件后，会在本机保存可继续编辑的版本。</p>'}</section>`;
  }
  function resumeDraft() {
    return recent ? `<div class="prep-recent"><button type="button" class="plain-button" data-resume-draft ${busy ? 'disabled' : ''}>继续上次备课</button><small>${renderRichMathHtml(recent.title)}</small></div>` : '';
  }
  async function refreshLibrary(repaint=true) {
    const items=await notebook.listVersions();
    versions=await Promise.all(items.map(async item=>({...item,memoryCount:(await notebook.listNotes(item.versionId)).length})));
    recent=versions[0] ?? null;
    if (repaint && !stopped && !busy) {
      root.querySelector('[data-prep-library]').outerHTML = library();
      const resume = root.querySelector('[data-prep-recent]');
      if (resume) resume.innerHTML = resumeDraft();
      wireLibrary();
    }
  }
  async function openVersion(versionId,pageNumber) {
    await pendingSave;
    const material=await notebook.getVersion(versionId);
    if(!material)throw Error('找不到这个备课版本。');
    const notes=await notebook.listNotes(versionId);material.pageMemories ??= {};
    for(const note of notes)(material.pageMemories[note.pageNumber] ??= []).push({id:note.id,packet:note.packet,kind:note.kind});
    showMaterial(material, fromDraft(material, material.draft), '', material.draft?.retryPlan ?? null);
    workspace.index = Math.max(0, previewEntries().findIndex(entry => entry.page.number === Number(pageNumber ?? material.lastPage)));
  }

  function startScreen() {
    const spec = workspace.spec;
    const { configured, fastConfigured } = ctx.providerSummary ?? {};
    const canUseModel = configured || fastConfigured;
    if (workspace.mode === 'native') {
      return `<section class="prep-card"><div class="prep-card-head"><h2>AI 备课</h2><button class="text-button" data-source-mode="import" ${busy ? 'disabled' : ''}>改用导入课件</button></div>
        <form class="prep-form" data-author-form>
          <label>课程和授课对象<input name="course" placeholder="例如：大一软件技术基础" value="${e(spec.course)}" maxlength="300" required ${busy ? 'disabled' : ''}></label>
          <label>本节课讲什么<textarea name="topic" rows="4" placeholder="填写主题、重难点或想讨论的问题" maxlength="8000" required ${busy ? 'disabled' : ''}>${e(spec.topic)}</textarea></label>
          ${canUseModel ? '' : `<p class="prep-note">当前可生成本地备课框架。<button type="button" class="text-button" data-prep-provider ${busy ? 'disabled' : ''}>连接模型</button></p>`}
          <div class="prep-options prep-native-settings">${authorSettings(spec)}</div>
          <button class="action-primary prep-primary" type="submit" ${busy ? 'disabled' : ''}>生成课件</button>
        </form></section>`;
    }
    return `<section class="prep-card prep-entry" data-upload-zone>
      <div class="prep-entry-actions">
        <button class="action-primary prep-primary" type="button" data-upload ${busy ? 'disabled' : ''}>导入课件</button>
        <button class="plain-button prep-primary" type="button" data-source-mode="native" ${busy ? 'disabled' : ''}>AI 备课</button>
      </div>
      <p class="prep-note">拖入 PPT、PPTX、PDF、Markdown、TXT 或共演课件，也可以<button type="button" class="text-button" data-paste ${busy ? 'disabled' : ''}>粘贴 Markdown / 多页讲义</button>。</p>
      <div data-prep-recent>${resumeDraft()}</div>
    </section>`;
  }

  function receiptDetails(result) {
    const receipt = result?.harnessReceipt;
    if (!receipt) return '';
    return `<details class="prep-options"><summary>生成详情</summary><ul>
      ${receipt.stages.map(stage => `<li>${e(stage.title)}${stage.status === 'complete' ? ' · 完成' : ''}</li>`).join('')}
      ${(receipt.repairs ?? []).map(repair => `<li>${repair.pageNumber ? '第 ' + repair.pageNumber + ' 页 · ' : ''}${repair.status === 'fallback' ? '已使用本地方案' : '已修复'} · ${e(repair.issue)}<p>${e(repair.beforeSummary ?? '原输出未通过校验')} → ${e(repair.afterSummary ?? '逐页复验通过')}</p></li>`).join('')}
    </ul><button type="button" class="text-button" data-receipt>查看完整护栏回执</button></details>`;
  }

  function adaptationPanel(material, result) {
    if (!legacyKinds.has(material.type) || result?.source === 'json-import' || result?.harnessReceipt?.adaptedPages?.length) return '';
    return `<form class="prep-adaptation" data-adapt-material aria-labelledby="adaptation-heading">
      <h3 id="adaptation-heading">原稿迁移方式</h3>
      <details class="prep-options"><summary>编排设置</summary>${authorSettings(workspace.adaptation)}</details>
      <div class="prep-adaptation-modes">${adaptationModes.map(([mode, title, summary]) =>
        `<button type="submit" name="adaptationMode" value="${mode}" data-adaptation-mode="${mode}"
          ${mode === 'preserve' ? 'data-run-harness' : ''} aria-label="${e(title)}" aria-describedby="adaptation-${mode}" ${busy ? 'disabled' : ''}>
          <strong>${e(title)}</strong><span id="adaptation-${mode}">${e(summary)}</span>
        </button>`).join('')}</div>
    </form>`;
  }

  function previewScreen() {
    const { material, result, index } = workspace;
    const entries = previewEntries();
    const supplements = entries.filter(entry => entry.supplement).length;
    const interactions = pageInteractions(result);
    const { page, supplement } = entries[index] ?? {};
    const lesson = supplement ? null : interactions.get(page?.number);
    const showActivity = Boolean(lesson && activityPreviews.has(slideKey(entries[index])));
    return `<section class="prep-card prep-preview">
      <header class="prep-preview-head"><div><h2>${renderRichMathHtml(result?.lectureScore.title ?? material.title)}</h2>
        <p class="prep-note">${entries.length} 页${supplements ? ' · ' + supplements + ' 张拓展页' : ''}${interactions.size ? ' · ' + interactions.size + ' 个互动' : ''}</p></div>
        <div class="prep-preview-actions"><button class="action-primary prep-primary" type="button" data-publish ${busy ? 'disabled' : ''}>开始上课</button>
        <details class="prep-menu"><summary>更多</summary><div>
          <button class="plain-button" type="button" data-export-deck ${busy ? 'disabled' : ''}>下载共演课件</button>
          <button class="plain-button" type="button" data-new-draft ${busy ? 'disabled' : ''}>返回备课首页</button>
        </div></details></div>
      </header>
      ${adaptationPanel(material, result)}
      ${workspace.message ? '<p class="prep-note">' + e(workspace.message) + '</p>' : ''}
      ${receiptDetails(result)}
      <div class="prep-preview-grid">
        <nav class="prep-page-list" aria-label="课件页">${entries.map(({page: original, supplement: extension}, i) =>
          `<button type="button" data-page="${i}" ${extension ? 'data-supplemental' : ''} aria-current="${i === index ? 'page' : 'false'}" ${busy ? 'disabled' : ''}>
            <span>${extension ? '↳' : original.number}</span><span><span data-prep-page-title>${renderRichMathHtml(extension?.title ?? original.title)}</span>
            ${extension ? `<small class="prep-supplement-tag">原稿第 ${original.number} 页拓展</small>` : memoriesFor(original).length ? '<small class="page-memory-badge">🧠 往届记忆</small>' : ''}</span>
            ${!extension && interactions.has(original.number) ? '<i aria-label="有互动"></i>' : ''}</button>`).join('')}</nav>
        <div class="prep-slide">
          ${page && !supplement && memoriesFor(page).length ? `<aside class="page-memory"><b>🧠 往届误区</b><p>${e(memoriesFor(page).map(memoryText).join("；"))}</p></aside>` : ''}
          <div class="prep-slide-view">
            <div class="prep-slide-toolbar"><h3>16:9 讲台预览</h3>
              ${lesson ? `<button class="plain-button" type="button" data-preview-activity aria-pressed="${showActivity}">预览页内互动</button>` : ''}
            </div>
            <div class="native-canvas prep-slide-stage" data-surface-role="teacher"><div class="native-layout${showActivity ? ' has-inline-interaction' : ''}">
              <div data-native-slide data-page-preview></div>
              ${lesson ? `<aside class="native-inline" data-inline-widget ${showActivity ? '' : 'hidden'} aria-label="本页互动预览">
                <div class="inline-content">
                  <header class="inline-heading"><span>${e(labels[lesson.activityId] ?? '互动题')}</span><b>首轮 · R1</b></header>
                  <p class="inline-prompt">${renderRichMathHtml(lesson.prompt)}</p>
                  <div data-module-preview>${moduleHtml(lesson, {phase:'collect',round:1,responses:[]})}</div>
                  ${lesson.activityId === 'step-fault@1' ? '' : '<div class="inline-choice-list">' + lesson.options.map(option =>
                    `<div><b>${e(option.id)}</b> ${renderRichMathHtml(option.label)}</div>`).join('') + '</div>'}
                </div>
              </aside>` : ''}
            </div></div>
          </div>
          ${page && !supplement ? `<details class="prep-options" open><summary>${lesson ? '本页互动 · ' + e(labels[lesson.activityId] ?? '互动题') : '给本页添加互动'}</summary>
            <label>互动类型<select data-swap ${busy ? 'disabled' : ''}><option value="">无互动</option>
              ${MODULE_MANIFESTS.map(item => `<option value="${item.id}" ${lesson?.activityId === item.id ? 'selected' : ''}>${e(labels[item.id])}</option>`).join('')}
            </select></label>
            ${lesson ? `<p class="prep-activity-prompt">${renderRichMathHtml(lesson.prompt)}</p>` : ''}
          </details>` : ''}
          ${page ? '<div data-page-editor></div>' : ''}
        </div>
      </div>
    </section>`;
  }

  function previewFrame({page, supplement}) {
    const frame = supplement ?? page, index = workspace.index;
    try {
      const compiled = lectureFrame(workspace.result?.lectureScore ?? buildLectureScore(workspace.material), index);
      if (compiled) return compiled;
    } catch { /* A preliminary import can still be reviewed before publishing it. */ }
    return {...frame, body: frame.body ?? frame.text?.split(/\r?\n/u) ?? [],
      blocks: frame.nativeBlocks ?? frame.blocks, pageNumber: page.number, source: {name: workspace.material.name}};
  }

  function mountPreview(entry, lesson) {
    const slot = root.querySelector('[data-page-preview]');
    const widget = root.querySelector('.prep-slide-stage [data-inline-widget]');
    const stage = slot.closest('.prep-slide-stage');
    const layout = slot.parentElement;
    const toggle = root.querySelector('[data-preview-activity]');
    const key = slideKey(entry);
    const total = previewEntries().length;
    let frame = previewFrame(entry), disposeModule;
    const fit = () => {
      fitLectureSlide(slot);
      if (widget && !widget.hidden) {
        const style = getComputedStyle(widget);
        const height = widget.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 4;
        fitPresentationContent(widget.querySelector('.inline-content'), height);
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(slot);
    slot.addEventListener('load', fit, true);
    function render(draft = contentDrafts.get(key)) {
      let preview = frame;
      if (draft) {
        try {
          const {title, blocks, archetype, text} = normalizeEditedSlide({...draft, title: draft.title.trim() || frame.title});
          preview = {...frame, title, blocks, archetype, body: text.split(/\r\n?|\n/u)};
        } catch (error) {
          return error.message;
        }
      }
      renderLectureFrame(slot, preview, {index: workspace.index, total});
      if (lesson?.activityId === 'step-fault@1' && !widget.hidden) {
        const code = slot.querySelector('.slide-code');
        const artifact = widget.querySelector('.module-artifact');
        if (code && artifact) {
          const copy = artifact.cloneNode(true);
          code.hidden = true;
          copy.hidden = false;
          copy.dataset.inlineStepArtifact = '';
          code.after(copy);
        }
        if (artifact) artifact.hidden = Boolean(code);
      }
      fit();
    }
    if (widget) {
      const bind = () => bindModule(widget.querySelector('[data-module-preview]'), lesson);
      if (!widget.hidden) disposeModule = bind();
      toggle.onclick = () => {
        const showing = activityPreviews.has(key);
        if (showing) activityPreviews.delete(key);
        else activityPreviews.add(key);
        widget.hidden = showing;
        layout.classList.toggle('has-inline-interaction', !showing);
        toggle.setAttribute('aria-pressed', String(!showing));
        if (showing) disposeModule?.();
        else disposeModule = bind();
        render();
      };
    }
    if (render()) render(null);
    paintFrame = (current, {reread = false} = {}) => {
      if (!current || slideKey(current) !== key || !stage.isConnected) return;
      if (reread) frame = previewFrame(current);
      return render();
    };
    return () => {
      disposeModule?.();
      observer.disconnect();
      slot.removeEventListener('load', fit, true);
      paintFrame = undefined;
    };
  }

  function paint() {
    disposePreview?.();
    disposePreview = undefined;
    disposeEditor?.();
    disposeEditor = undefined;
    const { material } = workspace;
    const previousList = paintedMaterial === material && root.querySelector('.prep-page-list');
    const listPosition = previousList ? { left: previousList.scrollLeft, top: previousList.scrollTop } : null;
    paintedMaterial = material;
    root.innerHTML = `<section class="prep-workspace v3-home"><header class="v3-page-heading"><div><h1>双源备课，同页共演。</h1><p>让原稿脉络与全班的思考，在同一页相遇。</p></div></header>
      <div class="prep-work-status"><p class="prep-progress" data-prep-progress role="status"></p>
        ${activeWork ? '<button type="button" class="plain-button" data-cancel-authoring>取消编排</button>' : ''}</div>
      ${failure && failure !== workspace.unfinishedRun?.error ? `<p class="shell-entry-error" role="alert">${e(failure)}</p>` : ''}
      <div data-agent-failure-slot></div>
      <div class="v4-author-grid">
        <div class="v4-source-column"><div data-agent-preview-slot></div>${startScreen()}${library()}</div>
        <aside class="v3-harness" data-harness-panel><div data-harness-heading>${harnessHeading()}</div>
          <section class="harness-tool-trace" data-agent-tools aria-label="Agent 工具调用轨迹"></section>
          <div data-harness-status>${pipeline()}</div>
        </aside>
      </div>
      ${material ? previewScreen() : ''}
      <input type="file" accept=".ppt,.pptx,.pdf,.json,.md,.txt" data-file hidden>
      <dialog class="overlay-dialog" data-paste-dialog aria-labelledby="paste-title"><form class="prep-form">
        <h2 id="paste-title">粘贴 Markdown / 多页讲义</h2><p class="prep-note">可用 --- 或 ## 自动分页，支持代码、表格与公式。</p>
        <label>标题<input name="title" maxlength="100" required></label>
        <label>讲义正文<textarea name="text" rows="6" required></textarea></label>
        <div class="prep-entry-actions"><button type="submit" class="action-primary">预览讲义</button><button type="button" class="plain-button" data-cancel>取消</button></div>
      </form></dialog></section>`;
    if (material) {
      const entry = previewEntries()[workspace.index];
      if (entry) {
        const { page, supplement } = entry;
        const key = slideKey(entry);
        const lesson = supplement ? null : workspace.result?.lectureScore.pages.find(item => item.number === page.number)?.interaction;
        disposePreview = mountPreview(entry, lesson);
        if (!busy) {
          disposeEditor = renderPageEditor(root.querySelector('[data-page-editor]'), {
            page: supplement ?? page, pageNumber: page.number, lesson, esc: e, visualOnly: Boolean(supplement),
            searchMedia: ctx.searchMedia,
            slideDraft: contentDrafts.get(key),
            onSlidePreview: draft => { contentDrafts.set(key, draft); return paintFrame?.(entry); },
            onSaveSlide: content => updateSlide(entry, {content}),
            onReviseSlide: ctx.reviseSlide,
            onVisualChange: visuals => updateSlide(entry, {visuals}),
            onRegenerate: payload => ctx.regeneratePage({...payload, page:{...payload.page, pageMemories:memoriesFor(page)}}),
            onSave: ({lesson, speakerNotes}) => {
              page.speakerNotes = speakerNotes;
              updateLesson(page, lesson);
              workspace.message = '本页已通过契约、引文与双轮预演验证，修改已保存。';
              paint();
            },
          });
        }
      }
    }
    streamStamp = traceStamp = failuresStamp = undefined;
    refreshAgentTools();
    wire();
    if (listPosition) root.querySelector('.prep-page-list')?.scrollTo(listPosition);
  }

  async function importFile(file) {
    await task('正在读取课件…', async () => {
      const extension = file.name.split('.').at(-1).toLowerCase();
      if (extension === 'json') {
        if (file.size > 64 * 1024 * 1024) throw new Error('课件超过 64 MB。');
        const lectureScore = validateLectureScore(JSON.parse(await file.text()));
        for (const { interaction } of lectureScore.pages) if (interaction) dryRunLesson(interaction);
        const versionId = await makeMaterialVersionId({ bytes: JSON.stringify(lectureScore) });
        lectureScore.source.versionId = versionId;
        showMaterial(materialFromScore(lectureScore, versionId), { lectureScore, source: 'json-import' });
        return;
      }
      if (['md','txt'].includes(extension)) {
        const content=await file.text();
        const material=parseMarkdownDeck(file.name.replace(/\.[^.]+$/,''),content);
        material.versionId=await makeMaterialVersionId({bytes:content});showMaterial(material);return;
      }
      if (!['ppt', 'pptx', 'pdf'].includes(extension)) throw new Error('请选择 PPT、PPTX、PDF、Markdown、TXT 或共演课件。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const versionId = await makeMaterialVersionId({ bytes });
      let data;
      if (ctx.mode === 'server' && (extension !== 'pptx' || ctx.materialRendering)) {
        try { data = await ctx.importMaterial(file); }
        catch (error) { if (extension === 'pdf') throw error; }
      }
      if (extension === 'pptx') {
        try { data = mergePptxSources(data, await readPptx(file)); }
        catch (error) { if (!data) throw error; }
      }
      if (!data && extension === 'ppt') data = await readLegacySlides(bytes);
      if (!data) throw new Error('PDF 导入需要课堂服务。也可以粘贴讲义继续备课。');
      showMaterial({ ...data, name: file.name, title: data.title || file.name, type: extension, versionId },
        null, data.warnings?.join(' ') ?? '');
    });
  }

  function updateLesson(page, id) {
    const { material, result } = workspace;
    let next = id && typeof id === 'object' ? id : id ? createPageModule(page, id) : null;
    if(typeof id === 'string' && id && next.activityId!==id){
      const sample=structuredClone(universalLessons.find(item=>item.activityId===id));
      next=normalizeEditedLesson(page,{...next,activityId:id,moduleConfig:sample.moduleConfig,options:sample.options,correctOptionId:sample.correctOptionId,quickReasons:sample.quickReasons,takeaway:sample.takeaway});
    }
    const map = pageInteractions(result);
    if (next) {
      dryRunLesson(next);
      map.set(page.number, next);
    } else {
      map.delete(page.number);
    }
    workspace.result = {
      ...result,
      lectureScore: buildLectureScore(material, adoptedSlides(result), { title: result?.lectureScore.title, interactionsByPage: map }),
    };
    if (typeof id === 'string' && next && next.activityId !== id) workspace.message = '本页内容适合先用概念题检查理解。';
    persist();
  }

  function updateSlide(entry, {content, visuals}) {
    const { material, result } = workspace;
    const { page, supplement, supplementIndex } = entry;
    const original = supplement ?? page;
    const changes = {...visuals};
    const interactions = pageInteractions(result);
    if (content) {
      const editableBlocks = original.nativeBlocks ?? original.blocks ?? [];
      const sameBlocks = JSON.stringify(editableBlocks) === JSON.stringify(content.blocks);
      const originalText = original.text ?? original.body?.join('\n') ?? '';
      const text = sameBlocks && content.blocks.length ? originalText || content.text : content.text;
      const sourceExcerpt = lectureSourceExcerpt(original);
      Object.assign(changes, content, {text, sourceExcerpt, nativeBlocks: undefined});
      if (supplement) changes.body = text.split(/\r\n?|\n/u);
      if (!supplement && (text !== originalText || !text && content.title !== original.title)) {
        const lesson = reanchorEditedLesson({...page, ...changes}, interactions.get(page.number));
        if (lesson) interactions.set(page.number, lesson);
      }
    }
    const adopted = adoptedSlides(result);
    let nextMaterial = material;
    if (supplementIndex !== undefined) {
      const slides = adopted.get(page.number).slides.map((slide, index) => index === supplementIndex ? { ...slide, ...changes } : slide);
      adopted.set(page.number, { slides });
    } else {
      nextMaterial = { ...material, pages: material.pages.map(item => item === page ? { ...item, ...changes } : item) };
    }
    const lectureScore = buildLectureScore(nextMaterial, adopted, {
      title: result?.lectureScore.title, interactionsByPage: interactions,
    });
    if (supplementIndex === undefined) {
      Object.assign(page, changes);
      if (visuals) workspace.visualEdits = {...workspace.visualEdits, [page.number]: visuals};
      if (content) workspace.contentEdits = {...workspace.contentEdits, [page.number]: changes};
    }
    if (content) {
      contentDrafts.delete(slideKey(entry));
      const title = root.querySelector('[data-page][aria-current=page] [data-prep-page-title]');
      if (title) title.innerHTML = renderRichMathHtml(content.title);
    }
    workspace.result = { ...result, lectureScore };
    paintFrame?.(previewEntries()[workspace.index], {reread: true});
    return persist(false).catch(() => { throw Error('本页预览已更新，浏览器保存草稿失败。请重试保存。'); });
  }

  async function runAuthoring(plan, signal, { resume = false, pageNumbers } = {}) {
    const previous = resume ? retryTarget()?.result : null;
    const inPlace = previous && previous === workspace.result && workspace.material?.versionId;
    const current = inPlace ? previewEntries()[workspace.index] : null;
    const options = {
      signal, onStage: progress,
      ...(previous?.retry && { retry: { ...previous.retry, lectureScore: previous.lectureScore, pageNumbers } }),
    };
    const { kind, settings, adaptationMode } = plan;
    try {
      let original, result;
      if (kind === 'adapt') {
        await pendingSave;
        original = plan.material ?? await notebook.getVersion(plan.sourceVersionId);
        signal.throwIfAborted();
        if (!original) throw Error('找不到原稿版本，请重新导入原稿。');
        result = await ctx.adaptMaterial(original, { ...settings, adaptationMode, ...options });
      } else {
        result = await ctx.authorDeck(plan.spec, options);
      }
      signal.throwIfAborted();
      const score = result.lectureScore;
      if (!score) {
        workspace.unfinishedRun = { plan, result };
        receipt = result.harnessReceipt;
        return;
      }
      const nextRetry = result.retry ? plan : null;
      if (original && original.versionId === workspace.material?.versionId &&
          (adaptationMode === 'preserve' || (adaptationMode === 'enhance' && !result.harnessReceipt?.adaptedPages?.length))) {
        Object.assign(workspace, { result, retryPlan: nextRetry, unfinishedRun: null, message: result.generationNote ?? '' });
        receipt = result.harnessReceipt;
        persist();
        return;
      }
      const previousPages = previous?.lectureScore?.pages;
      const samePageSet = inPlace && previousPages?.length === score.pages.length &&
        previousPages.every((page, index) => page.number === score.pages[index].number);
      let versionId = samePageSet ? inPlace : (original ? score.source.versionId : result.harnessReceipt?.contentDigest);
      if (!/^sha256-[a-f0-9]{64}$/u.test(versionId ?? '') ||
          (!samePageSet && (versionId === original?.versionId || versionId === inPlace))) {
        versionId = await makeMaterialVersionId({ bytes: JSON.stringify(original ? [adaptationMode, score] : score) });
      }
      signal.throwIfAborted();
      const derivative = adaptationMode === 'enhance'
        ? { name: score.source.name, title: score.title, type: score.source.kind, versionId, pages: original.pages }
        : materialFromScore(score, versionId);
      const lectureScore = { ...score, source: { ...score.source, versionId } };
      showMaterial(derivative, { ...result, lectureScore }, result.generationNote, nextRetry);
      if (current) workspace.index = Math.max(0, previewEntries().findIndex(entry => slideKey(entry) === slideKey(current)));
    } catch (error) {
      signal.throwIfAborted();
      workspace.unfinishedRun = { plan, result: previous, error: redactProviderError(error) };
      receipt = previous?.harnessReceipt ?? null;
      throw error;
    }
  }

  function wireLibrary() {
    root.querySelectorAll('[data-open-version]').forEach(button=>button.onclick=()=>void task('正在打开备课版本…',()=>openVersion(button.dataset.openVersion)));
    root.querySelectorAll('[data-delete-version]').forEach(button=>button.onclick=()=>void task('正在删除备课版本…',async()=>{await pendingSave;await notebook.deleteVersion(button.dataset.deleteVersion);if(recent?.versionId===button.dataset.deleteVersion)recent=null;await refreshLibrary(false);}));
    const resume = root.querySelector('[data-resume-draft]');
    if (resume) resume.onclick = () => void task('正在打开上次备课…', () => openVersion(recent.versionId));
  }

  function wire() {
    wireLibrary();
    root.querySelectorAll('[data-receipt]').forEach(button=>button.onclick=()=>{const dialog=ctx.configureReceipt?.();if(dialog)return;const d=document.createElement('dialog');d.className='overlay-dialog';d.innerHTML='<h2>护栏自修回执</h2><pre>'+e(JSON.stringify(workspace.result?.harnessReceipt ?? receipt,null,2))+'</pre><button type="button">关闭</button>';root.append(d);d.querySelector('button').onclick=()=>d.remove();d.addEventListener('cancel',()=>d.remove());d.showModal();});
    const click = (selector, action) => root.querySelector(selector)?.addEventListener('click', action);
    click('[data-agent-preview-slot]', event => {
      const button = event.target.closest('[data-agent-preview-page]');
      if (!button) return;
      streamPage = Number(button.dataset.agentPreviewPage);
      refreshAgentTools();
      root.querySelector(`[data-agent-preview-page="${streamPage}"]`)?.focus({ preventScroll: true });
    });
    click('[data-agent-failure-slot]', event => {
      const button = event.target.closest('[data-retry-failed], [data-retry-range]');
      const target = retryTarget();
      if (!button || button.disabled || !target) return;
      const pageNumbers = button.dataset.retryRange?.split(',').map(Number);
      void task('正在重试编排…', signal => runAuthoring(target.plan, signal, { resume: true, pageNumbers }), {
        cancellable: true, restoreFocus: '[data-retry-failed]',
      });
    });
    click('[data-cancel-authoring]', event => {
      event.currentTarget.disabled = true;
      activeWork?.abort();
      announce('正在取消编排…');
    });
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
      const { course, topic } = author.elements;
      workspace.spec = { course: course.value, topic: topic.value, ...readSettings(author) };
    };
    author?.addEventListener('input', saveSpec);
    author?.addEventListener('submit', event => {
      event.preventDefault();
      saveSpec();
      const plan = { kind: 'native', spec: { ...workspace.spec } };
      void task('正在生成课件…', signal => runAuthoring(plan, signal), {
        cancellable: true, restoreFocus: '[data-author-form] button[type=submit]',
      });
    });
    const adaptation = root.querySelector('[data-adapt-material]');
    adaptation?.addEventListener('input', () => { workspace.adaptation = readSettings(adaptation); });
    adaptation?.addEventListener('submit', event => {
      event.preventDefault();
      const mode = event.submitter?.value ?? 'preserve';
      workspace.adaptation = readSettings(adaptation);
      const plan = {
        kind: 'adapt', adaptationMode: mode, settings: { ...workspace.adaptation },
        material: workspace.material, sourceVersionId: workspace.material.versionId,
      };
      void task('正在编排原稿…', signal => runAuthoring(plan, signal), {
        cancellable: true, restoreFocus: `[data-adaptation-mode="${mode}"]`,
      });
    });
    root.querySelectorAll('[data-page]').forEach(button => button.onclick = () => {
      workspace.index = Number(button.dataset.page);
      const versionId = workspace.material.versionId;
      const pageNumber = previewEntries()[workspace.index].page.number;
      void pendingSave.then(() => notebook.setLastPage(versionId, pageNumber)).catch(() => {});
      paint();
      root.querySelector(`[data-page="${workspace.index}"]`)?.focus({ preventScroll: true });
    });
    root.querySelector('[data-swap]')?.addEventListener('change', event => {
      try {
        const current = previewEntries()[workspace.index].page;
        current.speakerNotes=root.querySelector('[data-speaker-notes]')?.value ?? current.speakerNotes;
        updateLesson(current, event.target.value);
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
      Object.assign(workspace, {
        material: null, result: null, index: 0, mode: 'import', message: '', retryPlan: null, unfinishedRun: null,
        visualEdits: {}, contentEdits: {},
      });
      contentDrafts.clear();
      activityPreviews.clear();
      receipt = null;
      failure = '';
      paint();
    });
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
        showMaterial({ ...parseMarkdownDeck(title,text), versionId });
      });
    };
  }

  paint();
  void refreshLibrary().catch(()=>{});
  if(returnTarget?.versionId)void task('正在打开对应原页…',()=>openVersion(returnTarget.versionId,returnTarget.pageNumber));
  return () => {
    stopped = true;
    activeWork?.abort();
    disposePreview?.();
    disposeEditor?.();
  };
}
