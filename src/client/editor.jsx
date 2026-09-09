/**
 * Draft editor — live-preview editing powered by `@atomic-editor/editor`
 * (MIT, https://github.com/kenforthewin/atomic-editor).
 *
 * Why this package: it is a production-hardened CM6 editor purpose-built for
 * Inline live preview. Its design directly fixes the problems
 * we hit hand-rolling decorations:
 *   - stable line heights — inline preview hides syntax on non-active lines
 *     with replace-decorations that never change line heights (no reflow,
 *     no "click causes cursor drift");
 *   - mouse-freeze guard — clicks don't trigger a mid-interaction decoration
 *     rebuild, eliminating cursor-offset bugs;
 *   - the raw Markdown is the source of truth; syntax shows on the current
 *     line and tucks away when you move on;
 *   - smart lists incl. clickable task checkboxes (`- [ ]`), WYSIWYG tables,
 *     links, code fences.
 *
 * Theming: every color/font/size reads a `--atomic-editor-*` CSS custom
 * property, so we just re-map those to our own palette on the editor
 * container (light/dark follow the host body[data-ds-dark-theme]).
 *
 * Autosave: the plugin host stores $DSH_HOME/draft.md; every edit pushes a
 * debounced PUT, with a localStorage mirror as fallback.
 */
import { useEffect, useRef, useState } from 'react'
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import { ATOMIC_CODE_LANGUAGES } from '@atomic-editor/editor/code-languages'
import atomicStyles from '@atomic-editor/editor/styles.css'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { t } from './i18n.js'
import { toggleWrap, toggleTaskLines } from './markdown-ops.js'

/**
 * Syntax highlighting for fenced code blocks. The atomic editor ships the
 * highlight style (`atomicMarkdownSyntax`, colors via --atomic-editor-hl-*)
 * but only renders fences as plain mono text until it gets a codeLanguages
 * list — we hand it the package's curated ~20-language list (JS/TS, Python,
 * Go, Rust, C/C++, Java, PHP, Swift, Shell, SQL, HTML, CSS, XML, JSON, YAML,
 * TOML, Dockerfile, Markdown…). Each language's grammar loads lazily on first
 * use. The reference must be stable across renders or the editor remounts.
 */
const CODE_LANGUAGES = ATOMIC_CODE_LANGUAGES

/* ─────────────────── formatting shortcuts (Mod-b/i/l) ───────────────────
 * Toggle-style formatting keys: `**bold**`, `*italic*`, GFM task checkboxes.
 * The wrap/task transforms live in markdown-ops.js as pure functions
 * (unit-tested in scripts/test.mjs); these thin commands translate the
 * result into a CM6 transaction.
 *
 * The keymap is wrapped in Prec.high so it beats the package's built-in
 * default keymap (the component's documented pattern for custom keys),
 * and the whole array is a module-level constant — the component captures
 * `extensions` once at mount and a changing reference would remount. */

function runToggleWrap(marker) {
  return (view) => {
    const { anchor, head } = view.state.selection.main
    const r = toggleWrap(view.state.doc.toString(), anchor, head, marker)
    view.dispatch({ changes: r.changes, selection: { anchor: r.anchor, head: r.head }, scrollIntoView: true })
    return true
  }
}

/** Enter inside a list item (caret in the middle of the line) splits the
 *  line with a 4-space indent — the markdown language's built-in
 *  continuation indents by the marker width (2 for `- `), which reads too
 *  tight. Line-end Enter (new sibling item) and everything else are left
 *  to the default keymap (return false). */
const runEnterInList = (view) => {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.from)
  if (!/^(\s*)(?:[-+*]|\d+[.)])(\s+)/.exec(line.text)) return false
  if (sel.from >= line.to) return false // line end → default: new sibling item
  view.dispatch({ changes: { from: sel.from, insert: '\n    ' }, scrollIntoView: true })
  return true
}

const runToggleTask = (view) => {
  const { from, to } = view.state.selection.main
  const r = toggleTaskLines(view.state.doc.toString(), from, to)
  if (r.changes.length) {
    view.dispatch({ changes: r.changes, selection: { anchor: r.anchor, head: r.head }, scrollIntoView: true })
  }
  return true // handled either way — don't let the browser swallow Mod-l
}

