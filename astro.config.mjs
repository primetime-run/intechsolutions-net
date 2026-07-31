import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: 'https://intechsolutions.net',
  integrations: [sitemap()],

  // 'directory' preserves the WordPress URL shape: every page builds to
  // <path>/index.html, so /business-continuity/ resolves as it did before.
  build: { format: 'directory' },

  // 'ignore' so /foo and /foo/ both resolve in dev, matching how GitHub Pages
  // behaves. Canonical URLs are normalised in Base.astro.
  trailingSlash: 'ignore',
})
