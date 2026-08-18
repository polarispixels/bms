// Room simulation: authored beats (D7) and archetype reactions (D6), plus the
// passive drains that make up step (3) of the D4 turn loop.
//
// `reduce` calls `roomRespond` once per turn, after the chair has acted and
// before the collapse check. Everything here is deterministic — no randomness
// decides *whether* an NPC acts, only which authored line renders later — and
// pure: the incoming state is cloned before anything is touched.
//
// Order within a turn (D4):
//   1. beats, in scenario order; each fires at most once, several may match
//   2. archetypes, in member-array order, with **at most one scene per turn**
//      so the transcript stays readable; a member who wanted the floor keeps
//      wanting it and acts on a later turn
//   3. passives: unaddressed interrupts drain, ignored requests time out
//
// What this file must NOT do: re-apply anything the chair reducer already
// charged. SELECTIVE_RECOGNITION (RECOGNIZE) and HESITATION (WAIT) belong to
// reducer.ts; charging them again here would double-bill the chair.

import type { Beat, Scenario } from '../content/schema'
import { beginDraft, emit, eventsThisTurn } from './draft'
import { applyDelta } from './meters'
import { topMotion } from './motions'
import type { MeetingState, Member, MemberId, Request, RoomSim } from './types'

/** Impatience at which the interrupter stops waiting for the chair (D6). */
const INTERRUPT_THRESHOLD = 3

/** Turns a moved motion may sit without a second before the stabilizer steps in. */
const UNSECONDED_GRACE = 2

/** Turns a motion may sit unstated before the stabilizer prompts the chair. */
const UNSTATED_GRACE = 3

/** Other members recognized ahead of the veteran before they give up (D6). */
const VETERAN_PATIENCE = 2

/** Turns any request may sit unaddressed before IGNORED_REQUEST_TIMEOUT (D5). */
const REQUEST_TIMEOUT = 3

/** Turns after a stabilizer rescue during which it may not rescue again (T9b). */
const STABILIZER_COOLDOWN = 2

/** Speech intents that mean a member was recognized to talk about the motion. */
const DEBATE_INTENTS: readonly string[] = ['DEBATE_FOR', 'DEBATE_AGAINST', 'COMMENT']

/** A fresh room: nothing has fired, nobody is mid-ramble. */
export function initialRoom(): RoomSim {
  return {
    firedBeats: [],
    veteranItems: [],
    veteranBaseline: null,
    enthusiastPendingPoint: false,
    drifting: null,
    timedOutRequests: [],
    stabilizerCooldownUntil: 0,
  }
}

/**
 * One turn's worth of room activity. `scene` records whether the turn's single
 * NPC scene has been spent — the pacing budget that keeps two archetypes from
 * talking over each other in the same beat of the transcript.
 */
type Turn = { draft: MeetingState; scene: boolean }

// ---------------------------------------------------------------------------
// Small readers over state
// ---------------------------------------------------------------------------

function memberName(state: MeetingState, id: MemberId): string {
  return state.members.find((m) => m.id === id)?.name ?? id
}

function motionText(state: MeetingState): string {
  return topMotion(state.motionStack)?.text ?? ''
}

/** Ids are drawn from the event counter, so they are unique and reproducible. */
function requestId(state: MeetingState): string {
  return `r${state.eventSeq}`
}

function hasPending(state: MeetingState, member: MemberId, kind: Request['kind']): boolean {
  return state.pendingRequests.some((r) => r.member === member && r.kind === kind)
}

/** The turn a motion was moved on, read back from its own event; null if unknown. */
function motionMovedTurn(state: MeetingState, motionId: string): number | null {
  for (let i = state.log.length - 1; i >= 0; i -= 1) {
    const event = state.log[i]
    if (event.intent === 'MOTION_MOVED' && event.payload.motionId === motionId) {
      const turn = event.payload.turn
      return typeof turn === 'number' ? turn : null
    }
  }
  return null
}

/** Everyone's recognition count right now, as a baseline to compare against later. */
function recognitionSnapshot(state: MeetingState): Record<MemberId, number> {
  const snapshot: Record<MemberId, number> = {}
  for (const [id, mood] of Object.entries(state.memberMood)) {
    snapshot[id] = mood.timesRecognized
  }
  return snapshot
}