const EDITOR_EXTENSIONS = [
  Prec.high(keymap.of([
    { key: 'Mod-b', run: runToggleWrap('**') },
    { key: 'Mod-i', run: runToggleWrap('*') },
    { key: 'Mod-l', run: runToggleTask },
    { key: 'Enter', run: runEnterInList },
  ])),
  indentUnit.of('    '), // 4-space indent (Tab, code blocks, etc.)
]

const MIRROR_KEY = 'dsh-draft.mirror.v4'

/** Where users report problems (public-facing error UI). */
const ISSUES_URL = 'https://github.com/lalalaleo/dsh-draft/issues'

function mirrorWrite(text) {
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify({ t: text, ts: Date.now() })) } catch { /* host save is authoritative */ }
}
function mirrorRead() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.t === 'string' && typeof parsed.ts === 'number') return parsed
  } catch { /* ignore */ }
  return null
}

async function apiGet() {
  const res = await fetch('/draft/api', { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  if (!body?.ok) throw new Error(body?.error?.message || 'bad response')
  return body.value
}

async function apiPut(text) {
  const res = await fetch('/draft/api', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${body.trim() ? ` — ${body.slice(0, 120).trim()}` : ''}`)
  }
  const parsed = await res.json().catch(() => null)
  return parsed?.value?.savedAt ?? null
}

/* ─────────────────────────── host theme detection ─────────────────────────── */

/** The host marks dark mode with body[data-ds-dark-theme]. */
function detectDark() {
  try {
    return typeof document !== 'undefined' && !!document.body && document.body.hasAttribute('data-ds-dark-theme')
  } catch {
    return false
  }
}

/* ─────────────────── design tokens → atomic-editor tokens ─────────────────── */

const EDITOR_CSS = `
/* ── container ─────────────────────────────────────────────────────── */
.dsh-draft { display: flex; flex-direction: column; height: 100%; min-height: 0; box-sizing: border-box; font-size: 16px; }
.dsh-draft * { box-sizing: border-box; }
.dsh-draft.dsh-draft-light {
  color-scheme: light;
  // --draft-bg: #ffffff;
  --draft-text: hsl(212deg 15% 30%);
  --draft-muted: hsl(212deg 15% 55%);
  --draft-faint: hsl(212deg 15% 70%);
  --draft-border: #ebedf0;
  --draft-accent: hsl(215deg 75% 60%);
  --draft-h1: var(--draft-text); --draft-h2: var(--draft-text);
  --draft-h3: #2e80f2; --draft-h4: #e5b567; --draft-h5: #e83e3e; --draft-h6: var(--draft-muted);
  --draft-strong: #ff82b2; --draft-em: #ff82b2; --draft-quote: #3eb4bf;
  --draft-code-bg: #eceef1; --draft-codeblock-bg: #f0f2f5;
  --draft-selection: hsl(215deg 75% 60% / 0.18);
  /* code-fence syntax tokens (light-safe contrast) */
  --draft-hl-keyword: #8250df; --draft-hl-string: #0a7d33; --draft-hl-number: #c9672f;
  --draft-hl-comment: hsl(212deg 15% 52%); --draft-hl-type: #953800; --draft-hl-function: #0550ae;
  --draft-hl-property: #0550ae; --draft-hl-regexp: #0550ae; --draft-hl-escape: #a04000;
  --draft-hl-tag: #116329; --draft-hl-variable: var(--draft-text); --draft-hl-operator: #5b6b80;
  --draft-hl-invalid: #cf222e;
}
.dsh-draft.dsh-draft-dark {
  color-scheme: dark;
  // --draft-bg: #1c2127;
  --draft-text: hsl(212deg 15% 82%);
  --draft-muted: hsl(212deg 15% 60%);
  --draft-faint: hsl(212deg 15% 45%);
  --draft-border: #35393e;
  --draft-accent: hsl(215deg 75% 64%);
  --draft-h1: var(--draft-text); --draft-h2: var(--draft-text);
  --draft-h3: #4c9aff; --draft-h4: #e0de71; --draft-h5: #fb464c; --draft-h6: var(--draft-muted);
  --draft-strong: #fa99cd; --draft-em: #fa99cd; --draft-quote: #53dfdd;
  --draft-code-bg: #303540; --draft-codeblock-bg: #282c34;
  --draft-selection: hsl(215deg 75% 64% / 0.28);
  /* code-fence syntax tokens — dark-safe tones for the dark palette */
  --draft-hl-keyword: #c792ea; --draft-hl-string: #c3e88d; --draft-hl-number: #f78c6c;
  --draft-hl-comment: hsl(212deg 15% 55%); --draft-hl-type: #ffcb6b; --draft-hl-function: #82aaff;
  --draft-hl-property: #82aaff; --draft-hl-regexp: #f07178; --draft-hl-escape: #89ddff;
  --draft-hl-tag: #f07178; --draft-hl-variable: var(--draft-text); --draft-hl-operator: #89ddff;
  --draft-hl-invalid: #ff5370;
}
.dsh-draft.dsh-draft-light { background: var(--draft-bg); color: var(--draft-text); }
.dsh-draft.dsh-draft-dark { background: var(--draft-bg); color: var(--draft-text); }
.dsh-draft-body { position: relative; flex: 1; min-height: 0; overflow: hidden; }

/* ── map our palette onto the editor (on the editor element so our
      values beat the package's dark/light defaults) ────────────────── */
.dsh-draft.dsh-draft-light .atomic-cm-editor,
.dsh-draft.dsh-draft-dark .atomic-cm-editor {
  --atomic-editor-bg: var(--draft-bg);
  --atomic-editor-fg: var(--draft-text);
  --atomic-editor-fg-muted: var(--draft-muted);
  --atomic-editor-fg-faint: var(--draft-faint);
  --atomic-editor-border: var(--draft-border);
  --atomic-editor-accent: var(--draft-accent);
  --atomic-editor-accent-bright: var(--draft-accent);
  --atomic-editor-accent-soft: color-mix(in srgb, var(--draft-accent) 22%, transparent);
  --atomic-editor-link: var(--draft-accent);
  --atomic-editor-link-hover: var(--draft-accent);
  --atomic-editor-code-bg: var(--draft-code-bg);
  --atomic-editor-code-rail: color-mix(in srgb, var(--draft-accent) 38%, var(--draft-border) 62%);
  --atomic-editor-hl-keyword: var(--draft-hl-keyword);
  --atomic-editor-hl-string: var(--draft-hl-string);
  --atomic-editor-hl-number: var(--draft-hl-number);
  --atomic-editor-hl-comment: var(--draft-hl-comment);
  --atomic-editor-hl-type: var(--draft-hl-type);
  --atomic-editor-hl-function: var(--draft-hl-function);
  --atomic-editor-hl-property: var(--draft-hl-property);
  --atomic-editor-hl-regexp: var(--draft-hl-regexp);
  --atomic-editor-hl-escape: var(--draft-hl-escape);
  --atomic-editor-hl-tag: var(--draft-hl-tag);
  --atomic-editor-hl-variable: var(--draft-hl-variable);
  --atomic-editor-hl-operator: var(--draft-hl-operator);
  --atomic-editor-hl-invalid: var(--draft-hl-invalid);
  --atomic-editor-selection-bg: var(--draft-selection);
  --atomic-editor-search-bg: color-mix(in srgb, var(--draft-accent) 22%, transparent);
  --atomic-editor-search-bg-active: color-mix(in srgb, var(--draft-accent) 45%, transparent);
  --atomic-editor-body-size: 16px;
  --atomic-editor-body-leading: 1.5;
  --atomic-editor-measure: 40rem; /* reading column width */
  --atomic-editor-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Ubuntu, sans-serif;
  --atomic-editor-font-mono: 'JetBrains Mono', 'Fira Code', Menlo, SFMono-Regular, Consolas, 'Roboto Mono', monospace;
  --atomic-editor-radius: 6px;
}

/* ── breathing room: widen the reading column's horizontal + vertical
      padding (atomic ships 0.5rem inline which hugs the panel edges).
      Bottom padding is tall (40vh) so a long document can scroll the
      last line to the middle of the screen instead of pinning it to
      the status bar ─ */
.dsh-draft .atomic-cm-editor .cm-content { padding: 1rem 1rem 40vh; }

/* ── per-level heading look (sizes, colors, h2 underline) ──────────── */
.dsh-draft .cm-line.cm-atomic-h1 { font-size: 1.7rem; color: var(--draft-h1); font-weight: 700; }
.dsh-draft .cm-line.cm-atomic-h2 { font-size: 1.5rem; color: var(--draft-h2); font-weight: 700; border-bottom: 2px solid var(--draft-border); padding-bottom: 2px; }
.dsh-draft .cm-line.cm-atomic-h3 { font-size: 1.2rem; color: var(--draft-h3); font-weight: 700; }
.dsh-draft .cm-line.cm-atomic-h4 { font-size: 1.1rem; color: var(--draft-h4); font-weight: 700; }
.dsh-draft .cm-line.cm-atomic-h5 { font-size: 1rem; color: var(--draft-h5); font-weight: 700; }
.dsh-draft .cm-line.cm-atomic-h6 { font-size: 0.9rem; color: var(--draft-h6); font-weight: 700; text-transform: none; letter-spacing: normal; }

/* ── signature colors: bold/em pink on top of the package's
      weight/italic styling. Must also cover the inner syntax-highlight
      span (a CM-generated class such as .ͼu on that inner element) that
      carries its own color
      and would otherwise override the outer mark's color. ─────────── */
.dsh-draft .cm-atomic-strong, .dsh-draft .cm-atomic-strong * { color: var(--draft-strong) !important; }
.dsh-draft .cm-atomic-em, .dsh-draft .cm-atomic-em * { color: var(--draft-em) !important; }

/* ── blockquote: green rail + italic text ──────────────────────────── */
.dsh-draft .cm-line.cm-atomic-blockquote {
  --atomic-editor-accent-soft: var(--draft-quote);
  color: var(--draft-quote);
  font-style: italic;
}

/* ── fenced code blocks get their own backdrop (vs shared inline-code
      bg); token colors flow in via the --atomic-editor-hl-* mapping ── */
.dsh-draft .cm-line.cm-atomic-fenced-code {
  background: var(--draft-codeblock-bg);
}

/* ── status bar ───────────────────────────────────────────────────── */
.dsh-draft-status {
  flex: none; display: flex; align-items: center; gap: 6px; padding: 3px 12px;
  font-size: 11px; opacity: 0.72; white-space: nowrap;
  border-top: 1px solid var(--draft-border); color: var(--draft-text);
}
.dsh-draft-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--draft-muted); flex: none; }
.dsh-draft-status.ok .dsh-draft-dot { background: #3fb950; }
.dsh-draft-status.err .dsh-draft-dot { background: #f85149; }
.dsh-draft-status.pending .dsh-draft-dot { background: #d29922; }

.dsh-draft-veil {
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: 10px;
  align-items: center; justify-content: center; padding: 24px; text-align: center;
  background: color-mix(in srgb, var(--draft-text) 5%, transparent); z-index: 5; color: var(--draft-text);
}
`

/** The editor's stylesheet must come before our overrides so equal-specificity
 *  rules resolve in our favour. */
function injectEditorCss() {
  const css = `${atomicStyles}\n${EDITOR_CSS}`
  const existing = document.querySelector('style[data-plugin="dsh-draft"]')
  if (existing) {
    existing.textContent = css
    return () => {}
  }
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-draft')
  style.textContent = css
  document.head.appendChild(style)
  return () => style.remove()
}

export function ScratchpadTab() {
  const mountRef = useRef(null)
  const st = useRef({ timer: null, lastMarkdown: undefined, lastSaved: '', savedAtText: '', seq: 0 })
  const [initialMd, setInitialMd] = useState(null) // string | null — editor mounts once per load
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [status, setStatus] = useState('idle')
  const [statusText, setStatusText] = useState('')
  const [errDetail, setErrDetail] = useState('')
  const [dark, setDark] = useState(detectDark)
  const [reload, setReload] = useState(0)

  const setDot = (s, t) => { setStatus(s); setStatusText(t) }

  const save = (md) => {
    const r = st.current
    mirrorWrite(md)
    if (md === r.lastSaved) {
      setDot('ok', r.savedAtText ? `${t('已保存', 'Saved')} ${r.savedAtText}` : t('无改动', 'No changes'))
      return
    }
    setDot('pending', t('保存中…', 'Saving…'))
    const seq = ++r.seq
    apiPut(md)
      .then((savedAt) => {
        if (seq !== r.seq) return
        r.lastSaved = md
        r.savedAtText = savedAt ? new Date(savedAt).toLocaleTimeString(t('zh-CN', 'en-US'), { hour: '2-digit', minute: '2-digit' }) : ''
        setDot('ok', r.savedAtText ? `${t('已保存', 'Saved')} ${r.savedAtText}` : t('已保存', 'Saved'))
      })
      .catch((err) => {
        if (seq !== r.seq) return
        console.error('[dsh-draft] save failed:', err)
        setDot('err', t('保存失败（服务不可用？），稍后自动重试', 'Save failed (service unavailable?) — will retry automatically'))
      })
  }

  const scheduleSave = (md) => {
    const r = st.current
    r.lastMarkdown = md
    clearTimeout(r.timer)
    r.timer = setTimeout(() => save(md), 600)
    setDot('pending', t('编辑中…', 'Editing…'))
  }

  const handleChange = (md) => scheduleSave(md)

  useEffect(() => { injectEditorCss() }, [])

  // Follow the host light/dark theme.
  useEffect(() => {
    const body = document.body
    if (!body) return
    const mo = new MutationObserver(() => setDark(detectDark()))
    mo.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => mo.disconnect()
  }, [])

  // Load the draft (fresh GET + localStorage mirror fallback).
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setPhase('loading')
      setInitialMd(null)
      try {
        const remote = await apiGet()
        const mirror = mirrorRead()
        const remoteMs = remote.savedAt ? new Date(remote.savedAt).getTime() : 0
        let md = remote.text ?? ''
        if (mirror && (mirror.ts > remoteMs || (remote.text === '' && mirror.t !== ''))) md = mirror.t
        if (cancelled) return
        st.current.lastSaved = md
        const time = remote.savedAt ? new Date(remote.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
        st.current.savedAtText = time
        setInitialMd(md)
        setPhase('ready')
        setDot('ok', time ? `${t('已保存', 'Saved')} ${time}` : '')
        if (md !== (remote.text ?? '')) apiPut(md).catch(() => {}) // push newer local mirror back
      } catch (err) {
        if (cancelled) return
        const mirror = mirrorRead()
        if (mirror && typeof mirror.t === 'string') {
          setErrDetail(`${t('连接服务失败（', 'Failed to reach the service (')}${String(err?.message ?? err).slice(0, 80)}${t('），已加载本地副本', '), loaded the local copy')}`)
          setPhase('error')
          setDot('err', t('服务暂不可用，已恢复本地副本', 'Service unavailable — restored the local copy'))
        } else {
          setErrDetail(String(err?.message ?? err))
          setPhase('error')
        }
      }
    }
    run()
    return () => {
      cancelled = true
      clearTimeout(st.current.timer)
    }
  }, [reload])

  return (
    <div
      className={`dsh-draft ${dark ? 'dsh-draft-dark' : 'dsh-draft-light'}`}
      data-theme={dark ? 'dark' : 'light'}
    >
      <div className="dsh-draft-body">
        {phase === 'ready' && initialMd !== null && (
          <AtomicCodeMirrorEditor
            markdownSource={initialMd}
            onMarkdownChange={handleChange}
            codeLanguages={CODE_LANGUAGES}
            extensions={EDITOR_EXTENSIONS}
            blurEditorOnMount
          />
        )}
        {phase === 'loading' && <div className="dsh-draft-veil">{t('加载草稿…', 'Loading draft…')}</div>}
        {phase === 'error' && (
          <div className="dsh-draft-veil">
            <div style={{ fontWeight: 600 }}>{t('草稿加载失败', 'Failed to load the draft')}</div>
            {errDetail && <code style={{ maxWidth: '100%', overflowWrap: 'anywhere', fontSize: 11, opacity: 0.85 }}>{errDetail}</code>}
            <div style={{ opacity: 0.65 }}>{t('内容都在磁盘上，不会丢。若反复出现，请到', 'Your content is safe on disk. If this keeps happening, report it at')} <a href={ISSUES_URL} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>GitHub Issues</a>{t('反馈。', '.')}</div>
            <button
              style={{ border: '1px solid currentColor', padding: '6px 16px', height: 'auto', background: 'transparent', color: 'inherit', borderRadius: 5, cursor: 'pointer' }}
              onClick={() => setReload((r) => r + 1)}
            >{t('重试', 'Retry')}</button>
          </div>
        )}
      </div>
      <div className={`dsh-draft-status ${status}`} title={t('草稿自动保存到 $DSH_HOME/draft.md', 'Draft autosaves to $DSH_HOME/draft.md')}>
        <span className="dsh-draft-dot" />
        <span>{statusText || t('自动保存已开启', 'Autosave is on')}</span>
      </div>
    </div>
  )
}