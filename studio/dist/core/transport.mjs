import { createRoom } from './engine.mjs';
import { applyRoomCommand, commandNeedsScore, createLectureRoom } from './lecture-room.mjs';
import { lectureFrame, validateLectureScore } from './lecture-score.mjs';
import { localLecturePlan, plannerPages } from './lecture-planner.mjs';
import { publishedLecture } from './published-lecture-store.mjs';
import { publicChallenge } from './challenge-lab.mjs';

const KEY = 'polyphony.v1.';
const CODE = /^[A-Z0-9]{6}$/;
const STUDENT_COMMANDS = new Set(['join', 'respond', 'experimentVote']);
export const isStudentCommand = type => STUDENT_COMMANDS.has(type);
export const validRoomCode = code => CODE.test(code);

const answersPublished = room => ['reveal', 'branch', 'closed'].includes(room.phase);
export const isRoomResponsePublic = (response, room, published = answersPublished(room)) => published || response.round < room.round;

export function projectRoom(room, role, participantId) {
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
  const events = (room.events ?? []).map(({ id, type, label, at }) => ({ id, type, label, at }));
  const { customLessons, lectureArchive, decision, analysis, winner, ...state } = room;
  if (room.lecture) {
    const { sourceVersion, ...visibleLecture } = room.lecture;
    state.lecture = visibleLecture;
  }
  const visibleAnalysis = published && analysis ? {
    headline: analysis.headline, summary: analysis.summary, branches: analysis.branches,
    recommendedId: analysis.recommendedId, source: analysis.source, evidence: [],
  } : null;
  const winnerIndex = room.participants.findIndex(({ id }) => id === winner?.id);
  return {
    ...state, ...statistics, ...experiment, participants, responses, events, analysis: visibleAnalysis,
    decision: decision ? { branchId: decision.branchId, title: decision.title } : null,
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

async function api(path, body) {
  const request = body == null ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const response = await fetch(API(path), { ...request, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
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

async function openServer({ role, room, demo, lessonId, lecture }, status) {
  const initial = room
    ? await api(`rooms/${room}/session`, { role })
    : await api('rooms', { demo, lessonId, lecture });
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
    compose(input) {
      if (role !== 'teacher') return Promise.reject(new Error('Only the teacher can compose a lesson.'));
      return api(`rooms/${code}/compose`, input);
    },
    async askPeer(index, turn) {
      if (role !== 'teacher') throw new Error('请由教师邀请 AI 同桌。');
      const result = await api(`rooms/${code}/experiment-peer`, {index,turn});
      sessions.update(result.room);
    },
    async importMaterial(file) {
      const url=API(`rooms/${code}/materials/import`);
      url.searchParams.set('name',file.name);
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      const data=await response.json();
      if (!response.ok) throw new Error(data.error ?? '课件解析失败。');
      return data;
    },
    async planLecture(material) {
      const pages=plannerPages(material);
      if (!(status.assistedLecturePlanning ?? status.assistedComposition)) return localLecturePlan(pages);
      try { return await api(`rooms/${code}/lecture-plan`,{pages}); }
      catch { return localLecturePlan(pages); }
    },
    getFrame(index) { return api(`rooms/${code}/frame?index=${index}`); },
    newRoom(options = {}) { return openServer({ ...options, role: 'teacher' }, status); },
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
    async compose() { throw new Error('Assisted composition requires the classroom server.'); },
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

export async function openSession({ role, room, demo = true, lessonId } = {}) {
  if (!['teacher', 'student', 'stage'].includes(role)) throw new Error('Unknown room view.');
  room = room?.trim().toUpperCase() || null;
  if (room && !validRoomCode(room)) throw new Error('Enter a valid six-character room code.');
  if (!room && role !== 'teacher') throw new Error('Enter a room code or open the classroom link.');
  const options = { role, room, demo, lessonId };
  if (location.protocol === 'file:') return localRoom(options);
  let status;
  try { status = await api('status'); } catch { /* Static hosting has no room API. */ }
  if (status?.polyphony) {
    sessionStorage.setItem(`${KEY}server`, '1');
    return openServer(options, status);
  }
  if (sessionStorage.getItem(`${KEY}server`)) throw new Error('The classroom server is unavailable. Reconnect and reopen this link.');
  return localRoom(options);
}
