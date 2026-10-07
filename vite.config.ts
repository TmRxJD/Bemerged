import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const LOCAL_HOST_CONFIG_ID = 'virtual:bemerged-local-host-config'
const RESOLVED_LOCAL_HOST_CONFIG_ID = `\0${LOCAL_HOST_CONFIG_ID}`

type LocalHostConfig = {
  aiAvailable: boolean
  aiModuleSpecifier: string
  aiSource: 'sibling-repo' | 'installed-package' | 'disabled'
}

function toViteFsPath(filePath: string): string {
  return `/@fs/${filePath.replace(/\\/g, '/')}`
}

function resolveLocalHostConfig(rootDir: string): LocalHostConfig {
  const siblingAiEntryPath = path.resolve(rootDir, '..', 'BemergedAI', 'src', 'index.ts')
  if (existsSync(siblingAiEntryPath)) {
    return {
      aiAvailable: true,
      aiModuleSpecifier: toViteFsPath(siblingAiEntryPath),
      aiSource: 'sibling-repo',
    }
  }

  const installedAiPackagePath = path.resolve(rootDir, 'node_modules', '@tmrxjd', 'bemerged-ai', 'package.json')
  if (existsSync(installedAiPackagePath)) {
    return {
      aiAvailable: true,
      aiModuleSpecifier: '@tmrxjd/bemerged-ai',
      aiSource: 'installed-package',
    }
  }

  return {
    aiAvailable: false,
    aiModuleSpecifier: '',
    aiSource: 'disabled',
  }
}

function bemergedLocalHostConfigPlugin(): Plugin {
  let rootDir = process.cwd()

  return {
    name: 'bemerged-local-host-config',
    configResolved(config) {
      rootDir = config.root
    },
    resolveId(id) {
      if (id === LOCAL_HOST_CONFIG_ID) {
        return RESOLVED_LOCAL_HOST_CONFIG_ID
      }
      return null
    },
    load(id) {
      if (id !== RESOLVED_LOCAL_HOST_CONFIG_ID) {
        return null
      }

      const config = resolveLocalHostConfig(rootDir)
      return `export const localHostConfig = ${JSON.stringify(config)};`
    },
  }
}

