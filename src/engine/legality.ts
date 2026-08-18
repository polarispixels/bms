// legalActions: pure function over the D3 legality matrix (verb x phase),
// plus the overrides listed below the table in design-decisions.md.
//
// Encodes D3 exactly:
//   - the base verb x phase grid
//   - no-quorum override (everything O except WAIT, RECESS(R), ADJOURN(I), GAVEL(R))
//   - CALL_VOTE in DEBATE with an unstated motion -> O (the "never-stated motion" trap)
//   - binding clarification (supersedes the bare grid): STATE_MOTION is IN_ORDER
//     in MOTION_PENDING only when the top motion is seconded
//
// `why` strings are original prose (never RONR text), shown as Learn-mode
// tooltips only (D2).

import type { Scenario } from '../content/schema'
import { topMotion } from './motions'
import type { Action, LegalityReport, LegalityStatus, MeetingState, Request } from './types'

type VerbReport = { status: LegalityStatus; why: string }
type Verb = Action['verb']

function inOrder(why: string): VerbReport {
  return { status: 'IN_ORDER', why }
}
function outOfOrder(why: string): VerbReport {
  return { status: 'OUT_OF_ORDER', why }
}
function risky(why: string): VerbReport {
  return { status: 'RISKY', why }
}

function isTerminal(state: MeetingState): boolean {
  return state.phase === 'ADJOURNED' || state.phase === 'COLLAPSED'
}

const TERMINAL_WHY = 'The meeting is over.'

function hasPending(state: MeetingState, kind: Request['kind']): boolean {
  return state.pendingRequests.some((r) => r.kind === kind)
}

// ---------------------------------------------------------------------------
// Per-verb base logic. Each assumes the meeting is active (not terminal) and
// quorum is present -- both are handled by the caller before these run.
// ---------------------------------------------------------------------------

function callItemStatus(state: MeetingState): VerbReport {
  switch (state.phase) {
    case 'PRE_MEETING':
      return inOrder('Calling the meeting to order and opening the first agenda item.')
    case 'ITEM_OPEN': {
      const resolved = state.itemsCompleted > state.currentItem
      return resolved
        ? inOrder('This item is finished; open the next one.')
        : outOfOrder('This item still has unfinished business; you cannot skip ahead.')
    }
    case 'RECESS':
      return inOrder('Resuming the meeting after recess.')
    case 'MOTION_PENDING':
    case 'DEBATE':
    case 'VOTING':
      return outOfOrder('There is a motion on the floor; finish it before opening a new item.')
    default:
      return outOfOrder(TERMINAL_WHY)
  }
}

function recognizeStatus(state: MeetingState): VerbReport {
  switch (state.phase) {
    case 'PRE_MEETING':
      return outOfOrder('The meeting has not been called to order yet.')
    case 'ITEM_OPEN':
    case 'MOTION_PENDING':
    case 'DEBATE':
      return inOrder('Recognizing a member to speak or move business.')
    case 'VOTING':
      return outOfOrder('A vote is underway; recognition is not in order.')
    case 'RECESS':
      return outOfOrder('The room is in recess.')
    default:
      return outOfOrder(TERMINAL_WHY)
  }
}

function stateMotionStatus(state: MeetingState): VerbReport {
  switch (state.phase) {
    case 'PRE_MEETING':
      return outOfOrder('The meeting has not been called to order yet.')
    case 'ITEM_OPEN':
      return outOfOrder('No motion has been moved yet.')
    case 'MOTION_PENDING': {
      const top = topMotion(state.motionStack)
      if (!top) return outOfOrder('There is no motion on the floor to state.')
      return top.seconded
        ? inOrder('Stating the pending motion for the room.')
        : outOfOrder('The motion has not been seconded.')
    }
    case 'DEBATE':
      return risky("That motion has already been stated; this would just restate it.")
    case 'VOTING':
      return outOfOrder('A vote is underway; there is nothing new to state.')
    case 'RECESS':
      return outOfOrder('The room is in recess.')
    default:
      return outOfOrder(TERMINAL_WHY)
  }
}

function ruleStatus(state: MeetingState): VerbReport {
  return hasPending(state, 'POINT_OF_ORDER')
    ? inOrder('Ruling on the pending point of order.')
    : outOfOrder('There is no point of order pending to rule on.')
}

function answerInquiryStatus(state: MeetingState): VerbReport {
  return hasPending(state, 'INQUIRY')
    ? inOrder('Answering the pending inquiry.')
    : outOfOrder('There is no inquiry pending to answer.')
}

function callVoteStatus(state: MeetingState): VerbReport {
  switch (state.phase) {
    case 'PRE_MEETING':
      return outOfOrder('The meeting has not been called to order yet.')
    case 'ITEM_OPEN':
      return outOfOrder('No motion is on the floor to vote on.')
    case 'MOTION_PENDING':
      return outOfOrder('The motion has not been stated and seconded yet.')
    case 'DEBATE': {
      const top = topMotion(state.motionStack)
      if (!top || !top.statedByChair) {
        return outOfOrder('The motion was never properly stated; you cannot vote on it.')
      }
      return hasPending(state, 'RECOGNITION')
        ? risky('Members are still waiting to be recognized to debate.')
        : inOrder('Calling for the vote.')
    }
    case 'VOTING':
      return outOfOrder('A vote is already underway.')
    case 'RECESS':
      return outOfOrder('The room is in recess.')
    default:
      return outOfOrder(TERMINAL_WHY)
  }
}

