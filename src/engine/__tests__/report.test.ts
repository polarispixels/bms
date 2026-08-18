import { describe, expect, it } from 'vitest'

import { buildReportCard } from '../report'
import type { MeterDelta } from '../types'
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
    it('reflects final trust meter', () => {
      const state = makeState({
        meters: { control: 95, trust: 75 },
        outOfOrderCount: 0,
        meterLog: [],
        itemsCompleted: 2,
        turn: 11,
      })

      const report = buildReportCard(state, scenario)

      expect(report.grades.fairness.score).toBe(75)
      expect(report.grades.fairness.grade).toBe('C')
    })

    it('penalizes SELECTIVE_RECOGNITION occurrences', () => {
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

      // trust 95 - 5*2 = 85
      expect(report.grades.fairness.score).toBe(85)
      expect(report.grades.fairness.grade).toBe('B')
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
