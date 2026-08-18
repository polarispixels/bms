import type { MeetingState, MeterDelta } from './types'

/**
 * Meter delta definitions.
 * Each reason key maps to { meter, delta, label }.
 * D5 + D6: exactly as specified in design-decisions.md.
 */
export const DELTAS: Record<string, { meter: 'control' | 'trust'; delta: number; label: string }> = {
  OUT_OF_ORDER_ACTION: {
    meter: 'control',
    delta: -6,
    label: 'Chair took an out-of-order action',
  },
  UNADDRESSED_INTERRUPT: {
    meter: 'control',
    delta: -8,
    label: 'An interrupt request sat unaddressed for a turn',
  },
  HESITATION: {
    meter: 'control',
    delta: -3,
    label: 'Chair called WAIT while there were pending requests',
  },
  STABILIZER_RESCUE: {
    meter: 'control',
    delta: -4,
    label: 'Stabilizer had to fix the chair\'s procedural mistake',
  },
  GAVEL_RESTORES_ORDER: {
    meter: 'control',
    delta: 8,
    label: 'Chair gaveled to restore order with pending interrupts',
  },
  GAVEL_QUIET_ROOM: {
    meter: 'trust',
    delta: -4,
    label: 'Chair gaveled when there was no disorder',
  },
  CLEAN_PROCEDURE_BONUS: {
    meter: 'control',
    delta: 3,
    label: 'Motion stated correctly and result announced promptly',
  },
  CUT_OFF_DEBATE: {
    meter: 'trust',
    delta: -6,
    label: 'Chair called vote while recognition requests were pending',
  },
  INVALID_RULING: {
    meter: 'trust',
    delta: -10,
    label: 'Chair ruled NOT_WELL_TAKEN on a valid point',
  },
  TECHNICALITY_RULING: {
    meter: 'trust',
    delta: -5,
    label: 'Chair ruled WELL_TAKEN on an invalid point',
  },
  CORRECT_RULING: {
    meter: 'control',
    delta: 4,
    label: 'Chair\'s ruling matched the validity of the point',
  },
  FAIR_RULING: {
    meter: 'trust',
    delta: 3,
    label: 'A fair ruling, fairly delivered',
  },
  SELECTIVE_RECOGNITION: {
    meter: 'trust',
    delta: -5,
    label: 'Chair recognized a member while another waited longer',
  },
  WRONG_INQUIRY_ANSWER: {
    meter: 'control',
    delta: -4,
    label: 'Chair answered inquiry incorrectly',
  },
  IGNORED_REQUEST_TIMEOUT: {
    meter: 'trust',
    delta: -4,
    label: 'Request went unaddressed for 3 turns',
  },
  RECESS_BREATHER: {
    meter: 'control',
    delta: 5,
    label: 'Chair called recess to calm a tense room',
  },
  RECESS_STALL: {
    meter: 'trust',
    delta: -3,
    label: 'Chair called recess as a delaying tactic',
  },
  PREMATURE_ADJOURN: {
    meter: 'trust',
    delta: -8,
    label: 'Chair adjourned with business still pending',
  },
  CUT_OFF_RAMBLER: {
    meter: 'trust',
    delta: -4,
    label: 'Chair gaveled during a drifting member\'s speech',
  },
}

/**
 * Applies a meter delta to the state.
 * Clamps meters to [0, 100] and appends a MeterDelta entry to meterLog.
 * Immutable: returns new state.
 */
export function applyDelta(
  state: MeetingState,
  reason: keyof typeof DELTAS,
): MeetingState {
  const deltaDef = DELTAS[reason]
  if (!deltaDef) {
    throw new Error(`Unknown delta reason: ${reason}`)
  }

  const meter = deltaDef.meter
  const delta = deltaDef.delta
  const label = deltaDef.label

  // Calculate new meter value and clamp
  const oldValue = state.meters[meter]
  const newValue = Math.max(0, Math.min(100, oldValue + delta))

  // Create new state with updated meters
  const newState: MeetingState = {
    ...state,
    meters: {
      ...state.meters,
      [meter]: newValue,
    },
    meterLog: [
      ...state.meterLog,
      {
        turn: state.turn,
        meter,
        delta,
        reason,
        label,
      } as MeterDelta,
    ],
  }

  return newState
}
