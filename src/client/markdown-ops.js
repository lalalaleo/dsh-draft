/**
 * Pure Markdown editing helpers for the editor's formatting shortcuts.
 *
 * DOM-free and CodeMirror-free: every function takes the current raw
 * markdown (the source of truth) plus caret ranges and returns an
 * explicit change list + new selection. The keymap layer in editor.jsx
 * turns those into CM6 transactions, and scripts/test.mjs covers them
 * directly. Keeping the semantics here (instead of inside CM6 commands)
 * is what makes the toggle behaviour testable without a DOM.
 *
 * Change shape (CM6 ChangeSpec compatible):
 *   { changes: [{ from, to, insert }...], anchor, head }
 * All `from`/`to` are positions in the ORIGINAL text (non-overlapping,
 * ascending), so callers can dispatch them as-is.
 */

const TASK_LINE = /^(\s*(?:[-+*]|\d+[.)])\s+)(\[[ xX]\]\s+)?(.*)$/
const TASK_CHECKBOX = /^\[([ xX])\]\s+$/

/** Marker-aware toggling of an emphasis wrap (`**` or `*`).
 *
 * - selection already enclosed by the marker  → unwrap (delete both
 *   markers, selection shrinks to the content);
 * - any other non-empty selection → wrap the selection;
 * - empty selection (caret) → insert an empty pair, caret lands between
 *   the two markers so the user can type straight into it.
 */
export function toggleWrap(text, from, to, marker) {
  const m = marker.length
  const enclosed =
    from >= m && to <= text.length && text.slice(from - m, from) === marker && text.slice(to, to + m) === marker

  if (enclosed) {
    return {
      changes: [
        { from: from - m, to: from, insert: '' },
        { from: to, to: to + m, insert: '' },
      ],
      anchor: from - m,
      head: to - m,
    }
  }

  const changes = [
    { from, to: from, insert: marker },
    { from: to, to, insert: marker },
  ]
  if (from === to) {
    // caret mode: place the caret between the fresh pair
    return { changes, anchor: from + m, head: from + m }
  }
  return { changes, anchor: from, head: to }
}

/** Remap a position through a list of non-overlapping edits.
 *  Positions inside an edit land at the end of its insert; positions
 *  after it shift by the net length delta. Used to keep the selection
 *  sensible across whole-line task toggles. */
function remap(pos, changes) {
  let p = pos
  for (const c of changes) {
    if (p >= c.to) p += c.insert.length - (c.to - c.from)
    else if (p > c.from) p = c.from + c.insert.length
  }
  return p
}

function lineBounds(text, pos) {
  const start = pos === 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1
  let end = text.indexOf('\n', start)
  if (end === -1) end = text.length
  return { start, end } // end excludes the trailing \n
}

function toggleTaskLine(line) {
  const m = TASK_LINE.exec(line)
  if (!m) {
    // not a list line — turn it into a task item (blank lines stay blank)
    return line.trim() === '' ? line : `- [ ] ${line}`
  }
  const [, marker, box, rest] = m
  if (box) {
    const checked = TASK_CHECKBOX.exec(box)[1] === 'X' || TASK_CHECKBOX.exec(box)[1] === 'x'
    return `${marker}${checked ? '[ ] ' : '[x] '}${rest}`
  }
  return `${marker}[ ] ${rest}`
}

/** Toggle GFM task checkboxes on every line touched by [from, to).
 *  Checked ⇄ unchecked; bare list items get `[ ] ` inserted after the
 *  marker; plain lines become `- [ ] ` items. The whole line is always
 *  rewritten (starting at the line holding `from`, ending at the line
 *  holding `to`). */
export function toggleTaskLines(text, from, to) {
  const first = lineBounds(text, from).start
  const last = lineBounds(text, to).end

  const changes = []
  let pos = first
  while (pos <= last) {
    const { start, end } = lineBounds(text, pos)
    const line = text.slice(start, end)
    const next = toggleTaskLine(line)
    if (next !== line) changes.push({ from: start, to: end, insert: next })
    if (end >= last) break
    pos = end + 1
  }

  // selection: keep the same visual span, remapped through the edits
  const anchor = remap(from, changes)
  const head = remap(to, changes)
  return { changes, anchor, head }
}