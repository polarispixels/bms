// Level 1 cross-scenario integration test.
//
// hoa-fence-01.test.ts owns the deep, scenario-specific assertions for the
// gold-standard scenario (readability, sabotage/collapse/checkpoint rewind,
// the exact inquiry answer, etc.) and is left untouched.
//
// This file is the generalization Task 11 asks for: every scenario exported
// from src/content gets the same floor of scrutiny —
//   (a) authoring rules that apply to all Level 1 content (no beat gives the
//       RULES_ENTHUSIAST their own point of order, no beat gates on RECESS,
//       no empty lines array),
//   (b) a scripted happy path, driven through the real engine, that reaches
//       ADJOURNED with every agenda item completed and an overall report
//       card grade of B or better,
// plus one variant-specific mechanic check each for hoa-fence-02 and
// hoa-fence-03, the two scenarios this task adds.

import { describe, expect, it } from 'vitest'
import { buildReportCard, initMeeting, reduce } from '../../engine'
import type { Action, MeetingState } from '../../engine'
import { scenarios } from '../index'
import type { Scenario } from '../schema'

const SEED = 20260817

const GRADE_ORDER = ['F', 'D', 'C', 'B', 'A'] as const

function play(scenario: Scenario, actions: Action[]): MeetingState {
  let state = initMeeting(scenario, SEED)
  for (const action of actions) {
    state = reduce(state, action, scenario)
  }
  return state
}

/**
 * A scripted, competently-chaired meeting for each scenario: recognize the
 * member who has waited longest, rule and answer requests promptly, gavel
 * interrupts and drifting speeches don't get cut off unnecessarily, call the
 * vote once debate is spent, announce, adjourn. Turn numbers were verified by
 * running each script and reading back the resulting event log and meter
 * deltas (see task-11-report.md) rather than by hand-counting alone — the
 * room simulation's passive drains (stray unaddressed interrupts, the
 * veteran's 3-turn request patience) are easy to miscount by hand.
 */
const HAPPY_PATHS: Record<string, Action[]> = {
  'hoa-fence-01': [
    { verb: 'CALL_ITEM' },
    { verb: 'RECOGNIZE', target: 'ruth' },
    { verb: 'STATE_MOTION' },
    { verb: 'CALL_VOTE', method: 'VOICE' },
    { verb: 'ANNOUNCE_RESULT' },
    { verb: 'CALL_ITEM' },
    { verb: 'RECOGNIZE', target: 'carl' },
    { verb: 'STATE_MOTION' },
    { verb: 'RECOGNIZE', target: 'hal' },
    { verb: 'GAVEL' },
    { verb: 'RECOGNIZE', target: 'ruth' },
    { verb: 'ANSWER_INQUIRY', target: 'beat-i2-inquiry', answer: 'a-majority' },
    { verb: 'GAVEL' },
    { verb: 'RULE', target: 'beat-i2-point-of-order', ruling: 'NOT_WELL_TAKEN' },
    { verb: 'RECOGNIZE', target: 'bev' },
    { verb: 'CALL_VOTE', method: 'VOICE' },
    { verb: 'ANNOUNCE_RESULT' },
    { verb: 'ADJOURN' },
  ],
  'hoa-fence-02': [
    { verb: 'CALL_ITEM' }, //                                              1
    { verb: 'RECOGNIZE', target: 'ruth' }, //                              2  Ruth moves the minutes
    { verb: 'STATE_MOTION' }, //                                           3
    { verb: 'CALL_VOTE', method: 'VOICE' }, //                             4
    { verb: 'ANNOUNCE_RESULT' }, //                                        5
    { verb: 'CALL_ITEM' }, //                                              6  item 2: the decorations policy
    { verb: 'RECOGNIZE', target: 'dee' }, //                               7  Dee moves the policy
    { verb: 'STATE_MOTION' }, //                                           8
    { verb: 'RECOGNIZE', target: 'hal' }, //                               9  the Veteran's (correct, this time) comment
    { verb: 'RECOGNIZE', target: 'ruth' }, //                             10  debate FOR
    { verb: 'GAVEL' }, //                                                 11  Dee talked over the room
    { verb: 'RULE', target: 'beat-i2-point-of-order', ruling: 'WELL_TAKEN' }, // 12  Hal's valid point
    { verb: 'RECOGNIZE', target: 'bev' }, //                              13  debate AGAINST
    { verb: 'GAVEL' }, //                                                 14  Dee again
    { verb: 'CALL_VOTE', method: 'VOICE' }, //                            15
    { verb: 'ANNOUNCE_RESULT' }, //                                       16  fails 2 to 3
    { verb: 'ADJOURN' }, //                                                17
  ],
  'hoa-fence-03': [
    { verb: 'CALL_ITEM' }, //                                              1
    { verb: 'RECOGNIZE', target: 'bev' }, //                               2  Beverly moves the minutes
    { verb: 'STATE_MOTION' }, //                                           3
    { verb: 'CALL_VOTE', method: 'VOICE' }, //                             4
    { verb: 'ANNOUNCE_RESULT' }, //                                        5
    { verb: 'CALL_ITEM' }, //                                              6  item 2: the special assessment
    { verb: 'RECOGNIZE', target: 'dee' }, //                               7  Dee moves the assessment
    { verb: 'STATE_MOTION' }, //                                           8
    { verb: 'RECOGNIZE', target: 'hal' }, //                               9  the Veteran, vindicated
    { verb: 'GAVEL' }, //                                                 10  Dee talked over the room
    { verb: 'RECOGNIZE', target: 'bev' }, //                              11  debate FOR
    { verb: 'RECOGNIZE', target: 'carl' }, //                             12  Carl's drifting speech begins
    { verb: 'WAIT' }, //                                                  13  the chair lets the ramble finish
    { verb: 'CALL_VOTE', method: 'VOICE' }, //                            14
    { verb: 'GAVEL' }, //                                                 15  a stray interrupt, cleared
    { verb: 'ANNOUNCE_RESULT' }, //                                       16  carries 4 to 1
    { verb: 'ADJOURN' }, //                                                17
  ],
}

