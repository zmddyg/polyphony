import { getLesson } from './catalog.mjs';
import { getActivity } from './activities.mjs';
import { createRoom, reduceRoom } from './engine.mjs';
import { exportScore, importScore } from './score-package.mjs';

const stages = ['prepare', 'generate', 'validate', 'compile'];
const materialLimit = 12;
const choiceCount = 3;
const branchCount = 3;
const evidenceLimit = 3;
const lengths = {
  subject: 80,
  prompt: 280,
  option: 240,
  title: 120,
  description: 700,
  revisionPrompt: 700,
};

export const COMPOSITION_ACTIVITY = getActivity({ activityId: 'choice@1' });

function objectSchema(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function arraySchema(items, minItems, maxItems = minItems) {
  return { type: 'array', items, minItems, maxItems };
}

function textSchema(maxLength) {
  return { type: 'string', minLength: 1, maxLength };
}

const branchSchema = objectSchema({
  title: textSchema(lengths.title),
  description: textSchema(lengths.description),
  revisionPrompt: textSchema(lengths.revisionPrompt),
  evidenceIds: arraySchema({ type: 'string' }, 1, evidenceLimit),
});

export const COMPOSITION_PLAN_SCHEMA = objectSchema({
  subject: textSchema(lengths.subject),
  prompt: textSchema(lengths.prompt),
  options: arraySchema(textSchema(lengths.option), choiceCount),
  branches: arraySchema(branchSchema, branchCount),
});
export const COMPOSITION_REFUSED = Symbol('composition provider refusal');

export class CompositionInputError extends Error {}

function text(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(label + '须为 1 至 ' + maximum + ' 个字符。');
  }
  return value.trim();
}

function prepare(input) {
  const reference = getLesson(text(input?.reference, '参考课程编号', 64));
  if (!reference) throw new Error('请选择有效的参考课程。');
  const material = text(input.material, '课堂材料', 2200);
  const lines = material.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const chunks = lines.length > materialLimit
    ? [...lines.slice(0, materialLimit - 1), lines.slice(materialLimit - 1).join('\n')]
    : lines;
  return {
    topic: text(input.topic, '课题', 100),
    goal: text(input.goal, '学习目标', 180),
    material,
    materials: chunks.map((value, index) => ({ id: 'M' + (index + 1), text: value })),
    reference: { id: reference.id, subject: reference.subject, steps: reference.steps, skills: reference.skills },
  };
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}

function checkDistinct(values, label) {
  const normalized = values.map(value => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error(label + '须互不相同。');
}

function validate(plan, input) {
  if (!exactKeys(plan, COMPOSITION_PLAN_SCHEMA.required)) {
    throw new Error('互动配置 JSON 须包含 subject、prompt、options、branches。');
  }
  const subject = text(plan.subject, '学科', lengths.subject);
  const prompt = text(plan.prompt, '首答题', lengths.prompt);
  if (!Array.isArray(plan.options) || plan.options.length !== choiceCount ||
      !Array.isArray(plan.branches) || plan.branches.length !== branchCount) {
    throw new Error('需要三个选项和三个靶向教学策略。');
  }
  const options = plan.options.map((value, index) => text(value, '选项 ' + (index + 1), lengths.option));
  const knownIds = new Set(input.materials.map(({ id }) => id));
  const branches = plan.branches.map((branch, index) => {
    const label = '分支 ' + (index + 1);
    if (!exactKeys(branch, branchSchema.required)) throw new Error(label + '须包含标题、任务、复答题和引用编号。');
    const ids = branch.evidenceIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > evidenceLimit ||
        new Set(ids).size !== ids.length || ids.some(id => !knownIds.has(id))) {
      const unknown = Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && /^M\d{1,4}$/.test(id) && !knownIds.has(id)) : [];
      throw new Error(label + '引用无效' + (unknown.length ? '（不存在：' + unknown.join('、') + '）' : '') + '，请使用材料清单中 1 至 3 个不同的编号。');
    }
    return {
      title: text(branch.title, label + '的标题', lengths.title),
      description: text(branch.description, label + '的学生任务', lengths.description),
      revisionPrompt: text(branch.revisionPrompt, label + '的复答题', lengths.revisionPrompt),
      evidenceIds: ids,
    };
  });
  checkDistinct(options, '选项');
  checkDistinct(branches.map(branch => branch.title), '分支标题');
  checkDistinct(branches.map(branch => branch.description), '分支任务');
  checkDistinct(branches.map(branch => branch.revisionPrompt), '复答题');
  return { subject, prompt, options, branches };
}

