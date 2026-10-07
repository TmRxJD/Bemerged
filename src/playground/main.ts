import Phaser from 'phaser'
import {
  applyBemergedUniqueEffectTuningPatch,
  type AutoplayGoal,
  type AutoplayStatus,
  type BemergedRenderQuality,
  type BemergedRuntimeState,
  type GameStats,
  type ModelDrivenAutoplayDecisionProvider,
  BASE_RATES,
  BemergedHudController,
  BOARD_COLS,
  BOARD_ROWS,
  TILE_SIZE,
  Match3Scene,
  applyBemergedParityTuningPatch,
  getBemergedParityTuningSnapshot,
  getBemergedUniqueEffectTuningSnapshot,
  loadBemergedRuntimeState,
  saveBemergedRuntimeState,
} from '../index'
import { ASSETS } from '../assets'

type BemergedAiModule = {
  createAutoplayDecisionProvider: (options?: {
    warmSemanticModel?: (input: { modelId: string }) => Promise<void>
    onHealthEvent?: (event: { stage: string; ok: boolean; detail: string; modelId?: string }) => void
  }) => Promise<ModelDrivenAutoplayDecisionProvider>
  loadBemergedLearningProfile?: () => Promise<unknown>
  recordBemergedAttempt?: (input: {
    goal: AutoplayGoal
    elapsedSeconds: number
    totalShards: number
    objective: ReturnType<Match3Scene['getObjectiveProgress']>
  }) => Promise<unknown>
}

type BemergedDevApi = {
  restart: () => void
  shuffle: () => void
  snapshot: () => ReturnType<Match3Scene['debugSnapshot']>
  autoplayStep: (goal?: AutoplayGoal | string) => ReturnType<Match3Scene['runAutoplayStep']>
  spawnBoss: (cell?: { row: number; col: number }, options?: { replaceExisting?: boolean }) => ReturnType<Match3Scene['debugSpawnBoss']>
  addMine: (cell?: { row: number; col: number }, overrides?: { movesRemaining?: number; blastRadius?: number }) => ReturnType<Match3Scene['debugAddMine']>
  previewBossCombo: (selection: Array<{ row: number; col: number }>) => ReturnType<Match3Scene['debugPreviewBossCombo']>
  applyBossCombo: (selection: Array<{ row: number; col: number }>) => ReturnType<Match3Scene['debugApplyBossCombo']>
  triggerMine: (cell: { row: number; col: number }) => ReturnType<Match3Scene['debugTriggerMine']>
  applyParityPatch: (patch: Parameters<typeof applyBemergedParityTuningPatch>[0]) => ReturnType<typeof applyBemergedParityTuningPatch>
  applyUniqueEffectPatch: (patch: Parameters<typeof applyBemergedUniqueEffectTuningPatch>[0]) => ReturnType<typeof applyBemergedUniqueEffectTuningPatch>
}

declare global {
  interface Window {
    __BEMERGED_DEV__?: BemergedDevApi
  }
}

const PREVIEW_BAR_HEIGHT = 72
const LOGICAL_GAME_WIDTH = BOARD_COLS * TILE_SIZE
const LOGICAL_GAME_HEIGHT = (BOARD_ROWS * TILE_SIZE) + PREVIEW_BAR_HEIGHT
const importMetaEnv: Record<string, string | undefined> = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
const LOCAL_AI_AVAILABLE = String(importMetaEnv.VITE_BEMERGED_LOCAL_AI_AVAILABLE || '').trim() === 'true'
const LOCAL_AI_MODULE_SPECIFIER = String(importMetaEnv.VITE_BEMERGED_LOCAL_AI_MODULE_SPECIFIER || '').trim()

let aiModulePromise: Promise<BemergedAiModule> | null = null
let aiAutoplayInitializing = false
let aiUsedInAttempt = false
let latestStats: GameStats = {
  score: 0,
  moves: 0,
  merges: 0,
  shatters: 0,
  bossesKilled: 0,
  elapsedSeconds: 0,
  shardsPerHour: 0,
  shardsByType: {
    Cannon: 0,
    Armor: 0,
    Generator: 0,
    Core: 0,
  },
}
let latestRuntimeState: BemergedRuntimeState | null = null
let runtimeSaveTimer: number | null = null
let latestAutoplay: AutoplayStatus = {
  active: false,
  delayMs: 250,
  goal: 'objective-progress' as AutoplayGoal,
  testingMode: false,
  movesExecuted: 0,
  mergesExecuted: 0,
  validMoveCount: 0,
  lastDecision: null,
  lastReward: null,
  elapsedSeconds: 0,
  lastError: null,
}
let game: Phaser.Game | null = null
let scene = new Match3Scene()

