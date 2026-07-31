/**
 * Rasterise public/favicon.svg into the PNG sizes that SVG favicons don't cover:
 * iOS home-screen icons and PWA manifest icons, neither of which accept SVG.
 *
 * Uses the sharp that ships with Astro, so there is no extra dependency.
 * Run with: npm run icons
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'public', 'favicon.svg')
const svg = fs.readFileSync(src)

const targets = [
  { file: 'apple-touch-icon.png', size: 180 }, // iOS home screen
  { file: 'icon-192.png', size: 192 }, // PWA manifest
  { file: 'icon-512.png', size: 512 }, // PWA splash / install prompt
]

for (const { file, size } of targets) {
  const out = path.join(root, 'public', file)
  await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out)
  console.log(`  ${file.padEnd(22)} ${size}x${size}  ${fs.statSync(out).size.toLocaleString()} B`)
}

// Maskable icon: Android crops home-screen icons to arbitrary shapes and only
// guarantees the middle ~80%. Inset the mark on a full-bleed background so the
// corners can be clipped without eating the letters.
{
  const size = 512
  const inner = Math.round(size * 0.62)
  const pad = Math.round((size - inner) / 2)
  const out = path.join(root, 'public', 'icon-maskable-512.png')
  const mark = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: '#1f6feb' },
  })
    .composite([{ input: mark, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toFile(out)
  console.log(`  ${'icon-maskable-512.png'.padEnd(22)} ${size}x${size}  ${fs.statSync(out).size.toLocaleString()} B`)
}
