# dsh-draft 开发参考

> 面向开发工作的工作流参考：工程现状、构建、测试、挂载、调试、踩坑。**稳定的规则见 `AGENTS.md`**；本文件收录"会变的部分"，随开发演化。

## 1. 工程现状

- 版本：0.2.0（本次待发布；0.1.0 已发布 npm 2026-09-08T18:55Z）。能力：Live Preview 编辑（标题/列表/任务框/表格/引用/链接/代码围栏高亮）、挂 dsh 官方右侧栏的草稿标签页、自动落盘、明暗跟随宿主、简单 en/zh i18n。
- **CI**（GitHub Actions，`.github/workflows/`）：`ci.yml` 在 PR/push 上全跑 `npm ci --legacy-peer-deps` + build + test；`release.yml` 在 `v*` tag 上自动 npm publish（幂等：版本已存在则跳过，补打旧 tag 安全。规则见 AGENTS §4）。`package-lock.json` 已入库（`npm ci` 依赖；npm 发布自动排除该文件，不进包）。
- **编辑器（当前实现）**：`@atomic-editor/editor`（MIT, kenforthewin/atomic-editor）——实现可替换，范式见 AGENTS §2。**不要**回到手写 `width:0` 隐藏 + widget（结构性 bug，见 §7）。
- **右侧栏集成**：挂进 dsh **官方右侧栏**（`@deepseek-ai/dsh-client-ui-sidebar-right`），两段式注册（类型 → 主体/标题），guide 条目让侧栏「+」列出草稿。已不再依赖 dsh-better-sidebar；`package.json` 的 `dsh.engines.dsh` 声明最低 dsh 版本，`dsh.client.inject` 列官方包名（排序/预载用）。细节与踩坑见 §7。
- **列表缩进（4 空格约定）**：库把每级缩进写死为 `LIST_LEVEL_EM = 0.6`（≈1.8 空格）并以行内 `padding-left` 输出，无变量/选项可调；`src/client/list-indent.js` 用自补 line decoration 改成 1.33em/级（= 4 空格），基座 2em（= 库的 0.8em + 1.2em alcove）不动。任务框右侧间距与 `text-indent` 补偿在同一层（见 §7）。
- **样式映射**：库读 `--atomic-editor-*` 变量；`.dsh-draft.light/.dark .atomic-cm-editor` 上重映射到 `--draft-*`（light/dark 各一套）；标题按级覆盖（h2 下划线）、引用绿 rail、行内代码底色。
- **语法高亮**：`CODE_LANGUAGES = ATOMIC_CODE_LANGUAGES`（约 20 种：JS/TS/Python/Go/Rust/C/C++/Java/PHP/Swift/Shell/SQL/HTML/CSS/XML/JSON/YAML/TOML/Dockerfile/Markdown），引用必须稳定（模块级常量）；`--draft-hl-*` 双套调色板 + `--draft-codeblock-bg` 打底。加语言：`npm install --save-dev --legacy-peer-deps --no-audit --no-fund @codemirror/lang-<x>`，再改 code-languages 清单或传自建 `LanguageDescription[]`。
- `markdownSource` 是**受控源**（变更=重建视图）：只在加载后设一次；编辑一律走 `onMarkdownChange`。
- **i18n（en/zh）**：Tab 标题/guide 文案经 `ctx.locale`（宿主偏好、实时；`locale` 已进 client inject）；组件文案按文档/浏览器语言（模块加载时定，刷新重选）。见 `src/client/i18n.js`；注入门控的坑见 §7。

## 2. 构建（lib/client.js）

- `scripts/build.mjs` 使用 devDependency 的 esbuild（`node_modules/.bin/esbuild`，CI/任意平台）。参数：bundle / cjs / browser / es2020 / jsx=automatic / `.css=text` / react 系 external。
- 产物手工包 `window.__ModuleLoader__.load({ id: "dsh-draft", factory: (require) => … })`；id 必须与包名一致。
- 依赖：全部在 devDependencies（CM6 全家 + @lezer + @atomic-editor/editor + esbuild）。安装必带 **`--legacy-peer-deps`**（否则拉宿主 peer 大树，400MB+）。

