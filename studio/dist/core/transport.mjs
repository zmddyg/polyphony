import { runDeckHarness, generateNativeDeck } from './deck-harness.mjs';
import { readSessionProvider, saveSessionProvider, sessionProviderSummary, testSessionProvider } from './provider-hub.mjs';
import { createRoom } from './engine.mjs';
import { applyRoomCommand, commandNeedsScore, createLectureRoom } from './lecture-room.mjs';
import { lectureFrame, validateLectureScore } from './lecture-score.mjs';
import { localLecturePlan, plannerPages } from './lecture-planner.mjs';
import { publishedLecture } from './published-lecture-store.mjs';
import { publicChallenge } from './challenge-lab.mjs';
import { roundTallies, pairedRevisions } from './cognition.mjs';

const KEY = 'polyphony.v1.';
const CODE = /^[A-Z0-9]{6}$/;
const STUDENT_COMMANDS = new Set(['join', 'respond', 'experimentVote']);
export const isStudentCommand = type => STUDENT_COMMANDS.has(type);
export const validRoomCode = code => CODE.test(code);

const answersPublished = room => ['reveal', 'branch', 'closed'].includes(room.phase);
export const isRoomResponsePublic = (response, room, published = answersPublished(room)) => published || response.round < room.round;

export function projectRoom(room, role, participantId) {
  if (role === 'stage') participantId = null;
  const statistics = { responseCount: 0, simulatedResponseCount: 0, samples: [] };
  for (const { round, sample, simulated } of room.responses) {
    if (round !== room.round) continue;
    statistics.responseCount++;
    if (simulated) statistics.simulatedResponseCount++;
    if (sample) statistics.samples.push({ phaseIndex: sample.phaseIndex, power: sample.power, simulated });
  }
  const experiment = room.experiment ? {experiment:publicChallenge(room.experiment, participantId)} : {};
  if (role === 'teacher') return { ...room, ...statistics, ...experiment };
  const published = answersPublished(room);
  // Model output and student prose can contain identity strings even after removing ID fields.
  const privateTokens = [...room.participants.flatMap(p => [p.name, p.id]), ...room.responses.map(r => r.id)]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const anonymousText = value => privateTokens.reduce((text, token) => text.split(token).join('〔匿名〕'), String(value ?? ''));
  const responses = [];
  for (const response of room.responses) {
    if (response.participantId === participantId) responses.push(response);
    else if (isRoomResponsePublic(response, room, published)) {
      const { optionId, round, simulated, sample } = response;
      responses.push({ id: `anonymous-response-${responses.length + 1}`, optionId, round, simulated, ...(sample ? { sample } : {}) });
    }
  }
  const participants = room.participants.map((participant, index) => participant.id === participantId
    ? participant : { id: `anonymous-${index + 1}`, name: '', simulated: participant.simulated });
  const events = (room.events ?? []).map(({ id, type, label, at }) => ({ id, type, label: anonymousText(label), at }));
  const { customLessons, lectureArchive, decision, analysis, firstRoundAnalysis, winner, ...state } = room;
  // Only completed takeaways cross to public streams, never private archived answers.
  state.lectureTakeaways=(lectureArchive??[]).filter(s=>s.phase==='closed').map(s=>({pageNumber:s.pageNumber,title:s.lesson.title,...(s.lesson.takeaway??s.lesson.moduleConfig?.takeaway??{})}));
  if (room.lecture) {
    const { sourceVersion, ...visibleLecture } = room.lecture;
    state.lecture = visibleLecture;
    if(role==='stage')state.lecture.filmstrip=room.lecture.filmstrip?.map(({pageNumber,activityId})=>({pageNumber,activityId}));
    else delete state.lecture.filmstrip;
  }
  state.lesson = structuredClone(room.lesson);
  if (!published) {
    delete state.lesson.correctOptionId;
    if (state.lesson.moduleConfig) { delete state.lesson.moduleConfig.faultStepId; delete state.lesson.moduleConfig.faultDiagnosis; }
  }
  if (role==='student' && state.lesson.moduleConfig?.aiPeer && !room.aiPeerRevealed) delete state.lesson.moduleConfig.aiPeer;
  const visibleAnalysis = published && analysis ? {
    headline: anonymousText(analysis.headline), summary: anonymousText(analysis.summary),
    branches: (analysis.branches ?? []).map(b => ({ id: b.id, title: anonymousText(b.title), description: anonymousText(b.description) })),
    contrastPair: (analysis.contrastPair ?? []).slice(0, 2).map(p => ({
      sideLabel: anonymousText(p.sideLabel), tone: p.tone === 'alert' ? 'alert' : 'insight', quote: anonymousText(p.quote),
    })),
    recommendedId: analysis.recommendedId, source: analysis.source, evidence: [],
  } : null;
  const winnerIndex = room.participants.findIndex(({ id }) => id === winner?.id);
  return {
    ...state, ...statistics, ...experiment, participants, responses, events, analysis: visibleAnalysis,
    ...(published&&room.round===2&&firstRoundAnalysis?{firstRoundContrastPair:(firstRoundAnalysis.contrastPair??[]).slice(0,2).map(p=>({sideLabel:anonymousText(p.sideLabel),tone:p.tone==='alert'?'alert':'insight',quote:anonymousText(p.quote)}))}:{}),
    ...(published ? { round1Tallies: roundTallies(room, 1), pairedRevisions: pairedRevisions(room) } : {}),
    decision: decision ? { branchId: decision.branchId, title: anonymousText(decision.title) } : null,
    winner: winnerIndex >= 0 ? participants[winnerIndex] : null,
  };
}

