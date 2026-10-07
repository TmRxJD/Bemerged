import { GameEngine } from './GameEngine'
import { createHeadlessModuleCatalog } from './headlessCatalog'
import { SeededRng } from './rng'
import { applyBemergedParityTuningPatch, getBemergedParityTuningSnapshot } from './parityTuning'
import { type AutoplayGoal, type AutoplayRewardBreakdown, BOARD_COLS, BOARD_ROWS, type Cell, type HazardTelemetry, type ModuleToken, type ModuleType, type Move, type ObjectiveProgress, type StrategyTelemetry } from './types'
import { type BemergedScenario, getBemergedScenarioById } from './scenarios'

export type BemergedHeadlessAction = {
  actionId: number
} & (
  {
    type: 'swap'
    fromRow: number
    fromCol: number
    toRow: number
    toCol: number
  }
  | {
    type: 'merge'
    selection: Cell[]
  }
  | {
    type: 'inventory'
    cell: Cell
    slotType: ModuleType
  }
  | {
    type: 'shard-boost'
    boostType: ModuleType
    currentLevel: number
    nextCost: number
    availableShards: number
  }
  | {
    type: 'boss-shatter'
    selection: Cell[]
  }
  | {
    type: 'mine-shatter'
    mine: Cell
    selection: Cell[]
  }
)

export type BemergedHeadlessState = {
  board: number[][]
  inventory: Record<ModuleType, ModuleToken | null>
  boss: {
    hp: number
    phase: number
    waveCount: number
  } | null
  player: {
    moves: number
    score: number
    merges: number
    shatters: number
    shardsByType: {
      Cannon: number
      Armor: number
      Generator: number
      Core: number
    }
  }
  meta: {
    seed: number
    turn: number
    goal: AutoplayGoal
    objective: ObjectiveProgress
    strategy: StrategyTelemetry
  }
}

export type BemergedHeadlessStepResult = {
  nextState: BemergedHeadlessState
  reward: number
  rewardBreakdown: AutoplayRewardBreakdown
  done: boolean
  info: {
    reason: 'objective-complete' | 'max-turns' | 'no-valid-actions' | 'stagnation' | 'invalid-action' | 'continue'
    validActionCount: number
    loopCount: number
    turn: number
    hazard: HazardTelemetry
  }
}

export type BemergedRewardConfig = {
  objectiveWeight: number
  strategyWeight: number
  preservationWeight: number
  bossWeight: number
  shardWeight: number
  inventoryWeight: number
  efficiencyWeight: number
  shardStrategyWeight: number
  timePenalty: number
  stagnationPenalty: number
  antiLoopPenalty: number
}

const MAX_TRAINING_ACTIONS = 8192
const MERGE_ACTION_ALIAS_TARGET = 512

function cloneHeadlessActionWithId(action: BemergedHeadlessAction, actionId: number): BemergedHeadlessAction {
  switch (action.type) {
    case 'swap':
      return {
        actionId,
        type: 'swap',
        fromRow: action.fromRow,
        fromCol: action.fromCol,
        toRow: action.toRow,
        toCol: action.toCol,
      }
    case 'merge':
      return {
        actionId,
        type: 'merge',
        selection: action.selection.map(cell => ({ row: cell.row, col: cell.col })),
      }
    case 'inventory':
      return {
        actionId,
        type: 'inventory',
        cell: { row: action.cell.row, col: action.cell.col },
        slotType: action.slotType,
      }
    case 'shard-boost':
      return {
        actionId,
        type: 'shard-boost',
        boostType: action.boostType,
        currentLevel: action.currentLevel,
        nextCost: action.nextCost,
        availableShards: action.availableShards,
      }
    case 'boss-shatter':
      return {
        actionId,
        type: 'boss-shatter',
        selection: action.selection.map(cell => ({ row: cell.row, col: cell.col })),
      }
    case 'mine-shatter':
      return {
        actionId,
        type: 'mine-shatter',
        mine: { row: action.mine.row, col: action.mine.col },
        selection: action.selection.map(cell => ({ row: cell.row, col: cell.col })),
      }
  }
}

export type BemergedHeadlessResetResult = {
  state: BemergedHeadlessState
  validActions: BemergedHeadlessAction[]
}

