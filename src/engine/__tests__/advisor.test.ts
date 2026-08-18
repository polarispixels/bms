// suggestAction: the deterministic hint engine (no AI, no randomness).
//
// One test per priority branch (D-something: hint system), plus a property
// test that replays a full scripted game and checks the safety invariant
// holds at every pre-terminal state, plus a determinism check.

import { describe, expect, it } from 'vitest'
import { suggestAction } from '../advisor'
import { legalActions } from '../legality'
import { initMeeting, reduce } from '../reducer'
import type { Action, MeetingState, Motion, Request } from '../types'
import { makeState } from './helpers'
import { FIXTURE_MOTION_ID, FIXTURE_MOTION_TEXT, fixtureScenario } from './fixture'
import { scenarios } from '../../content/index'
import { HAPPY_PATH } from '../../content/__tests__/hoa-fence-01.test'

const scenario = fixtureScenario()

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
    movedTurn: 1,
    votes: {},
    ...partial,
  }
}

describe('suggestAction — terminal phases', () => {
  it('returns null in ADJOURNED', () => {
    const state = makeState({ phase: 'ADJOURNED' })
    expect(suggestAction(state, scenario)).toBeNull()
  })

  it('returns null in COLLAPSED', () => {
    const state = makeState({ phase: 'COLLAPSED' })
    expect(suggestAction(state, scenario)).toBeNull()
  })
})

describe('suggestAction — priority order', () => {
  it('1: VOTING -> ANNOUNCE_RESULT', () => {
    const state = makeState({ phase: 'VOTING', motionStack: [makeMotion()] })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'ANNOUNCE_RESULT' })
    expect(hint?.why.length).toBeGreaterThan(0)
  })

  it('2: pending INTERRUPT -> GAVEL', () => {
    const interrupt: Request = { id: 'req-int', kind: 'INTERRUPT', member: 'm2', createdTurn: 1 }
    const state = makeState({ phase: 'DEBATE', pendingRequests: [interrupt] })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'GAVEL' })
  })

  it('3: pending POINT_OF_ORDER (valid) -> RULE WELL_TAKEN, oldest first', () => {
    const older: Request = { id: 'req-poo-old', kind: 'POINT_OF_ORDER', member: 'm3', createdTurn: 1, valid: true, claim: 'first' }
    const newer: Request = { id: 'req-poo-new', kind: 'POINT_OF_ORDER', member: 'm4', createdTurn: 2, valid: false, claim: 'second' }
    const state = makeState({ phase: 'DEBATE', pendingRequests: [newer, older] })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'RULE', target: 'req-poo-old', ruling: 'WELL_TAKEN' })
  })

  it('3: pending POINT_OF_ORDER (invalid) -> RULE NOT_WELL_TAKEN', () => {
    const req: Request = { id: 'req-poo', kind: 'POINT_OF_ORDER', member: 'm3', createdTurn: 1, valid: false, claim: 'bogus' }
    const state = makeState({ phase: 'DEBATE', pendingRequests: [req] })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'RULE', target: 'req-poo', ruling: 'NOT_WELL_TAKEN' })
  })

  it('4: pending INQUIRY -> ANSWER_INQUIRY with the correct answer, oldest first', () => {
    const older: Request = {
      id: 'req-inq-old',
      kind: 'INQUIRY',
      member: 'm3',
      createdTurn: 1,
      question: 'what threshold?',
      answers: [
        { id: 'a-wrong', text: 'a plurality', correct: false },
        { id: 'a-right', text: 'a majority', correct: true },
      ],
    }
    const newer: Request = { id: 'req-inq-new', kind: 'INQUIRY', member: 'm4', createdTurn: 2, question: 'q2', answers: [] }
    const state = makeState({ phase: 'DEBATE', pendingRequests: [newer, older] })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'ANSWER_INQUIRY', target: 'req-inq-old', answer: 'a-right' })
  })

  it('5: top motion seconded && !statedByChair -> STATE_MOTION', () => {
    const state = makeState({ phase: 'MOTION_PENDING', motionStack: [makeMotion({ seconded: true, statedByChair: false })] })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'STATE_MOTION' })
  })

  it('6: top motion on stack && !seconded -> WAIT (second must come from the floor)', () => {
    const state = makeState({
      phase: 'MOTION_PENDING',
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false })],
    })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'WAIT' })
    expect(hint?.why.toLowerCase()).toContain('second')
  })

  it('7: pending RECOGNITION -> RECOGNIZE the oldest requester', () => {
    const older: Request = { id: 'req-rec-old', kind: 'RECOGNITION', member: 'm3', createdTurn: 1, purpose: 'COMMENT' }
    const newer: Request = { id: 'req-rec-new', kind: 'RECOGNITION', member: 'm4', createdTurn: 2, purpose: 'COMMENT' }
    const state = makeState({ phase: 'ITEM_OPEN', pendingRequests: [newer, older] })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'RECOGNIZE', target: 'm3' })
  })

  it('8: DEBATE with no pending requests -> CALL_VOTE VOICE', () => {
    const state = makeState({ phase: 'DEBATE', motionStack: [makeMotion({ statedByChair: true, seconded: true })] })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'CALL_VOTE', method: 'VOICE' })
  })

  it('9a: all agenda items completed -> ADJOURN', () => {
    const state = makeState({ phase: 'ITEM_OPEN', currentItem: 1, itemsCompleted: 2 })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'ADJOURN' })
  })

  it('9b: PRE_MEETING -> CALL_ITEM', () => {
    const state = makeState({ phase: 'PRE_MEETING', itemsCompleted: 0 })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'CALL_ITEM' })
  })

  it('9c: ITEM_OPEN with the current item resolved -> CALL_ITEM', () => {
    const state = makeState({ phase: 'ITEM_OPEN', currentItem: 0, itemsCompleted: 1 })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'CALL_ITEM' })
  })

  it('10: fallback -> WAIT', () => {
    const state = makeState({ phase: 'RECESS' })
    const hint = suggestAction(state, scenario)
    expect(hint?.action).toEqual({ verb: 'WAIT' })
  })
})

