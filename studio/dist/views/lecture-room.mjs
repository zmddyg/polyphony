import { renderLectureFrame } from './lecture-stage.mjs';
import { renderDesk } from './desk.mjs';
import { renderStudent } from './student.mjs';
import { renderStage } from './surfaces.mjs';
import { challengeNames } from '../core/challenge-lab.mjs';
import { challengeForFrame } from '../core/lecture-planner.mjs';
import { createMaterialNotebook } from '../core/material-notebook.mjs';
import { renderChallenge } from './challenge-lab.mjs';

const rooms = new WeakMap();
const experiments = new WeakMap();
const resultSteps = new Set(['solved', 'tested', 'refit']);
const frameCache = new Map();
const outlineCache = new Map();
const notebook = createMaterialNotebook();
let activeOutlineController = null;

function cacheFrame(code, index, frame) {
  const key = `${code}:${index}`;
  frameCache.delete(key);
  frameCache.set(key, frame);
  while (frameCache.size > 32) frameCache.delete(frameCache.keys().next().value);
}

function loadFrameCached(ctx, code, index) {
  const key = `${code}:${index}`;
  if (frameCache.has(key)) return Promise.resolve(frameCache.get(key));
  return ctx.getFrame(index).then(frame => {
    cacheFrame(code, index, frame);
    return frame;
  });
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function fullscreen(root, ctx) {
  if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
  if (!root.requestFullscreen) { ctx.toast('当前浏览器没有提供全屏功能。'); return; }
  root.requestFullscreen().catch(() => ctx.toast('浏览器未能进入全屏。'));
}

export function renderLectureRoom(root, ctx, role) {
  const lecture = ctx.state.lecture;
  const teacher = role === 'teacher';
  const { esc, icon } = ctx;
  const button = (action, label, glyph, extra = '') =>
    `<button type="button" data-lecture-action="${action}" class="plain-button" ${extra}>${icon(glyph, 17)}<span>${esc(label)}</span></button>`;

  async function command(type, payload, current = ctx) {
    try { return await current.command(type, payload); }
    catch (error) { current.toast(error.message); return null; }
  }

  if (lecture.mode === 'experiment' && ctx.state.experiment) {
    activeOutlineController = null;
    const scope = ctx.state.code + '-' + role;
    let experiment = experiments.get(root.firstElementChild);
    if (!experiment || experiment.scope !== scope) {
      root.innerHTML = `<section class="cx-live"><header class="lecture-backbar"><span data-experiment-anchor></span>` +
        (teacher ? `<div class="lecture-bar-actions">${button('stage', '打开投影', 'monitor')}${button('invite', '邀请学生', 'users')}${button('resume', '返回讲义', 'arrow-left')}</div>` : '') +
        `</header><div data-lecture-challenge></div></section>`;
      experiment = {
        scope,
        holder: root.querySelector('[data-lecture-challenge]'),
        anchor: root.querySelector('[data-experiment-anchor]'),
      };
      if (teacher) {
        root.querySelector('[data-lecture-action="resume"]').onclick = () => command('lectureResume', undefined, experiment.ctx);
        root.querySelector('[data-lecture-action="stage"]').onclick = () => experiment.ctx.open('stage');
        root.querySelector('[data-lecture-action="invite"]').onclick = () => experiment.ctx.invite();
      }
      experiments.set(root.firstElementChild, experiment);
    }
    experiment.ctx = ctx;
    const anchor = `${lecture.title} · 原稿第 ${lecture.pageNumber} 页`;
    if (experiment.anchor.textContent !== anchor) experiment.anchor.textContent = anchor;
    const challenge = ctx.state.experiment;
    const resultKey = resultSteps.has(challenge.step) ? `${lecture.index}-${lecture.turn}-${challenge.step}` : null;
    if (resultKey !== null && experiment.resultKey === resultKey) return;
    renderChallenge(experiment.holder, challenge, {
      role, turn: lecture.turn, action: payload => command('lectureExperimentAct', payload),
      vote: choice => command('experimentVote', { choice }), askPeer: ctx.askPeer, report: ctx.toast,
    });
    experiment.resultKey = resultKey;
    return;
  }

  if (lecture.mode === 'activity') {
    activeOutlineController = null;
    if (!teacher) return role === 'student' ? renderStudent(root, ctx) : renderStage(root, ctx);
    if (!root.querySelector('[data-lecture-activity]')) {
      root.innerHTML = `<div class="lecture-backbar">${button('resume', '返回讲义', 'arrow-left')}<span data-activity-anchor></span></div><div data-lecture-activity></div>`;
    }
    root.querySelector('[data-activity-anchor]').textContent = `原稿第 ${lecture.pageNumber} 页`;
    root.querySelector('[data-lecture-action="resume"]').onclick = () => command('lectureResume');
    return renderDesk(root.querySelector('[data-lecture-activity]'), ctx);
  }

  if (lecture.mode === 'ended') {
    activeOutlineController = null;
    root.innerHTML = `<section class="lecture-ended"><h1>本节课已结束</h1><p>${esc(lecture.title)}</p>` +
      (teacher ? button('review', '查看课堂回顾', 'replay') + button('materials', '回到讲义备课', 'book') : '') +
      `</section>`;
    if (teacher) {
      root.querySelector('[data-lecture-action="review"]').onclick = () => ctx.go('replay');
      root.querySelector('[data-lecture-action="materials"]').onclick = () => ctx.go('materials');
    }
    return;
  }

  const scope = `${ctx.state.code}:${role}`;
  let view = rooms.get(root);
  if (!view || view.scope !== scope || view.shell !== root.firstElementChild) {
    if (view?.timerInterval) clearInterval(view.timerInterval);
    const defaultRailOpen = teacher && window.matchMedia('(min-width: 980px)').matches;
    root.innerHTML = `<div class="lecture-room lecture-room--${role}${defaultRailOpen ? ' has-presenter-rail' : ''}">
      <header class="lecture-room-bar">
        <div class="lecture-bar-title">
          <b data-lecture-title>${esc(lecture.title)}</b>
          ${teacher
            ? `<button type="button" class="lecture-page-pill" data-lecture-action="outline" aria-haspopup="dialog" aria-expanded="false" title="打开目录快速跳页（快捷键 G）">
                ${icon('list', 15)}<span data-lecture-meta></span>${icon('chevron-down', 13)}
              </button>`
            : `<span class="lecture-page-meta" data-lecture-meta></span>`}
        </div>
        <div class="lecture-bar-actions">
          ${teacher ? button('presenter', '讲台栏', 'layers', `aria-pressed="${defaultRailOpen}"`) : ''}
          ${teacher && ctx.remotePair ? button('remote', '手机遥控', 'smartphone') : ''}
          ${teacher ? button('stage', '打开投影', 'monitor') + button('invite', '邀请学生', 'users') : ''}
          ${role === 'student' ? `<button type="button" class="plain-button lecture-pulse-btn" data-lecture-action="pulse" aria-pressed="false">${icon('help', 16)}<span>这页有疑问</span></button>` : ''}
          ${role !== 'student' ? button('fullscreen', '全屏', 'maximize') : ''}
        </div>
      </header>
      <div class="lecture-workspace">
        <div class="lecture-stage-column">
          <div data-lecture-frame class="lecture-frame-slot" aria-live="polite"><p role="status">正在载入授课页…</p></div>
        </div>
        ${teacher ? `<aside class="lecture-presenter-rail" data-presenter-rail${defaultRailOpen ? '' : ' hidden'} aria-label="教师讲台辅助栏">
          <section class="presenter-card presenter-stats" aria-label="课堂实时状态">
            <div><span>在线学生</span><strong data-presenter-students>0</strong></div>
            <div><span>本页有疑问</span><strong data-presenter-pulses>0</strong></div>
            <div class="presenter-clock-box">
              <span>授课计时</span>
              <strong data-presenter-clock>00:00</strong>
              <div class="presenter-clock-controls">
                <button type="button" data-presenter-clock-toggle aria-label="暂停或继续计时">暂停</button>
                <button type="button" data-presenter-clock-reset aria-label="重置计时">重置</button>
              </div>
            </div>
          </section>
          <section class="presenter-card presenter-notes" aria-label="本页教师批注">
            <header><h3>本页私有批注</h3><span data-note-status>仅教师可见</span></header>
            <textarea data-presenter-note rows="5" placeholder="可在此记录本页讲解提示、过渡语或板书要点（仅自己可见）…"></textarea>
            <div class="presenter-note-actions">
              <button type="button" class="plain-button" data-presenter-note-save>保存批注</button>
            </div>
          </section>
          <section class="presenter-card presenter-next" aria-label="下一页预览">
            <header><h3>下一页预览</h3><span data-next-label></span></header>
            <div class="presenter-next-body" data-presenter-next>正在预载…</div>
          </section>
        </aside>` : ''}
      </div>
      ${teacher ? `<footer class="lecture-pager">
        ${button('previous', '上一页', 'arrow-left')}
        ${button('next', '下一页', 'arrow-right')}
        ${button('interact', '开启本页互动', 'users', 'hidden')}
        ${button('experiment', '开启本页实验', 'target', 'hidden')}
        ${button('finish', '结束授课', 'check')}
      </footer>` : ''}
      ${teacher ? `<div class="lecture-outline-backdrop" data-outline-backdrop hidden>
        <section class="lecture-outline-drawer" role="dialog" aria-modal="true" aria-labelledby="lecture-outline-title">
          <header class="lecture-outline-head">
            <h2 id="lecture-outline-title">课件目录（共 ${lecture.total} 页）</h2>
            <button type="button" class="icon-button" data-outline-close aria-label="关闭目录">${icon('close', 18)}</button>
          </header>
          <div class="lecture-outline-list" data-outline-list>正在加载目录…</div>
        </section>
      </div>` : ''}
    </div>`;

    view = {
      scope,
      shell: root.firstElementChild,
      ctx,
      renderedIndex: -1,
      failedIndex: -1,
      requestId: 0,
      noteKey: '',
      noteDirty: false,
      railOpen: defaultRailOpen,
      outlineOpen: false,
      clockRunning: true,
      clockElapsed: 0,
      clockStartedAt: Date.now(),
      holder: root.querySelector('[data-lecture-frame]'),
      meta: root.querySelector('[data-lecture-meta]'),
      prevBtn: root.querySelector('[data-lecture-action="previous"]'),
      nextBtn: root.querySelector('[data-lecture-action="next"]'),
      interactBtn: root.querySelector('[data-lecture-action="interact"]'),
      experimentBtn: root.querySelector('[data-lecture-action="experiment"]'),
      pulseBtn: root.querySelector('[data-lecture-action="pulse"]'),
      rail: root.querySelector('[data-presenter-rail]'),
      studentsEl: root.querySelector('[data-presenter-students]'),
      pulsesEl: root.querySelector('[data-presenter-pulses]'),
      clockEl: root.querySelector('[data-presenter-clock]'),
      clockToggleBtn: root.querySelector('[data-presenter-clock-toggle]'),
      noteArea: root.querySelector('[data-presenter-note]'),
      noteStatus: root.querySelector('[data-note-status]'),
      noteSaveBtn: root.querySelector('[data-presenter-note-save]'),
      nextLabel: root.querySelector('[data-next-label]'),
      nextBody: root.querySelector('[data-presenter-next]'),
      outlineBackdrop: root.querySelector('[data-outline-backdrop]'),
      outlineList: root.querySelector('[data-outline-list]'),
      outlineTrigger: root.querySelector('[data-lecture-action="outline"]'),
      presenterToggle: root.querySelector('[data-lecture-action="presenter"]'),
    };
    rooms.set(root, view);

    const navigate = targetIndex => {
      const current = view.ctx.state.lecture;
      if (targetIndex >= 0 && targetIndex < current.total && targetIndex !== current.index) {
        return command('lectureNavigate', { index: targetIndex }, view.ctx);
      }
    };

    const setOutlineOpen = async open => {
      if (!teacher || !view.outlineBackdrop) return;
      view.outlineOpen = Boolean(open);
      view.outlineBackdrop.hidden = !view.outlineOpen;
      view.outlineTrigger?.setAttribute('aria-expanded', String(view.outlineOpen));
      if (!view.outlineOpen) {
        view.outlineTrigger?.focus?.({ preventScroll: true });
        return;
      }
      renderOutline();
      const closeBtn = view.outlineBackdrop.querySelector('[data-outline-close]');
      closeBtn?.focus?.({ preventScroll: true });
    };

    const renderOutline = async () => {
      if (!view.outlineList) return;
      const code = view.ctx.state.code;
      let items = outlineCache.get(code);
      if (!items) {
        view.outlineList.innerHTML = '<p class="lecture-outline-empty">正在读取课件目录…</p>';
        try {
          const raw = await view.ctx.getOutline();
          items = Array.isArray(raw) ? raw : (raw?.items ?? []);
          if (items.length) outlineCache.set(code, items);
        } catch (error) {
          view.outlineList.innerHTML = `<p class="lecture-outline-empty" role="alert">${esc(error.message)}</p>`;
          return;
        }
      }
      if (!view.outlineList.isConnected) return;
      const current = view.ctx.state.lecture;
      const pulses = view.ctx.state.pulseCounts ?? {};
      view.outlineList.innerHTML = (items ?? []).map(item => {
        const active = item.index === current.index;
        const confused = pulses[item.pageNumber] ?? 0;
        const expKind = item.experiment?.kind ?? item.experimentKind;
        return `<button type="button" class="lecture-outline-item${active ? ' is-active' : ''}" data-outline-index="${item.index}" ${active ? 'aria-current="true"' : ''}>
          <span class="outline-num">${item.index + 1}</span>
          <span class="outline-main">
            <strong>${esc(item.title)}</strong>
            <small>原稿第 ${item.pageNumber} 页${item.supplemental ? ' · 补充讲解' : ''}</small>
          </span>
          <span class="outline-badges">
            ${item.hasInteraction ? '<em class="badge-interact">互动</em>' : ''}
            ${expKind ? `<em class="badge-exp">${esc(challengeNames[expKind] ?? '实验')}</em>` : ''}
            ${confused > 0 ? `<em class="badge-pulse">${confused} 疑问</em>` : ''}
          </span>
        </button>`;
      }).join('');
    };

    view.setOutlineOpen = setOutlineOpen;
    view.renderOutline = renderOutline;

    root.querySelector('[data-lecture-action="fullscreen"]')?.addEventListener('click', () => fullscreen(root, view.ctx));

    if (role === 'student' && view.pulseBtn) {
      view.pulseBtn.onclick = async () => {
        const nextConfused = !view.ctx.state.myPulse;
        view.pulseBtn.disabled = true;
        try {
          await command('lecturePulse', { confused: nextConfused }, view.ctx);
        } finally {
          if (view.pulseBtn.isConnected) view.pulseBtn.disabled = false;
        }
      };
    }

    if (teacher) {
      view.prevBtn.onclick = () => navigate(view.ctx.state.lecture.index - 1);
      view.nextBtn.onclick = () => navigate(view.ctx.state.lecture.index + 1);
      root.querySelector('[data-lecture-action="stage"]').onclick = () => view.ctx.open('stage');
      root.querySelector('[data-lecture-action="invite"]').onclick = () => view.ctx.invite();
      root.querySelector('[data-lecture-action="remote"]')?.addEventListener('click', () => view.ctx.remotePair?.());
      view.outlineTrigger.onclick = () => setOutlineOpen(!view.outlineOpen);
      view.outlineBackdrop.querySelector('[data-outline-close]').onclick = () => setOutlineOpen(false);
      view.outlineBackdrop.onclick = event => {
        if (event.target === view.outlineBackdrop) void setOutlineOpen(false);
      };
      view.outlineList.onclick = event => {
        const btn = event.target.closest('[data-outline-index]');
        if (!btn) return;
        const targetIndex = Number(btn.dataset.outlineIndex);
        void setOutlineOpen(false);
        void navigate(targetIndex);
      };
      view.presenterToggle.onclick = () => {
        view.railOpen = !view.railOpen;
        view.rail.hidden = !view.railOpen;
        view.shell.classList.toggle('has-presenter-rail', view.railOpen);
        view.presenterToggle.setAttribute('aria-pressed', String(view.railOpen));
      };
      view.interactBtn.onclick = () => {
        const cur = view.ctx.state.lecture;
        const closed = view.ctx.state.lectureArchive?.some(item => item.pageNumber === cur.pageNumber && item.phase === 'closed');
        return closed ? view.ctx.go('replay') : command('lectureInteract', undefined, view.ctx);
      };
      view.experimentBtn.onclick = () => command('lectureExperimentStart', undefined, view.ctx);
      root.querySelector('[data-lecture-action="finish"]').onclick = async () => {
        const confirmed = await view.ctx.confirmDialog({
          title: '结束本节讲义授课？',
          message: '结束后学生端将停止接收作答，全部互动记录、实验与困惑页热点将自动保留在课堂回顾中。',
          confirmLabel: '结束授课',
          cancelLabel: '继续授课',
        });
        if (confirmed) await command('lectureFinish', undefined, view.ctx);
      };

      const paintClock = () => {
        if (!view.clockEl?.isConnected) return;
        const total = view.clockElapsed + (view.clockRunning ? (Date.now() - view.clockStartedAt) / 1000 : 0);
        view.clockEl.textContent = formatClock(total);
      };
      view.timerInterval = setInterval(paintClock, 1000);
      view.clockToggleBtn.onclick = () => {
        if (view.clockRunning) {
          view.clockElapsed += (Date.now() - view.clockStartedAt) / 1000;
          view.clockRunning = false;
          view.clockToggleBtn.textContent = '继续';
        } else {
          view.clockStartedAt = Date.now();
          view.clockRunning = true;
          view.clockToggleBtn.textContent = '暂停';
        }
        paintClock();
      };
      root.querySelector('[data-presenter-clock-reset]').onclick = () => {
        view.clockElapsed = 0;
        view.clockStartedAt = Date.now();
        paintClock();
      };

      view.noteArea.addEventListener('input', () => {
        view.noteDirty = true;
        view.noteStatus.textContent = '未保存';
      });
      view.noteSaveBtn.onclick = async () => {
        const cur = view.ctx.state.lecture;
        if (!cur?.sourceVersion) return;
        view.noteSaveBtn.disabled = true;
        try {
          await notebook.savePageNote(cur.sourceVersion, cur.pageNumber, {
            id: 'annotation',
            kind: 'annotation',
            packet: { text: view.noteArea.value.trim() },
            source: { type: 'presenter-rail' },
          });
          view.noteDirty = false;
          view.noteStatus.textContent = '已保存';
          view.ctx.toast('本页批注已保存');
        } catch {
          view.noteStatus.textContent = '本机未缓存原课件，仅会话内保留';
        } finally {
          if (view.noteSaveBtn.isConnected) view.noteSaveBtn.disabled = false;
        }
      };
    }
  }

  view.ctx = ctx;
  if (teacher) {
    activeOutlineController = {
      isOpen: () => Boolean(view.shell.isConnected && view.outlineOpen),
      toggle: () => view.setOutlineOpen(!view.outlineOpen),
      close: () => view.setOutlineOpen(false),
    };
  }

  const metaText = `原稿第 ${lecture.pageNumber} 页${lecture.supplemental ? ' · 补充讲解' : ''}　${lecture.index + 1} / ${lecture.total}`;
  if (view.meta.textContent !== metaText) view.meta.textContent = metaText;

  if (role === 'student' && view.pulseBtn) {
    const active = Boolean(ctx.state.myPulse);
    view.pulseBtn.setAttribute('aria-pressed', String(active));
    view.pulseBtn.classList.toggle('is-active', active);
    view.pulseBtn.querySelector('span').textContent = active ? '已标记有疑问' : '这页有疑问';
  }

  if (teacher) {
    view.prevBtn.disabled = lecture.index === 0;
    view.nextBtn.disabled = lecture.index === lecture.total - 1;
    view.interactBtn.hidden = !lecture.hasInteraction;
    if (lecture.hasInteraction) {
      const closed = ctx.state.lectureArchive?.some(item => item.pageNumber === lecture.pageNumber && item.phase === 'closed');
      view.interactBtn.querySelector('span').textContent = closed ? '查看本页互动记录' : '开启本页互动';
    }
    const online = (ctx.state.participants ?? []).filter(p => !p.simulated).length;
    view.studentsEl.textContent = String(online);
    const pulseCount = ctx.state.pulseCounts?.[lecture.pageNumber] ?? 0;
    view.pulsesEl.textContent = String(pulseCount);
    view.pulsesEl.classList.toggle('has-pulses', pulseCount > 0);
    if (view.outlineOpen) void view.renderOutline();

    const noteKey = `${lecture.sourceVersion ?? ''}:${lecture.pageNumber}`;
    if (view.noteKey !== noteKey) {
      view.noteKey = noteKey;
      view.noteDirty = false;
      view.noteArea.value = '';
      view.noteStatus.textContent = '仅教师可见';
      if (lecture.sourceVersion) {
        notebook.getPageNotes(lecture.sourceVersion, lecture.pageNumber).then(notes => {
          if (view.noteKey !== noteKey || view.noteDirty || !view.noteArea.isConnected) return;
          const privateNote = notes.find(item => item.kind === 'annotation');
          const text = privateNote?.packet?.text ?? '';
          view.noteArea.value = text;
          view.noteStatus.textContent = text ? '来自备课本' : '仅教师可见';
        }).catch(() => {});
      }
    }
  }

  if (view.renderedIndex !== lecture.index || view.failedIndex === lecture.index) {
    const req = ++view.requestId;
    const targetIndex = lecture.index;
    view.holder.classList.add('is-loading');
    loadFrameCached(ctx, ctx.state.code, targetIndex).then(frame => {
      if (!view.holder.isConnected || view.requestId !== req) return;
      view.renderedIndex = targetIndex;
      view.failedIndex = -1;
      view.holder.classList.remove('is-loading');
      renderLectureFrame(view.holder, frame, { compact: role === 'student' });
      if (teacher && view.experimentBtn) {
        const kind = challengeForFrame(frame);
        if (kind) {
          view.experimentBtn.querySelector('span').textContent = challengeNames[kind] ?? '开启本页实验';
          view.experimentBtn.hidden = false;
        } else {
          view.experimentBtn.hidden = true;
        }
      }
    }).catch(error => {
      if (!view.holder.isConnected || view.requestId !== req) return;
      view.failedIndex = targetIndex;
      view.holder.classList.remove('is-loading');
      view.holder.innerHTML = `<p role="alert">${esc(error.message)}</p>${button('retry', '重新载入', 'replay')}`;
      view.holder.querySelector('button').onclick = () => renderLectureRoom(root, view.ctx, role);
    });

    if (teacher && view.nextBody) {
      const nextIndex = targetIndex + 1;
      if (nextIndex >= lecture.total) {
        view.nextLabel.textContent = '末页';
        view.nextBody.innerHTML = '<p class="presenter-next-empty">已是本节课最后一页。</p>';
      } else {
        view.nextLabel.textContent = `第 ${nextIndex + 1} / ${lecture.total} 页`;
        view.nextBody.innerHTML = '<p class="presenter-next-empty">正在预载下一页…</p>';
        loadFrameCached(ctx, ctx.state.code, nextIndex).then(nextFrame => {
          if (!view.nextBody.isConnected || view.requestId !== req) return;
          const snippet = (nextFrame.body ?? []).slice(0, 2).join(' ').slice(0, 140);
          view.nextBody.innerHTML = `
            <div class="presenter-next-card">
              <strong>${esc(nextFrame.title)}</strong>
              ${nextFrame.preview ? `<img src="${esc(nextFrame.preview)}" alt="${esc('下一页预览：' + nextFrame.title)}" decoding="async">` : ''}
              ${!nextFrame.preview && snippet ? `<p>${esc(snippet)}</p>` : ''}
              ${nextFrame.hasInteraction ? '<span class="presenter-next-badge">含课堂互动</span>' : ''}
            </div>`;
        }).catch(() => {
          if (view.nextBody.isConnected && view.requestId === req) {
            view.nextBody.innerHTML = '<p class="presenter-next-empty">下一页将在翻页后载入。</p>';
          }
        });
      }
    }
  }

  return () => {
    // Keep persistent shell & clock interval alive across incremental state updates; clean up if root unmounts.
    if (!view.shell.isConnected && view.timerInterval) {
      clearInterval(view.timerInterval);
      view.timerInterval = null;
    }
  };
}

export function lectureKeyboard(event, ctx) {
  const lecture = ctx.state.lecture;
  if (lecture?.mode !== 'slides' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
      document.querySelector('dialog[open]') || event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  if (event.key === 'Escape' && activeOutlineController?.isOpen()) {
    event.preventDefault();
    activeOutlineController.close();
    return;
  }
  if ((event.key === 'g' || event.key === 'G') && activeOutlineController) {
    event.preventDefault();
    if (!event.repeat) activeOutlineController.toggle();
    return;
  }
  if (activeOutlineController?.isOpen()) return;
  if (event.key === ' ' && event.target?.closest?.('button,a,summary')) return;
  const offsets = { ArrowRight: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, PageUp: -1 };
  if (!Object.hasOwn(offsets, event.key)) return;
  event.preventDefault();
  if (event.repeat) return;
  const index = lecture.index + offsets[event.key];
  if (index >= 0 && index < lecture.total) ctx.command('lectureNavigate', { index }).catch(error => ctx.toast(error.message));
}
