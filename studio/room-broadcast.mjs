import { isRoomResponsePublic, projectRoom } from './dist/core/transport.mjs';

function encodeList(items) {
  const ends = [];
  let end = -1;
  const text = items.map(item => {
    const json = JSON.stringify(item);
    end += json.length + 1;
    ends.push(end);
    return json;
  }).join(',');
  return { text, ends };
}

function replaceListItems({ text, ends }, replacements) {
  let result = '';
  let offset = 0;
  for (const { index, value } of replacements) {
    const start = index === 0 ? 0 : ends[index - 1] + 1;
    result += text.slice(offset, start) + JSON.stringify(value);
    offset = ends[index];
  }
  return result + text.slice(offset);
}

// The anonymous projection supplies the shared fields and list entries for every public view.
// Only the viewer's participant, answers, vote, pulse and appearance as the draw winner vary.
export function createPublicRoomEncoder(room) {
  const { participants, responses, experiment, winner, myPulse: _ignoredPulse, ...shared } = projectRoom(room, 'stage', null);
  const fullProjection = participantId => JSON.stringify(projectRoom(room, 'student', participantId));
  const roster = new Map();
  for (const [index, participant] of room.participants.entries()) {
    if (participant.id == null || roster.has(participant.id)) return fullProjection;
    roster.set(participant.id, { index, value: participant });
  }
  const ownAnswers = new Map();
  let visibleCount = 0;
  for (const response of room.responses) {
    if (response.participantId == null) return fullProjection;
    let changes = ownAnswers.get(response.participantId);
    if (!changes) {
      changes = { replacements: [], additions: [], firstInsertion: Infinity };
      ownAnswers.set(response.participantId, changes);
    }
    if (isRoomResponsePublic(response, room)) changes.replacements.push({ index: visibleCount++, value: response });
    else {
      changes.additions.push(response);
      changes.firstInsertion = Math.min(changes.firstInsertion, visibleCount);
    }
  }
  const votes = new Map();
  for (const { id, choice } of room.experiment?.votes ?? []) {
    if (!votes.has(id)) votes.set(id, choice ?? null);
  }
  const hasLecture = Boolean(room.lecture);
  const pulsed = new Set(hasLecture ? (room.lecturePulses?.[String(room.lecture.pageNumber)] ?? []) : []);
  const projectedParticipants = encodeList(participants);
  const projectedResponses = encodeList(responses);
  const base = JSON.stringify(shared).slice(0, -1);
  const anonymousWinner = JSON.stringify(winner);
  const noVote = experiment === undefined ? '' : `,"experiment":${JSON.stringify(experiment)}`;
  const experimentByVote = new Map([[null, noVote]]);
  const encode = (people, answers, selected, activity, pulse) =>
    `${base},"participants":[${people}],"responses":[${answers}],"winner":${selected}${activity}${pulse}}`;
  let anonymous;
  return participantId => {
    const participant = roster.get(participantId);
    const answers = ownAnswers.get(participantId);
    const vote = votes.get(participantId) ?? null;
    const isPulsed = hasLecture && participantId != null && pulsed.has(participantId);
    const pulseField = hasLecture ? `,"myPulse":${isPulsed}` : '';
    if (participantId == null || (!participant && !answers && vote === null && !isPulsed)) {
      return anonymous ??= encode(projectedParticipants.text, projectedResponses.text, anonymousWinner, noVote, hasLecture ? ',"myPulse":false' : '');
    }

    const visibleParticipants = participant ? replaceListItems(projectedParticipants, [participant]) : projectedParticipants.text;
    let visibleResponses = projectedResponses.text;
    if (answers) {
      if (answers.firstInsertion < visibleCount) {
        // An insertion before a public answer changes its anonymous ordinal.
        const projected = projectRoom(room, 'student', participantId);
        visibleResponses = JSON.stringify(projected.responses).slice(1, -1);
      } else {
        visibleResponses = replaceListItems(projectedResponses, answers.replacements);
        if (answers.additions.length) {
          const own = answers.additions.map(response => JSON.stringify(response)).join(',');
          visibleResponses = visibleResponses ? `${visibleResponses},${own}` : own;
        }
      }
    }
    const visibleWinner = participant && participantId === room.winner?.id ? JSON.stringify(participant.value) : anonymousWinner;
    if (!experimentByVote.has(vote)) experimentByVote.set(vote, `,"experiment":${JSON.stringify({ ...experiment, myVote: vote })}`);
    return encode(visibleParticipants, visibleResponses, visibleWinner, experimentByVote.get(vote), pulseField);
  };
}
