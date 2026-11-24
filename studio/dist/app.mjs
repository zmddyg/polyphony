import { openSession } from './core/transport.mjs';
import { lessons, getLesson } from './core/catalog.mjs';
import { activities, getActivity } from './core/activities.mjs';
import { exportScore, importScore } from './core/score-package.mjs';
import { icon, esc, viewStyles } from './ui.mjs';

const app = document.querySelector('#app');
const overlays = document.querySelector('#overlays');
const liveMessage = document.querySelector('#toast');
const titles = {materials:'讲义备课',desk:'课堂控制台',workshop:'AI 备课',lab:'学科实验',replay:'课堂回顾',system:'系统架构',student:'学生端',stage:'投影大屏'};
const teacherViews = ['materials','desk','workshop','lab','replay','system'];
const query = new URL(location.href).searchParams;
let view = Object.hasOwn(titles,query.get('view')) ? query.get('view') : (query.has('room')?'desk':'materials');
let labTab = query.get('tab') || null;
let session, unsubscribe, offStatus, cleanup, toastTimer, restoreFocus;
let pendingPage, lectureKeyboard, architectureUrl, qrScript;
let generation = 0;
let publishingLesson = false;
let railOpen = false;
const mobileShell = matchMedia('(max-width: 850px)');
const roleFor = v => v === 'stage' || v === 'student' ? v : 'teacher';
const brand = '<img class="shell-brand-mark" src="./assets/mark.svg" alt="" width="40" height="40"><span class="shell-brand-name"><b>共演</b><span>Polyphony</span></span>';
const readStorage = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeStorage = (key, value) => { try { localStorage.setItem(key,JSON.stringify(value)); } catch { /* Browser storage may be full. */ } };

function toast(message) {
  clearTimeout(toastTimer);
  liveMessage.textContent = message;
  liveMessage.classList.add('visible');
  toastTimer = setTimeout(() => liveMessage.classList.remove('visible'),3400);
}

function localize(error) {
  const detail = error?.message || String(error);
  if (/passphrase|口令/i.test(detail)) return '需要输入教师口令才能创建课堂或执行此操作。';
  if (/pairing token|配对/i.test(detail)) return '遥控配对链接已失效或已被使用，请在讲台电脑上重新生成。';
  if (/teacher desk|teacher session|teacher credential|teacher access/i.test(detail)) return '请回到创建这间课堂的浏览器打开教师台，或在讲台电脑上使用「手机遥控」扫码接管。';
  if (/unavailable in this browser/i.test(detail)) return '这个浏览器里没有这间排练室，请从创建课堂的同一浏览器打开。';
  if (/valid six|room code/i.test(detail)) return '请输入六位课堂码。';
  if (/room not found|unknown room|no such room/i.test(detail)) return '没有找到这间课堂，请核对课堂码或重新打开邀请链接。';
  if (/failed to fetch|networkerror|classroom server is unavailable/i.test(detail)) return '暂时连不上课堂服务，请检查网络后再试。';
  return detail;
}

function recentRooms() {
  const rooms = readStorage('polyphony.recent.v1', []);
  return Array.isArray(rooms) ? rooms.filter(room => room?.code && room.title) : [];
}
function remember() {
  if (!session || roleFor(view) !== 'teacher') return;
  const {code,lesson,phase,demo} = session.state;
  const entry = {code,title:session.state.lecture?.title||lesson.title,phase,demo,mode:session.mode,at:Date.now()};
  const records = recentRooms();
  if (records[0]?.code === code && records[0].phase === phase && records[0].title === entry.title &&
      records[0].mode === entry.mode && records[0].demo === demo) return;
  writeStorage('polyphony.recent.v1',[entry,...records.filter(item => item.code !== code)].slice(0,16));
}

function setAddress(v, code, replace = false, tab = null) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view',v);
  if (code) url.searchParams.set('room',code);
  if (v === 'lab' && tab) url.searchParams.set('tab',tab);
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState']({},'',url);
}

function focusSelector(element) {
  if (element?.id) return '#' + CSS.escape(element.id);
  for (const key of ['data-focus', 'data-desk-action', 'data-desk-branch']) {
    const value = element?.getAttribute?.(key);
    if (value) return '[' + key + '=' + CSS.escape(value) + ']';
  }
  return null;
}

function closeModal() {
  const dialog = overlays.querySelector('dialog');
  if (!dialog) return;
  dialog.close();
  dialog.remove();
  const origin = restoreFocus?.element;
  const replacement = restoreFocus?.selector && app.querySelector(restoreFocus.selector);
  (origin?.isConnected ? origin : replacement)?.focus?.({preventScroll:true});
  restoreFocus = null;
}

function modal(title, html) {
  closeModal();
  restoreFocus = {element: document.activeElement, selector: focusSelector(document.activeElement)};
  overlays.innerHTML = '<dialog class="overlay-dialog" aria-labelledby="app-dialog-title"><div class="dialog-head"><h2 id="app-dialog-title">'+esc(title)+'</h2><button type="button" class="icon-button" aria-label="关闭对话框" data-dismiss>'+icon('close',20)+'</button></div>'+html+'</dialog>';
  const dialog = overlays.firstElementChild;
  const dismiss = () => { if (dialog.getAttribute('aria-busy') !== 'true') closeModal(); };
  dialog.querySelector('[data-dismiss]').addEventListener('click',dismiss);
  dialog.addEventListener('cancel',e => { e.preventDefault(); dismiss(); });
  dialog.addEventListener('click',e => {
    if (e.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) dismiss();
  });
  dialog.showModal();
  return dialog;
}

