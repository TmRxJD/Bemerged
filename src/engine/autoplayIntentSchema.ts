import { z } from 'zod'

export const autoplayPrimaryWeightSchema = z.object({
  completion24x5StarAnc: z.number().finite().nonnegative().default(5000),
  fewerMoves: z.number().finite().nonnegative().default(8),
  fewerMerges: z.number().finite().nonnegative().default(5),
  finalShards: z.number().finite().nonnegative().default(0.6),
  speedPenaltyAlpha: z.number().finite().nonnegative().default(0.02),
})

export const autoplaySecondaryWeightSchema = z.object({
  hazardProtection: z.number().finite().nonnegative().default(60),
  uniqueEquipOptimization: z.number().finite().nonnegative().default(45),
  fodderPipelineProgress: z.number().finite().nonnegative().default(40),
  bossFodderPreparation: z.number().finite().nonnegative().default(35),
})

export const autoplayMistakeCountersSchema = z.object({
  missedObviousMerge: z.number().int().nonnegative().default(0),
  sacrificedHighRarity: z.number().int().nonnegative().default(0),
  overShatterWhenMergeAvailable: z.number().int().nonnegative().default(0),
  ignoredBossThreat: z.number().int().nonnegative().default(0),
  ignoredMineThreat: z.number().int().nonnegative().default(0),
  badPfVsUpgradeChoice: z.number().int().nonnegative().default(0),
})

export const autoplayMoveHeuristicFeaturesSchema = z.object({
  immediateMergeGain: z.number().finite(),
  highRarityProtectionDelta: z.number().finite(),
  uniqueEffectUpgradeDelta: z.number().finite(),
  fodderPipelineDelta: z.number().finite(),
  bossDamagePreparationDelta: z.number().finite(),
  pfVsUpgradeDelta: z.number().finite(),
  bossThreatPenalty: z.number().finite(),
  mineThreatPenalty: z.number().finite(),
  expectedDecisionMs: z.number().finite().nonnegative(),
})

export const autoplayMoveHeuristicWeightsSchema = z.object({
  immediateMergeGain: z.number().finite().default(120),
  highRarityProtectionDelta: z.number().finite().default(95),
  uniqueEffectUpgradeDelta: z.number().finite().default(70),
  fodderPipelineDelta: z.number().finite().default(65),
  bossDamagePreparationDelta: z.number().finite().default(50),
  pfVsUpgradeDelta: z.number().finite().default(40),
  bossThreatPenalty: z.number().finite().default(130),
  mineThreatPenalty: z.number().finite().default(105),
  speedPenaltyAlpha: z.number().finite().nonnegative().default(0.05),
})

export const autoplayStrategyDeltaSchema = z.object({
  slowDecisionPatterns: z.array(z.string().min(1)).default([]),
  improvementsToTryNextRun: z.array(z.string().min(1)).default([]),
  searchPolicyAdjustments: z.array(z.string().min(1)).default([]),
  rewardWeightAdjustments: z.array(z.string().min(1)).default([]),
})

export const autoplayRunSummarySchema = z.object({
  runId: z.union([z.string().min(1), z.number().int().nonnegative()]),
  finalModules5StarAnc: z.number().int().nonnegative(),
  totalMoves: z.number().int().nonnegative(),
  totalMerges: z.number().int().nonnegative(),
  finalShards: z.number().int().nonnegative(),
  avgTimePerMoveMs: z.number().finite().nonnegative(),
  terminationReason: z.string().min(1).default('in-progress'),
  indecisionTimeoutEvents: z.number().int().nonnegative().default(0),
  forcedRestarts: z.number().int().nonnegative().default(0),
  protectedHighRarityEvents: z.number().int().nonnegative().default(0),
  uniqueEquipOptimizations: z.number().int().nonnegative().default(0),
  fodderPipelineCompletions: z.number().int().nonnegative().default(0),
  bossFodderPreparations: z.number().int().nonnegative().default(0),
  mistakes: autoplayMistakeCountersSchema,
  strategyDelta: autoplayStrategyDeltaSchema,
})

