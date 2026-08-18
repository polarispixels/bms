// The title screen: pick a meeting, a mode, and a seed.
//
// The seed is exposed on purpose. The engine is deterministic (same scenario +
// same seed + same actions ⇒ same meeting), so a seed is a shareable meeting,
// and "Run it back" on the report card is just this screen's seed held fixed.

import { useState } from 'react'
import type { Scenario } from '../engine/index'
import { DEFAULT_MODE, MODE_ORDER, modes } from '../modes/modes'
import type { ModeId } from '../modes/modes'

export type SetupChoice = { scenarioId: string; modeId: ModeId; seed: number }

export type SetupProps = {
  scenarios: Scenario[]
  initial?: SetupChoice
  onStart: (choice: SetupChoice) => void
}

export function Setup({ scenarios, initial, onStart }: SetupProps) {
  const [scenarioId, setScenarioId] = useState(initial?.scenarioId ?? scenarios[0]?.id ?? '')
  const [modeId, setModeId] = useState<ModeId>(initial?.modeId ?? DEFAULT_MODE)
  const [seedText, setSeedText] = useState(String(initial?.seed ?? 1))

  const seed = Number(seedText)
  const seedValid = Number.isFinite(seed) && seedText.trim() !== ''

  return (
    <div className="setup">
      <div className="setup-card">
        <h1 className="setup-title">Order!</h1>
        <p className="setup-subtitle">
          A board meeting simulator. You are the chair. The rules are not the hard part.
        </p>

        <section className="setup-section">
          <h2 className="panel-heading">Meeting</h2>
          <ul className="scenario-list">
            {scenarios.map((scenario) => (
              <li key={scenario.id}>
                <button
                  type="button"
                  className="scenario-btn"
                  aria-pressed={scenario.id === scenarioId}
                  onClick={() => setScenarioId(scenario.id)}
                >
                  <span className="scenario-name">{scenario.title}</span>
                  <span className="scenario-body">{scenario.body}</span>
                  <span className="scenario-meta">
                    {scenario.agenda.length} item{scenario.agenda.length === 1 ? '' : 's'} · par{' '}
                    {scenario.parTurns} turns · {scenario.present.length} of {scenario.seats} present
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="setup-section">
          <h2 className="panel-heading">Mode</h2>
          <ul className="mode-list">
            {MODE_ORDER.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="mode-btn"
                  aria-pressed={id === modeId}
                  onClick={() => setModeId(id)}
                >
                  <span className="mode-name">{modes[id].label}</span>
                  <span className="mode-blurb">{modes[id].blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="setup-section setup-seed">
          <label className="panel-heading" htmlFor="seed">
            Seed
          </label>
          <input
            id="seed"
            className="seed-input"
            type="number"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
          />
          <p className="seed-help">The same seed runs the same meeting.</p>
        </section>

        <button
          type="button"
          className="start-btn"
          disabled={!seedValid || scenarioId === ''}
          onClick={() => onStart({ scenarioId, modeId, seed })}
        >
          Call the meeting to order
        </button>
      </div>
    </div>
  )
}
