import type { AutoplayGoal } from './types'

export type MineStrategyMoveContext = {
  goal: AutoplayGoal
  mineCount: number
  hasBoss: boolean
  hazardMitigationBonus: number
  hazardExposurePenalty: number
  mineDistancePenalty: number
  strategicRowingBonus: number
}

export function scoreMineStrategyMove(input: MineStrategyMoveContext): number {
  if (input.mineCount <= 0) {
    return 0
  }

  const goalRiskMultiplier = input.goal === 'objective-progress'
    ? 1.2
    : input.goal === 'boss-damage'
      ? 1.35
      : 1

  const mitigation = input.hazardMitigationBonus * 620
  const exposure = input.hazardExposurePenalty * 980 * goalRiskMultiplier
  const distancePenalty = input.mineDistancePenalty * (input.hasBoss ? 1.3 : 1)

  return mitigation + (input.strategicRowingBonus * 0.45) - exposure - distancePenalty
}
