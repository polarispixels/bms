// The meeting got away from the chair.
//
// The diagnostic is aggregated per reason (D10): ten small hesitations that
// add up to -30 read as one line, "−30 across 10 turns: …", rather than ten
// separate -3s. `restoreCheckpoint` is pure, so calling it here purely to read
// the diagnosis costs nothing — App calls it again when the player accepts.

import type { DiagnosticEntry } from '../engine/index'
import type { Line } from './Transcript'

export type CollapseModalProps = {
  /** The collapse narration lines, already rendered. */
  chaos: Line[]
  diagnostic: DiagnosticEntry[]
  checkpointLabel: string | null
  onRestore: () => void
  onRestart: () => void
}

function diagnosticLine(entry: DiagnosticEntry): string {
  const total = `−${Math.abs(entry.total)}`
  return entry.count > 1
    ? `${total} across ${entry.count} turns: ${entry.label}`
    : `${total}: ${entry.label}`
}

export function CollapseModal({
  chaos,
  diagnostic,
  checkpointLabel,
  onRestore,
  onRestart,
}: CollapseModalProps) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="The meeting collapsed">
      <div className="overlay-card collapse-card">
        <h2 className="overlay-title">Order is lost</h2>

        <ul className="chaos">
          {chaos.map((line) => (
            <li key={line.id}>{line.text}</li>
          ))}
        </ul>

        <h3 className="panel-subheading">What cost you the room</h3>
        {diagnostic.length === 0 ? (
          <p className="muted">The clerk has nothing particular to point to.</p>
        ) : (
          <ul className="diagnostic">
            {diagnostic.map((entry) => (
              <li key={entry.reason}>{diagnosticLine(entry)}</li>
            ))}
          </ul>
        )}

        <div className="overlay-actions">
          {checkpointLabel && (
            <button type="button" className="primary-btn" onClick={onRestore}>
              Return to last checkpoint
              <span className="btn-sub">{checkpointLabel}</span>
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={onRestart}>
            Start over
          </button>
        </div>
      </div>
    </div>
  )
}
