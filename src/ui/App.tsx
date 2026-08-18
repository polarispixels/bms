// Order! — the whole app.
//
// One `useReducer` wraps the engine. The reducer is pure (every engine call it
// makes is pure, including `renderEvent`), which matters for two reasons:
// StrictMode double-invokes reducers in development, and rendering an event
// twice must never produce two different lines.
//
// Two RNGs, deliberately separate — the same split the CLI uses:
//   - the *engine* RNG lives on `state.rngState` and only `reduce` touches it;
//   - the *presentation* RNG lives on `session.presentRng` and only
//     `renderEvent` touches it.
// Each event is rendered exactly once, at dispatch time, and cached by event id
// (`renderedIds`), so a re-render, a scroll, or a checkpoint restore can never
// re-roll a line variant.
//
// New lines are queued rather than shown, and drain one every 150ms so the room
// speaks in sequence instead of dumping a turn's worth of prose at once. The
// palette is disabled while the queue drains.

import { useEffect, useReducer } from 'react'
import {
  buildReportCard,
  initMeeting,
  legalActions,
  reduce,
  restoreCheckpoint,
} from '../engine/index'
import type { Action, MeetingEvent, MeetingState, Scenario } from '../engine/index'
import { renderEvent } from '../engine/render'
import { scenarios } from '../content/index'
import { modes } from '../modes/modes'
import type { ModeId } from '../modes/modes'
import { CollapseModal } from './CollapseModal'
import { Meters } from './Meters'
import { Palette } from './Palette'
import { ReportCard } from './ReportCard'
import { Setup } from './Setup'
import type { SetupChoice } from './Setup'
import { StatePanel } from './StatePanel'
import { Transcript } from './Transcript'
import type { Line } from './Transcript'
import './app.css'

/** Milliseconds between transcript lines while a turn's events play out. */
const STAGGER_MS = 150

/** Intents the engine emits when the meeting comes apart (reducer collapse). */
const COLLAPSE_INTENTS = ['ROOM_TALKS_OVER_CHAIR', 'MOTION_DIES', 'GAVEL_IGNORED']

type Session = {
  scenario: Scenario
  seed: number
  modeId: ModeId
  state: MeetingState
  /** Presentation RNG — never the engine's. */
  presentRng: number
  /** Every event id already turned into a line; keeps restores from replaying. */
  renderedIds: Set<string>
  /** Lines the player can see. */
  lines: Line[]
  /** Lines waiting their turn to appear. */
  queue: Line[]
}

type Msg =
  | { type: 'START'; choice: SetupChoice }
  | { type: 'ACT'; action: Action }
  | { type: 'REVEAL' }
  | { type: 'RESTORE' }
  | { type: 'RESTART' }
  | { type: 'TO_SETUP' }

function speakerName(state: MeetingState, actor: MeetingEvent['actor']): string | null {
  return state.members.find((m) => m.id === actor)?.name ?? null
}

/**
 * Renders every event in `next.log` that has not been rendered yet, appending
 * the new lines to the queue and advancing the presentation RNG. Pure.
 */
function ingest(session: Session, next: MeetingState): Session {
  let presentRng = session.presentRng
  const renderedIds = new Set(session.renderedIds)
  const fresh: Line[] = []

  for (const event of next.log) {
    if (renderedIds.has(event.id)) continue
    const rendered = renderEvent(event, session.scenario, presentRng)
    presentRng = rendered.rngState
    renderedIds.add(event.id)
    fresh.push({
      id: event.id,
      text: rendered.line,
      type: event.type,
      intent: event.intent,
      speaker: speakerName(next, event.actor),
    })
  }

  return {
    ...session,
    state: next,
    presentRng,
    renderedIds,
    queue: [...session.queue, ...fresh],
  }
}

function startSession(choice: SetupChoice): Session {
  const scenario = scenarios.find((s) => s.id === choice.scenarioId) ?? scenarios[0]
  const state = initMeeting(scenario, choice.seed)
  return ingest(
    {
      scenario,
      seed: choice.seed,
      modeId: choice.modeId,
      state,
      presentRng: choice.seed,
      renderedIds: new Set<string>(),
      lines: [],
      queue: [],
    },
    state,
  )
}

