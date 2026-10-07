import { z } from 'zod'

export const BEMERGED_AI_BRIDGE_COMMAND_VALUES = ['start', 'stop', 'status', 'snapshot', 'step'] as const
export const BEMERGED_AI_BRIDGE_MODE_VALUES = ['normal', 'dev'] as const
export const BEMERGED_AI_MODE_STATE_VALUES = ['ai', 'autoplay', 'testing', 'dev', 'swap-only', 'restricted'] as const
export const BEMERGED_AI_ACTION_TYPE_VALUES = ['swap', 'merge-selection', 'inventory', 'shard-boost', 'boss-shatter', 'mine-shatter'] as const
export const BEMERGED_AI_DEV_COMMAND_VALUES = ['dev-tools', 'parity-patch', 'forced-cheats'] as const
export const BEMERGED_AI_GOAL_VALUES = [
  'balanced',
  'objective-progress',
  'max-shards',
  'max-merges',
  'farm-cannon',
  'farm-armor',
  'farm-generator',
  'farm-core',
  'boss-damage',
] as const

export const BEMERGED_AI_GOVERNANCE_SCHEMA_VERSION = '2.0.0'
export const BEMERGED_AI_DELAY_BOUNDS = { minMs: 50, maxMs: 3000 } as const

export const bemergedAiBridgeCommandSchema = z.enum(BEMERGED_AI_BRIDGE_COMMAND_VALUES)
export const bemergedAiBridgeModeSchema = z.enum(BEMERGED_AI_BRIDGE_MODE_VALUES)
export const bemergedAiModeStateSchema = z.enum(BEMERGED_AI_MODE_STATE_VALUES)
export const bemergedAiActionTypeSchema = z.enum(BEMERGED_AI_ACTION_TYPE_VALUES)
export const bemergedAiDevCommandSchema = z.enum(BEMERGED_AI_DEV_COMMAND_VALUES)
export const bemergedAiGoalSchema = z.enum(BEMERGED_AI_GOAL_VALUES)

const bemergedCellSchema = z.object({
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
})

const bemergedStatsSchema = z.object({
  score: z.number().finite().nonnegative(),
  moves: z.number().int().nonnegative(),
  merges: z.number().int().nonnegative(),
  shatters: z.number().int().nonnegative(),
  elapsedSeconds: z.number().int().nonnegative(),
  shardsPerHour: z.number().int().nonnegative(),
  shardsByType: z.object({
    Cannon: z.number().int().nonnegative(),
    Armor: z.number().int().nonnegative(),
    Generator: z.number().int().nonnegative(),
    Core: z.number().int().nonnegative(),
  }),
})

const bemergedObjectiveProgressSchema = z.object({
  completionPercent: z.number().finite().min(0).max(100),
  completedTypeCount: z.number().int().nonnegative(),
  completedUniqueMods: z.number().int().nonnegative(),
  totalUniqueMods: z.number().int().positive(),
  targetStars: z.number().int().positive(),
  objectiveComplete: z.boolean(),
  highestStarsByType: z.object({
    Cannon: z.number().int().nonnegative(),
    Armor: z.number().int().nonnegative(),
    Generator: z.number().int().nonnegative(),
    Core: z.number().int().nonnegative(),
  }),
})

const bemergedSwapMoveSchema = z.object({
  index: z.number().int().nonnegative(),
  from: bemergedCellSchema,
  to: bemergedCellSchema,
})

const bemergedBossShatterPlanSchema = z.object({
  index: z.number().int().nonnegative(),
  selection: z.array(bemergedCellSchema),
})

const bemergedMineShatterPlanSchema = z.object({
  index: z.number().int().nonnegative(),
  mine: bemergedCellSchema,
  selection: z.array(bemergedCellSchema),
})

const bemergedInventoryActionSchema = z.object({
  cell: bemergedCellSchema,
  slotType: z.enum(['Cannon', 'Armor', 'Generator', 'Core']),
})

const bemergedMergeSelectionSchema = z.object({
  base: bemergedCellSchema,
  fodders: z.array(bemergedCellSchema),
  totalCells: z.number().int().positive(),
})

export const bemergedAiStateInputSchema = z.object({
  goal: bemergedAiGoalSchema,
  elapsedSeconds: z.number().finite().nonnegative(),
  stats: bemergedStatsSchema,
  objective: bemergedObjectiveProgressSchema,
})

