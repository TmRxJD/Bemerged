import Phaser from 'phaser'
import {
  type AutoplayGoal,
  type AutoplayLearningProfile,
  type AutoplayRewardBreakdown,
  type AutoplayStatus,
  BOARD_COLS,
  BOARD_ROWS,
  type Cell,
  type GameStats,
  type ModuleToken,
  type ModuleType,
  type Move,
  TILE_GAP,
  TILE_SIZE,
} from './types'
import { createModuleCatalog } from './catalog'
import { SeededRng } from './rng'
import { GameEngine, type GameEngineRuntimeState } from './GameEngine'
import { getModuleVariantAdornmentText, getUniqueModuleHoverText } from './modulePresentation'
import { bemergedParityTuning } from './parityTuning'
import { BOSS_IMG, MINE_ASSET } from '../assets'
import {
  BEMERGED_AI_COMMANDS,
  type BemergedAiBridgeMode,
  createBemergedAiGovernanceManifest,
} from './aiGovernanceManifest'
import { createSceneGovernanceAdapter } from './aiGovernanceAdapters'
import { type AutoplayRunSummary, type AutoplayStrategyDelta, parseAutoplayRunSummary, scoreAutoplayRunComposite } from './autoplayIntentSchema'
import { AutoplaySearchWidthController } from './autoplaySearchWidthController'
import { extractBemergedStrategyDeltaFromAutoplaySummary } from './aiStrategyDeltaEngine'

const TRACKER_AI_CLOUD_USAGE_LIMIT_EXCEEDED_MESSAGE = 'You have exceeded the allowed usage for cloud AI, please switch to a local model or wait until next month.'

export type BemergedRuntimeState = {
  version: 1
  elapsedSeconds: number
  restartCount: number
  shuffleCharges?: number
  engine: GameEngineRuntimeState
}

type SpecialSnapshot = {
  mines: ReturnType<GameEngine['getMines']>
  boss: ReturnType<GameEngine['getBoss']>
}

type SceneCallbacks = {
  onStats?: (stats: GameStats) => void
  onStatus?: (status: string) => void
  onAutoplay?: (status: AutoplayStatus) => void
  onInventory?: (inventory: Record<ModuleType, ModuleToken | null>) => void
  onSpecials?: (state: { mineCount: number; bossHp: number; bossWave: number; bossPhase: number }) => void
  onRuntimeStateChanged?: (state: BemergedRuntimeState) => void
}

type SceneUiSettings = {
  autoShatterRares?: boolean
  disableHints?: boolean
  hoverDescriptions?: boolean
  enableDevControls?: boolean
  aiDevControls?: boolean
}

type MutablePhaserTimeStep = Phaser.Core.TimeStep & {
  fpsLimit: number
  hasFpsLimit: boolean
  _limitRate: number
  _target: number
  tick?: () => void
}

export type ModelDrivenAutoplayDecisionInput = {
  goal: AutoplayGoal
  allowedActionTypes: ReadonlyArray<ModelDrivenAutoplayDecisionResult['actionType']>
  validMoves: Move[]
  elapsedSeconds: number
  stats: GameStats
  objective: ReturnType<GameEngine['getObjectiveProgress']>
  engineSnapshot: ReturnType<Match3Scene['getEngineSnapshot']>
  candidates: {
    shardBoost: {
      type: ModuleType
      currentLevel: number
      nextCost: number
      availableShards: number
    } | null
    inventoryAction: {
      cell: Cell
      slotType: ModuleType
    } | null
    mergeSelection: {
      base: Cell
      fodders: Cell[]
      totalCells: number
    } | null
    swapMoves: Array<{
      index: number
      from: Cell
      to: Cell
    }>
    bossShatterPlans: Array<{
      index: number
      selection: Cell[]
    }>
    mineShatterPlans: Array<{
      index: number
      mine: Cell
      selection: Cell[]
    }>
    validMoveCount: number
  }
}

export type ModelDrivenAutoplayDecisionResult = {
  actionType: 'swap' | 'merge-selection' | 'inventory' | 'shard-boost' | 'boss-shatter' | 'mine-shatter'
  moveIndex?: number
  bossPlanIndex?: number
  minePlanIndex?: number
  modelId?: string
  explanation?: string
}

export type ModelDrivenAutoplayOutcome = {
  actionType: ModelDrivenAutoplayDecisionResult['actionType']
  moved: boolean
  merged: boolean
  reason: string
  reward: AutoplayRewardBreakdown
  elapsedSeconds: number
  seed?: number
  lastError?: string | null
}

export type ModelDrivenAutoplayDecisionProvider = {
  decide: (input: ModelDrivenAutoplayDecisionInput) => Promise<ModelDrivenAutoplayDecisionResult | null>
  recordOutcome?: (outcome: ModelDrivenAutoplayOutcome) => void
}

export type AutoplayRuntimeTuning = {
  objectiveMergePriority: boolean
  preferClearMove: boolean
  maxSwapCandidates: number
  adaptiveExpansion: boolean
  expandedSwapCandidates: number
  decisionTimeoutMs: number
  restartOnDecisionTimeout: boolean
  decisionTimeoutRestartStreak: number
  restartFrequency: number
  restartOffset: number
  rampGrowthRate: number
  globalBaselineMaxMovesAchieved: number
  currentMoveLimit: number
}

export type AutoplayStepDiagnostics = {
  stepId: number
  timestampMs: number
  strategy: 'model' | 'scripted'
  goal: AutoplayGoal
  candidates: {
    validMoves: number
    swapMoves: number
    expandedSwapMoves: number
    expansionUsed: boolean
    bossPlans: number
    minePlans: number
    hasMergeSelection: boolean
    hasInventoryAction: boolean
    hasShardBoost: boolean
  }
  selectedAction: string
  executedAction: string
  moved: boolean
  merged: boolean
  shuffled: boolean
  reason: string
  fallback?: string | null
  notes?: string | null
}

const TILE_DRAW_SIZE = TILE_SIZE - TILE_GAP
const TILE_FRAME_OVERDRAW = 4
const TILE_ICON_INSET = 12
const TILE_RADIUS = 8
const PREVIEW_BAR_HEIGHT = 72
const PREVIEW_SLOT_SIZE = 44
const PREVIEW_FRAME_INSET = 1
const PREVIEW_ICON_SIZE = 29
const PREVIEW_GAP = 14
const PREVIEW_TEXT_GAP = 18
const AUTOPLAY_ACTION_DELAY_MIN_MS = 50
const AUTOPLAY_ACTION_DELAY_MAX_MS = 3000
const AUTOPLAY_SWAP_CANDIDATES_MIN = 1
const AUTOPLAY_SWAP_CANDIDATES_MAX = 80
const AUTOPLAY_EXPANDED_SWAP_CANDIDATES_MIN = 8
const AUTOPLAY_EXPANDED_SWAP_CANDIDATES_MAX = 256
const AUTOPLAY_DECISION_TIMEOUT_MIN_MS = 1000
const AUTOPLAY_DECISION_TIMEOUT_MAX_MS = 5000
const AUTOPLAY_DECISION_TIMEOUT_RESTART_STREAK_MIN = 1
const AUTOPLAY_DECISION_TIMEOUT_RESTART_STREAK_MAX = 6
const AUTOPLAY_RESTART_FREQUENCY_MIN = 0
const AUTOPLAY_RESTART_FREQUENCY_MAX = 20000
const AUTOPLAY_RESTART_FREQUENCY_MIN_EFFECTIVE = 2
const AUTOPLAY_RESTART_OFFSET_MIN = 0
const AUTOPLAY_RESTART_OFFSET_MAX = 5000
const AUTOPLAY_RAMP_GROWTH_RATE_MIN = 0.02
const AUTOPLAY_RAMP_GROWTH_RATE_MAX = 0.05
const AUTOPLAY_GLOBAL_BASELINE_MOVES_MIN = 1
const AUTOPLAY_GLOBAL_BASELINE_MOVES_MAX = 1000000
const AUTOPLAY_DIAGNOSTICS_HISTORY_LIMIT = 80
const AUTOPLAY_RUN_SUMMARY_HISTORY_LIMIT = 24
const RENDER_ACTIVITY_SETTLE_MS = 240
const HINT_PULSE_INTERVAL_MS = 320
const DEFAULT_ACTIVE_RENDER_FRAME_RATE = 60
const DEFAULT_IDLE_RENDER_FRAME_RATE = 12
const SWAP_ANIMATION_DURATION_MS = 180
const CLEAR_ANIMATION_DURATION_MS = 220
const CLEAR_ANIMATION_STAGGER_MS = 22
const PLUS_BADGE_SIZE = 18
const HAZARD_EXPLOSION_RING_ALPHA = 0.9
const BOSS_KILL_ANIMATION_MS = 980
const MINE_EXPLOSION_ANIMATION_MS = 720

function parseSeed(): number {
  try {
    const params = new URLSearchParams(window.location.search)
    const value = Number(params.get('seed'))
    if (Number.isFinite(value)) return Math.floor(value)
  } catch {
    return 1337
  }
  return 1337
}

export class Match3Scene extends Phaser.Scene {
  private readonly renderResolution: number
  private readonly activeFrameRate: number
  private readonly idleFrameRate: number
  private readonly seed = parseSeed()
  private readonly rng = new SeededRng(this.seed)
  private readonly catalog = createModuleCatalog(this.rng)
  private readonly engine = new GameEngine({
    seed: this.seed,
    catalog: this.catalog,
  })

  private selected: Cell | null = null
  private mineShatterMode: { mine: Cell; armedAtMs: number } | null = null
  private bossComboMode: { lockedType: ModuleType | null; selection: Cell[] } | null = null
  private hintMove: Move | null = null
  private hintCycleIndex = -1
  private hintPulsePhase: 0 | 1 = 0
  private hintPulseTimer: Phaser.Time.TimerEvent | null = null
  private hintAutoClearTimer: Phaser.Time.TimerEvent | null = null
  private idleHintTimer: Phaser.Time.TimerEvent | null = null
  private lastMoveActivityAtMs = Date.now()
  private nextIdleHintAtMs = Date.now() + 10000
  private autoHintVisible = false
  private hintsDisabled = false
  private hoverDescriptionsEnabled = true
  private aiDevControlsEnabled = false
  private aiGovernanceMode: BemergedAiBridgeMode = 'normal'
  private layer!: Phaser.GameObjects.Layer
  private callbacks: SceneCallbacks = {}
  private startMs = Date.now()
  private paused = false
  private pausedStartedAtMs: number | null = null
  private totalPausedMs = 0
  private restartCount = 0
  private shuffleCharges = 3
  private lastBossesKilled = 0
  private resolving = false
  private initialRuntimeState: BemergedRuntimeState | null = null
  private sceneReady = false
  private currentRenderFrameRate = 0
  private renderActivityUntilMs = 0
  private renderActivityTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private activeCascadeTweenCount = 0
  private externalWakeTarget: EventTarget | null = null
  private externalWakeHandler: ((event: Event) => void) | null = null

  private aiTimer: Phaser.Time.TimerEvent | null = null
  private autoplayTickInFlight = false
  private autoplayDecisionProvider: ModelDrivenAutoplayDecisionProvider | null = null
  private autoplayTuning: AutoplayRuntimeTuning = {
    objectiveMergePriority: true,
    preferClearMove: true,
    maxSwapCandidates: 10,
    adaptiveExpansion: true,
    expandedSwapCandidates: 16,
    decisionTimeoutMs: 5_000,
    restartOnDecisionTimeout: true,
    decisionTimeoutRestartStreak: 1,
    restartFrequency: 0,
    restartOffset: 0,
    rampGrowthRate: 0.03,
    globalBaselineMaxMovesAchieved: 10,
    currentMoveLimit: 10,
  }
  private readonly autoplaySearchWidthController = new AutoplaySearchWidthController()
  private autoplayDiagnosticsStepId = 0
  private lastAutoplayDiagnostics: AutoplayStepDiagnostics | null = null
  private autoplayDiagnosticsHistory: AutoplayStepDiagnostics[] = []
  private autoplayRunId = 0
  private autoplayCurrentRunContext: {
    runId: number
    startedAtMs: number
    startStepId: number
    baselineMovesExecuted: number
    baselineMergesExecuted: number
    baselineScore: number
    timeoutEvents: number
    forcedRestarts: number
    indecisionReasons: string[]
  } | null = null
  private lastAutoplayRunSummary: AutoplayRunSummary | null = null
  private autoplayRunSummaryHistory: AutoplayRunSummary[] = []
  private lastAutoplayRunCompositeScore: number | null = null
  private lastAutoplayActionType: 'swap' | 'merge' | 'inventory' | 'shard' | 'boss' | 'mine' | null = null
  private autoplayNoMoveStreak = 0
  private autoplayDecisionTimeoutStreak = 0
  private aiStatus: AutoplayStatus = {
    active: false,
    delayMs: 250,
    goal: 'objective-progress',
    testingMode: false,
    movesExecuted: 0,
    mergesExecuted: 0,
    validMoveCount: 0,
    lastDecision: null,
    lastReward: null,
    elapsedSeconds: 0,
    lastError: null,
  }
  private longPressTimer: Phaser.Time.TimerEvent | null = null
  private pointerDownCell: Cell | null = null
  private longPressTriggered = false
  private pendingTextureLoads = new Set<string>()
  private failedTextureLoads = new Set<string>()

  constructor(
    renderResolution = 1,
    activeFrameRate = DEFAULT_ACTIVE_RENDER_FRAME_RATE,
    idleFrameRate = DEFAULT_IDLE_RENDER_FRAME_RATE,
  ) {
    super('bemerged-match3')
    this.renderResolution = Number.isFinite(renderResolution) && renderResolution > 1
      ? renderResolution
      : 1
    this.activeFrameRate = Math.max(4, Math.floor(Number(activeFrameRate) || DEFAULT_ACTIVE_RENDER_FRAME_RATE))
    this.idleFrameRate = Math.max(
      1,
      Math.min(this.activeFrameRate, Math.floor(Number(idleFrameRate) || DEFAULT_IDLE_RENDER_FRAME_RATE)),
    )
  }

  setCallbacks(callbacks: SceneCallbacks): void {
    this.callbacks = callbacks
  }

  setUiSettings(settings: SceneUiSettings): void {
    this.engine.setAutoShatterRares(!!settings.autoShatterRares)
    this.hintsDisabled = !!settings.disableHints
    this.hoverDescriptionsEnabled = settings.hoverDescriptions !== false
    this.aiDevControlsEnabled = !!settings.enableDevControls && !!settings.aiDevControls
    if (this.hintsDisabled) {
      this.setHintMove(null, { source: 'system' })
      if (this.sceneReady) {
        this.renderBoard()
      }
    }
    if (!this.hoverDescriptionsEnabled && this.sceneReady) {
      this.game.canvas.removeAttribute('title')
    }
  }

  debugSpawnBoss(cell?: Cell, options?: { replaceExisting?: boolean }): ReturnType<GameEngine['getBoss']> {
    const boss = this.engine.debugSpawnBoss(cell, options)
    this.renderBoard()
    this.emitStats()
    return boss
  }

  debugAddMine(cell?: Cell, overrides?: { movesRemaining?: number; blastRadius?: number }): ReturnType<GameEngine['getMines']>[number] | null {
    const mine = this.engine.debugAddMine(cell, overrides)
    this.renderBoard()
    this.emitStats()
    return mine
  }

  debugSnapshot(): ReturnType<GameEngine['debugSnapshot']> {
    return this.engine.debugSnapshot()
  }

  debugPreviewBossCombo(selection: Cell[]): ReturnType<GameEngine['previewBossShatterSelection']> {
    return this.engine.previewBossShatterSelection(selection)
  }

  debugApplyBossCombo(selection: Cell[]): ReturnType<GameEngine['applyBossShatterSelection']> {
    const bossBefore = this.engine.getBoss()
    const result = this.engine.applyBossShatterSelection(selection)
    const bossAfter = this.engine.getBoss()
    this.bossComboMode = null
    this.mineShatterMode = null
    this.renderBoard()
    this.emitStats()
    if (result.valid && bossBefore) {
      if (!bossAfter) {
        void this.playBossKillAnimation({ row: bossBefore.row, col: bossBefore.col })
      } else {
        void this.playBossHitAnimation({ row: bossBefore.row, col: bossBefore.col }, result.damage)
      }
    }
    return result
  }

  debugTriggerMine(cell: Cell): ReturnType<GameEngine['applyMineShatterSelection']> {
    const mineBefore = this.engine.getMines().find(mine => mine.row === cell.row && mine.col === cell.col) || null
    const result = this.engine.applyMineShatterSelection(cell, [])
    this.mineShatterMode = null
    this.renderBoard()
    this.emitStats()
    if (result.valid && mineBefore) {
      void this.playMineExplosionAnimation({ row: mineBefore.row, col: mineBefore.col }, mineBefore.blastRadius)
    }
    return result
  }

  setAiGovernanceMode(mode: BemergedAiBridgeMode): void {
    this.aiGovernanceMode = mode === 'dev' ? 'dev' : 'normal'
  }

  setInitialRuntimeState(state: BemergedRuntimeState | null): void {
    this.initialRuntimeState = state
  }

  preload(): void {
    for (const entry of this.catalog.allAssetEntries) {
      const key = entry.key
      if (!this.textures.exists(key)) {
        this.load.image(key, entry.url)
      }
    }

    if (!this.textures.exists('boss-overlay')) {
      this.load.image('boss-overlay', String(BOSS_IMG))
    }
    if (!this.textures.exists('mine-overlay')) {
      this.load.image('mine-overlay', String(MINE_ASSET))
    }
  }

