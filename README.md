# dsh-draft

[![npm version](https://img.shields.io/npm/v/dsh-draft.svg)](https://www.npmjs.com/package/dsh-draft)
[![license](https://img.shields.io/npm/l/dsh-draft.svg)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/dsh-draft.svg)](https://www.npmjs.com/package/dsh-draft)
[![GitHub stars](https://img.shields.io/github/stars/lalalaleo/dsh-draft?style=social)](https://github.com/lalalaleo/dsh-draft)

> dsh-draft is a Markdown-based draft-board plugin for dsh with live-preview editing and local persistence.

**English** | [中文](README.zh-CN.md)

## Philosophy

**No burden.** Whenever there is something to jot down, there is a place to write it right away — a pleasant typing experience, and no worries about losing what you wrote.

## Features

- **Live Preview** — what you type is rendered as you type; the Markdown stays the real, editable document.
- **Local persistence** — autosaved to `$DSH_HOME/draft.md` (default `~/.dsh/draft.md`), safe across refreshes and restarts.
- **Formatting shortcuts** — `Mod-B` / `Ctrl-B` toggles **bold**, `Mod-I` / `Ctrl-I` toggles *italic*, `Mod-L` / `Ctrl-L` toggles a task checkbox. Toggle means pressing the same key again removes it.

## Installation

dsh-draft lives inside the [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) right panel — make sure it is installed first, then:

```sh
dsh plugin --profile <profile> add dsh-draft
```

Replace `<profile>` with your profile name (the default web profile is `web`). You can also install it with one click from the dshmarket plugin marketplace inside DSH. The npm package ships a prebuilt browser bundle — no build approval needed. Restart the Web UI afterwards, or simply refresh the page.

## Usage

Open the right sidebar, click "+" in its tab bar, and pick **Draft / 草稿** — start typing.

Formatting is keyboard-first: select text and press `Ctrl/Cmd+B` (bold) or `Ctrl/Cmd+I` (italic) to wrap it — press again to unwrap. `Ctrl/Cmd+L` on a list line toggles its task checkbox (checked ⇄ unchecked; a plain line becomes a task). Nested list continuation indents with 4 spaces.

## Participation

This project is developed end-to-end by **dsh agents**. If you would like to participate, join through your own dsh session — it will pick up this repository and follow `AGENTS.md`. No human developers edit the code directly.

## License

MIT — see [LICENSE](LICENSE). Third-party credits: [CREDITS.md](CREDITS.md).

Issues & feature requests: <https://github.com/lalalaleo/dsh-draft/issues>

<!-- Screenshots: add assets/screenshot-*.png (referenced via screenshots.json) after the first release. -->