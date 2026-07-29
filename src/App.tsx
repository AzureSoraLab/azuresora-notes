import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'

marked.use(markedKatex({ throwOnError: false, nonStandard: true }))

type Category = { id: string; name: string; color: string }
type Annotation = { id: string; quote: string; start: number; end: number; color: string; kind: 'highlight' | 'underline' }
type Note = { id: string; title: string; content: string; categoryId: string; tags: string[]; updatedAt: string; annotations: Annotation[] }
type Store = { categories: Category[]; notes: Note[] }
type SelectionMenu = { x: number; y: number; start: number; end: number; quote: string }

const storageKey = 'chengmo-notes-v3'
const uid = () => crypto.randomUUID()
const categoryColors = ['#7596b7', '#a8846d', '#728f78', '#ad8192']
const annotationColors = ['#f8d84b', '#ff6b6b', '#72b64a', '#3ca8df', '#a687e8', '#d86ee8', '#f39a3e', '#a7aaa5']
const sample = `# 傅里叶变换：频域视角

傅里叶变换把时域信号分解为不同频率的正弦分量。它回答的核心问题是：**信号由哪些频率构成，每个频率占多大权重？**

## 连续时间傅里叶变换

对于绝对可积信号 $x(t)$，定义为：

$$
X(\\omega) = \\int_{-\\infty}^{+\\infty} x(t)e^{-j\\omega t}\\,dt
$$

## 复习提示

先判断时移、频移还是尺度变换，再直接调用性质。`
const initial: Store = {
  categories: [
    { id: 'signals', name: '信号与系统', color: categoryColors[0] },
    { id: 'digital', name: '数字电路', color: categoryColors[1] },
    { id: 'comm', name: '通信原理', color: categoryColors[2] },
  ],
  notes: [{ id: 'fourier', title: '傅里叶变换：频域视角', categoryId: 'signals', content: sample, tags: ['傅里叶变换', '频谱'], updatedAt: '2026-07-23T08:30:00.000Z', annotations: [] }],
}

function load(): Store {
  try { return JSON.parse(localStorage.getItem(storageKey) || '') } catch { return initial }
}
function safe(input: string) { return input.replace(/<\/?(script|iframe|object|embed)[^>]*>/gi, '') }
function headings(content: string) { return [...content.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m, i) => ({ id: `section-${i}`, text: m[2].replace(/[*_`]/g, ''), level: m[1].length })) }

const renderedMarkdownCache = new Map<string, string>()
const renderedMarkdownCacheLimit = 24
const mathDelimiterPattern = /\r|^ {0,3}(?:\$\$|\\\[|\\\])[ \t]*$|\\\([^\n]+?\\\)/m

function findCodeSpanEnd(content: string, start: number, marker: string) {
  const end = content.indexOf(marker, start + marker.length)
  return end < 0 ? content.length : end + marker.length
}

function findFenceEnd(content: string, start: number, marker: string) {
  const markerChar = marker[0]
  const markerLength = marker.length
  let cursor = content.indexOf('\n', start) + 1
  while (cursor > 0 && cursor < content.length) {
    const lineEnd = content.indexOf('\n', cursor)
    const end = lineEnd < 0 ? content.length : lineEnd
    const line = content.slice(cursor, end)
    const match = line.match(/^[ \t]{0,3}([`~]+)[ \t]*$/)
    if (match && match[1][0] === markerChar && match[1].length >= markerLength) return lineEnd < 0 ? end : lineEnd + 1
    cursor = lineEnd < 0 ? content.length : lineEnd + 1
  }
  return content.length
}

function normalizeOutsideCode(content: string, normalizeText: (text: string) => string) {
  let result = ''
  let cursor = 0
  while (cursor < content.length) {
    const lineStart = cursor === 0 || content[cursor - 1] === '\n'
    const fence = lineStart && content.slice(cursor).match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (fence) {
      const start = cursor + fence[0].indexOf(fence[1])
      result += normalizeText(content.slice(0, start))
      const end = findFenceEnd(content, start, fence[1])
      result += content.slice(start, end)
      content = content.slice(end)
      cursor = 0
      continue
    }
    if (content[cursor] === '`') {
      let markerEnd = cursor
      while (content[markerEnd] === '`') markerEnd++
      const marker = content.slice(cursor, markerEnd)
      result += normalizeText(content.slice(0, cursor))
      const end = findCodeSpanEnd(content, cursor, marker)
      result += content.slice(cursor, end)
      content = content.slice(end)
      cursor = 0
      continue
    }
    cursor++
  }
  return result + normalizeText(content)
}

