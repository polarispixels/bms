// Checkpoint capture, restore and collapse diagnosis (D10).
//
// Consistent semantics for every boundary: **a checkpoint holds a state that is
// poised to take a turn.** `checkpoint.turn` and `snapshot.state.turn` are the
// turn number that will be played when the checkpoint is restored, never a turn
// whose action is already baked into the snapshot. Callers must therefore
// capture either before applying the turn's action (the pre-vote boundary) or
// after the turn counter advances (the item boundary).

import { DELTAS } from './meters'
import { nextRandom } from './rng'
import type { Checkpoint, MeetingState } from './types'

/** Snapshot log budget: enough transcript to re-read the room, not the meeting. */
const CHECKPOINT_LOG_LIMIT = 20

/** How many things the collapse screen blames (D10). */
const DIAGNOSTIC_LIMIT = 3

/** One reason's aggregated toll since the checkpoint: how often, and how much. */
export type DiagnosticEntry = {
  reason: string
  label: string
  count: number
  total: number
}

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
 * The worst things that happened since the checkpoint was taken: every reason
 * with a negative net total since `sinceTurn`, aggregated across occurrences
 * (count + summed total), sorted by |total| descending, top 3. Aggregating
 * this way is the point — ten small hesitations that add up to -30 outweigh
 * three -4 stabilizer rescues, and magnitude-sorting individual deltas used to
 * hide that (D10 tuning, T9b). Ties keep the reason's first-occurrence order
 * (Array.prototype.sort is stable).
 */
function diagnose(state: MeetingState, sinceTurn: number): DiagnosticEntry[] {
  const totals = new Map<string, { count: number; total: number }>()
  for (const d of state.meterLog) {
    if (d.turn < sinceTurn) continue
    const entry = totals.get(d.reason) ?? { count: 0, total: 0 }
    entry.count += 1
    entry.total += d.delta
    totals.set(d.reason, entry)
  }

  const entries: DiagnosticEntry[] = []
  for (const [reason, { count, total }] of totals) {
    if (total >= 0) continue
    entries.push({ reason, label: DELTAS[reason]?.label ?? reason, count, total })
  }

  return entries.sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, DIAGNOSTIC_LIMIT)
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
export function restoreCheckpoint(state: MeetingState): { state: MeetingState; diagnostic: DiagnosticEntry[] } {
  const checkpoint = state.checkpoints[state.checkpoints.length - 1]
  if (!checkpoint) return { state, diagnostic: [] }

  const restored: MeetingState = {
    ...structuredClone(checkpoint.state),
    checkpoints: state.checkpoints,
    rngState: nextRandom(checkpoint.state.rngState).rngState,
  }
  return { state: restored, diagnostic: diagnose(state, checkpoint.turn) }
}
