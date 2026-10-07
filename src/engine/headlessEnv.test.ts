import { describe, expect, it } from 'vitest'
import { BemergedHeadlessEnv } from './headlessEnv'
import { BEMERGED_SCENARIOS } from './scenarios'
import { exportBemergedReplayAsJson, runBemergedPlaytestHarness } from './playtestHarness'

describe('BemergedHeadlessEnv', () => {
  it('supports gym-like reset/step/get_valid_actions flow', () => {
    const env = new BemergedHeadlessEnv({ scenarioId: 'objective-default', seed: 1234, maxTurns: 20 })
    const reset = env.reset(1234)
    expect(reset.state.board.length).toBeGreaterThan(0)

    const actions = env.get_valid_actions()
    expect(actions.length).toBeGreaterThan(0)

    const step = env.step(actions[0].actionId)
    expect(typeof step.reward).toBe('number')
    expect(step.nextState.meta.turn).toBe(1)
    expect(step.rewardBreakdown.total).toBe(step.reward)

    env.dispose()
  })

  it('flags invalid action ids deterministically', () => {
    const env = new BemergedHeadlessEnv({ scenarioId: 'objective-default', seed: 5678, maxTurns: 5 })
    env.reset(5678)
    const step = env.step(999999)
    expect(step.info.reason).toBe('invalid-action')
    expect(step.reward).toBeLessThan(0)
    env.dispose()
  })

  it('applies increasing penalty when stalling with no valid action', () => {
    const env = new BemergedHeadlessEnv({ scenarioId: 'objective-default', seed: 5678, maxTurns: 5 })
    env.reset(5678)

    const first = env.step(999999)
    const second = env.step(999999)

    expect(first.info.reason).toBe('invalid-action')
    expect(second.info.reason).toBe('invalid-action')
    expect(second.reward).toBeLessThan(first.reward)
    expect(second.info.turn).toBe(first.info.turn + 1)

    env.dispose()
  })

  it('selects a valid autoplay action id for the configured goal', () => {
    const env = new BemergedHeadlessEnv({ scenarioId: 'objective-default', seed: 31415, maxTurns: 20, goal: 'objective-progress' })
    env.reset(31415)
    const actionId = env.choose_autoplay_action()
    const validActions = env.get_valid_actions()

    expect(actionId).not.toBeNull()
    expect(validActions.some(action => action.actionId === actionId)).toBe(true)

    env.dispose()
  })

})

describe('Bemerged playtest harness', () => {
  it('runs multi-attempt harness and returns replay export format', async () => {
    const scenario = {
      ...BEMERGED_SCENARIOS[0],
      maxTurns: Math.min(BEMERGED_SCENARIOS[0]?.maxTurns ?? 40, 40),
    }
    const report = await runBemergedPlaytestHarness({
      scenario,
      runs: 1,
    })

    expect(report.runs).toBe(1)
    expect(report.replays.length).toBe(1)
    expect(typeof report.completionRate).toBe('number')

    const serialized = exportBemergedReplayAsJson(report.replays[0])
    expect(serialized.includes('bemerged-replay-v1')).toBe(true)
  }, 30000)
})
