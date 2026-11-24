import { mziPowerA } from './mzi-power.mjs';

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

function buildTheoryPaths() {
  const a = [];
  const b = [];
  for (let j = 0; j <= 128; j++) {
    const prefix = `${j ? 'L' : 'M'}${x(j / 16).toFixed(1)}`;
    const power = mziPowerA(j * 2 * Math.PI / 128);
    a.push(`${prefix} ${y(power).toFixed(1)}`);
    b.push(`${prefix} ${y(1 - power).toFixed(1)}`);
  }
  return [a.join(' '), b.join(' ')];
}

function plotFrame(dark, reveal, showB) {
  const key = Number(dark) * 4 + Number(reveal) * 2 + Number(showB);
  const cached = plotFrames.get(key);
  if (cached) return cached;
  const ink = dark ? '#b6c9bf' : '#4a6458';
  const grid = dark ? '#355348' : '#d9e3db';
  const first = dark ? '#c9f88b' : '#377431';
  const second = dark ? '#80dad1' : '#197f89';
  const label = (px, py, anchor, value) => `<text x="${px}" y="${py}" text-anchor="${anchor}" fill="${ink}" font-family="Consolas,monospace" font-size="13">${value}</text>`;
  const rows = [0, .25, .5, .75, 1].map(v => `<path d="M${left} ${y(v)}H${right}" stroke="${grid}" stroke-dasharray="${v === 0 ? '0' : '3 5'}"/>${label(left-10, y(v)+4, 'end', `${v*100}%`)}`).join('');
  const columns = [0, 2, 4, 6, 8].map(i => `<path d="M${x(i)} ${top}V${bottom}" stroke="${grid}" stroke-dasharray="2 6"/>${label(x(i), bottom+24, 'middle', labels[i])}`).join('');
  const curve = (other, color) => {
    theoryPaths ??= buildTheoryPaths();
    return `<path d="${theoryPaths[Number(other)]}" fill="none" stroke="${color}" stroke-width="3.2" ${other ? 'stroke-dasharray="6 5"' : ''}/>`;
  };
  const frame = `<svg viewBox="0 0 711 257" width="100%" role="img" aria-label="相位与 A 端归一化功率的全班预测${reveal ? '，叠加理论曲线' : ''}" xmlns="http://www.w3.org/2000/svg">${rows}${columns}${reveal ? curve(false, first) : ''}${showB ? curve(true, second) : ''}`;
  plotFrames.set(key, frame);
  return frame;
}

// Input may be anonymous public samples or teacher-only response records.
export function curveGraphic(responses = [], { reveal = false, showB = false, dark = true } = {}) {
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
  const dots = [...points.values()].map(p => `<circle cx="${x(p.index)}" cy="${y(p.power).toFixed(1)}" r="${Math.min(8,4.4+Math.log2(p.n))}" fill="${p.simulated ? (dark ? '#223f32' : '#fff') : (dark ? '#fff3c7' : '#bf7428')}" stroke="${dark ? '#f4ddad' : '#95632c'}" stroke-width="2"><title>${labels[p.index]} · ${(p.power*100).toFixed(0)}% · ${p.n} 份${p.simulated ? '排练' : '现场'}预测</title></circle>`).join('');
  return `${plotFrame(Boolean(dark), Boolean(reveal), Boolean(showB))}${dots}</svg>`;
}