export const bemergedAiAllowedActionTypesSchema = z.array(bemergedAiActionTypeSchema).min(1)

export const bemergedAiLegalActionsInputSchema = z.object({
  swapMoves: z.array(bemergedSwapMoveSchema),
  bossShatterPlans: z.array(bemergedBossShatterPlanSchema),
  mineShatterPlans: z.array(bemergedMineShatterPlanSchema),
  validMoveCount: z.number().int().nonnegative(),
  shardBoost: z.object({
    type: z.enum(['Cannon', 'Armor', 'Generator', 'Core']),
    currentLevel: z.number().int().nonnegative(),
    nextCost: z.number().int().positive(),
    availableShards: z.number().int().nonnegative(),
  }).nullable(),
  inventoryAction: bemergedInventoryActionSchema.nullable(),
  mergeSelection: bemergedMergeSelectionSchema.nullable(),
})

export const bemergedAiDevCommandsInputSchema = z.array(bemergedAiDevCommandSchema)

export const bemergedAiPlannerDecisionSchema = z.object({
  actionType: bemergedAiActionTypeSchema,
  moveIndex: z.number().int().nonnegative().optional(),
  bossPlanIndex: z.number().int().nonnegative().optional(),
  minePlanIndex: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.actionType === 'swap' && value.moveIndex == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'moveIndex is required when actionType=swap' })
  }
  if (value.actionType === 'boss-shatter' && value.bossPlanIndex == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bossPlanIndex is required when actionType=boss-shatter' })
  }
  if (value.actionType === 'mine-shatter' && value.minePlanIndex == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'minePlanIndex is required when actionType=mine-shatter' })
  }
})

const bemergedAttemptCompletePayloadSchema = z.object({
  reason: z.enum(['win', 'restart']),
  mode: bemergedAiBridgeModeSchema,
  aiUsedInAttempt: z.boolean(),
  devControlsUsedInAttempt: z.boolean(),
  timeSeconds: z.number().int().nonnegative(),
  moveCount: z.number().int().nonnegative(),
  mergeCount: z.number().int().nonnegative(),
  shardsEarned: z.number().int().nonnegative(),
  objectiveComplete: z.boolean(),
  completedTypeCount: z.number().int().nonnegative(),
  completedUniqueMods: z.number().int().nonnegative(),
  totalUniqueMods: z.number().int().positive(),
  updatedAt: z.number().int().nonnegative(),
})

export const bemergedAttemptCompleteEventSchema = z.object({
  type: z.literal('bemerged:attempt-complete'),
  payload: bemergedAttemptCompletePayloadSchema,
})

