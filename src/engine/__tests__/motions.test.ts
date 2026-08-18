import { describe, it, expect } from 'vitest'
import { pushMotion, topMotion, popMotion, isDebatable, voteThreshold } from '../motions'
import type { Motion } from '../types'

describe('motions', () => {
  describe('pushMotion', () => {
    it('pushes a motion onto empty stack', () => {
      const m: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'Do something',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const result = pushMotion([], m)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(m)
    })

    it('pushes MAIN motion below existing MAIN', () => {
      const main1: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'First',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const main2: Motion = {
        id: 'main2',
        kind: 'MAIN',
        text: 'Second',
        mover: 'bob',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const stack = [main1]
      const result = pushMotion(stack, main2)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(main2) // new main at bottom
      expect(result[1]).toEqual(main1) // old main pushed up
    })

    it('pushes AMEND above MAIN', () => {
      const main: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'Do something',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const amend: Motion = {
        id: 'amend1',
        kind: 'AMEND',
        text: 'Change to something else',
        mover: 'bob',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const result = pushMotion([main], amend)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(main) // main stays at bottom
      expect(result[1]).toEqual(amend) // amend on top
    })

    it('throws when AMEND pushed on empty stack', () => {
      const amend: Motion = {
        id: 'amend1',
        kind: 'AMEND',
        text: 'Change it',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      expect(() => pushMotion([], amend)).toThrow()
    })

    it('throws when depth exceeds 3', () => {
      const motions: Motion[] = [
        {
          id: 'main1',
          kind: 'MAIN',
          text: 'Main',
          mover: 'alice',
          seconded: false,
          secondedBy: null,
          germane: true,
          statedByChair: false,
          debateSpeeches: 0,
          movedTurn: 1,
          votes: {},
        },
        {
          id: 'amend1',
          kind: 'AMEND',
          text: 'Amend 1',
          mover: 'bob',
          seconded: false,
          secondedBy: null,
          germane: true,
          statedByChair: false,
          debateSpeeches: 0,
          movedTurn: 1,
          votes: {},
        },
        {
          id: 'amend2',
          kind: 'AMEND',
          text: 'Amend 2',
          mover: 'charlie',
          seconded: false,
          secondedBy: null,
          germane: true,
          statedByChair: false,
          debateSpeeches: 0,
          movedTurn: 1,
          votes: {},
        },
      ]
      const newMotion: Motion = {
        id: 'amend3',
        kind: 'AMEND',
        text: 'Amend 3',
        mover: 'dave',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      expect(() => pushMotion(motions, newMotion)).toThrow()
    })

    it('does not mutate input', () => {
      const stack: Motion[] = [
        {
          id: 'main1',
          kind: 'MAIN',
          text: 'Main',
          mover: 'alice',
          seconded: false,
          secondedBy: null,
          germane: true,
          statedByChair: false,
          debateSpeeches: 0,
          movedTurn: 1,
          votes: {},
        },
      ]
      const m: Motion = {
        id: 'amend1',
        kind: 'AMEND',
        text: 'Amend',
        mover: 'bob',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const originalLength = stack.length
      pushMotion(stack, m)
      expect(stack).toHaveLength(originalLength)
    })
  })

  describe('topMotion', () => {
    it('returns null on empty stack', () => {
      expect(topMotion([])).toBeNull()
    })

    it('returns top motion', () => {
      const m: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'Do something',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const stack = [m]
      expect(topMotion(stack)).toEqual(m)
    })

    it('returns highest motion on multi-element stack', () => {
      const main: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'Main',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const amend: Motion = {
        id: 'amend1',
        kind: 'AMEND',
        text: 'Amend',
        mover: 'bob',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      expect(topMotion([main, amend])).toEqual(amend)
    })
  })

  describe('popMotion', () => {
    it('throws on empty stack', () => {
      expect(() => popMotion([])).toThrow()
    })

    it('pops top motion', () => {
      const m: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'Do something',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const result = popMotion([m])
      expect(result.stack).toHaveLength(0)
      expect(result.popped).toEqual(m)
    })

    it('pops top amendment, keeps main', () => {
      const main: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'Main',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const amend: Motion = {
        id: 'amend1',
        kind: 'AMEND',
        text: 'Amend',
        mover: 'bob',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      const result = popMotion([main, amend])
      expect(result.stack).toHaveLength(1)
      expect(result.stack[0]).toEqual(main)
      expect(result.popped).toEqual(amend)
    })

    it('does not mutate input', () => {
      const stack: Motion[] = [
        {
          id: 'main1',
          kind: 'MAIN',
          text: 'Main',
          mover: 'alice',
          seconded: false,
          secondedBy: null,
          germane: true,
          statedByChair: false,
          debateSpeeches: 0,
          movedTurn: 1,
          votes: {},
        },
      ]
      const originalLength = stack.length
      popMotion(stack)
      expect(stack).toHaveLength(originalLength)
    })
  })

  describe('isDebatable', () => {
    it('returns true for MAIN motion', () => {
      const m: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'Do something',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      expect(isDebatable(m)).toBe(true)
    })

    it('returns true for AMEND motion', () => {
      const m: Motion = {
        id: 'amend1',
        kind: 'AMEND',
        text: 'Change it',
        mover: 'bob',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      expect(isDebatable(m)).toBe(true)
    })
  })

  describe('voteThreshold', () => {
    it('returns MAJORITY for MAIN motion', () => {
      const m: Motion = {
        id: 'main1',
        kind: 'MAIN',
        text: 'Do something',
        mover: 'alice',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      expect(voteThreshold(m)).toBe('MAJORITY')
    })

    it('returns MAJORITY for AMEND motion', () => {
      const m: Motion = {
        id: 'amend1',
        kind: 'AMEND',
        text: 'Change it',
        mover: 'bob',
        seconded: false,
        secondedBy: null,
        germane: true,
        statedByChair: false,
        debateSpeeches: 0,
        movedTurn: 1,
        votes: {},
      }
      expect(voteThreshold(m)).toBe('MAJORITY')
    })
  })
})
