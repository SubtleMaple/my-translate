# AGENTS.md — 项目开发约定（AI 助手必读）

> 本文件是 AI 编码助手在本仓库工作时的行为规范。所有改动必须遵守本文件与 `docs/进度.md` 的交接记录。
> 需求见 `docs/项目要求.md` / `docs/更新需求.md`，规划见 `docs/plan.md`（历史规划 `docs/history/plan-v1.md`）。

## 项目概览

「英汉翻译 + 生词本」Windows 11 悬浮窗桌面应用（Electron）。核心：流式翻译、原文单词/短语选择入生词本、LLM 自动生成词条详情、生词本检索与管理、极简模式。

**技术栈（版本已锁定，禁止随意升级大版本）**：Electron 33 / electron-vite 2 / React 18.3 / TypeScript 5.6 / Tailwind CSS v3.4 / shadcn-ui / Zustand 5 / sql.js 1.12（纯 WASM SQLite）/ electron-builder 25（NSIS）。

**红线**：
- ❌ 禁止引入任何含原生编译（node-gyp/prebuild）的依赖——sql.js 是唯一数据库方案
- ❌ 禁止渲染进程直接 fetch 外部 API（一切 LLM 流量走主进程 IPC）
- ❌ 禁止关闭 contextIsolation / 开启 nodeIntegration / 关闭 sandbox
- ❌ 禁止在仓库提交真实 API Key（Key 只存在于 `%APPDATA%` 用户配置）

## 常用命令

```bash
pnpm install       # 依赖安装（pnpm 9，electron/esbuild 已在 onlyBuiltDependencies 白名单）
pnpm dev           # 开发模式（HMR + Electron）
pnpm typecheck     # 类型检查（node + web 双配置）
pnpm build         # 构建三端产物（out/）
pnpm dist          # 构建 + NSIS 安装包（release/My Translate-Setup-<version>.exe）
pnpm dist:dir      # 构建 + 免安装目录（release/win-unpacked/My Translate.exe）
```

## 目录结构

- `src/main/`：窗口（window.ts）、托盘（tray.ts）、IPC（ipc.ts）、设置存储（settings.ts）、LLM 客户端（llm/）、sql.js 数据层（db/）、详情生成队列（services/vocabService.ts）
- `src/preload/`：contextBridge 白名单 API（严格对应 `src/shared/types.ts` 的 RendererApi）
- `src/shared/`：**两端共享的类型与纯函数**——types.ts（契约）、ipc.ts（频道常量）、llm.ts（provider 解析）、injection.ts（注入检测 L1）、outputCheck.ts（输出校验 L3）
- `src/renderer/`：React UI，组件一律 shadcn/ui + Tailwind，图标 lucide-react

**契约先行**：改 IPC 必须先改 `src/shared/types.ts` + `src/shared/ipc.ts`，再同步 preload 与主进程。

## Git 工作流

- `main` = 稳定基线，永远可运行、可交付
- 每个功能/修复开独立分支：`git checkout -b feature/简述` 或 `fix/简述`
- 开发 + 验证全部在分支完成，随后 `git checkout main && git merge --no-ff <分支>`（保留分组历史），合并后删除分支
- 提交信息：`feat:` / `fix:` / `chore:` / `docs:` + 中文简述
- **推送 GitHub 需用户显式要求，不得自动 push**
- 涉及 UI 交互的改动，用户手动验证通过后才合并（用户会说「合并」）

## 文档纪律（每次改动必须）

1. 每完成一个功能/修复，**必须**在 `docs/进度.md` 追加完成记录：现象/根因/修复内容/验收结果/待人工验收清单
2. 同步更新 `docs/进度.md` 顶部「当前状态」与阶段总览表
3. 分支/提交历史在「Git 工作流约定」节登记

## 验证清单（合并前必须全部通过）

1. `pnpm typecheck` + `pnpm build`
2. dev 冒烟：`Start-Process pnpm.cmd dev` 后确认 4 个 electron 进程存活、无 stderr；结束用 `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` 逐个 `Stop-Process -Force`（**勿用 Get-Process 按名杀**，会漏）
3. 纯逻辑改动（LLM 协议/注入检测/迁移 SQL 等）按既有模式写独立单测：esbuild bundle 项目源码到 `%TEMP%\opencode\<case>\` 下用 node 跑（mock fetch / 真实 sql.js）
4. 真实 LLM 测试必须先在 shell 设代理：`$env:HTTPS_PROXY='http://127.0.0.1:7897'`（本机系统代理；**Node 直连不跟随系统代理**，Electron 应用内走 net.fetch 不受影响）
5. 深浅色两种主题各目视一遍（新增组件一律用 shadcn CSS 变量，禁硬编码色）

## 发布流程

- 功能批次完成或用户要求时执行 `pnpm dist` 重建安装包
- 版本号升级需用户确认（`package.json` version，安装包文件名随版本）
- `release/` 在 .gitignore 内，构建产物不入库
- 未签名安装包 SmartScreen 提示属预期（README 已说明）

## 环境与陷阱备忘

- **userData 分离**：dev=`%APPDATA%\my-translate\`，打包版=`%APPDATA%\My Translate\`，数据互不共享（属预期）
- **单实例锁**：残留进程会占锁导致新实例静默退出（表现为无报错无 db 文件）；排查用 `Get-CimInstance Win32_Process` 按 CommandLine/Name 过滤
- **强杀进程不触发 before-quit flush**：settings/db 落盘靠正常退出；验证迁移逻辑用真实文件 + 纯函数复算
- **sql.js 全内存**：所有 DB 变更必须走 `markDirty` → 防抖落盘；退出前 `flushDatabase(true)`
- **代理**：主进程 LLM 走 `net.fetch`（跟随系统代理）；node 独立测试需手动设环境变量代理
- **思考型模型**：Anthropic 协议 max_tokens 预算需留 thinking 余量（详情 2000 / 流式 4096）；`thinking:{type:"disabled"}` 可关思考（设置页）

## 安全防御（改动 LLM 链路时必须回归）

- 三层注入防御：L1 `shared/injection.ts`（中文指令输入侧拒绝）、L2 `llm/prompts.ts`（指令层级 + 分隔符包裹）、L3 `shared/outputCheck.ts`（中文主输入非回显 → 警告条）
- 修改这些文件必须重跑红队样本（`docs/注入攻击测试报告.md` 记录的攻击样本与测试脚本模式）
- 生词详情链路：contextSentence 命中 L1 则省略原句
