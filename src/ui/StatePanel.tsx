// Where the meeting actually stands: phase, item, floor, motion stack, queue.
//
// The motion stack is drawn as a literal stack — the main motion sits at the
// bottom of the panel and amendments pile on top of it, which is exactly how
// the engine stores it (`motionStack[0]` is the main motion) and exactly the
// mental model the player needs when deciding what can be voted on.

import type { MeetingState, MemberId, Scenario } from '../engine/index'

const PHASE_LABELS: Record<MeetingState['phase'], string> = {
  PRE_MEETING: 'Before the meeting',
  ITEM_OPEN: 'Item open',
  MOTION_PENDING: 'Motion pending',
  DEBATE: 'Debate',
  VOTING: 'Voting',
  RECESS: 'In recess',
  ADJOURNED: 'Adjourned',
  COLLAPSED: 'Collapsed',
}

const REQUEST_LABELS: Record<string, string> = {
  RECOGNITION: 'seeks the floor',
  POINT_OF_ORDER: 'point of order',
  INQUIRY: 'inquiry',
  INTERRUPT: 'talking over the room',
}

export type StatePanelProps = {
  state: MeetingState
  scenario: Scenario
}

function nameOf(state: MeetingState, id: MemberId): string {
  return state.members.find((m) => m.id === id)?.name ?? id
}

export function StatePanel({ state, scenario }: StatePanelProps) {
  const item = scenario.agenda[state.currentItem]
  const stack = [...state.motionStack].reverse() // top of stack first in the DOM

  return (
    <div className="state-panel">
      <div className="panel-row">
        <h2 className="panel-heading">The floor</h2>
        <span className="phase-badge" data-phase={state.phase}>
          {PHASE_LABELS[state.phase]}
        </span>
      </div>

      <dl className="facts">
        <dt>Item</dt>
        <dd>
          {item ? (
            <>
              <span className="fact-count">
                {state.currentItem + 1} of {scenario.agenda.length}
              </span>{' '}
              {item.title}
            </>
          ) : (
            <span className="muted">nothing before the board</span>
          )}
        </dd>
        <dt>Floor</dt>
        <dd>
          {state.floorHolder ? (
            nameOf(state, state.floorHolder)
          ) : (
            <span className="muted">nobody has the floor</span>
          )}
        </dd>
        <dt>Turn</dt>
        <dd>{state.turn}</dd>
      </dl>

      <h3 className="panel-subheading">Motion stack</h3>
      {stack.length === 0 ? (
        <p className="muted empty-stack">The floor is clear.</p>
      ) : (
        <ul className="motion-stack">
          {stack.map((motion) => (
            <li key={motion.id} className="motion" data-kind={motion.kind}>
              <div className="motion-kind">{motion.kind === 'MAIN' ? 'Main motion' : 'Amendment'}</div>
              <div className="motion-text">{motion.text}</div>
              <div className="chips">
                <span className="chip" data-on={motion.seconded}>
                  {motion.seconded ? 'seconded' : 'no second'}
                </span>
                <span className="chip" data-on={motion.statedByChair}>
                  {motion.statedByChair ? 'stated' : 'not stated'}
                </span>
                <span className="chip chip-quiet">moved by {nameOf(state, motion.mover)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="panel-subheading">Waiting on the chair</h3>
      {state.pendingRequests.length === 0 ? (
        <p className="muted">Nobody is waiting.</p>
      ) : (
        <ul className="requests">
          {state.pendingRequests.map((request) => {
            const age = state.turn - request.createdTurn
            return (
              <li key={request.id} className="request" data-kind={request.kind}>
                <span className="request-who">{nameOf(state, request.member)}</span>
                <span className="request-kind">{REQUEST_LABELS[request.kind] ?? request.kind}</span>
                <span className="request-age">
                  {age} turn{age === 1 ? '' : 's'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
