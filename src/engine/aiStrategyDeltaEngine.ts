import { z } from 'zod'
import { autoplayRunSummarySchema } from './autoplayIntentSchema'

export const bemergedRunSummarySchema = z.object({
  contractVersion: z.string().default('bemerged-run-summary-v2'),
  finalScore: z.number().default(0),
  turns: z.number().int().nonnegative().default(0),
  deathReason: z.string().default('none'),
  endgameState: z.string().default('unknown'),
  bugsDetected: z.array(z.string()).default([]),
  strategyDelta: z.object({
    avoid_patterns: z.array(z.string()).default([]),
    prefer_patterns: z.array(z.string()).default([]),
    new_tests: z.array(z.string()).default([]),
    discovered_bugs: z.array(z.string()).default([]),
    heuristics_to_adjust: z.array(z.string()).default([]),
  }).default({
    avoid_patterns: [],
    prefer_patterns: [],
    new_tests: [],
    discovered_bugs: [],
    heuristics_to_adjust: [],
  }),
  executed: z.boolean(),
  stepEvents: z.number().int().nonnegative().default(0),
  totalReward: z.number().default(0),
  dominantReason: z.string().default('none'),
  maxLoopCountObserved: z.number().int().nonnegative().default(0),
  objectiveCompletionPercent: z.number().min(0).max(100).default(0),
  seed: z.number().int().nonnegative(),
})

export const bemergedStrategyDeltaSchema = z.object({
  contractVersion: z.literal('bemerged-strategy-delta-v2'),
  avoid_patterns: z.array(z.string()).default([]),
  prefer_patterns: z.array(z.string()).default([]),
  new_tests: z.array(z.string()).default([]),
  discovered_bugs: z.array(z.string()).default([]),
  heuristics_to_adjust: z.array(z.string()).default([]),
})

export type BemergedRunSummary = z.infer<typeof bemergedRunSummarySchema>
export type BemergedStrategyDelta = z.infer<typeof bemergedStrategyDeltaSchema>

function unique(items: ReadonlyArray<string>): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)))
}

export function extractBemergedStrategyDelta(input: {
  current: unknown
  previous: ReadonlyArray<unknown>
}): BemergedStrategyDelta {
  const current = bemergedRunSummarySchema.parse(input.current)
  const previous = input.previous.map(item => bemergedRunSummarySchema.parse(item))
  const historicalMeanReward = previous.length > 0
    ? previous.reduce((sum, summary) => sum + summary.totalReward, 0) / previous.length
    : 0

  const avoidPatterns: string[] = []
  const preferPatterns: string[] = []
  const newTests: string[] = []
  const discoveredBugs: string[] = []
  const heuristicsToAdjust: string[] = []

  if (current.maxLoopCountObserved >= 3) {
    avoidPatterns.push('loop-prone-action-cycles')
    heuristicsToAdjust.push('increase-loop-penalty-weight')
    newTests.push('loop-pressure-regression')
  }

  if (current.totalReward < historicalMeanReward) {
    avoidPatterns.push('low-reward-greedy-branch')
    heuristicsToAdjust.push('rebalance-objective-vs-shard-priority')
  } else {
    preferPatterns.push('current-policy-baseline')
  }

  if (current.dominantReason === 'stagnation' || current.dominantReason === 'no-valid-actions') {
    avoidPatterns.push(`dominant-reason:${current.dominantReason}`)
    newTests.push('stagnation-recovery-suite')
  }

  if (current.objectiveCompletionPercent < 100) {
    heuristicsToAdjust.push('increase-objective-completion-pressure')
  }

  if (current.executed && current.stepEvents === 0) {
    discoveredBugs.push('executed-with-zero-step-events')
    newTests.push('execution-step-event-contract')
  }

  if (Array.isArray(current.bugsDetected) && current.bugsDetected.length > 0) {
    discoveredBugs.push(...current.bugsDetected.map(item => `run-bug:${String(item || '').trim()}`).filter(Boolean))
    newTests.push('run-summary-bug-regression')
  }

  return bemergedStrategyDeltaSchema.parse({
    contractVersion: 'bemerged-strategy-delta-v2',
    avoid_patterns: unique(avoidPatterns),
    prefer_patterns: unique(preferPatterns),
    new_tests: unique(newTests),
    discovered_bugs: unique(discoveredBugs),
    heuristics_to_adjust: unique(heuristicsToAdjust),
  })
}

