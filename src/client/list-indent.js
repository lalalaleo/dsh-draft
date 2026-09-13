/**
 * Visual list indentation for the draft editor.
 *
 * `@atomic-editor/editor` derives list nesting from the syntax tree, but its
 * per-level step is a hardcoded `LIST_LEVEL_EM = 0.6` written as an inline
 * `padding-left` on every list line — there is no CSS variable or option for
 * it. Draft writes 4 spaces per nesting level, and "what you see is what is
 * in the file" is the point of live preview, so this module re-declares the
 * same padding with a 4-space step.
 *
 * How the override wins without `!important`: the component composes consumer
 * `extensions` after its own built-ins, and CodeMirror appends the `style`
 * attribute of equal-position line decorations in facet order — so our
 * `padding-left` lands after the package's and wins in the inline style.
 * (Verified in a real browser: with a deliberately *smaller* value the
 * computed padding still follows this module. See `.dsh/harness`.)
 *
 * Depth and line ownership deliberately mirror the package — `ListItem`
 * ancestors of the line's first non-space character — so this layer never
 * disagrees with the package about which lines are indented, only by how much.
 * The base 2em is the package's own `0.8em base + 1.2em marker alcove`, so
 * depth-0 lines do not move at all.
 */
import { Decoration, ViewPlugin } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

/**
 * One nesting level, in em. The UI font's space is 0.333em (measured at 16px
 * in the browser), so 4 spaces — the source convention — is 4 × 0.333em.
 */
const LEVEL_EM = 1.33

/** Package base: 0.8em line inset + 1.2em marker alcove. */
const BASE_EM = 2

/**
 * Breathing room to the right of a task checkbox. The package couples the
 * widget's advance to its own marker alcove (`margin-right: 0.31em`) and pulls
 * the first line back with `text-indent: -(0.89em + margin)`; we keep that
 * invariant and re-declare the `text-indent` below, so growing the margin does
 * not push task text out of the column its sibling bullets share.
 */
export const TASK_BOX_GAP_EM = 0.55

const TASK_MARKER = /^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]/

/** 0-based list nesting depth of `pos`, or -1 when it is not inside a list item. */
function listDepth(state, pos) {
  let depth = -1
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'ListItem') depth++
  }
  return depth
}

function listIndentDecorations(view) {
  const { state } = view
  const ranges = []
  for (const { from, to } of view.visibleRanges) {
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number
    for (let number = first; number <= last; number++) {
      const line = state.doc.line(number)
      const offset = line.text.search(/\S/)
      if (offset < 0) continue // blank line — the package leaves these alone too
      const depth = listDepth(state, line.from + offset)
      if (depth < 0) continue
      let style = `padding-left: ${(BASE_EM + depth * LEVEL_EM).toFixed(2)}em`
      if (TASK_MARKER.test(line.text)) style += `; text-indent: -${(0.89 + TASK_BOX_GAP_EM).toFixed(2)}em`
      ranges.push(Decoration.line({ attributes: { style } }).range(line.from))
    }
  }
  return Decoration.set(ranges, true)
}

export const listIndent = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = listIndentDecorations(view)
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) this.decorations = listIndentDecorations(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
