/**
 * Host-half tests: the persistence route in lib/index.js, exercised directly
 * against a fake `webServer` service and a temporary $DSH_HOME. Pure node — no
 * DOM, no dsh process, no dependencies.
 *
 *   node scripts/test-host.mjs
 *
 * These cover the product's core promise (nothing typed is lost), which used to
 * be the one untested part of the plugin — and where a missing-directory bug and
 * an off-by-envelope size check had gone unnoticed.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply, storageFile } from '../lib/index.js'

const MAX_BYTES = 2 * 1024 * 1024

let failures = 0
const check = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail !== undefined ? `\n       ${detail}` : ''}`)
  }
}

const tempHomes = []
function tempHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), `dsh-draft-${prefix}-`))
  tempHomes.push(home)
  return home
}

/** Mount the plugin against a fake host; returns the registered route. */
function mount(dshHome) {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  const routes = []
  const errors = []
  apply({
    effect: (cb) => cb(),
    get: () => undefined,
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    logger: { info: () => {}, error: (...args) => errors.push(args.map(String).join(' ')) },
  })
  if (previous === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previous
  return { route: routes[0], errors }
}

function request(route, method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  const res = {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(chunk) { this.body = chunk ?? '' },
    destroy() {},
  }
  return route.handler(req, res).then(() => res)
}

const putJson = (route, text) => request(route, 'PUT', JSON.stringify({ text }))
const json = (res) => JSON.parse(res.body)

/* ── storage path ─────────────────────────────────────────────────────────── */
{
  process.env.DSH_HOME = '/tmp/dsh-draft-probe-home'
  check('storageFile honours $DSH_HOME', storageFile() === '/tmp/dsh-draft-probe-home/draft.md', storageFile())
  delete process.env.DSH_HOME
  check('storageFile falls back to ~/.dsh', storageFile().endsWith(join('.dsh', 'draft.md')), storageFile())
}

/* ── route registration ───────────────────────────────────────────────────── */
{
  const { route } = mount(tempHome('route'))
  check('registers /draft/api as an exact route', route?.path === '/draft/api' && route?.kind === 'exact', JSON.stringify(route && { path: route.path, kind: route.kind }))
}
{
  const errors = []
  apply({
    effect: (cb) => cb(),
    get: () => undefined,
    webServer: undefined,
    logger: { info: () => {}, error: (...args) => errors.push(args.map(String).join(' ')) },
  })
  check('missing webServer logs instead of throwing', errors.some((line) => line.includes('no webServer')), errors.join(' | '))
}

/* ── GET before anything was written ──────────────────────────────────────── */
{
  const { route } = mount(tempHome('empty'))
  const res = await request(route, 'GET')
  check('GET with no file → empty document', res.status === 200 && json(res).value.text === '' && json(res).value.savedAt === null, res.body)
}

/* ── round trip ───────────────────────────────────────────────────────────── */
{
  const home = tempHome('roundtrip')
  const { route } = mount(home)
  const text = '# 标题\n\n- 甲\n- [ ] 乙\n'
  const put = await putJson(route, text)
  const get = await request(route, 'GET')
  check('PUT → 200 with savedAt', put.status === 200 && typeof json(put).value.savedAt === 'string', put.body)
  check('GET returns what PUT wrote', json(get).value.text === text, get.body.slice(0, 80))
  check('file on disk is the raw markdown', readFileSync(join(home, 'draft.md'), 'utf8') === text)
  check('no temp file left behind', readdirSync(home).join() === 'draft.md', readdirSync(home).join())
}

/* ── malformed bodies ─────────────────────────────────────────────────────── */
{
  const { route } = mount(tempHome('bad'))
  const notJson = await request(route, 'PUT', 'not json')
  check('PUT with broken JSON → 400', notJson.status === 400 && json(notJson).error.code === 'bad-request', notJson.body)
  const noText = await request(route, 'PUT', JSON.stringify({ text: 42 }))
  check('PUT without a string text → 400', noText.status === 400, noText.body)
  const del = await request(route, 'DELETE')
  check('unsupported method → 405', del.status === 405 && json(del).error.code === 'method-error', del.body)
}

/* ── the 2 MB bound is on the document, not the JSON envelope ─────────────── */
{
  const { route } = mount(tempHome('size'))
  const exactly = await putJson(route, 'x'.repeat(MAX_BYTES))
  check('exactly 2 MB of text is accepted', exactly.status === 200, exactly.body)
  const over = await putJson(route, 'x'.repeat(MAX_BYTES + 1))
  check('2 MB + 1 byte → 413', over.status === 413 && json(over).error.code === 'too-large', over.body)
  // Past readBody's slack the rejection used to surface as a 500.
  const huger = await putJson(route, 'x'.repeat(MAX_BYTES + 5000))
  check('far over the bound → 413, not 500', huger.status === 413 && json(huger).error.code === 'too-large', huger.body)
  const multiByte = await putJson(route, '中'.repeat(Math.floor(MAX_BYTES / 3) + 1))
  check('bound counts UTF-8 bytes, not code units', multiByte.status === 413, multiByte.body)
}

/* ── $DSH_HOME that does not exist yet ────────────────────────────────────── */
{
  const parent = tempHome('missing')
  const home = join(parent, 'not-yet-created')
  const { route } = mount(home)
  const put = await putJson(route, 'hello')
  check('PUT creates the missing $DSH_HOME directory', put.status === 200 && existsSync(home) && statSync(home).isDirectory(), `${put.status} ${put.body} dir=${existsSync(home) ? (statSync(home).isDirectory() ? 'dir' : 'file') : 'absent'}`)
  check('draft written into the created directory', readFileSync(join(home, 'draft.md'), 'utf8') === 'hello')
}

/* ── concurrent writes stay serialized ────────────────────────────────────── */
{
  const home = tempHome('concurrent')
  const { route } = mount(home)
  const texts = Array.from({ length: 12 }, (_, i) => `doc-${i}`)
  const responses = await Promise.all(texts.map((text) => putJson(route, text)))
  const get = await request(route, 'GET')
  check('12 concurrent PUTs all succeed', responses.every((res) => res.status === 200), responses.map((res) => res.status).join())
  check('final document is one whole write (no interleaving)', texts.includes(json(get).value.text), json(get).value.text)
  check('concurrent writes leave no temp files', readdirSync(home).join() === 'draft.md', readdirSync(home).join())
}

for (const home of tempHomes) rmSync(home, { recursive: true, force: true })

if (failures === 0) {
  console.log('\nall host tests passed')
  process.exit(0)
} else {
  console.error(`\n${failures} host test(s) failed`)
  process.exit(1)
}
