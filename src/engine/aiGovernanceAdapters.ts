import {
  type BemergedAiActionType,
  type BemergedAiBridgeMode,
  type BemergedAiBridgePayload,
  type BemergedAiDevCommand,
  type BemergedAiGovernanceManifest,
  parseBemergedAiBridgePayload,
} from './aiGovernanceSchema'
import { evaluateBemergedGovernanceInvariants } from './aiGovernanceRuleEngine'

export function createBridgeGovernanceAdapter(manifest: BemergedAiGovernanceManifest) {
  return {
    assertDevCommandAllowed(command: BemergedAiDevCommand): void {
      if (manifest.devCommands.runtimeAllowed.includes(command)) return
      throw new Error(`Bridge governance invariant failure: dev command "${command}" is not allowed by manifest.`)
    },
    parseAndClampPayload(input: unknown): BemergedAiBridgePayload {
      const parsed = parseBemergedAiBridgePayload(input)
      const delayBounds = manifest.delayBounds

      if (parsed.mode !== manifest.mode) {
        throw new Error('Bridge governance invariant failure: payload mode must match manifest mode.')
      }

      if (!manifest.commands.some(command => command === parsed.command)) {
        throw new Error(`Bridge governance invariant failure: command "${parsed.command}" is not allowed by manifest.`)
      }

      if (!manifest.goals.some(goal => goal === parsed.goal)) {
        throw new Error(`Bridge governance invariant failure: goal "${parsed.goal}" is not allowed by manifest.`)
      }

      const delayMs = parsed.delayMs == null
        ? undefined
        : Math.max(delayBounds.minMs, Math.min(delayBounds.maxMs, Math.floor(parsed.delayMs)))

      const result: BemergedAiBridgePayload = {
        ...parsed,
        delayMs,
        testingMode: manifest.strictGuardrails.allowTestingMode && parsed.mode === 'dev' && parsed.testingMode === true,
      }

      const invariants = evaluateBemergedGovernanceInvariants({
        manifest,
        payload: result,
        bridgeDelayBounds: delayBounds,
      })
      if (!invariants.ok) {
        const firstError = invariants.violations.find(violation => violation.severity === 'error')
        throw new Error(firstError?.message || 'Bridge governance invariant failure.')
      }

      return result
    },
  }
}

export function createSceneGovernanceAdapter(manifest: BemergedAiGovernanceManifest) {
  const runtimeAllowed = manifest.actions.runtimeAllowed
  const delayBounds = manifest.delayBounds

  return {
    allowedActionTypes(): ReadonlyArray<BemergedAiActionType> {
      return runtimeAllowed
    },
    allowAdvancedAutoplayActions(): boolean {
      return runtimeAllowed.some(action => action !== 'swap')
    },
    enforceAction(actionType: BemergedAiActionType): BemergedAiActionType {
      if (runtimeAllowed.includes(actionType)) return actionType
      return 'swap'
    },
    clampDelayMs(delayMs: unknown, fallbackDelayMs: number): number {
      const resolvedDelay = Number.isFinite(Number(delayMs))
        ? Math.floor(Number(delayMs))
        : Math.floor(Number(fallbackDelayMs) || delayBounds.minMs)
      return Math.max(delayBounds.minMs, Math.min(delayBounds.maxMs, resolvedDelay))
    },
    enforceTestingMode(requestedTestingMode: unknown): boolean {
      return manifest.strictGuardrails.allowTestingMode && requestedTestingMode === true
    },
    allowsAction(actionType: BemergedAiActionType): boolean {
      return runtimeAllowed.includes(actionType)
    },
  }
}

export function createPlannerGovernanceAdapter(manifest: BemergedAiGovernanceManifest) {
  return {
    allowedPlannerActions(): ReadonlyArray<BemergedAiActionType> {
      return manifest.actions.plannerVisible
    },
    filterPlannerActions(candidateActions: ReadonlyArray<BemergedAiActionType>): ReadonlyArray<BemergedAiActionType> {
      return candidateActions.filter(action => manifest.actions.plannerVisible.includes(action))
    },
  }
}

export function createServerGovernanceAdapter(manifest: BemergedAiGovernanceManifest, mode: BemergedAiBridgeMode) {
  const runtimeAllowedActions = manifest.actions.runtimeAllowed.slice()

  return {
    buildObjectiveModel(): { id: string; description: string } {
      return {
        id: manifest.objectiveModel.id,
        description: manifest.objectiveModel.description,
      }
    },
    buildRuntimeActions(): ReadonlyArray<BemergedAiActionType> {
      void mode
      return runtimeAllowedActions
    },
    assertObjectiveProgressSemantics(objective: unknown): void {
      if (!objective || typeof objective !== 'object') {
        throw new Error('Server governance invariant failure: objective payload is missing.')
      }

      const typedObjective = objective as {
        completedTypeCount?: unknown
        completedUniqueMods?: unknown
        totalUniqueMods?: unknown
        completionPercent?: unknown
        objectiveComplete?: unknown
      }

      const completedTypeCount = Number(typedObjective.completedTypeCount)
      const completedUniqueMods = Number(typedObjective.completedUniqueMods)
      const totalUniqueMods = Number(typedObjective.totalUniqueMods)
      const completionPercent = Number(typedObjective.completionPercent)
      const objectiveComplete = typedObjective.objectiveComplete

      if (!Number.isInteger(completedTypeCount) || completedTypeCount < 0 || completedTypeCount > 4) {
        throw new Error('Server governance invariant failure: completedTypeCount must be an integer in [0,4].')
      }

      if (!Number.isInteger(totalUniqueMods) || totalUniqueMods <= 0) {
        throw new Error('Server governance invariant failure: totalUniqueMods must be a positive integer.')
      }

      if (!Number.isInteger(completedUniqueMods) || completedUniqueMods < 0 || completedUniqueMods > totalUniqueMods) {
        throw new Error('Server governance invariant failure: completedUniqueMods must be an integer in [0,totalUniqueMods].')
      }

      if (completedTypeCount > completedUniqueMods) {
        throw new Error('Server governance invariant failure: completedTypeCount cannot exceed completedUniqueMods.')
      }

      const expectedPercent = Number(((completedUniqueMods / totalUniqueMods) * 100).toFixed(2))
      if (!Number.isFinite(completionPercent) || Math.abs(completionPercent - expectedPercent) > 0.01) {
        throw new Error('Server governance invariant failure: completionPercent must match completedUniqueMods/totalUniqueMods semantics.')
      }

      if (typeof objectiveComplete !== 'boolean' || objectiveComplete !== (completedUniqueMods >= totalUniqueMods)) {
        throw new Error('Server governance invariant failure: objectiveComplete must match completedUniqueMods >= totalUniqueMods.')
      }
    },
  }
}