## 3. 测试

- `node scripts/test.mjs`：`src/codec.js`（**legacy 参考实现**，编辑器已不用）往返/不变量测试 + `src/client/markdown-ops.js` 的纯函数（wrap/task 切换、列表缩进级别、空项退级），纯逻辑无 DOM。
- 渲染效果只能浏览器验收（§6.6）。

## 4. 挂载（npm 安装 / 源码开发）

- **发布形态**：`dsh plugin --profile <profile> add dsh-draft`（`--profile` 必填；web profile 名 `web`），或 profile 的 `cordis.patch.yml` 插入 `- insert: { id: draft, name: dsh-draft }`。
- **源码开发挂载**：`name` = 仓库 `lib/index.js` 的绝对路径（免安装/免符号链接；本机开发即用此法）。
- `patchReload: live` 保存即热生效；`dsh-client-hmr`（~500ms）轮询 `lib/client.js`，变化自动 rebuilt 广播；稳的验收 = ⌘R 整页刷新。
- ⚠️ `dsh.client`/`exports` 包元数据按名缓存：改动需**重启 host**；只改 bundle 走 HMR。

### 卸载 / 回滚
删 profile `cordis.patch.yml` 的 insert 段（保存即热生效）；npm 安装的再从依赖移除；数据文件 `$DSH_HOME/draft.md` 自行保留。

## 5. Persistence 细节

- host（lib/index.js）：`inject: ['webServer']`（旧键 `httpServer` 有回退：`ctx.webServer ?? ctx.get('webServer') ?? ctx.get('httpServer')`）；`/draft/api` GET 读 / PUT 写；`storageFile()` = `$DSH_HOME/draft.md`（默认 `~/.dsh/draft.md`）；原子写（tmp+rename）、promise 链串行、≤2MB。
- client（editor.jsx）：GET 取 `{text, savedAt}`；localStorage 镜像（`dsh-draft.mirror.v4`）`ts > remote.savedAt` 时优先本地并回推；600ms 防抖 PUT；状态栏 已保存/保存中/保存失败；失败不丢（镜像兜底）。

## 6. 开发与调试

