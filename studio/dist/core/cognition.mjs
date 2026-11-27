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

// Imported activities only contribute accuracy when they declare an answer.
function correctOptionId(state) {
  const registered = { mzi: 'dark', 'rc-fault': 'current', 'optical-aliasing': '180' };
  const correct = state.lesson?.correctOptionId ?? (Object.hasOwn(registered, state.lessonId) ? registered[state.lessonId] : undefined);
  return state.lesson?.options?.some(option => option.id === correct) ? correct : undefined;
}

export function cognitionReport(state) {
  const first = state.round1Tallies ?? roundTallies(state, 1);
  const second = roundTallies(state, 2);
  const paired = state.pairedRevisions ?? pairedRevisions(state);
  const correct = correctOptionId(state);
  const percent = (count, total) => total ? Math.round(count * 100 / total) : null;
  return { first, second, paired, correct,
    firstCorrect: correct ? percent(first.counts[correct] ?? 0, first.total) : null,
    secondCorrect: correct ? percent(second.counts[correct] ?? 0, second.total) : null,
    revisionPercent: percent(paired.changed, paired.total) };
}

export const HIGH_ERROR_ACCURACY = 60;

export function lectureReviewEpisodes(state) {
  if (!state.lecture) return state.lesson?.options?.length ? [[null, state]] : [];
  const { pageNumber, mode } = state.lecture;
  const episodes = new Map((state.lectureArchive ?? []).map(episode => [episode.pageNumber, episode]));
  if (mode === 'activity') episodes.set(pageNumber, state);
  return [...episodes].sort(([left], [right]) => left - right);
}

function validSubmissions(episode) {
  const options = new Set(episode.lesson?.options?.map(option => option.id));
  const latest = new Map();
  for (const response of episode.responses ?? []) {
    const round = Number(response.round);
    if ((round === 1 || round === 2) && response.participantId && options.has(response.optionId)) {
      const simulated = Boolean(response.simulated);
      const key = JSON.stringify([response.participantId, round, simulated]);
      latest.set(key, { ...response, round, simulated });
    }
  }
  return [...latest.values()];
}

export function pilotResponses(episode, source) {
  return validSubmissions(episode).filter(response => response.simulated === (source === 'simulated'));
}

const percent = (count, total) => total ? count * 100 / total : null;
const rounded = value => value == null ? null : Math.round(value * 10) / 10 || 0;
const average = values => {
  const measured = values.filter(value => value != null);
  return measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null;
};
const gain = (first, second) => first == null || second == null ? null : rounded(second - first);

function episodeStats(episode, responses) {
  const sample = { ...episode, responses };
  const first = roundTallies(sample, 1);
  const second = roundTallies(sample, 2);
  const paired = pairedRevisions(sample);
  const correct = correctOptionId(sample);
  return {
    responses,
    reasonCount: responses.filter(response => typeof response.reason === 'string' && response.reason.trim()).length,
    firstAccuracy: correct ? percent(first.counts[correct] ?? 0, first.total) : null,
    secondAccuracy: correct ? percent(second.counts[correct] ?? 0, second.total) : null,
    firstRoundCount: first.total,
    secondRoundCount: second.total,
    pairedCount: paired.total,
    pairedChangedCount: paired.changed,
  };
}

function aggregate(samples) {
  const responses = samples.flatMap(sample => sample.responses);
  // Give each scored page equal weight. Count revision pairs on the same page only.
  const first = average(samples.map(sample => sample.firstAccuracy));
  const second = average(samples.map(sample => sample.secondAccuracy));
  const sum = field => samples.reduce((total, sample) => total + sample[field], 0);
  const pairedCount = sum('pairedCount');
  const pairedChangedCount = sum('pairedChangedCount');
  return {
    participantCount: new Set(responses.map(response => response.participantId)).size,
    reasonFillRate: rounded(percent(sum('reasonCount'), responses.length)),
    firstRoundAccuracy: rounded(first),
    secondRoundAccuracy: rounded(second),
    accuracyGainPp: gain(first, second),
    pairedRevisionRate: rounded(percent(pairedChangedCount, pairedCount)),
    firstRoundCount: sum('firstRoundCount'),
    secondRoundCount: sum('secondRoundCount'),
    pairedCount,
    pairedChangedCount,
  };
}

function lecturePageDetails(lecture) {
  const pages = new Map();
  // Supplementary frames may repeat a source page number in the filmstrip.
  for (const item of lecture?.filmstrip ?? []) {
    if (!pages.has(item.pageNumber)) pages.set(item.pageNumber, { title: item.title, muddyCount: item.muddyCount ?? 0 });
  }
  for (const [number, marks] of Object.entries(lecture?.muddy ?? {})) {
    const pageNumber = Number(number);
    if (Number.isSafeInteger(pageNumber) && pageNumber > 0) {
      pages.set(pageNumber, { ...pages.get(pageNumber), muddyCount: Object.keys(marks ?? {}).length });
    }
  }
  return pages;
}

export function wholeDeckPilotMetrics(state) {
  const lecturePages = lecturePageDetails(state.lecture);
  const episodes = lectureReviewEpisodes(state).map(([pageNumber, episode]) => ({ pageNumber, episode, responses: validSubmissions(episode) }));
  const source = episodes.some(({ responses }) => responses.some(response => !response.simulated)) ? 'live' : 'simulated';
  const selectedSamples = [];
  const pages = episodes.map(({ pageNumber, episode, responses }) => {
    const live = responses.filter(response => !response.simulated);
    const pageSource = live.length ? 'live' : 'simulated';
    const pageSample = episodeStats(episode, live.length ? live : responses);
    if (source === pageSource) selectedSamples.push(pageSample);
    const details = lecturePages.get(pageNumber);
    lecturePages.delete(pageNumber);
    return {
      pageNumber, title: details?.title ?? episode.lesson?.title ?? '课堂互动',
      activityId: episode.lesson?.activityId ?? null, kind: 'interaction', source: pageSource,
      ...aggregate([pageSample]), muddyCount: details?.muddyCount ?? 0,
      versionId: episode.versionId || state.lecture?.sourceVersion || '',
      highError: pageSample.firstAccuracy != null && pageSample.firstAccuracy < HIGH_ERROR_ACCURACY,
    };
  });
  let topMuddyPage = null;
  for (const [pageNumber, details] of lecturePages) {
    if (!(details.muddyCount > 0)) continue;
    const title = details.title ?? `第 ${pageNumber} 页`;
    pages.push({ pageNumber, title, activityId: null, kind: 'lecture', source: 'live',
      ...aggregate([]), muddyCount: details.muddyCount, versionId: state.lecture?.sourceVersion || '', highError: false });
    if (!topMuddyPage || details.muddyCount > topMuddyPage.count ||
      (details.muddyCount === topMuddyPage.count && pageNumber < topMuddyPage.pageNumber)) {
      topMuddyPage = { pageNumber, title, count: details.muddyCount };
    }
  }
  pages.sort((left, right) => left.pageNumber - right.pageNumber);
  return { source, ...aggregate(selectedSamples), interactivePageCount: episodes.length, topMuddyPage, pages };
}
