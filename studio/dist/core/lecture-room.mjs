import { createRoom, initialLessonState, recordRoomEvent, reduceRoom } from './engine.mjs';
import { lectureFrame, locateLectureFrame } from './lecture-score.mjs';
import { advanceChallenge, castVote, challengeNames, newChallenge, publicChallenge } from './challenge-lab.mjs';
import { challengeForFrame } from './lecture-planner.mjs';

const reject = message => { throw new Error(message); };
function readingLesson(title) {
  return { id: 'polyphony-lecture', title, subject: '', description: '', prompt: '',
    options: [], branches: [], skills: [], steps: [] };
}

function position(score, index, total) {
  const entry = locateLectureFrame(score, index);
  if (!entry) reject('这个课件页不存在。');
  const page = score.pages[entry.pageIndex];
  return { index, total, pageNumber: page.number, supplemental: entry.slideIndex >= 0,
    hasInteraction: Boolean(page.interaction) };
}

// The immutable score is kept separate from the small room snapshots sent over SSE.
export function createLectureRoom(code, score, at = Date.now()) {
  const base = createRoom({ code, demo: false, at });
  const total = score.pages.reduce((count, page) => count + 1 + page.adopted.length, 0);
  const lecture = { title: score.title, sourceName: score.source.name, sourceVersion: score.source.versionId || '',
    mode: 'slides', turn: 0, ...position(score, 0, total) };
  return { ...base, ...initialLessonState(readingLesson(score.title)), lecture, lectureArchive: [],
    experimentArchive: [], lecturePulses: {},
    events: [{ ...base.events[0], label: '已在共演开设讲义课堂', detail: { sourceName: lecture.sourceName, pageNumber: lecture.pageNumber } }] };
}

function activitySnapshot(state) {
  const { lesson, lessonId, phase, responses, round, revisionPrompt, decision, analysis, winner, winnerVisible, spotlight } = state;
  return { versionId: state.lecture.sourceVersion, pageNumber: state.lecture.pageNumber,
    lesson, lessonId, phase, responses, round, revisionPrompt, decision, analysis, winner, winnerVisible, spotlight };
}

function experimentSnapshot(state, at) {
  const visible = publicChallenge(state.experiment);
  return {
    pageNumber: state.lecture.pageNumber,
    kind: visible.kind,
    step: visible.step,
    ...(visible.params && { params: visible.params }),
    ...(visible.probe !== undefined && { probe: visible.probe }),
    ...(visible.input !== undefined && { input: visible.input }),
    ...(visible.reading !== undefined && { reading: visible.reading }),
    ...(visible.choice !== undefined && { choice: visible.choice }),
    ...(visible.answer !== undefined && { answer: visible.answer }),
    ...(visible.compatible && { compatible: visible.compatible }),
    ...(visible.angle !== undefined && { angle: visible.angle }),
    ...(visible.predicted !== undefined && { predicted: visible.predicted }),
    ...(visible.observed !== undefined && { observed: visible.observed }),
    ...(visible.firstModel && { firstModel: visible.firstModel }),
    ...(visible.model && { model: visible.model }),
    ...(visible.peer && { peer: visible.peer }),
    counts: visible.counts,
    archivedAt: at ?? Date.now(),
  };
}

export function commandNeedsScore(type) {
  return type === 'lectureNavigate' || type === 'lectureInteract' || type === 'lectureExperimentStart';
}

