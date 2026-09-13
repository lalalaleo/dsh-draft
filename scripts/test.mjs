/**
 * Editor-helper tests: the pure transforms behind the formatting shortcuts and
 * the list keymaps (src/client/markdown-ops.js). Pure node — no DOM, no
 * dependencies.
 *
 *   node scripts/test.mjs
 *
 * Rendering itself cannot be asserted here; see DEVELOPMENT.md §6 for the
 * browser probe.
 */
let failures = 0
const check = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail !== undefined ? `\n       ${detail}` : ''}`)
  }
}

// ─── editor formatting helpers (markdown-ops.js) ───
import { toggleWrap, toggleTaskLines, listIndentOf, nextIndentLevel, prevIndentLevel, emptyItemOutdent } from '../src/client/markdown-ops.js'

function applyChanges(text, r) {
  let out = ''
  let pos = 0
  for (const c of r.changes) {
    out += text.slice(pos, c.from) + c.insert
    pos = c.to
  }
  return out + text.slice(pos)
}
const sel = (r) => `${r.anchor}:${r.head}`

{
  // toggleWrap — bold
  let r = toggleWrap('abc', 1, 2, '**')
  check('wrap selection', applyChanges('abc', r) === 'a**b**c' && sel(r) === '3:4')
  r = toggleWrap('a**b**c', 3, 4, '**')
  check('unwrap enclosed selection', applyChanges('a**b**c', r) === 'abc' && sel(r) === '1:2')
  r = toggleWrap('ab', 1, 1, '**')
  const t = applyChanges('ab', r)
  check('caret inserts empty pair', t === 'a****b' && sel(r) === '3:3' && t.slice(1, 3) === '**' && t.slice(3, 5) === '**')
  // toggleWrap — italic (single asterisk)
  r = toggleWrap('ab', 0, 1, '*')
  check('italic wrap', applyChanges('ab', r) === '*a*b' && sel(r) === '1:2')
  r = toggleWrap('*a*b', 1, 2, '*')
  check('italic unwrap', applyChanges('*a*b', r) === 'ab' && sel(r) === '0:1')
  // unwrap only fires when both markers sit exactly on the flanks;
  // a selection starting at 0 (no room for an opening flank) wraps instead
  r = toggleWrap('**a**', 0, 5, '**')
  check('selection at doc start wraps', applyChanges('**a**', r) === '****a****')
  check('selection at doc start maps into content', sel(r) === '2:7')
  // reverse (backward) selections keep their direction and map onto content
  r = toggleWrap('ab', 2, 0, '**')
  check('reverse wrap', applyChanges('ab', r) === '**ab**' && sel(r) === '4:2')
  r = toggleWrap('**ab**', 4, 2, '**')
  check('reverse unwrap', applyChanges('**ab**', r) === 'ab' && sel(r) === '2:0')
}

{
  // toggleTaskLines — single lines
  let r = toggleTaskLines('- 买菜', 0, 4)
  check('plain list → task', applyChanges('- 买菜', r) === '- [ ] 买菜')
  r = toggleTaskLines('- [ ] 买菜', 0, 9)
  check('unchecked → checked', applyChanges('- [ ] 买菜', r) === '- [x] 买菜')
  r = toggleTaskLines('- [x] 买菜', 0, 9)
  check('checked → unchecked', applyChanges('- [x] 买菜', r) === '- [ ] 买菜')
  r = toggleTaskLines('- [X] 买菜', 0, 9)
  check('capital X → unchecked', applyChanges('- [X] 买菜', r) === '- [ ] 买菜')
  r = toggleTaskLines('1. 甲', 0, 4)
  check('ordered item → task', applyChanges('1. 甲', r) === '1. [ ] 甲')
  r = toggleTaskLines('普通段落', 0, 4)
  check('plain line → task item', applyChanges('普通段落', r) === '- [ ] 普通段落')
  r = toggleTaskLines('  嵌套段落', 0, 6)
  check('indented line keeps indent before marker', applyChanges('  嵌套段落', r) === '  - [ ] 嵌套段落')
  r = toggleTaskLines('', 0, 0)
  check('blank line becomes task', applyChanges('', r) === '- [ ] ')
  // multi-line selection rewrites each touched line, blanks included
  r = toggleTaskLines('- 甲\n\n- 乙', 0, 10)
  check('multi-line toggle includes blanks', applyChanges('- 甲\n\n- 乙', r) === '- [ ] 甲\n- [ ] \n- [ ] 乙')
  // caret-only on a list line still toggles that line
  r = toggleTaskLines('- 甲\n- 乙', 6, 6) // caret on the second line
  check('caret-only toggles its line', applyChanges('- 甲\n- 乙', r) === '- 甲\n- [ ] 乙')
  // selection remap: anchor/head stay on the same visual lines
  r = toggleTaskLines('- 甲\n- 乙', 0, 6)
  check('multi-line selection remapped', applyChanges('- 甲\n- 乙', r) === '- [ ] 甲\n- [ ] 乙' && sel(r) === '0:14')
}

{
  // list indent helpers (4-space levels)
  check('list level 0', listIndentOf('- a').indent === 0)
  check('list level 2', listIndentOf('  - a').indent === 2)
  check('list level 4', listIndentOf('    - a').indent === 4)
  check('ordered list', listIndentOf('1. a').indent === 0)
  check('task list', listIndentOf('- [ ] a').indent === 0)
  check('plain line is not a list', listIndentOf('abc') === null)
  check('continuation is not a list', listIndentOf('  abc') === null)
  check('next level 0→4', nextIndentLevel(0) === 4)
  check('next level 2→4', nextIndentLevel(2) === 4)
  check('next level 4→8', nextIndentLevel(4) === 8)
  check('next level 6→8', nextIndentLevel(6) === 8)
  check('prev level 4→0', prevIndentLevel(4) === 0)
  check('prev level 8→4', prevIndentLevel(8) === 4)
  check('prev level 0 stays 0', prevIndentLevel(0) === 0)
  check('prev level 2 → 0', prevIndentLevel(2) === 0)
}

{
  // Enter at the end of an empty item steps a FULL 4-space level out — the
  // package's own outdent would leave a half level (`    - [ ] ` → `  - [ ] `).
  const out = (text, from = 0) => {
    const r = emptyItemOutdent(text, from)
    return r && { text: applyChanges(text, r), caret: r.anchor }
  }
  check('empty nested item → level 0', out('    - [ ] ').text === '- [ ] ')
  check('empty nested item caret', out('    - [ ] ', 100).caret === 100)
  check('empty 8-space item → 4', out('        - ').text === '    - ')
  check('empty item outdent lands on the new marker', out('        - ', 20).caret === 24)
  check('empty ordered item → level 0', out('    1. ').text === '1. ')
  check('empty top-level item leaves the list', out('- [ ] ').text === '')
  check('empty top-level bullet leaves the list', out('- ').text === '')
  check('legacy 2-space item → level 0', out('  - [x] ').text === '- [x] ')
  check('non-empty item is not an outdent', emptyItemOutdent('- 买菜') === null)
  check('continuation line is not an outdent', emptyItemOutdent('    abc') === null)
  check('plain blank line is not an outdent', emptyItemOutdent('') === null)
}

if (failures === 0) {
  console.log('\nall tests passed')
  process.exit(0)
} else {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
}

