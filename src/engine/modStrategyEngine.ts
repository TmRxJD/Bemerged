import type { AutoplayGoal, ModuleType } from './types'

export type ModuleStrategyPhase = 'board' | 'pre-boss' | 'boss'

export type InventorySwapStrategyInput = {
  goal: AutoplayGoal
  phase: ModuleStrategyPhase
  upgradeValue: number
  rarityDelta: number
  effectDelta: number
  tokenEffectBonus: number
  slotEffectBonus: number
  threatened: boolean
  anticipatedThreat: boolean
  repeatedTouch: number
  reversePingPong: boolean
}

export type ShardBoostCandidate = {
  type: ModuleType
  availableShards: number
  nextCost: number
  level: number
  objectiveNeed: number
  fodderNeed: number
}

export function scoreInventorySwapForModuleStrategy(input: InventorySwapStrategyInput): number {
  const phaseMultiplier = input.phase === 'boss'
    ? 1.3
    : input.phase === 'pre-boss'
      ? 1.15
      : 1

  const strategyGain =
    (input.upgradeValue * 130)
    + (input.rarityDelta * 180)
    + (input.effectDelta * 210)
    + (input.tokenEffectBonus * 22)
    - (input.slotEffectBonus * 14)

  const dangerBonus = (input.threatened ? 600 : 0) + (input.anticipatedThreat ? 380 : 0)
  const behaviorPenalty = (input.repeatedTouch * 340) + (input.reversePingPong ? 900 : 0)

  return (strategyGain * phaseMultiplier) + dangerBonus - behaviorPenalty
}

export function recommendShardBoostType(input: {
  goal: AutoplayGoal
  candidates: ShardBoostCandidate[]
  pfScale: number
  totalShards: number
  movesUntilBossSpawn: number
}): ModuleType | null {
  const affordable = input.candidates.filter(candidate => candidate.availableShards >= candidate.nextCost)
  if (affordable.length === 0) return null

  let bestType: ModuleType | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const candidate of affordable) {
    const objectivePressure = candidate.objectiveNeed * 420
    const fodderPressure = candidate.fodderNeed * 260
    const opportunityWindow = input.movesUntilBossSpawn <= 2 ? 80 : 0
    const levelPenalty = candidate.level * 24
    const costPressure = candidate.nextCost / 190
    const hoardPressure = (input.pfScale * Math.max(0, input.totalShards - candidate.nextCost)) / 95

    const goalBias = input.goal === 'max-shards'
      ? 1.12
      : input.goal === 'objective-progress'
        ? 1.2
        : 1

    const score = ((objectivePressure + fodderPressure + opportunityWindow) * goalBias) - levelPenalty - costPressure - hoardPressure
    if (score > bestScore) {
      bestScore = score
      bestType = candidate.type
    }
  }

  return bestScore >= 120 ? bestType : null
}
