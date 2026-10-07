import { formatBackgroundDisplay } from '../assets/backgrounds'
import { getBossDamageForRarity } from './parityTuning'
import type { BossState, MineState, ModuleToken } from './types'
import { bemergedUniqueEffectTuning, getScaleValueForToken, getUniqueEffectId, type UniqueEffectId } from './uniqueEffects'

export type BemergedHoverDetails = {
  title: string
  subtitle: string
  lines: string[]
  accent: string
}

const UNIQUE_EFFECT_DESCRIPTIONS: Record<UniqueEffectId, (value: number) => string> = {
  AD: value => `All Rare+ modules deal +${value} extra boss hits.`,
  DP: value => `New bosses have a ${value}% chance to die instantly on spawn.`,
  BA: value => `Each combo module has a ${value}% chance to deal 2x damage.`,
  HB: value => `Every 5 moves, the boss loses ${value}% max HP.`,
  SR_CANNON: value => `Bosses spawn with ${value}% less HP.`,
  AS: value => `Boss combo damage gains ${value}% more scaling.`,
  ACP: () => 'Commons touching merges and combos auto-shatter and add to boss combo damage.',
  SD: value => `Mine spawn-rate control improves by ${value}, while mines still keep their reduced-radius roll.`,
  NMP: value => `You get ${value} extra moves before the boss starts destroying modules.`,
  WR: value => `Mines destroy ${value} fewer surrounding modules.`,
  SF: value => `The boss takes ${value} extra hits for each Rare module destroyed in its blast.`,
  OA: value => `Rare modules next to merges have a ${value}% chance to promote to Rare+.`,
  BHD: value => `A unique Epic has a ${value}% chance to spawn as Epic+ instead.`,
  SH: value => `Shattered modules have a ${value}% chance to pay out 2x shards.`,
  PH: value => `While a boss is alive, Rare and Epic drop pressure ramps by ${value}% each move until the boss dies.`,
  GC: value => `Each merge or shatter combo of 4+ reduces the timer by ${value} seconds.`,
  PF: value => `Unspent shards boost Rare and Epic spawn quality at ${value}% strength.`,
  RB_GENERATOR: value => `One module destroyed by a boss or mine has a ${value}% chance to promote instead.`,
  OC: value => `Modules next to the boss can deal +${value} extra hits.`,
  DC: value => `Each boss combo adds +${value} extra stacks toward the next combo.`,
  HC: value => `Boss and mine blasts have a ${value}% chance to spare one non-Common module.`,
  MVN: value => `Every ${value} moves, all Common modules sweep off the board.`,
  MH: value => `Every ${value} moves, mines crawl one step toward the boss.`,
  PC_CORE: value => `The core combo effect removes ${value}% of boss max HP.`,
}

export function formatUniqueEffectDisplayName(effectId: UniqueEffectId): string {
  return effectId.split('_')[0] || effectId
}

export function getUniqueModuleHoverText(token: ModuleToken): string | null {
  const effectId = getUniqueEffectId(token)
  if (!effectId) return null

  const effectScale = bemergedUniqueEffectTuning.effects[effectId]
  const effectValue = getScaleValueForToken(token, effectScale)
  return `${formatUniqueEffectDisplayName(effectId)}\n${UNIQUE_EFFECT_DESCRIPTIONS[effectId](effectValue)}`
}

function getVariantLabel(token: ModuleToken): string {
  if (token.rarity === 'Ancestral') {
    return `Ancestral ${Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))}★`
  }
  return `${token.rarity}${token.plus ? '+' : ''}`
}

function getAccentForToken(token: ModuleToken): string {
  if (token.rarity === 'Ancestral') return 'ancestral'
  if (token.rarity === 'Mythic') return 'mythic'
  if (token.rarity === 'Legendary') return 'legendary'
  if (token.rarity === 'Epic') return 'epic'
  if (token.rarity === 'Rare') return 'rare'
  return 'common'
}

function getTemplateTitle(token: ModuleToken): string {
  const effectId = getUniqueEffectId(token)
  if (effectId) {
    return `${token.type} ${formatUniqueEffectDisplayName(effectId)}`
  }
  return `${token.type} ${String(token.templateId || '').trim() || 'Module'}`
}

