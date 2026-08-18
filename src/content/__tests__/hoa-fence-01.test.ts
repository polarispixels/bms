// Level 1 integration test: the authored scenario driven through the real
// engine, twice.
//
// (a) Happy path — a scripted chair who does the job properly gets to
//     ADJOURNED with both agenda items completed and a report card of B or
//     better.
// (b) Sabotage — a chair who stalls and calls votes on nothing drives control
//     to zero, and the collapse rewinds to a checkpoint inside item 2 with a
//     diagnostic of at most three decisions.
//
// Everything here goes through the public engine API; nothing reaches into
// engine internals. The action script is the interesting artefact: it is the
// meeting we intend the content to produce.

import { describe, expect, it } from 'vitest'
import { buildReportCard, initMeeting, legalActions, reduce, restoreCheckpoint } from '../../engine'
import type { Action, MeetingState } from '../../engine'
import { renderEvent } from '../../engine/render'
import { scenarios } from '../index'
import type { Scenario } from '../schema'

const SEED = 20260817

const GRADE_ORDER = ['F', 'D', 'C', 'B', 'A'] as const

function scenario(): Scenario {
  const found = scenarios.find((s) => s.id === 'hoa-fence-01')
  if (!found) throw new Error('hoa-fence-01 is not exported from src/content')
  return found
}

function play(actions: Action[]): MeetingState {
  const s = scenario()
  let state = initMeeting(s, SEED)
  for (const action of actions) {
    state = reduce(state, action, s)
  }
  return state
}

/** Every log line rendered, for the readability assertions. */
function transcript(state: MeetingState, s: Scenario): string[] {
  let rng = SEED
  const lines: string[] = []
  for (const event of state.log) {
    const rendered = renderEvent(event, s, rng)
    rng = rendered.rngState
    lines.push(rendered.line)
  }
  return lines
}

/**
 * The scripted good meeting. Turn numbers in the comments are 1-based and
 * match `state.turn` while the action is being applied.
 */
export const HAPPY_PATH: Action[] = [
  { verb: 'CALL_ITEM' }, //                                     1  order; item 1 opens
  { verb: 'RECOGNIZE', target: 'ruth' }, //                      2  Ruth moves the minutes
  { verb: 'STATE_MOTION' }, //                                   3  chair states the question
  { verb: 'CALL_VOTE', method: 'VOICE' }, //                     4  voice vote
  { verb: 'ANNOUNCE_RESULT' }, //                                5  minutes approved
  { verb: 'CALL_ITEM' }, //                                      6  item 2: the fence variance
  { verb: 'RECOGNIZE', target: 'carl' }, //                      7  Carl moves the variance
  { verb: 'STATE_MOTION' }, //                                   8  stated, so debate is open
  { verb: 'RECOGNIZE', target: 'hal' }, //                       9  the Veteran gets his 2019 story
  { verb: 'GAVEL' }, //                                         10  Dee talked over the room
  { verb: 'RECOGNIZE', target: 'ruth' }, //                     11  debate FOR
  { verb: 'ANSWER_INQUIRY', target: 'beat-i2-inquiry', answer: 'a-majority' }, // 12  "a majority"
  { verb: 'GAVEL' }, //                                         13  Dee again, dealt with at once
  { verb: 'RULE', target: 'beat-i2-point-of-order', ruling: 'NOT_WELL_TAKEN' }, // 14  Hal's bogus point
  { verb: 'RECOGNIZE', target: 'bev' }, //                      15  debate AGAINST
  { verb: 'CALL_VOTE', method: 'VOICE' }, //                    16  the question is put
  { verb: 'ANNOUNCE_RESULT' }, //                               17  carried, 3 to 2
  { verb: 'ADJOURN' }, //                                       18
]

