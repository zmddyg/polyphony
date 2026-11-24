import { getActivity } from './activities.mjs';
import { getLesson } from './catalog.mjs';

const demoAnswers = {
  mzi: [
    ['林同学', 'dark', '在 A 口两束光相消，所以光能应该就没有了，B 口也不会亮。'],
    ['陈同学', 'dark', '两条光路都没有被挡住。如果 A 口变暗，B 口应该接收这部分能量。'],
    ['吴同学', 'half', '最后一块分束镜是五五分，我猜两个出口还是各有一半。'],
    ['周同学', 'dark', '波峰和波谷相遇后会抵掉。我不知道被抵掉的光还能去哪里。'],
    ['郑同学', 'dark', '相消只描述 A 口。B 口收到的两路振幅可能恰好同相。'],
    ['许同学', 'a', '光路没有改，我觉得光应该继续走原来的出口。'],
    ['唐同学', 'dark', 'B 口会亮。我想测两个出口的光强之和是否等于入射光强。'],
    ['顾同学', 'dark', '我觉得只有 A 口的数据还不足以知道 B 口会怎样。'],
    ['叶同学', 'dark', 'A、B 两口应此消彼长。我想同时记录两口。'],
  ],
  history: [
    ['林同学', 'poster', '既然有一百多人报名，到课六十人听起来很合理。'],
    ['陈同学', 'roll', '点名册里第一晚只有 42 人，所以至少这一晚不符合原来的说法。'],
    ['吴同学', 'memory', '学员在场，满座应该比教员在纸上写的数字更可信。'],
    ['周同学', 'roll', '这五天有四天低于 60 人。不过我们不能据此计算整个秋季的平均人数。'],
  ],
  blackbox: [
    ['林同学', 'three', '输入 3 时，平方得 9，乘以 2 则得 6。'],
    ['陈同学', 'two', '之前试过 2，用同一个数字应该更保险，也可以知道是不是平方。'],
    ['吴同学', 'claim', '2 的平方刚好是 4，已经可以确认机器在算平方了。'],
    ['周同学', 'three', '两条规则只要在某个输入上给出不同预测，机器的回答就能排除其中一条。'],
  ],
};

const demoMziGuesses = [0.95, 0.8, 0.56, 0.22, 0.32, 0.12, 0.47, 0.87, 0.98];

const lessonGuidance = {
  mzi: {
    focusOption: 'dark',
    branch: 'energy',
    contrast: '对照 A 口相消的解释与对 B 口的预测，再用两口的总光强检验。',
  },
  history: {
    focusOption: 'poster',
    branch: 'purpose',
    contrast: '对照报名人数与实际到课人数，核对每份材料可支持的主张。',
  },
  blackbox: {
    focusOption: 'two',
    branch: 'same',
    contrast: '比较重复输入 2 和改用输入 3 时，两条规则各自会怎样预测。',
  },
};

function fail(message) {
  throw new Error(message);
}

