const manifests = [
  {
    id: 'mzi-phase@1',
    title: '相位扫描',
    scene: 'mzi',
    input: 'phase-power',
    aggregate: 'phase-samples',
    reveal: 'two-port-power',
  },
  {
    id: 'source-critique@1',
    title: '史料互证',
    scene: 'history',
    input: 'choice-reason',
    aggregate: 'response-counts',
    reveal: 'sources',
  },
  {
    id: 'number-blackbox@1',
    title: '数字黑箱',
    scene: 'blackbox',
    input: 'choice-reason',
    aggregate: 'response-counts',
    reveal: 'competing-rules',
  },
  {
    id: 'choice@1',
    title: '选择与理由',
    scene: 'choice',
    input: 'choice-reason',
    aggregate: 'response-counts',
    reveal: 'choices',
  },
];

export const activities = Object.freeze(manifests.map((manifest) => Object.freeze(manifest)));

const legacyActivityIds = new Map([
  ['mzi', 'mzi-phase@1'],
  ['history', 'source-critique@1'],
  ['blackbox', 'number-blackbox@1'],
]);

export function getActivity(lesson) {
  const id = lesson?.activityId === undefined
    ? (legacyActivityIds.get(lesson?.id) ?? 'choice@1')
    : lesson.activityId;
  return activities.find((activity) => activity.id === id);
}
