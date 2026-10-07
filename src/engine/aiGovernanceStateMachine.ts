import { z } from 'zod'
import { bemergedAiModeStateSchema, type BemergedAiModeState } from './aiGovernanceSchema'

export const bemergedAiModeTransitionEventSchema = z.enum([
  'enable-ai',
  'disable-ai',
  'start-autoplay',
  'stop-autoplay',
  'enable-dev',
  'disable-dev',
  'enable-testing',
  'disable-testing',
  'enforce-swap-only',
  'lift-swap-only',
  'restrict',
  'unrestrict',
])

export type BemergedAiModeTransitionEvent = z.infer<typeof bemergedAiModeTransitionEventSchema>

type TransitionResult = {
  ok: boolean
  from: BemergedAiModeState
  event: BemergedAiModeTransitionEvent
  to: BemergedAiModeState
  error?: string
}

export function transitionBemergedAiMode(
  fromInput: BemergedAiModeState,
  eventInput: BemergedAiModeTransitionEvent,
): TransitionResult {
  const from = bemergedAiModeStateSchema.parse(fromInput)
  const event = bemergedAiModeTransitionEventSchema.parse(eventInput)

  const invalid = (error: string): TransitionResult => ({ ok: false, from, event, to: from, error })
  const valid = (to: BemergedAiModeState): TransitionResult => ({ ok: true, from, event, to })

  if (from === 'restricted' && event !== 'unrestrict') {
    return invalid('restricted-mode-lock')
  }

  switch (event) {
    case 'restrict':
      return valid('restricted')
    case 'unrestrict':
      return from === 'restricted' ? valid('ai') : valid(from)
    case 'enable-ai':
      return valid('ai')
    case 'disable-ai':
      return valid('restricted')
    case 'start-autoplay':
      return from === 'restricted' ? invalid('cannot-start-autoplay-while-restricted') : valid('autoplay')
    case 'stop-autoplay':
      return from === 'autoplay' ? valid('ai') : valid(from)
    case 'enable-dev':
      return from === 'restricted' ? invalid('cannot-enable-dev-while-restricted') : valid('dev')
    case 'disable-dev':
      return from === 'dev' ? valid('ai') : valid(from)
    case 'enable-testing':
      return from === 'dev' ? valid('testing') : invalid('testing-requires-dev')
    case 'disable-testing':
      return from === 'testing' ? valid('dev') : valid(from)
    case 'enforce-swap-only':
      return from === 'restricted' ? invalid('cannot-enforce-swap-only-while-restricted') : valid('swap-only')
    case 'lift-swap-only':
      return from === 'swap-only' ? valid('ai') : valid(from)
    default:
      return invalid('unknown-event')
  }
}