function browserId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function link(view, code, origin) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view', view);
  url.searchParams.set('room', code);
  if (origin) return new URL(url.pathname + url.search, origin).href;
  return url.href;
}

const API = path => new URL(`./api/${path}`, location.href);

function passphraseHeader(passphrase) {
  if (!passphrase) return {};
  const bytes = new TextEncoder().encode(passphrase);
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  return { 'X-Polyphony-Passphrase': 'base64:' + encoded };
}

async function responseData(response, fallback = `请求失败（${response.status}）。`) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.error ?? fallback), { code: data?.code });
  if (data == null) throw new Error('课堂服务返回了无法读取的响应。');
  return data;
}

async function api(path, body, headers = {}) {
  const request = body == null ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
  const response = await fetch(API(path), { ...request, cache: 'no-store' });
  return responseData(response);
}

function createSubscription(initialState, project = state => state) {
  let state = project(initialState);
  const listeners = new Set();
  return {
    get state() { return state; },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    update(next) {
      if (next.version <= state.version) return;
      const projected = project(next);
      state = projected;
      for (const fn of listeners) fn(projected);
    },
    clear() { listeners.clear(); },
  };
}

async function openServer({ role, room, demo, lessonId, lecture, claim, passphrase }, status) {
  let initial;
  if (claim) initial = await api(`rooms/${room}/claim-teacher`, { token: claim });
  else if (room) initial = await api(`rooms/${room}/session`, { role });
  else initial = await api('rooms', { demo, lessonId, lecture }, passphraseHeader(passphrase));
  const { room: state, participantId } = initial;
  const { code } = state;
  const sessions = createSubscription(state);
  const stream = new EventSource(API(`rooms/${code}/events?role=${role}`));
  let connected = false;
  const statusListeners = new Set();
  const connection = next => {
    if (next === connected) return;
    connected = next;
    for (const fn of statusListeners) fn(connected);
  };
  stream.onopen = () => connection(true);
  stream.onerror = () => connection(false);
  stream.onmessage = ({ data, lastEventId }) => {
    const version = Number(lastEventId);
    if (Number.isSafeInteger(version) && String(version) === lastEventId && version <= sessions.state.version) return;
    sessions.update(JSON.parse(data));
  };
  return {
    get state() { return sessions.state; },
    get connected() { return connected; },
    code,
    mode: 'server',
    passphraseRequired: Boolean(status.passphraseRequired),
    materialRendering: Boolean(status.materialRendering),
    lecturePlanProvider: status.lecturePlanProvider ?? (status.assistedComposition ? 'chat' : 'local'),
    participantId,
    assistedAnalysis: Boolean(status.assistedAnalysis),
    assistedComposition: Boolean(status.assistedComposition),
    aiOutputMode: status.aiOutputMode ?? null,
    subscribe: sessions.subscribe,
    subscribeStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    async command(type, payload = {}) {
      const result = await api(`rooms/${code}/commands`, { role, type, payload });
      sessions.update(result.room);
      return sessions.state;
    },
    get providerSummary() { return status.providerSummary ?? {configured:false,source:'none'}; },
    async authorDeck(spec,options={}) {
      if(role!=='teacher')throw Error('仅教师可以生成课件。');
      let stopped=false,timer;
      const poll=async()=>{if(stopped)return;try{const progress=await api(`rooms/${code}/harness`);if(!stopped&&progress.harnessReceipt)options.onStage?.(progress.harnessReceipt);}catch{/* Final response owns errors. */}finally{if(!stopped)timer=setTimeout(poll,300);}};
      if(options.onStage)timer=setTimeout(poll,120);
      try{return await api(`rooms/${code}/author-deck`,{spec,pacingMode:options.pacingMode});}finally{stopped=true;clearTimeout(timer);}
    },
    async configureProvider(input) {
      if (role !== 'teacher') throw Error('仅教师可以配置模型。');
      const result = await api(`rooms/${code}/provider`,input);
      status.providerSummary=result.providerSummary;
      return result;
    },
    async runHarness(material, options={}) {
      if (role !== 'teacher') throw Error('仅教师可以运行 Harness。');
      let stopped=false,timer;
      const poll=async()=>{
        if(stopped)return;
        try {const progress=await api(`rooms/${code}/harness`);if(!stopped&&progress.harnessReceipt)options.onStage?.(progress.harnessReceipt);}catch{/* Final POST response owns error reporting. */}
        finally{if(!stopped)timer=setTimeout(poll,250);}
      };
      if(options.onStage)timer=setTimeout(poll,100);
      try{return await api(`rooms/${code}/harness`,{material,pacingMode:options.pacingMode,mode:options.mode});}
      finally{stopped=true;clearTimeout(timer);}
    },
    compose(input) {
      if (role !== 'teacher') return Promise.reject(new Error('Only the teacher can compose a lesson.'));
      return api(`rooms/${code}/compose`, input);
    },
    async askPeer(index, turn) {
      if (role !== 'teacher') throw new Error('请由教师邀请 AI 辩友。');
      const result = await api(`rooms/${code}/experiment-peer`, {index,turn});
      sessions.update(result.room);
    },
    async importMaterial(file, credential = passphrase) {
      const url=API(`rooms/${code}/materials/import`);
      url.searchParams.set('name',file.name);
      const response=await fetch(url,{
        method:'POST', headers:{'Content-Type':'application/octet-stream', ...passphraseHeader(credential)}, body:file,
      });
      return responseData(response,'课件解析失败。');
    },
    async planLecture(material) {
      const pages=plannerPages(material);
      if (!(status.assistedLecturePlanning ?? status.assistedComposition)) return localLecturePlan(pages);
      try { return await api(`rooms/${code}/lecture-plan`,{pages}); }
      catch { return localLecturePlan(pages); }
    },
    getFrame(index) { return api(`rooms/${code}/frame?index=${index}`); },
    async createRemotePair() {
      if (role !== 'teacher') throw new Error('仅教师可以创建手机遥控配对。');
      const pair = await api(`rooms/${code}/remote-pair`, {});
      const url = new URL(link('remote', code, status.publicOrigin));
      url.hash = new URLSearchParams({ claim: pair.token }).toString();
      return { url: url.href, expiresAt: pair.expiresAt };
    },
    newRoom(options = {}) { return openServer({ passphrase, ...options, role: 'teacher' }, status); },
    url(view) {
      const publicView = view === 'student' || view === 'stage';
      return link(view, code, publicView && status.publicOrigin ? status.publicOrigin : null);
    },
    close() { stream.close(); statusListeners.clear(); connected = false; sessions.clear(); },
  };
}