function clean(value, max, field, required = true) {
  if (typeof value !== 'string') fail(field + '必须是文本。');
  const result = value.trim();
  if (required && !result) fail('请填写' + field + '。');
  if (result.length > max) fail(field + '超过长度限制。');
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveLesson(id, customLessons = []) {
  return customLessons.find((lesson) => lesson.id === id) || getLesson(id);
}

function validateLesson(input) {
  if (!input || typeof input !== 'object') fail('请提供课程内容。');
  const id = clean(input.id, 64, '课程编号');
  if (!/^[a-z0-9_-]+$/i.test(id) || getLesson(id)) fail('请为自定义课程使用新的课程编号。');
  const activity = getActivity({ id, activityId: input.activityId });
  if (!activity) fail('课程使用了不支持的活动类型。');
  const unique = (items, field, min, max, map) => {
    if (!Array.isArray(items) || items.length < min || items.length > max) fail(field + '数量超出范围。');
    const result = items.map(map);
    if (new Set(result.map((item) => item.id)).size !== result.length) fail(field + '编号不能重复。');
    return result;
  };
  const notes = (items, field) => {
    if (items === undefined) return [];
    if (!Array.isArray(items) || items.length > 12) fail(field + '数量超出范围。');
    return items.map((item) => clean(item, 180, field));
  };
  return {
    id,
    activityId: activity.id,
    title: clean(input.title, 100, '课程标题'),
    subject: clean(input.subject, 80, '学科', false),
    description: clean(input.description, 500, '课程简介', false),
    prompt: clean(input.prompt, 2500, '课堂问题'),
    options: unique(input.options, '选项', 2, 12, (item) => ({
      id: clean(item?.id, 64, '选项编号'), label: clean(item?.label, 240, '选项文字'),
    })),
    branches: unique(input.branches, '分支', 1, 12, (item) => ({
      id: clean(item?.id, 64, '分支编号'),
      title: clean(item?.title, 120, '分支标题'),
      description: clean(item?.description, 700, '分支说明'),
      ...(item?.revisionPrompt && { revisionPrompt: clean(item.revisionPrompt, 700, '改答问题') }),
      ...(Array.isArray(item?.evidenceIds) && item.evidenceIds.length && {
        evidenceIds: [...new Set(item.evidenceIds.slice(0, 6).map((ref) => clean(ref, 16, '引用编号')))],
      }),
    })),
    ...(Array.isArray(input.materials) && input.materials.length && {
      materials: unique(input.materials, '编号材料', 1, 12, (item) => ({
        id: clean(item?.id, 16, '材料编号'),
        text: clean(item?.text, 2200, '材料原文'),
      })),
    }),
    skills: notes(input.skills, '能力目标'),
    steps: notes(input.steps, '课堂步骤'),
  };
}

function record(state, type, label, detail, at) {
  const version = state.version + 1;
  return {
    ...state,
    version,
    events: [...state.events, {
      id: 'event-' + version,
      type,
      label,
      at: typeof at === 'string' || Number.isFinite(at) ? at : version,
      detail,
    }],
  };
}

function startLesson(lesson) {
  return {
    lessonId: lesson.id,
    lesson: clone(lesson),
    phase: 'collect',
    responses: [],
    round: 1,
    revisionPrompt: null,
    decision: null,
    analysis: null,
    winner: null,
    winnerVisible: false,
    spotlight: [],
    timer: null,
  };
}

export { record as recordRoomEvent, startLesson as initialLessonState };

export function createRoom({ code = 'SHOW26', lessonId = 'mzi', demo = false, at } = {}) {
  const lesson = resolveLesson(lessonId);
  if (!lesson) fail('找不到这门课。');
  const room = record({
    code: clean(code, 32, '课堂码'),
    ...startLesson(lesson),
    demo: Boolean(demo),
    version: 0,
    participants: [],
    events: [],
    customLessons: [],
  }, 'room', '课堂已创建', { lessonId, demo: Boolean(demo) }, at);
  return demo ? reduceRoom(room, { type: 'demoFill', payload: { at } }) : room;
}

function responseEvidence(state, response) {
  const current = state.lesson.options.find(({ id }) => id === response.optionId);
  const participantIndex = state.participants.findIndex(({ id }) => id === response.participantId);
  const student = response.simulated ? '模拟同学' : '同学';
  return {
    id: response.id,
    text: student + ' ' + String(participantIndex + 1).padStart(2, '0') +
      ' · 第' + response.round + '轮 · 选择「' + current.label + '」' +
      (response.reason ? '：「' + response.reason.slice(0, 100) + (response.reason.length > 100 ? '…' : '') + '」' : ''),
    simulated: response.simulated,
    responseId: response.id,
    round: response.round,
  };
}

function mziExplanation(reason) {
  const clauses = reason.split(/[，。！？；、,.!?;\n]/u);
  const asserted = clauses.filter((clause) => !/不确定|不知道|无法判断|不能确定|不一定|未必|也许|说不准|是不是|假设|如果|看不出|是否|或者|还是|并非|不是说|不代表|不能说|吗$|么$/u.test(clause));
  const lost = asserted.some((clause) =>
    /B\s*(?:口|端)?(?:也|就|应该|仍|都)*(?:没有光|没光|不亮|不会亮|为暗|熄灭)|(?:两口|两个出口|两个都|A\s*[和与]\s*B)\s*(?:都)?(?:不亮|没有光|没光|暗)|(?:光能|能量|光)(?:就|都|会|已经|应该|完全)*(?:消失了?|没有了)/iu.test(clause));
  const transferred = asserted.some((clause) =>
    /B\s*(?:口|端)?(?:会|就|应该|仍然)?(?:亮起来|亮|变亮|相长|接收|得到)|(?:转移|转|去|流|改走|集中)(?:到了?|向)?\s*B\s*(?:口|端)?/iu.test(clause));
  if (lost === transferred) return null;
  return lost ? 'lost' : 'transferred';
}

export function analyze(state) {
  const live = [];
  const simulated = [];
  for (const response of state.responses) {
    if (response.round === state.round) (response.simulated ? simulated : live).push(response);
  }
  const sample = live.length ? live : simulated;
  const tallies = new Map(state.lesson.options.map(({ id }) => [id, { count: 0, example: null }]));
  let reasonCount = 0;
  for (const response of sample) {
    if (response.reason) reasonCount++;
    const tally = tallies.get(response.optionId);
    if (!tally) continue;
    tally.count++;
    if (!tally.example || (!tally.example.reason && response.reason)) tally.example = response;
  }
  const count = id => tallies.get(id)?.count ?? 0;
  const ranked = state.lesson.options.filter(({ id }) => count(id) > 0).sort((a, b) => count(b.id) - count(a.id));
  const activity = getActivity(state.lesson);
  const guidance = activity && Object.hasOwn(lessonGuidance, activity.scene) ? lessonGuidance[activity.scene] : undefined;
  const focus = guidance && count(guidance.focusOption) &&
    state.lesson.branches.some(({ id }) => id === guidance.branch) ? guidance : undefined;
  const scope = live.length ? '本轮 ' + live.length + ' 份真实作答' : '本轮 ' + sample.length + ' 份模拟作答';
  let headline = '本轮还没有作答';
  let summary = '收集选择和理由后，才能引用本班证据。可以先请同学独立提交。';
  if (sample.length) {
    const split = ranked.map(({ id, label }) => '「' + label + '」' + count(id) + ' 份').join('，');
    if (ranked.length === 1) headline = '当前作答集中在一个选项';
    if (ranked.length > 1) {
      headline = count(ranked[0].id) === count(ranked[1].id)
        ? '当前有多个选项并列'
        : '当前作答出现不同预测';
    }
    summary = scope + '中，' + split + '。';
    if (!reasonCount) summary += '目前只有选择，无法判断同学为何这样选。';
    else if (reasonCount === 1) summary += '目前只有一份理由，可用来追问，仍不足以判断全班的想法。';
    else if (focus) summary += focus.contrast + '选项分布只能提示从哪里追问。';
    else summary += '可以让同学用原话说明理由，并明确什么证据会改变他们的判断。';
    if (live.length && simulated.length) summary += '模拟作答另有 ' + simulated.length + ' 份。';
  }
  const selected = ranked.slice(0, 4).map(({ id }) => tallies.get(id).example);
  let contrastEvidenceIds;
  if (activity?.scene === 'mzi' && focus) {
    let predictsLost, predictsTransfer;
    for (const response of sample) {
      if (response.optionId !== 'dark') continue;
      const explanation = mziExplanation(response.reason.slice(0, 100));
      if (explanation === 'lost') predictsLost ??= response;
      if (explanation === 'transferred') predictsTransfer ??= response;
      if (predictsLost && predictsTransfer) break;
    }
    if (predictsLost && predictsTransfer) {
      headline = '同选 A 口变暗，对 B 口的预测不同';
      summary += '两条原话给出了不同解释，一条认为光消失或两口都暗，另一条认为光会从 B 口出来。';
      contrastEvidenceIds = [predictsLost.id, predictsTransfer.id];
      const otherChoices = selected.filter(({ optionId }) => optionId !== 'dark');
      selected.splice(0, selected.length, predictsLost, predictsTransfer, ...otherChoices);
    }
  }
  const chosen = new Set(selected.map(({ id }) => id));
  for (const response of sample) {
    if (selected.length === 6) break;
    if (response.reason && !chosen.has(response.id)) selected.push(response);
  }
  return {
    headline,
    summary,
    evidence: selected.map((response) => responseEvidence(state, response)),
    ...(contrastEvidenceIds && { contrastEvidenceIds }),
    branches: clone(state.lesson.branches),
    recommendedId: focus && reasonCount > 1 ? focus.branch : state.lesson.branches[0].id,
    source: 'local',
  };
}

export function analysisCandidates(state, limit = 48) {
  const live = [];
  const simulated = [];
  for (const response of state.responses) {
    if (response.round === state.round) (response.simulated ? simulated : live).push(response);
  }
  const sample = live.length ? live : simulated;
  if (!sample.length) return [];
  const buckets = new Map(state.lesson.options.map(({ id }) => [id, []]));
  for (const response of sample) {
    const list = buckets.get(response.optionId);
    if (list) list.push(response);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => Number(Boolean(b.reason?.trim())) - Number(Boolean(a.reason?.trim())));
  }
  const chosen = [];
  const seen = new Set();
  const fallback = analyze(state);
  for (const item of fallback.evidence) {
    const original = sample.find((r) => r.id === item.id);
    if (original && !seen.has(original.id)) {
      seen.add(original.id);
      chosen.push(original);
    }
  }
  const lists = [...buckets.values()];
  let progress = true;
  while (chosen.length < limit && progress) {
    progress = false;
    for (const list of lists) {
      while (list.length && seen.has(list[0].id)) list.shift();
      if (!list.length) continue;
      const next = list.shift();
      seen.add(next.id);
      chosen.push(next);
      progress = true;
      if (chosen.length >= limit) break;
    }
  }
  return chosen.map((response) => responseEvidence(state, response));
}

