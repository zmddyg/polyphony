import { openSession } from './core/transport.mjs';
import { getLesson, WORKSPACE_LESSON_ID } from './core/catalog.mjs';
import { exportScore, importScore } from './core/score-package.mjs';
import { icon, esc, viewStyles } from './ui.mjs';

const app = document.querySelector('#app');
const overlays = document.querySelector('#overlays');
const liveMessage = document.querySelector('#toast');
const titles = {materials:'备课',desk:'课堂',workshop:'独立互动',replay:'课后复盘',student:'学生端',stage:'投影',remote:'手机遥控'};
const teacherViews = ['materials','desk','workshop','replay'];
let demonstration = null;
let view = 'materials';
let labTab = null;

let session, unsubscribe, offStatus, cleanup, toastTimer, restoreFocus;
let pendingPage, lectureKeyboard, qrScript;
let generation = 0;
let publishingLesson = false;
let railOpen = false;
let classroomStarted = false;
let teacherPassphrase = '';
const mobileShell = matchMedia('(max-width: 850px)');
const roleFor = v => v === 'stage' || v === 'student' ? v : 'teacher';
const brand = '<img class="shell-brand-mark" src="./assets/mark.svg" alt="" width="40" height="40"><span class="shell-brand-name"><b>共演智课</b><span>Polyphony</span></span>';
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
  if (error?.code === 'teacher-passphrase-required') return '请输入正确的教师口令。';
  if (/teacher desk|teacher session|teacher credential|teacher access/i.test(detail)) return '请在创建课堂的浏览器打开教师台，或扫描教师台的手机遥控二维码。';
  if (/unavailable in this browser/i.test(detail)) return '这个浏览器里没有这间离线课堂，请从创建课堂的同一浏览器打开。';
  if (/valid six|room code/i.test(detail)) return '请输入六位课堂码。';
  if (/room not found|unknown room|no such room/i.test(detail)) return '没有找到这间课堂，请核对课堂码或重新打开邀请链接。';
  if (/failed to fetch|networkerror|classroom server is unavailable/i.test(detail)) return '暂时连不上课堂服务，请检查网络后再试。';
  return detail;
}

const recentKey = () => demonstration ? 'polyphony.demo.recent.v1' : 'polyphony.recent.v1';
function recentRooms() {
  const rooms = readStorage(recentKey(), []);
  return Array.isArray(rooms) ? rooms.filter(room => room?.code && room.title) : [];
}
function remember() {
  if (!classroomStarted || !session || roleFor(view) !== 'teacher' || view === 'remote') return;
  const {code,lesson,phase,demo} = session.state;
  const entry = {code,title:session.state.lecture?.title||lesson.title,phase,demo,mode:session.mode,at:Date.now()};
  const records = recentRooms();
  if (records[0]?.code === code && records[0].phase === phase && records[0].title === entry.title &&
      records[0].mode === entry.mode && records[0].demo === demo) return;
  writeStorage(recentKey(),[entry,...records.filter(item => item.code !== code)].slice(0,16));
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

async function withTeacherPassphrase(request) {
  try { return await request(teacherPassphrase); }
  catch (error) { if (error.code !== 'teacher-passphrase-required') throw error; }
  teacherPassphrase = '';
  const dialog = modal('教师口令', `<form data-teacher-confirm><label class="field-caption" for="teacher-passphrase">课堂服务口令</label>
    <input class="field-select" id="teacher-passphrase" name="passphrase" type="password" autocomplete="current-password" required>
    <p class="dialog-feedback" role="status"></p><button type="submit" class="action-primary dialog-full">确认并继续</button></form>`);
  const form = dialog.querySelector('form');
  const input = form.elements.passphrase;
  const submit = form.querySelector('button');
  const feedback = form.querySelector('[role=status]');
  input.focus();
  return new Promise((resolve, reject) => {
    dialog.addEventListener('close', () => reject(new Error('已取消教师口令验证。')), { once:true });
    form.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled) return;
      const credential = input.value;
      dialog.setAttribute('aria-busy', 'true');
      submit.disabled = input.disabled = true;
      feedback.textContent = '正在验证…';
      try {
        const result = await request(credential);
        if (!dialog.isConnected) { result?.close?.(); return; }
        teacherPassphrase = credential;
        resolve(result);
        closeModal();
      } catch (error) {
        if (!dialog.isConnected) return;
        if (error.code !== 'teacher-passphrase-required') {
          reject(error);
          closeModal();
          return;
        }
        dialog.removeAttribute('aria-busy');
        submit.disabled = input.disabled = false;
        feedback.dataset.kind = 'error';
        feedback.textContent = localize(error);
        input.select();
      }
    };
  });
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

