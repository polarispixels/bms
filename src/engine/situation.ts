// describeSituation: one plain-language line for "what is happening right now".
//
// Second-round playtest feedback: "it's still just not clear at all what's
// happening and what to do next." The state panel had the facts, but it spoke
// engine (`MOTION_PENDING`, `RECOGNITION from Ruth (age 3 turns)`) and on a
// phone it sat collapsed behind a one-line summary. This module is the sentence
// a clerk would say if the chair leaned over and asked "where are we?".
//
// The line DESCRIBES and never ADVISES. Spec §2 principle 2 ("react, don't
// grade") puts recommendation entirely in the Hint's hands: `suggestAction` is
// the only place in the codebase allowed to say what the chair ought to do.
// `situation.test.ts` guards that boundary directly — no "should", no "you".
//
// Pure and deterministic, like the rest of the engine: no clock, no RNG, no
// mutation of the state it is handed.

import type { Scenario } from '../content/schema'
import { topMotion } from './motions'
import type { MeetingState, MemberId, Motion, Request } from './types'

/** At most this many pending-request clauses ride along after the core line. */
const MAX_CLAUSES = 2

function nameOf(state: MeetingState, scenario: Scenario, id: MemberId): string {
  return (
    scenario.members.find((m) => m.id === id)?.name ??
    state.members.find((m) => m.id === id)?.name ??
    id
  )
}

function itemTitle(state: MeetingState, scenario: Scenario): string | null {
  return scenario.agenda[state.currentItem]?.title ?? state.agenda[state.currentItem]?.title ?? null
}

/** The words of a motion, quoted the way the transcript quotes them. */
function quoted(motion: Motion): string {
  return `“${motion.text}”`
}

function motionSentence(state: MeetingState, scenario: Scenario, motion: Motion): string {
  if (!motion.seconded) {
    return `${nameOf(state, scenario, motion.mover)} has moved: ${quoted(motion)}. The motion has no second yet — a second must come from the floor.`
  }
  if (!motion.statedByChair) {
    return 'The motion has been moved and seconded. The room has not heard it stated from the chair.'
  }
  return `The motion before the board: ${quoted(motion)}.`
}

function itemSentence(state: MeetingState, scenario: Scenario): string {
  const title = itemTitle(state, scenario)
  if (title === null) return 'Nothing is before the board.'
  if (state.itemsCompleted > state.currentItem) {
    return `The board has finished with ${title}. Nothing else is before it yet.`
  }
  return `Before the board: ${title}. No motion has been made.`
}

function core(state: MeetingState, scenario: Scenario): string {
  const top = topMotion(state.motionStack)

  switch (state.phase) {
    case 'PRE_MEETING':
      return 'The board is seated. The meeting has not been called to order.'

    case 'RECESS':
      return 'The board is in recess. Business is suspended until the chair calls it back.'

    case 'ADJOURNED':
      return 'The meeting stands adjourned. Nothing further is before the board.'

    case 'COLLAPSED':
      return 'The room is talking over itself. The chair no longer has the meeting.'

    case 'VOTING':
      return state.currentVote && !state.currentVote.announced
        ? 'The vote has been taken. The result has not been announced.'
        : 'The board is voting on the motion.'

    case 'DEBATE':
      return top ? `Debate is open on the motion: ${quoted(top)}.` : 'Debate is open.'

    case 'MOTION_PENDING':
    case 'ITEM_OPEN':
      // ITEM_OPEN with a live stack is not a state the reducer produces, but
      // describing the motion is the honest answer if it ever does.
      return top ? motionSentence(state, scenario, top) : itemSentence(state, scenario)
  }
}

function countKind(requests: Request[], kind: Request['kind']): number {
  return requests.filter((r) => r.kind === kind).length
}

/**
 * Short clauses for what the room is waiting on, most urgent first. Capped at
 * MAX_CLAUSES so the line stays a line: the floor strip lists every request in
 * full, and this is a summary, not an index.
 */
function clauses(state: MeetingState): string[] {
  const out: string[] = []
  const requests = state.pendingRequests

  if (countKind(requests, 'INTERRUPT') > 0) {
    out.push('Someone is speaking without being recognized.')
  }

  const points = countKind(requests, 'POINT_OF_ORDER')
  if (points === 1) out.push('A point of order is pending.')
  else if (points > 1) out.push(`${points} points of order are pending.`)

  const inquiries = countKind(requests, 'INQUIRY')
  if (inquiries === 1) out.push('A question is waiting for the chair.')
  else if (inquiries > 1) out.push(`${inquiries} questions are waiting for the chair.`)

  const hands = countKind(requests, 'RECOGNITION')
  if (hands === 1) out.push('One hand is up.')
  else if (hands > 1) out.push(`${hands} hands are up.`)

  return out.slice(0, MAX_CLAUSES)
}

/**
 * One or two short sentences describing where the meeting stands: the phase,
 * the item, the motion, and what the room is waiting on. Never advice.
 */
export function describeSituation(state: MeetingState, scenario: Scenario): string {
  const line = core(state, scenario)
  // A finished meeting is finished; nobody is waiting on anything any more.
  if (state.phase === 'ADJOURNED' || state.phase === 'COLLAPSED') return line
  return [line, ...clauses(state)].join(' ')
}
