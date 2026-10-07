declare module 'virtual:bemerged-local-host-config' {
  export const localHostConfig: {
    aiAvailable: boolean
    aiModuleSpecifier: string
    aiSource: 'sibling-repo' | 'installed-package' | 'disabled'
  }
}

export {}