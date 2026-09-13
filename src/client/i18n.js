/**
 * Minimal en/zh copy for dsh-draft. The dsh ecosystem ships en/zh; anything
 * not zh falls back to English. Kept deliberately small (AGENTS §1.4).
 *
 * ONE source of truth for the language: the host's locale preference. The
 * client entry reads it into this module (`setHostLocale`) on load and on every
 * `ctx.locale` change, so the tab title, the guide copy and the editor's status
 * bar all follow the same preference. Before this they disagreed whenever a
 * Chinese host ran an English browser: the title used the host locale while
 * component copy used the document/browser language.
 *
 * The document/browser language remains only as the fallback for a host where
 * the locale service is unavailable.
 */

/** Host preference, pushed in by the client entry; null until then. */
let hostZh = null

/** Record the host's language preference. */
export function setHostLocale(zh) {
  hostZh = zh
}

/** Read a dsh context's language preference; null when the service is absent. */
export function readHostLocale(ctx) {
  try {
    const active = ctx?.locale?.getLocale?.().active
    return active ? String(active).toLowerCase().startsWith('zh') : null
  } catch {
    // `locale` is an inject-gated service: an undeclared access throws rather
    // than yielding undefined, so optional chaining alone cannot guard it.
    return null
  }
}

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

/** Whether copy should be Chinese: the host preference when known, else the
 *  document/browser language. Evaluated per call, so it tracks a locale switch. */
export function isZh() {
  return hostZh ?? detectZh()
}

/** zh / en selector for component copy. */
export const t = (zh, en) => (isZh() ? zh : en)
