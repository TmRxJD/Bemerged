import type { AutoplayGoal } from './types'
import type { BemergedParityTuningPatch } from './parityTuning'

export type BemergedScenario = {
  id: string
  title: string
  description: string
  seed: number
  maxTurns: number
  goal: AutoplayGoal
  parityPatch?: BemergedParityTuningPatch
}

export const BEMERGED_SCENARIOS: ReadonlyArray<BemergedScenario> = [
  {
    id: 'objective-default',
    title: 'Objective Baseline',
    description: 'Default parity, objective-progress goal: reach 24/24 unique 5★ Ancestral mods.',
    seed: 1337,
    maxTurns: 800,
    goal: 'objective-progress',
  },
  {
    id: 'speed-boss',
    title: 'Boss Speedrun Stress',
    description: 'Higher boss frequency to stress route planning and lower-time optimization.',
    seed: 20260220,
    maxTurns: 700,
    goal: 'boss-damage',
    parityPatch: {
      boss: {
        spawnEveryMoves: 60,
      },
    },
  },
  {
    id: 'shard-farm',
    title: 'Shard Yield Stress',
    description: 'Higher shard payout to test score outliers and exploit surfaces.',
    seed: 20260221,
    maxTurns: 900,
    goal: 'max-shards',
    parityPatch: {
      shardsPerClear: 7,
    },
  },
]

export function getBemergedScenarioById(id: string): BemergedScenario | null {
  const normalized = String(id || '').trim().toLowerCase()
  if (!normalized) return null
  return BEMERGED_SCENARIOS.find(scenario => scenario.id.toLowerCase() === normalized) || null
}