function announceResultStatus(state: MeetingState): VerbReport {
  return state.phase === 'VOTING'
    ? inOrder('Announcing the vote result.')
    : outOfOrder('There is no vote in progress to announce.')
}

function gavelStatus(state: MeetingState): VerbReport {
  switch (state.phase) {
    case 'PRE_MEETING':
    case 'ITEM_OPEN':
    case 'MOTION_PENDING':
    case 'DEBATE':
    case 'VOTING':
      return hasPending(state, 'INTERRUPT')
        ? inOrder('Restoring order over an interruption.')
        : risky('Gaveling a quiet room draws attention for no reason.')
    case 'RECESS':
      return outOfOrder('Already in recess; there is nothing to gavel.')
    default:
      return outOfOrder(TERMINAL_WHY)
  }
}

function recessStatus(state: MeetingState): VerbReport {
  switch (state.phase) {
    case 'PRE_MEETING':
    case 'ITEM_OPEN':
    case 'MOTION_PENDING':
    case 'DEBATE':
      return risky('Calling a recess here is unusual, though not forbidden.')
    case 'VOTING':
      return outOfOrder('A vote is underway; recess cannot start mid-vote.')
    case 'RECESS':
      return outOfOrder('The room is already in recess.')
    default:
      return outOfOrder(TERMINAL_WHY)
  }
}

function adjournStatus(state: MeetingState): VerbReport {
  switch (state.phase) {
    case 'PRE_MEETING':
      return risky('Adjourning before anything has happened.')
    case 'ITEM_OPEN': {
      const allDone = state.itemsCompleted >= state.agenda.length
      return allDone
        ? inOrder('All agenda business is finished; adjourning is in order.')
        : risky('There is still business on the agenda.')
    }
    case 'MOTION_PENDING':
    case 'DEBATE':
    case 'VOTING':
      return outOfOrder('There is a motion in play; adjourn after it is resolved.')
    case 'RECESS':
      return outOfOrder('The room is in recess; resume before adjourning.')
    default:
      return outOfOrder(TERMINAL_WHY)
  }
}

function waitStatus(): VerbReport {
  return inOrder('Passing the turn without acting.')
}

// ---------------------------------------------------------------------------
// No-quorum override
// ---------------------------------------------------------------------------

function noQuorumStatus(verb: Verb): VerbReport {
  switch (verb) {
    case 'WAIT':
      return inOrder('Waiting is always fine, quorum or not.')
    case 'RECESS':
      return risky('Without quorum, recessing is the safe move.')
    case 'ADJOURN':
      return inOrder('Without quorum there is no business to conduct; adjourn.')
    case 'GAVEL':
      return risky('Gaveling without quorum does not restore an order that never existed.')
    default:
      return outOfOrder('There is no quorum present.')
  }
}

function computeVerbs(state: MeetingState): LegalityReport['verbs'] {
  const base: LegalityReport['verbs'] = {
    CALL_ITEM: callItemStatus(state),
    RECOGNIZE: recognizeStatus(state),
    STATE_MOTION: stateMotionStatus(state),
    RULE: ruleStatus(state),
    ANSWER_INQUIRY: answerInquiryStatus(state),
    CALL_VOTE: callVoteStatus(state),
    ANNOUNCE_RESULT: announceResultStatus(state),
    GAVEL: gavelStatus(state),
    RECESS: recessStatus(state),
    ADJOURN: adjournStatus(state),
    WAIT: waitStatus(),
  }

  if (isTerminal(state)) {
    const terminalReport = outOfOrder(TERMINAL_WHY)
    const verbs = {} as LegalityReport['verbs']
    for (const verb of Object.keys(base) as Verb[]) {
      verbs[verb] = terminalReport
    }
    return verbs
  }

  if (!state.quorumPresent) {
    const verbs = {} as LegalityReport['verbs']
    for (const verb of Object.keys(base) as Verb[]) {
      verbs[verb] = noQuorumStatus(verb)
    }
    return verbs
  }

  return base
}

// ---------------------------------------------------------------------------
// targets (D2)
// ---------------------------------------------------------------------------

function computeTargets(state: MeetingState): LegalityReport['targets'] {
  return {
    recognize: state.members.filter((m) => m.present).map((m) => m.id),
    rule: state.pendingRequests.filter((r) => r.kind === 'POINT_OF_ORDER').map((r) => r.id),
    answer: state.pendingRequests.filter((r) => r.kind === 'INQUIRY').map((r) => r.id),
  }
}

export function legalActions(state: MeetingState, _scenario: Scenario): LegalityReport {
  return {
    verbs: computeVerbs(state),
    targets: computeTargets(state),
  }
}