export type AutoplayPrimaryWeights = z.infer<typeof autoplayPrimaryWeightSchema>
export type AutoplaySecondaryWeights = z.infer<typeof autoplaySecondaryWeightSchema>
export type AutoplayMistakeCounters = z.infer<typeof autoplayMistakeCountersSchema>
export type AutoplayMoveHeuristicFeatures = z.infer<typeof autoplayMoveHeuristicFeaturesSchema>
export type AutoplayMoveHeuristicWeights = z.infer<typeof autoplayMoveHeuristicWeightsSchema>
export type AutoplayRunSummary = z.infer<typeof autoplayRunSummarySchema>
export type AutoplayStrategyDelta = z.infer<typeof autoplayStrategyDeltaSchema>

export function scoreAutoplayMoveHeuristic(input: {
  features: AutoplayMoveHeuristicFeatures
  weights?: Partial<AutoplayMoveHeuristicWeights>
}): number {
  const features = autoplayMoveHeuristicFeaturesSchema.parse(input.features)
  const weights = autoplayMoveHeuristicWeightsSchema.parse(input.weights || {})

  return (
    (features.immediateMergeGain * weights.immediateMergeGain)
    + (features.highRarityProtectionDelta * weights.highRarityProtectionDelta)
    + (features.uniqueEffectUpgradeDelta * weights.uniqueEffectUpgradeDelta)
    + (features.fodderPipelineDelta * weights.fodderPipelineDelta)
    + (features.bossDamagePreparationDelta * weights.bossDamagePreparationDelta)
    + (features.pfVsUpgradeDelta * weights.pfVsUpgradeDelta)
    - (features.bossThreatPenalty * weights.bossThreatPenalty)
    - (features.mineThreatPenalty * weights.mineThreatPenalty)
    - (features.expectedDecisionMs * weights.speedPenaltyAlpha)
  )
}

export function scoreAutoplayRunComposite(input: {
  summary: AutoplayRunSummary
  primaryWeights?: Partial<AutoplayPrimaryWeights>
  secondaryWeights?: Partial<AutoplaySecondaryWeights>
}): number {
  const summary = autoplayRunSummarySchema.parse(input.summary)
  const primary = autoplayPrimaryWeightSchema.parse(input.primaryWeights || {})
  const secondary = autoplaySecondaryWeightSchema.parse(input.secondaryWeights || {})

  const completionScore = summary.finalModules5StarAnc >= 24
    ? primary.completion24x5StarAnc
    : (summary.finalModules5StarAnc / 24) * primary.completion24x5StarAnc

  const efficiencyScore =
    (summary.finalShards * primary.finalShards)
    - (summary.totalMoves * primary.fewerMoves)
    - (summary.totalMerges * primary.fewerMerges)

  const speedScore = -(summary.avgTimePerMoveMs * primary.speedPenaltyAlpha)

  const secondaryScore =
    (summary.protectedHighRarityEvents * secondary.hazardProtection)
    + (summary.uniqueEquipOptimizations * secondary.uniqueEquipOptimization)
    + (summary.fodderPipelineCompletions * secondary.fodderPipelineProgress)
    + (summary.bossFodderPreparations * secondary.bossFodderPreparation)

  const mistakes = summary.mistakes
  const mistakePenalty =
    (mistakes.missedObviousMerge * 120)
    + (mistakes.sacrificedHighRarity * 200)
    + (mistakes.overShatterWhenMergeAvailable * 90)
    + (mistakes.ignoredBossThreat * 160)
    + (mistakes.ignoredMineThreat * 130)
    + (mistakes.badPfVsUpgradeChoice * 80)

  const timeoutPenalty = (summary.indecisionTimeoutEvents * 45) + (summary.forcedRestarts * 70)

  return completionScore + efficiencyScore + speedScore + secondaryScore - mistakePenalty - timeoutPenalty
}

export function parseAutoplayRunSummary(input: unknown): AutoplayRunSummary {
  return autoplayRunSummarySchema.parse(input)
}
