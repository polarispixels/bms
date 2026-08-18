// The two primitives every mutating engine module shares: how a pure function
// takes a private copy of the state, and how an event gets appended to the log.
//
// Extracted from reducer.ts so room.ts emits through exactly the same counter.
// Event ids must never be derived from `log.length`: checkpoint snapshots
// truncate the log to its last 20 entries (D10), so a length-derived id would
// start reissuing ids that already exist the moment a checkpoint is restored.

import type { MeetingEvent, MeetingState } from './types'

/**
 * Deep-copies the state so a reducer-style function can work imperatively
 * without ever touching the caller's object. `checkpoints` is carried by
 * reference — its entries are frozen-by-convention snapshots and callers only
 * ever replace the array (never push into it), so nothing shared is mutated.
 */
export function beginDraft(state: MeetingState): MeetingState {
  const { checkpoints, ...rest } = state
  return { ...structuredClone(rest), checkpoints }
}

/**
 * Appends an event with a monotonic, deterministic id, stamped with the turn
 * it happened on. The turn stamp is what lets later steps of the same turn ask
 * "what has already happened this turn?" without a second bookkeeping channel.
 */
export function emit(
  draft: MeetingState,
  type: MeetingEvent['type'],
  actor: MeetingEvent['actor'],
  intent: string,
  payload: Record<string, unknown> = {},
): void {
  draft.eventSeq += 1
  draft.log.push({ id: `e${draft.eventSeq}`, type, actor, intent, payload: { turn: draft.turn, ...payload } })
}

/** Events appended during the turn the state is currently taking. */
export function eventsThisTurn(state: MeetingState): MeetingEvent[] {
  return state.log.filter((e) => e.payload.turn === state.turn)
}
