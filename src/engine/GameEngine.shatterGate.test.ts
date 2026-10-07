import { describe, expect, it } from 'vitest'
import { GameEngine } from './GameEngine'
import { createModuleCatalog } from './catalog'
import { SeededRng } from './rng'
import type { ModuleToken } from './types'

function makeEngine(seed: number): GameEngine {
  return new GameEngine({
    catalog: createModuleCatalog(new SeededRng(seed)),
    seed,
  })
}

function overwriteBoardRarity(engine: GameEngine, rarity: ModuleToken['rarity']): void {
  const internals = engine as unknown as { board: (ModuleToken | null)[][] }
  const board = internals.board

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const token = board[row][col]
      if (!token) continue
      board[row][col] = {
        ...token,
        rarity,
        plus: false,
      }
    }
  }
}

describe('GameEngine autoplay shatter evaluation gate', () => {
  it('allows shatter evaluation when no merge candidate is available', () => {
    const engine = makeEngine(555001)
    overwriteBoardRarity(engine, 'Rare')
    const gate = engine.getAutoplayShatterEvaluationGate({ mergeSelection: null })

    expect(gate.allow).toBe(true)
    expect(gate.reason).toBe('no-merge-candidate')
  })

  it('blocks shatter evaluation when merge candidate exists and commons are below threshold', () => {
    const engine = makeEngine(555002)
    overwriteBoardRarity(engine, 'Rare')
    const mergeSelection = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
    const gate = engine.getAutoplayShatterEvaluationGate({ mergeSelection })

    expect(gate.allow).toBe(false)
    expect(gate.reason).toBe('blocked-by-merge-priority')
    expect(gate.commonRatio).toBeLessThan(gate.threshold)
  })

  it('allows shatter evaluation when commons ratio reaches threshold even with merge candidate', () => {
    const engine = makeEngine(555003)
    overwriteBoardRarity(engine, 'Common')

    const mergeSelection = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
    const gate = engine.getAutoplayShatterEvaluationGate({ mergeSelection })

    expect(gate.allow).toBe(true)
    expect(gate.reason).toBe('commons-threshold')
    expect(gate.commonRatio).toBeGreaterThanOrEqual(gate.threshold)
  })
})
