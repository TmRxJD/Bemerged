import { describe, expect, it } from 'vitest'
import { BemergedHeadlessEnv } from './headlessEnv'
import { assertHeadlessBoardRendered } from './boardRenderGuard'

describe('BeMerged autoplay inventory soak', () => {
  it('uses inventory within first 100 moves per episode', () => {
    const episodeCount = 1
    const maxTurns = 120

    for (let episode = 0; episode < episodeCount; episode += 1) {
      const seed = 97000 + episode
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
        context: `inventory soak episode ${episode}`,
      })

      let done = false
      let turn = 0
      let firstInventoryTurn: number | null = null

      while (!done && turn < maxTurns) {
        const validActions = env.get_valid_actions()
        if (validActions.length === 0) break

        const actionId = env.choose_autoplay_action('objective-progress')
        expect(actionId).not.toBeNull()

        const selected = validActions.find(action => action.actionId === actionId)
        expect(selected).toBeDefined()
        if (!selected) break

        if (selected.type === 'inventory' && firstInventoryTurn === null) {
          firstInventoryTurn = turn + 1
        }

        const step = env.step(selected.actionId)
        done = step.done
        turn += 1

        if (turn >= 100 && firstInventoryTurn === null) {
          break
        }
      }

      const firstInventoryCutoff = Math.min(100, turn)
      expect(
        firstInventoryTurn,
        `episode ${episode} did not use inventory by move ${firstInventoryCutoff}`,
      ).not.toBeNull()
      expect(
        firstInventoryTurn!,
        `episode ${episode} first inventory turn (${String(firstInventoryTurn)}) exceeded move 100`,
      ).toBeLessThanOrEqual(100)

      env.dispose()
    }
  }, 90000)

  it.skip('keeps inventory toggling below thrash thresholds over long episodes', () => {
    const episodeCount = 4
    const maxTurns = 140

    let totalTurns = 0
    let totalInventoryActions = 0
    let inventorySlotToggleEvents = 0
    let repeatedSameCellSlotEvents = 0
    let maxConsecutiveInventory = 0
    let episodesWithInventoryBy100 = 0
    const slotTypesTouched = new Set<string>()

    for (let episode = 0; episode < episodeCount; episode += 1) {
      const seed = 98000 + episode
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
        context: `inventory soak long episode ${episode}`,
      })

      let done = false
      let turn = 0
      let consecutiveInventory = 0
      let firstInventoryTurn: number | null = null
      let previousInventory: { slotType: string; row: number; col: number } | null = null

      while (!done && turn < maxTurns) {
        const validActions = env.get_valid_actions()
        if (validActions.length === 0) break

        const actionId = env.choose_autoplay_action('objective-progress')
        expect(actionId).not.toBeNull()

        const selected = validActions.find(action => action.actionId === actionId)
        expect(selected).toBeDefined()
        if (!selected) break

        totalTurns += 1

        if (selected.type === 'inventory') {
          totalInventoryActions += 1
          slotTypesTouched.add(selected.slotType)
          if (firstInventoryTurn === null) {
            firstInventoryTurn = turn + 1
          }
          consecutiveInventory += 1
          maxConsecutiveInventory = Math.max(maxConsecutiveInventory, consecutiveInventory)

          if (previousInventory && previousInventory.slotType === selected.slotType) {
            inventorySlotToggleEvents += 1
            if (previousInventory.row === selected.cell.row && previousInventory.col === selected.cell.col) {
              repeatedSameCellSlotEvents += 1
            }
          }

          previousInventory = {
            slotType: selected.slotType,
            row: selected.cell.row,
            col: selected.cell.col,
          }
        } else {
          consecutiveInventory = 0
          previousInventory = null
        }

        const step = env.step(selected.actionId)
        expect(step.info.reason).not.toBe('invalid-action')
        done = step.done
        turn += 1

        if (turn === 100 && firstInventoryTurn === null) {
          throw new Error(`episode ${episode} did not use inventory within first 100 moves`)
        }
      }

      const firstInventoryCutoff = Math.min(100, turn)
      expect(
        firstInventoryTurn,
        `episode ${episode} did not use inventory by move ${firstInventoryCutoff}`,
      ).not.toBeNull()
      expect(
        firstInventoryTurn!,
        `episode ${episode} first inventory turn (${String(firstInventoryTurn)}) exceeded move 100`,
      ).toBeLessThanOrEqual(100)

      if (firstInventoryTurn !== null && firstInventoryTurn <= 100) {
        episodesWithInventoryBy100 += 1
      }

      env.dispose()
    }

    const inventoryActionRatio = totalTurns > 0 ? (totalInventoryActions / totalTurns) : 0

    console.log('[bemerged-inventory-soak-report]', JSON.stringify({
      episodeCount,
      maxTurns,
      totalTurns,
      totalInventoryActions,
      inventoryActionRatio,
      inventorySlotToggleEvents,
      repeatedSameCellSlotEvents,
      maxConsecutiveInventory,
      episodesWithInventoryBy100,
      slotTypesTouched: Array.from(slotTypesTouched.values()),
    }))

    expect(totalTurns).toBeGreaterThanOrEqual(episodeCount * 90)
    expect(totalInventoryActions).toBeGreaterThan(0)
    expect(episodesWithInventoryBy100).toBe(episodeCount)
    expect(slotTypesTouched.size).toBe(4)
    expect(inventoryActionRatio).toBeLessThanOrEqual(0.35)
    expect(inventorySlotToggleEvents).toBeLessThanOrEqual(Math.max(12, Math.floor(totalInventoryActions * 0.35)))
    expect(repeatedSameCellSlotEvents).toBeLessThanOrEqual(6)
    expect(maxConsecutiveInventory).toBeLessThanOrEqual(3)
  }, 60000)
})
