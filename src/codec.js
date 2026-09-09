/**
 * Pure Markdown <-> document-model codec for the draft editor.
 *
 * The editor keeps a *structural* contenteditable DOM as its working truth
 * (this is what makes live/所见即所得 editing possible without re-rendering
 * textareas) and this module converts between:
 *
 *   markdown string  <->  doc model  <->  DOM (via a thin adapter in
 *                                           editor.js — this file is DOM-free)
 *
 * Document model
 * --------------
 * doc = { blocks: Block[] }
 *
 * Block:
 *   { t: 'p',   c: Seg[] }                      paragraph
 *   { t: 'h',   lv: 1..6, c: Seg[] }            heading
 *   { t: 'ul' | 'ol', items: Item[] }           list (items flattened, `lv` nests)
 *   { t: 'quote', blocks: Block[] }             blockquote
 *   { t: 'code', lang: string, text: string }   fenced code block
 *   { t: 'hr' }                                 thematic break
 *
 * Item:  { lv: number, task: null|boolean, c: Seg[] }
 *   - lv 0..n : nesting level inside the list group
 *   - task: null = plain item, true = [x], false = [ ]
 *
 * Seg (inline): { k: 's', t } | { k: 'b', c: Seg[] } | { k: 'i', c: Seg[] }
 *               | { k: 'c', t } | { k: 'a', href, c: Seg[] }
 *
 * The supported subset is deliberately small (headings, lists incl. task
 * lists, bold/italic/code/links, quotes, fences, hr) — exactly the "极简"
 * surface the draft promises. Unknown constructs round-trip as plain
 * text and are never destroyed.
 */

/** --- inline parsing ---------------------------------------------------- */

/**
 * Parse inline markdown into segments. Supports `code`, **bold** (with
 * nested italic/code), *italic* (with nested code), and [text](href).
 * Anything unrecognized stays literal text — unbalanced markers are never
 * consumed, so partial input is always safe.
 */
export function parseInline(src, { bold = true, italic = true } = {}) {
  const out = []
  let buf = ''
  const flush = () => {
    if (buf) {
      out.push({ k: 's', t: buf })
      buf = ''
    }
  }
  let i = 0
  const n = src.length
  const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n'
  while (i < n) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end !== -1) {
        const inner = src.slice(i + 1, end)
        if (inner !== '' && !inner.includes('\n') && !isSpace(inner[0]) && !isSpace(inner[inner.length - 1])) {
          flush()
          out.push({ k: 'c', t: inner })
          i = end + 1
          continue
        }
      }
      buf += ch
      i += 1
      continue
    }
    if (ch === '*' && next === '*' && bold) {
      const end = src.indexOf('**', i + 2)
      if (end !== -1) {
        const inner = src.slice(i + 2, end)
        if (inner !== '' && !inner.includes('\n') && !isSpace(inner[0]) && !isSpace(inner[inner.length - 1])) {
          flush()
          out.push({ k: 'b', c: parseInline(inner, { bold: false, italic }) })
          i = end + 2
          continue
        }
      }
      buf += ch
      i += 1
      continue
    }
    if (ch === '*' && italic) {
      // A lone * must pair with another lone * (not **) and have non-space edges.
      let j = i + 1
      let end = -1
      while (j < n) {
        if (src[j] === '*' && src[j + 1] !== '*') {
          end = j
          break
        }
        j += 1
      }
      if (end !== -1) {
        const inner = src.slice(i + 1, end)
        if (inner !== '' && !inner.includes('\n') && !isSpace(inner[0]) && !isSpace(inner[inner.length - 1])) {
          flush()
          out.push({ k: 'i', c: parseInline(inner, { bold: false, italic: false }) })
          i = end + 1
          continue
        }
      }
      buf += ch
      i += 1
      continue
    }
    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ k: 'a', href: m[2], c: m[1] === '' ? [] : parseInline(m[1], { bold: false, italic: false }) })
        i += m[0].length
        continue
      }
      buf += ch
      i += 1
      continue
    }
    buf += ch
    i += 1
  }
  flush()
  return out
}

/** Serialize inline segments back to markdown. */
export function serializeInline(segs) {
  let md = ''
  for (const seg of segs) {
    if (seg.k === 's') md += seg.t
    else if (seg.k === 'b') md += `**${serializeInline(seg.c)}**`
    else if (seg.k === 'i') md += `*${serializeInline(seg.c)}*`
    else if (seg.k === 'c') md += `\`${seg.t}\``
    else if (seg.k === 'a') md += `[${serializeInline(seg.c)}](${seg.href})`
  }
  return md
}

