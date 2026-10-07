type SearchWidthStepSignal = {
  merged: boolean
  expansionUsed: boolean
  reason: string
}

type SearchWidthWindowStats = {
  expansionRate: number
  mergeRate: number
  timeoutRate: number
}

export type SearchWidthRecommendationInput = {
  fastLimit: number
  expandedLimit: number
  adaptiveExpansion: boolean
  timeoutStreak: number
}

export type SearchWidthRecommendation = {
  fastLimit: number
  expandedLimit: number
  allowExpansion: boolean
  rationale: string[]
}

const MAX_HISTORY = 36

export class AutoplaySearchWidthController {
  private readonly history: SearchWidthStepSignal[] = []

  recordStep(signal: SearchWidthStepSignal): void {
    this.history.push({
      merged: signal.merged === true,
      expansionUsed: signal.expansionUsed === true,
      reason: String(signal.reason || '').trim(),
    })
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY)
    }
  }

  recommend(input: SearchWidthRecommendationInput): SearchWidthRecommendation {
    const baseFast = Math.max(1, Math.floor(Number(input.fastLimit) || 1))
    const baseExpanded = Math.max(baseFast, Math.floor(Number(input.expandedLimit) || baseFast))
    const timeoutStreak = Math.max(0, Math.floor(Number(input.timeoutStreak) || 0))
    const stats = this.getWindowStats()

    let fastLimit = baseFast
    let expandedLimit = baseExpanded
    let allowExpansion = input.adaptiveExpansion === true
    const rationale: string[] = []

    if (timeoutStreak > 0) {
      fastLimit = Math.max(8, Math.floor(baseFast * 0.7))
      expandedLimit = Math.max(fastLimit + 4, Math.floor(baseExpanded * 0.6))
      rationale.push('timeout-streak-reduce-search-width')
    }

    if (stats.timeoutRate > 0.3) {
      fastLimit = Math.max(8, Math.floor(fastLimit * 0.75))
      expandedLimit = Math.max(fastLimit + 4, Math.floor(expandedLimit * 0.7))
      rationale.push('recent-timeout-pressure')
    }

    if (stats.mergeRate < 0.2 && stats.timeoutRate < 0.2) {
      fastLimit = Math.min(baseFast + 10, Math.max(fastLimit, baseFast + 6))
      rationale.push('low-merge-rate-expand-fast-pass')
    }

    if (stats.expansionRate > 0.65 && stats.timeoutRate > 0.2) {
      allowExpansion = false
      rationale.push('over-expansion-under-time-pressure')
    }

    fastLimit = Math.max(1, Math.floor(fastLimit))
    expandedLimit = Math.max(fastLimit, Math.floor(expandedLimit))

    return {
      fastLimit,
      expandedLimit,
      allowExpansion,
      rationale,
    }
  }

  private getWindowStats(): SearchWidthWindowStats {
    if (this.history.length <= 0) {
      return {
        expansionRate: 0,
        mergeRate: 0,
        timeoutRate: 0,
      }
    }

    const total = this.history.length
    const expansions = this.history.filter(item => item.expansionUsed).length
    const merges = this.history.filter(item => item.merged).length
    const timeouts = this.history.filter(item => item.reason.includes('timeout')).length

    return {
      expansionRate: expansions / total,
      mergeRate: merges / total,
      timeoutRate: timeouts / total,
    }
  }
}
