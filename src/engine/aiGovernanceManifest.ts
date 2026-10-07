import {
  BEMERGED_AI_ACTION_TYPE_VALUES,
  BEMERGED_AI_BRIDGE_COMMAND_VALUES,
  BEMERGED_AI_DEV_COMMAND_VALUES,
  BEMERGED_AI_DELAY_BOUNDS,
  BEMERGED_AI_GOAL_VALUES,
  BEMERGED_AI_GOVERNANCE_SCHEMA_VERSION,
  BEMERGED_AI_MODE_STATE_VALUES,
  type BemergedAiActionType,
  type BemergedAiBridgeCommand,
  type BemergedAiDevCommand,
  type BemergedAiBridgeMode,
  type BemergedAiGovernanceManifest,
  validateBemergedAiGovernanceManifest,
} from './aiGovernanceSchema'
import { evaluateBemergedGovernanceInvariants, type GovernanceViolation } from './aiGovernanceRuleEngine'

export type {
  BemergedAiActionType,
  BemergedAiBridgeCommand,
  BemergedAiDevCommand,
  BemergedAiBridgeMode,
  BemergedAiGovernanceManifest,
} from './aiGovernanceSchema'

export const BEMERGED_AI_COMMANDS: ReadonlyArray<BemergedAiBridgeCommand> = BEMERGED_AI_BRIDGE_COMMAND_VALUES
export const BEMERGED_AI_GOALS: ReadonlyArray<import('./aiGovernanceSchema').BemergedAiGoal> = BEMERGED_AI_GOAL_VALUES
export const BEMERGED_AUTOPLAY_ACTIONS: ReadonlyArray<BemergedAiActionType> = BEMERGED_AI_ACTION_TYPE_VALUES
export { BEMERGED_AI_DELAY_BOUNDS, BEMERGED_AI_GOVERNANCE_SCHEMA_VERSION }
export const BEMERGED_AI_DEV_COMMANDS: ReadonlyArray<BemergedAiDevCommand> = BEMERGED_AI_DEV_COMMAND_VALUES

export function getAllowedAutoplayActions(_input: { allowDevControls: boolean }): ReadonlyArray<BemergedAiActionType> {
  return BEMERGED_AUTOPLAY_ACTIONS
}

export function createBemergedAiGovernanceManifest(input: {
  mode: BemergedAiBridgeMode
  aiDevControlsEnabled: boolean
}): BemergedAiGovernanceManifest {
  const allowTestingMode = input.mode === 'dev'
  const allowDevControls = input.mode === 'dev' && input.aiDevControlsEnabled
  const runtimeAllowed = getAllowedAutoplayActions({ allowDevControls })
  const runtimeDevCommands = allowDevControls ? BEMERGED_AI_DEV_COMMANDS : []

  return validateBemergedAiGovernanceManifest({
    schemaVersion: BEMERGED_AI_GOVERNANCE_SCHEMA_VERSION,
    mode: input.mode,
    modes: BEMERGED_AI_MODE_STATE_VALUES,
    objectiveModel: {
      id: 'full-24-unique-5star',
      description: 'Complete all 24 unique module lines to 5-star Ancestral.',
    },
    delayBounds: {
      minMs: BEMERGED_AI_DELAY_BOUNDS.minMs,
      maxMs: BEMERGED_AI_DELAY_BOUNDS.maxMs,
    },
    contracts: {
      delayBoundsSource: 'manifest.delayBounds',
      objectiveModelSource: 'manifest.objectiveModel',
      telemetryRules: {
        emitAttemptCompletionForAllModes: true,
        devControlsUsedInAttemptRequiresActualUse: true,
        dedupeFields: true,
      },
      progressSemantics: {
        completedTypeCount: 'type-count',
        completedUniqueMods: 'unique-lines',
      },
    },
    goals: BEMERGED_AI_GOALS,
    commands: BEMERGED_AI_COMMANDS,
    actions: {
      plannerVisible: runtimeAllowed,
      runtimeAllowed,
    },
    devCommands: {
      plannerVisible: runtimeDevCommands,
      runtimeAllowed: runtimeDevCommands,
    },
    strictGuardrails: {
      allowTestingMode,
      allowDevControls,
      allowDevTools: allowDevControls,
      allowParityPatches: allowDevControls,
      allowForcedCheats: allowDevControls,
      swapOnly: runtimeAllowed.length === 1 && runtimeAllowed[0] === 'swap',
    },
    invariants: [
      'testingMode may be true only when mode=dev',
      'planner action set must equal runtime-allowed action set',
      'swap-only policy must apply to all action paths (planner, scene, built-in autoplay, bridge, dev commands)',
      'dev controls must be UI-visible and runtime-authorized before use',
      'planner must receive the exact capability set enforced by runtime',
      'bridge delay bounds must match runtime delay bounds',
    ],
  })
}

