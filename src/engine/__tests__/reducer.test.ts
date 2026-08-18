import { describe, expect, it } from 'vitest'

import { initMeeting, latestEvents, reduce } from '../reducer'
import type { Action, MeetingEvent, MeetingState, Motion, Request } from '../types'
import { makeState } from './helpers'
import {
  FIXTURE_ITEM_TITLE,
  FIXTURE_MOTION_ID,
  FIXTURE_MOTION_TEXT,
  debateRequest,
  fixtureScenario,
  moveRequest,
} from './fixture'

const scenario = fixtureScenario()

// --- small local helpers ----------------------------------------------------

function run(state: MeetingState, actions: Action[]): MeetingState {
  return actions.reduce((s, a) => reduce(s, a, scenario), state)
}

function withRequests(state: MeetingState, requests: Request[]): MeetingState {
  return { ...state, pendingRequests: [...state.pendingRequests, ...requests] }
}

/** Marks the top motion seconded (the room's job in Task 6; forced here). */
function second(state: MeetingState, by = 'm2'): MeetingState {
  const stack = state.motionStack.map((m, i) =>
    i === state.motionStack.length - 1 ? { ...m, seconded: true, secondedBy: by } : m,
  )
  return { ...state, motionStack: stack }
}

function reasons(state: MeetingState): string[] {
  return state.meterLog.map((d) => d.reason)
}

function intents(events: MeetingEvent[]): string[] {
  return events.map((e) => e.intent)
}

function makeMotion(partial?: Partial<Motion>): Motion {
  return {
    id: FIXTURE_MOTION_ID,
    kind: 'MAIN',
    text: FIXTURE_MOTION_TEXT,
    mover: 'm1',
    seconded: true,
    secondedBy: 'm2',
    germane: true,
    statedByChair: true,
    debateSpeeches: 0,
    votes: { m1: 'AYE', m2: 'AYE', m3: 'AYE', m4: 'NO', m5: 'ABSTAIN' },
    ...partial,
  }
}

/** A DEBATE state sitting on a properly moved, seconded and stated motion. */
function debateState(partial?: Partial<MeetingState>): MeetingState {
  return makeState({
    phase: 'DEBATE',
    agenda: scenario.agenda,
    motionStack: [makeMotion()],
    ...partial,
  })
}

// ---------------------------------------------------------------------------
// initMeeting
// ---------------------------------------------------------------------------

describe('initMeeting', () => {
  it('opens in PRE_MEETING with meters at 70/70 and the seed as rngState', () => {
    const state = initMeeting(scenario, 1234)
    expect(state.phase).toBe('PRE_MEETING')
    expect(state.meters).toEqual({ control: 70, trust: 70 })
    expect(state.rngState).toBe(1234)
    expect(state.currentItem).toBe(0)
    expect(state.itemsCompleted).toBe(0)
    expect(state.outOfOrderCount).toBe(0)
    expect(state.motionStack).toEqual([])
    expect(state.pendingRequests).toEqual([])
    expect(state.currentVote).toBeNull()
    expect(state.checkpoints).toEqual([])
  })

  it('builds members from scenario.members with presence from scenario.present', () => {
    const state = initMeeting(scenario, 1)
    expect(state.members).toHaveLength(5)
    expect(state.members[0]).toEqual({ id: 'm1', name: 'Member One', archetype: 'NONE', present: true })
    expect(state.memberMood.m3).toEqual({ impatience: 0, timesRecognized: 0 })
  })

  it('marks absent members and computes quorum from present.length >= quorum', () => {
    const thin = { ...scenario, present: ['m1', 'm2'] }
    const state = initMeeting(thin, 1)
    expect(state.quorumPresent).toBe(false)
    expect(state.members.find((m) => m.id === 'm5')?.present).toBe(false)
    expect(initMeeting(scenario, 1).quorumPresent).toBe(true)
  })

  it('emits call-to-order setting narration with deterministic counter ids', () => {
    const state = initMeeting(scenario, 1)
    expect(state.log.length).toBeGreaterThanOrEqual(2)
    expect(state.log.every((e) => e.type === 'NARRATION')).toBe(true)
    expect(state.log.map((e) => e.id)).toEqual(state.log.map((_, i) => `e${i + 1}`))
  })
})

// ---------------------------------------------------------------------------
// Happy path walk
// ---------------------------------------------------------------------------

