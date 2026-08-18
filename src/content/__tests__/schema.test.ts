import { describe, expect, it } from 'vitest'
import { validateScenario, type Scenario } from '../schema'

function minimalScenario(): Scenario {
  return {
    id: 'test-01',
    title: 'The Fence Variance',
    body: 'Willow Creek HOA Board',
    version: '1.0.0',
    seats: 5,
    quorum: 3,
    present: ['m1', 'm2', 'm3'],
    parTurns: 20,
    members: [
      {
        id: 'm1',
        name: 'Alice',
        archetype: 'NONE',
        objective: 'Get the fence approved',
        stances: { mo1: 'AYE' },
        lines: {},
      },
      {
        id: 'm2',
        name: 'Bob',
        archetype: 'RULES_ENTHUSIAST',
        objective: 'Keep procedure clean',
        stances: { mo1: 'NO' },
        lines: {},
      },
      {
        id: 'm3',
        name: 'Cara',
        archetype: 'NONE',
        objective: 'Stay neutral',
        stances: {},
        lines: {},
      },
    ],
    agenda: [
      {
        id: 'item1',
        title: 'Fence Variance',
        motions: [{ id: 'mo1', kind: 'MAIN', text: 'Approve the fence variance', germane: true }],
      },
    ],
    beats: [
      {
        id: 'b1',
        when: { itemIndex: 0 },
        effect: { kind: 'SECOND', member: 'm2' },
      },
    ],
    lines: {},
  } satisfies Scenario
}

describe('validateScenario', () => {
  it('accepts a minimal valid fixture', () => {
    const scenario = minimalScenario()
    expect(() => validateScenario(scenario)).not.toThrow()
    const result = validateScenario(scenario)
    expect(result.id).toBe('test-01')
    expect(result.members).toHaveLength(3)
  })

  it('throws naming the field when quorum is missing', () => {
    const scenario: Record<string, unknown> = minimalScenario()
    delete scenario.quorum
    expect(() => validateScenario(scenario)).toThrow(/quorum/)
  })

  it('throws when quorum exceeds seats', () => {
    const scenario = minimalScenario()
    scenario.quorum = scenario.seats + 1
    expect(() => validateScenario(scenario)).toThrow(/quorum/)
  })

  it('throws naming the field when a member stance references an unknown motion id', () => {
    const scenario = minimalScenario()
    scenario.members[0]!.stances = { 'not-a-real-motion': 'AYE' }
    expect(() => validateScenario(scenario)).toThrow(
      /members\[0\]\.stances.*unknown motion id "not-a-real-motion"/,
    )
  })

  it('throws naming the field when a beat references an unknown member', () => {
    const scenario = minimalScenario()
    scenario.beats = [
      { id: 'b1', when: { itemIndex: 0 }, effect: { kind: 'SECOND', member: 'ghost-member' } },
    ]
    expect(() => validateScenario(scenario)).toThrow(/beats\[0\].*unknown member id "ghost-member"/)
  })

  it('throws when a member references an unknown archetype', () => {
    const scenario: Record<string, unknown> = minimalScenario()
    const members = scenario.members as Record<string, unknown>[]
    members[0]!.archetype = 'CHAOS_GREMLIN'
    expect(() => validateScenario(scenario)).toThrow(/members\[0\]\.archetype/)
  })

  it('throws naming the field when present references an unknown member id', () => {
    const scenario = minimalScenario()
    scenario.present = ['m1', 'ghost']
    expect(() => validateScenario(scenario)).toThrow(/present\[1\].*unknown member id "ghost"/)
  })

  it('throws when a required top-level field is missing entirely', () => {
    const scenario: Record<string, unknown> = minimalScenario()
    delete scenario.title
    expect(() => validateScenario(scenario)).toThrow(/title/)
  })

  it('throws when json is not an object', () => {
    expect(() => validateScenario(null)).toThrow()
    expect(() => validateScenario('nope')).toThrow()
    expect(() => validateScenario(42)).toThrow()
  })

  it('throws naming the field when a required field has the wrong type', () => {
    const scenario: Record<string, unknown> = minimalScenario()
    scenario.seats = 'five'
    expect(() => validateScenario(scenario)).toThrow(/seats/)
  })
})
