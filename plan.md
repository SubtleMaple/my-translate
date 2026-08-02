已确认工作目录 `D:\项目\my-translate` 当前只有需求文档，是一个全新项目。下面是完整的深度规划，不含任何实现代码。

------

# 「英汉翻译 + 生词本」悬浮窗应用 — 总体技术规划

## 0. 关键技术决策（先定论，后展开）

在展开前先明确几个影响全局的决策，后续所有章节都基于此：

| 决策点               | 结论                                                         | 理由                                                         |
| :------------------- | :----------------------------------------------------------- | :----------------------------------------------------------- |
| 构建工具             | **electron-vite**（而非手写 vite-plugin-electron）           | 专为 Electron 设计，主/preload/渲染三端一套配置，HMR 体验好，与 electron-builder 衔接成熟 |
| sql.js 运行位置      | **主进程**                                                   | 渲染进程崩溃/刷新不丢数据；天然单写入者，无并发问题；无 CSP 限制 |
| sql.js WASM 加载方式 | **手动 readFile wasm 二进制，以 `wasmBinary` 参数传入**      | 彻底绕开 `locateFile` 在 asar 打包后的路径问题               |
| LLM 调用位置         | **主进程**（Node fetch）                                     | 渲染进程是浏览器环境，直接调第三方 API 必遇 CORS；apiKey 也不暴露在渲染端 |
| 生词详情生成         | **LLM 返回 JSON → 主进程组装成 Markdown 存库**               | 音标/简要释义需要单独入库（列表页要用），让模型直接吐 Markdown 再正则提取极不可靠 |
| 窗口方案             | **无边框窗口 + 自定义标题栏**（`frame: false` + CSS drag region） | 符合"现代美观"定位；备选方案为 `titleBarStyle: 'hidden' + titleBarOverlay`（保留 Win11 原生窗口控制与贴靠布局） |
| 页面组织             | **单窗口 + 视图切换**（翻译 / 生词本 / 设置三个 Tab）        | 悬浮工具不需要多窗口，用 Zustand 管理当前视图即可，不引入 react-router |
| React 版本           | **React 18.3**（不用 19）                                    | Radix/shadcn 生态最稳，不为新版本冒险                        |
| Tailwind 版本        | **Tailwind v3.4**（不用 v4）                                 | shadcn/ui 文档与社区方案最成熟的路径                         |
| 包管理               | **pnpm + `.npmrc` 设 `node-linker=hoisted`**                 | electron-builder 对 pnpm 软链结构的兼容性历史上坑很多，hoisted 模式最省心 |
| 主进程模块格式       | **ESM**（Electron ≥ 28 支持 ESM 主进程）；**preload 仍为 CJS** | sandbox: true 的 preload 必须是 CJS，electron-vite 可分别配置输出格式 |

版本基线建议（实现时以最新稳定版微调）：Electron 33+、electron-vite 2.x、Vite 5/6、TypeScript 5.6+、sql.js 1.10+、zustand 5、electron-builder 25+、sonner（toast）、react-markdown + remark-gfm（详情 Markdown 渲染）、lucide-react（图标）。

------

## 1. 整体架构设计

### 1.1 进程职责划分

```
┌─────────────────────────── 主进程 (Node, ESM) ───────────────────────────┐
│  窗口管理：创建/恢复 bounds、置顶、透明度、缩放限制、关闭→托盘               │
│  托盘：图标、右键菜单（显示/隐藏、置顶开关、退出）、单实例锁                 │
│  数据库：sql.js 内存库 + 防抖导出 + 原子写盘 + 崩溃恢复                     │
│  LLM 服务：翻译(流式)、单词详情(JSON)、连接测试、超时/中止/限流队列          │
│  配置：electron-store 持久化（settings.json）                              │
│  IPC：ipcMain.handle 注册全部服务接口                                      │
└──────────────▲──────────────────────────────────────────────────────────┘
               │ contextBridge（contextIsolation: true, sandbox: true）
┌──────────────┴──────────── 预加载 (CJS) ─────────────────────────────────┐
│  暴露唯一全局对象 window.api，方法级白名单，类型与 src/shared 对齐          │
└──────────────▲───────────────────────────────────────────────────────────┘
               │ 类型安全调用（无 nodeIntegration）
┌──────────────┴──────────── 渲染进程 (React) ─────────────────────────────┐
│  纯 UI：视图切换、Zustand 状态、Chip 交互、Markdown 渲染、深浅色主题        │
│  不持有任何 Node 能力、不直接 fetch 任何外部 API                            │
└───────────────────────────────────────────────────────────────────────────┘
```

