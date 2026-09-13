# Changelog

> 版本变更记录。

## 0.2.0 — 2026-09-13

- **集成（破坏性）**：草稿标签页改挂 dsh 的**官方右侧栏**，不再依赖 `dsh-better-sidebar`；要求 dsh **≥ 0.1.5-rc.1**（声明在 `engines.dsh`，插件市场据此提示兼容性）。打开方式不变：右侧栏标签栏「+」→ 引导页选 **草稿 / Draft**；标签页可拖动、分栏、浮动。
- 编辑体验：
  - 快捷键（切换式）：`Mod/⌘-B` 加粗、`Mod-I` 斜体、`Mod-L` 任务框；`Tab` / `Shift-Tab` 整行缩进一级。
  - 缩进所见即所得：源码 4 空格一级 = 渲染 4 空格一级（此前渲染约 1.8 空格）；无序/有序/任务框一致，折行续行与首行文字对齐。
  - 空列表项回车退**一整级**（此前退半级、残留 2 空格）；行中/行尾回车新建同级列表项，有序/无序行为一致。
  - 任务框与同级列表文字对齐（此前右偏 0.24em）；空任务行光标与方框之间留有间距。
  - 编辑器底部留白 40vh（长文可滚到屏幕中部）；标签标题与引导页文案跟随宿主语言实时切换。
- 发布：npm `dsh-draft@0.2.0`（latest）· GitHub `lalalaleo/dsh-draft`（main）。
- 待办：awesome-dsh-plugin 收录 PR（顺延自 0.1.0）。

## 0.1.0 — 2026-09-09

- 首个版本：基于 Markdown 的 dsh 草稿板插件。
- Live Preview 编辑（@atomic-editor/editor）：标题/列表/任务框/表格/引用/链接/代码围栏（~20 语言语法高亮）。
- 本地持久化：自动保存到 `$DSH_HOME/draft.md`（原子写、≤2MB、localStorage 镜像兜底）。
- 简单 en/zh i18n（Tab 标题跟随宿主语言偏好；状态/提示文案跟随文档语言）。
- 发布：npm `dsh-draft@0.1.0`（2026-09-08T18:55Z，latest）· GitHub `lalalaleo/dsh-draft`（main）。
- 待办：awesome-dsh-plugin 收录 PR（仓库满 1 天：UTC 2026-09-09T18:25Z 后提交）。