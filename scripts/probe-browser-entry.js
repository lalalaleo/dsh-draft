/* Browser-probe page entry (see probe-browser.mjs). Bundled by esbuild and
 * loaded in headless Chrome; it renders the REAL production decoration
 * extensions so list geometry and Enter behaviour can be measured instead of
 * guessed.
 *
 * This is a probe, not production code: the Enter handler below mirrors
 * editor.jsx's runEnterInList, and the numbers it asserts (the 0.89em checkbox
 * invariant, the padding formula) mirror list-indent.js. Keep it in step when
 * those change.
 *
 *   ?stock=1   omit list-indent, to measure the package's own behaviour
 */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
/* import the extension modules directly: the package's index also re-exports the
 * React component, and react is deliberately not installed here */
import { inlinePreview } from '../node_modules/@atomic-editor/editor/dist/inline-preview.js'
import { atomicEditorTheme, atomicMarkdownSyntax } from '../node_modules/@atomic-editor/editor/dist/atomic-theme.js'
/* production code */
import { listIndent } from '../src/client/list-indent.js'
import { listIndentOf, emptyItemOutdent } from '../src/client/markdown-ops.js'

const params = new URLSearchParams(location.search)
const STOCK = params.get('stock') === '1'

const DOC = [
  '- 设置页面',
  '    - 缩进设置（现在的缩进是 2 space ?）',
  '        - 第三级：有序列表对比',
  '            - 第四级',
  '    - 普通父级',
  '1. 有序一级',
  '    1. 有序二级',
  '        1. 有序三级',
  '- [ ] 任务一级',
  '    - [ ] 任务二级',
  '        - [ ] 任务三级',
  '- 包裹行测试：这是一段足够长的文字，用来观察换行后的续行是不是和首行文字对齐，以及每一级的缩进差异是否肉眼可见。',
  '    - 二级包裹行测试：这是一段足够长的文字，用来观察换行后的续行是不是和首行文字对齐，以及每一级的缩进差异是否肉眼可见。',
  '- [ ] 空任务父级',
  '    - [ ] ',
  '1. 空有序父级',
  '    1. ',
].join('\n')

/* mirrors editor.jsx: Prec.highest DOM keydown (a keymap cannot outrank the
 * package's Prec.highest Enter keymap), with the production decision function */
const enterKeydown = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.key !== 'Enter' || event.isComposing) return false
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    const sel = view.state.selection.main
    if (!sel.empty) return false
    const line = view.state.doc.lineAt(sel.from)
    if (sel.from !== line.to) return false
    const outdent = emptyItemOutdent(line.text, line.from)
    if (!outdent) return false
    view.dispatch({ changes: outdent.changes, selection: { anchor: outdent.anchor, head: outdent.anchor } })
    return true
  },
})

const extensions = [
  markdown({ base: markdownLanguage, extensions: [] }),
  atomicMarkdownSyntax,
  atomicEditorTheme,
  EditorView.lineWrapping,
  inlinePreview({}),
  Prec.highest(enterKeydown),
]
if (!STOCK) extensions.push(listIndent)

const view = new EditorView({
  parent: document.getElementById('root'),
  state: EditorState.create({ doc: DOC, extensions }),
})
window.__view = view

/** Simulate a real keypress: put the caret at the end of line `n`, focus, and
 * let the runner dispatch a genuine Enter key event through CDP. */
window.__cursorTo = (n, offset) => {
  const line = view.state.doc.line(n)
  view.dispatch({ selection: { anchor: Math.min(line.from + offset, line.to) } })
  view.focus()
  return { line: n, text: line.text }
}
window.__cursorToLineEnd = (n) => {
  const line = view.state.doc.line(n)
  view.dispatch({ selection: { anchor: line.to } })
  view.focus()
  return { line: n, text: line.text, to: line.to }
}
window.__doc = () => view.state.doc.toString()

/** 0-based list nesting depth of `pos`, or -1 when it is not inside a list item. */
function ownerDepth(pos) {
  let depth = -1
  for (let node = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'ListItem') depth++
  }
  return depth
}

window.__measure = () => {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit'
  probe.textContent = '    '
  document.getElementById('root').appendChild(probe)
  const spaceWidth = probe.getBoundingClientRect().width / 4
  probe.remove()

  const els = [...document.querySelectorAll('.cm-content .cm-line')]
  const lines = els.map((el, i) => {
    const docLine = view.state.doc.line(i + 1)
    const cs = getComputedStyle(el)
    const m = /^(\s*(?:[-+*]|\d+[.)])\s+)(\[[ xX]\]\s*)?/.exec(docLine.text)
    const contentOffset = m ? m[0].length : 0
    const c = m ? view.coordsAtPos(docLine.from + contentOffset) : null
    const off = docLine.text.search(/\S/)
    /* wrapped continuation: last visual rect of the line's last text chunk */
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim()) nodes.push(n)
    let wrapRects = null
    let lastRectLeft = null
    if (nodes.length) {
      const range = document.createRange()
      range.selectNodeContents(nodes[nodes.length - 1])
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5)
      wrapRects = rects.length
      lastRectLeft = rects.length ? +rects[rects.length - 1].left.toFixed(2) : null
    }
    return {
      i: i + 1,
      text: docLine.text.slice(0, 26),
      indent: /^\s*/.exec(docLine.text)[0].length,
      depth: listIndentOf(docLine.text) && off >= 0 ? ownerDepth(docLine.from + off) : null,
      padLeftEm: +(parseFloat(cs.paddingLeft) / 16).toFixed(3),
      textIndentEm: +(parseFloat(cs.textIndent) / 16).toFixed(3),
      contentX: c ? +c.left.toFixed(2) : null,
      wrapRects,
      lastRectLeft,
    }
  })

  const tasks = els
    .map((el, i) => ({ el, docLine: view.state.doc.line(i + 1) }))
    .filter(({ docLine }) => /^\s*[-+*]\s+\[[ xX]\]/.test(docLine.text))
    .map(({ el, docLine }) => {
      const cb = el.querySelector('.cm-atomic-task-checkbox')
      const r = cb ? cb.getBoundingClientRect() : null
      const m = /^(\s*[-+*]\s+)(\[[ xX]\]\s*)/.exec(docLine.text)
      const boxEnd = docLine.from + m[1].length + 3
      return {
        line: docLine.number,
        text: docLine.text.slice(0, 20),
        boxLeft: r ? +r.left.toFixed(2) : null,
        boxRight: r ? +r.right.toFixed(2) : null,
        boxWidth: r ? +r.width.toFixed(2) : null,
        contentX: +view.coordsAtPos(docLine.from + m[0].length).left.toFixed(2),
        caretAfterBox: +view.coordsAtPos(boxEnd, 1).left.toFixed(2),
      }
    })

  return { stock: STOCK, spaceWidthPx: +spaceWidth.toFixed(3), lines, tasks }
}
window.__ready = true
