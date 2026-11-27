import { mzmTransfer } from './optics.mjs';

const rcFields = [
  { key: 'resistanceKohm', label: '电阻 R', unit: 'kΩ', value: 10 },
  { key: 'capacitancePf', label: '总电容 Cₜₒₜ', unit: 'pF', value: 100 },
  { key: 'initialV', label: '初始电压 V₀', unit: 'V', value: 0 },
  { key: 'finalV', label: '稳态电压 V∞', unit: 'V', value: 5 },
];

const mziFields = [
  { key: 'phaseDeg', label: '两臂相位差 Δφ', unit: '°', value: 180, min: 0, max: 360 },
  { key: 'lossDb', label: '单臂额外损耗 α', unit: 'dB', value: 3, min: 0, max: 10 },
];

export const scienceModels = Object.freeze({
  rc: Object.freeze({ title: '高速 PD 一阶 RC 读出前级', fields: Object.freeze(rcFields.map(Object.freeze)) }),
  mzi: Object.freeze({ title: '非理想 MZM：偏置与消光比', fields: Object.freeze(mziFields.map(Object.freeze)) }),
});

export function formatScienceNumber(value, digits = 8) {
  return value === Infinity ? '∞' : Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '—';
}

function normalizeParameters(model, input = {}) {
  input ??= {};
  if (model === 'rc' && !Object.hasOwn(input, 'capacitancePf') && Object.hasOwn(input, 'capacitanceNf')) {
    input = { ...input, capacitancePf: input.capacitanceNf === null || input.capacitanceNf === '' ? NaN : Number(input.capacitanceNf) * 1000 };
  }
  return Object.fromEntries(scienceModels[model].fields.map(field => {
    const raw = Object.hasOwn(input ?? {}, field.key) ? input[field.key] : field.value;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(value)) throw new Error(`请输入有效的${field.label}。`);
    if (field.min != null && (value < field.min || value > field.max)) {
      throw new Error(`${field.label}应在 ${field.min}${field.unit} 至 ${field.max}${field.unit} 之间。`);
    }
    return [field.key, value === 0 ? 0 : value];
  }));
}

function normalizeAnchor(anchor) {
  if (typeof anchor?.id !== 'string' || !anchor.id.trim() || typeof anchor.title !== 'string' || !anchor.title.trim()) {
    throw new Error('请先选择讲义原页。');
  }
  const { id, title, page, materialId } = anchor;
  if (page != null && (!Number.isSafeInteger(page) || page < 1)) throw new Error('原页页码必须是正整数。');
  return {
    id: id.trim(),
    title: title.trim(),
    ...(page != null ? { page } : {}),
    ...(typeof materialId === 'string' && materialId.trim() ? { materialId: materialId.trim() } : {}),
  };
}

const voltageUnits = new Map([['mV', 1e-3], ['V', 1], ['kV', 1e3]]);
const timeUnits = new Map([['ns', 1e-3], ['µs', 1], ['μs', 1], ['us', 1], ['ms', 1e3], ['s', 1e6]]);
const quantity = (value, unit) => ({ value, unit });

function rcSolution({ resistanceKohm, capacitancePf, initialV, finalV }) {
  if (!(resistanceKohm > 0)) throw new Error('电阻 R 必须大于 0 kΩ。');
  if (!(capacitancePf > 0)) throw new Error('电容 C 必须大于 0 pF。');
  const tauUs = resistanceKohm * capacitancePf / 1000;
  if (!(tauUs > 0) || !Number.isFinite(5 * tauUs) || !Number.isFinite(1e3 / (2 * Math.PI * tauUs))) throw new Error('时间常数超出可计算范围。');
  return {
    initial: quantity(initialV, 'V'),
    final: quantity(finalV, 'V'),
    timeConstant: quantity(tauUs, 'μs'),
    riseTimeUs: Math.log(9) * tauUs,
    bandwidthKhz: 1e3 / (2 * Math.PI * tauUs),
  };
}

function measure(candidate, units) {
  if (!units.has(candidate?.unit) || !Number.isFinite(candidate.value)) return NaN;
  const value = candidate.value * units.get(candidate.unit);
  return value === 0 && candidate.value !== 0 ? NaN : value;
}

function closeEnough(actual, expected) {
  return Number.isFinite(actual) && (actual === expected ||
    Math.abs(actual - expected) <= 1e-7 * Math.max(Math.abs(actual), Math.abs(expected)));
}

function describeQuantity(value) {
  return Number.isFinite(value?.value)
    ? `${formatScienceNumber(value.value)} ${value.unit || '（无单位）'}`
    : '未提供';
}

