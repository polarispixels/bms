// initMeeting + reduce: the chair half of the D4 turn loop.
//
// reduce is pure. It clones the incoming state once, mutates that private
// draft, and hands the draft back — the caller's state object is never
// touched. Every meter change goes through meters.applyDelta (D5 keys only,
// never a hand-rolled number) and every random choice through rng.ts against
// state.rngState, so the same scenario + seed + action sequence always
// produces the identical state and log.
//
// Turn loop (D4):
//   1. apply the chair's action, or its out-of-order consequence
//   2-3. roomRespond (Task 6; identity stub today)
//   4. collapse check
//   5. checkpoint capture at a boundary (D10)
//   6. turn++
//
// `state.turn` is the 1-based number of the turn being taken: initMeeting
// starts at turn 1, and after N actions turn === N + 1.

import type { Scenario } from '../content/schema'
import { legalActions } from './legality'
import { applyDelta } from './meters'
import { popMotion, pushMotion, topMotion } from './motions'
import { pickIndex } from './rng'
import { roomRespond } from './room'
import type {
  Action,
  Checkpoint,
  LegalityStatus,
  MeetingEvent,
  MeetingState,
  Member,
  MemberId,
  Motion,
  Request,
  VoteTally,
} from './types'

const CHECKPOINT_LOG_LIMIT = 20

// ---------------------------------------------------------------------------
// Draft helpers (the only place that mutates)
// ---------------------------------------------------------------------------

/**
 * Deep-copies the state so the reducer can work imperatively without ever
 * touching the caller's object. `checkpoints` is carried by reference — its
 * entries are frozen-by-convention snapshots and we only ever replace the
 * array (never push into it), so nothing shared is mutated.
 */
function beginDraft(state: MeetingState): MeetingState {
  const { checkpoints, ...rest } = state
  return { ...structuredClone(rest), checkpoints }
}

function emit(
  draft: MeetingState,
  type: MeetingEvent['type'],
  actor: MeetingEvent['actor'],
  intent: string,
  payload: Record<string, unknown> = {},
): void {
  draft.log.push({ id: `e${draft.log.length + 1}`, type, actor, intent, payload })
}

function presentMembers(draft: MeetingState): Member[] {
  return draft.members.filter((m) => m.present)
}

function memberName(draft: MeetingState, id: MemberId): string {
  return draft.members.find((m) => m.id === id)?.name ?? id
}

/** Picks a present member with the seeded RNG, advancing draft.rngState. */
function pickPresentMember(draft: MeetingState): Member | null {
  const present = presentMembers(draft)
  if (present.length === 0) return null
  const { index, rngState } = pickIndex(draft.rngState, present.length)
  draft.rngState = rngState
  return present[index]
}

function dropRequest(draft: MeetingState, id: string): void {
  draft.pendingRequests = draft.pendingRequests.filter((r) => r.id !== id)
}

function currentItemTitle(draft: MeetingState): string {
  return draft.agenda[draft.currentItem]?.title ?? 'the current item'
}

// ---------------------------------------------------------------------------
// Checkpoints (D10 capture; restore lands in Task 6's checkpoints.ts)
// ---------------------------------------------------------------------------

function captureCheckpoint(draft: MeetingState, label: string): void {
  const { checkpoints: _ignored, ...rest } = draft
  const snapshot: MeetingState = { ...structuredClone(rest), checkpoints: [] }
  snapshot.log = snapshot.log.slice(-CHECKPOINT_LOG_LIMIT)
  const entry: Checkpoint = {
    id: `cp${draft.checkpoints.length + 1}`,
    label,
    turn: draft.turn,
    state: snapshot,
  }
  draft.checkpoints = [...draft.checkpoints, entry]
}

// ---------------------------------------------------------------------------
// initMeeting
// ---------------------------------------------------------------------------

