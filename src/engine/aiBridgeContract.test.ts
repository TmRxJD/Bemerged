import { describe, expect, it } from 'vitest'
import { getBemergedAiBridgeCommands, getBemergedAiBridgeGoals, validateBemergedAiBridgePayload } from './aiBridgeContract'

describe('aiBridgeContract', () => {
  it('exposes stable command and goal manifests', () => {
    expect(getBemergedAiBridgeCommands()).toEqual(['start', 'stop', 'status', 'snapshot', 'step'])
    expect(getBemergedAiBridgeGoals()).toContain('objective-progress')
  })

  it('rejects testing mode at bridge validation layer', () => {
    const parsed = validateBemergedAiBridgePayload({ command: 'start', mode: 'normal', testingMode: true })
    expect(parsed.ok).toBe(false)
    if (parsed.ok === false) {
      expect(parsed.code).toBe('guardrail-testing-mode-blocked')
    }
  })

  it('allows testing mode when mode=dev', () => {
    const parsed = validateBemergedAiBridgePayload({ command: 'start', mode: 'dev', testingMode: true })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.mode).toBe('dev')
      expect(parsed.testingMode).toBe(true)
    }
  })

  it('rejects unknown commands with deterministic error code', () => {
    const parsed = validateBemergedAiBridgePayload({ command: 'dev:godmode' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok === false) {
      expect(parsed.code).toBe('unknown-command')
    }
  })

  it('rejects unsupported goals with deterministic error code', () => {
    const parsed = validateBemergedAiBridgePayload({ command: 'start', goal: 'all-secrets' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok === false) {
      expect(parsed.code).toBe('unsupported-goal')
    }
  })

  it('parses valid payload into strict command object', () => {
    const parsed = validateBemergedAiBridgePayload({ command: 'start', goal: 'objective-progress', delayMs: 120, mode: 'normal' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.command).toBe('start')
      expect(parsed.goal).toBe('objective-progress')
      expect(parsed.testingMode).toBe(false)
      expect(parsed.mode).toBe('normal')
      expect(parsed.delayMs).toBe(120)
    }
  })

  it('clamps delay to governance bounds', () => {
    const low = validateBemergedAiBridgePayload({ command: 'start', delayMs: 1 })
    const high = validateBemergedAiBridgePayload({ command: 'start', delayMs: 99999 })

    expect(low.ok).toBe(true)
    expect(high.ok).toBe(true)
    if (low.ok && high.ok) {
      expect(low.delayMs).toBe(50)
      expect(high.delayMs).toBe(3000)
    }
  })
})
