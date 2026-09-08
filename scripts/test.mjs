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

if (failures === 0) {
  console.log('\ncodec: all tests passed')
  process.exit(0)
} else {
  console.error(`\ncodec: ${failures} test(s) failed`)
  process.exit(1)
}

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
