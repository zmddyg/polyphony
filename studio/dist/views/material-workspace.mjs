import { getLesson } from '../core/catalog.mjs';
import { readPptx } from '../core/pptx-reader.mjs';
import { readLegacySlides } from '../core/legacy-ppt.mjs';
import { createMaterialNotebook, makeMaterialVersionId } from '../core/material-notebook.mjs';
import { buildLectureScore } from '../core/lecture-score.mjs';
import { challengeNames, rcDefaults } from '../core/challenge-lab.mjs';
import { mountMaterialScience } from './material-science.mjs';
import { renderMaterialNotes } from './material-notes.mjs';
import { renderMaterialWorkshop } from './workshop.mjs';

const imageData = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/u;
const supported = new Set(['ppt', 'pptx', 'pdf']);
const activityTitles = {
  mzi: '干涉仪的两个输出端',
  blackbox: '数字黑箱',
  history: '史料互证',
  rc: 'RC 一阶电路',
  inquiry: '概念辨析互动',
};
const planSources = { provider: '模型建议', jev: 'Jev 快速建议', local: '本地规则' };
const supplementKinds = ['handout', 'science'];
const noteLabels = { handout: '补充讲义', science: '理科讲解', classroom: '课堂互动', experiment: '课堂实验' };
const experimentOptions = [
  { kind: 'rc', title: challengeNames.rc, desc: '一阶 RC 故障排查：全班只有一次仪表测量机会，可继承本页理科模板的 R/C/V₀/V∞ 参数。' },
  { kind: 'light', title: challengeNames.light, desc: '马赫–曾德尔干涉仪拟合与盲测挑战：用 3 个采样点拟合后选盲测角度验收。' },
  { kind: 'blackbox', title: challengeNames.blackbox, desc: '数字黑箱规则检验：已知 0→0、2→4，全班投出一个输入数字尝试区分 x² 与 2x。' },
];

const pageLabel = (version, number) => `《${version.name}》第 ${number} 页`;
const noteSource = (version, page) => ({
  type: 'material-page', versionId: version.versionId, name: version.name, pageNumber: page.number,
});
const noteKey = (versionId, pageNumber, id) => JSON.stringify([versionId, pageNumber, id]);
const plainLines = text => text.split(/\r\n?|\n/u).map(line => line.trim()).filter(Boolean);
const isAdopted = note => note?.adoption && note.adoption.withdrawnAt == null;

function isSafeMathML(markup) {
  return typeof markup === 'string' &&
    /^<math(?:\s[^<>]*)?>[\s\S]*<\/math>$/u.test(markup.trim()) &&
    !/<(?:script|iframe|object|embed|style|link|img|svg|a)\b|on[a-z]+\s*=|javascript:/iu.test(markup);
}