async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement('textarea');
    const focus = document.activeElement;
    field.style.cssText='position:fixed;opacity:0';
    field.value=value;
    (overlays.querySelector('dialog')||document.body).append(field);
    field.select();
    try { return document.execCommand('copy'); }
    catch { return false; }
    finally {
      field.remove();
      focus?.focus?.({preventScroll:true});
    }
  }
}

function localSurfaceUrl(v) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view',v);
  url.searchParams.set('room',session.code);
  return url.href;
}

function openSurface(v) {
  if (!['stage','student'].includes(v)) return;
  window.open(localSurfaceUrl(v),'_blank','noopener');
}

function qrGenerator() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return qrScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './assets/qr.js';
    script.onload = () => resolve(window.qrcode);
    script.onerror = () => {
      script.remove();
      qrScript = undefined;
      reject(new Error('二维码加载失败。'));
    };
    document.head.append(script);
  });
}

async function renderInviteCode(dialog, url) {
  const target = dialog.querySelector('#room-qr');
  target.setAttribute('aria-busy', 'true');
  try {
    const makeCode = await qrGenerator();
    if (!dialog.isConnected) return;
    const qr = makeCode(0, 'M');
    qr.addData(url);
    qr.make();
    target.innerHTML = qr.createSvgTag({cellSize:4,margin:16,scalable:true});
  } catch {
    target.hidden = true;
    const fallback = dialog.querySelector('[data-qr-fallback]');
    if (fallback) fallback.hidden = false;
  } finally {
    target.removeAttribute('aria-busy');
  }
}

function invite() {
  const local = session.mode === 'local';
  const projected = !local && view === 'stage';
  const url = session.url('student');
  const code = session.code;
  const body = `
    <p class="dialog-intro">${local ? '在同一浏览器打开学生端，即可体验作答和投影联动。'
      : projected ? '用手机扫描二维码，进入本节课。'
      : '学生可扫码或打开链接加入课堂。使用局域网时，请先连入同一网络。'}</p>
    <div class="invite-layout">
      ${local ? '<div class="invite-symbol">' + icon('smartphone', 40) + '</div>' : '<div id="room-qr" class="room-qr" role="img" aria-label="学生加入二维码"></div>'}
      <div><span class="field-caption">课堂码</span><div class="invite-code">${esc(code)}</div>
        <button class="text-button" type="button" data-copy-code>${icon('copy',14)}复制课堂码</button></div>
    </div>
    ${projected ? `<p class="dialog-intro stage-invite-fallback" data-qr-fallback hidden>可在学生端输入上方课堂码，或<a class="text-button" href="${esc(url)}" target="_blank" rel="noopener">打开学生加入链接</a>。</p>` : ''}
    ${local || projected ? '' : `<label class="field-caption" for="join-link">学生链接</label><div class="input-line">
      <input id="join-link" readonly value="${esc(url)}"><button type="button" class="plain-button" data-copy-link>复制链接</button></div>`}
    ${projected ? '' : `<button type="button" class="action-primary dialog-full" data-open-student>${icon('smartphone',17)}打开学生端${icon('arrow-up-right',16)}</button>`}
    <p class="dialog-feedback" data-copy-status role="status"></p>`;
  const dialog = modal('邀请学生',body);
  dialog.classList.toggle('overlay-stage-invite', projected);
  if (!local) void renderInviteCode(dialog, url);
  const feedback = dialog.querySelector('[data-copy-status]');
  const copyWithFeedback = async (value, label) => {
    const copied = await copy(value);
    feedback.dataset.kind = copied ? 'success' : 'error';
    feedback.textContent = copied ? '已复制' + label : '请选中' + label + '并手动复制。';
  };
  dialog.querySelector('[data-copy-code]').onclick = () => copyWithFeedback(code, '课堂码');
  dialog.querySelector('[data-copy-link]')?.addEventListener('click', () => copyWithFeedback(url, '学生链接'));
  dialog.querySelector('[data-open-student]')?.addEventListener('click', () => openSurface('student'));
}

function confirmDialog({ title = '确认操作', message = '', confirmLabel = '确认', cancelLabel = '取消', danger = false } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };
    const dialog = modal(title, `
      <p class="dialog-intro">${esc(message)}</p>
      <div class="dialog-actions">
        <button type="button" class="plain-button" data-confirm-no>${esc(cancelLabel)}</button>
        <button type="button" class="${danger ? 'action-danger' : 'action-primary'}" data-confirm-yes>${esc(confirmLabel)}</button>
      </div>`);
    dialog.addEventListener('close', () => { if (!settled) { settled = true; resolve(false); } });
    dialog.querySelector('[data-confirm-no]').onclick = () => finish(false);
    dialog.querySelector('[data-confirm-yes]').onclick = () => finish(true);
    dialog.querySelector('[data-confirm-no]').focus();
  });
}

