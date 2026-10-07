import { describe, expect, it } from 'vitest'
import { createBemergedAiGovernanceManifest } from './aiGovernanceManifest'
import { buildBemergedGovernedPlannerPrompt } from './aiPromptScaffold'

describe('aiPromptScaffold guardrail awareness', () => {
  it('informs planner that dev controls are disabled in normal mode', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })

    const prompt = buildBemergedGovernedPlannerPrompt({
      manifest,
      allowedActionTypes: ['swap'],
      goal: 'objective-progress',
      objectiveSummary: 'Complete all four module types at 5-star.',
      statePayload: { tick: 1 },
    })

    expect(prompt).toContain('<allow_dev_controls>false</allow_dev_controls>')
    expect(prompt).toContain('<swap_only>false</swap_only>')
    expect(prompt).toContain('<seed>0</seed>')
  })

  it('informs planner when dev controls are enabled and swap-only is inactive', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })

    const prompt = buildBemergedGovernedPlannerPrompt({
      manifest,
      allowedActionTypes: [...manifest.actions.plannerVisible],
      goal: 'objective-progress',
      plannerSeed: 98765,
      objectiveSummary: 'Complete all four module types at 5-star.',
      statePayload: { tick: 2 },
    })

    expect(prompt).toContain('<allow_dev_controls>true</allow_dev_controls>')
    expect(prompt).toContain('<swap_only>false</swap_only>')
    expect(prompt).toContain('<capability_set>')
    expect(prompt).toContain('<mode>dev</mode>')
    expect(prompt).toContain('<seed>98765</seed>')
    expect(prompt).toContain('<test_objective>')
    expect(prompt).toContain('<output_schema_json>')
    expect(prompt).toContain('"enum":["swap","merge-selection","inventory","shard-boost","boss-shatter","mine-shatter"]')
  })

  it('honors caller-scoped allowed_action_types even when runtime supports more actions', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })

    const prompt = buildBemergedGovernedPlannerPrompt({
      manifest,
      allowedActionTypes: ['swap', 'inventory'],
      goal: 'objective-progress',
      objectiveSummary: 'Complete all four module types at 5-star.',
      statePayload: { tick: 3 },
    })

    expect(prompt).toContain('<allowed_action_types>swap, inventory</allowed_action_types>')
    expect(prompt).not.toContain('invalid-action')
    expect(prompt).toContain('<delay_bounds min_ms="50" max_ms="3000" />')
  })

  it('filters prompt allowed_action_types to governance-visible actions when not swap-only', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })

    const prompt = buildBemergedGovernedPlannerPrompt({
      manifest,
      allowedActionTypes: ['swap', 'inventory', 'invalid-action' as never],
      goal: 'objective-progress',
      objectiveSummary: 'Complete all four module types at 5-star.',
      statePayload: { tick: 4 },
    })

    expect(prompt).toContain('<allowed_action_types>swap, inventory</allowed_action_types>')
    expect(prompt).not.toContain('invalid-action')
  })

  it('includes last N run summaries and keeps only newest six', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })

    const prompt = buildBemergedGovernedPlannerPrompt({
      manifest,
      allowedActionTypes: ['swap', 'inventory'],
      goal: 'objective-progress',
      objectiveSummary: 'Complete all four module types at 5-star.',
      statePayload: { tick: 5 },
      recentRunSummaries: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'],
    })

    expect(prompt).toContain('<last_run_summaries>')
    expect(prompt).toContain('<summary>s7</summary>')
    expect(prompt).not.toContain('<summary>s1</summary>')
  })
})
