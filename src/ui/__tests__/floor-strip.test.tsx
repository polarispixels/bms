// @vitest-environment jsdom
//
// The floor strip: who is visibly waiting on the chair, rendered at the point
// of action rather than inside a state panel the player has to go looking for.
//
// Playtest feedback (round two): "the hint says somebody's had their hand up
// for a long time but I don't see anything in the interface that says anybody
// has their hand up". The state was there; it was just nowhere near the
// buttons, and it was written in engine.
//
// Two properties matter beyond the labels:
//   - a chip is world state, not legality — it says who is asking, never
//     whether acting on them is in order, so it renders the same in Practice
//     and Learn (the palette's no-tell fingerprint is untouched by design:
//     chips live outside the `data-verb` button set entirely);
//   - a chip that leads to a *judgement* (rule a point, answer a question)
//     opens the picker with the target filled in and the judgement blank. The
//     chair still decides. Preselecting the ruling would be grading.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describeSituation, initMeeting, legalActions } from '../../engine/index'
import type { Action, MeetingState, Request } from '../../engine/index'
import { scenarios } from '../../content/index'
import { modes } from '../../modes/modes'
import { FloorStrip } from '../FloorStrip'
import { Palette } from '../Palette'
import type { PaletteFocus } from '../Palette'
import { SituationLine } from '../SituationLine'

afterEach(cleanup)

const scenario = scenarios[0]

const RUTH_HAND: Request = { id: 'r-hand', kind: 'RECOGNITION', member: 'ruth', createdTurn: 1, purpose: 'MOVE' }
const HAL_POINT: Request = {
  id: 'r-point',
  kind: 'POINT_OF_ORDER',
  member: 'hal',
  createdTurn: 2,
  claim: 'the motion was never stated',
  valid: true,
}
const DEE_INQUIRY: Request = {
  id: 'r-inquiry',
  kind: 'INQUIRY',
  member: 'dee',
  createdTurn: 3,
  question: 'does the covenant apply here?',
  answers: [
    { id: 'a1', text: 'It does.', correct: true },
    { id: 'a2', text: 'It does not.', correct: false },
  ],
}
const CARL_INTERRUPT: Request = { id: 'r-int', kind: 'INTERRUPT', member: 'carl', createdTurn: 4 }

function stateWith(pendingRequests: Request[], turn = 4): MeetingState {
  return { ...initMeeting(scenario, 1), pendingRequests, turn }
}

function chips(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-request-id]'))
}

function renderStrip(state: MeetingState, props?: { disabled?: boolean; onAction?: (a: Action) => void }) {
  const onAction = props?.onAction ?? vi.fn()
  render(
    <FloorStrip
      state={state}
      scenario={scenario}
      disabled={props?.disabled ?? false}
      onAction={onAction}
      onOpenPicker={vi.fn()}
    />,
  )
  return onAction
}

