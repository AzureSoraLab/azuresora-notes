import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const bundle = read('docs/assets/script-2.js');
for (const feature of ['AzureSora', 'New Note', 'mobile-nav', 'library-content', 'data-note-id', 'chengmoStorage', 'chengmo-notes-v1']) {
  assert.ok(bundle.includes(feature), `The published reader must retain ${feature}`);
}
assert.ok(!bundle.includes('MY NOTES'), 'The legacy source app must not replace the reader');

// Execute the actual delivery's Markdown renderer without mounting React.
const withoutPreload = bundle.replace(/\(function\(\)\{[\s\S]*?\}\)\(\);/, '');
const mount = withoutPreload.lastIndexOf('(0,u.createRoot)');
assert.ok(mount > 0);
const context = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(withoutPreload.slice(0, mount) + ';this.renderMarkdown = Is;', context);
for (const formula of [
  '$x(t)$', '$$\nx^2\n$$', '\\[\r\nx^2\r\n\\]',
  '$$\n\\begin{cases} x & x>0 \\\\ 0 & x<0 \\end{cases}\n$$'
]) {
  const rendered = context.renderMarkdown(formula);
  assert.ok(rendered.includes('class="katex"'), `Must render ${formula}`);
  assert.ok(!rendered.includes('katex-error'));
}
assert.ok(context.renderMarkdown('`$x$`').includes('<code>$x$</code>'));

const migration = read('docs/assets/release-migration.js');
const legacy = { categories: [{ id: 'course', name: 'Course' }], notes: [
  { id: 'existing', title: 'Legacy duplicate', content: 'older', categoryId: 'course' },
  { id: 'new', title: 'Keep me', content: 'new content', categoryId: 'course',
    annotations: [{ id: 'mark', quote: 'new', start: 0, end: 3, color: '#ffd400', kind: 'highlight' }] }
] };
const original = { courses: [], notes: [{ id: 'existing', content: 'current content' }] };
const data = new Map([
  ['chengmo-notes-v3', JSON.stringify(legacy)],
  ['chengmo-notes-v1', JSON.stringify(original)]
]);
const migrationContext = vm.createContext({ console, localStorage: {
  getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value)
} });
vm.runInContext(migration, migrationContext);
const migrated = JSON.parse(data.get('chengmo-notes-v1'));
assert.equal(migrated.notes.length, 2);
assert.equal(migrated.notes[0].content, 'current content');
assert.equal(migrated.notes[1].courseId, 'course');
assert.equal(JSON.parse(data.get('chengmo-text-selection-annotations-v1'))[0].noteId, 'new');
assert.equal(data.get('chengmo-notes-v3'), JSON.stringify(legacy));
vm.runInContext(migration, migrationContext);
assert.equal(data.get('chengmo-notes-v1'), JSON.stringify(migrated), 'Migration is idempotent');

const html = read('docs/index.html');
const loader = read('docs/assets/enhancements-loader.js');
const assets = [...html.matchAll(/(?:href|src)="(\.\/[^"?#]+(?:\?[^"#]*)?)"/g),
  ...loader.matchAll(/'(\.\/assets\/[^']+)'/g)].map(match => match[1]);
const events = new Map();
const stored = new Map();
let installedRequests;
const workerContext = vm.createContext({ URL, Request, console, fetch: async () => { throw new Error('offline'); },
  self: { location: { href: 'https://example.test/notes/service-worker.js', origin: 'https://example.test' },
    addEventListener: (type, listener) => events.set(type, listener), skipWaiting: async () => {}, clients: { claim: async () => {} } },
  caches: { open: async () => ({ addAll: async requests => { installedRequests = requests; },
    match: async request => stored.get(typeof request === 'string' ? request : request.url), put: async () => {} }) }
});
vm.runInContext(read('docs/service-worker.js') + ';this.assets = [...CORE_ASSETS, ...DEFERRED_ASSETS];', workerContext);
for (const asset of assets) {
  assert.ok(workerContext.assets.includes(asset), `Offline cache must use the exact URL: ${asset}`);
  assert.ok(fs.existsSync(new URL(`../docs/${asset.split('?')[0]}`, import.meta.url)), `Missing ${asset}`);
}
let installed;
events.get('install')({ waitUntil: promise => { installed = promise; } });
await installed;
assert.ok(installedRequests.every(request => request.cache === 'reload'), 'Installation must revalidate HTTP cache');

const fetchHandler = events.get('fetch');
const request = { method: 'GET', mode: 'cors', url: 'https://example.test/notes/assets/script-2.js?v=release-ui-20261013' };
stored.set(request.url, { release: 'current' });
let response;
fetchHandler({ request, respondWith: promise => { response = promise; }, waitUntil: () => {} });
assert.equal((await response).release, 'current', 'Offline visits retain current versioned assets');
stored.clear();
stored.set(request.url.replace('release-ui-20261013', 'older'), { release: 'old' });
fetchHandler({ request, respondWith: promise => { response = promise; }, waitUntil: () => {} });
await assert.rejects(response, /offline/, 'Never substitute a differently versioned cached asset');

for (const asset of ['index.html', 'service-worker.js', 'assets/script-2.js', 'assets/style-1.css', 'assets/release-migration.js']) {
  assert.equal(read(`docs/${asset}`), read(`outputs/澄墨笔记网站/${asset}`), `Delivery paths must agree: ${asset}`);
}
console.log('PASS: release identity, KaTeX, preserved legacy notes, exact offline URLs and synchronized delivery');