**安全基线**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、禁用 `remote`、渲染进程 `index.html` 配置 CSP（`default-src 'self'`；`style-src 'self' 'unsafe-inline'`）。渲染进程任何"需要能力"的操作一律走 IPC。

### 1.2 关键模块与数据流

**模块清单（主进程侧）：**

| 模块                       | 职责                                                         |
| :------------------------- | :----------------------------------------------------------- |
| `window.ts`                | 创建主窗口；bounds 记忆与恢复（校验落在可见屏幕内）；置顶/透明度应用 |
| `tray.ts`                  | 托盘创建、菜单、close 事件拦截（关闭=隐藏）、真正退出入口    |
| `db/database.ts`           | 启动时读 db 文件→加载进 sql.js；建表与 user_version 迁移     |
| `db/persist.ts`            | 变更后置脏标记，防抖 ~800ms 导出 Uint8Array，写临时文件再 rename（原子写）；`before-quit` 强制同步落盘；启动时校验文件可加载，损坏则备份后重建 |
| `db/vocabRepo.ts`          | 生词 CRUD、模糊搜索、排序、去重判断                          |
| `llm/client.ts`            | OpenAI 兼容请求封装：拼接 `{baseURL}/chat/completions`、AbortController 超时（翻译 30s / 详情 60s）、错误规范化（401/429/网络错误 → 友好文案） |
| `llm/translate.ts`         | 流式翻译：SSE 逐行解析，chunk 通过 `webContents.send` 推送渲染端 |
| `llm/wordDetail.ts`        | 详情生成：prompt 要求严格 JSON → 容错提取（截取首个 `{` 到末个 `}`）→ zod/手工校验 → 组装 Markdown |
| `services/vocabService.ts` | 编排：去重检查 → 立即插入 pending 记录 → 串行队列逐词生成详情（避免并发触发 429，失败可重试）→ 成功后更新行并广播 `vocab:changed` |
| `settings.ts`              | electron-store 读写、默认值、变更后即时应用（置顶/透明度/主题通知渲染端） |

**核心数据流（以"加入生词"为例）：**

```
渲染端: 选中 chips → 确认弹窗 → api.vocab.add([words], 原句)
   ↓ IPC invoke
主进程 vocabService:
   1. 逐词查重（word_lower UNIQUE）
   2. INSERT status='pending' → 立即返回（UI 即时可见，卡片显示"生成中"骨架）
   3. 持久化队列：串行调用 wordDetail 生成
   4. 成功 → UPDATE phonetic/brief/detail/status='ready' + 触发落盘防抖
      失败 → status='failed' + 记录原因
   5. webContents.send('vocab:changed') → 渲染端刷新列表 + toast
```

翻译数据流类似，区别在于流式：`invoke('llm:translate', text)` 建立任务 → 主进程循环 SSE chunk → 多次 `send('llm:translate:chunk', delta)` → `send('llm:translate:done')`。渲染端 Zustand 追加拼接，实现打字机效果。

### 1.3 窗口管理方案

- **默认尺寸**：约 `400×560`，`minWidth: 340`、`minHeight: 420`，`resizable: true`。
- **拖动**：自定义标题栏区域设 `-webkit-app-region: drag`，标题栏上的按钮/输入框必须显式 `no-drag`（这是最常见的坑，单列到风险章节）。
- **缩放**：无边框窗口在 Windows 上 `resizable: true` 即可边缘拖拽缩放（实现期需实测验证；如有问题，备选 `titleBarOverlay` 方案保留原生边框行为）。代价：失去 Win11 最大化按钮的 Snap Layouts，对悬浮小窗可接受。
- **置顶**：标题栏放图钉按钮 + 设置页开关，两者同步；`setAlwaysOnTop(flag)`。持久化"是否默认置顶"，启动时应用。
- **透明度**：设置页滑块（0.5–1.0），`win.setOpacity()`，即时生效并持久化。
- **关闭→托盘**：拦截窗口 `close` 事件——未处于"真退出"状态时 `preventDefault() + hide()`；托盘菜单"退出"置退出标记后 `app.quit()`。托盘菜单含：显示/隐藏、置顶开关、退出。
- **单实例锁**：`requestSingleInstanceLock()`，第二实例启动时聚焦并显示已有窗口。
- **bounds 记忆**：关闭前保存 `{x, y, width, height}`；启动恢复前校验与当前各显示器工作区有交集，否则回退居中（防止拔掉外接屏后窗口"消失"）。