async function localRoom({ role, room, demo, lessonId, lecture }) {
  let code = room;
  let savedScore;
  if (!code) {
    do { code = browserId().slice(0, 6).toUpperCase(); }
    while (localStorage.getItem(KEY + code));
    savedScore = lecture ? validateLectureScore(lecture) : undefined;
    const state = savedScore ? createLectureRoom(code,savedScore) : createRoom({ code, demo, lessonId, at: Date.now() });
    if (savedScore) await publishedLecture('add',code,savedScore);
    try {
      localStorage.setItem(`${KEY}${code}.teacher`, '1');
      localStorage.setItem(KEY + code, JSON.stringify(state));
    } catch (error) {
      localStorage.removeItem(`${KEY}${code}.teacher`);
      if (savedScore) await publishedLecture('delete',code);
      throw error;
    }
  }
  const roomKey = KEY + code;
  const read = () => JSON.parse(localStorage.getItem(roomKey));
  let lastValue = localStorage.getItem(roomKey);
  const initial = JSON.parse(lastValue);
  if (!initial) throw new Error('This room is unavailable in this browser. Local practice only works in tabs of the same browser.');
  if (role === 'teacher' && !localStorage.getItem(`${KEY}${code}.teacher`)) {
    throw new Error('Open the teacher desk in the browser that created this room.');
  }
  const studentKey = `${KEY}${code}.student`;
  let participantId = null;
  if (role === 'student') {
    participantId = sessionStorage.getItem(studentKey) ?? browserId();
    sessionStorage.setItem(studentKey, participantId);
  }
  const project = state => projectRoom(state, role, participantId);
  async function getScore() {
    savedScore ??= await publishedLecture('get',code);
    if (!savedScore) throw new Error('浏览器中找不到这节课的讲义，请回到备课页重新开课。');
    return savedScore;
  }
  const sessions = createSubscription(initial, project);
  const sync = () => {
    const value = localStorage.getItem(roomKey);
    if (value == null || value === lastValue) return;
    const state = JSON.parse(value);
    lastValue = value;
    if (state) sessions.update(state);
  };
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(roomKey) : null;
  if (channel) channel.onmessage = ({ data }) => {
    if (!Number.isSafeInteger(data) || data > sessions.state.version) sync();
  };
  const onStorage = ({ key, newValue }) => {
    if (key === roomKey && newValue !== lastValue) sync();
  };
  addEventListener('storage', onStorage);
  return {
    get state() { return sessions.state; },
    connected: true,
    code,
    mode: 'local',
    lecturePlanProvider: 'local',
    participantId,
    assistedAnalysis: false,
    assistedComposition: false,
    subscribe: sessions.subscribe,
    subscribeStatus() { return () => {}; },
    async command(type, payload = {}) {
      if (role === 'stage' || (role === 'student') !== isStudentCommand(type)) throw new Error('This view cannot perform that action.');
      if (role === 'student' && payload.participantId && payload.participantId !== participantId) throw new Error('This session can submit only its own response.');
      const score = initial.lecture && commandNeedsScore(type) ? await getScore() : undefined;
      const write = () => {
        const command = { type, payload: role === 'student' ? { ...payload, participantId } : { ...payload } };
        if (type === 'analyze') delete command.payload.analysis;
        command.payload.at = Date.now();
        if (type === 'draw') command.payload.random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
        const value = localStorage.getItem(roomKey);
        const current = JSON.parse(value);
        const next = applyRoomCommand(current, command, score);
        if (next === current) {
          lastValue = value;
        } else {
          const saved = JSON.stringify(next);
          localStorage.setItem(roomKey, saved);
          lastValue = saved;
        }
        sessions.update(next);
        if (next !== current) channel?.postMessage(next.version);
        return sessions.state;
      };
      return navigator.locks ? navigator.locks.request(roomKey, write) : write();
    },
    get providerSummary() { return sessionProviderSummary(); },
    authorDeck(spec,options={}) { if(role!=='teacher')return Promise.reject(Error('仅教师可以生成课件。'));return generateNativeDeck(spec,{...options,provider:readSessionProvider()}); },
    async configureProvider(input) {
      if (role !== 'teacher') throw Error('仅教师可以配置模型。');
      if (input.test) await testSessionProvider(input);
      return {providerSummary:input.testOnly?sessionProviderSummary():saveSessionProvider(input),tested:!!input.test};
    },
    async runHarness(material, options={}) {
      if (role !== 'teacher') throw Error('仅教师可以运行 Harness。');
      return runDeckHarness(material,{...options,provider:readSessionProvider()});
    },
    async compose() { throw new Error('Assisted composition requires the classroom server.'); },
    async askPeer(index, turn) {
      if (role !== 'teacher') throw new Error('请由教师邀请 AI 辩友。');
      return this.command('lectureExperimentAct', { action: 'peer', expectedLectureIndex: index, expectedLectureTurn: turn });
    },
    async importMaterial() { throw new Error('此转换需要在本机课堂服务中打开共演。'); },
    async planLecture(material) { return localLecturePlan(plannerPages(material)); },
    async getFrame(index) {
      if (!initial.lecture || read().lecture.index !== index) throw new Error('授课页已切换。');
      const frame=lectureFrame(await getScore(),index);
      if (!frame || read().lecture.index !== index) throw new Error('授课页已切换。');
      return frame;
    },
    async newRoom(options = {}) { return localRoom({ ...options, role: 'teacher' }); },
    url(view) { return link(view, code); },
    close() { channel?.close(); removeEventListener('storage', onStorage); sessions.clear(); },
  };
}

