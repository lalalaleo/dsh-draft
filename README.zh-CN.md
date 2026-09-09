# dsh-draft

[![npm version](https://img.shields.io/npm/v/dsh-draft.svg)](https://www.npmjs.com/package/dsh-draft)
[![license](https://img.shields.io/npm/l/dsh-draft.svg)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/dsh-draft.svg)](https://www.npmjs.com/package/dsh-draft)
[![GitHub stars](https://img.shields.io/github/stars/lalalaleo/dsh-draft?style=social)](https://github.com/lalalaleo/dsh-draft)

> dsh-draft 是一款基于 Markdown 的 dsh 草稿板插件，支持实时预览编辑，本地持久化。

[English](README.md) | **中文**

## 理念

**无负担。** 想随手写点什么时，能立刻找到地方写下来——输入体验顺手，也不用担心写下的内容会丢失。

## 特性

- **Live Preview** —— 边输入边渲染，Markdown 始终是真实可编辑的文档。
- **本地持久化** —— 自动保存到 `$DSH_HOME/draft.md`（默认 `~/.dsh/draft.md`），刷新、重启都不丢。
- **格式快捷键** —— `Mod-B` / `Ctrl-B` 切换**加粗**，`Mod-I` / `Ctrl-I` 切换*斜体*，`Mod-L` / `Ctrl-L` 切换任务框；再按一次取消。

## 安装

dsh-draft 运行在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的右侧面板中——请先确保已安装它，再安装本插件：

```sh
dsh plugin --profile <profile> add dsh-draft
```

把 `<profile>` 换成你的 profile 名（默认 web profile 是 `web`）。也可以在 dsh 内的 dshmarket 插件市场一键安装。npm 包自带预构建浏览器产物，无需构建授权。安装后重启 Web UI，或直接刷新页面。

## 使用

打开右侧 better-sidebar，点击标签栏「+」，选择 **草稿**，开始输入。

写作用键盘为主：选中文字后按 `Ctrl/Cmd+B`（加粗）或 `Ctrl/Cmd+I`（斜体）包裹——再按一次取消。列表行上按 `Ctrl/Cmd+L` 切换任务框（`[ ]` ⇄ `[x]`；普通行会自动变成任务项）。嵌套列表续行缩进 4 个空格。

## 参与

本项目**全程由 dsh agent 开发维护**。如果你想参与，请通过你自己的 dsh 会话接入本仓库——它会读取并遵循 `AGENTS.md`。没有真人开发者直接编写代码。

## 许可

MIT — 见 [LICENSE](LICENSE)。第三方致谢：[CREDITS.md](CREDITS.md)。

问题与建议：<https://github.com/lalalaleo/dsh-draft/issues>

<!-- Screenshots: 首次发布后补充 assets/screenshot-*.png（经 screenshots.json 引用）。 -->