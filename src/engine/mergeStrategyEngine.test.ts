import { describe, expect, it } from 'vitest'
import { buildMergeFodderTargetsByType } from './mergeStrategyEngine'
import type { ModuleToken, ModuleType } from './types'

function createToken(input: {
  templateId: string
  type: ModuleType
  rarity: ModuleToken['rarity']
  plus?: boolean
  stars?: number
}): ModuleToken {
  return {
    instanceId: `${input.templateId}-${input.type}-${input.rarity}-${input.plus ? 'p' : 'n'}`,
    templateId: input.templateId,
    type: input.type,
    rarity: input.rarity,
    plus: !!input.plus,
    stars: input.stars,
    frameSrc: '',
    assetSrc: '',
    frameTextureKey: '',
    assetTextureKey: '',
    matchKey: '',
  }
}

describe('mergeStrategyEngine', () => {
  it('models legendary unique path requirements including template epic+ step', () => {
    const uniqueLegendary = createToken({
      templateId: 'cannon-u1',
      type: 'Cannon',
      rarity: 'Legendary',
      plus: false,
    })

    const targets = buildMergeFodderTargetsByType({
      boardTokens: [uniqueLegendary],
      inventoryTokens: [],
      isUniqueToken: token => token.templateId.startsWith('cannon-u'),
    })

    expect(targets.Cannon.hasUpgradeableUnique).toBe(true)
    expect(targets.Cannon.activeUniqueTemplateId).toBe('cannon-u1')
    expect(targets.Cannon.epicPlusDeficit).toBe(2)
    expect(targets.Cannon.legendaryPlusDeficit).toBe(2)
    expect(targets.Cannon.templateEpicPlusDeficit).toBe(1)
  })

  it('tracks mythic+ to ancestral as requiring only epic+ type fodder', () => {
    const uniqueMythicPlus = createToken({
      templateId: 'armor-u2',
      type: 'Armor',
      rarity: 'Mythic',
      plus: true,
    })
    const epicPlusA = createToken({ templateId: 'armor-f1', type: 'Armor', rarity: 'Epic', plus: true })
    const epicPlusB = createToken({ templateId: 'armor-f2', type: 'Armor', rarity: 'Epic', plus: true })

    const targets = buildMergeFodderTargetsByType({
      boardTokens: [uniqueMythicPlus, epicPlusA, epicPlusB],
      inventoryTokens: [],
      isUniqueToken: token => token.templateId.startsWith('armor-u'),
    })

    expect(targets.Armor.epicPlusDeficit).toBe(0)
    expect(targets.Armor.legendaryPlusDeficit).toBe(0)
    expect(targets.Armor.templateEpicPlusDeficit).toBe(0)
  })

  it('plans ancestral star upgrades using template-matched epic+ fodder', () => {
    const ancestralThreeStar = createToken({
      templateId: 'gen-u1',
      type: 'Generator',
      rarity: 'Ancestral',
      plus: false,
      stars: 3,
    })
    const matchingEpicPlus = createToken({
      templateId: 'gen-u1',
      type: 'Generator',
      rarity: 'Epic',
      plus: true,
    })

    const targets = buildMergeFodderTargetsByType({
      boardTokens: [ancestralThreeStar, matchingEpicPlus],
      inventoryTokens: [],
      isUniqueToken: token => token.templateId.startsWith('gen-u1'),
    })

    expect(targets.Generator.hasUpgradeableUnique).toBe(true)
    expect(targets.Generator.templateEpicPlusDeficit).toBe(1)
    expect(targets.Generator.epicPlusDeficit).toBe(0)
    expect(targets.Generator.legendaryPlusDeficit).toBe(0)
  })
})
