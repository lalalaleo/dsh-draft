/**
 * dsh-draft — host (Node) half.
 *
 * One tiny JSON route that persists the draft markdown document to a plain
 * file on disk. The browser half (lib/client.js) edits the document live and
 * autosaves here; the file is the durable single source of truth, so a page
 * refresh, browser cache clear, or profile restart never loses the draft.
 *
 * Storage: $DSH_HOME/draft.md (falls back to ~/.dsh/draft.md), the same home
 * the profile keeps its own runtime state in. Content is a plain Markdown
 * file — readable/editable by anything.
 *
 * No framework imports on purpose: this file only uses Node builtins, so
 * mounting it never adds a resolution dependency beyond the package itself.
 */
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-draft'
// Newer DSH hosts provide the `webServer` service; older ones used
// `httpServer`. The inject key targets the new service name, and apply()
// falls back to the legacy key for old hosts.
export const inject = ['webServer']

/** Upper bound for one draft document (bytes). Keeps the local API honest. */
const MAX_BYTES = 2 * 1024 * 1024

/** Where the document lives on disk. */
export function storageFile() {
  const root = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(root, 'draft.md')
}

/** Serialize read-modify-write on the file (per-process promise chain). */
let writeChain = Promise.resolve()
function serialized(task) {
  const next = writeChain.then(task, task)
  // Keep the chain alive even when a previous task rejected.
  writeChain = next.catch(() => {})
  return next
}

/** Parse the request body as UTF-8 text (bounded). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BYTES + 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function writeError(res, status, code, message) {
  writeJson(res, status, { ok: false, error: { code, message } })
}

/** Atomic replace: write a temp sibling, then rename over the target. */
async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, text, 'utf8')
  try {
    await rename(tmp, file)
  } catch (error) {
    // Best-effort cleanup; the target write itself failed.
    await writeFile(file, text, 'utf8').catch(() => {})
    throw error
  }
}

/** Read `file` as UTF-8 and report mtime; returns null when absent. */
async function readIfExists(file) {
  try {
    const text = await readFile(file, 'utf8')
    const savedAt = (await stat(file).catch(() => null))?.mtime?.toISOString() ?? null
    return { text, savedAt }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null
    throw error
  }
}

export function apply(ctx) {
  const file = storageFile()
  const logger = ctx.logger ?? console

  async function readDoc() {
    return (await readIfExists(file)) ?? { text: '', savedAt: null }
  }

  const handler = async (req, res) => {
    try {
      if (req.method === 'GET') {
        const doc = await readDoc()
        writeJson(res, 200, { ok: true, value: doc })
        return
      }
      if (req.method === 'PUT') {
        const raw = await readBody(req)
        if (raw.length > MAX_BYTES) {
          writeError(res, 413, 'too-large', `draft document exceeds ${MAX_BYTES} bytes`)
          return
        }
        let text
        try {
          const parsed = JSON.parse(raw)
          text = typeof parsed?.text === 'string' ? parsed.text : null
        } catch {
          text = null
        }
        if (text === null) {
          writeError(res, 400, 'bad-request', 'expected a JSON body: { "text": string }')
          return
        }
        const savedAt = await serialized(async () => {
          await writeFile(dirname(file), '', 'utf8').catch(() => {}) // ensure dir exists (no-op on existing)
          await atomicWrite(file, text)
          return new Date().toISOString()
        })
        writeJson(res, 200, { ok: true, value: { savedAt } })
        return
      }
      writeError(res, 405, 'method-error', 'method not allowed (use GET or PUT)')
    } catch (error) {
      logger.error?.('[dsh-draft] route error:', error)
      writeError(res, 500, 'internal-error', String(error?.message ?? error))
    }
  }

  ctx.effect(() => {
    const server = ctx.webServer ?? ctx.get?.('webServer') ?? ctx.get?.('httpServer')
    if (!server) {
      logger.error?.('[dsh-draft] no webServer/httpServer service available')
      return undefined
    }
    const disposer = server.register({
      kind: 'exact',
      path: '/draft/api',
      handler,
    })
    logger.info?.(`[dsh-draft] mounted at /draft/api -> ${file}`)
    return disposer
  }, 'dsh-draft: /draft/api route')
}
