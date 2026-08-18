// Room simulation tests: beats (D7), archetypes (D6), and the D4 step-3
// passive drains. Every fixture here is deliberately small — a state literal
// plus a scenario with exactly the members and beats the rule under test
// needs — so the assertions read as rules rather than as content archaeology.

import { describe, expect, it } from 'vitest'

import { validateScenario } from '../../content/schema'
import type { Beat, Scenario } from '../../content/schema'
import { captureCheckpoint, restoreCheckpoint } from '../checkpoints'
import { reduce } from '../reducer'
import { roomRespond } from '../room'
import type { MeetingEvent, MeetingState, Motion, Request } from '../types'
import { makeState } from './helpers'

// ---------------------------------------------------------------------------
// Fixture: one member per archetype, two agenda items (the second is bait)
// ---------------------------------------------------------------------------

const MOTION_ID = 'motion-fence'
const MOTION_TEXT = 'the fence variance be approved as submitted'
const PLAIN_ITEM = 0
const BAIT_ITEM = 1

const ARCHETYPE_BY_MEMBER = {
  m1: 'RULES_ENTHUSIAST',
  m2: 'VETERAN',
  m3: 'INTERRUPTER',
  m4: 'STABILIZER',
  m5: 'DRIFTING_COMMENTER',
} as const

function archetypeScenario(beats: Beat[] = []): Scenario {
  return validateScenario({
    id: 'room-fixture',
    title: 'Room Fixture Meeting',
    body: 'Fixture Homeowners Association',
    version: '1.0.0',
    seats: 5,
    quorum: 3,
    present: ['m1', 'm2', 'm3', 'm4', 'm5'],
    parTurns: 10,
    members: Object.entries(ARCHETYPE_BY_MEMBER).map(([id, archetype]) => ({
      id,
      name: `Member ${id.toUpperCase()}`,
      archetype,
      objective: 'Be themselves.',
      stances: { [MOTION_ID]: 'AYE' },
      lines: {},
    })),
    agenda: [
      {
        id: 'item-plain',
        title: 'Approve the minutes',
        motions: [{ id: MOTION_ID, kind: 'MAIN', text: MOTION_TEXT, germane: true }],
      },
      { id: 'item-bait', title: 'Fence variance request', veteranBait: true, motions: [] },
    ],
    beats,
    lines: {},
  })
}

const scenario = archetypeScenario()

/** makeState, with the archetype cast and agenda wired to the fixture. */
function roomState(partial?: Partial<MeetingState>): MeetingState {
  const base = makeState()
  return {
    ...base,
    members: base.members.map((m) => ({
      ...m,
      archetype: ARCHETYPE_BY_MEMBER[m.id as keyof typeof ARCHETYPE_BY_MEMBER],
    })),
    agenda: scenario.agenda,
    ...partial,
  }
}

function makeMotion(partial?: Partial<Motion>): Motion {
  return {
    id: MOTION_ID,
    kind: 'MAIN',
    text: MOTION_TEXT,
    mover: 'm1',
    seconded: true,
    secondedBy: 'm2',
    germane: true,
    statedByChair: true,
    debateSpeeches: 0,
    movedTurn: 1,
    votes: { m1: 'AYE', m2: 'AYE', m3: 'AYE', m4: 'AYE', m5: 'AYE' },
    ...partial,
  }
}

function recognitionRequest(member: string, createdTurn = 1, purpose: Request['purpose'] = 'DEBATE_FOR'): Request {
  return { id: `req-${member}`, kind: 'RECOGNITION', member, createdTurn, purpose }
}

function movedEvent(turn: number): MeetingEvent {
  return {
    id: 'e1',
    type: 'STATE_CHANGE',
    actor: 'CHAIR',
    intent: 'MOTION_MOVED',
    payload: { motionId: MOTION_ID, motionText: MOTION_TEXT, turn },
  }
}

