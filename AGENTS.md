# AGENTS.md — AI 开发入口与约定

## 开始前的阅读顺序

1. 读 [handbook/README.md](handbook/README.md)：全局地图与接手步骤。
2. 读 [handbook/CURRENT_STATE.md](handbook/CURRENT_STATE.md)：代码基线、已发布/已合并/待验收的区别。
3. 用 `git status --short --branch`、`git branch -vv`、`git log --oneline -8` 核对真实工作区，不能把文档快照当作实时 Git 状态。
4. 按任务读 [架构](handbook/ARCHITECTURE.md)、[现行业务规则](handbook/BUSINESS_RULES.md)、[数据模型](handbook/DATA_MODEL.md)，再用 [开发定位表](handbook/DEVELOPMENT.md) 找代码与测试。
5. 验证/构建/发布看 [TESTING_RELEASE.md](handbook/TESTING_RELEASE.md)；手机安装与工具说明补充见 [android/README.md](android/README.md)。

`handbook/` 是应随源码提交的开发手册，不依赖历史聊天、本机日志或临时测试报告。本地 `docs/` 已被 Git 忽略，可辅助追溯，但缺少它不应阻塞新克隆接手；其中旧计划不是当前功能规范。

## 项目与边界

「英汉翻译 + 生词本」包含 Windows 11 Electron 悬浮窗和独立 Android 普通手机 App。两端复用 React UI、契约、业务服务、sql.js schema、提示词与 FSRS；网络、文件、剪贴板、窗口、导出由平台适配。当前能力包括翻译、逐位置摘词/词形归一、查词、推荐、自测、熟悉度排序、词云/分组和导出。

- 技术栈：Electron 33 / electron-vite 2 / React 18.3 / TypeScript 5.6 / Tailwind 3.4 / shadcn/ui / Zustand 5 / sql.js 1.12 / ts-fsrs 5.4.2 / electron-builder 25。准确依赖以 [package.json](package.json) 和 [锁文件](pnpm-lock.yaml) 为准，禁止随意升级大版本。
- 开发 Node ≥20、pnpm 9；Android 另需 JDK 17+、PowerShell 7、SDK 工具，使用仓库脚本构建，不假设存在 Gradle/Android Studio 工程。
- Windows、Android 的本地数据独立，不自动同步；Android 首版不含跨应用悬浮窗。

## 技术红线

- 禁止引入需要 node-gyp/prebuild 的 Node 依赖。数据库使用 sql.js；Android Java 宿主使用现有 SDK 工具链。
- UI 不直接访问模型 API：Windows 经 preload/IPC → 主进程 `net.fetch`；Android 经 RPC → 服务 WebView → Java HTTPS。
- Electron 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Android 保持 UI/服务 WebView 能力隔离、本地资源白名单、CSP 与 HTTPS 限制；交付 APK 不带测试证书/测试模型/调试桥。
- 真实 API Key、用户词库、签名私钥、密码及本机配置不入仓库。Windows 配置位于 userData；Android 私有数据由 Keystore 加密保存。
- 新 UI 使用现有 shadcn/ui、Tailwind、lucide-react 和语义 CSS 变量，覆盖深浅色、窄窗/手机触屏。

## 修改规则

- **契约先行**：先修改 [types.ts](src/shared/types.ts) / [ipc.ts](src/shared/ipc.ts)，再同步 [preload](src/preload/index.ts)、[handler](src/main/ipc.ts) 及 Android 传输/适配；UI 只使用 `window.api`。
- **schema 唯一来源**：[databaseSchema.ts](src/shared/databaseSchema.ts)。迁移追加新版本；检查 Android 的较新版本拒绝条件，不在 Windows/Android 各维护一份 DDL。
- **平台依赖显式适配**：`src/main/services` 也被 Android 复用。添加 Node/Electron 依赖前核对 [Android 构建别名](scripts/build-android-web.cjs)，不能认为“放 main 就只在 Windows 跑”。
- **落盘**：sql.js 为内存库，变更必须 `markDirty`。Windows 防抖保存并在正常退出 flush；Android 在响应/变更通知前同步保存。数据库事务与平台持久化失败的区别见数据手册。
- **保持领域语义**：摘录次数≠自测次数≠推荐消费次数；单词位置≠词头去重键；长期熟悉度≠即时回忆率。最新推荐队列规则必须按业务手册检查。
- **LLM 防御**：保留 L1 输入检测、L2 提示词边界、L3 输出检查；改链路须回归 [dictionary.test.ts](tests/dictionary.test.ts)、[translateStore.test.ts](tests/translateStore.test.ts) 及对应业务测试。已提交测试是可复现入口，本地旧红队报告不是必备附件。

## 验证与发布

- 功能改动至少 `pnpm test`、`pnpm typecheck`、`pnpm build`；涉及共享服务/UI/契约时增加 `pnpm typecheck:android`、`pnpm android:web` 和对应平台集成验证。
- 按 [验证矩阵](handbook/TESTING_RELEASE.md#验证矩阵) 选择专项。数据/算法测试使用合成数据、可注入时钟与真实 sql.js；网络默认 mock。
- Electron 冒烟用隔离 `MY_TRANSLATE_USER_DATA`。通过 `Get-CimInstance Win32_Process` 核对本次进程，再按 PID 清理；不要按进程名杀掉用户正在运行的应用。
- Android instrumentation 只运行在可丢弃模拟器，先安装当前 APK；模拟器通过不等于 HarmonyOS 真机通过。
- 纯文档改动执行 `pnpm docs:check` 和 `git diff --check` 即可，不为文档修改重建安装包或调用真实模型。
- 功能批次完成或用户要求时构建交付物；改版本号需用户确认。Android 同时考虑 Manifest 的 versionCode 与签名连续性。
- 使用正式发布前的构建校验；输出目录被运行程序占用时使用独立目录，具体命令见发布手册。

## Git 与交接纪律

- `main` 为可交付基线，每个功能/修复/文档整理使用独立分支。当前分支有尚未合并的前置工作时，明确基于哪个提交继续，保留既有修改。
- 提交、合并、推送和创建 Release 按本次用户授权执行，不把以前一次发布授权延续到新任务。
- 提交风格：`feat:` / `fix:` / `chore:` / `docs:` + 中文简述。提交前检查 status、diff、最近日志，只纳入预期文件。
- UI 改动经用户确认后才合并；合并使用 `--no-ff`，成功后安全删除已合并分支；推送需明确授权。
- 每完成需求，更新 **CURRENT_STATE** 与受影响的主题手册。发布才更新公开 CHANGELOG，不把开发中行为写成已发布事实。
- 本地 `docs/进度.md` 若存在，追加现象/根因/内容/实际验证/待验收并同步顶部和阶段表；若不存在，使用手册状态页交接即可。历史资料保留历史日期和适用范围。
- 手册不依赖用户名、绝对工作路径、临时报告和本地密钥。每次交接先更新现行规则，再追加历史，避免仅在长日志底部修正行为。

## 常见陷阱

- 同一 `0.3.0` 版本号可对应发布标签、后续本地主线和待合并修复；必须核对提交与工作区。
- 新增候选补位不能触发自动付费生成；耗尽的空队列与从未初始化的 `null` 不是一回事。
- Android JSON 数组会把 `undefined` 变 `null`，必须使用现有 RPC 编解码。
- Windows 关窗是隐藏托盘；强杀不执行 before-quit flush。测试恢复必须实际验证文件与正常退出路径。
- Electron 跟随系统代理；独立 Node 网络测试和手机网络要分别配置，不能照抄另一台机器的代理端口。