type BemergedHeadlessOptions = {
  seed?: number
  goal?: AutoplayGoal
  maxTurns?: number
  scenarioId?: string
  stagnationTurnLimit?: number
  rewardConfig?: Partial<BemergedRewardConfig>
}

const DEFAULT_MAX_TURNS = 800
const DEFAULT_STAGNATION_LIMIT = 25
export const DEFAULT_BEMERGED_REWARD_CONFIG: BemergedRewardConfig = {
  objectiveWeight: 12,
  strategyWeight: 1.5,
  preservationWeight: 4.0,
  bossWeight: 1.6,
  shardWeight: 0.04,
  inventoryWeight: 1.1,
  efficiencyWeight: 0.9,
  shardStrategyWeight: 0.9,
  timePenalty: -0.05,
  stagnationPenalty: -5,
  antiLoopPenalty: -1.2,
}

function encodeTokenToInt(token: unknown): number {
  if (!token || typeof token !== 'object') return 0
  const row = token as Record<string, unknown>
  const type = String(row.type || '')
  const rarity = String(row.rarity || '')
  const plus = Boolean(row.plus)
  const stars = Number(row.stars || 0)

  const typeId = type === 'Cannon'
    ? 1
    : type === 'Armor'
      ? 2
      : type === 'Generator'
        ? 3
        : type === 'Core'
          ? 4
          : 0

  const rarityId = rarity === 'Common'
    ? 1
    : rarity === 'Rare'
      ? 2
      : rarity === 'Epic'
        ? 3
        : rarity === 'Legendary'
          ? 4
          : rarity === 'Mythic'
            ? 5
            : rarity === 'Ancestral'
              ? 6
              : 0

  return (typeId * 100) + (rarityId * 10) + (plus ? 1 : 0) + Math.max(0, Math.min(9, Math.floor(stars)))
}

function buildBoardState(engine: GameEngine): number[][] {
  const board = engine.getBoard()
  const out: number[][] = []

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    const encodedRow: number[] = []
    for (let col = 0; col < BOARD_COLS; col += 1) {
      encodedRow.push(encodeTokenToInt(board[row]?.[col] || null))
    }
    out.push(encodedRow)
  }

  return out
}

function boardHash(board: number[][]): string {
  return board.map(row => row.join(',')).join('|')
}

function clampSignal(value: number, limit: number): number {
  return Number(Math.max(-limit, Math.min(limit, value)).toFixed(3))
}

function toState(engine: GameEngine, input: { seed: number; turn: number; goal: AutoplayGoal }): BemergedHeadlessState {
  const objective = engine.getObjectiveProgress()
  const strategy = engine.getStrategyTelemetry(input.goal)
  const stats = engine.getStats(Math.max(1, input.turn))
  const boss = engine.getBoss()

  return {
    board: buildBoardState(engine),
    inventory: engine.getInventory(),
    boss: boss
      ? {
        hp: boss.hitsRemaining,
        phase: boss.currentPhase,
        waveCount: boss.waveCount,
      }
      : null,
    player: {
      moves: stats.moves,
      score: stats.score,
      merges: stats.merges,
      shatters: stats.shatters,
      shardsByType: {
        Cannon: stats.shardsByType.Cannon,
        Armor: stats.shardsByType.Armor,
        Generator: stats.shardsByType.Generator,
        Core: stats.shardsByType.Core,
      },
    },
    meta: {
      seed: input.seed,
      turn: input.turn,
      goal: input.goal,
      objective,
      strategy,
    },
  }
}

export class BemergedHeadlessEnv {
  private seed: number
  private goal: AutoplayGoal
  private maxTurns: number
  private readonly stagnationTurnLimit: number
  private readonly scenario: BemergedScenario | null
  private engine: GameEngine
  private turn = 0
  private noProgressTurns = 0
  private lastSwapMove: Move | null = null
  private lastAutoplayActionType: BemergedHeadlessAction['type'] | null = null
  private readonly seenStateCounts = new Map<string, number>()
  private readonly initialParitySnapshot = getBemergedParityTuningSnapshot()
  private readonly rewardConfig: BemergedRewardConfig