/** Whether the parse of `src` produced any *structural* inline markup. */
export function inlineHasMarkup(segs) {
  return segs.some((s) => s.k !== 's')
}

/** --- document parsing --------------------------------------------------- */

const FENCE_RE = /^```(\S*)\s*$/
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/
const QUOTE_RE = /^\s*>\s?(.*)$/
// item marker: indent(0..) + ( - | * | + | 1. | 1) ) + task? + content
const ITEM_RE = /^(\s*)([-+*]|\d{1,9}[.)])(\s+)(.*)$/
const TASK_IN_RE = /^\[([ xX])\]\s+(.*)$/

/** Nesting depth from leading whitespace: 2 spaces (or one tab) per level. */
function indentOf(leading) {
  let spaces = 0
  for (const ch of leading) spaces += ch === '\t' ? 2 : 1
  return Math.floor(spaces / 2)
}

function itemKind(marker) {
  return /^\d/.test(marker) ? 'ol' : 'ul'
}

/**
 * Parse a markdown document into the doc model.
 * Blank-line tolerance: blank lines inside a list end the list (tight lists).
 */
export function parseDoc(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  const n = lines.length

  const pushParagraphLines = (start) => {
    // Gather contiguous non-blank lines that do not begin another block.
    const taken = []
    let j = start
    while (j < n) {
      const line = lines[j]
      if (line.trim() === '') break
      if (FENCE_RE.test(line) || HR_RE.test(line) || HEADING_RE.test(line) || QUOTE_RE.test(line)) break
      if (ITEM_RE.test(line) && indentOf(line.match(ITEM_RE)[1]) === 0) break
      taken.push(line)
      j += 1
    }
    if (taken.length === 0) return j
    blocks.push({ t: 'p', c: parseInline(taken.join('\n')) })
    return j
  }

  while (i < n) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '') {
      i += 1
      continue
    }
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const lang = fence[1]
      const body = []
      i += 1
      while (i < n && !FENCE_RE.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      if (i < n) i += 1 // consume closing fence
      // Drop a single leading/trailing newline the way a writer expects.
      let text = body.join('\n')
      if (text.startsWith('\n')) text = text.slice(1)
      if (text.endsWith('\n')) text = text.slice(0, -1)
      blocks.push({ t: 'code', lang, text })
      continue
    }
    if (HR_RE.test(line)) {
      blocks.push({ t: 'hr' })
      i += 1
      continue
    }
    const heading = HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ t: 'h', lv: heading[1].length, c: parseInline(heading[2]) })
      i += 1
      continue
    }
    if (QUOTE_RE.test(line)) {
      const inner = []
      while (i < n) {
        const q = QUOTE_RE.exec(lines[i])
        if (!q) break
        inner.push(q[1])
        i += 1
      }
      blocks.push({ t: 'quote', blocks: parseDoc(inner.join('\n')).blocks })
      continue
    }
    const item = ITEM_RE.exec(line)
    if (item) {
      const items = []
      // Consume a tight list group: item lines at any nesting plus plain
      // continuation lines indented deeper than the base marker.
      let last = null
      while (i < n) {
        const cur = lines[i]
        if (cur.trim() === '') break
        const m = ITEM_RE.exec(cur)
        if (m) {
          const lv = indentOf(m[1])
          let task = null
          let content = m[4]
          const taskMatch = TASK_IN_RE.exec(content)
          if (taskMatch) {
            task = taskMatch[1].toLowerCase() === 'x'
            content = taskMatch[2]
          }
          items.push({ lv, kind: itemKind(m[2]), task, c: parseInline(content) })
          last = { lv, kind: itemKind(m[2]) }
          i += 1
          continue
        }
        // Plain continuation line: must be indented past the current level.
        const contIndent = indentOf(/^(\s*)/.exec(cur)[1])
        if (last !== null && contIndent > 0 && contIndent > Math.min(last.lv, 0)) {
          const prev = items[items.length - 1]
          if (prev) prev.c = prev.c.concat([{ k: 's', t: '\n' }], parseInline(cur.trim()))
          i += 1
          continue
        }
        break
      }
      // Group consecutive same-kind top-level markers as one block list; the
      // serializer re-emits each item with its own kind, so mixed nesting
      // survives even though a block carries one nominal kind.
      blocks.push({ t: items.length > 0 && items[0].lv === 0 ? items[0].kind : 'ul', items })
      continue
    }
    i = pushParagraphLines(i)
  }
  return { blocks }
}

/** --- document serialization --------------------------------------------- */

function renderListGroup(blocks) {
  const out = []
  for (const block of blocks) {
    if (block.t === 'ul' || block.t === 'ol') {
      for (const item of block.items) {
        const marker = item.kind === 'ol' ? '1.' : '-'
        const task = item.task === null ? '' : item.task ? '[x] ' : '[ ] '
        const indent = '  '.repeat(item.lv)
        out.push(`${indent}${marker} ${task}${serializeInline(item.c)}`)
      }
    }
  }
  return out
}

/**
 * Serialize the doc model back to markdown. Paragraphs keep internal '\n'
 * line breaks; blocks are separated by blank lines; the document ends with a
 * trailing newline when non-empty.
 */
export function serializeDoc(doc) {
  const pieces = []
  for (const block of doc.blocks) {
    if (block.t === 'p') pieces.push(serializeInline(block.c))
    else if (block.t === 'h') pieces.push(`${'#'.repeat(block.lv)} ${serializeInline(block.c)}`)
    else if (block.t === 'hr') pieces.push('---')
    else if (block.t === 'ul' || block.t === 'ol') {
      pieces.push(renderListGroup([block]).join('\n'))
    } else if (block.t === 'quote') {
      const inner = serializeDoc({ blocks: block.blocks })
        .replace(/\n$/, '')
        .split('\n')
        .map((l) => (l.trim() === '' ? '>' : `> ${l}`))
        .join('\n')
      pieces.push(inner)
    } else if (block.t === 'code') {
      pieces.push(`\`\`\`${block.lang}${block.text === '' ? '' : '\n' + block.text}\n\`\`\``)
    }
  }
  if (pieces.length === 0) return ''
  return pieces.join('\n\n') + '\n'
}