async function remotePair() {
  const active = session;
  if (!active?.createRemotePair) return;
  const dialog = modal('手机遥控配对', `<p class="dialog-intro">用教师自己的手机扫码。配对链接五分钟内有效，只能使用一次。</p>
    <div id="room-qr" class="room-qr" role="img" aria-label="教师手机遥控二维码" hidden></div>
    <div data-remote-link hidden><label class="field-caption" for="remote-link">配对链接</label><div class="input-line">
      <input id="remote-link" readonly><button type="button" class="plain-button" data-copy-remote>复制</button></div></div>
    <p class="dialog-feedback" role="status">正在生成配对链接…</p>`);
  const feedback = dialog.querySelector('[role=status]');
  try {
    const pair = await active.createRemotePair();
    if (!dialog.isConnected || session !== active) return;
    dialog.querySelector('#remote-link').value = pair.url;
    dialog.querySelector('[data-remote-link]').hidden = false;
    dialog.querySelector('#room-qr').hidden = false;
    const expires = new Date(pair.expiresAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' });
    feedback.textContent = '有效至 ' + expires;
    dialog.querySelector('[data-copy-remote]').onclick = async () => {
      if (Date.now() >= pair.expiresAt) {
        feedback.textContent = '链接已过期，请关闭窗口后重新配对。';
        return;
      }
      feedback.textContent = await copy(pair.url) ? '已复制教师配对链接' : '请选择链接并手动复制。';
    };
    await renderInviteCode(dialog, pair.url);
  } catch (error) {
    feedback.dataset.kind = 'error';
    feedback.textContent = localize(error);
  }
}

function roomChooser() {
  const current = session;
  const records = recentRooms();
  const list = records.map(room => `<button type="button" class="recent-room" data-restore="${esc(room.code)}">
    <span><b>${esc(room.title)}</b><small>${esc(room.code)}${room.demo ? ' · 演示' : ''}</small></span>${icon('chevron-right',16)}
  </button>`).join('');
  const dialog = modal('课堂记录', `
    <div class="recent-rooms">${list}</div>
    <details class="prep-options"><summary>按课堂码打开</summary>
      <form data-open-room><label class="field-caption" for="switch-code">课堂码</label><div class="input-line">
        <input id="switch-code" name="room" maxlength="6" minlength="6" pattern="[0-9A-Za-z]{6}" autocomplete="off" required>
        <button type="submit" class="plain-button">打开</button></div></form>
    </details>
    <p class="dialog-feedback" data-room-feedback role="status"></p>`);
  const feedback = dialog.querySelector('[data-room-feedback]');
  async function open(code, target) {
    if (dialog.getAttribute('aria-busy') === 'true') return;
    dialog.setAttribute('aria-busy','true');
    feedback.textContent = '正在打开课堂…';
    try {
      const next = code === current.code ? current : await openSession({ role:'teacher', room:code });
      if (session !== current || !dialog.isConnected) { if (next !== current) next.close(); return; }
      const ended = next.state.lecture ? next.state.lecture.mode === 'ended' : next.state.phase === 'closed';
      activate(next, ended ? 'replay' : 'desk');
      focusSurface();
    } catch (error) {
      if (!dialog.isConnected) return;
      feedback.textContent = localize(error);
      dialog.removeAttribute('aria-busy');
      target?.focus();
    }
  }
  dialog.querySelectorAll('[data-restore]').forEach(button => button.onclick = () => open(button.dataset.restore,button));
  dialog.querySelector('[data-open-room]').onsubmit = event => {
    event.preventDefault();
    open(event.currentTarget.elements.room.value.trim().toUpperCase(),event.submitter);
  };
}

function navLink(name, glyph) {
  const current = (name === view || (name === 'materials' && view === 'workshop')) ? ' aria-current="page"' : '';
  return '<a class="shell-nav-link" data-nav="'+name+'" href="?view='+name+'&amp;room='+esc(session.code)+'"'+current+'>'+icon(glyph,19)+'<span>'+titles[name]+'</span></a>';
}

function paintShellStatus() {
  const status = app.querySelector('[data-shell-status]');
  if (!status) return;
  const local = session.mode === 'local';
  const connected = session.connected !== false;
  const label = local ? '本机课堂' : connected ? '已连接' : '正在连接课堂…';
  const mode = status.querySelector('[data-mode]');
  if (mode.textContent !== label) mode.textContent = label;
  status.dataset.connection = local ? 'local' : connected ? 'online' : 'pending';
}

function paintShell() {
  clearPage();
  setRail(false, false);
  const standalone = roleFor(view) !== 'teacher' || view === 'remote';
  document.body.classList.toggle('standalone', standalone);
  if (standalone) {
    app.innerHTML = view === 'remote' ? '<main id="surface" class="remote-surface" tabindex="-1"></main>' : '<main id="surface"></main>';
    return;
  }

  app.innerHTML = `<div class="workspace shell-workspace"><a class="shell-skip" href="#surface">跳到页面内容</a>
    <aside id="rail" class="shell-rail" aria-label="教师导航">
      <div class="shell-brand-row"><a class="shell-brand" href="?view=materials&amp;room=${esc(session.code)}" data-nav="materials" aria-label="共演智课 · 备课">${brand}</a>
        <button type="button" class="shell-drawer-close" data-rail-close aria-label="收起导航">${icon('close',20)}</button></div>
      <nav class="shell-nav" aria-label="教师工作区"><div class="shell-nav-group">
        ${demonstration ? navLink('demo','play') + navLink('lab','lab') : ''}
        ${navLink('materials','book')}
        ${classroomStarted && view !== 'replay' ? navLink('desk','desk') : ''}
        ${view === 'replay' ? navLink('replay','replay') : ''}
      </div></nav>
      ${classroomStarted ? '<div class="shell-rail-footer"><div class="shell-connection" data-shell-status role="status"><i aria-hidden="true"></i><span data-mode></span></div></div>' : ''}
    </aside>
    <button type="button" class="shell-scrim" data-rail-close tabindex="-1" aria-label="收起导航"></button>
    <div class="shell-main"><header class="shell-header"><div class="shell-header-inner">
      <div class="shell-header-left">
        <button type="button" class="shell-drawer-open" data-rail-open aria-label="展开导航" aria-controls="rail" aria-expanded="false">${icon('menu',21)}</button>
        <strong class="shell-current">${titles[view]}</strong>
      </div>
      <div class="shell-header-actions">
        ${recentRooms().length ? '<button type="button" class="shell-room-button" data-rooms aria-haspopup="dialog">课堂记录</button>' : ''}
        ${view === 'desk' && classroomStarted && !session.state.lecture && session.mode === 'server'
          ? '<button type="button" class="shell-room-button" data-remote-pair aria-haspopup="dialog">手机遥控</button>' : ''}
        <button type="button" class="shell-room-button" data-api-hub aria-haspopup="dialog">设置</button>
      </div>
    </div></header><main id="surface" class="content shell-content" tabindex="-1"></main></div></div>`;

  for (const link of app.querySelectorAll('[data-nav]')) link.onclick = event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go(link.dataset.nav);
  };
  app.querySelector('[data-rail-open]').onclick = () => setRail(true);
  for (const button of app.querySelectorAll('[data-rail-close]')) button.onclick = () => setRail(false);
  app.querySelector('[data-rooms]')?.addEventListener('click', roomChooser);
  app.querySelector('[data-api-hub]').onclick = () => modelApiDialog(() => { if (view === 'materials') paintPage(); });
  app.querySelector('[data-remote-pair]')?.addEventListener('click', remotePair);
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
  const prepared = canonical ? built : importScore(exportScore(built ? { ...lesson, id: 'import-' + lesson.id } : lesson));
  let next;
  publishingLesson = true;
  try {
    next = await withTeacherPassphrase(passphrase => active.newRoom({lessonId:built?.id || WORKSPACE_LESSON_ID,demo:false,passphrase}));
    if (!canonical) await next.command('loadLesson',{lesson:prepared});
    if (session !== active) throw new Error('当前课堂已切换，请重新发布互动配置。');
    activate(next,'desk');
    focusSurface();
    toast('互动配置已发布，新课堂已开启');
  } catch (error) {
    next?.close();
    throw error;
  } finally {
    publishingLesson = false;
  }
}