const hud = new BemergedHudController()
hud.setAiGameplayAvailable(LOCAL_AI_AVAILABLE)
hud.setAiCloudUsageSummary('')

function syncHudTuningSnapshots(): void {
  hud.setParitySettings(getBemergedParityTuningSnapshot())
  hud.setUniqueEffectSettings(getBemergedUniqueEffectTuningSnapshot())
}

syncHudTuningSnapshots()

function getBemergedRendererType(quality: BemergedRenderQuality): number {
  void quality
  return Phaser.CANVAS
}

function getBemergedFrameRateTarget(quality: BemergedRenderQuality): number {
  void quality
  return 60
}

function applyBemergedRenderSurfaceSizing(): void {
  const host = document.getElementById('bemerged-game-host')
  const canvas = game?.canvas
  const compact = window.innerWidth < 1200 || window.innerHeight < 760
  const shortLandscape = window.innerWidth >= 680 && window.innerHeight <= 620
  const availableWidth = Math.max(240, window.innerWidth - (shortLandscape ? 280 : 24))
  const availableHeight = Math.max(180, window.innerHeight - (shortLandscape ? 105 : window.innerWidth < 600 ? 230 : 210))
  const scale = compact ? Math.min(1, availableWidth / LOGICAL_GAME_WIDTH, availableHeight / LOGICAL_GAME_HEIGHT) : 1
  const widthPx = `${Math.floor(LOGICAL_GAME_WIDTH * scale)}px`
  const heightPx = `${Math.floor(LOGICAL_GAME_HEIGHT * scale)}px`
  document.getElementById('bemerged-shell')?.classList.toggle('bemerged-compact', compact)
  document.documentElement.style.setProperty('--bemerged-display-width', widthPx)

  if (host instanceof HTMLElement) {
    host.style.width = widthPx
    host.style.height = heightPx
  }

  if (canvas instanceof HTMLCanvasElement) {
    game?.scale.refresh()
    canvas.style.width = widthPx
    canvas.style.height = heightPx
    canvas.style.margin = '0'
    canvas.style.display = 'block'
  }
}

function revealUi(): void {
  document.body.classList.remove('bemerged-loading')
  window.requestAnimationFrame(() => {
    document.body.classList.remove('bemerged-loading')
  })
}

function scheduleRuntimeSave(state: BemergedRuntimeState): void {
  latestRuntimeState = state
  if (runtimeSaveTimer !== null) {
    window.clearTimeout(runtimeSaveTimer)
  }
  runtimeSaveTimer = window.setTimeout(() => {
    runtimeSaveTimer = null
    if (!latestRuntimeState) return
    void saveBemergedRuntimeState(latestRuntimeState)
  }, 220)
}

function flushRuntimeSave(): void {
  if (runtimeSaveTimer !== null) {
    window.clearTimeout(runtimeSaveTimer)
    runtimeSaveTimer = null
  }
  if (latestRuntimeState) {
    void saveBemergedRuntimeState(latestRuntimeState)
  }
}

async function loadRuntimeStateWithTimeout(timeoutMs = 1200): Promise<BemergedRuntimeState | null> {
  try {
    const timeoutPromise = new Promise<null>(resolve => {
      window.setTimeout(() => resolve(null), timeoutMs)
    })
    return await Promise.race([loadBemergedRuntimeState(), timeoutPromise])
  } catch {
    return null
  }
}

async function getBemergedAiModule(): Promise<BemergedAiModule> {
  if (!LOCAL_AI_AVAILABLE) {
    throw new Error('AI Play is not available in this local host.')
  }

  if (!LOCAL_AI_MODULE_SPECIFIER) {
    throw new Error('AI Play is enabled for this host, but no AI module specifier was configured.')
  }

  if (!aiModulePromise) {
    aiModulePromise = import(/* @vite-ignore */ LOCAL_AI_MODULE_SPECIFIER) as Promise<BemergedAiModule>
  }

  try {
    return await aiModulePromise
  } catch (error) {
    aiModulePromise = null
    throw error
  }
}

