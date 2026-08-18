// The floor strip: who is visibly waiting on the chair, right above the buttons.
//
// Second-round playtest feedback: "the hint says somebody's had their hand up
// for a long time but I don't see anything in the interface that says anybody
// has their hand up." Pending requests existed — in the state panel, in engine
// vocabulary, behind a collapsed `<details>` on a phone. The information was
// nowhere near the point of action, so for the player it did not exist.
//
// What this component is, and is not:
//   - it is WORLD STATE: who has a hand up, who raised a point, who is talking
//     over the room. That is something a chair standing in the room can see, so
//     it renders identically in Practice and Learn (it takes no mode prop);
//   - it is NOT legality. It never says whether acting on a chip is in order,
//     and it lives entirely outside the palette's `data-verb` button set, so
//     the no-tell fingerprint (spec §4.3, palette.test.tsx) is untouched;
//   - it is NOT advice. It reports who is asking, in the order they asked. What
//     to do about them stays the Hint's job.
//
// A chip is a shortcut, not a decision. Recognizing a member is a single
// unambiguous move, so a hand chip dispatches it outright — through the same
// `onAction` path the palette uses, so the engine cannot tell the difference.
// A point of order or an inquiry ends in a *judgement*, so those chips only
// preselect the target and hand the judgement itself back to the chair.

import type { Action, MeetingState, MemberId, Request, Scenario } from '../engine/index'
import type { PaletteFocus } from './Palette'

export type FloorStripProps = {
  state: MeetingState
  scenario: Scenario
  /** True while the transcript is still staggering, or the meeting is over. */
  disabled: boolean
  onAction: (action: Action) => void
  onOpenPicker: (focus: PaletteFocus) => void
}

/** A hand goes up "· waiting 3 turns" only once it has been up a while. */
const AGE_THRESHOLD = 2

function firstName(state: MeetingState, scenario: Scenario, id: MemberId): string {
  const full =
    scenario.members.find((m) => m.id === id)?.name ?? state.members.find((m) => m.id === id)?.name ?? id
  return full.split(' ')[0]
}

function chipLabel(state: MeetingState, scenario: Scenario, request: Request): string {
  const who = firstName(state, scenario, request.member)
  switch (request.kind) {
    case 'RECOGNITION':
      return `✋ ${who}`
    case 'POINT_OF_ORDER':
      return `❗ Point of order — ${who}`
    case 'INQUIRY':
      return `❓ Question — ${who}`
    case 'INTERRUPT':
      return `🗯 ${who} (interrupting)`
  }
}

export function FloorStrip({ state, scenario, disabled, onAction, onOpenPicker }: FloorStripProps) {
  // Nothing pending is not an empty strip — it is no strip at all. A permanent
  // "nobody is waiting" row would train the player to stop reading this space.
  if (state.pendingRequests.length === 0) return null

  // Oldest first: the person who has been waiting longest reads first, which is
  // the same order the room itself is keeping track in.
  const requests = [...state.pendingRequests].sort((a, b) => a.createdTurn - b.createdTurn)

  const activate = (request: Request) => {
    switch (request.kind) {
      case 'RECOGNITION':
      case 'INTERRUPT':
        return onAction({ verb: 'RECOGNIZE', target: request.member })
      case 'POINT_OF_ORDER':
        return onOpenPicker({ kind: 'RULE', target: request.id })
      case 'INQUIRY':
        return onOpenPicker({ kind: 'ANSWER', target: request.id })
    }
  }

  return (
    <div className="floor-strip" role="group" aria-label="Waiting on the chair">
      {requests.map((request) => {
        const age = state.turn - request.createdTurn
        return (
          <button
            key={request.id}
            type="button"
            className="floor-chip"
            data-request-id={request.id}
            data-request-kind={request.kind}
            disabled={disabled}
            onClick={() => activate(request)}
          >
            {chipLabel(state, scenario, request)}
            {age >= AGE_THRESHOLD && <span className="chip-age"> · waiting {age} turns</span>}
          </button>
        )
      })}
    </div>
  )
}
