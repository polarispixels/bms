// Content package entry point.
//
// Scenario JSON is imported statically (Vite and tsx both resolve JSON
// imports; `resolveJsonModule` is on in tsconfig.app.json) and validated at
// module load. Validation failures throw at import time on purpose: a
// malformed scenario is an authoring bug, and the loudest, earliest possible
// failure is the cheapest one. The game never ships content it cannot run.

import hoaFence01 from './scenarios/hoa-fence-01.json'
import { validateScenario } from './schema'
import type { Scenario } from './schema'

const RAW_SCENARIOS: unknown[] = [hoaFence01]

/** Every playable scenario, validated against D8. */
export const scenarios: Scenario[] = RAW_SCENARIOS.map((raw) => validateScenario(raw))

/** Looks a scenario up by id; returns undefined for an unknown id. */
export function scenarioById(id: string): Scenario | undefined {
  return scenarios.find((scenario) => scenario.id === id)
}

export { validateScenario } from './schema'
export type { Scenario, ScenarioMember, Beat, AgendaItem, ScenarioMotion } from './schema'