function reasons(state: MeetingState): string[] {
  return state.meterLog.map((d) => d.reason)
}

function mood(overrides: Record<string, number>): MeetingState['memberMood'] {
  const base = makeState().memberMood
  for (const [id, impatience] of Object.entries(overrides)) {
    base[id] = { ...base[id], impatience }
  }
  return base
}

/** Advances the room a turn without a chair action, the way reduce would. */
function nextTurn(state: MeetingState, partial?: Partial<MeetingState>): MeetingState {
  return { ...state, turn: state.turn + 1, ...partial }
}

// ---------------------------------------------------------------------------
// Beats (D7)
// ---------------------------------------------------------------------------

describe('beats', () => {
  const narrationBeat: Beat = {
    id: 'beat-murmur',
    when: { phase: 'ITEM_OPEN', itemIndex: PLAIN_ITEM },
    effect: { kind: 'NARRATION', intent: 'CROWD_MURMURS' },
  }

  it('fires when every `when` condition matches and records the beat as fired', () => {
    const sc = archetypeScenario([narrationBeat])
    const after = roomRespond(roomState({ phase: 'ITEM_OPEN', currentItem: PLAIN_ITEM }), sc)
    expect(after.log.map((e) => e.intent)).toContain('CROWD_MURMURS')
    expect(after.room.firedBeats).toEqual(['beat-murmur'])
  })

  it('never fires the same beat twice', () => {
    const sc = archetypeScenario([narrationBeat])
    let s = roomRespond(roomState({ phase: 'ITEM_OPEN', currentItem: PLAIN_ITEM }), sc)
    s = roomRespond(nextTurn(s), sc)
    expect(s.log.filter((e) => e.intent === 'CROWD_MURMURS')).toHaveLength(1)
  })

  it('does not fire while a `when` condition is unmet', () => {
    const sc = archetypeScenario([narrationBeat])
    const after = roomRespond(roomState({ phase: 'ITEM_OPEN', currentItem: BAIT_ITEM }), sc)
    expect(after.log).toHaveLength(0)
    expect(after.room.firedBeats).toEqual([])
  })

  it('fires several matching beats in scenario order in one turn', () => {
    const sc = archetypeScenario([
      { id: 'b1', when: { turnGte: 1 }, effect: { kind: 'NARRATION', intent: 'FIRST' } },
      { id: 'b2', when: { turnGte: 1 }, effect: { kind: 'NARRATION', intent: 'SECOND_BEAT' } },
    ])
    const after = roomRespond(roomState(), sc)
    expect(after.log.map((e) => e.intent)).toEqual(['FIRST', 'SECOND_BEAT'])
    expect(after.room.firedBeats).toEqual(['b1', 'b2'])
  })

  it('honours turnGte, motionOnStack and afterEventIntent', () => {
    const sc = archetypeScenario([
      { id: 'late', when: { turnGte: 4 }, effect: { kind: 'NARRATION', intent: 'LATE' } },
      { id: 'stack', when: { motionOnStack: true }, effect: { kind: 'NARRATION', intent: 'STACKED' } },
      {
        id: 'after',
        when: { afterEventIntent: 'MOTION_MOVED' },
        effect: { kind: 'NARRATION', intent: 'AFTER_MOVE' },
      },
    ])
    const early = roomRespond(roomState({ turn: 3 }), sc)
    expect(early.log).toHaveLength(0)

    const later = roomRespond(roomState({ turn: 4, motionStack: [makeMotion()], log: [movedEvent(3)] }), sc)
    expect(later.log.map((e) => e.intent)).toEqual(['MOTION_MOVED', 'LATE', 'STACKED', 'AFTER_MOVE'])
  })

  it('adds a pending request for a REQUEST effect, stamped with the current turn', () => {
    const sc = archetypeScenario([
      {
        id: 'b-req',
        when: { turnGte: 1 },
        effect: {
          kind: 'REQUEST',
          request: { kind: 'RECOGNITION', member: 'm2', purpose: 'MOVE' } as Omit<Request, 'id' | 'createdTurn'>,
        },
      },
    ])
    const after = roomRespond(roomState({ turn: 6 }), sc)
    expect(after.pendingRequests).toHaveLength(1)
    expect(after.pendingRequests[0]).toMatchObject({ kind: 'RECOGNITION', member: 'm2', createdTurn: 6 })
    expect(after.pendingRequests[0].id).toBeTruthy()
  })

  it('seconds the top motion for a SECOND effect', () => {
    const sc = archetypeScenario([
      { id: 'b-second', when: { turnGte: 1 }, effect: { kind: 'SECOND', member: 'm3' } },
    ])
    const state = roomState({
      phase: 'MOTION_PENDING',
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false })],
      log: [movedEvent(1)],
    })
    const after = roomRespond(state, sc)
    expect(after.motionStack[0].seconded).toBe(true)
    expect(after.motionStack[0].secondedBy).toBe('m3')
  })
})