/**
 * How many *distinct* members, other than `member`, have been recognized since
 * the baseline was taken. Counting members rather than recognitions is the
 * point: one member called on twice is one member who got in ahead of you.
 */
function membersRecognizedSince(
  state: MeetingState,
  baseline: Record<MemberId, number>,
  member: MemberId,
): number {
  return Object.entries(state.memberMood).filter(
    ([id, mood]) => id !== member && mood.timesRecognized > (baseline[id] ?? 0),
  ).length
}

function dropRequest(state: MeetingState, id: string): void {
  state.pendingRequests = state.pendingRequests.filter((r) => r.id !== id)
}

// ---------------------------------------------------------------------------
// (1) Beats — D7
// ---------------------------------------------------------------------------

/** The most recent thing the chair or the meeting itself did. */
function lastFrameIntent(state: MeetingState): string | null {
  for (let i = state.log.length - 1; i >= 0; i -= 1) {
    const event = state.log[i]
    if (event.actor === 'CHAIR' || event.actor === 'SYSTEM') return event.intent
  }
  return null
}

/**
 * Every condition the beat states must hold; unstated conditions do not care.
 *
 * `frameIntent` is read once, before any beat fires, so a beat that fires early
 * in the pass cannot change what a later beat sees: authors write `when`
 * against the chair's turn, not against each other.
 */
function matchesWhen(state: MeetingState, when: Beat['when'], frameIntent: string | null): boolean {
  if (when.phase !== undefined && state.phase !== when.phase) return false
  if (when.itemIndex !== undefined && state.currentItem !== when.itemIndex) return false
  if (when.turnGte !== undefined && state.turn < when.turnGte) return false
  if (when.motionOnStack !== undefined && state.motionStack.length > 0 !== when.motionOnStack) return false
  if (when.afterEventIntent !== undefined && frameIntent !== when.afterEventIntent) return false
  return true
}

/** The transcript line a newly filed request announces itself with. */
function requestIntent(kind: Request['kind']): { type: 'SPEECH' | 'INTERRUPT'; intent: string } {
  switch (kind) {
    case 'INTERRUPT':
      return { type: 'INTERRUPT', intent: 'INTERRUPT' }
    case 'POINT_OF_ORDER':
      return { type: 'SPEECH', intent: 'RAISE_POINT_OF_ORDER' }
    case 'INQUIRY':
      return { type: 'SPEECH', intent: 'RAISE_INQUIRY' }
    default:
      return { type: 'SPEECH', intent: 'SEEK_RECOGNITION' }
  }
}

function fileRequest(draft: MeetingState, request: Request, extraPayload: Record<string, unknown> = {}): void {
  const { type, intent } = requestIntent(request.kind)
  emit(draft, type, request.member, intent, {
    memberName: memberName(draft, request.member),
    motionText: motionText(draft),
    ...extraPayload,
  })
  draft.pendingRequests = [...draft.pendingRequests, request]
}

function applyBeat(draft: MeetingState, beat: Beat): void {
  const effect = beat.effect
  switch (effect.kind) {
    case 'REQUEST': {
      const request: Request = { ...effect.request, id: `beat-${beat.id}`, createdTurn: draft.turn }
      fileRequest(draft, request, { beatId: beat.id })
      return
    }
    case 'SECOND': {
      const top = topMotion(draft.motionStack)
      if (!top || top.seconded) return
      top.seconded = true
      top.secondedBy = effect.member
      emit(draft, 'SPEECH', effect.member, 'SECOND', {
        memberName: memberName(draft, effect.member),
        motionText: top.text,
      })
      return
    }
    case 'SPEECH':
      emit(draft, 'SPEECH', effect.member, effect.intent, {
        memberName: memberName(draft, effect.member),
        motionText: motionText(draft),
      })
      return
    case 'NARRATION':
      emit(draft, 'NARRATION', 'SYSTEM', effect.intent, {
        itemTitle: draft.agenda[draft.currentItem]?.title ?? '',
      })
  }
}