function rehearseRoom(lesson) {
  const participantId = 'composition-rehearsal';
  const loaded = reduceRoom(createRoom(), { type: 'loadLesson', payload: { lesson } });
  const joined = reduceRoom(loaded, { type: 'join', payload: { participantId, name: '备课试跑' } });
  const submit = (room, optionIndex) => reduceRoom(room, {
    type: 'respond',
    payload: {
      participantId,
      optionId: lesson.options[optionIndex].id,
      reason: '备课试跑第 ' + room.round + ' 轮',
      expectedLessonId: lesson.id,
      expectedRound: room.round,
    },
  });
  const initial = submit(joined, 0);
  const firstReveal = reduceRoom(initial, { type: 'reveal' });
  const analyzed = reduceRoom(firstReveal, { type: 'analyze' });
  if (!analyzed.analysis.evidence.some(({ responseId }) => responseId === initial.responses[0]?.id)) {
    throw new Error('首答未进入课堂证据。');
  }

  for (const branch of lesson.branches) {
    const selected = reduceRoom(analyzed, { type: 'branch', payload: { branchId: branch.id } });
    const revised = reduceRoom(selected, { type: 'revise' });
    const responded = submit(revised, 1);
    const secondReveal = reduceRoom(responded, { type: 'reveal' });
    const closed = reduceRoom(secondReveal, { type: 'close' });
    if (closed.phase !== 'closed' || closed.round !== 2 || closed.decision?.branchId !== branch.id ||
        closed.revisionPrompt !== branch.revisionPrompt ||
        closed.responses.length !== 2 || closed.responses[1].round !== 2) {
      throw new Error('分支未能完成第二轮作答。');
    }
  }
  return { scoreRoundTrip: true, rounds: 2, testedBranches: lesson.branches.length };
}

function compile(plan, input) {
  const nonce = crypto.getRandomValues(new Uint32Array(2));
  const lesson = {
    id: 'custom-' + [...nonce].map(value => value.toString(36)).join('-'),
    activityId: COMPOSITION_ACTIVITY.id,
    title: input.topic,
    subject: plan.subject,
    description: input.goal,
    prompt: plan.prompt + '\n\n课堂材料\n' + input.material,
    options: plan.options.map((label, index) => ({ id: 'option-' + (index + 1), label })),
    branches: plan.branches.map(({ title, description, revisionPrompt }, index) =>
      ({ id: 'branch-' + (index + 1), title, description, revisionPrompt })),
    skills: [input.goal],
    steps: ['独立作答并引用材料', '比较证据与解释', '按教师选择的分支核对，再次作答'],
  };
  const roundTripped = importScore(exportScore(lesson));
  return { lesson: roundTripped, checks: rehearseRoom(roundTripped) };
}