------

## 2. 推荐目录结构

```
my-translate/
├─ electron.vite.config.ts        # 三端构建配置（main=ESM, preload=CJS, renderer=React）
├─ electron-builder.yml           # 打包配置
├─ package.json                   # "type": "module"，scripts 见 §7
├─ .npmrc                         # node-linker=hoisted（pnpm 关键配置）
├─ tsconfig.json                  # 引用下面两个子配置
├─ tsconfig.node.json             # main + preload
├─ tsconfig.web.json              # renderer
├─ components.json                # shadcn/ui 配置
├─ tailwind.config.js             # darkMode: 'class'
├─ postcss.config.js
├─ build/
│  ├─ icon.ico                    # 应用图标（≥256x256，打包用）
│  └─ tray.ico                    # 托盘图标（16/32，建议线条简洁浅色）
├─ resources/
│  └─ sql-wasm.wasm               # 从 node_modules/sql.js/dist 复制，extraResources 打包
│
├─ src/
│  ├─ shared/                     # 主/渲染两端共享（纯类型与常量，无运行时依赖）
│  │  ├─ types.ts                 # VocabEntry、WordStatus、Settings、TranslateResult 等
│  │  └─ ipc.ts                   # IPC 频道名常量 + 各 invoke 的参数/返回值类型签名
│  │
│  ├─ main/
│  │  ├─ index.ts                 # 入口：ready、单实例锁、生命周期、退出前落盘
│  │  ├─ window.ts
│  │  ├─ tray.ts
│  │  ├─ ipc.ts                   # 集中注册全部 ipcMain.handle
│  │  ├─ settings.ts
│  │  ├─ db/
│  │  │  ├─ database.ts           # sql.js 初始化、schema、user_version 迁移
│  │  │  ├─ persist.ts            # 防抖导出 + 原子写 + 崩溃恢复
│  │  │  └─ vocabRepo.ts
│  │  ├─ llm/
│  │  │  ├─ client.ts
│  │  │  ├─ translate.ts
│  │  │  ├─ wordDetail.ts
│  │  │  └─ prompts.ts            # 翻译 prompt / 详情 JSON prompt（中文指令模板）
│  │  └─ services/
│  │     └─ vocabService.ts       # 加入生词 + 详情生成队列编排
│  │
│  ├─ preload/
│  │  └─ index.ts                 # contextBridge.exposeInMainWorld('api', {...})
│  │
│  └─ renderer/
│     ├─ index.html               # 含 CSP meta
│     └─ src/
│        ├─ main.tsx
│        ├─ App.tsx               # 顶栏 + 视图切换（translate/vocab/settings）
│        ├─ env.d.ts              # window.api 类型声明（引用 src/shared）
│        ├─ styles/globals.css    # tailwind 指令 + shadcn CSS 变量（light/dark）
│        ├─ lib/
│        │  ├─ utils.ts           # cn()
│        │  ├─ tokenize.ts        # 句子 → Token[]（word / 标点 / 空白）
│        │  └─ format.ts          # 时间格式化等小工具
│        ├─ stores/
│        │  ├─ uiStore.ts         # 当前视图、主题、置顶状态
│        │  ├─ settingsStore.ts   # 设置读写、测试连接状态
│        │  ├─ translateStore.ts  # 输入、流式结果、选中词集合、翻译状态机
│        │  └─ vocabStore.ts      # 列表、搜索词、排序、展开 id、loading
│        ├─ components/
│        │  ├─ ui/                # shadcn 生成的组件（button/card/dialog/sonner/
│        │  │                     #   switch/slider/select/scroll-area/tooltip/badge/
│        │  │                     #   textarea/input/label/separator/dropdown-menu/skeleton）
│        │  ├─ TitleBar.tsx       # 拖动区 + 置顶图钉 + 主题切换 + 最小化/关闭
│        │  ├─ translate/
│        │  │  ├─ TranslateView.tsx
│        │  │  ├─ WordChips.tsx   # Token 渲染、Chip 多选
│        │  │  └─ AddConfirmDialog.tsx  # 二次确认（列出所选词）
│        │  ├─ vocab/
│        │  │  ├─ VocabView.tsx
│        │  │  ├─ VocabCard.tsx   # 单词/音标/简义/时间 + 展开动画
│        │  │  ├─ VocabDetail.tsx # Markdown 详情 + 备注编辑 + 删除/重试
│        │  │  └─ VocabToolbar.tsx# 搜索框 + 排序下拉
│        │  └─ settings/
│        │     └─ SettingsView.tsx
│        └─ hooks/
│           └─ useIpcEvent.ts     # 订阅主进程 push（vocab:changed / 流式 chunk）
│
└─ 项目要求.md
```