function sessionReducer(session: Session | null, msg: Msg): Session | null {
  switch (msg.type) {
    case 'START':
      return startSession(msg.choice)

    case 'TO_SETUP':
      return null

    case 'RESTART':
      return session
        ? startSession({ scenarioId: session.scenario.id, modeId: session.modeId, seed: session.seed })
        : null

    case 'ACT':
      if (!session) return session
      return ingest(session, reduce(session.state, msg.action, session.scenario))

    case 'RESTORE': {
      if (!session) return session
      const { state } = restoreCheckpoint(session.state)
      const checkpoint = session.state.checkpoints[session.state.checkpoints.length - 1]
      // The restored log was narrated once already; `ingest` filters it out by
      // event id. All the transcript gains is a rule marking the rewind.
      const marker: Line = {
        id: `restore-${session.lines.length + session.queue.length}-${state.turn}`,
        text: `The chair takes it up again: ${checkpoint?.label ?? 'the last clean moment'}.`,
        type: 'NARRATION',
        intent: 'RESTORE_CHECKPOINT',
        speaker: null,
      }
      const ingested = ingest(session, state)
      return { ...ingested, queue: [marker, ...ingested.queue] }
    }

    case 'REVEAL': {
      if (!session || session.queue.length === 0) return session
      const [head, ...rest] = session.queue
      return { ...session, lines: [...session.lines, head], queue: rest }
    }
  }
}

export function App() {
  const [session, dispatch] = useReducer(sessionReducer, null)

  // Drain the queue one line at a time so a turn plays out rather than lands.
  useEffect(() => {
    if (!session || session.queue.length === 0) return
    const timer = setTimeout(() => dispatch({ type: 'REVEAL' }), STAGGER_MS)
    return () => clearTimeout(timer)
  }, [session])

  if (!session) {
    return <Setup scenarios={scenarios} onStart={(choice) => dispatch({ type: 'START', choice })} />
  }

  const { state, scenario } = session
  const mode = modes[session.modeId]
  const report = legalActions(state, scenario)
  const settling = session.queue.length > 0
  const terminal = state.phase === 'ADJOURNED' || state.phase === 'COLLAPSED'
  // Overlays wait for the room to finish talking.
  const showOverlay = terminal && !settling

  return (
    <div className="app">
      <header className="app-head">
        <span className="app-name">Order!</span>
        <span className="app-scenario">{scenario.title}</span>
        <span className="app-mode">{mode.label} mode · seed {session.seed}</span>
        <button type="button" className="link-btn" onClick={() => dispatch({ type: 'TO_SETUP' })}>
          Leave the meeting
        </button>
      </header>

      <main className="stage">
        <section className="transcript-col">
          <Transcript lines={session.lines} title={scenario.title} body={scenario.body} />
        </section>

        <aside className="side-col">
          <Meters control={state.meters.control} trust={state.meters.trust} />
          <div className="side-scroll">
            <StatePanel state={state} scenario={scenario} />
          </div>
          <Palette
            state={state}
            report={report}
            mode={mode}
            disabled={settling || terminal}
            onAction={(action) => dispatch({ type: 'ACT', action })}
          />
        </aside>
      </main>

      {showOverlay && state.phase === 'COLLAPSED' && (
        <CollapseModal
          chaos={session.lines.filter((line) => COLLAPSE_INTENTS.includes(line.intent)).slice(-3)}
          diagnostic={restoreCheckpoint(state).diagnostic}
          checkpointLabel={state.checkpoints[state.checkpoints.length - 1]?.label ?? null}
          onRestore={() => dispatch({ type: 'RESTORE' })}
          onRestart={() => dispatch({ type: 'RESTART' })}
        />
      )}

      {showOverlay && state.phase === 'ADJOURNED' && (
        <ReportCard
          report={buildReportCard(state, scenario)}
          scenarioTitle={scenario.title}
          seed={session.seed}
          onRunItBack={() => dispatch({ type: 'RESTART' })}
          onChangeSetup={() => dispatch({ type: 'TO_SETUP' })}
        />
      )}
    </div>
  )
}

export default App
