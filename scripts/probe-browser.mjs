/**
 * Manual browser probe for dsh-draft: bundles probe-browser-entry.js, builds a
 * standalone page from the package stylesheet + the editor's own EDITOR_CSS,
 * drives it in headless Chrome over CDP, and asserts the list geometry, the
 * Enter paths and the client-half registration contract.
 *
 *   node scripts/probe-browser.mjs        (needs Google Chrome; not run in CI)
 *
 * Exists because rendering cannot be asserted in node (DEVELOPMENT §3) and the
 * questions that matter — how deep a nesting level renders, whether a task
 * checkbox shares its siblings' text column, whether the built bundle even
 * loads — are exactly the ones that have produced real bugs here.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
/* generated page/bundle scratch: kept out of the repo tree */
const work = mkdtempSync(join(tmpdir(), 'dsh-draft-probe-'))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333

/* 1. bundle the harness entry */
await build({
  entryPoints: [join(here, 'probe-browser-entry.js')],
  bundle: true,
  format: 'iife',
  outfile: join(work, 'probe-browser.out.js'),
  loader: { '.css': 'text' },
  logLevel: 'warning',
})

/* 2. assemble the page from the production stylesheet sources. EDITOR_CSS is a
 * template literal, so resolve its `${TASK_BOX_GAP_EM}` the way the bundle does. */
const atomicCss = readFileSync(join(repo, 'node_modules/@atomic-editor/editor/dist/styles/inline-preview.css'), 'utf8')
const editorSrc = readFileSync(join(repo, 'src/client/editor.jsx'), 'utf8')
const m = /const EDITOR_CSS = `([\s\S]*?)`\n\n\/\*\* The editor's stylesheet/.exec(editorSrc)
if (!m) throw new Error('could not extract EDITOR_CSS from src/client/editor.jsx')
const indentSrc = readFileSync(join(repo, 'src/client/list-indent.js'), 'utf8')
const gap = /const TASK_BOX_GAP_EM = ([\d.]+)/.exec(indentSrc)[1]
const ourCss = m[1].replaceAll('${TASK_BOX_GAP_EM}', gap)
if (ourCss.includes('${')) throw new Error('unresolved interpolation left in EDITOR_CSS')

const page = (css) => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}
#panel{width:380px;height:600px;overflow:auto;font-size:16px}
${css}
</style></head><body><div id="panel"><div id="root" class="dsh-draft dsh-draft-light"></div></div>
<script src="./probe-browser.out.js"></script></body></html>`

writeFileSync(join(work, 'probe-browser.html'), page(`${atomicCss}\n${ourCss}`))

/* 3. headless chrome over CDP (no npm deps — Node's global WebSocket) */
const profile = '/tmp/dsh-harness-profile'
mkdirSync(profile, { recursive: true })
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-crash-reporter',
    '--crash-dumps-dir=/tmp/dsh-crash',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=420,700',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const target = list.find((t) => t.type === 'page')
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('chrome did not expose a page target')
}

const ws = new WebSocket(await connect())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
}
ws.onclose = () => {
  for (const { reject } of pending.values()) reject(new Error('devtools socket closed'))
  pending.clear()
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
  return r.result.value
}

async function load(query = '') {
  await send('Page.enable')
  await send('Page.navigate', { url: `file://${join(work, 'probe-browser.html')}${query}` })
  for (let i = 0; i < 80; i++) {
    await sleep(100)
    try {
      if (await evaluate('!!window.__ready')) return
    } catch {}
  }
  throw new Error('page never became ready')
}

/* assertions: the invariants that have actually broken here before */
const failures = []
const expect = (name, cond, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!cond) failures.push(name)
}

const fmt = (r) => {
  const out = [`  space=${r.spaceWidthPx}px  stock=${r.stock}`]
  for (const l of r.lines) {
    out.push(
      `  L${String(l.i).padStart(2)} ind=${String(l.indent).padStart(2)} d=${l.depth} pad=${String(l.padLeftEm).padStart(5)}em ti=${String(l.textIndentEm).padStart(5)} contentX=${String(l.contentX).padStart(6)} wrap=${l.wrapRects}/${l.lastRectLeft}  ${l.text}`,
    )
  }
  for (const t of r.tasks) {
    out.push(`  TASK L${t.line} box=[${t.boxLeft},${t.boxRight}]w=${t.boxWidth} contentX=${t.contentX} caretX=${t.caretAfterBox}  ${t.text}`)
  }
  return out.join('\n')
}

