import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const deliveryPath = resolve(process.argv[2] || 'outputs/澄墨笔记网站/index.html')
const assetDir = join(dirname(deliveryPath), 'assets')
const source = await readFile(deliveryPath, 'utf8')

if (source.includes('data-chengmo-external-assets')) {
  throw new Error('The delivery page already references external assets.')
}

await mkdir(assetDir, { recursive: true })

let styleIndex = 0
const htmlWithStyles = source.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_match, attributes, css) => {
  // Keep the tiny session-restoration rule inline so the reader never flashes
  // the default note before the saved session has been restored.
  if (styleIndex === 0) {
    styleIndex += 1
    return `<style${attributes}>${css}</style>`
  }
  const name = `style-${styleIndex}.css`
  styleIndex += 1
  return `__CHENGMO_STYLE_${name}__`
})

let scriptIndex = 0
const htmlWithAssets = htmlWithStyles.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (_match, attributes, script) => {
  // The first script is the synchronous session bootstrap and must remain
  // inline for the no-flash restoration behavior.
  if (scriptIndex === 0) {
    scriptIndex += 1
    return `<script${attributes}>${script}</script>`
  }
  const name = `script-${scriptIndex}.js`
  scriptIndex += 1
  return `__CHENGMO_SCRIPT_${name}:${attributes}__`
})

const styles = [...source.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)]
for (let index = 1; index < styles.length; index += 1) {
  await writeFile(join(assetDir, `style-${index}.css`), styles[index][2], 'utf8')
}

const scripts = [...source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
for (let index = 1; index < scripts.length; index += 1) {
  await writeFile(join(assetDir, `script-${index}.js`), scripts[index][2], 'utf8')
}

const output = htmlWithAssets
  .replace(/__CHENGMO_STYLE_([^_]+)__/g, (_match, name) => `<link rel="stylesheet" href="./assets/${name}">`)
  .replace(/__CHENGMO_SCRIPT_([^:]+):(.*?)__/g, (_match, name, attributes) => `<script${attributes} src="./assets/${name}"></script>`)
  .replace('<head>', '<head>\n    <meta data-chengmo-external-assets="true">')

await writeFile(deliveryPath, output, 'utf8')
console.log(`Externalized ${styles.length - 1} style sheets and ${scripts.length - 1} scripts into ${assetDir}`)
