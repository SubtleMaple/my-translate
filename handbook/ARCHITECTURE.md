# 架构与调用链

适用基线见 [当前状态](CURRENT_STATE.md)。业务语义见 [BUSINESS_RULES](BUSINESS_RULES.md)，数据结构见 [DATA_MODEL](DATA_MODEL.md)。

## 全局结构

```text
共享 React UI / Zustand stores
          │ window.api（RendererApi）
          ├─ Windows: contextBridge → ipcRenderer → ipcMain
          └─ Android: 复用preload → JSON RPC → Java转发 → 服务WebView handler
                                      │
                          main/ipc.ts 统一编排
                                      │
                 main/services + main/llm + main/db/*Repo
                       │              │             │
                  平台设置/导出     注入HTTP实现    平台database/persist
                       │              │             │
Windows:          userData JSON    Electron net.fetch    sql.js WASM → 文件
Android:          Java加密存储     Java HTTPS/SSE         sql.js → Java加密存储
```

`src/main/` 不等于“全部仅限桌面运行”。其中业务服务、仓储和IPC注册在Android服务WebView中也会被打包执行。

## Windows

- 启动：[main/index.ts](../src/main/index.ts) 注入 `net.fetch`，加载设置/数据库，注册handlers，创建窗口/托盘，恢复pending详情队列；退出时flush。
- 窗口/托盘：[window.ts](../src/main/window.ts)、[tray.ts](../src/main/tray.ts) 管理置顶、透明度、尺寸、极简及关闭隐藏。开发隔离profile通过 `MY_TRANSLATE_USER_DATA`，打包版忽略该变量。
- UI唯一能力入口：[preload/index.ts](../src/preload/index.ts) 暴露 `window.api`，与 [RendererApi](../src/shared/types.ts) 对应。
- [ipc.ts](../src/main/ipc.ts) 集中注册主进程handler，编排业务结果、窗口副作用和事件广播。
- [electron.vite.config.ts](../electron.vite.config.ts) 构建三端到out；[electron-builder.yml](../electron-builder.yml) 收集运行产物、数据库WASM与图标生成NSIS包。

## Android

平台入口为 [MainActivity.java](../android/app/src/main/java/com/mytranslate/mobile/MainActivity.java)，包含两个WebView：

| 层 | 入口 | 能力 |
|---|---|---|
| 可见UI | [ui.ts](../src/android/ui.ts) | 复用preload与React；只接收RPC/事件和剪贴板桥；加载mobile.css |
| UI传输 | [rendererBridge.ts](../src/android/rendererBridge.ts) | 用请求ID匹配Promise、订阅事件、超时处理，模拟Electron renderer接口 |
| 隔离服务 | [service.ts](../src/android/service.ts) | 初始化设置/DB，注入nativeFetch，注册同一批业务handlers，恢复详情队列 |
| 主进程适配 | [host.ts](../src/android/host.ts) | handler Map、事件发出、版本/路径与窗口操作适配；窗口API在手机上为no-op |
| 原生宿主 | MainActivity | 本地资源拦截、Java HTTPS、取消、Keystore/AtomicFile、系统导出、生命周期 |

调用路径：UI `window.api` → `AndroidUI.post` → Java `invokeService` → `handlers` → 业务服务 → `AndroidHost.post` → UI `receiveHost`。服务异常以RPC error返回。

重要构建映射见 [build-android-web.cjs](../scripts/build-android-web.cjs)：

| 原模块 | Android替代 |
|---|---|
| main/db/database.ts、main/db/persist.ts | [android/database.ts](../src/android/database.ts) |
| main/settings.ts | [android/settings.ts](../src/android/settings.ts) |
| main/window.ts、main/tray.ts、Electron/部分node:path能力 | host.ts |
| main/services/vocabExportService.ts | [android/exporter.ts](../src/android/exporter.ts) |
| node:crypto（当前用到的子集） | [android/crypto.ts](../src/android/crypto.ts) |
| preload中的Electron对象 | rendererBridge.ts，由 [Android Vite配置](../android/vite.config.ts) 替换 |

Android UI 的 `process.platform` 在构建时定义为 `android`，页面通过 `window.api.platform` 选择手机交互。不要向共享服务随意添加未适配的Node模块。

- [network.ts](../src/android/network.ts) 把Java响应头/字节块/结束/错误转换成Response与ReadableStream；取消请求必须传播到Java线程与连接。
- [rpc.ts](../src/android/rpc.ts) 用 `undefinedArgs` 保留省略参数，避免JSON将数组中undefined变成null。
- [compat.ts](../src/android/compat.ts) 提供旧WebView兼容。服务构建目标Chrome80，WebView<100加载sql.js纯JS构建；现代WebView走WASM。新增Web API不能仅以桌面浏览器可用为依据。
- UI与服务只加载APK内白名单虚拟HTTPS源；UI CSP禁止外部连接，Java网络只接受HTTPS且不自动跟随重定向。详细构建/签名见 [Android说明](../android/README.md)。

## 业务模块职责