export function initMeeting(scenario: Scenario, seed: number): MeetingState {
  const present = new Set(scenario.present)
  const members: Member[] = scenario.members.map((m) => ({
    id: m.id,
    name: m.name,
    archetype: m.archetype,
    present: present.has(m.id),
  }))

  const memberMood: MeetingState['memberMood'] = {}
  for (const member of members) {
    memberMood[member.id] = { impatience: 0, timesRecognized: 0 }
  }

  const state: MeetingState = {
    agenda: structuredClone(scenario.agenda),
    currentItem: 0,
    quorumPresent: scenario.present.length >= scenario.quorum,
    members,
    floorHolder: null,
    motionStack: [],
    pendingRequests: [],
    phase: 'PRE_MEETING',
    meters: { control: 70, trust: 70 },
    turn: 1,
    log: [],

    rngState: seed,
    meterLog: [],
    checkpoints: [],
    currentVote: null,
    consecutiveWaits: 0,
    memberMood,
    outOfOrderCount: 0,
    itemsCompleted: 0,
  }

  const presentCount = members.filter((m) => m.present).length
  emit(state, 'NARRATION', 'SYSTEM', 'MEETING_SETTING', {
    title: scenario.title,
    body: scenario.body,
    presentCount,
    seats: scenario.seats,
  })
  emit(state, 'NARRATION', 'CLERK', state.quorumPresent ? 'QUORUM_PRESENT' : 'NO_QUORUM', {
    presentCount,
    quorum: scenario.quorum,
  })
  emit(state, 'NARRATION', 'SYSTEM', 'AWAITING_CALL_TO_ORDER', { itemTitle: scenario.agenda[0]?.title ?? '' })

  return state
}

// ---------------------------------------------------------------------------
// latestEvents (D1)
// ---------------------------------------------------------------------------

export function latestEvents(prev: MeetingState, next: MeetingState): MeetingEvent[] {
  return next.log.slice(prev.log.length)
}

// ---------------------------------------------------------------------------
// Chair action handlers. Each runs on a private draft and is only reached when
// the action is IN_ORDER or RISKY for the current state.
// ---------------------------------------------------------------------------

function openItem(draft: MeetingState, index: number): void {
  draft.currentItem = index
  draft.phase = 'ITEM_OPEN'
  draft.floorHolder = null
  emit(draft, 'STATE_CHANGE', 'CHAIR', 'OPEN_ITEM', {
    itemIndex: index,
    itemTitle: draft.agenda[index]?.title ?? '',
    phase: 'ITEM_OPEN',
  })
  emit(draft, 'NARRATION', 'CLERK', 'READ_ITEM', {
    itemNumber: index + 1,
    itemTitle: draft.agenda[index]?.title ?? '',
  })
}

/** Returns the index of a newly opened item, or null when none was opened. */
function applyCallItem(draft: MeetingState): number | null {
  if (draft.phase === 'PRE_MEETING') {
    emit(draft, 'STATE_CHANGE', 'CHAIR', 'CALL_TO_ORDER', { itemTitle: draft.agenda[0]?.title ?? '' })
    openItem(draft, 0)
    return 0
  }

  if (draft.phase === 'RECESS') {
    // MVP: resume at ITEM_OPEN on the current item; the motion stack survives.
    draft.phase = 'ITEM_OPEN'
    emit(draft, 'STATE_CHANGE', 'CHAIR', 'RESUME_FROM_RECESS', {
      itemTitle: currentItemTitle(draft),
      phase: 'ITEM_OPEN',
    })
    return null
  }

  // ITEM_OPEN with the current item resolved: advance.
  const next = draft.currentItem + 1
  if (next >= draft.agenda.length) {
    emit(draft, 'NARRATION', 'CLERK', 'AGENDA_COMPLETE', {})
    return null
  }
  openItem(draft, next)
  return next
}

function speechIntentFor(purpose: Request['purpose']): string {
  switch (purpose) {
    case 'DEBATE_FOR':
      return 'DEBATE_FOR'
    case 'DEBATE_AGAINST':
      return 'DEBATE_AGAINST'
    default:
      return 'COMMENT'
  }
}

/** Authored stances for a motion, used as the motion's ballot when it is moved. */
function stancesFor(scenario: Scenario, motionId: string): Record<MemberId, 'AYE' | 'NO' | 'ABSTAIN'> {
  const votes: Record<MemberId, 'AYE' | 'NO' | 'ABSTAIN'> = {}
  for (const member of scenario.members) {
    const stance = member.stances[motionId]
    if (stance) votes[member.id] = stance
  }
  return votes
}

