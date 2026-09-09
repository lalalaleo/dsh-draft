/**
 * Roundtrip + invariant tests for the markdown codec.
 * Pure node tests — no DOM required (the codec in src/codec.js is DOM-free).
 *
 *   node scripts/test.mjs
 */
import { parseDoc, serializeDoc, parseInline, serializeInline } from '../src/codec.js'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail !== undefined ? `\n       ${detail}` : ''}`)
  }
}

/** Roundtrip: serialize(parse(md)) should reproduce canonical md exactly
 *  (canonical form ends with a single trailing newline). */
function roundtrip(name, md) {
  const expected = md === '' ? '' : md.endsWith('\n') ? md : `${md}\n`
  const out = serializeDoc(parseDoc(md))
  check(`roundtrip ${name}`, out === expected, `in:  ${JSON.stringify(md)}\nout: ${JSON.stringify(out)}\nexp: ${JSON.stringify(expected)}`)
}

roundtrip('empty', '')
roundtrip('plain paragraphs', '你好\n\n这是第二段。')
roundtrip('single-line paragraph', '一句话')
roundtrip('headings', '# 标题一\n\n## 标题二\n\n### 标题三')
roundtrip(
  'lists nested + task',
  '- 甲\n  - 甲一\n  - 甲二\n- 乙\n\n1. 一\n1. 二\n\n- [ ] 买菜\n- [x] 写代码',
)
roundtrip('quote with blank', '> 引用第一行\n>\n> 引用第二行')
roundtrip('code fence', '```js\nconst a = 1\nconsole.log(a)\n```\n\n后面一段。')
roundtrip('hr', '甲\n\n---\n\n乙')
roundtrip(
  'inline mixed',
  '有 **加粗**、*斜体*、`代码` 和 [链接](https://example.com) 的一段。',
)
roundtrip('paragraph with soft breaks', '第一行\n第二行\n\n新段')

// Inline specifics
{
  const md = '**加粗** 和 *斜体* 和 `代码` 和 [链接](https://example.com) 和普通文字'
  const segs = parseInline(md)
  check('inline parse has markup', segs.some((s) => s.k !== 's'))
  check('inline serialize stable', serializeInline(segs) === md)
}
check('unbalanced bold stays literal', serializeInline(parseInline('**没写完的')) === '**没写完的')
check('lone asterisk stays literal', serializeInline(parseInline('2 * 3 = 6')) === '2 * 3 = 6')
check('nested bold+italic', serializeInline(parseInline('**粗 *斜* 体**')) === '**粗 *斜* 体**')

// Lossless on arbitrary-ish writer text (nothing dropped, nothing added).
{
  const messy = '随手打字，**未闭合标记 ` 还有 (括号 [方括号] 以及 50% 折扣…'
  check('messy text preserved', serializeDoc(parseDoc(messy)) === messy + '\n')
}

// serializeDoc never throws on weird docs
{
  const docs = [
    { blocks: [{ t: 'h', lv: 9, c: [{ k: 's', t: 'x' }] }] },
    { blocks: [{ t: 'quote', blocks: [] }] },
    { blocks: [{ t: 'code', lang: 'x', text: '' }] },
    { blocks: [{ t: 'ul', items: [{ lv: 3, kind: 'ol', task: true, c: [{ k: 's', t: '深' }] }] }] },
  ]
  for (const d of docs) {
    const md = serializeDoc(d)
    check('serialize odd doc ok', typeof md === 'string' && md.length >= 0)
    // and it reparses without throwing
    check('reparse odd doc ok', typeof serializeDoc(parseDoc(md)) === 'string')
  }
}

// NOTE: no process.exit here — later sections (inline tokens, markdown-ops)
// must run too; the suite exits once at the end of the file.

// ─── live inline-token helpers ───
import { inlineTokens, caretInMarker, caretDisplacement } from '../src/codec.js'
{
  const toks = inlineTokens('**加粗** 和 *斜* 和 `代码`')
  check('tokens count', toks.length === 3)
  check('types', toks[0].kind === 'b' && toks[1].kind === 'i' && toks[2].kind === 'c')
  check('no stray asterisk math', inlineTokens('价格 2 * 3 = 6').length === 0)
  check('lone dash not a token', inlineTokens('- 项目').length === 0)
  // caret mapping for **加粗** (markers at 0..2 and 4..6; content '加粗' at 2..4)
  const boldToks = inlineTokens('**加粗**')
  const raw = '**加粗**'
  const atEnd = raw.length // 6
  check('end displacement hides 4', caretDisplacement(6, boldToks) === 4)
  check('mid content hides 2', caretDisplacement(3, boldToks) === 2)
  check('caret in opening marker', caretInMarker(1, boldToks) === true)
  check('caret in closing marker', caretInMarker(5, boldToks) === true)
  check('caret in content safe', caretInMarker(3, boldToks) === false)
}

// ─── editor formatting helpers (markdown-ops.js) ───
import { toggleWrap, toggleTaskLines } from '../src/client/markdown-ops.js'

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

if (failures === 0) {
  console.log('\nall tests passed')
  process.exit(0)
} else {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
}