async function hydrateAiLearningProfile(): Promise<void> {
  if (!LOCAL_AI_AVAILABLE) return
  try {
    const aiModule = await getBemergedAiModule()
    const profile = await aiModule.loadBemergedLearningProfile?.()
    if (profile) {
      scene.setAutoplayLearningProfile(profile as Parameters<Match3Scene['setAutoplayLearningProfile']>[0])
    }
  } catch {
    void 0
  }
}

async function recordAiAttempt(reason: string): Promise<void> {
  if (!LOCAL_AI_AVAILABLE || !aiUsedInAttempt) return
  const movesExecuted = Number(latestAutoplay.movesExecuted || 0)
  if (movesExecuted <= 0) return

  try {
    const aiModule = await getBemergedAiModule()
    const profile = await aiModule.recordBemergedAttempt?.({
      goal: latestAutoplay.goal,
      elapsedSeconds: latestStats.elapsedSeconds,
      totalShards: latestStats.score,
      objective: scene.getObjectiveProgress(),
    })
    if (profile) {
      scene.setAutoplayLearningProfile(profile as Parameters<Match3Scene['setAutoplayLearningProfile']>[0])
    }
    hud.setStatus(`AI attempt saved (${reason}).`)
  } catch {
    void 0
  }
}

async function prepareAiAutoplayProvider(): Promise<ModelDrivenAutoplayDecisionProvider> {
  const aiModule = await getBemergedAiModule()
  return await aiModule.createAutoplayDecisionProvider({
    onHealthEvent: event => {
      if (!event.ok) {
        console.warn('[bemerged] Gameplay AI health event:', event)
      }
    },
  })
}

function applyAiRestartControlsFromSettings(settings: ReturnType<BemergedHudController['getUiSettings']>): void {
  const restartFrequency = Math.max(0, Math.floor(Number(settings.aiRestartFrequency) || 0))
  const restartOffset = restartFrequency > 0
    ? Math.max(0, Math.floor(Number(settings.aiRestartOffset) || 0))
    : 0

  scene.setAutoplayTuningPatch({
    restartFrequency,
    restartOffset,
  })
}

function installBemergedDevApi(): void {
  window.__BEMERGED_DEV__ = {
    restart: () => {
      scene.restartBoard('debug-api-restart')
    },
    shuffle: () => {
      scene.shuffleBoard()
    },
    snapshot: () => scene.debugSnapshot(),
    autoplayStep: goal => scene.runAutoplayStep({ goal }),
    spawnBoss: (cell, options) => scene.debugSpawnBoss(cell, options),
    addMine: (cell, overrides) => scene.debugAddMine(cell, overrides),
    previewBossCombo: selection => scene.debugPreviewBossCombo(selection),
    applyBossCombo: selection => scene.debugApplyBossCombo(selection),
    triggerMine: cell => scene.debugTriggerMine(cell),
    applyParityPatch: patch => {
      const next = applyBemergedParityTuningPatch(patch)
      BASE_RATES.Common = next.dropRates.Common
      BASE_RATES.Rare = next.dropRates.Rare
      BASE_RATES.Epic = next.dropRates.Epic
      syncHudTuningSnapshots()
      return next
    },
    applyUniqueEffectPatch: patch => {
      const next = applyBemergedUniqueEffectTuningPatch(patch)
      syncHudTuningSnapshots()
      return next
    },
  }
}

function hydrateRulesUniqueIcons(): void {
  const icons = document.querySelectorAll<HTMLElement>('.rules-unique-icon[data-asset-dir][data-icon-key]')

  for (const icon of icons) {
    const assetDir = String(icon.dataset.assetDir || '').trim()
    const iconKey = String(icon.dataset.iconKey || '').trim()
    const frameKey = String(icon.dataset.frameKey || '').trim()
    const assetMap = (ASSETS as Record<string, Record<string, string> | undefined>)[assetDir]
    if (!assetMap) continue

    const iconSrc = assetMap[iconKey]
    const frameSrc = frameKey ? assetMap[frameKey] : ''

    if (iconSrc) {
      icon.style.setProperty('--rules-unique-icon-image', `url("${iconSrc}")`)
    }
    if (frameSrc) {
      icon.style.setProperty('--rules-unique-frame-image', `url("${frameSrc}")`)
    }
  }
}

