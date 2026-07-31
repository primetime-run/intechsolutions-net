import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    /** Position in the services grid and nav. */
    order: z.number(),
    /** One-line description for cards and meta descriptions. */
    summary: z.string(),
    icon: z.enum(['shield', 'server', 'cloud', 'lock', 'phone', 'camera', 'cable']),
    // The path this page lived at on WordPress. Routes are generated from this
    // field so URLs — and therefore SEO — survive the migration exactly.
    originalUrl: z.string(),
    draft: z.boolean().default(false),
  }),
})

export const collections = { services }
