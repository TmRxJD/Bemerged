import type { ModuleCatalog } from './catalog'
import { BASE_RATES, COMMON_TEMPLATES, EPIC_TEMPLATES, RARE_TEMPLATES, type TemplateLike } from './moduleTemplates'
import { SeededRng } from './rng'
import { buildTokenVisual } from './tokenVisual'
import type { ModuleRarity, ModuleToken, ModuleType } from './types'

type TokenBlueprint = {
  templateId: string
  type: ModuleType
  rarity: ModuleRarity
  plus: boolean
  frameSrc: string
  assetSrc: string
  frameTextureKey: string
  assetTextureKey: string
}

function createHeadlessVisual(templateId: string, type: ModuleType, rarity: ModuleRarity, plus: boolean) {
  return buildTokenVisual(
    `headless://frame/${String(rarity).toLowerCase()}${plus ? '-plus' : ''}`,
    `headless://asset/${String(type).toLowerCase()}/${String(templateId).toLowerCase()}/${String(rarity).toLowerCase()}${plus ? '-plus' : ''}`,
  )
}

function buildBlueprint(template: TemplateLike, rarity: ModuleRarity): TokenBlueprint {
  const visual = createHeadlessVisual(template.id, template.type, rarity, false)
  return {
    templateId: template.id,
    type: template.type,
    rarity,
    plus: false,
    frameSrc: visual.frameSrc,
    assetSrc: visual.assetSrc,
    frameTextureKey: visual.frameTextureKey,
    assetTextureKey: visual.assetTextureKey,
  }
}

const COMMON_BLUEPRINTS = COMMON_TEMPLATES.map(template => buildBlueprint(template, 'Common'))
const RARE_BLUEPRINTS = RARE_TEMPLATES.map(template => buildBlueprint(template, 'Rare'))
const EPIC_BLUEPRINTS = EPIC_TEMPLATES.map(template => buildBlueprint(template, 'Epic'))

export function createHeadlessModuleCatalog(rng: SeededRng): ModuleCatalog {
  let serial = 0
  const typeByTemplateId = new Map<string, ModuleType>()
  for (const template of [...COMMON_TEMPLATES, ...RARE_TEMPLATES, ...EPIC_TEMPLATES]) {
    typeByTemplateId.set(String(template.id), template.type)
  }

  const createFrom = (blueprint: TokenBlueprint): ModuleToken => {
    serial += 1
    return {
      instanceId: `tok-${serial}`,
      templateId: blueprint.templateId,
      type: blueprint.type,
      rarity: blueprint.rarity,
      plus: blueprint.plus,
      frameSrc: blueprint.frameSrc,
      assetSrc: blueprint.assetSrc,
      frameTextureKey: blueprint.frameTextureKey,
      assetTextureKey: blueprint.assetTextureKey,
      matchKey: `${blueprint.templateId}:${blueprint.rarity}${blueprint.plus ? '+' : ''}`,
    }
  }

  const createRandomToken = (): ModuleToken => {
    const weightedPools: Array<{ pool: TokenBlueprint[]; weight: number }> = [
      { pool: COMMON_BLUEPRINTS, weight: Math.max(0, Number(BASE_RATES.Common || 0.685)) },
      { pool: RARE_BLUEPRINTS, weight: Math.max(0, Number(BASE_RATES.Rare || 0.29)) },
      { pool: EPIC_BLUEPRINTS, weight: Math.max(0, Number(BASE_RATES.Epic || 0.025)) },
    ].filter(item => item.pool.length > 0)

    const totalWeight = weightedPools.reduce((sum, item) => sum + item.weight, 0)
    let pool = weightedPools[0]?.pool || COMMON_BLUEPRINTS
    if (totalWeight > 0) {
      let roll = rng.next() * totalWeight
      for (const item of weightedPools) {
        roll -= item.weight
        if (roll <= 0) {
          pool = item.pool
          break
        }
      }
    }

    return createFrom(rng.pick(pool))
  }

  const createToken = (input: {
    templateId: string
    type?: ModuleType
    rarity: ModuleRarity
    plus?: boolean
    stars?: number
  }): ModuleToken => {
    const templateId = String(input.templateId || '').trim()
    const rarity = input.rarity
    const plus = !!input.plus
    const type = input.type || typeByTemplateId.get(templateId)

    if (!templateId || !type) {
      return createRandomToken()
    }

    const visual = createHeadlessVisual(templateId, type, rarity, plus)
    serial += 1
    return {
      instanceId: `tok-${serial}`,
      templateId,
      type,
      rarity,
      plus,
      stars: Number.isFinite(Number(input.stars)) ? Math.max(1, Math.floor(Number(input.stars))) : undefined,
      frameSrc: visual.frameSrc,
      assetSrc: visual.assetSrc,
      frameTextureKey: visual.frameTextureKey,
      assetTextureKey: visual.assetTextureKey,
      matchKey: `${templateId}:${rarity}${plus ? '+' : ''}`,
    }
  }

  return {
    allAssetEntries: [],
    createRandomToken,
    createToken,
  }
}