export function getModuleVariantBadgeText(token: ModuleToken): string {
  if (token.rarity === 'Common') return 'C'
  if (token.rarity === 'Rare') return token.plus ? 'R+' : 'R'
  if (token.rarity === 'Epic') return token.plus ? 'E+' : 'E'
  if (token.rarity === 'Legendary') return token.plus ? 'L+' : 'L'
  if (token.rarity === 'Mythic') return token.plus ? 'M+' : 'M'
  return `A${Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))}`
}

export function getModuleVariantAdornmentText(token: ModuleToken): string | null {
  if (token.rarity === 'Ancestral') {
    return `${Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))}★`
  }
  if (token.plus) return '+'
  return null
}

export function getModuleHoverDetails(token: ModuleToken): BemergedHoverDetails {
  const effectId = getUniqueEffectId(token)
  const effectScale = effectId ? bemergedUniqueEffectTuning.effects[effectId] : null
  const effectValue = effectScale ? getScaleValueForToken(token, effectScale) : 0
  const lines: string[] = []

  if (token.rarity === 'Common') {
    lines.push('Straight horizontal or vertical lines of 3+ matching Common modules shatter for shards.')
    lines.push('Common modules also work as low-damage boss combo fodder.')
  } else if (token.rarity === 'Rare' && !token.plus) {
    lines.push('Merge 3 identical Rare copies to make Rare+.')
    lines.push('If Auto-shatter rares is enabled, straight lines of 3 matching Rares also shatter.')
  } else if (token.rarity === 'Rare' && token.plus) {
    lines.push('Merge 3 Rare+ of the same type to make an Epic.')
    lines.push('Rare+ modules hit the boss harder than Commons in manual combos.')
  } else if (token.rarity === 'Epic' && !token.plus) {
    lines.push('Merge 2 identical Epics to make Epic+.')
  } else if (token.rarity === 'Epic' && token.plus) {
    lines.push('Merge 3 Epic+ of the same type to make Legendary.')
  } else if (token.rarity === 'Legendary' && !token.plus) {
    lines.push('Merge with a matching Epic+ copy to make Legendary+.')
  } else if (token.rarity === 'Legendary' && token.plus) {
    lines.push('Unique lines can merge to Mythic from here. Non-unique lines stop here.')
  } else if (token.rarity === 'Mythic') {
    lines.push('Only unique lines can keep climbing into Mythic+ and Ancestral tiers.')
  } else if (token.rarity === 'Ancestral') {
    lines.push('Feed matching Epic+ copies into this unique line to add stars up to 5★.')
  }

  if (effectId && effectScale) {
    lines.push(UNIQUE_EFFECT_DESCRIPTIONS[effectId](effectValue))
  } else if (token.rarity !== 'Common') {
    const bossDamage = token.plus ? getBossDamageForRarity(token.rarity) : 0
    if (bossDamage > 0) {
      lines.push(`This variant contributes ${bossDamage} base boss damage when it is destroyed or comboed.`)
    }
  }

  lines.push('Hovering variants now shows their tier and effect so it is easier to tell them apart.')

  return {
    title: getTemplateTitle(token),
    subtitle: `${getVariantLabel(token)} • ${token.type}`,
    lines,
    accent: getAccentForToken(token),
  }
}

export function getMineHoverDetails(mine: MineState): BemergedHoverDetails {
  return {
    title: 'Mine',
    subtitle: `${mine.movesRemaining} moves remaining • radius ${mine.blastRadius}`,
    lines: [
      'Tiles touching a mine cannot be swapped.',
      'Double-tap a mine to trigger it immediately.',
      'Mine blasts decay nearby modules by 2 tiers, remove commons, and can chain into other mines.',
    ],
    accent: 'hazard',
  }
}

export function getBossHoverDetails(boss: BossState): BemergedHoverDetails {
  const burstCounter = Math.max(1, Math.floor(Number(boss.burstCounter || 0)))
  return {
    title: 'Boss',
    subtitle: `HP ${boss.hitsRemaining}/${Math.max(1, Math.floor(Number(boss.maxHits || boss.hitsRemaining)))} • burst in ${burstCounter}`,
    lines: [
      'Tiles touching the boss cannot be swapped.',
      'Long-press the boss to enter combo mode, lock the combo type from a touching module, then tap the boss again to confirm.',
      'The boss decays nearby modules every move and bursts every 6 moves, so keep valuables out of its ring.',
    ],
    accent: 'boss',
  }
}

export function getBackgroundUnlockMessage(background: string): string {
  return `Achievement:\nYou unlocked ${formatBackgroundDisplay(background)}!`
}
