// Mode configuration.
//
// A mode is *data*, not a branch: the palette reads `filterToInOrder` and
// `showWhy` off the config it is handed and never asks "am I in learn mode?".
// Adding Simulate later (spec §4.3) is a new entry here, not a new `if`.
//
// Practice is the default. Spec §4.3 is explicit that Practice must not hide
// or mark illegal actions — greying out the wrong answers is an answer key.

export type ModeId = 'learn' | 'practice'

export type ModeConfig = {
  id: ModeId
  label: string
  blurb: string
  /** Show only verbs whose legality status is IN_ORDER right now. */
  filterToInOrder: boolean
  /** Attach the legality report's `why` text to each verb as a tooltip. */
  showWhy: boolean
}

export const modes: Record<ModeId, ModeConfig> = {
  practice: {
    id: 'practice',
    label: 'Practice',
    blurb: 'Every action stays clickable. The room tells you what it thought.',
    filterToInOrder: false,
    showWhy: false,
  },
  learn: {
    id: 'learn',
    label: 'Learn',
    blurb: 'Only the moves that are in order, each one explained on hover.',
    filterToInOrder: true,
    showWhy: true,
  },
}

/** Display order for the mode picker; Practice first because it is the default. */
export const MODE_ORDER: ModeId[] = ['practice', 'learn']

export const DEFAULT_MODE: ModeId = 'practice'