function applyMove(draft: MeetingState, request: Request, scenario: Scenario): void {
  const spec = request.motion
  if (!spec) {
    draft.floorHolder = null
    emit(draft, 'SPEECH', request.member, 'DEMUR', { memberName: memberName(draft, request.member) })
    return
  }

  const blocked =
    draft.motionStack.length >= 3 ||
    (spec.kind === 'MAIN' && draft.motionStack.length > 0) ||
    (spec.kind === 'AMEND' && draft.motionStack.length === 0)

  if (blocked) {
    // A second main motion (or a groundless amendment) is simply not in order;
    // the reducer never inserts one behind the pending business.
    draft.floorHolder = null
    emit(draft, 'SPEECH', request.member, 'MOVE_OUT_OF_ORDER', {
      memberName: memberName(draft, request.member),
      motionText: spec.text,
    })
    return
  }

  const motion: Motion = {
    ...spec,
    votes: { ...stancesFor(scenario, spec.id), ...spec.votes },
    seconded: false,
    secondedBy: null,
    statedByChair: false,
    debateSpeeches: 0,
  }
  draft.motionStack = pushMotion(draft.motionStack, motion)
  draft.phase = 'MOTION_PENDING'
  draft.floorHolder = null // a motion awaiting a second leaves nobody holding the floor

  emit(draft, 'SPEECH', request.member, 'MOVE', {
    memberName: memberName(draft, request.member),
    motionText: motion.text,
  })
  emit(draft, 'STATE_CHANGE', 'CHAIR', 'MOTION_MOVED', {
    motionId: motion.id,
    motionText: motion.text,
    phase: 'MOTION_PENDING',
  })
}

function applySecond(draft: MeetingState, request: Request): void {
  const top = topMotion(draft.motionStack)
  if (!top || top.seconded) {
    emit(draft, 'SPEECH', request.member, 'DEMUR', { memberName: memberName(draft, request.member) })
    return
  }
  top.seconded = true
  top.secondedBy = request.member
  emit(draft, 'SPEECH', request.member, 'SECOND', {
    memberName: memberName(draft, request.member),
    motionText: top.text,
  })
}

function applyRecognize(draft: MeetingState, target: MemberId, scenario: Scenario): MeetingState {
  const member = draft.members.find((m) => m.id === target && m.present)
  if (!member) {
    emit(draft, 'NARRATION', 'SYSTEM', 'RECOGNIZE_NOBODY', { memberId: target })
    return draft
  }

  const request = draft.pendingRequests.find(
    (r) => r.member === target && (r.kind === 'RECOGNITION' || r.kind === 'INTERRUPT'),
  )

  // Jumping the queue: someone else has been waiting at least two turns longer
  // than the member being called on (D5 SELECTIVE_RECOGNITION).
  const reference = request ? request.createdTurn : draft.turn
  const jumped = draft.pendingRequests.some(
    (r) =>
      r.member !== target &&
      (r.kind === 'RECOGNITION' || r.kind === 'INTERRUPT') &&
      r.createdTurn <= reference - 2,
  )
  const next = jumped ? applyDelta(draft, 'SELECTIVE_RECOGNITION') : draft

  if (!request) {
    emit(next, 'SPEECH', target, 'DEMUR', { memberName: member.name })
    return next
  }

  next.floorHolder = target
  next.memberMood[target] = {
    impatience: next.memberMood[target]?.impatience ?? 0,
    timesRecognized: (next.memberMood[target]?.timesRecognized ?? 0) + 1,
  }
  dropRequest(next, request.id)

  if (request.kind === 'INTERRUPT') {
    // Legitimising an outburst: it becomes a speech, with no control recovery.
    emit(next, 'SPEECH', target, 'INTERRUPT_LEGITIMIZED', { memberName: member.name })
    return next
  }

  switch (request.purpose) {
    case 'MOVE':
      applyMove(next, request, scenario)
      return next
    case 'SECOND':
      applySecond(next, request)
      next.floorHolder = null
      return next
    default: {
      const top = topMotion(next.motionStack)
      emit(next, 'SPEECH', target, speechIntentFor(request.purpose), {
        memberName: member.name,
        motionText: top?.text ?? '',
      })
      if (top) top.debateSpeeches += 1
      next.floorHolder = null
      return next
    }
  }
}