function validateProviderAnalysis(provider, fallback, candidates = fallback.evidence) {
  if (!provider || typeof provider !== 'object') fail('收到的分析格式无效。');
  const validIds = new Map([...fallback.evidence, ...candidates].map((item) => [item.id, item]));
  const recommendedId = provider.recommendedId ?? fallback.recommendedId;
  if (!fallback.branches.some(({ id }) => id === recommendedId)) fail('分析推荐了不存在的分支。');
  if (!validIds.size) return fallback;
  if (!Array.isArray(provider.evidence) || provider.evidence.length < 1 || provider.evidence.length > 6) {
    fail('分析须引用本轮已提交的课堂证据。');
  }
  const ids = new Set();
  const evidence = provider.evidence.map((item) => {
    const original = validIds.get(item?.id);
    if (!original || ids.has(original.id) || (item.text !== undefined && item.text !== original.text)) {
      fail('分析引用了无效或重复的课堂证据。');
    }
    ids.add(original.id);
    return original;
  });
  let clusters;
  if (provider.clusters !== undefined) {
    if (!Array.isArray(provider.clusters)) fail('观点聚类格式无效。');
    const kept = [];
    for (const cluster of provider.clusters) {
      if (!cluster || typeof cluster !== 'object') continue;
      const label = typeof cluster.label === 'string' ? cluster.label.trim().slice(0, 48) : '';
      const summary = typeof cluster.summary === 'string' ? cluster.summary.trim().slice(0, 180) : '';
      if (!label || !summary || !Array.isArray(cluster.evidenceIds)) continue;
      const uniqueRefs = [...new Set(cluster.evidenceIds.filter((id) => validIds.has(id)))].slice(0, 6);
      if (!uniqueRefs.length) continue;
      kept.push({ label, summary, evidenceIds: uniqueRefs });
      if (kept.length >= 4) break;
    }
    if (kept.length) clusters = kept;
  }
  const headline = typeof provider.headline === 'string' && provider.headline.trim()
    ? clean(provider.headline, 80, '诊断结论') : fallback.headline;
  const summary = typeof provider.summary === 'string' && provider.summary.trim()
    ? clean(provider.summary, 280, '诊断说明') : fallback.summary;
  const contrast = (fallback.contrastEvidenceIds ?? []).map((id) => validIds.get(id)).filter(Boolean);
  const required = new Set(contrast.map(({ id }) => id));
  return {
    ...fallback,
    headline,
    summary,
    evidence: [...contrast, ...evidence.filter(({ id }) => !required.has(id))].slice(0, 6),
    ...(clusters && { clusters }),
    recommendedId,
    source: 'provider',
  };
}

