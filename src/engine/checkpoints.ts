// Checkpoint capture, restore and collapse diagnosis (D10).
//
// Consistent semantics for every boundary: **a checkpoint holds a state that is
// poised to take a turn.** `checkpoint.turn` and `snapshot.state.turn` are the
// turn number that will be played when the checkpoint is restored, never a turn
// whose action is already baked into the snapshot. Callers must therefore
// capture either before applying the turn's action (the pre-vote boundary) or
// after the turn counter advances (the item boundary).

import { nextRandom } from './rng'
import type { Checkpoint, MeetingState, MeterDelta } from './types'

/** Snapshot log budget: enough transcript to re-read the room, not the meeting. */
const CHECKPOINT_LOG_LIMIT = 20

/** How many things the collapse screen blames (D10). */
const DIAGNOSTIC_LIMIT = 3

/**
 * Returns a new state with `label` captured as a restore point. Pure: the
 * input's checkpoint list is untouched.
 *
 * The snapshot stores `checkpoints: []` (a checkpoint never nests its own
 * history) and keeps only the last 20 log entries. `eventSeq` rides along
 * unchanged, so a restored meeting keeps issuing fresh event ids instead of
 * reusing ids the truncation dropped.
 */
export function captureCheckpoint(state: MeetingState, label: string): MeetingState {
  const { checkpoints: _ignored, ...rest } = state
  const snapshot: MeetingState = { ...structuredClone(rest), checkpoints: [] }
  snapshot.log = snapshot.log.slice(-CHECKPOINT_LOG_LIMIT)

  const entry: Checkpoint = {
    id: `cp${state.checkpoints.length + 1}`,
    label,
    turn: state.turn,
    state: snapshot,
  }
  return { ...state, checkpoints: [...state.checkpoints, entry] }
}

/**
 * The worst things that happened since the checkpoint was taken: the three
 * largest-magnitude *negative* meter deltas from `meterLog`, biggest first.
 * Ties keep chronological order (Array.prototype.sort is stable).
 */
function diagnose(state: MeetingState, sinceTurn: number): MeterDelta[] {
  return state.meterLog
    .filter((d) => d.turn >= sinceTurn && d.delta < 0)
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, DIAGNOSTIC_LIMIT)
}

/**
 * Rewinds to the most recent checkpoint (D1/D10) and explains what went wrong
 * since it was taken.
 *
 * The restored state carries the *current* checkpoint list, so a second
 * collapse can rewind again, and its RNG is advanced one step so the retry
 * narrates differently instead of replaying verbatim. With nothing to rewind
 * to, the state comes back untouched and the diagnosis is empty — a collapse
 * on turn one is not a crash.
 */
export function restoreCheckpoint(state: MeetingState): { state: MeetingState; diagnostic: MeterDelta[] } {
  const checkpoint = state.checkpoints[state.checkpoints.length - 1]
  if (!checkpoint) return { state, diagnostic: [] }

  const restored: MeetingState = {
    ...structuredClone(checkpoint.state),
    checkpoints: state.checkpoints,
    rngState: nextRandom(checkpoint.state.rngState).rngState,
  }
  return { state: restored, diagnostic: diagnose(state, checkpoint.turn) }
}