function parsePastedPages(defaultTitle, rawText) {
  const normalized = rawText.replace(/\r\n?/gu, '\n').trim();
  const byRule = normalized.split(/\n[ \t]*-{3,}[ \t]*\n/u).map(chunk => chunk.trim()).filter(Boolean);
  let sections = byRule;
  if (sections.length === 1 && /^#\s+/mu.test(normalized)) {
    const splitHeadings = normalized.split(/(?=^#\s+)/mu).map(chunk => chunk.trim()).filter(Boolean);
    if (splitHeadings.length > 1) sections = splitHeadings;
  }
  if (sections.length <= 1) {
    return [{ number: 1, title: defaultTitle, text: normalized, images: [] }];
  }
  return sections.map((chunk, idx) => {
    const lines = chunk.split('\n');
    const headingMatch = lines[0]?.match(/^#{1,3}\s+(.+)$/u);
    const title = headingMatch ? headingMatch[1].trim().slice(0, 120)
      : (lines[0]?.trim().slice(0, 80) || `${defaultTitle} · 第 ${idx + 1} 页`);
    const body = headingMatch ? lines.slice(1).join('\n').trim() : chunk;
    return { number: idx + 1, title, text: body || title, images: [] };
  });
}

function importedMaterial(result, type, file, versionId) {
  if (!result?.pages?.length) throw new Error('课件没有可读取的页。');
  return {
    ...result,
    versionId,
    name: file.name,
    title: result.title || file.name.replace(/\.[^.]+$/u, ''),
    file,
    type,
    pages: result.pages.map(page => ({
      ...page,
      preview: imageData.test(page.preview ?? '') ? page.preview : undefined,
      images: (page.images ?? []).filter(figure => imageData.test(figure?.src ?? '')),
    })),
  };
}

function renderSource(version, page, e) {
  const title = page.title || `第 ${page.number} 页`;
  const embedded = page.preview ? [] : (page.images ?? []).filter(figure => figure.src !== page.preview);
  const figures = embedded.length ? `<div class="mw-figures">${embedded.map(figure => `<img loading="lazy" src="${e(figure.src)}" alt="${e(figure.alt || figure.name || '原课件插图')}">`).join('')}</div>` : '';
  const safeFormulas = page.preview ? [] : (page.formulas ?? []).filter(isSafeMathML);
  const formulasMarkup = safeFormulas.length
    ? `<div class="mw-formulas" aria-label="提取公式">${safeFormulas.map(math => `<div class="mw-formula">${math}</div>`).join('')}</div>`
    : '';
  let copy = '';
  if (page.text && page.preview) {
    copy = `<details class="mw-source-text"><summary>查看这页的原文</summary><p class="mw-extracted">${e(page.text)}</p></details>`;
  } else if (!page.preview) {
    const lines = (page.text ?? '').split(/\r\n?|\n/u);
    if (lines[0]?.trim() === title) lines.shift();
    const excerpt = lines.join('\n');
    if (excerpt) copy = `<p class="mw-extracted">${e(excerpt)}</p>`;
    else if (!page.text && !figures && !safeFormulas.length) copy = '<p class="mw-muted">这页没有可读取的文字或图片。</p>';
  }
  const sourceNote = figures ? '当前显示抽取的原文和可读取的插图。' : '当前按页显示抽取的原文。';
  return `<section class="mw-paper" aria-labelledby="mw-source-title">
    <div class="mw-source-header">
      <p class="mw-source-ref">${e(pageLabel(version, page.number))}${page.hidden ? ' · 原课件隐藏页' : ''}</p>
      <h2 id="mw-source-title" tabindex="-1">${e(title)}</h2>
    </div>
    ${page.preview ? `<img class="mw-preview" src="${e(page.preview)}" alt="${e(`原课件第 ${page.number} 页预览`)}">` : ''}
    ${copy}
    ${formulasMarkup}
    ${figures}
    ${!page.preview && (page.text || figures) && version.type !== 'text' ? `<p class="mw-source-note">${sourceNote}</p>` : ''}
    ${page.warnings?.length ? `<details class="mw-source-text"><summary>这页的读取说明</summary><ul>${page.warnings.map(warning => `<li>${e(warning)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function joinLecture(version, adopted) {
  const supplements = new Map();
  const interactionsByPage = new Map();
  const experimentsByPage = new Map();
  const sorted = [...adopted].sort((a, b) => (a.adoptedAt ?? 0) - (b.adoptedAt ?? 0));
  for (const { pageNumber, kind, packet } of sorted) {
    if (kind === 'classroom') interactionsByPage.set(pageNumber, packet.lesson ?? packet);
    if (kind === 'experiment' && packet?.kind) {
      experimentsByPage.set(pageNumber, { kind: packet.kind, ...(packet.params ? { params: packet.params } : {}) });
    }
    if (!supplementKinds.includes(kind)) continue;
    if (!supplements.has(pageNumber)) supplements.set(pageNumber, { slides: [] });
    supplements.get(pageNumber).slides.push(...packet.slides);
  }
  return buildLectureScore(version, supplements, { interactionsByPage, experimentsByPage });
}

function downloadJsonFile(data, filename) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function renderMaterialWorkspace(root, ctx) {
  const { esc: e, icon } = ctx;
  const notebook = createMaterialNotebook();
  const transientNotes = new Map();
  const unsavedDrafts = new Map();
  let version, page, notes = [], versions = [], stored = false;
  let pageButtons, currentPageButton;
  let operation = '', plan, panel = '', stopped = false, draftTimer, panelCleanup, notesCleanup;
  let draftWrites = Promise.resolve();
  let selection = 0;
  let versionRequest = 0;
  const active = () => !stopped && root.isConnected;

  root.innerHTML = `<div class="mw-workspace" data-mw-dropzone>
    <header class="mw-heading">
      <div><h1>讲义备课</h1><p data-mw-heading-info>导入已有课件，按原页备课，在共演授课。</p></div>
      <div class="mw-actions mw-heading-actions">
        <button class="mw-button" type="button" data-mw-workshop>${icon('sparkles')}AI 备课工坊</button>
        <button class="mw-button" type="button" data-mw-manage data-mw-lock>${icon('layers')}管理备课本</button>
        <select aria-label="最近打开的课件" data-mw-recent hidden></select>
        <button class="mw-button mw-primary" type="button" data-mw-start hidden>${icon('play')}在共演开始授课</button>
      </div>
    </header>
    <p class="mw-status" role="status" aria-live="polite" data-mw-status></p>
    <p class="mw-storage-warning" role="status" hidden data-mw-storage-warning>此浏览器暂时无法保存备课内容。当前页面仍可继续备课和授课。</p>
    <div class="mw-body" data-mw-body></div>
    <div data-mw-workshop-host hidden></div>
    <input type="file" accept=".ppt,.pptx,.pdf,application/pdf" data-mw-file hidden>
    <input type="file" accept=".json,application/json" data-mw-bundle-file hidden>
    <dialog class="mw-dialog" aria-labelledby="mw-paste-title" data-mw-paste>
      <form class="mw-form" data-mw-paste-form>
        <h2 id="mw-paste-title">粘贴讲义内容</h2>
        <p class="mw-muted">支持单页文本，也支持用单独一行的 <code>---</code> 或多段 <code># 标题</code> 自动拆分为多页讲义。</p>
        <label>讲义名称 / 首页标题<input name="title" maxlength="150" required></label>
        <label>正文内容<textarea name="text" rows="10" required placeholder="直接粘贴讲义文字，或用 --- 分隔不同页…"></textarea></label>
        <div class="mw-actions">
          <button class="mw-button" type="button" data-mw-paste-close>取消</button>
          <button class="mw-button mw-primary" type="submit">导入讲义</button>
        </div>
      </form>
    </dialog>
    <dialog class="mw-dialog mw-manage-dialog" aria-labelledby="mw-manage-title" data-mw-manage-dialog>
      <div class="mw-manage-head">
        <h2 id="mw-manage-title">管理本地备课本</h2>
        <button type="button" class="mw-plain" data-mw-manage-close aria-label="关闭">${icon('close', 18)}</button>
      </div>
      <p class="mw-muted">可将备课本（含全部原页、批注、理科例题与互动课谱）导出为 <code>.polyphony-notebook.json</code>，跨设备或换教室电脑一键迁移。</p>
      <div class="mw-actions mw-manage-top-actions">
        <button type="button" class="mw-button mw-primary" data-mw-bundle-import>${icon('plus', 16)}导入备课包 (.json)</button>
      </div>
      <div class="mw-manage-list" data-mw-manage-list></div>
    </dialog>
  </div>`;
  const find = selector => root.querySelector(selector);
  const workspace = find('[data-mw-dropzone]');
  const body = find('[data-mw-body]');
  const status = find('[data-mw-status]');
  const recent = find('[data-mw-recent]');
  const start = find('[data-mw-start]');
  const fileInput = find('[data-mw-file]');
  const bundleInput = find('[data-mw-bundle-file]');
  const pasteDialog = find('[data-mw-paste]');
  const manageDialog = find('[data-mw-manage-dialog]');
  const manageList = find('[data-mw-manage-list]');
  const workshopHost = find('[data-mw-workshop-host]');

  function tell(message = '', error = false) {
    if (!active()) return;
    status.textContent = message;
    status.classList.toggle('mw-status-error', error);
  }

  function renderRecent() {
    recent.hidden = !versions.length;
    recent.replaceChildren(new Option('最近课件', ''));
    const names = new Map();
    for (const { name } of versions) names.set(name, (names.get(name) ?? 0) + 1);
    for (const item of versions) {
      const label = names.get(item.name) > 1 ? `${item.name} · ${item.versionId.slice(7, 15)}` : item.name;
      recent.add(new Option(label, item.versionId));
    }
    recent.disabled = Boolean(operation);
  }

  function renderManageList() {
    if (!versions.length) {
      manageList.innerHTML = '<p class="mw-muted">当前浏览器还没有已保存的备课本。</p>';
      return;
    }
    manageList.innerHTML = `<ul class="mw-version-cards">${versions.map(item => `<li>
      <div class="mw-version-info">
        <strong>${e(item.name)}</strong>
        <small>${item.pageCount ?? item.pageNumbers?.length ?? 0} 页 · ${e(item.type?.toUpperCase() || 'TEXT')}${version?.versionId === item.versionId ? ' · 当前打开' : ''}</small>
      </div>
      <div class="mw-actions">
        <button type="button" class="mw-plain" data-manage-open="${e(item.versionId)}">打开</button>
        <button type="button" class="mw-plain" data-manage-export="${e(item.versionId)}">${icon('download', 14)}导出</button>
        <button type="button" class="mw-plain mw-danger-plain" data-manage-delete="${e(item.versionId)}">删除</button>
      </div>
    </li>`).join('')}</ul>`;
  }

  function busy(name = '') {
    operation = name;
    root.querySelectorAll('[data-mw-lock], [data-mw-start], [data-mw-recent]').forEach(control => {
      control.disabled = Boolean(name);
    });
    if (!name && version && !version.pages.some(item => !item.hidden)) start.disabled = true;
  }

  async function refreshVersions() {
    try {
      versions = await notebook.listVersions();
      if (active()) {
        renderRecent();
        if (manageDialog.open) renderManageList();
      }
    } catch { /* The open deck remains usable without recent files. */ }
  }

  function storeWarning() {
    if (active()) find('[data-mw-storage-warning]').hidden = false;
  }

  function transientFor(versionId, number) {
    return [...transientNotes.values()].filter(item => item.versionId === versionId && (number === undefined || item.pageNumber === number));
  }

  function mergePageNotes(versionId, number, persisted) {
    const merged = new Map(persisted.map(note => [note.id, note]));
    for (const note of transientFor(versionId, number)) merged.set(note.id, note);
    for (const entry of unsavedDrafts.values()) {
      if (entry.versionId === versionId && entry.pageNumber === number) {
        merged.set(entry.note.id, { ...merged.get(entry.note.id), ...entry.note });
      }
    }
    return [...merged.values()];
  }

  async function readNotes(versionId, number) {
    let result = [];
    try { result = await notebook.getPageNotes(versionId, number); } catch { /* The current page can use in-memory changes. */ }
    return mergePageNotes(versionId, number, result);
  }

  async function saveNote(target, sourcePage, note, adopt = false) {
    const versionId = target.versionId;
    const pageNumber = sourcePage.number;
    const key = noteKey(versionId, pageNumber, note.id);
    const previous = transientNotes.get(key) ?? (await readNotes(versionId, pageNumber)).find(item => item.id === note.id);
    const updatedAt = Date.now();
    const next = {
      ...previous,
      ...note,
      versionId,
      pageNumber,
      updatedAt,
      adoption: adopt ? { packet: note.packet, source: note.source, adoptedAt: updatedAt } : previous?.adoption,
    };
    transientNotes.set(key, next);
    try {
      await notebook.savePageNote(versionId, pageNumber, note, { adopt });
      if (transientNotes.get(key) === next) transientNotes.delete(key);
    } catch { storeWarning(); }
  }

  async function seedSpeakerNotes(material) {
    const withNotes = (material.pages ?? []).filter(item => typeof item.speakerNotes === 'string' && item.speakerNotes.trim());
    if (!withNotes.length) return;
    for (const item of withNotes) {
      try {
        const existing = await notebook.getPageNotes(material.versionId, item.number);
        if (existing.some(entry => entry.kind === 'annotation')) continue;
        await notebook.savePageNote(material.versionId, item.number, {
          id: 'annotation',
          kind: 'annotation',
          packet: { text: item.speakerNotes.trim() },
          source: { type: 'pptx-speaker-notes', pageNumber: item.number },
        });
      } catch { /* Ignore speaker note seed errors. */ }
    }
  }

  function flushDrafts() {
    clearTimeout(draftTimer);
    draftTimer = undefined;
    if (!unsavedDrafts.size) return draftWrites;
    // Workshop inputs keep editing the same draft. Snapshot it before queuing the write.
    const entries = Array.from(unsavedDrafts.values(), entry => ({ ...entry, note: structuredClone(entry.note) }));
    unsavedDrafts.clear();
    draftWrites = draftWrites.then(async () => {
      for (const { target, sourcePage, note } of entries) await saveNote(target, sourcePage, note);
    });
    return draftWrites;
  }

  function queueDraft(target, sourcePage, note) {
    const versionId = target.versionId;
    const pageNumber = sourcePage.number;
    unsavedDrafts.set(noteKey(versionId, pageNumber, note.id), { versionId, pageNumber, target, sourcePage, note });
    if (version === target && page === sourcePage) {
      const index = notes.findIndex(item => item.id === note.id);
      if (index < 0) notes.push(note);
      else notes[index] = { ...notes[index], ...note };
    }
    draftTimer ??= setTimeout(flushDrafts, 360);
  }

  async function readAdopted(versionId) {
    let adopted = [];
    try { adopted = await notebook.listAdopted(versionId); } catch { /* Include any changes kept for this page. */ }
    const keyOf = item => noteKey(item.versionId, item.pageNumber, item.id);
    const merged = new Map(adopted.map(item => [keyOf(item), item]));
    for (const entry of transientFor(versionId)) {
      if (isAdopted(entry)) merged.set(keyOf(entry), { ...entry, ...entry.adoption });
      else merged.delete(keyOf(entry));
    }
    return [...merged.values()];
  }

  async function updatePageNotes() {
    const opened = selection;
    const updated = await readNotes(version.versionId, page.number);
    if (!active() || opened !== selection) return;
    notes = updated;
    renderAdopted();
  }

  async function adoptNote(target, sourcePage, kind, packet, source = noteSource(target, sourcePage)) {
    unsavedDrafts.delete(noteKey(target.versionId, sourcePage.number, kind));
    await flushDrafts();
    await saveNote(target, sourcePage, { id: kind, kind, packet, source }, true);
    if (active() && version === target && page === sourcePage) await updatePageNotes();
  }

  async function withdrawNote(entry) {
    const versionId = version.versionId;
    const pageNumber = page.number;
    const key = noteKey(versionId, pageNumber, entry.id);
    await flushDrafts();
    try {
      await notebook.withdrawPageNote(versionId, pageNumber, entry.id);
      transientNotes.delete(key);
    } catch {
      transientNotes.set(key, { ...entry, adoption: { ...entry.adoption, withdrawnAt: Date.now() } });
      storeWarning();
    }
    if (active() && version.versionId === versionId && page.number === pageNumber) {
      await updatePageNotes();
    }
  }

  function renderEmpty() {
    version = undefined;
    page = undefined;
    start.hidden = true;
    find('[data-mw-workshop]').hidden = false;
    find('[data-mw-heading-info]').textContent = '导入已有课件，按原页备课，在共演授课。';
    body.innerHTML = `<section class="mw-empty" aria-labelledby="mw-empty-title">
      <div class="mw-empty-icon">${icon('workshop', 30)}</div>
      <h2 id="mw-empty-title">打开一份课件</h2>
      <p>支持旧版 PowerPoint（.ppt）、.pptx 和 PDF；也可以直接将课件或 <code>.polyphony-notebook.json</code> 备课包拖入此处。</p>
      <div class="mw-actions">
        <button class="mw-button mw-primary" type="button" data-mw-upload data-mw-lock>${icon('plus')}导入课件</button>
        <button class="mw-button" type="button" data-mw-paste-open data-mw-lock>粘贴讲义内容</button>
        <button class="mw-button" type="button" data-mw-empty-bundle data-mw-lock>${icon('download')}导入备课包</button>
      </div>
      ${ctx.mode === 'server' ? '' : '<p class="mw-source-note">PDF 原页可通过启动共演本地服务导入。</p>'}
    </section>`;
    body.querySelector('[data-mw-upload]').onclick = () => fileInput.click();
    body.querySelector('[data-mw-paste-open]').onclick = () => pasteDialog.showModal();
    body.querySelector('[data-mw-empty-bundle]').onclick = () => bundleInput.click();
  }

  async function openVersion(versionId, number) {
    if (operation) return;
    const requested = ++versionRequest;
    const result = await notebook.getVersion(versionId);
    if (!active() || requested !== versionRequest) return;
    if (!result) throw new Error('这份课件已不在最近记录里。');
    displayVersion(result, true, number);
  }

  function displayVersion(next, saved, number) {
    version = next;
    stored = saved;
    plan = undefined;
    const count = version.pages.length;
    find('[data-mw-heading-info]').textContent = `${version.name} · 原课件 ${count} 页`;
    find('[data-mw-workshop]').hidden = true;
    start.hidden = false;
    start.disabled = Boolean(operation) || !version.pages.some(item => !item.hidden);
    body.innerHTML = `
      <section class="mw-plan" aria-labelledby="mw-plan-title" data-mw-plan></section>
      <div class="mw-layout">
        <aside class="mw-pages" aria-label="原课件页序">
          <div class="mw-pages-heading"><h2>原课件</h2><button class="mw-plain" type="button" data-mw-replace data-mw-lock>换课件</button></div>
          <ol class="mw-page-list" data-mw-page-list></ol>
        </aside>
        <div class="mw-selected" data-mw-selected></div>
      </div>`;
    find('[data-mw-replace]').onclick = () => fileInput.click();
    renderPlan();
    goToPage(number ?? version.lastPage ?? version.pages[0].number);
  }

  function renderPlan() {
    const container = find('[data-mw-plan]');
    if (!container) return;
    const available = plan?.suggestions.filter(item => Object.hasOwn(activityTitles, item.kind) &&
      version.pages.some(candidate => candidate.number === item.pageNumber && !candidate.hidden)) ?? [];
    const fallbackCount = plan?.source === 'jev' && plan.modelPages < plan.scannedPages
      ? ` · Jev 判读 ${plan.modelPages} 页，其余使用本地规则` : '';
    container.innerHTML = `<div class="mw-plan-heading">
        <div><h2 id="mw-plan-title">全课排课</h2>
          <p>${plan ? e(`${planSources[plan.source] ?? planSources.local} · 检查了 ${plan.scannedPages} / ${plan.totalPages} 页${fallbackCount}`) : '从原课件中找适合补充讲解、概念辨析或加互动的页。'}</p></div>
        <button class="mw-button" type="button" data-mw-plan-request data-mw-lock>${icon('sparkles')}${plan ? '重新获取建议' : '获取排课建议'}</button>
      </div>
      ${plan && !available.length ? '<p class="mw-plan-feedback">没有匹配到适合加互动或理科讲解的页。可以按原课件授课，也可以逐页备课。</p>' : ''}
      ${available.length ? `<ul class="mw-suggestions">${available.map((item, index) => `<li>
        <div><strong>${e(activityTitles[item.kind])}</strong><p>${e(item.reason)}</p></div>
        <div class="mw-actions">
          <button class="mw-plain" type="button" data-mw-suggestion-page="${index}" data-mw-lock>看第 ${item.pageNumber} 页</button>
          <button class="mw-button" type="button" data-mw-suggestion="${index}" data-mw-lock>${item.kind === 'rc' ? '打开理科模板' : item.kind === 'inquiry' ? 'AI 生成本页互动' : '添加到这一页'}</button>
        </div>
      </li>`).join('')}</ul>` : ''}
      ${version.warnings?.length ? `<details class="mw-import-warnings"><summary>课件读取说明</summary><ul>${version.warnings.map(warning => `<li>${e(warning)}</li>`).join('')}</ul></details>` : ''}`;
    container.querySelector('[data-mw-plan-request]').onclick = async () => {
      if (operation) return;
      const target = version;
      busy('plan');
      tell('正在按页检查课件…');
      try {
        plan = await ctx.planLecture(target);
        if (!active()) return;
        renderPlan();
        tell();
        find('[data-mw-plan-request]').focus({ preventScroll: true });
      } catch (error) {
        tell(error?.message || '暂时无法获取排课建议，可以照常逐页备课。', true);
      } finally {
        busy();
      }
    };
    container.querySelectorAll('[data-mw-suggestion-page]').forEach(button => {
      button.onclick = () => goToPage(available[Number(button.dataset.mwSuggestionPage)].pageNumber, { focus: true });
    });
    container.querySelectorAll('[data-mw-suggestion]').forEach(button => {
      button.onclick = async () => {
        if (operation) return;
        const item = available[Number(button.dataset.mwSuggestion)];
        const target = version;
        const sourcePage = target.pages.find(candidate => candidate.number === item.pageNumber);
        if (item.kind === 'rc') {
          goToPage(item.pageNumber, { tool: 'science', model: 'rc', focus: true });
          return;
        }
        if (item.kind === 'inquiry') {
          goToPage(item.pageNumber, { tool: 'classroom', focus: true });
          return;
        }
        const lesson = getLesson(item.kind);
        if (!lesson) return;
        busy('adopt');
        try {
          const prior = (await readNotes(target.versionId, item.pageNumber)).find(entry => entry.kind === 'classroom');
          await adoptNote(target, sourcePage, 'classroom', {
            lesson,
            workshopDraft: prior?.packet?.workshopDraft,
          });
          if (!active()) return;
          goToPage(item.pageNumber, { focus: true });
          tell(`已把「${activityTitles[item.kind]}」加入第 ${item.pageNumber} 页。`);
        } catch (error) {
          tell(error?.message || '添加互动失败，请重试。', true);
        } finally {
          busy();
        }
      };
    });
  }

  function closePanels() {
    panelCleanup?.();
    notesCleanup?.();
    panelCleanup = undefined;
    notesCleanup = undefined;
    panel = '';
  }

  function renderPageList() {
    const list = find('[data-mw-page-list]');
    if (!list.childElementCount) {
      list.innerHTML = version.pages.map(item => `<li>
        <button class="mw-page-choice" type="button" data-mw-page="${item.number}" data-mw-lock>
          <span class="mw-page-number">${item.number}</span>
          <span class="mw-page-name">${e(item.title || `第 ${item.number} 页`)}${item.hidden ? '<small>隐藏页</small>' : ''}</span>
        </button>
      </li>`).join('');
      pageButtons = new Map(Array.from(list.querySelectorAll('[data-mw-page]'), button => [Number(button.dataset.mwPage), button]));
      currentPageButton = undefined;
      list.onclick = ({ target }) => {
        const button = target.closest('[data-mw-page]');
        if (button) goToPage(Number(button.dataset.mwPage), { focus: true });
      };
    }
    const nextButton = pageButtons.get(page.number);
    if (nextButton === currentPageButton) return;
    currentPageButton?.removeAttribute('aria-current');
    nextButton.setAttribute('aria-current', 'page');
    currentPageButton = nextButton;
  }

  function goToPage(number, { tool, model, focus = false } = {}) {
    if (!active() || !version) return;
    const written = flushDrafts();
    const nextPage = version.pages.find(item => item.number === number) ?? version.pages[0];
    if (page === nextPage && !tool && !body.hidden && find('[data-mw-selected]')?.childElementCount) {
      if (focus) focusPage();
      return;
    }
    closePanels();
    page = nextPage;
    notes = [];
    const target = version;
    const current = ++selection;
    body.hidden = false;
    workshopHost.hidden = true;
    workshopHost.replaceChildren();
    find('.mw-heading').hidden = false;
    renderPageList();
    const selected = find('[data-mw-selected]');
    selected.innerHTML = `
      ${renderSource(version, page, e)}
      ${page.hidden ? '<p class="mw-source-note">这页保留在备课记录中，放映时会跳过。</p>' : `<section class="mw-page-tools" aria-labelledby="mw-page-tools-title">
        <div class="mw-page-tools-heading">
          <h2 id="mw-page-tools-title">这一页的备课</h2>
          <div class="mw-actions" role="group" aria-label="逐页备课">
            <button class="mw-button" type="button" data-mw-tool="handout" data-mw-lock aria-expanded="false">${icon('plus')}补一页讲义</button>
            <button class="mw-button" type="button" data-mw-tool="science" data-mw-lock aria-expanded="false">${icon('lab')}理科模板</button>
            <button class="mw-button" type="button" data-mw-tool="experiment" data-mw-lock aria-expanded="false">${icon('target')}挂载课堂实验</button>
            <button class="mw-button" type="button" data-mw-tool="classroom" data-mw-lock aria-expanded="false">${icon('sparkles')}备课堂互动</button>
          </div>
        </div>
        <ul class="mw-adopted" aria-label="本页已安排的讲授内容" data-mw-adopted hidden></ul>
        <div class="mw-tool-panel" data-mw-tool-panel hidden></div>
      </section>`}
      ${stored ? `<details class="mw-memory" data-mw-memory>
        <summary>${icon('replay')}批注与课堂反馈</summary>
        <div data-mw-memory-content></div>
      </details>` : ''}
    `;
    selected.querySelectorAll('[data-mw-tool]').forEach(button => {
      button.onclick = () => showTool(button.dataset.mwTool);
    });
    const memory = selected.querySelector('[data-mw-memory]');
    if (memory) memory.ontoggle = () => {
      if (!memory.isConnected || !memory.open) return;
      notesCleanup?.();
      notesCleanup = renderMaterialNotes(memory.querySelector('[data-mw-memory-content]'), {
        notebook, version: target, pageNumber: nextPage.number,
        classroom: ctx.getState?.() ?? ctx.state,
        esc: e, goToPage,
        openVersion: (id, destination) => openVersion(id, destination).catch(error => tell(error.message, true)),
        onNotesChanged: (number, persisted) => {
          notes = mergePageNotes(target.versionId, number, persisted);
          renderAdopted();
        },
        onUseReason: reason => openWorkshop(reason),
        goReplay: () => ctx.go('replay'),
      });
    };
    if (focus) focusPage();
    if (stored) void notebook.setLastPage(target.versionId, nextPage.number).catch(storeWarning);
    void (async () => {
      await written;
      if (!active() || current !== selection) return;
      await updatePageNotes();
      if (active() && current === selection && tool) showTool(tool, model);
    })();
  }

  function focusPage() {
    const title = find('#mw-source-title');
    title?.focus({ preventScroll: true });
    title?.scrollIntoView({ block: 'nearest' });
  }

  function renderAdopted() {
    const list = find('[data-mw-adopted]');
    if (!list) return;
    const adopted = notes.filter(note => isAdopted(note) && noteLabels[note.kind]);
    list.hidden = !adopted.length;
    list.innerHTML = adopted.map((note, index) => {
      const packet = note.adoption.packet;
      const title = packet.lesson?.title ?? packet.title ?? challengeNames[packet.kind] ?? noteLabels[note.kind];
      return `<li><span>${e(noteLabels[note.kind])} · <strong>${e(title)}</strong></span>
        <button class="mw-plain" type="button" aria-label="${e(`从授课移除「${title}」`)}" data-mw-withdraw="${index}" data-mw-lock>移除</button></li>`;
    }).join('');
    list.querySelectorAll('[data-mw-withdraw]').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        await withdrawNote(adopted[Number(button.dataset.mwWithdraw)]);
      };
    });
  }

  function showTool(kind, model) {
    if (page.hidden) return;
    if (kind === 'classroom') return void openWorkshop();
    const host = find('[data-mw-tool-panel]');
    if (!host) return;
    panelCleanup?.();
    panelCleanup = undefined;
    panel = panel === kind && !model ? '' : kind;
    host.hidden = !panel;
    host.replaceChildren();
    root.querySelectorAll('[data-mw-tool]').forEach(button => {
      button.setAttribute('aria-expanded', String(button.dataset.mwTool === panel));
    });
    if (panel === 'handout') renderHandout(host);
    if (panel === 'experiment') renderExperimentTool(host);
    if (panel === 'science') {
      const target = version;
      const sourcePage = page;
      panelCleanup = mountMaterialScience(host, {
        anchor: { id: `${target.versionId}:${sourcePage.number}`, materialId: target.versionId, title: target.name, page: sourcePage.number },
        model,
        adoptedPacket: notes.find(note => note.kind === 'science' && isAdopted(note))?.adoption.packet,
        onAdopt: async packet => {
          await adoptNote(target, sourcePage, 'science', packet);
          if (version === target && page === sourcePage) tell('已将理科讲解加入这一页。');
        },
      });
    }
  }

  function renderExperimentTool(host) {
    const target = version;
    const sourcePage = page;
    const existing = notes.find(note => note.kind === 'experiment' && isAdopted(note))?.adoption?.packet;
    const adoptedRc = notes.find(note => note.kind === 'science' && isAdopted(note) && note.adoption.packet?.model === 'rc')?.adoption?.packet;
    const inheritedParams = adoptedRc?.parameters ?? existing?.params ?? rcDefaults;
    const selectedKind = existing?.kind ?? 'rc';
    host.innerHTML = `<form class="mw-form mw-exp-form" data-mw-exp-form>
      <p class="mw-muted">为原稿第 ${sourcePage.number} 页显式挂载一项课堂现场实验，授课时可直接点击底部实验按钮启动。</p>
      <div class="mw-exp-options">${experimentOptions.map(opt => `<label class="mw-exp-card">
        <input type="radio" name="kind" value="${e(opt.kind)}"${opt.kind === selectedKind ? ' checked' : ''}>
        <div><strong>${e(opt.title)}</strong><p>${e(opt.desc)}</p></div>
      </label>`).join('')}</div>
      <div class="mw-exp-rc-note" data-exp-rc-note${selectedKind === 'rc' ? '' : ' hidden'}>
        <strong>RC 故障台参数：</strong>
        R = ${e(inheritedParams.resistanceKohm)} kΩ，C = ${e(inheritedParams.capacitanceNf)} nF，V₀ = ${e(inheritedParams.initialV)} V，V∞ = ${e(inheritedParams.finalV)} V
        ${adoptedRc ? '（已自动同步本页采用的理科模板参数）' : '（如需自定义参数，可先在「理科模板」调整并采用）'}
      </div>
      <div class="mw-actions"><button class="mw-button mw-primary" type="submit" data-mw-lock>${icon('check')}挂载到此页</button></div>
    </form>`;
    const form = host.querySelector('[data-mw-exp-form]');
    const rcNote = form.querySelector('[data-exp-rc-note]');
    form.onchange = () => {
      rcNote.hidden = form.elements.kind.value !== 'rc';
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const kind = form.elements.kind.value;
      const meta = experimentOptions.find(item => item.kind === kind);
      if (!meta) return;
      const packet = {
        kind,
        title: meta.title,
        ...(kind === 'rc' ? { params: inheritedParams } : {}),
      };
      event.submitter.disabled = true;
      try {
        await adoptNote(target, sourcePage, 'experiment', packet);
        if (version === target && page === sourcePage) tell(`已将「${meta.title}」挂载到第 ${sourcePage.number} 页。`);
      } finally {
        event.submitter.disabled = false;
      }
    };
  }

  function renderHandout(host) {
    const target = version;
    const sourcePage = page;
    const existing = notes.find(note => note.kind === 'handout')?.packet.slides[0];
    host.innerHTML = `<form class="mw-form" data-mw-handout>
      <label>补页标题<input name="title" maxlength="150" required value="${e(existing?.title ?? `${sourcePage.title || `第 ${sourcePage.number} 页`} · 补充讲义`)}"></label>
      <label>讲义内容<textarea name="text" rows="5" required>${e(existing?.body.join('\n'))}</textarea></label>
      <div class="mw-actions"><button class="mw-button mw-primary" type="submit" data-mw-lock>${icon('check')}采用补页</button></div>
    </form>`;
    const form = host.querySelector('form');
    const packet = () => {
      const title = form.elements.title.value.trim();
      return { title, slides: [{ title, body: plainLines(form.elements.text.value), source: pageLabel(target, sourcePage.number) }] };
    };
    form.oninput = () => queueDraft(target, sourcePage, {
      id: 'handout', kind: 'handout', packet: packet(), source: noteSource(target, sourcePage),
    });
    form.onsubmit = async event => {
      event.preventDefault();
      const current = packet();
      if (!current.title || !current.slides[0].body.length) return tell('请填写补页的标题和内容。', true);
      event.submitter.disabled = true;
      try {
        await adoptNote(target, sourcePage, 'handout', current);
        if (version === target && page === sourcePage) tell('已将补充讲义加入这一页。');
      } finally {
        event.submitter.disabled = false;
      }
    };
  }

  async function openWorkshop(reason) {
    if (!page || page.hidden || body.hidden) return;
    const target = version;
    const sourcePage = page;
    await flushDrafts();
    const pageNotes = await readNotes(target.versionId, sourcePage.number);
    if (!active() || version !== target || page !== sourcePage || body.hidden) return;
    const saved = pageNotes.find(note => note.kind === 'classroom');
    const old = saved?.packet?.workshopDraft;
    const starter = saved?.packet?.lesson;
    const draft = old ? structuredClone(old) : {
      topic: (sourcePage.title || target.title).slice(0, 100),
      goal: '根据本页材料做出判断，并说明判断依据。',
      material: (sourcePage.text ?? '').trim().slice(0, 2200),
      ...(starter ? { score: structuredClone(starter), source: 'imported' } : {}),
      ...(starter && getLesson(starter.id) ? { reference: starter.id } : {}),
    };
    let source = saved?.source ?? noteSource(target, sourcePage);
    if (reason?.reason) {
      const excerpt = `课堂反馈（原话）\n${reason.reason}`;
      if (!draft.material.includes(excerpt)) {
        draft.material = [draft.material.slice(0, Math.max(0, 2198 - excerpt.length)).trim(), excerpt].filter(Boolean).join('\n\n').slice(0, 2200);
      }
      source = { ...noteSource(target, sourcePage), response: reason.source };
      queueDraft(target, sourcePage, { id: 'classroom', kind: 'classroom', packet: { lesson: starter, workshopDraft: draft }, source });
    }
    const closeWorkshop = () => {
      if (!active()) return;
      void flushDrafts().then(updatePageNotes);
      body.hidden = false;
      find('.mw-heading').hidden = false;
      workshopHost.hidden = true;
      workshopHost.replaceChildren();
      find('[data-mw-tool="classroom"]')?.focus({ preventScroll: true });
    };
    body.hidden = true;
    find('.mw-heading').hidden = true;
    workshopHost.hidden = false;
    renderMaterialWorkshop(workshopHost, ctx, {
      pageLabel: pageLabel(target, sourcePage.number),
      draft,
      onBack: closeWorkshop,
      onChange: workshopDraft => queueDraft(target, sourcePage, {
        id: 'classroom', kind: 'classroom', packet: { lesson: starter, workshopDraft }, source,
      }),
      onAdopt: async (lesson, workshopDraft) => {
        await adoptNote(target, sourcePage, 'classroom', { lesson, workshopDraft }, source);
        if (active() && version === target && page === sourcePage) {
          closeWorkshop();
          tell('已将互动课谱加入这一页。');
        }
      },
    });
    workshopHost.querySelector('h1').tabIndex = -1;
    workshopHost.querySelector('h1').focus({ preventScroll: true });
  }

  async function importFile(file) {
    const type = file.name.split('.').at(-1).toLowerCase();
    if (!supported.has(type)) throw new Error('请选择 .ppt、.pptx 或 .pdf 文件。');
    const bytes = await file.arrayBuffer();
    const versionId = await makeMaterialVersionId({ name: file.name, bytes });
    let previous;
    try { previous = await notebook.getVersion(versionId); } catch { /* Reading the new deck still works. */ }
    if (previous) {
      // Upgrade offline-cached slides with server-rendered original previews when now online.
      if (ctx.materialRendering && previous.type !== 'text' && previous.pages.some(item => !item.hidden && !item.preview)) {
        try {
          const rendered = await ctx.importMaterial(file);
          const matchingPages = rendered?.pages?.length === previous.pages.length &&
            rendered.pages.every((item, index) => item.number === previous.pages[index].number);
          if (matchingPages) {
            const upgraded = await notebook.updateDocumentPages(versionId, rendered.pages, rendered.warnings ?? previous.warnings);
            return { material: upgraded, saved: true, upgraded: true };
          }
        } catch { /* Keep the cached notebook intact if rendering fails. */ }
      }
      return { material: previous, saved: true };
    }
    let result;
    if (type === 'pptx') {
      let parsedInBrowser = true;
      try { result = await readPptx(file); }
      catch (error) {
        if (!ctx.materialRendering) throw error;
        parsedInBrowser = false;
        result = await ctx.importMaterial(file);
      }
      if (parsedInBrowser && ctx.materialRendering && result.pages.some(item => !item.hidden && !item.preview)) {
        try {
          const rendered = await ctx.importMaterial(file);
          const matchingPages = rendered.pages.length === result.pages.length &&
            rendered.pages.every((item, index) => item.number === result.pages[index].number);
          if (matchingPages) {
            result.pages = result.pages.map((item, index) => ({
              ...item, preview: rendered.pages[index].preview || item.preview,
            }));
          } else {
            result.warnings = [...(result.warnings ?? []), '原页图的页数或顺序与课件记录不一致，仍保留原课件页序。'];
          }
        } catch {
          result.warnings = [...(result.warnings ?? []), '未能生成完整的原页图。按页显示已有的预览、原文和插图。'];
        }
      }
    }
    else if (ctx.mode === 'server') result = await ctx.importMaterial(file);
    else if (type === 'ppt') {
      result = readLegacySlides(new Uint8Array(bytes), { pageLimit: 100, textLimit: 12000 });
      result.warnings = ['旧版 PowerPoint 在此处按页显示抽取的原文。'];
      if (result.truncated) result.warnings.push('文件较大。部分原文或原页超出读取范围。');
    } else throw new Error('请启动共演本地服务，再导入 PDF。也可以粘贴其中一页的原文。');
    const saved = await storeVersion(importedMaterial(result, type, file, versionId));
    if (saved.saved) await seedSpeakerNotes(saved.material);
    return saved;
  }

  async function importNotebookFile(file) {
    if (file.size > 64 * 1024 * 1024) throw new Error('备课包文件超过 64 MB 大小限制。');
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch { throw new Error('无法解析 JSON 备课包文件。'); }
    const imported = await notebook.importNotebook(parsed);
    const loaded = await notebook.getVersion(imported.versionId);
    if (!loaded) throw new Error('备课包导入后无法打开。');
    return {
      material: loaded,
      saved: true,
      message: `已导入备课包「${imported.name}」（${imported.pageCount} 页，${imported.noteCount} 条备课记录）。`,
    };
  }

  async function storeVersion(material) {
    try {
      return { material: await notebook.saveVersion(material), saved: true };
    } catch {
      storeWarning();
      return { material, saved: false };
    }
  }

  async function runImport(read) {
    if (operation) return false;
    versionRequest += 1;
    busy('import');
    tell('正在读取课件…');
    try {
      const { material, saved, upgraded, message } = await read();
      if (!active()) return false;
      displayVersion(material, saved);
      tell(message ?? (upgraded ? '已自动补齐高清原页预览，原有批注与备课记录完整保留。' : ''));
      void refreshVersions();
      return true;
    } catch (error) {
      tell(error?.message || '无法读取课件，请重新选择文件。', true);
      return false;
    } finally {
      busy();
    }
  }

  function handleIncomingFile(file) {
    if (!file) return;
    const ext = file.name.split('.').at(-1).toLowerCase();
    if (ext === 'json') {
      if (manageDialog.open) manageDialog.close();
      void runImport(() => importNotebookFile(file));
    } else {
      void runImport(() => importFile(file));
    }
  }

  fileInput.onchange = () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    handleIncomingFile(file);
  };
  bundleInput.onchange = () => {
    const [file] = bundleInput.files;
    bundleInput.value = '';
    if (file) {
      if (manageDialog.open) manageDialog.close();
      void runImport(() => importNotebookFile(file));
    }
  };

  let dragDepth = 0;
  const onDragEnter = event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    dragDepth++;
    workspace.classList.add('is-dragover');
  };
  const onDragOver = event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) workspace.classList.remove('is-dragover');
  };
  const onDrop = event => {
    event.preventDefault();
    dragDepth = 0;
    workspace.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file && !operation) handleIncomingFile(file);
  };
  workspace.addEventListener('dragenter', onDragEnter);
  workspace.addEventListener('dragover', onDragOver);
  workspace.addEventListener('dragleave', onDragLeave);
  workspace.addEventListener('drop', onDrop);

  find('[data-mw-manage]').onclick = async () => {
    await refreshVersions();
    renderManageList();
    manageDialog.showModal();
  };
  find('[data-mw-manage-close]').onclick = () => manageDialog.close();
  find('[data-mw-bundle-import]').onclick = () => bundleInput.click();
  manageList.onclick = async event => {
    const openBtn = event.target.closest('[data-manage-open]');
    if (openBtn) {
      manageDialog.close();
      try { await openVersion(openBtn.dataset.manageOpen); tell(); }
      catch (error) { tell(error?.message || '无法打开课件。', true); }
      return;
    }
    const exportBtn = event.target.closest('[data-manage-export]');
    if (exportBtn) {
      const id = exportBtn.dataset.manageExport;
      exportBtn.disabled = true;
      try {
        const bundle = await notebook.exportNotebook(id);
        const safeName = (bundle.versionMeta?.name || 'notebook').replace(/[\\/:*?"<>|]/g, '_');
        downloadJsonFile(bundle, `${safeName}.polyphony-notebook.json`);
        ctx.toast('已导出备课包');
      } catch (error) {
        tell(error?.message || '导出备课包失败。', true);
      } finally {
        exportBtn.disabled = false;
      }
      return;
    }
    const deleteBtn = event.target.closest('[data-manage-delete]');
    if (deleteBtn) {
      const id = deleteBtn.dataset.manageDelete;
      const meta = versions.find(item => item.versionId === id);
      manageDialog.close();
      const confirmed = await ctx.confirmDialog({
        title: '删除本地备课本？',
        message: `将永久删除「${meta?.name ?? id}」及其全部批注、补充讲义和互动课谱。建议删除前先导出备课包。`,
        confirmLabel: '确认删除',
        cancelLabel: '取消',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await notebook.deleteVersion(id);
        if (version?.versionId === id) renderEmpty();
        await refreshVersions();
        ctx.toast('已删除本地备课本');
      } catch (error) {
        tell(error?.message || '删除备课本失败。', true);
      }
    }
  };

  find('[data-mw-paste-close]').onclick = () => pasteDialog.close();
  find('[data-mw-paste-form]').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = form.elements.title.value.trim();
    const text = form.elements.text.value.trim();
    if (!title || !text) return;
    pasteDialog.close();
    const opened = await runImport(async () => {
      const pages = parsePastedPages(title, text);
      const bytes = new TextEncoder().encode(`${title}\n${text}`);
      const versionId = await makeMaterialVersionId({ name: title, bytes });
      return storeVersion({ name: title, title, versionId, type: 'text', pages });
    });
    if (opened) form.reset();
  };
  find('[data-mw-workshop]').onclick = () => ctx.go('workshop');
  recent.onchange = async () => {
    const { value } = recent;
    recent.value = '';
    if (!value || operation) return;
    try { await openVersion(value); tell(); }
    catch (error) { tell(error?.message || '无法打开最近课件。', true); }
  };
  start.onclick = async () => {
    if (operation || !version) return;
    busy('start');
    const target = version;
    tell('正在准备共演授课…');
    try {
      await flushDrafts();
      const lecture = joinLecture(target, await readAdopted(target.versionId));
      if (active()) await ctx.startLecture(lecture);
    } catch (error) {
      tell(error?.message || '未能开始授课，请重试。', true);
    } finally {
      busy();
    }
  };

  renderEmpty();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void flushDrafts();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', flushDrafts);
  void (async () => {
    await refreshVersions();
    if (active() && !version && !operation && versions.length) {
      try { await openVersion(versions[0].versionId); }
      catch { /* An unavailable recent deck does not prevent import. */ }
    }
  })();
  return () => {
    stopped = true;
    closePanels();
    workspace.removeEventListener('dragenter', onDragEnter);
    workspace.removeEventListener('dragover', onDragOver);
    workspace.removeEventListener('dragleave', onDragLeave);
    workspace.removeEventListener('drop', onDrop);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', flushDrafts);
    void flushDrafts();
  };
}