/* ─────────────────── live inline-token helpers ───────────────────
 * Used by the editor for live inline formatting: as soon as a
 * completed token (`**x**`, `*x*`, `` `x` ``) is typed, the editor hides
 * its markers and shows the content formatted. These pure helpers map a
 * caret character offset in the raw (marker-inclusive) text to the offset
 * in the marker-stripped content, and flag when the caret sits inside a
 * marker (in which case conversion is deferred).
 */

const isSpaceChar = (c) => c === ' ' || c === '\t' || c === '\n'

const INLINE_TOKEN_RE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g

/**
 * Flat, non-overlapping inline tokens in `src` that would be accepted as
 * structure by `parseInline` (same space/newline edge rules — so a lone
 * asterisk around text like "2 * 3" is never treated as emphasis).
 * Returns [{ kind: 'b'|'i'|'c', start, end, markerLen }].
 */
export function inlineTokens(src) {
  const tokens = []
  let m
  INLINE_TOKEN_RE.lastIndex = 0
  while ((m = INLINE_TOKEN_RE.exec(src))) {
    const start = m.index
    const end = start + m[0].length
    let kind, markerLen, inner
    if (m[1] !== undefined) { kind = 'c'; markerLen = 1; inner = m[1] }
    else if (m[2] !== undefined) { kind = 'b'; markerLen = 2; inner = m[2] }
    else { kind = 'i'; markerLen = 1; inner = m[3] }
    if (inner !== '' && !inner.includes('\n') && !isSpaceChar(inner[0]) && !isSpaceChar(inner[inner.length - 1])) {
      tokens.push({ kind, start, end, markerLen })
    }
  }
  return tokens
}

/** Whether `caret` (an offset in the raw text) falls inside any marker. */
export function caretInMarker(caret, tokens) {
  return tokens.some((t) => (caret >= t.start && caret < t.start + t.markerLen) ||
    (caret >= t.end - t.markerLen && caret < t.end))
}

/** How many marker characters lie before `caret` (i.e. the caret offset
 *  shift when markers are hidden). Assumes `caretInMarker` is false. */
export function caretDisplacement(caret, tokens) {
  let removed = 0
  for (const t of tokens) {
    const contentStart = t.start + t.markerLen
    if (caret >= t.end) removed += t.markerLen * 2
    else if (caret >= contentStart) removed += t.markerLen
  }
  return removed
}
