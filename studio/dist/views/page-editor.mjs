import { compileExpression } from '../core/safe-expr.mjs';
import { validateModulePayload } from '../core/activities.mjs';
import { validateHarnessLesson, dryRunLesson, numberEvidence } from '../core/deck-harness.mjs';
import {
  blockText, isEmbeddedLectureImage, LECTURE_ARCHETYPES, LECTURE_LAYOUTS,
  normalizeSlideArchetype, validateSlideBlocks,
} from '../core/lecture-score.mjs';
import { renderRichMathHtml, validateMathSource } from '../core/math-render.mjs';

const layoutLabels = Object.freeze({
  auto: '自动排版',
  single: '单栏聚焦',
  'split-right': '左文右图',
  'split-left': '左图右文',
  'media-top': '上图下文',
  'diagram-focus': '示意图聚焦',
});

const archetypeLabels = {
  cover: '封面', section: '章节过渡', derivation: '公式推导',
  'split-compare': '并列对比', example: '例题讲解', summary: '课末总结',
};
const blockLabels = {
  bullets: '要点', steps: '步骤', formula: '公式', callout: '提示',
  code: '代码', table: '表格', diagram: '示意图', chart: '图表',
  'code-pair': '双栏代码', 'stat-grid': '统计区块',
};
const blockDefaults = {
  bullets: { items: [''] }, steps: { items: [''] }, formula: { items: [''] },
  callout: { text: '', tone: 'note' }, code: { code: '', language: 'c' },
  table: { headers: ['', ''], rows: [['', '']] },
};
const toneLabels = { note: '说明', warning: '提醒', success: '结论' };
const mediaSourceLabels = { commons: 'Wikimedia Commons', wikipedia: 'Wikipedia', openverse: 'Openverse', downloads: '图片下载' };
const mediaStatusLabels = {
  ok: '有结果', no_hits: '无匹配图片', network_blocked: '连接受限', rate_limited: '请求受限',
  unverified: '图片未通过校验', unavailable: '图片不可用', skipped: '未检索', upstream_error: '服务异常',
};

export function normalizeEditedSlide({ title, blocks, archetype, text = '' }) {
  title = typeof title === 'string' ? title.trim() : '';
  if (!title) throw Error('请填写本页标题。');
  if (!Array.isArray(blocks)) throw Error('本页正文须由结构化区块组成。');
  const checked = validateSlideBlocks(blocks);
  if (!checked.length && typeof text !== 'string') throw Error('本页正文须为文本。');
  return {
    title, blocks: checked, archetype: normalizeSlideArchetype(archetype === '' ? undefined : archetype),
    text: (checked.length ? checked.map(blockText).filter(Boolean).join('\n') : text).trim(),
  };
}

export function reanchorEditedLesson(page, input) {
  if (!input?.sourceEvidence?.length) return input;
  const lesson = structuredClone(input);
  const blocks = numberEvidence(page.text || page.title);
  const remapped = new Map();
  function missing(id) {
    return Error(`本页改动影响了互动引文（${id}）。请保留引用文字，或先调整「本页互动」再保存讲义。`);
  }
  lesson.sourceEvidence = lesson.sourceEvidence.map(({id, quote}) => {
    const matches = blocks.filter(block => block.text.includes(quote));
    const match = matches.find(block => block.id === id) ?? (matches.length === 1 ? matches[0] : null);
    if (!match || (remapped.has(id) && remapped.get(id) !== match.id)) throw missing(id);
    remapped.set(id, match.id);
    return {id: match.id, quote};
  });
  function move(ids) {
    if (!Array.isArray(ids)) throw missing('证据编号');
    return [...new Set(ids.map(id => {
      if (!remapped.has(id)) throw missing(id);
      return remapped.get(id);
    }))];
  }
  lesson.evidenceIds = move(lesson.evidenceIds);
  lesson.branches.forEach(branch => { branch.evidenceIds = move(branch.evidenceIds); });
  const checked = validateHarnessLesson(lesson, {...page, blocks});
  dryRunLesson(checked);
  return checked;
}

