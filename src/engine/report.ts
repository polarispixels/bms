// Report card generator (D9).
//
// Scores five categories (procedure, fairness, efficiency, clarity, completion)
// based on game state and meter log, generates letter grades and an overall grade.
// Includes pedantry (selected significant events) and notes for each category.

import type { Scenario } from '../content/schema'
import type { MeetingState, MeterDelta } from './types'

export type ReportCard = {
  grades: Record<
    'procedure' | 'fairness' | 'efficiency' | 'clarity' | 'completion',
    { grade: 'A' | 'B' | 'C' | 'D' | 'F'; score: number; notes: string[] }
  >
  overall: 'A' | 'B' | 'C' | 'D' | 'F'
  meterFinal: { control: number; trust: number }
  pedantry: string[]
}

// ---------------------------------------------------------------------------
// Grade conversion (0-100 -> letter)
// ---------------------------------------------------------------------------

function toGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

// ---------------------------------------------------------------------------
// Scoring functions (D9 formulas)
// ---------------------------------------------------------------------------

function scoreProcedure(state: MeetingState): number {
  const invalidRulings = state.meterLog.filter((d) => d.reason === 'INVALID_RULING').length
  return Math.max(0, 100 - 12 * state.outOfOrderCount - 8 * invalidRulings)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function scoreFairness(state: MeetingState): number {
  const selectiveRecognitionCount = state.meterLog.filter((d) => d.reason === 'SELECTIVE_RECOGNITION')
    .length
  const trust = state.meters.trust
  return clamp(100 - 2 * (70 - trust) - 5 * selectiveRecognitionCount, 0, 100)
}

function scoreEfficiency(state: MeetingState, scenario: Scenario): number {
  const turns = state.turn - 1 // state.turn is 1-based
  const overPar = Math.max(0, turns - scenario.parTurns)
  return Math.max(0, 100 - 4 * overPar)
}

/** Counts both unstated motions and announce delays from the log. */
function countClarityPenalties(state: MeetingState): { unstatedMotions: number; announceDelays: number } {
  let unstatedMotions = 0
  let announceDelays = 0
  const votesTaken = new Map<string, number>() // motionId -> turn of VOTE_TAKEN

  for (const event of state.log) {
    if (event.intent === 'VOTE_TAKEN') {
      const motionId = event.payload.motionId as string
      const statedByChair = event.payload.statedByChair as boolean
      const turn = event.payload.turn as number

      if (!statedByChair) {
        unstatedMotions++
      }
      votesTaken.set(motionId, turn)
    } else if (event.intent === 'ANNOUNCE_RESULT') {
      const motionId = event.payload.motionId as string
      const voteTakenTurn = votesTaken.get(motionId)
      if (voteTakenTurn !== undefined) {
        const voteTakenTurnFromPayload = event.payload.voteTakenTurn as number
        const announceTurn = event.payload.turn as number
        // Use payload value if available (more reliable), else fallback to tracked turn
        const delay = announceTurn - (voteTakenTurnFromPayload || voteTakenTurn)
        if (delay > 1) {
          announceDelays++
        }
      }
    }
  }

  return { unstatedMotions, announceDelays }
}

function scoreClarity(state: MeetingState): number {
  const { unstatedMotions, announceDelays } = countClarityPenalties(state)
  return Math.max(0, 100 - 10 * unstatedMotions - 5 * announceDelays)
}

function scoreCompletion(state: MeetingState, scenario: Scenario): number {
  if (scenario.agenda.length === 0) return 100
  return Math.round((state.itemsCompleted / scenario.agenda.length) * 100)
}

// ---------------------------------------------------------------------------
// Notes generation (original prose for each category)
// ---------------------------------------------------------------------------

function notesForProcedure(state: MeetingState, score: number): string[] {
  const notes: string[] = []

  if (state.outOfOrderCount === 0) {
    notes.push('All chair actions were in proper order.')
  } else {
    notes.push(
      `The chair took ${state.outOfOrderCount} action${state.outOfOrderCount === 1 ? '' : 's'} out of order.`,
    )
  }

  const invalidRulings = state.meterLog.filter((d) => d.reason === 'INVALID_RULING').length
  if (invalidRulings > 0) {
    notes.push(`${invalidRulings} ruling${invalidRulings === 1 ? '' : 's'} were not well-taken.`)
  } else if (score >= 90) {
    notes.push('Procedurally, the chair ran a tight ship.')
  } else if (score >= 70) {
    notes.push('Procedure was generally sound with minor lapses.')
  }

  return notes
}

function notesForFairness(state: MeetingState, score: number): string[] {
  const notes: string[] = []

  const selectiveRecognitions = state.meterLog.filter((d) => d.reason === 'SELECTIVE_RECOGNITION')
  if (selectiveRecognitions.length === 0) {
    notes.push('The chair recognized members fairly and in order.')
  } else {
    notes.push(`The chair showed selective recognition ${selectiveRecognitions.length} time${selectiveRecognitions.length === 1 ? '' : 's'}.`)
  }

  if (score >= 90) {
    notes.push('Members felt respected and heard.')
  } else if (score >= 70) {
    notes.push('Recognition practices were generally fair.')
  } else {
    notes.push('Recognition patterns showed bias or favoritism.')
  }

  return notes
}

function notesForEfficiency(state: MeetingState, scenario: Scenario, score: number): string[] {
  const notes: string[] = []
  const turns = state.turn - 1
  const parTurns = scenario.parTurns

  if (turns <= parTurns) {
    notes.push(
      `The meeting concluded in ${turns} turn${turns === 1 ? '' : 's'}, meeting the par of ${parTurns}.`,
    )
  } else {
    notes.push(
      `The meeting took ${turns} turn${turns === 1 ? '' : 's'}, ${turns - parTurns} over the par of ${parTurns}.`,
    )
  }

  if (score >= 90) {
    notes.push('The pace was brisk and the chair kept things moving.')
  } else if (score >= 70) {
    notes.push('The meeting proceeded at a reasonable pace.')
  } else {
    notes.push('Delays and hesitations made the meeting drag.')
  }

  return notes
}

function notesForClarity(state: MeetingState, score: number): string[] {
  const notes: string[] = []

  const { unstatedMotions, announceDelays } = countClarityPenalties(state)

  if (unstatedMotions === 0 && announceDelays === 0) {
    notes.push('All motions were properly stated and vote results announced promptly.')
  } else {
    if (unstatedMotions > 0) {
      notes.push(
        `${unstatedMotions} motion${unstatedMotions === 1 ? '' : 's'} ${unstatedMotions === 1 ? 'was' : 'were'} handled without being stated.`,
      )
    }
    if (announceDelays > 0) {
      notes.push(
        `${announceDelays} vote result${announceDelays === 1 ? '' : 's'} ${announceDelays === 1 ? 'was' : 'were'} announced with delay.`,
      )
    }
  }

  if (score >= 90) {
    notes.push('The record is clear and unambiguous.')
  } else if (score >= 70) {
    notes.push('The record is mostly clear.')
  } else {
    notes.push('Confusion arose from unclear procedures.')
  }

  return notes
}

function notesForCompletion(state: MeetingState, scenario: Scenario, score: number): string[] {
  const notes: string[] = []

  if (state.itemsCompleted === scenario.agenda.length) {
    notes.push(
      `All ${scenario.agenda.length} agenda item${scenario.agenda.length === 1 ? '' : 's'} ${scenario.agenda.length === 1 ? 'was' : 'were'} completed.`,
    )
  } else {
    const remaining = scenario.agenda.length - state.itemsCompleted
    notes.push(
      `${remaining} agenda item${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'was' : 'were'} left unfinished.`,
    )
  }

  if (score >= 90) {
    notes.push('The board tackled all the business on the table.')
  } else if (score >= 70) {
    notes.push('Most of the agenda was addressed.')
  } else {
    notes.push('Significant business was deferred.')
  }

  return notes
}

// ---------------------------------------------------------------------------
// Pedantry: selected significant meter events (3-6 entries)
// ---------------------------------------------------------------------------

const PEDANTRY_MAP: Record<string, string> = {
  OUT_OF_ORDER_ACTION: 'The chair attempted an action out of proper order.',
  UNADDRESSED_INTERRUPT: 'A member was interrupting but not acknowledged.',
  HESITATION: 'The chair called time while requests were pending.',
  STABILIZER_RESCUE: 'A member had to prompt the chair to follow procedure.',
  GAVEL_RESTORES_ORDER: 'The gavel effectively restored control of the room.',
  GAVEL_QUIET_ROOM: 'The chair gaveled an already quiet room.',
  CLEAN_PROCEDURE_BONUS: 'A motion was stated and voted on cleanly.',
  CUT_OFF_DEBATE: 'The chair moved to vote while members still sought the floor.',
  INVALID_RULING: 'The chair ruled against a valid procedural point.',
  TECHNICALITY_RULING: 'The chair upheld a flawed procedural objection.',
  CORRECT_RULING: 'The chair made a sound procedural ruling.',
  SELECTIVE_RECOGNITION: 'The chair recognized a member out of queue.',
  WRONG_INQUIRY_ANSWER: 'The chair gave an incorrect answer to a point of inquiry.',
  IGNORED_REQUEST_TIMEOUT: 'A member waited too long for the chair to respond.',
  RECESS_BREATHER: 'A recess gave the chair breathing room to calm down.',
  RECESS_STALL: 'The chair took a recess to avoid difficult business.',
  PREMATURE_ADJOURN: 'The chair ended the meeting before finishing the agenda.',
  CUT_OFF_RAMBLER: 'The chair gaveled a long-winded member.',
}

function generatePedantry(state: MeetingState): string[] {
  const selectedReasons = new Map<string, MeterDelta>()

  // Pick the most significant (largest magnitude) deltas, favoring negative ones
  const sorted = [...state.meterLog].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  for (const delta of sorted) {
    if (selectedReasons.size >= 6) break
    if (!selectedReasons.has(delta.reason)) {
      selectedReasons.set(delta.reason, delta)
    }
  }

  // If we have fewer than 3 entries, fill with praise or generic positives
  if (selectedReasons.size < 3) {
    const missing = 3 - selectedReasons.size
    const praise = [
      'The chair demonstrated command of parliamentary procedure.',
      'Members worked collaboratively to move business forward.',
      'The room maintained a professional tone throughout.',
    ]
    // Add praise entries
    for (let i = 0; i < missing && i < praise.length; i++) {
      selectedReasons.set(`_praise_${i}`, { turn: 0, meter: 'control', delta: 0, reason: `_praise_${i}`, label: praise[i] })
    }
  }

  // Convert to prose
  const lines: string[] = []
  for (const [reason, delta] of selectedReasons) {
    if (reason.startsWith('_praise_')) {
      lines.push(delta.label)
    } else {
      lines.push(PEDANTRY_MAP[reason] || delta.label || `Meter event: ${reason}`)
    }
  }

  return lines.slice(0, 6)
}

// ---------------------------------------------------------------------------
// Main report card builder (D1)
// ---------------------------------------------------------------------------

export function buildReportCard(state: MeetingState, scenario: Scenario): ReportCard {
  const procedureScore = scoreProcedure(state)
  const fairnessScore = scoreFairness(state)
  const efficiencyScore = scoreEfficiency(state, scenario)
  const clarityScore = scoreClarity(state)
  const completionScore = scoreCompletion(state, scenario)

  const scores = [procedureScore, fairnessScore, efficiencyScore, clarityScore, completionScore]
  const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length

  const grades = {
    procedure: {
      grade: toGrade(procedureScore),
      score: procedureScore,
      notes: notesForProcedure(state, procedureScore),
    },
    fairness: {
      grade: toGrade(fairnessScore),
      score: fairnessScore,
      notes: notesForFairness(state, fairnessScore),
    },
    efficiency: {
      grade: toGrade(efficiencyScore),
      score: efficiencyScore,
      notes: notesForEfficiency(state, scenario, efficiencyScore),
    },
    clarity: {
      grade: toGrade(clarityScore),
      score: clarityScore,
      notes: notesForClarity(state, clarityScore),
    },
    completion: {
      grade: toGrade(completionScore),
      score: completionScore,
      notes: notesForCompletion(state, scenario, completionScore),
    },
  }

  return {
    grades,
    overall: toGrade(overallScore),
    meterFinal: { control: state.meters.control, trust: state.meters.trust },
    pedantry: generatePedantry(state),
  }
}