function checkQuantity(id, label, expected, candidate, units) {
  return {
    id, label,
    passed: closeEnough(measure(candidate, units), measure(expected, units)),
    expected: describeQuantity(expected),
    observed: describeQuantity(candidate),
  };
}

// An RC answer is the three measured quantities in
// The capacitor's exponential boundary-value solution is reviewed dimensionally.
export function reviewRcSolution(parameters, candidate) {
  const expected = rcSolution(normalizeParameters('rc', parameters));
  const dimensioned = voltageUnits.has(candidate?.initial?.unit) &&
    voltageUnits.has(candidate?.final?.unit) && timeUnits.has(candidate?.timeConstant?.unit);
  return [
    checkQuantity('initial', '初值 V<sub>C</sub>(0⁺)', expected.initial, candidate?.initial, voltageUnits),
    checkQuantity('final', '终值 V<sub>C</sub>(∞)', expected.final, candidate?.final, voltageUnits),
    {
      id: 'units', label: '单位', passed: dimensioned,
      expected: '初值、终值为电压，τ 为时间',
      observed: dimensioned ? 'Ω·F = s，t 与 τ 换成同一单位后相除' : '解答须给出可换算的电压与时间单位',
    },
    checkQuantity('time-constant', '时间常数 τ = RC', expected.timeConstant, candidate?.timeConstant, timeUnits),
  ];
}

function rcVoltage(initial, final, timeOverTau) {
  // Equivalent to the exponential boundary-value form, using stable weights
  // also for small t/τ and opposite-sign initial and final voltages.
  if (initial === final) return initial;
  return initial * Math.exp(-timeOverTau) - final * Math.expm1(-timeOverTau);
}

function rcExample(parameters) {
  const { resistanceKohm, capacitancePf, initialV, finalV } = parameters;
  const solution = rcSolution(parameters), tauUs = solution.timeConstant.value;
  const n = formatScienceNumber;
  const formula = `V<sub>C</sub>(t) = [${n(finalV)} + (${n(initialV)} − (${n(finalV)})) exp(−t/(${n(tauUs)} μs))] V`;
  const points = Array.from({ length: 51 }, (_, i) => ({ x: i * tauUs / 10, y: rcVoltage(initialV, finalV, i / 10) }));
  return { solution, formula, checks: reviewRcSolution(parameters, solution), slides: [
    { title: '高速 PD 读出前级 · 题页', body: [
      '光电二极管及同轴线的总电容与负载电阻构成一阶低通。以下是等效电压阶跃测试；不把本模型当作含运放反馈的完整跨阻放大器。',
      `负载 R<sub>L</sub> = ${n(resistanceKohm)} kΩ，总电容 C<sub>tot</sub> = ${n(capacitancePf)} pF。电容初值为 ${n(initialV)} V，电源电压为 ${n(finalV)} V。`,
      '求电容电压 V<sub>C</sub>(t)、10%–90% 上升时间及 −3 dB 带宽。增大负载电阻能否同时提高转换增益与带宽？'] },
    { title: '高速 PD 读出前级 · 解答', body: [
      `V<sub>C</sub>(0⁺) = ${n(initialV)} V，V<sub>C</sub>(∞) = ${n(finalV)} V。`,
      `τ = R<sub>L</sub>C<sub>tot</sub> = ${n(resistanceKohm)} kΩ × ${n(capacitancePf)} pF = ${n(tauUs)} μs。kΩ·pF = ns，先换算再代入指数。`,
      formula,
      `t<sub>r</sub> = ln(9)τ = ${n(solution.riseTimeUs, 5)} μs；f<sub>−3dB</sub> = 1/(2πτ) = ${n(solution.bandwidthKhz, 5)} kHz。`,
      '零初值阶跃中，V<sub>C</sub>(τ) = 0.6321 V∞；R、C 各自翻倍给出相同的时域与频域电压响应。'] },
    { title: '高速 PD 读出前级 · 数值曲线', body: [
      `V<sub>C</sub>(τ) = ${n(rcVoltage(initialV, finalV, 1))} V；上升时间与带宽的乘积约为 0.350。稳态光电流读出的转换增益约为 R<sub>L</sub>，提高电阻也会降低电压低通带宽。`],
      points, xLabel: '时间 t (μs)', yLabel: '电容电压 V<sub>C</sub> (V)' },
  ] };
}