async function remotePair() {
  if (!session || session.mode !== 'server' || typeof session.createRemotePair !== 'function') {
    toast('当前为本地浏览器排练模式，需在联机课堂服务下使用手机遥控。');
    return;
  }
  const dialog = modal('手机遥控配对', `
    <p class="dialog-intro">用手机或平板扫码即可接管当前课堂的翻页、互动与讲台控制。配对码仅可使用一次，5 分钟内有效。</p>
    <div class="invite-layout">
      <div id="room-qr" class="room-qr" role="img" aria-label="教师遥控配对二维码"></div>
      <div>
        <span class="field-caption">有效倒计时</span>
        <div class="invite-code" data-pair-timer>05:00</div>
        <button type="button" class="text-button" data-pair-refresh>${icon('replay', 14)}重新生成</button>
      </div>
    </div>
    <label class="field-caption" for="pair-link">遥控链接（一次性，请勿发给学生）</label>
    <div class="input-line">
      <input id="pair-link" readonly value="正在生成配对链接…">
      <button type="button" class="plain-button" data-copy-pair disabled>复制链接</button>
    </div>
    <p class="dialog-feedback" data-pair-status role="status"></p>`);
  const linkInput = dialog.querySelector('#pair-link');
  const copyBtn = dialog.querySelector('[data-copy-pair]');
  const timerEl = dialog.querySelector('[data-pair-timer]');
  const statusEl = dialog.querySelector('[data-pair-status]');
  const refreshBtn = dialog.querySelector('[data-pair-refresh]');
  let countdown;
  let activeUrl = '';

  const stopTimer = () => { if (countdown) { clearInterval(countdown); countdown = undefined; } };
  dialog.addEventListener('close', stopTimer);

  async function generate() {
    stopTimer();
    refreshBtn.disabled = true;
    copyBtn.disabled = true;
    statusEl.dataset.kind = 'pending';
    statusEl.textContent = '正在生成一次性配对二维码…';
    try {
      const pair = await session.createRemotePair();
      if (!dialog.isConnected) return;
      activeUrl = pair.url;
      linkInput.value = activeUrl;
      copyBtn.disabled = false;
      statusEl.textContent = '';
      void renderInviteCode(dialog, activeUrl);
      const tick = () => {
        if (!dialog.isConnected) return stopTimer();
        const remaining = Math.max(0, Math.ceil((pair.expiresAt - Date.now()) / 1000));
        const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
        const ss = String(remaining % 60).padStart(2, '0');
        timerEl.textContent = `${mm}:${ss}`;
        if (remaining <= 0) {
          stopTimer();
          statusEl.dataset.kind = 'error';
          statusEl.textContent = '配对码已过期，请点击「重新生成」。';
        }
      };
      tick();
      countdown = setInterval(tick, 1000);
    } catch (error) {
      if (!dialog.isConnected) return;
      statusEl.dataset.kind = 'error';
      statusEl.textContent = localize(error);
      linkInput.value = '';
    } finally {
      if (dialog.isConnected) refreshBtn.disabled = false;
    }
  }

  copyBtn.onclick = async () => {
    if (!activeUrl) return;
    const copied = await copy(activeUrl);
    statusEl.dataset.kind = copied ? 'success' : 'error';
    statusEl.textContent = copied ? '已复制遥控链接，请在教师手机打开' : '请选中链接手动复制。';
  };
  refreshBtn.onclick = () => { void generate(); };
  void generate();
}