const bemergedStatePayloadSchema = z.object({
  totalShards: z.number().int().nonnegative(),
  moveCount: z.number().int().nonnegative(),
  totalMerges: z.number().int().nonnegative(),
  totalShatters: z.number().int().nonnegative(),
  objectiveComplete: z.boolean(),
  completedTypeCount: z.number().int().nonnegative(),
  completedUniqueMods: z.number().int().nonnegative(),
  totalUniqueMods: z.number().int().positive(),
  elapsedSeconds: z.number().int().nonnegative(),
  shardsPerHour: z.number().int().nonnegative(),
  mergesPerHour: z.number().int().nonnegative(),
  shattersPerHour: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const bemergedStateTelemetryEventSchema = z.object({
  type: z.literal('bemerged:state'),
  payload: bemergedStatePayloadSchema,
})

const bemergedBridgeCapabilitiesSchema = z.object({
  goals: z.array(z.string()),
  actions: z.object({
    primary: z.array(z.string()),
    availableCommands: z.array(z.string()),
    runtimeAllowed: z.array(z.string()).optional(),
    plannerVisible: z.array(z.string()).optional(),
  }),
  strictGuardrails: z.object({
    allowTestingMode: z.boolean(),
    allowDevControls: z.boolean(),
    swapOnly: z.boolean(),
  }),
})

export const bemergedSceneToBridgePayloadSchema = z.object({
  autoplay: z.object({
    active: z.boolean(),
    delayMs: z.number().int().nonnegative(),
    goal: z.string(),
    testingMode: z.boolean(),
    movesExecuted: z.number().int().nonnegative(),
    mergesExecuted: z.number().int().nonnegative(),
    validMoveCount: z.number().int().nonnegative(),
    lastDecision: z.string().nullable(),
    lastReward: z.unknown().nullable(),
    elapsedSeconds: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
  }),
  autoplayDiagnostics: z.unknown().nullable().optional(),
  autoplayRunSummary: z.unknown().nullable().optional(),
  stats: bemergedStatsSchema,
  objective: bemergedObjectiveProgressSchema,
  aiContract: z.object({
    schemaVersion: z.string().min(1),
    governanceSchemaVersion: z.string().min(1),
    mode: bemergedAiBridgeModeSchema,
    strictGuardrails: z.lazy(() => bemergedStrictGuardrailsSchema),
    delayBounds: z.lazy(() => bemergedDelayBoundsSchema),
    goals: z.array(bemergedAiGoalSchema).min(1),
    commands: z.array(bemergedAiBridgeCommandSchema).min(1),
    actions: z.object({
      plannerVisible: z.array(bemergedAiActionTypeSchema).min(1),
      runtimeAllowed: z.array(bemergedAiActionTypeSchema).min(1),
    }),
    invariants: z.array(z.string().min(1)).min(1),
    governanceDrift: z.object({
      ok: z.boolean(),
      issues: z.array(z.object({
        code: z.string().min(1),
        severity: z.enum(['error', 'warning']).optional(),
        message: z.string().min(1),
      })),
    }),
  }),
  aiRuntime: z.object({
    initialized: z.boolean(),
    modelId: z.string().min(1),
    lastError: z.string().nullable(),
    controlSource: z.string().min(1),
    decisionMode: z.string().min(1),
  }),
  engine: z.object({
    seed: z.number().int(),
    elapsedSeconds: z.number().int().nonnegative(),
    stats: bemergedStatsSchema,
    validMoveCount: z.number().int().nonnegative(),
    objective: bemergedObjectiveProgressSchema,
    autoplayCapabilities: bemergedBridgeCapabilitiesSchema,
    board: z.array(z.array(z.object({
      row: z.number().int().nonnegative(),
      col: z.number().int().nonnegative(),
      templateId: z.string().min(1),
      type: z.enum(['Cannon', 'Armor', 'Generator', 'Core']),
      rarity: z.string().min(1),
      plus: z.boolean(),
      matchKey: z.string().min(1),
    }).nullable())),
    autoplay: z.unknown(),
  }),
})

export const bemergedBridgeToPlannerOutputSchema = z.object({
  manifest: z.lazy(() => bemergedAiGovernanceManifestSchema),
  allowedActionTypes: z.array(bemergedAiActionTypeSchema).min(1),
  goal: bemergedAiGoalSchema,
  plannerSeed: z.number().int().nonnegative().optional(),
  objectiveSummary: z.string().min(1),
  statePayload: z.unknown(),
  recentRunSummaries: z.array(z.string()).optional(),
  recentStrategyDelta: z.object({
    avoid_patterns: z.array(z.string()).default([]),
    prefer_patterns: z.array(z.string()).default([]),
    heuristics_to_adjust: z.array(z.string()).default([]),
  }).optional(),
})

const bemergedRuntimeSwapActionSchema = z.object({
  actionId: z.number().int().nonnegative(),
  type: z.literal('swap'),
  fromRow: z.number().int().nonnegative(),
  fromCol: z.number().int().nonnegative(),
  toRow: z.number().int().nonnegative(),
  toCol: z.number().int().nonnegative(),
})

const bemergedRuntimeMergeActionSchema = z.object({
  actionId: z.number().int().nonnegative(),
  type: z.literal('merge'),
  selection: z.array(z.object({
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
  })).min(2),
})

const bemergedRuntimeInventoryActionSchema = z.object({
  actionId: z.number().int().nonnegative(),
  type: z.literal('inventory'),
  cell: z.object({
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
  }),
  slotType: z.enum(['Cannon', 'Armor', 'Generator', 'Core']),
})

const bemergedRuntimeActionSchema = z.union([
  bemergedRuntimeSwapActionSchema,
  bemergedRuntimeMergeActionSchema,
  bemergedRuntimeInventoryActionSchema,
])

const bemergedServerCapabilitiesSchema = z.object({
  contractVersion: z.string().min(1),
  manifestVersion: z.string().min(1),
  governanceSchemaVersion: z.string().min(1),
  mode: bemergedAiBridgeModeSchema,
  delayBounds: z.lazy(() => bemergedDelayBoundsSchema),
  guardrails: z.object({
    noDevTools: z.boolean(),
    testingModeLocked: z.boolean(),
    allowedGoals: z.array(z.string()).min(1),
    deniedGoals: z.array(z.string()),
  }),
  aiGovernance: z.object({
    objectiveModel: z.lazy(() => bemergedObjectiveModelSchema),
    strictGuardrails: z.lazy(() => bemergedStrictGuardrailsSchema),
    commands: z.array(bemergedAiBridgeCommandSchema).min(1),
    goals: z.array(bemergedAiGoalSchema).min(1),
    invariants: z.array(z.string()).min(1),
    actions: z.object({
      plannerVisible: z.array(bemergedAiActionTypeSchema).min(1),
      runtimeAllowed: z.array(z.string()).min(1),
    }),
    adapter: z.object({
      type: z.string().min(1),
      reason: z.string().min(1),
    }),
  }),
}).passthrough()

const bemergedServerSessionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1),
  seed: z.number().int().positive(),
  goal: z.literal('objective-progress'),
  mode: bemergedAiBridgeModeSchema,
  testingMode: z.boolean(),
  validActions: z.array(bemergedRuntimeActionSchema),
  capabilities: bemergedServerCapabilitiesSchema,
})

