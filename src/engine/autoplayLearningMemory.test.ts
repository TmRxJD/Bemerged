import { describe, expect, it } from 'vitest'
import type { ModelDrivenAutoplayOutcome } from './Match3Scene'
import {
  buildStrategyDeltaFromOutcome,
  EMPTY_BEMERGED_STRATEGY_DELTA,
  updateAutoplayLearningMemory,
} from './autoplayLearningMemory'

function makeOutcome(overrides: Partial<ModelDrivenAutoplayOutcome> = {}): ModelDrivenAutoplayOutcome {
  return {
    actionType: 'swap',
    moved: true,
    merged: false,
    reason: 'normal-step',
    reward: {
      objective: 0,
      shards: 0,
      time: 0,
      risk: 0,
      total: 0,
    },
    elapsedSeconds: 10,
    ...overrides,
  }
}

describe('autoplayLearningMemory', () => {
  it('derives strategy delta buckets from risky outcome signals', () => {
    const delta = buildStrategyDeltaFromOutcome(makeOutcome({
      actionType: 'mine-shatter',
      moved: false,
      reason: 'loop-detected-near-mine',
      reward: {
        objective: -1,
        shards: 0,
        time: -1,
        risk: -2,
        total: -4,
      },
      seed: 1337,
      lastError: 'illegal mine branch',
    }))

    expect(delta.avoid_patterns).toContain('stalled-action:mine-shatter')
    expect(delta.avoid_patterns).toContain('runtime-error-branch')
    expect(delta.avoid_patterns).toContain('loop-prone-action-cycles')
    expect(delta.new_tests).toContain('runtime-error-replay-suite')
    expect(delta.heuristics_to_adjust).toContain('increase-loop-penalty-weight')
    expect(delta.discovered_bugs.some(item => item.includes('illegal mine branch'))).toBe(true)
    expect(delta.discovered_bugs.some(item => item.includes('seed-1337'))).toBe(true)
  })

  it('merges and prunes memory into clean lessons for planner context', () => {
    const memory = updateAutoplayLearningMemory({
      current: {
        recentDeltas: [],
        cleanLessons: { ...EMPTY_BEMERGED_STRATEGY_DELTA },
      },
      incomingDeltas: [
        {
          contractVersion: 'bemerged-strategy-delta-v2',
          avoid_patterns: ['a1', 'a2', 'a3'],
          prefer_patterns: ['p1'],
          new_tests: [],
          discovered_bugs: [],
          heuristics_to_adjust: ['h1', 'h2', 'h3'],
        },
        {
          contractVersion: 'bemerged-strategy-delta-v2',
          avoid_patterns: ['a2', 'a4'],
          prefer_patterns: ['p2', 'p3'],
          new_tests: [],
          discovered_bugs: [],
          heuristics_to_adjust: ['h4'],
        },
      ],
      maxRecentDeltas: 1,
      maxItemsPerBucket: 2,
    })

    expect(memory.recentDeltas).toHaveLength(1)
    expect(memory.cleanLessons.contractVersion).toBe('bemerged-strategy-delta-v2')
    expect(memory.cleanLessons.avoid_patterns.length).toBeLessThanOrEqual(2)
    expect(memory.cleanLessons.prefer_patterns.length).toBeLessThanOrEqual(2)
    expect(memory.cleanLessons.heuristics_to_adjust.length).toBeLessThanOrEqual(2)
  })
})