describe('FloorStrip — what the room shows', () => {
  it('renders nothing at all when nobody is waiting', () => {
    const { container } = render(
      <FloorStrip
        state={stateWith([])}
        scenario={scenario}
        disabled={false}
        onAction={vi.fn()}
        onOpenPicker={vi.fn()}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders one chip per pending request, oldest first, with first names', () => {
    // Deliberately out of order in the state: the strip sorts by age.
    renderStrip(stateWith([CARL_INTERRUPT, DEE_INQUIRY, HAL_POINT, RUTH_HAND]))

    const labels = chips().map((b) => b.textContent)
    expect(labels).toEqual([
      '✋ Ruth · waiting 3 turns',
      '❗ Point of order — Harold · waiting 2 turns',
      '❓ Question — Dee',
      '🗯 Carl (interrupting)',
    ])
    expect(chips().map((b) => b.dataset.requestId)).toEqual(['r-hand', 'r-point', 'r-inquiry', 'r-int'])
  })

  it('shows age only once a request has been waiting two turns or more', () => {
    renderStrip(stateWith([{ ...RUTH_HAND, createdTurn: 3 }], 4)) // age 1
    expect(chips()[0].textContent).toBe('✋ Ruth')
  })

  it('renders the same chips in Learn mode as in Practice (world state, not legality)', () => {
    // The strip takes no mode prop at all — the assertion is structural.
    renderStrip(stateWith([HAL_POINT]))
    expect(chips()).toHaveLength(1)
    expect(document.querySelectorAll('button[data-verb]')).toHaveLength(0)
  })

  it('disables every chip while the room is still talking', () => {
    renderStrip(stateWith([RUTH_HAND, HAL_POINT]), { disabled: true })
    expect(chips().every((b) => b.disabled)).toBe(true)
  })
})

describe('FloorStrip — chips as shortcuts', () => {
  it('dispatches RECOGNIZE for a raised hand', async () => {
    const user = userEvent.setup()
    const onAction = renderStrip(stateWith([RUTH_HAND]))

    await user.click(chips()[0])
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith({ verb: 'RECOGNIZE', target: 'ruth' })
  })

  it('dispatches RECOGNIZE for an interrupter too', async () => {
    const user = userEvent.setup()
    const onAction = renderStrip(stateWith([CARL_INTERRUPT]))

    await user.click(chips()[0])
    expect(onAction).toHaveBeenCalledWith({ verb: 'RECOGNIZE', target: 'carl' })
  })

  it('asks for the RULE picker on a point of order, and the ANSWER picker on an inquiry', async () => {
    const user = userEvent.setup()
    const onOpenPicker = vi.fn()
    render(
      <FloorStrip
        state={stateWith([HAL_POINT, DEE_INQUIRY])}
        scenario={scenario}
        disabled={false}
        onAction={vi.fn()}
        onOpenPicker={onOpenPicker}
      />,
    )

    await user.click(chips()[0])
    expect(onOpenPicker).toHaveBeenLastCalledWith({ kind: 'RULE', target: 'r-point' })

    await user.click(chips()[1])
    expect(onOpenPicker).toHaveBeenLastCalledWith({ kind: 'ANSWER', target: 'r-inquiry' })
  })
})

/** The strip and the palette wired together the way App wires them. */
function Dock({ state, onAction }: { state: MeetingState; onAction: (a: Action) => void }) {
  const [focus, setFocus] = useState<PaletteFocus | null>(null)
  return (
    <>
      <FloorStrip
        state={state}
        scenario={scenario}
        disabled={false}
        onAction={onAction}
        onOpenPicker={setFocus}
      />
      <Palette
        state={state}
        report={legalActions(state, scenario)}
        scenario={scenario}
        mode={modes.practice}
        disabled={false}
        onAction={onAction}
        focus={focus}
      />
    </>
  )
}

describe('FloorStrip + Palette', () => {
  it('opens the ruling picker with the point chosen and the ruling left to the chair', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<Dock state={stateWith([HAL_POINT])} onAction={onAction} />)

    await user.click(chips()[0])

    // Straight to the ruling: the target step is skipped, the judgement is not.
    expect(screen.getByText(/the chair rules the point/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Well taken' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not well taken' })).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Not well taken' }))
    expect(onAction).toHaveBeenCalledWith({ verb: 'RULE', target: 'r-point', ruling: 'NOT_WELL_TAKEN' })
  })

  it('opens the answer picker with the inquiry chosen and no answer preselected', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<Dock state={stateWith([DEE_INQUIRY])} onAction={onAction} />)

    await user.click(chips()[0])

    expect(screen.getByText(/the chair answers/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'It does.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'It does not.' })).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'It does.' }))
    expect(onAction).toHaveBeenCalledWith({ verb: 'ANSWER_INQUIRY', target: 'r-inquiry', answer: 'a1' })
  })

  it('reopens the same picker after the chair backs out of it', async () => {
    const user = userEvent.setup()
    render(<Dock state={stateWith([HAL_POINT])} onAction={vi.fn()} />)

    await user.click(chips()[0])
    await user.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.queryByText(/the chair rules the point/i)).toBeNull()

    await user.click(chips()[0])
    expect(screen.getByText(/the chair rules the point/i)).toBeTruthy()
  })
})

describe('SituationLine', () => {
  it('shows the engine sentence under a plain label', () => {
    const state = stateWith([RUTH_HAND])
    render(<SituationLine state={state} scenario={scenario} />)

    expect(screen.getByText('The floor')).toBeTruthy()
    expect(screen.getByText(describeSituation(state, scenario))).toBeTruthy()
  })
})
