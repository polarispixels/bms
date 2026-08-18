#!/usr/bin/env tsx
// Headless CLI playthrough (Task 9).
//
// A thin, Node-only shell over the fully-tested engine: no React, no browser
// globals. It prints rendered events, meters, a phase/item/floor/stack
// summary, pending requests, and a numbered action palette built straight
// from `legalActions`; the player picks a number and answers sub-prompts for
// any target the chosen verb needs.
//
// Two important threading rules:
//   - The *engine* RNG lives on `state.rngState` and is only ever advanced by
//     `reduce`/`initMeeting` — this script never touches it directly.
//   - The *presentation* RNG (`presentRng` below) is a completely separate
//     counter, seeded the same way, that only `renderEvent` advances. This
//     mirrors how the integration test replays a transcript: rendering is a
//     read-only view over the log and must never perturb gameplay state.
//
// Reads action numbers from stdin one line at a time via readline's async
// iterator, so `printf '1\n2\n...' | npm run play -- --seed 7` works exactly
// like a human typing at a TTY. On EOF (piped input exhausted, or a human
// hits Ctrl-D) it exits cleanly with a one-line summary instead of hanging.

import * as readline from 'node:readline/promises'
import {
  buildReportCard,
  initMeeting,
  legalActions,
  reduce,
  restoreCheckpoint,
  latestEvents,
} from '../src/engine/index.ts'
import { renderEvent } from '../src/engine/render.ts'
import { scenarios, scenarioById } from '../src/content/index.ts'
import type { Action, LegalityStatus, MeetingState, MemberId } from '../src/engine/index.ts'
import type { Scenario } from '../src/content/index.ts'

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

type Flags = { seed: number; scenarioId: string | null; learn: boolean }

function parseFlags(argv: string[]): Flags {
  let seed = 1
  let scenarioId: string | null = null
  let learn = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--seed') {
      seed = Number(argv[++i])
      if (!Number.isFinite(seed)) throw new Error(`--seed must be a number, got ${argv[i]}`)
    } else if (arg === '--scenario') {
      scenarioId = argv[++i] ?? null
    } else if (arg === '--learn') {
      learn = true
    }
  }
  return { seed, scenarioId, learn }
}

// ---------------------------------------------------------------------------
// stdin line reader (works for both a TTY and piped/non-interactive input)
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, terminal: false })
const stdinLines = rl[Symbol.asyncIterator]()

/** Returns the next line of input, or null on EOF. */
async function nextLine(): Promise<string | null> {
  const { value, done } = await stdinLines.next()
  return done ? null : (value as string)
}

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

// ---------------------------------------------------------------------------
// Meters / summary rendering
// ---------------------------------------------------------------------------

function meterBar(label: string, value: number): string {
  const clamped = Math.max(0, Math.min(100, value))
  const filled = Math.round(clamped / 10)
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
  return `[${label} ${bar} ${clamped}]`
}

function memberName(state: MeetingState, id: MemberId): string {
  return state.members.find((m) => m.id === id)?.name ?? id
}

function stackSummary(state: MeetingState): string {
  if (state.motionStack.length === 0) return 'empty'
  return state.motionStack
    .map((m) => {
      const bits = [m.seconded ? 'seconded' : 'unseconded', m.statedByChair ? 'stated' : 'unstated']
      return `${m.kind} "${m.text}" (${bits.join(', ')})`
    })
    .join(' > ')
}

function printSummary(state: MeetingState, scenario: Scenario): void {
  out()
  out(`${meterBar('CTRL', state.meters.control)} ${meterBar('TRUST', state.meters.trust)}`)
  const item = scenario.agenda[state.currentItem]
  const itemLabel = item ? `Item ${state.currentItem + 1}/${scenario.agenda.length}: ${item.title}` : 'no item'
  const floor = state.floorHolder ? memberName(state, state.floorHolder) : 'none'
  out(`Turn ${state.turn} | Phase: ${state.phase} | ${itemLabel} | Floor: ${floor} | Stack: ${stackSummary(state)}`)

  if (state.pendingRequests.length === 0) {
    out('Pending requests: none')
  } else {
    out('Pending requests:')
    for (const r of state.pendingRequests) {
      const age = state.turn - r.createdTurn
      out(`  - ${r.kind} from ${memberName(state, r.member)} (age ${age} turn${age === 1 ? '' : 's'})`)
    }
  }
}