function runBeats(draft: MeetingState, scenario: Scenario): MeetingState {
  const frameIntent = lastFrameIntent(draft)
  for (const beat of scenario.beats) {
    if (draft.room.firedBeats.includes(beat.id)) continue
    if (!matchesWhen(draft, beat.when, frameIntent)) continue
    draft.room = { ...draft.room, firedBeats: [...draft.room.firedBeats, beat.id] }
    applyBeat(draft, beat)
  }
  return draft
}

// ---------------------------------------------------------------------------
// (2) Archetypes — D6
// ---------------------------------------------------------------------------

/**
 * A speech that ran long finishes on the next turn. This is the tail of a scene
 * the chair already started, so it takes the turn's scene budget: nobody else
 * gets to start something while the room is still listening to this one.
 */
function continueDriftingSpeech(turn: Turn): Turn {
  const drifting = turn.draft.room.drifting
  if (!drifting) return turn

  emit(turn.draft, 'SPEECH', drifting.member, 'SPEECH_CONTINUES', {
    memberName: memberName(turn.draft, drifting.member),
    motionText: motionText(turn.draft),
  })
  turn.draft.room = { ...turn.draft.room, drifting: null }
  return { draft: turn.draft, scene: true }
}

/**
 * A drifting commenter who was recognized this turn is still talking. Recorded
 * after the archetype pass so the continuation lands on the *next* turn, and
 * so the reducer's GAVEL can find it (a gavel here is CUT_OFF_RAMBLER).
 */
function noteDriftingSpeech(draft: MeetingState): MeetingState {
  if (draft.room.drifting) return draft
  const drifters = new Set(draft.members.filter((m) => m.archetype === 'DRIFTING_COMMENTER').map((m) => m.id))
  const speech = eventsThisTurn(draft).find(
    (e) => e.type === 'SPEECH' && drifters.has(e.actor) && DEBATE_INTENTS.includes(e.intent),
  )
  if (!speech) return draft
  draft.room = { ...draft.room, drifting: { member: speech.actor, startedTurn: draft.turn } }
  return draft
}

/**
 * Impatience is not a scene — it accrues every turn, for every interrupter.
 * Only the outburst itself costs the turn's scene, so a deferred interrupter
 * keeps their impatience and erupts on the next turn instead.
 */
function interrupter(turn: Turn, member: Member): Turn {
  const draft = turn.draft
  const mood = draft.memberMood[member.id] ?? { impatience: 0, timesRecognized: 0 }
  const chairWaited = draft.consecutiveWaits > 0
  const selfWaiting = draft.pendingRequests.some((r) => r.member === member.id)

  let impatience = mood.impatience
  if (chairWaited && selfWaiting) impatience += 2
  else if (chairWaited || draft.pendingRequests.length > 0) impatience += 1

  const erupts = impatience >= INTERRUPT_THRESHOLD && !turn.scene && !hasPending(draft, member.id, 'INTERRUPT')
  if (erupts) {
    emit(draft, 'INTERRUPT', member.id, 'INTERRUPT', {
      memberName: member.name,
      motionText: motionText(draft),
    })
    draft.pendingRequests = [
      ...draft.pendingRequests,
      { id: requestId(draft), kind: 'INTERRUPT', member: member.id, createdTurn: draft.turn },
    ]
    impatience = 0
  }

  draft.memberMood[member.id] = { ...mood, impatience }
  return { draft, scene: turn.scene || erupts }
}

/**
 * The chair's mistakes are this member's cue. Any out-of-order action charged
 * this turn — including calling a vote on a motion that was never stated —
 * earns a point of order that is, annoyingly, correct.
 *
 * An objection that cannot be voiced because the turn's scene is already spent
 * is *deferred, not dropped*: it waits in `room.enthusiastPendingPoint` and is
 * raised on the next turn with room for it. The one exception is a point of
 * theirs that is still pending — that objection already stands, so a second
 * one is neither filed nor queued.
 */
