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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const scenario = scenarios[0]

/** Intents the collapse modal draws its chaos lines from. */
const COLLAPSE_INTENTS = ['ROOM_TALKS_OVER_CHAIR', 'MOTION_DIES', 'GAVEL_IGNORED']

function transcriptLines(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.line'))
}

function collapseLineTexts(): string[] {
  return transcriptLines()
    .filter((li) => COLLAPSE_INTENTS.includes(li.dataset.intent ?? ''))
    .map((li) => li.textContent ?? '')
}

function chaosTexts(): string[] {
  return Array.from(document.querySelectorAll('.chaos li')).map((li) => li.textContent ?? '')
}

/**
 * Waits for the transcript's stagger queue to drain. Real timers: the palette
 * re-enables exactly when the queue empties, so waiting on that both settles
 * the turn and asserts the disable/enable cycle. A terminal phase keeps the
 * palette disabled and raises an overlay instead, so that counts as settled.
 *
 * (Fake timers were tried first and abandoned: user-event's own waits deadlock
 * under vitest's fake clock even with `advanceTimers` wired up, with or without
 * a narrowed `toFake`. The real 150ms stagger costs this test a few seconds.)
 */
async function settle(): Promise<void> {
  await waitFor(
    () => {
      if (screen.queryByRole('dialog') !== null) return
      expect((screen.getByRole('button', { name: 'Wait' }) as HTMLButtonElement).disabled).toBe(false)
    },
    { timeout: 10000, interval: 25 },
  )
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

    // The palette is dead while the room is still talking.
    expect((screen.getByRole('button', { name: 'Wait' }) as HTMLButtonElement).disabled).toBe(true)
    expect(transcriptLines().length).toBe(0)

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

  it('returns to Setup holding the choices the player made', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Learn/ }))
    const seed = screen.getByLabelText('Seed')
    await user.clear(seed)
    await user.type(seed, '7')
    await user.click(screen.getByRole('button', { name: /Call the meeting to order/i }))
    expect(screen.getByText(/Learn mode · seed 7/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Leave the meeting' }))

    expect((screen.getByLabelText('Seed') as HTMLInputElement).value).toBe('7')
    expect(screen.getByRole('button', { name: /Learn/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Practice/ }).getAttribute('aria-pressed')).toBe('false')
  })

  // Regression: `restoreCheckpoint` rewinds `eventSeq` along with the rest of
  // the state, so a restored meeting reissues event ids the transcript has
  // already shown (checkpoint at eventSeq 7 of 27 ⇒ the next event is `e8`
  // again). A render-once cache carried across the rewind swallowed every
  // subsequent event: the meeting kept running with a silent transcript, and a
  // second collapse re-showed the *first* collapse's chaos lines.
  it('keeps narrating after a checkpoint restore, and a second collapse is its own', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Call the meeting to order/i }))
    await settle()
    await user.click(screen.getByRole('button', { name: 'Call the item' }))
    await settle()

    // Waiting the room out costs control until the meeting comes apart.
    for (let i = 0; i < 15 && screen.queryByRole('dialog') === null; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Wait' }))
      await settle()
    }

    expect(screen.getByRole('dialog', { name: 'The meeting collapsed' })).toBeTruthy()
    const firstChaos = chaosTexts()
    expect(firstChaos).toHaveLength(3)
    expect(collapseLineTexts()).toEqual(firstChaos)

    const beforeRestore = transcriptLines().length
    await user.click(screen.getByRole('button', { name: /Return to last checkpoint/ }))
    await settle()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(/The chair takes it up again/)).toBeTruthy()
    const afterRestore = transcriptLines().length
    expect(afterRestore).toBeGreaterThan(beforeRestore)

    // The heart of it: the meeting still narrates once it has been rewound.
    await user.click(screen.getByRole('button', { name: 'Wait' }))
    await settle()
    expect(transcriptLines().length).toBeGreaterThan(afterRestore)

    // Run it back into the ground; the second collapse must show its own lines.
    for (let i = 0; i < 15 && screen.queryByRole('dialog') === null; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Wait' }))
      await settle()
    }

    expect(screen.getByRole('dialog', { name: 'The meeting collapsed' })).toBeTruthy()
    const allCollapseLines = collapseLineTexts()
    expect(allCollapseLines).toHaveLength(6) // three per collapse, both narrated
    expect(chaosTexts()).toEqual(allCollapseLines.slice(-3))
  }, 60000)
})

describe('CollapseModal', () => {
  it('aggregates the diagnostic into one line per reason', () => {
    render(
      <CollapseModal
        chaos={[
          { seq: 0, id: 'e1', text: 'Nobody is listening.', type: 'NARRATION', intent: 'GAVEL_IGNORED', speaker: null },
        ]}
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
