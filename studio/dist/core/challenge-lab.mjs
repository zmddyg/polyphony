import { mziPowerA } from './mzi-power.mjs';

export const challengeNames = { rc: '只准测一次', light: '画条曲线，考考机器' };
export const probes = [
  { id: 'early', label: '2 ms 时的电容电压', unit: 'V' },
  { id: 'steady', label: '充稳后的电容电压', unit: 'V' },
  { id: 'current', label: '刚接通时的电流', unit: 'mA' },
];
export const diagnoses = [
  { id: 'r', label: '电阻翻倍' }, { id: 'c', label: '电容翻倍' },
  { id: 'open', label: '两种故障都说得通' },
];
export const angularStep = 15;
export const pointCount = 360 / angularStep;
export const initialSamples = [0, 8, 16];
export const blindAngles = [60, 180, 300];
const radians = degrees => degrees * Math.PI / 180;
const withinUnit = value => Math.min(1, Math.max(0, value));
const rms = (sum, count) => Math.sqrt(sum / count);

export function rcReading(fault, probe) {
  const resistance = fault === 'r' ? 20000 : 10000;
  const capacitance = fault === 'c' ? 200e-9 : 100e-9;
  if (probe === 'current') return 5000 / resistance;
  if (probe === 'steady') return 5;
  return 5 * -Math.expm1(-.002 / (resistance * capacitance));
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
    return next({step: 'tested', angle, predicted: lightAt(state.firstModel, angle), observed: state.target[angle / angularStep]});
  }
  if (state.step === 'tested' && action === 'refit') {
    const model = fitLight(state.target, [...initialSamples, state.angle / angularStep]);
    return next({step: 'refit', model});
  }
  throw new Error('实验已进入下一步，请按当前画面操作。');
}