const sceneCallbacks = {
  onStats: (stats: GameStats) => {
    latestStats = stats
    hud.setStats(stats)
    const objective = scene.getObjectiveProgress()
    if (objective.objectiveComplete) {
      hud.setStatus('Objective complete.')
    }
    revealUi()
  },
  onAutoplay: (status: AutoplayStatus) => {
    latestAutoplay = status
    hud.setAutoplay(status)
  },
  onInventory: (inventory: Parameters<BemergedHudController['setInventory']>[0]) => {
    hud.setInventory(inventory)
    revealUi()
  },
  onSpecials: (state: Parameters<BemergedHudController['setSpecials']>[0]) => {
    hud.setSpecials(state)
    revealUi()
  },
  onStatus: (status: string) => {
    hud.setStatus(status)
  },
  onRuntimeStateChanged: (runtimeState: BemergedRuntimeState) => {
    scheduleRuntimeSave(runtimeState)
  },
}

function createScene(renderQuality: BemergedRenderQuality): Match3Scene {
  const nextScene = new Match3Scene(1, getBemergedFrameRateTarget(renderQuality))
  nextScene.setCallbacks(sceneCallbacks)
  nextScene.setAiGovernanceMode('normal')
  return nextScene
}

async function destroyGame(): Promise<void> {
  if (!game) return
  const activeGame = game
  game = null
  activeGame.destroy(true)
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
}

hydrateRulesUniqueIcons()

async function bootstrapGame(runtimeStateOverride?: BemergedRuntimeState | null): Promise<void> {
  const persistedRuntimeState = runtimeStateOverride ?? await loadRuntimeStateWithTimeout()
  latestRuntimeState = persistedRuntimeState
  const initialUiSettings = hud.getUiSettings()
  const nextScene = createScene(initialUiSettings.renderQuality)
  if (persistedRuntimeState) {
    nextScene.setInitialRuntimeState(persistedRuntimeState)
  }
  nextScene.setUiSettings(initialUiSettings)
  applyAiRestartControlsFromSettings(initialUiSettings)
  scene = nextScene

  const rendererType = getBemergedRendererType(initialUiSettings.renderQuality)
  game = new Phaser.Game({
    type: rendererType,
    antialias: true,
    transparent: true,
    fps: {
      target: getBemergedFrameRateTarget(initialUiSettings.renderQuality),
      limit: getBemergedFrameRateTarget(initialUiSettings.renderQuality),
      forceSetTimeOut: false,
    },
    scale: {
      parent: 'bemerged-game-host',
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: LOGICAL_GAME_WIDTH,
      height: LOGICAL_GAME_HEIGHT,
    },
    render: {
      antialias: true,
      pixelArt: false,
      powerPreference: 'high-performance',
      roundPixels: false,
    },
    scene,
  })

  applyBemergedRenderSurfaceSizing()
  window.requestAnimationFrame(() => applyBemergedRenderSurfaceSizing())

  if (LOCAL_AI_AVAILABLE) {
    void hydrateAiLearningProfile()
  }

  revealUi()
}

async function rebuildGameForRenderQuality(): Promise<void> {
  const runtimeState = latestRuntimeState
  hud.setStatus('Applying render quality...')
  await destroyGame()
  await bootstrapGame(runtimeState)
}

function openRulesDialog(): void {
  const dialogEl = document.getElementById('bemerged-rules-dialog') as HTMLDialogElement | null
  if (!dialogEl) return
  if (!dialogEl.open) {
    dialogEl.showModal()
  }
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
    hud.setFullscreenState(false)
    return
  }

  const shell = document.getElementById('app')
  if (!(shell instanceof HTMLElement)) return
  if (!shell.requestFullscreen) {
    hud.setStatus('Your browser already uses the full window. Add to Home Screen for an immersive view.')
    return
  }
  try {
    await shell.requestFullscreen()
    hud.setFullscreenState(true)
  } catch {
    hud.setStatus('Fullscreen unavailable. The game still fills your browser window.')
  }
}

