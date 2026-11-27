import { mziPowerA } from './mzi-power.mjs';

export const challengeNames = { rc: '高速 PD 前级：一测排障', light: '光子滤波器逆向盲测' };
export const probes = [
  { id: 'early', label: 't = 2.0 μs 瞬态电容电压', unit: 'V' },
  { id: 'bode', label: '网络分析仪扫频测 −3 dB 带宽', unit: 'kHz' },
  { id: 'steady', label: '充分充稳后的电容电压', unit: 'V' },
  { id: 'current', label: 't = 0⁺ 合闸瞬间输入电流', unit: 'mA' },
];
export const diagnoses = [
  { id: 'r', label: '电阻翻倍' }, { id: 'c', label: '电容翻倍' },
  { id: 'open', label: '两种故障都说得通' },
];
export const angularStep = 15;
export const pointCount = 360 / angularStep;
export const initialSamples = [0, 8, 16];
export const blindAngles = [60, 120, 180, 300, 360];
const radians = degrees => degrees * Math.PI / 180;
const withinUnit = value => Math.min(1, Math.max(0, value));
const rms = (sum, count) => Math.sqrt(sum / count);

export function rcReading(fault, probe) {
  const resistance = fault === 'r' ? 20000 : 10000;
  const capacitance = fault === 'c' ? 200e-12 : 100e-12;
  if (probe === 'bode') return 1 / (2 * Math.PI * resistance * capacitance) / 1000;
  if (probe === 'current') return 5000 / resistance;
  if (probe === 'steady') return 5;
  if (probe !== 'early') throw new Error('请选择有效测量探头。');
  return 5 * -Math.expm1(-2e-6 / (resistance * capacitance));
}

export function presetTarget(kind = 'double') {
  return Array.from({length: pointCount}, (_, i) => {
    const theta = i * angularStep;
    if (kind === 'flat') return theta >= 90 && theta < 270 ? .92 : .08;
    return mziPowerA(radians(kind === 'single' ? theta : 2 * theta));
  });
}

export function lightAt(model, degrees) {
  return model.gain * mziPowerA(radians(model.order * degrees + model.bias));
}

export function fitLight(target, samples) {
  let best = null;
  const indices = samples.filter(() => true);
  const observed = indices.map(index => target[index]);
  const basis = Array(indices.length);
  // At fixed phase and sensitivity, least squares gives the attenuator setting directly.
  for (const order of [1, 2]) {
    for (let bias = 0; bias < 360; bias++) {
      let norm = 0;
      let dot = 0;
      for (let j = 0; j < indices.length; j++) {
        const value = mziPowerA(radians(order * indices[j] * angularStep + bias));
        basis[j] = value;
        norm += value * value;
        dot += value * observed[j];
      }
      const gain = norm > 1e-14 ? withinUnit(dot / norm) : 0;
      let error = 0;
      for (let j = 0; j < indices.length; j++) {
        error += (gain * basis[j] - observed[j]) ** 2;
      }
      // Both optical sensitivities can agree on the three training points. Prefer the simpler one on a tie.
      if (!best || error < best.sumSquaredError - 1e-13) best = {order, bias, gain, sumSquaredError: error};
    }
  }
  return {...best, trainingRms: rms(best.sumSquaredError, samples.length)};
}

export function fullCurveRms(model, target) {
  return rms(target.reduce((sum, value, i) => sum + (lightAt(model, i * angularStep) - value) ** 2, 0), target.length);
}

export function newChallenge(kind) {
  if (kind === 'rc') return {kind, step: 'measure', fault: Math.random() < .5 ? 'r' : 'c', votes: []};
  if (kind === 'light') return {kind, step: 'draw', target: presetTarget(), votes: []};
  throw new Error('找不到这项实验。');
}

export function voteChoices(state) {
  if (state.step === 'measure') return probes;
  if (state.step === 'diagnose') return diagnoses;
  if (state.step === 'blind') return blindAngles.map(angle => ({id: String(angle), label: angle + '°'}));
  return [];
}

export function castVote(state, participantId, choice) {
  if (typeof participantId !== 'string' || !participantId || participantId.length > 100 ||
      !voteChoices(state).some(item => item.id === choice)) throw new Error('这轮投票已结束或选项无效。');
  const prior = state.votes.find(vote => vote.id === participantId);
  if (prior?.choice === choice) return state;
  return {...state, votes: [...state.votes.filter(vote => vote.id !== participantId), {id: participantId, choice}]};
}

export function publicChallenge(state, participantId) {
  const {fault, votes, ...visible} = state;
  const counts = Object.fromEntries(voteChoices(state).map(item => [item.id, 0]));
  for (const {choice} of votes) counts[choice]++;
  return {...visible, counts, myVote: votes.find(vote => vote.id === participantId)?.choice ?? null};
}