async function startLecture(lecture, { experiment = false } = {}) {
  if (publishingLesson) throw new Error('正在创建课堂，请稍候。');
  publishingLesson=true;
  const active=session;
  let next;
  try {
    next=await withTeacherPassphrase(passphrase => active.newRoom({lecture,demo:false,passphrase}));
    if (experiment) await next.command('lectureExperimentStart',{expectedLectureIndex:next.state.lecture.index,expectedLectureTurn:next.state.lecture.turn});
    if (experiment && next.state.experiment?.kind === 'light' && next.state.experiment.step === 'draw') {
      await next.command('lectureExperimentAct',{action:'fit',target:next.state.experiment.target,
        expectedLectureIndex:next.state.lecture.index,expectedLectureTurn:next.state.lecture.turn});
    }
    if (session!==active) throw new Error('备课房间已切换，请重新打开讲义。');
    activate(next,'desk');focusSurface();
    return {code:next.code};
  } catch(error) {next?.close();throw error;}
  finally {publishingLesson=false;}
}

function context() {
  const active=session, snapshot=active.state;
  return {state:snapshot,mode:active.mode,connected:active.connected,remote:view==='remote',participantId:active.participantId,tab:labTab,esc,icon,toast,go,invite,open:openSurface,url:v=>active.url(v),
    demonstration: Boolean(demonstration), configureModel: modelApiDialog,
    remotePair: active.mode === 'server' && view === 'desk' ? remotePair : null,
    askPeer:snapshot.lecture ? ()=>active.askPeer(snapshot.lecture.index,snapshot.lecture.turn) : null,
    startLecture,startLesson,getState:()=>active.state,getRoomState:()=>active.state,getFrame:index=>active.getFrame(index),
    get providerSummary(){return active.providerSummary;},runHarness:(material,options)=>active.runHarness(material,options),authorDeck:(spec,options)=>active.authorDeck(spec,options),
    materialRendering:!!active.materialRendering,
    importMaterial:file=>withTeacherPassphrase(passphrase => active.importMaterial(file,passphrase)),planLecture:material=>active.planLecture(material),
    modelAvailable:!!active.assistedComposition,aiOutputMode:active.aiOutputMode,compose:input=>active.compose(input),
    command:async(type,payload={})=>{const result = await active.command(type,{...payload,expectedRound:snapshot.round,expectedLessonId:snapshot.lessonId,
      ...(snapshot.lecture&&{expectedLectureIndex:snapshot.lecture.index,expectedLectureTurn:snapshot.lecture.turn})});
      if (active === session && roleFor(view) === 'teacher') {
        classroomStarted = true;
        writeStorage('polyphony.workspace.pending.v1', readStorage('polyphony.workspace.pending.v1', []).filter(code => code !== active.code));
        remember(); paintShellStatus();
      }
      return result;}};
}



