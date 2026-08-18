// describeSituation: the plain-language "what is happening right now" line.
//
// Playtest feedback (round two): "it's still just not clear at all what's
// happening". The state panel spoke engine jargon and was collapsed behind a
// summary on a phone. This module is the sentence a clerk would say if you
// leaned over and asked "where are we?" — and nothing more than that.
//
// The hard boundary these tests defend is spec §2 principle 2 (react, don't
// grade): describing the room is allowed everywhere, recommending a move is
// only ever the Hint's job. The last describe block is the guard.

import { describe, expect, it } from 'vitest'
import { describeSituation } from '../situation'
import { fixtureScenario, FIXTURE_ITEM_TITLE, FIXTURE_MOTION_TEXT } from './fixture'
import { makeState } from './helpers'
import type { MeetingState, Motion, Request } from '../types'

const scenario = fixtureScenario()

function motion(partial?: Partial<Motion>): Motion {
  return {
    id: 'motion-fence',
    kind: 'MAIN',
    text: FIXTURE_MOTION_TEXT,
    mover: 'm1',
    seconded: false,
    secondedBy: null,
    germane: true,
    statedByChair: false,
    debateSpeeches: 0,
    movedTurn: 1,
    votes: {},
    ...partial,
  }
}

function request(partial: Partial<Request> & Pick<Request, 'kind'>): Request {
  return {
    id: `req-${partial.kind}-${partial.member ?? 'm1'}`,
    member: 'm1',
    createdTurn: 1,
    ...partial,
  } as Request
}

/** The agenda the fixture scenario carries, so item lookups line up. */
function state(partial?: Partial<MeetingState>): MeetingState {
  return makeState({ agenda: scenario.agenda, ...partial })
}

describe('describeSituation — phases', () => {
  it('describes a board that has not started yet', () => {
    expect(describeSituation(state({ phase: 'PRE_MEETING' }), scenario)).toBe(
      'The board is seated. The meeting has not been called to order.',
    )
  })

  it('names the item on the floor when no motion has been made', () => {
    expect(describeSituation(state({ phase: 'ITEM_OPEN' }), scenario)).toBe(
      `Before the board: ${FIXTURE_ITEM_TITLE}. No motion has been made.`,
    )
  })

  it('says so once the board has finished with the item', () => {
    expect(describeSituation(state({ phase: 'ITEM_OPEN', itemsCompleted: 1 }), scenario)).toBe(
      `The board has finished with ${FIXTURE_ITEM_TITLE}. Nothing else is before it yet.`,
    )
  })

  it('names the mover and the words of an unseconded motion', () => {
    const s = state({ phase: 'MOTION_PENDING', motionStack: [motion()] })
    expect(describeSituation(s, scenario)).toBe(
      `Member One has moved: “${FIXTURE_MOTION_TEXT}”. The motion has no second yet — a second must come from the floor.`,
    )
  })

  it('marks a seconded motion the room has not heard stated', () => {
    const s = state({ phase: 'MOTION_PENDING', motionStack: [motion({ seconded: true, secondedBy: 'm2' })] })
    expect(describeSituation(s, scenario)).toBe(
      'The motion has been moved and seconded. The room has not heard it stated from the chair.',
    )
  })

  it('reports a motion that has been moved, seconded and stated', () => {
    const s = state({
      phase: 'MOTION_PENDING',
      motionStack: [motion({ seconded: true, secondedBy: 'm2', statedByChair: true })],
    })
    expect(describeSituation(s, scenario)).toBe(`The motion before the board: “${FIXTURE_MOTION_TEXT}”.`)
  })

  it('opens debate on the words of the motion, with no hands clause at zero', () => {
    const s = state({
      phase: 'DEBATE',
      motionStack: [motion({ seconded: true, secondedBy: 'm2', statedByChair: true })],
    })
    expect(describeSituation(s, scenario)).toBe(`Debate is open on the motion: “${FIXTURE_MOTION_TEXT}”.`)
  })

  it('waits on the announcement while the vote is unannounced', () => {
    const s = state({
      phase: 'VOTING',
      motionStack: [motion({ seconded: true, secondedBy: 'm2', statedByChair: true })],
      currentVote: {
        method: 'VOICE',
        ayes: 3,
        noes: 1,
        abstains: 1,
        passed: true,
        motionId: 'motion-fence',
        announced: false,
      },
    })
    expect(describeSituation(s, scenario)).toBe('The vote has been taken. The result has not been announced.')
  })

  it('falls back to a plain line when the vote is already announced', () => {
    const s = state({
      phase: 'VOTING',
      currentVote: {
        method: 'VOICE',
        ayes: 3,
        noes: 1,
        abstains: 1,
        passed: true,
        motionId: 'motion-fence',
        announced: true,
      },
    })
    expect(describeSituation(s, scenario)).toBe('The board is voting on the motion.')
  })

  it('has a one-liner for recess', () => {
    expect(describeSituation(state({ phase: 'RECESS' }), scenario)).toBe(
      'The board is in recess. Business is suspended until the chair calls it back.',
    )
  })

  it('has a one-liner for adjournment', () => {
    expect(describeSituation(state({ phase: 'ADJOURNED' }), scenario)).toBe(
      'The meeting stands adjourned. Nothing further is before the board.',
    )
  })

  it('has a one-liner for collapse', () => {
    expect(describeSituation(state({ phase: 'COLLAPSED' }), scenario)).toBe(
      'The room is talking over itself. The chair no longer has the meeting.',
    )
  })

  it('says nothing is before the board when there is no item', () => {
    expect(describeSituation(state({ phase: 'ITEM_OPEN', currentItem: 9 }), scenario)).toBe(
      'Nothing is before the board.',
    )
  })
})

