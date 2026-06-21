import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Deployment preset. On Vercel (VERCEL=1) build with the Nitro Vercel preset
// (STACK.md §1). Locally default to `node-server` so `pnpm build` + `pnpm start`
// produce a runnable `.output/server/index.mjs`. Override with NITRO_PRESET.
const preset =
  process.env.NITRO_PRESET ?? (process.env.VERCEL ? 'vercel' : 'node-server')

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({ preset, rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
