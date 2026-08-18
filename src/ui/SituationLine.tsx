// One line of plain English for "where are we?".
//
// The state panel already had the facts, but it spoke engine and, on a phone,
// it sat collapsed behind a summary. This is the same information in the voice
// of a clerk answering a question, pinned where the chair is looking.
//
// All the wording lives in the engine (`describeSituation`) so it is unit
// tested, deterministic, and shared with the CLI. This component is a frame
// around a string — deliberately dumb, and deliberately never advice.

import { describeSituation } from '../engine/index'
import type { MeetingState, Scenario } from '../engine/index'

export type SituationLineProps = {
  state: MeetingState
  scenario: Scenario
}

export function SituationLine({ state, scenario }: SituationLineProps) {
  return (
    <section className="situation" aria-label="Where the meeting stands">
      <h2 className="situation-label">The floor</h2>
      <p className="situation-text">{describeSituation(state, scenario)}</p>
    </section>
  )
}
