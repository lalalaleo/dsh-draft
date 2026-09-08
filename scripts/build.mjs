/**
 * Build the browser bundle for dsh-draft.
 *
 * Uses the `esbuild` devDependency binary (node_modules/.bin/esbuild) —
 * install it first with `npm install --legacy-peer-deps`.
 *
 * Output protocol (matches the official tsdown.client.ts shape):
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 *
 * Platform modules (react, react-dom, react/jsx-runtime) stay as external
 * `require(...)` calls answered by the module loader at runtime.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Locate the esbuild binary from the `esbuild` devDependency
 * (`node_modules/.bin/esbuild`), provided by `npm install --legacy-peer-deps`.
 */
const BIN = [
  fileURLToPath(new URL('../node_modules/.bin/esbuild', import.meta.url)),
  fileURLToPath(new URL('../node_modules/esbuild/bin/esbuild', import.meta.url)),
].find((p) => existsSync(p))
if (!BIN) {
  console.error('[dsh-draft] esbuild binary not found — run `npm install --legacy-peer-deps` first')
  process.exit(1)
}
const raw = fileURLToPath(new URL('../lib/client.raw.js', import.meta.url))
const out = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const entry = fileURLToPath(new URL('../src/client/index.jsx', import.meta.url))

const externals = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime']
const args = [
  entry,
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  `--outfile=${raw}`,
  '--jsx=automatic',
  '--target=es2020',
  '--log-level=info',
  '--define:process.env.NODE_ENV="production"',
  '--loader:.css=text',
  ...externals.map((m) => `--external:${m}`),
]

const result = spawnSync(BIN, args, { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const body = await readFile(raw, 'utf8')
const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: "dsh-draft",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  body.trimEnd(),
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')
await writeFile(out, wrapped, 'utf8')
await rm(raw, { force: true })
console.log(`[dsh-draft] built ${out} (${wrapped.length} bytes)`)