// ---------------------------------------------------------------------------
// Action palette
// ---------------------------------------------------------------------------

const VERB_ORDER: Action['verb'][] = [
  'CALL_ITEM',
  'RECOGNIZE',
  'STATE_MOTION',
  'RULE',
  'ANSWER_INQUIRY',
  'CALL_VOTE',
  'ANNOUNCE_RESULT',
  'GAVEL',
  'RECESS',
  'ADJOURN',
  'WAIT',
]

type PaletteEntry = { verb: Action['verb']; status: LegalityStatus; why: string }

function buildPalette(state: MeetingState, scenario: Scenario, learn: boolean): PaletteEntry[] {
  const report = legalActions(state, scenario)
  const entries = VERB_ORDER.map((verb) => ({ verb, status: report.verbs[verb].status, why: report.verbs[verb].why }))
  // Practice mode (default) shows every verb with no status tell at all.
  // Learn mode filters out anything OUT_OF_ORDER and shows the why text.
  return learn ? entries.filter((e) => e.status !== 'OUT_OF_ORDER') : entries
}

function printPalette(palette: PaletteEntry[], learn: boolean): void {
  out('Actions:')
  palette.forEach((entry, i) => {
    const label = learn ? `${entry.verb} — ${entry.why}` : entry.verb
    out(`  ${i + 1}) ${label}`)
  })
}

async function pickFromList<T>(items: T[], render: (item: T) => string, prompt: string): Promise<T | null> {
  if (items.length === 0) {
    out(`  (nothing available for ${prompt})`)
    return null
  }
  items.forEach((item, i) => out(`  ${i + 1}) ${render(item)}`))
  const line = await nextLine()
  if (line === null) return null
  const n = Number(line.trim())
  if (!Number.isInteger(n) || n < 1 || n > items.length) {
    out(`  Not a valid choice; leaving ${prompt} unset.`)
    return items[0]
  }
  return items[n - 1]
}

/** Builds the concrete Action for a chosen verb, prompting for any target it needs. */
async function buildAction(verb: Action['verb'], state: MeetingState, scenario: Scenario): Promise<Action | null> {
  switch (verb) {
    case 'CALL_ITEM':
    case 'STATE_MOTION':
    case 'ANNOUNCE_RESULT':
    case 'GAVEL':
    case 'ADJOURN':
    case 'WAIT':
      return { verb }

    case 'RECOGNIZE': {
      out('Recognize whom?')
      const targets = legalActions(state, scenario).targets.recognize
      const target = await pickFromList(targets, (id) => memberName(state, id), 'RECOGNIZE target')
      if (target === null) return null
      return { verb: 'RECOGNIZE', target }
    }

    case 'RULE': {
      out('Rule on which point of order?')
      const pending = state.pendingRequests.filter((r) => r.kind === 'POINT_OF_ORDER')
      const request = await pickFromList(
        pending,
        (r) => `${r.id}: ${memberName(state, r.member)} claims "${r.claim ?? ''}"`,
        'RULE target',
      )
      if (request === null) return null
      out('Ruling? 1) WELL_TAKEN  2) NOT_WELL_TAKEN')
      const rulingLine = await nextLine()
      if (rulingLine === null) return null
      const ruling = rulingLine.trim() === '1' ? 'WELL_TAKEN' : 'NOT_WELL_TAKEN'
      return { verb: 'RULE', target: request.id, ruling }
    }

    case 'ANSWER_INQUIRY': {
      out('Answer which inquiry?')
      const pending = state.pendingRequests.filter((r) => r.kind === 'INQUIRY')
      const request = await pickFromList(
        pending,
        (r) => `${r.id}: ${memberName(state, r.member)} asks "${r.question ?? ''}"`,
        'ANSWER_INQUIRY target',
      )
      if (request === null) return null
      const answers = request.answers ?? []
      const answer = await pickFromList(answers, (a) => a.text, 'answer')
      if (answer === null) return null
      return { verb: 'ANSWER_INQUIRY', target: request.id, answer: answer.id }
    }

    case 'CALL_VOTE': {
      out('Vote method? 1) VOICE  2) ROLL_CALL')
      const line = await nextLine()
      if (line === null) return null
      const method = line.trim() === '2' ? 'ROLL_CALL' : 'VOICE'
      return { verb: 'CALL_VOTE', method }
    }

    case 'RECESS': {
      out('Recess for how many minutes? (number)')
      const line = await nextLine()
      if (line === null) return null
      const minutes = Number(line.trim())
      return { verb: 'RECESS', minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 5 }
    }
  }
}

