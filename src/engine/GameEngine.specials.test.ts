import { describe, expect, it } from 'vitest'
import { GameEngine } from './GameEngine'
import { cloneBoard, findMatches, swap } from './board'
import { createModuleCatalog } from './catalog'
import { bemergedParityTuning } from './parityTuning'
import { SeededRng } from './rng'
import type { ModuleToken } from './types'

function moveKey(move: { from: { row: number; col: number }; to: { row: number; col: number } }): string {
  return `${move.from.row}:${move.from.col}->${move.to.row}:${move.to.col}`
}

function isAdjacent(a: { row: number; col: number }, b: { row: number; col: number }): boolean {
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1
}

describe('GameEngine specials parity', () => {
  it('allows inventory modules to satisfy merge fodder requirements', () => {
    const catalog = createModuleCatalog(new SeededRng(424242))
    const engine = new GameEngine({
      catalog,
      seed: 424242,
    })

    const board = engine.getBoard()
    const sample = board[0][0]
    expect(sample).toBeTruthy()
    if (!sample) return

    const baseToken = catalog.createToken({
      templateId: sample.templateId,
      type: sample.type,
      rarity: 'Epic',
      plus: false,
    })
    const inventoryFodder = catalog.createToken({
      templateId: sample.templateId,
      type: sample.type,
      rarity: 'Epic',
      plus: false,
    })

    const internal = engine as unknown as {
      inventory: Record<'Cannon' | 'Armor' | 'Generator' | 'Core', typeof baseToken | null>
      board: Array<Array<typeof baseToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: null | { row: number; col: number }
    }

    internal.mines = []
    internal.boss = null
    internal.board[0][0] = baseToken
    internal.inventory[baseToken.type] = inventoryFodder

    const state = engine.getMergeSelectionState([{ row: 0, col: 0 }])
    expect(state.readyToMerge).toBe(true)

    const result = engine.applyMergeSelectionIfReady([{ row: 0, col: 0 }])
    expect(result.valid).toBe(true)
    expect(result.merged).toBe(true)
    expect(engine.getInventory()[baseToken.type]).toBeNull()
  })

  it('collapses tiles after merge removals even without immediate shatter', () => {
    const catalog = createModuleCatalog(new SeededRng(515151))
    const engine = new GameEngine({
      catalog,
      seed: 515151,
    })

    const board = engine.getBoard()
    const sample = board[0][0]
    expect(sample).toBeTruthy()
    if (!sample) return

    const baseToken = catalog.createToken({
      templateId: sample.templateId,
      type: sample.type,
      rarity: 'Epic',
      plus: false,
    })
    const fodderToken = catalog.createToken({
      templateId: sample.templateId,
      type: sample.type,
      rarity: 'Epic',
      plus: false,
    })

    const internal = engine as unknown as {
      board: Array<Array<typeof baseToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: null | { row: number; col: number }
    }

    internal.mines = []
    internal.boss = null
    internal.board[4][4] = baseToken
    internal.board[5][4] = fodderToken

    const result = engine.applyMergeSelectionIfReady([{ row: 4, col: 4 }, { row: 5, col: 4 }])
    expect(result.valid).toBe(true)
    expect(result.merged).toBe(true)

    const hasNull = engine.getBoard().some(row => row.some(cell => cell === null))
    expect(hasNull).toBe(false)
  })

  it('allows non-adjacent swaps even when they do not create a match', () => {
    const engine = new GameEngine({
      catalog: createModuleCatalog(new SeededRng(9001)),
      seed: 9001,
    })

    const moves = engine.findValidMoves()
    const nonMatchingMove = moves.find(move => {
      const preview = cloneBoard(engine.getBoard())
      swap(preview, move)
      return findMatches(preview).length === 0
    })

    expect(nonMatchingMove).toBeTruthy()
    const beforeFrom = engine.getBoard()[nonMatchingMove!.from.row][nonMatchingMove!.from.col]
    const beforeTo = engine.getBoard()[nonMatchingMove!.to.row][nonMatchingMove!.to.col]
    const result = engine.applyMove(nonMatchingMove!)
    expect(result.valid).toBe(true)
    const afterFrom = engine.getBoard()[nonMatchingMove!.from.row][nonMatchingMove!.from.col]
    const afterTo = engine.getBoard()[nonMatchingMove!.to.row][nonMatchingMove!.to.col]
    expect(beforeFrom).not.toBe(beforeTo)
    expect(afterFrom).not.toBeNull()
    expect(afterTo).not.toBeNull()
  })

  it('includes non-adjacent valid swap actions', () => {
    let foundNonAdjacent = false

    for (const seed of [1337, 2026, 31415, 8675309]) {
      const engine = new GameEngine({
        catalog: createModuleCatalog(new SeededRng(seed)),
        seed,
      })
      const moves = engine.findValidMoves()
      const nonAdjacent = moves.find(move => {
        const rowDelta = Math.abs(move.from.row - move.to.row)
        const colDelta = Math.abs(move.from.col - move.to.col)
        return rowDelta + colDelta > 1
      })
      if (nonAdjacent) {
        foundNonAdjacent = true
        const result = engine.applyMove(nonAdjacent)
        expect(result.valid).toBe(true)
        break
      }
    }

    expect(foundNonAdjacent).toBe(true)
  })

  it('excludes mine-adjacent tiles from valid swap actions', () => {
    const engine = new GameEngine({
      catalog: createModuleCatalog(new SeededRng(1337)),
      seed: 1337,
    })

    const moves = engine.findValidMoves()
    expect(moves.length).toBeGreaterThan(0)

    let targetMove = moves[0]
    let mineCell: { row: number; col: number } | null = null

    for (const move of moves) {
      const candidates = [
        { row: move.from.row - 1, col: move.from.col },
        { row: move.from.row + 1, col: move.from.col },
        { row: move.from.row, col: move.from.col - 1 },
        { row: move.from.row, col: move.from.col + 1 },
      ]

      const open = candidates.find(candidate => {
        if (candidate.row < 0 || candidate.row >= 8 || candidate.col < 0 || candidate.col >= 14) return false
        if (
          (candidate.row === move.from.row && candidate.col === move.from.col) ||
          (candidate.row === move.to.row && candidate.col === move.to.col)
        ) {
          return false
        }
        return true
      })

      if (open) {
        targetMove = move
        mineCell = open
        break
      }
    }

    expect(mineCell).not.toBeNull()

    const internal = engine as unknown as { mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }> }
    internal.mines = [
      {
        row: mineCell!.row,
        col: mineCell!.col,
        movesRemaining: 10,
        blastRadius: 2,
      },
    ]

    const updatedMoves = engine.findValidMoves()
    const updatedKeys = new Set(updatedMoves.map(moveKey))

    expect(updatedKeys.has(moveKey(targetMove))).toBe(false)
    for (const move of updatedMoves) {
      expect(isAdjacent(move.from, mineCell!)).toBe(false)
      expect(isAdjacent(move.to, mineCell!)).toBe(false)
    }
  })

  it('keeps boss waveCount stable across per-move boss ticks', () => {
    const engine = new GameEngine({
      catalog: createModuleCatalog(new SeededRng(2026)),
      seed: 2026,
    })

    const internal = engine as unknown as {
      boss: {
        row: number
        col: number
        hitsRemaining: number
        waveCount: number
        destructiveActive: boolean
        currentPhase: 1 | 2 | 3 | 4
        phaseMoveCount: number
        totalDestructiveMoves: number
        lastDestructiveTick: number
      } | null
      moves: number
      advanceBossSystem: () => void
    }

    internal.boss = {
      row: 0,
      col: 0,
      hitsRemaining: 100,
      waveCount: 2,
      destructiveActive: false,
      currentPhase: 1,
      phaseMoveCount: 0,
      totalDestructiveMoves: 0,
      lastDestructiveTick: 0,
    }
    internal.moves = 1

    internal.advanceBossSystem()

    expect(engine.getBoss()?.waveCount).toBe(2)
  })

  it('drops boss downward when holes exist below during resolution', () => {
    const engine = new GameEngine({
      catalog: createModuleCatalog(new SeededRng(30303)),
      seed: 30303,
    })

    const internal = engine as unknown as {
      board: Array<Array<ModuleToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: {
        row: number
        col: number
        hitsRemaining: number
        waveCount: number
        destructiveActive: boolean
        currentPhase: 1 | 2 | 3 | 4
        phaseMoveCount: number
        totalDestructiveMoves: number
        lastDestructiveTick: number
      } | null
      resolveBoardAfterAction: () => boolean
    }

    internal.mines = []
    internal.boss = {
      row: 2,
      col: 3,
      hitsRemaining: 50,
      waveCount: 1,
      destructiveActive: false,
      currentPhase: 1,
      phaseMoveCount: 0,
      totalDestructiveMoves: 0,
      lastDestructiveTick: 0,
    }

    for (let row = 3; row < 8; row += 1) {
      internal.board[row][3] = null
    }

    internal.resolveBoardAfterAction()

    expect(engine.getBoss()?.row).toBe(7)
  })

  it('counts merge actions as moves', () => {
    const catalog = createModuleCatalog(new SeededRng(45454))
    const engine = new GameEngine({
      catalog,
      seed: 45454,
    })

    const board = engine.getBoard()
    const sample = board[0][0]
    expect(sample).toBeTruthy()
    if (!sample) return

    const baseToken = catalog.createToken({
      templateId: sample.templateId,
      type: sample.type,
      rarity: 'Epic',
      plus: false,
    })
    const fodderToken = catalog.createToken({
      templateId: sample.templateId,
      type: sample.type,
      rarity: 'Epic',
      plus: false,
    })

    const internal = engine as unknown as {
      board: Array<Array<ModuleToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: null | { row: number; col: number }
    }

    internal.mines = []
    internal.boss = null
    internal.board[2][2] = baseToken
    internal.board[3][2] = fodderToken

    const beforeMoves = engine.getStats(1).moves
    const result = engine.applyMergeSelectionIfReady([{ row: 2, col: 2 }, { row: 3, col: 2 }])
    expect(result.valid).toBe(true)
    expect(result.merged).toBe(true)
    expect(engine.getStats(1).moves).toBe(beforeMoves + 1)
  })

  it('counts mine shatter actions as moves', () => {
    const catalog = createModuleCatalog(new SeededRng(56565))
    const engine = new GameEngine({
      catalog,
      seed: 56565,
    })

    const board = engine.getBoard()
    const sample = board[0][0]
    expect(sample).toBeTruthy()
    if (!sample) return

    const internal = engine as unknown as {
      board: Array<Array<ModuleToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: null | { row: number; col: number }
    }

    internal.boss = null
    internal.mines = [{ row: 4, col: 4, movesRemaining: 10, blastRadius: 1 }]
    internal.board[4][3] = catalog.createToken({
      templateId: sample.templateId,
      type: sample.type,
      rarity: 'Common',
      plus: false,
    })
    internal.board[4][5] = catalog.createToken({
      templateId: sample.templateId,
      type: sample.type,
      rarity: 'Common',
      plus: false,
    })

    const beforeMoves = engine.getStats(1).moves
    const result = engine.applyMineShatterSelection(
      { row: 4, col: 4 },
      [{ row: 4, col: 3 }, { row: 4, col: 5 }],
    )
    expect(result.valid).toBe(true)
    expect(engine.getStats(1).moves).toBe(beforeMoves + 1)
  })

  it('blocks inventory swaps while boss is on screen', () => {
    const catalog = createModuleCatalog(new SeededRng(67676))
    const engine = new GameEngine({
      catalog,
      seed: 67676,
    })

    const internal = engine as unknown as {
      board: Array<Array<ModuleToken | null>>
      boss: {
        row: number
        col: number
        hitsRemaining: number
        waveCount: number
        destructiveActive: boolean
        currentPhase: 1 | 2 | 3 | 4
        phaseMoveCount: number
        totalDestructiveMoves: number
        lastDestructiveTick: number
      } | null
    }

    internal.boss = {
      row: 0,
      col: 0,
      hitsRemaining: 100,
      waveCount: 1,
      destructiveActive: false,
      currentPhase: 1,
      phaseMoveCount: 0,
      totalDestructiveMoves: 0,
      lastDestructiveTick: 0,
    }

    internal.board[1][1] = catalog.createToken({
      templateId: 'AD',
      type: 'Cannon',
      rarity: 'Epic',
      plus: false,
    })

    expect(engine.applyInventoryAction({ row: 1, col: 1 })).toBe(false)
  })

  it('moves the boss toward nearest epic+ module every two moves', () => {
    const catalog = createModuleCatalog(new SeededRng(78787))
    const engine = new GameEngine({
      catalog,
      seed: 78787,
    })

    const internal = engine as unknown as {
      board: Array<Array<ModuleToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: {
        row: number
        col: number
        hitsRemaining: number
        waveCount: number
        destructiveActive: boolean
        currentPhase: 1 | 2 | 3 | 4
        phaseMoveCount: number
        totalDestructiveMoves: number
        lastDestructiveTick: number
      } | null
      moves: number
      advanceBossSystem: () => void
    }

    internal.mines = []
    internal.boss = {
      row: 0,
      col: 0,
      hitsRemaining: 100,
      waveCount: 1,
      destructiveActive: false,
      currentPhase: 1,
      phaseMoveCount: 0,
      totalDestructiveMoves: 0,
      lastDestructiveTick: 0,
    }
    internal.board[7][13] = catalog.createToken({
      templateId: 'AD',
      type: 'Cannon',
      rarity: 'Epic',
      plus: false,
    })

    internal.moves = 2
    internal.advanceBossSystem()

    expect(engine.getBoss()).toBeTruthy()
    expect(engine.getBoss()!.row).toBeGreaterThanOrEqual(0)
    expect(engine.getBoss()!.col).toBeGreaterThanOrEqual(0)
    expect(engine.getBoss()!.row + engine.getBoss()!.col).toBeGreaterThan(0)
  })

  it('spends shards to level epic type boosts with 10% escalating cost', () => {
    const engine = new GameEngine({
      catalog: createModuleCatalog(new SeededRng(81818)),
      seed: 81818,
    })

    const internal = engine as unknown as {
      score: number
      shardsByType: Record<'Cannon' | 'Armor' | 'Generator' | 'Core', number>
    }

    internal.score = 25000
    internal.shardsByType.Cannon = 25000

    const first = engine.purchaseShardBoostLevel('Cannon')
    expect(first.purchased).toBe(true)
    expect(first.level).toBe(1)
    expect(first.cost).toBe(10000)

    const second = engine.purchaseShardBoostLevel('Cannon')
    expect(second.purchased).toBe(true)
    expect(second.level).toBe(2)
    expect(second.cost).toBe(11000)

    const third = engine.purchaseShardBoostLevel('Cannon')
    expect(third.purchased).toBe(false)
    expect(third.cost).toBe(12100)

    const stats = engine.getStats(1)
    expect(stats.shardsByType.Cannon).toBe(4000)
    expect(stats.score).toBe(4000)
    expect(stats.shardBoostLevels?.Cannon).toBe(2)
    expect(stats.canAffordShardBoost?.Cannon).toBe(false)
  })

  it('tracks next-cost and affordability per shard type independently', () => {
    const engine = new GameEngine({
      catalog: createModuleCatalog(new SeededRng(83210)),
      seed: 83210,
    })

    const internal = engine as unknown as {
      score: number
      shardsByType: Record<'Cannon' | 'Armor' | 'Generator' | 'Core', number>
    }

    internal.score = 45000
    internal.shardsByType.Cannon = 11000
    internal.shardsByType.Armor = 9000
    internal.shardsByType.Generator = 10000
    internal.shardsByType.Core = 5000

    const cannonPurchase = engine.purchaseShardBoostLevel('Cannon')
    const generatorPurchase = engine.purchaseShardBoostLevel('Generator')

    expect(cannonPurchase.purchased).toBe(true)
    expect(cannonPurchase.cost).toBe(10000)
    expect(generatorPurchase.purchased).toBe(true)
    expect(generatorPurchase.cost).toBe(10000)

    const stats = engine.getStats(1)
    expect(stats.shardBoostLevels?.Cannon).toBe(1)
    expect(stats.shardBoostLevels?.Generator).toBe(1)
    expect(stats.shardBoostLevels?.Armor).toBe(0)
    expect(stats.shardBoostLevels?.Core).toBe(0)

    expect(stats.shardBoostNextCost?.Cannon).toBe(11000)
    expect(stats.shardBoostNextCost?.Generator).toBe(11000)
    expect(stats.shardBoostNextCost?.Armor).toBe(10000)
    expect(stats.shardBoostNextCost?.Core).toBe(10000)

    expect(stats.canAffordShardBoost?.Cannon).toBe(false)
    expect(stats.canAffordShardBoost?.Generator).toBe(false)
    expect(stats.canAffordShardBoost?.Armor).toBe(false)
    expect(stats.canAffordShardBoost?.Core).toBe(false)
    expect(stats.score).toBe(25000)
  })

  it('biases epic spawn type selection using purchased shard boost levels', () => {
    const catalog = createModuleCatalog(new SeededRng(84567))
    const engine = new GameEngine({
      catalog,
      seed: 84567,
    })

    const internal = engine as unknown as {
      shardBoostLevels: Record<'Cannon' | 'Armor' | 'Generator' | 'Core', number>
      rng: {
        next: () => number
        int: (maxExclusive: number) => number
      }
      applyEpicTypeSpawnWeighting: (token: ModuleToken) => ModuleToken
    }

    internal.shardBoostLevels.Cannon = 120
    internal.shardBoostLevels.Armor = 0
    internal.shardBoostLevels.Generator = 0
    internal.shardBoostLevels.Core = 0

    const baseEpicArmor = catalog.createToken({
      templateId: 'ACP',
      type: 'Armor',
      rarity: 'Epic',
      plus: false,
    })

    const originalNext = internal.rng.next
    const originalInt = internal.rng.int
    internal.rng.next = () => 0
    internal.rng.int = () => 0

    const weighted = internal.applyEpicTypeSpawnWeighting(baseEpicArmor)

    internal.rng.next = originalNext
    internal.rng.int = originalInt

    expect(weighted.rarity).toBe('Epic')
    expect(weighted.type).toBe('Cannon')
  })

  it('awards 2x shards for boss combos of 5+ modules', () => {
    const catalog = createModuleCatalog(new SeededRng(92929))
    const engine = new GameEngine({
      catalog,
      seed: 92929,
    })

    const internal = engine as unknown as {
      board: Array<Array<ModuleToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: {
        row: number
        col: number
        hitsRemaining: number
        waveCount: number
        destructiveActive: boolean
        currentPhase: 1 | 2 | 3 | 4
        phaseMoveCount: number
        totalDestructiveMoves: number
        lastDestructiveTick: number
      } | null
    }

    internal.mines = []
    internal.boss = {
      row: 0,
      col: 0,
      hitsRemaining: 100,
      waveCount: 1,
      destructiveActive: false,
      currentPhase: 1,
      phaseMoveCount: 0,
      totalDestructiveMoves: 0,
      lastDestructiveTick: 0,
    }

    const commonA = catalog.createToken({ templateId: 'MC_C', type: 'Cannon', rarity: 'Common', plus: false })
    const commonB = catalog.createToken({ templateId: 'EC_G', type: 'Generator', rarity: 'Common', plus: false })
    const commonC = catalog.createToken({ templateId: 'MB', type: 'Armor', rarity: 'Common', plus: false })
    const commonD = catalog.createToken({ templateId: 'MC_CO', type: 'Core', rarity: 'Common', plus: false })
    const commonE = catalog.createToken({ templateId: 'EC_C', type: 'Cannon', rarity: 'Common', plus: false })

    internal.board[6][1] = commonA
    internal.board[6][2] = commonB
    internal.board[6][3] = commonC
    internal.board[6][4] = commonD
    internal.board[6][5] = commonE

    const before = engine.getStats(1).score
    const result = engine.applyBossShatterSelection([
      { row: 6, col: 1 },
      { row: 6, col: 2 },
      { row: 6, col: 3 },
      { row: 6, col: 4 },
      { row: 6, col: 5 },
    ])

    expect(result.valid).toBe(true)
    expect(result.removed).toBe(5)

    const expectedMinimumGain = bemergedParityTuning.shardsPerClear * 5 * 2
    const gained = engine.getStats(1).score - before
    expect(gained).toBeGreaterThanOrEqual(expectedMinimumGain)
  })

  it('awards 2x shards for mine shatter combos of 5+ modules', () => {
    const catalog = createModuleCatalog(new SeededRng(93939))
    const engine = new GameEngine({
      catalog,
      seed: 93939,
    })

    const internal = engine as unknown as {
      board: Array<Array<ModuleToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: {
        row: number
        col: number
        hitsRemaining: number
        waveCount: number
        destructiveActive: boolean
        currentPhase: 1 | 2 | 3 | 4
        phaseMoveCount: number
        totalDestructiveMoves: number
        lastDestructiveTick: number
      } | null
    }

    internal.boss = null
    internal.mines = [{ row: 4, col: 4, movesRemaining: 10, blastRadius: 1 }]

    internal.board[3][4] = catalog.createToken({ templateId: 'MC_C', type: 'Cannon', rarity: 'Common', plus: false })
    internal.board[5][4] = catalog.createToken({ templateId: 'EC_C', type: 'Cannon', rarity: 'Common', plus: false })
    internal.board[4][3] = catalog.createToken({ templateId: 'MC_C', type: 'Cannon', rarity: 'Common', plus: false })
    internal.board[4][5] = catalog.createToken({ templateId: 'EC_C', type: 'Cannon', rarity: 'Common', plus: false })
    internal.board[5][5] = catalog.createToken({ templateId: 'MC_C', type: 'Cannon', rarity: 'Common', plus: false })

    const before = engine.getStats(1).score
    const result = engine.applyMineShatterSelection(
      { row: 4, col: 4 },
      [
        { row: 3, col: 4 },
        { row: 5, col: 4 },
        { row: 4, col: 3 },
        { row: 4, col: 5 },
      ],
    )

    expect(result.valid).toBe(true)
    expect(result.reason).toBe('mine-shattered')

    const expectedMinimumGain = bemergedParityTuning.shardsPerClear * 5 * 2
    const gained = engine.getStats(1).score - before
    expect(gained).toBeGreaterThanOrEqual(expectedMinimumGain)
  })

  it('awards 2x shards for 5+ standard board shatter clears', () => {
    const catalog = createModuleCatalog(new SeededRng(94949))
    const engine = new GameEngine({
      catalog,
      seed: 94949,
    })

    const internal = engine as unknown as {
      board: Array<Array<ModuleToken | null>>
      mines: Array<{ row: number; col: number; movesRemaining: number; blastRadius: number }>
      boss: null | {
        row: number
        col: number
        hitsRemaining: number
      }
      resolveBoardAfterAction: () => boolean
    }

    internal.mines = []
    internal.boss = null

    internal.board[2][2] = catalog.createToken({ templateId: 'MC_C', type: 'Cannon', rarity: 'Common', plus: false })
    internal.board[2][3] = catalog.createToken({ templateId: 'EC_C', type: 'Cannon', rarity: 'Common', plus: false })
    internal.board[2][4] = catalog.createToken({ templateId: 'MC_C', type: 'Cannon', rarity: 'Common', plus: false })
    internal.board[2][5] = catalog.createToken({ templateId: 'EC_C', type: 'Cannon', rarity: 'Common', plus: false })
    internal.board[2][6] = catalog.createToken({ templateId: 'MC_C', type: 'Cannon', rarity: 'Common', plus: false })

    const before = engine.getStats(1).score
    const merged = internal.resolveBoardAfterAction()

    expect(merged).toBe(true)
    const expectedMinimumGain = bemergedParityTuning.shardsPerClear * 5 * 2
    const gained = engine.getStats(1).score - before
    expect(gained).toBeGreaterThanOrEqual(expectedMinimumGain)
  })
})
