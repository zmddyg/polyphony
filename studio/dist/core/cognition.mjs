// Aggregate identities before projection. Distribution changes alone cannot identify who changed.
export function roundTallies(state, round) {
  const counts = Object.fromEntries((state.lesson?.options ?? []).map(o => [o.id, 0]));
  let total = 0;
  for (const r of state.responses ?? []) if (Number(r.round) === round && Object.hasOwn(counts, r.optionId)) {
    counts[r.optionId]++; total++;
  }
  return { total, counts };
}

export function pairedRevisions(state) {
  const first = new Map((state.responses ?? []).filter(r => Number(r.round) === 1 && r.participantId).map(r => [r.participantId, r]));
  const pairs = (state.responses ?? []).filter(r => Number(r.round) === 2 && r.participantId && first.has(r.participantId) && first.get(r.participantId).simulated === r.simulated);
  const live = pairs.filter(r => !r.simulated);
  const sample = live.length ? live : pairs;
  return { total: sample.length, changed: sample.filter(r => first.get(r.participantId).optionId !== r.optionId).length,
    source: live.length ? 'live' : 'simulated' };
}

export function cognitionReport(state) {
  const first = state.round1Tallies ?? roundTallies(state, 1);
  const second = roundTallies(state, 2);
  const paired = state.pairedRevisions ?? pairedRevisions(state);
  // Only the registered lessons have a known answer. Never guess the answer for imported lessons.
  const correct = state.lesson?.correctOptionId ?? ({ mzi: 'dark', 'rc-fault': 'current', 'optical-aliasing': '180' })[state.lessonId];
  const percent = (count, total) => total ? Math.round(count * 100 / total) : null;
  return { first, second, paired, correct,
    firstCorrect: correct ? percent(first.counts[correct] ?? 0, first.total) : null,
    secondCorrect: correct ? percent(second.counts[correct] ?? 0, second.total) : null,
    revisionPercent: percent(paired.changed, paired.total) };
}
