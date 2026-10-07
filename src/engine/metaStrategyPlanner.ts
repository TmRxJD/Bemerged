import type { AutoplayGoal } from './types'

export type MetaPlannerInput = {
  goal: AutoplayGoal
  baseGoalScore: number
  strategyScore: number
  survivalScore: number
  scoreTempo: number
}

export function composeMetaPlannerScore(input: MetaPlannerInput): number {
  const weights = getWeights(input.goal)
  return input.baseGoalScore
    + (input.strategyScore * weights.strategy)
    + (input.survivalScore * weights.survival)
    + (input.scoreTempo * weights.score)
}

function getWeights(goal: AutoplayGoal): { strategy: number; survival: number; score: number } {
  switch (goal) {
    case 'objective-progress':
      return { strategy: 0.95, survival: 1.1, score: 0.85 }
    case 'boss-damage':
      return { strategy: 1.15, survival: 1.2, score: 0.7 }
    case 'max-shards':
      return { strategy: 0.75, survival: 0.85, score: 1.15 }
    case 'max-merges':
      return { strategy: 0.9, survival: 0.8, score: 1 }
    case 'farm-cannon':
    case 'farm-armor':
    case 'farm-generator':
    case 'farm-core':
      return { strategy: 0.85, survival: 0.8, score: 1.05 }
    case 'balanced':
    default:
      return { strategy: 0.9, survival: 0.95, score: 0.95 }
  }
}