------

## 3. 数据模型设计

### 3.1 sql.js 表结构

数据库文件：`app.getPath('userData')/my-translate.db`（即 `C:\Users\<用户>\AppData\Roaming\<appname>\`）。Schema 版本用 SQLite 内置 `PRAGMA user_version` 管理，从 1 起步。

**vocabulary 表**（在需求字段基础上增加 3 个工程必需字段，均有明确理由）：

| 列               | 类型    | 约束                       | 说明                                                         |
| :--------------- | :------ | :------------------------- | :----------------------------------------------------------- |
| id               | INTEGER | PRIMARY KEY AUTOINCREMENT  |                                                              |
| word             | TEXT    | NOT NULL                   | 原始选中的词形（保留大小写）                                 |
| word_lower       | TEXT    | NOT NULL, **UNIQUE**       | 小写归一，用于去重（防大小写重复入库）                       |
| phonetic         | TEXT    | DEFAULT ''                 | 音标                                                         |
| pos              | TEXT    | DEFAULT ''                 | 词性（列表页可能用到，需求中属"基本信息"）                   |
| brief            | TEXT    | DEFAULT ''                 | 简要释义（卡片显示）                                         |
| detail           | TEXT    | DEFAULT ''                 | 完整 Markdown 详情（主进程按固定模板组装）                   |
| note             | TEXT    | DEFAULT ''                 | 用户备注                                                     |
| status           | TEXT    | NOT NULL DEFAULT 'pending' | `pending` / `ready` / `failed`：详情是异步生成的，必须有状态机 |
| context_sentence | TEXT    | DEFAULT ''                 | 选中该词时的原句（利于记忆回顾，几乎零成本）                 |
| fail_reason      | TEXT    | DEFAULT ''                 | 生成失败原因（UI 提示 + 重试入口）                           |
| created_at       | INTEGER | NOT NULL                   | 毫秒时间戳                                                   |
| updated_at       | INTEGER | NOT NULL                   | 毫秒时间戳                                                   |

**索引**：`word_lower` 已有 UNIQUE 索引；另建 `idx_vocab_created_at(created_at DESC)`。搜索用 `LIKE '%?%'` 覆盖 word / brief / detail / note（生词量级在千级，无需 FTS，保持简单）。

**detail Markdown 固定模板**（由主进程组装，保证格式永远一致）：

```
### 基本信息
- 音标：/…/
- 词性：…
- 中文释义：…

### 详细用法
…

### 例句
1. …（中文）
2. …
3. …

### 近义词 / 反义词
- 近义：…
- 反义：…

### 记忆提示 / 易混淆点
…
```

**LLM 返回的 JSON 契约**（详情生成用）：`{ phonetic, pos, brief, usage, examples: [{en, zh}×3], synonyms: string[], antonyms: string[], memory }`。主进程容错解析 + 校验（缺字段给空值兜底），再套模板。

### 3.2 持久化配置项（electron-store → settings.json）

| 键                   | 默认值                                                   | 说明                                                         |
| :------------------- | :------------------------------------------------------- | :----------------------------------------------------------- |
| `llm.baseURL`        | [`https://api.openai.com/v1`](https://api.openai.com/v1) | OpenAI 兼容端点                                              |
| `llm.apiKey`         | `''`                                                     | 本地明文存储（此类工具惯例；可选增强：Electron `safeStorage` 调 Windows DPAPI 加密，列入 P6 可选任务） |
| `llm.model`          | `gpt-4o-mini`                                            |                                                              |
| `window.alwaysOnTop` | `false`                                                  | 默认置顶                                                     |
| `window.opacity`     | `1.0`                                                    | 0.5–1.0                                                      |
| `window.bounds`      | `null`                                                   | 关闭时记忆的位置尺寸                                         |
| `ui.theme`           | `'system'`                                               | light / dark / system                                        |
| `vocab.sortBy`       | `'time'`                                                 | 生词本默认排序（time / alpha）                               |

