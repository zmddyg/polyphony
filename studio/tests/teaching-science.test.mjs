import test from 'node:test';
import assert from 'node:assert/strict';
import { mziPowerA } from '../dist/core/optics.mjs';
import { buildSciencePacket, reviewRcSolution } from '../dist/core/teaching-science.mjs';
import { renderScienceChart } from '../dist/views/material-science.mjs';

const anchor = { id: 'electricity-2', title: '电学讲义', page: 2, materialId: 'electricity' };
const rc = parameters => buildSciencePacket({ anchor, parameters });
const mzi = parameters => buildSciencePacket({ model: 'mzi', anchor, parameters });

const checked = result => Object.fromEntries(result.map(({ id, passed }) => [id, passed]));

test('RC packet links the original page with the numerical problem, solution, and curve', () => {
  const packet = rc();
  assert.deepEqual(packet.anchor, anchor);
  assert.notStrictEqual(packet.anchor, anchor);
  assert.equal(packet.model, 'rc');
  assert.deepEqual(packet.parameters, { resistanceKohm: 10, capacitancePf: 100, initialV: 0, finalV: 5 });
  assert.deepEqual(packet.slides.map(({ title }) => title.split(' · ')[1]), ['题页', '解答', '数值曲线']);
  assert.ok(packet.slides.every(slide => slide.source === '电学讲义 · 第 2 页'));
  assert.match(packet.slides[0].body.join('\n'), /电容初值为 0 V，电源电压为 5 V/);
  assert.equal(packet.solution.timeConstant.value, 1);
  assert.equal(packet.solution.timeConstant.unit, 'μs');
  assert.ok(Math.abs(packet.riseTimeUs - Math.log(9)) < 1e-12);
  assert.ok(Math.abs(packet.bandwidthKhz - 159.154943) < 1e-5);
  const curve = packet.slides[2];
  assert.equal(curve.points.length, 51);
  assert.deepEqual(curve.points[0], { x: 0, y: 0 });
  assert.equal(curve.points[10].x, 1);
  assert.ok(Math.abs(curve.points[10].y - (5 - 5 / Math.E)) < 1e-12);
  assert.equal(curve.points.at(-1).x, 5);
  assert.match(curve.xLabel, /μs/);
  assert.match(curve.yLabel, /\(V\)/);
});

test('changing only the initial voltage fails the initial-condition check of the previous RC solution', () => {
  const earlier = rc();
  const updated = rc({ ...earlier.parameters, initialV: 2 });
  assert.deepEqual(checked(reviewRcSolution(updated.parameters, earlier.solution)), {
    initial: false, final: true, units: true, 'time-constant': true,
  });
  assert.deepEqual(checked(updated.checks), {
    initial: true, final: true, units: true, 'time-constant': true,
  });
  const [first] = reviewRcSolution(updated.parameters, earlier.solution);
  assert.equal(first.expected, '2 V');
  assert.equal(first.observed, '0 V');
  assert.match(updated.slides[0].body.join('\n'), /电容初值为 2 V/);
  assert.match(updated.formula, /\(2 − \(5\)\)/);
  assert.deepEqual(updated.slides[2].points[0], { x: 0, y: 2 });
  assert.ok(Math.abs(updated.slides[2].points[10].y - (5 - 3 / Math.E)) < 1e-12);
});

test('RC review converts compatible units and detects wrong dimensions, final voltage, and time constant', () => {
  const parameters = { resistanceKohm: 20, capacitanceNf: 200, initialV: 4, finalV: -1 };
  const packet = rc(parameters);
  assert.deepEqual(packet.solution.timeConstant, { value: 4000, unit: 'μs' });
  const points = packet.slides[2].points;
  assert.ok(points.every(({ y }, index) => index === 0 || points[index - 1].y > y));
  assert.ok(Math.abs(points[10].y - (-1 + 5 / Math.E)) < 1e-12);
  assert.deepEqual(checked(reviewRcSolution(parameters, {
    initial: { value: 4000, unit: 'mV' },
    final: { value: -0.001, unit: 'kV' },
    timeConstant: { value: 0.004, unit: 's' },
  })), { initial: true, final: true, units: true, 'time-constant': true });
  assert.deepEqual(checked(reviewRcSolution(parameters, {
    initial: { value: 4, unit: 'Ω' },
    final: { value: 1, unit: 'V' },
    timeConstant: { value: 4, unit: 's' },
  })), { initial: false, final: false, units: false, 'time-constant': false });
  const steady = rc({ initialV: -2, finalV: -2 });
  assert.ok(steady.slides[2].points.every(({ y }) => y === -2));
});