function resolveClientEnv(mode: string): Record<string, string> {
  const repoEnv = loadEnv(mode, __dirname, '')
  const aiRoot = path.resolve(__dirname, '..', 'BemergedAI')
  const aiEnv = loadEnv(mode, aiRoot, '')
  const localHostConfig = resolveLocalHostConfig(__dirname)
  const pick = (...values: Array<string | undefined>): string => {
    for (const value of values) {
      const normalized = String(value || '').trim()
      if (normalized) return normalized
    }
    return ''
  }

  return {
    'import.meta.env.VITE_BEMERGEDAI_CLOUD_AI_API_KEY': JSON.stringify(pick(
      repoEnv.VITE_BEMERGEDAI_CLOUD_AI_API_KEY,
      repoEnv.BEMERGEDAI_CLOUD_AI_API_KEY,
      aiEnv.VITE_BEMERGEDAI_CLOUD_AI_API_KEY,
      aiEnv.BEMERGEDAI_CLOUD_AI_API_KEY,
    )),
    'import.meta.env.VITE_BEMERGEDAI_CLOUD_AI_ENDPOINT': JSON.stringify(pick(
      repoEnv.VITE_BEMERGEDAI_CLOUD_AI_ENDPOINT,
      repoEnv.BEMERGEDAI_CLOUD_AI_ENDPOINT,
      aiEnv.VITE_BEMERGEDAI_CLOUD_AI_ENDPOINT,
      aiEnv.BEMERGEDAI_CLOUD_AI_ENDPOINT,
    )),
    'import.meta.env.VITE_BEMERGEDAI_CLOUD_VISION_MODEL': JSON.stringify(pick(
      repoEnv.VITE_BEMERGEDAI_CLOUD_VISION_MODEL,
      repoEnv.BEMERGEDAI_CLOUD_VISION_MODEL,
      aiEnv.VITE_BEMERGEDAI_CLOUD_VISION_MODEL,
      aiEnv.BEMERGEDAI_CLOUD_VISION_MODEL,
    )),
    'import.meta.env.VITE_BEMERGEDAI_CLOUD_REASONING_MODEL': JSON.stringify(pick(
      repoEnv.VITE_BEMERGEDAI_CLOUD_REASONING_MODEL,
      repoEnv.BEMERGEDAI_CLOUD_REASONING_MODEL,
      aiEnv.VITE_BEMERGEDAI_CLOUD_REASONING_MODEL,
      aiEnv.BEMERGEDAI_CLOUD_REASONING_MODEL,
    )),
    'import.meta.env.VITE_BEMERGEDAI_CLOUD_DEEP_REASONING_MODEL': JSON.stringify(pick(
      repoEnv.VITE_BEMERGEDAI_CLOUD_DEEP_REASONING_MODEL,
      repoEnv.BEMERGEDAI_CLOUD_DEEP_REASONING_MODEL,
      aiEnv.VITE_BEMERGEDAI_CLOUD_DEEP_REASONING_MODEL,
      aiEnv.BEMERGEDAI_CLOUD_DEEP_REASONING_MODEL,
    )),
    'import.meta.env.VITE_BEMERGEDAI_CLOUD_FAST_REASONING_MODEL': JSON.stringify(pick(
      repoEnv.VITE_BEMERGEDAI_CLOUD_FAST_REASONING_MODEL,
      repoEnv.BEMERGEDAI_CLOUD_FAST_REASONING_MODEL,
      repoEnv.VITE_BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL,
      repoEnv.BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL,
      aiEnv.VITE_BEMERGEDAI_CLOUD_FAST_REASONING_MODEL,
      aiEnv.BEMERGEDAI_CLOUD_FAST_REASONING_MODEL,
      aiEnv.VITE_BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL,
      aiEnv.BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL,
    )),
    'import.meta.env.VITE_BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL': JSON.stringify(pick(
      repoEnv.VITE_BEMERGEDAI_CLOUD_FAST_REASONING_MODEL,
      repoEnv.BEMERGEDAI_CLOUD_FAST_REASONING_MODEL,
      repoEnv.VITE_BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL,
      repoEnv.BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL,
      aiEnv.VITE_BEMERGEDAI_CLOUD_FAST_REASONING_MODEL,
      aiEnv.BEMERGEDAI_CLOUD_FAST_REASONING_MODEL,
      aiEnv.VITE_BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL,
      aiEnv.BEMERGEDAI_CLOUD_FALLBACK_REASONING_MODEL,
    )),
    'import.meta.env.VITE_BEMERGEDAI_SEMANTIC_MODEL': JSON.stringify(pick(
      repoEnv.VITE_BEMERGEDAI_SEMANTIC_MODEL,
      repoEnv.BEMERGEDAI_SEMANTIC_MODEL,
      aiEnv.VITE_BEMERGEDAI_SEMANTIC_MODEL,
      aiEnv.BEMERGEDAI_SEMANTIC_MODEL,
    )),
    'import.meta.env.VITE_BEMERGED_LOCAL_AI_AVAILABLE': JSON.stringify(localHostConfig.aiAvailable ? 'true' : ''),
    'import.meta.env.VITE_BEMERGED_LOCAL_AI_MODULE_SPECIFIER': JSON.stringify(localHostConfig.aiModuleSpecifier),
    'import.meta.env.VITE_BEMERGED_LOCAL_AI_SOURCE': JSON.stringify(localHostConfig.aiSource),
  }
}

export default defineConfig(({ mode }) => ({
  define: resolveClientEnv(mode),
  plugins: [bemergedLocalHostConfigPlugin()],
  server: {
    host: 'localhost',
    port: 5179,
    strictPort: true,
    hmr: {
      host: 'localhost',
      port: 5179,
    },
    fs: {
      allow: [
        '.',
        path.resolve(__dirname, '..', 'BemergedAI'),
      ],
    },
  },
  preview: {
    host: 'localhost',
    port: 5179,
    strictPort: true,
  },
}))