  constructor(options?: BemergedHeadlessOptions) {
    this.scenario = options?.scenarioId ? getBemergedScenarioById(options.scenarioId) : null
    this.seed = Number.isFinite(Number(options?.seed))
      ? Math.floor(Number(options?.seed))
      : this.scenario?.seed ?? 1337
    this.goal = options?.goal || this.scenario?.goal || 'objective-progress'
    this.maxTurns = Number.isFinite(Number(options?.maxTurns))
      ? Math.max(1, Math.floor(Number(options?.maxTurns)))
      : this.scenario?.maxTurns ?? DEFAULT_MAX_TURNS
    this.stagnationTurnLimit = Number.isFinite(Number(options?.stagnationTurnLimit))
      ? Math.max(5, Math.floor(Number(options?.stagnationTurnLimit)))
      : DEFAULT_STAGNATION_LIMIT
    this.rewardConfig = {
      ...DEFAULT_BEMERGED_REWARD_CONFIG,
      ...(options?.rewardConfig || {}),
    }

    if (this.scenario?.parityPatch) {
      applyBemergedParityTuningPatch(this.scenario.parityPatch)
    }

    this.engine = this.createEngine(this.seed)
    this.trackState()
  }

  getRewardConfig(): BemergedRewardConfig {
    return { ...this.rewardConfig }
  }

  dispose(): void {
    applyBemergedParityTuningPatch(this.initialParitySnapshot)
  }

  reset(seed?: number): BemergedHeadlessResetResult {
    this.turn = 0
    this.noProgressTurns = 0
    this.lastSwapMove = null
    this.lastAutoplayActionType = null
    this.seenStateCounts.clear()

    if (Number.isFinite(Number(seed))) {
      this.seed = Math.floor(Number(seed))
    }

    this.engine = this.createEngine(this.seed)
    this.trackState()

    const state = toState(this.engine, {
      seed: this.seed,
      turn: this.turn,
      goal: this.goal,
    })

    return {
      state,
      validActions: this.get_valid_actions(),
    }
  }

  get_valid_actions(): BemergedHeadlessAction[] {
    const validMoves = this.engine.findValidMoves()
    const actions: BemergedHeadlessAction[] = []

    const mergeSelection = this.engine.chooseAutoplayMergeSelection(this.goal)
    const hasMergeSelection = Boolean(mergeSelection && mergeSelection.length > 1)
    const shatterGate = this.engine.getAutoplayShatterEvaluationGate({ mergeSelection })
    const prioritizeObjectiveMerge = hasMergeSelection && this.goal !== 'max-shards' && this.goal !== 'boss-damage'

    if (hasMergeSelection && mergeSelection) {
      actions.push({
        actionId: actions.length,
        type: 'merge',
        selection: mergeSelection.map(cell => ({ row: cell.row, col: cell.col })),
      })
    }

    for (const boostType of ['Cannon', 'Armor', 'Generator', 'Core'] as const) {
      if (!this.engine.canAffordShardBoost(boostType)) continue
      actions.push({
        actionId: actions.length,
        type: 'shard-boost',
        boostType,
        currentLevel: this.engine.getStats(Math.max(1, this.turn)).shardBoostLevels?.[boostType] || 0,
        nextCost: this.engine.getShardBoostNextCost(boostType),
        availableShards: this.engine.getStats(Math.max(1, this.turn)).shardsByType[boostType] || 0,
      })
    }

    const inventoryAction = this.engine.chooseAutoplayInventoryAction(this.goal)
    if (inventoryAction) {
      actions.push({
        actionId: actions.length,
        type: 'inventory',
        cell: { row: inventoryAction.cell.row, col: inventoryAction.cell.col },
        slotType: inventoryAction.slotType,
      })
    }

    const shatterPlanLimit = prioritizeObjectiveMerge ? 0 : (shatterGate.allow ? 2 : 0)
    const bossShatterPlans = shatterPlanLimit > 0
      ? this.engine.getAutoplayBossShatterPlanCandidates(shatterPlanLimit)
      : []
    for (const selection of bossShatterPlans) {
      actions.push({
        actionId: actions.length,
        type: 'boss-shatter',
        selection: selection.map(cell => ({ row: cell.row, col: cell.col })),
      })
    }

    const mineShatterPlans = shatterPlanLimit > 0
      ? this.engine.getAutoplayMineShatterPlanCandidates(shatterPlanLimit)
      : []
    for (const plan of mineShatterPlans) {
      actions.push({
        actionId: actions.length,
        type: 'mine-shatter',
        mine: { row: plan.mine.row, col: plan.mine.col },
        selection: plan.selection.map(cell => ({ row: cell.row, col: cell.col })),
      })
    }

    const swapOffset = actions.length
    const swapActions = validMoves.map((move, index) => ({
      actionId: swapOffset + index,
      type: 'swap' as const,
      fromRow: move.from.row,
      fromCol: move.from.col,
      toRow: move.to.row,
      toCol: move.to.col,
    }))

    actions.push(...swapActions)

    if (actions.length >= MAX_TRAINING_ACTIONS) {
      return actions.slice(0, MAX_TRAINING_ACTIONS)
    }

    const canonicalActions = actions.slice()
    const canonicalMergeAction = canonicalActions.find(action => action.type === 'merge') || null
    const aliasSources: BemergedHeadlessAction[] = []

    if (canonicalMergeAction) {
      const preferredMergeAliases = Math.min(
        MERGE_ACTION_ALIAS_TARGET,
        Math.max(0, MAX_TRAINING_ACTIONS - canonicalActions.length),
      )
      for (let index = 0; index < preferredMergeAliases; index += 1) {
        aliasSources.push(canonicalMergeAction)
      }
    }

    aliasSources.push(...canonicalActions)

    if (aliasSources.length === 0) {
      return actions
    }

    for (let actionId = canonicalActions.length; actionId < MAX_TRAINING_ACTIONS; actionId += 1) {
      const source = aliasSources[(actionId - canonicalActions.length) % aliasSources.length]
      actions.push(cloneHeadlessActionWithId(source, actionId))
    }

    return actions
  }

