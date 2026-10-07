import { z } from 'zod'
import { bemergedAiGovernanceManifestSchema } from './aiGovernanceSchema'

const promptScaffoldInputSchema = z.object({
  manifest: bemergedAiGovernanceManifestSchema,
  allowedActionTypes: z.array(z.string()).min(1),
  goal: z.string().min(1),
  plannerSeed: z.number().int().nonnegative().optional(),
  objectiveSummary: z.string().min(1),
  statePayload: z.unknown(),
  recentRunSummaries: z.array(z.string()).optional(),
  recentStrategyDelta: z.object({
    avoid_patterns: z.array(z.string()).default([]),
    prefer_patterns: z.array(z.string()).default([]),
    heuristics_to_adjust: z.array(z.string()).default([]),
  }).optional(),
  cloudLearning: z.object({
    baselineVersion: z.string().min(1),
    mergePolicy: z.string().min(1),
    patternsToAvoid: z.array(z.string()).default([]),
    recommendedSearchWidths: z.object({
      maxSwapCandidates: z.number().int().positive(),
      expandedSwapCandidates: z.number().int().positive(),
      decisionTimeoutMs: z.number().int().positive(),
      adaptiveExpansion: z.boolean(),
      restartOnDecisionTimeout: z.boolean(),
      decisionTimeoutRestartStreak: z.number().int().positive(),
    }),
  }).optional(),
})

export type BemergedPromptScaffoldInput = z.infer<typeof promptScaffoldInputSchema>

function buildOutputSchema(allowedActionTypes: readonly string[]): Record<string, unknown> {
  const bounded = Array.from(new Set(allowedActionTypes.map(item => String(item).trim()).filter(Boolean)))

  return {
    type: 'object',
    additionalProperties: false,
    required: ['actionType', 'reason'],
    properties: {
      actionType: {
        type: 'string',
        enum: bounded,
      },
      moveIndex: { type: 'integer', minimum: 0 },
      bossPlanIndex: { type: 'integer', minimum: 0 },
      minePlanIndex: { type: 'integer', minimum: 0 },
      reason: {
        type: 'string',
        minLength: 1,
        maxLength: 120,
      },
    },
  }
}

export function buildBemergedGovernedPlannerPrompt(input: BemergedPromptScaffoldInput): string {
  const parsed = promptScaffoldInputSchema.parse(input)
  const manifestPlannerAllowed = parsed.manifest.actions.plannerVisible
  const filteredAllowedActionTypes = parsed.allowedActionTypes.filter(action => manifestPlannerAllowed.some(allowed => allowed === action))
  const governedAllowedActionTypes = parsed.manifest.strictGuardrails.swapOnly
    ? ['swap']
    : filteredAllowedActionTypes.length > 0
      ? filteredAllowedActionTypes
      : [...manifestPlannerAllowed]

  const lines = [
    '<governed_planner_context>',
    `  <schema_version>${parsed.manifest.schemaVersion}</schema_version>`,
    `  <mode>${parsed.manifest.mode}</mode>`,
    `  <goal>${parsed.goal}</goal>`,
    `  <seed>${String(Number.isFinite(Number(parsed.plannerSeed)) ? Math.floor(Number(parsed.plannerSeed)) : 0)}</seed>`,
    `  <objective>${parsed.objectiveSummary}</objective>`,
    `  <allowed_action_types>${governedAllowedActionTypes.join(', ')}</allowed_action_types>`,
    '  <capability_set>',
    `    <goals>${parsed.manifest.goals.join(', ')}</goals>`,
    `    <commands>${parsed.manifest.commands.join(', ')}</commands>`,
    `    <planner_visible_actions>${parsed.manifest.actions.plannerVisible.join(', ')}</planner_visible_actions>`,
    `    <runtime_allowed_actions>${parsed.manifest.actions.runtimeAllowed.join(', ')}</runtime_allowed_actions>`,
    `    <dev_commands_visible>${parsed.manifest.devCommands.plannerVisible.join(', ')}</dev_commands_visible>`,
    `    <dev_commands_runtime>${parsed.manifest.devCommands.runtimeAllowed.join(', ')}</dev_commands_runtime>`,
    '  </capability_set>',
    '  <guardrails>',
    `    <delay_bounds min_ms="${String(parsed.manifest.delayBounds.minMs)}" max_ms="${String(parsed.manifest.delayBounds.maxMs)}" />`,
    `    <allow_testing_mode>${String(parsed.manifest.strictGuardrails.allowTestingMode)}</allow_testing_mode>`,
    `    <allow_dev_controls>${String(parsed.manifest.strictGuardrails.allowDevControls)}</allow_dev_controls>`,
    `    <swap_only>${String(parsed.manifest.strictGuardrails.swapOnly)}</swap_only>`,
    '  </guardrails>',
    '  <run_policy>',
    '    <rule>Prefer many short, fast runs over a single long run when uncertainty is high.</rule>',
    '    <rule>If confidence is low, choose the best legal action quickly instead of over-searching.</rule>',
    '    <rule>Decision timeout handling and forced restarts are managed by runtime policy; do not stall planning output.</rule>',
    '    <rule>Learning is evaluated primarily across run summaries and strategy deltas.</rule>',
    '  </run_policy>',
    '  <invariants>',
    ...parsed.manifest.invariants.map(invariant => `    <rule>${invariant}</rule>`),
    '  </invariants>',
    '  <test_objective>',
    `    <objective_model_id>${parsed.manifest.objectiveModel.id}</objective_model_id>`,
    `    <objective_model_description>${parsed.manifest.objectiveModel.description}</objective_model_description>`,
    `    <objective_summary>${parsed.objectiveSummary}</objective_summary>`,
    '  </test_objective>',
    '  <last_run_summaries>',
    ...((parsed.recentRunSummaries || []).slice(-6).map(summary => `    <summary>${summary}</summary>`)),
    '  </last_run_summaries>',
    '  <strategy_delta>',
    ...((parsed.recentStrategyDelta?.avoid_patterns || []).map(pattern => `    <avoid>${pattern}</avoid>`)),
    ...((parsed.recentStrategyDelta?.prefer_patterns || []).map(pattern => `    <prefer>${pattern}</prefer>`)),
    ...((parsed.recentStrategyDelta?.heuristics_to_adjust || []).map(pattern => `    <adjust>${pattern}</adjust>`)),
    '  </strategy_delta>',
    '  <cloud_learning>',
    `    <baseline_version>${parsed.cloudLearning?.baselineVersion || 'none'}</baseline_version>`,
    `    <merge_policy>${parsed.cloudLearning?.mergePolicy || 'local_plus_global_baseline'}</merge_policy>`,
    ...((parsed.cloudLearning?.patternsToAvoid || []).map(pattern => `    <avoid>${pattern}</avoid>`)),
    `    <recommended_search_widths>${JSON.stringify(parsed.cloudLearning?.recommendedSearchWidths || null)}</recommended_search_widths>`,
    '  </cloud_learning>',
    '  <output_schema_json>',
    JSON.stringify(buildOutputSchema(governedAllowedActionTypes)),
    '  </output_schema_json>',
    '  <state_payload_json>',
    JSON.stringify(parsed.statePayload),
    '  </state_payload_json>',
    '</governed_planner_context>',
    'Return ONLY compact JSON matching output_contract with no prose or markdown.',
  ]

  return lines.join('\n')
}
