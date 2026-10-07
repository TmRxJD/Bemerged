import { describe, expect, it } from 'vitest'
import { BemergedHeadlessEnv } from './headlessEnv'

describe('ScriptedPlayEngine determinism', () => {
  it('replays scripted autoplay deterministically for same seed', () => {
    const runScriptedEpisode = () => {
      const env = new BemergedHeadlessEnv({ scenarioId: 'objective-default', seed: 24680, maxTurns: 18, goal: 'objective-progress' })
      env.reset(24680)
      const trace: Array<{ actionId: number | null; reason: string; reward: number }> = []

      for (let turn = 0; turn < 12; turn += 1) {
        const actionId = env.choose_autoplay_action('objective-progress')
        if (actionId === null) {
          trace.push({ actionId: null, reason: 'no-action', reward: 0 })
          break
        }
        const step = env.step(actionId)
        trace.push({
          actionId,
          reason: step.info.reason,
          reward: step.reward,
        })
        if (step.done) break
      }

      env.dispose()
      return trace
    }

    const first = runScriptedEpisode()
    const second = runScriptedEpisode()

    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(0)
  }, 20000)
})