export function advanceChallenge(state, {action, value, target} = {}) {
  const next = patch => ({...state, ...patch, peer: null, votes: []});
  if (action === 'peer' && voteChoices(state).length) return { ...state, peer: offlinePeerSuggestion(state) };
  if (action === 'reset' && ['solved', 'refit', 'tested'].includes(state.step)) return newChallenge(state.kind);
  if (state.step === 'measure' && action === 'measure' && probes.some(probe => probe.id === value)) {
    return next({step: 'diagnose', probe: value, reading: rcReading(state.fault, value)});
  }
  if (state.step === 'diagnose' && action === 'diagnose' && diagnoses.some(item => item.id === value)) {
    const compatible = ['r', 'c'].filter(fault => Math.abs(rcReading(fault, state.probe) - state.reading) < 1e-9);
    const answer = compatible.length === 1 ? compatible[0] : 'open';
    return next({step: 'solved', choice: value, compatible, answer});
  }
  if (state.step === 'draw' && action === 'fit') {
    if (!Array.isArray(target) || target.length !== pointCount ||
        !Array.from(target).every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error('目标曲线需要 24 个介于 0 和 1 之间的光强采样。');
    }
    return next({step: 'blind', target: [...target], firstModel: fitLight(target, initialSamples)});
  }
  if (state.step === 'blind' && action === 'test' && blindAngles.some(angle => String(angle) === value)) {
    const angle = Number(value);
    return next({step: 'tested', angle, predicted: lightAt(state.firstModel, angle), observed: state.target[(angle / angularStep) % pointCount]});
  }
  if (state.step === 'tested' && action === 'refit') {
    const model = fitLight(state.target, [...new Set([...initialSamples, (state.angle / angularStep) % pointCount])]);
    const refitRms = fullCurveRms(model, state.target);
    return next({step: 'refit', model, refitRms, orderJump: model.order !== state.firstModel.order,
      degreeOfFreedomLimited: refitRms > 0.12});
  }
  throw new Error('实验已进入下一步，请按当前画面操作。');
}

// The provider and the zero-network example share this strict evidence boundary.
export function peerEvidence(state) {
  if (state.kind === 'rc') {
    const probe = probes.find(item => item.id === state.probe);
    return { problem: '高速 PD 等效前级，5 V 理想阶跃，零初值。标称负载 10.0 kΩ、总电容 100 pF。电阻误焊 20.0 kΩ 或同轴寄生令总电容为 200 pF，恰有一种故障。两者 τ 均为 2.00 μs，电压低通带宽均为 79.58 kHz。只有一次测量。',
      probes: probes.map(({ id, label, unit }) => ({ id, label, unit })),
      ...(probe && { measurement: probe.label, reading: state.reading, unit: probe.unit }) };
  }
  return { problem: '光子滤波谱逆向盲测。候选单级模型 P = η[1+cos(kθ+φ)]/2，k=1 或 2。只给出三点训练数据与锁定的拟合；无权访问完整目标谱。选出能证伪模型的角度，不能以训练零误差证明模型正确。',
    samples: initialSamples.map(i => ({ degrees: i * angularStep, power: state.target[i] })),
    ...(state.firstModel && { fit: { k: state.firstModel.order, biasDegrees: state.firstModel.bias, gain: state.firstModel.gain } }) };
}

export function offlinePeerSuggestion(state) {
  if (!voteChoices(state).length) throw new Error('本轮没有待选问题。');
  let choice, reason;
  if (state.kind === 'rc') {
    choice = state.step === 'measure' ? 'current' : state.probe === 'current' ? (state.reading < 0.375 ? 'r' : 'c') : 'open';
    reason = state.step === 'measure'
      ? '若两种故障的 RC 都相同，整条充电波形与波特图能区分吗？先算 i(0⁺)=5/R：0.25 mA 与 0.50 mA 是不同预测。建议只测瞬间电流，再用实测证伪。'
      : state.probe === 'current' ? `已公布电流 ${state.reading.toFixed(2)} mA。用 R=5/i 反推电阻，再判断哪种故障相容；此推断只依赖已公布读数。`
      : '两候选故障的 τ 都是 2.00 μs；电压瞬态、稳态与 −3 dB 带宽完全相同。这次读数尚不能唯一定位。若要追加一次测量，哪个量能单独约束 R？';
  } else {
    choice = '180';
    reason = '只凭 0°、120°、240° 三点，单周期与二倍频模型可能完全重合。建议在 180° 写下竞争模型各自的预测再盲测；零训练误差不保证谱线正确，我没有看到该点的真值。';
  }
  return { choice, reason, offlineDemo: true };
}
