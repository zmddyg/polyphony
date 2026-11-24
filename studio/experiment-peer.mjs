import { requestStructuredCompletion } from './lesson-provider.mjs';
import { angularStep, initialSamples, normalizeRcParams, rcProbes, voteChoices } from './dist/core/challenge-lab.mjs';

const reasonLimit = 180;
const instructions = `你是可被质疑的实验搭档。只凭给出的数据从 choices 选一个 id，用一句不超过 ${reasonLimit} 字的中文给出可用读数检验的理由。证据不足时保留相容的解释，不声称看到未公布的真值。只返回含 choice 与 reason 的 JSON。`;

function formatNum(value) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(4))) : '—';
}

export async function askExperimentPeer(state, provider) {
  const choices = voteChoices(state);
  if (!choices.length) throw new Error('本轮没有待选问题。');
  let evidence;
  if (state.kind === 'rc') {
    const params = normalizeRcParams(state.params);
    const probe = state.probe ? rcProbes(params).find(item => item.id === state.probe) : null;
    evidence = {
      problem: `${formatNum(params.finalV)} V 理想阶跃，电容初值 ${formatNum(params.initialV)} V。标称 R=${formatNum(params.resistanceKohm)} kΩ，C=${formatNum(params.capacitanceNf)} nF，恰好一个元件翻倍。全班只准测一次。`,
      ...(probe && { measurement: probe.label, reading: state.reading, unit: probe.unit }),
    };
  } else if (state.kind === 'blackbox') {
    evidence = {
      problem: '数字黑箱已知 0→0、2→4，候选规则为平方 x² 或倍增 2x。全班选一个新输入验证后再判断规则。',
      ...(state.input !== undefined && { input: state.input, output: state.reading }),
    };
  } else {
    evidence = {
      problem: '在 P=η[1+cos(kθ+φ)]/2 两类干涉仪中，k=1 或 2。找一个能检验已有拟合的角度。角度按度数给出。',
      samples: initialSamples.map(i => ({ degrees: i * angularStep, power: state.target[i] })),
      fit: { k: state.firstModel.order, biasDegrees: state.firstModel.bias, gain: state.firstModel.gain },
    };
  }
  const schema = {
    type: 'object', additionalProperties: false, required: ['choice', 'reason'],
    properties: { choice: { type: 'string', enum: choices.map(item => item.id) }, reason: { type: 'string' } },
  };
  const timeoutMs = Number(process.env.POLYPHONY_AI_PEER_TIMEOUT_MS) || 8000;
  const content = await requestStructuredCompletion({
    ...provider, schemaName: 'experiment_peer', schema,
    signal: AbortSignal.timeout(timeoutMs), messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: JSON.stringify({ evidence, choices }) },
    ],
  });
  const candidate = JSON.parse(content ?? 'null');
  const reason = typeof candidate?.reason === 'string' ? candidate.reason.trim() : '';
  if (!choices.some(item => item.id === candidate?.choice) || !reason || reason.length > reasonLimit) {
    throw new Error('模型没有返回可显示的选择与理由。');
  }
  return { choice: candidate.choice, reason };
}
