import { describe, expect, it } from 'vitest'
import { nextRandom, pickIndex } from '../rng'

describe('nextRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const seed = 12345
    const seqA: number[] = []
    let stateA = seed
    for (let i = 0; i < 5; i++) {
      const { value, rngState } = nextRandom(stateA)
      seqA.push(value)
      stateA = rngState
    }

    const seqB: number[] = []
    let stateB = seed
    for (let i = 0; i < 5; i++) {
      const { value, rngState } = nextRandom(stateB)
      seqB.push(value)
      stateB = rngState
    }

    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const { value: valueA } = nextRandom(1)
    const { value: valueB } = nextRandom(2)
    expect(valueA).not.toBe(valueB)
  })

  it('returns values in [0, 1)', () => {
    let state = 999
    for (let i = 0; i < 100; i++) {
      const { value, rngState } = nextRandom(state)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      state = rngState
    }
  })

  it('is a pure function (same input always yields same output)', () => {
    const first = nextRandom(42)
    const second = nextRandom(42)
    expect(first).toEqual(second)
  })

  it('advances state so consecutive calls differ', () => {
    const first = nextRandom(7)
    const second = nextRandom(first.rngState)
    expect(first.value).not.toBe(second.value)
  })
})

describe('pickIndex', () => {
  it('returns an index within [0, length)', () => {
    let state = 55
    for (let i = 0; i < 50; i++) {
      const { index, rngState } = pickIndex(state, 7)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(7)
      state = rngState
    }
  })

  it('is deterministic for a given seed and length', () => {
    const a = pickIndex(321, 10)
    const b = pickIndex(321, 10)
    expect(a).toEqual(b)
  })

  it('advances rngState', () => {
    const { rngState } = pickIndex(321, 10)
    expect(rngState).not.toBe(321)
  })

  it('handles length 1 by always returning index 0', () => {
    const { index } = pickIndex(123, 1)
    expect(index).toBe(0)
  })
})
