// Pure functional PRNG (mulberry32) so meeting state stays serializable and
// deterministic. No hidden generator object, no Math.random, no Date.now:
// the entire RNG state is the `rngState` number threaded through MeetingState.

/** Advance the generator one step. Same input always yields the same output. */
export function nextRandom(rngState: number): { value: number; rngState: number } {
  let a = (rngState + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { value, rngState: a }
}

/** Pick a uniformly random index in [0, length). Throws on a non-positive length. */
export function pickIndex(rngState: number, length: number): { index: number; rngState: number } {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error(`pickIndex: length must be a positive integer, got ${length}`)
  }
  const { value, rngState: nextState } = nextRandom(rngState)
  const index = Math.min(Math.floor(value * length), length - 1)
  return { index, rngState: nextState }
}