export const bemergedServerCapabilitiesResponseSchema = z.object({
  ok: z.literal(true),
}).and(bemergedServerCapabilitiesSchema)

export const bemergedServerResetResponseSchema = z.object({
  ok: z.literal(true),
  state: z.unknown(),
  info: z.object({
    turn: z.number().int().nonnegative(),
    objective: z.unknown(),
  }),
}).and(bemergedServerSessionPayloadSchema)

export const bemergedServerValidActionsResponseSchema = z.object({
  ok: z.literal(true),
}).and(bemergedServerSessionPayloadSchema)

export const bemergedServerStepResponseSchema = z.object({
  ok: z.literal(true),
  nextState: z.unknown(),
  reward: z.number().finite(),
  rewardBreakdown: z.object({
    objective: z.number().finite(),
    shards: z.number().finite(),
    time: z.number().finite(),
    risk: z.number().finite(),
    antiLoop: z.number().finite(),
    total: z.number().finite(),
  }),
  done: z.boolean(),
  info: z.object({
    reason: z.enum(['objective-complete', 'max-turns', 'no-valid-actions', 'stagnation', 'invalid-action', 'continue']),
    validActionCount: z.number().int().nonnegative(),
    loopCount: z.number().int().nonnegative(),
    turn: z.number().int().nonnegative(),
  }),
}).and(bemergedServerSessionPayloadSchema)

export const bemergedDelayBoundsSchema = z.object({
  minMs: z.number().int().min(1),
  maxMs: z.number().int().min(1),
}).refine(value => value.minMs <= value.maxMs, {
  message: 'minMs must be <= maxMs',
})

export const bemergedAiBridgePayloadSchema = z.object({
  command: z.string().default('status'),
  delayMs: z.number().int().optional(),
  testingMode: z.boolean().default(false),
  goal: z.string().default('objective-progress'),
  mode: z.string().default('normal'),
})

export const bemergedStrictGuardrailsSchema = z.object({
  allowTestingMode: z.boolean(),
  allowDevControls: z.boolean(),
  allowDevTools: z.boolean(),
  allowParityPatches: z.boolean(),
  allowForcedCheats: z.boolean(),
  swapOnly: z.boolean(),
})

export const bemergedObjectiveModelSchema = z.object({
  id: z.literal('full-24-unique-5star'),
  description: z.string().min(1),
})

export const bemergedContractsSchema = z.object({
  delayBoundsSource: z.literal('manifest.delayBounds'),
  objectiveModelSource: z.literal('manifest.objectiveModel'),
  telemetryRules: z.object({
    emitAttemptCompletionForAllModes: z.literal(true),
    devControlsUsedInAttemptRequiresActualUse: z.literal(true),
    dedupeFields: z.literal(true),
  }),
  progressSemantics: z.object({
    completedTypeCount: z.literal('type-count'),
    completedUniqueMods: z.literal('unique-lines'),
  }),
})