function rulesEnthusiast(turn: Turn, member: Member): Turn {
  const draft = turn.draft
  const chairErred = draft.meterLog.some((d) => d.turn === draft.turn && d.reason === 'OUT_OF_ORDER_ACTION')
  const wants = draft.room.enthusiastPendingPoint || chairErred
  if (!wants) return turn

  if (hasPending(draft, member.id, 'POINT_OF_ORDER')) {
    draft.room = { ...draft.room, enthusiastPendingPoint: false }
    return turn
  }
  if (turn.scene) {
    draft.room = { ...draft.room, enthusiastPendingPoint: true }
    return turn
  }

  draft.room = { ...draft.room, enthusiastPendingPoint: false }
  fileRequest(draft, {
    id: requestId(draft) + '-poo',
    kind: 'POINT_OF_ORDER',
    member: member.id,
    createdTurn: draft.turn,
    claim: 'That last step skipped a stage the rules require.',
    valid: true,
  })
  return { draft, scene: true }
}

/** Files for the floor the first time debate opens on an item authored as bait. */
function veteran(turn: Turn, member: Member): Turn {
  const draft = turn.draft
  if (turn.scene || draft.phase !== 'DEBATE') return turn

  const item = draft.agenda[draft.currentItem]
  if (!item?.veteranBait || draft.room.veteranItems.includes(item.id)) return turn

  fileRequest(draft, {
    id: requestId(draft) + '-vet',
    kind: 'RECOGNITION',
    member: member.id,
    createdTurn: draft.turn,
    purpose: 'COMMENT',
  })
  draft.room = {
    ...draft.room,
    veteranItems: [...draft.room.veteranItems, item.id],
    veteranBaseline: recognitionSnapshot(draft),
  }
  return { draft, scene: true }
}

/**
 * Fixes the chair's mess and makes everyone notice: every rescue costs control
 * (D5 STABILIZER_RESCUE), because the room just watched somebody else run the
 * meeting. Conditions are checked in escalating order and only one fires.
 *
 * A rescue also starts a 2-turn cooldown (T9b): back-to-back rescues used to
 * consume every turn's one NPC scene, so a pure stall never let any other
 * archetype (e.g. the interrupter) get a scene of their own. While on
 * cooldown the stabilizer sits out even if a rescue condition still holds.
 */
function stabilizer(turn: Turn, member: Member): Turn {
  let draft = turn.draft
  if (turn.scene) return turn
  if (draft.turn <= draft.room.stabilizerCooldownUntil) return turn

  const top = topMotion(draft.motionStack)
  const movedTurn = top ? motionMovedTurn(draft, top.id) : null
  const age = movedTurn === null ? null : draft.turn - movedTurn

  const stalled = draft.consecutiveWaits >= 2
  const unseconded = top !== null && !top.seconded && age !== null && age >= UNSECONDED_GRACE
  const unstated = top !== null && top.seconded && !top.statedByChair && age !== null && age >= UNSTATED_GRACE

  if (!stalled && !unseconded && !unstated) return turn

  if (unseconded && top) {
    top.seconded = true
    top.secondedBy = member.id
    emit(draft, 'SPEECH', member.id, 'SECOND', { memberName: member.name, motionText: top.text })
  } else {
    // Only the chair can state a motion or move the meeting along; the most a
    // member can do is say so out loud.
    emit(draft, 'SPEECH', member.id, unstated ? 'PROMPT_STATE_MOTION' : 'PROMPT_BUSINESS', {
      memberName: member.name,
      motionText: motionText(draft),
      itemTitle: draft.agenda[draft.currentItem]?.title ?? '',
    })
  }

  draft = applyDelta(draft, 'STABILIZER_RESCUE')
  draft.room = { ...draft.room, stabilizerCooldownUntil: draft.turn + STABILIZER_COOLDOWN }
  return { draft, scene: true }
}

function runArchetypes(draft: MeetingState): MeetingState {
  let turn: Turn = continueDriftingSpeech({ draft, scene: false })

  for (const member of turn.draft.members) {
    if (!member.present) continue
    switch (member.archetype) {
      case 'INTERRUPTER':
        turn = interrupter(turn, member)
        break
      case 'RULES_ENTHUSIAST':
        turn = rulesEnthusiast(turn, member)
        break
      case 'VETERAN':
        turn = veteran(turn, member)
        break
      case 'STABILIZER':
        turn = stabilizer(turn, member)
        break
      default:
        break
    }
  }

  return noteDriftingSpeech(turn.draft)
}

