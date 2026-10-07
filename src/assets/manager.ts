export function createAssetManager({
  ASSETS: _ASSETS,
  BACKGROUNDS,
  HARDCODED_COMMON_SELECTION: _HARDCODED_COMMON_SELECTION,
  RARITY_COLOR: _RARITY_COLOR,
  MINE_ASSET: _MINE_ASSET,
  TYPE_TOKENS: _TYPE_TOKENS,
  createModuleInstance: _createModuleInstance,
  normalizeId: _normalizeId,
  stableHash: _stableHash,
  appendToDebug: _appendToDebug,
}: {
  ASSETS: Record<string, unknown>
  BACKGROUNDS: Record<string, string>
  HARDCODED_COMMON_SELECTION: Record<string, string>
  RARITY_COLOR: Record<string, string>
  MINE_ASSET: string
  TYPE_TOKENS: Record<string, string>
  createModuleInstance: (...args: unknown[]) => unknown
  normalizeId: (id: string) => string
  stableHash: (value: string) => number
  appendToDebug: (message: string) => void
}) {
  const __commonVariantCounters = {}
  function pickCommonVariant(dirKey, tmpl, map) {
    const candidates: string[] = []
    if (tmpl) {
      const exact = 'common_' + tmpl
      if (map[exact]) {
        candidates.push(exact)
      }
      for (const k of Object.keys(map)) {
        if (k.startsWith('common_') && k.endsWith('_' + tmpl) && !candidates.includes(k)) {
          candidates.push(k)
        }
      }
    }
    if (candidates.length === 0) {
      for (const k of Object.keys(map)) {
        if (k.startsWith('common_')) {
          candidates.push(k)
        }
      }
    }
    if (candidates.length === 0) {
      return null
    }
    const keyBase = dirKey + '::' + (tmpl || '__any__')
    const idx = __commonVariantCounters[keyBase] || 0
    const chosen = candidates[idx % candidates.length]
    __commonVariantCounters[keyBase] = (idx + 1) % candidates.length
    return chosen
  }
  function applyBackground(key) {
    try {
      if (!key) {
        const html = document.documentElement
        const body = document.body
        html.style.backgroundImage = ''
        html.style.backgroundSize = ''
        html.style.backgroundPosition = ''
        html.style.backgroundRepeat = ''
        html.style.backgroundAttachment = ''
        html.style.backgroundColor = ''
        html.style.height = ''
        html.style.minHeight = ''
        body.style.backgroundImage = ''
        body.style.backgroundSize = ''
        body.style.backgroundPosition = ''
        body.style.backgroundRepeat = ''
        body.style.backgroundAttachment = ''
        body.style.backgroundColor = ''
        body.style.height = ''
        body.style.minHeight = ''
        try {
          localStorage.setItem('background', '')
        } catch (e) { throw e }
        return
      }
      const url = BACKGROUNDS[key]
      if (!url) {
        const html = document.documentElement
        const body = document.body
        html.style.backgroundImage = ''
        html.style.backgroundSize = ''
        html.style.backgroundPosition = ''
        html.style.backgroundRepeat = ''
        html.style.backgroundAttachment = ''
        html.style.backgroundColor = ''
        html.style.height = ''
        html.style.minHeight = ''
        body.style.backgroundImage = ''
        body.style.backgroundSize = ''
        body.style.backgroundPosition = ''
        body.style.backgroundRepeat = ''
        body.style.backgroundAttachment = ''
        body.style.backgroundColor = ''
        body.style.height = ''
        body.style.minHeight = ''
        try {
          localStorage.setItem('background', '')
        } catch (e) { throw e }
        return
      }
      try {
        const html = document.documentElement
        const body = document.body
        html.style.height = '100%'
        html.style.minHeight = '100vh'
        body.style.height = '100%'
        body.style.minHeight = '100vh'

        html.style.backgroundImage = `url("${url}")`
        html.style.backgroundSize = 'cover'
        html.style.backgroundPosition = 'center center'
        html.style.backgroundRepeat = 'no-repeat'
        html.style.backgroundAttachment = 'fixed'
        html.style.backgroundColor = '#000'

        body.style.backgroundImage = `url("${url}")`
        body.style.backgroundSize = 'cover'
        body.style.backgroundPosition = 'center center'
        body.style.backgroundRepeat = 'no-repeat'
        body.style.backgroundAttachment = 'fixed'
        body.style.backgroundColor = 'transparent'
      } catch (e) { throw e }
      try {
        localStorage.setItem('background', key)
      } catch (e) { throw e }
    } catch (e) { throw e }
  }

  return {
    pickCommonVariant,
    applyBackground,
  }
}
