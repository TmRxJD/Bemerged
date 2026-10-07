import { importedMergeChart, TYPE_TOKENS } from '../assets'
import { applyBackground, BACKGROUNDS, formatBackgroundDisplay, type BackgroundKey } from '../assets/backgrounds'
import { formatUniqueEffectDisplayName, getUniqueModuleHoverText, getModuleVariantAdornmentText } from '../engine/modulePresentation'
import type { BemergedParityTuning, BemergedParityTuningPatch } from '../engine/parityTuning'
import type { BemergedUniqueEffectTuning, BemergedUniqueEffectTuningPatch, UniqueEffectId } from '../engine/uniqueEffects'
import type { AutoplayStatus, GameStats, ModuleToken, ModuleType } from '../engine/types'
import { DEFAULT_BEMERGED_BACKGROUND, loadBemergedBackgroundUnlockState } from './backgroundUnlocks'

export type BemergedOrientation = 'landscape' | 'portrait'

export type BemergedRenderQuality = 'balanced' | 'high' | 'max'

export type BemergedUiSettings = {
  orientation: BemergedOrientation
  autoShatterRares: boolean
  disableHints: boolean
  hoverDescriptions: boolean
  background: BackgroundKey
  renderQuality: BemergedRenderQuality
  useAiAutoplay: boolean
  aiRestartFrequency: number
  aiRestartOffset: number
  aiDevControls: boolean
  enableDevControls: boolean
}

export type BemergedSettingsApplyPayload = {
  parityPatch: BemergedParityTuningPatch
  uniqueEffectPatch?: BemergedUniqueEffectTuningPatch
  dropRatesPatch?: {
    commonPercent?: number
    rarePercent?: number
    epicPercent?: number
  }
  uiSettings: BemergedUiSettings
}

type HudActions = {
  onAiStart: (payload: { delayMs: number; useAiAutoplay: boolean }) => void
  onAiStop: () => void
  onRestart: () => void
  onShuffle: () => void
  onPauseToggle: () => void
  onFullscreenToggle: () => void
  onHint: () => void
  onInventorySlotClick: (type: ModuleType) => void
  onShardTypeClick: (type: ModuleType) => void
  onRules: () => void
  onSettingsToggle: () => void
  onSettingsApply: (payload: BemergedSettingsApplyPayload) => void
}

const UI_SETTINGS_STORAGE_KEY = 'bemerged_ui_settings_v2'

function getInventoryVariantAccentColor(token: ModuleToken): string {
  if (token.rarity === 'Mythic' || token.rarity === 'Ancestral') return '#f59e0b'
  if (token.rarity === 'Legendary') return '#f97316'
  if (token.rarity === 'Epic') return '#38bdf8'
  return '#22d3ee'
}

const DEFAULT_UI_SETTINGS: BemergedUiSettings = {
  orientation: 'landscape',
  autoShatterRares: false,
  disableHints: false,
  hoverDescriptions: true,
  background: DEFAULT_BEMERGED_BACKGROUND,
  renderQuality: 'high',
  useAiAutoplay: false,
  aiRestartFrequency: 0,
  aiRestartOffset: 0,
  aiDevControls: false,
  enableDevControls: false,
}

const shardTypeOrder: ModuleType[] = ['Cannon', 'Generator', 'Armor', 'Core']

type ParityControlSpec = {
  key: string
  label: string
  min?: number
  max?: number
  step?: number
  read: (settings: BemergedParityTuning) => number
  write: (patch: BemergedParityTuningPatch, value: number) => void
}

