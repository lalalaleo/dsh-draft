# dsh-draft — 工作手册

给任何接手/参与本项目的 **dsh agent 会话**的工作手册。本项目由 dsh agent 端到端开发与维护；未来的协作者也应通过自己的 dsh 会话、借助本文件**无缝切入**（不会有真人开发者直接参与写代码）。请先通读本文件再动手。

本文只收录**稳定的事实与规则**；`请勿轻易推翻`——若确需推翻，先证明新方案能覆盖被替代方案解决的全部问题。**会变的内容**（工程现状、构建/调试细节、踩坑、发布 SOP、会话记忆、变更记录）在 `.dsh/` 目录（见 §5 索引），不放在本文。

---

## 1. 项目初衷与理念

- **定位**：极简的 dsh 草稿板插件。设计重心排序：**编辑体验 > 展示效果 > 持久化可靠性**——持久化简单易实现，展示相对好实现，**编辑体验最值得深入**。
- **理念**：**无负担 · 精简**。任何新功能先过三问：① 是否破坏精简？② 是否增加心智负担？③ 是否非刚需？**三关不过，不做**。宁缺毋滥。
- **工作流意义**：作者的第一个 dsh 插件——目标是走通流程、积累经验，沉淀一套**完整、可靠的 dsh 插件开发/发布工作流**；结论回写本文档与 `.dsh/`。

## 2. 底线与当前形态

**底线（不可违背）**：只有 README 起首那句承诺——**想随手写点什么时，能立刻找到地方写下来：输入体验顺手，不用担心内容丢失。**

**当前形态（为兑现底线做的决策——可演进，实现可替换，不是禁令）**：

- **Live Preview 交互**：`*` 等标记是真实可编辑文本（平时隐藏、光标落上显现、可删 `*` 取消格式）——"输入体验顺手"的当前方案；曾试错的编辑层选型见 DEVELOPMENT.md §7。
- **无工具栏 / 无配置项**：保持"想写即写"的零步骤形态。
- **本地纯 Markdown 持久化**：`$DSH_HOME/draft.md`（机制细节见 DEVELOPMENT.md §5）——"不丢失"的当前载体。
- **克制判据**：新功能三问不过不做（§1）——守住"无负担"的策略。

## 3. 目录结构（重要目录/文件）

```
dsh-draft/
├── package.json        # dsh.bundle.patch + dsh.client.platform=web + exports["./client"] + 全量 devDependencies
├── cordis.patch.yml    # bundle 补丁行：- insert: { id: draft, name: dsh-draft }
├── README.md           # 用户手册（EN 主 + 徽章）
├── README.zh-CN.md     # 中文版 README（互链）
├── AGENTS.md           # 本文件：稳定事实与规则
├── LICENSE             # MIT
├── CREDITS.md          # 第三方致谢
├── DEVELOPMENT.md      # 工程开发参考（现状/构建/测试/挂载/调试/踩坑）
├── CHANGELOG.md        # 版本变更记录
├── .dsh/               # 私有（gitignored）：RELEASING.md（发布 SOP）、MEMORY.md（跨会话记忆）
├── lib/
│   ├── index.js        # host 面源码（仅 Node 内置模块）
│   └── client.js       # browser 面构建产物（×不入库；发布时随包）
├── src/
│   ├── codec.js        # legacy 纯 codec 参考实现（仅测试用）
│   └── client/         # index.jsx（注册 Tab）、editor.jsx（编辑器+自动保存）、i18n.js（en/zh）
├── scripts/            # build.mjs（打包）、test.mjs（测试）
└── node_modules/       # 构建期依赖（不入库）
```

## 4. 基本架构与运行逻辑（DSH 插件双面协议）

- **host 面（Node）**：`exports "."` → `lib/index.js`。Cordis 插件**具名导出** `{ name, inject, apply }`（无 default export）；`apply(ctx)` 里注册路由/服务。
- **client 面（浏览器）**：`package.json` 声明 `"dsh": { "client": { "platform": "web", ... }, "bundle": { "patch": "./cordis.patch.yml" } }`，且 `exports["./client"]` 指向 `lib/client.js`。
- **挂载行**：向 profile 的 `cordis.patch.yml` 插入 `- insert: { id: draft, name: dsh-draft }`——`name` 必须等于包名（client-modules 按它定位 package.json）。
- **浏览器加载**：`dsh-client-modules`（Node 侧）扫描已挂载行的包 → 收进 `window.__DSH_BOOT__` 名册；bundle 以 **CJS closure-factory** 注册：`window.__ModuleLoader__.load({ id: "dsh-draft", factory: (require) => … })`。
- **client 插件**导出 `{ inject: ['betterSidebar'], apply(ctx) }`（`betterSidebar` 由 dsh-better-sidebar 的 client 半提供）；注册 `registerTab({ id: 'draft', title: () => … })`。
- **平台模块**（`react`、`react-dom/client`、`react/jsx-runtime`）由浏览器 loader 提供——**打包时 external**；其余依赖（CM6 等）打进 bundle。
- **语言**：dsh 生态为 en/zh。Tab 标题经 `ctx.locale`（宿主偏好，实时；未注入时降级浏览器语言——inject 门控见 DEVELOPMENT.md §7）；组件文案按文档/浏览器语言（见 `src/client/i18n.js`）。

## 5. 重要文档索引

| 文档 | 读者 | 内容 |
|---|---|---|
| `README.md` / `README.zh-CN.md` | 用户 | 介绍、设计理念、安装、使用 |
| `AGENTS.md`（本文件） | dsh agent | 稳定事实与规则（架构协议/决策/索引） |
| `DEVELOPMENT.md` | 开发中的 agent | 工程现状、构建、测试、挂载、调试、踩坑 |
| `CHANGELOG.md` | 用户/维护 | 版本变更记录 |
| `.dsh/RELEASING.md`（私有） | 发布 agent | 发布/收录 SOP |
| `.dsh/MEMORY.md`（私有） | 跨会话 | 条目化记忆（规则见 §6） |
| `CREDITS.md` | 合规 | 第三方致谢 |

---

## 6. 记忆机制（.dsh/MEMORY.md）

私有条目化记忆，用于跨会话传递**差量**信息（正式文档与板上是真相源，记忆只记"别处没有的"）。

- **记录什么**：只记"没有它、下个会话会不知道或搞错"的差量——环境/凭据状态、阶段与待办、新决策、用户偏好。可从代码、正式文档（AGENTS/DEVELOPMENT/CHANGELOG/README）或板上推导的，一律不记。
- **什么时候记录**：关键节点（阶段转移、发布、环境事实变化、用户重要偏好或决策拍板）；会话收尾仅当本会话有上述变化才写。**非每轮都写**。
- **格式**：两个固定区块——`## 事实`（环境/凭据）、`## 动态`（阶段/决策/偏好）；一条一行 `[YYYY-MM-DD] 标签：一句话`；**无段落、无自述**（吸取教训：文档不自我介绍）。
- **上限与优化**：≤30 行（约 3KB）。四条优化：① **完成即删**；② **入档即删**（写进正式文档后移除）；③ **过期即删**（一周未更新且不再相关）；④ **超限压缩**（保 事实 > 动态，最旧已完成的先删）。大节点（如发布）后做一次清仓。
- **去留**：本机制非必要——若维护成本超过收益，优先**删除机制**；未来有需要另寻他路（如第三方记忆类插件）。