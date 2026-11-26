import { materialClassroomReasons, materialClassroomReference } from '../core/material-notebook.mjs';

const mounted = new WeakMap();
const annotationDrafts = new Map();
const adoptionLabels = { handout: '补页', science: '理科讲解', classroom: '课堂活动' };
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(+date) ? dateFormat.format(date) : '';
}

function annotationText(note) {
  return typeof note?.packet === 'string' ? note.packet : note?.packet?.text ?? '';
}

function noteTitle(note, packet) {
  return packet?.lesson?.title ?? packet?.title ?? packet?.heading ?? adoptionLabels[note.kind];
}

function savedDrafts(notes, esc, pageNumber) {
  const drafts = notes.filter(note => Object.hasOwn(adoptionLabels, note.kind));
  if (!drafts.length) return '';
  return `<section class="pmn-records" aria-label="这页的补页和活动">
    ${drafts.map(note => {
      const { adoption } = note;
      const status = adoption && adoption.withdrawnAt == null
        ? '已采用 · ' + formatDate(adoption.adoptedAt)
        : adoption ? '已撤回 · ' + formatDate(adoption.withdrawnAt) : '已保存草稿';
      const packet = adoption && adoption.withdrawnAt == null ? adoption.packet : note.packet;
      return `<article>
        <div><span class="pmn-meta">${adoptionLabels[note.kind]} · ${esc(status)}</span>
          <h4>${esc(noteTitle(note, packet))}</h4>
          <p>最近编辑 ${esc(formatDate(note.updatedAt))}</p></div>
        <button type="button" class="pmn-link" data-pmn-page="${pageNumber}">定位原讲义第 ${pageNumber} 页</button>
      </article>`;
    }).join('')}
  </section>`;
}

function versionHistory(versions, version, openVersion, esc) {
  if (typeof openVersion !== 'function') return '';
  const siblings = versions.filter(item => item.versionId !== version.versionId && item.name === version.name);
  if (!siblings.length) return '';
  return `<details class="pmn-index" data-pmn-versions>
    <summary>同名课件的其他版本（${siblings.length}）</summary>
    <ul>${siblings.map(item => `<li><button class="pmn-link" type="button"
      data-pmn-version="${esc(item.versionId)}" data-pmn-resume="${item.lastPage}">
      ${esc(formatDate(item.createdAt))} · ${esc(item.versionId.slice(7, 15))} · 从第 ${item.lastPage} 页打开
    </button></li>`).join('')}</ul>
  </details>`;
}

function pageHistory(notes, version, esc) {
  const byPage = new Map();
  for (const note of notes) {
    if (note.kind === 'annotation' && !annotationText(note).trim()) continue;
    const list = byPage.get(note.pageNumber) ?? [];
    list.push(note);
    byPage.set(note.pageNumber, list);
  }
  if (!byPage.size) return '';
  const titles = new Map(version.pages.map(page => [page.number, page.title]));
  return `<details class="pmn-index" data-pmn-pages>
    <summary>本版本的备课记录（${byPage.size} 页）</summary>
    <ul>${Array.from(byPage, ([number, pageNotes]) => {
      const parts = new Set(pageNotes.map(note => ({
        annotation: '批注', 'classroom-reason': '课堂理由', ...adoptionLabels,
      })[note.kind]));
      return `<li><button class="pmn-link" type="button" data-pmn-page="${number}">
        第 ${number} 页${titles.get(number) ? ' · ' + esc(titles.get(number)) : ''} · ${Array.from(parts).join('、')}
      </button></li>`;
    }).join('')}</ul>
  </details>`;
}

function reasonPreview(quote, esc) {
  if (!quote) return '';
  return `<blockquote>${esc(quote.reason)}</blockquote>
    <p class="pmn-meta">第 ${quote.source.round} 轮 · ${esc(quote.optionLabel ?? '')} · ${esc(quote.source.eventId)}</p>`;
}