function localPlan({ topic, reference, materials }) {
  const options = {
    mzi: ['谷底二次项导致倍频，振幅不等令静态 ER 有限', '谷底像二极管半波截断，能量相消后消失', '需要把静态 ER 与偏置谐波分别验证'],
    'rc-fault': ['电压时频响应只约束 RC，初始电流可独立约束 R', '完整波特图与更多电压点能分别拟合 R 和 C', '需对两种故障写出同一探头的不同预测'],
    'optical-aliasing': ['零训练误差只能证明相容，应选竞争预测分歧点盲测', '按最简原则，零训练误差就能证明真实周期', '应先扩展谱形模型再用独立采样检验'],
  };
  const concept = /TFLN|行波电极|群折射率|VπL|速度失配/u.test(topic + materials.map(m => m.text).join(' '));
  const specialized = /MZ[IM]|马赫|RC|光子滤波|消光比/u.test(topic + materials.map(m => m.text).join(' '));
  const firstId = materials[0].id;
  const lastId = materials.at(-1).id;
  const compareTask = firstId === lastId
    ? '用材料中的同一条信息检验两种解释，指出它们对证据的不同预期。'
    : '对照材料的首末段，选出一条能检验两种解释的信息，指出它们对证据的不同预期。';
  return {
    subject: reference.subject.split(' · ')[0] + ' · 自编课',
    prompt: '围绕「' + topic + '」，阅读课堂材料，先独立选择一种判断。引用材料中的一处具体信息，说明它如何支持你的判断，以及它还不能回答什么。',
    options: concept ? ['延长电极降低半波电压，但损耗和速度失配可能压低带宽', '只要把电极加长，驱动电压降低而带宽必然同时提高', '须核对微波损耗、阻抗与群速度匹配后才能比较方案'] : specialized ? options[reference.id] : ['原页在给定条件下支持这项判断，不能删去条件', '可以忽略给定条件，将结论推广到所有情况', '原页尚不足以排除竞争解释，须追加独立证据'],
    branches: [
      { title: '回到材料找证据', description: '从第一段材料中选一条信息，标出出处并说明它能支持哪一步判断。', revisionPrompt: '重新选择一种判断，引用一条材料信息，说明这条信息如何支持你的选择。', evidenceIds: [firstId] },
      { title: '并排比较两种解释', description: compareTask, revisionPrompt: '比较两种解释后重新判断。哪条材料最能区分它们？', evidenceIds: [...new Set([firstId, lastId])] },
      { title: '设计一次追加核对', description: '读完最后一段材料后，指出当前证据留下的疑问，提出一项追加观测、记录或对照。说明不同结果会怎样改变原判断。', revisionPrompt: '回看初答。新提出的核对办法能区分哪些判断？什么结果会让你修改原答案？', evidenceIds: [lastId] },
    ],
  };
}

function start(input) {
  const started = performance.now();
  let prepared;
  try { prepared = prepare(input); }
  catch (error) { throw new CompositionInputError(error.message); }
  const trace = {
    activityId: COMPOSITION_ACTIVITY.id,
    attempts: 0,
    elapsedMs: 0,
    stages: stages.map(id => ({ id, status: 'skipped', elapsedMs: 0 })),
    issues: [],
    evidence: [],
    materials: prepared.materials,
  };
  function stage(id, status, since) {
    const entry = trace.stages.find(item => item.id === id);
    entry.status = status;
    entry.elapsedMs += Math.round(performance.now() - since);
  }
  stage('prepare', 'ok', started);
  function result(compiled, source, plan) {
    const { lesson, checks } = compiled;
    trace.checks = checks;
    trace.evidence = lesson.branches.map(({ id }, index) =>
      ({ branchId: id, materialIds: plan.branches[index].evidenceIds }));
    trace.coverage = {
      referenced: new Set(trace.evidence.flatMap(({ materialIds }) => materialIds)).size,
      available: prepared.materials.length,
    };
    trace.elapsedMs = Math.round(performance.now() - started);
    return { lesson, source, trace };
  }
  function local(source) {
    const validatesAt = performance.now();
    const plan = validate(localPlan(prepared), prepared);
    if (source === 'local') stage('validate', 'ok', validatesAt);
    const compilesAt = performance.now();
    const compiled = compile(plan, prepared);
    if (source === 'local') stage('compile', 'ok', compilesAt);
    else trace.fallback = { validate: 'ok', compile: 'ok' };
    return result(compiled, source, plan);
  }
  return { prepared, trace, stage, result, local };
}

export function composeLocally(input) {
  return start(input).local('local');
}

