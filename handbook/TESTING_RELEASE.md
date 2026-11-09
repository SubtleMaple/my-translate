# 验证、构建与发布

先确认 [当前状态](CURRENT_STATE.md)。脚本定义以 [package.json](../package.json) 为准，开发环境Node≥20、pnpm 9；Android补充见 [安装/构建说明](../android/README.md)。

## 验证矩阵

| 改动范围 | 至少执行 | 专项/人工补充 |
|---|---|---|
| 仅文档/入口/文档检查器 | `pnpm docs:check`、`git diff --check` | 对照源码检查语义；不重建应用安装包 |
| 纯逻辑、仓储、服务 | `pnpm test`、`pnpm typecheck`、`pnpm build` | 真实sql.js/可注入时钟；共享代码还需Android类型与Web构建 |
| 共享UI/契约/提示词/服务 | 上述 + `pnpm typecheck:android`、`pnpm android:web` | 对应Electron专项；相关Android原生能力测试与手机布局 |
| 翻译/选词/LLM协议 | `pnpm test:electron`、`pnpm test:selection`、`pnpm test:dictionary`中受影响项 | 注入/取消/流式/重复位置；手机触屏与HTTPS桥 |
| 推荐队列/反馈 | `pnpm test:recommendations` | 十词逐项消费至0、回退失败、两端重启；禁止额外推荐请求 |
| 自测/FSRS | `pnpm test:review` | 评分幂等、撤销、跨天/短期加练、前面不泄露答案 |
| 熟悉度/词云/排序 | `pnpm test:vocab-visuals` | 未测/时钟回拨、同日多次评分、字体碰撞、窄宽深浅 |
| 导出/文件能力 | `pnpm test:export` | 系统保存窗口、取消、覆盖、URI/真实读回；确认数据未改 |
| Android Java/网络/存储/构建 | `pnpm typecheck:android`、`pnpm android:apk`及受影响测试 | 当前APK实装、instrumentation full/reload、真机验收 |

专项命令通常会先执行一次Windows build；连续运行多个已构建专项可用 `pnpm exec electron tests/对应脚本.cjs` 避免重复构建。必须先确保out确实来自当前代码。

## 可复现测试入口