describe('happy path: call item -> move -> state -> debate -> vote -> announce -> adjourn', () => {
  it('walks the phases, motion lifecycle and tally without losing a meter point', () => {
    let s = initMeeting(scenario, 7)

    // Call to order, opening item 0.
    s = reduce(s, { verb: 'CALL_ITEM' }, scenario)
    expect(s.phase).toBe('ITEM_OPEN')
    expect(s.currentItem).toBe(0)
    expect(intents(s.log)).toContain('CALL_TO_ORDER')
    expect(s.log.some((e) => e.actor === 'CLERK')).toBe(true)

    // A member is waiting to move the main motion.
    s = withRequests(s, [moveRequest('m1', s.turn)])
    s = reduce(s, { verb: 'RECOGNIZE', target: 'm1' }, scenario)
    expect(s.phase).toBe('MOTION_PENDING')
    expect(s.motionStack).toHaveLength(1)
    expect(s.motionStack[0]).toMatchObject({
      id: FIXTURE_MOTION_ID,
      mover: 'm1',
      seconded: false,
      secondedBy: null,
      statedByChair: false,
      debateSpeeches: 0,
    })
    // Authored stances are copied onto the motion when it is moved.
    expect(s.motionStack[0].votes).toEqual({ m1: 'AYE', m2: 'AYE', m3: 'AYE', m4: 'NO', m5: 'ABSTAIN' })
    expect(s.pendingRequests).toHaveLength(0)
    expect(s.memberMood.m1.timesRecognized).toBe(1)

    // The room seconds it (Task 6's job; forced here).
    s = second(s)

    s = reduce(s, { verb: 'STATE_MOTION' }, scenario)
    expect(s.phase).toBe('DEBATE')
    expect(s.motionStack[0].statedByChair).toBe(true)

    // One debate speech.
    s = withRequests(s, [debateRequest('m2', 'DEBATE_FOR', s.turn)])
    s = reduce(s, { verb: 'RECOGNIZE', target: 'm2' }, scenario)
    expect(s.phase).toBe('DEBATE')
    expect(s.motionStack[0].debateSpeeches).toBe(1)
    expect(s.floorHolder).toBeNull()
    expect(s.pendingRequests).toHaveLength(0)

    s = reduce(s, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(s.phase).toBe('VOTING')
    expect(s.currentVote).toMatchObject({
      method: 'VOICE',
      ayes: 3,
      noes: 1,
      abstains: 1,
      passed: true,
      motionId: FIXTURE_MOTION_ID,
      announced: false,
    })

    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(s.phase).toBe('ITEM_OPEN')
    expect(s.motionStack).toHaveLength(0)
    expect(s.itemsCompleted).toBe(1)
    expect(s.currentVote?.announced).toBe(true)
    expect(s.log.some((e) => e.type === 'VOTE_RESULT')).toBe(true)
    expect(reasons(s)).toContain('CLEAN_PROCEDURE_BONUS')

    s = reduce(s, { verb: 'ADJOURN' }, scenario)
    expect(s.phase).toBe('ADJOURNED')
    expect(reasons(s)).not.toContain('PREMATURE_ADJOURN')

    expect(s.outOfOrderCount).toBe(0)
    expect(s.meters.control).toBeGreaterThanOrEqual(70)
    expect(s.meters.trust).toBeGreaterThanOrEqual(70)
  })
})

// ---------------------------------------------------------------------------
// Out-of-order chair actions
// ---------------------------------------------------------------------------

describe('out-of-order chair actions', () => {
  it('CALL_VOTE from ITEM_OPEN costs 6 control, counts, and has no intended effect', () => {
    const before = makeState({ phase: 'ITEM_OPEN', agenda: scenario.agenda })
    const after = reduce(before, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)

    expect(after.meters.control).toBe(64)
    expect(after.outOfOrderCount).toBe(1)
    expect(after.phase).toBe('ITEM_OPEN')
    expect(after.currentVote).toBeNull()
    expect(reasons(after)).toEqual(['OUT_OF_ORDER_ACTION'])
    expect(after.turn).toBe(before.turn + 1)
  })

  it('emits a CONFUSION speech from a present member', () => {
    const after = reduce(makeState({ phase: 'ITEM_OPEN' }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    const confusion = after.log.find((e) => e.intent === 'CONFUSION')
    expect(confusion?.type).toBe('SPEECH')
    expect(['m1', 'm2', 'm3', 'm4', 'm5']).toContain(confusion?.actor)
  })

  it('does not capture a pre-vote checkpoint for an out-of-order CALL_VOTE', () => {
    const after = reduce(makeState({ phase: 'ITEM_OPEN' }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.checkpoints).toEqual([])
  })

  it('honours the no-quorum override: CALL_ITEM cannot open business', () => {
    const before = makeState({ phase: 'PRE_MEETING', quorumPresent: false })
    const after = reduce(before, { verb: 'CALL_ITEM' }, scenario)
    expect(after.phase).toBe('PRE_MEETING')
    expect(after.outOfOrderCount).toBe(1)
    expect(after.checkpoints).toEqual([])
  })

  it('STATE_MOTION on an unseconded motion is out of order and does not state it', () => {
    const before = makeState({
      phase: 'MOTION_PENDING',
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false })],
    })
    const after = reduce(before, { verb: 'STATE_MOTION' }, scenario)
    expect(after.motionStack[0].statedByChair).toBe(false)
    expect(after.phase).toBe('MOTION_PENDING')
    expect(after.meters.control).toBe(64)
  })
})

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

describe('CALL_VOTE', () => {
  it('tallies 3 AYE / 1 NO / 1 ABSTAIN as passed', () => {
    const after = reduce(debateState(), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.currentVote).toMatchObject({ ayes: 3, noes: 1, abstains: 1, passed: true })
    expect(after.phase).toBe('VOTING')
    expect(after.log.some((e) => e.actor === 'CLERK')).toBe(true)
  })

  it('excludes absent members from the tally', () => {
    const state = debateState({
      members: makeState().members.map((m) => (m.id === 'm1' ? { ...m, present: false } : m)),
    })
    const after = reduce(state, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.currentVote).toMatchObject({ ayes: 2, noes: 1, abstains: 1, passed: true })
  })

  it('fails a motion that does not have a majority of those voting', () => {
    const state = debateState({ motionStack: [makeMotion({ votes: { m1: 'AYE', m2: 'NO', m3: 'NO' } })] })
    const after = reduce(state, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    // m4/m5 have no authored stance -> silent -> abstain
    expect(after.currentVote).toMatchObject({ ayes: 1, noes: 2, abstains: 2, passed: false })
  })

  it('fails a tie: a majority means more ayes than noes', () => {
    const state = debateState({
      motionStack: [makeMotion({ votes: { m1: 'AYE', m2: 'AYE', m3: 'NO', m4: 'NO', m5: 'ABSTAIN' } })],
    })
    const after = reduce(state, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.currentVote).toMatchObject({ ayes: 2, noes: 2, abstains: 1, passed: false })
  })

  it('is RISKY with recognition pending: it executes but costs trust', () => {
    const state = debateState({ pendingRequests: [debateRequest('m3')] })
    const after = reduce(state, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.phase).toBe('VOTING')
    expect(reasons(after)).toContain('CUT_OFF_DEBATE')
    expect(after.meters.trust).toBe(64)
    expect(after.outOfOrderCount).toBe(0)
  })

  it('is out of order on a motion that was never stated', () => {
    const state = debateState({ motionStack: [makeMotion({ statedByChair: false })] })
    const after = reduce(state, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.phase).toBe('DEBATE')
    expect(after.currentVote).toBeNull()
    expect(after.outOfOrderCount).toBe(1)
  })
})

describe('ANNOUNCE_RESULT', () => {
  it('pops the motion, resolves the item and returns to ITEM_OPEN', () => {
    let s = reduce(debateState(), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(s.motionStack).toHaveLength(0)
    expect(s.phase).toBe('ITEM_OPEN')
    expect(s.itemsCompleted).toBe(1)
    expect(s.currentVote?.announced).toBe(true)
    const result = s.log.find((e) => e.type === 'VOTE_RESULT')
    expect(result?.payload).toMatchObject({ ayes: 3, noes: 1, abstains: 1, passed: true })
  })

  it('fires CLEAN_PROCEDURE_BONUS when announced within one turn of the vote', () => {
    let s = reduce(debateState(), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(reasons(s)).toContain('CLEAN_PROCEDURE_BONUS')
    expect(s.meters.control).toBe(73)
  })

  it('withholds CLEAN_PROCEDURE_BONUS when there is no record of the vote being taken', () => {
    // A VOTING state with no VOTE_TAKEN event in the log: the bonus rewards a
    // demonstrably prompt announcement, so with no evidence it fails closed.
    const state = makeState({
      phase: 'VOTING',
      motionStack: [makeMotion()],
      currentVote: { method: 'VOICE', ayes: 3, noes: 1, abstains: 1, passed: true, motionId: FIXTURE_MOTION_ID, announced: false },
    })
    const after = reduce(state, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(reasons(after)).not.toContain('CLEAN_PROCEDURE_BONUS')
    expect(after.phase).toBe('ITEM_OPEN')
  })

  it('counts the item once even when a second main motion is taken up on it', () => {
    let s = reduce(debateState(), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(s.itemsCompleted).toBe(1)

    // Same item, a second main motion, moved / seconded / stated / voted.
    s = withRequests(s, [moveRequest('m3', s.turn)])
    s = reduce(s, { verb: 'RECOGNIZE', target: 'm3' }, scenario)
    s = second(s, 'm4')
    s = reduce(s, { verb: 'STATE_MOTION' }, scenario)
    s = reduce(s, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)

    expect(s.currentItem).toBe(0)
    expect(s.itemsCompleted).toBe(1)
  })

  it('clears the previous item vote when the next item opens', () => {
    let s = reduce(debateState({ agenda: makeState().agenda }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(s.currentVote).not.toBeNull()
    s = reduce(s, { verb: 'CALL_ITEM' }, scenario)
    expect(s.currentItem).toBe(1)
    expect(s.currentVote).toBeNull()
  })

  it('withholds CLEAN_PROCEDURE_BONUS when the chair dawdles a turn first', () => {
    let s = reduce(debateState(), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    s = reduce(s, { verb: 'WAIT' }, scenario)
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(reasons(s)).not.toContain('CLEAN_PROCEDURE_BONUS')
  })

  it('returns to debate on the underlying motion when the stack is not empty', () => {
    const amendment = makeMotion({ id: 'amend-1', kind: 'AMEND', text: 'strike the second sentence' })
    let s = debateState({ motionStack: [makeMotion(), amendment] })
    s = reduce(s, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(s.motionStack).toHaveLength(1)
    expect(s.phase).toBe('DEBATE')
    expect(s.itemsCompleted).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// RECOGNIZE
// ---------------------------------------------------------------------------

describe('RECOGNIZE', () => {
  it('legitimizes a pending INTERRUPT by handing over the floor', () => {
    const request: Request = { id: 'int-1', kind: 'INTERRUPT', member: 'm4', createdTurn: 1 }
    const after = reduce(makeState({ pendingRequests: [request] }), { verb: 'RECOGNIZE', target: 'm4' }, scenario)
    expect(after.floorHolder).toBe('m4')
    expect(after.pendingRequests).toHaveLength(0)
    expect(after.meterLog).toHaveLength(0)
  })

  it('produces a demur when the member has no pending request', () => {
    const before = makeState()
    const after = reduce(before, { verb: 'RECOGNIZE', target: 'm4' }, scenario)
    expect(after.floorHolder).toBeNull()
    expect(after.motionStack).toHaveLength(0)
    expect(intents(latestEvents(before, after))).toContain('DEMUR')
  })

  it('applies SELECTIVE_RECOGNITION when jumping a request that waited two turns longer', () => {
    const state = makeState({
      turn: 5,
      pendingRequests: [debateRequest('m3', 'DEBATE_FOR', 1), debateRequest('m2', 'DEBATE_AGAINST', 4)],
    })
    const after = reduce(state, { verb: 'RECOGNIZE', target: 'm2' }, scenario)
    expect(reasons(after)).toContain('SELECTIVE_RECOGNITION')
    expect(after.pendingRequests.map((r) => r.member)).toEqual(['m3'])
  })

  it('does not apply SELECTIVE_RECOGNITION when taking the longest waiter', () => {
    const state = makeState({
      turn: 5,
      pendingRequests: [debateRequest('m3', 'DEBATE_FOR', 1), debateRequest('m2', 'DEBATE_AGAINST', 4)],
    })
    const after = reduce(state, { verb: 'RECOGNIZE', target: 'm3' }, scenario)
    expect(reasons(after)).not.toContain('SELECTIVE_RECOGNITION')
  })

  it('never pushes a second MAIN motion while one is pending', () => {
    const state = makeState({
      phase: 'DEBATE',
      motionStack: [makeMotion()],
      pendingRequests: [moveRequest('m3', 1)],
    })
    const after = reduce(state, { verb: 'RECOGNIZE', target: 'm3' }, scenario)
    expect(after.motionStack).toHaveLength(1)
    expect(after.phase).toBe('DEBATE')
    expect(after.pendingRequests).toHaveLength(0)
  })

  it('seconds the pending motion for a SECOND purpose', () => {
    const state = makeState({
      phase: 'MOTION_PENDING',
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false })],
      pendingRequests: [{ id: 'r-sec', kind: 'RECOGNITION', member: 'm2', createdTurn: 1, purpose: 'SECOND' }],
    })
    const after = reduce(state, { verb: 'RECOGNIZE', target: 'm2' }, scenario)
    expect(after.motionStack[0].seconded).toBe(true)
    expect(after.motionStack[0].secondedBy).toBe('m2')
  })
})

// ---------------------------------------------------------------------------
// Rulings, inquiries, gavel, recess, adjourn, wait
// ---------------------------------------------------------------------------

describe('RULE', () => {
  const point = (valid: boolean): Request => ({
    id: 'poo-1',
    kind: 'POINT_OF_ORDER',
    member: 'm3',
    createdTurn: 1,
    claim: 'The motion was never stated.',
    valid,
  })

  it('rewards a ruling that matches the point (control +4, trust +3 FAIR_RULING) and clears the request', () => {
    const after = reduce(
      makeState({ pendingRequests: [point(true)] }),
      { verb: 'RULE', target: 'poo-1', ruling: 'WELL_TAKEN' },
      scenario,
    )
    expect(reasons(after)).toEqual(['CORRECT_RULING', 'FAIR_RULING'])
    expect(after.meters.control).toBe(74)
    expect(after.meters.trust).toBe(73)
    expect(after.pendingRequests).toHaveLength(0)
  })

  it('costs 10 trust for NOT_WELL_TAKEN on a valid point', () => {
    const after = reduce(
      makeState({ pendingRequests: [point(true)] }),
      { verb: 'RULE', target: 'poo-1', ruling: 'NOT_WELL_TAKEN' },
      scenario,
    )
    expect(reasons(after)).toEqual(['INVALID_RULING'])
    expect(after.meters.trust).toBe(60)
  })

  it('costs 5 trust for WELL_TAKEN on a bogus point', () => {
    const after = reduce(
      makeState({ pendingRequests: [point(false)] }),
      { verb: 'RULE', target: 'poo-1', ruling: 'WELL_TAKEN' },
      scenario,
    )
    expect(reasons(after)).toEqual(['TECHNICALITY_RULING'])
    expect(after.meters.trust).toBe(65)
  })

  it('rewards NOT_WELL_TAKEN on a bogus point', () => {
    const after = reduce(
      makeState({ pendingRequests: [point(false)] }),
      { verb: 'RULE', target: 'poo-1', ruling: 'NOT_WELL_TAKEN' },
      scenario,
    )
    expect(reasons(after)).toEqual(['CORRECT_RULING', 'FAIR_RULING'])
  })
})

describe('ANSWER_INQUIRY', () => {
  const inquiry: Request = {
    id: 'inq-1',
    kind: 'INQUIRY',
    member: 'm2',
    createdTurn: 1,
    question: 'Does an abstention count against the motion?',
    answers: [
      { id: 'a1', text: 'No; it is not a vote.', correct: true },
      { id: 'a2', text: 'Yes; it counts as a no.', correct: false },
    ],
  }

  it('clears the request with no penalty for the correct answer', () => {
    const after = reduce(
      makeState({ pendingRequests: [inquiry] }),
      { verb: 'ANSWER_INQUIRY', target: 'inq-1', answer: 'a1' },
      scenario,
    )
    expect(after.meterLog).toHaveLength(0)
    expect(after.pendingRequests).toHaveLength(0)
  })

  it('costs 4 control for a wrong answer', () => {
    const after = reduce(
      makeState({ pendingRequests: [inquiry] }),
      { verb: 'ANSWER_INQUIRY', target: 'inq-1', answer: 'a2' },
      scenario,
    )
    expect(reasons(after)).toEqual(['WRONG_INQUIRY_ANSWER'])
    expect(after.meters.control).toBe(66)
  })
})

describe('GAVEL', () => {
  it('restores order and clears interrupts (+8 control)', () => {
    const state = makeState({
      pendingRequests: [
        { id: 'i1', kind: 'INTERRUPT', member: 'm4', createdTurn: 1 },
        { id: 'r1', kind: 'RECOGNITION', member: 'm2', createdTurn: 1, purpose: 'COMMENT' },
      ],
    })
    const after = reduce(state, { verb: 'GAVEL' }, scenario)
    expect(reasons(after)).toEqual(['GAVEL_RESTORES_ORDER'])
    expect(after.meters.control).toBe(78)
    expect(after.pendingRequests.map((r) => r.id)).toEqual(['r1'])
  })

  it('costs 4 trust in a quiet room', () => {
    const after = reduce(makeState(), { verb: 'GAVEL' }, scenario)
    expect(reasons(after)).toEqual(['GAVEL_QUIET_ROOM'])
    expect(after.meters.trust).toBe(66)
    expect(after.outOfOrderCount).toBe(0)
  })
})

describe('RECESS and CALL_ITEM resume', () => {
  it('is a breather (+5 control) when control is below 40 and clears impatience', () => {
    const state = makeState({
      meters: { control: 30, trust: 70 },
      memberMood: { ...makeState().memberMood, m4: { impatience: 3, timesRecognized: 0 } },
    })
    const after = reduce(state, { verb: 'RECESS', minutes: 5 }, scenario)
    expect(after.phase).toBe('RECESS')
    expect(reasons(after)).toEqual(['RECESS_BREATHER'])
    expect(after.meters.control).toBe(35)
    expect(after.memberMood.m4.impatience).toBe(0)
  })

  it('is a stall (-3 trust) when the room is under control', () => {
    const after = reduce(makeState(), { verb: 'RECESS', minutes: 5 }, scenario)
    expect(reasons(after)).toEqual(['RECESS_STALL'])
    expect(after.meters.trust).toBe(67)
  })

  it('resumes to ITEM_OPEN on the current item when nothing is pending', () => {
    const state = makeState({ phase: 'RECESS', currentItem: 0, motionStack: [] })
    const after = reduce(state, { verb: 'CALL_ITEM' }, scenario)
    expect(after.phase).toBe('ITEM_OPEN')
    expect(after.currentItem).toBe(0)
  })

  it('resumes to DEBATE when a stated, seconded motion is still on the floor', () => {
    const state = makeState({ phase: 'RECESS', currentItem: 0, motionStack: [makeMotion()] })
    const after = reduce(state, { verb: 'CALL_ITEM' }, scenario)
    expect(after.phase).toBe('DEBATE')
    expect(after.currentItem).toBe(0)
    expect(after.motionStack).toHaveLength(1)
  })

  it('resumes to MOTION_PENDING when the motion is not yet stated or seconded', () => {
    const unstated = makeState({ phase: 'RECESS', motionStack: [makeMotion({ statedByChair: false })] })
    expect(reduce(unstated, { verb: 'CALL_ITEM' }, scenario).phase).toBe('MOTION_PENDING')

    const unseconded = makeState({
      phase: 'RECESS',
      motionStack: [makeMotion({ seconded: false, secondedBy: null })],
    })
    expect(reduce(unseconded, { verb: 'CALL_ITEM' }, scenario).phase).toBe('MOTION_PENDING')
  })

  it('leaves the vote completable after a recess taken mid-debate', () => {
    let s = debateState()
    s = reduce(s, { verb: 'RECESS', minutes: 10 }, scenario)
    expect(s.phase).toBe('RECESS')

    s = reduce(s, { verb: 'CALL_ITEM' }, scenario)
    expect(s.phase).toBe('DEBATE')
    expect(s.motionStack[0]).toMatchObject({ statedByChair: true, seconded: true, text: FIXTURE_MOTION_TEXT })

    s = reduce(s, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(s.phase).toBe('VOTING')
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(s.phase).toBe('ITEM_OPEN')
    expect(s.itemsCompleted).toBe(1)
    expect(s.outOfOrderCount).toBe(0)
  })
})

describe('ADJOURN', () => {
  it('ends the meeting and costs 8 trust with business remaining', () => {
    const after = reduce(makeState({ phase: 'ITEM_OPEN' }), { verb: 'ADJOURN' }, scenario)
    expect(after.phase).toBe('ADJOURNED')
    expect(reasons(after)).toEqual(['PREMATURE_ADJOURN'])
    expect(after.meters.trust).toBe(62)
  })

  it('is free once every item is completed', () => {
    const state = makeState({ phase: 'ITEM_OPEN', agenda: scenario.agenda, itemsCompleted: 1, currentItem: 0 })
    const after = reduce(state, { verb: 'ADJOURN' }, scenario)
    expect(after.phase).toBe('ADJOURNED')
    expect(after.meterLog).toHaveLength(0)
  })
})

describe('WAIT', () => {
  it('costs 3 control while requests are pending and counts consecutive waits', () => {
    const state = makeState({ pendingRequests: [debateRequest('m2')] })
    const after = reduce(state, { verb: 'WAIT' }, scenario)
    expect(reasons(after)).toEqual(['HESITATION'])
    expect(after.meters.control).toBe(67)
    expect(after.consecutiveWaits).toBe(1)
  })

  it('is free in an empty room and resets on the next real action', () => {
    let s = reduce(makeState(), { verb: 'WAIT' }, scenario)
    expect(s.meterLog).toHaveLength(0)
    s = reduce(s, { verb: 'WAIT' }, scenario)
    expect(s.consecutiveWaits).toBe(2)
    s = reduce(s, { verb: 'RECOGNIZE', target: 'm2' }, scenario)
    expect(s.consecutiveWaits).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Checkpoints (D10 capture rules)
// ---------------------------------------------------------------------------

describe('checkpoints', () => {
  it('captures on entering ITEM_OPEN for a new item', () => {
    const s = reduce(initMeeting(scenario, 3), { verb: 'CALL_ITEM' }, scenario)
    expect(s.checkpoints).toHaveLength(1)
    expect(s.checkpoints[0].label).toContain(FIXTURE_ITEM_TITLE)
    expect(s.checkpoints[0].state.phase).toBe('ITEM_OPEN')
    expect(s.checkpoints[0].state.checkpoints).toEqual([])
  })

  it('captures the item-advance boundary when moving to the next item', () => {
    // Two-item agenda, item 1 resolved: CALL_ITEM advances to index 1.
    const before = makeState({ phase: 'ITEM_OPEN', currentItem: 0, itemsCompleted: 1 })
    const after = reduce(before, { verb: 'CALL_ITEM' }, scenario)
    expect(after.currentItem).toBe(1)
    expect(after.checkpoints).toHaveLength(1)
    expect(after.checkpoints[0].label).toBe('Item 2: Fence variance request opened')
    expect(after.checkpoints[0].state.currentItem).toBe(1)
    expect(after.checkpoints[0].state.phase).toBe('ITEM_OPEN')
  })

  it('gives every checkpoint the same meaning: the turn it will replay', () => {
    // Item boundary: the CALL_ITEM of turn 1 is already applied, so the
    // snapshot is poised to take turn 2.
    const item = reduce(initMeeting(scenario, 3), { verb: 'CALL_ITEM' }, scenario)
    expect(item.checkpoints[0].turn).toBe(2)
    expect(item.checkpoints[0].state.turn).toBe(2)
    expect(item.turn).toBe(2)

    // Pre-vote boundary: captured before the vote is applied, so the snapshot
    // is poised to retake the very turn the chair just spent.
    const vote = reduce(debateState({ turn: 6 }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(vote.checkpoints[0].turn).toBe(6)
    expect(vote.checkpoints[0].state.turn).toBe(6)
    expect(vote.checkpoints[0].state.phase).toBe('DEBATE')
  })

  it('does not capture when merely returning to ITEM_OPEN on the same item', () => {
    let s = reduce(debateState(), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    const before = s.checkpoints.length
    s = reduce(s, { verb: 'ANNOUNCE_RESULT' }, scenario)
    expect(s.phase).toBe('ITEM_OPEN')
    expect(s.checkpoints).toHaveLength(before)
  })

  it('captures the pre-vote state immediately before applying CALL_VOTE', () => {
    const s = reduce(debateState(), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(s.checkpoints).toHaveLength(1)
    expect(s.checkpoints[0].state.phase).toBe('DEBATE')
    expect(s.checkpoints[0].state.currentVote).toBeNull()
  })

  it('truncates the snapshot log to the last 20 events', () => {
    const log: MeetingEvent[] = Array.from({ length: 30 }, (_, i) => ({
      id: `e${i + 1}`,
      type: 'NARRATION' as const,
      actor: 'SYSTEM' as const,
      intent: 'FILLER',
      payload: {},
    }))
    const s = reduce(debateState({ log }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(s.checkpoints[0].state.log).toHaveLength(20)
    expect(s.checkpoints[0].state.log[19].id).toBe('e30')
  })
})

// ---------------------------------------------------------------------------
// Collapse
// ---------------------------------------------------------------------------

describe('collapse', () => {
  it('collapses the meeting when control hits 0 and narrates the chaos', () => {
    const before = makeState({ phase: 'ITEM_OPEN', meters: { control: 6, trust: 70 } })
    const after = reduce(before, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.meters.control).toBe(0)
    expect(after.phase).toBe('COLLAPSED')
    const chaos = latestEvents(before, after).filter((e) => e.type === 'NARRATION' || e.type === 'INTERRUPT')
    expect(chaos.length).toBeGreaterThanOrEqual(3)
  })

  it('leaves a healthy meeting alone', () => {
    const after = reduce(makeState({ meters: { control: 7, trust: 70 } }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.meters.control).toBe(1)
    expect(after.phase).not.toBe('COLLAPSED')
  })
})

// ---------------------------------------------------------------------------
// Terminal absorption, purity, determinism, latestEvents
// ---------------------------------------------------------------------------

describe('terminal phases', () => {
  it('absorbs further actions with a single "meeting is over" narration', () => {
    const adjourned = makeState({ phase: 'ADJOURNED' })
    const after = reduce(adjourned, { verb: 'CALL_ITEM' }, scenario)
    expect(after.phase).toBe('ADJOURNED')
    expect(after.log).toHaveLength(adjourned.log.length + 1)
    expect(after.turn).toBe(adjourned.turn)
    expect(after.meterLog).toHaveLength(0)
    expect(after.outOfOrderCount).toBe(0)
    const narration = after.log[after.log.length - 1]
    expect(narration.type).toBe('NARRATION')
  })

  it('absorbs actions after a collapse too', () => {
    const collapsed = makeState({ phase: 'COLLAPSED' })
    const after = reduce(collapsed, { verb: 'GAVEL' }, scenario)
    expect(after.phase).toBe('COLLAPSED')
    expect(after.meterLog).toHaveLength(0)
  })
})

describe('purity', () => {
  it('never mutates the input state', () => {
    const state = withRequests(debateState(), [debateRequest('m2')])
    const snapshot = structuredClone(state)
    reduce(state, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    reduce(state, { verb: 'RECOGNIZE', target: 'm2' }, scenario)
    reduce(state, { verb: 'WAIT' }, scenario)
    expect(state).toEqual(snapshot)
  })
})

describe('event ids', () => {
  it('are unique and monotonic across a meeting', () => {
    const s = run(initMeeting(scenario, 5), [
      { verb: 'CALL_ITEM' },
      { verb: 'WAIT' },
      { verb: 'GAVEL' },
      { verb: 'CALL_VOTE', method: 'VOICE' },
      { verb: 'RECESS', minutes: 5 },
    ])
    const ids = s.log.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(ids.map((_, i) => `e${i + 1}`))
    expect(s.eventSeq).toBe(ids.length)
  })

  it('do not collide with live ids after resuming from a truncated checkpoint', () => {
    const log: MeetingEvent[] = Array.from({ length: 30 }, (_, i) => ({
      id: `e${i + 1}`,
      type: 'NARRATION' as const,
      actor: 'SYSTEM' as const,
      intent: 'FILLER',
      payload: {},
    }))
    const s = reduce(debateState({ log, eventSeq: 30 }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)

    // The snapshot keeps only the last 20 events but carries the counter, so a
    // resumed meeting keeps issuing fresh ids instead of reusing e21 onward.
    const resumed = s.checkpoints[0].state
    expect(resumed.log).toHaveLength(20)
    expect(resumed.eventSeq).toBe(30)

    const next = reduce(resumed, { verb: 'WAIT' }, scenario)
    const fresh = latestEvents(resumed, next).map((e) => e.id)
    expect(fresh).toEqual(['e31'])
    expect(log.map((e) => e.id)).not.toContain('e31')
  })
})

describe('determinism', () => {
  const actions: Action[] = [
    { verb: 'CALL_ITEM' },
    { verb: 'WAIT' },
    { verb: 'GAVEL' },
    { verb: 'CALL_VOTE', method: 'VOICE' },
    { verb: 'RECOGNIZE', target: 'm2' },
    { verb: 'WAIT' },
  ]

  it('same seed + same actions produce deep-equal states', () => {
    const a = run(initMeeting(scenario, 99), actions)
    const b = run(initMeeting(scenario, 99), actions)
    expect(a).toEqual(b)
  })

  it('advances rngState only through the seeded generator', () => {
    const a = run(initMeeting(scenario, 1), actions)
    const b = run(initMeeting(scenario, 2), actions)
    expect(a.rngState).not.toBe(b.rngState)
  })
})

describe('latestEvents', () => {
  it('returns only the events appended by the last reduce', () => {
    const before = makeState({ phase: 'ITEM_OPEN', agenda: scenario.agenda })
    const after = reduce(before, { verb: 'CALL_ITEM' }, scenario)
    expect(latestEvents(before, after)).toEqual(after.log.slice(before.log.length))
    expect(latestEvents(before, before)).toEqual([])
  })
})