export async function runComposition(input, { requestPlan, model, source = 'provider', signal }) {
  signal?.throwIfAborted();
  const { prepared, trace, stage, result, local } = start(input);
  if (model) trace.model = model;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const requestedAt = performance.now();
    trace.attempts = attempt;
    let reply;
    try {
      reply = await requestPlan(prepared, trace.issues.at(-1)?.message);
    } catch (error) {
      signal?.throwIfAborted();
      stage('generate', 'failed', requestedAt);
      trace.issues.push({
        attempt,
        message: error?.name === 'TimeoutError' ? '模型请求超过备课时限。' : '模型服务请求失败。',
      });
      break;
    }
    signal?.throwIfAborted();
    if (reply === COMPOSITION_REFUSED) {
      stage('generate', 'failed', requestedAt);
      trace.issues.push({ attempt, message: '模型未能提供可用互动配置。' });
      break;
    }
    stage('generate', 'ok', requestedAt);

    const validatesAt = performance.now();
    let plan;
    try {
      let decoded;
      try { decoded = JSON.parse(reply); }
      catch { throw new Error('模型须返回一个可直接解析的 JSON 对象。'); }
      plan = validate(decoded, prepared);
      stage('validate', attempt === 2 ? 'repaired' : 'ok', validatesAt);
    } catch (error) {
      stage('validate', 'failed', validatesAt);
      trace.issues.push({ attempt, message: error.message });
      continue;
    }

    const compilesAt = performance.now();
    try {
      const compiled = compile(plan, prepared);
      stage('compile', 'ok', compilesAt);
      return result(compiled, source, plan);
    } catch {
      stage('compile', 'failed', compilesAt);
      trace.issues.push({ attempt, message: '互动配置未通过课堂试跑，请确认每个分支都包含有效的学生任务和复答题。' });
    }
  }
  return local('fallback');
}

export const REHEARSAL_INPUT = Object.freeze({
  reference: 'mzi',
  topic: 'TFLN 调制器：单臂损耗与行波电极速度失配',
  goal: '区分静态 ER、偏置谐波和行波带宽三个约束，用原页编号材料核验工程折中。',
  material: 'MZM 采用两只 50:50 耦合器，一臂功率透过率 T₂=0.5，振幅透过率为 √0.5，静态 ER≈15.31 dB。\n正交偏置的小信号基频非零；谷底偶函数二次项产生二倍频，不是二极管半波截断。\nTFLN 行波电极加长可降低 Vπ，但微波传播损耗和微波–光群速度失配可能压低带宽；需同时考虑阻抗匹配。',
});

export function rehearseComposition() {
  return runComposition(REHEARSAL_INPUT, {
    source: 'rehearsal',
    requestPlan: async (_input, repair) => JSON.stringify({
      subject: '集成光子 · TFLN 电光调制',
      prompt: '单臂损耗下静态 ER 有限。若进一步加长 TFLN 电极以降低 Vπ，下列哪项同时尊重静态与行波约束？',
      options: ['延长电极必然同时提高带宽，谷底仍可完全相消', 'ER 由振幅和差约束，行波带宽还受微波损耗与速度失配约束', '谷底把负半周截掉，所以 ER 与带宽都是半波整流的结果'],
      branches: [
        { title: '核对损耗与偏置的不同约束', description: '用第一段求峰谷比，用第二段的正交与谷底比较检验半波截断解释。', revisionPrompt: '引用两段材料，分别解释静态 ER 与倍频的机制。', evidenceIds: repair ? ['M1', 'M2'] : ['M99'] },
        { title: '推导电极长度与带宽的折中', description: '从第三段列出延长电极改变的量，区分积累相移与高频相位失配。', revisionPrompt: '何种证据能判断加长后带宽是否下降？引用材料中的限制条件。', evidenceIds: ['M3'] },
        { title: '设计一项区分两种失配的测量', description: '对照静态扫描与射频频响，说明哪个观测受臂间损耗影响，哪个还需传播模型。', revisionPrompt: '重新判断器件方案，指出原页已支持的结论与尚缺的测量。', evidenceIds: ['M1', 'M3'] },
      ],
    }),
  });
}
