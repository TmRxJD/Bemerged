export type TokenVisual = {
  frameSrc: string
  assetSrc: string
  frameTextureKey: string
  assetTextureKey: string
}

export function textureKeyFromUrl(url: string): string {
  const safe = String(url || '')
  let hash = 0
  for (let index = 0; index < safe.length; index += 1) {
    hash = ((hash * 31) + safe.charCodeAt(index)) >>> 0
  }
  return `asset-${hash.toString(16)}`
}

export function buildTokenVisual(frameSrc: string, assetSrc: string): TokenVisual {
  const safeFrameSrc = String(frameSrc || '').trim()
  const safeAssetSrc = String(assetSrc || '').trim()

  if (!safeFrameSrc || !safeAssetSrc) {
    throw new Error('Invalid token visual: frameSrc and assetSrc are required')
  }

  return {
    frameSrc: safeFrameSrc,
    assetSrc: safeAssetSrc,
    frameTextureKey: textureKeyFromUrl(safeFrameSrc),
    assetTextureKey: textureKeyFromUrl(safeAssetSrc),
  }
}