describe('suggestAction — safety invariant', () => {
  it('never suggests a verb that legalActions marks anything but IN_ORDER', () => {
    // No quorum: almost everything is OUT_OF_ORDER except WAIT/RECESS/ADJOURN/GAVEL.
    // A naive branch-9 CALL_ITEM suggestion in PRE_MEETING would be illegal here.
    const state = makeState({ phase: 'PRE_MEETING', quorumPresent: false, itemsCompleted: 0 })
    const hint = suggestAction(state, scenario)
    expect(hint).not.toBeNull()
    if (hint) {
      expect(legalActions(state, scenario).verbs[hint.action.verb].status).toBe('IN_ORDER')
    }
  })
})

describe('suggestAction — determinism', () => {
  it('returns the same suggestion for the same state', () => {
    const state = makeState({ phase: 'ITEM_OPEN', currentItem: 0, itemsCompleted: 1 })
    expect(suggestAction(state, scenario)).toEqual(suggestAction(state, scenario))
  })
})

describe('suggestAction — property: replaying hoa-fence-01 happy path', () => {
  it('is always IN_ORDER per legalActions at every pre-terminal state', () => {
    const s = scenarios.find((sc) => sc.id === 'hoa-fence-01')
    if (!s) throw new Error('hoa-fence-01 missing')

    let state: MeetingState = initMeeting(s, 20260817)
    const checkPreTerminal = (st: MeetingState) => {
      if (st.phase === 'ADJOURNED' || st.phase === 'COLLAPSED') return
      const hint = suggestAction(st, s)
      expect(hint).not.toBeNull()
      if (hint) {
        expect(legalActions(st, s).verbs[hint.action.verb].status).toBe('IN_ORDER')
      }
    }

    checkPreTerminal(state)
    for (const action of HAPPY_PATH as Action[]) {
      state = reduce(state, action, s)
      checkPreTerminal(state)
    }
  })
})
