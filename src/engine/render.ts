// renderEvent: MeetingEvent -> one display line.
//
// D8's rendering rule, with the authored-content fallback chain:
//   member actor: member.lines[intent] -> scenario.lines[intent] -> built-in
//   everyone else (CHAIR/CLERK/AUDIENCE/SYSTEM): scenario.lines[intent] -> built-in
// Variants are picked with the seeded RNG so the same seed always narrates the
// same way. `{slot}` tokens are filled from the event payload.
//
// Missing content must never crash the game, so every intent the engine can
// emit has a neutral built-in line here, and anything unrecognised still gets
// a per-type sentence. The built-ins are single strings, so falling back
// consumes no randomness — `rngState` comes back untouched.
//
// All prose here is original; no parliamentary manual is quoted anywhere.

import type { Scenario, ScenarioMember } from '../content/schema'
import { pickIndex } from './rng'
import type { MeetingEvent } from './types'

const FALLBACK_LINES: Record<string, string> = {
  // Setting / meeting frame
  MEETING_SETTING: 'The board of {body} takes its seats. {presentCount} of {seats} members are here.',
  QUORUM_PRESENT: 'A quorum is present.',
  NO_QUORUM: 'There are not enough members present to do business.',
  AWAITING_CALL_TO_ORDER: 'The room waits for the chair to begin.',
  MEETING_OVER: 'The meeting is over.',

  // Agenda
  CALL_TO_ORDER: 'The chair calls the meeting to order.',
  READ_ITEM: 'The clerk reads the next item: {itemTitle}.',
  OPEN_ITEM: 'The chair opens {itemTitle} for business.',
  ITEM_RESOLVED: 'That settles {itemTitle}.',
  AGENDA_COMPLETE: 'There is nothing further on the agenda.',
  RESUME_FROM_RECESS: 'The chair calls the meeting back to order.',

  // Recognition and floor
  RECOGNIZE: 'The chair recognizes {memberName}.',
  DEMUR: '{memberName} shakes their head; they had nothing to say.',
  RECOGNIZE_NOBODY: 'The chair looks toward an empty chair.',
  INTERRUPT_LEGITIMIZED: 'The chair gives {memberName} the floor, and the outburst becomes a speech.',

  // Motions
  MOVE: '{memberName} moves {motionText}.',
  MOTION_MOVED: 'The motion is on the floor: {motionText}.',
  MOVE_OUT_OF_ORDER: '{memberName} starts to move something, but there is already business on the floor.',
  SECOND: '{memberName} seconds the motion.',
  NO_MOTION: 'There is no motion in front of the board.',
  STATE_MOTION: 'The chair states the question on {motionText}.',
  DEBATE_FOR: '{memberName} speaks in favor.',
  DEBATE_AGAINST: '{memberName} speaks against.',
  COMMENT: '{memberName} offers a comment.',

  // Voting
  VOTE_TAKEN: 'The chair puts the question to a vote.',
  VOICE_VOTE: 'Ayes and noes come back across the table: {ayes} to {noes}, with {abstains} silent.',
  ANNOUNCE_RESULT: 'The chair announces the vote: {ayes} in favor, {noes} opposed, {abstains} abstaining. The motion is {result}.',

  // The room speaking up (D6/D7)
  SEEK_RECOGNITION: '{memberName} catches the chair\'s eye and waits to be called on.',
  RAISE_POINT_OF_ORDER: '{memberName} raises a point of order.',
  RAISE_INQUIRY: '{memberName} has a question about procedure.',
  INTERRUPT: '{memberName} stops waiting to be called on and talks over the room.',
  SPEECH_CONTINUES: '{memberName} is still going, and the point is somewhere ahead.',
  WITHDRAW_REQUEST: '{memberName} lowers their hand and lets it go.',
  PROMPT_STATE_MOTION: '{memberName} points out that the chair has not put the question to the board yet.',
  PROMPT_BUSINESS: '{memberName} asks, politely, what the board is doing about {itemTitle}.',
  ROOM_RESTLESS: 'The interruption is still hanging in the air, and the room knows it.',

  // Chair conduct
  CONFUSION: '{memberName} looks around, unsure what just happened.',
  RULE_WELL_TAKEN: 'The chair rules the point well taken.',
  RULE_NOT_WELL_TAKEN: 'The chair rules the point not well taken.',
  NOTHING_TO_RULE: 'The chair looks for a point of order that is no longer there.',
  ANSWER_INQUIRY: 'The chair answers: {answerText}',
  NOTHING_TO_ANSWER: 'The chair answers a question nobody is asking.',
  GAVEL_ORDER: 'The gavel comes down and the room quiets.',
  GAVEL_QUIET: 'The gavel comes down. Nobody was talking.',
  GAVEL_CUT_OFF: 'The gavel comes down across {memberName}\'s sentence.',
  RECESS: 'The chair declares a recess of {minutes} minutes.',
  ADJOURN: 'The chair declares the meeting adjourned.',
  MEETING_ADJOURNED: 'Chairs scrape back from the table.',
  CHAIR_WAITS: 'The chair says nothing.',

  // Collapse
  ROOM_TALKS_OVER_CHAIR: 'Half a dozen conversations start at once and none of them are with the chair.',
  MOTION_DIES: 'Whatever was on the floor is gone; nobody could say when it died.',
  GAVEL_IGNORED: 'The gavel sounds twice more. It changes nothing.',
}

const GENERIC_BY_TYPE: Record<MeetingEvent['type'], string> = {
  SPEECH: '{memberName} says something the clerk does not quite catch.',
  STATE_CHANGE: 'The meeting moves on.',
  INTERRUPT: 'Someone speaks out of turn.',
  VOTE_RESULT: 'The question is resolved.',
  NARRATION: 'The room settles.',
}

const SLOT_PATTERN = /\{(\w+)\}/g

function findMember(scenario: Scenario, actor: MeetingEvent['actor']): ScenarioMember | undefined {
  return scenario.members.find((m) => m.id === actor)
}

function fillSlots(template: string, slots: Record<string, unknown>): string {
  return template
    .replace(SLOT_PATTERN, (_match, key: string) => {
      const value = slots[key]
      return value === undefined || value === null ? '' : String(value)
    })
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Renders one event as a display line, threading the seeded RNG so callers can
 * keep narration reproducible. Returns the (possibly unchanged) rngState.
 */
export function renderEvent(
  event: MeetingEvent,
  scenario: Scenario,
  rngState: number,
): { line: string; rngState: number } {
  // Member actors prefer their own voice, then the scenario's shared lines for
  // that intent (so an author can write a common line once), then the built-in.
  const member = findMember(scenario, event.actor)
  const authored = member?.lines[event.intent] ?? scenario.lines[event.intent]
  const variants = authored ?? []

  let template: string
  let nextRngState = rngState
  if (variants.length > 0) {
    const picked = pickIndex(rngState, variants.length)
    template = variants[picked.index]
    nextRngState = picked.rngState
  } else {
    template = FALLBACK_LINES[event.intent] ?? GENERIC_BY_TYPE[event.type]
  }

  const slots: Record<string, unknown> = {
    memberName: member?.name,
    ...event.payload,
  }
  if (slots.memberName === undefined) slots.memberName = member?.name ?? 'A member'

  return { line: fillSlots(template, slots), rngState: nextRngState }
}