function normalizeMathDelimiters(content: string) {
  // Preserve code examples while making common editor input unambiguous to KaTeX.
  if (!mathDelimiterPattern.test(content)) return content
  const normalizeText = (text: string) => text
    .replace(/^ {0,3}\$\$[ \t]*$/gm, () => '$$')
    .replace(/^ {0,3}\\\[[ \t]*$/gm, () => '$$')
    .replace(/^ {0,3}\\\][ \t]*$/gm, () => '$$')
    .replace(/\\\(([^\n]+?)\\\)/g, (match, formula, offset, source) => {
      let precedingBackslashes = 0
      for (let index = offset - 1; source[index] === '\\'; index--) precedingBackslashes++
      return precedingBackslashes % 2 ? match : `$${formula}$`
    })

  const normalized = content.replace(/\r\n?/g, '\n')
  return normalizeOutsideCode(normalized, normalizeText)
}

function renderCacheKey(content: string, annotations: Annotation[]) {
  return `${content}\0${annotations.map(({ id, start, end, color, kind }) => `${id}:${start}:${end}:${color}:${kind}`).join('|')}`
}

function renderMarkdown(content: string, annotations: Annotation[]) {
  const cacheKey = renderCacheKey(content, annotations)
  const cached = renderedMarkdownCache.get(cacheKey)
  if (cached) return cached

  const normalizedContent = normalizeMathDelimiters(content)
  let result = safe(marked.parse(normalizedContent, { async: false, breaks: true }) as string)
  let headingIndex = 0
  result = result.replace(/<h([1-3])>/g, (_, level) => `<h${level} id="section-${headingIndex++}">`)
  if (!annotations.length) return cacheMarkdown(cacheKey, result)

  const doc = new DOMParser().parseFromString(result, 'text/html')
  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) textNodes.push(node)

  // Apply from the end so original character offsets remain stable.
  for (const annotation of [...annotations].sort((a, b) => b.start - a.start)) {
    let offset = 0
    for (const textNode of textNodes) {
      const nodeStart = offset
      const nodeEnd = offset + textNode.data.length
      offset = nodeEnd
      const start = Math.max(annotation.start, nodeStart)
      const end = Math.min(annotation.end, nodeEnd)
      if (start >= end || !textNode.parentNode) continue
      const before = textNode.data.slice(0, start - nodeStart)
      const selected = textNode.data.slice(start - nodeStart, end - nodeStart)
      const after = textNode.data.slice(end - nodeStart)
      const fragment = doc.createDocumentFragment()
      if (before) fragment.append(before)
      const mark = doc.createElement('mark')
      mark.className = `annotation ${annotation.kind}`
      mark.dataset.id = annotation.id
      mark.style.setProperty('--annotation-color', annotation.color)
      mark.textContent = selected
      fragment.append(mark)
      if (after) fragment.append(after)
      textNode.parentNode.replaceChild(fragment, textNode)
    }
  }
  return cacheMarkdown(cacheKey, doc.body.innerHTML)
}

function cacheMarkdown(cacheKey: string, html: string) {
  if (renderedMarkdownCache.size >= renderedMarkdownCacheLimit) renderedMarkdownCache.delete(renderedMarkdownCache.keys().next().value!)
  renderedMarkdownCache.set(cacheKey, html)
  return html
}

