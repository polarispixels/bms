// Minimal inline scenario fixture for reducer/render tests.
//
// Deliberately NOT in src/content: this is a test-only rig, kept small and
// legible so reducer assertions read as arithmetic rather than content
// archaeology. One agenda item, one MAIN motion, five members whose authored
// stances tally 3 AYE / 1 NO / 1 ABSTAIN (a passing majority).
//
// Beats are empty and every archetype is NONE, so `roomRespond` (Task 6) has
// nothing to do here — these tests exercise the chair half of the turn loop in
// isolation.

import { validateScenario } from '../../content/schema'
import type { Scenario } from '../../content/schema'
import type { MemberId, Request } from '../types'

export const FIXTURE_ITEM_ID = 'item-fence'
export const FIXTURE_ITEM_TITLE = 'Fence variance request'
export const FIXTURE_MOTION_ID = 'motion-fence'
export const FIXTURE_MOTION_TEXT = 'the fence variance be approved as submitted'

/** 1 item, 5 members, one MAIN motion, no beats. Validated on the way out. */
export function fixtureScenario(): Scenario {
  const raw = {
    id: 'fixture-01',
    title: 'Fixture Board Meeting',
    body: 'Fixture Homeowners Association',
    version: '1.0.0',
    seats: 5,
    quorum: 3,
    present: ['m1', 'm2', 'm3', 'm4', 'm5'],
    parTurns: 10,
    members: [
      {
        id: 'm1',
        name: 'Member One',
        archetype: 'NONE',
        objective: 'Get the variance approved.',
        stances: { [FIXTURE_MOTION_ID]: 'AYE' },
        lines: {
          MOVE: ['I move that {motionText}.'],
          DEBATE_FOR: ['{memberName} argues the variance is overdue.'],
        },
      },
      {
        id: 'm2',
        name: 'Member Two',
        archetype: 'NONE',
        objective: 'Back the neighbours.',
        stances: { [FIXTURE_MOTION_ID]: 'AYE' },
        lines: {},
      },
      {
        id: 'm3',
        name: 'Member Three',
        archetype: 'NONE',
        objective: 'Keep things moving.',
        stances: { [FIXTURE_MOTION_ID]: 'AYE' },
        lines: {},
      },
      {
        id: 'm4',
        name: 'Member Four',
        archetype: 'NONE',
        objective: 'Defend the covenant.',
        stances: { [FIXTURE_MOTION_ID]: 'NO' },
        lines: {},
      },
      {
        id: 'm5',
        name: 'Member Five',
        archetype: 'NONE',
        objective: 'Stay out of it.',
        stances: { [FIXTURE_MOTION_ID]: 'ABSTAIN' },
        lines: {},
      },
    ],
    agenda: [
      {
        id: FIXTURE_ITEM_ID,
        title: FIXTURE_ITEM_TITLE,
        motions: [{ id: FIXTURE_MOTION_ID, kind: 'MAIN', text: FIXTURE_MOTION_TEXT, germane: true }],
      },
    ],
    beats: [],
    lines: {
      CALL_TO_ORDER: ['The chair calls the meeting to order.'],
      READ_ITEM: ['Next on the agenda: {itemTitle}.'],
      // A shared line any member without their own SECOND variant falls back to.
      SECOND: ['{memberName} seconds it.'],
    },
  }
  return validateScenario(raw)
}

/** A pending RECOGNITION whose holder will move the fixture's main motion. */
export function moveRequest(member: MemberId = 'm1', createdTurn = 1): Request {
  return {
    id: `req-move-${member}`,
    kind: 'RECOGNITION',
    member,
    createdTurn,
    purpose: 'MOVE',
    motion: {
      id: FIXTURE_MOTION_ID,
      kind: 'MAIN',
      text: FIXTURE_MOTION_TEXT,
      mover: member,
      germane: true,
      votes: {},
    },
  }
}

/** A pending RECOGNITION for a debate speech. */
export function debateRequest(
  member: MemberId,
  purpose: 'DEBATE_FOR' | 'DEBATE_AGAINST' | 'COMMENT' = 'DEBATE_FOR',
  createdTurn = 1,
): Request {
  return { id: `req-debate-${member}`, kind: 'RECOGNITION', member, createdTurn, purpose }
}
