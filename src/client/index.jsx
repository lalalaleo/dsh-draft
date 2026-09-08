/**
 * dsh-draft — browser (client) entry.
 *
 * Registers one "草稿 / Draft" tab into the dsh-better-sidebar service
 * (`ctx.betterSidebar.registerTab`). The tab hosts the live Markdown editor
 * from ./editor.jsx; content is autosaved to the host route which persists
 * it to disk, so nothing is ever lost on refresh.
 *
 * Requires the `betterSidebar` client service, so it only activates when
 * dsh-better-sidebar is installed and enabled (see package.json
 * peerDependencies).
 */
import { ScratchpadTab } from './editor.jsx'
import { isZh } from './i18n.js'

export const inject = ['betterSidebar']

/** A small notepad glyph sized for the sidebar tab strip. */
function DraftIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
      <line x1="9" y1="9" x2="10" y2="9" />
    </svg>
  )
}

export function apply(ctx) {
  // Styles (Milkdown theme + status bar) are injected by the editor itself on
  // mount, tagged data-plugin="dsh-draft" so HMR can drop them cleanly.

  ctx.effect(
    () =>
      ctx.betterSidebar.registerTab({
        id: 'draft',
        title: () => (isZh(ctx) ? '草稿' : 'Draft'),
        order: 55,
        single: true,
        icon: (size) => <DraftIcon size={size} />,
        component: () => <ScratchpadTab />,
      }),
    'dsh-draft: register sidebar tab',
  )
}
