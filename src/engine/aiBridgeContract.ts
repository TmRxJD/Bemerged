import type { AutoplayGoal } from './types'
import {
  BEMERGED_AI_COMMANDS,
  BEMERGED_AI_GOALS,
  createBemergedAiGovernanceManifest,
} from './aiGovernanceManifest'
import { createBridgeGovernanceAdapter } from './aiGovernanceAdapters'
import { parseBemergedAiBridgePayload } from './aiGovernanceSchema'

export type BemergedAiBridgeCommand = 'start' | 'stop' | 'status' | 'snapshot' | 'step'
export type BemergedAiBridgeMode = 'normal' | 'dev'

export type BemergedAiBridgeErrorCode =
  | 'unknown-command'
  | 'unsupported-goal'
  | 'guardrail-testing-mode-blocked'
  | 'dev-mode-required'
  | 'invalid-request'

const COMMANDS: ReadonlyArray<BemergedAiBridgeCommand> = BEMERGED_AI_COMMANDS

const GOALS: ReadonlyArray<AutoplayGoal> = BEMERGED_AI_GOALS

export const BEMERGED_AI_BRIDGE_SCHEMA_VERSION = 'bemerged-ai-bridge-v1'

export type BemergedAiBridgePayload = {
  command?: unknown
  delayMs?: unknown
  testingMode?: unknown
  goal?: unknown
  mode?: unknown
}

export type BemergedAiBridgeValidation =
  | {
    ok: true
    command: BemergedAiBridgeCommand
    goal: AutoplayGoal
    delayMs: number | undefined
    testingMode: boolean
    mode: BemergedAiBridgeMode
  }
  | {
    ok: false
    code: BemergedAiBridgeErrorCode
    message: string
  }

function isCommand(value: string): value is BemergedAiBridgeCommand {
  return COMMANDS.includes(value as BemergedAiBridgeCommand)
}

function isGoal(value: string): value is AutoplayGoal {
  return GOALS.includes(value as AutoplayGoal)
}

function parseMode(value: unknown): BemergedAiBridgeMode {
  const mode = String(value ?? 'normal').trim().toLowerCase()
  return mode === 'dev' ? 'dev' : 'normal'
}

export function getBemergedAiBridgeGoals(): ReadonlyArray<AutoplayGoal> {
  return GOALS
}

export function getBemergedAiBridgeCommands(): ReadonlyArray<BemergedAiBridgeCommand> {
  return COMMANDS
}

export function validateBemergedAiBridgePayload(payload: BemergedAiBridgePayload | null | undefined): BemergedAiBridgeValidation {
  const parsedPayload = parseBemergedAiBridgePayload(payload)
  const mode = parseMode(parsedPayload.mode)
  const requestedTestingMode = parsedPayload.testingMode === true

  if (requestedTestingMode && mode !== 'dev') {
    return {
      ok: false,
      code: 'guardrail-testing-mode-blocked',
      message: 'Guardrail violation: testing mode is only available in dev mode.',
    }
  }

  const rawCommand = String(parsedPayload.command ?? 'status').trim().toLowerCase()
  if (!isCommand(rawCommand)) {
    return {
      ok: false,
      code: 'unknown-command',
      message: `Unknown BeMerged AI command: ${rawCommand}`,
    }
  }

  const hasGoal = parsedPayload.goal !== undefined && parsedPayload.goal !== null && String(parsedPayload.goal).trim().length > 0
  const rawGoal = hasGoal ? String(parsedPayload.goal).trim().toLowerCase() : 'objective-progress'
  if (!isGoal(rawGoal)) {
    return {
      ok: false,
      code: 'unsupported-goal',
      message: `Unsupported BeMerged AI goal: ${rawGoal}`,
    }
  }

  const governance = createBemergedAiGovernanceManifest({ mode, aiDevControlsEnabled: mode === 'dev' })
  const adapter = createBridgeGovernanceAdapter(governance)
  const governedPayload = adapter.parseAndClampPayload({
    command: rawCommand,
    goal: rawGoal,
    delayMs: parsedPayload.delayMs,
    mode,
    testingMode: requestedTestingMode,
  })

  return {
    ok: true,
    command: rawCommand,
    goal: rawGoal,
    delayMs: governedPayload.delayMs,
    testingMode: governedPayload.testingMode,
    mode,
  }
}
