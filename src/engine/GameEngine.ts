import {
  type AutoplayGoal,
  type AutoplayLearningProfile,
  type HazardTelemetry,
  type InventorySlotTelemetry,
  BOARD_COLS,
  BOARD_ROWS,
  type BossState,
  type Cell,
  type GameStats,
  type MineState,
  type ModuleToken,
  type ModuleType,
  type Move,
  type ObjectiveProgress,
  type StrategyTelemetry,
} from './types'
import { type ModuleCatalog } from './catalog'
import { EPIC_TEMPLATES } from './moduleTemplates'
import { SeededRng } from './rng'
import {
  type BoardGrid,
  clearMatches,
  cloneBoard,
  collapse,
  createPlayableBoard,
  findAllValidMoves,
  findAnyValidMove,
  swap,
} from './board'
import { bemergedParityTuning, getBemergedProgressionTier, getBossDamageForRarity, getBossDamageForTokenProgression } from './parityTuning'
import {
  bemergedUniqueEffectTuning,
  getScaleValueForToken,
  getUniqueEffectId,
  rarityAtLeast,
  type UniqueEffectId,
} from './uniqueEffects'
import { buildMergeFodderTargetsByType } from './mergeStrategyEngine'
import { scoreBossStrategyMove } from './bossStrategyEngine'
import { scoreMineStrategyMove } from './mineStrategyEngine'
import { scorePreservationMove } from './preservationStrategyEngine'
import { scoreTempoMove } from './scoreTempoEngine'
import { composeMetaPlannerScore } from './metaStrategyPlanner'
import { type ModuleStrategyPhase, recommendShardBoostType, scoreInventorySwapForModuleStrategy } from './modStrategyEngine'

const UNIQUE_TEMPLATE_KEYS = new Set(EPIC_TEMPLATES.map(template => `${String(template.id)}:${String(template.type)}`))
const UNIQUE_MOD_TARGET_COUNT = UNIQUE_TEMPLATE_KEYS.size
const SHARD_BOOST_BASE_COST = 1000
const SHARD_BOOST_COST_GROWTH = 1.1
const SHARD_BOOST_EPIC_SPAWN_MULTIPLIER_PER_LEVEL = 1.01

const EPIC_TEMPLATE_IDS_BY_TYPE: Record<ModuleType, string[]> = {
  Cannon: [],
  Armor: [],
  Generator: [],
  Core: [],
}

for (const template of EPIC_TEMPLATES) {
  const type = template.type as ModuleType
  if (!EPIC_TEMPLATE_IDS_BY_TYPE[type]) continue
  EPIC_TEMPLATE_IDS_BY_TYPE[type].push(String(template.id))
}

function isUniqueToken(token: ModuleToken): boolean {
  return UNIQUE_TEMPLATE_KEYS.has(`${String(token.templateId)}:${String(token.type)}`)
}

const OBJECTIVE_PROGRESS_BUCKET_ORDER = [
  'Common',
  'Rare',
  'Rare+',
  'Epic',
  'Epic+',
  'Legendary',
  'Legendary+',
  'Mythic',
  'Mythic+',
  'Ancestral1',
  'Ancestral2',
  'Ancestral3',
  'Ancestral4',
  'Ancestral5',
] as const

const OBJECTIVE_STAGE_MAX = 14

function createObjectiveRarityCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const bucket of OBJECTIVE_PROGRESS_BUCKET_ORDER) {
    counts[bucket] = 0
  }
  return counts
}

function getObjectiveProgressBucket(token: ModuleToken): string {
  if (token.rarity === 'Common') return 'Common'
  if (token.rarity === 'Rare') return token.plus ? 'Rare+' : 'Rare'
  if (token.rarity === 'Epic') return token.plus ? 'Epic+' : 'Epic'
  if (token.rarity === 'Legendary') return token.plus ? 'Legendary+' : 'Legendary'
  if (token.rarity === 'Mythic') return token.plus ? 'Mythic+' : 'Mythic'
  const stars = Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
  return `Ancestral${stars}`
}

function getObjectiveStageValue(token: ModuleToken): number {
  if (token.rarity === 'Common') return 1
  if (token.rarity === 'Rare') return token.plus ? 3 : 2
  if (token.rarity === 'Epic') return token.plus ? 5 : 4
  if (token.rarity === 'Legendary') return token.plus ? 7 : 6
  if (token.rarity === 'Mythic') return token.plus ? 9 : 8
  const stars = Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
  return 9 + stars
}

function createEmptyHazardTelemetry(): HazardTelemetry {
  return {
    destroyedCount: 0,
    decayedCount: 0,
    bossDestroyedCount: 0,
    bossDecayedCount: 0,
    mineDestroyedCount: 0,
    mineDecayedCount: 0,
    highRarityDestroyedCount: 0,
    highRarityDecayedCount: 0,
    lostStageScore: 0,
    preservationPenaltyScore: 0,
  }
}

function isHighRarityToken(token: ModuleToken): boolean {
  return getObjectiveStageValue(token) >= 4
}

const AUTOPLAY_GOALS: ReadonlyArray<AutoplayGoal> = [
  'balanced',
  'objective-progress',
  'max-shards',
  'max-merges',
  'farm-cannon',
  'farm-armor',
  'farm-generator',
  'farm-core',
  'boss-damage',
]
const AUTOPLAY_HAZARD_TUNING = {
  inventory: {
    anticipatedThreatBase: 900,
    anticipatedThreatTokenWeight: 120,
    bossSpawnSoonTokenWeight: 70,
  },
  exposure: {
    mineBlast: 180,
    mineAdjacent: 85,
    bossAdjacentDestructive: 260,
    bossAdjacentPassive: 110,
    bossSpawnTopRows: 95,
  },
  scoring: {
    noClear: {
      hazardMitigationBonus: 320,
      spawnPrepDelta: 420,
      hazardExposurePenalty: 760,
    },
    objectiveProgress: {
      hazardMitigationBonus: 500,
      spawnPrepDelta: 640,
      hazardExposurePenalty: 980,
    },
    maxMerges: {
      hazardMitigationBonus: 120,
      spawnPrepDelta: 140,
      hazardExposurePenalty: 360,
    },
    maxShards: {
      hazardMitigationBonus: 90,
      spawnPrepDelta: 110,
      hazardExposurePenalty: 320,
    },
    farm: {
      hazardMitigationBonus: 90,
      spawnPrepDelta: 110,
      hazardExposurePenalty: 320,
    },
    bossDamage: {
      hazardMitigationBonus: 130,
      spawnPrepDelta: 160,
      hazardExposurePenalty: 420,
    },
    balanced: {
      hazardMitigationBonus: 220,
      spawnPrepDelta: 260,
      hazardExposurePenalty: 560,
    },
  },
  positioning: {
    bottomRowSafetyDeltaWeight: 55,
  },
  hazardLoss: {
    mineMultiplier: 1.45,
    bossMultiplier: 1.8,
  },
} as const

function isAutoplayGoal(value: string): value is AutoplayGoal {
  return AUTOPLAY_GOALS.includes(value as AutoplayGoal)
}

function rarityWeightForRarity(rarity: ModuleToken['rarity'], plus: boolean): number {
  if (rarity === 'Common') return 1
  if (rarity === 'Rare') return plus ? 4 : 3
  if (rarity === 'Epic') return plus ? 7 : 6
  if (rarity === 'Legendary') return plus ? 9 : 8
  if (rarity === 'Mythic') return plus ? 11 : 10
  if (rarity === 'Ancestral') return 13
  return 1
}

function rarityWeight(token: ModuleToken): number {
  return rarityWeightForRarity(token.rarity, !!token.plus)
}

function preservationWeight(token: ModuleToken): number {
  const rarity = token.rarity
  if (rarity === 'Common') return 0.25
  if (rarity === 'Rare') return token.plus ? 3.5 : 2.6
  if (rarity === 'Epic') return token.plus ? 5.8 : 4.6
  if (rarity === 'Legendary') return token.plus ? 8.8 : 7.1
  if (rarity === 'Mythic') return token.plus ? 12 : 10.2
  if (rarity === 'Ancestral') {
    const stars = Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
    return 14 + (stars * 2.8)
  }
  return 1
}

function getComboDamageForToken(token: ModuleToken): number {
  return getBossDamageForTokenProgression(token)
}

type PermanentUniqueEffectState = {
  uniqueKey: string
  effectId: UniqueEffectId
}

type BossComboPreview = {
  valid: boolean
  reason: string
  damage: number
  autoIncludedCells: Cell[]
  manualSelectableCells: Cell[]
  mineCells: Cell[]
  affectedMineCells: Cell[]
  allDamageCells: Cell[]
}

type MineExplosionPreview = {
  valid: boolean
  reason: string
  removed: number
  damage: number
  blastRadius: number
  affectedCells: Cell[]
}

type EngineConfig = {
  seed: number
  catalog: ModuleCatalog
}

type MergeOutcome = {
  rarity: ModuleToken['rarity']
  plus: boolean
  stars?: number
}

type MergeSelectionEvaluation = {
  valid: boolean
  reason: string
  baseToken: ModuleToken | null
  requiredTotal: number
  fodders: ModuleToken[]
  inventoryFodderSlots: ModuleType[]
}

type FodderTargetsByType = Record<ModuleType, {
  epicPlusDeficit: number
  legendaryPlusDeficit: number
  templateEpicPlusDeficit: number
  activeUniqueTemplateId: string | null
  hasUpgradeableUnique: boolean
}>

export type AutoplayShatterEvaluationGate = {
  allow: boolean
  reason: 'commons-threshold' | 'no-merge-candidate' | 'blocked-by-merge-priority'
  commonRatio: number
  commonCount: number
  tokenCount: number
  threshold: number
  hasMergeCandidate: boolean
}

type SerializedMergeSession = {
  base: Cell | null
  baseSlot?: ModuleType | null
  selection: Cell[]
  candidateKeys: string[]
}

export type GameEngineRuntimeState = {
  version: 1 | 2 | 3
  rngState: number
  board: (ModuleToken | null)[][]
  moves: number
  merges: number
  shatters: number
  score: number
  bossesKilled?: number
  shardsByType: Record<ModuleType, number>
  shardBoostLevels?: Record<ModuleType, number>
  mines: MineState[]
  boss: BossState | null
  bossWaveCount: number
  bossSpawnCount: number
  lastMineSpawnMove: number
  autoShatterRares: boolean
  inventory: Record<ModuleType, ModuleToken | null>
  mergeSession: SerializedMergeSession | null
  lastAppliedMove: Move | null
  recentAppliedMoveKeys: string[]
  lastInventoryExchange: {
    slotType: ModuleType
    cell: Cell
    boardTokenSignature: string
    slotTokenSignature: string | null
  } | null
  lastInventoryTouch: {
    slotType: ModuleType
    cell: Cell
    repeats: number
  } | null
  consecutiveInventoryActions: number
  bossMaxHits?: number
  bossComboCount?: number
  bossAliveMoveCount?: number
  bonusElapsedSeconds?: number
  bossMoveCount?: number
  permanentUniqueEffects?: PermanentUniqueEffectState[]
}

const AUTOPLAY_SHATTER_COMMON_RATIO_THRESHOLD = 0.52

export type MergeSelectionState = {
  valid: boolean
  reason: string
  requiredTotal: number
  selectedCount: number
  readyToMerge: boolean
  previewToken: ModuleToken | null
}

export type MergeSessionSnapshot = {
  active: boolean
  base: Cell | null
  baseSlot: ModuleType | null
  selection: Cell[]
  candidateKeys: string[]
  state: MergeSelectionState
}

function hasStraightTriple(cells: Cell[]): boolean {
  if (!cells || cells.length < 3) return false

  const byRow = new Map<number, number[]>()
  const byCol = new Map<number, number[]>()
  for (const cell of cells) {
    byRow.set(cell.row, [...(byRow.get(cell.row) || []), cell.col])
    byCol.set(cell.col, [...(byCol.get(cell.col) || []), cell.row])
  }

  for (const values of byRow.values()) {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    let run = 1
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] === sorted[index - 1] + 1) {
        run += 1
        if (run >= 3) return true
      } else {
        run = 1
      }
    }
  }

  for (const values of byCol.values()) {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    let run = 1
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] === sorted[index - 1] + 1) {
        run += 1
        if (run >= 3) return true
      } else {
        run = 1
      }
    }
  }

  return false
}

function extractStraightRunPositions(cells: Cell[]): Cell[] {
  const out = new Map<string, Cell>()
  if (!cells || cells.length === 0) return []

  const byRow = new Map<number, number[]>()
  const byCol = new Map<number, number[]>()
  for (const cell of cells) {
    byRow.set(cell.row, [...(byRow.get(cell.row) || []), cell.col])
    byCol.set(cell.col, [...(byCol.get(cell.col) || []), cell.row])
  }

  for (const [row, values] of byRow.entries()) {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    if (sorted.length === 0) continue
    let run: number[] = [sorted[0]]
    for (let index = 1; index <= sorted.length; index += 1) {
      const current = sorted[index]
      const previous = sorted[index - 1]
      if (current === previous + 1) {
        run.push(current)
      } else {
        if (run.length >= 3) {
          for (const col of run) {
            out.set(`${row}:${col}`, { row, col })
          }
        }
        run = current !== undefined ? [current] : []
      }
    }
  }

  for (const [col, values] of byCol.entries()) {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    if (sorted.length === 0) continue
    let run: number[] = [sorted[0]]
    for (let index = 1; index <= sorted.length; index += 1) {
      const current = sorted[index]
      const previous = sorted[index - 1]
      if (current === previous + 1) {
        run.push(current)
      } else {
        if (run.length >= 3) {
          for (const row of run) {
            out.set(`${row}:${col}`, { row, col })
          }
        }
        run = current !== undefined ? [current] : []
      }
    }
  }

  return Array.from(out.values())
}

function createShardCounter(): Record<ModuleType, number> {
  return {
    Cannon: 0,
    Armor: 0,
    Generator: 0,
    Core: 0,
  }
}

function createShardBoostCounter(): Record<ModuleType, number> {
  return {
    Cannon: 0,
    Armor: 0,
    Generator: 0,
    Core: 0,
  }
}

function cloneToken(token: ModuleToken | null): ModuleToken | null {
  if (!token) return null
  return {
    ...token,
    stars: token.stars,
  }
}

function cloneBoardDeep(board: (ModuleToken | null)[][]): (ModuleToken | null)[][] {
  return board.map(row => row.map(token => cloneToken(token)))
}

const OBJECTIVE_TARGET_STARS = 5

function createNeutralLearningProfile(): AutoplayLearningProfile {
  return {
    attempts: 0,
    typeBias: {
      Cannon: 1,
      Armor: 1,
      Generator: 1,
      Core: 1,
    },
    bestObjectiveCompletionPercent: 0,
    bestShards: 0,
    bestElapsedSeconds: 0,
  }
}

export class GameEngine {
  private readonly catalog: ModuleCatalog
  private rng: SeededRng
  private board: BoardGrid = []
  private moves = 0
  private merges = 0
  private shatters = 0
  private score = 0
  private bossesKilled = 0
  private shardsByType = createShardCounter()
  private shardBoostLevels = createShardBoostCounter()
  private mines: MineState[] = []
  private boss: BossState | null = null
  private bossWaveCount = 0
  private bossSpawnCount = 0
  private lastMineSpawnMove = Number.NEGATIVE_INFINITY
  private autoShatterRares = false
  private inventory: Record<ModuleType, ModuleToken | null> = {
    Cannon: null,
    Armor: null,
    Generator: null,
    Core: null,
  }
  private mergeSession: {
    base: Cell | null
    baseSlot: ModuleType | null
    selection: Cell[]
    candidateKeys: Set<string>
  } | null = null
  private autoplayLearningProfile: AutoplayLearningProfile = createNeutralLearningProfile()
  private lastAppliedMove: Move | null = null
  private recentAppliedMoveKeys: string[] = []
  private lastInventoryExchange: {
    slotType: ModuleType
    cell: Cell
    boardTokenSignature: string
    slotTokenSignature: string | null
  } | null = null
  private lastInventoryTouch: {
    slotType: ModuleType
    cell: Cell
    repeats: number
  } | null = null
  private consecutiveInventoryActions = 0
  private pendingHazardLossScore = 0
  private pendingHazardTelemetry: HazardTelemetry = createEmptyHazardTelemetry()
  private bossMaxHits = 0
  private bossComboCount = 0
  private bossAliveMoveCount = 0
  private bonusElapsedSeconds = 0
  private bossMoveCount = 0
  private permanentUniqueEffects: PermanentUniqueEffectState[] = []

  constructor(config: EngineConfig) {
    this.catalog = config.catalog
    this.rng = new SeededRng(config.seed)
    this.board = this.createStablePlayableBoard()
  }

  getBoard(): BoardGrid {
    return this.board
  }

  getInventory(): Record<ModuleType, ModuleToken | null> {
    return {
      Cannon: this.inventory.Cannon,
      Armor: this.inventory.Armor,
      Generator: this.inventory.Generator,
      Core: this.inventory.Core,
    }
  }

  getMines(): MineState[] {
    return this.mines.map(mine => ({ ...mine }))
  }

  getBoss(): BossState | null {
    return this.boss ? { ...this.boss } : null
  }

  debugSpawnBoss(cell?: Cell, options?: { replaceExisting?: boolean }): BossState | null {
    if (this.boss && !options?.replaceExisting) {
      return this.getBoss()
    }
    if (this.boss && options?.replaceExisting) {
      this.clearBoss()
    }

    const target = cell && !this.isCellBlocked(cell.row, cell.col)
      ? { row: cell.row, col: cell.col }
      : (() => {
        for (let row = 0; row < BOARD_ROWS; row += 1) {
          for (let col = 0; col < BOARD_COLS; col += 1) {
            if (!this.board[row][col] && !this.isCellBlocked(row, col)) {
              return { row, col }
            }
          }
        }
        return null
      })()
    if (!target) return null

    this.spawnBossAt(target.row, target.col)
    return this.getBoss()
  }

  debugAddMine(cell?: Cell, overrides?: Partial<MineState>): MineState | null {
    const target = cell && !this.isCellBlocked(cell.row, cell.col)
      ? { row: cell.row, col: cell.col }
      : (() => {
        for (let row = 0; row < BOARD_ROWS; row += 1) {
          for (let col = 0; col < BOARD_COLS; col += 1) {
            if (!this.board[row][col] && !this.isCellBlocked(row, col)) {
              return { row, col }
            }
          }
        }
        return null
      })()
    if (!target) return null

    if (this.board[target.row]?.[target.col]) {
      this.board[target.row][target.col] = null
    }

    const mine: MineState = {
      row: target.row,
      col: target.col,
      movesRemaining: Math.max(1, Math.floor(Number(overrides?.movesRemaining) || bemergedParityTuning.mine.baseMoves)),
      blastRadius: Math.max(1, Math.floor(Number(overrides?.blastRadius) || bemergedParityTuning.mine.blastRadius)),
    }
    this.mines.push(mine)
    return { ...mine }
  }

  debugSnapshot(): {
    moves: number
    boss: BossState | null
    mines: MineState[]
    board: Array<Array<{ type: ModuleType; rarity: string; plus: boolean; stars?: number } | null>>
  } {
    return {
      moves: this.moves,
      boss: this.getBoss(),
      mines: this.getMines(),
      board: this.board.map(row => row.map(token => token
        ? {
          type: token.type,
          rarity: token.rarity,
          plus: token.plus,
          stars: token.stars,
        }
        : null)),
    }
  }

  isCellBlocked(row: number, col: number): boolean {
    if (this.boss && this.boss.row === row && this.boss.col === col) return true
    return this.mines.some(mine => mine.row === row && mine.col === col)
  }

  private isCellAdjacentToMine(row: number, col: number): boolean {
    return this.mines.some(mine => {
      if (mine.row === row && mine.col === col) return false
      return Math.abs(mine.row - row) <= 1 && Math.abs(mine.col - col) <= 1
    })
  }

  private getShardBoostCostForLevel(level: number): number {
    const normalizedLevel = Math.max(0, Math.floor(Number(level) || 0))
    return Math.max(1, Math.floor(SHARD_BOOST_BASE_COST * (SHARD_BOOST_COST_GROWTH ** normalizedLevel)))
  }

  getShardBoostNextCost(type: ModuleType): number {
    return this.getShardBoostCostForLevel(this.shardBoostLevels[type] || 0)
  }

  canAffordShardBoost(type: ModuleType): boolean {
    return (this.shardsByType[type] || 0) >= this.getShardBoostNextCost(type)
  }

  purchaseShardBoostLevel(type: ModuleType): { purchased: boolean; level: number; cost: number; remaining: number } {
    const currentLevel = Math.max(0, Math.floor(this.shardBoostLevels[type] || 0))
    const cost = this.getShardBoostCostForLevel(currentLevel)
    const available = Math.max(0, Math.floor(this.shardsByType[type] || 0))
    if (available < cost) {
      return {
        purchased: false,
        level: currentLevel,
        cost,
        remaining: available,
      }
    }

    this.shardsByType[type] = available - cost
    this.score = Math.max(0, this.score - cost)
    this.shardBoostLevels[type] = currentLevel + 1

    return {
      purchased: true,
      level: this.shardBoostLevels[type],
      cost,
      remaining: this.shardsByType[type],
    }
  }

  private getEpicTypeSpawnMultiplier(type: ModuleType): number {
    const level = Math.max(0, Math.floor(this.shardBoostLevels[type] || 0))
    if (level <= 0) return 1
    return SHARD_BOOST_EPIC_SPAWN_MULTIPLIER_PER_LEVEL ** level
  }

  getStats(elapsedSeconds: number): GameStats {
    const boundedElapsed = Math.max(1, Math.floor(elapsedSeconds - this.bonusElapsedSeconds))
    const shardBoostNextCost: Record<ModuleType, number> = {
      Cannon: this.getShardBoostNextCost('Cannon'),
      Armor: this.getShardBoostNextCost('Armor'),
      Generator: this.getShardBoostNextCost('Generator'),
      Core: this.getShardBoostNextCost('Core'),
    }
    return {
      score: this.score,
      moves: this.moves,
      merges: this.merges,
      shatters: this.shatters,
      bossesKilled: this.bossesKilled,
      elapsedSeconds: boundedElapsed,
      shardsPerHour: Math.round((this.score * 3600) / boundedElapsed),
      shardsByType: {
        Cannon: this.shardsByType.Cannon,
        Armor: this.shardsByType.Armor,
        Generator: this.shardsByType.Generator,
        Core: this.shardsByType.Core,
      },
      shardBoostLevels: {
        Cannon: this.shardBoostLevels.Cannon,
        Armor: this.shardBoostLevels.Armor,
        Generator: this.shardBoostLevels.Generator,
        Core: this.shardBoostLevels.Core,
      },
      shardBoostNextCost,
      canAffordShardBoost: {
        Cannon: this.shardsByType.Cannon >= shardBoostNextCost.Cannon,
        Armor: this.shardsByType.Armor >= shardBoostNextCost.Armor,
        Generator: this.shardsByType.Generator >= shardBoostNextCost.Generator,
        Core: this.shardsByType.Core >= shardBoostNextCost.Core,
      },
    }
  }