export function applyRoomCommand(state, command, score) {
  if (!state.lecture) return reduceRoom(state, command);
  const { type, payload = {} } = command;
  const current = state.lecture;
  if (type === 'lecturePulse') {
    if (current.mode === 'ended') reject('这节讲义课已结束。');
    if (current.mode !== 'slides') reject('仅在讲义展示页可标记学习疑问。');
    if (payload.expectedLectureIndex !== undefined && payload.expectedLectureIndex !== current.index) {
      reject('讲义页已切换，请在当前页重新标记。');
    }
    const id = typeof payload.participantId === 'string' ? payload.participantId.trim() : '';
    if (!id || id.length > 100) reject('学员编号无效。');
    const pageKey = String(current.pageNumber);
    const pulses = state.lecturePulses ?? {};
    const existing = pulses[pageKey] ?? [];
    const had = existing.includes(id);
    const confused = payload.confused === undefined ? !had : Boolean(payload.confused);
    if (had === confused) return state;
    const nextList = confused ? [...existing, id] : existing.filter(item => item !== id);
    const nextPulses = { ...pulses, [pageKey]: nextList };
    return recordRoomEvent({ ...state, lecturePulses: nextPulses }, 'lecturePulse',
      confused ? `原稿第 ${current.pageNumber} 页收到学习疑问` : `原稿第 ${current.pageNumber} 页取消了一条学习疑问`,
      { pageNumber: current.pageNumber, confused, count: nextList.length }, payload.at);
  }
  if (type !== 'join' && (payload.expectedLectureTurn !== current.turn || payload.expectedLectureIndex !== current.index)) {
    reject('讲义页或互动已经切换，请按当前画面重新操作。');
  }
  if (current.mode === 'ended') reject('这节讲义课已结束。');
  const event = (patch, label, detail) => recordRoomEvent({ ...state, ...patch }, type, label, detail, payload.at);
  const nextLecture = patch => ({ ...current, turn: current.turn + 1, ...patch });
  if (type === 'lectureNavigate') {
    if (current.mode !== 'slides') reject('请先返回讲义，再翻页。');
    if (payload.index === current.index) return state;
    const next = position(score, payload.index, current.total);
    return event({ lecture: nextLecture(next) }, '讲到原稿第 ' + next.pageNumber + ' 页', { pageNumber: next.pageNumber, index: next.index });
  }
  if (type === 'lectureInteract') {
    if (current.mode !== 'slides' || !current.hasInteraction) reject('当前原页没有可开启的互动。');
    const page = score.pages[locateLectureFrame(score, current.index).pageIndex];
    const saved = state.lectureArchive.find(item => item.pageNumber === current.pageNumber);
    let active;
    let lectureArchive = state.lectureArchive;
    if (saved) {
      if (saved.phase === 'closed') reject('本页活动已结束，可在课堂回顾查看作答。');
      const { pageNumber, versionId, ...previous } = saved;
      active = previous;
      lectureArchive = lectureArchive.filter(item => item !== saved);
    } else active = initialLessonState(page.interaction);
    return event({ ...active, lecture: nextLecture({ mode: 'activity' }), lectureArchive },
      '原稿第 ' + page.number + ' 页开启互动', { pageNumber: page.number, lessonId: active.lessonId });
  }
  if (type === 'lectureExperimentStart') {
    if (current.mode !== 'slides') reject('请先返回讲义。');
    const frame = lectureFrame(score, current.index);
    const kind = challengeForFrame(frame);
    if (!kind) reject('本页没有匹配的实验。');
    const params = kind === 'rc' ? frame?.experiment?.params : undefined;
    return event({ lecture: nextLecture({ mode: 'experiment' }), experiment: newChallenge(kind, { random: payload.random, params }) },
      '从原页开启「' + challengeNames[kind] + '」', { pageNumber: current.pageNumber, kind });
  }
  if (type === 'experimentVote' || type === 'lectureExperimentAct') {
    if (current.mode !== 'experiment' || !state.experiment) reject('本页实验已经结束。');
    const prior = state.experiment;
    if (type === 'experimentVote') {
      const experiment = castVote(prior, payload.participantId, payload.choice);
      if (experiment === prior) return state;
      return event({ experiment }, '实验收到一次投票', { pageNumber: current.pageNumber, step: prior.step });
    }
    const experiment = advanceChallenge(prior, payload);
    const labels = {
      measure: '已使用本轮唯一一次测量', diagnose: '已比较候选模型的预测', probe: '已输入数字并查看黑箱输出',
      fit: '机器已根据三点锁定预测', test: '已揭晓盲测点的读数', refit: '机器已根据第四点重新拟合', reset: '已开始新一局实验',
    };
    const detail = { pageNumber: current.pageNumber, kind: prior.kind, action: payload.action, counts: publicChallenge(prior).counts };
    if (experiment.probe !== undefined) Object.assign(detail, { probe: experiment.probe, reading: experiment.reading });
    if (experiment.input !== undefined) detail.input = experiment.input;
    if (experiment.choice) Object.assign(detail, { choice: experiment.choice, answer: experiment.answer });
    if (experiment.angle !== undefined) Object.assign(detail, { angle: experiment.angle, predicted: experiment.predicted, observed: experiment.observed });
    const experimentArchive = payload.action === 'reset'
      ? [...(state.experimentArchive ?? []), experimentSnapshot(state, payload.at)]
      : (state.experimentArchive ?? []);
    return event({ lecture: nextLecture({}), experiment, experimentArchive }, labels[payload.action] ?? '实验已推进', detail);
  }
  if (type === 'lectureResume' || type === 'lectureFinish') {
    const finished = type === 'lectureFinish';
    if (!finished && !['activity', 'experiment'].includes(current.mode)) return state;
    let lectureArchive = state.lectureArchive;
    if (current.mode === 'activity') {
      lectureArchive = lectureArchive.filter(item => item.pageNumber !== current.pageNumber);
      lectureArchive.push(activitySnapshot(state));
    }
    let experimentArchive = state.experimentArchive ?? [];
    if (current.mode === 'experiment' && state.experiment) {
      experimentArchive = [...experimentArchive, experimentSnapshot(state, payload.at)];
    }
    return event({
      ...initialLessonState(readingLesson(current.title)),
      phase: finished ? 'closed' : 'collect',
      lectureArchive,
      experimentArchive,
      ...(current.mode === 'experiment' ? { experiment: null } : {}),
      lecture: nextLecture({ mode: finished ? 'ended' : 'slides' }),
    }, finished ? '讲义课堂已结束' : '已返回原页讲授', { pageNumber: current.pageNumber });
  }
  if (['switchLesson', 'loadLesson', 'demoFill'].includes(type) || (type !== 'join' && current.mode !== 'activity')) {
    reject('请先在对应的原页开启课堂互动。');
  }
  const next = reduceRoom(state, command);
  if (next === state) return state;
  const last = next.events.at(-1);
  const anchor = { lecturePageNumber: current.pageNumber, lectureVersionId: current.sourceVersion };
  // The reducer created this event and, for a response command, the matching answer.
  if (type === 'respond') {
    const response = next.responses.findLast(item => item.id === last.detail.responseId);
    Object.assign(response, anchor);
  }
  last.detail = { ...last.detail, ...anchor };
  return next;
}
