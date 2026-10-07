import { z } from 'zod'
import {
  bemergedAiActionTypeSchema,
  bemergedAiGovernanceManifestSchema,
  bemergedAiBridgePayloadSchema,
  type BemergedAiActionType,
  type BemergedAiGovernanceManifest,
} from './aiGovernanceSchema'

export type GovernanceViolation = {
  code: string
  severity: 'error' | 'warning'
  message: string
}

const governanceSnapshotSchema = z.object({
  manifest: bemergedAiGovernanceManifestSchema,
  payload: bemergedAiBridgePayloadSchema.optional(),
  runtimeAllowedActions: z.array(bemergedAiActionTypeSchema).optional(),
  plannerAllowedActions: z.array(bemergedAiActionTypeSchema).optional(),
  bridgeDelayBounds: z.object({ minMs: z.number().int(), maxMs: z.number().int() }).optional(),
  serverObjectiveModelId: z.string().optional(),
  completedTypeCount: z.number().int().optional(),
  completedUniqueMods: z.number().int().optional(),
  devControlsUsedInAttempt: z.boolean().optional(),
  devControlsActuallyUsed: z.boolean().optional(),
})

export type GovernanceSnapshot = z.infer<typeof governanceSnapshotSchema>

function equalList<T extends string>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function evaluateBemergedGovernanceInvariants(input: GovernanceSnapshot): {
  ok: boolean
  violations: GovernanceViolation[]
} {
  const snapshot = governanceSnapshotSchema.parse(input)
  const manifest: BemergedAiGovernanceManifest = snapshot.manifest
  const violations: GovernanceViolation[] = []

  if (snapshot.payload?.testingMode && snapshot.payload.mode !== 'dev') {
    violations.push({
      code: 'testing-mode-blocked',
      severity: 'error',
      message: 'testingMode=true requires mode=dev.',
    })
  }

  if (manifest.strictGuardrails.swapOnly) {
    const nonSwapRuntime = (snapshot.runtimeAllowedActions || []).filter(action => action !== 'swap')
    const nonSwapPlanner = (snapshot.plannerAllowedActions || []).filter(action => action !== 'swap')
    if (nonSwapRuntime.length > 0 || nonSwapPlanner.length > 0) {
      violations.push({
        code: 'swap-only-violation',
        severity: 'error',
        message: 'swap-only mode must reject non-swap actions at all layers.',
      })
    }
  }

  if (snapshot.bridgeDelayBounds) {
    if (
      snapshot.bridgeDelayBounds.minMs !== manifest.delayBounds.minMs
      || snapshot.bridgeDelayBounds.maxMs !== manifest.delayBounds.maxMs
    ) {
      violations.push({
        code: 'delay-bounds-drift',
        severity: 'error',
        message: 'Bridge delay bounds must match governance manifest bounds exactly.',
      })
    }
  }

  if (snapshot.runtimeAllowedActions && !equalList(snapshot.runtimeAllowedActions, manifest.actions.runtimeAllowed as BemergedAiActionType[])) {
    violations.push({
      code: 'runtime-capability-drift',
      severity: 'error',
      message: 'Runtime allowed actions must match governance manifest runtimeAllowed actions.',
    })
  }

  if (snapshot.plannerAllowedActions && !equalList(snapshot.plannerAllowedActions, manifest.actions.plannerVisible as BemergedAiActionType[])) {
    violations.push({
      code: 'planner-capability-drift',
      severity: 'error',
      message: 'Planner allowed actions must match governance manifest plannerVisible actions.',
    })
  }

  if (snapshot.serverObjectiveModelId && snapshot.serverObjectiveModelId !== manifest.objectiveModel.id) {
    violations.push({
      code: 'objective-model-drift',
      severity: 'error',
      message: 'Server objective model id must match governance objective model id.',
    })
  }

  if (typeof snapshot.completedTypeCount === 'number' && typeof snapshot.completedUniqueMods === 'number') {
    if (snapshot.completedTypeCount > 4) {
      violations.push({
        code: 'progress-type-count-invalid',
        severity: 'error',
        message: 'completedTypeCount must be a module-type count (0..4), not a unique-line count.',
      })
    }
    if (snapshot.completedTypeCount > snapshot.completedUniqueMods) {
      violations.push({
        code: 'progress-semantics-invalid',
        severity: 'error',
        message: 'completedTypeCount cannot exceed completedUniqueMods under governance semantics.',
      })
    }
  }

  if (snapshot.devControlsUsedInAttempt === true && snapshot.devControlsActuallyUsed === false) {
    violations.push({
      code: 'dev-controls-telemetry-drift',
      severity: 'warning',
      message: 'devControlsUsedInAttempt should be true only when dev controls were actually used.',
    })
  }

  return {
    ok: violations.every(violation => violation.severity !== 'error'),
    violations,
  }
}