const rulesCloseBtn = document.getElementById('btn-rules-close') as HTMLButtonElement | null
const rulesDialogEl = document.getElementById('bemerged-rules-dialog') as HTMLDialogElement | null
rulesCloseBtn?.addEventListener('click', () => rulesDialogEl?.close())
rulesDialogEl?.addEventListener('click', event => {
  if (event.target === rulesDialogEl) {
    rulesDialogEl.close()
  }
})

document.addEventListener('fullscreenchange', () => {
  hud.setFullscreenState(Boolean(document.fullscreenElement))
})

hud.bindActions({
  onAiStart: async payload => {
    if (aiAutoplayInitializing || latestAutoplay.active) return

    if (!payload.useAiAutoplay || !LOCAL_AI_AVAILABLE) {
      scene.setAutoplayDecisionProvider(null)
      aiUsedInAttempt = false
      latestAutoplay = scene.startAutoplay({ delayMs: payload.delayMs, testingMode: false })
      hud.setAutoplay(latestAutoplay)
      hud.setStatus('Scripted autoplay started (demo mode)')
      return
    }

    aiAutoplayInitializing = true
    hud.setAiInitializing(true)
    hud.setStatus('Initializing AI Play addon...')

    try {
      const provider = await prepareAiAutoplayProvider()
      scene.setAutoplayDecisionProvider(provider)
      aiUsedInAttempt = true
      latestAutoplay = scene.startAutoplay({ delayMs: payload.delayMs, testingMode: false })
      hud.setAutoplay(latestAutoplay)
      hud.setStatus('AI Play started')
    } catch (error) {
      scene.setAutoplayDecisionProvider(null)
      console.error('[bemerged] AI Play unavailable:', error)
    } finally {
      aiAutoplayInitializing = false
      hud.setAiInitializing(false)
    }
  },
  onAiStop: () => {
    latestAutoplay = scene.stopAutoplay('Autoplay stopped')
    scene.setAutoplayDecisionProvider(null)
    void recordAiAttempt('stop')
  },
  onRestart: () => {
    scene.restartBoard()
    scene.setAutoplayDecisionProvider(null)
    void recordAiAttempt('restart')
    aiUsedInAttempt = false
  },
  onShuffle: () => {
    scene.shuffleBoard()
  },
  onPauseToggle: () => {
    const paused = scene.togglePaused()
    if (paused && latestAutoplay.active) {
      latestAutoplay = scene.stopAutoplay('Paused')
      scene.setAutoplayDecisionProvider(null)
    }
    hud.setPaused(paused)
  },
  onFullscreenToggle: () => {
    void toggleFullscreen()
  },
  onHint: () => {
    scene.showHint()
  },
  onInventorySlotClick: type => {
    scene.onInventorySlotClick(type)
  },
  onShardTypeClick: type => {
    scene.onShardTypeClick(type)
  },
  onRules: () => {
    openRulesDialog()
  },
  onSettingsToggle: () => {
    hud.toggleSettingsPanel()
  },
  onSettingsApply: patch => {
    const parityPatch = applyBemergedParityTuningPatch(patch.parityPatch)
    const uniqueEffectPatch = applyBemergedUniqueEffectTuningPatch(patch.uniqueEffectPatch || {})
    BASE_RATES.Common = parityPatch.dropRates.Common
    BASE_RATES.Rare = parityPatch.dropRates.Rare
    BASE_RATES.Epic = parityPatch.dropRates.Epic

    const previousUiSettings = hud.getUiSettings()
    hud.setParitySettings(parityPatch)
    hud.setUniqueEffectSettings(uniqueEffectPatch)
    hud.setUiSettings(patch.uiSettings)
    applyAiRestartControlsFromSettings(patch.uiSettings)

    if (previousUiSettings.renderQuality !== patch.uiSettings.renderQuality) {
      void rebuildGameForRenderQuality()
      return
    }

    scene.setUiSettings(patch.uiSettings)
  },
})

window.addEventListener('resize', () => {
  applyBemergedRenderSurfaceSizing()
})

window.addEventListener('beforeunload', () => {
  flushRuntimeSave()
})

window.addEventListener('pagehide', () => {
  flushRuntimeSave()
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushRuntimeSave()
  }
})

installBemergedDevApi()

void bootstrapGame()
