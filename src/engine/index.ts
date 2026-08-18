// Engine public API (D1).
//
// Core functions for meeting simulation: initialization, turn reduction,
// legality checking, checkpoint management, and report generation.

// Core functions
export { initMeeting, reduce, latestEvents } from './reducer'
export { legalActions } from './legality'
export { restoreCheckpoint } from './checkpoints'
export { buildReportCard } from './report'
export { suggestAction } from './advisor'
export { describeSituation } from './situation'
export type { DiagnosticEntry } from './checkpoints'
export type { Suggestion } from './advisor'

// Types for consumers
export type {
  Action,
  MeetingEvent,
  MeetingState,
  MemberId,
  RequestId,
  AnswerId,
  Phase,
  Motion,
  Request,
  MeterDelta,
  Checkpoint,
  VoteTally,
  LegalityStatus,
  LegalityReport,
  RoomSim,
  Member,
  Archetype,
  ScenarioMotion,
  AgendaItem,
} from './types'
export type { ReportCard } from './report'

// Re-export Scenario type (consumers need to know the shape)
export type { Scenario } from '../content/schema'