describe('hoa-fence-01 content', () => {
  it('is exported, validated, and shaped the way Level 1 needs', () => {
    const s = scenario()
    expect(s.parTurns).toBe(22)
    expect(s.seats).toBe(5)
    expect(s.quorum).toBe(3)
    expect(s.present).toHaveLength(5)
    expect(s.agenda).toHaveLength(2)
    expect(s.agenda[1].veteranBait).toBe(true)

    const archetypes = s.members.map((m) => m.archetype)
    expect(archetypes).toEqual(
      expect.arrayContaining(['RULES_ENTHUSIAST', 'VETERAN', 'INTERRUPTER', 'STABILIZER', 'NONE']),
    )
    // Every member has an objective that explains their vote, and nobody is mute.
    for (const member of s.members) {
      expect(member.objective.length).toBeGreaterThan(20)
      expect(Object.keys(member.lines).length).toBeGreaterThan(0)
      for (const [intent, variants] of Object.entries(member.lines)) {
        expect(variants.length, `${member.id}.${intent} must not be empty`).toBeGreaterThan(0)
      }
    }
    for (const [intent, variants] of Object.entries(s.lines)) {
      expect(variants.length, `scenario.lines.${intent} must not be empty`).toBeGreaterThan(0)
    }
  })

  it('gives the frequently-heard intents at least three variants', () => {
    const s = scenario()
    const required: Record<string, string[]> = {
      ruth: ['SECOND', 'DEBATE_FOR', 'CONFUSION'],
      bev: ['SECOND', 'DEBATE_AGAINST', 'RAISE_POINT_OF_ORDER', 'CONFUSION'],
      hal: ['COMMENT', 'RAISE_POINT_OF_ORDER', 'CONFUSION'],
      dee: ['SECOND', 'INTERRUPT', 'RAISE_INQUIRY', 'CONFUSION'],
      carl: ['MOVE', 'SECOND', 'DEBATE_FOR', 'CONFUSION'],
    }
    for (const [memberId, intents] of Object.entries(required)) {
      const member = s.members.find((m) => m.id === memberId)
      expect(member, `member ${memberId}`).toBeDefined()
      for (const intent of intents) {
        expect(member?.lines[intent]?.length ?? 0, `${memberId}.${intent}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('authors the invalid point of order away from the rules enthusiast', () => {
    const s = scenario()
    const enthusiast = s.members.find((m) => m.archetype === 'RULES_ENTHUSIAST')
    const points = s.beats.filter(
      (b) => b.effect.kind === 'REQUEST' && b.effect.request.kind === 'POINT_OF_ORDER',
    )
    expect(points).toHaveLength(1)
    const point = points[0]
    if (point.effect.kind !== 'REQUEST') throw new Error('unreachable')
    expect(point.effect.request.valid).toBe(false)
    expect(point.effect.request.member).not.toBe(enthusiast?.id)
    // Beats gated on RECESS would never fire.
    expect(s.beats.every((b) => b.when.phase !== 'RECESS')).toBe(true)
  })

  it('carries the variance 3 to 2 when the meeting is run properly', () => {
    const s = scenario()
    const state = play(HAPPY_PATH)

    expect(state.phase).toBe('ADJOURNED')
    expect(state.itemsCompleted).toBe(2)
    expect(state.outOfOrderCount).toBe(0)
    expect(state.meters.control).toBeGreaterThan(0)

    const announcements = state.log.filter((e) => e.intent === 'ANNOUNCE_RESULT')
    expect(announcements).toHaveLength(2)
    const variance = announcements[1]
    expect(variance.payload.motionId).toBe('mo-variance')
    expect(variance.payload.ayes).toBe(3)
    expect(variance.payload.noes).toBe(2)
    expect(variance.payload.passed).toBe(true)

    const report = buildReportCard(state, s)
    expect(GRADE_ORDER.indexOf(report.overall)).toBeGreaterThanOrEqual(GRADE_ORDER.indexOf('B'))
    expect(report.grades.completion.score).toBe(100)
    expect(report.grades.procedure.score).toBe(100)
    expect(state.turn - 1).toBeLessThanOrEqual(s.parTurns)
  })

  it('reads like a meeting: motion, second, debate, a bogus point, an inquiry, a vote', () => {
    const s = scenario()
    const state = play(HAPPY_PATH)
    const intents = state.log.map((e) => e.intent)

    // The shape of item 2, in order.
    const order = [
      'MOVE',
      'SECOND',
      'STATE_MOTION',
      'COMMENT', //           the Veteran's 2019 story
      'DEBATE_FOR',
      'ANSWER_INQUIRY',
      'RULE_NOT_WELL_TAKEN',
      'DEBATE_AGAINST',
      'VOTE_TAKEN',
      'ANNOUNCE_RESULT',
    ]
    let cursor = intents.indexOf('OPEN_ITEM', intents.indexOf('ITEM_RESOLVED'))
    for (const intent of order) {
      const at = intents.indexOf(intent, cursor)
      expect(at, `expected ${intent} after index ${cursor}`).toBeGreaterThan(-1)
      cursor = at
    }

    // The room actually behaved like the cast promises.
    expect(intents).toContain('RAISE_POINT_OF_ORDER')
    expect(intents).toContain('RAISE_INQUIRY')
    expect(intents).toContain('INTERRUPT')
    expect(intents).toContain('SEEK_RECOGNITION')

    // Every line renders to authored or built-in prose; nothing is blank and
    // nothing leaks an unfilled {slot}.
    const lines = transcript(state, s)
    expect(lines.length).toBe(state.log.length)
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0)
      expect(line).not.toMatch(/\{[a-zA-Z]+\}/)
      expect(line).not.toMatch(/says something the clerk does not quite catch/)
    }
  })

  it('answers the inquiry correctly only with "majority"', () => {
    const s = scenario()
    const point = s.beats.find((b) => b.id === 'i2-inquiry')
    if (!point || point.effect.kind !== 'REQUEST') throw new Error('i2-inquiry beat missing')
    const answers = point.effect.request.answers ?? []
    expect(answers.length).toBeGreaterThanOrEqual(3)
    const correct = answers.filter((a) => a.correct)
    expect(correct).toHaveLength(1)
    expect(correct[0].id).toBe('a-majority')
    expect(point.effect.request.question?.toLowerCase()).toContain('two-thirds')
  })

  it('collapses under a stalling chair and rewinds into item 2', () => {
    const s = scenario()
    let state = initMeeting(s, SEED)

    // Get to item 2 legitimately, so there is an item-2 checkpoint to find.
    for (const action of HAPPY_PATH.slice(0, 6)) {
      state = reduce(state, action, s)
    }
    expect(state.currentItem).toBe(1)

    // Then stop chairing: sit on your hands, and periodically demand a vote on
    // business that is not in front of the board.
    const sabotage: Action[] = []
    for (let i = 0; i < 12; i += 1) {
      sabotage.push({ verb: 'WAIT' }, { verb: 'WAIT' }, { verb: 'CALL_VOTE', method: 'VOICE' })
    }
    for (const action of sabotage) {
      if (state.phase === 'COLLAPSED') break
      state = reduce(state, action, s)
    }

    expect(state.phase).toBe('COLLAPSED')
    expect(state.meters.control).toBe(0)

    const { state: restored, diagnostic } = restoreCheckpoint(state)
    expect(diagnostic.length).toBeGreaterThan(0)
    expect(diagnostic.length).toBeLessThanOrEqual(3)
    expect(diagnostic.every((d) => d.total < 0)).toBe(true)

    expect(restored.currentItem).toBe(1)
    expect(restored.phase).not.toBe('COLLAPSED')
    expect(restored.meters.control).toBeGreaterThan(0)
    // The rewind is playable again.
    expect(legalActions(restored, s).verbs.WAIT.status).toBe('IN_ORDER')
  })
})