设置保存后立即生效：置顶/透明度直调窗口 API；主题广播渲染端；LLM 配置下次调用即生效。

------

## 4. 核心功能实现思路

### 4.1 翻译流程

1. 渲染端提交文本 → 校验非空、长度上限（如 2000 字符）→ 置状态机 `idle → loading`。
2. 主进程读取当前 LLM 配置（未配置 apiKey → 立即返回结构化错误，UI 引导跳设置页）。
3. 构造 prompt（system：专业英译中，只输出译文；user：原文），发起流式请求，SSE 解析，chunk 经 IPC 推送，渲染端追加渲染译文区。
4. 结束推 `done`；异常推 `error`（带规范化文案：Key 无效 / 余额不足 / 网络超时 / 模型不存在）。
5. 渲染端提供"停止"按钮 → IPC 触发 AbortController。
6. **翻译完成后**，用原句（非译文）驱动 Chip 区渲染。

### 4.2 单词拆分与 Chip 交互

- **分词**（纯渲染端，`tokenize.ts`）：正则 `/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g` 匹配单词（覆盖 `don't`、`mother-in-law`、 curly apostrophe），其余片段（空格、标点、数字）作为不可点击文本保留原序渲染。
- **Chip 状态**：`translateStore` 持有 `selectedWords: Set<string>`（存小写归一值保证 `Book`/`book` 不重复）。点击切换选中；选中样式用 shadcn Badge 的 variant 切换 + 明显高亮。
- **已在生词本中的词**：翻译完成后 IPC 批量查重，已存在的 Chip 加弱化标记（如 ✓ 角标/置灰），点击提示"已在生词本"，避免重复添加。
- **加入流程**：选中 ≥1 词 → 浮动出现"加入生词本（n）"按钮 → **二次确认 Dialog**（列出所选词清单，显示将逐词生成详情）→ 确认后 invoke → 清空选择 → toast"已加入，正在生成详情"。
- 多选语义：**每个词独立成为一条生词记录**（不是短语拼接）。

### 4.3 加入生词 + 自动生成详情（完整时序）

```
确认 Dialog
  → vocabService.add(words, contextSentence)
     ├─ 逐词：查重（已存在 → 返回 existed 标记，UI 提示跳过）
     ├─ INSERT status='pending'（phonetic/brief/detail 为空）
     ├─ 触发防抖落盘
     ├─ 广播 vocab:changed（列表立即可见"生成中"卡片）
     └─ 进入串行生成队列：
          for each word:
            llm.wordDetail(word, contextSentence)
              → prompt 要求严格 JSON（附原句帮助消解歧义）
              → 容错解析 → 校验 → 组装 Markdown
            成功: UPDATE ... status='ready', updated_at=now
            失败: UPDATE status='failed', fail_reason=...（卡片显示"重试"按钮）
            每次循环间隔 ~300ms，规避 RPM 限制；429 时指数退避重试 ≤2 次
            每词完成即广播 vocab:changed（不等全部完成）
```

要点：**先入库、后生成**——即使生成时断网/Key 失效，生词本身不丢；状态机让失败可恢复（VocabDetail 里提供"重新生成"）。

### 4.4 生词本检索与展开

- **列表**：卡片网格（窄窗单列）。卡片显示：word、phonetic、brief（超出省略）、相对时间（"3 天前"）、status 徽标（生成中/失败）。
- **搜索**：输入即搜（防抖 300ms），SQL `LIKE` 覆盖 word/brief/detail/note，高亮可选（P6）。
- **排序**：下拉切换"最新优先 / 字母 A–Z"。
- **展开**：点击卡片就地展开（shadcn 动画或简单条件渲染），Detail 区用 react-markdown + remark-gfm 渲染 `detail`，remark 样式走 `@tailwindcss/typography` 的 `prose`（深浅色自适应 `dark:prose-invert`）。
- **备注**：Detail 底部 textarea，失焦/保存按钮写入 `note` 并更新 `updated_at`。
- **删除**：二次确认（小型 destructive Dialog），删除后落盘 + toast + 列表移除。
- **失败重试**：status='failed' 的卡片/详情提供"重新生成详情"按钮，单词重新入队。

