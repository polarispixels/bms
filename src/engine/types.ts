// Core engine types. Zero React imports, no browser globals, no runtime deps.
//
// Spec §4.1-4.2 (docs/spec.md) define `Action`, `MeetingEvent`, and the core
// shape of `MeetingState` verbatim. Design decision D2
// (.superpowers/sdd/2026-08-17-order-mvp/design-decisions.md) extends
// `MeetingState` with engine-internal bookkeeping fields and adds the
// supporting types (`Motion`, `Request`, `MeterDelta`, `Checkpoint`,
// `VoteTally`, `LegalityReport`) referenced by those two.
//
// `AgendaItem` and `ScenarioMotion` live here (rather than in
// src/content/schema.ts, where D8 lists them) because `MeetingState.agenda`
// needs them and content/schema.ts needs `Phase` from this file — defining
// both directions would be a circular import. content/schema.ts re-exports
// them so downstream code can still import from either module.

export type MemberId = string
export type RequestId = string
export type AnswerId = string

// ---------------------------------------------------------------------------
// Spec §4.1 — Action objects (verbatim)
// ---------------------------------------------------------------------------

export type Action =
  | { verb: 'CALL_ITEM' }
  | { verb: 'RECOGNIZE'; target: MemberId }
  | { verb: 'STATE_MOTION' }
  | { verb: 'RULE'; target: RequestId; ruling: 'WELL_TAKEN' | 'NOT_WELL_TAKEN' }
  | { verb: 'ANSWER_INQUIRY'; target: RequestId; answer: AnswerId }
  | { verb: 'CALL_VOTE'; method: 'VOICE' | 'ROLL_CALL' }
  | { verb: 'ANNOUNCE_RESULT' }
  | { verb: 'GAVEL' }
  | { verb: 'RECESS'; minutes: number }
  | { verb: 'ADJOURN' }
  | { verb: 'WAIT' }

// ---------------------------------------------------------------------------
// Spec §4.1 — Event objects (verbatim)
// ---------------------------------------------------------------------------

