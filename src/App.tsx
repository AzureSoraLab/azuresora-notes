import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'

marked.use(markedKatex({ throwOnError: false, nonStandard: true }))
type Category = { id: string; name: string; color: string }
type Annotation = { id: string; quote: string; kind: 'highlight' | 'underline' | 'strike'; comment?: string }
type Note = { id: string; title: string; content: string; categoryId: string; tags: string[]; updatedAt: string; annotations: Annotation[] }
type Store = { categories: Category[]; notes: Note[] }
const key = 'chengmo-notes-v2'
const uid = () => crypto.randomUUID()
const colors = ['#7596b7', '#a8846d', '#728f78', '#ad8192']
const sample = '# 傅里叶变换：频域视角\n\n傅里叶变换把时域信号分解为不同频率的正弦分量。它回答的核心问题是：**信号由哪些频率构成，每个频率占多大权重？**\n\n## 连续时间傅里叶变换\n\n对于绝对可积信号 $x(t)$，定义为：\n\n$$\nX(\\omega) = \\int_{-\\infty}^{+\\infty} x(t)e^{-j\\omega t}\\,dt\n$$\n\n## 复习提示\n\n先判断时移、频移还是尺度变换，再直接调用性质。'
const initial: Store = { categories: [{ id: 'signals', name: '信号与系统', color: colors[0] }, { id: 'digital', name: '数字电路', color: colors[1] }, { id: 'comm', name: '通信原理', color: colors[2] }], notes: [{ id: 'fourier', title: '傅里叶变换：频域视角', categoryId: 'signals', content: sample, tags: ['傅里叶变换', '频谱'], updatedAt: '2026-07-23T08:30:00.000Z', annotations: [] }] }
function load(): Store { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial } catch { return initial } }
function safe(html: string) { return html.replace(/<\/?(script|iframe|object|embed)[^>]*>/gi, '') }
function headings(content: string) { return [...content.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m, i) => ({ id: `section-${i}`, text: m[2].replace(/[*_`]/g, ''), level: m[1].length })) }
function html(content: string, annotations: Annotation[]) { let result = safe(marked.parse(content, { async: false, breaks: true }) as string); result = result.replace(/<h([1-3])>/g, (_, n) => `<h${n} id="section-${headingCount++}">`); for (const a of annotations) { const escaped = a.quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); result = result.replace(new RegExp(`(>[^<]*)(${escaped})`, 'i'), `$1<mark class="annotation ${a.kind}" data-id="${a.id}">$2</mark>`) } return result }
let headingCount = 0

export default function App() {
  const [store, setStore] = useState<Store>(load)
  const [categoryId, setCategoryId] = useState(store.categories[0]?.id || '')
  const [noteId, setNoteId] = useState(store.notes[0]?.id || '')
  const [listOpen, setListOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [annotating, setAnnotating] = useState(false)
  const [picked, setPicked] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const readerRef = useRef<HTMLElement>(null)
  const note = store.notes.find(n => n.id === noteId)
  const category = store.categories.find(c => c.id === categoryId)
  const notes = store.notes.filter(n => n.categoryId === categoryId && `${n.title} ${n.content}`.toLowerCase().includes(query.toLowerCase()))
  const outline = useMemo(() => note ? headings(note.content) : [], [note?.content])
  const rendered = useMemo(() => { headingCount = 0; return note ? html(note.content, note.annotations) : '' }, [note?.content, note?.annotations])
  useEffect(() => localStorage.setItem(key, JSON.stringify(store)), [store])
  function patch(changes: Partial<Note>) { if (!note) return; setStore(s => ({ ...s, notes: s.notes.map(n => n.id === note.id ? { ...n, ...changes, updatedAt: new Date().toISOString() } : n) })) }
  function toggleCategory(id: string) { const close = id === categoryId && listOpen; setCategoryId(id); setQuery(''); setListOpen(!close) }
  function createCategory() { const name = prompt('新分类名称')?.trim(); if (!name) return; const item = { id: uid(), name, color: colors[store.categories.length % colors.length] }; setStore(s => ({ ...s, categories: [...s.categories, item] })); setCategoryId(item.id) }
  function renameCategory(item: Category) { const name = prompt('修改分类名称', item.name)?.trim(); if (name) setStore(s => ({ ...s, categories: s.categories.map(c => c.id === item.id ? { ...c, name } : c) })) }
  function createNote() { const item: Note = { id: uid(), title: '新笔记', categoryId, content: '# 新笔记\n\n', tags: [], updatedAt: new Date().toISOString(), annotations: [] }; setStore(s => ({ ...s, notes: [item, ...s.notes] })); setNoteId(item.id); setEditing(true) }
  function onSelection() { if (!annotating || !readerRef.current) return; const s = window.getSelection(), text = s?.toString().trim() || ''; if (!text || !s?.rangeCount || !readerRef.current.contains(s.getRangeAt(0).commonAncestorContainer)) return; const r = s.getRangeAt(0).getBoundingClientRect(); setPicked(text); setMenu({ x: r.left + r.width / 2, y: r.bottom + 8 }) }
  function annotate(kind: Annotation['kind']) { if (!picked || !note) return; const comment = prompt('添加评论（可留空）')?.trim() || undefined; patch({ annotations: [...note.annotations, { id: uid(), quote: picked, kind, comment }] }); window.getSelection()?.removeAllRanges(); setPicked(''); setMenu(null) }
  function jump(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  return <main className={`app-shell ${listOpen ? 'list-open' : ''} ${outlineOpen ? '' : 'outline-hidden'}`}>
    <aside className="sidebar"><button className="sidebar-toggle" onClick={() => setListOpen(false)} aria-label="收起资料栏">‹</button><div className="brand">· 留白 <small>MY NOTES</small></div><button className="new-note" onClick={createNote}>＋ 新建笔记</button><section className="course-section"><div className="section-title"><span>笔记分类</span><button onClick={createCategory}>＋ 新建</button></div>{store.categories.map(c => <div className="course-group" key={c.id}><button className={`course-button ${c.id === categoryId ? 'active' : ''}`} onClick={() => toggleCategory(c.id)}><i style={{ background: c.color }} />{c.name}</button><button className="category-edit" onClick={() => renameCategory(c)}>编辑</button></div>)}</section><p className="storage-note">离线保存于此浏览器</p></aside>
    <aside className="note-list"><label className="search">⌕<input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索当前分类笔记" /></label><div className="note-list-header"><div><p>笔记列表</p><strong>{category?.name}</strong></div><button className="new-note compact" onClick={createNote}>＋</button></div><div className="note-index-scroll">{notes.map(n => <button className={`compact-note ${n.id === noteId ? 'selected' : ''}`} key={n.id} onClick={() => { setNoteId(n.id); setEditing(false) }}><span className="note-dot">·</span><div><strong>{n.title}</strong><small>{n.tags.map(t => `#${t}`).join(' ') || '未添加标签'}</small></div></button>)}</div></aside>
    <section className="reader">{note && <><header className="reader-header"><div className="crumb">{store.categories.find(c => c.id === note.categoryId)?.name || '未分类'}</div><div className="reader-actions"><button className={annotating ? 'annotate active' : 'annotate'} onClick={() => { setAnnotating(!annotating); setMenu(null) }}>标注</button><button className="outline-header-toggle" onClick={() => setOutlineOpen(!outlineOpen)}>目录</button><button className="edit-switch" onClick={() => setEditing(!editing)}>{editing ? '阅读' : '编辑'}</button></div></header>{editing ? <div className="editor-content"><input className="title-input" value={note.title} onChange={e => patch({ title: e.target.value })} /><textarea value={note.content} onChange={e => patch({ content: e.target.value })} /></div> : <div className="reading-layout">{menu && <div className="text-annotation-menu" style={{ left: menu.x, top: menu.y }}><button onClick={() => annotate('highlight')}>高亮</button><button onClick={() => annotate('underline')}>下划线</button><button onClick={() => annotate('strike')}>删除线</button></div>}<article ref={readerRef} onMouseUp={onSelection} className="markdown reader-body" dangerouslySetInnerHTML={{ __html: rendered }} /><aside className="outline"><div className="outline-content"><p>本文目录</p>{outline.map(s => <button key={s.id} className={`level-${s.level}`} onClick={() => jump(s.id)}>{s.text}</button>)}<div className="annotation-list"><p>标注</p>{note.annotations.map(a => <button key={a.id} onClick={() => document.querySelector(`[data-id="${a.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{a.quote}<small>{a.comment || a.kind}</small></button>)}</div><div className="reading-meta">更新于 {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(note.updatedAt))}</div></div></aside></div>}</>}</section>
  </main>
}