const phaseText = {collect:'收集中',reveal:'结果已公布',branch:'分支讨论',closed:'已结课'};
function roomChooser() {
  const current = session;
  const local = current.mode === 'local';
  const records = recentRooms().slice(0,5);
  const list = records.map(item => {
    const open = item.code === current.code;
    const kind = item.demo ? '样本排练' : item.mode === 'local' ? '空白排练' : item.mode === 'server' ? '现场课堂' : '';
    return `<button type="button" class="recent-room" data-restore="${esc(item.code)}"${open ? ' aria-current="true"' : ''}>
      <span><b>${esc(item.title)}</b><small>${esc([item.code, kind, phaseText[item.phase]].filter(Boolean).join(' · '))}</small></span>
      ${open ? '<em>当前课堂</em>' : icon('chevron-right',17)}</button>`;
  }).join('');
  const options = lessons.map(lesson => `<option value="${esc(lesson.id)}"${lesson.id === current.state.lessonId ? ' selected' : ''}>${esc(lesson.title)}</option>`).join('');
  const dialog = modal('课堂管理', `
    <section class="dialog-section" aria-labelledby="new-room-heading">
      <h3 id="new-room-heading">新建课堂</h3>
      <form data-create-room>
        <label class="field-caption" for="new-lesson">选择起始课谱</label>
        <select id="new-lesson" class="field-select" name="lesson">${options}</select>
        <fieldset class="room-modes"><legend class="field-caption">课堂模式</legend><div>
          <label><input type="radio" name="mode" value="empty" checked><strong>${local ? '空白排练' : '现场课堂'}</strong>
            <small>${local ? '在同一浏览器用空白课堂演练' : '只统计学生的现场提交'}</small></label>
          <label><input type="radio" name="mode" value="demo"><strong>样本排练</strong><small>自带已标记的模拟作答</small></label>
        </div></fieldset>
        <button type="submit" data-create class="action-primary dialog-full">${icon('plus',17)}创建课堂</button>
      </form>
      <p class="dialog-feedback" data-room-feedback role="status"></p>
    </section>
    <section class="dialog-section" aria-labelledby="switch-room-heading">
      <h3 id="switch-room-heading">切换课堂</h3>
      <form data-switch-room><label for="switch-code" class="visually-hidden">要打开的六位课堂码</label><div class="input-line">
        <input id="switch-code" name="room" maxlength="6" minlength="6" pattern="[0-9A-Za-z]{6}" placeholder="输入六位课堂码"
          autocomplete="off" autocapitalize="characters" spellcheck="false" required>
        <button type="submit" class="plain-button">打开课堂</button></div></form>
      <p class="dialog-feedback" data-room-feedback role="status"></p>
      ${list ? '<p class="field-caption" id="recent-rooms-heading">最近打开</p><div class="recent-rooms" aria-labelledby="recent-rooms-heading">' + list + '</div>' : ''}
    </section>`);
  const controls = [...dialog.querySelectorAll('input, select, button')];
  const feedback = [...dialog.querySelectorAll('[data-room-feedback]')];
  const busy = pending => {
    dialog.setAttribute('aria-busy', String(pending));
    for (const control of controls) control.disabled = pending;
  };
  async function changeRoom(action, message, trigger) {
    if (dialog.getAttribute('aria-busy') === 'true') return;
    const status = trigger?.closest('section')?.querySelector('[data-room-feedback]') ?? feedback[0];
    for (const item of feedback) item.textContent = '';
    busy(true);
    status.dataset.kind = 'pending';
    status.textContent = '正在连接课堂…';
    try {
      const next = await action();
      if (session !== current || !dialog.isConnected) { next.close(); return; }
      activate(next, 'desk');
      focusSurface();
      toast(message);
    } catch (error) {
      if (!dialog.isConnected) return;
      busy(false);
      status.dataset.kind = 'error';
      status.textContent = localize(error);
      trigger?.focus();
    }
  }
  function switchTo(code, trigger) {
    if (code === current.code) { closeModal(); return; }
    changeRoom(() => openSession({role:'teacher',room:code}), '已切换课堂', trigger);
  }
  dialog.querySelector('[data-create-room]').onsubmit = event => {
    event.preventDefault();
    const options = new FormData(event.currentTarget);
    const trigger = event.submitter ?? event.currentTarget.querySelector('[type="submit"]');
    changeRoom(() => current.newRoom({lessonId:options.get('lesson'),demo:options.get('mode') === 'demo'}), '新课堂已开启', trigger);
  };
  dialog.querySelector('[data-switch-room]').onsubmit = event => {
    event.preventDefault();
    const code = event.currentTarget.elements.room.value.trim().toUpperCase();
    switchTo(code, event.submitter ?? event.currentTarget.querySelector('[type="submit"]'));
  };
  for (const button of dialog.querySelectorAll('[data-restore]')) button.onclick = () => switchTo(button.dataset.restore, button);
}

function navLink(name, glyph) {
  const current = name === view ? ' aria-current="page"' : '';
  return '<a class="shell-nav-link" data-nav="'+name+'" href="?view='+name+'&amp;room='+esc(session.code)+'"'+current+'>'+icon(glyph,19)+'<span>'+titles[name]+'</span></a>';
}

function surfaceLink(name, glyph) {
  return '<a class="shell-surface-link" href="'+esc(localSurfaceUrl(name))+'" target="_blank" rel="noopener" title="'+titles[name]+'（新窗口）" aria-label="'+titles[name]+'（新窗口）">'+icon(glyph,18)+'<span>'+titles[name]+'</span></a>';
}

function paintShellStatus() {
  const status = app.querySelector('[data-shell-status]');
  if (!status) return;
  const connected = session.connected !== false;
  const local = session.mode === 'local';
  const label = local ? '浏览器排练' : connected ? '实时课堂服务' : '正在连接课堂';
  const mode = status.querySelector('[data-mode]');
  if (mode.textContent !== label) mode.textContent = label;
  status.dataset.connection = local ? 'local' : connected ? 'online' : 'pending';
  const lesson = app.querySelector('[data-shell-lesson]');
  const title=session.state.lecture?.title||session.state.lesson.title;
  if (lesson.textContent !== title) {
    lesson.textContent = title;
    lesson.title = title;
  }
}

