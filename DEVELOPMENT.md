# dsh-draft 开发参考

> 面向开发工作的工作流参考：工程现状、构建、测试、挂载、调试、踩坑。**稳定的规则见 `AGENTS.md`**；本文件收录"会变的部分"，随开发演化。

## 1. 工程现状

- 版本：0.1.0（已发布：npm 2026-09-08T18:55Z）。能力：Live Preview 编辑（标题/列表/任务框/表格/引用/链接/代码围栏高亮）、自动落盘、明暗跟随宿主、简单 en/zh i18n。
- **CI**（GitHub Actions，`.github/workflows/`）：`ci.yml` 在 PR/push 上全跑 `npm ci --legacy-peer-deps` + build + test；`release.yml` 在 `v*` tag 上自动 npm publish（幂等：版本已存在则跳过，补打旧 tag 安全。规则见 AGENTS §4）。`package-lock.json` 已入库（`npm ci` 依赖；npm 发布自动排除该文件，不进包）。
- **编辑器（当前实现）**：`@atomic-editor/editor`（MIT, kenforthewin/atomic-editor）——实现可替换，范式见 AGENTS §2。**不要**回到手写 `width:0` 隐藏 + widget（结构性 bug，见 §7）。
- **样式映射**：库读 `--atomic-editor-*` 变量；`.dsh-draft.light/.dark .atomic-cm-editor` 上重映射到 `--draft-*`（light/dark 各一套）；标题按级覆盖（h2 下划线）、引用绿 rail、行内代码底色。
- **语法高亮**：`CODE_LANGUAGES = ATOMIC_CODE_LANGUAGES`（约 20 种：JS/TS/Python/Go/Rust/C/C++/Java/PHP/Swift/Shell/SQL/HTML/CSS/XML/JSON/YAML/TOML/Dockerfile/Markdown），引用必须稳定（模块级常量）；`--draft-hl-*` 双套调色板 + `--draft-codeblock-bg` 打底。加语言：`npm install --save-dev --legacy-peer-deps --no-audit --no-fund @codemirror/lang-<x>`，再改 code-languages 清单或传自建 `LanguageDescription[]`。
- `markdownSource` 是**受控源**（变更=重建视图）：只在加载后设一次；编辑一律走 `onMarkdownChange`。
- **i18n（en/zh）**：Tab 标题经 `ctx.locale`（宿主偏好、实时；未注入时降级浏览器语言）；组件文案按文档/浏览器语言（模块加载时定，刷新重选）。见 `src/client/i18n.js`；注入门控的坑见 §7。

## 2. 构建（lib/client.js）

- `scripts/build.mjs` 使用 devDependency 的 esbuild（`node_modules/.bin/esbuild`，CI/任意平台）。参数：bundle / cjs / browser / es2020 / jsx=automatic / `.css=text` / react 系 external。
- 产物手工包 `window.__ModuleLoader__.load({ id: "dsh-draft", factory: (require) => … })`；id 必须与包名一致。
- 依赖：全部在 devDependencies（CM6 全家 + @lezer + @atomic-editor/editor + esbuild）。安装必带 **`--legacy-peer-deps`**（否则拉宿主 peer 大树，400MB+）。

## 3. 测试

- `node scripts/test.mjs`：`src/codec.js`（**legacy 参考实现**，编辑器已不用）往返/不变量测试，纯逻辑无 DOM。
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
2. 有 entry 但 Tab 不进：`betterSidebar` 服务未就绪（inject 等待）或 bundle 抛错（Console）。
3. host 报 `client bundle not found` → 改了 src 未重打包。
4. bundle id 与包名不一致 → 不激活。

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

### 构建与依赖
- **`--legacy-peer-deps` 必须**（peer 大树）；编辑器库零 dependencies 全 peer，devDependencies 必须列全。
- **`--no-save` 手工清单方案已废弃**（曾致误删）；依赖全部进 devDependencies。
- **包元数据按名缓存**：改 `dsh.client`/`exports` 需重启 host。

### 宿主与运行
- **`webServer` vs `httpServer`**：新旧键，代码有回退。
- **route/文件名三处一致**。
- **HMR 语义**：bundle 热替换只重跑 apply；host 从不热更。
- **bundle id = 包名**，否则不激活。
- **`ctx.locale` 是 inject-gated 服务**：未注入时访问 getter 直接抛 `cannot get property "locale" without inject`（可选链救不了 getter 抛错）；i18n 用 try/catch 降级浏览器语言。

### 数据与兼容
- `src/codec.js` 是 legacy 参考实现，勿当现行管线。