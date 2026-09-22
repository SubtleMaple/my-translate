# My Translate — 英汉翻译 + 生词本

Windows 11 本地悬浮窗翻译工具：一边看英文原文，一边翻译、收集生词，词条自动生成音标/释义/例句/近反义词等学习详情。

## 功能

- **悬浮翻译窗**：自由拖动 / 缩放 / 始终置顶 / 窗口透明度 / 关闭最小化到系统托盘
- **流式翻译**：支持 OpenAI 兼容 / Anthropic API；粘贴并翻译、复制译文，修改原文自动清除旧译文，停止结果明确标为未完成
- **生词摘录**：点击多选单词、拖选连续短语，预览去重后直接加入；已收录状态跟随词库，重复加入仅使出现次数 +1
- **生词本**：搜索（单词/释义/例句/备注）、时间/字母/出现次数排序、Markdown 学习详情、个人备注、失败重试；「自测」隐藏释义，点击揭晓
- **极简模式**：支持 260×140 小窗，原文/译文切换、粘贴翻译与复制，退出恢复完整窗口
- **详情自动生成**：加入生词后自动调用大模型生成 音标 / 词性 / 中文释义 / 详细用法 / 3 条例句 / 近反义词 / 记忆提示
- **深浅色主题**：浅色 / 深色 / 跟随系统（标题栏一键切换）

## 技术栈

Electron 33 + electron-vite + React 18 + TypeScript + Tailwind CSS v3 + shadcn/ui + Zustand + sql.js（纯 WASM SQLite，无任何原生编译模块）+ electron-builder（NSIS）

## 本地开发

要求：Windows 11、Node.js ≥ 18、pnpm（corepack 已启用则无需手动安装）

```bash
pnpm install     # 首次安装依赖（国内网络已配置 npmmirror 镜像）
pnpm dev         # 启动开发模式（HMR + Electron 自动拉起）
pnpm typecheck   # 类型检查（main + renderer 双配置）
pnpm test        # esbuild + node:test，隔离测试翻译/入库/搜索竞态
pnpm test:electron # Windows真实Electron集成测试，本地mock接口+临时profile，截图输出docs/qa-reading-flow
```

## 打包

```bash
pnpm build       # 仅构建三端产物（out/）
pnpm dist        # 构建 + 产出 NSIS 安装包（release/My Translate-Setup-<版本>.exe）
pnpm dist:dir    # 构建 + 免安装目录（release/win-unpacked/My Translate.exe）
```

安装包为**未签名**：首次运行时 Windows SmartScreen 会提示蓝色警告，点击「更多信息 → 仍要运行」即可，属正常现象。

## 数据与配置位置

- 开发模式：`%APPDATA%\my-translate\`（`settings.json` + `my-translate.db`）
- 安装版：`%APPDATA%\My Translate\`（两套数据互不共享，属预期）

数据库为 sql.js 文件，全量内容在内存中操作并防抖落盘；生成详情期间若直接杀进程，重启后未完成词条会自动继续生成。

## 使用提示

- 快速翻译：复制英文 →「粘贴并翻译」（Ctrl+Shift+V）；该操作替换整段原文
- 翻译：输入英文 → Ctrl+Enter 或点击「翻译」；翻译中可停止、修改原文或清空
- 右键粘贴：原文中替换选区或插入光标处；极简译文侧粘贴会换成新原文
- 加词：摘录区点词/拖选短语 → 检查待加入条目 → 直接加入；待加入标签可单独取消
- 复习：生词本 → 开始自测 → 回想词义 → 点击揭晓，退出自测恢复正常列表
- Base URL 需要带 `/v1`（如 `https://api.openai.com/v1`），无需以斜杠结尾
- 生词详情生成采用串行队列（每词间隔 300ms），大量加词时请耐心等待

开发验证可在 PowerShell 中设置 `$env:MY_TRANSLATE_USER_DATA="$env:TEMP\my-translate-test"` 后运行 `pnpm dev`，使用独立数据目录；安装版忽略该变量。清除变量后恢复普通开发目录。不要把真实 API Key 或用户数据放进仓库。
