// Checkpoint capture and restore (D10).
//
// A checkpoint is a state poised to take the turn recorded on it. Restoring
// one rewinds the meeting to that moment, nudges the RNG so the retry is not
// verbatim, and hands back the three worst things that happened since.

import { describe, expect, it } from 'vitest'

import { captureCheckpoint, restoreCheckpoint } from '../checkpoints'
import { initMeeting, reduce } from '../reducer'
import type { MeetingEvent, MeetingState, MeterDelta } from '../types'
import { fixtureScenario } from './fixture'
import { makeState } from './helpers'

const scenario = fixtureScenario()

function delta(partial: Partial<MeterDelta>): MeterDelta {
  return { turn: 1, meter: 'control', delta: -6, reason: 'OUT_OF_ORDER_ACTION', label: 'x', ...partial }
}

function filler(count: number): MeetingEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i + 1}`,
    type: 'NARRATION' as const,
    actor: 'SYSTEM' as const,
    intent: 'FILLER',
    payload: {},
  }))
}

// ---------------------------------------------------------------------------
// captureCheckpoint
// ---------------------------------------------------------------------------

describe('captureCheckpoint', () => {
  it('appends a labelled snapshot of the turn it will replay', () => {
    const before = makeState({ turn: 4 })
    const after = captureCheckpoint(before, 'Item 1: Approve the budget opened')

    expect(after.checkpoints).toHaveLength(1)
    expect(after.checkpoints[0]).toMatchObject({
      id: 'cp1',
      label: 'Item 1: Approve the budget opened',
      turn: 4,
    })
    expect(after.checkpoints[0].state.turn).toBe(4)
    expect(after.checkpoints[0].state.checkpoints).toEqual([])
  })

  it('is pure: the input state keeps its own checkpoint list', () => {
    const before = makeState()
    const snapshot = structuredClone(before)
    captureCheckpoint(before, 'label')
    expect(before).toEqual(snapshot)
  })

  it('numbers checkpoints in capture order', () => {
    let s = captureCheckpoint(makeState(), 'first')
    s = captureCheckpoint(s, 'second')
    expect(s.checkpoints.map((c) => c.id)).toEqual(['cp1', 'cp2'])
  })

  it('truncates the snapshot log to the last 20 events', () => {
    const after = captureCheckpoint(makeState({ log: filler(30), eventSeq: 30 }), 'label')
    expect(after.checkpoints[0].state.log).toHaveLength(20)
    expect(after.checkpoints[0].state.log[19].id).toBe('e30')
    expect(after.checkpoints[0].state.eventSeq).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// restoreCheckpoint
// ---------------------------------------------------------------------------

describe('restoreCheckpoint', () => {
  function collapsedWithHistory(): MeetingState {
    const base = captureCheckpoint(makeState({ turn: 3, phase: 'DEBATE' }), 'Before the vote')
    return {
      ...base,
      turn: 7,
      phase: 'COLLAPSED',
      meters: { control: 0, trust: 40 },
      meterLog: [
        delta({ turn: 1, delta: -10, reason: 'BEFORE_THE_CHECKPOINT', meter: 'trust' }),
        delta({ turn: 3, delta: -6, reason: 'OUT_OF_ORDER_ACTION' }),
        delta({ turn: 4, delta: -8, reason: 'UNADDRESSED_INTERRUPT' }),
        delta({ turn: 5, delta: 8, reason: 'GAVEL_RESTORES_ORDER' }),
        delta({ turn: 5, delta: -3, reason: 'HESITATION' }),
        delta({ turn: 6, delta: -5, reason: 'SELECTIVE_RECOGNITION', meter: 'trust' }),
      ],
    }
  }

  it('rewinds to the latest checkpoint', () => {
    const { state } = restoreCheckpoint(collapsedWithHistory())
    expect(state.turn).toBe(3)
    expect(state.phase).toBe('DEBATE')
    expect(state.meters).toEqual({ control: 70, trust: 70 })
  })

  it('advances the RNG so the retry is not a verbatim replay', () => {
    const collapsed = collapsedWithHistory()
    const { state } = restoreCheckpoint(collapsed)
    expect(state.rngState).not.toBe(collapsed.checkpoints[0].state.rngState)
  })

  it('keeps the checkpoint list so the restored meeting can rewind again', () => {
    const { state } = restoreCheckpoint(collapsedWithHistory())
    expect(state.checkpoints).toHaveLength(1)
    expect(state.checkpoints[0].id).toBe('cp1')
  })

  it('reports the three largest negative deltas since the checkpoint turn', () => {
    const { diagnostic } = restoreCheckpoint(collapsedWithHistory())
    expect(diagnostic).toHaveLength(3)
    expect(diagnostic.map((d) => d.reason)).toEqual([
      'UNADDRESSED_INTERRUPT',
      'OUT_OF_ORDER_ACTION',
      'SELECTIVE_RECOGNITION',
    ])
    expect(diagnostic.every((d) => d.delta < 0)).toBe(true)
    expect(diagnostic.map((d) => d.reason)).not.toContain('BEFORE_THE_CHECKPOINT')
    expect(diagnostic.map((d) => d.reason)).not.toContain('GAVEL_RESTORES_ORDER')
  })

  it('reports fewer than three when fewer things went wrong', () => {
    const base = captureCheckpoint(makeState({ turn: 2 }), 'cp')
    const { diagnostic } = restoreCheckpoint({
      ...base,
      turn: 3,
      meterLog: [delta({ turn: 2, delta: -3, reason: 'HESITATION' })],
    })
    expect(diagnostic).toHaveLength(1)
    expect(diagnostic[0].reason).toBe('HESITATION')
  })

  it('returns the state untouched when there is nothing to rewind to', () => {
    const state = makeState({ phase: 'COLLAPSED' })
    const result = restoreCheckpoint(state)
    expect(result.state).toEqual(state)
    expect(result.diagnostic).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// End to end: collapse and rewind through the reducer
// ---------------------------------------------------------------------------

describe('collapse and rewind', () => {
  it('rewinds a collapsed meeting to the last checkpoint with a short diagnosis', () => {
    // Open the first item (captures a checkpoint), then flail until control
    // runs out.
    let s = reduce(initMeeting(scenario, 11), { verb: 'CALL_ITEM' }, scenario)
    expect(s.checkpoints).toHaveLength(1)
    const checkpointTurn = s.checkpoints[0].turn

    while (s.phase !== 'COLLAPSED' && s.turn < 40) {
      s = reduce(s, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    }
    expect(s.phase).toBe('COLLAPSED')

    const { state, diagnostic } = restoreCheckpoint(s)
    expect(state.phase).toBe('ITEM_OPEN')
    expect(state.turn).toBe(checkpointTurn)
    expect(state.meters.control).toBeGreaterThan(0)
    expect(diagnostic.length).toBeGreaterThan(0)
    expect(diagnostic.length).toBeLessThanOrEqual(3)
    expect(diagnostic.every((d) => d.delta < 0 && d.turn >= checkpointTurn)).toBe(true)

    // The restored meeting is playable again.
    const resumed = reduce(state, { verb: 'WAIT' }, scenario)
    expect(resumed.phase).toBe('ITEM_OPEN')
    expect(resumed.turn).toBe(checkpointTurn + 1)
  })
})