function paintShell() {
  clearPage();
  setRail(false, false);
  const standalone = roleFor(view) !== 'teacher';
  document.body.classList.toggle('standalone', standalone);
  if (standalone) {
    app.innerHTML = '<main id="surface"></main>';
    return;
  }
  const roomCode = esc(session.code);
  app.innerHTML = '<div class="workspace shell-workspace"><a class="shell-skip" href="#surface">跳到页面内容</a><aside id="rail" class="shell-rail" aria-label="教师导航">'+
    '<div class="shell-brand-row"><a class="shell-brand" href="?view=desk&amp;room='+roomCode+'" data-nav="desk" aria-label="共演课堂控制台">'+brand+'</a>'+
    '<button type="button" class="shell-drawer-close" data-rail-close aria-label="收起导航">'+icon('close',20)+'</button></div>'+
    '<nav class="shell-nav" aria-label="教师工作区"><div class="shell-nav-group"><p class="shell-nav-heading">教学工作区</p>'+
    navLink('materials','book')+navLink('workshop','workshop')+navLink('desk','desk')+navLink('replay','replay')+'</div>'+
    '<div class="shell-nav-group"><p class="shell-nav-heading">教学工具</p>'+navLink('lab','lab')+navLink('system','network')+'</div></nav>'+
    '<div class="shell-rail-footer"><div class="shell-room-context"><span class="shell-room-context-icon">'+icon('book',17)+'</span><div><span>当前课堂</span><strong data-shell-lesson></strong></div></div>'+
    '<div class="shell-connection" data-shell-status role="status"><i aria-hidden="true"></i><span data-mode></span></div></div></aside>'+
    '<button type="button" class="shell-scrim" data-rail-close tabindex="-1" aria-label="收起导航"></button><div class="shell-main">'+
    '<header class="shell-header"><div class="shell-header-inner"><div class="shell-header-left">'+
    '<button type="button" class="shell-drawer-open" data-rail-open aria-label="展开导航" aria-controls="rail" aria-expanded="false">'+icon('menu',21)+'</button>'+
    '<span class="shell-crumb">教师工作区</span><span class="shell-crumb">'+icon('chevron-right',13)+'</span><strong class="shell-current">'+titles[view]+'</strong></div>'+
    '<div class="shell-header-actions">'+(view === 'desk' ? '' : surfaceLink('stage','monitor')+surfaceLink('student','smartphone'))+
    '<button type="button" class="shell-room-button" data-rooms aria-haspopup="dialog" aria-label="课堂管理，切换或创建课堂，当前课堂码 '+roomCode+'"><span>课堂码</span><b>'+roomCode+'</b>'+icon('chevron-down',13)+'</button></div></div></header>'+
    '<main id="surface" class="content shell-content" tabindex="-1"></main></div></div>';
  for (const link of app.querySelectorAll('[data-nav]')) link.onclick = event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go(link.dataset.nav);
  };
  app.querySelector('[data-rail-open]').onclick = () => setRail(true);
  for (const button of app.querySelectorAll('[data-rail-close]')) button.onclick = () => setRail(false);
  app.querySelector('[data-rooms]').onclick = roomChooser;
  paintShellStatus();
  setRail(false, false);
}

function setRail(open, moveFocus = true) {
  const wasOpen = railOpen;
  railOpen = mobileShell.matches && open;
  document.body.classList.toggle('shell-drawer-visible', railOpen);
  const workspace = app.querySelector('.shell-workspace');
  if (!workspace) return;
  const rail = workspace.querySelector('#rail');
  const trigger = workspace.querySelector('[data-rail-open]');
  workspace.classList.toggle('rail-expanded', railOpen);
  rail.inert = mobileShell.matches && !railOpen;
  rail.hidden = rail.inert;
  workspace.querySelector('.shell-main').inert = railOpen;
  workspace.querySelector('.shell-skip').inert = railOpen;
  trigger.setAttribute('aria-expanded', String(railOpen));
  if (railOpen) {
    rail.setAttribute('role', 'dialog');
    rail.setAttribute('aria-modal', 'true');
  } else {
    rail.removeAttribute('role');
    rail.removeAttribute('aria-modal');
  }
  if (!moveFocus) return;
  if (railOpen) {
    const close = rail.querySelector('[data-rail-close]');
    close.focus({ preventScroll: true });
    if (document.activeElement !== close) requestAnimationFrame(() => {
      if (railOpen && close.isConnected && !rail.contains(document.activeElement)) close.focus({ preventScroll: true });
    });
  }
  if (!railOpen && wasOpen) {
    const target = mobileShell.matches ? trigger : rail.querySelector('[aria-current="page"]');
    target?.focus({ preventScroll: true });
  }
}

async function startLesson(lesson) {
  if (publishingLesson) throw new Error('正在创建课堂，请稍候。');
  const active = session;
  const built = getLesson(lesson.id);
  const canonical = built && JSON.stringify(built) === JSON.stringify(lesson);
  const prepared = canonical ? built : importScore(exportScore(lesson));
  let next;
  publishingLesson = true;
  try {
    next = await active.newRoom({lessonId:built?.id || 'mzi',demo:false});
    if (!canonical) await next.command('loadLesson',{lesson:prepared});
    if (session !== active) throw new Error('当前课堂已切换，请重新发布课谱。');
    activate(next,'desk');
    focusSurface();
    toast('课谱已发布，新课堂已开启');
  } catch (error) {
    next?.close();
    throw error;
  } finally {
    publishingLesson = false;
  }
}

