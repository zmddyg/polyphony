import test from 'node:test';
import assert from 'node:assert/strict';
import { mzmTransfer, mzmRfSimulation, mziPowerA, assignedPhase, phaseLabel, curveGraphic } from '../dist/core/optics.mjs';
const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} differs from ${b}`);
test('lossy MZM calibrated ER and two-port power balance use amplitude, not power, interference', () => {
  const x = mzmTransfer({ lossDb: 3.0102999566 });
  near(x.T2, .5, 1e-10); near(x.erDb, 15.31, .05);
  assert.equal(x.PA + x.PB, (1 + x.T2) / 2);
  for (const lossDb of [0, .01, 3, 3.0102999566, 7, 10]) for (let phaseDeg = 0; phaseDeg <= 360; phaseDeg += 5) {
    const t = mzmTransfer({ lossDb, phaseDeg });
    near(t.PA, (1 + t.T2 + 2 * t.t2 * Math.cos(phaseDeg * Math.PI / 180)) / 4);
    near(t.PB, (1 + t.T2 - 2 * t.t2 * Math.cos(phaseDeg * Math.PI / 180)) / 4);
    near(t.PA + t.PB, t.totalPower); assert.ok(t.PA >= 0 && t.PB >= 0);
  }
  assert.equal(mzmTransfer().erDb, Infinity);
  assert.equal(mzmTransfer({ phaseDeg: 180 }).PA, 0);
  assert.equal(mziPowerA(Math.PI), 0); assert.equal(phaseLabel(4), 'π');
  assert.ok(assignedPhase('student') >= 0); assert.match(curveGraphic([], { reveal: true, lossDb: 3 }), /<svg/);
});
test('128-point real DFT preserves harmonic parity at quadrature and extrema', () => {
  const q = mzmRfSimulation({ lossDb: 3, biasDeg: 90, rfRatio: .2 });
  assert.equal(q.waveform.length, 128); assert.equal(q.vBiasRatio, .5);
  assert.ok(q.h2 < 1e-6 && q.h1 > .1 && q.h3 > 0);
  for (const biasDeg of [0, 180, 360]) {
    const valley = mzmRfSimulation({ lossDb: 3, biasDeg, rfRatio: .2 });
    assert.ok(valley.h1 < 1e-6 && valley.h2 > valley.h1 && valley.h3 < 1e-6);
    for (let n = 0; n < 64; n++) near(valley.waveform[n], valley.waveform[n + 64]);
  }
  const small = mzmRfSimulation({ rfRatio: .05 });
  const large = mzmRfSimulation({ rfRatio: .5 });
  assert.ok(large.h3 / large.h1 > small.h3 / small.h1);
  for (const bad of [{ lossDb: -1 }, { phaseDeg: 361 }, { lossDb: NaN }]) assert.throws(() => mzmTransfer(bad));
  for (const bad of [{ rfRatio: 0 }, { samples: 3 }, { samples: 128.5 }]) assert.throws(() => mzmRfSimulation(bad));
});
