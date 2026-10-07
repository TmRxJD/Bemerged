import { ASSETS } from '../assets'
import {
  BASE_RATES,
  COMMON_TEMPLATES,
  EPIC_TEMPLATES,
  RARE_TEMPLATES,
} from './moduleTemplates'

type AssetDirectory = keyof typeof ASSETS
type AssetMap = Record<string, string>

const moduleAssetDirectoryByType: Record<string, AssetDirectory> = {
  generator: 'modules_generator',
  core: 'modules_core',
  armor: 'modules_armor',
  cannon: 'modules_cannon',
}

export { BASE_RATES, COMMON_TEMPLATES, EPIC_TEMPLATES, RARE_TEMPLATES }

function findAssetByKey(assetKey: string): string | null {
  for (const dir of Object.keys(ASSETS) as AssetDirectory[]) {
    const map = ASSETS[dir] as AssetMap
    if (map[assetKey]) {
      return map[assetKey]
    }
  }
  return null
}

export function resolveAssetsForModule(moduleLike: Record<string, unknown>): void {
  const moduleType = String(moduleLike.type || 'Core').toLowerCase()
  const assetDirectory = moduleAssetDirectoryByType[moduleType] ?? 'modules_core'
  const map = ASSETS[assetDirectory] as AssetMap

  const rarity = String(moduleLike.rarity || 'Common').toLowerCase()
  const plus = !!moduleLike.plus
  const templateId = String(moduleLike.templateId || '').trim().toLowerCase()
  const templateStem = templateId.includes('_') ? templateId.split('_')[0] : templateId

  let frameKey = `mf_${rarity}${plus ? '_plus' : ''}`
  if (!map[frameKey]) {
    frameKey = map.mf_common ? 'mf_common' : (map.mf_empty ? 'mf_empty' : '')
  }

  let assetKey = ''
  if (templateId) {
    const candidates = Array.from(new Set([templateId, templateStem].filter(Boolean)))
    for (const candidate of candidates) {
      const rarityTemplateKey = `${rarity}_${candidate}`
      if (map[rarityTemplateKey]) {
        assetKey = rarityTemplateKey
        break
      }
      if (map[`rare_${candidate}`]) {
        assetKey = `rare_${candidate}`
        break
      }
      if (map[`common_${candidate}`]) {
        assetKey = `common_${candidate}`
        break
      }
      const match = Object.keys(map).find(key => key.toLowerCase().endsWith(`_${candidate}`))
      if (match) {
        assetKey = match
        break
      }
    }
  }

  if (!assetKey && rarity === 'common') {
    const commonKey = Object.keys(map).find(key => key.startsWith('common_'))
    if (commonKey) {
      assetKey = commonKey
    }
  }

  if (!assetKey) {
    const anyCommon = findAssetByKey('common_mc') || findAssetByKey('common_ec')
    if (anyCommon) {
      moduleLike._assetSrc = anyCommon
      moduleLike._frameSrc = frameKey ? (map[frameKey] || findAssetByKey(frameKey) || '') : ''
      return
    }
  }

  const frameSrc = frameKey ? (map[frameKey] || findAssetByKey(frameKey) || '') : ''
  const assetSrc = assetKey ? (map[assetKey] || findAssetByKey(assetKey) || '') : ''

  moduleLike._frameSrc = frameSrc
  moduleLike._assetSrc = assetSrc

  if (!frameSrc || !assetSrc) {
    throw new Error(`Unable to resolve assets for ${String(moduleLike.templateId || 'unknown')} (${String(moduleLike.rarity || 'unknown')})`)
  }
}
