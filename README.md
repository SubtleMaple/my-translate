# My Translate — 英汉翻译 + 生词本

Windows 11 本地悬浮窗翻译工具：一边看英文原文，一边翻译、收集生词，词条自动生成音标/释义/例句/近反义词等学习详情。

## 功能

- **悬浮翻译窗**：自由拖动 / 缩放 / 始终置顶 / 窗口透明度 / 关闭最小化到系统托盘
- **流式翻译**：调用任意 OpenAI 兼容 API（自配 Base URL / API Key / Model）
- **原文单词 Chip**：译文生成后，原文每个单词可点击多选，一键加入生词本（二次确认）
- **生词本**：搜索（单词/释义/例句）、时间或字母排序、卡片展开、Markdown 学习详情、个人备注、失败重试
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

- 翻译：输入英文 → Ctrl+Enter 或点击「翻译」；翻译中可「停止」
- 加词：译文下方原文 Chip 点击选中（可多选）→「加入生词本」→ 确认
- Base URL 需要带 `/v1`（如 `https://api.openai.com/v1`），无需以斜杠结尾
- 生词详情生成采用串行队列（每词间隔 300ms），大量加词时请耐心等待