function fillDemo(state, at) {
  if (state.phase !== 'collect') fail('请在作答阶段加入模拟样本。');
  const answers = demoAnswers[state.lessonId];
  if (!Array.isArray(answers)) fail('这门课没有预设的模拟样本。');
  const participants = [...state.participants];
  const responses = [...state.responses];
  answers.forEach(([name, optionId, reason], index) => {
    const id = 'demo-' + state.lessonId + '-' + (index + 1);
    if (!participants.some((participant) => participant.id === id)) participants.push({ id, name, simulated: true });
    if (!responses.some((response) => response.participantId === id && response.round === state.round)) {
      const sample = state.lessonId === 'mzi'
        ? { phaseIndex: index, power: demoMziGuesses[index] }
        : undefined;
      responses.push({
        ...(sample && { sample }),
        id: 'response-' + (state.version + 1) + '-' + (index + 1),
        participantId: id, optionId, reason, round: state.round, simulated: true,
      });
    }
  });
  if (responses.length === state.responses.length) return state;
  return record({ ...state, demo: true, participants, responses }, 'demoFill', '已加入模拟作答', {
    count: responses.length - state.responses.length, simulated: true, round: state.round,
  }, at);
}

export function drawCandidates(state) {
  const submittedIds = new Set(state.responses.map(({ participantId }) => participantId));
  const eligible = state.participants.filter(({ id }) => submittedIds.has(id));
  const real = eligible.filter(({ simulated }) => !simulated);
  if (real.length) return real;
  return state.demo ? eligible.filter(({ simulated }) => simulated) : [];
}

