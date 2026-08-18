// The clerk's assessment, after the fact.
//
// This is the only grading surface in the game (spec: no "Correct!"/"Wrong!"
// during play). Five categories with a letter, a score and the notes the
// engine wrote, then the pedantry — the small, true, slightly insufferable
// observations — set as footnotes.

import type { ReportCard as ReportCardData } from '../engine/index'

const CATEGORY_ORDER: (keyof ReportCardData['grades'])[] = [
  'procedure',
  'fairness',
  'efficiency',
  'clarity',
  'completion',
]

const CATEGORY_LABELS: Record<keyof ReportCardData['grades'], string> = {
  procedure: 'Procedure',
  fairness: 'Fairness',
  efficiency: 'Efficiency',
  clarity: 'Clarity',
  completion: 'Completion',
}

export type ReportCardProps = {
  report: ReportCardData
  scenarioTitle: string
  seed: number
  onRunItBack: () => void
  onChangeSetup: () => void
}

export function ReportCard({
  report,
  scenarioTitle,
  seed,
  onRunItBack,
  onChangeSetup,
}: ReportCardProps) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Report card">
      <div className="overlay-card report-card">
        <div className="report-head">
          <div>
            <h2 className="overlay-title">Minutes closed</h2>
            <p className="report-sub">
              {scenarioTitle} · seed {seed}
            </p>
          </div>
          <div className="overall">
            <span className="overall-grade" data-grade={report.overall}>
              {report.overall}
            </span>
            <span className="overall-label">overall</span>
          </div>
        </div>

        <ul className="grades">
          {CATEGORY_ORDER.map((category) => {
            const entry = report.grades[category]
            return (
              <li key={category} className="grade">
                <div className="grade-head">
                  <span className="grade-letter" data-grade={entry.grade}>
                    {entry.grade}
                  </span>
                  <span className="grade-name">{CATEGORY_LABELS[category]}</span>
                  <span className="grade-score">{entry.score}</span>
                </div>
                <ul className="grade-notes">
                  {entry.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>

        <div className="report-meters">
          <span>
            Control <strong>{report.meterFinal.control}</strong>
          </span>
          <span>
            Trust <strong>{report.meterFinal.trust}</strong>
          </span>
        </div>

        <h3 className="panel-subheading">Noted for the record</h3>
        <ol className="pedantry">
          {report.pedantry.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ol>

        <div className="overlay-actions">
          <button type="button" className="primary-btn" onClick={onRunItBack}>
            Run it back
            <span className="btn-sub">same meeting, same seed</span>
          </button>
          <button type="button" className="ghost-btn" onClick={onChangeSetup}>
            Change setup
          </button>
        </div>
      </div>
    </div>
  )
}
