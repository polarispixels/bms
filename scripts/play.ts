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
import type { Action, DiagnosticEntry, LegalityStatus, MeetingState, MemberId } from '../src/engine/index.ts'
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
  // Learn mode shows only verbs that are IN_ORDER right now (not RISKY, not
  // OUT_OF_ORDER) and explains why with the legality report's `why` text.
  return learn ? entries.filter((e) => e.status === 'IN_ORDER') : entries
}

function printPalette(palette: PaletteEntry[], learn: boolean): void {
  out('Actions:')
  palette.forEach((entry, i) => {
    const label = learn ? `${entry.verb} — ${entry.why}` : entry.verb
    out(`  ${i + 1}) ${label}`)
  })
}

// A sub-prompt (picking a target, or the whole action) can end three ways:
// a real pick, stdin closing (genuine EOF — the session must end), or the
// list of choices being empty (no target exists — nothing was typed, so
// this is NOT EOF; the chair just can't do this right now). Conflating the
// last two would make an empty RULE/ANSWER_INQUIRY target list silently
// abort the whole session and discard the rest of a piped script.
type Picked<T> = { kind: 'PICKED'; value: T } | { kind: 'EMPTY' } | { kind: 'EOF' }

async function pickFromList<T>(items: T[], render: (item: T) => string, prompt: string): Promise<Picked<T>> {
  if (items.length === 0) return { kind: 'EMPTY' }
  items.forEach((item, i) => out(`  ${i + 1}) ${render(item)}`))
  const line = await nextLine()
  if (line === null) return { kind: 'EOF' }
  const n = Number(line.trim())
  if (!Number.isInteger(n) || n < 1 || n > items.length) {
    out(`  Not a valid choice; leaving ${prompt} unset.`)
    return { kind: 'PICKED', value: items[0] }
  }
  return { kind: 'PICKED', value: items[n - 1] }
}

// Building an action can likewise come back as a real action, a genuine EOF,
// or EMPTY: the verb needs a target that does not currently exist (no
// pending point of order, no pending inquiry, nobody present to recognize).
// EMPTY costs no game turn — the caller prints the notice and re-shows the
// menu, still reading the same stdin stream.
type BuildResult = { kind: 'ACTION'; action: Action } | { kind: 'EMPTY'; message: string } | { kind: 'EOF' }

/** Builds the concrete Action for a chosen verb, prompting for any target it needs. */
async function buildAction(verb: Action['verb'], state: MeetingState, scenario: Scenario): Promise<BuildResult> {
  switch (verb) {
    case 'CALL_ITEM':
    case 'STATE_MOTION':
    case 'ANNOUNCE_RESULT':
    case 'GAVEL':
    case 'ADJOURN':
    case 'WAIT':
      return { kind: 'ACTION', action: { verb } }

    case 'RECOGNIZE': {
      out('Recognize whom?')
      const targets = legalActions(state, scenario).targets.recognize
      const picked = await pickFromList(targets, (id) => memberName(state, id), 'RECOGNIZE target')
      if (picked.kind === 'EMPTY') return { kind: 'EMPTY', message: 'There is nobody present for the chair to recognize.' }
      if (picked.kind === 'EOF') return { kind: 'EOF' }
      return { kind: 'ACTION', action: { verb: 'RECOGNIZE', target: picked.value } }
    }

    case 'RULE': {
      out('Rule on which point of order?')
      const pending = state.pendingRequests.filter((r) => r.kind === 'POINT_OF_ORDER')
      const picked = await pickFromList(
        pending,
        (r) => `${r.id}: ${memberName(state, r.member)} claims "${r.claim ?? ''}"`,
        'RULE target',
      )
      if (picked.kind === 'EMPTY') return { kind: 'EMPTY', message: 'There is no point of order before the chair.' }
      if (picked.kind === 'EOF') return { kind: 'EOF' }
      out('Ruling? 1) WELL_TAKEN  2) NOT_WELL_TAKEN')
      const rulingLine = await nextLine()
      if (rulingLine === null) return { kind: 'EOF' }
      const ruling = rulingLine.trim() === '1' ? 'WELL_TAKEN' : 'NOT_WELL_TAKEN'
      return { kind: 'ACTION', action: { verb: 'RULE', target: picked.value.id, ruling } }
    }

    case 'ANSWER_INQUIRY': {
      out('Answer which inquiry?')
      const pending = state.pendingRequests.filter((r) => r.kind === 'INQUIRY')
      const picked = await pickFromList(
        pending,
        (r) => `${r.id}: ${memberName(state, r.member)} asks "${r.question ?? ''}"`,
        'ANSWER_INQUIRY target',
      )
      if (picked.kind === 'EMPTY') return { kind: 'EMPTY', message: 'There is no inquiry before the chair.' }
      if (picked.kind === 'EOF') return { kind: 'EOF' }
      const answers = picked.value.answers ?? []
      const answerPicked = await pickFromList(answers, (a) => a.text, 'answer')
      if (answerPicked.kind === 'EMPTY') return { kind: 'EMPTY', message: 'The chair has nothing to answer with.' }
      if (answerPicked.kind === 'EOF') return { kind: 'EOF' }
      return { kind: 'ACTION', action: { verb: 'ANSWER_INQUIRY', target: picked.value.id, answer: answerPicked.value.id } }
    }

    case 'CALL_VOTE': {
      out('Vote method? 1) VOICE  2) ROLL_CALL')
      const line = await nextLine()
      if (line === null) return { kind: 'EOF' }
      const method = line.trim() === '2' ? 'ROLL_CALL' : 'VOICE'
      return { kind: 'ACTION', action: { verb: 'CALL_VOTE', method } }
    }

    case 'RECESS': {
      out('Recess for how many minutes? (number)')
      const line = await nextLine()
      if (line === null) return { kind: 'EOF' }
      const minutes = Number(line.trim())
      return { kind: 'ACTION', action: { verb: 'RECESS', minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 5 } }
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

function printCollapseDiagnostic(diagnostic: DiagnosticEntry[]): void {
  out()
  out('=== COLLAPSE ===')
  if (diagnostic.length === 0) {
    out('  (no diagnostic available)')
  }
  for (const d of diagnostic.slice(0, 3)) {
    if (d.count > 1) {
      out(`  ${d.total} across ${d.count} turn(s): ${d.label}`)
    } else {
      out(`  ${d.total}: ${d.label}`)
    }
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

    const result = await buildAction(palette[n - 1].verb, state, scenario)
    if (result.kind === 'EOF') {
      out()
      out(`Session ended at EOF: ${turnsTaken} action(s) taken, meeting still in progress.`)
      break
    }
    if (result.kind === 'EMPTY') {
      out(result.message)
      continue // no target existed to act on; no turn taken, keep reading input
    }

    state = reduce(state, result.action, scenario)
    turnsTaken += 1
    renderNew(state)
  }

  rl.close()
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exitCode = 1
})