export default function App() {
  const [store, setStore] = useState<Store>(load)
  const [categoryId, setCategoryId] = useState(store.categories[0]?.id || '')
  const [noteId, setNoteId] = useState(store.notes[0]?.id || '')
  const [listOpen, setListOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<SelectionMenu | null>(null)
 const [annotationKind, setAnnotationKind] = useState<Annotation['kind']>('highlight')
 const readerRef = useRef<HTMLElement>(null)
  const saveTimerRef = useRef<number | undefined>(undefined)
 const note = store.notes.find(item => item.id === noteId)
 const category = store.categories.find(item => item.id === categoryId)
 const notes = store.notes.filter(item => item.categoryId === categoryId && `${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase()))
 const outline = useMemo(() => note ? headings(note.content) : [], [note?.content])
  const rendered = useMemo(() => {
    if (editing || !note) return ''
    return renderMarkdown(note.content, note.annotations || [])
  }, [note?.content, note?.annotations, editing])

  useEffect(() => {
    const timer = saveTimerRef.current
    if (timer) clearTimeout(timer)
    saveTimerRef.current = window.setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(store))
    }, 500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [store])
 function patch(changes: Partial<Note>) {
    if (!note) return
    setStore(value => ({ ...value, notes: value.notes.map(item => item.id === note.id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item) }))
  }
  function toggleCategory(id: string) {
    const close = id === categoryId && listOpen
    setCategoryId(id); setQuery(''); setListOpen(!close)
  }
  function createCategory() {
    const name = prompt('新分类名称')?.trim()
    if (!name) return
    const item = { id: uid(), name, color: categoryColors[store.categories.length % categoryColors.length] }
    setStore(value => ({ ...value, categories: [...value.categories, item] })); setCategoryId(item.id)
  }
  function renameCategory(item: Category) {
    const name = prompt('修改分类名称', item.name)?.trim()
    if (name) setStore(value => ({ ...value, categories: value.categories.map(category => category.id === item.id ? { ...category, name } : category) }))
  }
  function createNote() {
    const item: Note = { id: uid(), title: '新笔记', content: '# 新笔记\\n\\n', categoryId, tags: [], updatedAt: new Date().toISOString(), annotations: [] }
    setStore(value => ({ ...value, notes: [item, ...value.notes] })); setNoteId(item.id); setEditing(true)
  }
  function textOffset(root: HTMLElement, container: Node, offset: number) {
    const range = document.createRange(); range.selectNodeContents(root); range.setEnd(container, offset)
    return range.toString().length
  }
  function onSelection() {
    if (!readerRef.current) return
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const quote = selection?.toString().trim() || ''
    if (!range || !quote || !readerRef.current.contains(range.commonAncestorContainer)) { setMenu(null); return }
    const rect = range.getBoundingClientRect()
    setMenu({ x: rect.left + rect.width / 2, y: Math.max(8, rect.bottom + 10), start: textOffset(readerRef.current, range.startContainer, range.startOffset), end: textOffset(readerRef.current, range.endContainer, range.endOffset), quote })
  }
  function annotate(color: string) {
    if (!note || !menu) return
    patch({ annotations: [...(note.annotations || []), { id: uid(), quote: menu.quote, start: menu.start, end: menu.end, color, kind: annotationKind }] })
    window.getSelection()?.removeAllRanges(); setMenu(null)
  }
  function jump(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return <main className={`app-shell ${listOpen ? 'note-list-open' : ''} ${outlineOpen ? '' : 'outline-collapsed'}`} onMouseDown={event => { if (menu && !(event.target as Element).closest('.text-annotation-menu')) setMenu(null) }}>
    <aside className="sidebar">
      <button className="sidebar-toggle" onClick={() => setListOpen(false)} aria-label="收起笔记列表">‹</button>
      <div className="brand">· 留白 <small>MY NOTES</small></div>
      <button className="new-note" onClick={createNote}>＋ 新建笔记</button>
      <section className="course-section"><div className="section-title"><span>笔记分类</span><button className="category-add" onClick={createCategory}>＋ 新建</button></div>
        {store.categories.map(item => <div className="course-group" key={item.id}><button className={`course-button ${item.id === categoryId ? 'active' : ''}`} onClick={() => toggleCategory(item.id)}><i style={{ background: item.color }} />{item.name}</button><button className="category-edit" onClick={() => renameCategory(item)}>编辑</button></div>)}
      </section><p className="storage-note">离线保存于此浏览器</p>
    </aside>
    <aside className="note-list"><div className="note-list-header"><div><p>笔记列表</p><strong>{category?.name}</strong></div><button className="new-note compact" onClick={createNote}>＋</button></div><label className="search">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索当前分类笔记" /></label><div className="note-index-scroll">{notes.map(item => <button className={`compact-note ${item.id === noteId ? 'selected' : ''}`} key={item.id} onClick={() => { setNoteId(item.id); setEditing(false) }}><span className="note-dot">·</span><div><strong>{item.title}</strong><small>{item.tags.map(tag => `#${tag}`).join(' ') || '未添加标签'}</small></div></button>)}</div></aside>
    <section className="reader">{note && <><header className="reader-header"><div className="crumb">{store.categories.find(item => item.id === note.categoryId)?.name}</div><div className="reader-actions"><button className="annotate" title="选中文本即可标注">标注</button><button className="outline-header-toggle" onClick={() => setOutlineOpen(!outlineOpen)}>目录</button><button className="edit-switch" onClick={() => setEditing(!editing)}>{editing ? '阅读' : '编辑'}</button></div></header>
      {editing ? <div className="editor-content"><input className="title-input" value={note.title} onChange={event => patch({ title: event.target.value })} /><textarea value={note.content} onChange={event => patch({ content: event.target.value })} /></div> : <div className="reading-layout">
        {menu && <div className="text-annotation-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={event => event.preventDefault()}><div className="annotation-colors">{annotationColors.map(color => <button key={color} className="annotation-color" style={{ backgroundColor: color }} aria-label="选择颜色" onClick={() => annotate(color)} />)}</div><div className="annotation-styles"><button className={annotationKind === 'highlight' ? 'active' : ''} title="高亮文本" onClick={() => setAnnotationKind('highlight')}>A</button><button className={annotationKind === 'underline' ? 'active underline-tool' : 'underline-tool'} title="下划线文本" onClick={() => setAnnotationKind('underline')}>A</button></div></div>}
        <article ref={readerRef} onMouseUp={onSelection} className="markdown reader-body" dangerouslySetInnerHTML={{ __html: rendered }} />
        <aside className="outline"><div className="outline-content"><p>本文目录</p>{outline.map(item => <button key={item.id} className={`level-${item.level}`} onClick={() => jump(item.id)}>{item.text}</button>)}<div className="annotation-list"><p>标注</p>{(note.annotations || []).map(item => <button key={item.id} onClick={() => document.querySelector(`[data-id="${item.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{item.quote}<small>{item.kind === 'highlight' ? '高亮' : '下划线'}</small></button>)}</div><div className="reading-meta">更新于 {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(note.updatedAt))}</div></div></aside>
      </div>}</>}</section>
  </main>
}