// ---------------------------------------------------------------------------
// (3) Passive effects — D4 step 3 / D5
// ---------------------------------------------------------------------------

function markTimedOut(draft: MeetingState, requestId_: string): void {
  draft.room = { ...draft.room, timedOutRequests: [...draft.room.timedOutRequests, requestId_] }
}

function withdraw(draft: MeetingState, request: Request): void {
  emit(draft, 'SPEECH', request.member, 'WITHDRAW_REQUEST', {
    memberName: memberName(draft, request.member),
  })
  dropRequest(draft, request.id)
}

/** An outburst nobody deals with keeps costing the chair the room (D5, −8/turn). */
function drainInterrupts(draft: MeetingState): MeetingState {
  // Only interrupts that have actually *sat* a turn drain: the one raised this
  // turn has not been ignored yet.
  const stale = draft.pendingRequests.filter((r) => r.kind === 'INTERRUPT' && r.createdTurn < draft.turn)
  if (stale.length === 0) return draft

  let next = draft
  for (let i = 0; i < stale.length; i += 1) {
    next = applyDelta(next, 'UNADDRESSED_INTERRUPT')
  }
  emit(next, 'NARRATION', 'AUDIENCE', 'ROOM_RESTLESS', { count: stale.length })
  return next
}

/**
 * Requests that have waited three turns cost trust once each (D5). The veteran
 * is the one member who then gives up and sits down — everyone else keeps
 * their hand in the air.
 */
function timeOutRequests(draft: MeetingState): MeetingState {
  let next = draft
  for (const request of [...next.pendingRequests]) {
    if (next.room.timedOutRequests.includes(request.id)) continue
    if (next.turn - request.createdTurn < REQUEST_TIMEOUT) continue

    next = applyDelta(next, 'IGNORED_REQUEST_TIMEOUT')
    markTimedOut(next, request.id)
    if (next.members.find((m) => m.id === request.member)?.archetype === 'VETERAN') {
      withdraw(next, request)
      next.room = { ...next.room, veteranBaseline: null }
    }
  }
  return next
}

/**
 * The veteran's own patience runs on who got the floor, not on turns: two
 * other *members* called on ahead of them and the story goes untold (D6).
 */
function timeOutVeteran(draft: MeetingState): MeetingState {
  const baseline = draft.room.veteranBaseline
  const veteranMember = draft.members.find((m) => m.archetype === 'VETERAN')
  if (baseline === null || !veteranMember) return draft

  const request = draft.pendingRequests.find((r) => r.member === veteranMember.id && r.kind === 'RECOGNITION')
  if (!request) {
    draft.room = { ...draft.room, veteranBaseline: null }
    return draft
  }
  if (membersRecognizedSince(draft, baseline, veteranMember.id) < VETERAN_PATIENCE) return draft

  let next = draft
  if (!next.room.timedOutRequests.includes(request.id)) {
    next = applyDelta(next, 'IGNORED_REQUEST_TIMEOUT')
    markTimedOut(next, request.id)
  }
  withdraw(next, request)
  next.room = { ...next.room, veteranBaseline: null }
  return next
}

function runPassives(draft: MeetingState): MeetingState {
  let next = drainInterrupts(draft)
  next = timeOutRequests(next)
  next = timeOutVeteran(next)
  return next
}

// ---------------------------------------------------------------------------
// roomRespond
// ---------------------------------------------------------------------------

/**
 * Steps (2)-(3) of the D4 turn loop: the room's half of the turn.
 *
 * A meeting that is over, or in recess, has no room to speak of — beats and
 * archetypes stay silent and nothing drains until business resumes.
 */
export function roomRespond(state: MeetingState, scenario: Scenario): MeetingState {
  if (state.phase === 'ADJOURNED' || state.phase === 'COLLAPSED' || state.phase === 'RECESS') return state

  let draft = beginDraft(state)
  draft = runBeats(draft, scenario)
  draft = runArchetypes(draft)
  draft = runPassives(draft)
  return draft
}
