import { mziPowerA } from './mzi-power.mjs';

function bounded(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name}须在 ${min} 至 ${max} 之间。`);
  return value;
}

// Equal 50:50 couplers; only the second arm has excess propagation loss.
// All powers are normalized to incident power before the first coupler.
export function mzmTransfer({ lossDb = 0, phaseDeg = 0 } = {}) {
  bounded(lossDb, 0, 10, '单臂损耗');
  bounded(phaseDeg, 0, 360, '相位');
  const T2 = 10 ** (-lossDb / 10), t2 = Math.sqrt(T2);
  const phaseRad = phaseDeg * Math.PI / 180;
  const totalPower = (1 + T2) / 2;
  const PA = (1 + T2 + 2 * t2 * Math.cos(phaseRad)) / 4;
  const PB = totalPower - PA;
  const pMax = (1 + t2) ** 2 / 4, pMin = (1 - t2) ** 2 / 4;
  const erDb = lossDb === 0 ? Infinity : 20 * Math.log10((1 + t2) / (1 - t2));
  return { T2, t2, phaseRad, PA, PB, powerA: PA, powerB: PB, totalPower, pMax, pMin, erDb };
}

export function mzmRfSimulation({ lossDb = 3, biasDeg = 90, rfRatio = 0.2, samples = 128 } = {}) {
  const transfer = mzmTransfer({ lossDb, phaseDeg: biasDeg });
  bounded(rfRatio, 0.05, 0.5, '射频调制深度');
  if (!Number.isInteger(samples) || samples < 16 || samples > 4096) throw new RangeError('采样数须为 16 至 4096 的整数。');
  const m = Math.PI * rfRatio;
  const theta = Array.from({ length: samples }, (_, n) => 2 * Math.PI * n / samples);
  const waveform = theta.map(angle => (1 + transfer.T2 + 2 * transfer.t2 * Math.cos(transfer.phaseRad + m * Math.sin(angle))) / 4);
  const harmonic = k => {
    let real = 0, imaginary = 0;
    for (let n = 0; n < samples; n++) {
      real += waveform[n] * Math.cos(k * theta[n]);
      imaginary -= waveform[n] * Math.sin(k * theta[n]);
    }
    return 2 * Math.hypot(real, imaginary) / samples;
  };
  return { ...transfer, lossDb, biasDeg, vBiasRatio: biasDeg / 180, rfRatio, samples, m, theta, waveform,
    dc: waveform.reduce((a, b) => a + b, 0) / samples, h1: harmonic(1), h2: harmonic(2), h3: harmonic(3) };
}

export { mziPowerA };

const labels = ['0', 'π/4', 'π/2', '3π/4', 'π', '5π/4', '3π/2', '7π/4', '2π'];

export function phaseLabel(index) { return labels[index] ?? '—'; }

export function assignedPhase(participantId) {
  let hash = 2166136261;
  for (const character of String(participantId || '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % labels.length;
}

const left = 49, right = 675, top = 27, bottom = 220;
const x = index => left + (right - left) * index / 8;
const y = power => bottom - (bottom - top) * power;
const plotFrames = new Map();
let theoryPaths;

function buildTheoryPaths(lossDb) {
  const a = [];
  const b = [];
  for (let j = 0; j <= 128; j++) {
    const prefix = `${j ? 'L' : 'M'}${x(j / 16).toFixed(1)}`;
    const transfer = mzmTransfer({ lossDb, phaseDeg: j * 360 / 128 });
    const power = transfer.PA;
    a.push(`${prefix} ${y(power).toFixed(1)}`);
    b.push(`${prefix} ${y(transfer.PB).toFixed(1)}`);
  }
  return [a.join(' '), b.join(' ')];
}

function plotFrame(dark, reveal, showB, lossDb) {
  const key = `${Number(dark) * 4 + Number(reveal) * 2 + Number(showB)}|${lossDb}`;
  const cached = plotFrames.get(key);
  if (cached) return cached;
  const ink = dark ? '#9FB4CC' : '#475569';
  const grid = dark ? '#1E304F' : '#D8E1EB';
  const first = dark ? '#22D3EE' : '#0B4F6C';
  const second = dark ? '#34D399' : '#047857';
  const label = (px, py, anchor, value) => `<text x="${px}" y="${py}" text-anchor="${anchor}" fill="${ink}" font-family="JetBrains Mono,Cascadia Mono,Consolas,monospace" font-size="13">${value}</text>`;
  const rows = [0, .25, .5, .75, 1].map(v => `<path d="M${left} ${y(v)}H${right}" stroke="${grid}" stroke-dasharray="${v === 0 ? '0' : '3 5'}"/>${label(left-10, y(v)+4, 'end', `${v*100}%`)}`).join('');
  const columns = [0, 2, 4, 6, 8].map(i => `<path d="M${x(i)} ${top}V${bottom}" stroke="${grid}" stroke-dasharray="2 6"/>${label(x(i), bottom+24, 'middle', labels[i])}`).join('');
  const curve = (other, color) => {
    theoryPaths = buildTheoryPaths(lossDb);
    return `<path d="${theoryPaths[Number(other)]}" fill="none" stroke="${color}" stroke-width="3.2" ${other ? 'stroke-dasharray="6 5"' : ''}/>`;
  };
  const frame = `<svg viewBox="0 0 711 257" width="100%" role="img" aria-label="相位与 A 端归一化功率的全班预测${reveal ? '，叠加理论曲线' : ''}" xmlns="http://www.w3.org/2000/svg">${rows}${columns}${reveal ? curve(false, first) : ''}${showB ? curve(true, second) : ''}`;
  plotFrames.set(key, frame);
  return frame;
}

// Input may be anonymous public samples or teacher-only response records.
export function curveGraphic(responses = [], { reveal = false, showB = false, dark = true, lossDb = 0 } = {}) {
  const points = new Map();
  for (const record of responses) {
    const sample = record.sample || record;
    if (!Number.isInteger(sample.phaseIndex) || sample.phaseIndex < 0 || sample.phaseIndex > 8 || !Number.isFinite(sample.power) || sample.power < 0 || sample.power > 1) continue;
    const value = Math.round(sample.power * 1000) / 1000;
    const key = `${sample.phaseIndex}.${value}.${Boolean(record.simulated)}`;
    const point = points.get(key) || { index: sample.phaseIndex, power: value, simulated: !!record.simulated, n: 0 };
    point.n++;
    points.set(key, point);
  }
  const dots = [...points.values()].map(p => `<circle cx="${x(p.index)}" cy="${y(p.power).toFixed(1)}" r="${Math.min(8,4.4+Math.log2(p.n))}" fill="${p.simulated ? (dark ? '#223f32' : '#fff') : (dark ? '#fff3c7' : '#bf7428')}" stroke="${dark ? '#f4ddad' : '#95632c'}" stroke-width="2"><title>${labels[p.index]} · ${(p.power*100).toFixed(0)}% · ${p.n} 份${p.simulated ? '模拟演示' : '现场'}预测</title></circle>`).join('');
  return `${plotFrame(Boolean(dark), Boolean(reveal), Boolean(showB), lossDb)}${dots}</svg>`;
}
