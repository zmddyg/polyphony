import { mzmTransfer } from './optics.mjs';
import { getActivity, validateModulePayload } from './activities.mjs';
import { getLesson } from './catalog.mjs';

const demoAnswers = {
  "mzi": [
    [
      "林同学",
      "dark",
      "A 应该对，谷底像二极管把负半周截断，所以出现二倍频。"
    ],
    [
      "陈同学",
      "dark",
      "cos(π+δ) 的二次项导致 sin² 倍频；振幅和差平方比给 ER 约 15.3 dB。"
    ],
    [
      "吴同学",
      "valley",
      "暗背景噪声低，放谷底线性度最好；3 dB 损耗不至于让 ER 低于 25 dB。"
    ],
    [
      "周同学",
      "dark",
      "我选 A，因为两臂抵掉的能量凭空消失了，剩下的才是倍频信号。"
    ],
    [
      "郑同学",
      "dark",
      "两臂振幅 1 与约 0.707 不等，和差平方比给 ER 约 15.3 dB；偶函数二次项让基频消失。"
    ],
    [
      "许同学",
      "peak",
      "0° 光最强，输出越大应当越线性；功率少一半，ER 就是 3 dB。"
    ],
    [
      "唐同学",
      "dark",
      "正交点斜率最大；谷底的二次项产生 2f，静态 ER 按振幅差平方算约 15.3 dB。"
    ],
    [
      "顾同学",
      "dark",
      "正弦负半波被二极管削波，像半波整流，故我赞成 A。"
    ],
    [
      "叶同学",
      "proportional",
      "单臂功率少一半，总输出变 0.75 倍；整条曲线等比缩小，谷底仍为零。"
    ],
    [
      "赵同学",
      "dark",
      "π 处一次导数为零，偶函数二次项 sin² 含直流和 2f；振幅和差平方比给 ER 约 15.3 dB。"
    ],
    [
      "何同学",
      "dark",
      "A 对，调制器像半波截断器削掉负半周，所以正负两段都变成亮脉冲。"
    ],
    [
      "沈同学",
      "valley",
      "要提高调制深度就必须靠近全暗谷底；ER 高低应该不受损耗影响。"
    ]
  ],
  "rc-fault": [
    [
      "林同学",
      "bode",
      "时域看不出来，网络分析仪多扫几个频点就能分别拟合 R 和 C。"
    ],
    [
      "陈同学",
      "current",
      "两故障 τ 都是 2 μs；瞬间电流分别 0.25、0.50 mA，可独立约束 R。"
    ],
    [
      "吴同学",
      "early",
      "完整波形比一个点信息多，做非线性拟合应能把 R、C 都解出来。"
    ],
    [
      "周同学",
      "bode",
      "波特图同时有幅度和相位，两个曲线足够解两个未知量。"
    ],
    [
      "郑同学",
      "current",
      "电压传函只含 RC；V꜀(0⁺)=0，i(0⁺)=5/R，电流测量打破参数简并。"
    ],
    [
      "许同学",
      "steady",
      "充稳电压应该随电容容量变化，200 pF 的最终电压会低一点。"
    ],
    [
      "唐同学",
      "current",
      "RC 同为 2 μs，带宽同为 79.58 kHz；初始电流却由电阻单独决定。"
    ],
    [
      "顾同学",
      "early",
      "2 μs 点应该正好落在两个响应的分叉处。"
    ],
    [
      "叶同学",
      "bode",
      "仪器带宽够高就不存在时域的简并，频域能分。"
    ],
    [
      "赵同学",
      "current",
      "先算两种假设的初始电流再测；示波器记录更长的电压曲线仍只约束乘积。"
    ],
    [
      "何同学",
      "bode",
      "−3 dB 截止点一定随电阻和电容的故障类别分别移动。"
    ],
    [
      "沈同学",
      "current",
      "改变观测量比增加电压采样更关键，0.25 与 0.50 mA 是可分的预测。"
    ]
  ],
  "optical-aliasing": [
    [
      "林同学",
      "occam",
      "三个数据点已经零误差，最简模型应该就是真实器件。"
    ],
    [
      "陈同学",
      "180",
      "两模型在 180° 预测为 0 与 1，相差 100 个百分点，能证伪其一。"
    ],
    [
      "吴同学",
      "120",
      "先把已知点重复测准，训练误差更小后就能确定周期。"
    ],
    [
      "周同学",
      "360",
      "测量跨度越大信息越多，所以盲测 360°。"
    ],
    [
      "郑同学",
      "180",
      "训练零误差只说明相容；应挑模型预测分歧最大而非测量跨度最大的角。"
    ],
    [
      "许同学",
      "occam",
      "单周期参数少，用奥卡姆原则即可排除二倍频。"
    ],
    [
      "唐同学",
      "180",
      "在公共交点再采样不会破简并，180° 是预测最大的分歧点。"
    ],
    [
      "顾同学",
      "360",
      "两倍周期一定会在扫描终点比单周期多一个峰，测终点最方便。"
    ],
    [
      "叶同学",
      "120",
      "复测能降低噪声，所以必能消除谱形混叠。"
    ],
    [
      "赵同学",
      "180",
      "不看真值先登记预测，再盲测；验证集应包含未参与拟合的判别点。"
    ],
    [
      "何同学",
      "occam",
      "RMS 为零意味着模型足够准确，无需额外盲测。"
    ],
    [
      "沈同学",
      "180",
      "0、120、240° 同时符合两个谐波模型，180° 才有区分力。"
    ]
  ]
};