async function startLecture(lecture) {
  if (publishingLesson) throw new Error('正在创建课堂，请稍候。');
  publishingLesson=true;
  const active=session;
  let next;
  try {
    next=await active.newRoom({lecture,demo:false});
    if (session!==active) throw new Error('备课房间已切换，请重新打开讲义。');
    activate(next,'desk');focusSurface();
    return {code:next.code};
  } catch(error) {next?.close();throw error;}
  finally {publishingLesson=false;}
}

function context() {
  const active=session, snapshot=active.state;
  return {state:snapshot,mode:active.mode,connected:active.connected,participantId:active.participantId,tab:labTab,esc,icon,toast,go,invite,
    remotePair:active.mode === 'server' ? remotePair : null,
    confirmDialog,
    open:openSurface,url:v=>active.url(v),
    askPeer:active.assistedComposition && snapshot.lecture ? ()=>active.askPeer(snapshot.lecture.index,snapshot.lecture.turn) : null,
    startLecture,startLesson,getState:()=>active.state,getRoomState:()=>active.state,getFrame:index=>active.getFrame(index),
    getOutline:()=>active.getOutline ? active.getOutline() : Promise.resolve([]),
    materialRendering:!!active.materialRendering,
    importMaterial:file=>active.importMaterial(file),planLecture:material=>active.planLecture(material),
    modelAvailable:!!active.assistedComposition,aiOutputMode:active.aiOutputMode,compose:input=>active.compose(input),
    command:(type,payload={})=>active.command(type,{...payload,expectedRound:snapshot.round,expectedLessonId:snapshot.lessonId,
      ...(snapshot.lecture&&{expectedLectureIndex:snapshot.lecture.index,expectedLectureTurn:snapshot.lecture.turn})})};
}

function systemView(root) {
  const server=session.mode==='server';
  const planning={jev:'Jev · System One',chat:'Chat Completions',local:'本地规则'}[session.lecturePlanProvider] ?? '本地规则';
  const current=getActivity(session.state.lesson)?.id;
  const embedded = document.getElementById('polyphony-architecture');
  if (embedded && !architectureUrl) {
    const bytes = Uint8Array.from(atob(embedded.textContent), character => character.charCodeAt(0));
    architectureUrl = URL.createObjectURL(new Blob([bytes], {type:'image/svg+xml;charset=utf-8'}));
  }
  const diagram = esc(architectureUrl ?? './assets/architecture.svg');
  root.innerHTML='<div class="sys-view"><header><h1>系统架构</h1><p>查看当前运行环境、活动接口和从备课到课堂回顾的数据流。</p></header>'+
    '<div class="sys-status"><article><span>'+icon('radio',16)+'运行环境</span><b>'+(server?'实时课堂服务':'浏览器排练')+'</b><p>'+(server?'教师、学生和投影共用同一房间。':'同一浏览器的多个窗口可同步排练。')+'</p></article>'+
    '<article><span>'+icon('sparkles',16)+'原页排课</span><b>'+esc(planning)+'</b><p>工坊与课堂评议使用'+(session.assistedAnalysis?' Chat Completions · '+esc(session.aiOutputMode):'本地模板与规则')+'。</p></article>'+
    '<article><span>'+icon('book',16)+'课谱与事件</span><b>'+lessons.length+' 门内置课谱</b><p>当前课堂已记录 '+session.state.events.length+' 个事件。</p></article></div>'+
    '<section class="map-panel"><div class="map-heading"><div><h2>平台数据流</h2><p>导入原稿，按页排课、校验和采用，再在同一房间讲授、互动、回顾。</p></div><a class="plain-button" data-focus="architecture-original" href="'+diagram+'" target="_blank" rel="noopener">'+icon('maximize',16)+'查看原图</a></div><a class="map-image" data-focus="architecture-image" href="'+diagram+'" target="_blank" rel="noopener" aria-label="放大系统架构图"><img src="'+diagram+'" alt="共演系统架构，展示课件导入、原页校核、原生授课、三端同步与证据回放"></a></section>'+
    '<section class="map-panel"><h2>活动接口</h2><p>课谱固定活动版本，提交和公开命令驱动对应的活动界面。</p><div class="manifest-list">'+activities.map(activity=>
      '<div'+(activity.id===current?' class="manifest-current"':'')+'><span><b>'+esc(activity.title)+'</b><code>'+esc(activity.id)+'</code></span><small>'+esc(activity.input)+' → '+esc(activity.aggregate)+'</small>'+(activity.id===current?'<em>本课使用</em>':'')+'</div>').join('')+'</div></section></div>';
}

const pages = {
  materials: {
    styles: ['workshop', 'material-workspace', 'material-notes', 'material-science'],
    load: () => import('./views/material-workspace.mjs').then(module => module.renderMaterialWorkspace),
  },
  desk: { styles: ['desk'], load: () => import('./views/desk.mjs').then(module => module.renderDesk) },
  student: { styles: ['student'], load: () => import('./views/student.mjs').then(module => module.renderStudent) },
  stage: { styles: ['surfaces'], load: () => import('./views/surfaces.mjs').then(module => module.renderStage) },
  workshop: { styles: ['workshop'], load: () => import('./views/workshop.mjs').then(module => module.renderWorkshop) },
  replay: { styles: ['replay'], load: () => import('./views/replay.mjs').then(module => module.renderReplay) },
  lab: { styles: ['lab', 'challenge-lab'], load: () => import('./views/lab.mjs').then(module => module.renderLab) },
  system: { render: systemView },
};

