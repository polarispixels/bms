// Scenario content schema + hand-rolled validation (design decision D8).
// No zod/ajv — the engine and content packages carry zero runtime
// dependencies. `validateScenario` throws `Error`s whose message names the
// offending field, e.g. `scenario.members[2].stances: unknown motion id "x"`.
//
// `AgendaItem`, `ScenarioMotion`, and `Phase` are defined in
// src/engine/types.ts (MeetingState needs them) and re-exported here so
// downstream code can import them from either module; see the note at the
// top of engine/types.ts for why.

import type { AgendaItem, Archetype, MemberId, Phase, Request, ScenarioMotion } from '../engine/types'

export type { AgendaItem, ScenarioMotion, Phase }

// ---------------------------------------------------------------------------
// D8 — Scenario schema types
// ---------------------------------------------------------------------------

export type ScenarioMember = {
  id: MemberId
  name: string
  archetype: Archetype
  objective: string
  stances: Record<string, 'AYE' | 'NO' | 'ABSTAIN'> // motionId -> vote
  lines: Record<string, string[]> // intent -> line variants (seeded pick)
}

// ---------------------------------------------------------------------------
// D7 — Beats
// ---------------------------------------------------------------------------

export type Beat = {
  id: string
  when: {
    phase?: Phase
    itemIndex?: number // currentItem
    turnGte?: number
    afterEventIntent?: string // last chair/system event intent equals this
    motionOnStack?: boolean
  }
  effect:
    | { kind: 'REQUEST'; request: Omit<Request, 'id' | 'createdTurn'> }
    | { kind: 'SECOND'; member: MemberId } // seconds top motion
    | { kind: 'SPEECH'; member: MemberId; intent: string }
    | { kind: 'NARRATION'; intent: string }
}

export type Scenario = {
  id: string
  title: string
  body: string
  version: string
  seats: number
  quorum: number
  present: MemberId[]
  parTurns: number // efficiency par for report card
  members: ScenarioMember[]
  agenda: AgendaItem[]
  beats: Beat[]
  lines: Record<string, string[]> // CLERK/AUDIENCE/SYSTEM narration by intent
}

// ---------------------------------------------------------------------------
// validateScenario
// ---------------------------------------------------------------------------