  create(): void {
    this.sceneReady = true
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanupRenderCadenceBindings()
    })
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.cleanupRenderCadenceBindings()
    })
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)')
    if (this.renderResolution > 1) {
      this.cameras.main.setZoom(this.renderResolution)
      this.cameras.main.roundPixels = false
    }
    this.layer = this.add.layer()
    this.bindExternalRenderWake()

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerDown(pointer)
    })
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      void this.handlePointerUp(pointer)
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerHover(pointer)
    })
    this.input.on('gameout', () => {
      this.clearLongPressTracking()
      this.game.canvas.removeAttribute('title')
    })

    this.input.mouse?.disableContextMenu()

    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      const key = String((file as { key?: string })?.key || '')
      if (!key) return
      this.pendingTextureLoads.delete(key)
      this.failedTextureLoads.add(key)
    })

    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.emitStats()
        this.emitRuntimeStateChanged()
      },
    })

    if (this.initialRuntimeState) {
      const restored = this.engine.importRuntimeState(this.initialRuntimeState.engine)
      if (restored) {
        const elapsedSeconds = Math.max(1, Math.floor(Number(this.initialRuntimeState.elapsedSeconds) || 1))
        this.startMs = Date.now() - (elapsedSeconds * 1000)
        this.restartCount = Math.max(0, Math.floor(Number(this.initialRuntimeState.restartCount) || 0))
        this.shuffleCharges = Math.max(0, Math.floor(Number(this.initialRuntimeState.shuffleCharges) || 3))
        this.lastBossesKilled = this.engine.getStats(elapsedSeconds).bossesKilled
      }
      this.initialRuntimeState = null
    }

    this.renderBoard()
    this.emitInventory()
    this.emitStatus('Ready')
    this.emitStats()
    this.emitAutoplayStatus()
    this.startIdleHintWatcher()
    this.emitRuntimeStateChanged()
    this.requestRenderActivity(800, true)
  }

  restartBoard(reason = 'manual-restart'): void {
    this.finalizeAutoplayRunSummary(reason)
    this.restartCount += 1
    this.startMs = Date.now()
    this.totalPausedMs = 0
    this.pausedStartedAtMs = null
    this.paused = false
    this.shuffleCharges = 3
    this.lastBossesKilled = 0
    this.engine.restart(this.seed + this.restartCount)
    this.selected = null
    this.engine.cancelMergeSession()
    this.mineShatterMode = null
    this.bossComboMode = null
    this.setHintMove(null)
    this.hintCycleIndex = -1
    this.renderBoard()
    this.emitInventory()
    this.emitStats()
    this.emitStatus('Restarted')
    this.emitRuntimeStateChanged()
    this.autoplayDecisionTimeoutStreak = 0
    if (this.aiStatus.active) {
      this.ensureAutoplayRunContext(true)
    }
  }

  shuffleBoard(): boolean {
    if (this.paused || this.shuffleCharges <= 0) return false
    this.shuffleCharges = Math.max(0, this.shuffleCharges - 1)
    this.engine.shuffle()
    this.selected = null
    this.engine.cancelMergeSession()
    this.mineShatterMode = null
    this.bossComboMode = null
    this.setHintMove(null)
    this.hintCycleIndex = -1
    this.renderBoard()
    this.emitStats()
    this.emitStatus('Shuffled')
    this.emitRuntimeStateChanged()
    return true
  }

  togglePaused(): boolean {
    this.paused = !this.paused
    if (this.paused) {
      this.pausedStartedAtMs = Date.now()
      this.clearLongPressTracking()
      this.game.canvas.setAttribute('title', 'Paused')
    } else if (this.pausedStartedAtMs != null) {
      this.totalPausedMs += Date.now() - this.pausedStartedAtMs
      this.pausedStartedAtMs = null
      this.game.canvas.removeAttribute('title')
    }
    this.emitStats()
    this.emitRuntimeStateChanged()
    return this.paused
  }

  isPaused(): boolean {
    return this.paused
  }

  getShuffleCharges(): number {
    return this.shuffleCharges
  }

  showHint(): Move | null {
    if (this.paused) return null
    this.recordInteractionActivity()
    if (this.hintsDisabled) {
      this.setHintMove(null, { source: 'system' })
      this.renderBoard()
      this.emitStatus('Hints disabled in settings')
      return null
    }

    const hintMoves = this.engine.findHintMoves()
    if (hintMoves.length === 0) {
      this.setHintMove(null)
      this.hintCycleIndex = -1
      this.renderBoard()
      this.emitStatus('No valid moves')
      return null
    }

    const currentKey = this.hintMove
      ? `${this.hintMove.from.row}:${this.hintMove.from.col}:${this.hintMove.to.row}:${this.hintMove.to.col}`
      : null
    const currentIndex = currentKey
      ? hintMoves.findIndex(move => `${move.from.row}:${move.from.col}:${move.to.row}:${move.to.col}` === currentKey)
      : -1
    const baseIndex = currentIndex >= 0 ? currentIndex : this.hintCycleIndex
    const nextIndex = (baseIndex + 1 + hintMoves.length) % hintMoves.length
    const hint = hintMoves[nextIndex]
    this.hintCycleIndex = nextIndex
    this.setHintMove(hint, { pulseToggles: 6, source: 'manual' })
    this.renderBoard()
    this.emitStatus(hint ? 'Hint highlighted' : 'No valid moves')
    return hint
  }

  startAutoplay(options?: { delayMs?: number; testingMode?: boolean; goal?: AutoplayGoal | string }): AutoplayStatus {
    if (this.paused) {
      return this.getAutoplayStatus()
    }
    const sceneManifest = createBemergedAiGovernanceManifest({
      mode: this.aiGovernanceMode,
      aiDevControlsEnabled: this.aiDevControlsEnabled,
    })
    const sceneAdapter = createSceneGovernanceAdapter(sceneManifest)
    const delayMs = sceneAdapter.clampDelayMs(options?.delayMs, this.aiStatus.delayMs)
    const testingMode = sceneAdapter.enforceTestingMode(options?.testingMode)
    const goal = options?.goal == null
      ? 'objective-progress'
      : this.engine.normalizeAutoplayGoal(options?.goal)

    this.stopAutoplay('stopped')
    this.lastAutoplayActionType = null
    this.autoplayNoMoveStreak = 0
    this.autoplayDecisionTimeoutStreak = 0
    this.autoplayTuning.currentMoveLimit = this.resolveAutoplayStartingMoveLimit()
    this.ensureAutoplayRunContext(true)

    this.aiStatus = {
      ...this.aiStatus,
      active: true,
      delayMs,
      goal,
      testingMode,
      validMoveCount: this.engine.findValidMoves().length,
      lastDecision: 'start',
      elapsedSeconds: this.getElapsedSeconds(),
      lastError: null,
    }

    this.aiTimer = this.time.addEvent({
      delay: delayMs,
      loop: true,
      callback: () => {
        void this.tickAutoplay()
      },
    })

    this.requestRenderActivity(Math.max(600, delayMs + 120), true)

    this.emitStatus(`AI running (${delayMs}ms, goal: ${goal})`)
    this.emitAutoplayStatus()

    void this.tickAutoplay()

    return this.getAutoplayStatus()
  }

  stopAutoplay(status = 'AI stopped'): AutoplayStatus {
    if (this.aiTimer) {
      this.aiTimer.remove(false)
      this.aiTimer = null
    }
    this.autoplayTickInFlight = false

    this.aiStatus = {
      ...this.aiStatus,
      active: false,
      validMoveCount: this.engine.findValidMoves().length,
      lastDecision: 'stop',
      elapsedSeconds: this.getElapsedSeconds(),
    }

    this.emitStatus(status)
    this.emitAutoplayStatus()
    this.autoplayNoMoveStreak = 0
    this.autoplayDecisionTimeoutStreak = 0
    this.finalizeAutoplayRunSummary('stopped')
    this.scheduleRenderIdleCheck(RENDER_ACTIVITY_SETTLE_MS)
    return this.getAutoplayStatus()
  }

  getAutoplayStatus(): AutoplayStatus {
    return { ...this.aiStatus }
  }

  getEngineSnapshot(options?: {
    validMoves?: Move[]
    elapsedSeconds?: number
    stats?: GameStats
    objective?: ReturnType<GameEngine['getObjectiveProgress']>
  }): Record<string, unknown> {
    const board = this.engine.getBoard()
    const mines = this.engine.getMines()
    const boss = this.engine.getBoss()
    const validMoves = options?.validMoves || this.engine.findValidMoves()
    const elapsedSeconds = Number.isFinite(Number(options?.elapsedSeconds))
      ? Math.max(1, Math.floor(Number(options?.elapsedSeconds)))
      : this.getElapsedSeconds()
    const stats = options?.stats || this.engine.getStats(elapsedSeconds)
    const objective = options?.objective || this.engine.getObjectiveProgress()

    const manifest = createBemergedAiGovernanceManifest({
      mode: this.aiGovernanceMode,
      aiDevControlsEnabled: this.aiDevControlsEnabled,
    })

    return {
      seed: this.seed,
      elapsedSeconds,
      stats,
      inventory: this.engine.getInventory(),
      mines,
      boss,
      validMoveCount: validMoves.length,
      hintMove: this.engine.findHint() || null,
      validActions: validMoves.map((move, index) => ({
        id: index,
        type: 'swap',
        from: move.from,
        to: move.to,
      })),
      objective,
      autoplayCapabilities: {
        goals: manifest.goals,
        actions: {
          primary: manifest.actions.runtimeAllowed,
          runtimeAllowed: manifest.actions.runtimeAllowed,
          plannerVisible: manifest.actions.plannerVisible,
          availableCommands: BEMERGED_AI_COMMANDS,
        },
        strictGuardrails: manifest.strictGuardrails,
      },
      board: board.map((row, rowIndex) => row.map((cell, colIndex) => {
        if (!cell) return null
        return {
          row: rowIndex,
          col: colIndex,
          templateId: cell.templateId,
          type: cell.type,
          rarity: cell.rarity,
          plus: !!cell.plus,
          matchKey: cell.matchKey,
        }
      })),
      autoplay: this.getAutoplayStatus(),
    }
  }

  getObjectiveProgress() {
    return this.engine.getObjectiveProgress()
  }

  getAutoplayGoals(): ReadonlyArray<AutoplayGoal> {
    return this.engine.getAutoplayGoals()
  }

  setAutoplayLearningProfile(profile?: Partial<AutoplayLearningProfile> | null): void {
    this.engine.setAutoplayLearningProfile(profile)
  }

  setAutoplayDecisionProvider(provider: ModelDrivenAutoplayDecisionProvider | null): void {
    this.autoplayDecisionProvider = provider
  }

  getAutoplayLearningProfile(): AutoplayLearningProfile {
    return this.engine.getAutoplayLearningProfile()
  }

  getAutoplayTuning(): AutoplayRuntimeTuning {
    return { ...this.autoplayTuning }
  }

  setAutoplayTuningPatch(patch?: Partial<AutoplayRuntimeTuning> | null): AutoplayRuntimeTuning {
    if (!patch || typeof patch !== 'object') {
      return this.getAutoplayTuning()
    }

    const next: AutoplayRuntimeTuning = { ...this.autoplayTuning }
    if (typeof patch.objectiveMergePriority === 'boolean') {
      next.objectiveMergePriority = patch.objectiveMergePriority
    }
    if (typeof patch.preferClearMove === 'boolean') {
      next.preferClearMove = patch.preferClearMove
    }
    if (Number.isFinite(Number(patch.maxSwapCandidates))) {
      next.maxSwapCandidates = Math.max(
        AUTOPLAY_SWAP_CANDIDATES_MIN,
        Math.min(AUTOPLAY_SWAP_CANDIDATES_MAX, Math.floor(Number(patch.maxSwapCandidates))),
      )
    }
    if (typeof patch.adaptiveExpansion === 'boolean') {
      next.adaptiveExpansion = patch.adaptiveExpansion
    }
    if (Number.isFinite(Number(patch.expandedSwapCandidates))) {
      next.expandedSwapCandidates = Math.max(
        AUTOPLAY_EXPANDED_SWAP_CANDIDATES_MIN,
        Math.min(AUTOPLAY_EXPANDED_SWAP_CANDIDATES_MAX, Math.floor(Number(patch.expandedSwapCandidates))),
      )
    }
    if (Number.isFinite(Number(patch.decisionTimeoutMs))) {
      next.decisionTimeoutMs = Math.max(
        AUTOPLAY_DECISION_TIMEOUT_MIN_MS,
        Math.min(AUTOPLAY_DECISION_TIMEOUT_MAX_MS, Math.floor(Number(patch.decisionTimeoutMs))),
      )
    }
    if (typeof patch.restartOnDecisionTimeout === 'boolean') {
      next.restartOnDecisionTimeout = patch.restartOnDecisionTimeout
    }
    if (Number.isFinite(Number(patch.decisionTimeoutRestartStreak))) {
      next.decisionTimeoutRestartStreak = Math.max(
        AUTOPLAY_DECISION_TIMEOUT_RESTART_STREAK_MIN,
        Math.min(AUTOPLAY_DECISION_TIMEOUT_RESTART_STREAK_MAX, Math.floor(Number(patch.decisionTimeoutRestartStreak))),
      )
    }
    if (Number.isFinite(Number(patch.restartFrequency))) {
      next.restartFrequency = Math.max(
        AUTOPLAY_RESTART_FREQUENCY_MIN,
        Math.min(AUTOPLAY_RESTART_FREQUENCY_MAX, Math.floor(Number(patch.restartFrequency))),
      )
    }
    if (Number.isFinite(Number(patch.restartOffset))) {
      next.restartOffset = Math.max(
        AUTOPLAY_RESTART_OFFSET_MIN,
        Math.min(AUTOPLAY_RESTART_OFFSET_MAX, Math.floor(Number(patch.restartOffset))),
      )
    }
    if (Number.isFinite(Number(patch.rampGrowthRate))) {
      next.rampGrowthRate = Math.max(
        AUTOPLAY_RAMP_GROWTH_RATE_MIN,
        Math.min(AUTOPLAY_RAMP_GROWTH_RATE_MAX, Number(patch.rampGrowthRate)),
      )
    }
    if (Number.isFinite(Number(patch.globalBaselineMaxMovesAchieved))) {
      next.globalBaselineMaxMovesAchieved = Math.max(
        AUTOPLAY_GLOBAL_BASELINE_MOVES_MIN,
        Math.min(AUTOPLAY_GLOBAL_BASELINE_MOVES_MAX, Math.floor(Number(patch.globalBaselineMaxMovesAchieved))),
      )
    }

    next.currentMoveLimit = this.resolveAutoplayStartingMoveLimit(next)

    this.autoplayTuning = next
    return this.getAutoplayTuning()
  }

  getAutoplayDiagnosticsSnapshot(): {
    tuning: AutoplayRuntimeTuning
    lastStep: AutoplayStepDiagnostics | null
    recentSteps: AutoplayStepDiagnostics[]
    runSummary: {
      current: AutoplayRunSummary | null
      lastCompleted: AutoplayRunSummary | null
      recentCompleted: AutoplayRunSummary[]
      lastCompositeScore: number | null
    }
  } {
    return {
      tuning: this.getAutoplayTuning(),
      lastStep: this.lastAutoplayDiagnostics ? { ...this.lastAutoplayDiagnostics } : null,
      recentSteps: this.autoplayDiagnosticsHistory.map(step => ({ ...step })),
      runSummary: {
        current: this.buildAutoplayRunSummary(),
        lastCompleted: this.lastAutoplayRunSummary ? { ...this.lastAutoplayRunSummary } : null,
        recentCompleted: this.autoplayRunSummaryHistory.map(summary => ({ ...summary })),
        lastCompositeScore: this.lastAutoplayRunCompositeScore,
      },
    }
  }

  async runAutoplayStep(options?: { goal?: AutoplayGoal | string }): Promise<{ moved: boolean; merged: boolean; shuffled: boolean; reason: string }> {
    if (this.paused) {
      return { moved: false, merged: false, shuffled: false, reason: 'paused' }
    }
    if (this.resolving) {
      return { moved: false, merged: false, shuffled: false, reason: 'resolving' }
    }

    const goal = this.engine.normalizeAutoplayGoal(options?.goal || this.aiStatus.goal)
    this.ensureAutoplayRunContext()
    const stepId = this.autoplayDiagnosticsStepId + 1
    this.autoplayDiagnosticsStepId = stepId
    const beforeElapsedSeconds = this.getElapsedSeconds()
    const beforeStats = this.engine.getStats(beforeElapsedSeconds)
    const beforeObjective = this.engine.getObjectiveProgress()
    const actionDelayMs = this.getAutoplayActionDelayMs()

    if (this.autoplayDecisionProvider) {
      const sceneManifest = createBemergedAiGovernanceManifest({
        mode: this.aiGovernanceMode,
        aiDevControlsEnabled: this.aiDevControlsEnabled,
      })
      const sceneAdapter = createSceneGovernanceAdapter(sceneManifest)
      const allowedActionTypes = sceneAdapter.allowedActionTypes()
      const allowMergeSelection = allowedActionTypes.includes('merge-selection')
      const allowInventory = allowedActionTypes.includes('inventory')
      const allowShardBoost = allowedActionTypes.includes('shard-boost')
      const allowBossShatter = allowedActionTypes.includes('boss-shatter')
      const allowMineShatter = allowedActionTypes.includes('mine-shatter')

      const validMoves = this.engine.findValidMoves()
      const searchWidth = this.autoplaySearchWidthController.recommend({
        fastLimit: this.autoplayTuning.maxSwapCandidates,
        expandedLimit: this.autoplayTuning.expandedSwapCandidates,
        adaptiveExpansion: this.autoplayTuning.adaptiveExpansion,
        timeoutStreak: this.autoplayDecisionTimeoutStreak,
      })
      const fastSwapCandidates = this.engine.getAutoplaySwapCandidates(validMoves, searchWidth.fastLimit)
      let orderedSwapMoves = fastSwapCandidates
      const shouldEvaluateShatter = allowBossShatter || allowMineShatter

      const shouldConsiderMergeSelection = allowMergeSelection || shouldEvaluateShatter
      let mergeSelection: Cell[] | null | undefined
      const getMergeSelection = (): Cell[] | null => {
        if (mergeSelection !== undefined) return mergeSelection
        mergeSelection = shouldConsiderMergeSelection
          ? this.engine.chooseAutoplayMergeSelection(goal)
          : null
        return mergeSelection
      }

      const shardBoostType = allowShardBoost
        ? this.engine.chooseAutoplayShardBoostAction(goal)
        : null
      const inventoryAction = (allowInventory && this.shouldAttemptAutoplayInventoryAction(beforeStats.moves))
        ? this.engine.chooseAutoplayInventoryAction(goal)
        : null

      const shatterGate = shouldEvaluateShatter
        ? this.engine.getAutoplayShatterEvaluationGate({
          mergeSelection: getMergeSelection(),
        })
        : {
          allow: false,
          reason: 'shatter-actions-disabled',
          commonRatio: 0,
        }
      const bossShatterPlans = (allowBossShatter && shatterGate.allow)
        ? this.engine.getAutoplayBossShatterPlanCandidates(6)
        : []
      const mineShatterPlans = (allowMineShatter && shatterGate.allow)
        ? this.engine.getAutoplayMineShatterPlanCandidates(6)
        : []

      if (validMoves.length === 0) {
        this.autoplayNoMoveStreak += 1
        let shuffled = false
        if (this.autoplayNoMoveStreak >= 2) {
          shuffled = this.shuffleBoard()
        } else {
          this.emitStatus('AI model is searching for a valid move...')
        }

        const afterElapsedSeconds = this.getElapsedSeconds()
        const afterStats = this.engine.getStats(afterElapsedSeconds)
        const afterObjective = this.engine.getObjectiveProgress()
        this.aiStatus = {
          ...this.aiStatus,
          goal,
          validMoveCount: this.engine.findValidMoves().length,
          lastDecision: 'ai:no-valid-move',
          lastReward: this.buildRewardBreakdown({
            beforeStats,
            afterStats,
            beforeObjective,
            afterObjective,
            beforeElapsedSeconds,
            afterElapsedSeconds,
            merged: false,
            shuffled,
          }),
          elapsedSeconds: this.getElapsedSeconds(),
        }
        this.emitAutoplayStatus()
        return {
          moved: false,
          merged: false,
          shuffled,
          reason: shuffled ? 'ai-no-move-shuffle' : 'ai-no-move-retry',
        }
      }

      let expandedSwapMovesCount = 0
      let expansionUsed = false
      const fastCoverageRatio = validMoves.length > 0
        ? (fastSwapCandidates.length / validMoves.length)
        : 1
      const shouldExpandSwapSearch = searchWidth.allowExpansion
        && !((getMergeSelection()?.length || 0) > 1)
        && fastCoverageRatio < 0.35
        && validMoves.length > (fastSwapCandidates.length + 3)

      if (shouldExpandSwapSearch) {
        const expandedSwapCandidates = this.engine.getAutoplaySwapCandidates(validMoves, searchWidth.expandedLimit)
        expandedSwapMovesCount = expandedSwapCandidates.length
        if (expandedSwapCandidates.length > orderedSwapMoves.length) {
          expansionUsed = true
          const seen = new Set<string>()
          const mergedCandidates: Move[] = []
          for (const move of [...orderedSwapMoves, ...expandedSwapCandidates]) {
            const key = `${move.from.row}:${move.from.col}:${move.to.row}:${move.to.col}`
            if (seen.has(key)) continue
            seen.add(key)
            mergedCandidates.push(move)
          }
          orderedSwapMoves = mergedCandidates
        }
      }

      const plannerSwapLimit = Math.max(2, Math.min(4, Math.floor(Number(searchWidth.fastLimit) || 2)))
      const swapMoves = orderedSwapMoves.slice(0, plannerSwapLimit).map((move, index) => ({
        index,
        from: move.from,
        to: move.to,
      }))

      const candidateDiagnostics = {
        validMoves: validMoves.length,
        swapMoves: swapMoves.length,
        expandedSwapMoves: expandedSwapMovesCount,
        expansionUsed,
        expansionTopPriority: -1,
        expansionThreshold: 0,
        shatterGateAllowed: shatterGate.allow,
        shatterGateReason: shatterGate.reason,
        shatterCommonRatio: shatterGate.commonRatio,
        bossPlans: bossShatterPlans.length,
        minePlans: mineShatterPlans.length,
        hasMergeSelection: shouldConsiderMergeSelection && !!((getMergeSelection()?.length || 0) > 1),
        hasInventoryAction: !!inventoryAction,
        hasShardBoost: !!shardBoostType,
      }

      const emitInvalidOutcome = (reason: string, error: string, actionType: ModelDrivenAutoplayDecisionResult['actionType'] = 'swap') => {
        this.autoplayDecisionProvider?.recordOutcome?.({
          actionType,
          moved: false,
          merged: false,
          reason,
          reward: {
            objective: 0,
            shards: 0,
            time: -1,
            risk: -2,
            total: -3,
          },
          elapsedSeconds: this.getElapsedSeconds(),
          seed: this.seed,
          lastError: error,
        })
      }

      const stopModelAutoplay = (
        reasonCode: string,
        explanation: string,
        actionType: ModelDrivenAutoplayDecisionResult['actionType'] = 'swap',
        selectedAction = 'none',
        recordDiagnostics = true,
      ) => {
        emitInvalidOutcome(reasonCode, explanation, actionType)

        if (this.aiTimer) {
          this.aiTimer.remove(false)
          this.aiTimer = null
        }
        this.autoplayTickInFlight = false
        this.autoplayNoMoveStreak = 0
        this.autoplayDecisionTimeoutStreak = 0

        this.aiStatus = {
          ...this.aiStatus,
          active: false,
          goal,
          validMoveCount: this.engine.findValidMoves().length,
          lastDecision: reasonCode,
          elapsedSeconds: this.getElapsedSeconds(),
          lastError: explanation,
        }
        this.emitStatus(`AI stopped: ${explanation}`)
        this.emitAutoplayStatus()
        this.finalizeAutoplayRunSummary('stopped')
        this.scheduleRenderIdleCheck(RENDER_ACTIVITY_SETTLE_MS)

        if (recordDiagnostics) {
          this.pushAutoplayDiagnostics({
            stepId,
            timestampMs: Date.now(),
            strategy: 'model',
            goal,
            candidates: candidateDiagnostics,
            selectedAction,
            executedAction: 'none',
            moved: false,
            merged: false,
            shuffled: false,
            reason: reasonCode,
            fallback: null,
            notes: explanation,
          })
        }

        return { moved: false, merged: false, shuffled: false, reason: reasonCode }
      }

      const decisionTimeoutMs = this.autoplayTuning.decisionTimeoutMs
      const mergeSelectionForPrompt = allowMergeSelection ? getMergeSelection() : null
      let decision: Awaited<ReturnType<ModelDrivenAutoplayDecisionProvider['decide']>> | null = null
      try {
        decision = await Promise.race([
          this.autoplayDecisionProvider.decide({
            allowedActionTypes,
            goal,
            validMoves,
            elapsedSeconds: beforeElapsedSeconds,
            stats: beforeStats,
            objective: beforeObjective,
            engineSnapshot: this.getEngineSnapshot({
              validMoves,
              elapsedSeconds: beforeElapsedSeconds,
              stats: beforeStats,
              objective: beforeObjective,
            }),
            candidates: {
              shardBoost: shardBoostType
                ? {
                  type: shardBoostType,
                  currentLevel: Math.max(0, Math.floor(Number(beforeStats.shardBoostLevels?.[shardBoostType] || 0))),
                  nextCost: this.engine.getShardBoostNextCost(shardBoostType),
                  availableShards: Math.max(0, Math.floor(Number(beforeStats.shardsByType?.[shardBoostType] || 0))),
                }
                : null,
              inventoryAction: inventoryAction
                ? {
                  cell: { row: inventoryAction.cell.row, col: inventoryAction.cell.col },
                  slotType: inventoryAction.slotType,
                }
                : null,
              mergeSelection: mergeSelectionForPrompt && mergeSelectionForPrompt.length > 1
                ? {
                  base: { row: mergeSelectionForPrompt[0].row, col: mergeSelectionForPrompt[0].col },
                  fodders: mergeSelectionForPrompt.slice(1).map(cell => ({ row: cell.row, col: cell.col })),
                  totalCells: mergeSelectionForPrompt.length,
                }
                : null,
              swapMoves,
              bossShatterPlans: bossShatterPlans.map((selection, index) => ({
                index,
                selection: selection.map(cell => ({ row: cell.row, col: cell.col })),
              })),
              mineShatterPlans: mineShatterPlans.map((plan, index) => ({
                index,
                mine: { row: plan.mine.row, col: plan.mine.col },
                selection: plan.selection.map(cell => ({ row: cell.row, col: cell.col })),
              })),
              validMoveCount: validMoves.length,
            },
          }),
          new Promise<never>((_, reject) => {
            globalThis.setTimeout(() => {
              reject(new Error(`Model decision timed out after ${decisionTimeoutMs}ms`))
            }, decisionTimeoutMs)
          }),
        ])
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === TRACKER_AI_CLOUD_USAGE_LIMIT_EXCEEDED_MESSAGE) {
          return stopModelAutoplay('ai-cloud-usage-limit', message, 'swap', 'cloud-usage-limit')
        }
        const restartResult = this.handleAutoplayDecisionTimeout({
          message,
          goal,
          stepId,
          candidates: candidateDiagnostics,
          strategy: 'model',
        })
        if (restartResult) {
          return restartResult
        }
        return stopModelAutoplay('ai-timeout', message, 'swap', 'timeout', false)
      }

      this.autoplayDecisionTimeoutStreak = 0

      if (!decision?.actionType) {
        return stopModelAutoplay('ai-invalid-decision', 'Model decision failed (missing action type).', 'swap', 'invalid-decision')
      }

      const governedActionType = sceneAdapter.enforceAction(decision.actionType)
      if (governedActionType !== decision.actionType) {
        return stopModelAutoplay(
          'ai-guardrail-rejected',
          `Planner selected blocked action: ${decision.actionType}.`,
          decision.actionType,
          decision.actionType,
        )
      }

      let moved = false
      let mergedByModel = false
      let actionReason = 'ai-step'

      if (decision.actionType === 'shard-boost') {
        if (!shardBoostType) {
          return stopModelAutoplay('ai-invalid-shard-boost', 'Model selected shard boost but no valid boost is available.', 'shard-boost', 'shard-boost')
        }

        const boost = this.engine.purchaseShardBoostLevel(shardBoostType)
        if (boost.purchased) {
          moved = true
          actionReason = `ai-shard-boost:${shardBoostType}`
          this.emitStatus(`AI upgraded ${shardBoostType} Epic spawn boost to Lv.${boost.level}`)
          this.emitStats()
        }
      } else if (decision.actionType === 'boss-shatter') {
        const plan = Number.isFinite(decision.bossPlanIndex)
          ? bossShatterPlans[Math.max(0, Math.min(bossShatterPlans.length - 1, Math.floor(decision.bossPlanIndex as number)))]
          : null

        if (!plan || plan.length <= 0) {
          return stopModelAutoplay('ai-invalid-boss-plan', 'Model selected boss shatter but provided an invalid boss plan index.', 'boss-shatter', 'boss-shatter')
        }

        const bossResult = await this.executeAutoplayBossShatter(plan, actionDelayMs)
        moved = bossResult.valid
        mergedByModel = bossResult.valid
        actionReason = bossResult.valid ? `ai-boss-shatter:${bossResult.damage}` : `ai-boss-shatter-failed:${bossResult.reason}`
      } else if (decision.actionType === 'mine-shatter') {
        const plan = Number.isFinite(decision.minePlanIndex)
          ? mineShatterPlans[Math.max(0, Math.min(mineShatterPlans.length - 1, Math.floor(decision.minePlanIndex as number)))]
          : null

        if (!plan || !plan.selection.length) {
          return stopModelAutoplay('ai-invalid-mine-plan', 'Model selected mine shatter but provided an invalid mine plan index.', 'mine-shatter', 'mine-shatter')
        }

        const mineResult = await this.executeAutoplayMineShatter(plan.mine, plan.selection, actionDelayMs)
        moved = mineResult.valid
        mergedByModel = mineResult.valid
        actionReason = mineResult.valid ? `ai-mine-shatter:${mineResult.removed}` : `ai-mine-shatter-failed:${mineResult.reason}`
      } else if (decision.actionType === 'inventory') {
        if (!inventoryAction) {
          return stopModelAutoplay('ai-invalid-inventory', 'Model selected inventory action but no valid inventory action is available.', 'inventory', 'inventory')
        }

        moved = await this.executeAutoplayInventoryAction(inventoryAction.cell, inventoryAction.slotType, actionDelayMs)
        actionReason = moved ? 'ai-inventory' : 'ai-inventory-noop'
      } else if (decision.actionType === 'merge-selection') {
        const selectedMerge = getMergeSelection()
        if (!selectedMerge || selectedMerge.length <= 1) {
          return stopModelAutoplay('ai-invalid-merge-selection', 'Model selected merge selection but no valid merge selection is available.', 'merge-selection', 'merge-selection')
        }

        mergedByModel = await this.executeAutoplayMergeSelection(selectedMerge, actionDelayMs)
        moved = mergedByModel
        actionReason = mergedByModel ? 'ai-merge-selection' : 'ai-merge-selection-noop'
      } else if (decision.actionType === 'swap') {
        const selectedMove = Number.isFinite(decision.moveIndex)
          ? swapMoves[Math.max(0, Math.min(swapMoves.length - 1, Math.floor(decision.moveIndex as number)))]
          : null

        if (!selectedMove) {
          return stopModelAutoplay('ai-invalid-swap-index', 'Model selected swap action but provided an invalid move index.', 'swap', 'swap')
        }

        mergedByModel = await this.tryResolveMove({ from: selectedMove.from, to: selectedMove.to }, {
          previewSelection: true,
          selectionDelayMs: actionDelayMs,
        })
        moved = true
        actionReason = mergedByModel ? 'ai-swap-merged' : 'ai-swap'
      }

      this.autoplayNoMoveStreak = 0
      const afterElapsedSeconds = this.getElapsedSeconds()
      const afterStats = this.engine.getStats(afterElapsedSeconds)
      const afterObjective = this.engine.getObjectiveProgress()
      const reward = this.buildRewardBreakdown({
        beforeStats,
        afterStats,
        beforeObjective,
        afterObjective,
        beforeElapsedSeconds,
        afterElapsedSeconds,
        merged: mergedByModel,
        shuffled: false,
      })
      this.aiStatus = {
        ...this.aiStatus,
        goal,
        movesExecuted: this.aiStatus.movesExecuted + (moved ? 1 : 0),
        mergesExecuted: this.aiStatus.mergesExecuted + (mergedByModel ? 1 : 0),
        validMoveCount: this.engine.findValidMoves().length,
        lastDecision: `ai:${decision.modelId || 'local'}:${decision.actionType}:${decision.explanation || actionReason}`,
        lastReward: reward,
        elapsedSeconds: this.getElapsedSeconds(),
        lastError: null,
      }
      this.emitAutoplayStatus()
      this.autoplayDecisionProvider.recordOutcome?.({
        actionType: decision.actionType,
        moved,
        merged: mergedByModel,
        reason: actionReason,
        reward,
        elapsedSeconds: this.getElapsedSeconds(),
        seed: this.seed,
        lastError: null,
      })

      if (decision.actionType === 'shard-boost') {
        this.lastAutoplayActionType = 'shard'
      } else if (decision.actionType === 'boss-shatter') {
        this.lastAutoplayActionType = 'boss'
      } else if (decision.actionType === 'mine-shatter') {
        this.lastAutoplayActionType = 'mine'
      } else if (decision.actionType === 'inventory') {
        this.lastAutoplayActionType = 'inventory'
      } else if (decision.actionType === 'merge-selection') {
        this.lastAutoplayActionType = 'merge'
      } else {
        this.lastAutoplayActionType = 'swap'
      }

      this.pushAutoplayDiagnostics({
        stepId,
        timestampMs: Date.now(),
        strategy: 'model',
        goal,
        candidates: candidateDiagnostics,
        selectedAction: decision.actionType,
        executedAction: decision.actionType,
        moved,
        merged: mergedByModel,
        shuffled: false,
        reason: actionReason,
        fallback: null,
        notes: decision.explanation || null,
      })

      return {
        moved,
        merged: mergedByModel,
        shuffled: false,
        reason: actionReason,
      }
    }

    const builtInSceneAdapter = createSceneGovernanceAdapter(createBemergedAiGovernanceManifest({
      mode: this.aiGovernanceMode,
      aiDevControlsEnabled: this.aiDevControlsEnabled,
    }))
    const allowAdvancedAutoplayActions = builtInSceneAdapter.allowAdvancedAutoplayActions()

    const shardBoostType = allowAdvancedAutoplayActions
      ? this.engine.chooseAutoplayShardBoostAction(goal)
      : null
    if (allowAdvancedAutoplayActions && shardBoostType) {
      const boost = this.engine.purchaseShardBoostLevel(shardBoostType)
      if (boost.purchased) {
        this.emitStatus(`AI upgraded ${shardBoostType} Epic spawn boost to Lv.${boost.level}`)
        this.emitStats()
      }
    }

    if (allowAdvancedAutoplayActions && this.shouldAttemptAutoplayInventoryAction(beforeStats.moves)) {
      const inventoryAction = this.engine.chooseAutoplayInventoryAction(goal)
      if (inventoryAction) {
        const changed = await this.executeAutoplayInventoryAction(inventoryAction.cell, inventoryAction.slotType, actionDelayMs)
        if (changed) {
          this.emitStatus('AI secured module in inventory')

          const afterElapsedSeconds = this.getElapsedSeconds()
          const afterStats = this.engine.getStats(afterElapsedSeconds)
          const afterObjective = this.engine.getObjectiveProgress()
          this.aiStatus = {
            ...this.aiStatus,
            goal,
            movesExecuted: this.aiStatus.movesExecuted,
            mergesExecuted: this.aiStatus.mergesExecuted,
            validMoveCount: this.engine.findValidMoves().length,
            lastDecision: `step-inventory:${goal}`,
            lastReward: this.buildRewardBreakdown({
              beforeStats,
              afterStats,
              beforeObjective,
              afterObjective,
              beforeElapsedSeconds,
              afterElapsedSeconds,
              merged: false,
              shuffled: false,
            }),
            elapsedSeconds: this.getElapsedSeconds(),
          }
          this.emitStats()
          this.emitInventory()
          this.emitAutoplayStatus()
          this.lastAutoplayActionType = 'inventory'
          this.pushAutoplayDiagnostics({
            stepId,
            timestampMs: Date.now(),
            strategy: 'scripted',
            goal,
            candidates: {
              validMoves: this.engine.findValidMoves().length,
              swapMoves: this.engine.findValidMoves().length,
              expandedSwapMoves: 0,
              expansionUsed: false,
              bossPlans: 0,
              minePlans: 0,
              hasMergeSelection: false,
              hasInventoryAction: true,
              hasShardBoost: !!shardBoostType,
            },
            selectedAction: 'inventory',
            executedAction: 'inventory',
            moved: true,
            merged: false,
            shuffled: false,
            reason: 'inventory',
            fallback: null,
            notes: null,
          })
          return { moved: true, merged: false, shuffled: false, reason: 'inventory' }
        }
      }
    }
    const mergeSelection = allowAdvancedAutoplayActions
      ? this.engine.chooseAutoplayMergeSelection(goal)
      : null
    if (mergeSelection && mergeSelection.length > 1) {
      const mergedFromSelection = await this.executeAutoplayMergeSelection(mergeSelection, actionDelayMs)
      if (mergedFromSelection) {
        const afterElapsedSeconds = this.getElapsedSeconds()
        const afterStats = this.engine.getStats(afterElapsedSeconds)
        const afterObjective = this.engine.getObjectiveProgress()
        this.aiStatus = {
          ...this.aiStatus,
          goal,
          movesExecuted: this.aiStatus.movesExecuted + 1,
          mergesExecuted: this.aiStatus.mergesExecuted + 1,
          validMoveCount: this.engine.findValidMoves().length,
          lastDecision: `step-merge-selection:${goal}`,
          lastReward: this.buildRewardBreakdown({
            beforeStats,
            afterStats,
            beforeObjective,
            afterObjective,
            beforeElapsedSeconds,
            afterElapsedSeconds,
            merged: true,
            shuffled: false,
          }),
          elapsedSeconds: this.getElapsedSeconds(),
        }
        this.emitAutoplayStatus()
        this.lastAutoplayActionType = 'merge'
        this.pushAutoplayDiagnostics({
          stepId,
          timestampMs: Date.now(),
          strategy: 'scripted',
          goal,
          candidates: {
            validMoves: this.engine.findValidMoves().length,
            swapMoves: this.engine.findValidMoves().length,
            expandedSwapMoves: 0,
            expansionUsed: false,
            bossPlans: 0,
            minePlans: 0,
            hasMergeSelection: true,
            hasInventoryAction: false,
            hasShardBoost: !!shardBoostType,
          },
          selectedAction: 'merge-selection',
          executedAction: 'merge-selection',
          moved: true,
          merged: true,
          shuffled: false,
          reason: 'merge-selection',
          fallback: null,
          notes: null,
        })
        return { moved: true, merged: true, shuffled: false, reason: 'merge-selection' }
      }
    }

    const scriptedValidMoves = this.engine.findValidMoves()
    const scriptedCandidateMoves = this.engine.getAutoplaySwapCandidates(scriptedValidMoves, this.autoplayTuning.maxSwapCandidates)
    const scriptedDecisionWindow = Math.min(6, scriptedCandidateMoves.length)
    const scriptedDecisionMoves = scriptedDecisionWindow > 0
      ? scriptedCandidateMoves.slice(0, scriptedDecisionWindow)
      : scriptedCandidateMoves
    const move = this.engine.chooseAutoplayClearMove(goal, {
      validMoves: scriptedDecisionMoves,
      candidateLimit: scriptedDecisionWindow,
    })
      || this.engine.chooseAutoplayMove(goal, {
        validMoves: scriptedDecisionMoves,
        candidateLimit: scriptedDecisionWindow,
      })
    if (!move) {
      this.autoplayNoMoveStreak += 1
      let shuffled = false
      if (this.autoplayNoMoveStreak >= 2) {
        shuffled = this.shuffleBoard()
      } else {
        this.emitStatus('AI searching for a valid move...')
      }
      const afterElapsedSeconds = this.getElapsedSeconds()
      const afterStats = this.engine.getStats(afterElapsedSeconds)
      const afterObjective = this.engine.getObjectiveProgress()
      this.aiStatus = {
        ...this.aiStatus,
        goal,
        validMoveCount: this.engine.findValidMoves().length,
        lastDecision: `shuffle-no-hint:${goal}`,
        lastReward: this.buildRewardBreakdown({
          beforeStats,
          afterStats,
          beforeObjective,
          afterObjective,
          beforeElapsedSeconds,
          afterElapsedSeconds,
          merged: false,
          shuffled,
        }),
        elapsedSeconds: this.getElapsedSeconds(),
      }
      this.emitAutoplayStatus()
      this.pushAutoplayDiagnostics({
        stepId,
        timestampMs: Date.now(),
        strategy: 'scripted',
        goal,
        candidates: {
          validMoves: this.engine.findValidMoves().length,
          swapMoves: this.engine.findValidMoves().length,
          expandedSwapMoves: 0,
          expansionUsed: false,
          bossPlans: 0,
          minePlans: 0,
          hasMergeSelection: false,
          hasInventoryAction: false,
          hasShardBoost: !!shardBoostType,
        },
        selectedAction: 'shuffle-or-retry',
        executedAction: shuffled ? 'shuffle' : 'none',
        moved: false,
        merged: false,
        shuffled,
        reason: shuffled ? 'no-hint-shuffle' : 'no-hint-retry',
        fallback: null,
        notes: null,
      })
      return {
        moved: false,
        merged: false,
        shuffled,
        reason: shuffled ? 'no-hint-shuffle' : 'no-hint-retry',
      }
    }

    this.autoplayNoMoveStreak = 0

    const merged = await this.tryResolveMove(move, {
      previewSelection: true,
      selectionDelayMs: actionDelayMs,
    })
    const afterElapsedSeconds = this.getElapsedSeconds()
    const afterStats = this.engine.getStats(afterElapsedSeconds)
    const afterObjective = this.engine.getObjectiveProgress()
    this.aiStatus = {
      ...this.aiStatus,
      goal,
      movesExecuted: this.aiStatus.movesExecuted + 1,
      mergesExecuted: this.aiStatus.mergesExecuted + (merged ? 1 : 0),
      validMoveCount: this.engine.findValidMoves().length,
      lastDecision: merged ? `step-merged:${goal}` : `step-swapped:${goal}`,
      lastReward: this.buildRewardBreakdown({
        beforeStats,
        afterStats,
        beforeObjective,
        afterObjective,
        beforeElapsedSeconds,
        afterElapsedSeconds,
        merged,
        shuffled: false,
      }),
      elapsedSeconds: this.getElapsedSeconds(),
    }
    this.emitAutoplayStatus()
    this.lastAutoplayActionType = 'swap'
    this.pushAutoplayDiagnostics({
      stepId,
      timestampMs: Date.now(),
      strategy: 'scripted',
      goal,
      candidates: {
        validMoves: this.engine.findValidMoves().length,
        swapMoves: this.engine.findValidMoves().length,
        expandedSwapMoves: 0,
        expansionUsed: false,
        bossPlans: 0,
        minePlans: 0,
        hasMergeSelection: false,
        hasInventoryAction: false,
        hasShardBoost: !!shardBoostType,
      },
      selectedAction: 'swap',
      executedAction: 'swap',
      moved: true,
      merged,
      shuffled: false,
      reason: merged ? 'merged' : 'swapped',
      fallback: null,
      notes: null,
    })
    return { moved: true, merged, shuffled: false, reason: merged ? 'merged' : 'swapped' }
  }

  private shouldAttemptAutoplayInventoryAction(currentMoveCount: number): boolean {
    if (this.lastAutoplayActionType === 'inventory') return false

    const moves = Math.max(0, Math.floor(Number(currentMoveCount) || 0))
    if (moves <= 0) return true

    if (moves < 40) {
      return moves % 5 === 0
    }

    return moves % 6 === 0
  }

  private buildRewardBreakdown(input: {
    beforeStats: GameStats
    afterStats: GameStats
    beforeObjective: ReturnType<GameEngine['getObjectiveProgress']>
    afterObjective: ReturnType<GameEngine['getObjectiveProgress']>
    beforeElapsedSeconds: number
    afterElapsedSeconds: number
    merged: boolean
    shuffled: boolean
  }): AutoplayRewardBreakdown {
    const objective = (input.afterObjective.completionPercent - input.beforeObjective.completionPercent) * 10
    const shards = input.afterStats.score - input.beforeStats.score
    const elapsedDelta = Math.max(0, input.afterElapsedSeconds - input.beforeElapsedSeconds)
    const time = -elapsedDelta
    const risk = input.shuffled
      ? -8
      : input.merged
        ? 1
        : -1

    return {
      objective,
      shards,
      time,
      risk,
      total: objective + shards + time + risk,
    }
  }

  private async tickAutoplay(): Promise<void> {
    if (this.paused || !this.aiStatus.active || this.resolving || this.autoplayTickInFlight) return

    this.autoplayTickInFlight = true
    try {
      const outcome = await this.runAutoplayStep()
      if (outcome.moved) {
        this.applyCurriculumRestartIfNeeded()
      }
    } finally {
      this.autoplayTickInFlight = false
    }
  }

  private resolveAutoplayStartingMoveLimit(tuningOverride?: Partial<AutoplayRuntimeTuning>): number {
    const tuning = tuningOverride ? { ...this.autoplayTuning, ...tuningOverride } : this.autoplayTuning
    const restartFrequency = Math.max(0, Math.floor(Number(tuning.restartFrequency) || 0))
    if (restartFrequency > 0) {
      return Math.max(AUTOPLAY_RESTART_FREQUENCY_MIN_EFFECTIVE, restartFrequency)
    }
    return Math.max(
      AUTOPLAY_GLOBAL_BASELINE_MOVES_MIN,
      Math.floor(Number(tuning.globalBaselineMaxMovesAchieved) || AUTOPLAY_GLOBAL_BASELINE_MOVES_MIN),
    )
  }

  private applyCurriculumRestartIfNeeded(): void {
    const restartFrequency = Math.max(0, Math.floor(Number(this.autoplayTuning.restartFrequency) || 0))
    if (restartFrequency <= 0) return
    if (!this.aiStatus.active) return

    this.ensureAutoplayRunContext()
    const context = this.autoplayCurrentRunContext
    if (!context) return

    const limit = Math.max(
      AUTOPLAY_RESTART_FREQUENCY_MIN_EFFECTIVE,
      Math.floor(Number(this.autoplayTuning.currentMoveLimit) || AUTOPLAY_RESTART_FREQUENCY_MIN_EFFECTIVE),
    )
    const runMoves = Math.max(0, Math.floor(Number(this.aiStatus.movesExecuted) || 0) - context.baselineMovesExecuted)
    if (runMoves < limit) return

    context.forcedRestarts += 1
    const nextLimit = Math.max(
      limit + 1,
      Math.floor(limit + this.autoplayTuning.restartOffset + (limit * this.autoplayTuning.rampGrowthRate)),
    )
    this.autoplayTuning.currentMoveLimit = nextLimit

    this.emitStatus(`AI curriculum restart at ${runMoves}/${limit} moves (next limit ${nextLimit})`)
    this.restartBoard('curriculum-move-limit-restart')
  }

  private getAutoplayActionDelayMs(): number {
    return Math.max(
      AUTOPLAY_ACTION_DELAY_MIN_MS,
      Math.min(AUTOPLAY_ACTION_DELAY_MAX_MS, Math.floor(Number(this.aiStatus.delayMs) || 250)),
    )
  }

  private async executeAutoplayMergeSelection(selection: Cell[], actionDelayMs: number): Promise<boolean> {
    if (!Array.isArray(selection) || selection.length < 2) return false

    this.resolving = true
    try {
      const [base, ...fodders] = selection
      const start = this.engine.startMergeSession(base)
      if (!start.started) {
        this.clearSelectionState()
        this.renderBoard()
        return false
      }

      this.emitStatus('AI selecting merge modules')
      this.renderBoard()
      await this.wait(actionDelayMs)

      for (const fodder of fodders) {
        const toggleResult = this.engine.toggleMergeSessionCell(fodder)
        if (toggleResult.cancelled) {
          this.clearSelectionState()
          this.renderBoard()
          return false
        }

        this.renderBoard()
        await this.wait(actionDelayMs)
      }

      const beforeBoard = this.engine.getBoard().map(row => row.slice())
      const beforeSpecials = this.captureSpecialSnapshot()
      const mergeResult = this.engine.confirmMergeSession()
      this.clearSelectionState()
      if (!mergeResult.valid || !mergeResult.merged) {
        this.renderBoard()
        return false
      }

      await this.renderMergedCascade(beforeBoard, beforeSpecials)
      this.recordMoveActivity()
      this.emitStats()
      return true
    } finally {
      this.resolving = false
    }
  }

  private async executeAutoplayInventoryAction(cell: Cell, slotType: ModuleType, actionDelayMs: number): Promise<boolean> {
    if (this.resolving) return false

    this.selected = { row: cell.row, col: cell.col }
    this.renderBoard()
    await this.wait(actionDelayMs)

    const changed = this.engine.applyInventoryActionToSlot(cell, slotType)
    this.clearSelectionState()
    this.renderBoard()
    if (!changed) {
      return false
    }

    this.recordMoveActivity()
    this.emitStats()
    this.emitInventory()
    await this.wait(Math.max(40, Math.floor(actionDelayMs * 0.6)))
    return true
  }

  private async executeAutoplayBossShatter(selection: Cell[], actionDelayMs: number): Promise<{ valid: boolean; damage: number; removed: number; reason: string }> {
    if (this.resolving) return { valid: false, damage: 0, removed: 0, reason: 'resolving' }

    this.resolving = true
    try {
      const bossBefore = this.engine.getBoss()
      this.bossComboMode = {
        lockedType: null,
        selection: selection.map(cell => ({ row: cell.row, col: cell.col })),
      }
      this.renderBoard()
      await this.wait(Math.max(40, Math.floor(actionDelayMs * 0.7)))

      const result = this.engine.applyBossShatterSelection(this.bossComboMode.selection)
      const bossAfter = this.engine.getBoss()
      this.bossComboMode = null
      this.clearSelectionState()
      this.renderBoard()
      if (!result.valid) return result

      if (bossBefore) {
        if (!bossAfter) {
          await this.playBossKillAnimation({ row: bossBefore.row, col: bossBefore.col })
        } else {
          await this.playBossHitAnimation({ row: bossBefore.row, col: bossBefore.col }, result.damage)
        }
      }

      this.recordMoveActivity()
      this.emitStats()
      return result
    } finally {
      this.resolving = false
    }
  }

  private async executeAutoplayMineShatter(mine: Cell, selection: Cell[], actionDelayMs: number): Promise<{ valid: boolean; removed: number; reason: string }> {
    if (this.resolving) return { valid: false, removed: 0, reason: 'resolving' }

    this.resolving = true
    try {
      const mineBefore = this.engine.getMines().find(item => item.row === mine.row && item.col === mine.col) || null
      this.mineShatterMode = {
        mine: { row: mine.row, col: mine.col },
        armedAtMs: Date.now(),
      }
      void selection
      this.renderBoard()
      await this.wait(Math.max(40, Math.floor(actionDelayMs * 0.7)))

      const result = this.engine.applyMineShatterSelection(this.mineShatterMode.mine, [])
      this.mineShatterMode = null
      this.clearSelectionState()
      this.renderBoard()
      if (!result.valid) return result

      if (mineBefore) {
        await this.playMineExplosionAnimation({ row: mineBefore.row, col: mineBefore.col }, mineBefore.blastRadius)
      }

      this.recordMoveActivity()
      this.emitStats()
      return result
    } finally {
      this.resolving = false
    }
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.resolving || this.paused) return
    this.clearLongPressTracking()
    this.recordInteractionActivity()

    const cell = this.pointerToCell(pointer)
    this.pointerDownCell = cell
    if (!cell) return
    if (pointer.rightButtonDown()) return

    this.longPressTimer = this.time.delayedCall(bemergedParityTuning.combo.longPressMs, () => {
      if (!this.pointerDownCell) return
      if (this.pointerDownCell.row !== cell.row || this.pointerDownCell.col !== cell.col) return

      const boss = this.engine.getBoss()
      if (boss && boss.row === cell.row && boss.col === cell.col) {
        this.mineShatterMode = null
        this.bossComboMode = { lockedType: null, selection: [] }
        this.clearSelectionState()
        this.emitStatus('Boss combo mode: tap a touching module to lock type, then tap the boss to confirm')
        this.renderBoard()
        this.longPressTriggered = true
        return
      }

      if (this.engine.isCellBlocked(cell.row, cell.col)) return

      const token = this.engine.getBoard()[cell.row][cell.col]
      if (!token || token.rarity === 'Common') return

      this.enterMergeMode(cell)
      this.longPressTriggered = true
    })
  }

  private async handlePointerUp(pointer: Phaser.Input.Pointer): Promise<void> {
    if (this.paused) return
    const triggered = this.longPressTriggered
    this.clearLongPressTracking()
    if (triggered) return

    const releasedCell = this.pointerToCell(pointer)
    if (!releasedCell && this.engine.hasMergeSession()) {
      const mergedFromPreview = await this.tryMergeFromPreview(pointer)
      if (mergedFromPreview) return
      this.clearSelectionState()
      this.emitStatus('Merge mode cancelled')
      this.renderBoard()
      return
    }

    await this.handlePointer(pointer)
  }

  private clearLongPressTracking(): void {
    if (this.longPressTimer) {
      this.longPressTimer.remove(false)
      this.longPressTimer = null
    }
    this.pointerDownCell = null
    this.longPressTriggered = false
  }

  private async handlePointer(pointer: Phaser.Input.Pointer): Promise<void> {
    if (this.resolving || this.paused) return

    this.setHintMove(null)
    const cell = this.pointerToCell(pointer)
    if (!cell) return

    if (pointer.rightButtonDown()) {
      this.enterMergeMode(cell)
      return
    }

    const boss = this.engine.getBoss()
    const mineAtCell = this.engine.getMines().find(mine => mine.row === cell.row && mine.col === cell.col)
    const bossComboPreview = this.bossComboMode
      ? this.engine.previewBossShatterSelection(this.bossComboMode.selection)
      : null

    if (this.mineShatterMode && !mineAtCell) {
      this.mineShatterMode = null
    }

    if (mineAtCell) {
      const armedMine = this.mineShatterMode?.mine
      const armedRecently = this.mineShatterMode
        && armedMine
        && armedMine.row === cell.row
        && armedMine.col === cell.col
        && (Date.now() - this.mineShatterMode.armedAtMs) <= bemergedParityTuning.mine.manualTriggerDoubleTapMs

      if (armedRecently) {
        const mineBefore = this.engine.getMines().find(mine => mine.row === cell.row && mine.col === cell.col) || null
        const result = this.engine.applyMineShatterSelection({ row: cell.row, col: cell.col }, [])
        this.mineShatterMode = null
        this.clearSelectionState()
        if (!result.valid) {
          this.emitStatus('Mine shatter failed')
          this.renderBoard()
          return
        }
        this.emitStatus('Mine shattered')
        this.recordMoveActivity()
        this.renderBoard()
        if (mineBefore) {
          await this.playMineExplosionAnimation({ row: mineBefore.row, col: mineBefore.col }, mineBefore.blastRadius)
        }
        this.emitStats()
        return
      }

      this.mineShatterMode = {
        mine: { row: cell.row, col: cell.col },
        armedAtMs: Date.now(),
      }
      this.bossComboMode = null
      this.clearSelectionState()
      this.emitStatus('Mine armed: double-tap the mine to trigger it instantly')
      this.renderBoard()
      return
    }

    if (this.bossComboMode) {
      if (boss && cell.row === boss.row && cell.col === boss.col) {
        const bossBefore = this.engine.getBoss()
        const result = this.engine.applyBossShatterSelection(this.bossComboMode.selection)
        const bossAfter = this.engine.getBoss()
        this.bossComboMode = null
        this.clearSelectionState()
        if (!result.valid) {
          this.emitStatus('Boss damage failed')
          this.renderBoard()
          return
        }
        this.emitStatus(`Boss damaged (${result.damage})`)
        this.recordMoveActivity()
        this.renderBoard()
        if (bossBefore) {
          if (!bossAfter) {
            await this.playBossKillAnimation({ row: bossBefore.row, col: bossBefore.col })
          } else {
            await this.playBossHitAnimation({ row: bossBefore.row, col: bossBefore.col }, result.damage)
          }
        }
        this.emitStats()
        return
      }

      if (!boss) {
        this.bossComboMode = null
        this.renderBoard()
        return
      }

      const token = this.engine.getBoard()[cell.row]?.[cell.col]
      const lockedType = this.bossComboMode.lockedType
      const autoIncludedKeys = new Set((bossComboPreview?.autoIncludedCells || []).map(item => `${item.row}:${item.col}`))
      const manualSelectableKeys = new Set(
        (lockedType ? this.engine.getBossComboSelectableCells(lockedType) : []).map(item => `${item.row}:${item.col}`),
      )
      const isBossAdjacent = Math.abs(cell.row - boss.row) <= 1
        && Math.abs(cell.col - boss.col) <= 1
        && !(cell.row === boss.row && cell.col === boss.col)

      if (!lockedType) {
        if (!token || !isBossAdjacent) {
          this.emitStatus('Tap a module touching the boss to lock the combo type')
          return
        }
        this.bossComboMode.lockedType = token.type
        this.bossComboMode.selection = []
        const preview = this.engine.previewBossShatterSelection([])
        this.emitStatus(`Boss combo locked to ${token.type}. Preview damage: ${preview.damage}`)
        this.renderBoard()
        return
      }

      if (this.engine.isCellBlocked(cell.row, cell.col)) {
        this.emitStatus('Cannot use blocked tile for boss damage')
        return
      }

      if (!token || token.type !== lockedType || !manualSelectableKeys.has(`${cell.row}:${cell.col}`)) {
        this.emitStatus(`Boss combo is locked to ${lockedType}`)
        return
      }

      if (autoIncludedKeys.has(`${cell.row}:${cell.col}`)) {
        this.emitStatus('Touching boss modules are always included automatically')
        return
      }

      const index = this.bossComboMode.selection.findIndex(item => item.row === cell.row && item.col === cell.col)
      if (index >= 0) {
        this.bossComboMode.selection.splice(index, 1)
      } else {
        this.bossComboMode.selection.push(cell)
      }
      const preview = this.engine.previewBossShatterSelection(this.bossComboMode.selection)
      this.emitStatus(`Boss combo preview: ${preview.damage} damage`)
      this.renderBoard()
      return
    }

    if (this.engine.isCellBlocked(cell.row, cell.col)) {
      if (boss && boss.row === cell.row && boss.col === cell.col) {
        this.emitStatus('Long-press the boss to enter combo mode')
        return
      }
      this.emitStatus('Tile is blocked by mine or boss')
      return
    }

    const mergeSession = this.engine.getMergeSessionSnapshot()
    if (mergeSession.active) {
      const base = mergeSession.base
      if (base && base.row === cell.row && base.col === cell.col) {
        const mergeState = mergeSession.state
        if (!mergeState.valid || !mergeState.readyToMerge) {
          this.clearSelectionState()
          this.emitStatus('Merge mode cancelled')
          this.renderBoard()
          return
        }

        this.resolving = true
        try {
          const beforeBoard = this.engine.getBoard().map(row => row.slice())
          const beforeSpecials = this.captureSpecialSnapshot()
          const result = this.engine.confirmMergeSession()
          this.clearSelectionState()
          if (!result.valid) {
            this.emitStatus('Merge failed')
            this.renderBoard()
            return
          }
          await this.renderMergedCascade(beforeBoard, beforeSpecials)
          this.recordMoveActivity()
          this.emitStats()
          this.emitStatus('Merged')
        } finally {
          this.resolving = false
        }
        return
      }

      const toggleResult = this.engine.toggleMergeSessionCell(cell)
      if (toggleResult.cancelled) {
        this.clearSelectionState()
        this.emitStatus('Merge mode cancelled')
      } else if (toggleResult.changed) {
        this.emitMergeModeStatus()
      }

      this.renderBoard()
      return
    }

    if (!this.selected) {
      this.selected = cell
      this.renderBoard()
      return
    }

    if (this.selected.row === cell.row && this.selected.col === cell.col) {
      this.selected = null
      this.renderBoard()
      return
    }

    const base = this.selected
    const move: Move = {
      from: base,
      to: cell,
    }
    this.selected = null
    this.clearSelectionState()

    await this.tryResolveMove(move)
  }

  onInventorySlotClick(slotType: ModuleType): void {
    if (this.resolving || this.paused) return
    this.recordInteractionActivity()

    const mergeSession = this.engine.getMergeSessionSnapshot()
    if (mergeSession.active && mergeSession.baseSlot === slotType) {
      const mergeState = mergeSession.state
      if (!mergeState.valid || !mergeState.readyToMerge) {
        this.emitMergeModeStatus()
        return
      }

      this.resolving = true
      void (async () => {
        try {
          const beforeBoard = this.engine.getBoard().map(row => row.slice())
          const beforeSpecials = this.captureSpecialSnapshot()
          const result = this.engine.confirmMergeSession()
          this.clearSelectionState()
          if (!result.valid) {
            this.emitStatus('Merge failed')
            this.renderBoard()
            return
          }

          await this.renderMergedCascade(beforeBoard, beforeSpecials)
          this.recordMoveActivity()
          this.emitInventory()
          this.emitStats()
          this.emitStatus('Merged')
        } finally {
          this.resolving = false
        }
      })()
      return
    }

    if (!this.selected) {
      if (mergeSession.active) {
        this.emitMergeModeStatus()
        return
      }

      const result = this.engine.startInventoryMergeSession(slotType)
      if (!result.started) {
        this.emitStatus('That equipped module cannot merge yet')
        return
      }

      this.emitMergeModeStatus()
      this.renderBoard()
      return
    }

    const changed = this.engine.applyInventoryActionToSlot(this.selected, slotType)
    if (!changed) {
      this.emitStatus('Only matching unique modules can use inventory')
      return
    }

    this.clearSelectionState()
    this.recordMoveActivity()
    this.renderBoard()
    this.emitInventory()
    this.emitStatus('Inventory updated')
  }

  onShardTypeClick(type: ModuleType): void {
    if (this.resolving || this.paused) return
    this.recordInteractionActivity()

    const result = this.engine.purchaseShardBoostLevel(type)
    if (!result.purchased) {
      this.emitStatus(`Need ${result.cost.toLocaleString()} ${type} shards for next Epic level`)
      return
    }

    this.emitStats()
    this.emitRuntimeStateChanged()
    this.emitStatus(`${type} Epic spawn boost upgraded to Lv.${result.level} (-${result.cost.toLocaleString()} shards)`)
  }

  private async tryResolveMove(
    move: Move,
    options?: {
      previewSelection?: boolean
      selectionDelayMs?: number
    },
  ): Promise<boolean> {
    if (options?.previewSelection) {
      this.selected = { row: move.from.row, col: move.from.col }
      this.renderBoard()
      await this.wait(Math.max(40, Math.floor(Number(options.selectionDelayMs) || 0)))
      this.selected = null
      this.renderBoard()
      await this.wait(Math.max(30, Math.floor((Number(options.selectionDelayMs) || 0) * 0.5)))
    }

    this.resolving = true
    const beforeBoard = this.engine.getBoard().map(row => row.slice())
    const beforeSpecials = this.captureSpecialSnapshot()
    const fromToken = beforeBoard[move.from.row]?.[move.from.col] || null
    const toToken = beforeBoard[move.to.row]?.[move.to.col] || null
    const swapIsValid = !!fromToken
      && !!toToken
      && !this.engine.isCellBlocked(move.from.row, move.from.col)
      && !this.engine.isCellBlocked(move.to.row, move.to.col)
      && fromToken.matchKey !== toToken.matchKey
    if (!swapIsValid) {
      this.resolving = false
      this.emitStatus('Invalid swap')
      return false
    }

    await this.playSwapAnimation(move, beforeBoard)
    const result = this.engine.applyMove(move)
    if (!result.valid) {
      this.resolving = false
      this.emitStatus('Invalid swap')
      return false
    }

    try {
      this.recordMoveActivity()
      if (result.merged) {
        await this.renderMergedCascade(beforeBoard, beforeSpecials)
      } else {
        this.renderBoard()
        await this.wait(40)
      }
      this.emitStatus(result.merged ? 'Merged' : 'Swapped')
      this.emitStats()
      this.emitRuntimeStateChanged()
      return result.merged
    } finally {
      this.resolving = false
    }
  }

  private pointerToCell(pointer: Phaser.Input.Pointer): Cell | null {
    const boardY = pointer.y - PREVIEW_BAR_HEIGHT
    const col = Math.floor(pointer.x / TILE_SIZE)
    const row = Math.floor(boardY / TILE_SIZE)
    if (row < 0 || col < 0 || row >= BOARD_ROWS || col >= BOARD_COLS) return null
    return { row, col }
  }

  private renderBoard(
    highlightCells: Cell[] = [],
    options?: {
      animateCascade?: boolean
      previousTokenPositions?: Map<ModuleToken, Cell>
      previousSpecialSnapshot?: SpecialSnapshot
      hiddenTokenCellKeys?: Set<string>
    },
  ): number {
    if (!this.sceneReady || !this.layer) {
      return 0
    }

    this.requestRenderActivity(options?.animateCascade ? 520 : RENDER_ACTIVITY_SETTLE_MS)

    const board = this.engine.getBoard()
    const animateCascade = !!options?.animateCascade
    const previousTokenPositions = options?.previousTokenPositions
    const previousSpecialSnapshot = options?.previousSpecialSnapshot
    const hiddenTokenCellKeys = options?.hiddenTokenCellKeys
    const cascadeTargets: Array<{
      node: Phaser.GameObjects.Image | Phaser.GameObjects.Text
      startY: number
      finalY: number
      delay: number
    }> = []
    const mines = this.engine.getMines()
    const boss = this.engine.getBoss()
    const mineByKey = new Map<string, (typeof mines)[number]>()
    for (const mine of mines) {
      mineByKey.set(`${mine.row},${mine.col}`, mine)
    }
    const mineStartRowByKey = this.buildMineStartRowByKey(mines, previousSpecialSnapshot?.mines || [])
    const flash = new Set(highlightCells.map(cell => `${cell.row},${cell.col}`))
    if (this.hintMove) {
      if (this.hintPulseTimer) {
        const hintedCell = this.hintPulsePhase === 0 ? this.hintMove.from : this.hintMove.to
        flash.add(`${hintedCell.row},${hintedCell.col}`)
      } else {
        flash.add(`${this.hintMove.from.row},${this.hintMove.from.col}`)
        flash.add(`${this.hintMove.to.row},${this.hintMove.to.col}`)
      }
    }

    const mergeSession = this.engine.getMergeSessionSnapshot()
    const mergeSelectionKeys = new Set(mergeSession.selection.map(item => `${item.row},${item.col}`))
    const mergeCandidateKeys = new Set(mergeSession.candidateKeys)
    const mergeBaseKey = mergeSession.base ? `${mergeSession.base.row},${mergeSession.base.col}` : null
    const bossComboPreview = this.bossComboMode
      ? this.engine.previewBossShatterSelection(this.bossComboMode.selection)
      : null
    const bossComboAutoKeys = new Set((bossComboPreview?.autoIncludedCells || []).map(item => `${item.row},${item.col}`))
    const bossComboAffectedMineKeys = new Set((bossComboPreview?.mineCells || []).map(item => `${item.row},${item.col}`))
    const bossComboSplashKeys = new Set((bossComboPreview?.affectedMineCells || []).map(item => `${item.row},${item.col}`))
    const bossComboSelectedKeys = new Set((this.bossComboMode?.selection || []).map(item => `${item.row},${item.col}`))
    const bossComboSelectableKeys = new Set(
      (this.bossComboMode?.lockedType
        ? this.engine.getBossComboSelectableCells(this.bossComboMode.lockedType)
        : [])
        .map(item => `${item.row},${item.col}`),
    )

    this.layer.removeAll(true)

    const countdownExplosionDurationMs = animateCascade && previousSpecialSnapshot
      ? this.playCountdownMineExplosionAnimations(previousSpecialSnapshot.mines || [])
      : 0

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const token = board[row][col]
        const key = `${row},${col}`
        const mine = mineByKey.get(key)
        const isBossCell = !!(boss && boss.row === row && boss.col === col)
        if (!token && !mine && !isBossCell) continue

        const x = (col * TILE_SIZE) + (TILE_SIZE / 2)
        const y = PREVIEW_BAR_HEIGHT + (row * TILE_SIZE) + (TILE_SIZE / 2)
        const blocked = this.engine.isCellBlocked(row, col)

        const tileBackground = this.add.rectangle(x, y, TILE_DRAW_SIZE, TILE_DRAW_SIZE, 0x0a0f18, 0.48)
        tileBackground.setStrokeStyle(2, blocked ? 0x7c2d12 : 0x2b384f, 0.78)
        tileBackground.setOrigin(0.5, 0.5)

        if (tileBackground instanceof Phaser.GameObjects.Rectangle) {
          tileBackground.setDisplaySize(TILE_DRAW_SIZE, TILE_DRAW_SIZE)
        }

        const showTokenArt = !!token && !mine && !isBossCell
  const hideTokenArt = !!(showTokenArt && hiddenTokenCellKeys?.has(key))
        const frameTexture = showTokenArt ? token!.frameTextureKey : ''
        const iconTexture = showTokenArt ? token!.assetTextureKey : ''

  const frameReady = showTokenArt && !hideTokenArt ? this.ensureTextureReady(token!.frameSrc, token!.frameTextureKey) : false
  const iconReady = showTokenArt && !hideTokenArt ? this.ensureTextureReady(token!.assetSrc, token!.assetTextureKey) : false

        const frame = frameReady ? this.add.image(x, y, frameTexture) : null
        frame?.setDisplaySize(TILE_DRAW_SIZE + TILE_FRAME_OVERDRAW, TILE_DRAW_SIZE + TILE_FRAME_OVERDRAW)

        const icon = iconReady ? this.add.image(x, y, iconTexture) : null
        icon?.setDisplaySize(TILE_DRAW_SIZE - TILE_ICON_INSET, TILE_DRAW_SIZE - TILE_ICON_INSET)
        const plusAdornment = showTokenArt ? this.createPlusVariantAdornment(token!, x, y) : []

        const previousPosition = animateCascade && previousTokenPositions && token ? previousTokenPositions.get(token) : undefined
        const previousRow = previousPosition?.row

        if (animateCascade && frame) {
          const finalY = frame.y
          const startY = previousRow !== undefined
            ? PREVIEW_BAR_HEIGHT + (previousRow * TILE_SIZE) + (TILE_SIZE / 2)
            : finalY - (TILE_SIZE * 1.2)
          const rowDistance = previousRow !== undefined ? Math.max(0, row - previousRow) : row + 1
          const shouldAnimate = startY !== finalY
          if (shouldAnimate) {
            frame.setY(startY)
            frame.setAlpha(0.7)
            cascadeTargets.push({ node: frame, startY, finalY, delay: rowDistance * 18 })
          }
        }
        if (animateCascade && icon) {
          const finalY = icon.y
          const startY = previousRow !== undefined
            ? PREVIEW_BAR_HEIGHT + (previousRow * TILE_SIZE) + (TILE_SIZE / 2)
            : finalY - (TILE_SIZE * 1.2)
          const rowDistance = previousRow !== undefined ? Math.max(0, row - previousRow) : row + 1
          const shouldAnimate = startY !== finalY
          if (shouldAnimate) {
            icon.setY(startY)
            icon.setAlpha(0.7)
            cascadeTargets.push({ node: icon, startY, finalY, delay: rowDistance * 18 })
          }
        }

        const borderColor = this.selected && this.selected.row === row && this.selected.col === col
          ? 0xf8fafc
          : mergeSelectionKeys.has(key)
            ? 0x38bdf8
            : mergeSession.active && mergeCandidateKeys.has(key)
              ? 0xf8fafc
              : this.mineShatterMode?.mine.row === row && this.mineShatterMode?.mine.col === col
                ? 0xf97316
                : bossComboSelectedKeys.has(key)
                  ? 0xfb7185
                  : bossComboAutoKeys.has(key)
                    ? 0xe11d48
                    : bossComboAffectedMineKeys.has(key)
                      ? 0xf97316
                      : bossComboSplashKeys.has(key)
                        ? 0xfda4af
                        : bossComboSelectableKeys.has(key)
                          ? 0x22c55e
                          : flash.has(key)
                            ? 0xfacc15
                            : blocked
                              ? 0xf97316
                              : 0x000000

        const isMergeBase = !!(mergeSession.active && mergeBaseKey === key)
        const isMergeSelected = mergeSelectionKeys.has(key)
        const isMergeCandidate = !!(mergeSession.active && mergeCandidateKeys.has(key))
        const dimForMergeMode = mergeSession.active && !isMergeBase && !isMergeSelected && !isMergeCandidate
        const mergeDimAlpha = dimForMergeMode ? 0.28 : 1

        tileBackground.setAlpha(dimForMergeMode ? 0.22 : 0.48)

        const borderAlpha = borderColor === 0x000000 ? 0.35 : 1
        const overlay = this.add.graphics()
        overlay.lineStyle(borderColor === 0x000000 ? 1 : 3, borderColor, borderAlpha)
        overlay.strokeRoundedRect(
          x - (TILE_DRAW_SIZE / 2),
          y - (TILE_DRAW_SIZE / 2),
          TILE_DRAW_SIZE,
          TILE_DRAW_SIZE,
          TILE_RADIUS,
        )

        this.layer.add(tileBackground)
        if (frame) this.layer.add(frame)
        if (icon) this.layer.add(icon)
        for (const plusNode of plusAdornment) {
          ;(plusNode as Phaser.GameObjects.Graphics | Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text).setAlpha(dimForMergeMode ? 0.44 : 1)
          this.layer.add(plusNode)
        }

        if (mine) {
          const mineIcon = this.add.image(x, y, 'mine-overlay')
          mineIcon.setDisplaySize(TILE_DRAW_SIZE - 14, TILE_DRAW_SIZE - 14)

          if (animateCascade) {
            const startRow = mineStartRowByKey.get(key)
            if (startRow !== undefined && startRow !== row) {
              const finalY = mineIcon.y
              const startY = PREVIEW_BAR_HEIGHT + (startRow * TILE_SIZE) + (TILE_SIZE / 2)
              const rowDistance = Math.max(0, row - startRow)
              mineIcon.setY(startY)
              mineIcon.setAlpha(0.7)
              cascadeTargets.push({ node: mineIcon, startY, finalY, delay: rowDistance * 18 })
            }
          }

          this.layer.add(mineIcon)

          const mineText = this.add.text(x + (TILE_DRAW_SIZE / 2) - 8, y - (TILE_DRAW_SIZE / 2) + 6, String(mine.movesRemaining), {
            fontSize: '14px',
            color: '#ffffff',
            backgroundColor: '#8b1c1c',
          })
          mineText.setPadding(2, 1, 2, 1)
          mineText.setOrigin(1, 0)

          if (animateCascade) {
            const startRow = mineStartRowByKey.get(key)
            if (startRow !== undefined && startRow !== row) {
              const finalY = mineText.y
              const startY = (PREVIEW_BAR_HEIGHT + (startRow * TILE_SIZE) + (TILE_SIZE / 2)) - (TILE_DRAW_SIZE / 2) + 6
              const rowDistance = Math.max(0, row - startRow)
              mineText.setY(startY)
              mineText.setAlpha(0.7)
              cascadeTargets.push({ node: mineText, startY, finalY, delay: rowDistance * 18 })
            }
          }

          frame?.setAlpha(mergeDimAlpha)
          this.layer.add(mineText)
        }

        if (isBossCell && boss) {
          icon?.setAlpha(mergeDimAlpha)
          const bossIcon = this.add.image(x, y, 'boss-overlay')
          bossIcon.setDisplaySize(TILE_DRAW_SIZE - 8, TILE_DRAW_SIZE - 8)

          if (animateCascade && previousSpecialSnapshot?.boss && previousSpecialSnapshot.boss.col === boss.col) {
            const previousBossRow = previousSpecialSnapshot.boss.row
            if (previousBossRow !== boss.row) {
              const finalY = bossIcon.y
              const startY = PREVIEW_BAR_HEIGHT + (previousBossRow * TILE_SIZE) + (TILE_SIZE / 2)
              const rowDistance = Math.max(0, boss.row - previousBossRow)
              bossIcon.setY(startY)
              bossIcon.setAlpha(0.7)
              cascadeTargets.push({ node: bossIcon, startY, finalY, delay: rowDistance * 18 })
            }
          }

          this.layer.add(bossIcon)

          const hpText = this.add.text(x, y - (TILE_DRAW_SIZE / 2) + 6, String(boss.hitsRemaining), {
            fontSize: '14px',
            color: '#ffffff',
            backgroundColor: '#801212',
          })
          hpText.setPadding(3, 1, 3, 1)
          hpText.setOrigin(0.5, 0)

          if (animateCascade && previousSpecialSnapshot?.boss && previousSpecialSnapshot.boss.col === boss.col) {
            const previousBossRow = previousSpecialSnapshot.boss.row
            if (previousBossRow !== boss.row) {
              const finalY = hpText.y
              const startY = (PREVIEW_BAR_HEIGHT + (previousBossRow * TILE_SIZE) + (TILE_SIZE / 2)) - (TILE_DRAW_SIZE / 2) + 6
              const rowDistance = Math.max(0, boss.row - previousBossRow)
              hpText.setY(startY)
              hpText.setAlpha(0.7)
              cascadeTargets.push({ node: hpText, startY, finalY, delay: rowDistance * 18 })
            }
          }

          this.layer.add(hpText)

          const bossPreviewDamage = this.bossComboMode?.lockedType
            ? Math.max(0, Math.floor(Number(bossComboPreview?.damage) || 0))
            : 0
          if (bossPreviewDamage > 0) {
            const previewText = this.add.text(x, y - (TILE_DRAW_SIZE / 2) + 24, `-${bossPreviewDamage}`, {
              fontSize: '13px',
              color: '#fda4af',
              backgroundColor: '#3b0712',
              fontStyle: 'bold',
            })
            previewText.setPadding(3, 1, 3, 1)
            previewText.setOrigin(0.5, 0)

            if (animateCascade && previousSpecialSnapshot?.boss && previousSpecialSnapshot.boss.col === boss.col) {
              const previousBossRow = previousSpecialSnapshot.boss.row
              if (previousBossRow !== boss.row) {
                const finalY = previewText.y
                const startY = (PREVIEW_BAR_HEIGHT + (previousBossRow * TILE_SIZE) + (TILE_SIZE / 2)) - (TILE_DRAW_SIZE / 2) + 24
                const rowDistance = Math.max(0, boss.row - previousBossRow)
                previewText.setY(startY)
                previewText.setAlpha(0.7)
                cascadeTargets.push({ node: previewText, startY, finalY, delay: rowDistance * 18 })
              }
            }

            this.layer.add(previewText)
          }
        }

        this.layer.add(overlay)
      }
    }

    this.renderMergePreviewOverlay(board, mergeSession)

    if (animateCascade) {
      return Math.max(this.playCascadeAnimation(cascadeTargets), countdownExplosionDurationMs)
    }

    return countdownExplosionDurationMs
  }

  private playCascadeAnimation(targets: Array<{
    node: Phaser.GameObjects.Image | Phaser.GameObjects.Text
    startY: number
    finalY: number
    delay: number
  }>): number {
    let maxDurationMs = 0
    for (const target of targets) {
      const distance = Math.abs(target.finalY - target.startY)
      const duration = Math.min(380, Math.max(180, distance * 2.2))
      maxDurationMs = Math.max(maxDurationMs, target.delay + duration)
      this.activeCascadeTweenCount += 1
      this.tweens.add({
        targets: target.node,
        y: target.finalY,
        alpha: 1,
        duration,
        delay: target.delay,
        ease: 'Cubic.Out',
        onComplete: () => {
          this.activeCascadeTweenCount = Math.max(0, this.activeCascadeTweenCount - 1)
          this.scheduleRenderIdleCheck(RENDER_ACTIVITY_SETTLE_MS)
        },
      })
    }
    if (maxDurationMs > 0) {
      this.requestRenderActivity(maxDurationMs + 80, true)
    }

    return maxDurationMs
  }

  private buildMineStartRowByKey(
    currentMines: ReturnType<GameEngine['getMines']>,
    previousMines: ReturnType<GameEngine['getMines']>,
  ): Map<string, number> {
    const out = new Map<string, number>()
    if (currentMines.length === 0 || previousMines.length === 0) return out

    const previousByCol = new Map<number, number[]>()
    for (const mine of previousMines) {
      const rows = previousByCol.get(mine.col) || []
      rows.push(mine.row)
      previousByCol.set(mine.col, rows)
    }

    for (const rows of previousByCol.values()) {
      rows.sort((left, right) => left - right)
    }

    const currentSorted = [...currentMines].sort((left, right) => {
      if (left.col !== right.col) return left.col - right.col
      return left.row - right.row
    })

    for (const mine of currentSorted) {
      const rows = previousByCol.get(mine.col)
      if (!rows || rows.length === 0) continue

      let matchedIndex = -1
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index] <= mine.row) {
          matchedIndex = index
          break
        }
      }
      if (matchedIndex < 0) {
        matchedIndex = 0
      }

      const startRow = rows[matchedIndex]
      rows.splice(matchedIndex, 1)
      out.set(`${mine.row},${mine.col}`, startRow)
    }

    return out
  }

  private captureSpecialSnapshot(): SpecialSnapshot {
    return {
      mines: this.engine.getMines(),
      boss: this.engine.getBoss(),
    }
  }

  private buildTokenPositionIndex(board: (ModuleToken | null)[][]): Map<ModuleToken, Cell> {
    const positions = new Map<ModuleToken, Cell>()
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const token = board[row]?.[col]
        if (!token) continue
        positions.set(token, { row, col })
      }
    }
    return positions
  }

  private renderMergePreviewOverlay(
    board: (ModuleToken | null)[][],
    mergeSession: ReturnType<GameEngine['getMergeSessionSnapshot']>,
  ): void {
    const selectedTokens: Array<ModuleToken | null> = [null, null, null]
    let predictedToken: ModuleToken | null = null

    if (mergeSession.active) {
      const inventory = this.engine.getInventory()
      const selectionOffset = mergeSession.baseSlot ? 1 : 0
      if (mergeSession.baseSlot) {
        selectedTokens[0] = inventory[mergeSession.baseSlot] || null
      }

      for (let index = 0; index < 3 - selectionOffset; index += 1) {
        const cell = mergeSession.selection[index]
        if (!cell) continue
        selectedTokens[index + selectionOffset] = board[cell.row]?.[cell.col] || null
      }

      if (mergeSession.state.readyToMerge) predictedToken = mergeSession.state.previewToken
    }

    const slotTokens: Array<ModuleToken | null> = [
      selectedTokens[0],
      selectedTokens[1],
      selectedTokens[2],
      predictedToken,
    ]

    const layout = this.getPreviewLayout()
    const panel = this.add.rectangle(
      layout.panelCenterX,
      layout.panelCenterY,
      layout.panelWidth,
      layout.panelHeight,
      0x0b111d,
      0.9,
    )
    panel.setStrokeStyle(1, 0x334155, 0.9)
    panel.setOrigin(0.5, 0.5)
    this.layer.add(panel)

    for (let index = 0; index < 4; index += 1) {
      const slotX = layout.slotCenters[index]
      const slotY = layout.slotCenterY
      const token = slotTokens[index]
      const isResultSlot = index === 3

      const ready = isResultSlot && mergeSession.active
        && (mergeSession.selection.length > 0 || !!mergeSession.baseSlot)
        && predictedToken !== null

      const slotBg = this.add.rectangle(slotX, slotY, PREVIEW_SLOT_SIZE, PREVIEW_SLOT_SIZE, 0x05080f, 0.88)
      slotBg.setStrokeStyle(2, ready ? 0x6f99ff : 0x2c3a52, 1)
      slotBg.setOrigin(0.5, 0.5)
      this.layer.add(slotBg)

      if (token) {
        const frameReady = this.ensureTextureReady(token.frameSrc, token.frameTextureKey)
        const iconReady = this.ensureTextureReady(token.assetSrc, token.assetTextureKey)

        if (frameReady) {
          const frame = this.add.image(slotX, slotY, token.frameTextureKey)
          frame.setDisplaySize(PREVIEW_SLOT_SIZE - PREVIEW_FRAME_INSET, PREVIEW_SLOT_SIZE - PREVIEW_FRAME_INSET)
          this.layer.add(frame)
        }

        if (iconReady) {
          const icon = this.add.image(slotX, slotY, token.assetTextureKey)
          icon.setDisplaySize(PREVIEW_ICON_SIZE, PREVIEW_ICON_SIZE)
          this.layer.add(icon)
        }

        for (const adornment of this.createPreviewVariantAdornment(token, slotX, slotY)) {
          this.layer.add(adornment)
        }
      }

      if (index < 3) {
        const operator = this.add.text(
          slotX + (PREVIEW_SLOT_SIZE / 2) + PREVIEW_TEXT_GAP,
          slotY,
          index === 2 ? '=' : '+',
          {
            fontSize: '18px',
            color: '#d0d8e9',
          },
        )
        operator.setOrigin(0.5, 0.5)
        this.layer.add(operator)
      }
    }
  }

  private async tryMergeFromPreview(pointer: Phaser.Input.Pointer): Promise<boolean> {
    if (this.resolving || !this.engine.hasMergeSession()) return false

    const layout = this.getPreviewLayout()
    const withinResultSlot = pointer.x >= layout.resultSlot.left
      && pointer.x <= layout.resultSlot.right
      && pointer.y >= layout.resultSlot.top
      && pointer.y <= layout.resultSlot.bottom

    if (!withinResultSlot) return false

    const mergeState = this.engine.getMergeSessionSnapshot().state
    if (!mergeState.valid || !mergeState.readyToMerge) return false

    this.resolving = true
    try {
      const beforeBoard = this.engine.getBoard().map(row => row.slice())
      const beforeSpecials = this.captureSpecialSnapshot()
      const result = this.engine.confirmMergeSession()
      this.clearSelectionState()
      if (!result.valid) {
        this.emitStatus('Merge failed')
        this.renderBoard()
        return true
      }

      await this.renderMergedCascade(beforeBoard, beforeSpecials)
      this.recordMoveActivity()
      this.emitStatus('Merged')
      this.emitStats()
      return true
    } finally {
      this.resolving = false
    }
  }

  private async renderMergedCascade(
    beforeBoard: (ModuleToken | null)[][],
    beforeSpecials: SpecialSnapshot,
  ): Promise<void> {
    const previousTokenPositions = this.buildTokenPositionIndex(beforeBoard)
    const clearDurationMs = this.playRemovedTokenFade(previousTokenPositions)
    const cascadeDurationMs = this.renderBoard([], {
      animateCascade: true,
      previousTokenPositions,
      previousSpecialSnapshot: beforeSpecials,
    })
    await this.wait(Math.max(260, clearDurationMs, cascadeDurationMs) + 40)
  }

  private async playSwapAnimation(move: Move, beforeBoard: (ModuleToken | null)[][]): Promise<void> {
    const fromToken = beforeBoard[move.from.row]?.[move.from.col] || null
    const toToken = beforeBoard[move.to.row]?.[move.to.col] || null
    if (!fromToken || !toToken || !this.sceneReady) {
      return
    }

    const hiddenTokenCellKeys = new Set<string>([
      `${move.from.row},${move.from.col}`,
      `${move.to.row},${move.to.col}`,
    ])
    this.renderBoard([], { hiddenTokenCellKeys })

    const transientLayer = this.add.layer()
    const fromCenter = this.getCellCenter(move.from)
    const toCenter = this.getCellCenter(move.to)
    const fromVisual = this.createTransientTokenVisual(fromToken, fromCenter.x, fromCenter.y)
    const toVisual = this.createTransientTokenVisual(toToken, toCenter.x, toCenter.y)
    const tweenTargets = [
      fromVisual ? { node: fromVisual, targetX: toCenter.x, targetY: toCenter.y } : null,
      toVisual ? { node: toVisual, targetX: fromCenter.x, targetY: fromCenter.y } : null,
    ].filter((value): value is { node: Phaser.GameObjects.Container; targetX: number; targetY: number } => !!value)

    for (const tweenTarget of tweenTargets) {
      transientLayer.add(tweenTarget.node)
    }

    if (tweenTargets.length === 0) {
      transientLayer.destroy(true)
      return
    }

    this.requestRenderActivity(SWAP_ANIMATION_DURATION_MS + 120, true)

    await new Promise<void>(resolve => {
      let remaining = tweenTargets.length
      const finish = () => {
        remaining -= 1
        if (remaining > 0) return
        transientLayer.destroy(true)
        resolve()
      }

      for (const tweenTarget of tweenTargets) {
        this.tweens.add({
          targets: tweenTarget.node,
          x: tweenTarget.targetX,
          y: tweenTarget.targetY,
          duration: SWAP_ANIMATION_DURATION_MS,
          ease: 'Sine.InOut',
          onComplete: finish,
        })
      }
    })
  }

  private playRemovedTokenFade(previousTokenPositions: Map<ModuleToken, Cell>): number {
    if (!this.sceneReady) return 0

    const currentTokenPositions = this.buildTokenPositionIndex(this.engine.getBoard())
    const transientLayer = this.add.layer()
    let tweensStarted = 0
    let maxDurationMs = 0

    for (const [token, cell] of previousTokenPositions.entries()) {
      if (currentTokenPositions.has(token)) continue

      const center = this.getCellCenter(cell)
      const visual = this.createTransientTokenVisual(token, center.x, center.y)
      if (!visual) continue

      const delay = cell.row * CLEAR_ANIMATION_STAGGER_MS
      const duration = CLEAR_ANIMATION_DURATION_MS
      transientLayer.add(visual)
      tweensStarted += 1
      maxDurationMs = Math.max(maxDurationMs, delay + duration)

      this.tweens.add({
        targets: visual,
        alpha: 0,
        scaleX: 0.72,
        scaleY: 0.72,
        y: center.y - 10,
        delay,
        duration,
        ease: 'Cubic.In',
        onComplete: () => {
          visual.destroy()
          if (!transientLayer.list.length) {
            transientLayer.destroy(true)
          }
        },
      })
    }

    if (tweensStarted === 0) {
      transientLayer.destroy(true)
      return 0
    }

    this.requestRenderActivity(maxDurationMs + 80, true)
    return maxDurationMs
  }

  private getPlusAccentColor(token: ModuleToken): number {
    if (token.rarity === 'Mythic' || token.rarity === 'Ancestral') return 0xf59e0b
    if (token.rarity === 'Legendary') return 0xf97316
    if (token.rarity === 'Epic') return 0x38bdf8
    return 0x22d3ee
  }

  private createPlusVariantAdornment(token: ModuleToken, x: number, y: number): Phaser.GameObjects.GameObject[] {
    return this.createVariantAdornment(token, x, y, TILE_DRAW_SIZE, PLUS_BADGE_SIZE)
  }

  private createPreviewVariantAdornment(token: ModuleToken, x: number, y: number): Phaser.GameObjects.GameObject[] {
    return this.createVariantAdornment(token, x, y, PREVIEW_SLOT_SIZE - 2, 14)
  }

  private createVariantAdornment(token: ModuleToken, x: number, y: number, tileSize: number, badgeSize: number): Phaser.GameObjects.GameObject[] {
    const badgeText = getModuleVariantAdornmentText(token)
    if (!badgeText) return []

    const accent = this.getPlusAccentColor(token)
    const badgeOffset = Math.max(10, Math.floor(tileSize * 0.24))
    const badgeX = x + (tileSize / 2) - badgeOffset
    const badgeY = y - (tileSize / 2) + badgeOffset

    const badge = this.add.graphics()
    badge.fillStyle(0x03111f, 0.96)
    badge.lineStyle(2, accent, 1)
    const half = badgeSize / 2
    const points = [
      new Phaser.Geom.Point(badgeX, badgeY - half),
      new Phaser.Geom.Point(badgeX + half, badgeY),
      new Phaser.Geom.Point(badgeX, badgeY + half),
      new Phaser.Geom.Point(badgeX - half, badgeY),
    ]
    badge.fillPoints(points, true)
    badge.strokePoints(points, true, true)

    const plusText = this.add.text(badgeX, badgeY, badgeText, {
      fontSize: badgeText.length > 1 ? `${Math.max(9, badgeSize - 5)}px` : `${Math.max(12, badgeSize - 2)}px`,
      color: '#f8fafc',
      fontStyle: 'bold',
    })
    plusText.setOrigin(0.5, 0.52)

    return [badge, plusText]
  }

  private handlePointerHover(pointer: Phaser.Input.Pointer): void {
    if (!this.hoverDescriptionsEnabled) {
      this.game.canvas.removeAttribute('title')
      return
    }

    const cell = this.pointerToCell(pointer)
    if (!cell) {
      this.game.canvas.removeAttribute('title')
      return
    }

    const token = this.engine.getBoard()[cell.row]?.[cell.col] || null
    const hoverText = token ? getUniqueModuleHoverText(token) : null
    if (!hoverText) {
      this.game.canvas.removeAttribute('title')
      return
    }

    this.game.canvas.setAttribute('title', hoverText)
  }

  private playCountdownMineExplosionAnimations(previousMines: ReturnType<GameEngine['getMines']>): number {
    const currentMineKeys = new Set(this.engine.getMines().map(mine => `${mine.row}:${mine.col}`))
    const expiredMines = previousMines.filter(mine => mine.movesRemaining <= 1 && !currentMineKeys.has(`${mine.row}:${mine.col}`))
    for (const mine of expiredMines) {
      void this.playMineExplosionAnimation({ row: mine.row, col: mine.col }, mine.blastRadius)
    }
    return expiredMines.length > 0 ? MINE_EXPLOSION_ANIMATION_MS : 0
  }

  private async playBossHitAnimation(cell: Cell, damage: number): Promise<void> {
    if (!this.sceneReady) return

    const center = this.getCellCenter(cell)
    const layer = this.add.layer()
    const overlay = this.add.image(center.x, center.y, 'boss-overlay')
    overlay.setDisplaySize(TILE_DRAW_SIZE - 8, TILE_DRAW_SIZE - 8)
    layer.add(overlay)

    const hitFlash = this.add.circle(center.x, center.y, 10, 0xfca5a5, 0.85)
    hitFlash.setScale(0.55)
    layer.add(hitFlash)

    const damageLabel = this.add.text(center.x, center.y - 6, `-${Math.max(0, Math.floor(Number(damage) || 0))}`, {
      fontSize: '22px',
      color: '#fee2e2',
      fontStyle: 'bold',
      stroke: '#7f1d1d',
      strokeThickness: 4,
    })
    damageLabel.setOrigin(0.5, 0.5)
    layer.add(damageLabel)

    for (let index = 0; index < 8; index += 1) {
      const shard = this.add.rectangle(center.x, center.y, 8, 3, index % 2 === 0 ? 0xf97316 : 0xfde68a, 0.95)
      shard.setAngle((360 / 8) * index)
      layer.add(shard)
      const angle = ((Math.PI * 2) / 8) * index
      this.tweens.add({
        targets: shard,
        x: center.x + (Math.cos(angle) * 34),
        y: center.y + (Math.sin(angle) * 34),
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 260,
        ease: 'Cubic.Out',
        onComplete: () => {
          shard.destroy()
        },
      })
    }

    this.tweens.add({
      targets: overlay,
      scaleX: 0.86,
      scaleY: 0.86,
      yoyo: true,
      duration: 170,
      repeat: 1,
      ease: 'Quad.InOut',
    })
    this.tweens.add({
      targets: hitFlash,
      alpha: 0,
      scale: 3.2,
      duration: 320,
      ease: 'Quad.Out',
      onComplete: () => {
        hitFlash.destroy()
      },
    })
    this.tweens.add({
      targets: damageLabel,
      y: center.y - 32,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.Out',
      onComplete: () => {
        damageLabel.destroy()
        layer.destroy(true)
      },
    })

    this.requestRenderActivity(520, true)
    await this.wait(420)
  }

  private async playCellExplosionAnimation(options: {
    cell: Cell
    durationMs: number
    burstRadiusPx: number
    particleCount: number
    palette: number[]
    overlayTexture?: string
    overlaySize?: number
    shockwaveColor: number
  }): Promise<void> {
    if (!this.sceneReady) return

    const center = this.getCellCenter(options.cell)
    const layer = this.add.layer()
    const durationMs = Math.max(220, Math.floor(options.durationMs))
    const overlaySize = options.overlaySize || (TILE_DRAW_SIZE - 8)

    const flash = this.add.circle(center.x, center.y, 14, options.palette[0], 0.92)
    flash.setScale(0.4)
    layer.add(flash)

    const shockwave = this.add.circle(center.x, center.y, 12, 0xffffff, 0)
    shockwave.setStrokeStyle(4, options.shockwaveColor, HAZARD_EXPLOSION_RING_ALPHA)
    layer.add(shockwave)

    let overlay: Phaser.GameObjects.Image | null = null
    if (options.overlayTexture) {
      overlay = this.add.image(center.x, center.y, options.overlayTexture)
      overlay.setDisplaySize(overlaySize, overlaySize)
      layer.add(overlay)
    }

    for (let index = 0; index < options.particleCount; index += 1) {
      const color = options.palette[index % options.palette.length]
      const particle = this.add.circle(center.x, center.y, 3 + (this.rng.next() * 5), color, 0.95)
      layer.add(particle)
      const angle = ((Math.PI * 2 * index) / options.particleCount) + (this.rng.next() * 0.28)
      const travel = options.burstRadiusPx * (0.45 + (this.rng.next() * 0.75))
      const duration = durationMs * (0.55 + (this.rng.next() * 0.35))
      this.tweens.add({
        targets: particle,
        x: center.x + (Math.cos(angle) * travel),
        y: center.y + (Math.sin(angle) * travel),
        alpha: 0,
        scale: 0.15,
        duration,
        ease: 'Cubic.Out',
        onComplete: () => {
          particle.destroy()
        },
      })
    }

    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 4.2,
      duration: durationMs * 0.78,
      ease: 'Quad.Out',
      onComplete: () => {
        flash.destroy()
      },
    })

    this.tweens.add({
      targets: shockwave,
      scale: 5.8,
      alpha: 0,
      duration: durationMs,
      ease: 'Sine.Out',
      onComplete: () => {
        shockwave.destroy()
      },
    })

    if (overlay) {
      this.tweens.add({
        targets: overlay,
        alpha: 0,
        scale: 1.55,
        angle: 16,
        duration: durationMs * 0.9,
        ease: 'Cubic.Out',
        onComplete: () => {
          overlay?.destroy()
        },
      })
    }

    this.requestRenderActivity(durationMs + 140, true)
    await this.wait(durationMs)
    layer.destroy(true)
  }

  private async playBossKillAnimation(cell: Cell): Promise<void> {
    if (this.sceneReady) {
      const center = this.getCellCenter(cell)
      const collapseLayer = this.add.layer()
      const collapseOverlay = this.add.image(center.x, center.y, 'boss-overlay')
      collapseOverlay.setDisplaySize(TILE_DRAW_SIZE - 8, TILE_DRAW_SIZE - 8)
      collapseLayer.add(collapseOverlay)
      const collapseGlow = this.add.circle(center.x, center.y, 24, 0xfca5a5, 0.18)
      collapseLayer.add(collapseGlow)

      this.tweens.add({
        targets: collapseOverlay,
        scaleX: 0.48,
        scaleY: 0.48,
        alpha: 0.28,
        angle: -18,
        duration: 220,
        ease: 'Quad.In',
      })
      this.tweens.add({
        targets: collapseGlow,
        scale: 0.2,
        alpha: 0,
        duration: 220,
        ease: 'Quad.In',
      })

      this.requestRenderActivity(360, true)
      await this.wait(220)
      collapseLayer.destroy(true)
    }

    await this.playCellExplosionAnimation({
      cell,
      durationMs: BOSS_KILL_ANIMATION_MS,
      burstRadiusPx: 118,
      particleCount: 26,
      palette: [0x38bdf8, 0x60a5fa, 0xf59e0b, 0xfef3c7],
      overlayTexture: 'boss-overlay',
      overlaySize: TILE_DRAW_SIZE + 18,
      shockwaveColor: 0xf8fafc,
    })
  }

  private async playMineExplosionAnimation(cell: Cell, blastRadius: number): Promise<void> {
    await this.playCellExplosionAnimation({
      cell,
      durationMs: MINE_EXPLOSION_ANIMATION_MS,
      burstRadiusPx: 72 + (Math.max(1, blastRadius) * 18),
      particleCount: 18 + (Math.max(1, blastRadius) * 3),
      palette: [0xfb7185, 0xf97316, 0xfacc15, 0xfef2f2],
      overlayTexture: 'mine-overlay',
      overlaySize: TILE_DRAW_SIZE + 8,
      shockwaveColor: 0xf97316,
    })
  }

  private createTransientTokenVisual(token: ModuleToken, x: number, y: number): Phaser.GameObjects.Container | null {
    const children: Phaser.GameObjects.GameObject[] = []
    if (this.ensureTextureReady(token.frameSrc, token.frameTextureKey)) {
      const frame = this.add.image(0, 0, token.frameTextureKey)
      frame.setDisplaySize(TILE_DRAW_SIZE + TILE_FRAME_OVERDRAW, TILE_DRAW_SIZE + TILE_FRAME_OVERDRAW)
      children.push(frame)
    }
    if (this.ensureTextureReady(token.assetSrc, token.assetTextureKey)) {
      const icon = this.add.image(0, 0, token.assetTextureKey)
      icon.setDisplaySize(TILE_DRAW_SIZE - TILE_ICON_INSET, TILE_DRAW_SIZE - TILE_ICON_INSET)
      children.push(icon)
    }
    children.push(...this.createPlusVariantAdornment(token, 0, 0))
    if (children.length === 0) {
      return null
    }

    const container = this.add.container(x, y, children)
    container.setScale(1)
    container.setAlpha(1)
    return container
  }

  private getCellCenter(cell: Cell): { x: number; y: number } {
    return {
      x: (cell.col * TILE_SIZE) + (TILE_SIZE / 2),
      y: PREVIEW_BAR_HEIGHT + (cell.row * TILE_SIZE) + (TILE_SIZE / 2),
    }
  }

  private getPreviewLayout(): {
    panelCenterX: number
    panelCenterY: number
    panelWidth: number
    panelHeight: number
    slotCenters: number[]
    slotCenterY: number
    resultSlot: { left: number; right: number; top: number; bottom: number }
  } {
    const boardWidth = BOARD_COLS * TILE_SIZE
    const contentWidth = (PREVIEW_SLOT_SIZE * 4) + (PREVIEW_GAP * 3) + (PREVIEW_TEXT_GAP * 3)
    const panelPadding = 10
    const panelWidth = contentWidth + (panelPadding * 2)
    const panelHeight = 56
    const panelCenterX = boardWidth - (panelWidth / 2) - 8
    const panelCenterY = PREVIEW_BAR_HEIGHT / 2
    const slotCenterY = panelCenterY
    const slotCenters: number[] = []

    let cursor = panelCenterX - (contentWidth / 2) + (PREVIEW_SLOT_SIZE / 2)
    for (let index = 0; index < 4; index += 1) {
      slotCenters.push(cursor)
      cursor += PREVIEW_SLOT_SIZE
      if (index < 3) cursor += PREVIEW_TEXT_GAP + PREVIEW_GAP
    }

    const resultX = slotCenters[3]
    const half = PREVIEW_SLOT_SIZE / 2

    return {
      panelCenterX,
      panelCenterY,
      panelWidth,
      panelHeight,
      slotCenters,
      slotCenterY,
      resultSlot: {
        left: resultX - half,
        right: resultX + half,
        top: slotCenterY - half,
        bottom: slotCenterY + half,
      },
    }
  }

  private emitStats(): void {
    const elapsedSeconds = this.getElapsedSeconds()
    const stats = {
      ...this.engine.getStats(elapsedSeconds),
      shuffleCharges: this.shuffleCharges,
    }
    if (stats.bossesKilled > this.lastBossesKilled) {
      this.shuffleCharges += stats.bossesKilled - this.lastBossesKilled
      this.lastBossesKilled = stats.bossesKilled
      stats.shuffleCharges = this.shuffleCharges
    }
    this.callbacks.onStats?.(stats)
    const boss = this.engine.getBoss()
    this.callbacks.onSpecials?.({
      mineCount: this.engine.getMines().length,
      bossHp: boss ? boss.hitsRemaining : 0,
      bossWave: boss ? boss.waveCount : 0,
      bossPhase: boss ? boss.currentPhase : 0,
    })
    this.emitInventory()
  }

  private getElapsedSeconds(): number {
    const pausedDelta = this.paused && this.pausedStartedAtMs != null
      ? Date.now() - this.pausedStartedAtMs
      : 0
    return Math.max(1, Math.floor((Date.now() - this.startMs - this.totalPausedMs - pausedDelta) / 1000))
  }

  private emitStatus(status: string): void {
    this.callbacks.onStatus?.(status)
  }

  private emitAutoplayStatus(): void {
    this.callbacks.onAutoplay?.(this.getAutoplayStatus())
  }

  private pushAutoplayDiagnostics(entry: AutoplayStepDiagnostics): void {
    this.lastAutoplayDiagnostics = { ...entry }
    this.autoplayDiagnosticsHistory.push({ ...entry })
    this.autoplaySearchWidthController.recordStep({
      merged: entry.merged,
      expansionUsed: entry.candidates.expansionUsed,
      reason: entry.reason,
    })
    if (this.autoplayDiagnosticsHistory.length > AUTOPLAY_DIAGNOSTICS_HISTORY_LIMIT) {
      this.autoplayDiagnosticsHistory.splice(0, this.autoplayDiagnosticsHistory.length - AUTOPLAY_DIAGNOSTICS_HISTORY_LIMIT)
    }
  }

  private handleAutoplayDecisionTimeout(input: {
    message: string
    goal: AutoplayGoal
    stepId: number
    candidates: AutoplayStepDiagnostics['candidates']
    strategy: AutoplayStepDiagnostics['strategy']
  }): { moved: boolean; merged: boolean; shuffled: boolean; reason: string } | null {
    this.autoplayDecisionTimeoutStreak += 1
    if (!this.autoplayCurrentRunContext) {
      this.ensureAutoplayRunContext()
    }
    if (this.autoplayCurrentRunContext) {
      this.autoplayCurrentRunContext.timeoutEvents += 1
      this.autoplayCurrentRunContext.indecisionReasons.push(String(input.message || '').slice(0, 240))
    }

    this.pushAutoplayDiagnostics({
      stepId: input.stepId,
      timestampMs: Date.now(),
      strategy: input.strategy,
      goal: input.goal,
      candidates: input.candidates,
      selectedAction: 'timeout',
      executedAction: 'none',
      moved: false,
      merged: false,
      shuffled: false,
      reason: 'ai-timeout',
      fallback: null,
      notes: input.message,
    })

    return null
  }

  private ensureAutoplayRunContext(reset = false): void {
    if (this.autoplayCurrentRunContext && !reset) return

    const elapsedSeconds = this.getElapsedSeconds()
    const stats = this.engine.getStats(elapsedSeconds)
    const nextRunId = this.autoplayRunId + 1
    this.autoplayRunId = nextRunId
    this.autoplayCurrentRunContext = {
      runId: nextRunId,
      startedAtMs: Date.now(),
      startStepId: this.autoplayDiagnosticsStepId + 1,
      baselineMovesExecuted: Math.max(0, Math.floor(Number(this.aiStatus.movesExecuted) || 0)),
      baselineMergesExecuted: Math.max(0, Math.floor(Number(this.aiStatus.mergesExecuted) || 0)),
      baselineScore: Math.max(0, Math.floor(Number(stats.score) || 0)),
      timeoutEvents: 0,
      forcedRestarts: 0,
      indecisionReasons: [],
    }
  }

  private finalizeAutoplayRunSummary(terminationReason = 'completed'): void {
    const summary = this.buildAutoplayRunSummary(terminationReason)
    if (!summary) return

    this.lastAutoplayRunSummary = { ...summary }
    this.autoplayRunSummaryHistory.push({ ...summary })
    if (this.autoplayRunSummaryHistory.length > AUTOPLAY_RUN_SUMMARY_HISTORY_LIMIT) {
      this.autoplayRunSummaryHistory.splice(0, this.autoplayRunSummaryHistory.length - AUTOPLAY_RUN_SUMMARY_HISTORY_LIMIT)
    }
    this.lastAutoplayRunCompositeScore = scoreAutoplayRunComposite({ summary })
    this.autoplayCurrentRunContext = null
  }

  private buildAutoplayRunSummary(terminationReason = 'in-progress'): AutoplayRunSummary | null {
    const context = this.autoplayCurrentRunContext
    if (!context) return null

    const elapsedSeconds = this.getElapsedSeconds()
    const stats = this.engine.getStats(elapsedSeconds)
    const objective = this.engine.getObjectiveProgress()
    const runSteps = this.autoplayDiagnosticsHistory.filter(step => step.stepId >= context.startStepId)
    const totalMoves = Math.max(0, Math.floor(Number(this.aiStatus.movesExecuted) || 0) - context.baselineMovesExecuted)
    const totalMerges = Math.max(0, Math.floor(Number(this.aiStatus.mergesExecuted) || 0) - context.baselineMergesExecuted)
    const finalShards = Math.max(0, Math.floor(Number(stats.score) || 0) - context.baselineScore)
    const elapsedMs = Math.max(1, Date.now() - context.startedAtMs)
    const avgTimePerMoveMs = totalMoves > 0 ? Math.round(elapsedMs / totalMoves) : elapsedMs

    const protectedHighRarityEvents = runSteps.filter(step => step.executedAction === 'inventory' && step.moved).length
    const uniqueEquipOptimizations = protectedHighRarityEvents
    const fodderPipelineCompletions = runSteps.filter(step => step.merged).length
    const bossFodderPreparations = runSteps.filter(step => step.executedAction === 'boss-shatter' || step.executedAction === 'mine-shatter').length

    const mistakes = {
      missedObviousMerge: runSteps.filter(step => step.candidates.hasMergeSelection && step.executedAction === 'swap' && !step.merged).length,
      sacrificedHighRarity: runSteps.filter(step => (step.executedAction === 'boss-shatter' || step.executedAction === 'mine-shatter') && String(step.reason || '').includes('failed')).length,
      overShatterWhenMergeAvailable: runSteps.filter(step => step.candidates.hasMergeSelection && (step.executedAction === 'boss-shatter' || step.executedAction === 'mine-shatter')).length,
      ignoredBossThreat: runSteps.filter(step => step.candidates.bossPlans > 0 && step.executedAction !== 'boss-shatter' && !step.merged).length,
      ignoredMineThreat: runSteps.filter(step => step.candidates.minePlans > 0 && step.executedAction !== 'mine-shatter' && !step.merged).length,
      badPfVsUpgradeChoice: runSteps.filter(step => step.executedAction === 'shard-boost' && step.candidates.hasMergeSelection).length,
    }

    const timeoutFallbackCount = runSteps.filter(step => String(step.reason || '').includes('timeout-fallback')).length
    const timeoutRestartCount = runSteps.filter(step => String(step.reason || '').includes('timeout-run-restart')).length
    const expansionUseRate = runSteps.length > 0
      ? runSteps.filter(step => step.candidates.expansionUsed).length / runSteps.length
      : 0

    const slowDecisionPatterns: string[] = []
    if (avgTimePerMoveMs > 2200) {
      slowDecisionPatterns.push('high-average-decision-time')
    }
    if (timeoutFallbackCount > 0) {
      slowDecisionPatterns.push('timeout-fallback-pressure')
    }
    if (timeoutRestartCount > 0 || context.timeoutEvents > 0) {
      slowDecisionPatterns.push('decision-timeout-restart-pressure')
    }
    if (expansionUseRate > 0.65) {
      slowDecisionPatterns.push('over-frequent-search-expansion')
    }

    const improvementsToTryNextRun: string[] = []
    if (mistakes.missedObviousMerge > 0) improvementsToTryNextRun.push('raise-merge-selection-priority')
    if (mistakes.ignoredBossThreat > 0 || mistakes.ignoredMineThreat > 0) improvementsToTryNextRun.push('increase-threat-avoidance-weight')
    if (avgTimePerMoveMs > 2200) improvementsToTryNextRun.push('reduce-default-swap-candidate-limit')

    const searchPolicyAdjustments: string[] = []
    if (expansionUseRate > 0.65) {
      searchPolicyAdjustments.push('lower-expanded-candidate-limit')
    } else if (expansionUseRate < 0.15) {
      searchPolicyAdjustments.push('increase-expansion-trigger-threshold')
    }
    if (timeoutFallbackCount > 0) {
      searchPolicyAdjustments.push('tighten-timeout-safe-fallback-ordering')
    }
    if (context.timeoutEvents > 0) {
      searchPolicyAdjustments.push('prefer-many-short-runs-over-timeout-stalls')
    }

    const rewardWeightAdjustments: string[] = []
    if (mistakes.missedObviousMerge > 0) rewardWeightAdjustments.push('increase-immediateMergeGain-weight')
    if (mistakes.ignoredBossThreat > 0) rewardWeightAdjustments.push('increase-bossThreatPenalty-weight')
    if (mistakes.ignoredMineThreat > 0) rewardWeightAdjustments.push('increase-mineThreatPenalty-weight')

    const strategyDelta: AutoplayStrategyDelta = {
      slowDecisionPatterns,
      improvementsToTryNextRun,
      searchPolicyAdjustments,
      rewardWeightAdjustments,
    }

    const provisionalSummary = parseAutoplayRunSummary({
      runId: context.runId,
      finalModules5StarAnc: Math.max(0, Math.floor(Number(objective.completedUniqueMods) || 0)),
      totalMoves,
      totalMerges,
      finalShards,
      avgTimePerMoveMs,
      protectedHighRarityEvents,
      uniqueEquipOptimizations,
      fodderPipelineCompletions,
      bossFodderPreparations,
      terminationReason,
      indecisionTimeoutEvents: context.timeoutEvents,
      forcedRestarts: context.forcedRestarts,
      mistakes,
      strategyDelta,
    })

    const learnedDelta = extractBemergedStrategyDeltaFromAutoplaySummary({
      current: provisionalSummary,
      previous: this.autoplayRunSummaryHistory,
    })

    return parseAutoplayRunSummary({
      ...provisionalSummary,
      strategyDelta: {
        slowDecisionPatterns: Array.from(new Set([
          ...provisionalSummary.strategyDelta.slowDecisionPatterns,
          ...learnedDelta.avoid_patterns,
        ])).slice(0, 12),
        improvementsToTryNextRun: Array.from(new Set([
          ...provisionalSummary.strategyDelta.improvementsToTryNextRun,
          ...learnedDelta.prefer_patterns,
        ])).slice(0, 12),
        searchPolicyAdjustments: Array.from(new Set([
          ...provisionalSummary.strategyDelta.searchPolicyAdjustments,
          ...learnedDelta.heuristics_to_adjust,
        ])).slice(0, 12),
        rewardWeightAdjustments: Array.from(new Set([
          ...provisionalSummary.strategyDelta.rewardWeightAdjustments,
          ...learnedDelta.new_tests,
        ])).slice(0, 12),
      },
    })
  }

  private emitInventory(): void {
    this.callbacks.onInventory?.(this.engine.getInventory())
  }

  private buildRuntimeState(): BemergedRuntimeState {
    return {
      version: 1,
      elapsedSeconds: this.getElapsedSeconds(),
      restartCount: this.restartCount,
      shuffleCharges: this.shuffleCharges,
      engine: this.engine.exportRuntimeState(),
    }
  }

  private emitRuntimeStateChanged(): void {
    this.callbacks.onRuntimeStateChanged?.(this.buildRuntimeState())
  }

  private clearSelectionState(): void {
    this.selected = null
    this.engine.cancelMergeSession()
  }

  private setHintMove(
    move: Move | null,
    options?: { pulseToggles?: number; autoClearMs?: number; source?: 'manual' | 'auto' | 'system' },
  ): void {
    this.hintMove = move

    if (this.hintAutoClearTimer) {
      this.hintAutoClearTimer.remove(false)
      this.hintAutoClearTimer = null
    }

    if (!move) {
      this.hintPulsePhase = 0
      if (this.hintPulseTimer) {
        this.hintPulseTimer.remove(false)
        this.hintPulseTimer = null
      }
      this.autoHintVisible = false
      return
    }

    if (this.hintPulseTimer) {
      this.hintPulseTimer.remove(false)
      this.hintPulseTimer = null
    }

    const pulseToggles = Math.max(0, Math.floor(Number(options?.pulseToggles || 0)))
    if (pulseToggles > 0) {
      this.requestRenderActivity((pulseToggles * HINT_PULSE_INTERVAL_MS) + 160, true)
      let togglesRemaining = pulseToggles
      this.hintPulseTimer = this.time.addEvent({
        delay: HINT_PULSE_INTERVAL_MS,
        loop: true,
        callback: () => {
          if (!this.hintMove || !this.hintPulseTimer) return
          this.hintPulsePhase = this.hintPulsePhase === 0 ? 1 : 0
          togglesRemaining -= 1
          this.renderBoard()
          if (togglesRemaining <= 0) {
            this.hintPulseTimer?.remove(false)
            this.hintPulseTimer = null
            this.renderBoard()
          }
        },
      })
    } else {
      this.hintPulsePhase = 0
      this.scheduleRenderIdleCheck(RENDER_ACTIVITY_SETTLE_MS)
    }

    const autoClearMs = Math.max(0, Math.floor(Number(options?.autoClearMs || 0)))
    if (autoClearMs > 0) {
      this.hintAutoClearTimer = this.time.delayedCall(autoClearMs, () => {
        this.setHintMove(null, { source: 'system' })
        this.renderBoard()
      })
    }

    this.autoHintVisible = options?.source === 'auto'
  }

  private startIdleHintWatcher(): void {
    this.lastMoveActivityAtMs = Date.now()
    this.nextIdleHintAtMs = this.lastMoveActivityAtMs + 10000
    this.scheduleNextIdleHintCheck()
  }

  private scheduleNextIdleHintCheck(): void {
    if (this.idleHintTimer) {
      this.idleHintTimer.remove(false)
      this.idleHintTimer = null
    }

    const delayMs = Math.max(250, this.nextIdleHintAtMs - Date.now())
    this.idleHintTimer = this.time.delayedCall(delayMs, () => {
      this.idleHintTimer = null

      if (this.hintsDisabled || this.aiStatus.active || this.resolving || this.engine.hasMergeSession() || this.autoHintVisible) {
        this.scheduleNextIdleHintCheck()
        return
      }

      const now = Date.now()
      if (now < this.nextIdleHintAtMs) {
        this.scheduleNextIdleHintCheck()
        return
      }

      const hintMoves = this.engine.findHintMoves()
      if (hintMoves.length === 0) {
        this.nextIdleHintAtMs = now + 10000
        this.scheduleNextIdleHintCheck()
        return
      }

      const currentKey = this.hintMove
        ? `${this.hintMove.from.row}:${this.hintMove.from.col}:${this.hintMove.to.row}:${this.hintMove.to.col}`
        : null
      const currentIndex = currentKey
        ? hintMoves.findIndex(move => `${move.from.row}:${move.from.col}:${move.to.row}:${move.to.col}` === currentKey)
        : -1
      const baseIndex = currentIndex >= 0 ? currentIndex : this.hintCycleIndex
      const nextIndex = (baseIndex + 1 + hintMoves.length) % hintMoves.length
      const hint = hintMoves[nextIndex]
      this.hintCycleIndex = nextIndex
      this.setHintMove(hint, { pulseToggles: 8, autoClearMs: 3000, source: 'auto' })
      this.renderBoard()
      this.emitStatus('Hint highlighted')
      this.nextIdleHintAtMs = now + 10000
      this.scheduleNextIdleHintCheck()
    })
  }

  private recordMoveActivity(): void {
    this.recordInteractionActivity()
    this.emitRuntimeStateChanged()
  }

  private recordInteractionActivity(): void {
    this.lastMoveActivityAtMs = Date.now()
    this.nextIdleHintAtMs = this.lastMoveActivityAtMs + 10000
    this.scheduleNextIdleHintCheck()
    if (this.autoHintVisible) {
      this.setHintMove(null, { source: 'system' })
      this.renderBoard()
    }
  }

  private enterMergeMode(cell: Cell): void {
    this.selected = null
    const result = this.engine.startMergeSession(cell)
    if (!result.started) {
      if (result.reason === 'blocked-tile') {
        this.emitStatus('Tile is blocked by mine or boss')
      } else if (result.reason === 'base-cannot-merge') {
        this.emitStatus('Common modules cannot be merged')
      }
      return
    }

    this.emitMergeModeStatus()
    this.renderBoard()
  }

  private emitMergeModeStatus(): void {
    const mergeSession = this.engine.getMergeSessionSnapshot()
    const mergeState = mergeSession.state
    const required = mergeState.requiredTotal
    const selectedCount = mergeState.selectedCount
    const confirmHint = mergeSession.baseSlot
      ? 'tap the equipped module again or the preview when ready'
      : 'tap base when ready'
    this.emitStatus(`Merge mode ${selectedCount}/${Number.isFinite(required) ? required : '?'}: select highlighted modules, ${confirmHint}, tap outside to cancel`)
  }

  private async wait(delayMs: number): Promise<void> {
    await new Promise<void>(resolve => {
      this.time.delayedCall(delayMs, () => resolve())
    })
  }

  private bindExternalRenderWake(): void {
    const canvas = this.game.canvas
    if (!(canvas instanceof HTMLCanvasElement)) {
      return
    }

    this.externalWakeTarget = canvas
    this.externalWakeHandler = () => {
      this.requestRenderActivity(700, true)
    }

    for (const eventName of ['pointerenter', 'pointermove', 'pointerdown', 'touchstart', 'focus']) {
      canvas.addEventListener(eventName, this.externalWakeHandler, { passive: true })
    }
  }

  private cleanupRenderCadenceBindings(): void {
    if (this.renderActivityTimer !== null) {
      window.clearTimeout(this.renderActivityTimer)
      this.renderActivityTimer = null
    }

    if (this.externalWakeTarget && this.externalWakeHandler) {
      for (const eventName of ['pointerenter', 'pointermove', 'pointerdown', 'touchstart', 'focus']) {
        this.externalWakeTarget.removeEventListener(eventName, this.externalWakeHandler)
      }
    }

    this.externalWakeTarget = null
    this.externalWakeHandler = null
    this.activeCascadeTweenCount = 0
  }

  private requestRenderActivity(durationMs = RENDER_ACTIVITY_SETTLE_MS, immediate = false): void {
    const nextIdleAtMs = Date.now() + Math.max(RENDER_ACTIVITY_SETTLE_MS, Math.floor(Number(durationMs) || 0))
    if (nextIdleAtMs > this.renderActivityUntilMs) {
      this.renderActivityUntilMs = nextIdleAtMs
    }

    this.applyRenderFrameRate(this.activeFrameRate, immediate)
    this.scheduleRenderIdleCheck(Math.max(80, this.renderActivityUntilMs - Date.now()))
  }

  private scheduleRenderIdleCheck(delayMs: number): void {
    if (this.renderActivityTimer !== null) {
      globalThis.clearTimeout(this.renderActivityTimer)
    }

    this.renderActivityTimer = globalThis.setTimeout(() => {
      this.renderActivityTimer = null
      this.applyIdleRenderFrameRateIfPossible()
    }, Math.max(40, Math.floor(Number(delayMs) || 0)))
  }

  private applyIdleRenderFrameRateIfPossible(): void {
    if (!this.canUseIdleRenderCadence()) {
      this.scheduleRenderIdleCheck(RENDER_ACTIVITY_SETTLE_MS)
      return
    }

    this.applyRenderFrameRate(this.idleFrameRate)
  }

  private canUseIdleRenderCadence(): boolean {
    if (!this.sceneReady || !this.game) return false
    if (Date.now() < this.renderActivityUntilMs) return false
    if (this.resolving || this.autoplayTickInFlight || this.aiStatus.active) return false
    if (this.activeCascadeTweenCount > 0) return false
    if (this.hintPulseTimer || this.pendingTextureLoads.size > 0) return false
    return true
  }

  private applyRenderFrameRate(fpsLimit: number, immediate = false): void {
    if (!this.game) return

    const safeLimit = Math.max(1, Math.floor(Number(fpsLimit) || this.activeFrameRate))
    if (this.currentRenderFrameRate === safeLimit && !immediate) {
      return
    }

    const loop = this.game.loop as MutablePhaserTimeStep
    loop.targetFps = safeLimit
    loop.fpsLimit = safeLimit
    loop.hasFpsLimit = safeLimit > 0
    loop._limitRate = safeLimit > 0 ? 1000 / safeLimit : 0
    loop._target = 1000 / safeLimit
    this.currentRenderFrameRate = safeLimit

    if (immediate && typeof loop.tick === 'function') {
      loop.tick()
    }
  }

  private ensureTextureReady(url: string, key: string): boolean {
    const resolvedKey = String(key).trim()
    if (!resolvedKey) return false
    if (this.textures.exists(resolvedKey)) return true
    if (this.failedTextureLoads.has(resolvedKey)) return false

    if (!this.pendingTextureLoads.has(resolvedKey)) {
      this.pendingTextureLoads.add(resolvedKey)
      this.load.image(resolvedKey, url)

      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.pendingTextureLoads.delete(resolvedKey)
        this.renderBoard()
      })

      if (!this.load.isLoading()) {
        this.load.start()
      }
    }

    return false
  }
}
