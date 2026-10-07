import type { ModelDrivenAutoplayOutcome } from './Match3Scene'
import {
  type BemergedStrategyDelta,
  bemergedStrategyDeltaSchema,
  mergeBemergedStrategyDeltas,
  pruneBemergedStrategyDelta,
} from './aiStrategyDeltaEngine'

export const EMPTY_BEMERGED_STRATEGY_DELTA: BemergedStrategyDelta = {
  contractVersion: 'bemerged-strategy-delta-v2',
  avoid_patterns: [],
  prefer_patterns: [],
  new_tests: [],
  discovered_bugs: [],
  heuristics_to_adjust: [],
}

export type AutoplayLearningMemoryState = {
  recentDeltas: BemergedStrategyDelta[]
  cleanLessons: BemergedStrategyDelta
}

function unique(items: ReadonlyArray<string>): string[] {
  return Array.from(new Set(items.map(item => String(item || '').trim()).filter(Boolean)))
}

export function buildStrategyDeltaFromOutcome(outcome: ModelDrivenAutoplayOutcome): BemergedStrategyDelta {
  const avoidPatterns: string[] = []
  const preferPatterns: string[] = []
  const newTests: string[] = []
  const discoveredBugs: string[] = []
  const heuristicsToAdjust: string[] = []

  const rewardTotal = Number(outcome.reward?.total || 0)
  if (rewardTotal > 0) {
    preferPatterns.push(`reward-positive:${outcome.actionType}`)
  } else if (rewardTotal < 0) {
    avoidPatterns.push(`reward-negative:${outcome.actionType}`)
    heuristicsToAdjust.push('rebalance-risk-and-objective-weights')
  }

  if (!outcome.moved) {
    avoidPatterns.push(`stalled-action:${outcome.actionType}`)
    heuristicsToAdjust.push('increase-stall-penalty')
  }

  if (outcome.lastError) {
    const normalizedError = String(outcome.lastError || '').trim().slice(0, 64)
    if (normalizedError) {
      const seedSuffix = Number.isFinite(Number(outcome.seed))
        ? `:seed-${Math.floor(Number(outcome.seed))}`
        : ''
      discoveredBugs.push(`runtime-error:${normalizedError}${seedSuffix}`)
      avoidPatterns.push('runtime-error-branch')
      newTests.push('runtime-error-replay-suite')
    }
  }

  if (outcome.reason && String(outcome.reason).toLowerCase().includes('loop')) {
    avoidPatterns.push('loop-prone-action-cycles')
    heuristicsToAdjust.push('increase-loop-penalty-weight')
    newTests.push('loop-pressure-regression')
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

export function updateAutoplayLearningMemory(input: {
  current: AutoplayLearningMemoryState
  incomingDeltas: ReadonlyArray<unknown>
  maxRecentDeltas?: number
  maxItemsPerBucket?: number
}): AutoplayLearningMemoryState {
  const maxRecentDeltas = Math.max(1, Math.floor(Number(input.maxRecentDeltas) || 8))
  const maxItemsPerBucket = Math.max(1, Math.floor(Number(input.maxItemsPerBucket) || 8))

  const currentRecent = Array.isArray(input.current.recentDeltas)
    ? input.current.recentDeltas.map(item => bemergedStrategyDeltaSchema.parse(item))
    : []
  const incoming = Array.isArray(input.incomingDeltas)
    ? input.incomingDeltas.map(item => bemergedStrategyDeltaSchema.parse(item))
    : []

  const recentDeltas = [...currentRecent, ...incoming].slice(-maxRecentDeltas)
  const cleanLessons = pruneBemergedStrategyDelta(
    mergeBemergedStrategyDeltas(recentDeltas),
    maxItemsPerBucket,
  )

  return {
    recentDeltas,
    cleanLessons,
  }
}