const ARCHETYPES: readonly string[] = [
  'RULES_ENTHUSIAST',
  'VETERAN',
  'INTERRUPTER',
  'STABILIZER',
  'DRIFTING_COMMENTER',
  'NONE',
]
const VOTE_VALUES: readonly string[] = ['AYE', 'NO', 'ABSTAIN']
const MOTION_KINDS: readonly string[] = ['MAIN', 'AMEND']
const BEAT_EFFECT_KINDS: readonly string[] = ['REQUEST', 'SECOND', 'SPEECH', 'NARRATION']

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function fail(path: string, message: string): never {
  const full = path ? `scenario.${path}` : 'scenario'
  throw new Error(`${full}: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, `expected an object, got ${describeValue(value)}`)
  return value
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, `expected a string, got ${describeValue(value)}`)
  return value
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) fail(path, `expected a number, got ${describeValue(value)}`)
  return value
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, `expected a boolean, got ${describeValue(value)}`)
  return value
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, `expected an array, got ${describeValue(value)}`)
  return value
}

function requireStringArrayRecord(value: unknown, path: string): Record<string, string[]> {
  const raw = requireRecord(value, path)
  const result: Record<string, string[]> = {}
  for (const [key, arr] of Object.entries(raw)) {
    if (!Array.isArray(arr) || !arr.every((entry) => typeof entry === 'string')) {
      fail(`${path}.${key}`, 'expected an array of strings')
    }
    result[key] = arr as string[]
  }
  return result
}

function validateMotion(value: unknown, path: string): ScenarioMotion {
  const raw = requireRecord(value, path)
  const id = requireString(raw.id, `${path}.id`)
  const kind = requireString(raw.kind, `${path}.kind`)
  if (!MOTION_KINDS.includes(kind)) fail(`${path}.kind`, `invalid motion kind "${kind}"`)
  const text = requireString(raw.text, `${path}.text`)
  const germane = requireBoolean(raw.germane, `${path}.germane`)
  return { id, kind: kind as 'MAIN' | 'AMEND', text, germane }
}

function validateAgendaItem(value: unknown, path: string): AgendaItem {
  const raw = requireRecord(value, path)
  const id = requireString(raw.id, `${path}.id`)
  const title = requireString(raw.title, `${path}.title`)
  const veteranBait = raw.veteranBait === undefined ? undefined : requireBoolean(raw.veteranBait, `${path}.veteranBait`)
  const motionsRaw = requireArray(raw.motions, `${path}.motions`)
  const motions = motionsRaw.map((motion, i) => validateMotion(motion, `${path}.motions[${i}]`))
  return { id, title, veteranBait, motions }
}

function validateMember(value: unknown, path: string, motionIds: Set<string>): ScenarioMember {
  const raw = requireRecord(value, path)
  const id = requireString(raw.id, `${path}.id`)
  const name = requireString(raw.name, `${path}.name`)
  const archetype = requireString(raw.archetype, `${path}.archetype`)
  if (!ARCHETYPES.includes(archetype)) fail(`${path}.archetype`, `invalid archetype "${archetype}"`)
  const objective = requireString(raw.objective, `${path}.objective`)

  const stancesRaw = requireRecord(raw.stances, `${path}.stances`)
  const stances: Record<string, 'AYE' | 'NO' | 'ABSTAIN'> = {}
  for (const [motionId, vote] of Object.entries(stancesRaw)) {
    if (!motionIds.has(motionId)) fail(`${path}.stances`, `unknown motion id "${motionId}"`)
    if (typeof vote !== 'string' || !VOTE_VALUES.includes(vote)) {
      fail(`${path}.stances`, `invalid vote "${describeValue(vote)}" for motion "${motionId}"`)
    }
    stances[motionId] = vote as 'AYE' | 'NO' | 'ABSTAIN'
  }

  const lines = requireStringArrayRecord(raw.lines, `${path}.lines`)
  return { id, name, archetype: archetype as Archetype, objective, stances, lines }
}

function validateBeat(value: unknown, path: string, memberIds: Set<string>): Beat {
  const raw = requireRecord(value, path)
  const id = requireString(raw.id, `${path}.id`)

  const whenRaw = requireRecord(raw.when, `${path}.when`)
  const when: Beat['when'] = {}
  if (whenRaw.phase !== undefined) when.phase = requireString(whenRaw.phase, `${path}.when.phase`) as Phase
  if (whenRaw.itemIndex !== undefined) when.itemIndex = requireNumber(whenRaw.itemIndex, `${path}.when.itemIndex`)
  if (whenRaw.turnGte !== undefined) when.turnGte = requireNumber(whenRaw.turnGte, `${path}.when.turnGte`)
  if (whenRaw.afterEventIntent !== undefined) {
    when.afterEventIntent = requireString(whenRaw.afterEventIntent, `${path}.when.afterEventIntent`)
  }
  if (whenRaw.motionOnStack !== undefined) {
    when.motionOnStack = requireBoolean(whenRaw.motionOnStack, `${path}.when.motionOnStack`)
  }

  const effectRaw = requireRecord(raw.effect, `${path}.effect`)
  const kind = requireString(effectRaw.kind, `${path}.effect.kind`)
  if (!BEAT_EFFECT_KINDS.includes(kind)) fail(`${path}.effect.kind`, `invalid beat effect kind "${kind}"`)

  if (kind === 'REQUEST') {
    const requestRaw = requireRecord(effectRaw.request, `${path}.effect.request`)
    const member = requireString(requestRaw.member, `${path}.effect.request.member`)
    if (!memberIds.has(member)) fail(`${path}.effect.request.member`, `unknown member id "${member}"`)
    requireString(requestRaw.kind, `${path}.effect.request.kind`)
    const request = { ...requestRaw, member } as unknown as Omit<Request, 'id' | 'createdTurn'>
    return { id, when, effect: { kind: 'REQUEST', request } }
  }
  if (kind === 'SECOND') {
    const member = requireString(effectRaw.member, `${path}.effect.member`)
    if (!memberIds.has(member)) fail(`${path}.effect.member`, `unknown member id "${member}"`)
    return { id, when, effect: { kind: 'SECOND', member } }
  }
  if (kind === 'SPEECH') {
    const member = requireString(effectRaw.member, `${path}.effect.member`)
    if (!memberIds.has(member)) fail(`${path}.effect.member`, `unknown member id "${member}"`)
    const intent = requireString(effectRaw.intent, `${path}.effect.intent`)
    return { id, when, effect: { kind: 'SPEECH', member, intent } }
  }
  // kind === 'NARRATION' (only remaining option, checked above)
  const intent = requireString(effectRaw.intent, `${path}.effect.intent`)
  return { id, when, effect: { kind: 'NARRATION', intent } }
}

export function validateScenario(json: unknown): Scenario {
  if (!isRecord(json)) fail('', `expected an object, got ${describeValue(json)}`)
  const raw = json

  const id = requireString(raw.id, 'id')
  const title = requireString(raw.title, 'title')
  const body = requireString(raw.body, 'body')
  const version = requireString(raw.version, 'version')
  const seats = requireNumber(raw.seats, 'seats')
  const quorum = requireNumber(raw.quorum, 'quorum')
  const parTurns = requireNumber(raw.parTurns, 'parTurns')
  const presentRaw = requireArray(raw.present, 'present')
  const membersRaw = requireArray(raw.members, 'members')
  const agendaRaw = requireArray(raw.agenda, 'agenda')
  const beatsRaw = requireArray(raw.beats, 'beats')
  const lines = requireStringArrayRecord(raw.lines, 'lines')

  if (quorum > seats) fail('quorum', `must be <= seats (quorum ${quorum} > seats ${seats})`)

  const agenda = agendaRaw.map((item, i) => validateAgendaItem(item, `agenda[${i}]`))
  const motionIds = new Set(agenda.flatMap((item) => item.motions.map((motion) => motion.id)))

  const members = membersRaw.map((member, i) => validateMember(member, `members[${i}]`, motionIds))
  const memberIds = new Set(members.map((member) => member.id))

  const present = presentRaw.map((entry, i) => {
    const memberId = requireString(entry, `present[${i}]`)
    if (!memberIds.has(memberId)) fail(`present[${i}]`, `unknown member id "${memberId}"`)
    return memberId
  })

  const beats = beatsRaw.map((beat, i) => validateBeat(beat, `beats[${i}]`, memberIds))

  return { id, title, body, version, seats, quorum, present, parTurns, members, agenda, beats, lines }
}
