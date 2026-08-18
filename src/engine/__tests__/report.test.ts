import { describe, expect, it } from 'vitest'

import { initMeeting, reduce } from '../reducer'
import { buildReportCard } from '../report'
import type { MeterDelta } from '../types'
import { fixtureScenario } from './fixture'
import { makeState } from './helpers'

describe('buildReportCard', () => {
  const scenario = {
    id: 'test-scenario',
    title: 'Test Meeting',
    body: 'Test Body',
    version: '1.0.0',
    seats: 5,
    quorum: 3,
    present: ['m1', 'm2', 'm3', 'm4', 'm5'],
    parTurns: 10,
    members: [],
    agenda: [
      { id: 'item-1', title: 'Item 1', motions: [] },
      { id: 'item-2', title: 'Item 2', motions: [] },
    ],
    beats: [],
    lines: {},
  }

  describe('clean playthrough', () => {
    it('produces all A/B grades and computes overall as mean', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // Verify all grades are A or B
      expect(['A', 'B']).toContain(report.grades.procedure.grade)
      expect(['A', 'B']).toContain(report.grades.fairness.grade)
      expect(['A', 'B']).toContain(report.grades.efficiency.grade)
      expect(['A', 'B']).toContain(report.grades.clarity.grade)
      expect(['A', 'B']).toContain(report.grades.completion.grade)

      // Verify overall is mean of five
      const mean =
        (report.grades.procedure.score +
          report.grades.fairness.score +
          report.grades.efficiency.score +
          report.grades.clarity.score +
          report.grades.completion.score) /
        5
      expect(report.overall).toBe(
        mean >= 90 ? 'A' : mean >= 80 ? 'B' : mean >= 70 ? 'C' : mean >= 60 ? 'D' : 'F',
      )
    })
  })

  describe('procedure', () => {
    it('penalizes 3 out-of-order actions to D grade (score ≤ 64)', () => {
      const state = makeState({
        outOfOrderCount: 3,
        meters: { control: 95, trust: 95 },
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // 100 - 12*3 = 64
      expect(report.grades.procedure.score).toBe(64)
      expect(report.grades.procedure.grade).toBe('D')
    })

    it('penalizes invalid rulings', () => {
      const state = makeState({
        outOfOrderCount: 0,
        meterLog: [
          { turn: 1, meter: 'trust', delta: -10, reason: 'INVALID_RULING', label: 'Invalid ruling' },
          { turn: 2, meter: 'trust', delta: -10, reason: 'INVALID_RULING', label: 'Invalid ruling' },
        ],
        meters: { control: 95, trust: 95 },
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // 100 - 8*2 = 84
      expect(report.grades.procedure.score).toBe(84)
      expect(report.grades.procedure.grade).toBe('B')
    })
  })

  describe('fairness', () => {
    it('reflects the new formula: 100 - 2*(70-trust) - 5*selectiveRecognitionCount', () => {
      const state = makeState({
        meters: { control: 95, trust: 75 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // 100 - 2*(70-75) - 0 = 100 - (-10) = 110, clamped to 100
      expect(report.grades.fairness.score).toBe(100)
      expect(report.grades.fairness.grade).toBe('A')
    })

    it('penalizes SELECTIVE_RECOGNITION occurrences at 5 points each', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [
          {
            turn: 1,
            meter: 'trust',
            delta: -5,
            reason: 'SELECTIVE_RECOGNITION',
            label: 'Selective recognition',
          },
          {
            turn: 2,
            meter: 'trust',
            delta: -5,
            reason: 'SELECTIVE_RECOGNITION',
            label: 'Selective recognition',
          },
        ],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // 100 - 2*(70-95) - 5*2 = 100 + 50 - 10 = 140, clamped to 100
      expect(report.grades.fairness.score).toBe(100)
      expect(report.grades.fairness.grade).toBe('A')
    })

    it('scores a flawless chair (trust 70, no selective recognition) as a full 100/A', () => {
      const state = makeState({
        meters: { control: 95, trust: 70 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // 100 - 2*(70-70) - 0 = 100
      expect(report.grades.fairness.score).toBe(100)
      expect(report.grades.fairness.grade).toBe('A')
    })

    it('clamps a FAIR_RULING-boosted trust of 73 at 100, not 106', () => {
      const state = makeState({
        meters: { control: 95, trust: 73 },
        outOfOrderCount: 0,
        meterLog: [
          { turn: 1, meter: 'trust', delta: 3, reason: 'FAIR_RULING', label: 'A fair ruling, fairly delivered' },
        ],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // 100 - 2*(70-73) - 0 = 100 + 6 = 106, clamped to 100
      expect(report.grades.fairness.score).toBe(100)
      expect(report.grades.fairness.grade).toBe('A')
    })

    it('scores trust 50 with one selective recognition as 55/F', () => {
      const state = makeState({
        meters: { control: 95, trust: 50 },
        outOfOrderCount: 0,
        meterLog: [
          {
            turn: 1,
            meter: 'trust',
            delta: -5,
            reason: 'SELECTIVE_RECOGNITION',
            label: 'Selective recognition',
          },
        ],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // 100 - 2*(70-50) - 5*1 = 100 - 40 - 5 = 55
      expect(report.grades.fairness.score).toBe(55)
      expect(report.grades.fairness.grade).toBe('F')
    })
  })

  describe('efficiency', () => {
    it('penalizes turns over par', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 21, // 20 actions taken, 10 over par
      })

      const report = buildReportCard(state, scenario)

      // 100 - 4*max(0, 20-10) = 100 - 40 = 60
      expect(report.grades.efficiency.score).toBe(60)
      expect(report.grades.efficiency.grade).toBe('D')
    })

    it('awards full score when under or at par', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11, // 10 actions, at par
      })

      const report = buildReportCard(state, scenario)

      expect(report.grades.efficiency.score).toBe(100)
      expect(report.grades.efficiency.grade).toBe('A')
    })
  })

  describe('clarity', () => {
    it('gives full score when no issues', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // No unstated motions or announce delays
      expect(report.grades.clarity.score).toBe(100)
      expect(report.grades.clarity.grade).toBe('A')
    })

    it('scores a clean game 100 and says so, without hedging', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      expect(report.grades.clarity.score).toBe(100)
      expect(report.grades.clarity.notes).toContain(
        'All motions were properly stated and vote results announced promptly.',
      )
    })

    it('penalizes each out-of-order CALL_VOTE attempt 10 points', () => {
      // The real evidence of an unstated motion going to a vote: D3 makes
      // CALL_VOTE out of order on an unstated motion, so `applyCallVote` never
      // runs and no VOTE_TAKEN event ever carries statedByChair: false. What
      // the log holds is the reducer's CONFUSION event, stamped with the verb.
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 3,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
        log: [1, 2, 3].map((n) => ({
          id: `e${n}`,
          type: 'SPEECH' as const,
          actor: 'm2',
          intent: 'CONFUSION',
          payload: { memberName: 'Member Two', verb: 'CALL_VOTE' },
        })),
      })

      const report = buildReportCard(state, scenario)

      // 100 - 10*3 = 70
      expect(report.grades.clarity.score).toBe(70)
      expect(report.grades.clarity.score).toBeLessThanOrEqual(70)
      expect(report.grades.clarity.grade).toBe('C')
    })

    it('never claims all motions were stated when premature votes were attempted', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 3,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
        log: [1, 2, 3].map((n) => ({
          id: `e${n}`,
          type: 'SPEECH' as const,
          actor: 'm2',
          intent: 'CONFUSION',
          payload: { memberName: 'Member Two', verb: 'CALL_VOTE' },
        })),
      })

      const notes = buildReportCard(state, scenario).grades.clarity.notes

      expect(notes.some((n) => /properly stated/.test(n))).toBe(false)
      expect(notes.some((n) => /never been stated|premature/i.test(n))).toBe(true)
      expect(notes.some((n) => n.includes('3'))).toBe(true)
    })

    it('ignores out-of-order attempts at other verbs', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 1,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
        log: [
          {
            id: 'e1',
            type: 'SPEECH' as const,
            actor: 'm2',
            intent: 'CONFUSION',
            payload: { memberName: 'Member Two', verb: 'CALL_ITEM' },
          },
        ],
      })

      const report = buildReportCard(state, scenario)

      // Clarity is untouched — but the note must not assert a clean record
      // either, because the meeting did go out of order.
      expect(report.grades.clarity.score).toBe(100)
      expect(report.grades.clarity.notes.some((n) => /properly stated/.test(n))).toBe(false)
    })

    it('penalizes announce delays: VOTE_TAKEN at turn T, ANNOUNCE_RESULT at turn T+2', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
        log: [
          {
            id: 'e1',
            type: 'STATE_CHANGE',
            actor: 'CHAIR',
            intent: 'VOTE_TAKEN',
            payload: {
              motionId: 'motion-1',
              motionText: 'test motion',
              method: 'VOICE' as const,
              statedByChair: true,
              ayes: 3,
              noes: 1,
              abstains: 1,
              turn: 5,
            },
          },
          {
            id: 'e2',
            type: 'VOTE_RESULT',
            actor: 'CHAIR',
            intent: 'ANNOUNCE_RESULT',
            payload: {
              motionId: 'motion-1',
              motionText: 'test motion',
              ayes: 3,
              noes: 1,
              abstains: 1,
              passed: true,
              result: 'carried',
              voteTakenTurn: 5,
              turn: 7,
            },
          },
        ],
      })

      const report = buildReportCard(state, scenario)

      // 100 - 5*1 = 95
      expect(report.grades.clarity.score).toBe(95)
      expect(report.grades.clarity.grade).toBe('A')
    })

    it('combines both penalties: premature vote attempt + announce delay', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 1,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
        log: [
          {
            id: 'e0',
            type: 'SPEECH' as const,
            actor: 'm2',
            intent: 'CONFUSION',
            payload: { memberName: 'Member Two', verb: 'CALL_VOTE' },
          },
          {
            id: 'e1',
            type: 'STATE_CHANGE',
            actor: 'CHAIR',
            intent: 'VOTE_TAKEN',
            payload: {
              motionId: 'motion-1',
              motionText: 'test motion',
              method: 'VOICE' as const,
              statedByChair: true,
              ayes: 3,
              noes: 1,
              abstains: 1,
              turn: 5,
            },
          },
          {
            id: 'e2',
            type: 'VOTE_RESULT',
            actor: 'CHAIR',
            intent: 'ANNOUNCE_RESULT',
            payload: {
              motionId: 'motion-1',
              motionText: 'test motion',
              ayes: 3,
              noes: 1,
              abstains: 1,
              passed: true,
              result: 'carried',
              voteTakenTurn: 5,
              turn: 7,
            },
          },
        ],
      })

      const report = buildReportCard(state, scenario)

      // 100 - 10*1 - 5*1 = 85
      expect(report.grades.clarity.score).toBe(85)
      expect(report.grades.clarity.grade).toBe('B')
    })
  })

  // The clarity unit tests above hand-build a log. This one plays the mistake
  // for real through `reduce`, which is the only proof that the term is
  // reachable at all — the old statedByChair term never was.
  describe('clarity, played out through reduce', () => {
    it('charges three real out-of-order CALL_VOTE attempts and says so in the notes', () => {
      const sc = fixtureScenario()
      let state = initMeeting(sc, 7)
      state = reduce(state, { verb: 'CALL_ITEM' }, sc) // ITEM_OPEN, nothing moved

      for (let i = 0; i < 3; i += 1) {
        state = reduce(state, { verb: 'CALL_VOTE', method: 'VOICE' }, sc)
      }

      expect(state.outOfOrderCount).toBe(3)
      expect(state.log.filter((e) => e.intent === 'CONFUSION' && e.payload.verb === 'CALL_VOTE')).toHaveLength(3)
      // No vote was ever taken: the attempts never reached applyCallVote.
      expect(state.log.some((e) => e.intent === 'VOTE_TAKEN')).toBe(false)

      const clarity = buildReportCard(state, sc).grades.clarity
      expect(clarity.score).toBeLessThanOrEqual(70)
      expect(clarity.notes.some((n) => /never been stated|premature/i.test(n))).toBe(true)
      expect(clarity.notes.some((n) => /properly stated/.test(n))).toBe(false)
    })
  })

  describe('completion', () => {
    it('scores 50 when 1 of 2 items done', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 1,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      // 100*1/2 = 50
      expect(report.grades.completion.score).toBe(50)
      expect(report.grades.completion.grade).toBe('F')
    })

    it('scores 100 when all items done', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      expect(report.grades.completion.score).toBe(100)
      expect(report.grades.completion.grade).toBe('A')
    })
  })

  describe('pedantry', () => {
    it('generates 3–6 non-empty entries from meterLog reasons', () => {
      const deltas: MeterDelta[] = [
        { turn: 1, meter: 'control', delta: -6, reason: 'OUT_OF_ORDER_ACTION', label: 'Out of order action' },
        { turn: 2, meter: 'control', delta: -8, reason: 'UNADDRESSED_INTERRUPT', label: 'Unaddressed interrupt' },
        { turn: 3, meter: 'control', delta: -3, reason: 'HESITATION', label: 'Hesitation' },
        { turn: 4, meter: 'trust', delta: -6, reason: 'CUT_OFF_DEBATE', label: 'Cut off debate' },
      ]

      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: deltas,
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      expect(report.pedantry.length).toBeGreaterThanOrEqual(3)
      expect(report.pedantry.length).toBeLessThanOrEqual(6)
      expect(report.pedantry.every((p) => typeof p === 'string' && p.length > 0)).toBe(true)
    })

    it('renders FAIR_RULING in pedantic voice rather than leaking the meter label', () => {
      const state = makeState({
        meterLog: [{ turn: 1, meter: 'trust', delta: 3, reason: 'FAIR_RULING', label: 'A fair ruling, fairly delivered' }],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      expect(report.pedantry).toContain('The chair ruled on the point without appearing to take a side.')
      expect(report.pedantry).not.toContain('A fair ruling, fairly delivered')
    })

    it('lists one ruling once, not twice, when CORRECT_RULING and FAIR_RULING both fired', () => {
      // One sound ruling charges both keys (reducer.applyRule); the report is
      // not allowed to bill the player's ear for it twice.
      const state = makeState({
        meterLog: [
          { turn: 1, meter: 'control', delta: 4, reason: 'CORRECT_RULING', label: 'Chair\'s ruling matched the validity of the point' },
          { turn: 1, meter: 'trust', delta: 3, reason: 'FAIR_RULING', label: 'A fair ruling, fairly delivered' },
        ],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      const rulingLines = report.pedantry.filter((p) => /ruling|ruled/.test(p))
      expect(rulingLines).toEqual(['The chair made a sound procedural ruling.'])
    })

    it('handles clean games with pedantic praise', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      expect(report.pedantry.length).toBeGreaterThanOrEqual(3)
      expect(report.pedantry.length).toBeLessThanOrEqual(6)
      expect(report.pedantry.every((p) => p.length > 0)).toBe(true)
    })
  })

  describe('meterFinal', () => {
    it('includes the final control and trust meter values', () => {
      const state = makeState({
        meters: { control: 42, trust: 88 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      expect(report.meterFinal).toEqual({ control: 42, trust: 88 })
    })
  })

  describe('notes', () => {
    it('includes at least one note per grade category', () => {
      const state = makeState({
        meters: { control: 95, trust: 95 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      expect(report.grades.procedure.notes.length).toBeGreaterThanOrEqual(1)
      expect(report.grades.fairness.notes.length).toBeGreaterThanOrEqual(1)
      expect(report.grades.efficiency.notes.length).toBeGreaterThanOrEqual(1)
      expect(report.grades.clarity.notes.length).toBeGreaterThanOrEqual(1)
      expect(report.grades.completion.notes.length).toBeGreaterThanOrEqual(1)
    })
  })
})