export const bemergedAiGovernanceManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  mode: bemergedAiBridgeModeSchema,
  modes: z.array(bemergedAiModeStateSchema).min(1),
  objectiveModel: bemergedObjectiveModelSchema,
  delayBounds: bemergedDelayBoundsSchema,
  contracts: bemergedContractsSchema,
  goals: z.array(bemergedAiGoalSchema).min(1),
  commands: z.array(bemergedAiBridgeCommandSchema).min(1),
  actions: z.object({
    plannerVisible: z.array(bemergedAiActionTypeSchema).min(1),
    runtimeAllowed: z.array(bemergedAiActionTypeSchema).min(1),
  }),
  devCommands: z.object({
    plannerVisible: z.array(bemergedAiDevCommandSchema),
    runtimeAllowed: z.array(bemergedAiDevCommandSchema),
  }),
  strictGuardrails: bemergedStrictGuardrailsSchema,
  invariants: z.array(z.string().min(1)).min(1),
})

export type BemergedAiBridgeCommand = z.infer<typeof bemergedAiBridgeCommandSchema>
export type BemergedAiBridgeMode = z.infer<typeof bemergedAiBridgeModeSchema>
export type BemergedAiModeState = z.infer<typeof bemergedAiModeStateSchema>
export type BemergedAiActionType = z.infer<typeof bemergedAiActionTypeSchema>
export type BemergedAiDevCommand = z.infer<typeof bemergedAiDevCommandSchema>
export type BemergedAiGoal = z.infer<typeof bemergedAiGoalSchema>
export type BemergedAiBridgePayload = z.infer<typeof bemergedAiBridgePayloadSchema>
export type BemergedAiGovernanceManifest = z.infer<typeof bemergedAiGovernanceManifestSchema>
export type BemergedAiPlannerDecision = z.infer<typeof bemergedAiPlannerDecisionSchema>

