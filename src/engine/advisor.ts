// suggestAction: a deterministic hint for a stuck chair.
//
// No AI, no randomness, no engine mutation — this reads a MeetingState and
// picks the single most useful next move, in a fixed priority order (playtest
// feedback: a first-time player got stuck with no way to ask "what do I do
// next?"). Every branch below is a rule, not a guess, so the same state always
// produces the same suggestion.
//
// Priority order (highest first):
//   1. VOTING              -> ANNOUNCE_RESULT
//   2. pending INTERRUPT   -> GAVEL
//   3. pending POINT_OF_ORDER (oldest) -> RULE, with the correct ruling
//   4. pending INQUIRY (oldest)        -> ANSWER_INQUIRY, with the correct answer
//   5. top motion seconded && !stated  -> STATE_MOTION
//   6. top motion on stack && !seconded -> WAIT (a second must come from the floor)
//   7. pending RECOGNITION (oldest)    -> RECOGNIZE
//   8. DEBATE with nothing pending     -> CALL_VOTE VOICE
//   9. all agenda items completed      -> ADJOURN
//      else PRE_MEETING, or ITEM_OPEN with the current item resolved -> CALL_ITEM
//  10. fallback -> WAIT
//
// Safety invariant: whatever branch fires, the suggested verb is re-checked
// against `legalActions` before it is returned. If it is not IN_ORDER (e.g. no
// quorum quietly turned CALL_ITEM into OUT_OF_ORDER), the suggestion falls back
// to WAIT instead — a hint must never tell the player to do something illegal.

import type { Scenario } from '../content/schema'
import { legalActions } from './legality'
import { topMotion } from './motions'
import type { Action, MeetingState, Request } from './types'

export type Suggestion = { action: Action; why: string }

const FALLBACK_WHY = 'Nothing is pressing right now. Wait and see what the room does.'

function oldest(requests: Request[]): Request {
  return requests.reduce((a, b) => (b.createdTurn < a.createdTurn ? b : a))
}

function computeSuggestion(state: MeetingState): Suggestion {
  if (state.phase === 'VOTING') {
    return {
      action: { verb: 'ANNOUNCE_RESULT' },
      why: 'The votes are counted. Announce the result before the room moves on without you.',
    }
  }

  const interrupt = state.pendingRequests.find((r) => r.kind === 'INTERRUPT')
  if (interrupt) {
    return {
      action: { verb: 'GAVEL' },
      why: "Someone's talking over the room. Bring the gavel down and reclaim it.",
    }
  }

  const points = state.pendingRequests.filter((r) => r.kind === 'POINT_OF_ORDER')
  if (points.length > 0) {
    const target = oldest(points)
    const valid = target.valid === true
    return valid
      ? {
          action: { verb: 'RULE', target: target.id, ruling: 'WELL_TAKEN' },
          why: 'That point holds up. Rule it well taken.',
        }
      : {
          action: { verb: 'RULE', target: target.id, ruling: 'NOT_WELL_TAKEN' },
          why: "That point doesn't hold up. Rule it not well taken.",
        }
  }

  const inquiries = state.pendingRequests.filter((r) => r.kind === 'INQUIRY')
  if (inquiries.length > 0) {
    const target = oldest(inquiries)
    const answers = target.answers ?? []
    const correct = answers.find((a) => a.correct) ?? answers[0]
    return {
      action: { verb: 'ANSWER_INQUIRY', target: target.id, answer: correct?.id ?? '' },
      why: "There's a real question waiting on a real answer. Give it before the room starts guessing.",
    }
  }

  const top = topMotion(state.motionStack)
  if (top && top.seconded && !top.statedByChair) {
    return {
      action: { verb: 'STATE_MOTION' },
      why: 'The motion has a second. State it so the room knows what it\'s debating.',
    }
  }
  if (top && !top.seconded) {
    return {
      action: { verb: 'WAIT' },
      why: 'Nothing for the chair to do yet — a second has to come from the floor.',
    }
  }

  const recognitions = state.pendingRequests.filter((r) => r.kind === 'RECOGNITION')
  if (recognitions.length > 0) {
    const target = oldest(recognitions)
    return {
      action: { verb: 'RECOGNIZE', target: target.member },
      // Points at the floor strip on purpose: the first version of this line
      // referred to a raised hand the interface never showed, and a playtester
      // went looking for it and found nothing.
      why: "A hand's been up a while — you'll see it above your actions. Recognize them before they give up on it.",
    }
  }

  if (state.phase === 'DEBATE' && state.pendingRequests.length === 0) {
    return {
      action: { verb: 'CALL_VOTE', method: 'VOICE' },
      why: "Debate has run its course and nobody's waiting on anything. Put it to a vote.",
    }
  }

  if (state.itemsCompleted >= state.agenda.length) {
    return {
      action: { verb: 'ADJOURN' },
      why: 'The agenda is finished. Adjourn and let everyone go home.',
    }
  }
  if (state.phase === 'PRE_MEETING') {
    return {
      action: { verb: 'CALL_ITEM' },
      why: 'Nothing is open yet. Call the item and get the meeting under way.',
    }
  }
  if (state.phase === 'ITEM_OPEN' && state.itemsCompleted > state.currentItem) {
    return {
      action: { verb: 'CALL_ITEM' },
      why: 'This item is settled. Call the next one.',
    }
  }

  return { action: { verb: 'WAIT' }, why: FALLBACK_WHY }
}

export function suggestAction(state: MeetingState, scenario: Scenario): Suggestion | null {
  if (state.phase === 'ADJOURNED' || state.phase === 'COLLAPSED') return null

  const raw = computeSuggestion(state)
  const report = legalActions(state, scenario)
  if (report.verbs[raw.action.verb].status !== 'IN_ORDER') {
    return { action: { verb: 'WAIT' }, why: FALLBACK_WHY }
  }
  return raw
}