describe('every Level 1 scenario', () => {
  for (const scenario of scenarios) {
    describe(scenario.id, () => {
      it('never gives the RULES_ENTHUSIAST their own authored point of order, and no beat gates on RECESS', () => {
        const enthusiast = scenario.members.find((m) => m.archetype === 'RULES_ENTHUSIAST')
        for (const beat of scenario.beats) {
          expect(beat.when.phase, `${scenario.id} beat ${beat.id}`).not.toBe('RECESS')
          if (beat.effect.kind === 'REQUEST' && beat.effect.request.kind === 'POINT_OF_ORDER') {
            expect(beat.effect.request.member, `${scenario.id} beat ${beat.id}`).not.toBe(enthusiast?.id)
          }
        }
      })

      it('never authors an empty lines array', () => {
        for (const member of scenario.members) {
          expect(Object.keys(member.lines).length, `${scenario.id} ${member.id}`).toBeGreaterThan(0)
          for (const [intent, variants] of Object.entries(member.lines)) {
            expect(variants.length, `${scenario.id} ${member.id}.${intent}`).toBeGreaterThan(0)
          }
        }
        expect(Object.keys(scenario.lines).length, scenario.id).toBeGreaterThan(0)
        for (const [intent, variants] of Object.entries(scenario.lines)) {
          expect(variants.length, `${scenario.id} scenario.lines.${intent}`).toBeGreaterThan(0)
        }
      })

      it('gives every member an objective that explains their vote', () => {
        for (const member of scenario.members) {
          expect(member.objective.length, `${scenario.id} ${member.id}`).toBeGreaterThan(20)
        }
      })

      it('reaches ADJOURNED with every agenda item completed and an overall grade of B or better when chaired well', () => {
        const script = HAPPY_PATHS[scenario.id]
        expect(script, `no happy-path script authored for ${scenario.id} in this test`).toBeDefined()

        const state = play(scenario, script)

        expect(state.phase).toBe('ADJOURNED')
        expect(state.itemsCompleted).toBe(scenario.agenda.length)

        const report = buildReportCard(state, scenario)
        expect(
          GRADE_ORDER.indexOf(report.overall),
          `${scenario.id} overall grade was ${report.overall}`,
        ).toBeGreaterThanOrEqual(GRADE_ORDER.indexOf('B'))
        expect(report.grades.completion.score).toBe(100)
      })
    })
  }
})

