// Checkpoint capture and restore (D10).
//
// A checkpoint is a state poised to take the turn recorded on it. Restoring
// one rewinds the meeting to that moment, nudges the RNG so the retry is not
// verbatim, and hands back the three worst things that happened since.

import { describe, expect, it } from 'vitest'

import { validateScenario } from '../../content/schema'
import type { Scenario } from '../../content/schema'
import { captureCheckpoint, restoreCheckpoint } from '../checkpoints'
import { initMeeting, reduce } from '../reducer'
import type { MeetingEvent, MeetingState, MeterDelta, Request } from '../types'
import { fixtureScenario } from './fixture'
import { makeState } from './helpers'

const scenario = fixtureScenario()

/** One item, one STABILIZER member among four NONEs, no motions/beats: just
 * enough room to let a pure stall (repeated WAIT with a pending request)
 * trigger both HESITATION every turn and, periodically, STABILIZER_RESCUE. */
function stallScenario(): Scenario {
  return validateScenario({
    id: 'stall-fixture',
    title: 'Stall Fixture Meeting',
    body: 'Stall Fixture Body',
    version: '1.0.0',
    seats: 5,
    quorum: 3,
    present: ['m1', 'm2', 'm3', 'm4', 'm5'],
    parTurns: 10,
    members: [
      { id: 'm1', name: 'M1', archetype: 'NONE', objective: 'x', stances: {}, lines: {} },
      { id: 'm2', name: 'M2', archetype: 'NONE', objective: 'x', stances: {}, lines: {} },
      { id: 'm3', name: 'M3', archetype: 'NONE', objective: 'x', stances: {}, lines: {} },
      { id: 'm4', name: 'M4', archetype: 'STABILIZER', objective: 'x', stances: {}, lines: {} },
      { id: 'm5', name: 'M5', archetype: 'NONE', objective: 'x', stances: {}, lines: {} },
    ],
    agenda: [{ id: 'item-1', title: 'Item 1', motions: [] }],
    beats: [],
    lines: {},
  })
}

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

  it('reports the three reasons with the largest negative totals since the checkpoint turn', () => {
    const { diagnostic } = restoreCheckpoint(collapsedWithHistory())
    expect(diagnostic).toHaveLength(3)
    expect(diagnostic.map((d) => d.reason)).toEqual([
      'UNADDRESSED_INTERRUPT',
      'OUT_OF_ORDER_ACTION',
      'SELECTIVE_RECOGNITION',
    ])
    expect(diagnostic.every((d) => d.total < 0)).toBe(true)
    expect(diagnostic.every((d) => d.count === 1)).toBe(true)
    expect(diagnostic.find((d) => d.reason === 'UNADDRESSED_INTERRUPT')).toMatchObject({
      total: -8,
      count: 1,
      label: expect.any(String),
    })
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
    expect(diagnostic[0]).toMatchObject({ reason: 'HESITATION', count: 1, total: -3 })
  })

  it('aggregates repeated occurrences of the same reason into one entry with a summed total', () => {
    const base = captureCheckpoint(makeState({ turn: 2 }), 'cp')
    const { diagnostic } = restoreCheckpoint({
      ...base,
      turn: 6,
      meterLog: [
        delta({ turn: 2, delta: -3, reason: 'HESITATION' }),
        delta({ turn: 3, delta: -3, reason: 'HESITATION' }),
        delta({ turn: 4, delta: -3, reason: 'HESITATION' }),
        delta({ turn: 5, delta: -4, reason: 'STABILIZER_RESCUE' }),
      ],
    })
    expect(diagnostic).toEqual([
      { reason: 'HESITATION', label: expect.any(String), count: 3, total: -9 },
      { reason: 'STABILIZER_RESCUE', label: expect.any(String), count: 1, total: -4 },
    ])
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
    expect(diagnostic.every((d) => d.total < 0)).toBe(true)

    // The restored meeting is playable again.
    const resumed = reduce(state, { verb: 'WAIT' }, scenario)
    expect(resumed.phase).toBe('ITEM_OPEN')
    expect(resumed.turn).toBe(checkpointTurn + 1)
  })

  it('surfaces HESITATION as the top-blamed reason in a pure-stall spiral, ahead of the stabilizer rescues', () => {
    // Open the item (captures a checkpoint), seed one pending request that
    // nobody ever addresses, then WAIT forever: HESITATION fires every turn
    // (-3) while STABILIZER_RESCUE fires only once every few turns (-4 each,
    // 2-turn cooldown) — so HESITATION's summed total should dominate even
    // though individual rescue deltas are larger in magnitude.
    const sc = stallScenario()
    let s = reduce(initMeeting(sc, 5), { verb: 'CALL_ITEM' }, sc)
    expect(s.checkpoints).toHaveLength(1)

    const stuckRequest: Request = { id: 'stuck-1', kind: 'RECOGNITION', member: 'm1', createdTurn: s.turn, purpose: 'DEBATE_FOR' }
    s = { ...s, pendingRequests: [...s.pendingRequests, stuckRequest] }

    while (s.phase !== 'COLLAPSED' && s.turn < 60) {
      s = reduce(s, { verb: 'WAIT' }, sc)
    }
    expect(s.phase).toBe('COLLAPSED')

    const { diagnostic } = restoreCheckpoint(s)
    expect(diagnostic[0].reason).toBe('HESITATION')
    expect(diagnostic.some((d) => d.reason === 'STABILIZER_RESCUE')).toBe(true)
    const hesitation = diagnostic.find((d) => d.reason === 'HESITATION')!
    const rescue = diagnostic.find((d) => d.reason === 'STABILIZER_RESCUE')!
    expect(hesitation.count).toBeGreaterThan(1)
    expect(Math.abs(hesitation.total)).toBeGreaterThan(Math.abs(rescue.total))
  })
})
