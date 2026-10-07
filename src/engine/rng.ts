export class SeededRng {
  private state: number

  constructor(seed: number) {
    const normalized = Number.isFinite(seed) ? Math.floor(seed) : 1
    this.state = (normalized >>> 0) || 1
  }

  next(): number {
    let value = this.state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.state = value >>> 0
    return this.state / 0x100000000
  }

  int(maxExclusive: number): number {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 1) return 0
    return Math.floor(this.next() * maxExclusive)
  }

  pick<T>(items: T[]): T {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('SeededRng.pick requires a non-empty array')
    }
    return items[this.int(items.length)]
  }

  getState(): number {
    return this.state >>> 0
  }

  setState(nextState: number): void {
    const normalized = Number.isFinite(nextState) ? Math.floor(nextState) : 1
    this.state = (normalized >>> 0) || 1
  }
}