export function normalizeEditedLesson(page, input) {
  const lesson = structuredClone(input), config = lesson.moduleConfig;
  const text = page.text || page.blocks?.map(blockText).join('\n') || page.title;
  const blocks = numberEvidence(text);
  const refs = blocks.slice(0,6).map(b=>({id:b.id,quote:b.text.slice(0,160)}));
  lesson.evidenceIds = refs.map(r=>r.id); lesson.sourceEvidence = refs;
  lesson.quickReasons = config.quickReasons = (lesson.quickReasons ?? config.quickReasons).map(s=>s.trim()).filter(Boolean);
  if (lesson.quickReasons.length < 1 || lesson.quickReasons.length > 12) throw Error('快速理由须为 1–12 条。');
  const takeaway = {...(lesson.takeaway ?? config.takeaway)};
  takeaway.summary = takeaway.summary?.trim() || `本页要点：${page.title}`;
  takeaway.pitfall = takeaway.pitfall?.trim() || '请核对本页条件与证据，避免跳过推理步骤。';
  if (!takeaway.formula?.trim()) delete takeaway.formula;
  lesson.takeaway = config.takeaway = takeaway;
  lesson.branches = lesson.branches.map(b=>({...b,evidenceIds:[...lesson.evidenceIds]}));
  if (lesson.activityId === 'step-fault@1') {
    lesson.options = config.steps.map(step=>({id:step.id,label:`第 ${step.line} 步：${step.content}`.slice(0,500)}));
    lesson.correctOptionId = config.faultStepId;
  }
  if (lesson.activityId === 'evidence-weighing@1') lesson.correctOptionId = null;
  const checked = validateHarnessLesson(lesson,{...page,blocks});
  dryRunLesson(checked); return checked;
}

export function inspectParamConfig(config) {
  validateModulePayload('param-explorer@1',config);
  const variables = [config.xAxis.symbol,...config.sliders.map(s=>s.symbol)];
  const corners = Array.from({length:2**config.sliders.length},(_,mask)=>Object.fromEntries(config.sliders.map((s,i)=>[s.symbol,mask & 1<<i ? s.max : s.min])));
  const defaults = Object.fromEntries(config.sliders.map(s=>[s.symbol,s.defaultValue]));
  const series = config.curves.map(curve=>{
    const compiled=compileExpression(curve.expr,variables);
    const f=values=>compiled.evaluate(values);
    for(const parameters of [...corners,defaults]) for(let i=0;i<=64;i++) {
      const x=config.xAxis.min+(config.xAxis.max-config.xAxis.min)*i/64;
      if(!Number.isFinite(f({...parameters,[config.xAxis.symbol]:x})))throw Error('滑块端点采样出现非有限值。');
    }
    return Array.from({length:65},(_,i)=>{
      const x=config.xAxis.min+(config.xAxis.max-config.xAxis.min)*i/64;
      return [x,f({...defaults,[config.xAxis.symbol]:x})];
    });
  });
  return {corners:corners.length,series};
}

