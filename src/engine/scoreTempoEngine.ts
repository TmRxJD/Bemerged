import type { AutoplayGoal } from './types'

export type ScoreTempoMoveContext = {
  goal: AutoplayGoal
  shardsValue: number
  matchCount: number
  objectiveTypeWeight: number
  objectiveCompletionWeight: number
  rareClearBonus: number
  commonClearBonus: number
  fodderPipelineMatchBonus: number
}

export function scoreTempoMove(input: ScoreTempoMoveContext): number {
  const objectiveMultiplier = input.goal === 'objective-progress' ? 1.25 : 1
  const shardMultiplier = input.goal === 'max-shards' ? 1.3 : 1

  return (
    (input.shardsValue * 310 * shardMultiplier)
    + (input.matchCount * 190)
    + (input.objectiveTypeWeight * 760 * objectiveMultiplier)
    + (input.objectiveCompletionWeight * 1.6)
    + (input.rareClearBonus * 0.9)
    + (input.commonClearBonus * 0.35)
    + (input.fodderPipelineMatchBonus * 0.95)
  )
}