function mziExample({ phaseDeg, lossDb }) {
  const solution = { phaseRadians: phaseDeg * Math.PI / 180, ...mzmTransfer({ lossDb, phaseDeg }) };
  const n = formatScienceNumber, p = value => `${n(value * 100, 6)}%`;
  const peak = mzmTransfer({ lossDb, phaseDeg: 0 }), valley = mzmTransfer({ lossDb, phaseDeg: 180 });
  const points = Array.from({ length: 73 }, (_, i) => ({ x: i * 5, y: 100 * mzmTransfer({ lossDb, phaseDeg: i * 5 }).PA }));
  const pointsB = points.map(({ x }) => ({ x, y: 100 * mzmTransfer({ lossDb, phaseDeg: x }).PB }));
  const formula = 'P<sub>A</sub>/P<sub>in</sub> = [1 + T<sub>2</sub> + 2√T<sub>2</sub>cos(Δφ)]/4；P<sub>B</sub>/P<sub>in</sub> = [1 + T<sub>2</sub> − 2√T<sub>2</sub>cos(Δφ)]/4';
  return { solution, formula, checks: [
    { id: 'phase-zero', label: '零相位峰值', passed: closeEnough(peak.PA, solution.pMax), expected: `A 端 ${p(solution.pMax)}` },
    { id: 'phase-pi', label: '半周期谷底', passed: closeEnough(valley.PA, solution.pMin), expected: `A 端 ${p(solution.pMin)}` },
    { id: 'energy', label: '单臂损耗功率平衡', passed: closeEnough(solution.PA + solution.PB, solution.totalPower), expected: `P<sub>A</sub> + P<sub>B</sub> = (1 + T<sub>2</sub>)/2 = ${n(solution.totalPower)}` },
    { id: 'er', label: '静态消光比 ER', passed: lossDb === 0 ? solution.erDb === Infinity : closeEnough(10 * Math.log10(solution.pMax / solution.pMin), solution.erDb), expected: `${n(solution.erDb, 5)} dB（全相位扫描峰谷比）` },
  ], slides: [
    { title: '非理想 MZM 调制器 · 题页', body: [
      `两只理想 50:50 耦合器；一臂有 ${lossDb} dB 额外损耗，T<sub>2</sub> = 10<sup>−α/10</sup> = ${n(solution.T2)}，振幅透过率 t<sub>2</sub> = √T<sub>2</sub>。`,
      `在相位 ${phaseDeg}° 求两端归一化光功率及静态 ER。若施加 V<sub>RF</sub> = 0.2 V<sub>π</sub>sin(ωt)，为何谷底偏置不能线性传送基频？`] },
    { title: '非理想 MZM 调制器 · 解答', body: [ formula,
      `A 端输出 ${p(solution.PA)}，B 端输出 ${p(solution.PB)}，总输出 ${p(solution.totalPower)}；缺少的功率在有损臂中耗散，不是相消使能量凭空消失。`,
      `ER = 20 log<sub>10</sub>[(1+t<sub>2</sub>)/(1−t<sub>2</sub>)] = ${n(solution.erDb, 5)} dB。3.0103 dB 单臂损耗对应约 15.31 dB 静态 ER。`,
      '正交点 φ₀ = π/2 的小信号一阶项非零，偶次谐波消失。峰值或谷底一阶项为零，输出以 2f 为主，并含更高偶次谐波；这是偶函数折叠，不是二极管半波截断。'] },
    { title: '非理想 MZM 调制器 · 数值曲线', body: [
      '扫相位而不改变单臂损耗，两端总功率保持 (1+T₂)/2。静态 ER 与当前偏置无关；偏置决定射频信号的谐波结构。'],
      points, series: [{ label: 'A 端', color: '#0B4F6C', points }, { label: 'B 端', color: '#047857', points: pointsB }],
      xLabel: '相位差 Δφ (°)', yLabel: '相对入射功率 (%)' },
  ] };
}

// A packet holds a source-linked problem, solution, and numerical plot, in
// teaching order. Slides can be rendered independently in the classroom.
export function buildSciencePacket({ model = 'rc', anchor, parameters } = {}) {
  if (!Object.hasOwn(scienceModels, model)) throw new Error('请选择一项例题。');
  const original = normalizeAnchor(anchor);
  const values = normalizeParameters(model, parameters);
  const example = model === 'rc' ? rcExample(values) : mziExample(values);
  const source = original.page == null ? original.title : `${original.title} · 第 ${original.page} 页`;
  return {
    kind: 'science', model, title: scienceModels[model].title, anchor: original, parameters: values,
    solution: example.solution, ...(model === 'rc' && { riseTimeUs: example.solution.riseTimeUs, bandwidthKhz: example.solution.bandwidthKhz }), formula: example.formula, checks: example.checks,
    slides: example.slides.map(slide => ({ ...slide, source })),
  };
}
