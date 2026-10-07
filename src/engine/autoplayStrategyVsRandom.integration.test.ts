import { describe, expect, it } from 'vitest'
import { BemergedHeadlessEnv } from './headlessEnv'

type EpisodeSummary = {
  completion: number
  score: number
  merges: number
  moves: number
  inventoryOrMergeChoices: number
}

function seededNext(seed: number): number {
  let value = seed >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

function runEpisode(options: {
  seed: number
  maxTurns: number
  policy: 'autoplay' | 'random'
}): EpisodeSummary {
  const env = new BemergedHeadlessEnv({
    scenarioId: 'objective-default',
    seed: options.seed,
    goal: 'objective-progress',
    maxTurns: options.maxTurns,
  })

  const reset = env.reset(options.seed)
  let state = reset.state
  let done = false
  let turn = 0
  let randomSeed = options.seed
  let inventoryOrMergeChoices = 0

  while (!done && turn < options.maxTurns) {
    const validActions = env.get_valid_actions()
    if (validActions.length === 0) break

    let chosenActionId: number | null = null
    if (options.policy === 'autoplay') {
      chosenActionId = env.choose_autoplay_action('objective-progress')
      if (chosenActionId == null) break
    } else {
      randomSeed = seededNext(randomSeed + turn)
      const index = randomSeed % validActions.length
      chosenActionId = validActions[index]?.actionId ?? null
      if (chosenActionId == null) break
    }

    const chosen = validActions.find(action => action.actionId === chosenActionId)
    if (chosen && (chosen.type === 'merge' || chosen.type === 'inventory')) {
      inventoryOrMergeChoices += 1
    }

    const step = env.step(chosenActionId)
    state = step.nextState
    done = step.done
    turn += 1
  }

  const summary: EpisodeSummary = {
    completion: state.meta.objective.completionPercent,
    score: state.player.score,
    merges: state.player.merges,
    moves: state.player.moves,
    inventoryOrMergeChoices,
  }

  env.dispose()
  return summary
}

describe('BeMerged autoplay strategy vs random baseline', () => {
  it('shows objective-directed strategy better than random legal play', () => {
    const episodes = 1
    const maxTurns = 60

    const autoplaySummaries: EpisodeSummary[] = []
    const randomSummaries: EpisodeSummary[] = []

    for (let i = 0; i < episodes; i += 1) {
      const seed = 50000 + i
      autoplaySummaries.push(runEpisode({ seed, maxTurns, policy: 'autoplay' }))
      randomSummaries.push(runEpisode({ seed, maxTurns, policy: 'random' }))
    }

    const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)

    const autoplay = {
      completion: avg(autoplaySummaries.map(item => item.completion)),
      score: avg(autoplaySummaries.map(item => item.score)),
      merges: avg(autoplaySummaries.map(item => item.merges)),
      moves: avg(autoplaySummaries.map(item => item.moves)),
      intent: avg(autoplaySummaries.map(item => item.inventoryOrMergeChoices)),
    }

    const random = {
      completion: avg(randomSummaries.map(item => item.completion)),
      score: avg(randomSummaries.map(item => item.score)),
      merges: avg(randomSummaries.map(item => item.merges)),
      moves: avg(randomSummaries.map(item => item.moves)),
      intent: avg(randomSummaries.map(item => item.inventoryOrMergeChoices)),
    }

    console.log('[bemerged-strategy-vs-random]', JSON.stringify({ episodes, maxTurns, autoplay, random }))

    expect(autoplay.intent).toBeGreaterThan(random.intent)
    expect(autoplay.score).toBeGreaterThan(random.score)
  }, 20000)
})