const lecturePages = Object.fromEntries(['desk', 'student', 'stage'].map(name => [name, {
  styles: [...pages[name].styles, 'material-science', 'lecture-stage', 'lecture-room', 'challenge-lab'],
  load: () => import('./views/lecture-room.mjs').then(module => {
    lectureKeyboard = module.lectureKeyboard;
    return module.renderLectureRoom;
  }),
}]));

const loadedStyles = new Map();
function loadStyle(name) {
  const cached = loadedStyles.get(name);
  if (cached) return cached.ready;

  const embedded = document.querySelector(`template[data-view-style="${name}"]`);
  const element = embedded ? embedded.content.firstElementChild.cloneNode(true) : document.createElement('link');
  const ready = embedded ? Promise.resolve() : new Promise((resolve, reject) => {
    element.rel = 'stylesheet';
    element.href = `./views/${name}.css`;
    element.onload = resolve;
    element.onerror = () => {
      loadedStyles.delete(name);
      element.remove();
      reject(new Error(`样式载入失败：${name}`));
    };
  });
  loadedStyles.set(name, {element, ready});
  const next = viewStyles.slice(viewStyles.indexOf(name) + 1).find(key => loadedStyles.has(key));
  document.head.insertBefore(element, loadedStyles.get(next)?.element ?? null);
  return ready;
}

function preparePage(page) {
  if (page.render) return Promise.resolve();
  return page.loading ??= Promise.all([page.load(), ...page.styles.map(loadStyle)]).then(([render]) => {
    page.render = render;
  }, error => {
    page.loading = undefined;
    throw error;
  });
}

function clearPage() {
  if (typeof cleanup==='function') cleanup();
  cleanup = pendingPage = undefined;
}

function paintPage() {
  const root = app.querySelector('#surface');
  if (!root) return;
  const page = (session.state.lecture && lecturePages[view]) || pages[view];
  document.title='共演 Polyphony · '+titles[view];
  if (page.render) {
    const keepFocus = (view === 'stage' || view === 'system') && root.contains(document.activeElement);
    const control = keepFocus ? focusSelector(document.activeElement) : null;
    clearPage();
    cleanup = page.render(root, context(), roleFor(view));
    if (control) root.querySelector(control)?.focus({preventScroll:true});
    return;
  }
  if (pendingPage?.root === root && pendingPage.page === page) return;
  clearPage();
  const pending = pendingPage = {root, page};
  root.innerHTML = '<div class="shell-view-state" role="status">正在载入页面…</div>';
  preparePage(page).then(() => {
    if (pendingPage === pending && root.isConnected) paintPage();
  }, () => {
    if (pendingPage !== pending || !root.isConnected) return;
    root.innerHTML = '<div class="shell-view-state"><p role="alert">暂时无法载入此页面。</p><button type="button" class="plain-button">重新载入</button></div>';
    root.querySelector('button').onclick = () => location.reload();
  });
}

function go(v,tab=null) {
  if(!teacherViews.includes(v) || roleFor(view)!=='teacher') return;
  view=v; labTab=tab; closeModal(); setAddress(view,session.code,false,tab);
  paintShell(); paintPage();
  focusSurface();
}

function focusSurface() {
  document.querySelector('#surface')?.focus({preventScroll:true});
  window.scrollTo({top:0,behavior:'instant'});
}

function activate(next,v,replace=false) {
  unsubscribe?.(); offStatus?.();
  if(session && session!==next) session.close();
  session=next; view=v;
  closeModal(); setAddress(view,session.code,replace,labTab); remember();
  paintShell(); paintPage();
  unsubscribe=session.subscribe(()=>{
    remember();
    paintShellStatus();
    if (!['lab','workshop','materials'].includes(view)) paintPage();
  });
  offStatus=session.subscribeStatus?.(()=>{
    paintShellStatus();
    if (view === 'stage' || view === 'student') paintPage();
  });
}

let teacherPassphrase = '';
try { teacherPassphrase = sessionStorage.getItem('polyphony.passphrase') || ''; } catch { /* ignore */ }

