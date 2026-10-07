import type { ModuleRarity, ModuleToken } from './types'

export type BemergedParityTuning = {
  shardsPerClear: number
  dropRates: {
    Common: number
    Rare: number
    Epic: number
  }
  mine: {
    baseMoves: number
    blastRadius: number
    spawnPercentPerDrop: number
    spawnCooldownMoves: number
    reducedRadiusChancePercent: number
    reducedRadiusTiles: number
    manualTriggerDoubleTapMs: number
  }
  boss: {
    spawnEveryMoves: number
    baseRequiredHits: number
    requiredHitsStepPerSpawn: number
    decayGraceMoves: number
    decaySampleCount: number
    decayTierLoss: number
    moveEveryMoves: number
    burstEveryMoves: number
    burstRadius: number
    burstTierLoss: number
  }
  combo: {
    longPressMs: number
    stackDamagePercent: number
  }
  damage: {
    baseTierDamage: number
    tierStepDamage: number
  }
}

export const bemergedParityTuning: BemergedParityTuning = {
  shardsPerClear: 5,
  dropRates: {
    Common: 0.685,
    Rare: 0.29,
    Epic: 0.025,
  },
  mine: {
    baseMoves: 10,
    blastRadius: 2,
    spawnPercentPerDrop: 1,
    spawnCooldownMoves: 10,
    reducedRadiusChancePercent: 15,
    reducedRadiusTiles: 1,
    manualTriggerDoubleTapMs: 320,
  },
  boss: {
    spawnEveryMoves: 100,
    baseRequiredHits: 100,
    requiredHitsStepPerSpawn: 10,
    decayGraceMoves: 0,
    decaySampleCount: 5,
    decayTierLoss: 1,
    moveEveryMoves: 1,
    burstEveryMoves: 6,
    burstRadius: 2,
    burstTierLoss: 2,
  },
  combo: {
    longPressMs: 360,
    stackDamagePercent: 5,
  },
  damage: {
    baseTierDamage: 1,
    tierStepDamage: 1,
  },
}

export function getBossDamageForRarity(rarity: ModuleRarity): number {
  switch (rarity) {
    case 'Common':
      return 1
    case 'Rare':
      return 2
    case 'Epic':
      return 4
    case 'Legendary':
      return 6
    case 'Mythic':
      return 8
    case 'Ancestral':
      return 10
    default:
      return 1
  }
}

export function getBemergedProgressionTier(token: ModuleToken): number {
  if (token.rarity === 'Common') return 1
  if (token.rarity === 'Rare' && !token.plus) return 2
  if (token.rarity === 'Rare' && token.plus) return 3
  if (token.rarity === 'Epic' && !token.plus) return 4
  if (token.rarity === 'Epic' && token.plus) return 5
  if (token.rarity === 'Legendary' && !token.plus) return 6
  if (token.rarity === 'Legendary' && token.plus) return 7
  if (token.rarity === 'Mythic' && !token.plus) return 8
  if (token.rarity === 'Mythic' && token.plus) return 9

  const stars = Math.max(1, Math.min(4, Math.floor(Number(token.stars || 1))))
  return 9 + stars
}

export function getBossDamageForTokenProgression(token: ModuleToken): number {
  const tier = Math.max(1, getBemergedProgressionTier(token))
  return bemergedParityTuning.damage.baseTierDamage + ((tier - 1) * bemergedParityTuning.damage.tierStepDamage)
}

export type BemergedParityTuningPatch = {
  shardsPerClear?: number
  dropRates?: {
    Common?: number
    Rare?: number
    Epic?: number
  }
  mine?: {
    baseMoves?: number
    blastRadius?: number
    spawnPercentPerDrop?: number
    spawnCooldownMoves?: number
    reducedRadiusChancePercent?: number
    reducedRadiusTiles?: number
    manualTriggerDoubleTapMs?: number
  }
  boss?: {
    spawnEveryMoves?: number
    baseRequiredHits?: number
    requiredHitsStepPerSpawn?: number
    decayGraceMoves?: number
    decaySampleCount?: number
    decayTierLoss?: number
    moveEveryMoves?: number
    burstEveryMoves?: number
    burstRadius?: number
    burstTierLoss?: number
  }
  combo?: {
    longPressMs?: number
    stackDamagePercent?: number
  }
  damage?: {
    baseTierDamage?: number
    tierStepDamage?: number
  }
}

function clampInt(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const asInt = Math.floor(parsed)
  return Math.max(min, Math.min(max, asInt))
}

function copyTuning(): BemergedParityTuning {
  return {
    shardsPerClear: bemergedParityTuning.shardsPerClear,
    dropRates: {
      ...bemergedParityTuning.dropRates,
    },
    mine: {
      ...bemergedParityTuning.mine,
    },
    boss: {
      ...bemergedParityTuning.boss,
    },
    combo: {
      ...bemergedParityTuning.combo,
    },
    damage: {
      ...bemergedParityTuning.damage,
    },
  }
}

export function getBemergedParityTuningSnapshot(): BemergedParityTuning {
  return copyTuning()
}