export async function openSession({ role, room, demo = true, lessonId = 'four-spaces', claim, passphrase, remote = false } = {}) {
  if (!['teacher', 'student', 'stage'].includes(role)) throw new Error('Unknown room view.');
  room = room?.trim().toUpperCase() || null;
  if (room && !validRoomCode(room)) throw new Error('Enter a valid six-character room code.');
  if (!room && role !== 'teacher') throw new Error('Enter a room code or open the classroom link.');
  if ((remote || claim) && (!room || role !== 'teacher' || (claim && !/^[a-f0-9]{32}$/i.test(claim)))) {
    throw new Error('手机遥控链接无效，请扫描教师台生成的二维码。');
  }
  const options = { role, room, demo, lessonId, claim, passphrase };
  const remoteUnavailable = '手机遥控需要连接课堂服务，请检查网络后重新扫码。';
  if (location.protocol === 'file:') {
    if (remote || claim) throw new Error(remoteUnavailable);
    return localRoom(options);
  }
  let status;
  try { status = await api('status'); } catch { /* Static hosting has no room API. */ }
  if (status?.polyphony) {
    try { sessionStorage.setItem(`${KEY}server`, '1'); } catch { /* The server supports restricted storage contexts. */ }
    return openServer(options, status);
  }
  if (remote || claim) throw new Error(remoteUnavailable);
  let usedServer;
  try { usedServer = sessionStorage.getItem(`${KEY}server`); } catch { /* Treat a static host as local. */ }
  if (usedServer) throw new Error('The classroom server is unavailable. Reconnect and reopen this link.');
  return localRoom(options);
}