  choose_autoplay_action(goal?: AutoplayGoal): number | null {
    const normalizedGoal = goal || this.goal

    const shardBoostType = this.engine.chooseAutoplayShardBoostAction(normalizedGoal)
    if (shardBoostType) {
      const shardBoostCandidate = this.get_valid_actions().find(action =>
        action.type === 'shard-boost' && action.boostType === shardBoostType,
      )
      if (shardBoostCandidate) return shardBoostCandidate.actionId
    }

    if (this.shouldAttemptAutoplayInventoryAction()) {
      const inventoryAction = this.engine.chooseAutoplayInventoryAction(normalizedGoal)
      if (inventoryAction) {
        const inventoryCandidate = this.get_valid_actions().find(action =>
          action.type === 'inventory'
          && action.cell.row === inventoryAction.cell.row
          && action.cell.col === inventoryAction.cell.col
          && action.slotType === inventoryAction.slotType,
        )
        if (inventoryCandidate) return inventoryCandidate.actionId
      }
    }

    const mergeSelection = this.engine.chooseAutoplayMergeSelection(normalizedGoal)
    if (mergeSelection && mergeSelection.length > 1) {
      const mergeCandidate = this.get_valid_actions().find(action => action.type === 'merge')
      if (mergeCandidate) return mergeCandidate.actionId
    }

    const bossShatterCandidate = this.get_valid_actions().find(action => action.type === 'boss-shatter')
    if (bossShatterCandidate) return bossShatterCandidate.actionId

    const mineShatterCandidate = this.get_valid_actions().find(action => action.type === 'mine-shatter')
    if (mineShatterCandidate) return mineShatterCandidate.actionId

    const validActions = this.get_valid_actions()
    const mergeAction = validActions.find(action => action.type === 'merge')
    if (mergeAction) return mergeAction.actionId

    const selectedMove = this.engine.chooseAutoplayMove(normalizedGoal)
    if (!selectedMove) return null

    const match = validActions.find(action =>
      action.type === 'swap'
      &&
      action.fromRow === selectedMove.from.row
      && action.fromCol === selectedMove.from.col
      && action.toRow === selectedMove.to.row
      && action.toCol === selectedMove.to.col,
    )

    return typeof match?.actionId === 'number' ? match.actionId : null
  }