const PARITY_CONTROL_SPECS: ParityControlSpec[] = [
  {
    key: 'shardsPerClear',
    label: 'Shards per clear',
    min: 1,
    max: 200,
    step: 1,
    read: settings => settings.shardsPerClear,
    write: (patch, value) => {
      patch.shardsPerClear = value
    },
  },
  {
    key: 'dropCommon',
    label: 'Common drop rate',
    min: 0,
    max: 1,
    step: 0.001,
    read: settings => settings.dropRates.Common,
    write: (patch, value) => {
      patch.dropRates = { ...(patch.dropRates || {}), Common: value }
    },
  },
  {
    key: 'dropRare',
    label: 'Rare drop rate',
    min: 0,
    max: 1,
    step: 0.001,
    read: settings => settings.dropRates.Rare,
    write: (patch, value) => {
      patch.dropRates = { ...(patch.dropRates || {}), Rare: value }
    },
  },
  {
    key: 'dropEpic',
    label: 'Epic drop rate',
    min: 0,
    max: 1,
    step: 0.001,
    read: settings => settings.dropRates.Epic,
    write: (patch, value) => {
      patch.dropRates = { ...(patch.dropRates || {}), Epic: value }
    },
  },
  {
    key: 'mineBaseMoves',
    label: 'Mine base moves',
    min: 1,
    max: 100,
    step: 1,
    read: settings => settings.mine.baseMoves,
    write: (patch, value) => {
      patch.mine = { ...(patch.mine || {}), baseMoves: value }
    },
  },
  {
    key: 'mineBlastRadius',
    label: 'Mine blast radius',
    min: 1,
    max: 4,
    step: 1,
    read: settings => settings.mine.blastRadius,
    write: (patch, value) => {
      patch.mine = { ...(patch.mine || {}), blastRadius: value }
    },
  },
  {
    key: 'mineSpawnPercentPerDrop',
    label: 'Mine spawn % per drop',
    min: 0,
    max: 50,
    step: 1,
    read: settings => settings.mine.spawnPercentPerDrop,
    write: (patch, value) => {
      patch.mine = { ...(patch.mine || {}), spawnPercentPerDrop: value }
    },
  },
  {
    key: 'mineSpawnCooldownMoves',
    label: 'Mine spawn cooldown',
    min: 0,
    max: 500,
    step: 1,
    read: settings => settings.mine.spawnCooldownMoves,
    write: (patch, value) => {
      patch.mine = { ...(patch.mine || {}), spawnCooldownMoves: value }
    },
  },
  {
    key: 'mineReducedRadiusChancePercent',
    label: 'Reduced blast %',
    min: 0,
    max: 100,
    step: 1,
    read: settings => settings.mine.reducedRadiusChancePercent,
    write: (patch, value) => {
      patch.mine = { ...(patch.mine || {}), reducedRadiusChancePercent: value }
    },
  },
  {
    key: 'mineReducedRadiusTiles',
    label: 'Reduced blast tiles',
    min: 0,
    max: 4,
    step: 1,
    read: settings => settings.mine.reducedRadiusTiles,
    write: (patch, value) => {
      patch.mine = { ...(patch.mine || {}), reducedRadiusTiles: value }
    },
  },
  {
    key: 'mineManualTriggerDoubleTapMs',
    label: 'Mine double-tap ms',
    min: 100,
    max: 1200,
    step: 10,
    read: settings => settings.mine.manualTriggerDoubleTapMs,
    write: (patch, value) => {
      patch.mine = { ...(patch.mine || {}), manualTriggerDoubleTapMs: value }
    },
  },
  {
    key: 'bossSpawnEveryMoves',
    label: 'Boss spawn every moves',
    min: 1,
    max: 1000,
    step: 1,
    read: settings => settings.boss.spawnEveryMoves,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), spawnEveryMoves: value }
    },
  },
  {
    key: 'bossBaseRequiredHits',
    label: 'Boss base HP',
    min: 1,
    max: 100000,
    step: 1,
    read: settings => settings.boss.baseRequiredHits,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), baseRequiredHits: value }
    },
  },
  {
    key: 'bossRequiredHitsStepPerSpawn',
    label: 'Boss HP step',
    min: 0,
    max: 1000,
    step: 1,
    read: settings => settings.boss.requiredHitsStepPerSpawn,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), requiredHitsStepPerSpawn: value }
    },
  },
  {
    key: 'bossDecayGraceMoves',
    label: 'Boss grace moves',
    min: 0,
    max: 200,
    step: 1,
    read: settings => settings.boss.decayGraceMoves,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), decayGraceMoves: value }
    },
  },
  {
    key: 'bossDecaySampleCount',
    label: 'Boss sample count',
    min: 0,
    max: 8,
    step: 1,
    read: settings => settings.boss.decaySampleCount,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), decaySampleCount: value }
    },
  },
  {
    key: 'bossDecayTierLoss',
    label: 'Boss decay tier loss',
    min: 0,
    max: 4,
    step: 1,
    read: settings => settings.boss.decayTierLoss,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), decayTierLoss: value }
    },
  },
  {
    key: 'bossMoveEveryMoves',
    label: 'Boss move every moves',
    min: 1,
    max: 20,
    step: 1,
    read: settings => settings.boss.moveEveryMoves,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), moveEveryMoves: value }
    },
  },
  {
    key: 'bossBurstEveryMoves',
    label: 'Boss burst every moves',
    min: 1,
    max: 20,
    step: 1,
    read: settings => settings.boss.burstEveryMoves,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), burstEveryMoves: value }
    },
  },
  {
    key: 'bossBurstRadius',
    label: 'Boss burst radius',
    min: 1,
    max: 4,
    step: 1,
    read: settings => settings.boss.burstRadius,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), burstRadius: value }
    },
  },
  {
    key: 'bossBurstTierLoss',
    label: 'Boss burst tier loss',
    min: 0,
    max: 4,
    step: 1,
    read: settings => settings.boss.burstTierLoss,
    write: (patch, value) => {
      patch.boss = { ...(patch.boss || {}), burstTierLoss: value }
    },
  },
  {
    key: 'comboLongPressMs',
    label: 'Combo long-press ms',
    min: 100,
    max: 1200,
    step: 10,
    read: settings => settings.combo.longPressMs,
    write: (patch, value) => {
      patch.combo = { ...(patch.combo || {}), longPressMs: value }
    },
  },
  {
    key: 'comboStackDamagePercent',
    label: 'Combo stack %',
    min: 0,
    max: 100,
    step: 1,
    read: settings => settings.combo.stackDamagePercent,
    write: (patch, value) => {
      patch.combo = { ...(patch.combo || {}), stackDamagePercent: value }
    },
  },
  {
    key: 'damageBaseTierDamage',
    label: 'Base tier damage',
    min: 0,
    max: 100,
    step: 1,
    read: settings => settings.damage.baseTierDamage,
    write: (patch, value) => {
      patch.damage = { ...(patch.damage || {}), baseTierDamage: value }
    },
  },
  {
    key: 'damageTierStepDamage',
    label: 'Tier step damage',
    min: 0,
    max: 100,
    step: 1,
    read: settings => settings.damage.tierStepDamage,
    write: (patch, value) => {
      patch.damage = { ...(patch.damage || {}), tierStepDamage: value }
    },
  },
]

const UNIQUE_RARITY_ORDER: Array<keyof BemergedUniqueEffectTuning['effects'][UniqueEffectId]> = ['Epic', 'Legendary', 'Mythic', 'Ancestral']

