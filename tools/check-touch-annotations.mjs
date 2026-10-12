import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../docs/assets/script-4.js', import.meta.url), 'utf8');
const listeners = new Map();
const timers = new Map();
let nextTimer = 0;
class Element {
  constructor() { this.children = []; this.dataset = {}; this.styles = {}; this.style = {setProperty: (key,value) => {this.styles[key] = value;}}; this.events = {}; this.className = ''; this.offsetHeight = 220; this.offsetWidth = 392; this.classList = {contains: value => this.className.split(' ').includes(value), toggle: () => {}}; }
  append(...items) { this.children.push(...items); }
  setAttribute(key,value) { this[key] = value; }
  addEventListener(type,fn) { this.events[type] = fn; }
  remove() { this.removed = true; }
  contains(value) { return value === this || this.children.some(child => child.contains?.(value)); }
  querySelectorAll() { return this.children; }
}
const root = new Element(); root.textContent = 'Tablet selection example';
const article = {firstElementChild: root};
const range = {commonAncestorContainer: root, startContainer: root, endContainer: root, startOffset: 0, endOffset: 6, getBoundingClientRect: () => ({left:100,top:200,bottom:230,width:160})};
let collapsed = false;
const selection = {rangeCount:1,get isCollapsed(){return collapsed;},toString:() => collapsed ? '' : 'Tablet',getRangeAt:() => range,removeAllRanges:() => {collapsed = true;}};
const window = {
  innerWidth:1024,innerHeight:768,
  getSelection:() => selection,
  matchMedia:query => ({matches: query === '(pointer: coarse)'}),
  setTimeout:fn => { const id = ++nextTimer; timers.set(id,fn); return id; },clearTimeout:id => timers.delete(id),
  requestAnimationFrame:() => 1,addEventListener:() => {},
};
const document = {
  body:new Element(),createElement:() => new Element(),
  querySelector:selector => selector === '.reader-body' ? article : selector === '.compact-note.selected' ? {dataset:{noteId:'note1'}} : null,
  addEventListener:(type,fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type,list); },
  createRange:() => ({selectNodeContents:() => {},setEnd:(_,offset) => { document.offset = offset; },toString:() => root.textContent.slice(0,document.offset)}),
};
const data = new Map();
const context = vm.createContext({window,document,localStorage:{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)},CustomEvent:class {},console});
// Expose module internals only inside this isolated test context.
vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.test = {showMenu, choose, createMark, getSelected:()=>selected};})();'),context);
const dispatch = (type,event={}) => (listeners.get(type)||[]).forEach(fn=>fn(event));
dispatch('selectionchange');
assert.equal(timers.size,1,'tablet selection schedules controls without a phone-width cutoff');
for (const [id,fn] of [...timers]) {timers.delete(id);fn();}
let menu = document.body.children.at(-1);
assert.ok(menu.classList.contains('selection-annotation-menu--touch'));
assert.equal(menu.style.top,'536px','toolbar docks at viewport bottom');
assert.equal(menu.children[1].children.length,8);
menu.events.pointerdown({});
assert.equal(collapsed,true);
dispatch('selectionchange');
assert.equal(menu.removed,undefined,'saved selection survives native selection dismissal');
assert.equal(window.test.getSelected().start,0);
assert.equal(window.test.getSelected().end,6);
window.test.showMenu();
assert.equal(menu.removed,undefined,'synthetic selection events do not discard saved offsets');
const mark = window.test.createMark({kind:'highlight',color:'#ffd400',id:'test'},'Tablet');
assert.equal(mark.styles['--selection-annotation-background'],'rgba(255, 212, 0, 0.35)');
assert.equal(mark.styles['--selection-annotation-color'],'#ffd400');
menu.children[0].children[1].events.click();
assert.equal(menu.removed,true,'cancel clears the pending annotation');
collapsed = false;
dispatch('touchstart',{target:{closest:()=>null}});
dispatch('selectionchange');
assert.equal(timers.size,0,'do not interrupt native handle dragging');
root.contains = () => true;
dispatch('touchend',{target:{closest:()=>null}});
assert.equal(timers.size,1,'controls appear after finger release');
console.log('PASS: tablet detection, bottom toolbar, range retention, RGBA fallback, cancel, selection dragging');