function classroomPanel({ binding, reference, quotes, selected, notes, goReplay, onUseReason, esc }) {
  const sameClass = binding && reference && ['room', 'roomStartedAt', 'lessonId', 'lessonStartEventId', 'lessonStartedAt']
    .every(key => binding[key] === reference[key]);
  const saved = notes.filter(note => note.kind === 'classroom-reason');
  return `<section class="pmn-card" aria-label="课堂理由">
    <h3>课堂理由</h3>
    ${binding ? `<p class="pmn-meta">课堂 ${esc(binding.room)} · ${esc(binding.lessonTitle)}</p>` : ''}
    ${reference && !sameClass ? `<button class="pmn-button" type="button" data-pmn-bind>
      ${binding ? '改为关联课堂' : '关联此页与课堂'} ${esc(reference.room)}</button>` : ''}
    ${sameClass && goReplay ? '<button type="button" class="pmn-link" data-pmn-replay>查看学情复盘</button>' : ''}
    ${quotes.length ? `<label>选择真实作答理由<select data-pmn-quote>
      ${quotes.map(({ reason, source }) => `<option value="${esc(source.responseId)}"${source.responseId === selected ? ' selected' : ''}>
        第 ${source.round} 轮 · ${esc(reason.slice(0, 32))}${reason.length > 32 ? '…' : ''}
      </option>`).join('')}</select></label>
      <div data-pmn-quote-preview>${reasonPreview(quotes.find(item => item.source.responseId === selected), esc)}</div>
      <button class="pmn-button" type="button" data-pmn-use>${onUseReason ? '选入备课' : '保留到这页'}</button>` : ''}
    ${sameClass && !quotes.length ? '<p class="pmn-meta">这堂课的关联记录暂无真实作答理由。</p>' : ''}
    ${!binding && !reference ? '<p class="pmn-meta">打开这页的课堂记录后，可关联并选用学生提交的理由。</p>' : ''}
    ${binding && !sameClass ? '<p class="pmn-meta">在已关联课堂中可选入其他理由。</p>' : ''}
    ${saved.length ? `<details data-pmn-quotes>
      <summary>已摘录理由（${saved.length}）</summary>
      <ul class="pmn-quotations">${saved.map(note => `<li>
        ${reasonPreview({ ...note.packet, source: note.source }, esc)}
        <p class="pmn-meta">课堂 ${esc(note.source.room)} · ${esc(note.source.lessonTitle)} · ${esc(note.source.responseId)}</p>
        ${onUseReason ? `<button class="pmn-link" type="button" data-pmn-saved-quote="${esc(note.id)}">用这条理由备课</button>` : ''}
      </li>`).join('')}</ul>
    </details>` : ''}
  </section>`;
}