function modelApiDialog(onUpdate) {
  const summary=session.providerSummary??{};
  const dialog=modal('模型设置',`<p class="dialog-intro">OpenAI 兼容 Chat Completions 协议，可连接 DeepSeek、Qwen、Gemini 或校园网关。</p><form class="v3-provider-form"><label>预设端点<select name="preset"><option value="custom">自定义 / 校园网关</option><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="qwen">Qwen</option><option value="gemini">Gemini（兼容协议）</option></select></label><label>Base URL<input type="url" name="baseUrl" required placeholder="https://gateway.example.edu/v1" autocomplete="off"></label><label>Model<input name="model" required value="${esc(summary.model??'')}" placeholder="模型名称" autocomplete="off"></label><label>API Key<input type="password" name="key" required autocomplete="new-password" placeholder="输入密钥（不回显已保存密钥）"></label><label>输出模式<select name="outputMode"><option value="json_object">JSON Object（通用兼容）</option><option value="json_schema">JSON Schema（严格结构）</option><option value="text">Text JSON（兼容网关）</option></select></label><p class="v3-secret-note">${session.mode==='local'?'仅保存在当前浏览器标签页会话内存，关闭即销毁，绝不写入导出课件':'仅保存在本机服务运行内存，停止服务即销毁，绝不写入课堂存档或导出课件'}。</p><div class="v3-dialog-actions"><button class="v3-subtle" type="button" data-provider-clear>清除配置</button><button class="v3-subtle" type="button" data-provider-test>测试连接</button><button class="v3-primary" type="submit">保存至当前会话</button></div><p role="status" data-provider-feedback></p></form>`);
  const form=dialog.querySelector('form'),feedback=form.querySelector('[data-provider-feedback]');
  const presets={openai:['https://api.openai.com/v1','gpt-4.1-mini'],deepseek:['https://api.deepseek.com','deepseek-chat'],qwen:['https://dashscope.aliyuncs.com/compatible-mode/v1','qwen-plus'],gemini:['https://generativelanguage.googleapis.com/v1beta/openai','gemini-2.5-flash']};
  form.elements.preset.onchange=()=>{const p=presets[form.elements.preset.value];if(p){form.elements.baseUrl.value=p[0];form.elements.model.value=p[1];}};
  const perform=async(test=false,clear=false)=>{
    if(!clear&&!form.reportValidity())return;
    const input=clear?{clear:true}:Object.fromEntries(new FormData(form));
    if(test)Object.assign(input,{test:true,testOnly:true});
    for(const b of form.querySelectorAll('button'))b.disabled=true;
    feedback.textContent=test?'正在测试连接（最多 5 秒）…':'正在保存当前会话…';
    try { await session.configureProvider(input); feedback.textContent=clear?'配置已清除。':test?'连接测试通过。':'已保存；密钥不会写入课件。';if (!test) onUpdate?.(); }
    catch(error){feedback.textContent=localize(error);}
    finally{for(const b of form.querySelectorAll('button'))b.disabled=false;}
  };
  form.onsubmit=event=>{event.preventDefault();void perform();};
  form.querySelector('[data-provider-test]').onclick=()=>perform(true);
  form.querySelector('[data-provider-clear]').onclick=()=>perform(false,true);
}


