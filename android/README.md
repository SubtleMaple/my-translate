# Android 手机版

与 Windows 版共用 React、业务服务、提示词、sql.js v5 数据库结构和 FSRS 算法。普通手机 App，包名 `com.mytranslate.mobile`，当前版本沿用 `0.3.0`。不要求 Google Play 服务。

## 安装与使用

1. 把 `release/android/My-Translate-0.3.0.apk` 传到手机，用文件管理器打开安装。系统询问时允许该文件管理器安装此 APK。
2. 打开「译 · My Translate」→「设置」，填写自己的 API 类型、HTTPS Base URL、API Key 和模型，点「测试连接」。这些配置需要在手机上重新填写。
3. 在翻译页粘贴英文；点词可收藏。「选短语」模式下依次点首词和尾词。
4. 查词、生词本、词云/分组、复习和 JSON/CSV 导出沿用桌面功能。导出时由系统询问保存位置。

最低 Android 8（API 26），需要 Chromium 80 或更新版本的系统 WebView。实际自动化覆盖 Android 11 / WebView 83、Android 15 / WebView 124。HarmonyOS 4.2 设备的安装、输入法、字体、后台行为仍需真机验收。请勿把本包当作 HarmonyOS NEXT 原生应用。

手机独立保存数据，与 Windows 词库**不自动同步**，当前没有词库导入功能。模型请求需要手机能访问服务商；电脑的代理不会自动变成手机代理。本版本只接受 HTTPS 地址，重定向会提示改用最终地址。跨 App 悬浮窗、托盘、窗口透明度未包含在手机版范围内。

设置和词库保存在应用私有目录，并使用 Android Keystore 的 AES-GCM 密钥加密。卸载/清除应用数据会移除词库和密钥；请定期导出。JSON/CSV 导出只含词条，沿用 Windows 格式，**不含 API Key 或完整复习会话备份**。

## 构建

Windows 上安装 Node、pnpm 9、JDK 17+、PowerShell 7，然后在仓库根目录运行：

```powershell
pnpm install
pwsh -NoProfile -File scripts/setup-android.ps1
pnpm typecheck
pnpm typecheck:android
pnpm test
pnpm android:apk
```

SDK 默认安装到 `%LOCALAPPDATA%\MyTranslateAndroid\tools`。可对 setup/build 脚本传 `-ToolsRoot`。构建用官方 aapt2、javac、D8、zipalign、apksigner，不需要 Android Studio、Gradle 或 node-gyp。产物与 SHA256 位于 `release/android/`；APK 同时支持 ARM/ARM64/x86/x64，因为没有打包架构专属原生库。

脚本首次生成独立 RSA 签名密钥，后续构建复用。密钥位于 `%LOCALAPPDATA%\MyTranslateAndroid\signing\release.jks`，密码经当前 Windows 用户 DPAPI 保护，均不入仓库。应妥善备份签名材料；丢失签名将无法覆盖更新已安装版本。迁移构建机器时，需在原 Windows 用户环境下另行安全导出签名材料。

版本号读取根目录 `package.json`，调整前仍需用户确认。Android 的 `versionCode` 在 Manifest，当前为 300，发布新版时同步递增。测试 APK、测试证书、测试模型不打入交付 APK；交付包不启用 WebView 远程调试，也不声明 debuggable。

## 结构与安全边界

- `app/src/main/java/.../MainActivity.java`：原生宿主、HTTPS 流、Keystore/AtomicFile、剪贴板和系统文档选择器。
- `src/android/ui.ts`：复用桌面 preload 白名单和 React UI。UI WebView 只有 RPC/剪贴板桥；CSP 禁止联网、框架和对象加载。
- `src/android/service.ts`：独立不可见 WebView 中复用原主进程服务；构建时替换 Electron、文件系统、随机数等平台依赖。LLM 的 HTTP 由 Java 执行，保留请求取消和逐块流式解析。
- 两个 WebView 均只加载 APK 内指定路径的 HTTPS 虚拟源；关闭 file/content 访问、混合内容和页面跳转。网页不能导航到第三方页面来获取原生桥。
- 现代 WebView 使用 sql.js WASM；WebView 100 以下使用同版本 sql.js 的纯 JS 构建，以保留严格 CSP。迁移定义只在 `src/shared/databaseSchema.ts`，Windows 持久化实现保持原有方式。
- 数据变更通过 `markDirty` 标记；请求返回和变更通知前同步加密原子保存。读取损坏文件时显示错误并保留原文件，不静默清空。
- JSON RPC 显式保留省略参数，避免 `undefined` 变 `null` 后破坏默认查询。

## 模拟器验证

只对可丢弃的 emulator 设备运行，会写入合成测试词库/设置：

```powershell
pwsh -NoProfile -File scripts/test-android.ps1 -Device emulator-5558
pwsh -NoProfile -File scripts/test-android.ps1 -Device emulator-5558 -Phase reload
```

测试单独编译 instrumentation APK，使用同一签名；在设备内启动测试专用 HTTPS 服务验证 OpenAI/Anthropic、真实 SSE、归一/收藏、复习/撤销、剪贴板、短语、系统导出取消/保存读回和私有文件加密。`reload` 在新进程检查持久化。截图和报告留在本地 `docs/qa-android/`。测试证书仅存在临时测试包且只在测试进程中受信任。