export function renderMaterialNotes(root, {
  notebook, version, pageNumber, classroom, esc, goToPage, openVersion, onNotesChanged, onUseReason, goReplay,
}) {
  mounted.get(root)?.();
  const { versionId } = version;
  const draftKey = versionId + '/' + pageNumber;
  let current = true;
  let busy = false;
  let data;
  let selected = '';
  let notice = '';
  const sectionMarkup = new Map();
  const reference = materialClassroomReference(classroom, versionId, pageNumber);
  const refresh = async () => {
    const [allNotes, versions, binding] = await Promise.all([
      notebook.listNotes(versionId), openVersion ? notebook.listVersions() : [],
      notebook.getPageClassroom(versionId, pageNumber),
    ]);
    if (!current) return;
    const quotes = materialClassroomReasons(classroom, binding);
    if (!quotes.some(quote => quote.source.responseId === selected)) selected = quotes[0]?.source.responseId ?? '';
    data = { allNotes, versions, binding, quotes, notes: allNotes.filter(note => note.pageNumber === pageNumber) };
    draw();
  };

  function status(message, error = false) {
    if (!current) return;
    const line = root.querySelector('[data-pmn-status]');
    line.textContent = message;
    line.classList.toggle('pmn-error', error);
  }

  function draw() {
    const { binding, notes, quotes, allNotes, versions } = data;
    const annotation = notes.find(note => note.kind === 'annotation' && note.source?.type !== 'classroom-review');
    const remembered = annotationDrafts.get(draftKey) ?? annotationText(annotation);
    if (!sectionMarkup.size) {
      root.innerHTML = `<div class="pmn">
        <div class="pmn-columns">
          <form class="pmn-card" data-pmn-annotation>
            <h3>教师批注</h3>
            <label><span class="visually-hidden">第 ${pageNumber} 页的教师批注</span>
              <textarea data-pmn-text rows="3" maxlength="2000" placeholder="给下次讲这一页的自己留一句话"></textarea>
            </label>
            <div class="pmn-actions"><button type="submit" class="pmn-button" data-pmn-save>保存批注</button>
              <span class="pmn-meta" data-pmn-annotation-meta></span></div>
          </form>
          <div data-pmn-classroom style="display:contents"></div>
        </div>
        <p class="pmn-status" data-pmn-status role="status"></p>
        <div data-pmn-history style="display:contents"></div>
      </div>`;
    }
    const field = root.querySelector('[data-pmn-text]');
    if (field.value !== remembered) field.value = remembered;
    const meta = root.querySelector('[data-pmn-annotation-meta]');
    const stamp = '仅本浏览器的备课区' + (annotationText(annotation) ? ' · ' + formatDate(annotation.updatedAt) : '');
    if (meta.textContent !== stamp) meta.textContent = stamp;
    const sections = {
      classroom: classroomPanel({ binding, reference, quotes, selected, notes, goReplay, onUseReason, esc }),
      history: notes.filter(note => note.source?.type === 'classroom-review').map(note => `<section class="pmn-card pmn-review-memory"><h3>本页课堂回流 · 典型物理误区</h3><p>${esc(annotationText(note))}</p><small>原稿第 ${pageNumber} 页 · ${esc(formatDate(note.updatedAt))} · 已锚定</small></section>`).join('') + savedDrafts(notes, esc, pageNumber) + pageHistory(allNotes, version, esc) +
        versionHistory(versions, version, openVersion, esc),
    };
    for (const [name, html] of Object.entries(sections)) {
      if (sectionMarkup.get(name) === html) continue;
      const section = root.querySelector('[data-pmn-' + name + ']');
      const opened = ['versions', 'pages', 'quotes'].filter(key => section.querySelector('[data-pmn-' + key + ']')?.open);
      section.innerHTML = html;
      sectionMarkup.set(name, html);
      for (const key of opened) {
        const details = section.querySelector('[data-pmn-' + key + ']');
        if (details) details.open = true;
      }
    }
    status(notice);
  }

  async function save(operation, message, afterSave) {
    if (busy) return;
    busy = true;
    status('正在保存…');
    try {
      const value = await operation();
      if (!current) return;
      notice = message;
      await refresh();
      if (!current) return;
      await onNotesChanged?.(pageNumber, data.notes);
      if (current) await afterSave?.(value);
    } catch (error) {
      status(error?.message ?? '保存失败，请重试。', true);
    } finally {
      busy = false;
    }
  }

  function submit(event) {
    if (!event.target.matches('[data-pmn-annotation]')) return;
    event.preventDefault();
    const text = event.target.querySelector('[data-pmn-text]').value;
    void save(async () => {
      const result = await notebook.savePageNote(versionId, pageNumber, {
        id: 'annotation', kind: 'annotation', packet: { text },
      });
      if (annotationDrafts.get(draftKey) === text) annotationDrafts.delete(draftKey);
      return result;
    }, '教师批注已保存。');
  }

  function input({ target }) {
    if (target.matches('[data-pmn-text]')) annotationDrafts.set(draftKey, target.value);
  }

  function change({ target }) {
    if (!target.matches('[data-pmn-quote]')) return;
    selected = target.value;
    root.querySelector('[data-pmn-quote-preview]').innerHTML =
      reasonPreview(data.quotes.find(item => item.source.responseId === selected), esc);
  }

  function click(event) {
    const button = event.target.closest('button');
    if (!button || !data) return;
    const { pmnPage, pmnVersion, pmnResume, pmnSavedQuote } = button.dataset;
    if (pmnPage) return goToPage(Number(pmnPage), { focus: true });
    if (pmnVersion) return openVersion?.(pmnVersion, Number(pmnResume));
    if (button.hasAttribute('data-pmn-replay')) return goReplay?.();
    if (button.hasAttribute('data-pmn-bind')) {
      return void save(() => notebook.bindPageClassroom(versionId, pageNumber, classroom), '课堂已关联到这页。');
    }
    if (button.hasAttribute('data-pmn-use')) {
      return void save(() => notebook.saveClassroomReason(versionId, pageNumber, classroom, selected),
        '课堂理由已摘录。', value => onUseReason?.(value));
    }
    if (pmnSavedQuote) {
      const quote = data.notes.find(note => note.id === pmnSavedQuote);
      if (quote && onUseReason) {
        void Promise.resolve().then(() => onUseReason({ ...quote.packet, source: quote.source })).catch(error =>
          status(error?.message ?? '无法打开备课稿。', true));
      }
    }
  }

  function cleanup() {
    current = false;
    root.removeEventListener('submit', submit);
    root.removeEventListener('input', input);
    root.removeEventListener('change', change);
    root.removeEventListener('click', click);
    if (mounted.get(root) === cleanup) mounted.delete(root);
  }

  root.innerHTML = '<p class="pmn-status" data-pmn-status role="status">正在读取备课记录…</p>';
  root.addEventListener('submit', submit);
  root.addEventListener('input', input);
  root.addEventListener('change', change);
  root.addEventListener('click', click);
  mounted.set(root, cleanup);
  void refresh().catch(error => status(error?.message ?? '无法读取备课记录。', true));
  return cleanup;
}
