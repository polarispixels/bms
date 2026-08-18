import { describe, expect, it } from 'vitest'
import type { Scenario } from '../../content/schema'
import { legalActions } from '../legality'
import type { Motion, Phase, Request } from '../types'
import { makeState } from './helpers'

// legalActions doesn't read from scenario for Level 1 (D2: "the state fields
// you read"), but the signature takes one, so build a minimal stand-in.
const scenario = {} as Scenario

function makeMotion(partial?: Partial<Motion>): Motion {
  return {
    id: 'main-1',
    kind: 'MAIN',
    text: 'Approve the budget as presented',
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

function makeRequest(partial?: Partial<Request>): Request {
  return {
    id: 'req-1',
    kind: 'POINT_OF_ORDER',
    member: 'm2',
    createdTurn: 1,
    ...partial,
  }
}

const ACTIVE_PHASES: Phase[] = ['PRE_MEETING', 'ITEM_OPEN', 'MOTION_PENDING', 'DEBATE', 'VOTING', 'RECESS']
const TERMINAL_PHASES: Phase[] = ['ADJOURNED', 'COLLAPSED']

describe('legalActions', () => {
  // -------------------------------------------------------------------------
  // Terminal phases: every verb is OUT_OF_ORDER once the meeting is over.
  // -------------------------------------------------------------------------
  describe('terminal phases', () => {
    it.each(TERMINAL_PHASES)('every verb is OUT_OF_ORDER in %s', (phase) => {
      const report = legalActions(makeState({ phase }), scenario)
      for (const verb of Object.keys(report.verbs) as Array<keyof typeof report.verbs>) {
        expect(report.verbs[verb].status, `${verb} in ${phase}`).toBe('OUT_OF_ORDER')
      }
    })
  })

  // -------------------------------------------------------------------------
  // CALL_ITEM row
  // -------------------------------------------------------------------------
  describe('CALL_ITEM', () => {
    it('is IN_ORDER in PRE_MEETING (call to order + first item)', () => {
      const report = legalActions(makeState({ phase: 'PRE_MEETING' }), scenario)
      expect(report.verbs.CALL_ITEM.status).toBe('IN_ORDER')
    })

    it('is IN_ORDER in ITEM_OPEN when the current item is resolved', () => {
      const state = makeState({ phase: 'ITEM_OPEN', currentItem: 0, itemsCompleted: 1 })
      expect(legalActions(state, scenario).verbs.CALL_ITEM.status).toBe('IN_ORDER')
    })

    it('is OUT_OF_ORDER in ITEM_OPEN when the current item is not resolved', () => {
      const state = makeState({ phase: 'ITEM_OPEN', currentItem: 0, itemsCompleted: 0 })
      expect(legalActions(state, scenario).verbs.CALL_ITEM.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in MOTION_PENDING', () => {
      const state = makeState({ phase: 'MOTION_PENDING', motionStack: [makeMotion()] })
      expect(legalActions(state, scenario).verbs.CALL_ITEM.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in DEBATE', () => {
      const state = makeState({ phase: 'DEBATE', motionStack: [makeMotion({ statedByChair: true })] })
      expect(legalActions(state, scenario).verbs.CALL_ITEM.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in VOTING', () => {
      const state = makeState({ phase: 'VOTING', motionStack: [makeMotion({ statedByChair: true })] })
      expect(legalActions(state, scenario).verbs.CALL_ITEM.status).toBe('OUT_OF_ORDER')
    })

    it('is IN_ORDER in RECESS (resume)', () => {
      const state = makeState({ phase: 'RECESS' })
      expect(legalActions(state, scenario).verbs.CALL_ITEM.status).toBe('IN_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // RECOGNIZE row
  // -------------------------------------------------------------------------
  describe('RECOGNIZE', () => {
    it('is OUT_OF_ORDER in PRE_MEETING', () => {
      expect(legalActions(makeState({ phase: 'PRE_MEETING' }), scenario).verbs.RECOGNIZE.status).toBe(
        'OUT_OF_ORDER',
      )
    })

    it('is IN_ORDER in ITEM_OPEN', () => {
      expect(legalActions(makeState({ phase: 'ITEM_OPEN' }), scenario).verbs.RECOGNIZE.status).toBe('IN_ORDER')
    })

    it('is IN_ORDER in MOTION_PENDING', () => {
      const state = makeState({ phase: 'MOTION_PENDING', motionStack: [makeMotion()] })
      expect(legalActions(state, scenario).verbs.RECOGNIZE.status).toBe('IN_ORDER')
    })

    it('is IN_ORDER in DEBATE', () => {
      const state = makeState({ phase: 'DEBATE', motionStack: [makeMotion({ statedByChair: true })] })
      expect(legalActions(state, scenario).verbs.RECOGNIZE.status).toBe('IN_ORDER')
    })

    it('is OUT_OF_ORDER in VOTING', () => {
      expect(legalActions(makeState({ phase: 'VOTING' }), scenario).verbs.RECOGNIZE.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in RECESS', () => {
      expect(legalActions(makeState({ phase: 'RECESS' }), scenario).verbs.RECOGNIZE.status).toBe('OUT_OF_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // STATE_MOTION row (+ binding clarification override)
  // -------------------------------------------------------------------------
  describe('STATE_MOTION', () => {
    it('is OUT_OF_ORDER in PRE_MEETING', () => {
      expect(legalActions(makeState({ phase: 'PRE_MEETING' }), scenario).verbs.STATE_MOTION.status).toBe(
        'OUT_OF_ORDER',
      )
    })

    it('is OUT_OF_ORDER in ITEM_OPEN', () => {
      expect(legalActions(makeState({ phase: 'ITEM_OPEN' }), scenario).verbs.STATE_MOTION.status).toBe(
        'OUT_OF_ORDER',
      )
    })

    it('is IN_ORDER in MOTION_PENDING when the top motion IS seconded (binding clarification)', () => {
      const state = makeState({
        phase: 'MOTION_PENDING',
        motionStack: [makeMotion({ seconded: true, secondedBy: 'm2' })],
      })
      expect(legalActions(state, scenario).verbs.STATE_MOTION.status).toBe('IN_ORDER')
    })

    it('is OUT_OF_ORDER in MOTION_PENDING when the top motion is NOT seconded, with a "not seconded" why', () => {
      const state = makeState({ phase: 'MOTION_PENDING', motionStack: [makeMotion({ seconded: false })] })
      const report = legalActions(state, scenario)
      expect(report.verbs.STATE_MOTION.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.STATE_MOTION.why.toLowerCase()).toContain('not been seconded')
    })

    it('is RISKY in DEBATE (already stated; would just restate it)', () => {
      const state = makeState({ phase: 'DEBATE', motionStack: [makeMotion({ statedByChair: true, seconded: true })] })
      const report = legalActions(state, scenario)
      expect(report.verbs.STATE_MOTION.status).toBe('RISKY')
      expect(report.verbs.STATE_MOTION.why.toLowerCase()).toContain('restat')
    })

    it('is OUT_OF_ORDER in VOTING', () => {
      expect(legalActions(makeState({ phase: 'VOTING' }), scenario).verbs.STATE_MOTION.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in RECESS', () => {
      expect(legalActions(makeState({ phase: 'RECESS' }), scenario).verbs.STATE_MOTION.status).toBe('OUT_OF_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // RULE row
  // -------------------------------------------------------------------------
  describe('RULE', () => {
    it.each(ACTIVE_PHASES)('is IN_ORDER in %s when a point of order is pending', (phase) => {
      const state = makeState({ phase, pendingRequests: [makeRequest({ kind: 'POINT_OF_ORDER' })] })
      expect(legalActions(state, scenario).verbs.RULE.status).toBe('IN_ORDER')
    })

    it.each(ACTIVE_PHASES)('is OUT_OF_ORDER in %s when no point of order is pending', (phase) => {
      const state = makeState({ phase, pendingRequests: [] })
      expect(legalActions(state, scenario).verbs.RULE.status).toBe('OUT_OF_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // ANSWER_INQUIRY row
  // -------------------------------------------------------------------------
  describe('ANSWER_INQUIRY', () => {
    it.each(ACTIVE_PHASES)('is IN_ORDER in %s when an inquiry is pending', (phase) => {
      const state = makeState({ phase, pendingRequests: [makeRequest({ kind: 'INQUIRY' })] })
      expect(legalActions(state, scenario).verbs.ANSWER_INQUIRY.status).toBe('IN_ORDER')
    })

    it.each(ACTIVE_PHASES)('is OUT_OF_ORDER in %s when no inquiry is pending', (phase) => {
      const state = makeState({ phase, pendingRequests: [] })
      expect(legalActions(state, scenario).verbs.ANSWER_INQUIRY.status).toBe('OUT_OF_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // CALL_VOTE row (+ overrides)
  // -------------------------------------------------------------------------
  describe('CALL_VOTE', () => {
    it('is OUT_OF_ORDER in PRE_MEETING', () => {
      expect(legalActions(makeState({ phase: 'PRE_MEETING' }), scenario).verbs.CALL_VOTE.status).toBe(
        'OUT_OF_ORDER',
      )
    })

    it('is OUT_OF_ORDER in ITEM_OPEN', () => {
      expect(legalActions(makeState({ phase: 'ITEM_OPEN' }), scenario).verbs.CALL_VOTE.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in MOTION_PENDING (unstated/unseconded) -- override: unstated motion', () => {
      const state = makeState({ phase: 'MOTION_PENDING', motionStack: [makeMotion({ seconded: false })] })
      const report = legalActions(state, scenario)
      expect(report.verbs.CALL_VOTE.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.CALL_VOTE.why.toLowerCase()).toContain('stated')
    })

    it('is IN_ORDER in DEBATE with a stated motion and no pending recognitions', () => {
      const state = makeState({
        phase: 'DEBATE',
        motionStack: [makeMotion({ statedByChair: true, seconded: true })],
      })
      expect(legalActions(state, scenario).verbs.CALL_VOTE.status).toBe('IN_ORDER')
    })

    it('override: is OUT_OF_ORDER in DEBATE when the motion was never stated by the chair', () => {
      const state = makeState({
        phase: 'DEBATE',
        motionStack: [makeMotion({ statedByChair: false, seconded: true })],
      })
      const report = legalActions(state, scenario)
      expect(report.verbs.CALL_VOTE.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.CALL_VOTE.why.toLowerCase()).toContain('stated')
    })

    it('override: is RISKY in DEBATE when RECOGNITION requests are pending (cutting off debate)', () => {
      const state = makeState({
        phase: 'DEBATE',
        motionStack: [makeMotion({ statedByChair: true, seconded: true })],
        pendingRequests: [makeRequest({ kind: 'RECOGNITION', purpose: 'DEBATE_FOR' })],
      })
      const report = legalActions(state, scenario)
      expect(report.verbs.CALL_VOTE.status).toBe('RISKY')
      expect(report.verbs.CALL_VOTE.why.toLowerCase()).toContain('recogni')
    })

    it('is OUT_OF_ORDER in VOTING (already voting)', () => {
      expect(legalActions(makeState({ phase: 'VOTING' }), scenario).verbs.CALL_VOTE.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in RECESS', () => {
      expect(legalActions(makeState({ phase: 'RECESS' }), scenario).verbs.CALL_VOTE.status).toBe('OUT_OF_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // ANNOUNCE_RESULT row
  // -------------------------------------------------------------------------
  describe('ANNOUNCE_RESULT', () => {
    it.each(ACTIVE_PHASES.filter((p) => p !== 'VOTING'))('is OUT_OF_ORDER in %s', (phase) => {
      expect(legalActions(makeState({ phase }), scenario).verbs.ANNOUNCE_RESULT.status).toBe('OUT_OF_ORDER')
    })

    it('is IN_ORDER in VOTING', () => {
      expect(legalActions(makeState({ phase: 'VOTING' }), scenario).verbs.ANNOUNCE_RESULT.status).toBe('IN_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // GAVEL row (+ override: quiet room)
  // -------------------------------------------------------------------------
  describe('GAVEL', () => {
    it.each(['PRE_MEETING', 'ITEM_OPEN', 'MOTION_PENDING', 'DEBATE', 'VOTING'] as Phase[])(
      'is IN_ORDER in %s when an INTERRUPT is pending',
      (phase) => {
        const state = makeState({ phase, pendingRequests: [makeRequest({ kind: 'INTERRUPT' })] })
        expect(legalActions(state, scenario).verbs.GAVEL.status).toBe('IN_ORDER')
      },
    )

    it.each(['PRE_MEETING', 'ITEM_OPEN', 'MOTION_PENDING', 'DEBATE', 'VOTING'] as Phase[])(
      'override: is RISKY in %s when the room is quiet ("gaveling a quiet room")',
      (phase) => {
        const state = makeState({ phase, pendingRequests: [] })
        const report = legalActions(state, scenario)
        expect(report.verbs.GAVEL.status).toBe('RISKY')
        expect(report.verbs.GAVEL.why.toLowerCase()).toContain('quiet')
      },
    )

    it('is OUT_OF_ORDER in RECESS', () => {
      expect(legalActions(makeState({ phase: 'RECESS' }), scenario).verbs.GAVEL.status).toBe('OUT_OF_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // RECESS row (verb)
  // -------------------------------------------------------------------------
  describe('RECESS (verb)', () => {
    it.each(['PRE_MEETING', 'ITEM_OPEN', 'MOTION_PENDING', 'DEBATE'] as Phase[])('is RISKY in %s', (phase) => {
      expect(legalActions(makeState({ phase }), scenario).verbs.RECESS.status).toBe('RISKY')
    })

    it('is OUT_OF_ORDER in VOTING', () => {
      expect(legalActions(makeState({ phase: 'VOTING' }), scenario).verbs.RECESS.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in RECESS (already in recess)', () => {
      expect(legalActions(makeState({ phase: 'RECESS' }), scenario).verbs.RECESS.status).toBe('OUT_OF_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // ADJOURN row (+ overrides: business remaining vs all done)
  // -------------------------------------------------------------------------
  describe('ADJOURN', () => {
    it('is RISKY in PRE_MEETING (nothing done)', () => {
      expect(legalActions(makeState({ phase: 'PRE_MEETING' }), scenario).verbs.ADJOURN.status).toBe('RISKY')
    })

    it('override: is RISKY in ITEM_OPEN when business remains', () => {
      const state = makeState({ phase: 'ITEM_OPEN', itemsCompleted: 0 })
      const report = legalActions(state, scenario)
      expect(report.verbs.ADJOURN.status).toBe('RISKY')
      expect(report.verbs.ADJOURN.why.toLowerCase()).toContain('business')
    })

    it('override: is IN_ORDER in ITEM_OPEN when all agenda items are completed', () => {
      const state = makeState({ phase: 'ITEM_OPEN', itemsCompleted: 2 }) // 2 == default agenda length
      expect(legalActions(state, scenario).verbs.ADJOURN.status).toBe('IN_ORDER')
    })

    it('is OUT_OF_ORDER in MOTION_PENDING', () => {
      const state = makeState({ phase: 'MOTION_PENDING', motionStack: [makeMotion()] })
      expect(legalActions(state, scenario).verbs.ADJOURN.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in DEBATE', () => {
      const state = makeState({ phase: 'DEBATE', motionStack: [makeMotion({ statedByChair: true })] })
      expect(legalActions(state, scenario).verbs.ADJOURN.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in VOTING', () => {
      expect(legalActions(makeState({ phase: 'VOTING' }), scenario).verbs.ADJOURN.status).toBe('OUT_OF_ORDER')
    })

    it('is OUT_OF_ORDER in RECESS', () => {
      expect(legalActions(makeState({ phase: 'RECESS' }), scenario).verbs.ADJOURN.status).toBe('OUT_OF_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // WAIT row
  // -------------------------------------------------------------------------
  describe('WAIT', () => {
    it.each(ACTIVE_PHASES)('is IN_ORDER in %s', (phase) => {
      expect(legalActions(makeState({ phase }), scenario).verbs.WAIT.status).toBe('IN_ORDER')
    })
  })

  // -------------------------------------------------------------------------
  // No-quorum override
  // -------------------------------------------------------------------------
  describe('no quorum override', () => {
    it('marks CALL_ITEM, RECOGNIZE, STATE_MOTION, RULE, ANSWER_INQUIRY, CALL_VOTE, and ANNOUNCE_RESULT OUT_OF_ORDER', () => {
      const state = makeState({ phase: 'ITEM_OPEN', quorumPresent: false })
      const report = legalActions(state, scenario)
      expect(report.verbs.CALL_ITEM.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.RECOGNIZE.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.STATE_MOTION.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.RULE.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.ANSWER_INQUIRY.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.CALL_VOTE.status).toBe('OUT_OF_ORDER')
      expect(report.verbs.ANNOUNCE_RESULT.status).toBe('OUT_OF_ORDER')
    })

    it('leaves WAIT IN_ORDER', () => {
      const state = makeState({ phase: 'ITEM_OPEN', quorumPresent: false })
      expect(legalActions(state, scenario).verbs.WAIT.status).toBe('IN_ORDER')
    })

    it('makes RECESS RISKY', () => {
      const state = makeState({ phase: 'ITEM_OPEN', quorumPresent: false })
      expect(legalActions(state, scenario).verbs.RECESS.status).toBe('RISKY')
    })

    it('makes ADJOURN IN_ORDER', () => {
      const state = makeState({ phase: 'ITEM_OPEN', quorumPresent: false })
      expect(legalActions(state, scenario).verbs.ADJOURN.status).toBe('IN_ORDER')
    })

    it('makes GAVEL RISKY', () => {
      const state = makeState({ phase: 'ITEM_OPEN', quorumPresent: false })
      expect(legalActions(state, scenario).verbs.GAVEL.status).toBe('RISKY')
    })
  })

  // -------------------------------------------------------------------------
  // targets
  // -------------------------------------------------------------------------
  describe('targets', () => {
    it('recognize lists all present members', () => {
      const state = makeState()
      const report = legalActions(state, scenario)
      expect(report.targets.recognize.sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
    })

    it('recognize excludes members who are not present', () => {
      const state = makeState({
        members: [
          { id: 'm1', name: 'Member One', archetype: 'NONE', present: true },
          { id: 'm2', name: 'Member Two', archetype: 'NONE', present: false },
        ],
      })
      const report = legalActions(state, scenario)
      expect(report.targets.recognize).toEqual(['m1'])
    })

    it('rule lists pending POINT_OF_ORDER request ids only', () => {
      const state = makeState({
        pendingRequests: [
          makeRequest({ id: 'poo-1', kind: 'POINT_OF_ORDER' }),
          makeRequest({ id: 'inq-1', kind: 'INQUIRY' }),
          makeRequest({ id: 'poo-2', kind: 'POINT_OF_ORDER' }),
        ],
      })
      const report = legalActions(state, scenario)
      expect(report.targets.rule.sort()).toEqual(['poo-1', 'poo-2'])
    })

    it('answer lists pending INQUIRY request ids only', () => {
      const state = makeState({
        pendingRequests: [
          makeRequest({ id: 'poo-1', kind: 'POINT_OF_ORDER' }),
          makeRequest({ id: 'inq-1', kind: 'INQUIRY' }),
          makeRequest({ id: 'inq-2', kind: 'INQUIRY' }),
        ],
      })
      const report = legalActions(state, scenario)
      expect(report.targets.answer.sort()).toEqual(['inq-1', 'inq-2'])
    })
  })
})
