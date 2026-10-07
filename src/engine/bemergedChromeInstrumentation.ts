export type BemergedInstrumentationEventType =
  | 'onBoardUpdate'
  | 'onBossSpawn'
  | 'onMineSpawn'
  | 'onMerge'
  | 'onShatter'
  | 'onDamage'
  | 'onAnimationComplete'
  | 'onAutoplayStateChanged'
  | 'onDevCommand'
  | 'onError'

export type BemergedInstrumentationEvent = {
  id: string
  sequence: number
  type: BemergedInstrumentationEventType
  timestampIso: string
  payload: Record<string, unknown>
}

export type BemergedChromeInstrumentation = {
  readonly contractVersion: 'bemerged-mcp-instrumentation-v1'
  readonly cdpDomains: ReadonlyArray<'Page' | 'Runtime' | 'Performance' | 'Network' | 'Overlay' | 'Input'>
  readonly streamProtocol: {
    contractVersion: 'bemerged-state-stream-v1'
    transport: 'sse+snapshot-poll'
    eventEndpoint: '/api/bemerged/events'
    recentEndpoint: '/api/bemerged/events/recent'
  }
  getStateSnapshot: () => Record<string, unknown>
  refreshStateSnapshot: () => Record<string, unknown>
  getRecentEvents: (limit?: number, types?: BemergedInstrumentationEventType[]) => BemergedInstrumentationEvent[]
  subscribe: (listener: (event: BemergedInstrumentationEvent) => void) => () => void
  recordEvent: (type: BemergedInstrumentationEventType, payload?: Record<string, unknown>) => BemergedInstrumentationEvent
  runDevCommand: (command: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>
  dispose: () => void
}

type CreateBemergedChromeInstrumentationOptions = {
  eventBufferLimit?: number
  getStateSnapshot: () => Record<string, unknown>
  runDevCommand: (command: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>
}

const INSTRUMENTATION_WINDOW_KEY = '__BEMERGED_MCP_HARNESS__'
const INSTRUMENTATION_CONSOLE_PREFIX = '__BEMERGED_INSTRUMENTATION__'
const DEFAULT_EVENT_BUFFER_LIMIT = 300

function copySnapshot(raw: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
  } catch {
    return raw
  }
}

function createEvent(
  sequence: number,
  type: BemergedInstrumentationEventType,
  payload: Record<string, unknown>,
): BemergedInstrumentationEvent {
  return {
    id: `bemerged-inst-${Date.now()}-${sequence}`,
    sequence,
    type,
    timestampIso: new Date().toISOString(),
    payload,
  }
}

declare global {
  interface Window {
    __BEMERGED_MCP_HARNESS__?: BemergedChromeInstrumentation
  }
}

export function createBemergedChromeInstrumentation(
  options: CreateBemergedChromeInstrumentationOptions,
): BemergedChromeInstrumentation {
  const eventBufferLimit = Math.max(50, Math.min(1000, Number(options.eventBufferLimit) || DEFAULT_EVENT_BUFFER_LIMIT))
  const eventBuffer: BemergedInstrumentationEvent[] = []
  const listeners = new Set<(event: BemergedInstrumentationEvent) => void>()

  let disposed = false
  let sequence = 0
  let latestSnapshot = copySnapshot(options.getStateSnapshot())
  let frameHandle: number | null = null
  let previousAnimationFrameTs = performance.now()
  let animationLagCount = 0
  let longTaskObserver: PerformanceObserver | null = null

  const recordEvent = (type: BemergedInstrumentationEventType, payload: Record<string, unknown> = {}) => {
    const event = createEvent(++sequence, type, payload)
    eventBuffer.push(event)
    if (eventBuffer.length > eventBufferLimit) {
      eventBuffer.splice(0, eventBuffer.length - eventBufferLimit)
    }

    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        void 0
      }
    }

    try {
      console.debug(`${INSTRUMENTATION_CONSOLE_PREFIX}${JSON.stringify(event)}`)
    } catch {
      void 0
    }

    return event
  }

  const refreshStateSnapshot = () => {
    if (disposed) {
      return latestSnapshot
    }
    latestSnapshot = copySnapshot(options.getStateSnapshot())
    return latestSnapshot
  }

  const getStateSnapshot = () => refreshStateSnapshot()

  const subscribe = (listener: (event: BemergedInstrumentationEvent) => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const getRecentEvents = (limit = 50, types: BemergedInstrumentationEventType[] = []) => {
    const bounded = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)))
    const typeFilter = new Set(types)
    const scoped = typeFilter.size > 0
      ? eventBuffer.filter(item => typeFilter.has(item.type))
      : eventBuffer
    return scoped.slice(-bounded)
  }

  const runDevCommand = async (command: string, args: Record<string, unknown> = {}) => {
    try {
      const result = await options.runDevCommand(command, args)
      recordEvent('onDevCommand', {
        command,
        ok: true,
        result,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordEvent('onError', {
        command,
        ok: false,
        error: message,
      })
      throw error
    }
  }

  const animationTick = (timestamp: number) => {
    if (disposed) return
    const deltaMs = timestamp - previousAnimationFrameTs
    previousAnimationFrameTs = timestamp
    if (deltaMs > 50) {
      animationLagCount += 1
      recordEvent('onAnimationComplete', {
        source: 'raf-monitor',
        frameDeltaMs: Math.round(deltaMs),
        lagCount: animationLagCount,
      })
    }
    frameHandle = window.requestAnimationFrame(animationTick)
  }

  try {
    frameHandle = window.requestAnimationFrame(animationTick)
  } catch {
    void 0
  }

  try {
    longTaskObserver = new PerformanceObserver(entryList => {
      const entries = entryList.getEntries()
      for (const entry of entries) {
        const duration = Math.max(0, Math.round(entry.duration))
        if (duration < 50) continue
        recordEvent('onAnimationComplete', {
          source: 'long-task',
          durationMs: duration,
          startTimeMs: Math.round(entry.startTime),
        })
      }
    })
    longTaskObserver.observe({ entryTypes: ['longtask'] })
  } catch {
    longTaskObserver = null
  }

  const api: BemergedChromeInstrumentation = {
    contractVersion: 'bemerged-mcp-instrumentation-v1',
    cdpDomains: ['Page', 'Runtime', 'Performance', 'Network', 'Overlay', 'Input'],
    streamProtocol: {
      contractVersion: 'bemerged-state-stream-v1',
      transport: 'sse+snapshot-poll',
      eventEndpoint: '/api/bemerged/events',
      recentEndpoint: '/api/bemerged/events/recent',
    },
    getStateSnapshot,
    refreshStateSnapshot,
    getRecentEvents,
    subscribe,
    recordEvent,
    runDevCommand,
    dispose: () => {
      if (disposed) return
      disposed = true
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle)
      }
      try {
        longTaskObserver?.disconnect()
      } catch {
        void 0
      }
      listeners.clear()
      if (window[INSTRUMENTATION_WINDOW_KEY] === api) {
        delete window[INSTRUMENTATION_WINDOW_KEY]
      }
    },
  }

  window[INSTRUMENTATION_WINDOW_KEY] = api
  return api
}
