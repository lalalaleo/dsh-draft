/**
 * Minimal en/zh copy for dsh-draft. The dsh ecosystem ships en/zh; anything
 * not zh falls back to English. Kept deliberately small (AGENTS §1.4):
 *
 * - Tab title follows the HOST locale preference (`ctx.locale`, live) —
 *   see isZh(ctx), used by a function title in registerTab.
 * - Component copy follows the document/browser language at module load;
 *   a page refresh re-picks the language.
 */
export function detectZh() {
  try {
    const doc = typeof document !== 'undefined' && document.documentElement
      ? document.documentElement.lang || ''
      : ''
    const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
    return String(doc || nav).toLowerCase().startsWith('zh')
  } catch {
    return false
  }
}

/** zh / en selector for component copy. */
export const t = (zh, en) => (detectZh() ? zh : en)

/**
 * Whether the active plugin context runs in Chinese (host preference).
 *
 * `locale` is an inject-gated service: without an `inject` declaration,
 * merely touching `ctx.locale` throws ("cannot get property ... without
 * inject"), which optional chaining cannot catch (getter throws, it never
 * yields undefined). So the access is guarded: when the service is present
 * (injected host), the host preference wins; otherwise fall back to the
 * document/browser language. The tab title re-evaluates per render, so a
 * host locale switch is picked up live.
 */
export function isZh(ctx) {
  try {
    const active = ctx?.locale?.getLocale?.().active
    if (active) return String(active).toLowerCase().startsWith('zh')
  } catch {
    /* locale service not injected — fall through to browser language */
  }
  return detectZh()
}