### 4.5 设置页与配置持久化

- 分组卡片式表单：**大模型**（baseURL / apiKey 密码框 / model / "测试连接"按钮带 loading 与结果提示）、**窗口**（默认置顶开关、透明度滑块实时预览）、**外观**（浅色/深色/跟随系统）、**数据**（显示数据库文件路径、"打开数据目录"按钮）。
- 保存策略：LLM 配置点"保存"统一提交；窗口/外观类即改即存（开关语义明确无需保存按钮）。
- 测试连接：主进程发一条极短 chat 请求（max_tokens=1），区分成功/认证失败/网络错误。
- 主题：uiStore 根据设置切换 `<html>` 的 `dark` class；`system` 模式订阅主进程 `nativeTheme.updated`。

------

## 5. 分阶段实现计划

> 每阶段结束必须能 `pnpm dev` 跑起来验证；P2 末增加一次"冒烟打包"，把打包风险前置。

### Phase 1 — 工程基座（0.5–1 天）

- **目标**：可运行的 Electron + Vite + React + TS + Tailwind + shadcn 空壳。
- **产出**：electron-vite 三端配置、`.npmrc`(hoisted)、tsconfig 拆分、Tailwind v3 + shadcn 初始化（含 globals.css 双主题变量、sonner）、目录骨架、`pnpm dev` 能开一个显示 "Hello" 的窗口。
- **验收**：`pnpm install` 在 Windows 11 无任何原生编译；`pnpm dev` 窗口 HMR 正常；shadcn Button 渲染正常。

### Phase 2 — 窗口、托盘、设置骨架 + 冒烟打包（1–1.5 天）

- **目标**：悬浮窗全部窗口行为 + 配置持久化 + LLM 客户端（未接 UI）。
- **产出**：无边框窗口（拖动/缩放/最小尺寸/bounds 记忆）、自定义 TitleBar（置顶图钉、最小化、关闭）、关闭→托盘、托盘菜单、单实例锁；settings.ts + 设置页表单（LLM 配置可保存、测试连接可用）；置顶/透明度即时生效；**一次 electron-builder NSIS 冒烟打包**。
- **验收**：关闭窗口进程不退、托盘可唤出可退出；重启应用 bounds/置顶/透明度/LLM 配置全部保留；安装包能装上并启动空白窗口。

### Phase 3 — sql.js 数据层（0.5–1 天）

- **目标**：主进程数据库就绪，持久化可靠。
- **产出**：wasm 资源复制脚本/配置（dev 与打包后路径双适配）、database.ts（建表+迁移）、persist.ts（防抖+原子写+before-quit 落盘+损坏恢复）、vocabRepo.ts、对 vocab 的全套 IPC handler。
- **验收**：通过 IPC 增删查改后**杀进程重启**数据仍在；手动破坏 db 文件能自动备份重建并提示；打包版同样持久化正常（wasm 路径验证）。

### Phase 4 — 翻译 + Chip 交互（1 天）

- **目标**：翻译主流程完整可用。
- **产出**：TranslateView（输入/翻译/停止/清空）、流式渲染、错误文案体系；tokenize + WordChips 多选 + 已收录标记；加入确认 Dialog。
- **验收**：流式打字机效果；断网/错 Key 有明确提示；`don't`、`state-of-the-art` 正确成 Chip；多选、取消、确认交互顺畅。

### Phase 5 — 生词生成管线（1 天）

- **目标**：加入生词 → 自动详情全链路。
- **产出**：prompts.ts（翻译/详情 JSON 双模板）、wordDetail.ts（容错 JSON 解析+模板组装）、vocabService 队列（串行、退避、失败态）、vocab:changed 广播与渲染端订阅。
- **验收**：选 3 词确认后列表立刻出现 3 张"生成中"卡片，逐词变 ready；拔网线后部分失败可重试；detail Markdown 格式与需求模板完全一致。

### Phase 6 — 生词本 UI + 打磨（1–1.5 天）