describe('describeSituation — pending requests', () => {
  it('counts raised hands during debate', () => {
    const s = state({
      phase: 'DEBATE',
      motionStack: [motion({ seconded: true, secondedBy: 'm2', statedByChair: true })],
      pendingRequests: [
        request({ kind: 'RECOGNITION', member: 'm2', id: 'r1' }),
        request({ kind: 'RECOGNITION', member: 'm3', id: 'r2' }),
      ],
    })
    expect(describeSituation(s, scenario)).toBe(
      `Debate is open on the motion: “${FIXTURE_MOTION_TEXT}”. 2 hands are up.`,
    )
  })

  it('uses the singular for a single hand', () => {
    const s = state({ pendingRequests: [request({ kind: 'RECOGNITION', member: 'm2', id: 'r1' })] })
    expect(describeSituation(s, scenario)).toContain('One hand is up.')
  })

  it('flags a pending point of order', () => {
    const s = state({ pendingRequests: [request({ kind: 'POINT_OF_ORDER', member: 'm4', id: 'r1' })] })
    expect(describeSituation(s, scenario)).toBe(
      `Before the board: ${FIXTURE_ITEM_TITLE}. No motion has been made. A point of order is pending.`,
    )
  })

  it('flags a waiting inquiry', () => {
    const s = state({ pendingRequests: [request({ kind: 'INQUIRY', member: 'm4', id: 'r1' })] })
    expect(describeSituation(s, scenario)).toContain('A question is waiting for the chair.')
  })

  it('flags someone speaking out of turn', () => {
    const s = state({ pendingRequests: [request({ kind: 'INTERRUPT', member: 'm4', id: 'r1' })] })
    expect(describeSituation(s, scenario)).toContain('Someone is speaking without being recognized.')
  })

  it('pluralises points and questions', () => {
    const s = state({
      pendingRequests: [
        request({ kind: 'POINT_OF_ORDER', member: 'm4', id: 'r1' }),
        request({ kind: 'POINT_OF_ORDER', member: 'm5', id: 'r2' }),
      ],
    })
    expect(describeSituation(s, scenario)).toContain('2 points of order are pending.')
  })

  it('composes clauses in urgency order and never runs past two of them', () => {
    const s = state({
      pendingRequests: [
        request({ kind: 'RECOGNITION', member: 'm2', id: 'r1' }),
        request({ kind: 'INQUIRY', member: 'm3', id: 'r2' }),
        request({ kind: 'POINT_OF_ORDER', member: 'm4', id: 'r3' }),
        request({ kind: 'INTERRUPT', member: 'm5', id: 'r4' }),
      ],
    })
    expect(describeSituation(s, scenario)).toBe(
      `Before the board: ${FIXTURE_ITEM_TITLE}. No motion has been made. Someone is speaking without being recognized. A point of order is pending.`,
    )
  })

  it('adds no clauses once the meeting is over', () => {
    const pendingRequests = [request({ kind: 'POINT_OF_ORDER', member: 'm4', id: 'r1' })]
    expect(describeSituation(state({ phase: 'ADJOURNED', pendingRequests }), scenario)).toBe(
      'The meeting stands adjourned. Nothing further is before the board.',
    )
    expect(describeSituation(state({ phase: 'COLLAPSED', pendingRequests }), scenario)).toBe(
      'The room is talking over itself. The chair no longer has the meeting.',
    )
  })
})

describe('describeSituation — purity and register', () => {
  it('is deterministic and leaves the state alone', () => {
    const s = state({ phase: 'DEBATE', motionStack: [motion({ seconded: true, statedByChair: true })] })
    const before = JSON.stringify(s)
    expect(describeSituation(s, scenario)).toBe(describeSituation(s, scenario))
    expect(JSON.stringify(s)).toBe(before)
  })

  // The line describes; it never advises. Advice belongs to the Hint alone.
  it('never tells the chair what to do', () => {
    const phases: MeetingState['phase'][] = [
      'PRE_MEETING',
      'ITEM_OPEN',
      'MOTION_PENDING',
      'DEBATE',
      'VOTING',
      'RECESS',
      'ADJOURNED',
      'COLLAPSED',
    ]
    const kinds: Request['kind'][] = ['RECOGNITION', 'POINT_OF_ORDER', 'INQUIRY', 'INTERRUPT']

    for (const phase of phases) {
      for (const kind of kinds) {
        for (const stack of [[], [motion()], [motion({ seconded: true, statedByChair: true })]]) {
          const line = describeSituation(
            state({ phase, motionStack: stack, pendingRequests: [request({ kind, id: 'r1' })] }),
            scenario,
          )
          expect(line.toLowerCase()).not.toContain('you should')
          expect(line.toLowerCase()).not.toContain('the chair should')
          expect(line).not.toMatch(/\bshould\b/i)
          expect(line).not.toMatch(/\byou\b/i)
          expect(line).not.toMatch(/\brecommend/i)
          expect(line.endsWith('.')).toBe(true)
        }
      }
    }
  })
})
