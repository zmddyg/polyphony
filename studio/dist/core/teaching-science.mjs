import { mziPowerA, phaseLabel } from './optics.mjs';
import { mziFormulaMathML, rcFormulaMathML } from './mathml.mjs';

const rcFields = [
  { key: 'resistanceKohm', label: '电阻 R', unit: 'kΩ', value: 10 },
  { key: 'capacitanceNf', label: '电容 C', unit: 'nF', value: 100 },
  { key: 'initialV', label: '初始电压 V₀', unit: 'V', value: 0 },
  { key: 'finalV', label: '稳态电压 V∞', unit: 'V', value: 5 },
];

const mziFields = [
  { key: 'phaseDeg', label: '两臂相位差 Δφ', unit: '°', value: 180, min: 0, max: 360 },
];

export const scienceModels = Object.freeze({
  rc: Object.freeze({ title: '一阶 RC 电路', fields: Object.freeze(rcFields.map(Object.freeze)) }),
  mzi: Object.freeze({ title: '马赫–曾德尔干涉', fields: Object.freeze(mziFields.map(Object.freeze)) }),
});

export function formatScienceNumber(value, digits = 8) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '—';
}

function normalizeParameters(model, input = {}) {
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
const timeUnits = new Map([['ns', 1e-6], ['µs', 1e-3], ['μs', 1e-3], ['us', 1e-3], ['ms', 1], ['s', 1e3]]);
const quantity = (value, unit) => ({ value, unit });

function rcSolution({ resistanceKohm, capacitanceNf, initialV, finalV }) {
  if (!(resistanceKohm > 0)) throw new Error('电阻 R 必须大于 0 kΩ。');
  if (!(capacitanceNf > 0)) throw new Error('电容 C 必须大于 0 nF。');
  const product = resistanceKohm * capacitanceNf;
  // kΩ × nF = µs. Convert once to the millisecond scale used by the curve.
  const tauMs = Number.isFinite(product) ? product / 1e3 : (resistanceKohm / 1e3) * capacitanceNf;
  if (tauMs / 1e3 <= 0 || !Number.isFinite(5 * tauMs)) throw new Error('时间常数超出可计算范围。');
  return {
    initial: quantity(initialV, 'V'),
    final: quantity(finalV, 'V'),
    timeConstant: quantity(tauMs, 'ms'),
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
    passed: closeEnough(measure(candidate, units), expected.value),
    expected: describeQuantity(expected),
    observed: describeQuantity(candidate),
  };
}

// An RC answer is the three measured quantities in
// V_C(t) = V∞ + (V₀ − V∞) exp(−t/τ). Review each against the current problem.
export function reviewRcSolution(parameters, candidate) {
  const expected = rcSolution(normalizeParameters('rc', parameters));
  const dimensioned = voltageUnits.has(candidate?.initial?.unit) &&
    voltageUnits.has(candidate?.final?.unit) && timeUnits.has(candidate?.timeConstant?.unit);
  return [
    checkQuantity('initial', '初值 V_C(0⁺)', expected.initial, candidate?.initial, voltageUnits),
    checkQuantity('final', '终值 V_C(∞)', expected.final, candidate?.final, voltageUnits),
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
  const { resistanceKohm, capacitanceNf, initialV, finalV } = parameters;
  const solution = rcSolution(parameters);
  const tauMs = solution.timeConstant.value;
  const number = formatScienceNumber;
  const initial = number(initialV);
  const final = number(finalV);
  const tau = number(tauMs);
  const sample = timeOverTau => number(rcVoltage(initialV, finalV, timeOverTau));
  const formula = `V_C(t) = [${final} + (${initial} − ${finalV < 0 ? `(${final})` : final}) × exp(−t/(${tau} ms))] V`;
  const formulas = [rcFormulaMathML({ initial, final, finalNegative: finalV < 0, tau })];
  const points = Array.from({ length: 51 }, (_, index) => {
    const ratio = index / 10;
    return { x: ratio * tauMs, y: rcVoltage(initialV, finalV, ratio) };
  });
  return {
    solution, formula, checks: reviewRcSolution(parameters, solution),
    slides: [
      {
        title: '一阶 RC 电路 · 题页',
        body: [
          't = 0 时，将带有给定初始电压的电容接入由理想恒压电源与电阻组成的串联回路。',
          `电阻 R = ${number(resistanceKohm)} kΩ，电容 C = ${number(capacitanceNf)} nF。电容初值为 ${initial} V，电源电压为 ${final} V。`,
          '求时间常数 τ 和 t ≥ 0 时的电容电压 V_C(t)，再计算经过一个时间常数时的电压。',
        ],
      },
      {
        title: '一阶 RC 电路 · 解答',
        body: [
          `电容电压连续，V_C(0⁺) = ${initial} V。稳态电流为零，V_C(∞) = ${final} V。`,
          `τ = RC = ${number(resistanceKohm)} kΩ × ${number(capacitanceNf)} nF = ${tau} ms。Ω·F = s，计算 t/τ 时使用同一时间单位。`,
          `${formula}，t ≥ 0。`,
          `代入 t = τ = ${tau} ms，V_C(τ) ≈ ${sample(1)} V。`,
        ],
        formulas,
      },
      {
        title: '一阶 RC 电路 · 数值曲线',
        body: [`V_C(0⁺) = ${initial} V，V_C(τ) ≈ ${sample(1)} V，V_C(5τ) ≈ ${sample(5)} V。`],
        points, xLabel: '时间 t (ms)', yLabel: '电容电压 V_C (V)',
      },
    ],
  };
}

function mziExample({ phaseDeg }) {
  const powerAt = degrees => mziPowerA(degrees * Math.PI / 180);
  const phaseRadians = phaseDeg * Math.PI / 180;
  const a = powerAt(phaseDeg);
  const b = 1 - a;
  const percent = fraction => `${formatScienceNumber(100 * fraction)}%`;
  const phase = Number.isInteger(phaseDeg / 45) ? phaseLabel(phaseDeg / 45) : formatScienceNumber(phaseRadians);
  const points = Array.from({ length: 73 }, (_, index) => ({ x: index * 5, y: 100 * powerAt(index * 5) }));
  const pointsB = points.map(({ x, y }) => ({ x, y: 100 - y }));
  const formula = 'P_A/P_in = cos²(Δφ/2)，P_B/P_in = 1 − P_A/P_in = sin²(Δφ/2)';
  return {
    solution: { phaseRadians, powerA: a, powerB: b }, formula,
    checks: [
      { id: 'phase-zero', label: '零相位', passed: powerAt(0) === 1, expected: 'A 端 100%，B 端 0%' },
      { id: 'phase-pi', label: '半周期', passed: powerAt(180) === 0, expected: 'A 端 0%，B 端 100%' },
      { id: 'energy', label: '功率守恒', passed: closeEnough(a + b, 1), expected: '两端功率之和等于入射功率' },
    ],
    slides: [
      {
        title: '马赫–曾德尔干涉 · 题页',
        body: [
          '理想、无损的平衡马赫–曾德尔干涉仪，两臂均畅通。按实验的端口约定，Δφ = 0° 时光由 A 端输出。',
          `将两臂相位差 Δφ 调至 ${phaseDeg}°，求 A、B 两端的功率分别占入射功率的比例，再求两者之和。`,
        ],
      },
      {
        title: '马赫–曾德尔干涉 · 解答',
        body: [
          `将相位差换算为弧度，Δφ = ${phase} rad。`,
          `${formula}。`,
          `代入后，A 端输出 ${percent(a)}，B 端输出 ${percent(b)}。两端功率之和等于入射功率。`,
        ],
        formulas: [mziFormulaMathML()],
      },
      {
        title: '马赫–曾德尔干涉 · 数值曲线',
        body: [
          '相位差从 0° 扫到 360°。A 端与 B 端的归一化功率互补。',
          `在题设的 ${phaseDeg}° 处，A 端为 ${percent(a)}，B 端为 ${percent(b)}。`,
        ],
        points, xLabel: '两臂相位差 Δφ (°)', yLabel: '归一化功率 (%)',
        series: [
          { label: 'A 端', color: '#315be8', points },
          { label: 'B 端', color: '#0f766e', points: pointsB },
        ],
      },
    ],
  };
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
    solution: example.solution, formula: example.formula, checks: example.checks,
    slides: example.slides.map(slide => ({ ...slide, source })),
  };
}
