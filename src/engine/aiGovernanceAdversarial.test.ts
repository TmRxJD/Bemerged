import { describe, expect, it } from 'vitest'
import { BEMERGED_AUTOPLAY_ACTIONS, createBemergedAiGovernanceManifest } from './aiGovernanceManifest'
import {
  BEMERGED_AI_GOVERNANCE_MANIFEST_JSON_SCHEMA,
  BEMERGED_AI_GOVERNANCE_SCHEMA_VERSION,
  parseBemergedAiPlannerDecision,
  parseBemergedAttemptCompleteTelemetryEvent,
  parseBemergedBridgeToPlannerOutput,
  parseBemergedSceneToBridgePayload,
  parseBemergedServerCapabilitiesResponse,
  parseBemergedServerResetResponse,
  parseBemergedServerStepResponse,
  parseBemergedServerValidActionsResponse,
  parseBemergedStateTelemetryEvent,
  validateBemergedAiAllowedActionTypes,
  validateBemergedAiDevCommandsInput,
  validateBemergedAiGovernanceManifest,
  validateBemergedAiLegalActionsInput,
  validateBemergedAiStateInput,
} from './aiGovernanceSchema'
import { validateBemergedAiBridgePayload } from './aiBridgeContract'
import { evaluateBemergedGovernanceInvariants } from './aiGovernanceRuleEngine'
import { createBridgeGovernanceAdapter, createPlannerGovernanceAdapter, createSceneGovernanceAdapter, createServerGovernanceAdapter } from './aiGovernanceAdapters'
import { transitionBemergedAiMode } from './aiGovernanceStateMachine'
import { buildBemergedGovernedPlannerPrompt } from './aiPromptScaffold'
import { bemergedRunSummarySchema, extractBemergedStrategyDelta, mergeBemergedStrategyDeltas, pruneBemergedStrategyDelta } from './aiStrategyDeltaEngine'
import { buildStrategyDeltaFromOutcome, EMPTY_BEMERGED_STRATEGY_DELTA, updateAutoplayLearningMemory } from './autoplayLearningMemory'