const pages = {
  materials: {
    styles: ['lecture-stage', 'material-science'],
    load: () => import('./views/material-workspace.mjs').then(module => module.renderMaterialWorkspace),
  },
  desk: { styles: ['desk'], load: () => import('./views/desk.mjs').then(module => module.renderDesk) },
  student: { styles: ['student'], load: () => import('./views/student.mjs').then(module => module.renderStudent) },
  stage: { styles: ['cognition','surfaces'], load: () => import('./views/surfaces.mjs').then(module => module.renderStage) },
  workshop: { styles: ['workshop'], load: () => import('./views/workshop.mjs').then(module => module.renderWorkshop) },
  replay: { styles: ['cognition','replay'], load: () => import('./views/replay.mjs').then(module => module.renderReplay) },
};
pages.remote = pages.desk;

const lecturePages = Object.fromEntries(['desk', 'student', 'stage'].map(name => [name, {
  styles: [...pages[name].styles, 'material-science', 'lecture-stage', 'lecture-room', 'challenge-lab'],
  load: () => import('./views/lecture-room.mjs').then(module => {
    lectureKeyboard = module.lectureKeyboard;
    return module.renderLectureRoom;
  }),
}]));
lecturePages.remote = lecturePages.desk;

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
  document.title='共演智课 · Polyphony · '+titles[view];
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

function activate(next,v,replace=false,started=true) {
  unsubscribe?.(); offStatus?.();
  if(session && session!==next) session.close();
  session=next; view=v;
  classroomStarted = started;
  const pending = readStorage('polyphony.workspace.pending.v1', []).filter(code => code !== next.code);
  if (!started) pending.push(next.code);
  writeStorage('polyphony.workspace.pending.v1', pending.slice(-32));
  closeModal(); setAddress(view,session.code,replace,labTab); remember();
  paintShell(); paintPage();
  unsubscribe=session.subscribe(()=>{
    remember();
    paintShellStatus();
    if (!['lab','workshop','materials'].includes(view)) paintPage();
  });
  offStatus=session.subscribeStatus?.(()=>{
    paintShellStatus();
    if (['stage','student','remote'].includes(view)) paintPage();
  });
}