function applyStateMotion(draft: MeetingState): void {
  const top = topMotion(draft.motionStack)
  if (!top) {
    emit(draft, 'NARRATION', 'SYSTEM', 'NO_MOTION', {})
    return
  }
  top.statedByChair = true
  draft.phase = 'DEBATE'
  emit(draft, 'STATE_CHANGE', 'CHAIR', 'STATE_MOTION', {
    motionId: top.id,
    motionText: top.text,
    phase: 'DEBATE',
  })
}

function tally(draft: MeetingState, motion: Motion, method: VoteTally['method']): VoteTally {
  let ayes = 0
  let noes = 0
  let abstains = 0
  for (const member of presentMembers(draft)) {
    // A present member with no authored stance sits on their hands.
    const vote = motion.votes[member.id] ?? 'ABSTAIN'
    if (vote === 'AYE') ayes += 1
    else if (vote === 'NO') noes += 1
    else abstains += 1
  }
  return { method, ayes, noes, abstains, passed: ayes > noes, motionId: motion.id, announced: false }
}

function applyCallVote(draft: MeetingState, method: VoteTally['method']): MeetingState {
  const top = topMotion(draft.motionStack)
  if (!top) {
    emit(draft, 'NARRATION', 'SYSTEM', 'NO_MOTION', {})
    return draft
  }

  // RISKY case: members are still waiting to debate (D5 CUT_OFF_DEBATE).
  let next = draft
  if (next.pendingRequests.some((r) => r.kind === 'RECOGNITION')) {
    next = applyDelta(next, 'CUT_OFF_DEBATE')
  }

  next.currentVote = tally(next, top, method)
  next.phase = 'VOTING'
  next.floorHolder = null

  emit(next, 'STATE_CHANGE', 'CHAIR', 'VOTE_TAKEN', {
    motionId: top.id,
    motionText: top.text,
    method,
    ayes: next.currentVote.ayes,
    noes: next.currentVote.noes,
    abstains: next.currentVote.abstains,
    turn: next.turn,
  })
  emit(next, 'NARRATION', 'CLERK', method === 'ROLL_CALL' ? 'ROLL_CALL_VOTE' : 'VOICE_VOTE', {
    motionText: top.text,
    ayes: next.currentVote.ayes,
    noes: next.currentVote.noes,
    abstains: next.currentVote.abstains,
  })
  return next
}

/** Turn on which the pending vote was taken, read back from its own event. */
function voteTurn(draft: MeetingState, motionId: string): number | null {
  for (let i = draft.log.length - 1; i >= 0; i -= 1) {
    const event = draft.log[i]
    if (event.intent === 'VOTE_TAKEN' && event.payload.motionId === motionId) {
      const turn = event.payload.turn
      return typeof turn === 'number' ? turn : null
    }
  }
  return null
}

function applyAnnounceResult(draft: MeetingState): MeetingState {
  const vote = draft.currentVote
  if (!vote || draft.motionStack.length === 0) {
    emit(draft, 'NARRATION', 'SYSTEM', 'NO_MOTION', {})
    return draft
  }

  const { stack, popped } = popMotion(draft.motionStack)
  draft.motionStack = stack
  draft.currentVote = { ...vote, announced: true }
  draft.floorHolder = null

  emit(draft, 'VOTE_RESULT', 'CHAIR', 'ANNOUNCE_RESULT', {
    motionId: popped.id,
    motionText: popped.text,
    ayes: vote.ayes,
    noes: vote.noes,
    abstains: vote.abstains,
    passed: vote.passed,
    result: vote.passed ? 'carried' : 'lost',
  })

  let next = draft
  const taken = voteTurn(next, popped.id)
  const prompt = taken === null || next.turn - taken <= 1
  if (popped.statedByChair && prompt) {
    next = applyDelta(next, 'CLEAN_PROCEDURE_BONUS')
  }

  if (next.motionStack.length === 0) {
    next.itemsCompleted += 1
    next.phase = 'ITEM_OPEN'
    emit(next, 'STATE_CHANGE', 'CHAIR', 'ITEM_RESOLVED', {
      itemIndex: next.currentItem,
      itemTitle: currentItemTitle(next),
      phase: 'ITEM_OPEN',
    })
  } else {
    // An amendment came off the top; the underlying motion is live again.
    next.phase = topMotion(next.motionStack)?.statedByChair ? 'DEBATE' : 'MOTION_PENDING'
  }
  return next
}