export function mergeBemergedStrategyDeltas(deltas: ReadonlyArray<unknown>): BemergedStrategyDelta {
  const parsed = deltas.map(delta => bemergedStrategyDeltaSchema.parse(delta))
  return bemergedStrategyDeltaSchema.parse({
    contractVersion: 'bemerged-strategy-delta-v2',
    avoid_patterns: unique(parsed.flatMap(delta => delta.avoid_patterns)),
    prefer_patterns: unique(parsed.flatMap(delta => delta.prefer_patterns)),
    new_tests: unique(parsed.flatMap(delta => delta.new_tests)),
    discovered_bugs: unique(parsed.flatMap(delta => delta.discovered_bugs)),
    heuristics_to_adjust: unique(parsed.flatMap(delta => delta.heuristics_to_adjust)),
  })
}

export function pruneBemergedStrategyDelta(deltaInput: unknown, maxItemsPerBucket = 12): BemergedStrategyDelta {
  const delta = bemergedStrategyDeltaSchema.parse(deltaInput)
  const limit = Math.max(1, Math.floor(maxItemsPerBucket))

  return bemergedStrategyDeltaSchema.parse({
    contractVersion: 'bemerged-strategy-delta-v2',
    avoid_patterns: delta.avoid_patterns.slice(0, limit),
    prefer_patterns: delta.prefer_patterns.slice(0, limit),
    new_tests: delta.new_tests.slice(0, limit),
    discovered_bugs: delta.discovered_bugs.slice(0, limit),
    heuristics_to_adjust: delta.heuristics_to_adjust.slice(0, limit),
  })
}

export function extractBemergedStrategyDeltaFromAutoplaySummary(input: {
  current: unknown
  previous: ReadonlyArray<unknown>
}): BemergedStrategyDelta {
  const current = autoplayRunSummarySchema.parse(input.current)
  const previous = input.previous.map(item => autoplayRunSummarySchema.parse(item))

  const averageMoveTimeMs = previous.length > 0
    ? previous.reduce((sum, summary) => sum + summary.avgTimePerMoveMs, 0) / previous.length
    : current.avgTimePerMoveMs

  const avoidPatterns: string[] = []
  const preferPatterns: string[] = []
  const newTests: string[] = []
  const discoveredBugs: string[] = []
  const heuristicsToAdjust: string[] = []

  if (current.indecisionTimeoutEvents > 0) {
    avoidPatterns.push('decision-timeout-branches')
    heuristicsToAdjust.push('tighten-search-width-under-time-pressure')
    newTests.push('timeout-restart-policy-regression')
  }

  if (current.forcedRestarts > 0) {
    preferPatterns.push('short-episode-recovery-policy')
    heuristicsToAdjust.push('improve-first-pass-candidate-prioritization')
  }

  if (current.avgTimePerMoveMs > averageMoveTimeMs * 1.2) {
    avoidPatterns.push('late-run-analysis-paralysis')
    heuristicsToAdjust.push('reduce-expanded-candidate-limit')
  }

  if (current.mistakes.missedObviousMerge > 0) {
    heuristicsToAdjust.push('increase-merge-priority-weight')
    newTests.push('obvious-merge-selection-suite')
  }

  if (current.mistakes.ignoredBossThreat > 0 || current.mistakes.ignoredMineThreat > 0) {
    heuristicsToAdjust.push('increase-hazard-penalty-weight')
    newTests.push('hazard-response-priority-suite')
  }

  if (current.terminationReason.includes('timeout')) {
    discoveredBugs.push('run-terminated-by-timeout-policy')
  }

  return bemergedStrategyDeltaSchema.parse({
    contractVersion: 'bemerged-strategy-delta-v2',
    avoid_patterns: unique(avoidPatterns),
    prefer_patterns: unique(preferPatterns),
    new_tests: unique(newTests),
    discovered_bugs: unique(discoveredBugs),
    heuristics_to_adjust: unique(heuristicsToAdjust),
  })
}