const demoMziGuesses = [0.95, 0.8, 0.56, 0.22, 0.32, 0.12, 0.47, 0.87, 0.98];
const lessonGuidance = {
  "mzi": {
    "focusOption": "dark",
    "branch": "energy",
    "contrast": "同选正确选项也可能混淆偶函数二次项与半波截断；用谐波和双端读数核对理由。"
  },
  "rc-fault": {
    "focusOption": "bode",
    "branch": "degeneracy",
    "contrast": "完整波形与波特图都只约束 RC，需改用独立约束 R 的初始电流。"
  },
  "optical-aliasing": {
    "focusOption": "occam",
    "branch": "blind",
    "contrast": "零训练误差不能证明模型正确，先锁定竞争预测再做 180° 盲测。"
  }
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
  if (input.moduleConfig !== undefined || !['choice@1','mzi-phase@1','rc-degeneracy@1','spectral-aliasing@1'].includes(activity.id)) validateModulePayload(activity.id, input.moduleConfig);
  if (input.correctOptionId != null && !input.options?.some(o => o.id === input.correctOptionId)) fail('标准答案须对应选项。');
  if (activity.id === 'step-fault@1' && (input.correctOptionId !== input.moduleConfig.faultStepId || input.options.some(o => !input.moduleConfig.steps.some(s => s.id === o.id)) || !input.options.some(o => o.id === input.moduleConfig.faultStepId))) fail('找茬选项与步骤编号不匹配。');
  const sourceTakeaway=input.takeaway??input.moduleConfig?.takeaway;
  let takeaway;
  if(sourceTakeaway){
    if(typeof sourceTakeaway!=='object'||Array.isArray(sourceTakeaway))fail('速查卡格式无效。');
    takeaway={pitfall:clean(sourceTakeaway.pitfall,900,'易错提醒'),
      ...(sourceTakeaway.formula!==undefined&&{formula:clean(sourceTakeaway.formula,1500,'速查公式')}),
      ...(sourceTakeaway.summary!==undefined&&{summary:clean(sourceTakeaway.summary,900,'速查总结')})};
    if(!takeaway.formula&&!takeaway.summary)fail('速查卡需要公式或总结。');
  }
  return {
    id,
    activityId: activity.id,
    ...(input.correctOptionId !== undefined && {correctOptionId: input.correctOptionId}),
    ...(input.moduleConfig && {moduleConfig: clone(input.moduleConfig)}),
    ...(input.evidenceIds && {evidenceIds: clone(input.evidenceIds)}),
    ...(input.sourceEvidence && {sourceEvidence: clone(input.sourceEvidence)}),
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
      ...(item?.evidenceIds && { evidenceIds: clone(item.evidenceIds) }),
      ...(item?.revisionPrompt && { revisionPrompt: clean(item.revisionPrompt, 700, '改答问题') }),
    })),
    skills: notes(input.skills, '能力目标'),
    steps: notes(input.steps, '课堂步骤'),
    ...((input.quickReasons ?? input.moduleConfig?.quickReasons) && { quickReasons: notes(input.quickReasons ?? input.moduleConfig.quickReasons, '快选理由') }),
    ...(takeaway && { takeaway }),
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
    firstRoundAnalysis: null,
    winner: null,
    aiPeerRevealed: false,
  };
}

