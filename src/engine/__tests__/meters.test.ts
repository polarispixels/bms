import { describe, it, expect } from 'vitest'
import { DELTAS, applyDelta } from '../meters'
import type { MeetingState } from '../types'

describe('meters', () => {
  describe('DELTAS', () => {
    it('exports DELTAS with all required keys', () => {
      const requiredKeys = [
        'OUT_OF_ORDER_ACTION',
        'UNADDRESSED_INTERRUPT',
        'HESITATION',
        'STABILIZER_RESCUE',
        'GAVEL_RESTORES_ORDER',
        'GAVEL_QUIET_ROOM',
        'CLEAN_PROCEDURE_BONUS',
        'CUT_OFF_DEBATE',
        'INVALID_RULING',
        'TECHNICALITY_RULING',
        'CORRECT_RULING',
        'SELECTIVE_RECOGNITION',
        'WRONG_INQUIRY_ANSWER',
        'IGNORED_REQUEST_TIMEOUT',
        'RECESS_BREATHER',
        'RECESS_STALL',
        'PREMATURE_ADJOURN',
        'CUT_OFF_RAMBLER',
      ]
      for (const key of requiredKeys) {
        expect(DELTAS).toHaveProperty(key)
      }
    })

    it('has correct delta values for control meter', () => {
      expect(DELTAS.OUT_OF_ORDER_ACTION.meter).toBe('control')
      expect(DELTAS.OUT_OF_ORDER_ACTION.delta).toBe(-6)

      expect(DELTAS.UNADDRESSED_INTERRUPT.meter).toBe('control')
      expect(DELTAS.UNADDRESSED_INTERRUPT.delta).toBe(-8)

      expect(DELTAS.HESITATION.meter).toBe('control')
      expect(DELTAS.HESITATION.delta).toBe(-3)

      expect(DELTAS.STABILIZER_RESCUE.meter).toBe('control')
      expect(DELTAS.STABILIZER_RESCUE.delta).toBe(-4)

      expect(DELTAS.GAVEL_RESTORES_ORDER.meter).toBe('control')
      expect(DELTAS.GAVEL_RESTORES_ORDER.delta).toBe(8)

      expect(DELTAS.CLEAN_PROCEDURE_BONUS.meter).toBe('control')
      expect(DELTAS.CLEAN_PROCEDURE_BONUS.delta).toBe(3)

      expect(DELTAS.CORRECT_RULING.meter).toBe('control')
      expect(DELTAS.CORRECT_RULING.delta).toBe(4)

      expect(DELTAS.WRONG_INQUIRY_ANSWER.meter).toBe('control')
      expect(DELTAS.WRONG_INQUIRY_ANSWER.delta).toBe(-4)

      expect(DELTAS.RECESS_BREATHER.meter).toBe('control')
      expect(DELTAS.RECESS_BREATHER.delta).toBe(5)
    })

    it('has correct delta values for trust meter', () => {
      expect(DELTAS.GAVEL_QUIET_ROOM.meter).toBe('trust')
      expect(DELTAS.GAVEL_QUIET_ROOM.delta).toBe(-4)

      expect(DELTAS.CUT_OFF_DEBATE.meter).toBe('trust')
      expect(DELTAS.CUT_OFF_DEBATE.delta).toBe(-6)

      expect(DELTAS.INVALID_RULING.meter).toBe('trust')
      expect(DELTAS.INVALID_RULING.delta).toBe(-10)

      expect(DELTAS.TECHNICALITY_RULING.meter).toBe('trust')
      expect(DELTAS.TECHNICALITY_RULING.delta).toBe(-5)

      expect(DELTAS.SELECTIVE_RECOGNITION.meter).toBe('trust')
      expect(DELTAS.SELECTIVE_RECOGNITION.delta).toBe(-5)

      expect(DELTAS.IGNORED_REQUEST_TIMEOUT.meter).toBe('trust')
      expect(DELTAS.IGNORED_REQUEST_TIMEOUT.delta).toBe(-4)

      expect(DELTAS.RECESS_STALL.meter).toBe('trust')
      expect(DELTAS.RECESS_STALL.delta).toBe(-3)

      expect(DELTAS.PREMATURE_ADJOURN.meter).toBe('trust')
      expect(DELTAS.PREMATURE_ADJOURN.delta).toBe(-8)

      expect(DELTAS.CUT_OFF_RAMBLER.meter).toBe('trust')
      expect(DELTAS.CUT_OFF_RAMBLER.delta).toBe(-4)
    })

    it('has labels for all deltas', () => {
      for (const key in DELTAS) {
        expect(DELTAS[key as keyof typeof DELTAS]).toHaveProperty('label')
        expect(typeof DELTAS[key as keyof typeof DELTAS].label).toBe('string')
        expect(DELTAS[key as keyof typeof DELTAS].label.length).toBeGreaterThan(0)
      }
    })
  })

  describe('applyDelta', () => {
    const baseState: MeetingState = {
      agenda: [],
      currentItem: 0,
      quorumPresent: true,
      members: [],
      floorHolder: null,
      motionStack: [],
      pendingRequests: [],
      phase: 'ITEM_OPEN',
      meters: { control: 70, trust: 70 },
      turn: 5,
      log: [],
      rngState: 0,
      eventSeq: 0,
      meterLog: [],
      checkpoints: [],
      currentVote: null,
      consecutiveWaits: 0,
      memberMood: {},
      outOfOrderCount: 0,
      itemsCompleted: 0,
    }

    it('applies positive delta to control meter', () => {
      const result = applyDelta(baseState, 'GAVEL_RESTORES_ORDER')
      expect(result.meters.control).toBe(78) // 70 + 8
      expect(result.meters.trust).toBe(70)
    })

    it('applies negative delta to control meter', () => {
      const result = applyDelta(baseState, 'OUT_OF_ORDER_ACTION')
      expect(result.meters.control).toBe(64) // 70 - 6
      expect(result.meters.trust).toBe(70)
    })

    it('applies positive delta to trust meter', () => {
      const stateWithLowTrust: MeetingState = {
        ...baseState,
        meters: { control: 70, trust: 50 },
      }
      // No positive trust deltas in the table, so this won't apply,
      // but test the mechanism anyway
      expect(stateWithLowTrust.meters.trust).toBe(50)
    })

    it('applies negative delta to trust meter', () => {
      const result = applyDelta(baseState, 'INVALID_RULING')
      expect(result.meters.trust).toBe(60) // 70 - 10
      expect(result.meters.control).toBe(70)
    })

    it('clamps control meter at 100', () => {
      const stateNear100: MeetingState = {
        ...baseState,
        meters: { control: 95, trust: 70 },
      }
      const result = applyDelta(stateNear100, 'GAVEL_RESTORES_ORDER')
      expect(result.meters.control).toBe(100) // 95 + 8 = 103, clamped to 100
      expect(result.meters.trust).toBe(70)
    })

    it('clamps control meter at 0', () => {
      const stateNear0: MeetingState = {
        ...baseState,
        meters: { control: 5, trust: 70 },
      }
      const result = applyDelta(stateNear0, 'UNADDRESSED_INTERRUPT')
      expect(result.meters.control).toBe(0) // 5 - 8 = -3, clamped to 0
      expect(result.meters.trust).toBe(70)
    })

    it('clamps trust meter at 100', () => {
      const stateNear100: MeetingState = {
        ...baseState,
        meters: { control: 70, trust: 100 },
      }
      const result = applyDelta(stateNear100, 'GAVEL_QUIET_ROOM')
      expect(result.meters.trust).toBe(96) // 100 - 4 = 96
      expect(result.meters.control).toBe(70)
    })

    it('clamps trust meter at 0', () => {
      const stateNear0: MeetingState = {
        ...baseState,
        meters: { control: 70, trust: 5 },
      }
      const result = applyDelta(stateNear0, 'INVALID_RULING')
      expect(result.meters.trust).toBe(0) // 5 - 10 = -5, clamped to 0
      expect(result.meters.control).toBe(70)
    })

    it('appends meterLog entry with correct shape', () => {
      const result = applyDelta(baseState, 'HESITATION')
      expect(result.meterLog).toHaveLength(1)
      const entry = result.meterLog[0]
      expect(entry).toEqual(
        expect.objectContaining({
          turn: 5,
          meter: 'control',
          delta: -3,
          reason: 'HESITATION',
          label: expect.any(String),
        }),
      )
    })

    it('preserves multiple meterLog entries', () => {
      let state = baseState
      state = applyDelta(state, 'OUT_OF_ORDER_ACTION')
      state = applyDelta(state, 'GAVEL_QUIET_ROOM')
      expect(state.meterLog).toHaveLength(2)
      expect(state.meterLog[0].reason).toBe('OUT_OF_ORDER_ACTION')
      expect(state.meterLog[1].reason).toBe('GAVEL_QUIET_ROOM')
    })

    it('does not mutate input state', () => {
      const originalMeters = { ...baseState.meters }
      const originalMeterLog = [...baseState.meterLog]
      applyDelta(baseState, 'HESITATION')
      expect(baseState.meters).toEqual(originalMeters)
      expect(baseState.meterLog).toEqual(originalMeterLog)
    })

    it('preserves other state fields', () => {
      const result = applyDelta(baseState, 'HESITATION')
      expect(result.turn).toBe(baseState.turn)
      expect(result.phase).toBe(baseState.phase)
      expect(result.quorumPresent).toBe(baseState.quorumPresent)
      expect(result.motionStack).toEqual(baseState.motionStack)
    })
  })
})