export function applyBemergedParityTuningPatch(patch: BemergedParityTuningPatch): BemergedParityTuning {
  const nextShardsPerClear = clampInt(patch.shardsPerClear, 1, 200)
  if (nextShardsPerClear != null) {
    bemergedParityTuning.shardsPerClear = nextShardsPerClear
  }

  if (patch.dropRates) {
    const nextCommon = Number(patch.dropRates.Common)
    const nextRare = Number(patch.dropRates.Rare)
    const nextEpic = Number(patch.dropRates.Epic)

    if (Number.isFinite(nextCommon) && nextCommon >= 0) {
      bemergedParityTuning.dropRates.Common = nextCommon
    }
    if (Number.isFinite(nextRare) && nextRare >= 0) {
      bemergedParityTuning.dropRates.Rare = nextRare
    }
    if (Number.isFinite(nextEpic) && nextEpic >= 0) {
      bemergedParityTuning.dropRates.Epic = nextEpic
    }
  }

  if (patch.mine) {
    const nextBaseMoves = clampInt(patch.mine.baseMoves, 1, 100)
    if (nextBaseMoves != null) {
      bemergedParityTuning.mine.baseMoves = nextBaseMoves
    }

    const nextBlastRadius = clampInt(patch.mine.blastRadius, 1, 4)
    if (nextBlastRadius != null) {
      bemergedParityTuning.mine.blastRadius = nextBlastRadius
    }

    const nextSpawnPercentPerDrop = clampInt(patch.mine.spawnPercentPerDrop, 0, 50)
    if (nextSpawnPercentPerDrop != null) {
      bemergedParityTuning.mine.spawnPercentPerDrop = nextSpawnPercentPerDrop
    }

    const nextSpawnCooldownMoves = clampInt(patch.mine.spawnCooldownMoves, 0, 500)
    if (nextSpawnCooldownMoves != null) {
      bemergedParityTuning.mine.spawnCooldownMoves = nextSpawnCooldownMoves
    }

    const nextReducedRadiusChancePercent = clampInt(patch.mine.reducedRadiusChancePercent, 0, 100)
    if (nextReducedRadiusChancePercent != null) {
      bemergedParityTuning.mine.reducedRadiusChancePercent = nextReducedRadiusChancePercent
    }

    const nextReducedRadiusTiles = clampInt(patch.mine.reducedRadiusTiles, 0, 4)
    if (nextReducedRadiusTiles != null) {
      bemergedParityTuning.mine.reducedRadiusTiles = nextReducedRadiusTiles
    }

    const nextManualTriggerDoubleTapMs = clampInt(patch.mine.manualTriggerDoubleTapMs, 120, 1000)
    if (nextManualTriggerDoubleTapMs != null) {
      bemergedParityTuning.mine.manualTriggerDoubleTapMs = nextManualTriggerDoubleTapMs
    }
  }

  if (patch.boss) {
    const nextSpawnEveryMoves = clampInt(patch.boss.spawnEveryMoves, 1, 1000)
    if (nextSpawnEveryMoves != null) {
      bemergedParityTuning.boss.spawnEveryMoves = nextSpawnEveryMoves
    }

    const nextBaseRequiredHits = clampInt(patch.boss.baseRequiredHits, 1, 5000)
    if (nextBaseRequiredHits != null) {
      bemergedParityTuning.boss.baseRequiredHits = nextBaseRequiredHits
    }

    const nextRequiredHitsStep = clampInt(patch.boss.requiredHitsStepPerSpawn, 0, 500)
    if (nextRequiredHitsStep != null) {
      bemergedParityTuning.boss.requiredHitsStepPerSpawn = nextRequiredHitsStep
    }

    const nextDecayGraceMoves = clampInt(patch.boss.decayGraceMoves, 0, 1000)
    if (nextDecayGraceMoves != null) {
      bemergedParityTuning.boss.decayGraceMoves = nextDecayGraceMoves
    }

    const nextDecaySampleCount = clampInt(patch.boss.decaySampleCount, 1, 8)
    if (nextDecaySampleCount != null) {
      bemergedParityTuning.boss.decaySampleCount = nextDecaySampleCount
    }

    const nextDecayTierLoss = clampInt(patch.boss.decayTierLoss, 1, 4)
    if (nextDecayTierLoss != null) {
      bemergedParityTuning.boss.decayTierLoss = nextDecayTierLoss
    }

    const nextMoveEveryMoves = clampInt(patch.boss.moveEveryMoves, 1, 20)
    if (nextMoveEveryMoves != null) {
      bemergedParityTuning.boss.moveEveryMoves = nextMoveEveryMoves
    }

    const nextBurstEveryMoves = clampInt(patch.boss.burstEveryMoves, 1, 50)
    if (nextBurstEveryMoves != null) {
      bemergedParityTuning.boss.burstEveryMoves = nextBurstEveryMoves
    }

    const nextBurstRadius = clampInt(patch.boss.burstRadius, 1, 6)
    if (nextBurstRadius != null) {
      bemergedParityTuning.boss.burstRadius = nextBurstRadius
    }

    const nextBurstTierLoss = clampInt(patch.boss.burstTierLoss, 1, 6)
    if (nextBurstTierLoss != null) {
      bemergedParityTuning.boss.burstTierLoss = nextBurstTierLoss
    }
  }

  if (patch.combo) {
    const nextLongPressMs = clampInt(patch.combo.longPressMs, 120, 1000)
    if (nextLongPressMs != null) {
      bemergedParityTuning.combo.longPressMs = nextLongPressMs
    }

    const nextStackDamagePercent = clampInt(patch.combo.stackDamagePercent, 0, 100)
    if (nextStackDamagePercent != null) {
      bemergedParityTuning.combo.stackDamagePercent = nextStackDamagePercent
    }
  }

  if (patch.damage) {
    const nextBaseTierDamage = clampInt(patch.damage.baseTierDamage, 0, 500)
    if (nextBaseTierDamage != null) {
      bemergedParityTuning.damage.baseTierDamage = nextBaseTierDamage
    }

    const nextTierStepDamage = clampInt(patch.damage.tierStepDamage, 0, 500)
    if (nextTierStepDamage != null) {
      bemergedParityTuning.damage.tierStepDamage = nextTierStepDamage
    }
  }

  return copyTuning()
}
