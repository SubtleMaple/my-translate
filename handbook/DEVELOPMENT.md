# 新需求开发定位与工作法

先读 [当前状态](CURRENT_STATE.md) 与需求对应的 [业务规则](BUSINESS_RULES.md)。本章给出改动入口，不替代源码与测试。

## 需求定位

| 需求类型 | 首先定位 | 需要联动 | 主要验证入口 |
|---|---|---|---|
| 翻译协议/流式/取消 | [client.ts](../src/main/llm/client.ts)、[translate.ts](../src/main/llm/translate.ts) | [translateStore](../src/renderer/src/stores/translateStore.ts)、Android [network](../src/android/network.ts) / Java宿主 | [dictionary.test](../tests/dictionary.test.ts)、[translateStore.test](../tests/translateStore.test.ts)、[android.test](../tests/android.test.ts)、阅读/Android集成 |
| 选词、短语、词形 | [shared/tokenize](../src/shared/tokenize.ts)、[normalizeWord](../src/main/llm/normalizeWord.ts) | [selection](../src/renderer/src/lib/selection.ts)、[WordChips](../src/renderer/src/components/translate/WordChips.tsx)、vocabRepo/详情生成 | [vocabNormalization.test](../tests/vocabNormalization.test.ts)、[electron-selection](../tests/electron-selection.cjs) |
| 查词/收藏 | [lookupService](../src/main/services/lookupService.ts)、[lookupStore](../src/renderer/src/stores/lookupStore.ts) | 原词头/推荐义项、查询成功消费、结果缓存、VocabChanged | [lookupStore.test](../tests/lookupStore.test.ts)、[electron-dictionary](../tests/electron-dictionary.cjs) |
| 推荐规则/队列 | [recommendationService](../src/main/services/recommendationService.ts)、[recommendationRepo](../src/main/db/recommendationRepo.ts) | [shared/recommendations](../src/shared/recommendations.ts)、[提示词](../src/main/llm/recommendations.ts)、[store](../src/renderer/src/stores/recommendationStore.ts) / [面板](../src/renderer/src/components/lookup/RecommendationPanel.tsx) | [recommendations.test](../tests/recommendations.test.ts)、[recommendationStore.test](../tests/recommendationStore.test.ts)、[electron-recommendations](../tests/electron-recommendations.cjs) |
| 自测/记忆间隔 | [reviewService](../src/main/services/reviewService.ts)、[reviewScheduler](../src/main/services/reviewScheduler.ts) | [reviewSelection](../src/shared/reviewSelection.ts)、[reviewRepo](../src/main/db/reviewRepo.ts)、[ReviewView](../src/renderer/src/components/vocab/ReviewView.tsx) | [review.test](../tests/review.test.ts)、[reviewStore.test](../tests/reviewStore.test.ts)、[electron-review](../tests/electron-review.cjs) |
| 熟悉度/词云/分组 | [vocabViewService](../src/main/services/vocabViewService.ts)、[learning](../src/shared/learning.ts) | [vocabStore](../src/renderer/src/stores/vocabStore.ts)、[VocabView](../src/renderer/src/components/vocab/VocabView.tsx)、[wordCloud](../src/renderer/src/lib/wordCloud.ts) | [learningView.test](../tests/learningView.test.ts)、[wordCloud.test](../tests/wordCloud.test.ts)、[vocabStore.test](../tests/vocabStore.test.ts)、[electron-vocab-visuals](../tests/electron-vocab-visuals.cjs) |
| 词库增删/备注/迁移 | [databaseSchema](../src/shared/databaseSchema.ts)、[vocabRepo](../src/main/db/vocabRepo.ts) | 两端database/persist、复习清理、推荐排除、展示与来源索引 | 真实SQL测试及双端持久化测试 |
| 导出 | [shared/vocabExport](../src/shared/vocabExport.ts) | [Windows exporter](../src/main/services/vocabExportService.ts)、[Android exporter](../src/android/exporter.ts)、系统保存窗口/URI | [vocabExport.test](../tests/vocabExport.test.ts)、[electron-export](../tests/electron-export.cjs)、Android保存读回 |
| 设置/主题/窗口 | [types](../src/shared/types.ts)、[settingsStore](../src/renderer/src/stores/settingsStore.ts) | 两端settings、[ThemeSync](../src/renderer/src/components/ThemeSync.tsx)、[globals.css](../src/renderer/src/styles/globals.css)、[window](../src/main/window.ts) | 默认值/旧配置回归、深浅/窄窗/手机布局 |
| Android宿主能力 | [MainActivity.java](../android/app/src/main/java/com/mytranslate/mobile/MainActivity.java) | [native桥](../src/android/native.ts)、[rendererBridge](../src/android/rendererBridge.ts)、[host](../src/android/host.ts)、构建别名/CSP | [android.test](../tests/android.test.ts)、[SmokeTest.java](../android/tests/SmokeTest.java) |
| 文档交接 | 本手册、[AGENTS](../AGENTS.md)、[README](../README.md) | 当前状态、现行规则与代码链接；本地历史只作补充 | `pnpm docs:check`、`git diff --check` |

## 一次需求的推荐步骤

