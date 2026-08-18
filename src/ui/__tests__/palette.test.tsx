// @vitest-environment jsdom
//
// Palette behaviour, with the emphasis on the one thing the UI must never do:
// tell the player which actions are in order (spec §4.3). Practice mode gets a
// state that genuinely contains both IN_ORDER and OUT_OF_ORDER verbs, then
// asserts that nothing in the rendered markup distinguishes them.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { initMeeting, legalActions } from '../../engine/index'
import { scenarios } from '../../content/index'
import { modes } from '../../modes/modes'
import { Palette } from '../Palette'
import type { Action } from '../../engine/index'

afterEach(cleanup)

/**
 * The order the palette must render, spelled out here rather than imported so
 * the test pins the contract instead of agreeing with the implementation.
 */
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

const scenario = scenarios[0]

function setup() {
  const state = initMeeting(scenario, 1)
  const report = legalActions(state, scenario)
  return { state, report }
}

function verbButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-verb]'))
}

describe('Palette — practice mode', () => {
  it('renders all eleven verbs in the fixed order', () => {
    const { state, report } = setup()
    render(
      <Palette state={state} report={report} mode={modes.practice} disabled={false} onAction={vi.fn()} />,
    )

    const buttons = verbButtons()
    expect(buttons).toHaveLength(11)
    expect(buttons.map((b) => b.dataset.verb)).toEqual(VERB_ORDER)
  })

  it('gives IN_ORDER and OUT_OF_ORDER verbs identical markup', () => {
    const { state, report } = setup()
    // The fixture has to actually contain both statuses or this proves nothing.
    const statuses = new Set(VERB_ORDER.map((verb) => report.verbs[verb].status))
    expect(statuses.has('IN_ORDER')).toBe(true)
    expect(statuses.has('OUT_OF_ORDER')).toBe(true)

    render(
      <Palette state={state} report={report} mode={modes.practice} disabled={false} onAction={vi.fn()} />,
    )

    // Every attribute on every button, minus the verb identity itself, must be
    // the same for all eleven — no status-derived class, title, aria or state.
    const fingerprints = verbButtons().map((button) =>
      Array.from(button.attributes)
        .filter((attr) => attr.name !== 'data-verb')
        .map((attr) => `${attr.name}=${attr.value}`)
        .sort()
        .join('|'),
    )
    expect(new Set(fingerprints).size).toBe(1)

    for (const button of verbButtons()) {
      expect(button.className).toBe('verb-btn')
      expect(button.hasAttribute('title')).toBe(false)
      expect(button.disabled).toBe(false)
    }
  })
})

describe('Palette — learn mode', () => {
  it('renders only IN_ORDER verbs, each with its why as a tooltip', () => {
    const { state, report } = setup()
    render(
      <Palette state={state} report={report} mode={modes.learn} disabled={false} onAction={vi.fn()} />,
    )

    const inOrder = VERB_ORDER.filter((verb) => report.verbs[verb].status === 'IN_ORDER')
    const buttons = verbButtons()
    expect(buttons.map((b) => b.dataset.verb)).toEqual(inOrder)
    expect(buttons.length).toBeLessThan(VERB_ORDER.length)

    for (const button of buttons) {
      const verb = button.dataset.verb as (typeof VERB_ORDER)[number]
      expect(button.getAttribute('title')).toBe(report.verbs[verb].why)
    }
  })
})

describe('Palette — target pickers', () => {
  it('surfaces member targets for RECOGNIZE and emits the action', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { state, report } = setup()
    render(
      <Palette state={state} report={report} mode={modes.practice} disabled={false} onAction={onAction} />,
    )

    await user.click(screen.getByRole('button', { name: 'Recognize' }))

    const targets = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-member-id]'))
    expect(targets.map((b) => b.dataset.memberId)).toEqual(report.targets.recognize)
    // Real names, not ids.
    const first = state.members.find((m) => m.id === report.targets.recognize[0])
    expect(targets[0].textContent).toBe(first?.name)

    await user.click(targets[0])
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith({ verb: 'RECOGNIZE', target: report.targets.recognize[0] })
  })

  it('emits a bare action for verbs that need no target', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { state, report } = setup()
    render(
      <Palette state={state} report={report} mode={modes.practice} disabled={false} onAction={onAction} />,
    )

    await user.click(screen.getByRole('button', { name: 'Wait' }))
    expect(onAction).toHaveBeenCalledWith({ verb: 'WAIT' })
  })

  it('closes the target picker on Escape without emitting anything', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { state, report } = setup()
    render(
      <Palette state={state} report={report} mode={modes.practice} disabled={false} onAction={onAction} />,
    )

    await user.click(screen.getByRole('button', { name: 'Recognize' }))
    expect(document.querySelectorAll('button[data-member-id]').length).toBeGreaterThan(0)

    await user.keyboard('{Escape}')
    expect(document.querySelectorAll('button[data-member-id]')).toHaveLength(0)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('says so when a verb has no target to act on', async () => {
    const user = userEvent.setup()
    const { state, report } = setup()
    expect(report.targets.rule).toHaveLength(0)

    render(
      <Palette state={state} report={report} mode={modes.practice} disabled={false} onAction={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Rule on the point' }))
    expect(screen.getByText(/no point of order before the chair/i)).toBeTruthy()
  })
})