// ---------------------------------------------------------------------------
// Report card / collapse diagnostic
// ---------------------------------------------------------------------------

function printReportCard(state: MeetingState, scenario: Scenario): void {
  const report = buildReportCard(state, scenario)
  out()
  out('=== REPORT CARD ===')
  out(`Overall: ${report.overall}`)
  for (const [category, entry] of Object.entries(report.grades)) {
    out(`${category}: ${entry.grade} (${entry.score})`)
    for (const note of entry.notes) out(`  - ${note}`)
  }
  out(`Final meters: control ${report.meterFinal.control}, trust ${report.meterFinal.trust}`)
  out('Pedantry:')
  for (const line of report.pedantry) out(`  - ${line}`)
}

function printCollapseDiagnostic(diagnostic: { turn: number; delta: number; label: string }[]): void {
  out()
  out('=== COLLAPSE ===')
  if (diagnostic.length === 0) {
    out('  (no diagnostic available)')
  }
  for (const d of diagnostic.slice(0, 3)) {
    out(`  Turn ${d.turn}: ${d.delta} — ${d.label}`)
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const scenario = flags.scenarioId ? scenarioById(flags.scenarioId) : scenarios[0]
  if (!scenario) {
    out(`Unknown scenario id: ${flags.scenarioId}`)
    rl.close()
    process.exitCode = 1
    return
  }

  out(`Playing "${scenario.title}" (seed ${flags.seed}${flags.learn ? ', learn mode' : ''})`)

  let state = initMeeting(scenario, flags.seed)
  let printed: MeetingState = state // last state whose log we've fully rendered
  let presentRng = flags.seed
  let turnsTaken = 0

  const renderNew = (next: MeetingState): void => {
    for (const event of latestEvents(printed, next)) {
      const rendered = renderEvent(event, scenario, presentRng)
      presentRng = rendered.rngState
      out(rendered.line)
    }
    printed = next
  }

  renderNew(state)

  while (true) {
    if (state.phase === 'ADJOURNED') {
      printReportCard(state, scenario)
      out()
      out(`Session complete: ${turnsTaken} action(s) taken, meeting adjourned.`)
      break
    }

    if (state.phase === 'COLLAPSED') {
      const { state: restored, diagnostic } = restoreCheckpoint(state)
      printCollapseDiagnostic(diagnostic)
      out('Return to last checkpoint? (y/n)')
      const answer = await nextLine()
      if (answer === null) {
        out()
        out(`Session ended at EOF: ${turnsTaken} action(s) taken, meeting collapsed.`)
        break
      }
      if (answer.trim().toLowerCase().startsWith('y')) {
        state = restored
        printed = restored // the checkpoint's log was already narrated once; don't replay it
        out('Restored to the last checkpoint.')
        continue
      }
      out()
      out(`Session ended: ${turnsTaken} action(s) taken, meeting collapsed (not restored).`)
      break
    }

    printSummary(state, scenario)
    const palette = buildPalette(state, scenario, flags.learn)
    printPalette(palette, flags.learn)
    out('Pick an action number:')

    const line = await nextLine()
    if (line === null) {
      out()
      out(`Session ended at EOF: ${turnsTaken} action(s) taken, meeting still in progress.`)
      break
    }
    const n = Number(line.trim())
    if (!Number.isInteger(n) || n < 1 || n > palette.length) {
      out(`Not a valid choice: ${line}`)
      continue
    }

    const action = await buildAction(palette[n - 1].verb, state, scenario)
    if (action === null) {
      out()
      out(`Session ended at EOF: ${turnsTaken} action(s) taken, meeting still in progress.`)
      break
    }

    state = reduce(state, action, scenario)
    turnsTaken += 1
    renderNew(state)
  }

  rl.close()
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exitCode = 1
})