type DriftIssue = GovernanceViolation

export function detectBemergedAiGovernanceDrift(input: {
  manifest: BemergedAiGovernanceManifest
  sceneCapabilities: {
    goals?: unknown
    actions?: {
      primary?: unknown
      availableCommands?: unknown
      runtimeAllowed?: unknown
      plannerVisible?: unknown
    }
    strictGuardrails?: {
      allowTestingMode?: unknown
      allowDevControls?: unknown
      swapOnly?: unknown
    }
  } | null | undefined
  runtimeContract?: {
    mode?: unknown
    delayBounds?: {
      minMs?: unknown
      maxMs?: unknown
    } | null
    objectiveModelId?: unknown
    telemetryRules?: {
      emitAttemptCompletionForAllModes?: unknown
      devControlsUsedInAttemptRequiresActualUse?: unknown
      dedupeFields?: unknown
    } | null
  } | null
}): { ok: boolean; issues: DriftIssue[] } {
  const issues: DriftIssue[] = []
  const capabilities = input.sceneCapabilities

  const toList = (value: unknown): string[] => Array.isArray(value) ? value.map(item => String(item)) : []

  const goals = toList(capabilities?.goals)
  const sceneCommands = toList(capabilities?.actions?.availableCommands)
  const scenePrimary = toList(capabilities?.actions?.primary)
  const sceneRuntimeAllowed = toList(capabilities?.actions?.runtimeAllowed)
  const scenePlannerVisible = toList(capabilities?.actions?.plannerVisible)

  if (JSON.stringify(goals) !== JSON.stringify(input.manifest.goals)) {
    issues.push({ code: 'goals-drift', severity: 'error', message: 'Scene goal set differs from governance manifest.' })
  }
  if (JSON.stringify(sceneCommands) !== JSON.stringify(input.manifest.commands)) {
    issues.push({ code: 'commands-drift', severity: 'error', message: 'Scene command set differs from governance manifest.' })
  }
  if (scenePrimary.length > 0 && JSON.stringify(scenePrimary) !== JSON.stringify(input.manifest.actions.runtimeAllowed)) {
    issues.push({ code: 'primary-actions-drift', severity: 'error', message: 'Scene primary actions differ from governance runtimeAllowed actions.' })
  }
  if (sceneRuntimeAllowed.length > 0 && JSON.stringify(sceneRuntimeAllowed) !== JSON.stringify(input.manifest.actions.runtimeAllowed)) {
    issues.push({ code: 'runtime-actions-drift', severity: 'error', message: 'Scene runtimeAllowed actions differ from governance manifest.' })
  }
  if (scenePlannerVisible.length > 0 && JSON.stringify(scenePlannerVisible) !== JSON.stringify(input.manifest.actions.plannerVisible)) {
    issues.push({ code: 'planner-actions-drift', severity: 'error', message: 'Scene plannerVisible actions differ from governance manifest.' })
  }

  const guardrails = capabilities?.strictGuardrails
  if (typeof guardrails?.allowTestingMode === 'boolean' && guardrails.allowTestingMode !== input.manifest.strictGuardrails.allowTestingMode) {
    issues.push({ code: 'testing-mode-drift', severity: 'error', message: 'allowTestingMode differs between scene and governance manifest.' })
  }
  if (typeof guardrails?.allowDevControls === 'boolean' && guardrails.allowDevControls !== input.manifest.strictGuardrails.allowDevControls) {
    issues.push({ code: 'dev-controls-drift', severity: 'error', message: 'allowDevControls differs between scene and governance manifest.' })
  }
  if (typeof guardrails?.swapOnly === 'boolean' && guardrails.swapOnly !== input.manifest.strictGuardrails.swapOnly) {
    issues.push({ code: 'swap-only-drift', severity: 'error', message: 'swapOnly differs between scene and governance manifest.' })
  }

  const ruleEngine = evaluateBemergedGovernanceInvariants({
    manifest: input.manifest,
    plannerAllowedActions: scenePlannerVisible as BemergedAiActionType[],
    runtimeAllowedActions: sceneRuntimeAllowed as BemergedAiActionType[],
  })
  issues.push(...ruleEngine.violations)

  const runtimeContract = input.runtimeContract
  let contractDriftDetected = false

  if (typeof runtimeContract?.mode === 'string' && runtimeContract.mode !== input.manifest.mode) {
    contractDriftDetected = true
    issues.push({ code: 'mode-drift', severity: 'error', message: 'Runtime mode differs from governance manifest mode.' })
  }

  if (
    runtimeContract?.delayBounds
    && (
      Number(runtimeContract.delayBounds.minMs) !== input.manifest.delayBounds.minMs
      || Number(runtimeContract.delayBounds.maxMs) !== input.manifest.delayBounds.maxMs
    )
  ) {
    contractDriftDetected = true
    issues.push({ code: 'delay-bound-drift', severity: 'error', message: 'Runtime delay bounds differ from governance manifest bounds.' })
  }

  if (
    typeof runtimeContract?.objectiveModelId === 'string'
    && runtimeContract.objectiveModelId !== input.manifest.objectiveModel.id
  ) {
    contractDriftDetected = true
    issues.push({ code: 'objective-drift', severity: 'error', message: 'Runtime objective model differs from governance objective model.' })
  }

  const telemetryRules = runtimeContract?.telemetryRules
  if (telemetryRules) {
    const manifestTelemetry = input.manifest.contracts.telemetryRules
    if (
      typeof telemetryRules.emitAttemptCompletionForAllModes === 'boolean'
      && telemetryRules.emitAttemptCompletionForAllModes !== manifestTelemetry.emitAttemptCompletionForAllModes
    ) {
      contractDriftDetected = true
      issues.push({ code: 'telemetry-drift', severity: 'error', message: 'Runtime telemetry rules differ from governance telemetry rules.' })
    }
    if (
      typeof telemetryRules.devControlsUsedInAttemptRequiresActualUse === 'boolean'
      && telemetryRules.devControlsUsedInAttemptRequiresActualUse !== manifestTelemetry.devControlsUsedInAttemptRequiresActualUse
    ) {
      contractDriftDetected = true
      issues.push({ code: 'telemetry-drift', severity: 'error', message: 'Runtime telemetry rules differ from governance telemetry rules.' })
    }
    if (
      typeof telemetryRules.dedupeFields === 'boolean'
      && telemetryRules.dedupeFields !== manifestTelemetry.dedupeFields
    ) {
      contractDriftDetected = true
      issues.push({ code: 'telemetry-drift', severity: 'error', message: 'Runtime telemetry rules differ from governance telemetry rules.' })
    }
  }

  if (contractDriftDetected) {
    issues.push({ code: 'contract-drift', severity: 'error', message: 'Runtime contract differs from governance manifest contract.' })
  }

  return {
    ok: issues.every(issue => issue.severity !== 'error'),
    issues,
  }
}

export function createBemergedGovernanceDriftError(input: {
  context: string
  report: { ok: boolean; issues: DriftIssue[] }
}): Error {
  const issueCodes = input.report.issues.map(issue => issue.code)
  const message = `Governance drift blocked in ${input.context}: ${issueCodes.join(', ') || 'unknown-drift'}`
  const error = new Error(message)
  ;(error as Error & { code: string; details: unknown }).code = 'governance-drift-blocked'
  ;(error as Error & { code: string; details: unknown }).details = {
    context: input.context,
    issueCount: input.report.issues.length,
    issues: input.report.issues,
  }
  return error
}

export function assertBemergedGovernanceNoDrift(input: {
  context: string
  report: { ok: boolean; issues: DriftIssue[] }
}): void {
  if (input.report.ok) return
  throw createBemergedGovernanceDriftError(input)
}
