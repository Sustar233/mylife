import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/weapp/', import.meta.url))

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) return collect(target)
    return entry.name.endsWith('.wxss') ? [target] : []
  }))
  return nested.flat()
}

const files = await collect(root)
const universalSelector = /(^|[},])\s*\*([,:.{#\[]|\s)/m
const failures = []

for (const file of files) {
  const content = await readFile(file, 'utf8')
  if (universalSelector.test(content)) failures.push(`${file}: 微信 WXSS 不支持通配选择器 *`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`WXSS compatibility check passed (${files.length} files).`)
}
