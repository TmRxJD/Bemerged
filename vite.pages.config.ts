import { defineConfig } from 'vite'

// Public builds never load the local AI host or its private environment files.
export default defineConfig({
  base: './',
  envDir: '.github/public-env',
  define: {
    'import.meta.env.VITE_BEMERGED_LOCAL_AI_AVAILABLE': JSON.stringify(''),
    'import.meta.env.VITE_BEMERGED_LOCAL_AI_MODULE_SPECIFIER': JSON.stringify(''),
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