  exportRuntimeState(): GameEngineRuntimeState {
    return {
      version: 2,
      rngState: this.rng.getState(),
      board: cloneBoardDeep(this.board),
      moves: this.moves,
      merges: this.merges,
      shatters: this.shatters,
      score: this.score,
      bossesKilled: this.bossesKilled,
      shardsByType: {
        Cannon: this.shardsByType.Cannon,
        Armor: this.shardsByType.Armor,
        Generator: this.shardsByType.Generator,
        Core: this.shardsByType.Core,
      },
      shardBoostLevels: {
        Cannon: this.shardBoostLevels.Cannon,
        Armor: this.shardBoostLevels.Armor,
        Generator: this.shardBoostLevels.Generator,
        Core: this.shardBoostLevels.Core,
      },
      mines: this.mines.map(mine => ({ ...mine })),
      boss: this.boss ? { ...this.boss } : null,
      bossWaveCount: this.bossWaveCount,
      bossSpawnCount: this.bossSpawnCount,
      lastMineSpawnMove: this.lastMineSpawnMove,
      autoShatterRares: this.autoShatterRares,
      inventory: {
        Cannon: cloneToken(this.inventory.Cannon),
        Armor: cloneToken(this.inventory.Armor),
        Generator: cloneToken(this.inventory.Generator),
        Core: cloneToken(this.inventory.Core),
      },
      mergeSession: this.mergeSession
        ? {
          base: this.mergeSession.base ? { ...this.mergeSession.base } : null,
          baseSlot: this.mergeSession.baseSlot,
          selection: this.mergeSession.selection.map(cell => ({ ...cell })),
          candidateKeys: Array.from(this.mergeSession.candidateKeys),
        }
        : null,
      lastAppliedMove: this.lastAppliedMove
        ? {
          from: { ...this.lastAppliedMove.from },
          to: { ...this.lastAppliedMove.to },
        }
        : null,
      recentAppliedMoveKeys: [...this.recentAppliedMoveKeys],
      lastInventoryExchange: this.lastInventoryExchange
        ? {
          slotType: this.lastInventoryExchange.slotType,
          cell: { ...this.lastInventoryExchange.cell },
          boardTokenSignature: this.lastInventoryExchange.boardTokenSignature,
          slotTokenSignature: this.lastInventoryExchange.slotTokenSignature,
        }
        : null,
      lastInventoryTouch: this.lastInventoryTouch
        ? {
          slotType: this.lastInventoryTouch.slotType,
          cell: { ...this.lastInventoryTouch.cell },
          repeats: this.lastInventoryTouch.repeats,
        }
        : null,
      consecutiveInventoryActions: this.consecutiveInventoryActions,
      bossMaxHits: this.bossMaxHits,
      bossComboCount: this.bossComboCount,
      bossAliveMoveCount: this.bossAliveMoveCount,
      bonusElapsedSeconds: this.bonusElapsedSeconds,
      bossMoveCount: this.bossMoveCount,
      permanentUniqueEffects: this.permanentUniqueEffects.map(effect => ({ ...effect })),
    }
  }

  importRuntimeState(raw: unknown): boolean {
    try {
      if (!raw || typeof raw !== 'object') return false
      const state = raw as Partial<GameEngineRuntimeState>
      if (state.version !== 1 && state.version !== 2 && state.version !== 3) return false
      if (!Array.isArray(state.board) || state.board.length !== BOARD_ROWS) return false

      const normalizedBoard: (ModuleToken | null)[][] = []
      for (let row = 0; row < BOARD_ROWS; row += 1) {
        const sourceRow = state.board[row]
        if (!Array.isArray(sourceRow) || sourceRow.length !== BOARD_COLS) return false
        const normalizedRow: Array<ModuleToken | null> = []
        for (let col = 0; col < BOARD_COLS; col += 1) {
          const token = sourceRow[col]
          if (token === null) {
            normalizedRow.push(null)
            continue
          }
          if (!token || typeof token !== 'object') return false
          normalizedRow.push(cloneToken(token as ModuleToken))
        }
        normalizedBoard.push(normalizedRow)
      }

      this.board = normalizedBoard
      this.rng.setState(Number(state.rngState))
      this.moves = Math.max(0, Math.floor(Number(state.moves) || 0))
      this.merges = Math.max(0, Math.floor(Number(state.merges) || 0))
      this.shatters = Math.max(0, Math.floor(Number(state.shatters) || 0))
      this.score = Math.max(0, Math.floor(Number(state.score) || 0))
      this.bossesKilled = Math.max(0, Math.floor(Number(state.bossesKilled) || 0))
      this.shardsByType = {
        Cannon: Math.max(0, Math.floor(Number(state.shardsByType?.Cannon) || 0)),
        Armor: Math.max(0, Math.floor(Number(state.shardsByType?.Armor) || 0)),
        Generator: Math.max(0, Math.floor(Number(state.shardsByType?.Generator) || 0)),
        Core: Math.max(0, Math.floor(Number(state.shardsByType?.Core) || 0)),
      }
      this.shardBoostLevels = {
        Cannon: Math.max(0, Math.floor(Number(state.shardBoostLevels?.Cannon) || 0)),
        Armor: Math.max(0, Math.floor(Number(state.shardBoostLevels?.Armor) || 0)),
        Generator: Math.max(0, Math.floor(Number(state.shardBoostLevels?.Generator) || 0)),
        Core: Math.max(0, Math.floor(Number(state.shardBoostLevels?.Core) || 0)),
      }
      this.mines = Array.isArray(state.mines) ? state.mines.map(mine => ({ ...mine })) : []
      this.boss = state.boss ? { ...state.boss } : null
      this.bossWaveCount = Math.max(0, Math.floor(Number(state.bossWaveCount) || 0))
      this.bossSpawnCount = Math.max(0, Math.floor(Number(state.bossSpawnCount) || 0))
      this.lastMineSpawnMove = Number.isFinite(Number(state.lastMineSpawnMove))
        ? Number(state.lastMineSpawnMove)
        : Number.NEGATIVE_INFINITY
      this.autoShatterRares = !!state.autoShatterRares
      this.inventory = {
        Cannon: cloneToken(state.inventory?.Cannon || null),
        Armor: cloneToken(state.inventory?.Armor || null),
        Generator: cloneToken(state.inventory?.Generator || null),
        Core: cloneToken(state.inventory?.Core || null),
      }
      this.mergeSession = state.mergeSession
        ? {
          base: state.mergeSession.base ? { ...state.mergeSession.base } : null,
          baseSlot: state.mergeSession.baseSlot ?? null,
          selection: Array.isArray(state.mergeSession.selection)
            ? state.mergeSession.selection.map(cell => ({ ...cell }))
            : [],
          candidateKeys: new Set(Array.isArray(state.mergeSession.candidateKeys) ? state.mergeSession.candidateKeys : []),
        }
        : null
      this.lastAppliedMove = state.lastAppliedMove
        ? {
          from: { ...state.lastAppliedMove.from },
          to: { ...state.lastAppliedMove.to },
        }
        : null
      this.recentAppliedMoveKeys = Array.isArray(state.recentAppliedMoveKeys)
        ? state.recentAppliedMoveKeys.filter(key => typeof key === 'string')
        : []
      this.lastInventoryExchange = state.lastInventoryExchange
        ? {
          slotType: state.lastInventoryExchange.slotType,
          cell: { ...state.lastInventoryExchange.cell },
          boardTokenSignature: String(state.lastInventoryExchange.boardTokenSignature || ''),
          slotTokenSignature: state.lastInventoryExchange.slotTokenSignature == null
            ? null
            : String(state.lastInventoryExchange.slotTokenSignature),
        }
        : null
      this.lastInventoryTouch = state.lastInventoryTouch
        ? {
          slotType: state.lastInventoryTouch.slotType,
          cell: { ...state.lastInventoryTouch.cell },
          repeats: Math.max(1, Math.floor(Number(state.lastInventoryTouch.repeats) || 1)),
        }
        : null
      this.consecutiveInventoryActions = Math.max(0, Math.floor(Number(state.consecutiveInventoryActions) || 0))
      this.bossMaxHits = Math.max(0, Math.floor(Number(state.bossMaxHits) || 0))
      this.bossComboCount = Math.max(0, Math.floor(Number(state.bossComboCount) || 0))
      this.bossAliveMoveCount = Math.max(0, Math.floor(Number(state.bossAliveMoveCount) || 0))
      this.bonusElapsedSeconds = Math.max(0, Math.floor(Number(state.bonusElapsedSeconds) || 0))
      this.bossMoveCount = Math.max(0, Math.floor(Number(state.bossMoveCount) || 0))
      this.permanentUniqueEffects = Array.isArray(state.permanentUniqueEffects)
        ? state.permanentUniqueEffects
          .filter(effect => effect && typeof effect === 'object')
          .map(effect => ({
            uniqueKey: String(effect.uniqueKey || ''),
            effectId: String(effect.effectId || '') as UniqueEffectId,
          }))
          .filter(effect => effect.uniqueKey && effect.effectId)
        : []

      if (this.boss) {
        if (this.bossMaxHits <= 0) {
          this.bossMaxHits = Math.max(1, this.boss.hitsRemaining)
        }
        this.boss.maxHits = this.bossMaxHits
        this.boss.comboCount = this.bossComboCount
        this.boss.totalDestructiveMoves = this.bossMoveCount
      }

      this.promoteSavedFiveStarUniques()
      this.repositionSpecials()
      return true
    } catch {
      return false
    }
  }

  restart(seed: number): void {
    this.rng = new SeededRng(seed)
    this.board = this.createStablePlayableBoard()
    this.moves = 0
    this.merges = 0
    this.shatters = 0
    this.score = 0
    this.bossesKilled = 0
    this.shardsByType = createShardCounter()
    this.shardBoostLevels = createShardBoostCounter()
    this.mines = []
    this.clearBoss()
    this.bossSpawnCount = 0
    this.bonusElapsedSeconds = 0
    this.bossMoveCount = 0
    this.lastMineSpawnMove = Number.NEGATIVE_INFINITY
    this.inventory = {
      Cannon: null,
      Armor: null,
      Generator: null,
      Core: null,
    }
    this.mergeSession = null
    this.lastAppliedMove = null
    this.recentAppliedMoveKeys = []
    this.lastInventoryExchange = null
    this.lastInventoryTouch = null
    this.consecutiveInventoryActions = 0
    this.permanentUniqueEffects = []
  }

  shuffle(): void {
    const flat = this.board.flat().filter(Boolean)
    for (let index = flat.length - 1; index > 0; index -= 1) {
      const target = this.rng.int(index + 1)
      const current = flat[index]
      flat[index] = flat[target]
      flat[target] = current
    }

    for (let row = 0; row < this.board.length; row += 1) {
      for (let col = 0; col < this.board[row].length; col += 1) {
        this.board[row][col] = flat[(row * this.board[row].length) + col] || this.catalog.createRandomToken()
      }
    }

    if (!findAnyValidMove(this.board)) {
      this.board = this.createStablePlayableBoard()
    }

    if (this.findShatterCellsIgnoringBlocked().length > 0) {
      this.board = this.createStablePlayableBoard()
    }

    this.repositionSpecials()
    this.mergeSession = null
    this.lastAppliedMove = null
    this.recentAppliedMoveKeys = []
    this.lastInventoryExchange = null
    this.lastInventoryTouch = null
    this.consecutiveInventoryActions = 0
  }

  findHint(): Move | null {
    const hintMoves = this.findHintMoves()
    return hintMoves[0] || null
  }

  findHintMoves(): Move[] {
    const moves = this.findValidMoves()
    const scored: Array<{ move: Move; clearCount: number }> = []

    for (const move of moves) {
      const clearCount = this.getImmediateClearCount(move)
      if (clearCount <= 0) continue
      scored.push({ move, clearCount })
    }

    scored.sort((left, right) => {
      if (left.clearCount !== right.clearCount) return right.clearCount - left.clearCount
      return this.compareMoveTieBreaker(left.move, right.move)
    })

    return scored.map(item => item.move)
  }

  hasImmediateClearMove(): boolean {
    const moves = this.findValidMoves()
    for (const move of moves) {
      if (this.getImmediateClearCount(move) > 0) return true
    }
    return false
  }

  private getImmediateClearCount(move: Move): number {
    const preview = cloneBoard(this.board)
    swap(preview, move)
    return this.findShatterCellsOnBoard(preview).length
  }