/* the package's own behaviour, for the before/after comparison */
await load('?stock=1')
const stock = await evaluate('window.__measure()')
console.log('=== stock (package) ===')
console.log(fmt(stock))

/* production modules */
await load()
const ours = await evaluate('window.__measure()')
console.log('\n=== production (src/client/list-indent.js) ===')
console.log(fmt(ours))

/* real Enter keypresses, through the production path */
const pressEnter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await sleep(150)
}
const lineAt = async (n) => (await evaluate('window.__doc()')).split('\n')[n - 1]

console.log('\n=== Enter paths (production) ===')
await evaluate('window.__cursorToLineEnd(15)')
const before15 = await lineAt(15)
await pressEnter()
const after15 = await lineAt(15)
console.log(`  empty nested task    ${JSON.stringify(before15)} → ${JSON.stringify(after15)}`)
expect('Enter on an empty nested item steps a full level out', after15 === '- [ ] ', JSON.stringify(after15))
await evaluate('window.__cursorToLineEnd(17)')
const before17 = await lineAt(17)
await pressEnter()
const after17 = await lineAt(17)
console.log(`  empty nested ordered ${JSON.stringify(before17)} → ${JSON.stringify(after17)}`)
expect('the same for an ordered item', after17 === '1. ', JSON.stringify(after17))
await evaluate('window.__cursorTo(1, 2)')
await pressEnter()
const splitA = await lineAt(1)
const splitB = await lineAt(2)
console.log(`  mid-line bullet      → ${JSON.stringify(splitA)} / ${JSON.stringify(splitB)}`)
expect('mid-line Enter makes a new sibling item at the same indent', splitA === '- ' && splitB === '- 设置页面', `${JSON.stringify(splitA)} / ${JSON.stringify(splitB)}`)

/* derived numbers for the write-up */
const sw = stock.spaceWidthPx
const byDepth = (r) => {
  const map = {}
  for (const l of r.lines) if (l.depth != null && map[l.depth] === undefined) map[l.depth] = l.padLeftEm
  return map
}
console.log('\n=== geometry ===')
console.log(`  space = ${sw}px; 4 spaces = ${(4 * sw / 16).toFixed(2)}em`)
const stockDepth = byDepth(stock)
const ourDepth = byDepth(ours)
const stepsOf = (map) => Object.keys(map).map((k) => map[k]).sort((a, b) => a - b).map((v, i, arr) => (i ? +(v - arr[i - 1]).toFixed(3) : null)).slice(1)
console.log(`  stock:      ${JSON.stringify(stockDepth)} → step ${stepsOf(stockDepth)}em`)
console.log(`  production: ${JSON.stringify(ourDepth)} → step ${stepsOf(ourDepth)}em`)
expect('package step is the ~1.8-space 0.6em it used to be', stepsOf(stockDepth).every((d) => Math.abs(d - 0.6) < 0.01))
expect('production step is 1.33em (4 spaces)', stepsOf(ourDepth).every((d) => Math.abs(d - 1.33) < 0.02), JSON.stringify(stepsOf(ourDepth)))
expect('depth 0 is unchanged from the package', ourDepth[0] === stockDepth[0], `${ourDepth[0]} vs ${stockDepth[0]}`)
expect('production step is ~4 source spaces', Math.abs((stepsOf(ourDepth)[0] * 16) / sw - 4) < 0.1, `${((stepsOf(ourDepth)[0] * 16) / sw).toFixed(2)} spaces`)

const bullet = ours.lines.find((l) => l.depth === 0 && l.text.startsWith('- 设置'))
const task0 = ours.tasks.find((t) => t.line === 9)
const taskDelta = task0.contentX - bullet.contentX
console.log(`  task vs bullet text column: ${task0.contentX} vs ${bullet.contentX} → Δ${taskDelta.toFixed(2)}px`)
expect('task text shares the bullet text column', Math.abs(taskDelta) < 1, `Δ${taskDelta.toFixed(2)}px`)
const wrapped = ours.lines.filter((l) => l.wrapRects > 1)
expect(
  'wrapped continuation aligns with the first-line text column',
  wrapped.length > 0 && wrapped.every((l) => Math.abs(l.lastRectLeft - l.contentX) < 1),
  wrapped.map((l) => `L${l.i} ${l.lastRectLeft} vs ${l.contentX}`).join('; '),
)