// ---------------------------------------------------------------------------
// RULES_ENTHUSIAST (D6)
// ---------------------------------------------------------------------------

describe('RULES_ENTHUSIAST', () => {
  it('files a valid point of order right after the chair takes an out-of-order action', () => {
    // CALL_VOTE from ITEM_OPEN is out of order (D3).
    const after = reduce(roomState({ phase: 'ITEM_OPEN' }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    const point = after.pendingRequests.find((r) => r.kind === 'POINT_OF_ORDER')
    expect(point).toBeDefined()
    expect(point?.member).toBe('m1')
    expect(point?.valid).toBe(true)
    expect(point?.claim).toBeTruthy()
  })

  it('files a point when the chair calls a vote on a motion that was never stated', () => {
    const state = roomState({
      phase: 'DEBATE',
      motionStack: [makeMotion({ statedByChair: false })],
      log: [movedEvent(1)],
    })
    const after = reduce(state, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(after.pendingRequests.some((r) => r.kind === 'POINT_OF_ORDER' && r.member === 'm1')).toBe(true)
  })

  it('keeps at most one point pending at a time', () => {
    let s = reduce(roomState({ phase: 'ITEM_OPEN' }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    s = reduce(s, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(s.pendingRequests.filter((r) => r.kind === 'POINT_OF_ORDER')).toHaveLength(1)
  })

  it('stays quiet when the chair acts in order', () => {
    const after = reduce(roomState({ phase: 'ITEM_OPEN' }), { verb: 'WAIT' }, scenario)
    expect(after.pendingRequests).toHaveLength(0)
  })

  it('defers the point to the next turn when another scene has taken this one', () => {
    // The drifting commenter is mid-speech, so the continuation owns the turn's
    // one scene — and the chair picks exactly that turn to blunder.
    const recognized = reduce(
      roomState({
        phase: 'DEBATE',
        currentItem: PLAIN_ITEM,
        motionStack: [makeMotion()],
        pendingRequests: [recognitionRequest('m5', 1, 'DEBATE_FOR')],
        log: [movedEvent(1)],
      }),
      { verb: 'RECOGNIZE', target: 'm5' },
      scenario,
    )
    expect(recognized.room.drifting?.member).toBe('m5')

    // CALL_ITEM with a motion on the floor is out of order (D3).
    const blocked = reduce(recognized, { verb: 'CALL_ITEM' }, scenario)
    expect(blocked.log.some((e) => e.intent === 'SPEECH_CONTINUES')).toBe(true)
    expect(blocked.pendingRequests.filter((r) => r.kind === 'POINT_OF_ORDER')).toHaveLength(0)
    expect(blocked.room.enthusiastPendingPoint).toBe(true)

    // Deferred, not dropped: the objection lands on the next turn.
    const after = reduce(blocked, { verb: 'WAIT' }, scenario)
    const point = after.pendingRequests.find((r) => r.kind === 'POINT_OF_ORDER')
    expect(point).toMatchObject({ member: 'm1', valid: true })
    expect(after.room.enthusiastPendingPoint).toBe(false)
  })

  it('drops a deferred point when the enthusiast is already objecting', () => {
    let s = reduce(roomState({ phase: 'ITEM_OPEN' }), { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(s.pendingRequests.filter((r) => r.kind === 'POINT_OF_ORDER')).toHaveLength(1)

    s = reduce(s, { verb: 'CALL_VOTE', method: 'VOICE' }, scenario)
    expect(s.room.enthusiastPendingPoint).toBe(false)
    expect(s.pendingRequests.filter((r) => r.kind === 'POINT_OF_ORDER')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// INTERRUPTER (D6)
// ---------------------------------------------------------------------------

describe('INTERRUPTER', () => {
  it('gains one impatience per turn with any request pending', () => {
    const after = roomRespond(roomState({ pendingRequests: [recognitionRequest('m1')] }), scenario)
    expect(after.memberMood.m3.impatience).toBe(1)
  })

  it('gains one impatience when the chair waits with nothing pending', () => {
    const after = roomRespond(roomState({ consecutiveWaits: 1 }), scenario)
    expect(after.memberMood.m3.impatience).toBe(1)
  })

  it('gains two when the chair waits while the interrupter is the one waiting', () => {
    const state = roomState({ consecutiveWaits: 1, pendingRequests: [recognitionRequest('m3')] })
    expect(roomRespond(state, scenario).memberMood.m3.impatience).toBe(2)
  })

  it('sits still when nothing is pending and the chair is working', () => {
    expect(roomRespond(roomState(), scenario).memberMood.m3.impatience).toBe(0)
  })

  it('interrupts at impatience 3, then resets to zero', () => {
    const state = roomState({ memberMood: mood({ m3: 2 }), pendingRequests: [recognitionRequest('m1')] })
    const after = roomRespond(state, scenario)
    expect(after.memberMood.m3.impatience).toBe(0)
    expect(after.pendingRequests.some((r) => r.kind === 'INTERRUPT' && r.member === 'm3')).toBe(true)
    expect(after.log.some((e) => e.type === 'INTERRUPT' && e.actor === 'm3')).toBe(true)
  })

  it('does not charge UNADDRESSED_INTERRUPT on the turn the outburst happens', () => {
    const state = roomState({ memberMood: mood({ m3: 2 }), pendingRequests: [recognitionRequest('m1')] })
    const after = roomRespond(state, scenario)
    expect(reasons(after)).not.toContain('UNADDRESSED_INTERRUPT')
  })

  it('drains 8 control per turn while the interrupt sits unaddressed', () => {
    const interrupt: Request = { id: 'i1', kind: 'INTERRUPT', member: 'm3', createdTurn: 1 }
    const after = roomRespond(roomState({ turn: 2, pendingRequests: [interrupt] }), scenario)
    expect(reasons(after)).toContain('UNADDRESSED_INTERRUPT')
    expect(after.meters.control).toBe(62)
  })

  it('stops draining once the chair gavels: +8 and the interrupt is cleared', () => {
    const interrupt: Request = { id: 'i1', kind: 'INTERRUPT', member: 'm3', createdTurn: 1 }
    const after = reduce(roomState({ turn: 2, pendingRequests: [interrupt] }), { verb: 'GAVEL' }, scenario)
    expect(after.pendingRequests.filter((r) => r.kind === 'INTERRUPT')).toHaveLength(0)
    expect(reasons(after)).toEqual(['GAVEL_RESTORES_ORDER'])
    expect(after.meters.control).toBe(78)
  })
})

// ---------------------------------------------------------------------------
// STABILIZER (D6)
// ---------------------------------------------------------------------------

describe('STABILIZER', () => {
  it('seconds a motion that has sat unseconded for two turns, at 4 control', () => {
    const state = roomState({
      phase: 'MOTION_PENDING',
      turn: 3,
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false })],
      log: [movedEvent(1)],
    })
    const after = roomRespond(state, scenario)
    expect(after.motionStack[0].seconded).toBe(true)
    expect(after.motionStack[0].secondedBy).toBe('m4')
    expect(reasons(after)).toEqual(['STABILIZER_RESCUE'])
    expect(after.meters.control).toBe(66)
    expect(after.log.some((e) => e.type === 'SPEECH' && e.actor === 'm4')).toBe(true)
  })

  it('still rescues an unseconded motion after a restore truncated MOTION_MOVED out of the log', () => {
    // The motion's age used to be recovered by scanning the log for its
    // MOTION_MOVED event. A checkpoint keeps only the last 20 log entries, so
    // after a restore that scan came back empty, the age read as "unknown",
    // and the stabilizer silently stopped rescuing. Motion.movedTurn survives
    // the snapshot, so the rescue must survive it too.
    const filler: MeetingEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `f${i}`,
      type: 'NARRATION',
      actor: 'SYSTEM',
      intent: 'CHAIR_WAITS',
      payload: {},
    }))

    const before = roomState({
      phase: 'MOTION_PENDING',
      turn: 3,
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false, movedTurn: 1 })],
      log: [movedEvent(1), ...filler],
    })

    const { state: restored } = restoreCheckpoint(captureCheckpoint(before, 'Before the vote'))

    // Precondition: the restore really did lose the event the old code read.
    expect(restored.log.some((e) => e.intent === 'MOTION_MOVED')).toBe(false)
    expect(restored.motionStack[0].movedTurn).toBe(1)

    const after = roomRespond(restored, scenario)
    expect(after.motionStack[0].seconded).toBe(true)
    expect(after.motionStack[0].secondedBy).toBe('m4')
    expect(reasons(after)).toEqual(['STABILIZER_RESCUE'])
  })

  it('leaves a freshly moved motion alone', () => {
    const state = roomState({
      phase: 'MOTION_PENDING',
      turn: 2,
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false })],
      log: [movedEvent(1)],
    })
    const after = roomRespond(state, scenario)
    expect(after.motionStack[0].seconded).toBe(false)
    expect(after.meterLog).toHaveLength(0)
  })

  it('prompts the chair after two consecutive waits', () => {
    const after = roomRespond(roomState({ consecutiveWaits: 2 }), scenario)
    expect(reasons(after)).toContain('STABILIZER_RESCUE')
    expect(after.log.some((e) => e.type === 'SPEECH' && e.actor === 'm4')).toBe(true)
  })

  it('prompts the chair to state a seconded motion left hanging three turns', () => {
    const state = roomState({
      phase: 'MOTION_PENDING',
      turn: 4,
      motionStack: [makeMotion({ statedByChair: false })],
      log: [movedEvent(1)],
    })
    const after = roomRespond(state, scenario)
    expect(reasons(after)).toEqual(['STABILIZER_RESCUE'])
    expect(after.motionStack[0].statedByChair).toBe(false) // only the chair can state it
  })

  it('sits out 2 turns after a rescue, so a long stall no longer starves the interrupter (T9b)', () => {
    let state = roomState({
      phase: 'MOTION_PENDING',
      turn: 3,
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false })],
      log: [movedEvent(1)],
    })

    // 4 consecutive WAITs through the full turn loop (reduce), the way a
    // player who just stalls actually plays it.
    for (let i = 0; i < 4; i++) {
      state = reduce(state, { verb: 'WAIT' }, scenario)
    }

    // Exactly one rescue in the first 3 turns of the stall (turns 3-5): the
    // cooldown set by the turn-3 rescue blocks turns 4 and 5.
    const rescuesInFirstThreeTurns = state.meterLog.filter(
      (d) => d.reason === 'STABILIZER_RESCUE' && d.turn <= 5,
    )
    expect(rescuesInFirstThreeTurns).toHaveLength(1)

    // With the stabilizer sidelined, the interrupter's accruing impatience is
    // no longer starved of a scene: Dee (m3) erupts during the stall.
    expect(state.log.some((e) => e.type === 'INTERRUPT' && e.actor === 'm3')).toBe(true)
  })

  it('still sits out its cooldown when it is checked BEFORE the interrupter in member order', () => {
    // The test above uses the shared `scenario` fixture, where m3 (INTERRUPTER)
    // precedes m4 (STABILIZER) in the members array — `runArchetypes` iterates
    // in array order, so the interrupter always gets first crack at the turn's
    // one scene there regardless of whether the cooldown works. That fixture
    // alone would pass even with the cooldown reverted, so it does not pin the
    // real bug: in the actual scenario (hoa-fence-01), Ruth (STABILIZER) is
    // ordered BEFORE Dee (INTERRUPTER). This fixture reproduces that ordering
    // to prove the cooldown — not iteration order — is what frees the scene.
    const orderByMember = { m1: 'STABILIZER', m2: 'NONE', m3: 'NONE', m4: 'INTERRUPTER', m5: 'NONE' } as const
    const orderedScenario = validateScenario({
      id: 'room-fixture-stabilizer-first',
      title: 'Room Fixture Meeting (stabilizer ordered before interrupter)',
      body: 'Fixture Homeowners Association',
      version: '1.0.0',
      seats: 5,
      quorum: 3,
      present: ['m1', 'm2', 'm3', 'm4', 'm5'],
      parTurns: 10,
      members: Object.entries(orderByMember).map(([id, archetype]) => ({
        id,
        name: `Member ${id.toUpperCase()}`,
        archetype,
        objective: 'Be themselves.',
        stances: { [MOTION_ID]: 'AYE' },
        lines: {},
      })),
      agenda: [
        {
          id: 'item-plain',
          title: 'Approve the minutes',
          motions: [{ id: MOTION_ID, kind: 'MAIN', text: MOTION_TEXT, germane: true }],
        },
      ],
      beats: [],
      lines: {},
    })

    const base = makeState()
    let state: MeetingState = {
      ...base,
      members: base.members.map((m) => ({
        ...m,
        archetype: orderByMember[m.id as keyof typeof orderByMember],
      })),
      agenda: orderedScenario.agenda,
      phase: 'MOTION_PENDING',
      turn: 3,
      motionStack: [makeMotion({ seconded: false, secondedBy: null, statedByChair: false })],
      log: [movedEvent(1)],
    }

    for (let i = 0; i < 4; i++) {
      state = reduce(state, { verb: 'WAIT' }, orderedScenario)
    }

    // (a) Exactly one rescue in the first 3 turns of the stall (turns 3-5):
    // the cooldown set by the turn-3 rescue blocks turns 4 and 5, even though
    // m1 (STABILIZER) is checked before m4 (INTERRUPTER) every turn.
    const rescuesInFirstThreeTurns = state.meterLog.filter(
      (d) => d.reason === 'STABILIZER_RESCUE' && d.turn <= 5,
    )
    expect(rescuesInFirstThreeTurns).toHaveLength(1)

    // (b) The later-ordered interrupter (m4) still gets a scene and erupts.
    expect(state.log.some((e) => e.type === 'INTERRUPT' && e.actor === 'm4')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// VETERAN (D6)
// ---------------------------------------------------------------------------

describe('VETERAN', () => {
  function baitedDebate(partial?: Partial<MeetingState>): MeetingState {
    return roomState({
      phase: 'DEBATE',
      currentItem: BAIT_ITEM,
      motionStack: [makeMotion()],
      log: [movedEvent(1)],
      ...partial,
    })
  }

  it('files a COMMENT recognition the first time debate opens on a baited item', () => {
    const after = roomRespond(baitedDebate(), scenario)
    const request = after.pendingRequests.find((r) => r.member === 'm2')
    expect(request).toMatchObject({ kind: 'RECOGNITION', purpose: 'COMMENT' })
  })

  it('files it only once for that item', () => {
    let s = roomRespond(baitedDebate(), scenario)
    s = roomRespond(nextTurn(s, { pendingRequests: [] }), scenario)
    expect(s.pendingRequests.filter((r) => r.member === 'm2')).toHaveLength(0)
  })

  it('stays quiet on an item that is not flagged', () => {
    const after = roomRespond(baitedDebate({ currentItem: PLAIN_ITEM }), scenario)
    expect(after.pendingRequests.filter((r) => r.member === 'm2')).toHaveLength(0)
  })

  it('keeps waiting when the same member is recognized twice', () => {
    // Patience is spent by *members* getting in ahead of them, not by the
    // number of times the gavel pointed somewhere else.
    let s = roomRespond(baitedDebate(), scenario)
    s = nextTurn(s, {
      memberMood: { ...s.memberMood, m1: { impatience: 0, timesRecognized: 2 } },
    })
    s = roomRespond(s, scenario)

    expect(reasons(s)).not.toContain('IGNORED_REQUEST_TIMEOUT')
    expect(s.pendingRequests.some((r) => r.member === 'm2')).toBe(true)

    // A second, different member is what finally does it.
    s = nextTurn(s, {
      memberMood: { ...s.memberMood, m4: { impatience: 0, timesRecognized: 1 } },
    })
    s = roomRespond(s, scenario)
    expect(reasons(s)).toContain('IGNORED_REQUEST_TIMEOUT')
    expect(s.pendingRequests.filter((r) => r.member === 'm2')).toHaveLength(0)
  })

  it('times out at 4 trust and withdraws once two other members are recognized', () => {
    let s = roomRespond(baitedDebate(), scenario)
    expect(s.pendingRequests.some((r) => r.member === 'm2')).toBe(true)

    s = nextTurn(s, {
      memberMood: {
        ...s.memberMood,
        m1: { impatience: 0, timesRecognized: 1 },
        m4: { impatience: 0, timesRecognized: 1 },
      },
    })
    s = roomRespond(s, scenario)

    expect(reasons(s)).toContain('IGNORED_REQUEST_TIMEOUT')
    expect(s.meters.trust).toBe(66)
    expect(s.pendingRequests.filter((r) => r.member === 'm2')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Generic ignored-request timeout (D5)
// ---------------------------------------------------------------------------

describe('ignored requests', () => {
  it('charges 4 trust once when a request has waited three turns', () => {
    let s = roomRespond(roomState({ turn: 4, pendingRequests: [recognitionRequest('m1', 1)] }), scenario)
    expect(reasons(s).filter((r) => r === 'IGNORED_REQUEST_TIMEOUT')).toHaveLength(1)
    expect(s.meters.trust).toBe(66)

    s = roomRespond(nextTurn(s), scenario)
    expect(reasons(s).filter((r) => r === 'IGNORED_REQUEST_TIMEOUT')).toHaveLength(1)
  })

  it('leaves a request that has waited two turns alone', () => {
    const after = roomRespond(roomState({ turn: 3, pendingRequests: [recognitionRequest('m1', 1)] }), scenario)
    expect(reasons(after)).not.toContain('IGNORED_REQUEST_TIMEOUT')
  })
})

// ---------------------------------------------------------------------------
// DRIFTING_COMMENTER (D6)
// ---------------------------------------------------------------------------

describe('DRIFTING_COMMENTER', () => {
  function driftingRecognized(): MeetingState {
    const state = roomState({
      phase: 'DEBATE',
      currentItem: PLAIN_ITEM,
      motionStack: [makeMotion()],
      pendingRequests: [recognitionRequest('m5', 1, 'DEBATE_FOR')],
      log: [movedEvent(1)],
    })
    return reduce(state, { verb: 'RECOGNIZE', target: 'm5' }, scenario)
  }

  it('runs the speech into a second turn unless the chair stops it', () => {
    const recognized = driftingRecognized()
    expect(recognized.room.drifting?.member).toBe('m5')

    const after = reduce(recognized, { verb: 'WAIT' }, scenario)
    expect(after.log.filter((e) => e.type === 'SPEECH' && e.actor === 'm5')).toHaveLength(2)
    expect(after.room.drifting).toBeNull()
  })

  it('does not keep rambling for a third turn', () => {
    let s = reduce(driftingRecognized(), { verb: 'WAIT' }, scenario)
    s = reduce(s, { verb: 'WAIT' }, scenario)
    expect(s.log.filter((e) => e.type === 'SPEECH' && e.actor === 'm5')).toHaveLength(2)
  })

  it('gaveling mid-ramble costs 4 trust as CUT_OFF_RAMBLER, not GAVEL_QUIET_ROOM', () => {
    const after = reduce(driftingRecognized(), { verb: 'GAVEL' }, scenario)
    expect(reasons(after)).toContain('CUT_OFF_RAMBLER')
    expect(reasons(after)).not.toContain('GAVEL_QUIET_ROOM')
    expect(after.meters.trust).toBe(66)
    expect(after.room.drifting).toBeNull()
    expect(after.log.filter((e) => e.type === 'SPEECH' && e.actor === 'm5')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Pacing: one NPC scene per turn
// ---------------------------------------------------------------------------

describe('one scene per turn', () => {
  it('defers the stabilizer when the interrupter has already taken the turn', () => {
    const state = roomState({
      consecutiveWaits: 2,
      memberMood: mood({ m3: 2 }),
      pendingRequests: [recognitionRequest('m1')],
    })
    const first = roomRespond(state, scenario)
    expect(first.pendingRequests.some((r) => r.kind === 'INTERRUPT')).toBe(true)
    expect(reasons(first)).not.toContain('STABILIZER_RESCUE')

    const second = roomRespond(nextTurn(first), scenario)
    expect(reasons(second)).toContain('STABILIZER_RESCUE')
  })
})

// ---------------------------------------------------------------------------
// The room never re-applies what the chair reducer already charged
// ---------------------------------------------------------------------------

describe('no double charging', () => {
  it('applies SELECTIVE_RECOGNITION exactly once for a jumped queue', () => {
    const state = roomState({
      turn: 5,
      pendingRequests: [recognitionRequest('m4', 1), recognitionRequest('m1', 4)],
    })
    const after = reduce(state, { verb: 'RECOGNIZE', target: 'm1' }, scenario)
    expect(reasons(after).filter((r) => r === 'SELECTIVE_RECOGNITION')).toHaveLength(1)
  })

  it('applies HESITATION exactly once for a WAIT with requests pending', () => {
    const after = reduce(roomState({ pendingRequests: [recognitionRequest('m1')] }), { verb: 'WAIT' }, scenario)
    expect(reasons(after).filter((r) => r === 'HESITATION')).toHaveLength(1)
  })

  it('is pure: roomRespond never mutates its input', () => {
    const state = roomState({ turn: 4, consecutiveWaits: 2, pendingRequests: [recognitionRequest('m1', 1)] })
    const snapshot = structuredClone(state)
    roomRespond(state, scenario)
    expect(state).toEqual(snapshot)
  })

  it('keeps the room quiet once the meeting is over', () => {
    const state = roomState({
      phase: 'ADJOURNED',
      turn: 9,
      pendingRequests: [{ id: 'i1', kind: 'INTERRUPT', member: 'm3', createdTurn: 1 }],
    })
    expect(roomRespond(state, scenario)).toEqual(state)
  })
})