describe('ai governance adversarial suite', () => {
  it('satisfies checklist 1.1: single JSON schema + semver + cross-layer version parity', () => {
    const requiredKeys = BEMERGED_AI_GOVERNANCE_MANIFEST_JSON_SCHEMA.required || []
    expect(requiredKeys).toEqual(expect.arrayContaining([
      'schemaVersion',
      'mode',
      'modes',
      'objectiveModel',
      'delayBounds',
      'contracts',
      'goals',
      'commands',
      'actions',
      'devCommands',
      'strictGuardrails',
      'invariants',
    ]))

    expect(BEMERGED_AI_GOVERNANCE_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/)

    const normalManifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const devManifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })
    expect(normalManifest.schemaVersion).toBe(BEMERGED_AI_GOVERNANCE_SCHEMA_VERSION)
    expect(devManifest.schemaVersion).toBe(BEMERGED_AI_GOVERNANCE_SCHEMA_VERSION)
  })

  it('satisfies checklist 1.2: manifest defines all required modes', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    expect(manifest.modes).toEqual(expect.arrayContaining([
      'ai',
      'autoplay',
      'testing',
      'dev',
      'swap-only',
      'restricted',
    ]))
    expect(new Set(manifest.modes).size).toBe(6)
  })

  it('satisfies checklist 1.3: manifest defines per-mode capabilities and planner/runtime visibility', () => {
    const normalManifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const devManifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })

    expect(normalManifest.actions.runtimeAllowed).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
    expect(devManifest.actions.runtimeAllowed.length).toBeGreaterThan(1)

    expect(normalManifest.devCommands.runtimeAllowed).toEqual([])
    expect(devManifest.devCommands.runtimeAllowed).toEqual(expect.arrayContaining([
      'dev-tools',
      'parity-patch',
      'forced-cheats',
    ]))

    expect(normalManifest.actions.plannerVisible).toEqual(normalManifest.actions.runtimeAllowed)
    expect(devManifest.actions.plannerVisible).toEqual(devManifest.actions.runtimeAllowed)
    expect(normalManifest.devCommands.plannerVisible).toEqual(normalManifest.devCommands.runtimeAllowed)
    expect(devManifest.devCommands.plannerVisible).toEqual(devManifest.devCommands.runtimeAllowed)
  })

  it('satisfies checklist 1.4: manifest defines delay/objective/telemetry/progress contracts', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })

    expect(manifest.contracts.delayBoundsSource).toBe('manifest.delayBounds')
    expect(manifest.contracts.objectiveModelSource).toBe('manifest.objectiveModel')
    expect(manifest.contracts.telemetryRules.emitAttemptCompletionForAllModes).toBe(true)
    expect(manifest.contracts.telemetryRules.devControlsUsedInAttemptRequiresActualUse).toBe(true)
    expect(manifest.contracts.telemetryRules.dedupeFields).toBe(true)
    expect(manifest.contracts.progressSemantics.completedTypeCount).toBe('type-count')
    expect(manifest.contracts.progressSemantics.completedUniqueMods).toBe('unique-lines')
  })

  it('satisfies checklist 1.5: manifest defines required end-to-end invariants', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })

    expect(manifest.invariants.some(item => item.includes('testingMode may be true only when mode=dev'))).toBe(true)
    expect(manifest.invariants.some(item => item.includes('swap-only policy must apply to all action paths'))).toBe(true)
    expect(manifest.invariants.some(item => item.includes('dev controls must be UI-visible and runtime-authorized'))).toBe(true)
    expect(manifest.invariants.some(item => item.includes('planner must receive the exact capability set enforced by runtime'))).toBe(true)
  })

  it('satisfies checklist 2.1: validates state, legal actions, dev commands, planner output, bridge payloads, and telemetry events', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })

    const state = validateBemergedAiStateInput({
      goal: 'objective-progress',
      elapsedSeconds: 120,
      stats: {
        score: 450,
        moves: 23,
        merges: 11,
        shatters: 6,
        elapsedSeconds: 120,
        shardsPerHour: 13500,
        shardsByType: {
          Cannon: 120,
          Armor: 110,
          Generator: 100,
          Core: 120,
        },
      },
      objective: {
        completionPercent: 33,
        completedTypeCount: 2,
        completedUniqueMods: 8,
        totalUniqueMods: 24,
        targetStars: 5,
        objectiveComplete: false,
        highestStarsByType: {
          Cannon: 3,
          Armor: 2,
          Generator: 1,
          Core: 2,
        },
      },
    })
    expect(state.goal).toBe('objective-progress')

    const allowedActions = validateBemergedAiAllowedActionTypes(['swap', 'inventory'])
    expect(allowedActions).toEqual(['swap', 'inventory'])

    const legalActions = validateBemergedAiLegalActionsInput({
      shardBoost: null,
      inventoryAction: {
        cell: { row: 0, col: 1 },
        slotType: 'Cannon',
      },
      mergeSelection: {
        base: { row: 1, col: 1 },
        fodders: [{ row: 1, col: 2 }],
        totalCells: 2,
      },
      swapMoves: [{ index: 0, from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }],
      bossShatterPlans: [{ index: 0, selection: [{ row: 2, col: 2 }] }],
      mineShatterPlans: [{ index: 0, mine: { row: 3, col: 3 }, selection: [{ row: 3, col: 4 }, { row: 4, col: 4 }] }],
      validMoveCount: 1,
    })
    expect(legalActions.swapMoves.length).toBe(1)

    const devCommands = validateBemergedAiDevCommandsInput(manifest.devCommands.runtimeAllowed)
    expect(devCommands).toEqual(expect.arrayContaining(['dev-tools', 'parity-patch', 'forced-cheats']))

    const plannerDecision = parseBemergedAiPlannerDecision({
      actionType: 'swap',
      moveIndex: 0,
      reason: 'safe swap',
    })
    expect(plannerDecision.actionType).toBe('swap')

    const bridgePayload = validateBemergedAiBridgePayload({
      command: 'start',
      goal: 'objective-progress',
      delayMs: 150,
      mode: 'dev',
      testingMode: true,
    })
    expect(bridgePayload.ok).toBe(true)

    const attemptTelemetry = parseBemergedAttemptCompleteTelemetryEvent({
      type: 'bemerged:attempt-complete',
      payload: {
        reason: 'win',
        mode: 'dev',
        aiUsedInAttempt: true,
        devControlsUsedInAttempt: true,
        timeSeconds: 123,
        moveCount: 45,
        mergeCount: 19,
        shardsEarned: 1200,
        objectiveComplete: false,
        completedTypeCount: 3,
        completedUniqueMods: 14,
        totalUniqueMods: 24,
        updatedAt: Date.now(),
      },
    })
    expect(attemptTelemetry.type).toBe('bemerged:attempt-complete')

    const stateTelemetry = parseBemergedStateTelemetryEvent({
      type: 'bemerged:state',
      payload: {
        totalShards: 1200,
        moveCount: 45,
        totalMerges: 19,
        totalShatters: 31,
        objectiveComplete: false,
        completedTypeCount: 3,
        completedUniqueMods: 14,
        totalUniqueMods: 24,
        elapsedSeconds: 123,
        shardsPerHour: 35121,
        mergesPerHour: 556,
        shattersPerHour: 907,
        updatedAt: Date.now(),
      },
    })
    expect(stateTelemetry.type).toBe('bemerged:state')

    expect(() => parseBemergedAiPlannerDecision({ actionType: 'swap' })).toThrow()
    expect(() => parseBemergedStateTelemetryEvent({ type: 'bemerged:state', payload: { totalShards: -1 } })).toThrow()
  })

  it('satisfies checklist 2.2: validates scene->bridge, bridge->planner, planner->scene, and server->client outputs', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })

    const sceneToBridge = parseBemergedSceneToBridgePayload({
      autoplay: {
        active: false,
        delayMs: 150,
        goal: 'objective-progress',
        testingMode: false,
        movesExecuted: 0,
        mergesExecuted: 0,
        validMoveCount: 1,
        lastDecision: null,
        lastReward: null,
        elapsedSeconds: 0,
        lastError: null,
      },
      stats: {
        score: 0,
        moves: 0,
        merges: 0,
        shatters: 0,
        elapsedSeconds: 0,
        shardsPerHour: 0,
        shardsByType: { Cannon: 0, Armor: 0, Generator: 0, Core: 0 },
      },
      objective: {
        completionPercent: 0,
        completedTypeCount: 0,
        completedUniqueMods: 0,
        totalUniqueMods: 24,
        targetStars: 5,
        objectiveComplete: false,
        highestStarsByType: { Cannon: 0, Armor: 0, Generator: 0, Core: 0 },
      },
      aiContract: {
        schemaVersion: 'bemerged-ai-bridge-v1',
        governanceSchemaVersion: manifest.schemaVersion,
        mode: 'normal',
        strictGuardrails: manifest.strictGuardrails,
        delayBounds: manifest.delayBounds,
        goals: manifest.goals,
        commands: manifest.commands,
        actions: manifest.actions,
        invariants: manifest.invariants,
        governanceDrift: { ok: true, issues: [] },
      },
      aiRuntime: {
        initialized: true,
        modelId: 'autoplay-local',
        lastError: null,
        controlSource: 'none',
        decisionMode: 'builtin-autoplay',
      },
      engine: {
        seed: 1337,
        elapsedSeconds: 0,
        stats: {
          score: 0,
          moves: 0,
          merges: 0,
          shatters: 0,
          elapsedSeconds: 0,
          shardsPerHour: 0,
          shardsByType: { Cannon: 0, Armor: 0, Generator: 0, Core: 0 },
        },
        validMoveCount: 1,
        objective: {
          completionPercent: 0,
          completedTypeCount: 0,
          completedUniqueMods: 0,
          totalUniqueMods: 24,
          targetStars: 5,
          objectiveComplete: false,
          highestStarsByType: { Cannon: 0, Armor: 0, Generator: 0, Core: 0 },
        },
        autoplayCapabilities: {
          goals: manifest.goals,
          actions: {
            primary: manifest.actions.runtimeAllowed,
            availableCommands: manifest.commands,
            runtimeAllowed: manifest.actions.runtimeAllowed,
            plannerVisible: manifest.actions.plannerVisible,
          },
          strictGuardrails: {
            allowTestingMode: manifest.strictGuardrails.allowTestingMode,
            allowDevControls: manifest.strictGuardrails.allowDevControls,
            swapOnly: manifest.strictGuardrails.swapOnly,
          },
        },
        board: [[null]],
        autoplay: {},
      },
    })
    expect(sceneToBridge.aiContract.mode).toBe('normal')

    const bridgeToPlanner = parseBemergedBridgeToPlannerOutput({
      manifest,
      allowedActionTypes: ['swap'],
      goal: 'objective-progress',
      objectiveSummary: 'Complete all 24 unique lines.',
      statePayload: { legalActions: { swapMoves: [{ index: 0 }] } },
      recentStrategyDelta: {
        avoid_patterns: ['loop'],
        prefer_patterns: ['objective'],
        heuristics_to_adjust: ['risk-weight'],
      },
    })
    expect(bridgeToPlanner.allowedActionTypes).toEqual(['swap'])

    const plannerToScene = parseBemergedAiPlannerDecision({ actionType: 'swap', moveIndex: 0, reason: 'safe' })
    expect(plannerToScene.actionType).toBe('swap')

    const serverCapabilities = parseBemergedServerCapabilitiesResponse({
      ok: true,
      contractVersion: 'bemerged-headless-env-v1',
      manifestVersion: 'bemerged-capability-manifest-v1',
      governanceSchemaVersion: manifest.schemaVersion,
      mode: 'normal',
      delayBounds: manifest.delayBounds,
      guardrails: {
        noDevTools: true,
        testingModeLocked: true,
        allowedGoals: ['objective-progress'],
        deniedGoals: ['max-score'],
      },
      aiGovernance: {
        objectiveModel: manifest.objectiveModel,
        strictGuardrails: manifest.strictGuardrails,
        commands: manifest.commands,
        goals: manifest.goals,
        invariants: manifest.invariants,
        actions: {
          plannerVisible: manifest.actions.plannerVisible,
          runtimeAllowed: ['swap'],
        },
        adapter: {
          type: 'headless-runtime-adapter',
          reason: 'swap-only runtime',
        },
      },
    })
    expect(serverCapabilities.ok).toBe(true)

    const serverCapabilitiesPayload: Record<string, unknown> = { ...serverCapabilities }
    delete serverCapabilitiesPayload.ok

    const serverSessionPayload = {
      sessionId: 's1',
      scenarioId: 'objective-default',
      seed: 1337,
      goal: 'objective-progress',
      mode: 'normal',
      testingMode: false,
      validActions: [{ actionId: 0, type: 'swap', fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 }],
      capabilities: serverCapabilitiesPayload,
    }

    const serverReset = parseBemergedServerResetResponse({
      ok: true,
      state: {},
      info: {
        turn: 0,
        objective: {},
      },
      ...serverSessionPayload,
    })
    expect(serverReset.ok).toBe(true)

    const serverActions = parseBemergedServerValidActionsResponse({ ok: true, ...serverSessionPayload })
    expect(serverActions.validActions.length).toBe(1)

    const serverStep = parseBemergedServerStepResponse({
      ok: true,
      nextState: {},
      reward: 0,
      rewardBreakdown: {
        objective: 0,
        shards: 0,
        time: -1,
        risk: 0,
        antiLoop: 0,
        total: -1,
      },
      done: false,
      info: {
        reason: 'continue',
        validActionCount: 1,
        loopCount: 1,
        turn: 1,
      },
      ...serverSessionPayload,
    })
    expect(serverStep.info.reason).toBe('continue')

    expect(() => parseBemergedBridgeToPlannerOutput({ manifest, allowedActionTypes: ['swap'], goal: 'objective-progress', objectiveSummary: '' })).toThrow()
    expect(() => parseBemergedServerStepResponse({ ok: true })).toThrow()
  })

  it('rejects malformed governance manifest schema', () => {
    expect(() => validateBemergedAiGovernanceManifest({ mode: 'normal' })).toThrow()
  })

  it('flags testing mode override invariant violation', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const result = evaluateBemergedGovernanceInvariants({
      manifest,
      payload: {
        command: 'start',
        goal: 'objective-progress',
        mode: 'normal',
        testingMode: true,
      },
    })
    expect(result.ok).toBe(false)
    expect(result.violations.some(item => item.code === 'testing-mode-blocked')).toBe(true)
  })

  it('flags completedTypeCount when it drifts into unique-line counting range', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const result = evaluateBemergedGovernanceInvariants({
      manifest,
      completedTypeCount: 12,
      completedUniqueMods: 12,
    })
    expect(result.ok).toBe(false)
    expect(result.violations.some(item => item.code === 'progress-type-count-invalid')).toBe(true)
  })

  it('flags cross-layer invariant drift for planner/runtime capabilities, bridge bounds, and objective model', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })

    const capabilityDrift = evaluateBemergedGovernanceInvariants({
      manifest,
      runtimeAllowedActions: ['swap', 'inventory'],
      plannerAllowedActions: ['swap', 'inventory'],
    })
    expect(capabilityDrift.ok).toBe(false)
    expect(capabilityDrift.violations.some(item => item.code === 'runtime-capability-drift')).toBe(true)
    expect(capabilityDrift.violations.some(item => item.code === 'planner-capability-drift')).toBe(true)

    const delayDrift = evaluateBemergedGovernanceInvariants({
      manifest,
      bridgeDelayBounds: { minMs: 10, maxMs: 2500 },
    })
    expect(delayDrift.ok).toBe(false)
    expect(delayDrift.violations.some(item => item.code === 'delay-bounds-drift')).toBe(true)

    const objectiveDrift = evaluateBemergedGovernanceInvariants({
      manifest,
      serverObjectiveModelId: 'legacy-objective-model',
    })
    expect(objectiveDrift.ok).toBe(false)
    expect(objectiveDrift.violations.some(item => item.code === 'objective-model-drift')).toBe(true)
  })

  it('exposes full runtime actions via scene/planner adapters when dev controls are off', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const sceneAdapter = createSceneGovernanceAdapter(manifest)
    const plannerAdapter = createPlannerGovernanceAdapter(manifest)

    expect(sceneAdapter.allowedActionTypes()).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
    expect(sceneAdapter.enforceAction('inventory')).toBe('inventory')
    expect(plannerAdapter.filterPlannerActions(['swap', 'inventory'])).toEqual(['swap', 'inventory'])
  })

  it('ensures planner adapter receives exact capability set and strips illegal planner actions', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })
    const plannerAdapter = createPlannerGovernanceAdapter(manifest)

    expect(plannerAdapter.allowedPlannerActions()).toEqual(manifest.actions.plannerVisible)
    expect(plannerAdapter.filterPlannerActions(['swap', 'inventory', 'mine-shatter'])).toEqual(['swap', 'inventory', 'mine-shatter'])
    expect(plannerAdapter.filterPlannerActions(['swap', 'inventory', 'invalid-action' as never])).toEqual(['swap', 'inventory'])
  })

  it('enforces server adapter objective model and progress semantics from manifest', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const serverAdapter = createServerGovernanceAdapter(manifest, 'normal')

    expect(serverAdapter.buildObjectiveModel()).toEqual(manifest.objectiveModel)
    expect(serverAdapter.buildRuntimeActions()).toEqual(manifest.actions.runtimeAllowed)

    expect(() => serverAdapter.assertObjectiveProgressSemantics({
      completedTypeCount: 2,
      completedUniqueMods: 12,
      totalUniqueMods: 24,
      completionPercent: 50,
      objectiveComplete: false,
    })).not.toThrow()
    expect(() => serverAdapter.assertObjectiveProgressSemantics({
      completedTypeCount: 5,
      completedUniqueMods: 25,
      totalUniqueMods: 24,
      completionPercent: 125,
      objectiveComplete: true,
    })).toThrow()
  })

  it('enforces scene delay bounds and testing mode guardrails from manifest', () => {
    const normalManifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const normalSceneAdapter = createSceneGovernanceAdapter(normalManifest)

    expect(normalSceneAdapter.clampDelayMs(1, 250)).toBe(normalManifest.delayBounds.minMs)
    expect(normalSceneAdapter.clampDelayMs(99999, 250)).toBe(normalManifest.delayBounds.maxMs)
    expect(normalSceneAdapter.enforceTestingMode(true)).toBe(false)

    const devManifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })
    const devSceneAdapter = createSceneGovernanceAdapter(devManifest)
    expect(devSceneAdapter.enforceTestingMode(true)).toBe(true)
  })

  it('keeps built-in autoplay advanced actions available via scene governance adapter', () => {
    const normalManifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: true })
    const normalSceneAdapter = createSceneGovernanceAdapter(normalManifest)
    expect(normalSceneAdapter.allowAdvancedAutoplayActions()).toBe(true)

    const devWithoutUiManifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: false })
    const devWithoutUiSceneAdapter = createSceneGovernanceAdapter(devWithoutUiManifest)
    expect(devWithoutUiSceneAdapter.allowAdvancedAutoplayActions()).toBe(true)

    const devWithUiManifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })
    const devWithUiSceneAdapter = createSceneGovernanceAdapter(devWithUiManifest)
    expect(devWithUiSceneAdapter.allowAdvancedAutoplayActions()).toBe(true)
  })

  it('clamps bridge payload delay and strips illegal testing mode via bridge adapter', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const adapter = createBridgeGovernanceAdapter(manifest)
    const payload = adapter.parseAndClampPayload({
      command: 'start',
      goal: 'objective-progress',
      mode: 'normal',
      testingMode: true,
      delayMs: 999999,
    })

    expect(payload.testingMode).toBe(false)
    expect(payload.delayMs).toBe(3000)
  })

  it('enforces bridge command/goal capability sets and manifest delay bounds', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const strictManifest = {
      ...manifest,
      delayBounds: { minMs: 100, maxMs: 200 },
      commands: manifest.commands.filter(command => command === 'start'),
      goals: manifest.goals.filter(goal => goal === 'objective-progress'),
    }
    const adapter = createBridgeGovernanceAdapter(strictManifest)

    const payload = adapter.parseAndClampPayload({
      command: 'start',
      goal: 'objective-progress',
      mode: 'normal',
      delayMs: 999,
      testingMode: true,
    })

    expect(payload.delayMs).toBe(200)
    expect(payload.testingMode).toBe(false)

    expect(() => adapter.parseAndClampPayload({
      command: 'snapshot',
      goal: 'objective-progress',
      mode: 'normal',
    })).toThrow(/not allowed by manifest/)

    expect(() => adapter.parseAndClampPayload({
      command: 'start',
      goal: 'max-shards',
      mode: 'normal',
    })).toThrow(/not allowed by manifest/)
  })

  it('enforces dev command authorization through bridge adapter', () => {
    const normalManifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const normalAdapter = createBridgeGovernanceAdapter(normalManifest)
    expect(() => normalAdapter.assertDevCommandAllowed('parity-patch')).toThrow(/not allowed by manifest/)

    const devWithoutUiManifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: false })
    const devWithoutUiAdapter = createBridgeGovernanceAdapter(devWithoutUiManifest)
    expect(() => devWithoutUiAdapter.assertDevCommandAllowed('parity-patch')).toThrow(/not allowed by manifest/)

    const devWithUiManifest = createBemergedAiGovernanceManifest({ mode: 'dev', aiDevControlsEnabled: true })
    const devWithUiAdapter = createBridgeGovernanceAdapter(devWithUiManifest)
    expect(() => devWithUiAdapter.assertDevCommandAllowed('parity-patch')).not.toThrow()
  })

  it('blocks invalid state-machine transition into testing from non-dev mode', () => {
    const transition = transitionBemergedAiMode('ai', 'enable-testing')
    expect(transition.ok).toBe(false)
    expect(transition.error).toBe('testing-requires-dev')
  })

  it('builds governed prompt scaffold with capability and invariant injection', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const prompt = buildBemergedGovernedPlannerPrompt({
      manifest,
      allowedActionTypes: ['swap'],
      goal: 'objective-progress',
      objectiveSummary: 'Complete all 24 unique lines to 5-star.',
      statePayload: { legalActions: { swapMoves: [{ index: 0 }] } },
      recentStrategyDelta: {
        avoid_patterns: ['loop-prone-action-cycles'],
        prefer_patterns: ['current-policy-baseline'],
        heuristics_to_adjust: ['increase-loop-penalty-weight'],
      },
    })

    expect(prompt).toContain('<governed_planner_context>')
    expect(prompt).toContain('<allowed_action_types>swap</allowed_action_types>')
    expect(prompt).toContain('<invariants>')
  })

  it('extracts/merges/prunes strategy deltas deterministically', () => {
    const deltaA = extractBemergedStrategyDelta({
      current: {
        seed: 1337,
        executed: true,
        stepEvents: 10,
        totalReward: -1,
        dominantReason: 'stagnation',
        maxLoopCountObserved: 4,
        objectiveCompletionPercent: 20,
      },
      previous: [
        {
          seed: 1336,
          executed: true,
          stepEvents: 12,
          totalReward: 3,
          dominantReason: 'continue',
          maxLoopCountObserved: 1,
          objectiveCompletionPercent: 32,
        },
      ],
    })

    const deltaB = extractBemergedStrategyDelta({
      current: {
        seed: 2026,
        executed: true,
        stepEvents: 4,
        totalReward: 5,
        dominantReason: 'continue',
        maxLoopCountObserved: 0,
        objectiveCompletionPercent: 45,
      },
      previous: [],
    })

    const merged = mergeBemergedStrategyDeltas([deltaA, deltaB])
    const pruned = pruneBemergedStrategyDelta(merged, 2)

    expect(merged.contractVersion).toBe('bemerged-strategy-delta-v2')
    expect(merged.avoid_patterns.length).toBeGreaterThan(0)
    expect(pruned.avoid_patterns.length).toBeLessThanOrEqual(2)
    expect(pruned.heuristics_to_adjust.length).toBeLessThanOrEqual(2)
  })

  it('validates run summary schema fields required for learning loop governance', () => {
    const parsed = bemergedRunSummarySchema.parse({
      seed: 4242,
      executed: true,
      finalScore: 4200,
      turns: 87,
      deathReason: 'boss-overwhelm',
      endgameState: 'objective-incomplete',
      bugsDetected: ['unsafe-merge-order'],
      strategyDelta: {
        avoid_patterns: ['loop-prone-action-cycles'],
        prefer_patterns: ['objective-priority'],
        new_tests: ['boss-overwhelm-regression'],
        discovered_bugs: ['unsafe-merge-order'],
        heuristics_to_adjust: ['increase-risk-penalty'],
      },
      stepEvents: 14,
      totalReward: 6,
      dominantReason: 'continue',
      maxLoopCountObserved: 1,
      objectiveCompletionPercent: 32,
    })

    expect(parsed.finalScore).toBe(4200)
    expect(parsed.turns).toBe(87)
    expect(parsed.deathReason).toBe('boss-overwhelm')
    expect(parsed.endgameState).toBe('objective-incomplete')
    expect(parsed.bugsDetected).toEqual(['unsafe-merge-order'])

    const delta = extractBemergedStrategyDelta({
      current: parsed,
      previous: [],
    })
    expect(delta.discovered_bugs.some(item => item.includes('unsafe-merge-order'))).toBe(true)
  })

  it('validates final governance chain from planner to next-run learning continuity', () => {
    const manifest = createBemergedAiGovernanceManifest({ mode: 'normal', aiDevControlsEnabled: false })
    const sceneAdapter = createSceneGovernanceAdapter(manifest)
    const bridgeAdapter = createBridgeGovernanceAdapter(manifest)
    const plannerAdapter = createPlannerGovernanceAdapter(manifest)
    const serverAdapter = createServerGovernanceAdapter(manifest, 'normal')

    expect(sceneAdapter.allowedActionTypes()).toEqual(BEMERGED_AUTOPLAY_ACTIONS)
    expect(plannerAdapter.filterPlannerActions(['swap', 'inventory'])).toEqual(['swap', 'inventory'])
    const clampedPayload = bridgeAdapter.parseAndClampPayload({
      command: 'start',
      goal: 'objective-progress',
      mode: 'normal',
      testingMode: true,
    })
    expect(clampedPayload.testingMode).toBe(false)
    expect(serverAdapter.buildRuntimeActions()).toEqual(manifest.actions.runtimeAllowed)

    const scenePayload = parseBemergedSceneToBridgePayload({
      mode: 'normal',
      testingMode: false,
      goal: 'objective-progress',
      aiControlSource: 'builtin-autoplay',
      autoplay: {
        active: true,
        delayMs: 250,
        goal: 'objective-progress',
        testingMode: false,
        movesExecuted: 2,
        mergesExecuted: 1,
        validMoveCount: 1,
        lastDecision: null,
        lastReward: null,
        elapsedSeconds: 12,
        lastError: null,
      },
      stats: {
        score: 10,
        moves: 2,
        merges: 1,
        shatters: 0,
        elapsedSeconds: 12,
        shardsPerHour: 100,
        shardsByType: { Cannon: 2, Armor: 2, Generator: 3, Core: 3 },
      },
      objective: {
        completionPercent: 5,
        completedTypeCount: 1,
        completedUniqueMods: 1,
        totalUniqueMods: 24,
        targetStars: 5,
        objectiveComplete: false,
        highestStarsByType: { Cannon: 1, Armor: 0, Generator: 0, Core: 0 },
      },
      aiContract: {
        schemaVersion: 'bemerged-ai-bridge-v1',
        governanceSchemaVersion: manifest.schemaVersion,
        mode: manifest.mode,
        strictGuardrails: manifest.strictGuardrails,
        delayBounds: manifest.delayBounds,
        goals: manifest.goals,
        commands: manifest.commands,
        actions: manifest.actions,
        invariants: manifest.invariants,
        governanceDrift: { ok: true, issues: [] },
      },
      aiRuntime: {
        initialized: true,
        modelId: 'autoplay-local',
        lastError: null,
        controlSource: 'builtin-autoplay',
        decisionMode: 'builtin-autoplay',
      },
      engine: {
        seed: 1337,
        elapsedSeconds: 12,
        stats: {
          score: 10,
          moves: 2,
          merges: 1,
          shatters: 0,
          elapsedSeconds: 12,
          shardsPerHour: 100,
          shardsByType: { Cannon: 2, Armor: 2, Generator: 3, Core: 3 },
        },
        validMoveCount: 1,
        objective: {
          completionPercent: 5,
          completedTypeCount: 1,
          completedUniqueMods: 1,
          totalUniqueMods: 24,
          targetStars: 5,
          objectiveComplete: false,
          highestStarsByType: { Cannon: 1, Armor: 0, Generator: 0, Core: 0 },
        },
        autoplayCapabilities: {
          goals: manifest.goals,
          actions: {
            primary: manifest.actions.runtimeAllowed,
            availableCommands: manifest.commands,
            runtimeAllowed: manifest.actions.runtimeAllowed,
            plannerVisible: manifest.actions.plannerVisible,
          },
          strictGuardrails: {
            allowTestingMode: false,
            allowDevControls: false,
            swapOnly: true,
          },
        },
        board: [[null]],
        autoplay: {},
      },
    })

    const bridgeToPlanner = parseBemergedBridgeToPlannerOutput({
      manifest,
      allowedActionTypes: [...plannerAdapter.allowedPlannerActions()],
      goal: 'objective-progress',
      plannerSeed: 1337,
      objectiveSummary: 'Complete all 24 unique module lines to 5-star Ancestral.',
      statePayload: scenePayload,
      recentRunSummaries: ['seed=1337 t=10 action=swap moved=1 merged=1 reward=1.5 reason=ai-swap'],
      recentStrategyDelta: {
        avoid_patterns: ['loop-prone-action-cycles'],
        prefer_patterns: ['reward-positive:swap'],
        heuristics_to_adjust: ['increase-loop-penalty-weight'],
      },
    })

    const prompt = buildBemergedGovernedPlannerPrompt({
      manifest,
      allowedActionTypes: bridgeToPlanner.allowedActionTypes,
      goal: bridgeToPlanner.goal,
      plannerSeed: bridgeToPlanner.plannerSeed,
      objectiveSummary: bridgeToPlanner.objectiveSummary,
      statePayload: bridgeToPlanner.statePayload,
      recentRunSummaries: bridgeToPlanner.recentRunSummaries,
      recentStrategyDelta: bridgeToPlanner.recentStrategyDelta,
    })
    expect(prompt).toContain('<seed>1337</seed>')

    const plannerDecision = parseBemergedAiPlannerDecision({ actionType: 'swap', moveIndex: 0, reason: 'legal-action' })
    expect(plannerDecision.actionType).toBe('swap')

    const attemptTelemetry = parseBemergedAttemptCompleteTelemetryEvent({
      type: 'bemerged:attempt-complete',
      payload: {
        reason: 'win',
        mode: 'normal',
        aiUsedInAttempt: true,
        devControlsUsedInAttempt: false,
        timeSeconds: 30,
        moveCount: 12,
        mergeCount: 6,
        shardsEarned: 50,
        objectiveComplete: false,
        completedTypeCount: 1,
        completedUniqueMods: 3,
        totalUniqueMods: 24,
        updatedAt: Date.now(),
      },
    })
    expect(attemptTelemetry.payload.mode).toBe('normal')

    const stateTelemetry = parseBemergedStateTelemetryEvent({
      type: 'bemerged:state',
      payload: {
        totalShards: 50,
        moveCount: 12,
        totalMerges: 6,
        totalShatters: 1,
        elapsedSeconds: 30,
        shardsPerHour: 6000,
        mergesPerHour: 720,
        shattersPerHour: 120,
        objectiveComplete: false,
        completedTypeCount: 1,
        completedUniqueMods: 3,
        totalUniqueMods: 24,
        updatedAt: Date.now(),
      },
    })
    expect(stateTelemetry.payload.totalShards).toBe(50)

    const runA = bemergedRunSummarySchema.parse({
      seed: 1337,
      executed: true,
      finalScore: 120,
      turns: 30,
      deathReason: 'none',
      endgameState: 'objective-incomplete',
      bugsDetected: ['swap-loop'],
      strategyDelta: {
        avoid_patterns: ['loop-prone-action-cycles'],
        prefer_patterns: [],
        new_tests: ['loop-pressure-regression'],
        discovered_bugs: ['swap-loop'],
        heuristics_to_adjust: ['increase-loop-penalty-weight'],
      },
      stepEvents: 10,
      totalReward: -2,
      dominantReason: 'stagnation',
      maxLoopCountObserved: 4,
      objectiveCompletionPercent: 10,
    })
    const runB = bemergedRunSummarySchema.parse({
      seed: 1337,
      executed: true,
      finalScore: 240,
      turns: 30,
      deathReason: 'none',
      endgameState: 'objective-incomplete',
      bugsDetected: [],
      strategyDelta: {
        avoid_patterns: [],
        prefer_patterns: ['reward-positive:swap'],
        new_tests: [],
        discovered_bugs: [],
        heuristics_to_adjust: ['increase-objective-completion-pressure'],
      },
      stepEvents: 12,
      totalReward: 4,
      dominantReason: 'continue',
      maxLoopCountObserved: 0,
      objectiveCompletionPercent: 15,
    })

    const deltaA = extractBemergedStrategyDelta({ current: runA, previous: [] })
    const deltaB = extractBemergedStrategyDelta({ current: runB, previous: [runA] })
    const merged = mergeBemergedStrategyDeltas([deltaA, deltaB])
    const pruned = pruneBemergedStrategyDelta(merged, 6)
    expect(pruned.avoid_patterns.length).toBeGreaterThan(0)
    expect(pruned.prefer_patterns.length).toBeGreaterThan(0)

    const nextRunLearning = updateAutoplayLearningMemory({
      current: {
        recentDeltas: [],
        cleanLessons: { ...EMPTY_BEMERGED_STRATEGY_DELTA },
      },
      incomingDeltas: [
        buildStrategyDeltaFromOutcome({
          actionType: 'swap',
          moved: false,
          merged: false,
          reason: 'loop-detected',
          reward: { objective: -1, shards: 0, time: -1, risk: -2, total: -4 },
          elapsedSeconds: 10,
          seed: 1337,
          lastError: 'loop branch',
        }),
        buildStrategyDeltaFromOutcome({
          actionType: 'swap',
          moved: true,
          merged: true,
          reason: 'safe-progress',
          reward: { objective: 2, shards: 1, time: 0, risk: 0, total: 3 },
          elapsedSeconds: 20,
          seed: 1337,
          lastError: null,
        }),
      ],
      maxRecentDeltas: 8,
      maxItemsPerBucket: 8,
    })

    expect(nextRunLearning.cleanLessons.avoid_patterns.length).toBeGreaterThan(0)
    expect(nextRunLearning.cleanLessons.prefer_patterns.length).toBeGreaterThan(0)
  })
})