function renderSlideEditor(root, {page, pageNumber, slideDraft, esc:e, onSlidePreview, onSaveSlide, onReviseSlide}) {
  const blocks = page.nativeBlocks ?? page.blocks ?? [];
  const draft = slideDraft ?? {
    title: page.title, archetype: page.archetype, blocks: structuredClone(blocks),
    text: blocks.length ? '' : page.text ?? page.body?.join('\n') ?? '',
  };
  let revision = 0, saving = false, request;
  root.innerHTML = `<form class="slide-editor" data-slide-editor aria-label="编辑本页讲义">
    <div class="slide-editor-fields">
      <label>本页标题<input data-page-title value="${e(draft.title)}" required maxlength="500"></label>
      <label>页面视觉原型<select data-page-archetype><option value="">自动推断</option>
        ${LECTURE_ARCHETYPES.map(value => `<option value="${value}" ${value === draft.archetype ? 'selected' : ''}>${archetypeLabels[value]}</option>`).join('')}
      </select></label>
    </div>
    <div class="slide-editor-blocks" data-blocks></div>
    <div class="slide-editor-add">
      <label>区块类型<select data-block-type>${Object.keys(blockDefaults).map(type => `<option value="${type}">${blockLabels[type]}</option>`).join('')}</select></label>
      <button type="button" data-add-block>添加区块</button>
    </div>
    ${onReviseSlide ? `<div class="editor-ai">
      <label>✨ 一句话 AI 改写本页讲义<input data-revise-instruction maxlength="2000" placeholder="例如：先交代成立条件，再用一个公式概括结论"></label>
      <button type="button" data-revise-slide>改写本页</button>
    </div>` : ''}
    <div class="slide-editor-actions">
      <button type="submit" class="action-primary" data-save-slide>保存讲义</button>
      <p data-slide-status role="status">${slideDraft ? '预览中的修改尚未保存。' : ''}</p>
    </div>
  </form>`;
  const form = root.firstElementChild;
  const blockHost = form.querySelector('[data-blocks]');
  const title = form.querySelector('[data-page-title]');
  const archetype = form.querySelector('[data-page-archetype]');
  const addBlock = form.querySelector('[data-add-block]');
  const blockType = form.querySelector('[data-block-type]');
  const status = form.querySelector('[data-slide-status]');
  const save = form.querySelector('[data-save-slide]');
  const revise = form.querySelector('[data-revise-slide]');
  const instruction = form.querySelector('[data-revise-instruction]');

  function tableFields(block) {
    const label = (name, value, attributes) =>
      `<input aria-label="${e(name)}" value="${e(value)}" maxlength="16000" ${attributes}>`;
    return `<div class="slide-editor-table"><table><thead><tr>${block.headers.map((value, col) =>
      `<th scope="col">${label(`第 ${col + 1} 列表头`, value, `data-table-header="${col}"`)}</th>`).join('')}<th scope="col">行操作</th>
      </tr></thead><tbody>${block.rows.map((row, rowIndex) => `<tr>${row.map((value, col) =>
        `<td>${label(`第 ${rowIndex + 1} 行第 ${col + 1} 列`, value, `data-table-cell="${col}" data-table-row="${rowIndex}"`)}</td>`).join('')}
        <td><button type="button" data-remove-table-row="${rowIndex}" aria-label="删除第 ${rowIndex + 1} 行">删除</button></td>
      </tr>`).join('')}</tbody></table></div>
      <div class="slide-editor-block-tools">
        <button type="button" data-add-table-row ${block.rows.length >= 40 ? 'disabled' : ''}>加一行</button>
        <button type="button" data-add-table-column ${block.headers.length >= 8 ? 'disabled' : ''}>加一列</button>
        <button type="button" data-remove-table-column ${block.headers.length <= 1 ? 'disabled' : ''}>删除末列</button>
      </div>`;
  }

  function editFields(block) {
    if (['bullets','steps','formula'].includes(block.type)) {
      const formula = block.type === 'formula';
      return `${block.items.map((value, i) => `<div class="slide-editor-item">
        <label>${formula ? '公式' : '条目'} ${i + 1}<textarea rows="${formula ? 2 : 1}" maxlength="16000" ${formula ? 'spellcheck="false"' : ''} data-block-item="${i}">${e(value)}</textarea></label>
        <button type="button" data-remove-block-item="${i}" aria-label="删除第 ${i + 1} 项">删除</button>
        ${formula ? `<div class="slide-editor-math" data-live-formula="${i}" hidden></div>` : ''}
      </div>`).join('')}
      <div class="slide-editor-block-tools"><button type="button" data-add-block-item ${block.items.length >= 80 ? 'disabled' : ''}>${formula ? '添加公式' : '添加条目'}</button></div>`;
    }
    if (block.type === 'code') return `<label>语言<input data-block-field="language" maxlength="16000" value="${e(block.language)}"></label>
      <label>代码<textarea class="slide-editor-code" data-block-field="code" rows="5" maxlength="16000" spellcheck="false">${e(block.code)}</textarea></label>`;
    if (block.type === 'callout') return `<label>提示类型<select data-block-field="tone">${Object.entries(toneLabels).map(([value, label]) =>
      `<option value="${value}" ${value === block.tone ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label>提示正文<textarea data-block-field="text" rows="3" maxlength="16000">${e(block.text)}</textarea></label>`;
    if (block.type === 'table') return tableFields(block);
    return '';
  }

  function paintFormula(host) {
    const block = draft.blocks[Number(host.closest('[data-edit-block]').dataset.editBlock)];
    const item = block.items[Number(host.dataset.liveFormula)];
    host.hidden = !item.trim();
    if (host.hidden) return;
    const result = validateMathSource(item, {block: true});
    host.innerHTML = renderRichMathHtml(item, {block: true}) + (result.ok ? '' :
      `<small class="slide-editor-math-error">${e(result.errors[0]?.message ?? '该公式无法排版。')}</small>`);
  }

  function paintBlocks() {
    blockHost.innerHTML = draft.blocks.map((block, index) => `<fieldset data-edit-block="${index}">
      <legend>${index + 1}. ${blockLabels[block.type]}</legend>
      <div class="slide-editor-block-heading">
        <label>区块标题<input data-block-field="title" maxlength="16000" value="${e(block.title ?? '')}"></label>
        <button type="button" data-remove-block aria-label="删除区块 ${index + 1}">删除区块</button>
      </div>
      ${editFields(block)}
    </fieldset>`).join('') || `<label>正文<textarea rows="3" data-slide-plain>${e(draft.text)}</textarea></label>`;
    addBlock.disabled = draft.blocks.length >= 16;
    blockHost.querySelectorAll('[data-live-formula]').forEach(paintFormula);
  }

  function changed(message = '预览中的修改尚未保存。') {
    revision++;
    status.textContent = onSlidePreview(draft) || message;
  }

  form.oninput = ({target}) => {
    if (target === instruction || target === blockType) return;
    if (target === title) draft.title = target.value;
    else if (target === archetype) draft.archetype = target.value || undefined;
    else if (target.matches('[data-slide-plain]')) draft.text = target.value;
    else {
      const group = target.closest('[data-edit-block]');
      if (!group) return;
      const block = draft.blocks[Number(group.dataset.editBlock)], data = target.dataset;
      if (data.blockField) block[data.blockField] = target.value;
      if (data.blockItem !== undefined) {
        block.items[Number(data.blockItem)] = target.value;
        const formula = target.closest('.slide-editor-item').querySelector('[data-live-formula]');
        if (formula) paintFormula(formula);
      }
      if (data.tableHeader !== undefined) block.headers[Number(data.tableHeader)] = target.value;
      if (data.tableCell !== undefined) block.rows[Number(data.tableRow)][Number(data.tableCell)] = target.value;
    }
    changed();
  };
  addBlock.onclick = () => {
    if (addBlock.disabled || !Object.hasOwn(blockDefaults, blockType.value)) return;
    draft.blocks.push({type: blockType.value, title: '', ...structuredClone(blockDefaults[blockType.value])});
    paintBlocks();
    blockHost.lastElementChild.querySelector('[data-block-field=title]').focus();
    changed();
  };
  blockHost.onclick = event => {
    const button = event.target.closest('button');
    const group = button?.closest('[data-edit-block]');
    if (!group || button.disabled) return;
    const index = Number(group.dataset.editBlock), block = draft.blocks[index], data = button.dataset;
    let focus;
    if (button.hasAttribute('data-remove-block')) draft.blocks.splice(index, 1);
    else if (button.hasAttribute('data-add-block-item')) {
      block.items.push('');
      focus = `[data-block-item="${block.items.length - 1}"]`;
    } else if (data.removeBlockItem !== undefined) {
      block.items.splice(Number(data.removeBlockItem), 1);
      focus = '[data-add-block-item]';
    } else if (button.hasAttribute('data-add-table-row')) {
      block.rows.push(block.headers.map(() => ''));
      focus = `[data-table-row="${block.rows.length - 1}"]`;
    } else if (data.removeTableRow !== undefined) {
      block.rows.splice(Number(data.removeTableRow), 1);
      focus = '[data-add-table-row]';
    } else if (button.hasAttribute('data-add-table-column')) {
      block.headers.push('');
      block.rows.forEach(row => row.push(''));
      focus = `[data-table-header="${block.headers.length - 1}"]`;
    } else if (button.hasAttribute('data-remove-table-column')) {
      block.headers.pop();
      block.rows.forEach(row => row.pop());
      focus = '[data-add-table-column]';
    } else return;
    paintBlocks();
    (focus && blockHost.querySelector(`[data-edit-block="${index}"] ${focus}`) || addBlock).focus();
    changed();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (saving) return;
    const startedAt = revision;
    saving = save.disabled = true;
    try {
      await onSaveSlide(normalizeEditedSlide(draft));
      if (form.isConnected && revision === startedAt) status.textContent = '本页讲义已保存。';
    } catch (error) {
      if (form.isConnected && revision === startedAt) status.textContent = error.message;
    } finally {
      saving = save.disabled = false;
    }
  };
  if (revise) revise.onclick = async () => {
    const prompt = instruction.value.trim();
    if (!prompt) { status.textContent = '请填写一句本页改写要求。'; instruction.focus(); return; }
    const startedAt = revision;
    request = new AbortController();
    const { signal } = request;
    revise.disabled = true;
    try {
      const content = normalizeEditedSlide(draft);
      status.textContent = '正在改写本页讲义并检查公式…';
      const result = await onReviseSlide({page: {number: pageNumber, ...content}, instruction: prompt}, {signal});
      if (signal.aborted || !form.isConnected) return;
      if (revision !== startedAt) {
        status.textContent = '你已继续编辑本页，请按当前内容重新发起改写。';
        return;
      }
      const edited = normalizeEditedSlide({...result, archetype: draft.archetype});
      Object.assign(draft, edited, {text: edited.blocks.length ? '' : edited.text});
      title.value = draft.title;
      paintBlocks();
      changed('改写已更新到预览，请核对正文和公式后保存。');
    } catch (error) {
      if (!signal.aborted && form.isConnected && revision === startedAt) status.textContent = error.message;
    } finally {
      request = undefined;
      revise.disabled = false;
    }
  };
  paintBlocks();
  return () => request?.abort();
}

function renderVisualEditor(root, {page, draft, esc:e, searchMedia, onVisualChange}) {
  const hasPreview = isEmbeddedLectureImage(page.preview);
  root.innerHTML = `<div class="editor-visuals">
    <label>版式<select data-page-layout>${LECTURE_LAYOUTS.map(layout =>
      `<option value="${layout}" ${layout === (draft.layout ?? 'auto') ? 'selected' : ''}>${layoutLabels[layout]}</option>`).join('')}</select></label>
    ${searchMedia ? `<form class="editor-media-query" data-media-search>
      <label>配图关键词<input data-media-query name="query" type="search" maxlength="160" required autocomplete="off" placeholder="例如：双缝干涉实验装置" value="${e(draft.query)}"></label>
      <button type="submit">🔍 联网搜图配入本页</button></form>`
    : '<p class="prep-note">离线备课可使用声明式示意图。</p>'}
    <div class="editor-media-list" data-media-candidates></div>
    <div class="editor-media-list" data-page-images></div>
    <p data-media-status role="status"></p>
  </div>`;
  const layoutSelect = root.querySelector('[data-page-layout]');
  const searchForm = root.querySelector('[data-media-search]');
  const candidateList = root.querySelector('[data-media-candidates]');
  const imageList = root.querySelector('[data-page-images]');
  const status = root.querySelector('[data-media-status]');
  let inFlight;

  function apply({layout = draft.layout, images = draft.images} = {}) {
    const saved = onVisualChange({layout, images});
    Object.assign(draft, {layout, images});
    return saved;
  }

  function mediaEntry({src, title, caption, source}, button) {
    const image = isEmbeddedLectureImage(src) ? `<img src="${e(src)}" alt="" loading="lazy" decoding="async">` : '';
    const badge = Object.hasOwn(mediaSourceLabels, source) && mediaSourceLabels[source];
    return `<div class="editor-media-entry">${image}<div><b>${renderRichMathHtml(title)}</b>
      ${badge ? `<span class="editor-media-source">${e(badge)}</span>` : ''}
      ${caption ? `<small>${e(caption)}</small>` : ''}</div>${button}</div>`;
  }

  function paintImages() {
    imageList.innerHTML = draft.images.map((image, index) => {
      if (hasPreview && image?.accompanyPreview !== true) return '';
      const src = image?.cropped ? image.visibleSrc : image?.src;
      if (!isEmbeddedLectureImage(src)) return '';
      return mediaEntry({
        src, title: image.alt || image.name || `本页配图 ${index + 1}`,
        caption: [image.credit, image.license].filter(Boolean).join(' · '), source: image.source,
      }, `<button type="button" data-remove-media="${index}" aria-label="移除本页配图 ${index + 1}">移除</button>`);
    }).join('');
  }

  function paintCandidates() {
    candidateList.innerHTML = draft.candidates.map(({id, preview, title, alt, credit, license, source}) => mediaEntry({
      src: preview, title: title || alt || '图库配图', caption: [credit, license].filter(Boolean).join(' · '), source,
    }, `<button type="button" data-media-candidate="${e(id)}">内嵌本页</button>`)).join('');
  }

  async function request(input, loading, accept) {
    if (inFlight) return;
    const controller = new AbortController();
    inFlight = controller;
    const buttons = [searchForm.querySelector('button'), ...candidateList.querySelectorAll('button')];
    for (const button of buttons) button.disabled = true;
    status.textContent = loading;
    try {
      const result = await searchMedia(input, {signal: controller.signal});
      if (!controller.signal.aborted) {
        const message = await accept(result);
        if (!controller.signal.aborted) status.textContent = message;
      }
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.message || '配图操作失败，请稍后再试。';
    } finally {
      for (const button of buttons) button.disabled = false;
      inFlight = undefined;
    }
  }

  layoutSelect.onchange = async () => {
    try {
      await apply({layout: layoutSelect.value});
      status.textContent = '版式已保存。';
    } catch (error) {
      layoutSelect.value = draft.layout ?? 'auto';
      status.textContent = error.message;
    }
  };
  imageList.onclick = async event => {
    const button = event.target.closest('[data-remove-media]');
    if (!button) return;
    try {
      const index = Number(button.dataset.removeMedia);
      const saved = apply({images: draft.images.filter((_, position) => position !== index)});
      paintImages();
      (imageList.querySelector('button') ?? layoutSelect).focus();
      await saved;
      status.textContent = '已移除本页配图。';
    } catch (error) { status.textContent = error.message; }
  };
  if (searchForm) {
    const query = searchForm.elements.query;
    query.oninput = () => { draft.query = query.value; };
    searchForm.onsubmit = event => {
      event.preventDefault();
      const keyword = query.value.trim();
      if (!keyword) { status.textContent = '请输入配图关键词。'; return; }
      void request({action:'search', query:keyword}, '正在检索开源图库…', result => {
        const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
        draft.candidates = candidates.filter(item => typeof item?.id === 'string').slice(0, 4);
        paintCandidates();
        const message = draft.candidates.length ? `找到 ${draft.candidates.length} 张候选图。` : result?.message || '未找到合适的开源图，可调整关键词或改用示意图。';
        const diagnostics = Object.entries(result?.diagnostics ?? {}).flatMap(([source, detail]) =>
          Object.hasOwn(mediaSourceLabels, source) && Object.hasOwn(mediaStatusLabels, detail?.status)
            ? [`${mediaSourceLabels[source]} ${mediaStatusLabels[detail.status]}`] : []);
        return diagnostics.length ? `${message} ${diagnostics.join('，')}。` : message;
      });
    };
    candidateList.onclick = event => {
      const button = event.target.closest('[data-media-candidate]');
      if (!button) return;
      void request({action:'embed', candidate:{id:button.dataset.mediaCandidate}}, '正在校验并内嵌配图…', async result => {
        const {src, alt, credit, license, source, sourceUrl} = result?.image ?? {};
        if (!isEmbeddedLectureImage(src)) return result?.message || '未能内嵌该图，请选择其他候选。';
        if (draft.images.some(image => image?.src === src && (!hasPreview || image.accompanyPreview))) return '本页已有这张配图。';
        const saved = apply({images:[...draft.images, {src, alt, credit, license, source, sourceUrl, ...(hasPreview && {accompanyPreview: true})}]});
        paintImages();
        await saved;
        return '图片及许可已保存至本页。';
      });
    };
  }
  paintCandidates();
  paintImages();
  return () => inFlight?.abort();
}

export function renderPageEditor(root, {
  page, pageNumber = page.number, lesson, esc:e, onSave, onRegenerate, searchMedia, onVisualChange,
  slideDraft, onSlidePreview, onSaveSlide, onReviseSlide, visualOnly = false,
}) {
  let draft=lesson?structuredClone(lesson):null, notes=page.speakerNotes ?? '';
  const visualDraft = {layout:page.layout, images:[...(page.images ?? [])], candidates:[], query:''};
  let disposed = false;
  root.innerHTML = `<section class="page-editor"><h3>本页可视化精修</h3>
    ${onSaveSlide ? '<div data-editor-slide></div>' : ''}
    ${onVisualChange ? '<div data-editor-visuals></div>' : ''}
    ${visualOnly ? '' : '<div data-editor-interaction></div>'}
  </section>`;
  const disposeSlide = onSaveSlide && renderSlideEditor(root.querySelector('[data-editor-slide]'), {
    page, pageNumber, slideDraft, esc:e, onSlidePreview, onSaveSlide, onReviseSlide,
  });
  const disposeVisuals = onVisualChange && renderVisualEditor(root.querySelector('[data-editor-visuals]'), {
    page, draft:visualDraft, esc:e, searchMedia, onVisualChange,
  });
  const interactionHost = root.querySelector('[data-editor-interaction]');
  if(draft) {draft.quickReasons=structuredClone(draft.quickReasons??draft.moduleConfig.quickReasons);draft.takeaway=structuredClone(draft.takeaway??draft.moduleConfig.takeaway);}
  const at = path=>path.split('.').reduce((v,key)=>v?.[key],draft);
  const field=(label,path,type='text')=>`<label>${e(label)}<input type="${type}" ${type==='number'?'step="any"':''} data-edit="${e(path)}" value="${e(at(path) ?? '')}"></label>`;
  const area=(label,path)=>`<label>${e(label)}<textarea rows="3" data-edit="${e(path)}">${e(at(path) ?? '')}</textarea></label>`;
  function specialized() {
    const c=draft.moduleConfig;
    if(draft.activityId==='step-fault@1')return `<fieldset><legend>步骤与首错步</legend>${field('片段标题','moduleConfig.artifactTitle')}<label>片段类型<select data-edit="moduleConfig.artifactLang">${['code','math','flow'].map(v=>`<option ${v===c.artifactLang?'selected':''}>${v}</option>`).join('')}</select></label>${c.steps.map((step,i)=>`<div class="editor-step"><label><input type="radio" name="fault" data-fault="${e(step.id)}" ${c.faultStepId===step.id?'checked':''}>首错步 ${i+1}</label>${area('步骤内容',`moduleConfig.steps.${i}.content`)}<button type="button" data-remove-step="${i}">删除步骤</button></div>`).join('')}<button type="button" data-add-step>增加步骤</button>${area('错误诊断','moduleConfig.faultDiagnosis')}</fieldset>`;
    if(draft.activityId==='param-explorer@1')return `<fieldset><legend>声明式参数实验</legend>${field('公式显示','moduleConfig.formulaDisplay')}<div class="editor-grid">${['symbol','label','min','max'].map(k=>field('横轴 '+k,'moduleConfig.xAxis.'+k,['min','max'].includes(k)?'number':'text')).join('')}${['label','min','max'].map(k=>field('纵轴 '+k,'moduleConfig.yAxis.'+k,k==='label'?'text':'number')).join('')}</div><h4>滑块范围</h4>${c.sliders.map((s,i)=>`<div class="editor-grid">${['symbol','label','min','max','step','defaultValue'].map(k=>field(k,`moduleConfig.sliders.${i}.${k}`,['symbol','label'].includes(k)?'text':'number')).join('')}</div>`).join('')}<h4>曲线表达式</h4>${c.curves.map((s,i)=>`<div class="editor-grid">${field('曲线名称',`moduleConfig.curves.${i}.label`)}${field('安全表达式 expr',`moduleConfig.curves.${i}.expr`)}</div>`).join('')}${area('观察提示','moduleConfig.insightNote')}<div data-expression-preview aria-live="polite"></div></fieldset>`;
    if(draft.activityId==='evidence-weighing@1')return `<fieldset><legend>维度与 AI 辩友</legend><label>维度列表（每行一项，2–4项）<textarea data-dimensions>${e(c.dimensions.join('\n'))}</textarea></label>${field('persona · 角色','moduleConfig.aiPeer.persona')}${area('claim · 主张','moduleConfig.aiPeer.claim')}${area('flawHint · 质询线索','moduleConfig.aiPeer.flawHint')}</fieldset>`;
    return '';
  }
  function paint() {
    if (!interactionHost) return;
    interactionHost.innerHTML=`<form data-editor-form><label>讲者备注<textarea data-speaker-notes rows="3">${e(notes)}</textarea></label>
      ${draft?`<div class="editor-ai"><label>✨ 一句话 AI 微调本页互动<input data-ai-instruction maxlength="2000" placeholder="例如：保留知识点，增加一个针对常见误区的选项"></label><button type="button" data-ai-regenerate>微调本页</button></div>${field('互动标题','title')}${area('题干 prompt','prompt')}<fieldset><legend>选项与标答</legend>${draft.options.map((o,i)=>`<div class="editor-option">${field('选项 '+o.id,`options.${i}.label`)}<label><input type="radio" name="answer" data-answer="${e(o.id)}" ${draft.correctOptionId===o.id?'checked':''} ${draft.activityId==='step-fault@1'||draft.activityId==='evidence-weighing@1'?'disabled':''}>标答</label></div>`).join('')}</fieldset><label>快速理由 quickReasons（每行一项，1–12项）<textarea rows="3" data-reasons>${e(draft.quickReasons.join('\n'))}</textarea></label>${specialized()}<fieldset><legend>讨论分支</legend>${draft.branches.map((b,i)=>`<div class="editor-branch">${field('分支标题',`branches.${i}.title`)}${area('分支任务',`branches.${i}.description`)}${area('改答提示',`branches.${i}.revisionPrompt`)}</div>`).join('')}</fieldset><fieldset><legend>本页速查 takeaway</legend>${field('公式（可留空）','takeaway.formula')}${area('总结','takeaway.summary')}${area('易错点','takeaway.pitfall')}</fieldset>`:''}
      <button type="submit" class="action-primary">验证并保存本页</button><p data-editor-status role="status"></p></form>
      ${draft?`<details class="prep-options"><summary>原始 JSON 查验</summary><textarea class="v3-json-editor" rows="10" data-raw-json>${e(JSON.stringify(draft,null,2))}</textarea><button type="button" data-save-json>校验并应用 JSON</button></details>`:''}`;
    const status=root.querySelector('[data-editor-status]');
    root.querySelector('[data-editor-form]').oninput=event=>{
      const target=event.target;
      if(target.matches('[data-speaker-notes]')) notes=target.value;
      if(target.dataset.edit){const keys=target.dataset.edit.split('.');const key=keys.pop();const owner=keys.reduce((v,k)=>v[k],draft);owner[key]=target.type==='number'?Number(target.value):target.value;}
      if(target.matches('[data-reasons]'))draft.quickReasons=target.value.split('\n');
      if(target.matches('[data-dimensions]'))draft.moduleConfig.dimensions=target.value.split('\n').map(s=>s.trim()).filter(Boolean);
      if(target.dataset.fault)draft.moduleConfig.faultStepId=target.dataset.fault;
      if(target.dataset.answer)draft.correctOptionId=target.dataset.answer;
      if(draft?.activityId==='param-explorer@1')previewExpression();
      status.textContent='有未保存修改';
    };
    root.querySelector('[data-editor-form]').onsubmit=event=>{event.preventDefault();save(draft);};
    root.querySelector('[data-save-json]')?.addEventListener('click',()=>{try{save(JSON.parse(root.querySelector('[data-raw-json]').value));}catch(error){status.textContent=error.message;}});
    root.querySelector('[data-add-step]')?.addEventListener('click',()=>{
      if(draft.moduleConfig.steps.length>=12)return;
      const used=new Set(draft.moduleConfig.steps.map(s=>s.id));let id=1;while(used.has('S'+id))id++;
      draft.moduleConfig.steps.push({id:'S'+id,line:String(draft.moduleConfig.steps.length+1),content:'请填写步骤'});paint();
    });
    root.querySelectorAll('[data-remove-step]').forEach(button=>button.onclick=()=>{
      const c=draft.moduleConfig;if(c.steps.length<=3){status.textContent='至少保留 3 个步骤。';return;}
      c.steps.splice(Number(button.dataset.removeStep),1);c.steps.forEach((s,i)=>s.line=String(i+1));
      if(!c.steps.some(s=>s.id===c.faultStepId))c.faultStepId=c.steps[0].id;paint();
    });
    root.querySelector('[data-ai-regenerate]')?.addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;status.textContent='正在重生成并验证本页互动…';
      try {const next=await onRegenerate({page:{...page,speakerNotes:notes},activityId:draft.activityId,instruction:root.querySelector('[data-ai-instruction]').value});if(!disposed && button.isConnected)save(next);}
      catch(error){status.textContent=error.message;}finally{if(button.isConnected)button.disabled=false;}
    });
    if(draft?.activityId==='param-explorer@1')previewExpression();
  }
  function save(input) {
    try {
      const checked=input?normalizeEditedLesson(page,input):null;
      if(checked?.activityId==='param-explorer@1')inspectParamConfig(checked.moduleConfig);
      onSave({lesson:checked,speakerNotes:notes});
    } catch(error) {root.querySelector('[data-editor-status]').textContent=error.message;}
  }
  function previewExpression() {
    const host=root.querySelector('[data-expression-preview]'), c=draft.moduleConfig;
    try {
      const result=inspectParamConfig(c);
      const project=([x,y])=>`${(24+(x-c.xAxis.min)/(c.xAxis.max-c.xAxis.min)*432).toFixed(2)},${(176-Math.max(0,Math.min(1,(y-c.yAxis.min)/(c.yAxis.max-c.yAxis.min)))*160).toFixed(2)}`;
      host.innerHTML=`<p>✓ 白名单编译通过 · ${result.corners} 组滑块端点 × 65 个横轴采样通过</p><svg viewBox="0 0 480 200" role="img" aria-label="本页公式即时曲线预览"><path d="M24 16V176H456" fill="none" stroke="#728da6"/>${result.series.map((series,i)=>`<polyline points="${e(series.map(project).join(' '))}" fill="none" stroke="${i?'#b47840':'#258b99'}" stroke-width="2"/>`).join('')}</svg>`;
    }catch(error){host.textContent='表达式体检未通过：'+error.message;}
  }
  paint();
  return () => { disposed = true; disposeVisuals?.(); disposeSlide?.(); };
}