describe('hoa-fence-02: the valid point of order', () => {
  const scenario = scenarios.find((s) => s.id === 'hoa-fence-02')
  if (!scenario) throw new Error('hoa-fence-02 is not exported from src/content')

  it('authors its valid point of order away from the rules enthusiast, unlike hoa-fence-01', () => {
    const enthusiast = scenario.members.find((m) => m.archetype === 'RULES_ENTHUSIAST')
    const validPoints = scenario.beats.filter(
      (b) => b.effect.kind === 'REQUEST' && b.effect.request.kind === 'POINT_OF_ORDER' && b.effect.request.valid === true,
    )
    expect(validPoints.length).toBeGreaterThan(0)
    for (const beat of validPoints) {
      if (beat.effect.kind !== 'REQUEST') throw new Error('unreachable')
      const pointMember = beat.effect.request.member
      expect(pointMember).not.toBe(enthusiast?.id)
      // The brief's suggested twist: give it to the Veteran.
      const owner = scenario.members.find((m) => m.id === pointMember)
      expect(owner?.archetype).toBe('VETERAN')
    }
  })

  it('ruling WELL_TAKEN on the valid point yields CORRECT_RULING and FAIR_RULING, and the policy fails 2 to 3', () => {
    const state = play(scenario, HAPPY_PATHS['hoa-fence-02'])

    const ruling = state.log.find((e) => e.intent === 'RULE_WELL_TAKEN')
    expect(ruling).toBeDefined()

    const correctRuling = state.meterLog.filter((d) => d.reason === 'CORRECT_RULING')
    const fairRuling = state.meterLog.filter((d) => d.reason === 'FAIR_RULING')
    const invalidRuling = state.meterLog.filter((d) => d.reason === 'INVALID_RULING')
    const technicalityRuling = state.meterLog.filter((d) => d.reason === 'TECHNICALITY_RULING')
    expect(correctRuling.length).toBeGreaterThan(0)
    expect(fairRuling.length).toBeGreaterThan(0)
    expect(invalidRuling).toHaveLength(0)
    expect(technicalityRuling).toHaveLength(0)

    const announcements = state.log.filter((e) => e.intent === 'ANNOUNCE_RESULT')
    const policyResult = announcements.find((e) => e.payload.motionId === 'mo-policy')
    expect(policyResult).toBeDefined()
    expect(policyResult?.payload.ayes).toBe(2)
    expect(policyResult?.payload.noes).toBe(3)
    expect(policyResult?.payload.passed).toBe(false)
  })
})

describe('hoa-fence-03: the drifting commenter, with no stabilizer to catch anything', () => {
  const scenario = scenarios.find((s) => s.id === 'hoa-fence-03')
  if (!scenario) throw new Error('hoa-fence-03 is not exported from src/content')

  it('casts a DRIFTING_COMMENTER and no STABILIZER, and a par turns under 22', () => {
    expect(scenario.members.some((m) => m.archetype === 'DRIFTING_COMMENTER')).toBe(true)
    expect(scenario.members.some((m) => m.archetype === 'STABILIZER')).toBe(false)
    expect(scenario.parTurns).toBeLessThan(22)
  })

  it('lets a recognized drifting speech run two turns: waiting costs the turn, not a ruling', () => {
    const state = play(scenario, HAPPY_PATHS['hoa-fence-03'])

    const drifter = scenario.members.find((m) => m.archetype === 'DRIFTING_COMMENTER')
    expect(drifter).toBeDefined()

    const commentAt = state.log.findIndex((e) => e.actor === drifter?.id && e.intent === 'COMMENT')
    const continuesAt = state.log.findIndex((e) => e.actor === drifter?.id && e.intent === 'SPEECH_CONTINUES')
    expect(commentAt).toBeGreaterThan(-1)
    expect(continuesAt).toBeGreaterThan(commentAt)
    expect(state.log[continuesAt].payload.turn).toBe((state.log[commentAt].payload.turn as number) + 1)

    // Waiting through the ramble is the cost, not a meter penalty of its own.
    expect(state.meterLog.some((d) => d.reason === 'CUT_OFF_RAMBLER')).toBe(false)
  })

  it('gaveling mid-ramble cuts it off instead, costing trust via CUT_OFF_RAMBLER', () => {
    // Everything up to and including the RECOGNIZE that starts Carl's ramble.
    const recognizeCarlIndex = HAPPY_PATHS['hoa-fence-03'].findIndex(
      (a) => a.verb === 'RECOGNIZE' && a.target === 'carl',
    )
    const prefix = HAPPY_PATHS['hoa-fence-03'].slice(0, recognizeCarlIndex + 1)

    let state = initMeeting(scenario, SEED)
    for (const action of prefix) {
      state = reduce(state, action, scenario)
    }
    expect(state.room.drifting).not.toBeNull()

    const before = state
    state = reduce(state, { verb: 'GAVEL' }, scenario)

    const newDeltas = state.meterLog.slice(before.meterLog.length)
    expect(newDeltas.some((d) => d.reason === 'CUT_OFF_RAMBLER')).toBe(true)
    expect(state.room.drifting).toBeNull()
    expect(state.log.some((e) => e.intent === 'GAVEL_CUT_OFF')).toBe(true)
  })
})