- 文档校验 [check-docs.cjs](../scripts/check-docs.cjs) 仅使用Node内置模块；尚未安装依赖时也可直接执行 `node scripts/check-docs.cjs`。它检查当前手册使用的行内相对链接与ATX标题锚点、pnpm命令、基础版本字段和本机资料依赖，不代替业务语义审查或远端链接可用性检查。
- [tests/run.cjs](../tests/run.cjs) 用esbuild把实际源码和 `*.test.ts` 打包到临时目录后运行Node test，无额外测试框架；Electron对象仅在逻辑测试中适配，SQL用真实sql.js。
- 推荐/复习/词库/导出/前端竞态测试按 [定位表](DEVELOPMENT.md#需求定位) 选择；测试数量随新增用例变化，不以旧日志中的数量当通过标准。
- 注入回归入口是 [dictionary.test.ts](../tests/dictionary.test.ts)、[translateStore.test.ts](../tests/translateStore.test.ts) 及对应模型服务测试；保留L1省略恶意上下文、L2边界、L3输出检查。修改防御文件时核对专项红队样本；本地报告缺失不阻止先运行仓库测试，但未覆盖项须明确列出并获取可共享样本或由维护者补跑，不能把缺失资料当成安全回归全部通过。
- Electron集成使用独立profile和本地mock模型；导出专项只替换保存选择器返回值，实际IPC/SQL/文件写入仍执行。保存窗口本身、真实服务商语义和厂商手机行为仍需相应人工验证。
- 所有测试数据应为合成数据，不能读取真实Key或用户词库来方便造场景。

## Windows冒烟与进程清理

先在一个终端设置独立profile后启动：

```powershell
$env:MY_TRANSLATE_USER_DATA = Join-Path $env:TEMP ('opencode\my-translate-smoke-' + [Guid]::NewGuid().ToString('N'))
pnpm dev
```

记录此次启动的父PID及工作目录，通过 `Get-CimInstance Win32_Process` 核对本项目、本轮进程树与命令行。当前Electron构建通常有4个进程；还要确认窗口已加载、无异常stderr，进程数不能替代交互检查。

- 首选托盘「退出」验证正常flush；Windows关窗只是隐藏到托盘。
- 清理测试实例时仅按已核对的PID操作，不按 `electron.exe` / `My Translate.exe` 名称批量强杀。
- 测持久化需实际复读文件/重启，不能仅检查内存返回值；强杀不执行before-quit。
- 清除当前终端的 `MY_TRANSLATE_USER_DATA` 后才使用正常开发profile。安装版忽略此变量，不拿安装版测试真实用户数据。

## Android设备验证

构建顺序：

```powershell
pnpm install
pwsh -NoProfile -File scripts/setup-android.ps1
pnpm typecheck:android
pnpm android:web
pnpm android:apk
```

真实脚本：[setup](../scripts/setup-android.ps1)、[web构建](../scripts/build-android-web.cjs)、[APK构建](../scripts/build-android.ps1)、[instrumentation](../scripts/test-android.ps1)。setup/build支持ToolsRoot；test脚本目前使用默认工具根路径，换位置时需核对脚本，不能假定四个脚本都有相同参数。

instrumentation仅在**可丢弃模拟器**运行，会改写合成词库与设置。先安装刚构建的产品APK，再运行测试脚本（脚本只自动安装测试APK）：

```powershell
$adb = Join-Path $env:LOCALAPPDATA 'MyTranslateAndroid\tools\platform-tools\platform-tools\adb.exe'
$version = node -p "require('./package.json').version"
& $adb devices
& $adb -s emulator-5558 install --no-incremental -r "release/android/My-Translate-$version.apk"
pwsh -NoProfile -File scripts/test-android.ps1 -Device emulator-5558 -Phase full
pwsh -NoProfile -File scripts/test-android.ps1 -Device emulator-5558 -Phase reload
```

设备ID是示例，使用实际列出的可丢弃emulator。测试报告与拉取文件落本地 `docs/qa-android/`。成功标志为 `ANDROID_CHECKS_PASSED`；full和独立进程reload都要核对，失败不能只看脚本最后有没有退出。

- 测试源码：[SmokeTest.java](../android/tests/SmokeTest.java)、[MockModel.java](../android/tests/MockModel.java)，单独instrumentation包，测试TLS证书仅在测试进程信任。
- 需覆盖Java HTTPS两协议/SSE逐块UTF-8、取消/错误、SQLite与加密文件、剪贴板、触屏短语、系统导出与重启恢复。
- 交付APK不应包含测试模型、测试证书或调试桥；Android 11/WebView83、Android 15/WebView124通过仅说明对应环境，不替代HarmonyOS4.2真机。

## 代理与真实模型

默认测试mock，不产生真实模型费用。真实服务商验证按本次任务需要执行，并说明调用范围。

- Electron `net.fetch` 使用系统网络/代理。
- 独立Node客户端不会自动继承Electron设置；环境代理变量是否生效取决于Node版本与HTTP实现，须用实际小请求确认，不能把设置HTTPS_PROXY等同于网络已验证。
- 手机使用自己的网络；电脑代理不会自动共享给手机。Android只接受HTTPS且不跟随重定向，应填写服务商最终地址。
- 不把某台机器的固定代理端口、Key或测试账户写入手册/测试源码。

## Windows构建与校验

```powershell
pnpm dist
node scripts/verify-package.cjs
```

默认目录为release，NSIS文件名随根版本变化；[verify-package.cjs](../scripts/verify-package.cjs) 核对asar内应用版本、out运行文件、图标/WASM及FSRS包一致性，并输出安装包SHA256。

旧免安装版占用目录时，保留正在运行的用户应用，选择**新的独立输出目录**。以下 `release/verification-build` 是示例，实际使用前确认没有同名运行实例或需要保留的产物：

```powershell
pnpm build
pnpm exec electron-builder --config.directories.output=release/verification-build
node scripts/verify-package.cjs release/verification-build
```

构建本身成功不等于测试已完成；验证完的out与发布包必须一致。不要在持续运行的dev/HMR任务同时写out时打包。

## Android版本与签名

- 根版本来自package.json；Manifest的versionCode独立递增，变更前用户确认。
- APK构建脚本使用aapt2/javac/D8/zipalign/apksigner，保留签名连续性；签名材料由本机安全管理，不进入Git，迁机按Android README操作。
- APK和SHA256输出到release/android；构建会校验v2/v3签名，记录实际版本、源码提交、签名证书指纹和文件hash，不能仅凭相同文件名认定是同一个包。
- 本项目尚无自动数据同步或完整备份导入；安装测试与清理设备必须区分测试profile和用户设备。

## Git与发布交接

1. 按授权更新版本与公开CHANGELOG；文档整理不自动继承以前发布授权。
2. 提交前检查status/diff/log，仅纳入预期源码、测试、脚本和手册；排除真实配置、用户DB、私钥和构建产物。
3. UI经用户确认后合并，使用 `--no-ff`；若合并后tree完全相同，可沿用已通过验证，发生新改动则重新选择验证范围。
4. 推送、标签和GitHub Release需本次用户授权；发布后核对远端main、标签目标、Release正式状态、资产大小和digest。
5. 更新CURRENT_STATE，明确源码提交、已发布/本地未推送/待验收状态和实际验证。公开手册只保留可迁移资料，本机报告路径留可选本地日志。
