// The chair's action palette.
//
// Verbs render in one fixed order, always the same order, with one class for
// every button. In Practice mode that is the whole point: spec §4.3 forbids the
// UI from telling the player which actions are in order, so an OUT_OF_ORDER
// button must be indistinguishable from an IN_ORDER one — same class, same
// tooltip (none), same enabled state, same position. Learn mode is the only
// mode that filters, and it filters by *removing* verbs, never by styling them.
//
// Verbs that need a target open a second row inline (members to recognize,
// points to rule on, inquiries to answer, vote method, recess length). Escape
// or "Back" cancels without spending a turn, and a verb whose targets are all
// gone shows a note instead of an empty row.

import { useCallback, useEffect, useState } from 'react'
import { suggestAction } from '../engine/index'
import type { Action, LegalityReport, MeetingState, MemberId, Request, RequestId, Scenario } from '../engine/index'
import type { ModeConfig } from '../modes/modes'

/** Fixed palette order. Never re-sorted — ordering would be a legality tell. */
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

const VERB_LABELS: Record<Action['verb'], string> = {
  CALL_ITEM: 'Call the item',
  RECOGNIZE: 'Recognize',
  STATE_MOTION: 'State the question',
  RULE: 'Rule on the point',
  ANSWER_INQUIRY: 'Answer the inquiry',
  CALL_VOTE: 'Put it to a vote',
  ANNOUNCE_RESULT: 'Announce the result',
  GAVEL: 'Gavel',
  RECESS: 'Recess',
  ADJOURN: 'Adjourn',
  WAIT: 'Wait',
}

/** Recess lengths the chair may declare (a fixed, small choice). */
const RECESS_MINUTES = [5, 10, 15]

type Step =
  | { kind: 'IDLE' }
  | { kind: 'RECOGNIZE' }
  | { kind: 'RULE_TARGET' }
  | { kind: 'RULE_RULING'; target: RequestId }
  | { kind: 'ANSWER_TARGET' }
  | { kind: 'ANSWER_CHOICE'; target: RequestId }
  | { kind: 'VOTE_METHOD' }
  | { kind: 'RECESS' }

/**
 * A sub-picker the floor strip has asked the palette to open, with the target
 * already chosen (the chip the player tapped names it) and the *judgement*
 * still open — the ruling and the answer are the chair's to make, never
 * something the UI preselects. A fresh object means "open it again", so tapping
 * the same chip after backing out reopens the picker.
 */
export type PaletteFocus =
  | { kind: 'RULE'; target: RequestId }
  | { kind: 'ANSWER'; target: RequestId }

export type PaletteProps = {
  state: MeetingState
  report: LegalityReport
  scenario: Scenario
  mode: ModeConfig
  /** True while the transcript is still staggering in the last turn's lines. */
  disabled: boolean
  onAction: (action: Action) => void
  /** Optional: a picker the floor strip wants opened on a given target. */
  focus?: PaletteFocus | null
}

function memberName(state: MeetingState, id: MemberId): string {
  return state.members.find((m) => m.id === id)?.name ?? id
}