function applyRule(
  draft: MeetingState,
  target: string,
  ruling: 'WELL_TAKEN' | 'NOT_WELL_TAKEN',
): MeetingState {
  const request = draft.pendingRequests.find((r) => r.id === target && r.kind === 'POINT_OF_ORDER')
  if (!request) {
    emit(draft, 'NARRATION', 'SYSTEM', 'NOTHING_TO_RULE', { requestId: target })
    return draft
  }

  dropRequest(draft, request.id)
  emit(draft, 'SPEECH', 'CHAIR', ruling === 'WELL_TAKEN' ? 'RULE_WELL_TAKEN' : 'RULE_NOT_WELL_TAKEN', {
    memberName: memberName(draft, request.member),
    claim: request.claim ?? '',
    ruling,
  })

  const valid = request.valid === true
  const agrees = (ruling === 'WELL_TAKEN') === valid
  if (agrees) return applyDelta(draft, 'CORRECT_RULING')
  if (ruling === 'NOT_WELL_TAKEN') return applyDelta(draft, 'INVALID_RULING')
  return applyDelta(draft, 'TECHNICALITY_RULING')
}

function applyAnswerInquiry(draft: MeetingState, target: string, answerId: string): MeetingState {
  const request = draft.pendingRequests.find((r) => r.id === target && r.kind === 'INQUIRY')
  if (!request) {
    emit(draft, 'NARRATION', 'SYSTEM', 'NOTHING_TO_ANSWER', { requestId: target })
    return draft
  }

  const answer = request.answers?.find((a) => a.id === answerId)
  dropRequest(draft, request.id)
  emit(draft, 'SPEECH', 'CHAIR', 'ANSWER_INQUIRY', {
    memberName: memberName(draft, request.member),
    question: request.question ?? '',
    answerText: answer?.text ?? '',
  })

  // An answer the chair cannot even produce is not a right answer.
  return answer?.correct === true ? draft : applyDelta(draft, 'WRONG_INQUIRY_ANSWER')
}

function applyGavel(draft: MeetingState): MeetingState {
  const interrupts = draft.pendingRequests.filter((r) => r.kind === 'INTERRUPT')
  if (interrupts.length > 0) {
    draft.pendingRequests = draft.pendingRequests.filter((r) => r.kind !== 'INTERRUPT')
    emit(draft, 'STATE_CHANGE', 'CHAIR', 'GAVEL_ORDER', { cleared: interrupts.length })
    return applyDelta(draft, 'GAVEL_RESTORES_ORDER')
  }
  emit(draft, 'NARRATION', 'CHAIR', 'GAVEL_QUIET', {})
  return applyDelta(draft, 'GAVEL_QUIET_ROOM')
}

function applyRecess(draft: MeetingState, minutes: number): MeetingState {
  const breather = draft.meters.control < 40
  draft.phase = 'RECESS'
  draft.floorHolder = null
  emit(draft, 'STATE_CHANGE', 'CHAIR', 'RECESS', { minutes, phase: 'RECESS' })

  if (!breather) return applyDelta(draft, 'RECESS_STALL')

  for (const id of Object.keys(draft.memberMood)) {
    draft.memberMood[id] = { ...draft.memberMood[id], impatience: 0 }
  }
  return applyDelta(draft, 'RECESS_BREATHER')
}

function applyAdjourn(draft: MeetingState): MeetingState {
  const businessRemains = draft.itemsCompleted < draft.agenda.length
  draft.phase = 'ADJOURNED'
  draft.floorHolder = null
  emit(draft, 'STATE_CHANGE', 'CHAIR', 'ADJOURN', { itemsCompleted: draft.itemsCompleted })
  emit(draft, 'NARRATION', 'CLERK', 'MEETING_ADJOURNED', {})
  return businessRemains ? applyDelta(draft, 'PREMATURE_ADJOURN') : draft
}

function applyWait(draft: MeetingState): MeetingState {
  emit(draft, 'NARRATION', 'CHAIR', 'CHAIR_WAITS', {})
  return draft.pendingRequests.length > 0 ? applyDelta(draft, 'HESITATION') : draft
}