  chooseAutoplayMove(
    goal: AutoplayGoal = 'balanced',
    options?: { validMoves?: Move[]; candidateLimit?: number },
  ): Move | null {
    const validMoves = options?.validMoves || this.findValidMoves()
    if (validMoves.length === 0) return null

    const candidateMoves = this.selectAutoplayMoveCandidatesWithLimit(validMoves, options?.candidateLimit)

    const scoredMoves: Array<{ move: Move; score: number; oscillationPenalty: number; hasImmediateClear: boolean }> = []

    for (const move of candidateMoves) {
      const oscillationPenalty = this.getAutoplayOscillationPenalty(move)
      const hasImmediateClear = this.getImmediateClearCount(move) > 0
      const score = this.scoreMoveForAutoplay(move, goal)
      scoredMoves.push({ move, score, oscillationPenalty, hasImmediateClear })
    }

    scoredMoves.sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      return this.compareMoveTieBreaker(left.move, right.move)
    })

    const bestMove = scoredMoves[0]?.move || null
    if (!bestMove) return null

    const alternative = this.chooseAntiOscillationAlternative(scoredMoves)
    if (alternative) {
      return alternative
    }

    return bestMove
  }

  chooseAutoplayClearMove(
    goal: AutoplayGoal = 'balanced',
    options?: { validMoves?: Move[]; candidateLimit?: number },
  ): Move | null {
    const validMoves = options?.validMoves || this.findValidMoves()
    const candidateMoves = this.selectAutoplayMoveCandidatesWithLimit(validMoves, options?.candidateLimit)
    const clearMoves = candidateMoves.filter(move => this.getImmediateClearCount(move) > 0)
    if (clearMoves.length === 0) return null

    const scoredMoves: Array<{ move: Move; score: number }> = []
    for (const move of clearMoves) {
      scoredMoves.push({
        move,
        score: this.scoreMoveForAutoplay(move, goal),
      })
    }

    scoredMoves.sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      return this.compareMoveTieBreaker(left.move, right.move)
    })

    return scoredMoves[0]?.move || null
  }

  getAutoplaySwapCandidates(validMoves: Move[], limit?: number): Move[] {
    return this.selectAutoplayMoveCandidatesWithLimit(validMoves, limit)
  }

  getAutoplayShatterEvaluationGate(
    options?: { mergeSelection?: Cell[] | null },
  ): AutoplayShatterEvaluationGate {
    const mergeSelection = options?.mergeSelection || null
    const hasMergeCandidate = Array.isArray(mergeSelection) && mergeSelection.length > 1

    let commonCount = 0
    let tokenCount = 0
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (this.isCellBlocked(row, col)) continue
        const token = this.board[row]?.[col] || null
        if (!token) continue
        tokenCount += 1
        if (token.rarity === 'Common') {
          commonCount += 1
        }
      }
    }

    const commonRatio = tokenCount > 0 ? commonCount / tokenCount : 0
    if (commonRatio >= AUTOPLAY_SHATTER_COMMON_RATIO_THRESHOLD) {
      return {
        allow: true,
        reason: 'commons-threshold',
        commonRatio,
        commonCount,
        tokenCount,
        threshold: AUTOPLAY_SHATTER_COMMON_RATIO_THRESHOLD,
        hasMergeCandidate,
      }
    }

    if (!hasMergeCandidate) {
      return {
        allow: true,
        reason: 'no-merge-candidate',
        commonRatio,
        commonCount,
        tokenCount,
        threshold: AUTOPLAY_SHATTER_COMMON_RATIO_THRESHOLD,
        hasMergeCandidate,
      }
    }

    return {
      allow: false,
      reason: 'blocked-by-merge-priority',
      commonRatio,
      commonCount,
      tokenCount,
      threshold: AUTOPLAY_SHATTER_COMMON_RATIO_THRESHOLD,
      hasMergeCandidate,
    }
  }

  getAutoplaySwapExpansionSignal(
    validMoves: Move[],
    options?: { fastLimit?: number },
  ): { belowThreshold: boolean; topPriority: number; threshold: number; candidateCount: number } {
    const fastLimit = Math.max(1, Math.floor(Number(options?.fastLimit) || 1))
    const scoredFastCandidates = this.getScoredAutoplayMoveCandidates(validMoves)
      .slice(0, fastLimit)
    const topPriority = scoredFastCandidates[0]?.priority ?? Number.NEGATIVE_INFINITY
    const threshold = this.getAutoplaySwapExpansionThreshold()
    return {
      belowThreshold: topPriority < threshold,
      topPriority,
      threshold,
      candidateCount: scoredFastCandidates.length,
    }
  }

  private selectAutoplayMoveCandidates(validMoves: Move[]): Move[] {
    return this.selectAutoplayMoveCandidatesWithLimit(validMoves)
  }

  private selectAutoplayMoveCandidatesWithLimit(validMoves: Move[], limit?: number): Move[] {
    const requestedLimit = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 512
    const maxCandidates = Math.max(1, Math.min(512, requestedLimit))
    if (validMoves.length <= maxCandidates) {
      return validMoves
    }

    const scored = this.getScoredAutoplayMoveCandidates(validMoves)

    return scored
      .slice(0, maxCandidates)
      .map(entry => entry.move)
  }

  private getScoredAutoplayMoveCandidates(validMoves: Move[]): Array<{ move: Move; priority: number }> {
    if (validMoves.length <= 1) {
      return validMoves.map(move => ({
        move,
        priority: this.scoreAutoplayCandidatePriority(move),
      }))
    }

    const scored = validMoves.map(move => ({
      move,
      priority: this.scoreAutoplayCandidatePriority(move),
    }))

    scored.sort((left, right) => {
      if (left.priority !== right.priority) return right.priority - left.priority
      return this.compareMoveTieBreaker(left.move, right.move)
    })

    return scored
  }

  private getAutoplaySwapExpansionThreshold(): number {
    let threshold = 4200
    if (this.boss) {
      threshold += 1800
    }
    if (this.mines.length > 0) {
      threshold += Math.min(1500, this.mines.length * 450)
    }
    if (this.getMovesUntilBossSpawn() <= 3) {
      threshold += 900
    }
    return threshold
  }

  private scoreAutoplayCandidatePriority(move: Move): number {
    const objective = this.getObjectiveProgress()
    const preferredType = this.getPreferredObjectiveType(objective)
    const fromToken = this.board[move.from.row]?.[move.from.col] || null
    const toToken = this.board[move.to.row]?.[move.to.col] || null

    const touchedTokens = [fromToken, toToken].filter((token): token is ModuleToken => !!token)
    const anchorRarityScore = touchedTokens.reduce((sum, token) => {
      const uniqueBonus = isUniqueToken(token) ? 140 : 0
      return sum + (preservationWeight(token) * 92) + uniqueBonus
    }, 0)
    const anchorPreferredTypeScore = touchedTokens
      .filter(token => token.type === preferredType)
      .length * 170

    const preview = cloneBoard(this.board)
    swap(preview, move)
    const matches = this.findShatterCellsOnBoard(preview)
    const localMergeOpportunityBefore = this.scoreLocalMergeOpportunity(this.board, move.from, preferredType)
      + this.scoreLocalMergeOpportunity(this.board, move.to, preferredType)
    const localMergeOpportunityAfter = this.scoreLocalMergeOpportunity(preview, move.from, preferredType)
      + this.scoreLocalMergeOpportunity(preview, move.to, preferredType)
    const localMergeOpportunityDelta = localMergeOpportunityAfter - localMergeOpportunityBefore
    const immediateClearBonus = matches.length > 0 ? 640 : 0

    let matchRarityScore = 0
    let objectiveTouchScore = 0
    let bossDamageScore = 0
    for (const cell of matches) {
      const token = preview[cell.row]?.[cell.col] || null
      if (!token) continue
      matchRarityScore += rarityWeight(token) * 88
      if (token.type === preferredType) objectiveTouchScore += 75
      if (this.boss) {
        bossDamageScore += this.getBossDamageForToken(token) * 150
      }
    }

    const commonOnlyPenalty = matches.length > 0 && matches.every(cell => {
      const token = preview[cell.row]?.[cell.col] || null
      return !!token && token.rarity === 'Common'
    })
      ? 220
      : 0
    const progresslessCommonClearPenalty = matches.length > 0
      && commonOnlyPenalty > 0
      && localMergeOpportunityDelta <= 0
      && objectiveTouchScore <= 0
      ? 980
      : 0

    const mineAdjacencyPenalty = this.estimateMineAdjacencyPenalty(move) * 22
    const oscillationPenalty = this.getAutoplayOscillationPenalty(move) * 0.35
    const bottomRowSafetyScore = this.estimateBottomRowSafetyDelta(move)

    return anchorRarityScore
      + anchorPreferredTypeScore
      + immediateClearBonus
      + (localMergeOpportunityDelta * 4.2)
      + matchRarityScore
      + objectiveTouchScore
      + bossDamageScore
      + bottomRowSafetyScore
      - commonOnlyPenalty
      - progresslessCommonClearPenalty
      - mineAdjacencyPenalty
      - oscillationPenalty
  }

  private chooseAntiOscillationAlternative(
    scoredMoves: Array<{ move: Move; score: number; oscillationPenalty: number; hasImmediateClear: boolean }>,
  ): Move | null {
    if (!this.lastAppliedMove || scoredMoves.length < 2) return null

    const reverseOfLastKey = this.getDirectedMoveKey(this.getReversedMove(this.lastAppliedMove))
    const top = scoredMoves[0]
    const topKey = this.getDirectedMoveKey(top.move)
    if (topKey !== reverseOfLastKey) return null

    const topPenalty = top.oscillationPenalty
    if (topPenalty < 2400) return null

    for (let index = 1; index < scoredMoves.length; index += 1) {
      const candidate = scoredMoves[index]
      if (!Number.isFinite(candidate.score)) continue

      if (top.hasImmediateClear && !candidate.hasImmediateClear) {
        continue
      }

      if (candidate.score < (top.score - 900)) {
        continue
      }

      const candidateKey = this.getDirectedMoveKey(candidate.move)
      if (candidateKey === reverseOfLastKey) continue

      if (candidate.oscillationPenalty < topPenalty) {
        return candidate.move
      }
    }

    return null
  }

  chooseAutoplayMergeSelection(goal: AutoplayGoal = 'objective-progress'): Cell[] | null {
    const objective = this.getObjectiveProgress()
    const preferredType = this.getPreferredObjectiveType(objective)
    const fodderTargets = this.getFodderTargetsByType()
    const scoredSelections: Array<{ selection: Cell[]; score: number; uniqueProgress: boolean; fodderProgress: boolean }> = []

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (this.isCellBlocked(row, col)) continue
        const baseToken = this.board[row][col]
        if (!baseToken || baseToken.rarity === 'Common') continue

        const requiredTotal = this.requiredTotalForBaseToken(baseToken)
        if (!Number.isFinite(requiredTotal) || requiredTotal < 2) continue

        const fodderCount = requiredTotal - 1
        const candidates = this.getMergeCandidates({ row, col })
        const inventoryFodders = this.getInventoryFodderEntries(baseToken, fodderCount)
        if (candidates.length + inventoryFodders.length < fodderCount) continue

        const sortedCandidates = [...candidates].sort((left, right) => {
          const leftToken = this.board[left.row]?.[left.col] || null
          const rightToken = this.board[right.row]?.[right.col] || null
          const leftWeight = leftToken ? this.scoreFodderForBase(baseToken, leftToken, preferredType) : Number.NEGATIVE_INFINITY
          const rightWeight = rightToken ? this.scoreFodderForBase(baseToken, rightToken, preferredType) : Number.NEGATIVE_INFINITY
          if (leftWeight !== rightWeight) return rightWeight - leftWeight
          if (left.row !== right.row) return left.row - right.row
          return left.col - right.col
        })

        const selectedBoardCells = sortedCandidates.slice(0, Math.min(fodderCount, sortedCandidates.length))
        const selection: Cell[] = [{ row, col }, ...selectedBoardCells]
        const selectedFodders = selection
          .slice(1)
          .map(cell => this.board[cell.row]?.[cell.col] || null)
          .filter((token): token is ModuleToken => !!token)

        const remainingFodders = fodderCount - selectedFodders.length
        if (remainingFodders < 0) continue
        const selectedInventoryFodders = inventoryFodders.slice(0, remainingFodders).map(entry => entry.token)
        const allFodders = [...selectedFodders, ...selectedInventoryFodders]
        if (allFodders.length !== fodderCount) continue

        const outcome = this.predictMergeOutcome(baseToken, allFodders)
        if (!outcome) continue

        if (goal === 'objective-progress') {
          const baseIsUnique = isUniqueToken(baseToken)
          const outcomeAboveEpicPlus = outcome.rarity === 'Legendary' || outcome.rarity === 'Mythic' || outcome.rarity === 'Ancestral'
          if (!baseIsUnique && outcomeAboveEpicPlus) {
            continue
          }

          if (!baseIsUnique && allFodders.some(token => isUniqueToken(token))) {
            continue
          }
        }

        const uniqueProgress = this.isUniqueProgressMerge(baseToken, outcome)
        const fodderProgress = this.isFodderProgressMerge(baseToken, outcome)
        const score = this.scoreMergeSelectionForAutoplay(baseToken, outcome, objective, preferredType, fodderTargets, goal)
        scoredSelections.push({ selection, score, uniqueProgress, fodderProgress })
      }
    }

    if (scoredSelections.length === 0) {
      return null
    }

    const uniqueProgressSelections = scoredSelections.filter(item => item.uniqueProgress)
    const candidatePool = uniqueProgressSelections.length > 0
      ? uniqueProgressSelections
      : scoredSelections

    candidatePool.sort((left, right) => {
      if (left.uniqueProgress !== right.uniqueProgress) return left.uniqueProgress ? -1 : 1
      if (left.fodderProgress !== right.fodderProgress) return left.fodderProgress ? -1 : 1
      return right.score - left.score
    })
    const bestSelection = candidatePool[0]?.selection || null

    return bestSelection
  }

  private isFodderProgressMerge(base: ModuleToken, outcome: MergeOutcome): boolean {
    if (base.rarity === 'Rare') return true
    if (base.rarity === 'Epic' && !base.plus) return true
    if (outcome.rarity === 'Epic' && outcome.plus) return true
    if (outcome.rarity === 'Legendary' && outcome.plus) return true
    if (outcome.rarity === 'Mythic' && !outcome.plus) return true
    return false
  }

  private isUniqueProgressMerge(base: ModuleToken, outcome: MergeOutcome): boolean {
    if (!isUniqueToken(base)) return false
    if (base.rarity !== outcome.rarity) return true
    if (!!base.plus !== !!outcome.plus) return true
    if (base.rarity === 'Ancestral') {
      const baseStars = Math.max(1, Math.min(5, Math.floor(Number(base.stars || 1))))
      const nextStars = Math.max(1, Math.min(5, Math.floor(Number(outcome.stars || 1))))
      return nextStars > baseStars
    }
    return false
  }

  private getFodderTargetsByType(): FodderTargetsByType {
    const boardTokens: ModuleToken[] = []
    for (const row of this.board) {
      for (const token of row) {
        if (token) boardTokens.push(token)
      }
    }

    const inventoryTokens: ModuleToken[] = []
    if (this.inventory.Cannon) inventoryTokens.push(this.inventory.Cannon)
    if (this.inventory.Armor) inventoryTokens.push(this.inventory.Armor)
    if (this.inventory.Generator) inventoryTokens.push(this.inventory.Generator)
    if (this.inventory.Core) inventoryTokens.push(this.inventory.Core)

    return buildMergeFodderTargetsByType({
      boardTokens,
      inventoryTokens,
      isUniqueToken,
    })
  }

  private getPreferredObjectiveType(objective: ObjectiveProgress): ModuleType {
    const ordered: ModuleType[] = ['Cannon', 'Armor', 'Generator', 'Core']
    let selected: ModuleType = ordered[0]
    let lowest = Number.POSITIVE_INFINITY
    for (const type of ordered) {
      const stars = objective.highestStarsByType[type]
      if (stars < lowest) {
        lowest = stars
        selected = type
      }
    }
    return selected
  }

  private estimateStepsToAncestral(base: ModuleToken): number {
    const unique = isUniqueToken(base)
    if (base.rarity === 'Ancestral') return 0
    if (!unique && base.rarity === 'Legendary' && base.plus) return 99
    if (!unique && base.rarity === 'Mythic') return 99

    const key = `${base.rarity}${base.plus ? '+' : ''}`
    switch (key) {
      case 'Rare':
        return 7
      case 'Rare+':
        return 6
      case 'Epic':
        return 5
      case 'Epic+':
        return 4
      case 'Legendary':
        return 3
      case 'Legendary+':
        return unique ? 2 : 99
      case 'Mythic':
        return unique ? 1 : 99
      case 'Mythic+':
        return unique ? 1 : 99
      default:
        return 99
    }
  }

  private scoreFodderForBase(base: ModuleToken, candidate: ModuleToken, preferredType: ModuleType): number {
    let score = rarityWeight(candidate) * 10
    const sameTemplate = candidate.templateId === base.templateId

    if (base.rarity === 'Rare' || (base.rarity === 'Epic' && !base.plus) || (base.rarity === 'Legendary' && !base.plus) || base.rarity === 'Ancestral') {
      score += sameTemplate ? 500 : -400
    }

    if ((base.rarity === 'Epic' && base.plus) || (base.rarity === 'Legendary' && base.plus) || (base.rarity === 'Mythic' && !base.plus) || (base.rarity === 'Mythic' && base.plus)) {
      if (!isUniqueToken(base) && isUniqueToken(candidate)) score -= 350
    }

    if (base.rarity === 'Legendary' && base.plus && candidate.rarity === 'Legendary' && candidate.plus) {
      score += 300
    }

    if (base.rarity === 'Mythic' && !base.plus && candidate.rarity === 'Legendary' && candidate.plus) {
      score += 260
    }

    if (base.rarity === 'Mythic' && base.plus && candidate.rarity === 'Epic' && candidate.plus) {
      score += 280
    }

    if (candidate.type === preferredType) score += 80
    return score
  }

  chooseAutoplayInventoryAction(goal: AutoplayGoal = 'objective-progress'): { cell: Cell; slotType: ModuleType } | null {
    if (this.boss) return null

    const movesUntilBossSpawn = this.getMovesUntilBossSpawn()
    const bossSpawnSoon = movesUntilBossSpawn <= 3
    const goalMultiplier = goal === 'boss-damage'
      ? 1.25
      : goal === 'objective-progress'
        ? 1.1
        : 1
    const phase: ModuleStrategyPhase = bossSpawnSoon ? 'pre-boss' : 'board'

    let bestAction: { cell: Cell; slotType: ModuleType } | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    const hasEmptyInventorySlot = this.inventory.Cannon === null
      || this.inventory.Armor === null
      || this.inventory.Generator === null
      || this.inventory.Core === null
    let bestEmptySlotAction: { cell: Cell; slotType: ModuleType } | null = null
    let bestEmptySlotScore = Number.NEGATIVE_INFINITY

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (this.isCellBlocked(row, col)) continue
        const token = this.board[row]?.[col] || null
        if (!token || !isUniqueToken(token)) continue

        const slotType = token.type
        const slotToken = this.inventory[slotType]
        const tokenWeight = this.getTokenStrategicWeight(token)
        const slotWeight = slotToken ? this.getTokenStrategicWeight(slotToken) : 0
        const tokenEffectBonus = this.getUniqueEffectStrategicBonus(token)
        const slotEffectBonus = slotToken ? this.getUniqueEffectStrategicBonus(slotToken) : 0
        const rarityDelta = slotToken ? (rarityWeight(token) - rarityWeight(slotToken)) : 0
        const effectDelta = tokenEffectBonus - slotEffectBonus
        const threatened = this.isCellThreatenedByMineOrBoss(row, col)
        const anticipatedThreat = bossSpawnSoon && row <= 2
        const reversePingPong = this.isReverseInventoryExchange({ row, col }, slotType, token, slotToken)
        const repeatedTouch = this.lastInventoryTouch
          && this.lastInventoryTouch.slotType === slotType
          && this.lastInventoryTouch.cell.row === row
          && this.lastInventoryTouch.cell.col === col
          ? this.lastInventoryTouch.repeats
          : 0

        const upgradeValue = tokenWeight - slotWeight
        const slotIsEmpty = !slotToken
        if (hasEmptyInventorySlot && slotIsEmpty) {
          const emptySlotScore =
            (tokenWeight * 150 * goalMultiplier)
            + (threatened ? 2600 : 0)
            + (anticipatedThreat ? 1200 : 0)
            + (bossSpawnSoon ? (tokenWeight * 95) : 0)
            - (repeatedTouch * 1200)
            - (reversePingPong ? 2200 : 0)

          if (emptySlotScore > bestEmptySlotScore) {
            bestEmptySlotScore = emptySlotScore
            bestEmptySlotAction = {
              cell: { row, col },
              slotType,
            }
          }

          continue
        }

        if (!threatened && !anticipatedThreat && slotToken && upgradeValue <= 0) {
          continue
        }
        if (!threatened && !anticipatedThreat && reversePingPong) {
          continue
        }
        if (!threatened && !anticipatedThreat && repeatedTouch >= 2) {
          continue
        }
        if (!threatened && !anticipatedThreat && this.consecutiveInventoryActions >= 2 && upgradeValue < 3) {
          continue
        }
        if (!threatened && !anticipatedThreat && this.consecutiveInventoryActions >= 3) {
          continue
        }
        if (!threatened && !anticipatedThreat && slotIsEmpty && tokenWeight < 18) {
          continue
        }
        const meaningfulUpgrade = upgradeValue >= 10 || rarityDelta >= 2 || effectDelta >= 8
        if (!threatened && !anticipatedThreat && !slotIsEmpty && !meaningfulUpgrade) {
          continue
        }
        if (!threatened && !anticipatedThreat && repeatedTouch >= 1 && upgradeValue < 14) {
          continue
        }
        if (!threatened && !anticipatedThreat && this.consecutiveInventoryActions >= 2 && upgradeValue < 14) {
          continue
        }

        const score =
          (upgradeValue * 120 * goalMultiplier)
          + (threatened ? 1400 : 0)
          + (anticipatedThreat
            ? (
              AUTOPLAY_HAZARD_TUNING.inventory.anticipatedThreatBase
              + (tokenWeight * AUTOPLAY_HAZARD_TUNING.inventory.anticipatedThreatTokenWeight)
            )
            : 0)
          + (bossSpawnSoon ? (tokenWeight * AUTOPLAY_HAZARD_TUNING.inventory.bossSpawnSoonTokenWeight) : 0)
          - (this.consecutiveInventoryActions * 480)
          - (repeatedTouch * 900)
          - (reversePingPong ? 1800 : 0)
          + scoreInventorySwapForModuleStrategy({
            goal,
            phase,
            upgradeValue,
            rarityDelta,
            effectDelta,
            tokenEffectBonus,
            slotEffectBonus,
            threatened,
            anticipatedThreat,
            repeatedTouch,
            reversePingPong,
          })

        if (score > bestScore) {
          bestScore = score
          bestAction = {
            cell: { row, col },
            slotType,
          }
        }
      }
    }

    if (bestEmptySlotAction) {
      return bestEmptySlotAction
    }

    return bestAction
  }

  chooseAutoplayShardBoostAction(goal: AutoplayGoal = 'objective-progress'): ModuleType | null {
    const objective = this.getObjectiveProgress()
    const fodderTargets = this.getFodderTargetsByType()
    const movesUntilBossSpawn = this.getMovesUntilBossSpawn()
    const pfScale = this.getActiveUniqueScalar('PF')
    const totalShards = this.shardsByType.Cannon + this.shardsByType.Armor + this.shardsByType.Generator + this.shardsByType.Core

    const candidates: Array<{
      type: ModuleType
      availableShards: number
      nextCost: number
      level: number
      objectiveNeed: number
      fodderNeed: number
    }> = []

    for (const type of ['Cannon', 'Armor', 'Generator', 'Core'] as const) {
      const availableShards = this.shardsByType[type] || 0
      const nextCost = this.getShardBoostNextCost(type)
      const level = this.shardBoostLevels[type] || 0
      const objectiveNeed = Math.max(0, OBJECTIVE_TARGET_STARS - objective.highestStarsByType[type])
      const fodderNeed = fodderTargets[type].epicPlusDeficit + fodderTargets[type].legendaryPlusDeficit + (fodderTargets[type].templateEpicPlusDeficit * 2)

      candidates.push({
        type,
        availableShards,
        nextCost,
        level,
        objectiveNeed,
        fodderNeed,
      })
    }

    return recommendShardBoostType({
      goal,
      candidates,
      pfScale,
      totalShards,
      movesUntilBossSpawn,
    })
  }

  getAutoplayBossShatterPlanCandidates(limit = 8): Cell[][] {
    if (!this.boss) return []

    const candidates: Array<{ selection: Cell[]; score: number }> = []
    const availableTypes = this.getBossComboAvailableTypes()

    for (const type of availableTypes) {
      const selectableCells = this.getBossComboSelectableCells(type)
        .filter(cell => !this.getBossAdjacentModuleEntries().some(entry => entry.cell.row === cell.row && entry.cell.col === cell.col))
        .map(cell => ({
          cell,
          token: this.board[cell.row]?.[cell.col] || null,
        }))
        .filter((entry): entry is { cell: Cell; token: ModuleToken } => !!entry.token)
        .sort((left, right) => {
          const damageDelta = getComboDamageForToken(right.token) - getComboDamageForToken(left.token)
          if (damageDelta !== 0) return damageDelta
          return rarityWeight(left.token) - rarityWeight(right.token)
        })

      const pool = selectableCells.slice(0, Math.min(6, selectableCells.length)).map(entry => entry.cell)
      const comboSizes = [0, 1, 2, 3, 4]
      for (const comboSize of comboSizes) {
        const selections = comboSize === 0 ? [[]] : this.buildCellCombinations(pool, comboSize)
        for (const selection of selections) {
          const preview = this.previewBossShatterSelection(selection)
          if (!preview.valid) continue
          candidates.push({
            selection,
            score: preview.damage - (selection.length * 8),
          })
        }
      }
    }

    candidates.sort((left, right) => right.score - left.score)

    const dedupe = new Set<string>()
    const output: Cell[][] = []
    for (const candidate of candidates) {
      const key = candidate.selection
        .map(cell => `${cell.row}:${cell.col}`)
        .sort()
        .join('|')
      if (dedupe.has(key)) continue
      dedupe.add(key)
      output.push(candidate.selection)
      if (output.length >= Math.max(1, Math.floor(limit))) break
    }

    return output
  }

  getAutoplayMineShatterPlanCandidates(limit = 8): Array<{ mine: Cell; selection: Cell[] }> {
    if (!this.mines.length) return []

    const plans: Array<{ mine: Cell; selection: Cell[]; score: number }> = []

    for (const mine of this.mines) {
      const preview = this.previewMineExplosion({ row: mine.row, col: mine.col })
      if (!preview.valid) continue
      const bossProximity = this.boss && Math.abs(this.boss.row - mine.row) <= preview.blastRadius && Math.abs(this.boss.col - mine.col) <= preview.blastRadius
        ? preview.damage
        : 0
      plans.push({
        mine: { row: mine.row, col: mine.col },
        selection: [],
        score: (preview.damage * 2.4) + (preview.removed * 12) + bossProximity,
      })
    }

    plans.sort((left, right) => right.score - left.score)
    const dedupe = new Set<string>()
    const output: Array<{ mine: Cell; selection: Cell[] }> = []
    for (const plan of plans) {
      const key = `${plan.mine.row}:${plan.mine.col}:${plan.selection.map(cell => `${cell.row}:${cell.col}`).sort().join('|')}`
      if (dedupe.has(key)) continue
      dedupe.add(key)
      output.push({ mine: plan.mine, selection: plan.selection })
      if (output.length >= Math.max(1, Math.floor(limit))) break
    }

    return output
  }

  private buildCellCombinations(cells: Cell[], size: number): Cell[][] {
    const normalizedSize = Math.max(1, Math.floor(Number(size) || 1))
    if (cells.length < normalizedSize) return []

    const output: Cell[][] = []
    const visit = (start: number, current: Cell[]) => {
      if (current.length === normalizedSize) {
        output.push(current.map(cell => ({ row: cell.row, col: cell.col })))
        return
      }
      for (let index = start; index < cells.length; index += 1) {
        current.push(cells[index])
        visit(index + 1, current)
        current.pop()
      }
    }

    visit(0, [])
    return output
  }

  private estimateMineBlastBenefit(mine: Cell, blastRadius: number): number {
    let score = 0
    for (let row = Math.max(0, mine.row - blastRadius); row <= Math.min(BOARD_ROWS - 1, mine.row + blastRadius); row += 1) {
      for (let col = Math.max(0, mine.col - blastRadius); col <= Math.min(BOARD_COLS - 1, mine.col + blastRadius); col += 1) {
        const token = this.board[row]?.[col]
        if (!token) continue
        const value = (rarityWeight(token) * 24) + (isUniqueToken(token) ? 40 : 0)
        score += value
      }
    }

    if (this.boss) {
      const bossInBlast =
        Math.abs(this.boss.row - mine.row) <= blastRadius
        && Math.abs(this.boss.col - mine.col) <= blastRadius
      if (bossInBlast) {
        score += 220
      }
    }

    return score
  }

  private getInventoryTokenSignature(token: ModuleToken | null): string | null {
    if (!token) return null
    const stars = token.rarity === 'Ancestral'
      ? Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
      : 0
    return `${String(token.templateId)}:${token.type}:${token.rarity}:${token.plus ? '1' : '0'}:${stars}`
  }

  private isReverseInventoryExchange(cell: Cell, slotType: ModuleType, boardToken: ModuleToken, slotToken: ModuleToken | null): boolean {
    if (!this.lastInventoryExchange) return false
    const last = this.lastInventoryExchange
    if (last.slotType !== slotType) return false
    if (last.cell.row !== cell.row || last.cell.col !== cell.col) return false

    const currentBoardSignature = this.getInventoryTokenSignature(boardToken)
    const currentSlotSignature = this.getInventoryTokenSignature(slotToken)
    return currentBoardSignature === last.slotTokenSignature && currentSlotSignature === last.boardTokenSignature
  }

  private registerInventoryExchange(cell: Cell, slotType: ModuleType, boardToken: ModuleToken, slotToken: ModuleToken | null): void {
    this.lastInventoryExchange = {
      slotType,
      cell: { row: cell.row, col: cell.col },
      boardTokenSignature: this.getInventoryTokenSignature(boardToken) || '',
      slotTokenSignature: this.getInventoryTokenSignature(slotToken),
    }

    if (
      this.lastInventoryTouch
      && this.lastInventoryTouch.slotType === slotType
      && this.lastInventoryTouch.cell.row === cell.row
      && this.lastInventoryTouch.cell.col === cell.col
    ) {
      this.lastInventoryTouch = {
        slotType,
        cell: { row: cell.row, col: cell.col },
        repeats: this.lastInventoryTouch.repeats + 1,
      }
    } else {
      this.lastInventoryTouch = {
        slotType,
        cell: { row: cell.row, col: cell.col },
        repeats: 1,
      }
    }

    this.consecutiveInventoryActions += 1
  }

  private registerNonInventoryAction(): void {
    this.consecutiveInventoryActions = 0
    this.lastInventoryTouch = null
  }

  private getUniqueKey(token: ModuleToken): string {
    return `${String(token.templateId)}:${String(token.type)}`
  }

  private hasPermanentUniqueEffect(effectId: UniqueEffectId): boolean {
    return this.permanentUniqueEffects.some(effect => effect.effectId === effectId)
  }

  private registerPermanentUniqueEffect(token: ModuleToken): boolean {
    const effectId = getUniqueEffectId(token)
    if (!effectId) return false

    const uniqueKey = this.getUniqueKey(token)
    if (this.permanentUniqueEffects.some(effect => effect.uniqueKey === uniqueKey)) {
      return false
    }

    this.permanentUniqueEffects.push({ uniqueKey, effectId })
    this.permanentUniqueEffects.sort((left, right) => left.uniqueKey.localeCompare(right.uniqueKey))
    return true
  }

  private promoteSavedFiveStarUniques(): void {
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const token = this.board[row][col]
        if (!token || token.rarity !== 'Ancestral' || Math.floor(Number(token.stars || 1)) < 5) continue
        if (this.registerPermanentUniqueEffect(token)) {
          this.board[row][col] = null
        }
      }
    }

    for (const slotType of ['Cannon', 'Armor', 'Generator', 'Core'] as const) {
      const token = this.inventory[slotType]
      if (!token || token.rarity !== 'Ancestral' || Math.floor(Number(token.stars || 1)) < 5) continue
      if (this.registerPermanentUniqueEffect(token)) {
        this.inventory[slotType] = null
      }
    }
  }

  private getInventoryUniqueToken(effectId: UniqueEffectId): ModuleToken | null {
    const slots: ModuleType[] = ['Cannon', 'Armor', 'Generator', 'Core']
    for (const slot of slots) {
      const token = this.inventory[slot]
      if (!token) continue
      if (getUniqueEffectId(token) === effectId) {
        return token
      }
    }
    return null
  }

  private getActiveUniqueScalar(effectId: UniqueEffectId): number {
    if (this.hasPermanentUniqueEffect(effectId)) {
      return bemergedUniqueEffectTuning.effects[effectId].Ancestral
    }

    const token = this.getInventoryUniqueToken(effectId)
    if (!token) return 0
    return getScaleValueForToken(token, bemergedUniqueEffectTuning.effects[effectId])
  }

  private getActiveUniqueEffectCount(): number {
    const active = new Set<UniqueEffectId>()
    for (const effect of this.permanentUniqueEffects) {
      active.add(effect.effectId)
    }

    const slots: ModuleType[] = ['Cannon', 'Armor', 'Generator', 'Core']
    for (const slot of slots) {
      const effectId = getUniqueEffectId(this.inventory[slot])
      if (effectId) {
        active.add(effectId)
      }
    }
    return active.size
  }

  private getUniqueEffectStrategicBonus(token: ModuleToken): number {
    const effectId = getUniqueEffectId(token)
    if (!effectId) return 0
    const scalar = getScaleValueForToken(token, bemergedUniqueEffectTuning.effects[effectId])
    if (scalar <= 0) return 0

    const rarityFactor = rarityWeight(token)
    switch (effectId) {
      case 'AD':
      case 'DP':
      case 'BA':
      case 'HB':
      case 'SR_CANNON':
      case 'AS':
      case 'SF':
      case 'OC':
      case 'DC':
      case 'PC_CORE':
        return (scalar * 18) + (rarityFactor * 3)
      case 'SD':
      case 'NMP':
      case 'WR':
      case 'HC':
      case 'MVN':
      case 'MH':
        return (scalar * 14) + (rarityFactor * 2)
      case 'BHD':
      case 'SH':
      case 'PH':
      case 'GC':
      case 'PF':
      case 'RB_GENERATOR':
        return (scalar * 12) + (rarityFactor * 2)
      case 'ACP':
      case 'OA':
      default:
        return (scalar * 10) + rarityFactor
    }
  }

  private getTokenStrategicWeight(token: ModuleToken): number {
    const rarityScore = rarityWeight(token)
    const stars = token.rarity === 'Ancestral'
      ? Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
      : 0
    return rarityScore + (stars * 2) + this.getUniqueEffectStrategicBonus(token)
  }

  private recordHazardImpact(token: ModuleToken, nextToken: ModuleToken | null, source: 'mine' | 'boss'): void {
    const beforeStage = getObjectiveStageValue(token)
    const afterStage = nextToken ? getObjectiveStageValue(nextToken) : 0
    const lostStageScore = Math.max(0, beforeStage - afterStage)
    if (lostStageScore <= 0 && nextToken) {
      return
    }

    const multiplier = source === 'boss'
      ? AUTOPLAY_HAZARD_TUNING.hazardLoss.bossMultiplier
      : AUTOPLAY_HAZARD_TUNING.hazardLoss.mineMultiplier
    const severityRatio = nextToken
      ? Math.max(0.35, lostStageScore / Math.max(1, beforeStage))
      : 1
    const penalty = preservationWeight(token) * multiplier * severityRatio
    const highRarity = isHighRarityToken(token)

    this.pendingHazardLossScore += penalty
    this.pendingHazardTelemetry.lostStageScore += lostStageScore
    this.pendingHazardTelemetry.preservationPenaltyScore += penalty

    if (nextToken) {
      this.pendingHazardTelemetry.decayedCount += 1
      if (source === 'boss') {
        this.pendingHazardTelemetry.bossDecayedCount += 1
      } else {
        this.pendingHazardTelemetry.mineDecayedCount += 1
      }
      if (highRarity) {
        this.pendingHazardTelemetry.highRarityDecayedCount += 1
      }
      return
    }

    this.pendingHazardTelemetry.destroyedCount += 1
    if (source === 'boss') {
      this.pendingHazardTelemetry.bossDestroyedCount += 1
    } else {
      this.pendingHazardTelemetry.mineDestroyedCount += 1
    }
    if (highRarity) {
      this.pendingHazardTelemetry.highRarityDestroyedCount += 1
    }
  }

  private recordHazardLoss(token: ModuleToken, source: 'mine' | 'boss'): void {
    this.recordHazardImpact(token, null, source)
  }

  consumeAndResetHazardLossScore(): number {
    const score = this.pendingHazardLossScore
    this.pendingHazardLossScore = 0
    this.pendingHazardTelemetry = createEmptyHazardTelemetry()
    return score
  }

  consumeAndResetHazardTelemetry(): HazardTelemetry {
    const payload = { ...this.pendingHazardTelemetry }
    this.pendingHazardTelemetry = createEmptyHazardTelemetry()
    this.pendingHazardLossScore = 0
    return payload
  }

  private countBossThreatProfile(): { valuableThreatenedCount: number; sacrificialCommonThreatCount: number } {
    if (!this.boss) {
      return {
        valuableThreatenedCount: 0,
        sacrificialCommonThreatCount: 0,
      }
    }

    let valuableThreatenedCount = 0
    let sacrificialCommonThreatCount = 0
    for (const cell of this.getCellsAround(this.boss.row, this.boss.col, 1)) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) continue
      if (token.rarity === 'Common') {
        sacrificialCommonThreatCount += 1
        continue
      }
      if (isHighRarityToken(token) || isUniqueToken(token)) {
        valuableThreatenedCount += 1
      }
    }

    return {
      valuableThreatenedCount,
      sacrificialCommonThreatCount,
    }
  }

  private buildInventorySlotTelemetry(slot: ModuleType, token: ModuleToken | null): InventorySlotTelemetry | null {
    if (!token) return null
    const effectId = getUniqueEffectId(token)
    return {
      slot,
      templateId: String(token.templateId),
      type: token.type,
      rarity: token.rarity,
      plus: !!token.plus,
      stars: token.rarity === 'Ancestral'
        ? Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
        : 0,
      effectId,
      effectScalar: effectId ? this.getActiveUniqueScalar(effectId) : 0,
      strategicWeight: this.getTokenStrategicWeight(token),
    }
  }

  getStrategyTelemetry(goal: AutoplayGoal = 'objective-progress'): StrategyTelemetry {
    const fodderTargets = this.getFodderTargetsByType()
    const inventory: Record<ModuleType, InventorySlotTelemetry | null> = {
      Cannon: this.buildInventorySlotTelemetry('Cannon', this.inventory.Cannon),
      Armor: this.buildInventorySlotTelemetry('Armor', this.inventory.Armor),
      Generator: this.buildInventorySlotTelemetry('Generator', this.inventory.Generator),
      Core: this.buildInventorySlotTelemetry('Core', this.inventory.Core),
    }
    const activeEffects = (Object.values(inventory).filter((item): item is InventorySlotTelemetry => !!item && !!item.effectId)).map(item => ({
      slot: item.slot,
      effectId: String(item.effectId),
      scalar: item.effectScalar,
      rarity: item.rarity,
      stars: item.stars,
    }))
    const totalShards = this.shardsByType.Cannon + this.shardsByType.Armor + this.shardsByType.Generator + this.shardsByType.Core
    const threatProfile = this.countBossThreatProfile()
    return {
      inventory,
      activeEffects,
      uniqueEffectCount: this.getActiveUniqueEffectCount(),
      movesUntilBossSpawn: this.getMovesUntilBossSpawn(),
      bossThreatActive: this.getBossThreatActive(),
      mergeReadinessScore: this.estimateMergeReadiness(this.board),
      hazardExposureScore: this.estimateHazardExposureScore(this.board),
      bossSpawnPreparationScore: this.estimateBossSpawnPreparationScore(this.board),
      inventoryStrategicScore: Object.values(inventory).reduce((sum, item) => sum + (item?.strategicWeight || 0), 0),
      totalFodderDeficit:
        fodderTargets.Cannon.epicPlusDeficit
        + fodderTargets.Cannon.legendaryPlusDeficit
        + fodderTargets.Armor.epicPlusDeficit
        + fodderTargets.Armor.legendaryPlusDeficit
        + fodderTargets.Generator.epicPlusDeficit
        + fodderTargets.Generator.legendaryPlusDeficit
        + fodderTargets.Core.epicPlusDeficit
        + fodderTargets.Core.legendaryPlusDeficit,
      fodderTargets,
      valuableThreatenedCount: threatProfile.valuableThreatenedCount,
      sacrificialCommonThreatCount: threatProfile.sacrificialCommonThreatCount,
      shardBoostLevels: {
        Cannon: this.shardBoostLevels.Cannon,
        Armor: this.shardBoostLevels.Armor,
        Generator: this.shardBoostLevels.Generator,
        Core: this.shardBoostLevels.Core,
      },
      shardBoostNextCost: {
        Cannon: this.getShardBoostNextCost('Cannon'),
        Armor: this.getShardBoostNextCost('Armor'),
        Generator: this.getShardBoostNextCost('Generator'),
        Core: this.getShardBoostNextCost('Core'),
      },
      canAffordShardBoost: {
        Cannon: this.canAffordShardBoost('Cannon'),
        Armor: this.canAffordShardBoost('Armor'),
        Generator: this.canAffordShardBoost('Generator'),
        Core: this.canAffordShardBoost('Core'),
      },
      totalShards,
      pfScalar: this.getActiveUniqueScalar('PF'),
      recommendedShardBoostType: this.chooseAutoplayShardBoostAction(goal),
    }
  }

  private getBossMoveThresholdWithEffects(): number {
    const bonus = this.getActiveUniqueScalar('NMP')
    return bemergedParityTuning.boss.decayGraceMoves + Math.max(0, Math.floor(bonus))
  }

  private clearBoss(): void {
    this.boss = null
    this.bossMaxHits = 0
    this.bossComboCount = 0
    this.bossAliveMoveCount = 0
    this.bossMoveCount = 0
  }

  private attachBossRuntimeState(): void {
    if (!this.boss) return
    const threatActive = this.getBossThreatActive()
    this.boss.maxHits = this.bossMaxHits
    this.boss.comboCount = this.bossComboCount
    this.boss.destructiveActive = threatActive
    this.boss.currentPhase = threatActive ? 2 : 1
    this.boss.phaseMoveCount = this.bossMoveCount
    this.boss.totalDestructiveMoves = this.bossMoveCount
    this.boss.burstCounter = this.getBossBurstCountdown()
  }

  private applyBossDamage(amount: number): void {
    if (!this.boss || amount <= 0) return
    this.boss.hitsRemaining = Math.max(0, this.boss.hitsRemaining - amount)
    if (this.boss.hitsRemaining <= 0) {
      this.bossesKilled += 1
      this.clearBoss()
      return
    }
    this.attachBossRuntimeState()
  }

  private getBossBurstCountdown(): number {
    if (!this.boss) return 0
    const everyMoves = Math.max(1, Math.floor(Number(bemergedParityTuning.boss.burstEveryMoves) || 1))
    const remainder = this.bossMoveCount % everyMoves
    return remainder === 0 ? everyMoves : everyMoves - remainder
  }

  private getCellsAround(row: number, col: number, radius = 1): Cell[] {
    const cells: Cell[] = []
    for (let nextRow = Math.max(0, row - radius); nextRow <= Math.min(BOARD_ROWS - 1, row + radius); nextRow += 1) {
      for (let nextCol = Math.max(0, col - radius); nextCol <= Math.min(BOARD_COLS - 1, col + radius); nextCol += 1) {
        if (nextRow === row && nextCol === col) continue
        cells.push({ row: nextRow, col: nextCol })
      }
    }
    return cells
  }

  private sampleCellsUniformly(cells: Cell[], requestedCount: number, rng: SeededRng): Cell[] {
    const pool = cells.map(cell => ({ row: cell.row, col: cell.col }))
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const target = rng.int(index + 1)
      const current = pool[index]
      pool[index] = pool[target]
      pool[target] = current
    }
    return pool.slice(0, Math.max(0, Math.min(pool.length, Math.floor(requestedCount))))
  }

  private createTokenAtTier(token: ModuleToken, tier: number): ModuleToken | null {
    if (tier <= 0) return null
    if (tier === 1) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Common',
        plus: false,
      })
    }
    if (tier === 2) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Rare',
        plus: false,
      })
    }
    if (tier === 3) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Rare',
        plus: true,
      })
    }
    if (tier === 4) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Epic',
        plus: false,
      })
    }
    if (tier === 5) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Epic',
        plus: true,
      })
    }
    if (tier === 6) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Legendary',
        plus: false,
      })
    }
    if (tier === 7) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Legendary',
        plus: true,
      })
    }
    if (tier === 8) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Mythic',
        plus: false,
      })
    }
    if (tier === 9) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Mythic',
        plus: true,
      })
    }

    const stars = Math.max(1, Math.min(5, tier - 9))
    return this.catalog.createToken({
      templateId: token.templateId,
      type: token.type,
      rarity: 'Ancestral',
      plus: false,
      stars,
    })
  }

  private applyTierLoss(token: ModuleToken, tiersLost: number): ModuleToken | null {
    const normalizedLoss = Math.max(0, Math.floor(Number(tiersLost) || 0))
    if (normalizedLoss <= 0) return cloneToken(token)
    const currentTier = getBemergedProgressionTier(token)
    const nextTier = currentTier - normalizedLoss
    return this.createTokenAtTier(token, nextTier)
  }

  private applyBossDecayToCells(cells: Cell[], tiersLost: number, rng: SeededRng): void {
    if (!this.boss || cells.length === 0) return

    const hcMissChance = this.getActiveUniqueScalar('HC') / 100
    const sfBonus = this.getActiveUniqueScalar('SF')
    const pcPercent = this.getActiveUniqueScalar('PC_CORE')
    const destroyedTokens: ModuleToken[] = []
    let skippedNonCommon = false
    let bonusDamage = 0

    for (const cell of cells) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) continue

      if (!skippedNonCommon && hcMissChance > 0 && token.rarity !== 'Common' && rng.next() < hcMissChance) {
        skippedNonCommon = true
        continue
      }

      const originalTier = getBemergedProgressionTier(token)
      const decayedToken = this.applyTierLoss(token, tiersLost)
      const qualifiesForPc = originalTier >= 3

      if (sfBonus > 0) {
        bonusDamage += Math.floor(sfBonus + originalTier)
      }
      if (pcPercent > 0 && qualifiesForPc && this.bossMaxHits > 0) {
        bonusDamage += Math.floor(this.bossMaxHits * (pcPercent / 100))
      }

      if (!decayedToken || (decayedToken.rarity === 'Common' && tiersLost > 0 && originalTier <= tiersLost)) {
        destroyedTokens.push(token)
        this.recordHazardLoss(token, 'boss')
        this.board[cell.row][cell.col] = null
        continue
      }

      this.recordHazardImpact(token, decayedToken, 'boss')
      this.board[cell.row][cell.col] = decayedToken
    }

    for (const token of destroyedTokens) {
      this.addShatterRewards(token, { comboSize: destroyedTokens.length })
    }

    if (bonusDamage > 0) {
      this.applyBossDamage(bonusDamage)
    }
  }

  private getBossAdjacentModuleEntries(): Array<{ cell: Cell; token: ModuleToken }> {
    if (!this.boss) return []

    const entries: Array<{ cell: Cell; token: ModuleToken }> = []
    for (const cell of this.getCellsAround(this.boss.row, this.boss.col, 1)) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) continue
      entries.push({ cell, token })
    }
    return entries
  }

  getBossComboAvailableTypes(): ModuleType[] {
    const types = new Set<ModuleType>()
    for (const entry of this.getBossAdjacentModuleEntries()) {
      types.add(entry.token.type)
    }
    return Array.from(types.values()).sort()
  }

  getBossComboSelectableCells(type: ModuleType): Cell[] {
    if (!this.getBossComboAvailableTypes().includes(type)) return []

    const cells: Cell[] = []
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const token = this.board[row]?.[col]
        if (!token || token.type !== type) continue
        cells.push({ row, col })
      }
    }
    return cells
  }

  private previewMineExplosion(mineCell: Cell, rng: SeededRng = new SeededRng(this.rng.getState())): MineExplosionPreview {
    const mine = this.mines.find(item => item.row === mineCell.row && item.col === mineCell.col)
    if (!mine) {
      return {
        valid: false,
        reason: 'no-mine',
        removed: 0,
        damage: 0,
        blastRadius: 0,
        affectedCells: [],
      }
    }

    const wrReduction = Math.max(0, Math.floor(this.getActiveUniqueScalar('WR')))
    const reducedBySd = rng.next() < (bemergedParityTuning.mine.reducedRadiusChancePercent / 100)
      ? bemergedParityTuning.mine.reducedRadiusTiles
      : 0
    const blastRadius = Math.max(1, (mine.blastRadius || bemergedParityTuning.mine.blastRadius) - wrReduction - reducedBySd)

    const affectedCells: Cell[] = []
    let removed = 0
    let damage = 0
    const hcMissChance = this.getActiveUniqueScalar('HC') / 100
    let skippedNonCommon = false
    for (const cell of this.getCellsAround(mine.row, mine.col, blastRadius)) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) continue
      if (!skippedNonCommon && hcMissChance > 0 && token.rarity !== 'Common' && rng.next() < hcMissChance) {
        skippedNonCommon = true
        continue
      }
      affectedCells.push(cell)
      damage += getComboDamageForToken(token)
      const decayed = this.applyTierLoss(token, 2)
      if (!decayed) {
        removed += 1
      }
    }

    return {
      valid: true,
      reason: 'ok',
      removed,
      damage,
      blastRadius,
      affectedCells,
    }
  }

  previewBossShatterSelection(selection: Cell[]): BossComboPreview {
    if (!this.boss) {
      return {
        valid: false,
        reason: 'no-boss',
        damage: 0,
        autoIncludedCells: [],
        manualSelectableCells: [],
        mineCells: [],
        affectedMineCells: [],
        allDamageCells: [],
      }
    }

    const autoEntries = this.getBossAdjacentModuleEntries()
    const availableTypes = this.getBossComboAvailableTypes()
    if (availableTypes.length === 0) {
      return {
        valid: false,
        reason: 'no-adjacent-modules',
        damage: 0,
        autoIncludedCells: [],
        manualSelectableCells: [],
        mineCells: [],
        affectedMineCells: [],
        allDamageCells: [],
      }
    }

    const autoKeySet = new Set(autoEntries.map(entry => `${entry.cell.row}:${entry.cell.col}`))
    const uniqueSelection: Cell[] = []
    const selectionKeys = new Set<string>()
    for (const cell of selection || []) {
      const key = `${cell.row}:${cell.col}`
      if (selectionKeys.has(key) || autoKeySet.has(key)) continue
      selectionKeys.add(key)
      uniqueSelection.push({ row: cell.row, col: cell.col })
    }

    let lockedType: ModuleType | null = null
    for (const cell of uniqueSelection) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) {
        return {
          valid: false,
          reason: 'empty-selection',
          damage: 0,
          autoIncludedCells: autoEntries.map(entry => entry.cell),
          manualSelectableCells: [],
          mineCells: [],
          affectedMineCells: [],
          allDamageCells: autoEntries.map(entry => entry.cell),
        }
      }
      if (!lockedType) {
        lockedType = token.type
      }
      if (token.type !== lockedType) {
        return {
          valid: false,
          reason: 'type-lock-mismatch',
          damage: 0,
          autoIncludedCells: autoEntries.map(entry => entry.cell),
          manualSelectableCells: [],
          mineCells: [],
          affectedMineCells: [],
          allDamageCells: autoEntries.map(entry => entry.cell),
        }
      }
    }

    if (lockedType && !availableTypes.includes(lockedType)) {
      return {
        valid: false,
        reason: 'type-not-adjacent-at-start',
        damage: 0,
        autoIncludedCells: autoEntries.map(entry => entry.cell),
        manualSelectableCells: [],
        mineCells: [],
        affectedMineCells: [],
        allDamageCells: autoEntries.map(entry => entry.cell),
      }
    }

    const manualSelectableCells = lockedType ? this.getBossComboSelectableCells(lockedType) : []
    const mineCells = new Map<string, Cell>()
    for (const entry of autoEntries) {
      for (const mine of this.mines) {
        if (Math.abs(mine.row - entry.cell.row) <= 1 && Math.abs(mine.col - entry.cell.col) <= 1) {
          mineCells.set(`${mine.row}:${mine.col}`, { row: mine.row, col: mine.col })
        }
      }
    }

    const damageCells = new Map<string, Cell>()
    for (const entry of autoEntries) {
      damageCells.set(`${entry.cell.row}:${entry.cell.col}`, { row: entry.cell.row, col: entry.cell.col })
    }
    for (const cell of uniqueSelection) {
      damageCells.set(`${cell.row}:${cell.col}`, { row: cell.row, col: cell.col })
    }

    const rng = new SeededRng(this.rng.getState())
    const affectedMineCells = new Map<string, Cell>()
    for (const mineCell of mineCells.values()) {
      const minePreview = this.previewMineExplosion(mineCell, rng)
      if (!minePreview.valid) continue
      for (const cell of minePreview.affectedCells) {
        const key = `${cell.row}:${cell.col}`
        affectedMineCells.set(key, { row: cell.row, col: cell.col })
        damageCells.set(key, { row: cell.row, col: cell.col })
      }
    }

    const adjacentBossExtraHits = this.getActiveUniqueScalar('OC')
    const comboDoubleChance = this.getActiveUniqueScalar('BA') / 100
    let totalDamage = 0
    for (const cell of damageCells.values()) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) continue
      let tokenDamage = getComboDamageForToken(token)
      const adjacentToBoss = Math.abs(cell.row - this.boss.row) <= 1
        && Math.abs(cell.col - this.boss.col) <= 1
        && !(cell.row === this.boss.row && cell.col === this.boss.col)
      if (adjacentToBoss && adjacentBossExtraHits > 0 && rng.next() < 0.1) {
        tokenDamage += adjacentBossExtraHits
      }
      if (comboDoubleChance > 0 && rng.next() < comboDoubleChance) {
        tokenDamage *= 2
      }
      totalDamage += tokenDamage
    }

    const stackBonus = this.bossComboCount > 0
      ? (this.bossComboCount * bemergedParityTuning.combo.stackDamagePercent)
      : 0
    const comboPercent = this.getActiveUniqueScalar('AS') + stackBonus
    const damage = comboPercent > 0
      ? Math.max(0, Math.floor(totalDamage * (1 + (comboPercent / 100))))
      : totalDamage

    return {
      valid: true,
      reason: 'ready',
      damage,
      autoIncludedCells: autoEntries.map(entry => ({ row: entry.cell.row, col: entry.cell.col })),
      manualSelectableCells,
      mineCells: Array.from(mineCells.values()),
      affectedMineCells: Array.from(affectedMineCells.values()),
      allDamageCells: Array.from(damageCells.values()),
    }
  }

  private rollSpawnTokenAtLeast(minRarity: 'Rare' | 'Epic'): ModuleToken {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const token = this.catalog.createRandomToken()
      if (rarityAtLeast(token.rarity, minRarity)) {
        return token
      }
    }
    return this.catalog.createRandomToken()
  }

  private applyEpicTypeSpawnWeighting(token: ModuleToken): ModuleToken {
    if (token.rarity !== 'Epic') return token

    const weightedTypes: Array<{ type: ModuleType; weight: number }> = [
      { type: 'Cannon', weight: this.getEpicTypeSpawnMultiplier('Cannon') },
      { type: 'Armor', weight: this.getEpicTypeSpawnMultiplier('Armor') },
      { type: 'Generator', weight: this.getEpicTypeSpawnMultiplier('Generator') },
      { type: 'Core', weight: this.getEpicTypeSpawnMultiplier('Core') },
    ]

    const totalWeight = weightedTypes.reduce((sum, item) => sum + item.weight, 0)
    if (totalWeight <= 0) return token

    let roll = this.rng.next() * totalWeight
    let selectedType: ModuleType = weightedTypes[0].type
    for (const item of weightedTypes) {
      roll -= item.weight
      if (roll <= 0) {
        selectedType = item.type
        break
      }
    }

    if (selectedType === token.type) return token

    const candidates = EPIC_TEMPLATE_IDS_BY_TYPE[selectedType]
    if (!Array.isArray(candidates) || candidates.length === 0) return token

    const selectedTemplateId = candidates[this.rng.int(candidates.length)]
    if (!selectedTemplateId) return token

    return this.catalog.createToken({
      templateId: selectedTemplateId,
      type: selectedType,
      rarity: 'Epic',
      plus: token.plus,
    })
  }

  private createSpawnToken(): ModuleToken {
    let token = this.catalog.createRandomToken()

    const phScalar = this.getActiveUniqueScalar('PH')
    const pfScalar = this.getActiveUniqueScalar('PF')
    const unspentShardsOnHand = Math.max(
      0,
      (this.shardsByType.Cannon || 0)
      + (this.shardsByType.Armor || 0)
      + (this.shardsByType.Generator || 0)
      + (this.shardsByType.Core || 0),
    )
    const bossBonusPercent = this.boss
      ? ((phScalar * this.bossAliveMoveCount) + (Math.log10(Math.max(1, unspentShardsOnHand + 1)) * pfScalar))
      : 0

    if (token.rarity === 'Common' && bossBonusPercent > 0 && this.rng.next() < Math.min(0.45, bossBonusPercent / 100)) {
      token = this.rollSpawnTokenAtLeast('Rare')
    } else if (token.rarity === 'Rare' && bossBonusPercent > 0 && this.rng.next() < Math.min(0.25, bossBonusPercent / 100)) {
      token = this.rollSpawnTokenAtLeast('Epic')
    }

    token = this.applyEpicTypeSpawnWeighting(token)

    const bhdPercent = this.getActiveUniqueScalar('BHD')
    if (bhdPercent > 0 && token.rarity === 'Epic' && !token.plus && isUniqueToken(token) && this.rng.next() < (bhdPercent / 100)) {
      token = this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Epic',
        plus: true,
      })
    }

    return token
  }

  private addShatterRewards(token: ModuleToken, options?: { comboSize?: number }): void {
    this.shatters += 1
    const comboMultiplier = Number(options?.comboSize) >= 5 ? 2 : 1
    const baseShardGain = this.getActiveUniqueScalar('SH') > 0 && this.rng.next() < (this.getActiveUniqueScalar('SH') / 100)
      ? bemergedParityTuning.shardsPerClear * 2
      : bemergedParityTuning.shardsPerClear
    const shardGain = baseShardGain * comboMultiplier
    this.score += shardGain
    this.shardsByType[token.type] += shardGain
  }

  private applyGeneratorComboTimerReduction(comboSize: number): void {
    if (comboSize < 4) return
    const reducedSeconds = Math.max(0, Math.floor(this.getActiveUniqueScalar('GC')))
    if (reducedSeconds <= 0) return
    this.bonusElapsedSeconds += reducedSeconds
  }

  private applyPeriodicCommonSweepIfReady(): void {
    const interval = Math.max(0, Math.floor(this.getActiveUniqueScalar('MVN')))
    if (interval <= 0 || this.moves <= 0 || this.moves % interval !== 0) return

    const removed: ModuleToken[] = []
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (this.isCellBlocked(row, col)) continue
        const token = this.board[row][col]
        if (!token || token.rarity !== 'Common') continue
        removed.push(token)
        this.board[row][col] = null
      }
    }

    if (removed.length <= 0) return

    for (const token of removed) {
      this.addShatterRewards(token, { comboSize: removed.length })
    }

    const dropSlots = this.captureDropSlotsForCollapse()
    this.settleSpecialsDown()
    collapse(this.board, () => this.createSpawnToken())
    this.trySpawnMine(dropSlots.length)
    for (const slot of dropSlots) {
      this.trySpawnBoss(slot.row, slot.col)
    }
    this.repositionSpecials()
  }

  private moveMinesTowardBossIfNeeded(): void {
    if (!this.boss || this.mines.length === 0) return
    const interval = Math.max(0, Math.floor(this.getActiveUniqueScalar('MH')))
    if (interval <= 0 || this.moves <= 0 || this.moves % interval !== 0) return

    const occupied = new Set(this.mines.map(mine => `${mine.row}:${mine.col}`))
    for (const mine of this.mines) {
      occupied.delete(`${mine.row}:${mine.col}`)
      const rowStep = this.boss.row === mine.row ? 0 : (this.boss.row > mine.row ? 1 : -1)
      const colStep = this.boss.col === mine.col ? 0 : (this.boss.col > mine.col ? 1 : -1)

      const candidates: Array<{ row: number; col: number }> = [
        { row: mine.row + rowStep, col: mine.col + colStep },
        { row: mine.row + rowStep, col: mine.col },
        { row: mine.row, col: mine.col + colStep },
      ]

      const next = candidates.find(candidate => {
        if (candidate.row < 0 || candidate.row >= BOARD_ROWS || candidate.col < 0 || candidate.col >= BOARD_COLS) return false
        if (candidate.row === mine.row && candidate.col === mine.col) return false
        if (this.boss && candidate.row === this.boss.row && candidate.col === this.boss.col) return false
        return !occupied.has(`${candidate.row}:${candidate.col}`)
      })

      if (next) {
        mine.row = next.row
        mine.col = next.col
      }
      occupied.add(`${mine.row}:${mine.col}`)
    }
  }

  private countAdjacentRareModulesToBoss(): number {
    if (!this.boss) return 0
    let count = 0
    for (let row = Math.max(0, this.boss.row - 1); row <= Math.min(BOARD_ROWS - 1, this.boss.row + 1); row += 1) {
      for (let col = Math.max(0, this.boss.col - 1); col <= Math.min(BOARD_COLS - 1, this.boss.col + 1); col += 1) {
        if (row === this.boss.row && col === this.boss.col) continue
        const token = this.board[row][col]
        if (!token) continue
        if (token.rarity === 'Rare' || token.rarity === 'Epic' || token.rarity === 'Legendary' || token.rarity === 'Mythic' || token.rarity === 'Ancestral') {
          count += 1
        }
      }
    }
    return count
  }

  private maybePromoteHazardDestroyedToken(token: ModuleToken): ModuleToken {
    const chancePercent = this.getActiveUniqueScalar('RB_GENERATOR')
    if (chancePercent <= 0 || this.rng.next() >= (chancePercent / 100)) {
      return token
    }

    if (token.rarity === 'Common') {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Rare',
        plus: false,
      })
    }
    if (token.rarity === 'Rare' && !token.plus) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Rare',
        plus: true,
      })
    }
    if (token.rarity === 'Rare' && token.plus) {
      return this.catalog.createToken({
        templateId: token.templateId,
        type: token.type,
        rarity: 'Epic',
        plus: false,
      })
    }

    return token
  }

  private isCellThreatenedByMineOrBoss(row: number, col: number): boolean {
    for (const mine of this.mines) {
      const rowDelta = Math.abs(mine.row - row)
      const colDelta = Math.abs(mine.col - col)
      if (rowDelta <= 1 && colDelta <= 1) {
        return true
      }
    }

    if (this.boss) {
      const rowDelta = Math.abs(this.boss.row - row)
      const colDelta = Math.abs(this.boss.col - col)
      const adjacentToBoss = rowDelta <= 1 && colDelta <= 1 && !(rowDelta === 0 && colDelta === 0)
      if (adjacentToBoss && this.getBossThreatActive()) {
        return true
      }
    }

    return false
  }

  private scoreMergeSelectionForAutoplay(
    base: ModuleToken,
    outcome: MergeOutcome,
    objective: ObjectiveProgress,
    preferredType: ModuleType,
    fodderTargets: FodderTargetsByType,
    goal: AutoplayGoal,
  ): number {
    const type = base.type
    const rarityScore = rarityWeightForRarity(outcome.rarity, outcome.plus)
    const stars = outcome.rarity === 'Ancestral'
      ? Math.max(1, Math.min(5, Math.floor(Number(outcome.stars || 1))))
      : 0
    const currentTypeStars = objective.highestStarsByType[type]
    const neededTypeStars = Math.max(0, OBJECTIVE_TARGET_STARS - currentTypeStars)
    const objectiveGain = Math.min(neededTypeStars, stars || 1) * this.autoplayLearningProfile.typeBias[type]
    const typeNeedWeight = neededTypeStars * this.autoplayLearningProfile.typeBias[type]
    const uniqueLineage = isUniqueToken(base)
    const stepsToAnc = this.estimateStepsToAncestral(base)
    const pathWeight = Math.max(0, 10 - stepsToAnc)
    const uniquePathBonus = uniqueLineage ? 1 : 0
    const deadEndPenalty = stepsToAnc >= 99 ? 1 : 0
    const preferredTypeBonus = type === preferredType ? 1 : 0
    const typeTargets = fodderTargets[type]
    const epicPlusGain = outcome.rarity === 'Epic' && outcome.plus ? 1 : 0
    const legendaryPlusGain = outcome.rarity === 'Legendary' && outcome.plus ? 1 : 0
    const templateEpicPlusGain = outcome.rarity === 'Epic'
      && outcome.plus
      && !!typeTargets.activeUniqueTemplateId
      && String(base.templateId) === typeTargets.activeUniqueTemplateId
      ? 1
      : 0
    const rareToPipelineBonus =
      (base.rarity === 'Rare' && !base.plus)
      || (base.rarity === 'Rare' && base.plus)
      || (base.rarity === 'Epic' && !base.plus)
        ? 1
        : 0
    const fodderPlanBonus =
      (epicPlusGain * typeTargets.epicPlusDeficit * 700)
      + (legendaryPlusGain * typeTargets.legendaryPlusDeficit * 1100)
      + (templateEpicPlusGain * typeTargets.templateEpicPlusDeficit * 1400)
      + (rareToPipelineBonus * (typeTargets.epicPlusDeficit + typeTargets.legendaryPlusDeficit) * 220)
    const fodderDeficitPressure = (typeTargets.epicPlusDeficit * 1.2)
      + (typeTargets.legendaryPlusDeficit * 1.8)
      + (typeTargets.templateEpicPlusDeficit * 2)
    const advancesFodderPipeline = epicPlusGain > 0
      || legendaryPlusGain > 0
      || templateEpicPlusGain > 0
      || rareToPipelineBonus > 0
    const offPipelinePenalty = fodderDeficitPressure > 0 && !advancesFodderPipeline
      ? fodderDeficitPressure * 650
      : 0
    const baseBossDamage = this.boss ? getBossDamageForRarity(outcome.rarity) : 0
    const burstCountdown = this.getBossBurstCountdown()
    const bossPhaseWeight = !this.boss
      ? 0
      : !this.getBossThreatActive()
        ? 1.2
        : burstCountdown <= 1
          ? 2.4
          : burstCountdown <= 2
            ? 2
            : 1.6
    const bossHpPressure = this.boss
      ? Math.max(1, Math.min(3, (15 / Math.max(1, this.boss.hitsRemaining))))
      : 0
    const bossUrgencyBonus = baseBossDamage * bossPhaseWeight * bossHpPressure

    switch (goal) {
      case 'objective-progress':
        return (objectiveGain * 2600) + (typeNeedWeight * 1400) + (rarityScore * 400) + (pathWeight * 260) + (uniquePathBonus * 700) + (preferredTypeBonus * 550) + (bossUrgencyBonus * 340) + fodderPlanBonus - (deadEndPenalty * 1800) - offPipelinePenalty
      case 'max-shards':
        return (rarityScore * 1800) + (objectiveGain * 700) + (pathWeight * 120) + (bossUrgencyBonus * 220) + (fodderPlanBonus * 0.35) - (deadEndPenalty * 500)
      case 'max-merges':
        return (rarityScore * 900) + (objectiveGain * 600) + (pathWeight * 150) + (bossUrgencyBonus * 80) + (fodderPlanBonus * 0.45) - (deadEndPenalty * 400)
      case 'farm-cannon':
        return type === 'Cannon' ? (rarityScore * 1500) + (objectiveGain * 800) + (pathWeight * 140) + (fodderPlanBonus * 0.5) : rarityScore * 250
      case 'farm-armor':
        return type === 'Armor' ? (rarityScore * 1500) + (objectiveGain * 800) + (pathWeight * 140) + (fodderPlanBonus * 0.5) : rarityScore * 250
      case 'farm-generator':
        return type === 'Generator' ? (rarityScore * 1500) + (objectiveGain * 800) + (pathWeight * 140) + (fodderPlanBonus * 0.5) : rarityScore * 250
      case 'farm-core':
        return type === 'Core' ? (rarityScore * 1500) + (objectiveGain * 800) + (pathWeight * 140) + (fodderPlanBonus * 0.5) : rarityScore * 250
      case 'boss-damage':
        return (bossUrgencyBonus * 3200) + (rarityScore * 500) + (objectiveGain * 250) + (pathWeight * 120) + (fodderPlanBonus * 0.2) - (deadEndPenalty * 350)
      case 'balanced':
      default:
        return (objectiveGain * 1900) + (typeNeedWeight * 800) + (rarityScore * 600) + (pathWeight * 180) + (uniquePathBonus * 450) + (preferredTypeBonus * 260) + (bossUrgencyBonus * 300) + (fodderPlanBonus * 0.65) - (deadEndPenalty * 1100)
    }
  }

  getAutoplayGoals(): ReadonlyArray<AutoplayGoal> {
    return AUTOPLAY_GOALS
  }

  setAutoplayLearningProfile(profile?: Partial<AutoplayLearningProfile> | null): void {
    if (!profile || typeof profile !== 'object') {
      this.autoplayLearningProfile = createNeutralLearningProfile()
      return
    }

    const attempts = Number.isFinite(Number(profile.attempts))
      ? Math.max(0, Math.floor(Number(profile.attempts)))
      : 0
    const bestObjectiveCompletionPercent = Number.isFinite(Number(profile.bestObjectiveCompletionPercent))
      ? Math.max(0, Math.min(100, Number(profile.bestObjectiveCompletionPercent)))
      : 0
    const bestShards = Number.isFinite(Number(profile.bestShards))
      ? Math.max(0, Math.floor(Number(profile.bestShards)))
      : 0
    const bestElapsedSeconds = Number.isFinite(Number(profile.bestElapsedSeconds))
      ? Math.max(0, Math.floor(Number(profile.bestElapsedSeconds)))
      : 0

    const baseBias = createNeutralLearningProfile().typeBias
    const incomingBias: Partial<Record<ModuleType, unknown>> = profile.typeBias && typeof profile.typeBias === 'object'
      ? (profile.typeBias as Partial<Record<ModuleType, unknown>>)
      : {}

    this.autoplayLearningProfile = {
      attempts,
      typeBias: {
        Cannon: Number.isFinite(Number(incomingBias.Cannon)) ? Math.max(0.5, Math.min(2.5, Number(incomingBias.Cannon))) : baseBias.Cannon,
        Armor: Number.isFinite(Number(incomingBias.Armor)) ? Math.max(0.5, Math.min(2.5, Number(incomingBias.Armor))) : baseBias.Armor,
        Generator: Number.isFinite(Number(incomingBias.Generator)) ? Math.max(0.5, Math.min(2.5, Number(incomingBias.Generator))) : baseBias.Generator,
        Core: Number.isFinite(Number(incomingBias.Core)) ? Math.max(0.5, Math.min(2.5, Number(incomingBias.Core))) : baseBias.Core,
      },
      bestObjectiveCompletionPercent,
      bestShards,
      bestElapsedSeconds,
    }
  }

  getAutoplayLearningProfile(): AutoplayLearningProfile {
    return {
      attempts: this.autoplayLearningProfile.attempts,
      typeBias: { ...this.autoplayLearningProfile.typeBias },
      bestObjectiveCompletionPercent: this.autoplayLearningProfile.bestObjectiveCompletionPercent,
      bestShards: this.autoplayLearningProfile.bestShards,
      bestElapsedSeconds: this.autoplayLearningProfile.bestElapsedSeconds,
    }
  }

  getObjectiveProgress(targetStars = OBJECTIVE_TARGET_STARS): ObjectiveProgress {
    const normalizedTarget = Math.max(1, Math.min(5, Math.floor(Number(targetStars) || OBJECTIVE_TARGET_STARS)))
    const highestStarsByType: Record<ModuleType, number> = {
      Cannon: 0,
      Armor: 0,
      Generator: 0,
      Core: 0,
    }
    const completedUniqueKeys = new Set<string>()
    const uniqueStageByKey = new Map<string, number>()
    const boardRarityCounts = createObjectiveRarityCounts()
    const inventoryRarityCounts = createObjectiveRarityCounts()
    let stageProgressScore = 0
    let trackedBoardModCount = 0
    let trackedInventoryModCount = 0

    const observeToken = (token: ModuleToken | null, source: 'board' | 'inventory') => {
      if (!token) return
      const rarityBucket = getObjectiveProgressBucket(token)
      const stageValue = getObjectiveStageValue(token)
      stageProgressScore += stageValue
      if (source === 'board') {
        trackedBoardModCount += 1
        boardRarityCounts[rarityBucket] = Number(boardRarityCounts[rarityBucket] || 0) + 1
      } else {
        trackedInventoryModCount += 1
        inventoryRarityCounts[rarityBucket] = Number(inventoryRarityCounts[rarityBucket] || 0) + 1
      }
      let stars = 0
      if (token.rarity === 'Ancestral') {
        stars = Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
      }
      if (stars > highestStarsByType[token.type]) {
        highestStarsByType[token.type] = stars
      }
      const uniqueKey = `${String(token.templateId)}:${String(token.type)}`
      if (isUniqueToken(token)) {
        const previousStage = uniqueStageByKey.get(uniqueKey) || 0
        if (stageValue > previousStage) {
          uniqueStageByKey.set(uniqueKey, stageValue)
        }
      }
      if (stars < normalizedTarget) return
      if (!UNIQUE_TEMPLATE_KEYS.has(uniqueKey)) return
      completedUniqueKeys.add(uniqueKey)
    }

    for (const row of this.board) {
      for (const token of row) {
        observeToken(token, 'board')
      }
    }
    observeToken(this.inventory.Cannon, 'inventory')
    observeToken(this.inventory.Armor, 'inventory')
    observeToken(this.inventory.Generator, 'inventory')
    observeToken(this.inventory.Core, 'inventory')
    for (const effect of this.permanentUniqueEffects) {
      completedUniqueKeys.add(effect.uniqueKey)
      uniqueStageByKey.set(effect.uniqueKey, OBJECTIVE_STAGE_MAX)
    }

    const perTypeValues = Object.values(highestStarsByType)
    const completedTypeCount = perTypeValues.filter(stars => stars >= normalizedTarget).length
    const trackedModCount = trackedBoardModCount + trackedInventoryModCount
    const completionPercent = trackedModCount > 0
      ? Number(((stageProgressScore / (trackedModCount * OBJECTIVE_STAGE_MAX)) * 100).toFixed(2))
      : 0
    const finalGoalCompletionPercent = UNIQUE_MOD_TARGET_COUNT > 0
      ? Number(((completedUniqueKeys.size / UNIQUE_MOD_TARGET_COUNT) * 100).toFixed(2))
      : 0
    const uniqueStageProgressScore = Array.from(uniqueStageByKey.values()).reduce((sum, value) => sum + value, 0)
    const uniqueStageProgressPercent = UNIQUE_MOD_TARGET_COUNT > 0
      ? Number(((uniqueStageProgressScore / (UNIQUE_MOD_TARGET_COUNT * OBJECTIVE_STAGE_MAX)) * 100).toFixed(2))
      : 0

    return {
      targetStars: normalizedTarget,
      highestStarsByType,
      completedTypeCount,
      completedUniqueMods: completedUniqueKeys.size,
      totalUniqueMods: UNIQUE_MOD_TARGET_COUNT,
      objectiveComplete: completedUniqueKeys.size >= UNIQUE_MOD_TARGET_COUNT,
      completionPercent,
      finalGoalCompletionPercent,
      uniqueStageProgressPercent,
      stageProgressScore,
      trackedModCount,
      trackedBoardModCount,
      trackedInventoryModCount,
      boardRarityCounts,
      inventoryRarityCounts,
    }
  }

  normalizeAutoplayGoal(rawGoal: unknown): AutoplayGoal {
    const value = String(rawGoal || '').trim().toLowerCase()
    if (isAutoplayGoal(value)) return value
    return 'balanced'
  }

  private compareMoveTieBreaker(left: Move, right: Move): number {
    const leftKey = `${left.from.row}:${left.from.col}:${left.to.row}:${left.to.col}`
    const rightKey = `${right.from.row}:${right.from.col}:${right.to.row}:${right.to.col}`
    return leftKey.localeCompare(rightKey)
  }

  private getDirectedMoveKey(move: Move): string {
    return `${move.from.row}:${move.from.col}:${move.to.row}:${move.to.col}`
  }

  private getReversedMove(move: Move): Move {
    return {
      from: { row: move.to.row, col: move.to.col },
      to: { row: move.from.row, col: move.from.col },
    }
  }

  private registerAppliedMove(move: Move): void {
    const key = this.getDirectedMoveKey(move)
    this.lastAppliedMove = {
      from: { row: move.from.row, col: move.from.col },
      to: { row: move.to.row, col: move.to.col },
    }
    this.recentAppliedMoveKeys.push(key)
    if (this.recentAppliedMoveKeys.length > 30) {
      this.recentAppliedMoveKeys.splice(0, this.recentAppliedMoveKeys.length - 30)
    }
  }

  private getAutoplayOscillationPenalty(move: Move): number {
    const key = this.getDirectedMoveKey(move)
    const reverseKey = this.getDirectedMoveKey(this.getReversedMove(move))

    let penalty = 0
    if (this.lastAppliedMove) {
      const reversedLastMoveKey = this.getDirectedMoveKey(this.getReversedMove(this.lastAppliedMove))
      if (key === reversedLastMoveKey) {
        penalty += 2400
      }
    }

    let oscillationRepeats = 0
    for (const recentKey of this.recentAppliedMoveKeys) {
      if (recentKey === key || recentKey === reverseKey) {
        oscillationRepeats += 1
      }
    }

    return penalty + (oscillationRepeats * 650)
  }

  private scoreMoveForAutoplay(move: Move, goal: AutoplayGoal): number {
    const preview = cloneBoard(this.board)
    swap(preview, move)
    const matches = this.findShatterCellsOnBoard(preview)
    const objective = this.getObjectiveProgress()
    const preferredType = this.getPreferredObjectiveType(objective)
    const localMergeOpportunityBefore = this.scoreLocalMergeOpportunity(this.board, move.from, preferredType)
      + this.scoreLocalMergeOpportunity(this.board, move.to, preferredType)
    const localMergeOpportunityAfter = this.scoreLocalMergeOpportunity(preview, move.from, preferredType)
      + this.scoreLocalMergeOpportunity(preview, move.to, preferredType)
    const localMergeOpportunityDelta = localMergeOpportunityAfter - localMergeOpportunityBefore
    const fodderTargets = this.getFodderTargetsByType()
    const totalFodderDeficit =
      fodderTargets.Cannon.epicPlusDeficit
      + fodderTargets.Cannon.legendaryPlusDeficit
      + fodderTargets.Armor.epicPlusDeficit
      + fodderTargets.Armor.legendaryPlusDeficit
      + fodderTargets.Generator.epicPlusDeficit
      + fodderTargets.Generator.legendaryPlusDeficit
      + fodderTargets.Core.epicPlusDeficit
      + fodderTargets.Core.legendaryPlusDeficit
    const mergeReadinessBefore = this.estimateMergeReadiness(this.board)
    const mergeReadinessAfter = this.estimateMergeReadiness(preview)
    const mergeReadinessDelta = mergeReadinessAfter - mergeReadinessBefore
    const hazardExposureBefore = this.estimateHazardExposureScore(this.board)
    const hazardExposureAfter = this.estimateHazardExposureScore(preview)
    const hazardExposurePenalty = Math.max(0, hazardExposureAfter - hazardExposureBefore)
    const hazardMitigationBonus = Math.max(0, hazardExposureBefore - hazardExposureAfter)
    const spawnPrepBefore = this.estimateBossSpawnPreparationScore(this.board)
    const spawnPrepAfter = this.estimateBossSpawnPreparationScore(preview)
    const spawnPrepDelta = spawnPrepAfter - spawnPrepBefore
    const strategicRowingBonus = this.estimateBottomRowSafetyDelta(move)
    const inventoryEffectContextScore =
      (this.getActiveUniqueEffectCount() * 180)
      + (this.boss
        ? (
          (this.getActiveUniqueScalar('AS')
            + this.getActiveUniqueScalar('AD')
            + this.getActiveUniqueScalar('BA')
            + this.getActiveUniqueScalar('OC')
            + this.getActiveUniqueScalar('PC_CORE')) * 14
        )
        : (
          (this.getActiveUniqueScalar('DP')
            + this.getActiveUniqueScalar('SR_CANNON')
            + this.getActiveUniqueScalar('NMP')
            + this.getActiveUniqueScalar('PH')
            + this.getActiveUniqueScalar('PF')) * 8
        ))

    if (matches.length === 0) {
      const fromToken = this.board[move.from.row]?.[move.from.col] || null
      const toToken = this.board[move.to.row]?.[move.to.col] || null
      const preferredTouches = [fromToken, toToken].filter(token => token?.type === preferredType).length
      const rareTouches = [fromToken, toToken].filter(token => token?.rarity === 'Rare').length
      const commonTouches = [fromToken, toToken].filter(token => token?.rarity === 'Common').length
      const organizationScore = (preferredTouches * 70) + (rareTouches * 120) - (commonTouches * 90)
      const oscillationPenalty = this.getAutoplayOscillationPenalty(move)
      const mineDistancePenalty = this.estimateMineAdjacencyPenalty(move)
      const freeMovePenalty = 4200
      const baseNoClearScore = organizationScore
        + inventoryEffectContextScore
        + (mergeReadinessDelta * 180)
        + (localMergeOpportunityDelta * 210)
        + (localMergeOpportunityDelta * 240)
        + (hazardMitigationBonus * 320)
        + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.noClear.hazardMitigationBonus)
        + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.noClear.spawnPrepDelta)
        + strategicRowingBonus
        - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.noClear.hazardExposurePenalty)
        - mineDistancePenalty
        - oscillationPenalty
        - freeMovePenalty

      const strategyScore =
        scoreBossStrategyMove({
          goal,
          hasBoss: !!this.boss,
          movesUntilBossSpawn: this.getMovesUntilBossSpawn(),
          bossDamage: 0,
          matchCount: 0,
          rareClearCount: 0,
          rarePlusClearCount: 0,
          objectiveProgressDelta: 0,
          spawnPrepDelta,
        })
        + scoreMineStrategyMove({
          goal,
          mineCount: this.mines.length,
          hasBoss: !!this.boss,
          hazardMitigationBonus,
          hazardExposurePenalty,
          mineDistancePenalty,
          strategicRowingBonus,
        })

      const survivalScore = scorePreservationMove({
        goal,
        hazardExposurePenalty,
        hazardMitigationBonus,
        commonOnlyMatchPenalty: 0,
        oscillationPenalty,
        strategicRowingBonus,
        mergeReadinessDelta,
      })

      const scoreTempo = scoreTempoMove({
        goal,
        shardsValue: 0,
        matchCount: 0,
        objectiveTypeWeight: 0,
        objectiveCompletionWeight: objective.completionPercent * 15,
        rareClearBonus: 0,
        commonClearBonus: 0,
        fodderPipelineMatchBonus: 0,
      })

      return composeMetaPlannerScore({
        goal,
        baseGoalScore: baseNoClearScore,
        strategyScore,
        survivalScore,
        scoreTempo,
      })
    }

    const matchCount = matches.length
    let shardsValue = 0
    let bossDamage = 0
    let commonClearCount = 0
    let rareClearCount = 0
    let rarePlusClearCount = 0
    let farmCannon = 0
    let farmArmor = 0
    let farmGenerator = 0
    let farmCore = 0
    let objectiveProgressDelta = 0
    let fodderPipelineMatchBonus = 0

    for (const cell of matches) {
      const token = preview[cell.row]?.[cell.col] || null
      if (!token) continue
      const weight = rarityWeight(token)
      shardsValue += weight
      bossDamage += this.getBossDamageForToken(token)
      if (token.rarity === 'Common') commonClearCount += 1
      if (token.rarity === 'Rare') {
        rareClearCount += 1
        if (token.plus) rarePlusClearCount += 1
      }
      if (token.rarity === 'Rare') {
        const typeTargets = fodderTargets[token.type]
        const deficitPressure = typeTargets.epicPlusDeficit + (typeTargets.legendaryPlusDeficit * 1.4)
        fodderPipelineMatchBonus += deficitPressure * (token.plus ? 380 : 280)
      }
      if (token.rarity === 'Epic' && token.plus) {
        const typeTargets = fodderTargets[token.type]
        fodderPipelineMatchBonus += typeTargets.epicPlusDeficit * 640
      }
      if (token.rarity === 'Legendary' && token.plus) {
        const typeTargets = fodderTargets[token.type]
        fodderPipelineMatchBonus += typeTargets.legendaryPlusDeficit * 980
      }
      if (token.type === 'Cannon') farmCannon += weight
      if (token.type === 'Armor') farmArmor += weight
      if (token.type === 'Generator') farmGenerator += weight
      if (token.type === 'Core') farmCore += weight
      if (token.rarity === 'Ancestral') {
        const stars = Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
        const current = objective.highestStarsByType[token.type]
        const needed = Math.max(0, OBJECTIVE_TARGET_STARS - current)
        if (needed > 0) {
          objectiveProgressDelta += Math.min(stars, needed) * this.autoplayLearningProfile.typeBias[token.type]
        }
      }
    }

    const mineDistancePenalty = this.estimateMineAdjacencyPenalty(move)
    const bossBonus = this.boss ? bossDamage : 0
    const typeNeedFactor = {
      Cannon: Math.max(0, OBJECTIVE_TARGET_STARS - objective.highestStarsByType.Cannon) * this.autoplayLearningProfile.typeBias.Cannon,
      Armor: Math.max(0, OBJECTIVE_TARGET_STARS - objective.highestStarsByType.Armor) * this.autoplayLearningProfile.typeBias.Armor,
      Generator: Math.max(0, OBJECTIVE_TARGET_STARS - objective.highestStarsByType.Generator) * this.autoplayLearningProfile.typeBias.Generator,
      Core: Math.max(0, OBJECTIVE_TARGET_STARS - objective.highestStarsByType.Core) * this.autoplayLearningProfile.typeBias.Core,
    }
    const objectiveTypeWeight =
      (farmCannon * typeNeedFactor.Cannon) +
      (farmArmor * typeNeedFactor.Armor) +
      (farmGenerator * typeNeedFactor.Generator) +
      (farmCore * typeNeedFactor.Core) +
      objectiveProgressDelta
    const objectiveCompletionWeight = objective.completionPercent * 15
    const oscillationPenalty = this.getAutoplayOscillationPenalty(move)
    const commonClearBonus = commonClearCount * 8
    const rareClearBonus = (rareClearCount * 280) + (rarePlusClearCount * 420)
    const commonOnlyMatchPenalty = commonClearCount === matches.length
      ? 860 + (totalFodderDeficit * 220)
      : 0
    const mergeSetupBonus = Math.max(0, localMergeOpportunityDelta)
    const mergeSetupRegressionPenalty = Math.max(0, -localMergeOpportunityDelta)
    const progresslessCommonClearPenalty = commonOnlyMatchPenalty > 0
      && objectiveProgressDelta <= 0
      && mergeReadinessDelta <= 0
      && localMergeOpportunityDelta <= 0
      && fodderPipelineMatchBonus <= 0
      ? 3200
      : 0

    let baseGoalScore = 0
    switch (goal) {
      case 'objective-progress':
        baseGoalScore = (objectiveTypeWeight * 1500)
          + inventoryEffectContextScore
          + (shardsValue * 350)
          + (matchCount * 220)
          + (bossBonus * 280)
          + objectiveCompletionWeight
          + commonClearBonus
          + rareClearBonus
          + fodderPipelineMatchBonus
          + (mergeReadinessDelta * 980)
          + (mergeSetupBonus * 780)
          + (hazardMitigationBonus * 500)
          + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.objectiveProgress.hazardMitigationBonus)
          + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.objectiveProgress.spawnPrepDelta)
          + strategicRowingBonus
          - commonOnlyMatchPenalty
          - progresslessCommonClearPenalty
          - (mergeSetupRegressionPenalty * 220)
          - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.objectiveProgress.hazardExposurePenalty)
          - mineDistancePenalty
          - oscillationPenalty
        break
      case 'max-merges':
        baseGoalScore = inventoryEffectContextScore + (matchCount * 1000) + (shardsValue * 10) + (commonClearBonus * 0.2) + (rareClearBonus * 0.35) + (mergeReadinessDelta * 360) + bossBonus + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.maxMerges.hazardMitigationBonus) + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.maxMerges.spawnPrepDelta) - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.maxMerges.hazardExposurePenalty) - mineDistancePenalty - oscillationPenalty
        break
      case 'max-shards':
        baseGoalScore = inventoryEffectContextScore + (shardsValue * 1000) + (matchCount * 100) + (commonClearBonus * 0.3) + (rareClearBonus * 0.5) + (mergeReadinessDelta * 280) + bossBonus + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.maxShards.hazardMitigationBonus) + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.maxShards.spawnPrepDelta) - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.maxShards.hazardExposurePenalty) - mineDistancePenalty - oscillationPenalty
        break
      case 'farm-cannon':
        baseGoalScore = inventoryEffectContextScore + (farmCannon * 1500) + (shardsValue * 200) + (matchCount * 50) + (commonClearBonus * 0.2) + (rareClearBonus * 0.3) + (mergeReadinessDelta * 260) + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.farm.hazardMitigationBonus) + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.farm.spawnPrepDelta) - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.farm.hazardExposurePenalty) - mineDistancePenalty - oscillationPenalty
        break
      case 'farm-armor':
        baseGoalScore = inventoryEffectContextScore + (farmArmor * 1500) + (shardsValue * 200) + (matchCount * 50) + (commonClearBonus * 0.2) + (rareClearBonus * 0.3) + (mergeReadinessDelta * 260) + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.farm.hazardMitigationBonus) + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.farm.spawnPrepDelta) - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.farm.hazardExposurePenalty) - mineDistancePenalty - oscillationPenalty
        break
      case 'farm-generator':
        baseGoalScore = inventoryEffectContextScore + (farmGenerator * 1500) + (shardsValue * 200) + (matchCount * 50) + (commonClearBonus * 0.2) + (rareClearBonus * 0.3) + (mergeReadinessDelta * 260) + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.farm.hazardMitigationBonus) + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.farm.spawnPrepDelta) - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.farm.hazardExposurePenalty) - mineDistancePenalty - oscillationPenalty
        break
      case 'farm-core':
        baseGoalScore = inventoryEffectContextScore + (farmCore * 1500) + (shardsValue * 200) + (matchCount * 50) + (commonClearBonus * 0.2) + (rareClearBonus * 0.3) + (mergeReadinessDelta * 260) + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.farm.hazardMitigationBonus) + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.farm.spawnPrepDelta) - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.farm.hazardExposurePenalty) - mineDistancePenalty - oscillationPenalty
        break
      case 'boss-damage':
        baseGoalScore = inventoryEffectContextScore + (bossBonus * 2000) + (shardsValue * 200) + (matchCount * 100) + (commonClearBonus * 0.1) + (rareClearBonus * 0.25) + (mergeReadinessDelta * 220) + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.bossDamage.hazardMitigationBonus) + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.bossDamage.spawnPrepDelta) - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.bossDamage.hazardExposurePenalty) - mineDistancePenalty - oscillationPenalty
        break
      case 'balanced':
      default:
        baseGoalScore = inventoryEffectContextScore + (objectiveTypeWeight * 900) + (shardsValue * 500) + (matchCount * 220) + (bossBonus * 320) + objectiveCompletionWeight + (commonClearBonus * 0.3) + (rareClearBonus * 0.6) + (mergeReadinessDelta * 520) + (mergeSetupBonus * 260) + (hazardMitigationBonus * AUTOPLAY_HAZARD_TUNING.scoring.balanced.hazardMitigationBonus) + (spawnPrepDelta * AUTOPLAY_HAZARD_TUNING.scoring.balanced.spawnPrepDelta) + strategicRowingBonus - (commonOnlyMatchPenalty * 0.4) - (progresslessCommonClearPenalty * 0.3) - (mergeSetupRegressionPenalty * 90) - (hazardExposurePenalty * AUTOPLAY_HAZARD_TUNING.scoring.balanced.hazardExposurePenalty) - mineDistancePenalty - oscillationPenalty
        break
    }

    const strategyScore =
      scoreBossStrategyMove({
        goal,
        hasBoss: !!this.boss,
        movesUntilBossSpawn: this.getMovesUntilBossSpawn(),
        bossDamage: bossBonus,
        matchCount,
        rareClearCount,
        rarePlusClearCount,
        objectiveProgressDelta,
        spawnPrepDelta,
      })
      + scoreMineStrategyMove({
        goal,
        mineCount: this.mines.length,
        hasBoss: !!this.boss,
        hazardMitigationBonus,
        hazardExposurePenalty,
        mineDistancePenalty,
        strategicRowingBonus,
      })

    const survivalScore = scorePreservationMove({
      goal,
      hazardExposurePenalty,
      hazardMitigationBonus,
      commonOnlyMatchPenalty,
      oscillationPenalty,
      strategicRowingBonus,
      mergeReadinessDelta,
    })

    const scoreTempo = scoreTempoMove({
      goal,
      shardsValue,
      matchCount,
      objectiveTypeWeight,
      objectiveCompletionWeight,
      rareClearBonus,
      commonClearBonus,
      fodderPipelineMatchBonus,
    })

    return composeMetaPlannerScore({
      goal,
      baseGoalScore,
      strategyScore,
      survivalScore,
      scoreTempo,
    })
  }

  private getMovesUntilBossSpawn(): number {
    if (this.boss) return Number.POSITIVE_INFINITY
    const every = Math.max(1, Math.floor(Number(bemergedParityTuning.boss.spawnEveryMoves) || 1))
    const remainder = this.moves % every
    return remainder === 0 ? every : every - remainder
  }

  private estimateBossSpawnPreparationScore(board: BoardGrid): number {
    if (this.boss) return 0
    const movesUntilBossSpawn = this.getMovesUntilBossSpawn()
    if (movesUntilBossSpawn > 4) return 0

    let score = 0
    for (const slotType of ['Cannon', 'Armor', 'Generator', 'Core'] as const) {
      const slotToken = this.inventory[slotType]
      if (!slotToken) continue
      score += preservationWeight(slotToken) * 220
    }

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (this.isCellBlocked(row, col)) continue
        const token = board[row]?.[col]
        if (!token || token.rarity === 'Common') continue
        const value = preservationWeight(token)
        if (row >= BOARD_ROWS - 2) {
          score += value * 65
        } else if (row <= 2) {
          score -= value * 95
        }
      }
    }

    return score * (5 - movesUntilBossSpawn)
  }

  private estimateHazardExposureScore(board: BoardGrid): number {
    let exposure = 0

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (this.isCellBlocked(row, col)) continue
        const token = board[row]?.[col]
        if (!token || token.rarity === 'Common') continue
        const value = preservationWeight(token)

        for (const mine of this.mines) {
          const rowDelta = Math.abs(mine.row - row)
          const colDelta = Math.abs(mine.col - col)
          const blastRadius = Math.max(1, mine.blastRadius || bemergedParityTuning.mine.blastRadius)
          if (rowDelta <= blastRadius && colDelta <= blastRadius) {
            exposure += value * 180
            exposure += value * AUTOPLAY_HAZARD_TUNING.exposure.mineBlast
          } else if (rowDelta <= 1 && colDelta <= 1) {
            exposure += value * AUTOPLAY_HAZARD_TUNING.exposure.mineAdjacent
          }
        }

        if (this.boss) {
          const rowDelta = Math.abs(this.boss.row - row)
          const colDelta = Math.abs(this.boss.col - col)
          const adjacent = rowDelta <= 1 && colDelta <= 1 && !(rowDelta === 0 && colDelta === 0)
          if (adjacent) {
            exposure += value * (
              this.getBossThreatActive()
                ? AUTOPLAY_HAZARD_TUNING.exposure.bossAdjacentDestructive
                : AUTOPLAY_HAZARD_TUNING.exposure.bossAdjacentPassive
            )
          }
        }
      }
    }

    if (!this.boss) {
      const movesUntilBossSpawn = this.getMovesUntilBossSpawn()
      if (movesUntilBossSpawn <= 3) {
        for (let row = 0; row < BOARD_ROWS; row += 1) {
          for (let col = 0; col < BOARD_COLS; col += 1) {
            if (this.isCellBlocked(row, col)) continue
            const token = board[row]?.[col]
            if (!token || token.rarity === 'Common') continue
            const value = preservationWeight(token)
            if (row <= 2) {
              exposure += value * (AUTOPLAY_HAZARD_TUNING.exposure.bossSpawnTopRows * (4 - movesUntilBossSpawn))
            }
          }
        }
      }
    }

    return exposure
  }

  private estimateBottomRowSafetyDelta(move: Move): number {
    const fromToken = this.board[move.from.row]?.[move.from.col] || null
    const toToken = this.board[move.to.row]?.[move.to.col] || null
    if (!fromToken || !toToken) return 0

    const fromValue = preservationWeight(fromToken)
    const toValue = preservationWeight(toToken)
    const fromRowBefore = move.from.row
    const toRowBefore = move.to.row
    const fromRowAfter = move.to.row
    const toRowAfter = move.from.row

    const fromDelta = (fromRowAfter - fromRowBefore) * fromValue
    const toDelta = (toRowAfter - toRowBefore) * toValue

    return (fromDelta + toDelta) * AUTOPLAY_HAZARD_TUNING.positioning.bottomRowSafetyDeltaWeight
  }

  private estimateMergeReadiness(board: BoardGrid): number {
    let readinessScore = 0

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (this.isCellBlocked(row, col)) continue

        const baseToken = board[row]?.[col] || null
        if (!baseToken || baseToken.rarity === 'Common') continue

        const requiredTotal = this.requiredTotalForBaseToken(baseToken)
        if (!Number.isFinite(requiredTotal) || requiredTotal < 2) continue

        const foddersRequired = requiredTotal - 1
        let boardFodderCount = 0

        for (let candidateRow = 0; candidateRow < BOARD_ROWS; candidateRow += 1) {
          for (let candidateCol = 0; candidateCol < BOARD_COLS; candidateCol += 1) {
            if (candidateRow === row && candidateCol === col) continue
            if (this.isCellBlocked(candidateRow, candidateCol)) continue

            const candidateToken = board[candidateRow]?.[candidateCol] || null
            if (!candidateToken) continue
            if (!this.canBeFodder(baseToken, candidateToken)) continue
            boardFodderCount += 1
          }
        }

        const inventoryFodderCount = this.getInventoryFodderEntries(baseToken, foddersRequired).length
        const availableFodders = boardFodderCount + inventoryFodderCount
        if (availableFodders <= 0) continue

        const readinessRatio = Math.min(1, availableFodders / Math.max(1, foddersRequired))
        const rarityFactor =
          baseToken.rarity === 'Rare'
            ? (baseToken.plus ? 4.4 : 4.8)
            : baseToken.rarity === 'Epic'
              ? (baseToken.plus ? 3.2 : 2.8)
              : baseToken.rarity === 'Legendary'
                ? 2.4
                : baseToken.rarity === 'Mythic'
                  ? 2
                  : 1.5
        const readyNowBonus = availableFodders >= foddersRequired ? 1 : 0
        const rarePathBonus = baseToken.rarity === 'Rare' ? 1 : 0

        readinessScore += (readinessRatio * rarityFactor * 320)
          + (readyNowBonus * rarityFactor * 220)
          + (rarePathBonus * readinessRatio * 380)
      }
    }

    return readinessScore
  }

  private scoreLocalMergeOpportunity(board: BoardGrid, cell: Cell, preferredType: ModuleType): number {
    if (this.isCellBlocked(cell.row, cell.col)) return 0

    const baseToken = board[cell.row]?.[cell.col] || null
    if (!baseToken || baseToken.rarity === 'Common') return 0

    const requiredTotal = this.requiredTotalForBaseToken(baseToken)
    if (!Number.isFinite(requiredTotal) || requiredTotal < 2) return 0

    const foddersRequired = requiredTotal - 1
    let boardFodderCount = 0
    let scoredFodderWeight = 0

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (row === cell.row && col === cell.col) continue
        if (this.isCellBlocked(row, col)) continue

        const candidateToken = board[row]?.[col] || null
        if (!candidateToken) continue
        if (!this.canBeFodder(baseToken, candidateToken)) continue

        boardFodderCount += 1
        scoredFodderWeight += Math.max(0, this.scoreFodderForBase(baseToken, candidateToken, preferredType))
      }
    }

    const inventoryFodderCount = this.getInventoryFodderEntries(baseToken, foddersRequired).length
    const availableFodders = boardFodderCount + inventoryFodderCount
    if (availableFodders <= 0) return 0

    const readinessRatio = Math.min(1, availableFodders / Math.max(1, foddersRequired))
    const readyNowBonus = availableFodders >= foddersRequired ? 1 : 0
    const preferredTypeBonus = baseToken.type === preferredType ? 1 : 0

    return (readinessRatio * 620)
      + (Math.min(boardFodderCount, foddersRequired) * 180)
      + (readyNowBonus * 280)
      + (preferredTypeBonus * 120)
      + (Math.min(2400, scoredFodderWeight) * 0.18)
  }

  private estimateMineAdjacencyPenalty(move: Move): number {
    if (this.mines.length === 0) return 0
    let penalty = 0
    const touchedCells = [move.from, move.to]
    for (const touched of touchedCells) {
      for (const mine of this.mines) {
        const rowDelta = Math.abs(mine.row - touched.row)
        const colDelta = Math.abs(mine.col - touched.col)
        if (rowDelta <= 1 && colDelta <= 1) {
          penalty += 25
        }
      }
    }
    return penalty
  }

  private isMoveStrictlyValid(move: Move): boolean {
    if (this.isCellBlocked(move.from.row, move.from.col) || this.isCellBlocked(move.to.row, move.to.col)) {
      return false
    }
    if (this.isCellAdjacentToMine(move.from.row, move.from.col) || this.isCellAdjacentToMine(move.to.row, move.to.col)) {
      return false
    }

    const from = this.board[move.from.row]?.[move.from.col] || null
    const to = this.board[move.to.row]?.[move.to.col] || null
    if (!from || !to) return false
    if (from.matchKey === to.matchKey) return false
    return true
  }

  findValidMoves(): Move[] {
    const boardForMoves = cloneBoard(this.board)
    for (const mine of this.mines) {
      boardForMoves[mine.row][mine.col] = null
      for (let row = Math.max(0, mine.row - 1); row <= Math.min(BOARD_ROWS - 1, mine.row + 1); row += 1) {
        for (let col = Math.max(0, mine.col - 1); col <= Math.min(BOARD_COLS - 1, mine.col + 1); col += 1) {
          if (row === mine.row && col === mine.col) continue
          boardForMoves[row][col] = null
        }
      }
    }
    if (this.boss) {
      boardForMoves[this.boss.row][this.boss.col] = null
    }
    return findAllValidMoves(boardForMoves)
  }

  applyMove(move: Move): { valid: boolean; merged: boolean } {
    if (!this.isMoveStrictlyValid(move)) {
      return { valid: false, merged: false }
    }

    swap(this.board, move)

    this.moves += 1
    this.applyPeriodicCommonSweepIfReady()
    const mergedFromSwap = this.resolveBoardAfterAction()

    this.advanceMineSystem()
    this.advanceBossSystem()
    const mergedFromEffects = this.resolveBoardAfterAction()
    const merged = mergedFromSwap || mergedFromEffects
    this.mergeSession = null
    this.registerAppliedMove(move)
    this.registerNonInventoryAction()

    return { valid: true, merged }
  }

  applyBossShatterSelection(selection: Cell[]): { valid: boolean; damage: number; removed: number; reason: string } {
    this.mergeSession = null
    const preview = this.previewBossShatterSelection(selection)
    if (!preview.valid) return { valid: false, damage: 0, removed: 0, reason: preview.reason }

    const autoKeys = new Set(preview.autoIncludedCells.map(cell => `${cell.row}:${cell.col}`))
    const manualCells: Cell[] = []
    const seenManualKeys = new Set<string>()
    for (const cell of selection || []) {
      const key = `${cell.row}:${cell.col}`
      if (seenManualKeys.has(key) || autoKeys.has(key)) continue
      seenManualKeys.add(key)
      manualCells.push({ row: cell.row, col: cell.col })
    }

    const explicitCells = new Map<string, Cell>()
    for (const cell of preview.autoIncludedCells) {
      explicitCells.set(`${cell.row}:${cell.col}`, { row: cell.row, col: cell.col })
    }
    for (const cell of manualCells) {
      explicitCells.set(`${cell.row}:${cell.col}`, { row: cell.row, col: cell.col })
    }

    const minePreviews = preview.mineCells.map(cell => ({
      mine: { row: cell.row, col: cell.col },
      preview: this.previewMineExplosion(cell, this.rng),
    }))

    const adjacentBossExtraHits = this.getActiveUniqueScalar('OC')
    const comboDoubleChance = this.getActiveUniqueScalar('BA') / 100
    let rawDamage = 0
    for (const cell of preview.allDamageCells) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token || !this.boss) continue
      let tokenDamage = getComboDamageForToken(token)
      const adjacentToBoss = Math.abs(cell.row - this.boss.row) <= 1
        && Math.abs(cell.col - this.boss.col) <= 1
        && !(cell.row === this.boss.row && cell.col === this.boss.col)
      if (adjacentToBoss && adjacentBossExtraHits > 0 && this.rng.next() < 0.1) {
        tokenDamage += adjacentBossExtraHits
      }
      if (comboDoubleChance > 0 && this.rng.next() < comboDoubleChance) {
        tokenDamage *= 2
      }
      rawDamage += tokenDamage
    }

    const stackBonus = this.bossComboCount > 0
      ? (this.bossComboCount * bemergedParityTuning.combo.stackDamagePercent)
      : 0
    const comboPercent = this.getActiveUniqueScalar('AS') + stackBonus
    const damage = comboPercent > 0
      ? Math.max(0, Math.floor(rawDamage * (1 + (comboPercent / 100))))
      : rawDamage

    const removedTokens: ModuleToken[] = []
    for (const cell of explicitCells.values()) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) continue
      removedTokens.push(token)
      this.board[cell.row][cell.col] = null
    }

    for (const mineEntry of minePreviews) {
      this.mines = this.mines.filter(item => !(item.row === mineEntry.mine.row && item.col === mineEntry.mine.col))
      for (const cell of mineEntry.preview.affectedCells) {
        if (explicitCells.has(`${cell.row}:${cell.col}`)) continue
        const token = this.board[cell.row]?.[cell.col]
        if (!token) continue
        const decayed = this.applyTierLoss(token, 2)
        if (!decayed) {
          removedTokens.push(token)
          this.recordHazardLoss(token, 'mine')
          this.board[cell.row][cell.col] = null
          continue
        }
        this.recordHazardImpact(token, decayed, 'mine')
        this.board[cell.row][cell.col] = decayed
      }
    }

    const comboSize = removedTokens.length
    for (const token of removedTokens) {
      this.addShatterRewards(token, { comboSize })
    }

    this.applyBossDamage(damage)
    if (this.boss) {
      this.bossComboCount += Math.max(0, Math.floor(this.getActiveUniqueScalar('DC')))
      this.attachBossRuntimeState()
    }

    const removed = removedTokens.length
    this.applyGeneratorComboTimerReduction(Math.max(1, removed))
    this.moves += 1
    this.applyPeriodicCommonSweepIfReady()
    this.resolveBoardAfterAction()
    this.advanceMineSystem()
    this.advanceBossSystem()
    this.resolveBoardAfterAction()
    this.registerNonInventoryAction()
    return { valid: true, damage, removed, reason: 'boss-damaged' }
  }

  applyMineShatterSelection(mineCell: Cell, selection: Cell[]): { valid: boolean; removed: number; reason: string } {
    this.mergeSession = null
    void selection
    const mine = this.mines.find(item => item.row === mineCell.row && item.col === mineCell.col)
    if (!mine) return { valid: false, removed: 0, reason: 'no-mine' }

    this.mines = this.mines.filter(item => !(item.row === mine.row && item.col === mine.col))

    let removed = 0
    let bossDamage = 0
    const destroyedTokens: ModuleToken[] = []
    const wrReduction = Math.max(0, Math.floor(this.getActiveUniqueScalar('WR')))
    const reducedBySd = this.rng.next() < (bemergedParityTuning.mine.reducedRadiusChancePercent / 100)
      ? bemergedParityTuning.mine.reducedRadiusTiles
      : 0
    const blastRadius = Math.max(1, (mine.blastRadius || bemergedParityTuning.mine.blastRadius) - wrReduction - reducedBySd)
    const hcMissChance = this.getActiveUniqueScalar('HC') / 100
    let skippedNonCommon = false
    let promotionSaved = false
    for (const cell of this.getCellsAround(mine.row, mine.col, blastRadius)) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) continue

      if (!skippedNonCommon && hcMissChance > 0 && token.rarity !== 'Common' && this.rng.next() < hcMissChance) {
        skippedNonCommon = true
        continue
      }

      const decayed = this.applyTierLoss(token, 2)
      if (!decayed && !promotionSaved) {
        const promoted = this.maybePromoteHazardDestroyedToken(token)
        if (promoted !== token) {
          this.board[cell.row][cell.col] = promoted
          promotionSaved = true
          continue
        }
      }

      bossDamage += getComboDamageForToken(token)
      if (!decayed) {
        removed += 1
        destroyedTokens.push(token)
        this.recordHazardLoss(token, 'mine')
        this.board[cell.row][cell.col] = null
        continue
      }

      this.recordHazardImpact(token, decayed, 'mine')
      this.board[cell.row][cell.col] = decayed
    }

    for (const token of destroyedTokens) {
      this.addShatterRewards(token, { comboSize: destroyedTokens.length })
    }

    if (this.boss) {
      const bossInBlast =
        Math.abs(this.boss.row - mine.row) <= blastRadius &&
        Math.abs(this.boss.col - mine.col) <= blastRadius
      if (bossInBlast) {
        this.applyBossDamage(bossDamage)
      }
    }

    this.moves += 1
    this.applyGeneratorComboTimerReduction(Math.max(1, removed))
    this.applyPeriodicCommonSweepIfReady()
    this.resolveBoardAfterAction()
    this.advanceMineSystem()
    this.advanceBossSystem()
    this.resolveBoardAfterAction()
    this.registerNonInventoryAction()
    return { valid: true, removed, reason: 'mine-shattered' }
  }

  private canCellBeFodder(baseCell: Cell, candidateCell: Cell): boolean {
    if (baseCell.row === candidateCell.row && baseCell.col === candidateCell.col) return false
    if (this.isCellBlocked(baseCell.row, baseCell.col) || this.isCellBlocked(candidateCell.row, candidateCell.col)) return false
    const base = this.board[baseCell.row][baseCell.col]
    const candidate = this.board[candidateCell.row][candidateCell.col]
    if (!base || !candidate) return false
    return this.canBeFodder(base, candidate)
  }

  getMergeCandidates(baseCell: Cell): Cell[] {
    if (this.isCellBlocked(baseCell.row, baseCell.col)) return []
    const base = this.board[baseCell.row][baseCell.col]
    if (!base || base.rarity === 'Common') return []

    return this.getMergeCandidatesForToken(base, baseCell)
  }

  private getMergeCandidatesForToken(base: ModuleToken, excludedCell: Cell | null = null): Cell[] {
    if (!base || base.rarity === 'Common') return []

    const candidates: Cell[] = []
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        if (excludedCell && row === excludedCell.row && col === excludedCell.col) continue
        if (this.isCellBlocked(row, col)) continue
        const candidate = this.board[row]?.[col] || null
        if (candidate && this.canBeFodder(base, candidate)) {
          const candidateCell = { row, col }
          candidates.push(candidateCell)
        }
      }
    }

    return candidates
  }

  hasMergeSession(): boolean {
    return this.mergeSession !== null
  }

  getMergeSessionSnapshot(): MergeSessionSnapshot {
    if (!this.mergeSession) {
      return {
        active: false,
        base: null,
        baseSlot: null,
        selection: [],
        candidateKeys: [],
        state: this.getMergeSelectionState([]),
      }
    }

    return {
      active: true,
      base: this.mergeSession.base ? { ...this.mergeSession.base } : null,
      baseSlot: this.mergeSession.baseSlot,
      selection: this.mergeSession.selection.map(cell => ({ ...cell })),
      candidateKeys: Array.from(this.mergeSession.candidateKeys.values()),
      state: this.getMergeSelectionState(this.mergeSession.selection, this.mergeSession.baseSlot),
    }
  }

  startMergeSession(baseCell: Cell): { started: boolean; reason: string; session: MergeSessionSnapshot } {
    if (this.isCellBlocked(baseCell.row, baseCell.col)) {
      return { started: false, reason: 'blocked-tile', session: this.getMergeSessionSnapshot() }
    }

    const token = this.board[baseCell.row][baseCell.col]
    if (!token) {
      return { started: false, reason: 'invalid-base', session: this.getMergeSessionSnapshot() }
    }
    if (token.rarity === 'Common') {
      return { started: false, reason: 'base-cannot-merge', session: this.getMergeSessionSnapshot() }
    }

    const candidates = this.getMergeCandidates(baseCell)
    this.mergeSession = {
      base: { ...baseCell },
      baseSlot: null,
      selection: [{ ...baseCell }],
      candidateKeys: new Set(candidates.map(candidate => this.cellKey(candidate))),
    }

    return { started: true, reason: 'started', session: this.getMergeSessionSnapshot() }
  }

  startInventoryMergeSession(slotType: ModuleType): { started: boolean; reason: string; session: MergeSessionSnapshot } {
    const token = this.inventory[slotType]
    if (!token) {
      return { started: false, reason: 'invalid-base', session: this.getMergeSessionSnapshot() }
    }
    if (token.rarity === 'Common') {
      return { started: false, reason: 'base-cannot-merge', session: this.getMergeSessionSnapshot() }
    }

    const candidates = this.getMergeCandidatesForToken(token)
    this.mergeSession = {
      base: null,
      baseSlot: slotType,
      selection: [],
      candidateKeys: new Set(candidates.map(candidate => this.cellKey(candidate))),
    }

    return { started: true, reason: 'started', session: this.getMergeSessionSnapshot() }
  }

  toggleMergeSessionCell(cell: Cell): {
    active: boolean
    changed: boolean
    cancelled: boolean
    reason: string
    session: MergeSessionSnapshot
  } {
    if (!this.mergeSession) {
      return {
        active: false,
        changed: false,
        cancelled: false,
        reason: 'no-merge-session',
        session: this.getMergeSessionSnapshot(),
      }
    }

    const base = this.mergeSession.base
    if (base && cell.row === base.row && cell.col === base.col) {
      return {
        active: true,
        changed: false,
        cancelled: false,
        reason: 'base-cell',
        session: this.getMergeSessionSnapshot(),
      }
    }

    const key = this.cellKey(cell)
    if (!this.mergeSession.candidateKeys.has(key)) {
      this.mergeSession = null
      return {
        active: false,
        changed: true,
        cancelled: true,
        reason: 'invalid-fodder',
        session: this.getMergeSessionSnapshot(),
      }
    }

    const index = this.mergeSession.selection.findIndex(item => item.row === cell.row && item.col === cell.col)
    if (index >= 0) {
      this.mergeSession.selection.splice(index, 1)
      return {
        active: true,
        changed: true,
        cancelled: false,
        reason: 'removed',
        session: this.getMergeSessionSnapshot(),
      }
    }

    const state = this.getMergeSelectionState(this.mergeSession.selection, this.mergeSession.baseSlot)
    const selectedTotal = this.mergeSession.selection.length + (this.mergeSession.baseSlot ? 1 : 0)
    if (!Number.isFinite(state.requiredTotal) || selectedTotal >= state.requiredTotal) {
      return {
        active: true,
        changed: false,
        cancelled: false,
        reason: 'selection-full',
        session: this.getMergeSessionSnapshot(),
      }
    }

    this.mergeSession.selection.push({ ...cell })
    return {
      active: true,
      changed: true,
      cancelled: false,
      reason: 'added',
      session: this.getMergeSessionSnapshot(),
    }
  }

  confirmMergeSession(): { valid: boolean; merged: boolean; reason: string } {
    if (!this.mergeSession) {
      return { valid: false, merged: false, reason: 'no-merge-session' }
    }

    const result = this.applyMergeSelectionIfReady(this.mergeSession.selection, this.mergeSession.baseSlot)
    if (result.valid) {
      this.mergeSession = null
    }
    return result
  }

  cancelMergeSession(): void {
    this.mergeSession = null
  }

  getMergeSelectionState(selection: Cell[], inventoryBaseSlot: ModuleType | null = null): MergeSelectionState {
    const evaluated = this.evaluateMergeSelection(selection, { requireExactCount: false, inventoryBaseSlot })
    const selectedCount = inventoryBaseSlot ? selection.length : Math.max(0, selection.length - 1)
    if (!evaluated.valid) {
      return {
        valid: false,
        reason: evaluated.reason,
        requiredTotal: evaluated.requiredTotal,
        selectedCount,
        readyToMerge: false,
        previewToken: null,
      }
    }

    if (evaluated.fodders.length !== (evaluated.requiredTotal - 1)) {
      return {
        valid: true,
        reason: 'selection-incomplete',
        requiredTotal: evaluated.requiredTotal,
        selectedCount,
        readyToMerge: false,
        previewToken: null,
      }
    }

    const outcome = this.predictMergeOutcome(evaluated.baseToken as ModuleToken, evaluated.fodders)
    if (!outcome) {
      return {
        valid: false,
        reason: 'no-merge-rule',
        requiredTotal: evaluated.requiredTotal,
        selectedCount,
        readyToMerge: false,
        previewToken: null,
      }
    }

    const baseToken = evaluated.baseToken as ModuleToken
    return {
      valid: true,
      reason: 'ready',
      requiredTotal: evaluated.requiredTotal,
      selectedCount,
      readyToMerge: true,
      previewToken: this.catalog.createToken({
        templateId: baseToken.templateId,
        type: baseToken.type,
        rarity: outcome.rarity,
        plus: outcome.plus,
        stars: outcome.stars,
      }),
    }
  }

  applyMergeSelectionIfReady(selection: Cell[], inventoryBaseSlot: ModuleType | null = null): { valid: boolean; merged: boolean; reason: string } {
    const state = this.getMergeSelectionState(selection, inventoryBaseSlot)
    if (!state.valid || !state.readyToMerge) {
      return { valid: false, merged: false, reason: state.reason }
    }
    return this.applyMergeSelection(selection, inventoryBaseSlot)
  }

  applyMergeSelection(selection: Cell[], inventoryBaseSlot: ModuleType | null = null): { valid: boolean; merged: boolean; reason: string } {
    const evaluated = this.evaluateMergeSelection(selection, { requireExactCount: true, inventoryBaseSlot })
    if (!evaluated.valid || !evaluated.baseToken) {
      return { valid: false, merged: false, reason: evaluated.reason }
    }

    const outcome = this.predictMergeOutcome(evaluated.baseToken, evaluated.fodders)
    if (!outcome) return { valid: false, merged: false, reason: 'no-merge-rule' }

    const selectionStartIndex = inventoryBaseSlot ? 0 : 1
    for (let index = selectionStartIndex; index < selection.length; index += 1) {
      const cell = selection[index]
      this.board[cell.row][cell.col] = null
    }

    for (const slotType of evaluated.inventoryFodderSlots) {
      this.inventory[slotType] = null
    }

    const upgradedToken = this.catalog.createToken({
      templateId: evaluated.baseToken.templateId,
      type: evaluated.baseToken.type,
      rarity: outcome.rarity,
      plus: outcome.plus,
      stars: outcome.stars,
    })
    if (inventoryBaseSlot) {
      this.inventory[inventoryBaseSlot] = upgradedToken
    } else {
      const baseCell = selection[0]
      this.board[baseCell.row][baseCell.col] = upgradedToken
    }
    const mergedToken = inventoryBaseSlot
      ? this.inventory[inventoryBaseSlot]
      : this.board[selection[0].row][selection[0].col]
    if (mergedToken && mergedToken.rarity === 'Ancestral' && Math.floor(Number(mergedToken.stars || 1)) >= 5 && this.registerPermanentUniqueEffect(mergedToken)) {
      if (inventoryBaseSlot) {
        this.inventory[inventoryBaseSlot] = null
      } else {
        this.board[selection[0].row][selection[0].col] = null
      }
    }
    this.moves += 1
    this.merges += 1
    this.mergeSession = null
    this.applyPeriodicCommonSweepIfReady()

    this.resolveBoardAfterAction()
    this.advanceMineSystem()
    this.advanceBossSystem()
    this.resolveBoardAfterAction()
    this.registerNonInventoryAction()
    return { valid: true, merged: true, reason: 'merged' }
  }

  applyInventoryAction(cell: Cell): boolean {
    if (this.boss) return false
    if (this.isCellBlocked(cell.row, cell.col)) return false

    const token = this.board[cell.row][cell.col]
    if (!token) return false
    if (!isUniqueToken(token)) return false

    const slotType = token.type
    const slotToken = this.inventory[slotType]

    if (!slotToken) {
      this.inventory[slotType] = token
      this.board[cell.row][cell.col] = this.createSpawnToken()
      this.registerInventoryExchange(cell, slotType, token, null)
      return true
    }

    this.inventory[slotType] = token
    this.board[cell.row][cell.col] = slotToken
    this.registerInventoryExchange(cell, slotType, token, slotToken)
    return true
  }

  applyInventoryActionToSlot(cell: Cell, slotType: ModuleType): boolean {
    if (this.boss) return false
    if (this.isCellBlocked(cell.row, cell.col)) return false

    const token = this.board[cell.row][cell.col]
    if (!token) return false
    if (token.type !== slotType) return false
    if (!isUniqueToken(token)) return false

    const slotToken = this.inventory[slotType]
    if (!slotToken) {
      this.inventory[slotType] = token
      this.board[cell.row][cell.col] = this.createSpawnToken()
      this.registerInventoryExchange(cell, slotType, token, null)
      return true
    }

    this.inventory[slotType] = token
    this.board[cell.row][cell.col] = slotToken
    this.registerInventoryExchange(cell, slotType, token, slotToken)
    return true
  }

  consumeBoardChangedFlag(): boolean {
    return true
  }

  setAutoShatterRares(enabled: boolean): void {
    this.autoShatterRares = !!enabled
  }

  getBoardRows(): number {
    return BOARD_ROWS
  }

  private resolveBoardAfterAction(): boolean {
    let merged = false

    while (true) {
      const hasEmptyCells = this.board.some(row => row.some(cell => !cell))
      const matches = this.findShatterCellsIgnoringBlocked()
      if (matches.length === 0) {
        if (!hasEmptyCells) break

        const dropSlots = this.captureDropSlotsForCollapse()
        this.settleSpecialsDown()
        collapse(this.board, () => this.createSpawnToken())
        this.trySpawnMine(dropSlots.length)
        for (const slot of dropSlots) {
          this.trySpawnBoss(slot.row, slot.col)
        }
        this.repositionSpecials()
        continue
      }

      merged = true
      const adjacentRareCells = this.collectAdjacentRareCells(matches)
      const oaPercent = this.getActiveUniqueScalar('OA')
      if (oaPercent > 0) {
        for (const cell of adjacentRareCells) {
          const token = this.board[cell.row][cell.col]
          if (!token || token.rarity !== 'Rare' || token.plus) continue
          if (this.rng.next() >= (oaPercent / 100)) continue
          this.board[cell.row][cell.col] = this.catalog.createToken({
            templateId: token.templateId,
            type: token.type,
            rarity: 'Rare',
            plus: true,
          })
        }
      }

      const bonusRareCells = this.autoShatterRares ? adjacentRareCells : []
      const removed = clearMatches(this.board, matches)

      for (const cell of bonusRareCells) {
        const token = this.board[cell.row][cell.col]
        if (!token || token.rarity !== 'Rare' || token.plus) continue
        this.board[cell.row][cell.col] = null
        removed.push(token)
      }

      const acpEnabled = this.getActiveUniqueScalar('ACP') > 0
      if (acpEnabled) {
        const adjacentCommons = this.collectAdjacentCommonCells(matches)
        for (const cell of adjacentCommons) {
          const token = this.board[cell.row][cell.col]
          if (!token || token.rarity !== 'Common') continue
          this.board[cell.row][cell.col] = null
          removed.push(token)
          if (this.boss) {
            this.bossComboCount += 1
          }
        }
      }

      for (const token of removed) {
        this.addShatterRewards(token, { comboSize: removed.length })
      }
      this.applyGeneratorComboTimerReduction(removed.length)

      if (this.boss) {
        let damage = 0
        for (const token of removed) {
          damage += this.getBossDamageForToken(token)
        }
        this.applyBossDamage(damage)
      }

      const dropSlots = this.captureDropSlotsForCollapse()
      this.settleSpecialsDown()
      collapse(this.board, () => this.createSpawnToken())
      this.trySpawnMine(dropSlots.length)
      for (const slot of dropSlots) {
        this.trySpawnBoss(slot.row, slot.col)
      }
      this.repositionSpecials()
    }

    return merged
  }

  private createStablePlayableBoard(): BoardGrid {
    let attempts = 0
    while (attempts < 200) {
      attempts += 1
      const candidate = createPlayableBoard(() => this.catalog.createRandomToken())
      this.board = candidate
      if (this.findShatterCellsIgnoringBlocked().length === 0) {
        return candidate
      }
    }

    const fallback = createPlayableBoard(() => this.catalog.createRandomToken())
    this.board = fallback
    return fallback
  }

  private findShatterCellsIgnoringBlocked(): Cell[] {
    return this.findShatterCellsOnBoard(this.board)
  }

  private findShatterCellsOnBoard(board: BoardGrid): Cell[] {
    const visited = new Set<string>()
    const straightMatches = new Map<string, Cell>()
    const isEligible = (token: ModuleToken | null): token is ModuleToken => {
      if (!token) return false
      if (token.rarity === 'Common') return true
      return token.rarity === 'Rare' && !token.plus && this.autoShatterRares
    }

    const keyFor = (row: number, col: number): string => `${row}:${col}`

    const collectGroup = (startRow: number, startCol: number): Cell[] => {
      const start = board[startRow][startCol]
      if (!isEligible(start)) return []

      const groupingIsType = start.rarity === 'Common'
      const group: Cell[] = []
      const stack: Cell[] = [{ row: startRow, col: startCol }]

      while (stack.length > 0) {
        const current = stack.pop()
        if (!current) continue
        const { row, col } = current
        if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) continue
        if (this.isCellBlocked(row, col)) continue

        const key = keyFor(row, col)
        if (visited.has(key)) continue

        const token = board[row][col]
        if (!isEligible(token)) continue

        const sameGroup = groupingIsType
          ? token.rarity === 'Common' && token.type === start.type
          : token.templateId === start.templateId
        if (!sameGroup) continue

        visited.add(key)
        group.push({ row, col })
        stack.push({ row: row - 1, col })
        stack.push({ row: row + 1, col })
        stack.push({ row, col: col - 1 })
        stack.push({ row, col: col + 1 })
      }

      return group
    }

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const key = keyFor(row, col)
        if (visited.has(key) || this.isCellBlocked(row, col)) continue
        const token = board[row][col]
        if (!isEligible(token)) continue

        const group = collectGroup(row, col)
        if (group.length < 3 || !hasStraightTriple(group)) continue

        for (const cell of extractStraightRunPositions(group)) {
          straightMatches.set(keyFor(cell.row, cell.col), cell)
        }
      }
    }

    return Array.from(straightMatches.values())
  }

  private requiredTotalForBaseToken(base: ModuleToken): number {
    const key = `${base.rarity}${base.plus ? '+' : ''}`
    switch (key) {
      case 'Rare':
      case 'Rare+':
      case 'Epic+':
      case 'Mythic+':
        return 3
      case 'Epic':
      case 'Legendary':
      case 'Legendary+':
      case 'Mythic':
      case 'Ancestral':
        return 2
      default:
        return Number.POSITIVE_INFINITY
    }
  }

  private cellKey(cell: Cell): string {
    return `${cell.row},${cell.col}`
  }

  private evaluateMergeSelection(
    selection: Cell[],
    options: { requireExactCount: boolean; inventoryBaseSlot?: ModuleType | null },
  ): MergeSelectionEvaluation {
    const inventoryBaseSlot = options.inventoryBaseSlot ?? null
    if (!Array.isArray(selection) || (!inventoryBaseSlot && selection.length < 1)) {
      return {
        valid: false,
        reason: 'selection-too-small',
        baseToken: null,
        requiredTotal: Number.POSITIVE_INFINITY,
        fodders: [],
        inventoryFodderSlots: [],
      }
    }

    const unique = new Set<string>()
    for (const cell of selection) {
      const key = `${cell.row}:${cell.col}`
      if (unique.has(key)) {
        return {
          valid: false,
          reason: 'duplicate-selection',
          baseToken: null,
          requiredTotal: Number.POSITIVE_INFINITY,
          fodders: [],
          inventoryFodderSlots: [],
        }
      }
      unique.add(key)
      if (this.isCellBlocked(cell.row, cell.col)) {
        return {
          valid: false,
          reason: 'blocked-tile',
          baseToken: null,
          requiredTotal: Number.POSITIVE_INFINITY,
          fodders: [],
          inventoryFodderSlots: [],
        }
      }
      if (!this.board[cell.row][cell.col]) {
        return {
          valid: false,
          reason: 'empty-selection',
          baseToken: null,
          requiredTotal: Number.POSITIVE_INFINITY,
          fodders: [],
          inventoryFodderSlots: [],
        }
      }
    }

    const baseCell = inventoryBaseSlot ? null : selection[0]
    const baseToken = inventoryBaseSlot
      ? this.inventory[inventoryBaseSlot]
      : this.board[baseCell!.row][baseCell!.col]
    if (!baseToken) {
      return {
        valid: false,
        reason: 'invalid-base',
        baseToken: null,
        requiredTotal: Number.POSITIVE_INFINITY,
        fodders: [],
        inventoryFodderSlots: [],
      }
    }

    const requiredTotal = this.requiredTotalForBaseToken(baseToken)
    if (!Number.isFinite(requiredTotal)) {
      return {
        valid: false,
        reason: 'base-cannot-merge',
        baseToken,
        requiredTotal,
        fodders: [],
        inventoryFodderSlots: [],
      }
    }

    const selectedCellLimit = inventoryBaseSlot ? (requiredTotal - 1) : requiredTotal
    if (selection.length > selectedCellLimit) {
      return {
        valid: false,
        reason: 'incorrect-selection-count',
        baseToken,
        requiredTotal,
        fodders: [],
        inventoryFodderSlots: [],
      }
    }

    const fodders: ModuleToken[] = []
    const inventoryFodderSlots: ModuleType[] = []
    for (let index = inventoryBaseSlot ? 0 : 1; index < selection.length; index += 1) {
      const cell = selection[index]
      const token = this.board[cell.row][cell.col]
      if (!token || !this.canBeFodder(baseToken, token)) {
        return {
          valid: false,
          reason: 'invalid-fodder',
          baseToken,
          requiredTotal,
          fodders: [],
          inventoryFodderSlots: [],
        }
      }
      fodders.push(token)
    }

    const neededFromInventory = Math.max(0, (requiredTotal - 1) - fodders.length)
    if (neededFromInventory > 0) {
      const inventoryEntries = this.getInventoryFodderEntries(baseToken, neededFromInventory, inventoryBaseSlot)
      if (inventoryEntries.length < neededFromInventory) {
        if (options.requireExactCount) {
          return {
            valid: false,
            reason: 'incorrect-selection-count',
            baseToken,
            requiredTotal,
            fodders,
            inventoryFodderSlots,
          }
        }
      } else {
        for (const entry of inventoryEntries) {
          fodders.push(entry.token)
          inventoryFodderSlots.push(entry.slotType)
        }
      }
    }

    if (options.requireExactCount && fodders.length !== (requiredTotal - 1)) {
      return {
        valid: false,
        reason: 'incorrect-selection-count',
        baseToken,
        requiredTotal,
        fodders,
        inventoryFodderSlots,
      }
    }

    return {
      valid: true,
      reason: 'ok',
      baseToken,
      requiredTotal,
      fodders,
      inventoryFodderSlots,
    }
  }

  private getInventoryFodderEntries(base: ModuleToken, maxCount: number, excludedSlot: ModuleType | null = null): Array<{ slotType: ModuleType; token: ModuleToken }> {
    if (maxCount <= 0) return []

    const orderedTypes: ModuleType[] = ['Cannon', 'Armor', 'Generator', 'Core']
    const out: Array<{ slotType: ModuleType; token: ModuleToken }> = []

    for (const slotType of orderedTypes) {
      if (excludedSlot && slotType === excludedSlot) continue
      const token = this.inventory[slotType]
      if (!token) continue
      if (!this.canBeFodder(base, token)) continue
      out.push({ slotType, token })
      if (out.length >= maxCount) break
    }

    return out
  }

  private canBeFodder(base: ModuleToken, candidate: ModuleToken): boolean {
    if (!base || !candidate) return false
    if (candidate.rarity === 'Common' || base.rarity === 'Common') return false
    if (candidate.type !== base.type) return false

    if (base.rarity === 'Rare' && !base.plus) {
      return candidate.rarity === 'Rare' && !candidate.plus && candidate.templateId === base.templateId
    }
    if (base.rarity === 'Rare' && base.plus) {
      return candidate.rarity === 'Rare' && candidate.plus && candidate.type === base.type
    }
    if (base.rarity === 'Epic' && !base.plus) {
      return candidate.rarity === 'Epic' && !candidate.plus && candidate.templateId === base.templateId
    }
    if (base.rarity === 'Epic' && base.plus) {
      return candidate.rarity === 'Epic' && candidate.plus && candidate.type === base.type
    }
    if (base.rarity === 'Legendary' && !base.plus) {
      return candidate.rarity === 'Epic' && candidate.plus && candidate.templateId === base.templateId
    }
    if (base.rarity === 'Legendary' && base.plus) {
      return candidate.rarity === 'Legendary' && candidate.plus && candidate.type === base.type
    }
    if (base.rarity === 'Mythic' && !base.plus) {
      return candidate.rarity === 'Legendary' && candidate.plus && candidate.type === base.type
    }
    if (base.rarity === 'Mythic' && base.plus) {
      return candidate.rarity === 'Epic' && candidate.plus && candidate.type === base.type
    }
    if (base.rarity === 'Ancestral') {
      return candidate.rarity === 'Epic' && candidate.plus && candidate.templateId === base.templateId
    }

    return false
  }

  private predictMergeOutcome(base: ModuleToken, fodders: ModuleToken[]): MergeOutcome | null {
    const uniqueLineage = isUniqueToken(base)

    if (base.rarity === 'Rare' && !base.plus && fodders.length === 2 && fodders.every(token => token.rarity === 'Rare' && !token.plus && token.templateId === base.templateId)) {
      return { rarity: 'Rare', plus: true }
    }

    if (base.rarity === 'Rare' && base.plus && fodders.length === 2 && fodders.every(token => token.rarity === 'Rare' && token.plus && token.type === base.type)) {
      return { rarity: 'Epic', plus: false }
    }

    if (base.rarity === 'Epic' && !base.plus && fodders.length === 1 && fodders[0].rarity === 'Epic' && !fodders[0].plus && fodders[0].templateId === base.templateId) {
      return { rarity: 'Epic', plus: true }
    }

    if (base.rarity === 'Epic' && base.plus && fodders.length === 2 && fodders.every(token => token.rarity === 'Epic' && token.plus && token.type === base.type)) {
      return { rarity: 'Legendary', plus: false }
    }

    if (base.rarity === 'Legendary' && !base.plus && fodders.length === 1 && fodders[0].rarity === 'Epic' && fodders[0].plus && fodders[0].templateId === base.templateId) {
      return { rarity: 'Legendary', plus: true }
    }

    if (!uniqueLineage && base.rarity === 'Legendary' && base.plus) {
      return null
    }

    if (uniqueLineage && base.rarity === 'Legendary' && base.plus && fodders.length === 1 && fodders[0].rarity === 'Legendary' && fodders[0].plus && fodders[0].type === base.type) {
      return { rarity: 'Mythic', plus: false }
    }

    if (uniqueLineage && base.rarity === 'Mythic' && !base.plus && fodders.length === 1 && fodders[0].rarity === 'Legendary' && fodders[0].plus && fodders[0].type === base.type) {
      return { rarity: 'Mythic', plus: true }
    }

    if (uniqueLineage && base.rarity === 'Mythic' && base.plus && fodders.length === 2 && fodders.every(token => token.rarity === 'Epic' && token.plus && token.type === base.type)) {
      return { rarity: 'Ancestral', plus: false, stars: 1 }
    }

    if (uniqueLineage && base.rarity === 'Ancestral' && fodders.length === 1 && fodders[0].rarity === 'Epic' && fodders[0].plus && fodders[0].templateId === base.templateId) {
      const nextStars = Math.min(5, Math.max(1, Math.floor(Number(base.stars || 1)) + 1))
      return { rarity: 'Ancestral', plus: false, stars: nextStars }
    }

    return null
  }

  private collectAdjacentRareCells(matches: Cell[]): Cell[] {
    if (matches.length === 0) return []

    const matchedKeys = new Set(matches.map(cell => `${cell.row}:${cell.col}`))
    const rareKeys = new Set<string>()
    const rareCells: Cell[] = []

    for (const cell of matches) {
      const neighbors: Cell[] = [
        { row: cell.row - 1, col: cell.col },
        { row: cell.row + 1, col: cell.col },
        { row: cell.row, col: cell.col - 1 },
        { row: cell.row, col: cell.col + 1 },
      ]

      for (const neighbor of neighbors) {
        if (neighbor.row < 0 || neighbor.row >= BOARD_ROWS || neighbor.col < 0 || neighbor.col >= BOARD_COLS) continue
        const key = `${neighbor.row}:${neighbor.col}`
        if (matchedKeys.has(key) || rareKeys.has(key)) continue
        if (this.isCellBlocked(neighbor.row, neighbor.col)) continue

        const token = this.board[neighbor.row][neighbor.col]
        if (!token || token.rarity !== 'Rare') continue

        rareKeys.add(key)
        rareCells.push(neighbor)
      }
    }

    return rareCells
  }

  private collectAdjacentCommonCells(matches: Cell[]): Cell[] {
    if (matches.length === 0) return []

    const matchedKeys = new Set(matches.map(cell => `${cell.row}:${cell.col}`))
    const commonKeys = new Set<string>()
    const commonCells: Cell[] = []

    for (const cell of matches) {
      const neighbors: Cell[] = [
        { row: cell.row - 1, col: cell.col },
        { row: cell.row + 1, col: cell.col },
        { row: cell.row, col: cell.col - 1 },
        { row: cell.row, col: cell.col + 1 },
      ]

      for (const neighbor of neighbors) {
        if (neighbor.row < 0 || neighbor.row >= BOARD_ROWS || neighbor.col < 0 || neighbor.col >= BOARD_COLS) continue
        const key = `${neighbor.row}:${neighbor.col}`
        if (matchedKeys.has(key) || commonKeys.has(key)) continue
        if (this.isCellBlocked(neighbor.row, neighbor.col)) continue

        const token = this.board[neighbor.row][neighbor.col]
        if (!token || token.rarity !== 'Common') continue

        commonKeys.add(key)
        commonCells.push(neighbor)
      }
    }

    return commonCells
  }

  private advanceMineSystem(): void {
    this.trySpawnMine(1)
    if (this.mines.length === 0) return

    this.moveMinesTowardBossIfNeeded()

    const pending: MineState[] = []
    for (const mine of this.mines) {
      mine.movesRemaining -= 1
      if (mine.movesRemaining <= 0) pending.push(mine)
    }

    if (pending.length === 0) return

    const queue = [...pending]
    const exploded = new Set<string>()
    while (queue.length > 0) {
      const mine = queue.shift()
      if (!mine) continue

      const key = `${mine.row}:${mine.col}`
      if (exploded.has(key)) continue
      exploded.add(key)

      this.mines = this.mines.filter(item => !(item.row === mine.row && item.col === mine.col))

      let bossDamageFromBlast = 0
      const destroyedTokens: ModuleToken[] = []
      const wrReduction = Math.max(0, Math.floor(this.getActiveUniqueScalar('WR')))
      const hasSd = this.getActiveUniqueScalar('SD') > 0
      const reducedBySd = hasSd && this.rng.next() < 0.15 ? 1 : 0
      const blastRadius = Math.max(1, (mine.blastRadius || bemergedParityTuning.mine.blastRadius) - wrReduction - reducedBySd)
      const hcMissChance = this.getActiveUniqueScalar('HC') / 100
      let skippedNonCommon = false
      let promotionSaved = false
      for (let row = Math.max(0, mine.row - blastRadius); row <= Math.min(BOARD_ROWS - 1, mine.row + blastRadius); row += 1) {
        for (let col = Math.max(0, mine.col - blastRadius); col <= Math.min(BOARD_COLS - 1, mine.col + blastRadius); col += 1) {
          const chainedMine = this.mines.find(item => item.row === row && item.col === col)
          if (chainedMine) {
            queue.push(chainedMine)
          }

          const token = this.board[row][col]
          if (!token) continue

          if (!skippedNonCommon && hcMissChance > 0 && token.rarity !== 'Common' && this.rng.next() < hcMissChance) {
            skippedNonCommon = true
            continue
          }

          if (!promotionSaved) {
            const promoted = this.maybePromoteHazardDestroyedToken(token)
            if (promoted !== token) {
              this.board[row][col] = promoted
              promotionSaved = true
              continue
            }
          }

          destroyedTokens.push(token)
          this.recordHazardLoss(token, 'mine')
          bossDamageFromBlast += this.getBossDamageForToken(token)
          this.board[row][col] = null
        }
      }

      for (const token of destroyedTokens) {
        this.addShatterRewards(token, { comboSize: destroyedTokens.length })
      }

      if (this.boss) {
        const bossInBlast =
          Math.abs(this.boss.row - mine.row) <= blastRadius &&
          Math.abs(this.boss.col - mine.col) <= blastRadius
        if (bossInBlast) {
          this.applyBossDamage(bossDamageFromBlast)
        }
      }
    }

    const dropSlots = this.captureDropSlotsForCollapse()
    this.settleSpecialsDown()
    collapse(this.board, () => this.createSpawnToken())
    this.trySpawnMine(dropSlots.length)
    for (const slot of dropSlots) {
      this.trySpawnBoss(slot.row, slot.col)
    }
    this.settleSpecialsDown()
  }

  private trySpawnMine(dropAttempts = 1): void {
    if ((this.moves - this.lastMineSpawnMove) < bemergedParityTuning.mine.spawnCooldownMoves) return

    const attempts = Math.max(0, Math.floor(dropAttempts))
    if (attempts <= 0) return

    let shouldSpawn = false
    const spawnBonusPercent = this.getActiveUniqueScalar('SD')
    const adjustedSpawnPercent = Math.max(0, bemergedParityTuning.mine.spawnPercentPerDrop + spawnBonusPercent)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if ((this.rng.next() * 100) < adjustedSpawnPercent) {
        shouldSpawn = true
        break
      }
    }
    if (!shouldSpawn) return

    const candidates: Cell[] = []
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const occupiedByMine = this.mines.some(mine => mine.row === row && mine.col === col)
        if (occupiedByMine) continue
        if (this.boss && this.boss.row === row && this.boss.col === col) continue
        candidates.push({ row, col })
      }
    }

    if (candidates.length === 0) return
    const choice = candidates[this.rng.int(candidates.length)]
    this.mines.push({
      row: choice.row,
      col: choice.col,
      movesRemaining: bemergedParityTuning.mine.baseMoves,
      blastRadius: bemergedParityTuning.mine.blastRadius,
    })
    this.lastMineSpawnMove = this.moves
  }

  private trySpawnBoss(preferredRow?: number, preferredCol?: number): void {
    if (this.boss) return
    if (this.moves <= 0 || this.moves % bemergedParityTuning.boss.spawnEveryMoves !== 0) return

    if (Number.isFinite(preferredRow) && Number.isFinite(preferredCol)) {
      const row = Math.max(0, Math.min(BOARD_ROWS - 1, Math.floor(Number(preferredRow))))
      const col = Math.max(0, Math.min(BOARD_COLS - 1, Math.floor(Number(preferredCol))))
      const occupiedByMine = this.mines.some(mine => mine.row === row && mine.col === col)
      if (!occupiedByMine) {
        this.spawnBossAt(row, col)
        return
      }
    }

    const candidates: Cell[] = []
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const occupiedByMine = this.mines.some(mine => mine.row === row && mine.col === col)
        if (!occupiedByMine) {
          candidates.push({ row, col })
        }
      }
    }

    if (candidates.length === 0) return
    const position = candidates[0]
    this.spawnBossAt(position.row, position.col)
  }

  private spawnBossAt(row: number, col: number): void {
    this.bossWaveCount += 1
    this.bossSpawnCount += 1
    const baselineRequiredHits = Math.max(
      1,
      bemergedParityTuning.boss.baseRequiredHits +
        ((this.bossSpawnCount - 1) * bemergedParityTuning.boss.requiredHitsStepPerSpawn),
    )

    const spawnHpReductionPercent = this.getActiveUniqueScalar('SR_CANNON')
    const reducedRequiredHits = Math.max(1, Math.floor(baselineRequiredHits * (1 - (spawnHpReductionPercent / 100))))

    this.bossMaxHits = reducedRequiredHits
    this.bossComboCount = 0
    this.bossAliveMoveCount = 0

    this.boss = {
      row,
      col,
      hitsRemaining: reducedRequiredHits,
      maxHits: reducedRequiredHits,
      comboCount: 0,
      waveCount: this.bossWaveCount,
      destructiveActive: false,
      currentPhase: 1,
      phaseMoveCount: 0,
      totalDestructiveMoves: 0,
      lastDestructiveTick: 0,
      burstCounter: Math.max(1, Math.floor(Number(bemergedParityTuning.boss.burstEveryMoves) || 1)),
    }

    const instantKillChance = this.getActiveUniqueScalar('DP') / 100
    if (instantKillChance > 0 && this.rng.next() < instantKillChance) {
      this.clearBoss()
      return
    }

    this.attachBossRuntimeState()
  }

  private getBossThreatActive(): boolean {
    return !!this.boss && this.bossMoveCount >= this.getBossMoveThresholdWithEffects()
  }

  private findBossPursuitStep(): Cell | null {
    if (!this.boss) return null

    const mineKeys = new Set(this.mines.map(mine => `${mine.row}:${mine.col}`))
    const queue: Array<{ row: number; col: number; firstStep: Cell | null; distance: number }> = [{
      row: this.boss.row,
      col: this.boss.col,
      firstStep: null,
      distance: 0,
    }]
    const visited = new Set<string>([`${this.boss.row}:${this.boss.col}`])
    const directions: Cell[] = [
      { row: -1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
    ]

    let bestTarget: { distance: number; row: number; col: number; firstStep: Cell | null } | null = null
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) break

      const token = this.board[current.row]?.[current.col]
      if (token && isUniqueToken(token)) {
        const candidate = {
          distance: current.distance,
          row: current.row,
          col: current.col,
          firstStep: current.firstStep,
        }
        if (!bestTarget
          || candidate.distance < bestTarget.distance
          || (candidate.distance === bestTarget.distance && (candidate.row < bestTarget.row || (candidate.row === bestTarget.row && candidate.col < bestTarget.col)))) {
          bestTarget = candidate
        }
        continue
      }

      if (bestTarget && current.distance >= bestTarget.distance) continue

      for (const direction of directions) {
        const nextRow = current.row + direction.row
        const nextCol = current.col + direction.col
        if (nextRow < 0 || nextRow >= BOARD_ROWS || nextCol < 0 || nextCol >= BOARD_COLS) continue
        const key = `${nextRow}:${nextCol}`
        if (visited.has(key) || mineKeys.has(key)) continue
        visited.add(key)
        queue.push({
          row: nextRow,
          col: nextCol,
          firstStep: current.firstStep ?? { row: nextRow, col: nextCol },
          distance: current.distance + 1,
        })
      }
    }

    return bestTarget?.firstStep ?? null
  }

  private destroyBossAdjacentCommons(): ModuleToken[] {
    if (!this.boss) return []
    const destroyedTokens: ModuleToken[] = []
    for (const cell of this.getCellsAround(this.boss.row, this.boss.col, 1)) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token || token.rarity !== 'Common') continue
      destroyedTokens.push(token)
      this.recordHazardLoss(token, 'boss')
      this.board[cell.row][cell.col] = null
    }
    return destroyedTokens
  }

  private applyBossTierDecay(radius: number, tierLoss: number, sampledOnly: boolean): ModuleToken[] {
    if (!this.boss) return []

    const candidateCells = this.getCellsAround(this.boss.row, this.boss.col, radius)
    const targetCells = sampledOnly
      ? this.sampleCellsUniformly(candidateCells, bemergedParityTuning.boss.decaySampleCount, this.rng)
      : candidateCells

    const destroyedTokens: ModuleToken[] = []
    const hcMissChance = this.getActiveUniqueScalar('HC') / 100
    let skippedNonCommon = false
    let promotionSaved = false
    for (const cell of targetCells) {
      const token = this.board[cell.row]?.[cell.col]
      if (!token) continue
      if (!skippedNonCommon && hcMissChance > 0 && token.rarity !== 'Common' && this.rng.next() < hcMissChance) {
        skippedNonCommon = true
        continue
      }

      const decayed = this.applyTierLoss(token, tierLoss)
      if (decayed) {
        this.recordHazardImpact(token, decayed, 'boss')
        this.board[cell.row][cell.col] = decayed
        continue
      }

      if (!promotionSaved) {
        const promoted = this.maybePromoteHazardDestroyedToken(token)
        if (promoted !== token) {
          this.board[cell.row][cell.col] = promoted
          promotionSaved = true
          continue
        }
      }

      destroyedTokens.push(token)
      this.recordHazardLoss(token, 'boss')
      this.board[cell.row][cell.col] = null
    }

    return destroyedTokens
  }

  private finalizeBossHazardResolution(destroyedTokens: ModuleToken[]): void {
    if (destroyedTokens.length === 0) return
    for (const token of destroyedTokens) {
      this.addShatterRewards(token, { comboSize: destroyedTokens.length })
    }

    const rareDestroyedCount = destroyedTokens.filter(token => token.rarity === 'Rare').length
    const sfBonusPerRare = this.getActiveUniqueScalar('SF')
    if (sfBonusPerRare > 0 && rareDestroyedCount > 0) {
      this.applyBossDamage(Math.floor(sfBonusPerRare * rareDestroyedCount))
      if (!this.boss) return
    }

    const dropSlots = this.captureDropSlotsForCollapse()
    this.settleSpecialsDown()
    collapse(this.board, () => this.createSpawnToken())
    this.trySpawnMine(dropSlots.length)
    this.settleSpecialsDown()
  }

  private advanceBossSystem(): void {
    this.trySpawnBoss()
    if (!this.boss) return

    const tick = this.moves
    this.bossAliveMoveCount += 1

    const hbPercent = this.getActiveUniqueScalar('HB')
    if (hbPercent > 0 && tick > 0 && tick % 5 === 0 && this.bossMaxHits > 0) {
      this.applyBossDamage(Math.floor(this.bossMaxHits * (hbPercent / 100)))
      if (!this.boss) return
    }

    const destroyedTokens: ModuleToken[] = []
    if (this.getBossThreatActive()) {
      destroyedTokens.push(...this.destroyBossAdjacentCommons())
      destroyedTokens.push(...this.applyBossTierDecay(1, bemergedParityTuning.boss.decayTierLoss, true))
    }

    const moveEveryMoves = Math.max(1, Math.floor(Number(bemergedParityTuning.boss.moveEveryMoves) || 1))
    if (this.bossAliveMoveCount % moveEveryMoves === 0) {
      const nextStep = this.findBossPursuitStep()
      if (nextStep) {
        this.boss.row = nextStep.row
        this.boss.col = nextStep.col
      }
      this.bossMoveCount += 1
    }

    destroyedTokens.push(...this.destroyBossAdjacentCommons())

    const burstEveryMoves = Math.max(1, Math.floor(Number(bemergedParityTuning.boss.burstEveryMoves) || 1))
    if (this.getBossThreatActive() && this.bossMoveCount > 0 && this.bossMoveCount % burstEveryMoves === 0) {
      destroyedTokens.push(...this.applyBossTierDecay(
        bemergedParityTuning.boss.burstRadius,
        bemergedParityTuning.boss.burstTierLoss,
        false,
      ))
    }

    this.attachBossRuntimeState()
    this.finalizeBossHazardResolution(destroyedTokens)
  }

  private captureDropSlotsForCollapse(): Cell[] {
    const drops: Cell[] = []
    for (let col = 0; col < BOARD_COLS; col += 1) {
      let nullCount = 0
      for (let row = 0; row < BOARD_ROWS; row += 1) {
        if (!this.board[row][col]) {
          nullCount += 1
        }
      }

      for (let row = 0; row < nullCount; row += 1) {
        drops.push({ row, col })
      }
    }
    return drops
  }

  private repositionSpecials(): void {
    this.mines = this.mines.filter(mine => mine.row >= 0 && mine.row < BOARD_ROWS && mine.col >= 0 && mine.col < BOARD_COLS)
    if (this.boss && (this.boss.row < 0 || this.boss.row >= BOARD_ROWS || this.boss.col < 0 || this.boss.col >= BOARD_COLS)) {
      this.clearBoss()
    }
  }

  private settleSpecialsDown(): void {
    this.repositionSpecials()

    const occupied = new Set<string>()
    const keyFor = (row: number, col: number): string => `${row}:${col}`

    const sortedMines = [...this.mines].sort((a, b) => b.row - a.row)
    for (const mine of sortedMines) {
      let nextRow = mine.row
      while (
        nextRow + 1 < BOARD_ROWS &&
        !this.board[nextRow + 1][mine.col] &&
        !occupied.has(keyFor(nextRow + 1, mine.col))
      ) {
        nextRow += 1
      }
      mine.row = nextRow
      occupied.add(keyFor(mine.row, mine.col))
    }

    if (this.boss) {
      let nextRow = this.boss.row
      while (
        nextRow + 1 < BOARD_ROWS &&
        !this.board[nextRow + 1][this.boss.col] &&
        !occupied.has(keyFor(nextRow + 1, this.boss.col))
      ) {
        nextRow += 1
      }
      this.boss.row = nextRow
    }
  }

  private getBossDamageForToken(token: ModuleToken): number {
    if (!token) return 0

    let damage = getBossDamageForTokenProgression(token)
    if (token.rarity === 'Rare' && token.plus) {
      damage += Math.max(0, Math.floor(this.getActiveUniqueScalar('AD')))
    }

    if (!this.boss || damage <= 0) return damage

    const perComboPercent = this.getActiveUniqueScalar('AS')
    if (perComboPercent <= 0 || this.bossComboCount <= 0) return damage

    const multiplier = 1 + ((perComboPercent / 100) * this.bossComboCount)
    return Math.max(0, Math.floor(damage * multiplier))
  }
}