**改前端（src/client/*）→ 重打包 → 刷新页面；改后端（lib/index.js）→ 重启 dsh。**

### 6.1 前端热更
```sh
cd <repo> && node scripts/build.mjs
```
HMR 只重跑 apply()（重新注册 Tab），稳的做法 ⌘R。改元数据/新增依赖需重启 host。

### 6.2 后端重启
host 半从不热更：重启 dsh web 后重新 import 并注册 `/draft/api`。改路由/文件名务必**三处一致**：`lib/index.js`（注册路径、`storageFile()` 文件名）、`src/client/editor.jsx`（fetch 路径）。

### 6.3 日志
- host：dsh web 进程 stdout——`[dsh-draft] mounted at /draft/api -> <file>` / `[dsh-draft] route error: ...`。
- 浏览器：Console（`[dsh-draft] save failed: ...`）、Network `/draft/api`、localStorage 键 `dsh-draft.mirror.v4`。
- 快速验证：`curl -s http://127.0.0.1:<dsh-port>/draft/api`（本地默认端口 3080）。

### 6.4 排查"Tab 不出现"
1. `window.__DSH_BOOT__` 的 entries 无 `dsh-draft` → host 没认到：核对挂载行 name（npm 包名或绝对路径）与 `package.json` 的 `dsh.client` 声明。
2. 有 entry 但侧栏「+」的引导页里没有草稿：`sidebarRightTabs`/`slots` 服务未就绪（inject 等待）、`kind` 已被别的类型占用（同 kind 同 band 会抛错），或 bundle 抛错（Console）。
3. host 报 `client bundle not found` → 改了 src 未重打包。
4. bundle id 与包名不一致 → 不激活。
5. 未认证的浏览器打不开 GUI（`dsh web authentication required`）——headless 验证需要 `dsh web` 打印的带令牌 URL。

### 6.5 离线校验装饰
```js
// node --input-type=module -e '…'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
const st = EditorState.create({ doc: '**加粗**\n\n# 标题\n\n- 列表', extensions: [markdown()] })
syntaxTree(st).cursor().iterate((n) => console.log(n.name, n.from, n.to))
```
CSS 排版效果只能浏览器验收。

### 6.6 最小验证闭环
改完 → build（前端）或重启（后端）→ 刷新 → 侧栏「+」→ 草稿 → 输入 `**加粗**`/`# 标题`/`- 列表`/`> 引用`，核对排版、`*` 显隐、状态栏"已保存"。

## 7. 踩坑记录

### 编辑层
- **ProseMirror / Milkdown / contenteditable 作编辑层不行**（实测教训）：它们把 `**加粗**` 转成 `strong` mark，`*` 不进正文——用户没有 `*` 可删，做不到"删 `*` 取消格式"。当前方案是 CM6 装饰（`@atomic-editor/editor`）。
- **手写 `width:0` 隐藏 + widget 必败**：光标进零宽区消失、点击定位偏移、行高不稳——换完备实现才解决。
- **`EDITOR_CSS` 是反引号模板字符串**：内容/注释里绝不能出现裸反引号（提前截断字符串，bundle import 即崩：`... is not a function` / `Failed to load plugins` / Tab 消失）；`node --check` 查不出。备注用 `.ͼu` 写法而非反引号包裹。
- **CSS 特异性**：覆盖须在 atomic 样式之后或更高特异性（`.dsh-draft .cm-line.cm-atomic-h2` = 0,3,0 > 包默认 0,2,0）。
- **内层高亮 span 盖外层 mark 色**：`strong`/`em` 覆盖要穿透子元素（`.cm-atomic-strong, .cm-atomic-strong * { color: … !important }`）。
- **库 `styles.css` 必须注入**否则无样式；`codeLanguages` 引用必须稳定否则编辑器重挂。
- **列表缩进不可配置**：`LIST_LEVEL_EM = 0.6`/级（≈1.8 空格）写死在 `inline-preview.js` 里，以行内 `padding-left` 输出——CSS 变量改不了，只能自补 line decoration 覆盖（`src/client/list-indent.js`）。同位置 line decoration 的 `style` 由 CodeMirror 按 facet 顺序追加，consumer `extensions` 在包之后 → **后写的值生效，无需 `!important`**（实测：故意填更小的值也照样生效，证明是顺序而非数值）。基座 2em = 包的 `0.8em + 1.2em(alcove)`，depth 0 不受影响。
- **keymap 抢不过包的 `Prec.highest`**：CM6 把所有 keymap 汇总进*一个* `Prec.default` 的 `domEventHandlers`（`handleKeyEvents`）执行，所以包的 `Prec.highest` Enter（`insertTightListItem`）永远先跑；要抢先只能用 `Prec.highest(EditorView.domEventHandlers({ keydown }))`（见 `enterKeydown`）。踩过的坑：曾用 `Prec.high(keymap)` 接 Enter，"4 空格拆分"实际从未生效（死代码）。
- **包的列表续行/退级按 2 空格写死**（`Math.floor(indent.length / 2)`、`indent.slice(0, -2)`）：4 空格约定下空项回车会退成半级（`    - [ ] ` → `  - [ ] `）。空项退级由 `emptyItemOutdent`（`markdown-ops.js`）接管；行中/行尾 Enter 交给包（它按行自身缩进续写，4 空格下正确）。
- **任务框 widget 别自己重画**：包把 `width 1.05em + margin-left -0.16em + margin-right M` 的 advance 与 `LIST_ALCOVE_EM = 1.2em`、`text-indent = -(0.89em + M)` 绑成一套等式。曾用 `::before`/`::after` 重画加宽到 1.6em：任务文字比同级列表右偏 0.24em（实测 3.86px），换来的只是同样宽度的间距。正解=只改 `margin-right` + `list-indent.js` 里同步 `text-indent`。

### 官方右侧栏集成（0.2.0 起）
- **两段式注册，缺一不可**：`ctx.sidebarRightTabs.register({ id, kind, priority, title, guide })` 注册类型；`ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: <id> }, Body))` 注册主体，`key` 必须等于定义里的 `id`（不是 `kind`）。要在语言切换时更新标签文字，再注册 `sidebar.right.pane.tab.title`（同 key），否则 chip 用的是打开时捕获的 `title(address)` 文本。
- **发现入口是 guide**：侧栏「+」打开的是 `guide` 类型页，里面列出所有注册类型的 `guide[]` 条目；`order` 全局升序（官方 files 用 10）。不注册 `guide` 的类型只能被 `openTab(kind)` 打开——用户找不到。
- **类型分 band**：`extension`（外部插件，也是默认）/ `builtin` / `fallback`；同一 `kind` 的 `extension` 会顶掉 `builtin`，同 band 重复注册或 `id` 重复直接抛错。页面类型不写 `patterns`（那是按 `dsh-resource://` 地址认领用的）。
- **body 的 scope 是 session**：每个会话一套标签页记录，`single` 之类旧 better-sidebar 选项不存在；同一 pane 内按地址去重。我们编辑的 draft.md 是全局文件（不带 session 参数），多会话同时打开同一草稿属于 last-write-wins。
- **`dsh.client.inject` 填包名**（官方包，如 `@deepseek-ai/dsh-client-ui-sidebar-right`），运行时代码里 `export const inject` 填**服务名**（`sidebarRightTabs`/`slots`/`locale`）——两者不是一回事。
- **兼容区间写顶层 `engines.dsh`**：dshmarket 的 `manifestFacts` 只读 npm manifest 的 `engines.dsh` 与 `@deepseek-ai/dsh-*` peerDependencies（实测：顶层写 `>=0.1.5-rc.1` → `compatible (basis manifest)`；写成 `dsh.engines.dsh` → `unknown (undeclared)`）。部分已发布插件用的是嵌套 `dsh.engines`，这套工具链并不读。

### 构建与依赖
- **`--legacy-peer-deps` 必须**（peer 大树）；编辑器库零 dependencies 全 peer，devDependencies 必须列全。
- **`--no-save` 手工清单方案已废弃**（曾致误删）；依赖全部进 devDependencies。
- **包元数据按名缓存**：改 `dsh.client`/`exports` 需重启 host。
- **本地 npm 缓存 EPERM 时**：加 `--cache /tmp/<dir>` 可跑 `npm install --package-lock-only`（改 peerDependencies 后必须重生成 lockfile，否则 CI 的 `npm ci` 校验失败）。

### 宿主与运行
- **`webServer` vs `httpServer`**：新旧键，代码有回退。
- **route/文件名三处一致**。
- **HMR 语义**：bundle 热替换只重跑 apply；host 从不热更。
- **bundle id = 包名**，否则不激活。
- **`ctx.locale` 是 inject-gated 服务**：未注入时访问 getter 直接抛 `cannot get property "locale" without inject`（可选链救不了 getter 抛错）；`isZh` 用 try/catch 降级浏览器语言（已注入 `locale`，正常不会走到）。
- **GUI 需要认证**：未带 `dsh web` 打印的令牌 URL 打开时只得到 `dsh web authentication required`（cookie 由 activation secret 签名，无法离线伪造）——无头浏览器验收得用那个 URL。

### 数据与兼容
- `src/codec.js` 是 legacy 参考实现，勿当现行管线。