function applyOutOfOrder(draft: MeetingState, action: Action): MeetingState {
  const next = applyDelta(draft, 'OUT_OF_ORDER_ACTION')
  next.outOfOrderCount += 1
  const confused = pickPresentMember(next)
  if (confused) {
    emit(next, 'SPEECH', confused.id, 'CONFUSION', {
      memberName: confused.name,
      verb: action.verb,
    })
  }
  return next
}

// ---------------------------------------------------------------------------
// reduce
// ---------------------------------------------------------------------------

function applyChairAction(
  draft: MeetingState,
  action: Action,
  scenario: Scenario,
): { draft: MeetingState; openedItem: number | null } {
  switch (action.verb) {
    case 'CALL_ITEM':
      return { draft, openedItem: applyCallItem(draft) }
    case 'RECOGNIZE':
      return { draft: applyRecognize(draft, action.target, scenario), openedItem: null }
    case 'STATE_MOTION':
      applyStateMotion(draft)
      return { draft, openedItem: null }
    case 'RULE':
      return { draft: applyRule(draft, action.target, action.ruling), openedItem: null }
    case 'ANSWER_INQUIRY':
      return { draft: applyAnswerInquiry(draft, action.target, action.answer), openedItem: null }
    case 'CALL_VOTE':
      return { draft: applyCallVote(draft, action.method), openedItem: null }
    case 'ANNOUNCE_RESULT':
      return { draft: applyAnnounceResult(draft), openedItem: null }
    case 'GAVEL':
      return { draft: applyGavel(draft), openedItem: null }
    case 'RECESS':
      return { draft: applyRecess(draft, action.minutes), openedItem: null }
    case 'ADJOURN':
      return { draft: applyAdjourn(draft), openedItem: null }
    case 'WAIT':
      return { draft: applyWait(draft), openedItem: null }
  }
}

function applyCollapse(draft: MeetingState): void {
  draft.phase = 'COLLAPSED'
  draft.floorHolder = null
  emit(draft, 'NARRATION', 'AUDIENCE', 'ROOM_TALKS_OVER_CHAIR', {})
  emit(draft, 'INTERRUPT', 'AUDIENCE', 'MOTION_DIES', {
    motionText: topMotion(draft.motionStack)?.text ?? '',
  })
  emit(draft, 'NARRATION', 'SYSTEM', 'GAVEL_IGNORED', {})
}

export function reduce(state: MeetingState, action: Action, scenario: Scenario): MeetingState {
  // A finished meeting absorbs everything (D1).
  if (state.phase === 'ADJOURNED' || state.phase === 'COLLAPSED') {
    const draft = beginDraft(state)
    emit(draft, 'NARRATION', 'SYSTEM', 'MEETING_OVER', {})
    return draft
  }

  const status: LegalityStatus = legalActions(state, scenario).verbs[action.verb].status
  let draft = beginDraft(state)

  // (5a) D10: the pre-vote snapshot is taken before the vote is applied.
  if (action.verb === 'CALL_VOTE' && status !== 'OUT_OF_ORDER') {
    captureCheckpoint(draft, `Before the vote on ${topMotion(draft.motionStack)?.text ?? currentItemTitle(draft)}`)
  }

  // (1) chair action, or its consequence. WAIT is the one verb that never
  // "acts", but it still carries the hesitation cost.
  let openedItem: number | null = null
  if (status === 'OUT_OF_ORDER') {
    draft = applyOutOfOrder(draft, action)
  } else {
    const applied = applyChairAction(draft, action, scenario)
    draft = applied.draft
    openedItem = applied.openedItem
  }
  draft.consecutiveWaits = action.verb === 'WAIT' ? draft.consecutiveWaits + 1 : 0

  // (2)-(3) the room reacts (Task 6).
  draft = roomRespond(draft, scenario)

  // (4) collapse check.
  const terminal = draft.phase === 'ADJOURNED' || draft.phase === 'COLLAPSED'
  if (draft.meters.control <= 0 && !terminal) {
    applyCollapse(draft)
  }

  // (5b) D10: a new agenda item is a checkpoint boundary.
  if (openedItem !== null && draft.phase !== 'COLLAPSED') {
    captureCheckpoint(draft, `Item ${openedItem + 1}: ${draft.agenda[openedItem]?.title ?? ''} opened`)
  }

  // (6)
  draft.turn += 1
  return draft
}