1. **定位基线**：检查工作区、分支、提交，阅读CURRENT_STATE的待验收项。已有分支有前置工作时写明从哪里继续，不丢弃或假装已合并。
2. **说清行为变化**：明确输入、正常路径、失败/取消、边界与持久化预期；必要时确认产品取舍。先写出应保持的不变量，例如查询不增加摘录count。
3. **划清平台影响**：共享types/UI/LLM/服务/仓储默认按双端影响检查；宿主与文件网络调用核对 [别名表](ARCHITECTURE.md#android)。
4. **契约先行**：类型与频道→preload/handler→平台适配→服务/仓储→store/组件。涉及JSON默认字段或DDL时先确认旧数据路径。
5. **针对性验证**：状态/算法用可注入时钟、seed和mock网络；读写用真实sql.js与可丢弃文件；对应IPC与设备能力用集成验证。
6. **交付与文档**：记录实际命令/结果和未验证范围，更新当前规则与状态，再按授权提交/合并/发布。

## 扩展一个API时

- [RendererApi](../src/shared/types.ts)：定义稳定的参数/返回类型，区分省略值、空队列、错误状态。
- [IPC常量](../src/shared/ipc.ts)：新增频道，不能散落字符串。
- [preload](../src/preload/index.ts)：增加受控方法；[main/ipc](../src/main/ipc.ts)注册handler。
- Android复用以上二者，但仍要检查新参数是否可JSON编码、[rpc](../src/android/rpc.ts)的省略参数、是否引入Node类型和新的原生能力。
- 修改事件时检查所有订阅者与退订；payload里的requestId/questionId/revision用于防旧回包，不可省略。
- UI字段新增默认值须更新DEFAULT_SETTINGS与平台设置合并；应验证旧设置缺字段时行为。

## 状态与异步的一致性

- `translateStore` 用原文revision和requestId隔离旧翻译、旧摘录回包；复制/粘贴也有输入快照。
- `lookupStore` 以请求ID淘汰旧结果；服务端也取消旧查词。结果ID用于收藏复用，不能让渲染端任意提交一份伪造模型详情。
- 推荐store序号控制异步生成/本地过滤；**普通读取、消费补位、生成批次必须分别处理**，不能因组件挂载而清空未消费队列。
- `reviewStore` 对写操作串行，操作失败先读服务端当前状态；忙碌期间的词库变化排队补拉。幂等仍须由主进程事务保证。
- `vocabStore` 防抖期间也淘汰旧响应；静默刷新保留已加载内容，视图切换不把旧排序回包写回。详情弹窗按ID独立读取，不能仅从筛选结果查找当前详情。

## UI改动要看哪里

入口 [App.tsx](../src/renderer/src/App.tsx) 管理普通导航和极简回翻译；[TitleBar](../src/renderer/src/components/TitleBar.tsx) 与 [SettingsView](../src/renderer/src/components/settings/SettingsView.tsx) 包含桌面/手机能力条件。

- 桌面最小完整窗口340×420，极简260×140；手机检查触屏目标、软键盘、系统栏、长按粘贴及旧WebView。
- 颜色使用语义CSS变量；配色、深浅色、学习阶段颜色有不同含义，不把它们混为掌握分数。
- 自测答案在揭晓前不渲染；把新元数据放入卡片时检查是否通过标题/ARIA/隐藏DOM泄露答案。
- 长单词/短语/Markdown要换行或滚动；词云未布置词需要明确补充入口；主要评分/操作按钮在小窗应可达。
- 视图条件分支变化后检查恢复/关闭/导出弹窗实例是否重建；测试要按当前选择的格式执行，不能依赖旧实例的本地state。

## 按现有资料排障

| 现象 | 先查什么 |
|---|---|
| 新实例静默退出 | 单实例锁、自己的测试进程是否残留；核对CIM命令行与userData |
| 模型请求一直等/无文本 | 当前provider、thinking预算、取消/超时链路、原生/Node代理配置 |
| Android空白页面 | 服务ready/fatal消息、实际WebView版本、资源白名单/路径、CSP、legacy构建、Java加载日志 |
| 手机上默认查询报错 | JSON RPC是否把undefined当成null；使用decodeArguments |
| 操作成功但重启数据没了 | 使用了哪套profile、markDirty、正常flush、原生AtomicFile错误；不要用强杀当正常退出 |
| 推荐一返回就换词/产生请求 | batchIds/queueIds语义、current/refresh、lookup成功消费、是否把耗尽重置成null |
| 自测重复记次/撤销异常 | session/question/revision、非撤销唯一约束、before快照和交易边界 |
| 发布目录无法清理 | 正在运行的免安装版或文件锁；用独立输出目录，不杀用户进程 |

## 文档更新属于完成条件

新需求影响规则时更新BUSINESS_RULES，接口/模块变动更新ARCHITECTURE/定位表，数据结构变动更新DATA_MODEL，新增测试/工具更新TESTING_RELEASE。CURRENT_STATE记录实际基线与待验收事项；公开CHANGELOG只在发布时更新。

不要把新的结论只追加到本地日志末尾。`pnpm docs:check` 会检查相对链接、大小写、命令和基础版本字段；语义仍需对照代码审查。
