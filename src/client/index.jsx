/**
 * dsh-draft — browser (client) entry.
 *
 * Registers one "草稿 / Draft" page tab in the OFFICIAL right sidebar
 * (`@deepseek-ai/dsh-client-ui-sidebar-right`). A tab type registers in two
 * stages — the sidebar's public path for every type, shipped with the product
 * or not:
 *
 *   1. the type itself into the `sidebarRightTabs` registry: its kind, the chip
 *      title, and the guide entry that makes the sidebar's add-tab control list
 *      it;
 *   2. its body (and, for a live title, its title) into the keyed
 *      `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` seats, under
 *      the definition's own `id`.
 *
 * The tab hosts the live Markdown editor from ./editor.jsx; content is
 * autosaved to the host route which persists it to disk, so nothing is lost on
 * refresh. The tab body is session-scoped (that is the seat's scope); the
 * document it edits is not — every mount reads the same draft file.
 */
import { ScratchpadTab } from './editor.jsx'
import { isZh } from './i18n.js'

/** Services this half needs: the tab-type registry, the slot seats, and copy. */
export const inject = ['sidebarRightTabs', 'slots', 'locale']

/** This implementation's identity in the tab system: what its body and title
 *  register under. A kind is not unique across packages, an id is. */
const DRAFT_ID = 'dsh-draft'
/** The type discriminator: what `openTab` names, and what the guide opens. */
const DRAFT_KIND = 'draft'
/** Guide position; after the shipped types (files 10, document previews follow). */
const GUIDE_ORDER = 55

/** The tab glyph: a small notepad, sized by the seat that draws it. */
function DraftIcon({ size = 16, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
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
  // Styles (editor theme + status bar) are injected by the editor itself on
  // mount, tagged data-plugin="dsh-draft" so HMR can drop them cleanly.

  /** Title / guide copy reads the host locale on every use, so a language switch
   *  needs no re-registration. */
  const label = () => (isZh(ctx) ? '草稿' : 'Draft')
  const blurb = () => (isZh(ctx) ? '随手写点什么，自动保存到磁盘' : 'Jot something down — autosaved to disk')

  /** The tab body; the seat's props (tab info hooks, locale) are not needed. */
  const DraftBody = () => <ScratchpadTab />
  /** The chip title, so it follows a language switch instead of keeping the
   *  text captured when the tab was opened. */
  const DraftTitle = () => <>{label()}</>

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: DRAFT_ID,
        kind: DRAFT_KIND,
        priority: 'extension',
        title: () => label(),
        guide: [{ order: GUIDE_ORDER, title: label, description: blurb, icon: DraftIcon }],
      }),
    'dsh-draft: register the draft tab type',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: DRAFT_ID }, DraftBody),
      ),
    'dsh-draft: register the draft tab body',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: DRAFT_ID }, DraftTitle),
      ),
    'dsh-draft: register the draft tab title',
  )
}