export class BemergedHudController {
  private readonly scoreEl = document.getElementById('hud-score')
  private readonly moveEl = document.getElementById('hud-moves')
  private readonly mergesEl = document.getElementById('hud-merges')
  private readonly shattersEl = document.getElementById('hud-shatters')
  private readonly timerEl = document.getElementById('hud-timer')
  private readonly minesEl = document.getElementById('hud-mines')
  private readonly bossHpEl = document.getElementById('hud-boss-hp')
  private readonly bossWaveEl = document.getElementById('hud-boss-wave')
  private readonly bossPhaseEl = document.getElementById('hud-boss-phase')
  private readonly statusEl = document.getElementById('hud-status')
  private readonly delayInput = document.getElementById('ai-delay') as HTMLInputElement | null
  private readonly aiStatusEl = document.getElementById('hud-ai-status')
  private readonly pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement | null
  private readonly aiInitOverlayEl = document.getElementById('bemerged-ai-init-overlay')
  private readonly aiInitTextEl = document.getElementById('bemerged-ai-init-text')
  private readonly aiInitProgressFillEl = document.getElementById('bemerged-ai-init-progress-fill')
  private readonly aiInitPercentEl = document.getElementById('bemerged-ai-init-percent')
  private readonly aiControlEl = document.getElementById('hud-ai-control')
  private readonly aiToggleBtn = document.getElementById('btn-ai-toggle') as HTMLButtonElement | null
  private readonly shardRow = document.getElementById('hud-shards-row')
  private readonly inventoryRoot = document.getElementById('inventory-grid')
  private readonly boardSlotEl = document.getElementById('bemerged-board-slot')
  private readonly pausedOverlayEl = document.getElementById('bemerged-paused-overlay')
  private readonly settingsPanelEl = document.getElementById('settings-panel')
  private readonly settingsButtonEl = document.getElementById('btn-settings')
  private readonly bossesKilledEl = document.getElementById('hud-bosses-killed')
  private readonly chartSlotEl = document.getElementById('bemerged-chart-slot')
  private readonly chartToggleBtn = document.getElementById('btn-toggle-chart') as HTMLButtonElement | null
  private readonly fullscreenToggleBtn = document.getElementById('btn-fullscreen') as HTMLButtonElement | null
  private readonly shellEl = document.getElementById('bemerged-shell')
  private readonly orientationEl = document.getElementById('set-orientation') as HTMLSelectElement | null
  private readonly autoShatterRaresEl = document.getElementById('set-auto-shatter-rares') as HTMLInputElement | null
  private readonly disableHintsEl = document.getElementById('set-disable-hints') as HTMLInputElement | null
  private readonly hoverDescriptionsEl = document.getElementById('set-hover-descriptions') as HTMLInputElement | null
  private readonly backgroundRowEl = document.getElementById('set-background-row')
  private readonly backgroundEl = document.getElementById('set-background') as HTMLSelectElement | null
  private readonly renderQualityEl = document.getElementById('set-render-quality') as HTMLSelectElement | null
  private readonly useAiAutoplayRowEl = document.getElementById('set-use-ai-autoplay-row')
  private readonly useAiAutoplayEl = document.getElementById('set-use-ai-autoplay') as HTMLInputElement | null
  private readonly aiRestartFrequencyRowEl = document.getElementById('set-ai-restart-frequency-row')
  private readonly aiRestartFrequencyEl = document.getElementById('set-ai-restart-frequency') as HTMLInputElement | null
  private readonly aiRestartOffsetRowEl = document.getElementById('set-ai-restart-offset-row')
  private readonly aiRestartOffsetEl = document.getElementById('set-ai-restart-offset') as HTMLInputElement | null
  private readonly aiCloudUsageRowEl = document.getElementById('set-ai-cloud-usage-row')
  private readonly aiDevControlsRowEl = document.getElementById('set-ai-dev-controls-row')
  private readonly aiDevControlsEl = document.getElementById('set-ai-dev-controls') as HTMLInputElement | null
  private readonly enableDevControlsEl = document.getElementById('set-enable-dev-controls') as HTMLInputElement | null
  private readonly devControlsGroupEl = document.getElementById('dev-controls-group')
  private readonly parityControlsRoot = document.getElementById('set-parity-controls')
  private readonly uniqueEffectControlsRoot = document.getElementById('set-unique-effect-controls')
  private actions: HudActions | null = null
  private aiGameplayAvailable = true
  private aiActive = false
  private aiInitializing = false
  private aiControlLabel = 'Control: none'
  private lastAutoplayStatus: AutoplayStatus = {
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

  private syncChartLayoutState(): void {
    const chartHidden = this.chartSlotEl?.classList.contains('hidden') ?? false
    this.shellEl?.classList.toggle('bemerged-shell--chart-hidden', chartHidden)
    if (this.chartToggleBtn) {
      this.chartToggleBtn.textContent = chartHidden ? 'Show Chart' : 'Hide Chart'
    }
  }

  private readonly mineSpawnEl = document.getElementById('set-mine-spawn') as HTMLInputElement | null
  private readonly rateCommonEl = document.getElementById('set-rate-common') as HTMLInputElement | null
  private readonly rateRareEl = document.getElementById('set-rate-rare') as HTMLInputElement | null
  private readonly rateEpicEl = document.getElementById('set-rate-epic') as HTMLInputElement | null
  private readonly mineCooldownEl = document.getElementById('set-mine-cooldown') as HTMLInputElement | null
  private readonly mineMovesEl = document.getElementById('set-mine-moves') as HTMLInputElement | null
  private readonly mineRadiusEl = document.getElementById('set-mine-radius') as HTMLInputElement | null
  private readonly bossSpawnEl = document.getElementById('set-boss-spawn') as HTMLInputElement | null
  private readonly bossHpElInput = document.getElementById('set-boss-hp') as HTMLInputElement | null
  private readonly bossStepEl = document.getElementById('set-boss-step') as HTMLInputElement | null
  private readonly bossThresholdEl = document.getElementById('set-boss-threshold') as HTMLInputElement | null
  private readonly bossMoveThresholdEl = document.getElementById('set-boss-move-threshold') as HTMLInputElement | null
  private readonly bossPhaseDurationEl = document.getElementById('set-boss-phase-duration') as HTMLInputElement | null
  private readonly commonDmgEl = document.getElementById('set-common-dmg') as HTMLInputElement | null
  private readonly rareDmgEl = document.getElementById('set-rare-dmg') as HTMLInputElement | null
  private readonly epicDmgEl = document.getElementById('set-epic-dmg') as HTMLInputElement | null
  private readonly legendaryDmgEl = document.getElementById('set-legendary-dmg') as HTMLInputElement | null
  private readonly mythicDmgEl = document.getElementById('set-mythic-dmg') as HTMLInputElement | null
  private readonly ancestralDmgEl = document.getElementById('set-ancestral-dmg') as HTMLInputElement | null
  private readonly shardsPerClearEl = document.getElementById('set-shards-per-clear') as HTMLInputElement | null
  private uiSettings: BemergedUiSettings = { ...DEFAULT_UI_SETTINGS }
  private unlockedBackgrounds: BackgroundKey[] = [DEFAULT_BEMERGED_BACKGROUND]
  private readonly parityInputs = new Map<string, HTMLInputElement>()
  private readonly uniqueEffectInputs = new Map<string, HTMLInputElement>()
  private lastStats: GameStats | null = null
  private lastInventory: Record<ModuleType, ModuleToken | null> = {
    Cannon: null,
    Generator: null,
    Armor: null,
    Core: null,
  }
  private paused = false
  private aiErrorMessage = ''

  constructor() {
    const chartImage = document.getElementById('merge-chart-image') as HTMLImageElement | null
    if (chartImage) {
      chartImage.src = String(importedMergeChart)
    }

    this.unlockedBackgrounds = loadBemergedBackgroundUnlockState().unlockedBackgrounds
    this.buildParityControls()
    this.uiSettings = this.loadUiSettingsFromStorage()
    this.populateBackgroundOptions()
    this.applyUiSettingsToDom(this.uiSettings)
    this.persistUiSettings()
  }

  bindActions(actions: HudActions): void {
    this.actions = actions
    const applyUiSettingsImmediately = () => {
      actions.onSettingsApply({
        parityPatch: {},
        uiSettings: this.readUiSettingsFromInputs(),
      })
    }

    this.aiToggleBtn?.addEventListener('click', () => {
      if (this.aiInitializing) return
      if (this.aiActive) {
        actions.onAiStop()
      } else {
        actions.onAiStart({
          delayMs: this.getDelayMs(),
          useAiAutoplay: this.uiSettings.useAiAutoplay,
        })
      }
    })
    document.getElementById('btn-restart')?.addEventListener('click', () => {
      actions.onRestart()
    })
    document.getElementById('btn-shuffle')?.addEventListener('click', () => {
      actions.onShuffle()
    })
    this.pauseBtn?.addEventListener('click', () => {
      actions.onPauseToggle()
    })
    this.fullscreenToggleBtn?.addEventListener('click', () => {
      actions.onFullscreenToggle()
    })
    document.getElementById('btn-hint')?.addEventListener('click', () => {
      actions.onHint()
    })
    document.getElementById('btn-rules')?.addEventListener('click', () => {
      actions.onRules()
    })
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      actions.onSettingsToggle()
    })
    document.addEventListener('pointerdown', event => {
      if (!this.settingsPanelEl || this.settingsPanelEl.classList.contains('hidden')) return

      const targetNode = event.target as Node | null
      if (!targetNode) return
      if (this.settingsPanelEl.contains(targetNode)) return
      if (this.settingsButtonEl?.contains(targetNode)) return

      this.settingsPanelEl.classList.add('hidden')
    })
    this.syncChartLayoutState()
    this.chartToggleBtn?.addEventListener('click', () => {
      this.chartSlotEl?.classList.toggle('hidden')
      this.syncChartLayoutState()
    })
    this.enableDevControlsEl?.addEventListener('change', () => {
      const settings = this.readUiSettingsFromInputs()
      this.applyUiSettingsToDom(settings)
      applyUiSettingsImmediately()
    })
    this.orientationEl?.addEventListener('change', () => {
      applyUiSettingsImmediately()
    })
    this.autoShatterRaresEl?.addEventListener('change', () => {
      applyUiSettingsImmediately()
    })
    this.disableHintsEl?.addEventListener('change', () => {
      applyUiSettingsImmediately()
    })
    this.hoverDescriptionsEl?.addEventListener('change', () => {
      applyUiSettingsImmediately()
    })
    this.backgroundEl?.addEventListener('change', () => {
      applyUiSettingsImmediately()
    })
    this.renderQualityEl?.addEventListener('change', () => {
      applyUiSettingsImmediately()
    })
    this.useAiAutoplayEl?.addEventListener('change', () => {
      const settings = this.readUiSettingsFromInputs()
      this.applyUiSettingsToDom(settings)
      applyUiSettingsImmediately()
      this.updateAiButtonLabel()
    })
    this.aiRestartFrequencyEl?.addEventListener('input', () => {
      const settings = this.readUiSettingsFromInputs()
      this.applyUiSettingsToDom(settings)
      applyUiSettingsImmediately()
    })
    this.aiRestartOffsetEl?.addEventListener('input', () => {
      const settings = this.readUiSettingsFromInputs()
      this.applyUiSettingsToDom(settings)
      applyUiSettingsImmediately()
    })
    this.aiDevControlsEl?.addEventListener('change', () => {
      applyUiSettingsImmediately()
    })
    document.getElementById('btn-settings-apply')?.addEventListener('click', () => {
      actions.onSettingsApply({
        parityPatch: this.getSettingsPatch(),
        uniqueEffectPatch: this.getUniqueEffectPatch(),
        uiSettings: this.readUiSettingsFromInputs(),
      })
    })
  }

  setUiSettings(settings: BemergedUiSettings): void {
    this.uiSettings = this.normalizeUiSettings(settings)
    this.applyUiSettingsToDom(this.uiSettings)
    this.persistUiSettings()
  }

  setAiGameplayAvailable(available: boolean): void {
    this.aiGameplayAvailable = available
    if (!available) {
      this.uiSettings = this.normalizeUiSettings({
        ...this.uiSettings,
        useAiAutoplay: false,
        aiDevControls: false,
        aiRestartFrequency: 0,
        aiRestartOffset: 0,
      })
      this.setAiCloudUsageSummary('')
    }
    this.applyUiSettingsToDom(this.uiSettings)
    this.persistUiSettings()
  }

  getUiSettings(): BemergedUiSettings {
    return { ...this.uiSettings }
  }

  setFullscreenState(active: boolean): void {
    if (!this.fullscreenToggleBtn) return
    this.fullscreenToggleBtn.textContent = active ? 'Exit Fullscreen' : 'Fullscreen'
    this.fullscreenToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false')
  }

  setParitySettings(settings: BemergedParityTuning): void {
    for (const spec of PARITY_CONTROL_SPECS) {
      const input = this.parityInputs.get(spec.key)
      if (!input) continue
      input.value = String(spec.read(settings))
    }
  }

  setUniqueEffectSettings(settings: BemergedUniqueEffectTuning): void {
    this.buildUniqueEffectControls(settings)
    for (const [effectId, scale] of Object.entries(settings.effects) as Array<[UniqueEffectId, BemergedUniqueEffectTuning['effects'][UniqueEffectId]]>) {
      for (const rarity of UNIQUE_RARITY_ORDER) {
        const input = this.uniqueEffectInputs.get(`${effectId}:${rarity}`)
        if (!input) continue
        input.value = String(scale[rarity])
      }
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.boardSlotEl?.classList.toggle('bemerged-board-slot--paused', paused)
    this.pausedOverlayEl?.classList.toggle('hidden', !paused)
    if (this.pauseBtn) {
      this.pauseBtn.textContent = paused ? 'Resume' : 'Pause'
      this.pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false')
    }
  }

  setShuffleCount(count: number): void {
    const normalized = Math.max(0, Math.floor(Number(count) || 0))
    const label = `Shuffle (${normalized})`
    const shuffleBtn = document.getElementById('btn-shuffle') as HTMLButtonElement | null
    if (!shuffleBtn) return
    shuffleBtn.textContent = label
    shuffleBtn.disabled = normalized <= 0
    shuffleBtn.title = normalized > 0
      ? `${normalized} shuffle${normalized === 1 ? '' : 's'} remaining`
      : 'No shuffles remaining'
  }

  setAiError(message: string | null): void {
    this.aiErrorMessage = String(message || '').trim()
    if (this.aiStatusEl) {
      this.aiStatusEl.removeAttribute('title')
      this.aiStatusEl.textContent = this.lastAutoplayStatus.active
        ? `Running (${this.lastAutoplayStatus.delayMs}ms)`
        : 'Idle'
    }

    if (this.aiToggleBtn) {
      this.aiToggleBtn.removeAttribute('title')
    }

    if (this.aiCloudUsageRowEl && this.aiErrorMessage) {
      this.aiCloudUsageRowEl.classList.add('hidden')
      this.aiCloudUsageRowEl.classList.remove('settings-note--warning')
    }
  }

  toggleSettingsPanel(): boolean {
    if (!this.settingsPanelEl) return false
    this.settingsPanelEl.classList.toggle('hidden')
    return !this.settingsPanelEl.classList.contains('hidden')
  }

  setStats(stats: GameStats): void {
    this.lastStats = {
      ...stats,
      shardsByType: { ...stats.shardsByType },
      shardBoostLevels: stats.shardBoostLevels ? { ...stats.shardBoostLevels } : undefined,
      shardBoostNextCost: stats.shardBoostNextCost ? { ...stats.shardBoostNextCost } : undefined,
      canAffordShardBoost: stats.canAffordShardBoost ? { ...stats.canAffordShardBoost } : undefined,
    }
    if (this.scoreEl) this.scoreEl.textContent = String(stats.score)
    if (this.moveEl) this.moveEl.textContent = String(stats.moves)
    if (this.mergesEl) this.mergesEl.textContent = String(stats.merges)
    if (this.shattersEl) this.shattersEl.textContent = String(stats.shatters)
    if (this.bossesKilledEl) this.bossesKilledEl.textContent = String(stats.bossesKilled)
    if (this.timerEl) this.timerEl.textContent = this.formatElapsed(stats.elapsedSeconds)
    this.setShuffleCount(stats.shuffleCharges ?? 3)

    if (this.shardRow) {
      this.shardRow.innerHTML = ''
      for (const type of shardTypeOrder) {
        const value = stats.shardsByType[type] || 0
        const level = Math.max(0, Math.floor(Number(stats.shardBoostLevels?.[type]) || 0))
        const nextCost = Math.max(1, Math.floor(Number(stats.shardBoostNextCost?.[type]) || 1000))
        const canAfford = !!stats.canAffordShardBoost?.[type]
        const item = document.createElement('div')
        item.className = 'shard-item'
        item.classList.toggle('shard-item-can-buy', canAfford)
        if (this.uiSettings.hoverDescriptions) {
          item.title = `${type} Epic level ${level}. Next level cost: ${nextCost.toLocaleString()} ${type} shards`
        } else {
          item.removeAttribute('title')
        }
        item.addEventListener('click', () => {
          this.actions?.onShardTypeClick(type)
        })

        const icon = document.createElement('img')
        icon.src = String(TYPE_TOKENS[type])
        icon.alt = type

        const valueEl = document.createElement('span')
        valueEl.className = 'shard-item-value'
        valueEl.textContent = `${value}`

        item.appendChild(icon)
        item.appendChild(valueEl)
        this.shardRow.appendChild(item)
      }
    }
  }

  setStatus(_status: string): void {
    void this.statusEl
  }

  setAutoplay(status: AutoplayStatus): void {
    this.lastAutoplayStatus = { ...status }
    this.aiActive = !!status.active
    if (this.aiErrorMessage) {
      this.updateAiButtonLabel()
      return
    }
    if (this.aiStatusEl) {
      this.aiStatusEl.textContent = status.active
        ? `Running (${status.delayMs}ms)`
        : 'Idle'
    }
    this.updateAiButtonLabel()
  }

  setAiInitializing(initializing: boolean): void {
    this.aiInitializing = initializing
    if (this.aiToggleBtn) {
      this.aiToggleBtn.disabled = initializing || (!this.aiGameplayAvailable && !this.aiActive)
    }
    if (initializing) {
      if (this.aiToggleBtn) this.aiToggleBtn.textContent = 'Initializing AI...'
      if (this.aiStatusEl) this.aiStatusEl.textContent = 'Initializing AI model...'
      this.setAiControlState('HUD AI init', 'model init in progress')
      this.setAiError(null)
      this.setAiInitProgress({
        visible: true,
        text: 'Preparing AI runtime...',
        progress: null,
      })
      return
    }

    this.setAiInitProgress({ visible: false })

    if (this.aiErrorMessage) {
      this.setAiError(this.aiErrorMessage)
      this.updateAiButtonLabel()
      return
    }

    if (this.aiStatusEl) {
      this.aiStatusEl.textContent = this.lastAutoplayStatus.active
        ? `Running (${this.lastAutoplayStatus.delayMs}ms)`
        : 'Idle'
    }
    this.updateAiButtonLabel()
  }

  setAiInitProgress(input: {
    visible: boolean
    text?: string
    progress?: number | null
  }): void {
    if (!this.aiInitOverlayEl) return

    this.aiInitOverlayEl.classList.toggle('hidden', !input.visible)
    if (!input.visible) return

    const text = String(input.text || '').trim() || 'Initializing AI model...'
    if (this.aiInitTextEl) {
      this.aiInitTextEl.textContent = text
    }

    const numericProgress = Number(input.progress)
    const hasProgress = Number.isFinite(numericProgress)
    const progressValue = hasProgress
      ? Math.max(0, Math.min(100, Math.floor(numericProgress)))
      : 0

    if (this.aiInitProgressFillEl) {
      this.aiInitProgressFillEl.style.width = hasProgress ? `${progressValue}%` : '8%'
    }

    const progressTrack = this.aiInitProgressFillEl?.parentElement
    if (progressTrack) {
      progressTrack.setAttribute('aria-valuenow', hasProgress ? String(progressValue) : '0')
    }

    if (this.aiInitPercentEl) {
      this.aiInitPercentEl.textContent = hasProgress
        ? `${progressValue}%`
        : 'Downloading model assets...'
    }
  }

  setAiControlState(source: string, detail?: string): void {
    const normalizedSource = String(source || '').trim() || 'none'
    const normalizedDetail = String(detail || '').trim()
    this.aiControlLabel = normalizedDetail
      ? `Control: ${normalizedSource} (${normalizedDetail})`
      : `Control: ${normalizedSource}`
    if (this.aiControlEl) {
      this.aiControlEl.textContent = this.aiControlLabel
    }
  }

  setAiCloudUsageSummary(text: string): void {
    if (!this.aiCloudUsageRowEl) return
    if (this.aiErrorMessage) return
    const normalized = String(text || '').trim()
    this.aiCloudUsageRowEl.textContent = normalized
    this.aiCloudUsageRowEl.classList.toggle('hidden', !this.aiGameplayAvailable || !this.uiSettings.useAiAutoplay || !normalized)
    this.aiCloudUsageRowEl.classList.toggle('settings-note--warning', /exceeded/i.test(normalized))
  }

  setSpecials(state: { mineCount: number; bossHp: number; bossWave: number; bossPhase: number }): void {
    if (this.minesEl) this.minesEl.textContent = String(state.mineCount)
    if (this.bossHpEl) this.bossHpEl.textContent = String(state.bossHp)
    if (this.bossWaveEl) {
      this.bossWaveEl.textContent = state.bossWave > 0 ? `(Wave ${state.bossWave})` : ''
    }
    if (this.bossPhaseEl) {
      this.bossPhaseEl.textContent = state.bossPhase > 0 ? `(P${state.bossPhase})` : ''
    }
  }

  setInventory(inventory: Record<ModuleType, ModuleToken | null>): void {
    if (!this.inventoryRoot) return
    this.lastInventory = {
      Cannon: inventory.Cannon ?? null,
      Generator: inventory.Generator ?? null,
      Armor: inventory.Armor ?? null,
      Core: inventory.Core ?? null,
    }
    this.inventoryRoot.innerHTML = ''

    for (const type of shardTypeOrder) {
      const slot = document.createElement('div')
      slot.className = 'inventory-slot'
      slot.addEventListener('click', () => {
        this.actions?.onInventorySlotClick(type)
      })

      const token = inventory[type]
      if (token) {
        const frame = document.createElement('img')
        frame.className = 'inv-frame'
        frame.src = token.frameSrc
        frame.alt = `${type} frame`

        const icon = document.createElement('img')
        icon.className = 'inv-icon'
        icon.src = token.assetSrc
        icon.alt = `${type} icon`

        slot.appendChild(frame)
        slot.appendChild(icon)

        const badgeText = getModuleVariantAdornmentText(token)
        if (badgeText) {
          const badge = document.createElement('span')
          badge.className = 'inventory-variant-badge'
          if (badgeText.length > 1) {
            badge.classList.add('inventory-variant-badge--long')
          }
          badge.style.setProperty('--inventory-variant-accent', getInventoryVariantAccentColor(token))

          const badgeLabel = document.createElement('span')
          badgeLabel.className = 'inventory-variant-badge__label'
          badgeLabel.textContent = badgeText

          badge.appendChild(badgeLabel)
          slot.appendChild(badge)
        }

          const hoverText = this.uiSettings.hoverDescriptions ? getUniqueModuleHoverText(token) : null
          if (hoverText) {
            slot.title = hoverText
          } else {
            slot.removeAttribute('title')
          }
      } else {
        const placeholder = document.createElement('img')
        placeholder.className = 'inv-placeholder'
        placeholder.src = String(TYPE_TOKENS[type])
        placeholder.alt = type
          slot.removeAttribute('title')
        slot.appendChild(placeholder)
      }

      const label = document.createElement('span')
      label.className = 'inventory-label'
      label.textContent = type
      slot.appendChild(label)

      this.inventoryRoot.appendChild(slot)
    }
  }

  getDelayMs(): number {
    if (!this.delayInput) return 250
    const parsed = Number(this.delayInput.value)
    if (!Number.isFinite(parsed)) return 250
    return Math.max(50, Math.min(3000, Math.floor(parsed)))
  }

  private getSettingsPatch(): BemergedParityTuningPatch {
    const patch: BemergedParityTuningPatch = {}
    for (const spec of PARITY_CONTROL_SPECS) {
      const input = this.parityInputs.get(spec.key)
      if (!input) continue
      const parsed = Number(input.value)
      if (!Number.isFinite(parsed)) continue
      spec.write(patch, parsed)
    }
    return patch
  }

  private getUniqueEffectPatch(): BemergedUniqueEffectTuningPatch {
    const patch: BemergedUniqueEffectTuningPatch = { effects: {} }
    for (const [key, input] of this.uniqueEffectInputs.entries()) {
      const [effectId, rarity] = key.split(':') as [UniqueEffectId, keyof BemergedUniqueEffectTuning['effects'][UniqueEffectId]]
      const parsed = Number(input.value)
      if (!Number.isFinite(parsed)) continue
      patch.effects![effectId] = {
        ...(patch.effects![effectId] || {}),
        [rarity]: parsed,
      }
    }
    return patch
  }

  private buildParityControls(): void {
    if (!this.parityControlsRoot) return
    this.parityControlsRoot.innerHTML = ''
    this.parityInputs.clear()
    for (const spec of PARITY_CONTROL_SPECS) {
      const label = document.createElement('label')
      label.textContent = spec.label
      const input = document.createElement('input')
      input.type = 'number'
      input.min = String(spec.min ?? 0)
      input.max = String(spec.max ?? 999999)
      input.step = String(spec.step ?? 1)
      input.dataset.settingKey = spec.key
      label.appendChild(input)
      this.parityControlsRoot.appendChild(label)
      this.parityInputs.set(spec.key, input)
    }
  }

  private buildUniqueEffectControls(settings: BemergedUniqueEffectTuning): void {
    if (!this.uniqueEffectControlsRoot || this.uniqueEffectInputs.size > 0) return
    this.uniqueEffectControlsRoot.innerHTML = ''
    const table = document.createElement('table')
    table.className = 'settings-effect-table'
    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const title of ['Effect', ...UNIQUE_RARITY_ORDER]) {
      const th = document.createElement('th')
      th.textContent = title
      headRow.appendChild(th)
    }
    thead.appendChild(headRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (const effectId of Object.keys(settings.effects) as UniqueEffectId[]) {
      const row = document.createElement('tr')
      const labelCell = document.createElement('td')
      labelCell.textContent = formatUniqueEffectDisplayName(effectId)
      row.appendChild(labelCell)
      for (const rarity of UNIQUE_RARITY_ORDER) {
        const cell = document.createElement('td')
        const input = document.createElement('input')
        input.type = 'number'
        input.min = '0'
        input.step = '0.1'
        input.dataset.effectId = effectId
        input.dataset.effectRarity = rarity
        cell.appendChild(input)
        row.appendChild(cell)
        this.uniqueEffectInputs.set(`${effectId}:${rarity}`, input)
      }
      tbody.appendChild(row)
    }
    table.appendChild(tbody)
    this.uniqueEffectControlsRoot.appendChild(table)
  }

  private readUiSettingsFromInputs(): BemergedUiSettings {
    const orientationRaw = String(this.orientationEl?.value || this.uiSettings.orientation || 'landscape').toLowerCase()
    const orientation: BemergedOrientation = orientationRaw === 'portrait' ? 'portrait' : 'landscape'

    const backgroundRaw = String(this.backgroundEl?.value || this.uiSettings.background || DEFAULT_UI_SETTINGS.background).trim()
    const background: BackgroundKey = Object.prototype.hasOwnProperty.call(BACKGROUNDS, backgroundRaw) && this.isBackgroundUnlocked(backgroundRaw)
      ? (backgroundRaw as BackgroundKey)
      : DEFAULT_UI_SETTINGS.background

    const useAiAutoplay = this.aiGameplayAvailable && !!this.useAiAutoplayEl?.checked
    const enableDevControls = !!this.enableDevControlsEl?.checked
    const aiDevControls = useAiAutoplay && enableDevControls && !!this.aiDevControlsEl?.checked
    const aiRestartFrequencyRaw = Number(this.aiRestartFrequencyEl?.value || this.uiSettings.aiRestartFrequency || 0)
    const aiRestartOffsetRaw = Number(this.aiRestartOffsetEl?.value || this.uiSettings.aiRestartOffset || 0)
    const aiRestartFrequency = Math.max(0, Math.min(20000, Math.floor(Number.isFinite(aiRestartFrequencyRaw) ? aiRestartFrequencyRaw : 0)))
    const aiRestartOffset = aiRestartFrequency > 0
      ? Math.max(0, Math.min(5000, Math.floor(Number.isFinite(aiRestartOffsetRaw) ? aiRestartOffsetRaw : 0)))
      : 0

    return {
      orientation,
      autoShatterRares: !!this.autoShatterRaresEl?.checked,
      disableHints: !!this.disableHintsEl?.checked,
      hoverDescriptions: this.hoverDescriptionsEl?.checked !== false,
      background,
      renderQuality: this.normalizeRenderQuality(this.renderQualityEl?.value || this.uiSettings.renderQuality),
      useAiAutoplay,
      aiRestartFrequency,
      aiRestartOffset,
      aiDevControls,
      enableDevControls,
    }
  }

  private normalizeUiSettings(raw: Partial<BemergedUiSettings> | null | undefined): BemergedUiSettings {
    const orientationRaw = String(raw?.orientation || DEFAULT_UI_SETTINGS.orientation).toLowerCase()
    const orientation: BemergedOrientation = orientationRaw === 'portrait' ? 'portrait' : 'landscape'

    const backgroundRaw = String(raw?.background || DEFAULT_UI_SETTINGS.background)
    const background: BackgroundKey = Object.prototype.hasOwnProperty.call(BACKGROUNDS, backgroundRaw) && this.isBackgroundUnlocked(backgroundRaw)
      ? (backgroundRaw as BackgroundKey)
      : DEFAULT_UI_SETTINGS.background

    const useAiAutoplay = this.aiGameplayAvailable && !!raw?.useAiAutoplay
    const enableDevControls = !!raw?.enableDevControls
    const aiDevControls = useAiAutoplay && enableDevControls && !!raw?.aiDevControls
    const aiRestartFrequency = useAiAutoplay
      ? Math.max(0, Math.min(20000, Math.floor(Number(raw?.aiRestartFrequency) || 0)))
      : 0
    const aiRestartOffset = useAiAutoplay && aiRestartFrequency > 0
      ? Math.max(0, Math.min(5000, Math.floor(Number(raw?.aiRestartOffset) || 0)))
      : 0

    return {
      orientation,
      autoShatterRares: !!raw?.autoShatterRares,
      disableHints: !!raw?.disableHints,
      hoverDescriptions: raw?.hoverDescriptions !== false,
      background,
      renderQuality: this.normalizeRenderQuality(raw?.renderQuality),
      useAiAutoplay,
      aiRestartFrequency,
      aiRestartOffset,
      aiDevControls,
      enableDevControls,
    }
  }

  private applyUiSettingsToDom(settings: BemergedUiSettings): void {
    this.uiSettings = this.normalizeUiSettings(settings)

    if (this.shellEl) {
      this.shellEl.classList.toggle('orientation-portrait', this.uiSettings.orientation === 'portrait')
    }

    if (this.orientationEl) {
      this.orientationEl.value = this.uiSettings.orientation
    }
    if (this.autoShatterRaresEl) {
      this.autoShatterRaresEl.checked = this.uiSettings.autoShatterRares
    }
    if (this.disableHintsEl) {
      this.disableHintsEl.checked = this.uiSettings.disableHints
    }
    if (this.hoverDescriptionsEl) {
      this.hoverDescriptionsEl.checked = this.uiSettings.hoverDescriptions
    }
    if (this.backgroundEl) {
      this.backgroundEl.value = this.uiSettings.background
      this.backgroundEl.disabled = this.unlockedBackgrounds.length <= 1
    }
    this.backgroundRowEl?.classList.toggle('hidden', this.unlockedBackgrounds.length <= 1)
    if (this.renderQualityEl) {
      this.renderQualityEl.value = this.uiSettings.renderQuality
    }
    if (this.useAiAutoplayEl) {
      this.useAiAutoplayEl.checked = this.uiSettings.useAiAutoplay
      this.useAiAutoplayEl.disabled = !this.aiGameplayAvailable
    }
    this.useAiAutoplayRowEl?.classList.toggle('hidden', !this.aiGameplayAvailable)
    if (this.aiRestartFrequencyEl) {
      this.aiRestartFrequencyEl.value = String(this.uiSettings.aiRestartFrequency)
    }
    if (this.aiRestartOffsetEl) {
      this.aiRestartOffsetEl.value = String(this.uiSettings.aiRestartOffset)
    }
    this.aiRestartFrequencyRowEl?.classList.toggle('hidden', !this.aiGameplayAvailable || !this.uiSettings.useAiAutoplay)
    this.aiRestartOffsetRowEl?.classList.toggle('hidden', !this.aiGameplayAvailable || !this.uiSettings.useAiAutoplay || this.uiSettings.aiRestartFrequency <= 0)
    this.aiCloudUsageRowEl?.classList.toggle('hidden', !this.aiErrorMessage && (!this.aiGameplayAvailable || !this.uiSettings.useAiAutoplay || !String(this.aiCloudUsageRowEl.textContent || '').trim()))
    this.aiDevControlsRowEl?.classList.toggle('hidden', !this.aiGameplayAvailable || !this.uiSettings.useAiAutoplay || !this.uiSettings.enableDevControls)
    if (this.aiDevControlsEl) {
      const canUseAiDevControls = this.uiSettings.useAiAutoplay && this.uiSettings.enableDevControls
      this.aiDevControlsEl.checked = canUseAiDevControls && this.uiSettings.aiDevControls
      this.aiDevControlsEl.disabled = !canUseAiDevControls
    }
    if (this.enableDevControlsEl) {
      this.enableDevControlsEl.checked = this.uiSettings.enableDevControls
    }

    this.devControlsGroupEl?.classList.toggle('hidden', !this.uiSettings.enableDevControls)

    try {
      applyBackground(this.uiSettings.background)
    } catch {
      void 0
    }

    this.updateAiButtonLabel()

    if (this.lastStats) {
      this.setStats(this.lastStats)
    }
    this.setInventory(this.lastInventory)
  }

  private populateBackgroundOptions(): void {
    if (!this.backgroundEl) return
    this.backgroundEl.innerHTML = ''
    for (const key of this.unlockedBackgrounds) {
      const option = document.createElement('option')
      option.value = key
      option.textContent = formatBackgroundDisplay(key)
      this.backgroundEl.appendChild(option)
    }
  }

  private isBackgroundUnlocked(value: string): value is BackgroundKey {
    return this.unlockedBackgrounds.includes(value as BackgroundKey)
  }

  private normalizeRenderQuality(raw: unknown): BemergedRenderQuality {
    const value = String(raw || '').trim().toLowerCase()
    if (value === 'balanced' || value === 'max') return value
    return 'high'
  }

  private updateAiButtonLabel(): void {
    if (!this.aiToggleBtn || this.aiInitializing) return
    if (this.aiActive) {
      this.aiToggleBtn.textContent = this.aiGameplayAvailable && this.uiSettings.useAiAutoplay ? 'Stop AI' : 'Stop Autoplay'
      return
    }
    this.aiToggleBtn.textContent = this.aiGameplayAvailable && this.uiSettings.useAiAutoplay ? 'AI Play' : 'Autoplay'
  }

  private loadUiSettingsFromStorage(): BemergedUiSettings {
    try {
      const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY)
      if (!raw) return { ...DEFAULT_UI_SETTINGS }
      const parsed = JSON.parse(raw) as Partial<BemergedUiSettings>
      if (parsed.background === 'Golden') {
        parsed.background = DEFAULT_BEMERGED_BACKGROUND
      }
      return this.normalizeUiSettings(parsed)
    } catch {
      return { ...DEFAULT_UI_SETTINGS }
    }
  }

  private persistUiSettings(): void {
    try {
      window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(this.uiSettings))
    } catch {
      void 0
    }
  }

  private setInput(input: HTMLInputElement | null, value: number): void {
    if (!input) return
    input.value = String(value)
  }

  private getInput(input: HTMLInputElement | null): number | undefined {
    if (!input) return undefined
    const parsed = Number(input.value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  private formatElapsed(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }
}
