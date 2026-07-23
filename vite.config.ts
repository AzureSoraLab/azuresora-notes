import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => {
  const portable = mode === 'portable'
  return {
    base: portable ? './' : '/',
    plugins: [react(), ...(portable ? [viteSingleFile()] : [])],
    build: portable ? { outDir: 'outputs/澄墨笔记网站', emptyOutDir: true } : undefined,
  }
})
