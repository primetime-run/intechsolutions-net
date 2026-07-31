/**
 * Fail the build if any URL WordPress used to serve stopped resolving.
 *
 * Routes are generated from each entry's `originalUrl`, so this is the guard
 * that keeps a refactor from silently breaking inbound links and search
 * rankings. Runs in CI before anything is uploaded.
 */
import fs from 'node:fs'
import path from 'node:path'

const inventory = JSON.parse(fs.readFileSync('url-inventory.json', 'utf8'))
const required = ['index.html', '404.html', 'sitemap-index.xml', 'robots.txt']

let missing = []

for (const entry of inventory) {
  const rel = entry.from.replace(/^\/|\/$/g, '')
  const file = rel ? path.join('dist', rel, 'index.html') : path.join('dist', 'index.html')
  if (!fs.existsSync(file)) missing.push(entry.from)
}

for (const f of required) {
  if (!fs.existsSync(path.join('dist', f))) missing.push(`/${f}`)
}

if (missing.length) {
  console.error(`\nURL verification FAILED — ${missing.length} missing:`)
  for (const m of missing) console.error(`  ${m}`)
  process.exit(1)
}

console.log(`URL verification passed: ${inventory.length} original URLs + ${required.length} required files.`)
