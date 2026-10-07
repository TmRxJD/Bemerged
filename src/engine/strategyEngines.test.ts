import { describe, expect, it } from 'vitest'
import { scoreBossStrategyMove } from './bossStrategyEngine'
import { scoreMineStrategyMove } from './mineStrategyEngine'
import { scorePreservationMove } from './preservationStrategyEngine'
import { scoreTempoMove } from './scoreTempoEngine'
import { recommendShardBoostType, scoreInventorySwapForModuleStrategy } from './modStrategyEngine'
import { composeMetaPlannerScore } from './metaStrategyPlanner'

describe('strategy engine scoring', () => {
  it('boss engine prioritizes direct boss damage over neutral pre-spawn state', () => {
    const bossScore = scoreBossStrategyMove({
      goal: 'boss-damage',
      hasBoss: true,
      movesUntilBossSpawn: 99,
      bossDamage: 12,
      matchCount: 3,
      rareClearCount: 1,
      rarePlusClearCount: 1,
      objectiveProgressDelta: 0,
      spawnPrepDelta: 0,
    })

    const prepScore = scoreBossStrategyMove({
      goal: 'boss-damage',
      hasBoss: false,
      movesUntilBossSpawn: 4,
      bossDamage: 0,
      matchCount: 0,
      rareClearCount: 0,
      rarePlusClearCount: 0,
      objectiveProgressDelta: 0,
      spawnPrepDelta: 5,
    })

    expect(bossScore).toBeGreaterThan(prepScore)
  })

  it('mine and preservation engines penalize exposed unstable moves', () => {
    const safe = scoreMineStrategyMove({
      goal: 'objective-progress',
      mineCount: 2,
      hasBoss: false,
      hazardMitigationBonus: 2,
      hazardExposurePenalty: 0,
      mineDistancePenalty: 10,
      strategicRowingBonus: 50,
    }) + scorePreservationMove({
      goal: 'objective-progress',
      hazardExposurePenalty: 0,
      hazardMitigationBonus: 2,
      commonOnlyMatchPenalty: 0,
      oscillationPenalty: 0,
      strategicRowingBonus: 50,
      mergeReadinessDelta: 1,
    })

    const risky = scoreMineStrategyMove({
      goal: 'objective-progress',
      mineCount: 2,
      hasBoss: true,
      hazardMitigationBonus: 0,
      hazardExposurePenalty: 2,
      mineDistancePenalty: 80,
      strategicRowingBonus: -20,
    }) + scorePreservationMove({
      goal: 'objective-progress',
      hazardExposurePenalty: 2,
      hazardMitigationBonus: 0,
      commonOnlyMatchPenalty: 800,
      oscillationPenalty: 1200,
      strategicRowingBonus: -20,
      mergeReadinessDelta: -1,
    })

    expect(safe).toBeGreaterThan(risky)
  })

  it('mod strategy prefers meaningful upgrades and smart shard spending', () => {
    const upgradeScore = scoreInventorySwapForModuleStrategy({
      goal: 'objective-progress',
      phase: 'pre-boss',
      upgradeValue: 16,
      rarityDelta: 2,
      effectDelta: 10,
      tokenEffectBonus: 22,
      slotEffectBonus: 8,
      threatened: false,
      anticipatedThreat: true,
      repeatedTouch: 0,
      reversePingPong: false,
    })

    const pingPongScore = scoreInventorySwapForModuleStrategy({
      goal: 'objective-progress',
      phase: 'board',
      upgradeValue: 2,
      rarityDelta: 0,
      effectDelta: 0,
      tokenEffectBonus: 4,
      slotEffectBonus: 6,
      threatened: false,
      anticipatedThreat: false,
      repeatedTouch: 2,
      reversePingPong: true,
    })

    expect(upgradeScore).toBeGreaterThan(pingPongScore)

    const recommendedType = recommendShardBoostType({
      goal: 'objective-progress',
      pfScale: 0,
      totalShards: 40000,
      movesUntilBossSpawn: 3,
      candidates: [
        {
          type: 'Cannon',
          availableShards: 20000,
          nextCost: 11000,
          level: 2,
          objectiveNeed: 4,
          fodderNeed: 5,
        },
        {
          type: 'Armor',
          availableShards: 20000,
          nextCost: 11000,
          level: 4,
          objectiveNeed: 1,
          fodderNeed: 1,
        },
      ],
    })

    expect(recommendedType).toBe('Cannon')

    const pfConstrainedRecommendation = recommendShardBoostType({
      goal: 'objective-progress',
      pfScale: 8,
      totalShards: 220000,
      movesUntilBossSpawn: 4,
      candidates: [
        {
          type: 'Cannon',
          availableShards: 60000,
          nextCost: 12000,
          level: 3,
          objectiveNeed: 2,
          fodderNeed: 1,
        },
      ],
    })

    // High PF hoard pressure should suppress low-urgency shard spending.
    expect(pfConstrainedRecommendation).toBeNull()
  })

  it('meta planner combines strategy survival and score deterministically', () => {
    const total = composeMetaPlannerScore({
      goal: 'balanced',
      baseGoalScore: 1000,
      strategyScore: 400,
      survivalScore: 300,
      scoreTempo: scoreTempoMove({
        goal: 'balanced',
        shardsValue: 10,
        matchCount: 4,
        objectiveTypeWeight: 3,
        objectiveCompletionWeight: 20,
        rareClearBonus: 300,
        commonClearBonus: 40,
        fodderPipelineMatchBonus: 200,
      }),
    })

    expect(total).toBeGreaterThan(1000)
  })
})