export function Palette({ state, report, scenario, mode, disabled, onAction, focus }: PaletteProps) {
  const [step, setStep] = useState<Step>({ kind: 'IDLE' })
  // The clerk's suggestion, computed fresh at click time so it always reflects
  // the current state rather than a stale render (D-hint).
  const [hint, setHint] = useState<{ action: Action; why: string } | null>(null)

  const cancel = useCallback(() => setStep({ kind: 'IDLE' }), [])

  // Escape backs out of any sub-picker.
  useEffect(() => {
    if (step.kind === 'IDLE') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step.kind, cancel])

  // A tap on a floor chip lands here: jump straight to the step that still
  // needs a decision, with the target already chosen. Keyed on the object
  // identity rather than its contents, so tapping the same chip twice (after a
  // "← Back", say) opens the picker again rather than doing nothing.
  useEffect(() => {
    if (!focus) return
    setStep(
      focus.kind === 'RULE'
        ? { kind: 'RULE_RULING', target: focus.target }
        : { kind: 'ANSWER_CHOICE', target: focus.target },
    )
  }, [focus])

  const emit = (action: Action) => {
    setStep({ kind: 'IDLE' })
    onAction(action)
  }

  const chooseVerb = (verb: Action['verb']) => {
    switch (verb) {
      case 'RECOGNIZE':
        return setStep({ kind: 'RECOGNIZE' })
      case 'RULE':
        return setStep({ kind: 'RULE_TARGET' })
      case 'ANSWER_INQUIRY':
        return setStep({ kind: 'ANSWER_TARGET' })
      case 'CALL_VOTE':
        return setStep({ kind: 'VOTE_METHOD' })
      case 'RECESS':
        return setStep({ kind: 'RECESS' })
      default:
        return emit({ verb } as Action)
    }
  }

  // Learn mode filters the palette down to what is in order; Practice shows
  // every verb. Both read the flag off the mode config.
  const verbs = VERB_ORDER.filter(
    (verb) => !mode.filterToInOrder || report.verbs[verb].status === 'IN_ORDER',
  )

  const requestById = (id: RequestId) => state.pendingRequests.find((r) => r.id === id)

  return (
    <div className="palette" aria-label="Chair actions">
      <h2 className="panel-heading">Chair</h2>

      <div className="verb-row">
        {verbs.map((verb) => (
          <button
            key={verb}
            type="button"
            className="verb-btn"
            data-verb={verb}
            title={mode.showWhy ? report.verbs[verb].why : undefined}
            disabled={disabled}
            onClick={() => chooseVerb(verb)}
          >
            {VERB_LABELS[verb]}
          </button>
        ))}
        {verbs.length === 0 && (
          <p className="sub-note">There is nothing in order for the chair to do.</p>
        )}
      </div>

      {step.kind !== 'IDLE' && (
        <div className="sub-row" role="group" aria-label="Choose a target">
          <button type="button" className="sub-back" onClick={cancel}>
            ← Back
          </button>
          <SubPicker
            step={step}
            state={state}
            report={report}
            disabled={disabled}
            requestById={requestById}
            setStep={setStep}
            emit={emit}
          />
        </div>
      )}

      <div className="hint-row">
        <button
          type="button"
          className="hint-btn"
          disabled={disabled}
          onClick={() => setHint(suggestAction(state, scenario))}
        >
          Hint
        </button>
      </div>

      {hint && (
        <div className="hint-panel" role="note">
          <p className="hint-lead">The clerk leans over:</p>
          <p className="hint-why">{hint.why}</p>
          <div className="hint-actions">
            <button
              type="button"
              className="hint-do"
              disabled={disabled}
              onClick={() => {
                setHint(null)
                emit(hint.action)
              }}
            >
              Do it
            </button>
            <button type="button" className="hint-dismiss" onClick={() => setHint(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type SubPickerProps = {
  step: Step
  state: MeetingState
  report: LegalityReport
  disabled: boolean
  requestById: (id: RequestId) => Request | undefined
  setStep: (step: Step) => void
  emit: (action: Action) => void
}

function SubPicker({ step, state, report, disabled, requestById, setStep, emit }: SubPickerProps) {
  switch (step.kind) {
    case 'IDLE':
      return null

    case 'RECOGNIZE': {
      const targets = report.targets.recognize
      if (targets.length === 0) return <p className="sub-note">There is nobody present to recognize.</p>
      return (
        <>
          <span className="sub-label">Recognize whom?</span>
          {targets.map((id) => (
            <button
              key={id}
              type="button"
              className="sub-btn"
              data-member-id={id}
              disabled={disabled}
              onClick={() => emit({ verb: 'RECOGNIZE', target: id })}
            >
              {memberName(state, id)}
            </button>
          ))}
        </>
      )
    }

    case 'RULE_TARGET': {
      const targets = report.targets.rule
      if (targets.length === 0) return <p className="sub-note">There is no point of order before the chair.</p>
      return (
        <>
          <span className="sub-label">Rule on which point?</span>
          {targets.map((id) => (
            <button
              key={id}
              type="button"
              className="sub-btn"
              data-request-id={id}
              disabled={disabled}
              onClick={() => setStep({ kind: 'RULE_RULING', target: id })}
            >
              {memberName(state, requestById(id)?.member ?? '')}: {requestById(id)?.claim ?? 'a point of order'}
            </button>
          ))}
        </>
      )
    }

    case 'RULE_RULING':
      return (
        <>
          <span className="sub-label">The chair rules the point…</span>
          <button
            type="button"
            className="sub-btn"
            disabled={disabled}
            onClick={() => emit({ verb: 'RULE', target: step.target, ruling: 'WELL_TAKEN' })}
          >
            Well taken
          </button>
          <button
            type="button"
            className="sub-btn"
            disabled={disabled}
            onClick={() => emit({ verb: 'RULE', target: step.target, ruling: 'NOT_WELL_TAKEN' })}
          >
            Not well taken
          </button>
        </>
      )

    case 'ANSWER_TARGET': {
      const targets = report.targets.answer
      if (targets.length === 0) return <p className="sub-note">There is no inquiry before the chair.</p>
      return (
        <>
          <span className="sub-label">Answer which inquiry?</span>
          {targets.map((id) => (
            <button
              key={id}
              type="button"
              className="sub-btn"
              data-request-id={id}
              disabled={disabled}
              onClick={() => setStep({ kind: 'ANSWER_CHOICE', target: id })}
            >
              {memberName(state, requestById(id)?.member ?? '')}: {requestById(id)?.question ?? 'a question'}
            </button>
          ))}
        </>
      )
    }

    case 'ANSWER_CHOICE': {
      const answers = requestById(step.target)?.answers ?? []
      if (answers.length === 0) return <p className="sub-note">The chair has nothing to answer with.</p>
      return (
        <>
          <span className="sub-label">The chair answers…</span>
          {answers.map((answer) => (
            <button
              key={answer.id}
              type="button"
              className="sub-btn"
              data-answer-id={answer.id}
              disabled={disabled}
              onClick={() => emit({ verb: 'ANSWER_INQUIRY', target: step.target, answer: answer.id })}
            >
              {answer.text}
            </button>
          ))}
        </>
      )
    }

    case 'VOTE_METHOD':
      return (
        <>
          <span className="sub-label">How is the vote taken?</span>
          <button
            type="button"
            className="sub-btn"
            disabled={disabled}
            onClick={() => emit({ verb: 'CALL_VOTE', method: 'VOICE' })}
          >
            Voice vote
          </button>
          <button
            type="button"
            className="sub-btn"
            disabled={disabled}
            onClick={() => emit({ verb: 'CALL_VOTE', method: 'ROLL_CALL' })}
          >
            Roll call
          </button>
        </>
      )

    case 'RECESS':
      return (
        <>
          <span className="sub-label">Recess for how long?</span>
          {RECESS_MINUTES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="sub-btn"
              disabled={disabled}
              onClick={() => emit({ verb: 'RECESS', minutes })}
            >
              {minutes} minutes
            </button>
          ))}
        </>
      )
  }
}