test('invalid parameters and missing anchors fail instead of producing calculated slides', () => {
  assert.throws(() => buildSciencePacket(), /讲义原页/);
  assert.throws(() => buildSciencePacket({ anchor: { ...anchor, page: 0 } }), /页码/);
  assert.throws(() => rc({ resistanceKohm: 0 }), /电阻 R 必须大于 0/);
  assert.throws(() => rc({ capacitanceNf: -1 }), /电容 C 必须大于 0/);
  assert.throws(() => rc({ initialV: '' }), /初始电压/);
  assert.throws(() => rc({ finalV: null }), /稳态电压/);
  assert.throws(() => rc({ resistanceKohm: Number.MAX_VALUE, capacitancePf: Number.MAX_VALUE }), /时间常数/);
  assert.throws(() => mzi({ phaseDeg: 361 }), /0° 至 360°/);
});

test('lossy MZM packets audit peak, valley, power balance and static extinction ratio', () => {
  const packet = mzi();
  assert.ok(Math.abs(packet.solution.erDb - 15.34) < .02);
  assert.ok(Math.abs(packet.solution.totalPower - .7505936) < 1e-6);
  assert.ok(packet.solution.powerA > 0 && packet.solution.powerB < 1);
  assert.equal(packet.checks.length, 4); assert.ok(packet.checks.every(c => c.passed));
  const { points, series } = packet.slides[2];
  assert.equal(points.length, 73);
  assert.ok(points.every((p,i) => Math.abs(p.y + series[1].points[i].y - 100 * packet.solution.totalPower) < 1e-10));
  const ideal = mzi({ lossDb: 0 });
  assert.equal(ideal.solution.powerA, 0); assert.equal(ideal.solution.powerB, 1);
  assert.equal(ideal.solution.erDb, Infinity);
  const text = packet.slides.flatMap(s => s.body).join(' ');
  assert.match(text, /P<sub>A<\/sub>/);
  assert.doesNotMatch(text, /V_C|P_A\/P_in|f_-3dB/);
});

test('RC audit accepts nanoseconds through seconds and millivolts through kilovolts', () => {
  const parameters = rc().parameters;
  for (const timeConstant of [{value:1000,unit:'ns'},{value:1,unit:'μs'},{value:.001,unit:'ms'},{value:1e-6,unit:'s'}]) {
    const candidate = { initial:{value:0,unit:'mV'}, final:{value:.005,unit:'kV'}, timeConstant };
    assert.ok(reviewRcSolution(parameters, candidate).every(c => c.passed));
  }
  assert.deepEqual(rc({capacitanceNf:.1}).parameters, parameters);
});

test('chart displays both port series and keeps dynamic text and style out of markup', () => {
  assert.equal(renderScienceChart(rc().slides[0]), '');
  const screen = renderScienceChart({ ...mzi().slides[2],
    xLabel: '<script>x</script>',
    series: [
      { ...mzi().slides[2].series[0], color: 'red" onclick="x', label: '<img src=x>', },
      mzi().slides[2].series[1],
    ],
  });
  assert.equal(screen.match(/class="psci-series"/g)?.length, 2);
  assert.match(screen, /&lt;img src=x&gt;/);
  assert.match(screen, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(screen, /<script|<img|onclick|NaN|Infinity/);
  const single = renderScienceChart(rc({ initialV: 0, finalV: 0 }).slides[2]);
  assert.equal(single.match(/class="psci-series"/g)?.length, 1);
  assert.doesNotMatch(single, /NaN|Infinity/);
});