export { record as recordRoomEvent, startLesson as initialLessonState };

export function createRoom({ code = 'SHOW26', lessonId = 'four-spaces', demo = false, at } = {}) {
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
      ' · 第' + response.round + '轮 · 选择「' + (current?.label ?? response.optionId) + '」' +
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

function reasoningTone(reason, scene) {
  const clauses = reason.split(/[，。！？；,.!?;\n]/u).filter(c => !/不是|并非|不能说|不代表|不确定|不知道|是否|未必|不一定/u.test(c));
  const text = clauses.join('；');
  if (scene === 'mzi') {
    if (/半波|二极管|削波|(?:能量|光能).{0,8}(?:消失|抵消)/u.test(text)) return 'alert';
    if (/二次项|偶函数|振幅.{0,15}(?:平方|差)|15[.．]3/u.test(text)) return 'insight';
  } else if (scene === 'rc-fault') {
    if (/(?:波特|频域|完整波形|拟合).{0,20}(?:一定|能分|足够解|解出来)|越多/u.test(text)) return 'alert';
    if (/只(?:含|约束)|简并|初始电流|瞬间电流|0[.．]25/u.test(text)) return 'insight';
  } else if (scene === 'optical-aliasing') {
    if (/最简.{0,12}(?:真|排除)|零误差.{0,15}(?:意味|真实|证明)|跨度越大/u.test(text)) return 'alert';
    if (/证伪|分歧|区分力|盲测|相差.{0,8}100/u.test(text)) return 'insight';
  }
  if (/必然|一定|直接证明|已经证明|无需验证|足以确认/u.test(text)) return 'alert';
  if (/不足以|不能证明|还需要|还需|未必|独立证据/u.test(text)) return 'insight';
  return null;
}

function representativePair(sample, scene, lesson) {
  const withReasons = sample.filter(r => r.reason?.trim());
  if (lesson.activityId === 'step-fault@1' && lesson.moduleConfig?.artifactLang === 'code') {
    const flawed = withReasons.find(r => r.optionId !== lesson.correctOptionId && /NULL|打印|读取|赋值/u.test(r.reason));
    const sound = withReasons.find(r => r.optionId === lesson.correctOptionId && /解引用|有效.*对象/u.test(r.reason));
    if (flawed && sound) return [flawed, sound];
  }
  if(lesson.activityId==='concept-diagnosis@1') {
    const assumptions=withReasons.filter(r=>/我把|我觉得|我认为|等同于/u.test(r.reason));
    for(const assumption of assumptions) {
      const contrast=withReasons.find(r=>r.optionId===assumption.optionId&&r.reason!==assumption.reason&&!/我把|我觉得|我认为|等同于/u.test(r.reason));
      if(contrast)return [assumption,contrast];
    }
  }
  const alert = withReasons.find(r => reasoningTone(r.reason, scene) === 'alert');
  const insight = withReasons.find(r => reasoningTone(r.reason, scene) === 'insight');
  if (alert && insight) return [alert, insight];
  const first = withReasons[0];
  if (!first) return [];
  const opposite = withReasons.find(r => r.optionId !== first.optionId);
  // Different unclassified reasons are not asserted to be logically contradictory.
  if (!opposite) return [];
  return reasoningTone(first.reason, scene) === 'insight' || reasoningTone(opposite.reason, scene) === 'alert'
    ? [opposite, first] : [first, opposite];
}

export function analyze(state) {
  const live = [];
  const simulated = [];
  for (const response of state.responses) {
    if (response.round === state.round) (response.simulated ? simulated : live).push(response);
  }
  const sample = live.length ? live : simulated;
  const tallies = new Map(state.lesson.options.map(({ id }) => [id, { count: 0, example: null, excerpts: [] }]));
  let reasonCount = 0;
  for (const response of sample) {
    if (response.reason) reasonCount++;
    const tally = tallies.get(response.optionId);
    if (!tally) continue;
    tally.count++;
    if (!tally.example || (!tally.example.reason && response.reason)) tally.example = response;
    if (tally.excerpts.length < 2) {
      const reason = response.reason?.trim();
      if (reason) tally.excerpts.push(reason.slice(0, 140).replace(/[\uD800-\uDBFF]$/u, ''));
    }
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
  const pair = representativePair(sample, activity?.scene, state.lesson);
  if (pair.length === 2) {
    contrastEvidenceIds = pair.map(r => r.id);
    selected.splice(0, selected.length, ...pair, ...selected.filter(r => !pair.includes(r)));
    if (activity?.scene === 'mzi' && pair[0].optionId === 'dark' && pair[1].optionId === 'dark') {
      headline = '同选 A，物理机制却相反';
      summary += '一条原话用半波截断或能量消失解释，另一条指出二次项倍频与振幅差；选对选项不等于掌握机制。';
    }
    else if(pair[0].optionId===pair[1].optionId){headline='同选一项，理由仍需对撞核验';summary+='两份相同选择包含不同前提；选项一致不能证明理解一致。';}
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
    contrastPair: pair.map((response, index) => ({
      sideLabel: (index===0?'待核验解释':'对照解释（同样需证据）')+' · 选择 '+String.fromCharCode(65+state.lesson.options.findIndex(o=>o.id===response.optionId)),
      tone: index === 0 ? 'alert' : 'insight', quote: response.reason,
    })),
    optionExcerpts: Object.fromEntries([...tallies].map(([id, { excerpts }]) => [id, excerpts])),
    branches: clone(state.lesson.branches),
    recommendedId: focus && reasonCount > 1 ? focus.branch : state.lesson.branches[0].id,
    source: 'local',
  };
}

function validateProviderAnalysis(provider, fallback) {
  if (!provider || typeof provider !== 'object') fail('收到的分析格式无效。');
  const validIds = new Map(fallback.evidence.map((item) => [item.id, item]));
  const recommendedId = provider.recommendedId ?? fallback.recommendedId;
  if (!fallback.branches.some(({ id }) => id === recommendedId)) fail('分析推荐了不存在的分支。');
  if (!fallback.evidence.length) return fallback;
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
  const contrast = (fallback.contrastEvidenceIds ?? []).map((id) => validIds.get(id));
  const required = new Set(contrast.map(({ id }) => id));
  return {
    ...fallback,
    evidence: [...contrast, ...evidence.filter(({ id }) => !required.has(id))].slice(0, 6),
    recommendedId,
    source: 'provider',
  };
}

function fillDemo(state, at) {
  if (state.phase !== 'collect') fail('请在作答阶段加入模拟样本。');
  const config = state.lesson.moduleConfig ?? {};
  const steps = config.steps ?? [];
  const faultIndex = steps.findIndex(s => s.id === config.faultStepId);
  const fault = steps[faultIndex];
  // Contract ids, rather than a course name or S1, determine the simulated split.
  // Twelve explicitly simulated learners give 5/4/3 (42/33/25 after rounding).
  const distractors = steps.filter(s => s.id !== fault?.id && state.lesson.options.some(o => o.id === s.id))
    .sort((a,b) => Math.abs(steps.indexOf(a)-faultIndex)-Math.abs(steps.indexOf(b)-faultIndex));
  // In the swap example, contrast the NULL initialization with the later read.
  // Both are plausible competing explanations of the first invalid write.
  if (fault && /\*temp\s*=\s*\*px/.test(fault.content)) {
    const laterRead = distractors.find(s => /\*py\s*=\s*\*temp/.test(s.content));
    if (laterRead) distractors.splice(1, 0, distractors.splice(distractors.indexOf(laterRead), 1)[0]);
  }
  const stepAnswers = state.lesson.activityId === 'step-fault@1' && fault && distractors.length
    ? Array.from({length:12}, (_,i) => {
      const step = i < 5 ? fault : i < 9 ? distractors[0] : (distractors[1] ?? distractors[0]);
      const reason = i < 5 ? ((config.quickReasons??[]).find(r=>r.includes(`第 ${fault.line} 行`)&&r.includes('首次')) ?? config.faultDiagnosis ?? `首次不成立的是第 ${fault.line} 步：${fault.content}`)
        : `我认为第 ${step.line} 行 / 步「${step.content}」已经不成立；需要与首次失效步骤的前提逐项比较。`;
      return ['模拟同学'+(i+1), step.id, reason];
    }) : null;
  const answers = stepAnswers ?? demoAnswers[state.lessonId] ?? Array.from({length:12}, (_,i) => [
    '模拟同学'+(i+1), state.lesson.options[(i < 6 ? 0 : i % state.lesson.options.length)].id,
    (state.lesson.quickReasons ?? state.lesson.moduleConfig?.quickReasons ?? ['需要核对原页证据'])[i % (state.lesson.quickReasons?.length || state.lesson.moduleConfig?.quickReasons?.length || 1)]
  ]);
  if (!Array.isArray(answers)) fail('这门课没有预设的模拟样本。');
  if (answers.some(([, id]) => !state.lesson.options.some(option => option.id === id))) {
    fail('此存档使用旧版题目，请新建专业课课堂后演示模拟班级。');
  }
  const participants = [...state.participants], responses = [...state.responses];
  let changed = 0;
  answers.forEach(([name, firstOption, firstReason], index) => {
    const id = 'demo-' + state.lessonId + '-' + (index + 1);
    if (!participants.some(p => p.id === id)) participants.push({ id, name, simulated: true });
    const revised = state.round === 2 && index < 11;
    const correctId = state.lesson.correctOptionId || state.lesson.options[0].id;
    const optionId = revised ? correctId : state.round === 2 ? (stepAnswers ? distractors[0].id : state.lesson.options.find(o => o.id !== correctId).id) : firstOption;
    const reason = revised ? ({
      mzi: '复核示波与 DFT 后，谷底由偶函数二次项倍频，并非半波截断；两臂振幅差使 ER 约 15.3 dB。',
      'rc-fault': '复核后确认时域与频域只含 RC；i(0⁺)=5/R 可分辨 0.25 与 0.50 mA，唯一测量选电流。',
      'optical-aliasing': '盲测 180° 的竞争预测为 0% 与 100%；三点训练零误差不能证明真实阶次。',
    })[state.lessonId] ?? ('复核原页后：'+(state.lesson.moduleConfig?.faultDiagnosis || state.lesson.moduleConfig?.takeaway?.summary || '判断须说明证据与边界。')) : state.round === 2 ? '我仍认为原来的直觉成立，还想用更多相同类型的观测确认它。' : firstReason;
    const phaseIndex = index % 9;
    const sample = state.lessonId === 'mzi' ? { phaseIndex, power: (revised || (state.round === 1 && [1, 4, 6, 9].includes(index)))
      ? mzmTransfer({ lossDb: 3, phaseDeg: phaseIndex * 45 }).PA : demoMziGuesses[phaseIndex] } : undefined;
    const prior = responses.find(r => r.participantId === id && r.round === state.round);
    if (prior && !prior.simulated) return;
    const response = { id: prior?.id ?? 'response-' + (state.version + 1) + '-' + (index + 1),
      participantId: id, optionId, reason, round: state.round, simulated: true, ...(sample && { sample }) };
    if (prior && JSON.stringify(prior) === JSON.stringify(response)) return;
    if (prior) responses[responses.indexOf(prior)] = response; else responses.push(response);
    changed++;
  });
  if (!changed) return state;
  return record({ ...state, demo: true, participants, responses }, 'demoFill', '已加入模拟作答', {
    count: changed, simulated: true, round: state.round,
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
    fail('课堂已进入新的互动配置或轮次，请按照当前题目重新操作。');
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
    case 'toggleAiPeer':
      if (state.lesson.activityId !== 'evidence-weighing@1') fail('当前模块没有 AI 辩友。');
      return transition({aiPeerRevealed: !state.aiPeerRevealed}, '教师切换了 AI 辩友观点');
    case 'reveal':
      if (state.phase === 'reveal') return state;
      requirePhase('collect');
      return transition({ phase: 'reveal' }, '本轮作答已公布', { round: state.round });
    case 'analyze': {
      requirePhase('reveal', 'branch');
      const fallback = analyze(state);
      const analysis = payload.analysis === undefined ? fallback : validateProviderAnalysis(payload.analysis, fallback);
      if (JSON.stringify(analysis) === JSON.stringify(state.analysis)) return state;
      return transition({ analysis }, '已整理课堂证据', { source: analysis.source, evidenceIds: analysis.evidence.map(({ id }) => id) });
    }
    case 'branch': {
      if (state.phase === 'branch' && state.decision?.branchId === payload.branchId) return state;
      requirePhase('reveal', 'branch');
      if (state.round !== 1) fail('靶向教学策略须在第一轮公布后选择。');
      const branch = state.lesson.branches.find(({ id }) => id === payload.branchId);
      if (!branch) fail('请选择本课程的有效分支。');
      const analysis = state.analysis ?? analyze(state);
      const decision = { branchId: branch.id, title: branch.title, evidenceIds: analysis.evidence.map(({ id }) => id) };
      return transition({ phase: 'branch', decision, analysis }, '已选择靶向教学策略', decision);
    }
    case 'revise': {
      if (state.round === 2 && state.phase === 'collect') return state;
      requirePhase('branch');
      if (state.round !== 1 || !state.decision) fail('请先选定第一轮的靶向教学策略。');
      const branch = state.lesson.branches.find(({ id }) => id === state.decision.branchId);
      const revisionPrompt = branch.revisionPrompt ?? ('完成「' + branch.title + '」后，结合新证据重新回答题目。' + state.lesson.prompt);
      return transition({ phase: 'collect', round: 2, firstRoundAnalysis: state.analysis, analysis: null, revisionPrompt }, '第二轮改答已开启', {
        round: 2, branchId: branch.id, revisionPrompt,
      });
    }
    case 'close':
      if (state.phase === 'closed') return state;
      requirePhase('reveal', 'branch');
      return transition({ phase: 'closed' }, '课堂已结束', { round: state.round });
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
      return transition({ winner }, simulated ? '已从模拟作答者中抽签' : '已从提交作答的同学中抽签', detail);
    }
    case 'switchLesson': {
      const lesson = resolveLesson(payload.lessonId, state.customLessons);
      if (!lesson) fail('找不到这门课。');
      if (state.lessonId === lesson.id && state.phase === 'collect' && state.round === 1) return state;
      const participants = state.participants.filter(({ simulated }) => !simulated);
      const next = transition({ ...startLesson(lesson), participants }, '已切换课程', { lessonId: lesson.id });
      return state.demo ? fillDemo(next, at) : next;
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
