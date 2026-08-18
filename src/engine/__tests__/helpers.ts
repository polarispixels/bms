// Shared test builder for MeetingState. Produces a valid Level-1-shaped
// 5-member state with sensible defaults, overridable via a partial.
// Deliberately dependency-light (types only) so later tasks (reducer, room,
// report) can reuse it without pulling in reducer/room logic.

import type { AgendaItem, MeetingState, Member } from '../types'

function defaultAgenda(): AgendaItem[] {
  return [
    { id: 'item-1', title: 'Approve the budget', motions: [] },
    { id: 'item-2', title: 'Fence variance request', motions: [] },
  ]
}

function defaultMembers(): Member[] {
  return [
    { id: 'm1', name: 'Member One', archetype: 'NONE', present: true },
    { id: 'm2', name: 'Member Two', archetype: 'NONE', present: true },
    { id: 'm3', name: 'Member Three', archetype: 'NONE', present: true },
    { id: 'm4', name: 'Member Four', archetype: 'NONE', present: true },
    { id: 'm5', name: 'Member Five', archetype: 'NONE', present: true },
  ]
}

/**
 * Builds a valid Level-1-shaped MeetingState with sensible defaults:
 * phase ITEM_OPEN, meters 70/70, quorumPresent true, empty stacks/requests,
 * turn 1, five present members, a two-item agenda. Pass `partial` to
 * override any field (shallow merge).
 */
export function makeState(partial?: Partial<MeetingState>): MeetingState {
  const members = defaultMembers()
  const memberMood: MeetingState['memberMood'] = {}
  for (const member of members) {
    memberMood[member.id] = { impatience: 0, timesRecognized: 0 }
  }

  const defaults: MeetingState = {
    agenda: defaultAgenda(),
    currentItem: 0,
    quorumPresent: true,
    members,
    floorHolder: null,
    motionStack: [],
    pendingRequests: [],
    phase: 'ITEM_OPEN',
    meters: { control: 70, trust: 70 },
    turn: 1,
    log: [],

    rngState: 1,
    meterLog: [],
    checkpoints: [],
    currentVote: null,
    consecutiveWaits: 0,
    memberMood,
    outOfOrderCount: 0,
    itemsCompleted: 0,
  }

  return { ...defaults, ...partial }
}