- **目标**：生词本完整功能 + 深浅色 + 全部 loading/toast/空态。
- **产出**：VocabView（搜索/排序/卡片/展开/备注/删除确认/重试）、Markdown prose 渲染、深浅色切换（含 system 跟随）、所有异步操作的 skeleton/spinner/toast、空列表引导插画文案；可选：safeStorage 加密 apiKey、搜索高亮。
- **验收**：需求文档第 3 节"生词本页面"逐条过；深色模式无样式遗漏；无任何"静默失败"操作。

### Phase 7 — 正式打包与交付（0.5–1 天）

- **目标**：产出可靠 Windows 安装包。
- **产出**：electron-builder.yml 终版（appId、NSIS 配置、icon、asarUnpack/extraResources 含 sql-wasm.wasm、artifactName）、干净环境（无 node_modules 缓存的虚拟机或另一台 Win11 机器）安装验证、README（开发/打包命令）。
- **验收**：安装→启动→翻译→加词→重启→数据在→托盘退出，全流程在干净机器上通过。

总计约 **5–7 个工作日**（不含联调大模型 prompt 调优的弹性时间）。

------

## 6. 潜在风险与 Windows 注意事项

### 6.1 sql.js 持久化（本项目最高危区）

1. **忘记导出 = 丢数据**：sql.js 全内存，必须"每次变更后防抖 export + 退出前强制同步 flush"。`before-quit` 里用同步写（`writeFileSync`），异步可能来不及。
2. **写盘中途崩溃 = 文件损坏**：必须原子写（先写 `.tmp` 再 `renameSync`）；启动加载失败时把坏文件改名 `.corrupt.<时间戳>` 备份后重建空库并 toast 告知。
3. **打包后 wasm 找不到**（dev 正常、安装包白屏/报错）：用 `asarUnpack` 或 `extraResources` 带出 `sql-wasm.wasm`，运行时以 `process.resourcesPath` 拼路径 + `readFileSync` 后以 `wasmBinary` 传入。**Phase 2 的冒烟打包就是为提前引爆此雷。**
4. **数据库膨胀**：detail 为长文本，万级词条 db 约几十 MB，export 全量写盘仍可接受；防抖间隔 ≥500ms 避免高频写。
5. **不要把 db 放安装目录**（Program Files 不可写），必须 `userData`。

### 6.2 窗口置顶与托盘

1. **drag 区域吞噬点击**：标题栏内所有可交互元素必须 `-webkit-app-region: no-drag`，否则按钮"看着能点其实拖动了窗口"。
2. **无边框窗口缩放**：Win11 上 `frame:false + resizable:true` 一般可边缘缩放，但需实测；异常时退回 `titleBarStyle:'hidden' + titleBarOverlay`（还能白捡 Snap Layouts）。
3. **关闭拦截的退出标记**：`isQuitting` 标记必须在托盘"退出"和 `before-quit` 两处都置位，否则用户永远关不掉程序（常见 bug）。
4. **托盘图标路径**：打包后从 `process.resourcesPath` 取；图标建议 `.ico`（PNG 在部分缩放比下模糊）。Tray 变量必须全局持有，防止被 GC（Electron 经典坑：`let tray` 声明在函数内会消失）。
5. **bounds 恢复**：多显示器/拔扩展屏场景，恢复前校验坐标在当前某块屏工作区内。
6. **置顶等级**：普通应用窗口用默认 level 即可；不要随手用 `screen-saver` 级，会盖住某些系统 UI 引来投诉。全屏游戏之上仍可能失效，属 Windows 限制，不必处理。

### 6.3 打包

