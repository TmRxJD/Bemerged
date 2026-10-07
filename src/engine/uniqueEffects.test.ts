import { describe, expect, it } from 'vitest'
import { EPIC_TEMPLATES } from './moduleData'
import {
  bemergedUniqueEffectTuning,
  getScaleValueForToken,
  getUniqueEffectId,
  rarityAtLeast,
} from './uniqueEffects'
import type { ModuleRarity, ModuleToken, ModuleType } from './types'

function tokenOf(input: {
  templateId: string
  type: ModuleType
  rarity?: ModuleRarity
}): ModuleToken {
  return {
    instanceId: `tok-${input.type}-${input.templateId}`,
    templateId: input.templateId,
    type: input.type,
    rarity: input.rarity || 'Epic',
    plus: false,
    frameSrc: 'frame',
    assetSrc: 'asset',
    frameTextureKey: 'frame-key',
    assetTextureKey: 'asset-key',
    matchKey: `${input.templateId}:${input.rarity || 'Epic'}`,
  }
}

describe('unique effect contract', () => {
  it('maps every epic template to a unique effect id', () => {
    for (const template of EPIC_TEMPLATES) {
      const effectId = getUniqueEffectId(tokenOf({
        templateId: template.id,
        type: template.type,
      }))
      expect(effectId, `${template.type}:${template.id} should map to a unique effect`).toBeTruthy()
    }
  })

  it('provides valid scale values for every effect across epic+ rarities', () => {
    const rarities: ModuleRarity[] = ['Epic', 'Legendary', 'Mythic', 'Ancestral']
    const effects = Object.entries(bemergedUniqueEffectTuning.effects)

    expect(effects.length).toBeGreaterThan(0)
    for (const [effectId, scale] of effects) {
      for (const rarity of rarities) {
        const value = getScaleValueForToken(tokenOf({
          templateId: 'AD',
          type: 'Cannon',
          rarity,
        }), scale)
        expect(Number.isFinite(value), `${effectId}:${rarity} should be finite`).toBe(true)
        expect(value, `${effectId}:${rarity} should be non-negative`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('returns zero scale for non-epic rarities', () => {
    const scale = bemergedUniqueEffectTuning.effects.PF

    const commonValue = getScaleValueForToken(tokenOf({ templateId: 'PF', type: 'Generator', rarity: 'Common' }), scale)
    const rareValue = getScaleValueForToken(tokenOf({ templateId: 'PF', type: 'Generator', rarity: 'Rare' }), scale)

    expect(commonValue).toBe(0)
    expect(rareValue).toBe(0)
  })

  it('enforces expected rarity ordering for min-rarity checks', () => {
    expect(rarityAtLeast('Epic', 'Epic')).toBe(true)
    expect(rarityAtLeast('Legendary', 'Epic')).toBe(true)
    expect(rarityAtLeast('Rare', 'Epic')).toBe(false)
    expect(rarityAtLeast('Mythic', 'Legendary')).toBe(true)
    expect(rarityAtLeast('Common', 'Rare')).toBe(false)
  })
})
