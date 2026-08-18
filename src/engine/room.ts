// Room simulation — beats (D7) and archetype reactions (D6).
//
// TASK 5 PLACEHOLDER. `reduce` calls this for steps (2)-(3) of the D4 turn
// loop (beats fire, archetypes react, passive drains apply). Task 6 replaces
// this identity implementation with the real thing; the signature is the
// contract, so nothing in reducer.ts needs to change when it lands.

import type { Scenario } from '../content/schema'
import type { MeetingState } from './types'

/** Identity stub: the room does nothing yet. Replaced in Task 6. */
export function roomRespond(state: MeetingState, _scenario: Scenario): MeetingState {
  return state
}