export type MeetingEvent = {
  id: string
  type: 'SPEECH' | 'STATE_CHANGE' | 'INTERRUPT' | 'VOTE_RESULT' | 'NARRATION'
  actor: MemberId | 'CHAIR' | 'CLERK' | 'AUDIENCE' | 'SYSTEM'
  intent: string // e.g. 'MOVE_AMENDMENT', 'OBJECT_GERMANENESS'
  payload: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Archetypes (D6/D8) and runtime members
// ---------------------------------------------------------------------------

export type Archetype =
  | 'RULES_ENTHUSIAST'
  | 'VETERAN'
  | 'INTERRUPTER'
  | 'STABILIZER'
  | 'DRIFTING_COMMENTER'
  | 'NONE'

/** Runtime member on MeetingState (spec §4.2 `members: Member[]`, not otherwise defined). */
export type Member = {
  id: MemberId
  name: string
  archetype: Archetype
  present: boolean
}

// ---------------------------------------------------------------------------
// Agenda / motions (needed by MeetingState.agenda; re-exported from D8)
// ---------------------------------------------------------------------------

export type ScenarioMotion = { id: string; kind: 'MAIN' | 'AMEND'; text: string; germane: boolean }

export type AgendaItem = { id: string; title: string; veteranBait?: boolean; motions: ScenarioMotion[] }

// ---------------------------------------------------------------------------
// D2 — Motion, Request, and supporting record types
// ---------------------------------------------------------------------------

export type Motion = {
  id: string
  kind: 'MAIN' | 'AMEND'
  text: string // what was moved
  mover: MemberId
  seconded: boolean
  secondedBy: MemberId | null
  germane: boolean // authored; always true in Level 1
  statedByChair: boolean // chair must STATE_MOTION before debate
  debateSpeeches: number // completed speeches on this motion
  votes: Record<MemberId, 'AYE' | 'NO' | 'ABSTAIN'> // authored stances
}

export type Request = {
  id: RequestId
  kind: 'RECOGNITION' | 'POINT_OF_ORDER' | 'INQUIRY' | 'INTERRUPT'
  member: MemberId
  createdTurn: number
  // RECOGNITION: what the member will do if recognized
  purpose?: 'MOVE' | 'SECOND' | 'DEBATE_FOR' | 'DEBATE_AGAINST' | 'COMMENT'
  motion?: Omit<Motion, 'seconded' | 'secondedBy' | 'statedByChair' | 'debateSpeeches'> // for purpose MOVE
  // POINT_OF_ORDER:
  claim?: string
  valid?: boolean // authored/derived; deterministic ground truth
  // INQUIRY:
  question?: string
  answers?: { id: AnswerId; text: string; correct: boolean }[]
}

export type MeterDelta = {
  turn: number
  meter: 'control' | 'trust'
  delta: number // negative or positive
  reason: string // machine key, e.g. 'UNADDRESSED_INTERRUPT'
  label: string // human sentence for diagnostics/report
}

export type Checkpoint = {
  id: string
  label: string // e.g. 'Item 2: Fence variance opened'
  turn: number
  state: MeetingState // deep snapshot with checkpoints: [] inside
}

/**
 * Bookkeeping the room simulation needs across turns (D6/D7). It lives on
 * MeetingState rather than in module scope so the engine stays pure and every
 * checkpoint snapshot rewinds the room along with the meeting.
 */
export type RoomSim = {
  /** Beat ids already fired; every beat fires at most once (D7). */
  firedBeats: string[]
  /** Agenda item ids the veteran has already reacted to. */
  veteranItems: string[]
  /**
   * Every member's recognition count at the moment the veteran filed, so their
   * patience can be spent by *distinct* members getting the floor ahead of
   * them (D6: "2 other members have been recognized since"). Null when idle.
   */
  veteranBaseline: Record<MemberId, number> | null
  /**
   * The rules enthusiast has an objection ready but the turn's one scene was
   * already spent. Deferred, not dropped: it files on a later turn (D4).
   */
  enthusiastPendingPoint: boolean
  /** A drifting speech still running into its second turn (D6). */
  drifting: { member: MemberId; startedTurn: number } | null
  /** Requests that already charged IGNORED_REQUEST_TIMEOUT (fires once each). */
  timedOutRequests: RequestId[]
}

export type VoteTally = {
  method: 'VOICE' | 'ROLL_CALL'
  ayes: number
  noes: number
  abstains: number
  passed: boolean
  motionId: string
  announced: boolean
}

// ---------------------------------------------------------------------------
// Spec §4.2 — Meeting state, verbatim + D2 additions
// ---------------------------------------------------------------------------

export type MeetingState = {
  agenda: AgendaItem[]
  currentItem: number
  quorumPresent: boolean
  members: Member[]
  floorHolder: MemberId | null
  motionStack: Motion[] // main motion at the bottom, amendments above
  pendingRequests: Request[] // recognition, point of order, inquiry
  phase: 'PRE_MEETING' | 'ITEM_OPEN' | 'MOTION_PENDING' | 'DEBATE' | 'VOTING' | 'RECESS' | 'ADJOURNED' | 'COLLAPSED'
  meters: { control: number; trust: number }
  turn: number
  log: MeetingEvent[]

  // D2 additions:
  rngState: number
  /**
   * Monotonic event counter. Event ids are `e{eventSeq}` taken from this, not
   * from `log.length`: checkpoint snapshots truncate `log` to its last 20
   * entries (D10), so a length-derived id would start reissuing ids that
   * already exist once a checkpoint is restored.
   */
  eventSeq: number
  meterLog: MeterDelta[]
  checkpoints: Checkpoint[]
  currentVote: VoteTally | null
  consecutiveWaits: number
  memberMood: Record<MemberId, { impatience: number; timesRecognized: number }>
  outOfOrderCount: number // chair actions taken while OUT_OF_ORDER
  itemsCompleted: number
  /** Room-simulation bookkeeping (D6/D7); see RoomSim. */
  room: RoomSim
}

export type Phase = MeetingState['phase']

// ---------------------------------------------------------------------------
// D2 — Legality report
// ---------------------------------------------------------------------------

export type LegalityStatus = 'IN_ORDER' | 'OUT_OF_ORDER' | 'RISKY'

export type LegalityReport = {
  verbs: Record<Action['verb'], { status: LegalityStatus; why: string }>
  targets: {
    recognize: MemberId[] // members with pending RECOGNITION or INTERRUPT requests, plus all members (recognizing a non-requester is RISKY, handled by UI copy)
    rule: RequestId[] // pending POINT_OF_ORDER ids
    answer: RequestId[] // pending INQUIRY ids
  }
}
