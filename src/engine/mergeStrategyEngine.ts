import type { ModuleToken, ModuleType } from './types'

export type MergePipelinePlan = {
  stepsToAncestral: number
  epicPlusFodderNeeded: number
  legendaryPlusFodderNeeded: number
  templateEpicPlusNeeded: number
  activeUniqueTemplateId: string | null
  hasUpgradeableUnique: boolean
}

export type MergeFodderTargets = {
  epicPlusDeficit: number
  legendaryPlusDeficit: number
  templateEpicPlusDeficit: number
  activeUniqueTemplateId: string | null
  hasUpgradeableUnique: boolean
}

export type MergeFodderTargetsByType = Record<ModuleType, MergeFodderTargets>

function estimateStepsToAncestral(token: ModuleToken): number {
  const key = `${token.rarity}${token.plus ? '+' : ''}`
  switch (key) {
    case 'Rare':
      return 7
    case 'Rare+':
      return 6
    case 'Epic':
      return 5
    case 'Epic+':
      return 4
    case 'Legendary':
      return 3
    case 'Legendary+':
      return 2
    case 'Mythic':
      return 1
    case 'Mythic+':
      return 1
    case 'Ancestral': {
      const stars = Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
      return Math.max(0, 5 - stars)
    }
    default:
      return 99
  }
}

function getPipelineNeedsForUniqueToken(token: ModuleToken): MergePipelinePlan {
  if (token.rarity === 'Ancestral') {
    const stars = Math.max(1, Math.min(5, Math.floor(Number(token.stars || 1))))
    return {
      stepsToAncestral: Math.max(0, 5 - stars),
      epicPlusFodderNeeded: 0,
      legendaryPlusFodderNeeded: 0,
      templateEpicPlusNeeded: Math.max(0, 5 - stars),
      activeUniqueTemplateId: String(token.templateId),
      hasUpgradeableUnique: stars < 5,
    }
  }

  if (token.rarity === 'Mythic' && token.plus) {
    return {
      stepsToAncestral: 1,
      epicPlusFodderNeeded: 2,
      legendaryPlusFodderNeeded: 0,
      templateEpicPlusNeeded: 0,
      activeUniqueTemplateId: String(token.templateId),
      hasUpgradeableUnique: true,
    }
  }

  if (token.rarity === 'Mythic' && !token.plus) {
    return {
      stepsToAncestral: 1,
      epicPlusFodderNeeded: 2,
      legendaryPlusFodderNeeded: 1,
      templateEpicPlusNeeded: 0,
      activeUniqueTemplateId: String(token.templateId),
      hasUpgradeableUnique: true,
    }
  }

  if (token.rarity === 'Legendary' && token.plus) {
    return {
      stepsToAncestral: 2,
      epicPlusFodderNeeded: 2,
      legendaryPlusFodderNeeded: 2,
      templateEpicPlusNeeded: 0,
      activeUniqueTemplateId: String(token.templateId),
      hasUpgradeableUnique: true,
    }
  }

  if (token.rarity === 'Legendary' && !token.plus) {
    return {
      stepsToAncestral: 3,
      epicPlusFodderNeeded: 2,
      legendaryPlusFodderNeeded: 2,
      templateEpicPlusNeeded: 1,
      activeUniqueTemplateId: String(token.templateId),
      hasUpgradeableUnique: true,
    }
  }

  return {
    stepsToAncestral: estimateStepsToAncestral(token),
    epicPlusFodderNeeded: 2,
    legendaryPlusFodderNeeded: 2,
    templateEpicPlusNeeded: 0,
    activeUniqueTemplateId: String(token.templateId),
    hasUpgradeableUnique: true,
  }
}

function countTemplateEpicPlus(tokens: ModuleToken[], templateId: string): number {
  return tokens.filter(token =>
    token.rarity === 'Epic'
    && token.plus
    && String(token.templateId) === templateId,
  ).length
}

function createEmptyTargets(): MergeFodderTargetsByType {
  return {
    Cannon: {
      epicPlusDeficit: 0,
      legendaryPlusDeficit: 0,
      templateEpicPlusDeficit: 0,
      activeUniqueTemplateId: null,
      hasUpgradeableUnique: false,
    },
    Armor: {
      epicPlusDeficit: 0,
      legendaryPlusDeficit: 0,
      templateEpicPlusDeficit: 0,
      activeUniqueTemplateId: null,
      hasUpgradeableUnique: false,
    },
    Generator: {
      epicPlusDeficit: 0,
      legendaryPlusDeficit: 0,
      templateEpicPlusDeficit: 0,
      activeUniqueTemplateId: null,
      hasUpgradeableUnique: false,
    },
    Core: {
      epicPlusDeficit: 0,
      legendaryPlusDeficit: 0,
      templateEpicPlusDeficit: 0,
      activeUniqueTemplateId: null,
      hasUpgradeableUnique: false,
    },
  }
}

export function buildMergeFodderTargetsByType(input: {
  boardTokens: ModuleToken[]
  inventoryTokens: ModuleToken[]
  isUniqueToken: (token: ModuleToken) => boolean
}): MergeFodderTargetsByType {
  const { boardTokens, inventoryTokens, isUniqueToken } = input
  const allTokens = [...boardTokens, ...inventoryTokens]
  const out = createEmptyTargets()

  const types: ModuleType[] = ['Cannon', 'Armor', 'Generator', 'Core']
  for (const type of types) {
    const typeTokens = allTokens.filter(token => token.type === type)
    const uniqueTypeTokens = typeTokens.filter(token => isUniqueToken(token))

    const upgradableUnique = uniqueTypeTokens
      .map(token => getPipelineNeedsForUniqueToken(token))
      .filter(plan => plan.hasUpgradeableUnique)
      .sort((left, right) => left.stepsToAncestral - right.stepsToAncestral)[0] || null

    if (!upgradableUnique) {
      out[type] = {
        epicPlusDeficit: 0,
        legendaryPlusDeficit: 0,
        templateEpicPlusDeficit: 0,
        activeUniqueTemplateId: null,
        hasUpgradeableUnique: false,
      }
      continue
    }

    const epicPlusCount = typeTokens.filter(token => token.rarity === 'Epic' && token.plus).length
    const legendaryPlusCount = typeTokens.filter(token => token.rarity === 'Legendary' && token.plus).length

    const templateEpicPlusCount = upgradableUnique.activeUniqueTemplateId
      ? countTemplateEpicPlus(typeTokens, upgradableUnique.activeUniqueTemplateId)
      : 0

    out[type] = {
      epicPlusDeficit: Math.max(0, upgradableUnique.epicPlusFodderNeeded - epicPlusCount),
      legendaryPlusDeficit: Math.max(0, upgradableUnique.legendaryPlusFodderNeeded - legendaryPlusCount),
      templateEpicPlusDeficit: Math.max(0, upgradableUnique.templateEpicPlusNeeded - templateEpicPlusCount),
      activeUniqueTemplateId: upgradableUnique.activeUniqueTemplateId,
      hasUpgradeableUnique: upgradableUnique.hasUpgradeableUnique,
    }
  }

  return out
}
