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
  const base = createRoom({code, demo:false, at});
  const total = score.pages.reduce((count, page) => count + 1 + page.adopted.length, 0);
  const lecture = { title: score.title, sourceName: score.source.name, sourceVersion: score.source.versionId || '',
    mode: 'slides', turn: 0, filmstrip:score.pages.flatMap(p=>[{title:p.title,pageNumber:p.number,activityId:p.interaction?.activityId??null},...p.adopted.map(s=>({title:s.title,pageNumber:p.number,activityId:p.interaction?.activityId??null}))]), ...position(score, 0, total) };
  return { ...base, ...initialLessonState(readingLesson(score.title)), lecture, lectureArchive: [],
    events: [{...base.events[0], label:'已在共演开设讲义课堂', detail:{sourceName:lecture.sourceName, pageNumber:lecture.pageNumber}}] };
}

function activitySnapshot(state) {
  const {lesson, lessonId, phase, responses, round, revisionPrompt, decision, analysis, firstRoundAnalysis, winner, aiPeerRevealed} = state;
  return {versionId:state.lecture.sourceVersion, pageNumber:state.lecture.pageNumber,
    lesson, lessonId, phase, responses, round, revisionPrompt, decision, analysis, firstRoundAnalysis, winner, aiPeerRevealed};
}

export function commandNeedsScore(type) {
  return type === 'lectureNavigate' || type === 'lectureInteract' || type === 'lectureExperimentStart';
}

export function applyRoomCommand(state, command, score) {
  if (!state.lecture) return reduceRoom(state, command);
  const {type, payload = {}} = command;
  const current = state.lecture;
  if (type !== 'join' && (payload.expectedLectureTurn !== current.turn || payload.expectedLectureIndex !== current.index)) {
    reject('讲义页或互动已经切换，请按当前画面重新操作。');
  }
  if (current.mode === 'ended') reject('这节讲义课已结束。');
  const event = (patch, label, detail) => recordRoomEvent({...state,...patch}, type, label, detail, payload.at);
  const nextLecture = patch => ({...current, turn:current.turn + 1, ...patch});
  if (type === 'lectureNavigate') {
    if (payload.index === current.index) return state;
    const next = position(score, payload.index, current.total);
    const lectureArchive=current.mode==='activity'
      ? [...state.lectureArchive.filter(s=>s.pageNumber!==current.pageNumber),activitySnapshot(state)] : state.lectureArchive;
    // Navigation is always legal. The old page is archived before entering the next canvas.
    return event({...initialLessonState(readingLesson(current.title)),experiment:null,lectureArchive,
      lecture:nextLecture({...next,mode:'slides'})}, '讲到原稿第 '+next.pageNumber+' 页', {pageNumber:next.pageNumber,index:next.index});
  }
  if (type === 'lectureInteract') {
    if (current.mode !== 'slides' || !current.hasInteraction) reject('当前原页没有可开启的互动。');
    const page = score.pages[locateLectureFrame(score, current.index).pageIndex];
    const saved = state.lectureArchive.find(item => item.pageNumber === current.pageNumber);
    let active;
    let lectureArchive = state.lectureArchive;
    if (saved) {
      const {pageNumber,versionId,...previous} = saved;
      active = previous;
      lectureArchive = lectureArchive.filter(item => item !== saved);
    } else active = initialLessonState(page.interaction);
    return event({...active,lecture:nextLecture({mode:'activity'}),lectureArchive},
      '原稿第 '+page.number+' 页开启互动', {pageNumber:page.number,lessonId:active.lessonId});
  }
  if (type === 'lectureExperimentStart') {
    if (current.mode !== 'slides') reject('请先返回讲义。');
    const kind = challengeForFrame(lectureFrame(score, current.index));
    if (!kind) reject('本页没有匹配的实验。');
    return event({lecture:nextLecture({mode:'experiment'}), experiment:newChallenge(kind)},
      '从原页开启「'+challengeNames[kind]+'」', {pageNumber:current.pageNumber, kind});
  }
  if (type === 'experimentVote' || type === 'lectureExperimentAct') {
    if (current.mode !== 'experiment' || !state.experiment) reject('本页实验已经结束。');
    const prior = state.experiment;
    if (type === 'experimentVote') {
      const experiment = castVote(prior, payload.participantId, payload.choice);
      if (experiment === prior) return state;
      return event({experiment}, '实验收到一次投票', {pageNumber:current.pageNumber, step:prior.step});
    }
    const experiment = advanceChallenge(prior, payload);
    const labels = {measure:'已使用本轮唯一一次测量', diagnose:'已比较两个故障的预测', fit:'机器已根据三点锁定预测',
      test:'已揭晓盲测点的读数', refit:'机器已根据第四点重新拟合', reset:'已开始新一局实验', peer:'已展示离线预设推演示例'};
    const detail = {pageNumber:current.pageNumber, kind:prior.kind, action:payload.action, counts:publicChallenge(prior).counts};
    if (experiment.probe) Object.assign(detail, {probe:experiment.probe, reading:experiment.reading});
    if (experiment.choice) Object.assign(detail, {choice:experiment.choice, answer:experiment.answer});
    if (experiment.angle !== undefined) Object.assign(detail, {angle:experiment.angle, predicted:experiment.predicted, observed:experiment.observed});
    return event({lecture:payload.action === 'peer' ? current : nextLecture({}), experiment}, labels[payload.action], detail);
  }
  if (type === 'lectureResume' || type === 'lectureFinish') {
    const finished = type === 'lectureFinish';
    if (!finished && !['activity','experiment'].includes(current.mode)) return state;
    let lectureArchive = state.lectureArchive;
    if (current.mode === 'activity') {
      lectureArchive = lectureArchive.filter(item => item.pageNumber !== current.pageNumber);
      lectureArchive.push(activitySnapshot(state));
    }
    return event({...initialLessonState(readingLesson(current.title)),phase:finished?'closed':'collect',lectureArchive,
      ...(current.mode === 'experiment' ? {experiment:null} : {}),
      lecture:nextLecture({mode:finished?'ended':'slides'})}, finished?'讲义课堂已结束':'已返回原页讲授',{pageNumber:current.pageNumber});
  }
  if (['switchLesson','loadLesson'].includes(type) || (type !== 'join' && current.mode !== 'activity')) {
    reject('请先在对应的原页开启课堂互动。');
  }
  const next = reduceRoom(state, command);
  if (next === state) return state;
  const last = next.events.at(-1);
  const anchor = {lecturePageNumber:current.pageNumber,lectureVersionId:current.sourceVersion};
  // The reducer created this event and, for a response command, the matching answer.
  if (type === 'respond') {
    const response = next.responses.findLast(item => item.id === last.detail.responseId);
    Object.assign(response, anchor);
  }
  last.detail = {...last.detail, ...anchor};
  return next;
}
