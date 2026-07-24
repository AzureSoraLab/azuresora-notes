import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const file = resolve(process.argv[2] || 'outputs/澄墨笔记网站/assets/script-2.js')
const source = await readFile(file, 'utf8')
const before = 'localStorage.setItem(Ds,JSON.stringify(e))},180),r=()=>{n&&(window.clearTimeout(n),n=0),localStorage.setItem(Ds,JSON.stringify(e))}'
const after = 'window.chengmoStorage?.saveNotes?.(e)||localStorage.setItem(Ds,JSON.stringify(e))},180),r=()=>{n&&(window.clearTimeout(n),n=0),window.chengmoStorage?.saveNotes?.(e)||localStorage.setItem(Ds,JSON.stringify(e))}'
const matches = source.split(before).length - 1

if (matches !== 1) throw new Error(`Expected one note-persistence block, found ${matches}.`)

await writeFile(file, source.replace(before, after), 'utf8')
console.log(`Patched ${file}`)
