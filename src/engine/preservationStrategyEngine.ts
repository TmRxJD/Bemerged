import type { AutoplayGoal } from './types'

export type PreservationMoveContext = {
  goal: AutoplayGoal
  hazardExposurePenalty: number
  hazardMitigationBonus: number
  commonOnlyMatchPenalty: number
  oscillationPenalty: number
  strategicRowingBonus: number
  mergeReadinessDelta: number
}

export function scorePreservationMove(input: PreservationMoveContext): number {
  const survivalBias = input.goal === 'objective-progress'
    ? 1.15
    : input.goal === 'max-shards'
      ? 0.9
      : 1

  return (
    (input.hazardMitigationBonus * 560 * survivalBias)
    + (input.strategicRowingBonus * 0.55)
    + (input.mergeReadinessDelta * 180)
    - (input.hazardExposurePenalty * 1150 * survivalBias)
    - (input.commonOnlyMatchPenalty * 0.65)
    - (input.oscillationPenalty * 0.75)
  )
}