function drawIndex(state, random, size) {
  if (random !== undefined) {
    if (!Number.isFinite(random) || random < 0 || random >= 1) fail('抽签数值超出范围。');
    return Math.floor(random * size);
  }
  let hash = 2166136261;
  const seed = state.code + '|' + state.version + '|' + state.participants.map(({ id }) => id).join('|');
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % size;
}

export function reduceRoom(state, { type, payload = {} }) {
  if (!state || !state.lesson || !Array.isArray(state.events)) fail('课堂状态无效。');
  if (!payload || typeof payload !== 'object') fail('课堂操作参数无效。');
  if ((payload.expectedRound !== undefined && payload.expectedRound !== state.round)
      || (payload.expectedLessonId !== undefined && payload.expectedLessonId !== state.lessonId)) {
    fail('课堂已进入新的课谱或轮次，请按照当前题目重新操作。');
  }
  const { at } = payload;
  const transition = (patch, label, detail = null) => record({ ...state, ...patch }, type, label, detail, at);
  const requirePhase = (...phases) => {
    if (!phases.includes(state.phase)) fail('当前课堂阶段无法进行这项操作。');
  };
  switch (type) {
    case 'join': {
      requirePhase('collect', 'reveal', 'branch');
      const id = clean(payload.participantId, 100, '学员编号');
      const name = clean(payload.name, 48, '显示名');
      if (id.startsWith('demo-')) fail('该学员编号保留给模拟数据。');
      const existing = state.participants.find((participant) => participant.id === id);
      if (existing?.name === name) return state;
      const participant = { id, name, simulated: false };
      const participants = existing
        ? state.participants.map((item) => item.id === id ? participant : item)
        : [...state.participants, participant];
      return transition({ participants }, existing ? '同学更新了显示名' : '有同学加入课堂', { participantId: id });
    }
    case 'removeParticipant': {
      const id = clean(payload.participantId, 100, '学员编号');
      const existing = state.participants.find((participant) => participant.id === id);
      if (!existing || existing.simulated) fail('只能清理未提交作答的现场在线记录。');
      if (state.responses.some((response) => response.participantId === id)) {
        fail('该同学已提交作答记录，不能移除。');
      }
      const participants = state.participants.filter((participant) => participant.id !== id);
      return transition({ participants }, '已清理未作答的重复加入记录', { participantId: id });
    }
    case 'respond': {
      requirePhase('collect');
      const { participantId, optionId } = payload;
      const participant = state.participants.find(({ id }) => id === participantId);
      if (!participant || participant.simulated) fail('请先加入课堂。');
      if (!state.lesson.options.some(({ id }) => id === optionId)) fail('请选择有效选项。');
      const reason = clean(payload.reason ?? '', 1000, '作答理由', false);
      const existing = state.responses.find((item) => item.participantId === participantId && item.round === state.round);
      let sample = existing?.sample;
      if (payload.sample !== undefined) {
        const { phaseIndex, power } = payload.sample ?? {};
        if (getActivity(state.lesson)?.input !== 'phase-power' || !Number.isInteger(phaseIndex) || phaseIndex < 0 || phaseIndex > 8 ||
            !Number.isFinite(power) || power < 0 || power > 1) fail('实验读数无效。');
        sample = { phaseIndex, power };
      }
      if (existing?.optionId === optionId && existing.reason === reason &&
          existing.sample?.phaseIndex === sample?.phaseIndex && existing.sample?.power === sample?.power) return state;
      const response = {
        id: existing?.id ?? 'response-' + (state.version + 1),
        participantId, optionId, reason, round: state.round, simulated: false,
        ...(sample && { sample }),
      };
      const responses = existing
        ? state.responses.map((item) => item.id === existing.id ? response : item)
        : [...state.responses, response];
      return transition({ responses }, existing ? '一份作答已更新' : '收到一份作答', { responseId: response.id, round: state.round });
    }
    case 'reveal':
      if (state.phase === 'reveal') return state;
      requirePhase('collect');
      return transition({ phase: 'reveal', timer: null }, '本轮作答已公布', { round: state.round });
    case 'analyze': {
      requirePhase('reveal', 'branch');
      const fallback = analyze(state);
      const candidates = payload.analysis === undefined ? fallback.evidence : analysisCandidates(state, 48);
      const analysis = payload.analysis === undefined ? fallback : validateProviderAnalysis(payload.analysis, fallback, candidates);
      if (JSON.stringify(analysis) === JSON.stringify(state.analysis)) return state;
      return transition({ analysis }, '已整理课堂证据', { source: analysis.source, evidenceIds: analysis.evidence.map(({ id }) => id) });
    }
    case 'spotlight': {
      requirePhase('reveal', 'branch', 'closed');
      if (!Array.isArray(payload.responseIds) || payload.responseIds.length > 2) {
        fail('大屏最多同时对比展示 2 条匿名原话。');
      }
      const uniqueIds = [...new Set(payload.responseIds)];
      if (uniqueIds.length !== payload.responseIds.length) fail('投屏原话编号不能重复。');
      const spotlight = uniqueIds.map((id) => {
        const response = state.responses.find((item) => item.id === id && item.round === state.round);
        if (!response) fail('只能投屏本轮已提交的课堂作答。');
        const reason = typeof response.reason === 'string' ? response.reason.trim() : '';
        if (!reason) fail('这条作答没有填写文字理由。');
        const option = state.lesson.options.find((item) => item.id === response.optionId);
        return {
          id: response.id,
          optionId: response.optionId,
          optionLabel: option?.label ?? response.optionId,
          round: response.round,
          text: reason.slice(0, 280),
          simulated: Boolean(response.simulated),
        };
      });
      if (JSON.stringify(spotlight) === JSON.stringify(state.spotlight ?? [])) return state;
      return transition({ spotlight }, spotlight.length ? '已匿名投屏典型作答' : '已取消大屏作答对比', {
        round: state.round,
        count: spotlight.length,
        evidenceIds: spotlight.map(({ id }) => id),
      });
    }
    case 'spotlightWinner': {
      if (!state.winner) fail('请先完成一次抽签。');
      const visible = Boolean(payload.visible);
      if (Boolean(state.winnerVisible) === visible) return state;
      return transition({ winnerVisible: visible }, visible ? '已在大屏公布抽签结果' : '已隐藏大屏抽签结果', {
        visible, participantId: state.winner.id,
      });
    }
    case 'timer': {
      requirePhase('collect', 'reveal', 'branch');
      const rawSeconds = payload.seconds ?? payload.durationSec;
      const seconds = rawSeconds == null ? 0 : Number(rawSeconds);
      if (!Number.isInteger(seconds) || (seconds !== 0 && (seconds < 15 || seconds > 1800))) {
        fail('计时时长须为 15 至 1800 秒。');
      }
      const startedAt = Number.isFinite(at) ? at : Date.now();
      const timer = seconds ? { startedAt, seconds, durationSec: seconds, endsAt: startedAt + seconds * 1000 } : null;
      if (!timer && !state.timer) return state;
      return transition({ timer }, timer ? `已开启 ${Math.round(seconds / 60 * 10) / 10} 分钟倒计时` : '已结束倒计时', {
        seconds, durationSec: seconds, endsAt: timer?.endsAt ?? null, round: state.round,
      });
    }
    case 'branch': {
      if (state.phase === 'branch' && state.decision?.branchId === payload.branchId) return state;
      requirePhase('reveal', 'branch');
      if (state.round !== 1) fail('教学分支须在第一轮公布后选择。');
      const branch = state.lesson.branches.find(({ id }) => id === payload.branchId);
      if (!branch) fail('请选择本课程的有效分支。');
      const analysis = state.analysis ?? analyze(state);
      const decision = { branchId: branch.id, title: branch.title, evidenceIds: analysis.evidence.map(({ id }) => id) };
      return transition({ phase: 'branch', decision, analysis }, '已选择教学分支', decision);
    }
    case 'revise': {
      if (state.round === 2 && state.phase === 'collect') return state;
      requirePhase('branch');
      if (state.round !== 1 || !state.decision) fail('请先选定第一轮的教学分支。');
      const branch = state.lesson.branches.find(({ id }) => id === state.decision.branchId);
      const revisionPrompt = branch.revisionPrompt ?? ('完成「' + branch.title + '」后，结合新证据重新回答题目。' + state.lesson.prompt);
      return transition({ phase: 'collect', round: 2, analysis: null, spotlight: [], winnerVisible: false, timer: null, revisionPrompt }, '第二轮改答已开启', {
        round: 2, branchId: branch.id, revisionPrompt,
      });
    }
    case 'close':
      if (state.phase === 'closed') return state;
      requirePhase('reveal', 'branch');
      return transition({ phase: 'closed', timer: null }, '课堂已结束', { round: state.round });
    case 'draw': {
      const candidates = drawCandidates(state);
      const eligibleCount = candidates.length;
      if (!eligibleCount) fail('需要至少一位同学提交有效作答才能抽签。');
      const { id, name, simulated } = candidates[drawIndex(state, payload.random, eligibleCount)];
      const winner = { name, id, simulated, eligibleCount };
      const detail = {
        participantId: id,
        simulated,
        eligibleCount,
        eligibleSource: simulated ? 'simulated' : 'live',
        eligibleIds: candidates.map((participant) => participant.id),
      };
      return transition({ winner, winnerVisible: false }, simulated ? '已从模拟作答者中抽签' : '已从提交作答的同学中抽签', detail);
    }
    case 'switchLesson': {
      const lesson = resolveLesson(payload.lessonId, state.customLessons);
      if (!lesson) fail('找不到这门课。');
      if (state.lessonId === lesson.id && state.phase === 'collect' && state.round === 1) return state;
      const participants = state.participants.filter(({ simulated }) => !simulated);
      const next = transition({ ...startLesson(lesson), participants }, '已切换课程', { lessonId: lesson.id });
      return state.demo && Array.isArray(demoAnswers[lesson.id]) ? fillDemo(next, at) : next;
    }
    case 'loadLesson': {
      const lesson = validateLesson(payload.lesson);
      const customLessons = [...(state.customLessons ?? []).filter(({ id }) => id !== lesson.id), lesson];
      if (state.lessonId === lesson.id && state.phase === 'collect' && state.round === 1 &&
          JSON.stringify(state.lesson) === JSON.stringify(lesson)) return state;
      const participants = state.participants.filter(({ simulated }) => !simulated);
      return transition({ ...startLesson(lesson), participants, customLessons }, '已载入自定义课程', { lessonId: lesson.id });
    }
    case 'demoFill':
      return fillDemo(state, at);
    default:
      fail('未知的课堂操作。');
  }
}
