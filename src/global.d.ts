declare module '*.png' {
  const value: string
  export default value
}

declare module '*.jpg' {
  const value: string
  export default value
}

declare module '*.jpeg' {
  const value: string
  export default value
}

declare module '*.webp' {
  const value: string
  export default value
}

declare module '*.gif' {
  const value: string
  export default value
}

declare module '*.svg' {
  const value: string
  export default value
}

declare module '*.css' {
  const value: string
  export default value
}

declare module '*.html?raw' {
  const value: string
  export default value
}

interface ImportMetaEnv {
  readonly VITE_BEMERGED_LOCAL_AI_AVAILABLE?: string
  readonly VITE_BEMERGED_LOCAL_AI_MODULE_SPECIFIER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'virtual:bemerged-local-host-config' {
  export const localHostConfig: {
    aiAvailable: boolean
    aiModuleSpecifier: string
    aiSource: 'sibling-repo' | 'installed-package' | 'disabled'
  }
}