1. **pnpm 软链 vs electron-builder**：`.npmrc` 写 `node-linker=hoisted`，从第一天就用，别等打包阶段再翻。
2. **国内网络**：Electron 与 electron-builder 二进制下载易失败，准备 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR`（npmmirror）。
3. **未签名安装包**：SmartScreen 蓝色警告属预期，README 注明"更多信息→仍要运行"；签名证书属采购事项，不阻塞开发。
4. **NSIS 配置**：用 assisted（非 oneClick）让用户能选安装路径；`perMachine: false` 免管理员权限；`createDesktopShortcut` 由用户勾选。
5. **中文路径**：项目位于 `D:\项目\...`，现代工具链基本兼容，但若 electron-builder/pnpm 出现匪夷所思的路径报错，第一排查动作就是把项目移到纯 ASCII 路径验证。
6. **dev 与 prod 的 userData 同名冲突**：打包后 app name 与 dev 模式不同（dev 用 "Electron"），如需共享数据，显式 `app.setName()` 统一。

### 6.4 其他易踩坑

1. **渲染进程直连 LLM = CORS 失败**——一切外部 HTTP 走主进程，这条写进给实现模型的硬约束。
2. **OpenAI 兼容 API 的 baseURL 差异**：用户可能填 [`https://xxx.com/v1`](https://xxx.com/v1) 或带尾斜杠或缺 `/v1`——拼接端点时规范化（去尾斜杠，是否自动补 `/v1` 在设置页用占位提示说明，不做隐式魔法，避免国产网关路径各异时出错）。
3. **详情 JSON 解析失败**：模型可能输出 ```json 代码块或前后解释性文字——提取首个 `{` 至末个 `}` 再 parse；仍失败则该词置 failed 可重试，绝不让异常打断队列。
4. **并发打爆 RPM**：详情生成必须串行队列 + 间隔 + 429 退避，不要 Promise.all。
5. **CSP 误伤**：renderer 的 CSP 若漏 `img-src data:` 或 style inline，shadcn 某些场景会静默破样式；P1 就配好。
6. **防抖落盘与退出竞态**：退出时先 cancel 防抖计时器再同步 flush，否则可能 flush 后防抖又触发一次半状态写入。

------

## 7. 给后续实现模型的执行建议

### 7.1 规划 → 任务清单的转换方式

1. **以 Phase 为里程碑建 todo**，每个 Phase 拆成 ≤10 个可独立验证的任务（示例粒度：「P3-2 persist.ts：防抖导出 + 原子写 + quit flush」「P4-1 tokenize.ts + 单测样例词表」）。
2. **每个任务带验收命令**：`pnpm dev` 目视验证 / `pnpm build && pnpm start` 打包验证 / 特定手测步骤（杀进程验证持久化）。
3. **严格按 Phase 顺序**，禁止跨阶段提前实现（尤其禁止在 P3 数据层就绪前写翻译 UI 的假数据逻辑，返工成本高）。
4. **每 Phase 结束跑一遍该阶段验收清单**，全部通过才进入下一阶段；P2 的冒烟打包绝不允许跳过。
5. **先把 src/shared/types.ts 与 ipc.ts 写完整**（类型契约先行），主/渲染两端并行开发时以契约为准，可显著减少返工。

### 7.2 实现时必须严格遵守的约束清单（可直接作为系统提示词）

- ❌ 禁止 `better-sqlite3` 及任何含原生编译的依赖；安装任何新依赖前检查其是否带 `node-gyp`/`prebuild`。
- ❌ 禁止渲染进程直接 `fetch` 外部 API；一切 LLM 流量走主进程 IPC。
- ❌ 禁止关闭 `contextIsolation` / 开启 `nodeIntegration` / 关闭 `sandbox`。
- ❌ 禁止跳过二次确认直接写入生词；禁止并发调用详情生成。
- ✅ 主进程 ESM、preload CJS；pnpm 配 `node-linker=hoisted`；React 18.3 + Tailwind v3.4。
- ✅ 所有 DB 变更走"变更 → 置脏 → 防抖落盘"唯一通道；退出前同步 flush。
- ✅ 所有 IPC 频道名与 DTO 只能从 `src/shared` 引用，禁止字符串硬编码散落各处。
- ✅ 所有异步操作必须有 loading + 成功/失败 toast；所有 LLM 错误映射为用户可读中文文案。
- ✅ UI 组件一律 shadcn/ui + Tailwind，禁止引入其他组件库；图标一律 lucide-react。
- ✅ 每完成一个功能，深浅色两种主题各看一遍。
- ✅ 遵循现有目录与命名，不做需求范围外的"顺手重构"；最小改动原则。

### 7.3 交付命令（实现完成后写进 README）

- 开发：`pnpm install` → `pnpm dev`
- 类型检查：`pnpm typecheck`
- 打包：`pnpm build`（产出 `release/` 下 NSIS 安装包）

------

规划完毕。如确认无误，下一步可以从 **Phase 1 工程基座** 开始实现；若对关键决策（无边框 vs titleBarOverlay、electron-vite 选型、详情 JSON 契约等）有不同意见，现在调整成本最低。