/* 4. bundle smoke + integration contract: import the real lib/client.js with a
 * stubbed module loader, then run apply() against a recording fake ctx and
 * check the sidebar registrations against the official two-stage contract. */
const smokePage = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
window.__DSH_BOOT__ = {}
window.__errors = []
window.onerror = (m) => { window.__errors.push(String(m)) }
window.__ModuleLoader__ = {
  load({ id, factory }) {
    var stub = (name) => {
      if (name === 'react') return { useState: (v) => [v, () => {}], useEffect() {}, useRef: (v) => ({ current: v }), useCallback: (f) => f, useMemo: (f) => f(), createElement: () => null, Fragment: {} }
      if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: {} }
      if (name === 'react/jsx-dev-runtime') return { jsxDEV: () => null, Fragment: {} }
      if (name === 'react-dom' || name === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
      throw new Error('unstubbed require: ' + name)
    }
    try {
      var mod = factory(stub)
      var reg = { effects: [], injected: [], slotRegisters: [], tabs: [] }
      var fakeCtx = {
        effect(cb, label) { reg.effects.push(label); return cb() },
        sidebarRightTabs: { register(def) { reg.tabs.push(def); return () => {} } },
        slots: {
          inject(name, factory) { reg.injected.push(name); return factory() },
          register(opts, Comp) { reg.slotRegisters.push({ name: opts.name, key: opts.key, component: typeof Comp }); return () => {} },
        },
        locale: { getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} },
      }
      mod.apply(fakeCtx)
      window.__smoke = {
        ok: true,
        id: id,
        exports: Object.keys(mod || {}),
        inject: mod.inject,
        effects: reg.effects,
        injected: reg.injected,
        slotRegisters: reg.slotRegisters,
        tabs: reg.tabs.map((d) => ({
          id: d.id, kind: d.kind, priority: d.priority,
          title: d.title('sidebar://draft'),
          guide: (d.guide || []).map((g) => ({ order: g.order, title: g.title(), description: g.description && g.description(), icon: typeof g.icon })),
        })),
      }
    } catch (e) {
      window.__smoke = { ok: false, id: id, error: String((e && e.stack) || e) }
    }
  }
}
</script>
<script src="file://${join(repo, 'lib/client.js')}"></script>
</body></html>`
writeFileSync(join(work, 'probe-browser-smoke.html'), smokePage)
await send('Page.enable')
await send('Page.navigate', { url: `file://${join(work, 'probe-browser-smoke.html')}` })
await sleep(800)
const smoke = await evaluate('({ smoke: window.__smoke, errors: window.__errors })')
console.log('\n=== bundle smoke + sidebar contract (lib/client.js, stubbed loader) ===')
const s = smoke.smoke
console.log(`  ${JSON.stringify(s, null, 1)}`)
if (smoke.errors.length) console.log(`  window.onerror: ${JSON.stringify(smoke.errors)}`)
expect('lib/client.js loads and exports apply/inject', !!s?.ok && s.exports.includes('apply') && s.exports.includes('inject'), s?.error)
expect('client declares the sidebar services', JSON.stringify(s?.inject) === JSON.stringify(['sidebarRightTabs', 'slots', 'locale']), JSON.stringify(s?.inject))
expect('one tab type is registered', s?.tabs?.length === 1 && s.tabs[0].id === 'dsh-draft' && s.tabs[0].kind === 'draft', JSON.stringify(s?.tabs))
expect('the type offers a guide entry (the "+" discovery path)', (s?.tabs?.[0]?.guide?.length ?? 0) === 1 && s.tabs[0].guide[0].icon === 'function' && s.tabs[0].guide[0].title.length > 0)
expect(
  'body and title are registered under the definition id',
  s?.slotRegisters?.length === 2 && s.slotRegisters.every((r) => r.key === 'dsh-draft' && r.component === 'function'),
  JSON.stringify(s?.slotRegisters),
)
expect('both registrations are keyed seats', JSON.stringify(s?.injected) === JSON.stringify(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title']), JSON.stringify(s?.injected))
expect('every registration is owned by a ctx.effect', (s?.effects?.length ?? 0) === 4, JSON.stringify(s?.effects))

ws.close()
chrome.kill()
rmSync(work, { recursive: true, force: true })
if (failures.length) {
  console.error(`\n${failures.length} probe assertion(s) failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('\nall browser-probe assertions passed')
process.exit(0)