  private shouldAttemptAutoplayInventoryAction(): boolean {
    if (this.lastAutoplayActionType === 'inventory') return false

    const moves = this.engine.getStats(Math.max(1, this.turn + 1)).moves
    if (moves <= 0) return true

    if (moves < 40) {
      return moves % 5 === 0
    }

    return moves % 6 === 0 || this.noProgressTurns >= 4
  }

  step(action: number | BemergedHeadlessAction): BemergedHeadlessStepResult {
    const validActions = this.get_valid_actions()
    if (validActions.length === 0) {
      this.engine.shuffle()
      const state = toState(this.engine, {
        seed: this.seed,
        turn: this.turn,
        goal: this.goal,
      })
      const loopCount = this.trackState()
      const antiLoop = loopCount > 1 ? -Math.min(10, loopCount - 1) : 0
      const timeSignal = Number((this.rewardConfig.timePenalty * 40).toFixed(3))
      const riskSignal = Number(this.rewardConfig.stagnationPenalty.toFixed(3))
      const antiLoopSignal = Number(((this.rewardConfig.antiLoopPenalty * 4) + antiLoop).toFixed(3))
      return {
        nextState: state,
        reward: Number((timeSignal + riskSignal + antiLoopSignal).toFixed(3)),
        rewardBreakdown: {
          objective: 0,
          strategy: 0,
          preservation: 0,
          boss: 0,
          shards: 0,
          inventory: 0,
          efficiency: 0,
          time: timeSignal,
          risk: riskSignal,
          antiLoop: antiLoopSignal,
          total: Number((timeSignal + riskSignal + antiLoopSignal).toFixed(3)),
        },
        done: false,
        info: {
          reason: 'continue',
          validActionCount: this.engine.findValidMoves().length,
          loopCount,
          turn: this.turn,
          hazard: this.engine.consumeAndResetHazardTelemetry(),
        },
      }
    }

    const actionId = typeof action === 'number' ? action : Number(action.actionId)
    const selected = Number.isInteger(actionId)
      ? validActions.find(candidate => Number(candidate.actionId) === actionId)
      : undefined
    const hasMergeActionAvailable = validActions.some(candidate => candidate.type === 'merge')
    if (!Number.isInteger(actionId) || actionId < 0 || !selected) {
      this.turn += 1
      this.noProgressTurns += 1
      const state = toState(this.engine, {
        seed: this.seed,
        turn: this.turn,
        goal: this.goal,
      })
      const loopCount = this.currentLoopCount(state.board)
      const timePenalty = Number((this.rewardConfig.timePenalty * 35).toFixed(3))
      const riskPenalty = Number((this.rewardConfig.stagnationPenalty * 1.8).toFixed(3))
      const antiLoopPenalty = Number(((-Math.abs(this.rewardConfig.antiLoopPenalty) * 3) - Math.min(6, this.noProgressTurns)).toFixed(3))
      return {
        nextState: state,
        reward: Number((timePenalty + riskPenalty + antiLoopPenalty).toFixed(3)),
        rewardBreakdown: {
          objective: 0,
          strategy: 0,
          preservation: 0,
          boss: 0,
          shards: 0,
          inventory: 0,
          efficiency: 0,
          time: timePenalty,
          risk: riskPenalty,
          antiLoop: antiLoopPenalty,
          total: Number((timePenalty + riskPenalty + antiLoopPenalty).toFixed(3)),
        },
        done: false,
        info: {
          reason: 'invalid-action',
          validActionCount: validActions.length,
          loopCount,
          turn: this.turn,
          hazard: this.engine.consumeAndResetHazardTelemetry(),
        },
      }
    }

    this.lastAutoplayActionType = selected.type

    const beforeState = toState(this.engine, {
      seed: this.seed,
      turn: this.turn,
      goal: this.goal,
    })

    this.turn += 1
    let merged = false
    let pingPongPenalty = 0
    if (selected.type === 'shard-boost') {
      this.engine.purchaseShardBoostLevel(selected.boostType)
      merged = false
      this.lastSwapMove = null
    } else if (selected.type === 'inventory') {
      this.engine.applyInventoryActionToSlot(selected.cell, selected.slotType)
      merged = false
      this.lastSwapMove = null
    } else if (selected.type === 'merge') {
      const mergeResult = this.engine.applyMergeSelectionIfReady(selected.selection)
      merged = mergeResult.valid && mergeResult.merged
      this.lastSwapMove = null
    } else if (selected.type === 'boss-shatter') {
      const bossResult = this.engine.applyBossShatterSelection(selected.selection)
      merged = bossResult.valid && bossResult.damage > 0
      this.lastSwapMove = null
    } else if (selected.type === 'mine-shatter') {
      const mineResult = this.engine.applyMineShatterSelection(selected.mine, selected.selection)
      merged = mineResult.valid && mineResult.removed > 0
      this.lastSwapMove = null
    } else {
      const move: Move = {
        from: { row: selected.fromRow, col: selected.fromCol },
        to: { row: selected.toRow, col: selected.toCol },
      }
      if (this.lastSwapMove) {
        const isReverseOfLast = this.lastSwapMove.from.row === move.to.row
          && this.lastSwapMove.from.col === move.to.col
          && this.lastSwapMove.to.row === move.from.row
          && this.lastSwapMove.to.col === move.from.col
        if (isReverseOfLast) {
          pingPongPenalty = -8
        }
      }
      const result = this.engine.applyMove(move)
      merged = result.valid && result.merged
      this.lastSwapMove = move
    }

    let nextState = toState(this.engine, {
      seed: this.seed,
      turn: this.turn,
      goal: this.goal,
    })

    const hazard = this.engine.consumeAndResetHazardTelemetry()
    const completionPercentDelta = nextState.meta.objective.completionPercent - beforeState.meta.objective.completionPercent
    const uniqueStageDelta = (nextState.meta.objective.uniqueStageProgressPercent || 0) - (beforeState.meta.objective.uniqueStageProgressPercent || 0)
    const finalGoalDelta = (nextState.meta.objective.finalGoalCompletionPercent || 0) - (beforeState.meta.objective.finalGoalCompletionPercent || 0)
    const stageProgressDelta = (nextState.meta.objective.stageProgressScore || 0) - (beforeState.meta.objective.stageProgressScore || 0)
    const completedTypeDelta = (nextState.meta.objective.completedTypeCount || 0) - (beforeState.meta.objective.completedTypeCount || 0)
    const completedUniqueDelta = (nextState.meta.objective.completedUniqueMods || 0) - (beforeState.meta.objective.completedUniqueMods || 0)
    const objectiveDelta =
      (completionPercentDelta * 1.8)
      + (uniqueStageDelta * 2.6)
      + (finalGoalDelta * 0.45)
      + (stageProgressDelta * 0.22)
      + (completedTypeDelta * 18)
      + (completedUniqueDelta * 10)
    const mergeReadinessDelta = nextState.meta.strategy.mergeReadinessScore - beforeState.meta.strategy.mergeReadinessScore
    const spawnPrepDelta = nextState.meta.strategy.bossSpawnPreparationScore - beforeState.meta.strategy.bossSpawnPreparationScore
    const hazardMitigationDelta = beforeState.meta.strategy.hazardExposureScore - nextState.meta.strategy.hazardExposureScore
    const fodderDelta = beforeState.meta.strategy.totalFodderDeficit - nextState.meta.strategy.totalFodderDeficit
    const valuableThreatDelta = beforeState.meta.strategy.valuableThreatenedCount - nextState.meta.strategy.valuableThreatenedCount
    const sacrificialThreatDelta = nextState.meta.strategy.sacrificialCommonThreatCount - beforeState.meta.strategy.sacrificialCommonThreatCount
    const inventoryStrategicDelta = nextState.meta.strategy.inventoryStrategicScore - beforeState.meta.strategy.inventoryStrategicScore
    const activeEffectDelta = nextState.meta.strategy.uniqueEffectCount - beforeState.meta.strategy.uniqueEffectCount
    const bossDamageDelta = Math.max(0, (beforeState.boss?.hp || 0) - (nextState.boss?.hp || 0))
    const mergesDelta = Math.max(0, nextState.player.merges - beforeState.player.merges)
    const shattersDelta = Math.max(0, nextState.player.shatters - beforeState.player.shatters)
    const shardTotal = Math.max(0, nextState.player.score - beforeState.player.score)
    const timePenalty = -Math.min(2.5, 0.02 * this.turn)
    const achievedObjectiveProgress = completionPercentDelta > 0 || uniqueStageDelta > 0 || stageProgressDelta > 0 || completedTypeDelta > 0 || completedUniqueDelta > 0
    const selectedShatterAction = selected.type === 'boss-shatter' || selected.type === 'mine-shatter'
    const emptySwapPenalty = selected.type === 'swap' && !merged && !achievedObjectiveProgress && hazardMitigationDelta <= 0 && spawnPrepDelta <= 0
      ? -4.5
      : 0
    const lowValueSwapClearPenalty = selected.type === 'swap'
      && shattersDelta > 0
      && !achievedObjectiveProgress
      && mergeReadinessDelta <= 0
      && hazardMitigationDelta <= 0
      && bossDamageDelta <= 0
      ? -Math.min(28, shattersDelta * 1.35)
      : 0
    const emptyShatterPenalty = shattersDelta > 0 && !achievedObjectiveProgress && bossDamageDelta <= 0 && hazardMitigationDelta <= 0
      ? -Math.min(18, shattersDelta * 1.6)
      : 0
    const shatterOpportunityPenalty = selectedShatterAction && hasMergeActionAvailable
      ? -18
      : 0
    const mergeExecutionBonus = merged ? 4.5 + (mergesDelta * 3.5) : 0
    const shardRewardMultiplier = achievedObjectiveProgress || mergesDelta > 0 || mergeReadinessDelta > 0 || bossDamageDelta > 0
      ? 1
      : selectedShatterAction || (selected.type === 'swap' && shattersDelta > 0)
        ? 0.1
        : 0.35

    const preservationSignal = clampSignal(-(
      (hazard.preservationPenaltyScore * this.rewardConfig.preservationWeight)
      + (hazard.highRarityDestroyedCount * 36)
      + (hazard.highRarityDecayedCount * 22)
      + (hazard.destroyedCount * 7)
      + (hazard.decayedCount * 5.5)
      + (hazard.lostStageScore * 3.4)
    ), 220)
    const strategySignal = clampSignal((
      (mergeReadinessDelta * 0.34)
      + (spawnPrepDelta * 0.12)
      + (hazardMitigationDelta * 0.26)
      + (fodderDelta * 18)
      + (valuableThreatDelta * 28)
      + (sacrificialThreatDelta * 10)
      + emptySwapPenalty
    ) * this.rewardConfig.strategyWeight, 55)
    const inventorySignal = clampSignal((
      (inventoryStrategicDelta * 0.16)
      + (activeEffectDelta * 7)
      + (selected.type === 'inventory' ? 2.5 : 0)
    ) * this.rewardConfig.inventoryWeight, 36)
    const bossSignal = clampSignal((
      (bossDamageDelta * 3.2)
      + (valuableThreatDelta * 6)
      + (sacrificialThreatDelta * 3.5)
    ) * this.rewardConfig.bossWeight, 54)
    let shardStrategyRaw = 0
    if (selected.type === 'shard-boost') {
      if (beforeState.meta.strategy.recommendedShardBoostType === selected.boostType) {
        shardStrategyRaw += 8
      } else {
        shardStrategyRaw -= beforeState.meta.strategy.pfScalar > 0 ? 8 : 4
      }
    } else if (beforeState.meta.strategy.pfScalar > 0 && beforeState.meta.strategy.recommendedShardBoostType === null) {
      const affordableTypes = Object.values(beforeState.meta.strategy.canAffordShardBoost).filter(Boolean).length
      if (affordableTypes > 0) {
        shardStrategyRaw += 2
      }
    }
    shardStrategyRaw += Math.max(0, nextState.meta.strategy.totalShards - beforeState.meta.strategy.totalShards) * 0.02
    const shardStrategySignal = clampSignal(shardStrategyRaw * this.rewardConfig.shardStrategyWeight, 22)
    const efficiencySignal = clampSignal((
      mergeExecutionBonus
      + (mergesDelta * 14)
      + (shattersDelta * (achievedObjectiveProgress || bossDamageDelta > 0 || hazardMitigationDelta > 0 ? 0.8 : 0))
      + (bossDamageDelta * 0.8)
      + lowValueSwapClearPenalty
      + emptyShatterPenalty
      + shatterOpportunityPenalty
    ) * this.rewardConfig.efficiencyWeight, 34)

    const stagnationProgressSignal = objectiveDelta + Math.max(0, strategySignal) + Math.max(0, inventorySignal) + Math.max(0, bossSignal) + Math.max(0, efficiencySignal) + Math.max(0, shardStrategySignal)
    if (stagnationProgressSignal <= 0) {
      this.noProgressTurns += 1
    } else {
      this.noProgressTurns = 0
    }

    let loopCount = this.trackState()
    const antiLoopPenalty = loopCount > 1 ? -Math.min(3, loopCount - 1) : 0

    const rewardBreakdown = {
      objective: clampSignal(objectiveDelta * this.rewardConfig.objectiveWeight, 65),
      strategy: strategySignal,
      preservation: preservationSignal,
      boss: bossSignal,
      shards: Number((shardTotal * this.rewardConfig.shardWeight * shardRewardMultiplier).toFixed(3)),
      inventory: inventorySignal,
      efficiency: efficiencySignal + shardStrategySignal,
      time: Number((timePenalty * Math.abs(this.rewardConfig.timePenalty / -0.05)).toFixed(3)),
      risk: 0,
      antiLoop: Number(((antiLoopPenalty * Math.abs(this.rewardConfig.antiLoopPenalty)) + pingPongPenalty).toFixed(3)),
      total: 0,
    }

    const objectiveComplete = nextState.meta.objective.objectiveComplete
    const maxTurnsReached = this.turn >= this.maxTurns
    const stagnationReached = this.noProgressTurns >= this.stagnationTurnLimit
    const noValidActionsAfter = this.engine.findValidMoves().length === 0

    if (!objectiveComplete && !maxTurnsReached && !stagnationReached && noValidActionsAfter) {
      this.engine.shuffle()
      nextState = toState(this.engine, {
        seed: this.seed,
        turn: this.turn,
        goal: this.goal,
      })
      loopCount = this.trackState()
      rewardBreakdown.antiLoop = Number(((loopCount > 1 ? -Math.min(3, loopCount - 1) : 0) * Math.abs(this.rewardConfig.antiLoopPenalty)).toFixed(3))
    }

    if (stagnationReached) {
      rewardBreakdown.risk = Number(this.rewardConfig.stagnationPenalty.toFixed(3))
    }

    rewardBreakdown.total = Number((
      rewardBreakdown.objective
      + rewardBreakdown.strategy
      + rewardBreakdown.preservation
      + rewardBreakdown.boss
      + rewardBreakdown.shards
      + rewardBreakdown.inventory
      + rewardBreakdown.efficiency
      + rewardBreakdown.time
      + rewardBreakdown.risk
      + rewardBreakdown.antiLoop
    ).toFixed(3))

    const done = objectiveComplete || maxTurnsReached || stagnationReached
    const reason: BemergedHeadlessStepResult['info']['reason'] = objectiveComplete
      ? 'objective-complete'
      : maxTurnsReached
        ? 'max-turns'
        : stagnationReached
          ? 'stagnation'
          : 'continue'

    return {
      nextState,
      reward: rewardBreakdown.total,
      rewardBreakdown,
      done,
      info: {
        reason,
        validActionCount: this.engine.findValidMoves().length,
        loopCount,
        turn: this.turn,
        hazard,
      },
    }
  }

  private createEngine(seed: number): GameEngine {
    const rng = new SeededRng(seed)
    const catalog = createHeadlessModuleCatalog(rng)
    return new GameEngine({
      seed,
      catalog,
    })
  }

  private currentLoopCount(board: number[][]): number {
    return this.seenStateCounts.get(boardHash(board)) || 0
  }

  private trackState(): number {
    const state = toState(this.engine, {
      seed: this.seed,
      turn: this.turn,
      goal: this.goal,
    })
    const hash = boardHash(state.board)
    const nextCount = (this.seenStateCounts.get(hash) || 0) + 1
    this.seenStateCounts.set(hash, nextCount)
    return nextCount
  }
}
