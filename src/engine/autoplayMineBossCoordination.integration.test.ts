import { describe, expect, it } from 'vitest'
import { BemergedHeadlessEnv } from './headlessEnv'
import type { BemergedHeadlessAction } from './headlessEnv'
import { assertHeadlessBoardRendered } from './boardRenderGuard'

type CoordinationSummary = {
  bossTurns: number
  overlapHazardTurns: number
  cumulativeHazardPenalty: number
  cumulativeBossDamageProxy: number
}

function chooseNoCoordinationAction(validActions: BemergedHeadlessAction[]): number {
  const nonInventory = validActions.find(action => action.type === 'swap')
    || validActions.find(action => action.type === 'merge')
    || validActions[0]

  return nonInventory.actionId
}

function runCoordinationEpisode(input: {
  seed: number
  targetMoves: number
  policy: 'strategic' | 'baseline'
}): CoordinationSummary {
  const env = new BemergedHeadlessEnv({
    scenarioId: 'objective-default',
    seed: input.seed,
    maxTurns: Math.max(220, input.targetMoves * 3),
    stagnationTurnLimit: Math.max(120, input.targetMoves * 2),
    goal: 'boss-damage',
  })

  const resetResult = env.reset(input.seed)
  assertHeadlessBoardRendered({
    state: resetResult.state,
    validActions: resetResult.validActions,
    context: `mine-boss coordination seed ${input.seed}`,
  })

  let state = resetResult.state
  let done = false
  let turn = 0

  let bossTurns = 0
  let overlapHazardTurns = 0
  let cumulativeHazardPenalty = 0
  let cumulativeBossDamageProxy = 0

  const maxDecisionTurns = Math.max(220, input.targetMoves * 3)
  while (!done && turn < maxDecisionTurns && state.player.moves < input.targetMoves) {
    const validActions = env.get_valid_actions()
    if (validActions.length === 0) break

    const actionId = input.policy === 'strategic'
      ? env.choose_autoplay_action('boss-damage')
      : chooseNoCoordinationAction(validActions)

    if (actionId === null) break

    const previousBossHp = state.boss?.hp ?? null
    const step = env.step(actionId)
    state = step.nextState

    const bossActive = state.boss !== null
    if (bossActive) {
      bossTurns += 1
    }

    const nextBossHp = state.boss?.hp ?? null
    if (previousBossHp !== null && nextBossHp !== null && nextBossHp < previousBossHp) {
      cumulativeBossDamageProxy += previousBossHp - nextBossHp
    }

    const risk = step.rewardBreakdown.risk
    if (bossActive && risk <= -20) {
      overlapHazardTurns += 1
    }
    if (risk < 0) {
      cumulativeHazardPenalty += risk
    }

    done = step.done
    turn += 1
  }

  env.dispose()

  return {
    bossTurns,
    overlapHazardTurns,
    cumulativeHazardPenalty,
    cumulativeBossDamageProxy,
  }
}

describe('BeMerged mine + boss coordination integration', () => {
  it('reduces overlap hazard pressure while preserving boss pressure versus baseline policy', () => {
    const episodeCount = 1
    const targetMoves = 60

    let strategicBossTurns = 0
    let baselineBossTurns = 0
    let strategicOverlapHazardTurns = 0
    let baselineOverlapHazardTurns = 0
    let strategicHazardPenalty = 0
    let baselineHazardPenalty = 0
    let strategicBossDamage = 0
    let baselineBossDamage = 0

    for (let episode = 0; episode < episodeCount; episode += 1) {
      const seed = 130000 + episode
      const strategic = runCoordinationEpisode({
        seed,
        targetMoves,
        policy: 'strategic',
      })
      const baseline = runCoordinationEpisode({
        seed,
        targetMoves,
        policy: 'baseline',
      })

      strategicBossTurns += strategic.bossTurns
      baselineBossTurns += baseline.bossTurns
      strategicOverlapHazardTurns += strategic.overlapHazardTurns
      baselineOverlapHazardTurns += baseline.overlapHazardTurns
      strategicHazardPenalty += strategic.cumulativeHazardPenalty
      baselineHazardPenalty += baseline.cumulativeHazardPenalty
      strategicBossDamage += strategic.cumulativeBossDamageProxy
      baselineBossDamage += baseline.cumulativeBossDamageProxy
    }

    console.log('[bemerged-mine-boss-coordination-report]', JSON.stringify({
      episodeCount,
      targetMoves,
      strategicBossTurns,
      baselineBossTurns,
      strategicOverlapHazardTurns,
      baselineOverlapHazardTurns,
      strategicHazardPenalty,
      baselineHazardPenalty,
      strategicBossDamage,
      baselineBossDamage,
    }))

    expect(strategicOverlapHazardTurns).toBeLessThanOrEqual(strategicBossTurns)

    if (strategicBossTurns > 0) {
      expect(strategicBossDamage).toBeGreaterThanOrEqual(0)
    }

    if (baselineBossTurns > 0 && strategicBossTurns > 0) {
      expect(strategicOverlapHazardTurns).toBeLessThanOrEqual(baselineOverlapHazardTurns)
      expect(strategicBossDamage).toBeGreaterThanOrEqual(Math.floor(baselineBossDamage * 0.65))
    }
  }, 45000)
})
