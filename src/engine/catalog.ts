import { resolveAssetsForModule } from './moduleData'
import { BASE_RATES, COMMON_TEMPLATES, EPIC_TEMPLATES, RARE_TEMPLATES, type TemplateLike } from './moduleTemplates'
import type { ModuleRarity, ModuleToken, ModuleType } from './types'
import { SeededRng } from './rng'
import { buildTokenVisual } from './tokenVisual'

type TokenBlueprint = {
  templateId: string
  type: ModuleType
  rarity: ModuleRarity
  plus: boolean
  frameSrc: string
  assetSrc: string
  frameTextureKey: string
  assetTextureKey: string
  matchKey: string
}

const commonTemplates = COMMON_TEMPLATES as TemplateLike[]
const rareTemplates = RARE_TEMPLATES as TemplateLike[]
const epicTemplates = EPIC_TEMPLATES as TemplateLike[]

function buildBlueprint(template: TemplateLike, rarity: ModuleRarity): TokenBlueprint {
  const moduleLike: Record<string, unknown> = {
    templateId: template.id,
    type: template.type,
    rarity,
    plus: false,
  }
  resolveAssetsForModule(moduleLike)

  const frameSrc = String(moduleLike._frameSrc || '')
  const assetSrc = String(moduleLike._assetSrc || '')

  if (!frameSrc || !assetSrc) {
    throw new Error(`Missing resolved assets for ${template.id} (${rarity})`)
  }

  const visual = buildTokenVisual(frameSrc, assetSrc)

  return {
    templateId: template.id,
    type: template.type,
    rarity,
    plus: false,
    frameSrc: visual.frameSrc,
    assetSrc: visual.assetSrc,
    frameTextureKey: visual.frameTextureKey,
    assetTextureKey: visual.assetTextureKey,
    matchKey: `${template.id}:${rarity}`,
  }
}

function tryBuildBlueprint(template: TemplateLike, rarity: ModuleRarity): TokenBlueprint | null {
  try {
    return buildBlueprint(template, rarity)
  } catch (error) {
    console.warn(
      `[BeMerged] Skipping template ${template.id} (${rarity}) due to missing assets`,
      error,
    )
    return null
  }
}

const COMMON_BLUEPRINTS = commonTemplates
  .map(template => tryBuildBlueprint(template, 'Common'))
  .filter((item): item is TokenBlueprint => Boolean(item))
const RARE_BLUEPRINTS = rareTemplates
  .map(template => tryBuildBlueprint(template, 'Rare'))
  .filter((item): item is TokenBlueprint => Boolean(item))
const EPIC_BLUEPRINTS = epicTemplates
  .map(template => tryBuildBlueprint(template, 'Epic'))
  .filter((item): item is TokenBlueprint => Boolean(item))

export type ModuleCatalog = {
  allAssetEntries: Array<{ key: string; url: string }>
  createRandomToken: () => ModuleToken
  createToken: (input: {
    templateId: string
    type?: ModuleType
    rarity: ModuleRarity
    plus?: boolean
    stars?: number
  }) => ModuleToken
}

export function createModuleCatalog(rng: SeededRng): ModuleCatalog {
  if (COMMON_BLUEPRINTS.length === 0 && RARE_BLUEPRINTS.length === 0 && EPIC_BLUEPRINTS.length === 0) {
    throw new Error('No BeMerged module blueprints were resolved from assets')
  }

  let serial = 0

  const allAssetEntries = Array.from(new Map(
    [...COMMON_BLUEPRINTS, ...RARE_BLUEPRINTS, ...EPIC_BLUEPRINTS]
      .flatMap(item => [
        [item.frameTextureKey, { key: item.frameTextureKey, url: item.frameSrc }],
        [item.assetTextureKey, { key: item.assetTextureKey, url: item.assetSrc }],
      ]),
  ).values())

  const typeByTemplateId = new Map<string, ModuleType>()
  for (const template of [...commonTemplates, ...rareTemplates, ...epicTemplates]) {
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
    const explicitType = input.type
    const type = explicitType || typeByTemplateId.get(templateId)

    if (!templateId || !type) {
      return createRandomToken()
    }

    const moduleLike: Record<string, unknown> = {
      templateId,
      type,
      rarity,
      plus,
      stars: Number.isFinite(Number(input.stars)) ? Math.max(1, Math.floor(Number(input.stars))) : undefined,
    }
    resolveAssetsForModule(moduleLike)
    const visual = buildTokenVisual(
      String(moduleLike._frameSrc || ''),
      String(moduleLike._assetSrc || ''),
    )

    serial += 1
    return {
      instanceId: `tok-${serial}`,
      templateId,
      type,
      rarity,
      plus,
      stars: Number.isFinite(Number(moduleLike.stars)) ? Math.max(1, Math.floor(Number(moduleLike.stars))) : undefined,
      frameSrc: visual.frameSrc,
      assetSrc: visual.assetSrc,
      frameTextureKey: visual.frameTextureKey,
      assetTextureKey: visual.assetTextureKey,
      matchKey: `${templateId}:${rarity}${plus ? '+' : ''}`,
    }
  }

  const createRandomToken = (): ModuleToken => {
    const rareAvailable = RARE_BLUEPRINTS.length > 0
    const commonAvailable = COMMON_BLUEPRINTS.length > 0
    const epicAvailable = EPIC_BLUEPRINTS.length > 0

    let pool: TokenBlueprint[]
    if (!commonAvailable && !rareAvailable) {
      pool = EPIC_BLUEPRINTS
    } else if (!commonAvailable && !epicAvailable) {
      pool = RARE_BLUEPRINTS
    } else if (!rareAvailable && !epicAvailable) {
      pool = COMMON_BLUEPRINTS
    } else {
      const commonRate = Math.max(0, Number(BASE_RATES.Common || 0.685))
      const rareRate = Math.max(0, Number(BASE_RATES.Rare || 0.29))
      const epicRate = Math.max(0, Number(BASE_RATES.Epic || 0.025))
      const weightedPools: Array<{ pool: TokenBlueprint[]; weight: number }> = []
      if (commonAvailable) weightedPools.push({ pool: COMMON_BLUEPRINTS, weight: commonRate })
      if (rareAvailable) weightedPools.push({ pool: RARE_BLUEPRINTS, weight: rareRate })
      if (epicAvailable) weightedPools.push({ pool: EPIC_BLUEPRINTS, weight: epicRate })

      const totalWeight = weightedPools.reduce((sum, item) => sum + item.weight, 0)
      if (totalWeight <= 0) {
        pool = commonAvailable ? COMMON_BLUEPRINTS : (rareAvailable ? RARE_BLUEPRINTS : EPIC_BLUEPRINTS)
      } else {
        let roll = rng.next() * totalWeight
        pool = weightedPools[0].pool
        for (const item of weightedPools) {
          roll -= item.weight
          if (roll <= 0) {
            pool = item.pool
            break
          }
        }
      }
    }

    return createFrom(rng.pick(pool))
  }

  return {
    allAssetEntries,
    createRandomToken,
    createToken,
  }
}
