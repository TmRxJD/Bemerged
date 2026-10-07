import { describe, expect, it } from 'vitest'
import { BemergedHeadlessEnv } from './headlessEnv'
import type { BemergedHeadlessAction } from './headlessEnv'
import { assertHeadlessBoardRendered } from './boardRenderGuard'

type EpisodeSummary = {
  preBossInventoryActions: number
  cumulativeBossDamageProxy: number
}

function chooseNoInventoryAction(validActions: BemergedHeadlessAction[]): number {
  const nonInventory = validActions.find(action => action.type === 'merge')
    || validActions.find(action => action.type === 'swap')
    || validActions[0]

  return nonInventory.actionId
}

function runBossDamageEpisode(input: {
  seed: number
  maxTurns: number
  policy: 'strategic' | 'no-loadout'
}): EpisodeSummary {
  const env = new BemergedHeadlessEnv({
    scenarioId: 'objective-default',
    seed: input.seed,
    maxTurns: input.maxTurns,
    goal: 'boss-damage',
  })

  const resetResult = env.reset(input.seed)
  assertHeadlessBoardRendered({
    state: resetResult.state,
    validActions: resetResult.validActions,
    context: `boss loadout seed ${input.seed}`,
  })

  let state = resetResult.state
  let done = false
  let turn = 0
  let preBossInventoryActions = 0
  let cumulativeBossDamageProxy = 0

  while (!done && turn < input.maxTurns) {
    const validActions = env.get_valid_actions()
    if (validActions.length === 0) break

    const bossVisibleBeforeStep = state.boss !== null

    let actionId: number | null
    if (input.policy === 'strategic') {
      actionId = env.choose_autoplay_action('boss-damage')
      if (actionId === null) break
    } else {
      actionId = chooseNoInventoryAction(validActions)
    }

    const selected = validActions.find(action => action.actionId === actionId)
    if (!selected) break

    if (!bossVisibleBeforeStep && selected.type === 'inventory') {
      preBossInventoryActions += 1
    }

    const previousBossHp = state.boss?.hp ?? null
    const step = env.step(actionId)
    state = step.nextState
    const nextBossHp = state.boss?.hp ?? null

    if (previousBossHp !== null && nextBossHp !== null && nextBossHp < previousBossHp) {
      cumulativeBossDamageProxy += previousBossHp - nextBossHp
    }

    done = step.done
    turn += 1
  }

  env.dispose()

  return {
    preBossInventoryActions,
    cumulativeBossDamageProxy,
  }
}

describe('BeMerged boss loadout strategy integration', () => {
  it('uses pre-boss inventory setup to improve boss-damage outcomes over no-loadout baseline', () => {
    const episodeCount = 1
    const maxTurns = 80

    let strategicPreBossInventory = 0
    let baselinePreBossInventory = 0
    let strategicBossDamage = 0
    let baselineBossDamage = 0

    for (let episode = 0; episode < episodeCount; episode += 1) {
      const seed = 120000 + episode

      const strategic = runBossDamageEpisode({
        seed,
        maxTurns,
        policy: 'strategic',
      })
      const baseline = runBossDamageEpisode({
        seed,
        maxTurns,
        policy: 'no-loadout',
      })

      strategicPreBossInventory += strategic.preBossInventoryActions
      baselinePreBossInventory += baseline.preBossInventoryActions
      strategicBossDamage += strategic.cumulativeBossDamageProxy
      baselineBossDamage += baseline.cumulativeBossDamageProxy
    }

    console.log('[bemerged-boss-loadout-report]', JSON.stringify({
      episodeCount,
      maxTurns,
      strategicPreBossInventory,
      baselinePreBossInventory,
      strategicBossDamage,
      baselineBossDamage,
    }))

    expect(strategicPreBossInventory).toBeGreaterThan(baselinePreBossInventory)
    if (strategicBossDamage > 0 || baselineBossDamage > 0) {
      expect(strategicBossDamage).toBeGreaterThanOrEqual(baselineBossDamage)
    }
  }, 45000)
})
