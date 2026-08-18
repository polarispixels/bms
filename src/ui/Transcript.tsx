// The transcript: the meeting as the clerk would have taken it down.
//
// Lines arrive already rendered (App renders each event exactly once, at
// dispatch time, threading the presentation RNG) so scrolling and re-renders
// can never re-roll a line variant. This component only decides how a line
// *looks*: speech gets the speaker's name in bold, narration and state changes
// are set in italics like a stage direction.

import { useEffect, useRef } from 'react'
import type { MeetingEvent } from '../engine/index'

export type Line = {
  /**
   * UI-side monotonic sequence number. This — not `id` — is the React key:
   * `restoreCheckpoint` rewinds the engine's `eventSeq`, so a restored meeting
   * legitimately reissues event ids the transcript has already shown, and
   * keying on `id` would collide.
   */
  seq: number
  /**
   * Event id, or a synthetic `restore-*` id for UI-authored interjections.
   * Purely a render-once cache token; never a React key.
   */
  id: string
  text: string
  type: MeetingEvent['type']
  intent: string
  /** Display name of the member speaking, when the actor is a member. */
  speaker: string | null
}

const STAGE_TYPES: MeetingEvent['type'][] = ['NARRATION', 'STATE_CHANGE']

/** Bolds the speaker's name where it appears in the rendered prose. */
function withSpeaker(text: string, speaker: string | null) {
  if (!speaker) return text
  const at = text.indexOf(speaker)
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <b className="speaker">{speaker}</b>
      {text.slice(at + speaker.length)}
    </>
  )
}

export type TranscriptProps = {
  lines: Line[]
  title: string
  body: string
}

export function Transcript({ lines, title, body }: TranscriptProps) {
  const scroller = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  return (
    <div className="transcript" ref={scroller} aria-label="Transcript" aria-live="polite">
      <div className="transcript-head">
        <h1 className="transcript-title">{title}</h1>
        <p className="transcript-body">{body}</p>
      </div>
      <ol className="lines">
        {lines.map((line) => (
          <li
            key={line.seq}
            className={STAGE_TYPES.includes(line.type) ? 'line line-stage' : 'line'}
            data-intent={line.intent}
          >
            {withSpeaker(line.text, line.speaker)}
          </li>
        ))}
      </ol>
    </div>
  )
}
