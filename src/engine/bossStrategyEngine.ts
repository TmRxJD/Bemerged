import type { AutoplayGoal } from './types'

export type BossStrategyMoveContext = {
  goal: AutoplayGoal
  hasBoss: boolean
  movesUntilBossSpawn: number
  bossDamage: number
  matchCount: number
  rareClearCount: number
  rarePlusClearCount: number
  objectiveProgressDelta: number
  spawnPrepDelta: number
}

export function scoreBossStrategyMove(input: BossStrategyMoveContext): number {
  const nearSpawn = input.movesUntilBossSpawn <= 2
  const bossFocusMultiplier = input.goal === 'boss-damage' ? 1.35 : 1

  if (input.hasBoss) {
    return (
      (input.bossDamage * 1100 * bossFocusMultiplier)
      + (input.matchCount * 45)
      + (input.rareClearCount * 70)
      + (input.rarePlusClearCount * 120)
      + (input.objectiveProgressDelta * 90)
    )
  }

  if (!nearSpawn) {
    return 0
  }

  const spawnPrepValue = Math.max(-2200, Math.min(2200, input.spawnPrepDelta * 14))
  const prepRareBonus = (input.rareClearCount * 28) + (input.rarePlusClearCount * 42)
  return spawnPrepValue + prepRareBonus
}
