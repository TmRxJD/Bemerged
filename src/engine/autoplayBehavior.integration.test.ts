import { describe, expect, it } from 'vitest'
import { BemergedHeadlessEnv } from './headlessEnv'
import { assertHeadlessBoardRendered } from './boardRenderGuard'

type SwapAction = {
  type: 'swap'
  fromRow: number
  fromCol: number
  toRow: number
  toCol: number
}

function isReverseSwap(previous: SwapAction | null, current: SwapAction | null): boolean {
  if (!previous || !current) return false
  return previous.fromRow === current.toRow
    && previous.fromCol === current.toCol
    && previous.toRow === current.fromRow
    && previous.toCol === current.fromCol
}

describe('BeMerged autoplay behavior', () => {
  it('plays with intent and avoids ping-pong loops', () => {
    const episodeCount = 1
    const maxTurns = 60

    let totalMergeOrInventoryDecisions = 0
    let totalReverseSwaps = 0
    let worstLoopCount = 0
    let mergeOpportunityCount = 0
    let intentfulChoiceCount = 0

    for (let episode = 0; episode < episodeCount; episode += 1) {
      const seed = 93000 + episode
      const env = new BemergedHeadlessEnv({
        scenarioId: 'objective-default',
        seed,
        maxTurns,
        goal: 'objective-progress',
      })

      const resetResult = env.reset(seed)
      assertHeadlessBoardRendered({
        state: resetResult.state,
        validActions: resetResult.validActions,
        context: `autoplay behavior episode ${episode}`,
      })

      let done = false
      let turn = 0
      let previousSwap: SwapAction | null = null
      let episodeReverseSwaps = 0

      while (!done && turn < maxTurns) {
        const validActions = env.get_valid_actions()
        if (validActions.length === 0) {
          break
        }

        const actionId = env.choose_autoplay_action('objective-progress')
        expect(actionId).not.toBeNull()

        const selected = validActions.find(action => action.actionId === actionId)
        expect(selected).toBeDefined()
        if (!selected) break

        const mergeAvailable = validActions.some(action => action.type === 'merge')
        const inventoryAvailable = validActions.some(action => action.type === 'inventory')
        if (mergeAvailable || inventoryAvailable) {
          mergeOpportunityCount += 1
          if (selected.type === 'merge' || selected.type === 'inventory') {
            intentfulChoiceCount += 1
          }
        }

        if (selected.type === 'swap') {
          const currentSwap: SwapAction = {
            type: 'swap',
            fromRow: selected.fromRow,
            fromCol: selected.fromCol,
            toRow: selected.toRow,
            toCol: selected.toCol,
          }
          if (isReverseSwap(previousSwap, currentSwap)) {
            episodeReverseSwaps += 1
          }
          previousSwap = currentSwap
        } else {
          totalMergeOrInventoryDecisions += 1
          previousSwap = null
        }

        const step = env.step(selected.actionId)
        turn += 1
        done = step.done
        worstLoopCount = Math.max(worstLoopCount, step.info.loopCount)

        expect(step.info.reason).not.toBe('invalid-action')
      }

      totalReverseSwaps += episodeReverseSwaps
      env.dispose()
    }

    const intentRatio = mergeOpportunityCount > 0
      ? (intentfulChoiceCount / mergeOpportunityCount)
      : 1

    console.log('[bemerged-autoplay-intent-report]', JSON.stringify({
      episodeCount,
      totalMergeOrInventoryDecisions,
      mergeOpportunityCount,
      intentfulChoiceCount,
      intentRatio,
      totalReverseSwaps,
      worstLoopCount,
    }))

    expect(totalMergeOrInventoryDecisions).toBeGreaterThan(0)
    expect(intentRatio).toBeGreaterThanOrEqual(0.75)
    expect(totalReverseSwaps).toBeLessThanOrEqual(4)
    expect(worstLoopCount).toBeLessThanOrEqual(30)
  }, 20000)
})