export const BEMERGED_AI_GOVERNANCE_MANIFEST_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'bemerged-ai-governance-manifest-v2',
  title: 'BeMerged AI Governance Manifest',
  type: 'object',
  required: ['schemaVersion', 'mode', 'modes', 'objectiveModel', 'delayBounds', 'contracts', 'goals', 'commands', 'actions', 'devCommands', 'strictGuardrails', 'invariants'],
  properties: {
    schemaVersion: { type: 'string', minLength: 1 },
    mode: { enum: [...BEMERGED_AI_BRIDGE_MODE_VALUES] },
    modes: {
      type: 'array',
      minItems: 1,
      items: { enum: [...BEMERGED_AI_MODE_STATE_VALUES] },
    },
    objectiveModel: {
      type: 'object',
      required: ['id', 'description'],
      properties: {
        id: { const: 'full-24-unique-5star' },
        description: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    delayBounds: {
      type: 'object',
      required: ['minMs', 'maxMs'],
      properties: {
        minMs: { type: 'integer', minimum: 1 },
        maxMs: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    contracts: {
      type: 'object',
      required: ['delayBoundsSource', 'objectiveModelSource', 'telemetryRules', 'progressSemantics'],
      properties: {
        delayBoundsSource: { const: 'manifest.delayBounds' },
        objectiveModelSource: { const: 'manifest.objectiveModel' },
        telemetryRules: {
          type: 'object',
          required: ['emitAttemptCompletionForAllModes', 'devControlsUsedInAttemptRequiresActualUse', 'dedupeFields'],
          properties: {
            emitAttemptCompletionForAllModes: { const: true },
            devControlsUsedInAttemptRequiresActualUse: { const: true },
            dedupeFields: { const: true },
          },
          additionalProperties: false,
        },
        progressSemantics: {
          type: 'object',
          required: ['completedTypeCount', 'completedUniqueMods'],
          properties: {
            completedTypeCount: { const: 'type-count' },
            completedUniqueMods: { const: 'unique-lines' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    goals: {
      type: 'array',
      minItems: 1,
      items: { enum: [...BEMERGED_AI_GOAL_VALUES] },
    },
    commands: {
      type: 'array',
      minItems: 1,
      items: { enum: [...BEMERGED_AI_BRIDGE_COMMAND_VALUES] },
    },
    actions: {
      type: 'object',
      required: ['plannerVisible', 'runtimeAllowed'],
      properties: {
        plannerVisible: {
          type: 'array',
          minItems: 1,
          items: { enum: [...BEMERGED_AI_ACTION_TYPE_VALUES] },
        },
        runtimeAllowed: {
          type: 'array',
          minItems: 1,
          items: { enum: [...BEMERGED_AI_ACTION_TYPE_VALUES] },
        },
      },
      additionalProperties: false,
    },
    devCommands: {
      type: 'object',
      required: ['plannerVisible', 'runtimeAllowed'],
      properties: {
        plannerVisible: {
          type: 'array',
          items: { enum: [...BEMERGED_AI_DEV_COMMAND_VALUES] },
        },
        runtimeAllowed: {
          type: 'array',
          items: { enum: [...BEMERGED_AI_DEV_COMMAND_VALUES] },
        },
      },
      additionalProperties: false,
    },
    strictGuardrails: {
      type: 'object',
      required: ['allowTestingMode', 'allowDevControls', 'allowDevTools', 'allowParityPatches', 'allowForcedCheats', 'swapOnly'],
      properties: {
        allowTestingMode: { type: 'boolean' },
        allowDevControls: { type: 'boolean' },
        allowDevTools: { type: 'boolean' },
        allowParityPatches: { type: 'boolean' },
        allowForcedCheats: { type: 'boolean' },
        swapOnly: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    invariants: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
  },
  additionalProperties: false,
} as const

export function parseBemergedAiBridgePayload(input: unknown): BemergedAiBridgePayload {
  if (!input || typeof input !== 'object') {
    return bemergedAiBridgePayloadSchema.parse({})
  }

  const payload = input as Record<string, unknown>
  const delayMs = payload.delayMs == null ? undefined : Number(payload.delayMs)

  return bemergedAiBridgePayloadSchema.parse({
    command: payload.command,
    delayMs: Number.isFinite(delayMs) ? delayMs : undefined,
    testingMode: payload.testingMode === true,
    goal: payload.goal,
    mode: payload.mode,
  })
}

export function validateBemergedAiGovernanceManifest(input: unknown): BemergedAiGovernanceManifest {
  return bemergedAiGovernanceManifestSchema.parse(input)
}

export function validateBemergedAiStateInput(input: unknown): z.infer<typeof bemergedAiStateInputSchema> {
  return bemergedAiStateInputSchema.parse(input)
}

export function validateBemergedAiAllowedActionTypes(input: unknown): z.infer<typeof bemergedAiAllowedActionTypesSchema> {
  return bemergedAiAllowedActionTypesSchema.parse(input)
}

export function validateBemergedAiLegalActionsInput(input: unknown): z.infer<typeof bemergedAiLegalActionsInputSchema> {
  return bemergedAiLegalActionsInputSchema.parse(input)
}

export function validateBemergedAiDevCommandsInput(input: unknown): z.infer<typeof bemergedAiDevCommandsInputSchema> {
  return bemergedAiDevCommandsInputSchema.parse(input)
}

export function parseBemergedAiPlannerDecision(input: unknown): BemergedAiPlannerDecision {
  return bemergedAiPlannerDecisionSchema.parse(input)
}

export function parseBemergedAttemptCompleteTelemetryEvent(input: unknown): z.infer<typeof bemergedAttemptCompleteEventSchema> {
  return bemergedAttemptCompleteEventSchema.parse(input)
}

export function parseBemergedStateTelemetryEvent(input: unknown): z.infer<typeof bemergedStateTelemetryEventSchema> {
  return bemergedStateTelemetryEventSchema.parse(input)
}

export function parseBemergedSceneToBridgePayload(input: unknown): z.infer<typeof bemergedSceneToBridgePayloadSchema> {
  return bemergedSceneToBridgePayloadSchema.parse(input)
}

export function parseBemergedBridgeToPlannerOutput(input: unknown): z.infer<typeof bemergedBridgeToPlannerOutputSchema> {
  return bemergedBridgeToPlannerOutputSchema.parse(input)
}

export function parseBemergedServerCapabilitiesResponse(input: unknown): z.infer<typeof bemergedServerCapabilitiesResponseSchema> {
  return bemergedServerCapabilitiesResponseSchema.parse(input)
}

export function parseBemergedServerResetResponse(input: unknown): z.infer<typeof bemergedServerResetResponseSchema> {
  return bemergedServerResetResponseSchema.parse(input)
}

export function parseBemergedServerValidActionsResponse(input: unknown): z.infer<typeof bemergedServerValidActionsResponseSchema> {
  return bemergedServerValidActionsResponseSchema.parse(input)
}

export function parseBemergedServerStepResponse(input: unknown): z.infer<typeof bemergedServerStepResponseSchema> {
  return bemergedServerStepResponseSchema.parse(input)
}
