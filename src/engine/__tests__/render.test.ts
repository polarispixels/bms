import { describe, expect, it } from 'vitest'

import { renderEvent } from '../render'
import type { MeetingEvent } from '../types'
import { FIXTURE_MOTION_TEXT, fixtureScenario } from './fixture'

const scenario = fixtureScenario()

function event(partial: Partial<MeetingEvent>): MeetingEvent {
  return { id: 'e1', type: 'NARRATION', actor: 'SYSTEM', intent: 'FILLER', payload: {}, ...partial }
}

describe('renderEvent', () => {
  it('renders an authored member line with payload slots filled', () => {
    const { line } = renderEvent(
      event({ type: 'SPEECH', actor: 'm1', intent: 'MOVE', payload: { motionText: FIXTURE_MOTION_TEXT } }),
      scenario,
      1,
    )
    expect(line).toBe(`I move that ${FIXTURE_MOTION_TEXT}.`)
  })

  it('fills {memberName} from the scenario when the payload omits it', () => {
    const { line } = renderEvent(event({ type: 'SPEECH', actor: 'm1', intent: 'DEBATE_FOR' }), scenario, 1)
    expect(line).toContain('Member One')
  })

  it('renders non-member actors from scenario.lines', () => {
    const { line } = renderEvent(event({ actor: 'CHAIR', intent: 'CALL_TO_ORDER' }), scenario, 1)
    expect(line).toBe('The chair calls the meeting to order.')
  })

  it('falls back to a built-in neutral line when the intent has no authored variants', () => {
    const { line } = renderEvent(
      event({ type: 'SPEECH', actor: 'm4', intent: 'CONFUSION', payload: { memberName: 'Member Four' } }),
      scenario,
      1,
    )
    expect(line.length).toBeGreaterThan(0)
    expect(line).not.toContain('{')
  })

  it('never crashes on an unknown intent or a missing payload slot', () => {
    const { line } = renderEvent(event({ intent: 'TOTALLY_UNKNOWN_INTENT' }), scenario, 1)
    expect(typeof line).toBe('string')
    expect(line.length).toBeGreaterThan(0)
    expect(line).not.toContain('{')
  })

  it('renders vote results from the payload', () => {
    const { line } = renderEvent(
      event({
        type: 'VOTE_RESULT',
        actor: 'CHAIR',
        intent: 'ANNOUNCE_RESULT',
        payload: { ayes: 3, noes: 1, abstains: 1, passed: true, motionText: FIXTURE_MOTION_TEXT },
      }),
      scenario,
      1,
    )
    expect(line).toContain('3')
    expect(line).toContain('1')
  })

  it('is deterministic for a given rngState and threads the generator forward', () => {
    const first = renderEvent(event({ actor: 'CHAIR', intent: 'CALL_TO_ORDER' }), scenario, 42)
    const again = renderEvent(event({ actor: 'CHAIR', intent: 'CALL_TO_ORDER' }), scenario, 42)
    expect(first).toEqual(again)
    expect(first.rngState).not.toBe(42)
  })

  it('leaves rngState untouched when there is nothing to pick between', () => {
    const { rngState } = renderEvent(event({ intent: 'TOTALLY_UNKNOWN_INTENT' }), scenario, 42)
    expect(rngState).toBe(42)
  })
})