| 业务 | 服务/算法入口 | UI/状态入口 |
|---|---|---|
| 流式翻译 | [llm/translate.ts](../src/main/llm/translate.ts)、[client.ts](../src/main/llm/client.ts) | [translateStore.ts](../src/renderer/src/stores/translateStore.ts)、[TranslateView.tsx](../src/renderer/src/components/translate/TranslateView.tsx) |
| 位置选择与归一 | [shared/tokenize.ts](../src/shared/tokenize.ts)、[normalizeWord.ts](../src/main/llm/normalizeWord.ts) | [selection.ts](../src/renderer/src/lib/selection.ts)、[WordChips.tsx](../src/renderer/src/components/translate/WordChips.tsx) |
| 词条与详情队列 | [vocabRepo.ts](../src/main/db/vocabRepo.ts)、[vocabService.ts](../src/main/services/vocabService.ts)、[wordDetail.ts](../src/main/llm/wordDetail.ts) | [VocabDetail.tsx](../src/renderer/src/components/vocab/VocabDetail.tsx) |
| 查词/收藏 | [lookupService.ts](../src/main/services/lookupService.ts) | [lookupStore.ts](../src/renderer/src/stores/lookupStore.ts)、[LookupView.tsx](../src/renderer/src/components/lookup/LookupView.tsx) |
| 推荐批次/消费 | [recommendationService.ts](../src/main/services/recommendationService.ts)、[recommendationRepo.ts](../src/main/db/recommendationRepo.ts)、[shared/recommendations.ts](../src/shared/recommendations.ts) | [recommendationStore.ts](../src/renderer/src/stores/recommendationStore.ts)、[RecommendationPanel.tsx](../src/renderer/src/components/lookup/RecommendationPanel.tsx) |
| 自测/FSRS | [reviewService.ts](../src/main/services/reviewService.ts)、[reviewScheduler.ts](../src/main/services/reviewScheduler.ts)、[reviewSelection.ts](../src/shared/reviewSelection.ts) | [reviewStore.ts](../src/renderer/src/stores/reviewStore.ts)、[ReviewView.tsx](../src/renderer/src/components/vocab/ReviewView.tsx) |
| 词库学习视图 | [vocabViewService.ts](../src/main/services/vocabViewService.ts)、[learning.ts](../src/shared/learning.ts) | [vocabStore.ts](../src/renderer/src/stores/vocabStore.ts)、[VocabView.tsx](../src/renderer/src/components/vocab/VocabView.tsx)、[wordCloud.ts](../src/renderer/src/lib/wordCloud.ts) |
| 导出 | [vocabExport.ts](../src/shared/vocabExport.ts)、[vocabExportService.ts](../src/main/services/vocabExportService.ts) / Android exporter | [VocabExportDialog.tsx](../src/renderer/src/components/vocab/VocabExportDialog.tsx) |

## 关键调用链

### 摘词

`WordChips → selectedEntries → window.api.addVocab → normalizeSelections → addNormalizedVocab → enqueueDetail → generateWordDetail → updateVocabDetail → VocabChanged`

选词目标先按位置独立消歧，模型结果严格对应目标ID；归一后的词头才用于入库去重。原始位置继续传到详情生成。添加结果与随后详情生成是两个阶段，主进程队列串行、可重试/恢复。

### 查词与推荐

`LookupView → lookupWord/lookupRecommendation → 归一或推荐义项 → generateWordDetail → recordLookup → 返回结果ID`

`recordLookup` 只在详情成功且未取消后执行，负责查词历史与本批推荐消费。收藏用结果ID读取主进程缓存，复用解释。推荐生成、读队列和消费是不同操作，完整状态机见业务手册。

### 自测与学习视图

`startReview → 选择队列 → reveal → rate → FSRS.next → 记忆/事件/会话事务 → ReviewChanged`

自测评分/撤销后刷新可见词库，隐藏词库等重新进入时读取新快照。原始 `listVocab` 和派生 `queryVocabView/getVocabViewEntry` 分开，避免将学习摘要混入原始CRUD和导出。

## 契约与状态通知

唯一频道名在 [shared/ipc.ts](../src/shared/ipc.ts)，参数与返回值在 [shared/types.ts](../src/shared/types.ts)。

| 类别 | 主要方法/事件 | 消费者 |
|---|---|---|
| 翻译流 | translate、abortTranslate；chunk/done/error携带requestId | translateStore丢弃旧请求回包 |
| 词库变更 | add/delete/note/detail；VocabChanged | 词库视图、原文已收录索引、查词收藏状态 |
| 学习变更 | rate/undo后ReviewChanged | 可见词库的熟悉度快照、词条弹窗 |
| 推荐 | getRecommendations / feedback / preference / abort | 推荐store；查词成功通过仓储消费队列 |
| 平台 | 设置、窗口、导出；Android storage:error | Windows窗口编排或Android适配/UI提示 |

异步请求需检查请求序号/原文版本/题目revision，不能让旧回包覆盖新输入。取消不能仅隐藏loading，还需传播至实际网络或会话操作边界。