function errorPage(message, code) {
  setRail(false, false);
  document.body.classList.remove('standalone');
  if (view === 'remote') {
    app.innerHTML = '<main class="shell-entry"><section class="shell-entry-card"><h1>手机遥控</h1><p class="shell-entry-hint" role="alert">'+esc(message || '请扫描教师台生成的二维码。')+'</p></section></main>';
    return;
  }
  const role = roleFor(view);
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
    '<form id="entry-form"><label for="room-input">六位课堂码</label><input class="shell-entry-code" id="room-input" name="room" maxlength="6" minlength="6" pattern="[0-9A-Za-z]{6}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" required value="'+esc(code || '')+'">'+
    '<button type="submit" class="action-primary shell-entry-submit"><span>'+entry.action+'</span>'+icon('arrow-right',17)+'</button></form>'+
    (role === 'teacher' ? '<div class="shell-entry-recovery">'+
        (recent ? '<button type="button" class="plain-button" data-entry-recent><span>返回上次课堂</span></button>' : '')+
        '<button type="button" class="text-button shell-entry-reset"><span>开启新课堂</span></button></div>' : '')+'</div></main>';
  const form = app.querySelector('#entry-form');
  const input = form.querySelector('#room-input');
  const submit = form.querySelector('[type="submit"]');
  const reset = app.querySelector('.shell-entry-reset');
  const resume = app.querySelector('[data-entry-recent]');
  function submitEntry(target, room, button, pending) {
    form.setAttribute('aria-busy', 'true');
    input.readOnly = true;
    submit.disabled = true;
    if (reset) reset.disabled = true;
    if (resume) resume.disabled = true;
    button.querySelector('span').textContent = pending;
    connect(target, room);
  }
  form.onsubmit = event => {
    event.preventDefault();
    submitEntry(view, input.value.trim().toUpperCase(), submit, '正在连接…');
  };
  if (reset) reset.onclick = () => submitEntry('materials', null, reset, '正在打开…');
  if (resume) resume.onclick = () => submitEntry('desk', recent.code, resume, '正在返回…');
  if (message) input.focus({ preventScroll:true });
}

function takeRemoteClaim(v) {
  if (v !== 'remote') return null;
  const url = new URL(location.href);
  const claim = new URLSearchParams(url.hash.slice(1)).get('claim');
  if (claim !== null) {
    url.hash = '';
    history.replaceState(null, '', url);
  }
  return claim;
}

async function connect(v,code,claim = takeRemoteClaim(v)) {
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
    const request = passphrase => openSession({role,room:code,demo:false,lessonId:WORKSPACE_LESSON_ID,remote:v==='remote',claim,passphrase});
    const next = role === 'teacher' && !code && v !== 'remote' ? await withTeacherPassphrase(request) : await request(teacherPassphrase);
    if(token!==generation) {next.close();return;}
    activate(next,v,true,!!code && !readStorage('polyphony.workspace.pending.v1', []).includes(next.code));
  } catch(error) {if(token===generation){view=v;errorPage(localize(error),code);}}
}

window.addEventListener('popstate',()=>{
  const params=new URL(location.href).searchParams;
  const v = requestedView(params);
  const code=params.get('room');
  const claim=takeRemoteClaim(v);
  labTab=params.get('tab');
  if(!claim && session && session.code===code && roleFor(view)===roleFor(v) && (v!=='remote' || session.mode==='server')) {view=v;closeModal();paintShell();paintPage();}
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
function requestedView(params) {
  const requested = params.get('view');
  if ((requested === 'desk' || requested === 'replay') && !params.has('room')) return 'materials';
  if (Object.hasOwn(titles, requested)) return requested;
  if (demonstration && requested === 'system') return 'lab';
  return demonstration ? 'demo' : params.has('room') && !requested ? 'desk' : 'materials';
}

export function startApplication(extras = null) {
  demonstration = extras;
  if (extras) {
    Object.assign(titles, { demo:'比赛演示', lab:'交互模组' });
    teacherViews.push('demo','lab');
    pages.demo = { render:extras.renderMenu };
    pages.lab = { styles:['lab','challenge-lab','cognition'], load:extras.loadGallery };
  }
  const query = new URL(location.href).searchParams;
  view = requestedView(query);
  labTab = query.get('tab');
  void connect(view, query.get('room'));
}
