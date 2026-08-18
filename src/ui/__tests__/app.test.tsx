// @vitest-environment jsdom
//
// Shell-level smoke: setup screen → a running meeting → a turn taken, plus the
// two overlay presentations (collapse diagnostic, report card) rendered
// directly so their copy is pinned without having to drive a whole meeting.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildReportCard, initMeeting, reduce } from '../../engine/index'
import { scenarios } from '../../content/index'
import App from '../App'
import { CollapseModal } from '../CollapseModal'
import { ReportCard } from '../ReportCard'

afterEach(cleanup)

const scenario = scenarios[0]

function transcriptLines(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.line'))
}

describe('App', () => {
  it('opens on the setup screen', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Order!' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /The Fence Variance/ })).toBeTruthy()
    // Practice is the default mode.
    expect(screen.getByRole('button', { name: /Practice/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('starts a meeting, narrates it, and takes a turn', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Call the meeting to order/i }))

    // The opening events stagger in rather than landing all at once.
    await waitFor(() => expect(transcriptLines().length).toBeGreaterThan(1), { timeout: 5000 })
    const opening = await waitFor(
      () => {
        const button = screen.getByRole('button', { name: 'Call the item' }) as HTMLButtonElement
        expect(button.disabled).toBe(false) // the queue has drained
        return transcriptLines().length
      },
      { timeout: 5000 },
    )

    await user.click(screen.getByRole('button', { name: 'Call the item' }))
    await waitFor(() => expect(transcriptLines().length).toBeGreaterThan(opening), { timeout: 5000 })

    // The state panel tracks the engine.
    expect(screen.getByText(scenario.agenda[0].title)).toBeTruthy()
    expect(screen.getByRole('meter', { name: 'CONTROL' })).toBeTruthy()
  })
})

describe('CollapseModal', () => {
  it('aggregates the diagnostic into one line per reason', () => {
    render(
      <CollapseModal
        chaos={[{ id: 'e1', text: 'Nobody is listening.', type: 'NARRATION', intent: 'GAVEL_IGNORED', speaker: null }]}
        diagnostic={[
          { reason: 'HESITATION', label: 'The chair kept waiting.', count: 10, total: -30 },
          { reason: 'INVALID_RULING', label: 'A valid point was overruled.', count: 1, total: -6 },
        ]}
        checkpointLabel="Item 2: Fence variance opened"
        onRestore={vi.fn()}
        onRestart={vi.fn()}
      />,
    )

    expect(screen.getByText('−30 across 10 turns: The chair kept waiting.')).toBeTruthy()
    expect(screen.getByText('−6: A valid point was overruled.')).toBeTruthy()
    expect(screen.getByText('Nobody is listening.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Return to last checkpoint/ })).toBeTruthy()
  })

  it('offers no checkpoint button when there is nothing to rewind to', () => {
    render(
      <CollapseModal
        chaos={[]}
        diagnostic={[]}
        checkpointLabel={null}
        onRestore={vi.fn()}
        onRestart={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /Return to last checkpoint/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy()
  })
})

describe('ReportCard', () => {
  it('shows a letter and score for every category plus the pedantry', () => {
    const adjourned = reduce(initMeeting(scenario, 1), { verb: 'ADJOURN' }, scenario)
    const report = buildReportCard(adjourned, scenario)

    render(
      <ReportCard
        report={report}
        scenarioTitle={scenario.title}
        seed={1}
        onRunItBack={vi.fn()}
        onChangeSetup={vi.fn()}
      />,
    )

    for (const category of ['Procedure', 'Fairness', 'Efficiency', 'Clarity', 'Completion']) {
      expect(screen.getByText(category)).toBeTruthy()
    }
    expect(document.querySelectorAll('.grade')).toHaveLength(5)
    expect(document.querySelectorAll('.pedantry li').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByRole('button', { name: /Run it back/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change setup' })).toBeTruthy()
  })
})
