import { BemergedHeadlessEnv } from './headlessEnv'
import type { BemergedScenario } from './scenarios'
import { assertHeadlessBoardRendered } from './boardRenderGuard'

export type BemergedEpisodeReplay = {
  seed: number
  scenarioId: string
  goal: string
  startedAtIso: string
  finishedAtIso: string
  doneReason: string
  steps: Array<{
    turn: number
    actionId: number
    reward: number
    rewardBreakdown: {
      objective: number
      shards: number
      time: number
      risk: number
      antiLoop?: number
      total: number
    }
    loopCount: number
  }>
  summary: {
    completionPercent: number
    completedTypeCount: number
    score: number
    moves: number
    merges: number
    shatters: number
  }
}

export type BemergedHarnessAnomaly = {
  type: 'stagnation' | 'loop' | 'score-outlier'
  severity: 'warning' | 'critical'
  episodeIndex: number
  details: string
}

export type BemergedHarnessResult = {
  runs: number
  completionRate: number
  averageScore: number
  averageTurns: number
  anomalies: BemergedHarnessAnomaly[]
  replays: BemergedEpisodeReplay[]
}

export type BemergedPolicy = (context: {
  turn: number
  validActions: Array<{ actionId: number }>
}) => number

export async function runBemergedPlaytestHarness(input: {
  scenario: BemergedScenario
  runs: number
  policy?: BemergedPolicy
}): Promise<BemergedHarnessResult> {
  const runs = Math.max(1, Math.min(5000, Math.floor(Number(input.runs) || 1)))
  const replays: BemergedEpisodeReplay[] = []

  const scores: number[] = []
  const turns: number[] = []
  let completionCount = 0

  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    const env = new BemergedHeadlessEnv({
      scenarioId: input.scenario.id,
      seed: input.scenario.seed + runIndex,
      goal: input.scenario.goal,
      maxTurns: input.scenario.maxTurns,
    })

    const startedAtIso = new Date().toISOString()
    const resetResult = env.reset(input.scenario.seed + runIndex)
    assertHeadlessBoardRendered({
      state: resetResult.state,
      validActions: resetResult.validActions,
      context: `harness run ${runIndex}`,
    })
    let done = false
    let turn = 0
    let doneReason = 'continue'
    const steps: BemergedEpisodeReplay['steps'] = []

    while (!done && turn < input.scenario.maxTurns) {
      const validActions = env.get_valid_actions()
      const actionId = input.policy
        ? input.policy({ turn, validActions })
        : (env.choose_autoplay_action(input.scenario.goal) ?? validActions[0]?.actionId ?? 0)

      const step = env.step(actionId)
      turn += 1
      done = step.done
      doneReason = step.info.reason

      steps.push({
        turn,
        actionId,
        reward: step.reward,
        rewardBreakdown: step.rewardBreakdown,
        loopCount: step.info.loopCount,
      })

      if (done) {
        const completionPercent = step.nextState.meta.objective.completionPercent
        if (step.nextState.meta.objective.objectiveComplete) {
          completionCount += 1
        }

        scores.push(step.nextState.player.score)
        turns.push(turn)

        replays.push({
          seed: input.scenario.seed + runIndex,
          scenarioId: input.scenario.id,
          goal: input.scenario.goal,
          startedAtIso,
          finishedAtIso: new Date().toISOString(),
          doneReason,
          steps,
          summary: {
            completionPercent,
            completedTypeCount: step.nextState.meta.objective.completedTypeCount,
            score: step.nextState.player.score,
            moves: step.nextState.player.moves,
            merges: step.nextState.player.merges,
            shatters: step.nextState.player.shatters,
          },
        })
      }
    }

    env.dispose()
  }

  const averageScore = scores.length > 0
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    : 0
  const averageTurns = turns.length > 0
    ? Math.round(turns.reduce((sum, value) => sum + value, 0) / turns.length)
    : 0

  const anomalies: BemergedHarnessAnomaly[] = []
  const scoreThreshold = averageScore > 0 ? averageScore * 2.5 : Number.POSITIVE_INFINITY

  replays.forEach((replay, episodeIndex) => {
    const maxLoopCount = replay.steps.reduce((max, step) => Math.max(max, step.loopCount), 0)
    if (replay.doneReason === 'stagnation') {
      anomalies.push({
        type: 'stagnation',
        severity: 'warning',
        episodeIndex,
        details: 'Episode terminated due to no-progress turn limit.',
      })
    }

    if (maxLoopCount >= 3) {
      anomalies.push({
        type: 'loop',
        severity: maxLoopCount >= 6 ? 'critical' : 'warning',
        episodeIndex,
        details: `Detected repeated board states (max loop count ${maxLoopCount}).`,
      })
    }

    if (replay.summary.score > scoreThreshold) {
      anomalies.push({
        type: 'score-outlier',
        severity: 'critical',
        episodeIndex,
        details: `Score ${replay.summary.score} exceeded outlier threshold ${Math.round(scoreThreshold)}.`,
      })
    }
  })

  return {
    runs,
    completionRate: runs > 0 ? Math.round((completionCount / runs) * 100) : 0,
    averageScore,
    averageTurns,
    anomalies,
    replays,
  }
}

export function exportBemergedReplayAsJson(replay: BemergedEpisodeReplay): string {
  return JSON.stringify(
    {
      replayFormatVersion: 'bemerged-replay-v1',
      ...replay,
    },
    null,
    2,
  )
}
