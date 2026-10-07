import { describe, expect, it } from 'vitest'
import {
  BEMERGED_AUTOPLAY_ACTIONS,
  assertBemergedGovernanceNoDrift,
  createBemergedAiGovernanceManifest,
  detectBemergedAiGovernanceDrift,
} from './aiGovernanceManifest'

describe('aiGovernanceManifest runtime action invariants', () => {
  it('allows full gameplay action set when aiDevControls is disabled', () => {
    const manifest = createBemergedAiGovernanceManifest({
      mode: 'normal',
      aiDevControlsEnabled: false,
    })

    expect(manifest.strictGuardrails.swapOnly).toBe(false)
    expect(manifest.actions.runtimeAllowed).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
    expect(manifest.actions.plannerVisible).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
    expect(manifest.strictGuardrails.allowTestingMode).toBe(false)
    expect(manifest.strictGuardrails.allowDevControls).toBe(false)
  })

  it('allows full governed action set when aiDevControls is enabled in dev mode', () => {
    const manifest = createBemergedAiGovernanceManifest({
      mode: 'dev',
      aiDevControlsEnabled: true,
    })

    expect(manifest.strictGuardrails.swapOnly).toBe(false)
    expect(manifest.strictGuardrails.allowTestingMode).toBe(true)
    expect(manifest.strictGuardrails.allowDevControls).toBe(true)
    expect(manifest.actions.runtimeAllowed).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
    expect(manifest.actions.plannerVisible).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
  })

  it('keeps full gameplay capabilities in normal mode even when ui aiDevControls is true', () => {
    const manifest = createBemergedAiGovernanceManifest({
      mode: 'normal',
      aiDevControlsEnabled: true,
    })

    expect(manifest.strictGuardrails.allowDevControls).toBe(false)
    expect(manifest.strictGuardrails.swapOnly).toBe(false)
    expect(manifest.actions.runtimeAllowed).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
    expect(manifest.actions.plannerVisible).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
  })

  it('keeps full gameplay capabilities in dev mode when ui dev controls are not enabled', () => {
    const manifest = createBemergedAiGovernanceManifest({
      mode: 'dev',
      aiDevControlsEnabled: false,
    })

    expect(manifest.strictGuardrails.allowDevControls).toBe(false)
    expect(manifest.strictGuardrails.swapOnly).toBe(false)
    expect(manifest.actions.runtimeAllowed).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
    expect(manifest.actions.plannerVisible).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
  })

  it('detects capability drift when runtime advertises non-swap actions during swap-only mode', () => {
    const manifest = createBemergedAiGovernanceManifest({
      mode: 'normal',
      aiDevControlsEnabled: false,
    })

    const drift = detectBemergedAiGovernanceDrift({
      manifest,
      sceneCapabilities: {
        goals: manifest.goals,
        actions: {
          availableCommands: manifest.commands,
          primary: ['swap', 'inventory'],
          runtimeAllowed: ['swap', 'inventory'],
          plannerVisible: ['swap'],
        },
        strictGuardrails: {
          allowTestingMode: false,
          allowDevControls: false,
          swapOnly: true,
        },
      },
    })

    expect(drift.ok).toBe(false)
    expect(drift.issues.some(issue => issue.code === 'primary-actions-drift')).toBe(true)
    expect(drift.issues.some(issue => issue.code === 'runtime-actions-drift')).toBe(true)
  })

  it('detects mode, contract, objective, telemetry, and delay-bound drift', () => {
    const manifest = createBemergedAiGovernanceManifest({
      mode: 'normal',
      aiDevControlsEnabled: false,
    })

    const drift = detectBemergedAiGovernanceDrift({
      manifest,
      sceneCapabilities: {
        goals: manifest.goals,
        actions: {
          availableCommands: manifest.commands,
          primary: manifest.actions.runtimeAllowed,
          runtimeAllowed: manifest.actions.runtimeAllowed,
          plannerVisible: manifest.actions.plannerVisible,
        },
        strictGuardrails: {
          allowTestingMode: manifest.strictGuardrails.allowTestingMode,
          allowDevControls: manifest.strictGuardrails.allowDevControls,
          swapOnly: manifest.strictGuardrails.swapOnly,
        },
      },
      runtimeContract: {
        mode: 'dev',
        delayBounds: { minMs: 10, maxMs: 2500 },
        objectiveModelId: 'legacy-objective-model',
        telemetryRules: {
          emitAttemptCompletionForAllModes: false,
          devControlsUsedInAttemptRequiresActualUse: false,
          dedupeFields: false,
        },
      },
    })

    expect(drift.ok).toBe(false)
    expect(drift.issues.some(issue => issue.code === 'mode-drift')).toBe(true)
    expect(drift.issues.some(issue => issue.code === 'delay-bound-drift')).toBe(true)
    expect(drift.issues.some(issue => issue.code === 'objective-drift')).toBe(true)
    expect(drift.issues.some(issue => issue.code === 'telemetry-drift')).toBe(true)
    expect(drift.issues.some(issue => issue.code === 'contract-drift')).toBe(true)
  })

  it('blocks execution with structured governance drift error payload', () => {
    const manifest = createBemergedAiGovernanceManifest({
      mode: 'normal',
      aiDevControlsEnabled: false,
    })

    const report = detectBemergedAiGovernanceDrift({
      manifest,
      sceneCapabilities: {
        goals: manifest.goals,
        actions: {
          availableCommands: manifest.commands,
          primary: ['swap', 'inventory'],
          runtimeAllowed: ['swap', 'inventory'],
          plannerVisible: ['swap'],
        },
      },
    })

    expect(report.ok).toBe(false)
    expect(() => assertBemergedGovernanceNoDrift({ context: 'unit-test', report })).toThrow(/Governance drift blocked/)
  })
})