function errorPage(message, code) {
  setRail(false, false);
  document.body.classList.remove('standalone');
  const role = roleFor(view);
  const needsPassphrase = role === 'teacher' && /口令|passphrase/i.test(message || '');
  const entry = {
    teacher: { kind:'教师端', symbol:'desk', title:'打开教师工作区', hint:'请使用创建课堂时的浏览器来重新连接。', action:'打开工作区' },
    stage: { kind:'投影端', symbol:'monitor', title:'连接投影大屏', hint:'输入教师提供的课堂码，将课堂画面投到大屏。', action:'连接投影' },
    student: { kind:'学生端', symbol:'smartphone', title:'加入共演课堂', hint:'输入教师提供的课堂码，进入本节课。', action:'加入课堂' },
  }[role];
  const recent = role === 'teacher' && recentRooms().find(item => item.code !== code);
  app.innerHTML = '<main class="shell-entry" aria-labelledby="shell-entry-title"><div class="shell-entry-card">'+
    '<div class="shell-entry-top"><div class="shell-brand">'+brand+'</div><span class="shell-entry-role">'+icon(entry.symbol,15)+entry.kind+'</span></div>'+
    '<h1 id="shell-entry-title">'+entry.title+'</h1><p class="shell-entry-hint">'+entry.hint+'</p>'+
    (message ? '<p class="shell-entry-error" role="alert">'+esc(message)+'</p>' : '')+
    '<form id="entry-form"><label for="room-input">六位课堂码</label><input class="shell-entry-code" id="room-input" name="room" maxlength="6" minlength="6" pattern="[0-9A-Za-z]{6}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" '+(needsPassphrase?'':'required ')+'value="'+esc(code || '')+'">'+
    (needsPassphrase ? '<label for="passphrase-input">教师口令</label><input class="shell-entry-passphrase" id="passphrase-input" name="passphrase" type="password" autocomplete="current-password" placeholder="输入服务端配置的教师口令" value="'+esc(teacherPassphrase)+'" required>' : '')+
    '<button type="submit" class="action-primary shell-entry-submit"><span>'+entry.action+'</span>'+icon('arrow-right',17)+'</button></form>'+
    (role === 'teacher' ? '<div class="shell-entry-recovery">'+
        (recent ? '<button type="button" class="plain-button" data-entry-recent><span>返回上次课堂</span></button>' : '')+
        '<button type="button" class="text-button shell-entry-reset"><span>创建新的排练室</span></button></div>' : '')+'</div></main>';
  const form = app.querySelector('#entry-form');
  const input = form.querySelector('#room-input');
  const passInput = form.querySelector('#passphrase-input');
  const submit = form.querySelector('[type="submit"]');
  const reset = app.querySelector('.shell-entry-reset');
  const resume = app.querySelector('[data-entry-recent]');
  function savePassphrase() {
    if (!passInput) return;
    teacherPassphrase = passInput.value.trim();
    try { sessionStorage.setItem('polyphony.passphrase', teacherPassphrase); } catch { /* ignore */ }
  }
  function submitEntry(target, room, button, pending) {
    savePassphrase();
    form.setAttribute('aria-busy', 'true');
    input.readOnly = true;
    if (passInput) passInput.readOnly = true;
    submit.disabled = true;
    if (reset) reset.disabled = true;
    if (resume) resume.disabled = true;
    button.querySelector('span').textContent = pending;
    connect(target, room);
  }
  form.onsubmit = event => {
    event.preventDefault();
    const roomVal = input.value.trim().toUpperCase();
    submitEntry(view, roomVal || null, submit, '正在连接…');
  };
  if (reset) reset.onclick = () => submitEntry('desk', null, reset, '正在创建…');
  if (resume) resume.onclick = () => submitEntry('desk', recent.code, resume, '正在返回…');
  if (needsPassphrase && passInput) passInput.focus({ preventScroll:true });
  else if (message) input.focus({ preventScroll:true });
}

async function connect(v,code,claim=null) {
  const token=++generation;
  const role=roleFor(v);
  if (session) {
    closeModal();
    setRail(false, false);
    unsubscribe?.();
    offStatus?.();
    clearPage();
    session.close();
    session = unsubscribe = offStatus = undefined;
    app.innerHTML = '<main class="initial" role="status"><img src="./assets/mark.svg" alt=""><p>正在打开课堂…</p></main>';
  }
  if(role!=='teacher' && !code) {view=v;errorPage('',null);return;}
  if (!Object.hasOwn(lecturePages, v)) void preparePage(pages[v]).catch(() => {});
  try {
    const next=await openSession({role,room:code,claim,passphrase:teacherPassphrase || undefined,demo:true,lessonId:'mzi'});
    if(token!==generation) {next.close();return;}
    activate(next,v,true);
    if (claim) toast('已连接教师遥控权限');
  } catch(error) {if(token===generation){view=v;errorPage(localize(error),code);}}
}

window.addEventListener('popstate',()=>{
  const params=new URL(location.href).searchParams;
  const v=Object.hasOwn(titles,params.get('view'))?params.get('view'):(params.has('room')?'desk':'materials');
  const code=params.get('room');
  const claim=params.get('claim');
  labTab=params.get('tab');
  if(session && session.code===code && roleFor(view)===roleFor(v) && !claim) {view=v;closeModal();paintShell();paintPage();}
  else connect(v,code,claim);
});
mobileShell.addEventListener('change', () => setRail(false));
window.addEventListener('keydown', event => {
  if (!railOpen && session?.state.lecture && view==='desk') lectureKeyboard?.(event,context());
  if (!railOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    setRail(false);
  }
  if (event.key !== 'Tab') return;
  const focusable = app.querySelectorAll('#rail a[href], #rail button:not([disabled])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});
window.addEventListener('pagehide',e=>{if(!e.persisted)session?.close();});
const requestedRoom=query.get('room') || (roleFor(view)==='teacher' ? recentRooms()[0]?.code : null);
const requestedClaim=query.get('claim');
connect(view,requestedRoom,requestedClaim);
