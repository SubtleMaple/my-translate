# 更新需求实施计划（R1：Anthropic / 短语拖选 / 极简模式 / 生词计数）

> 依据 `docs/更新需求.md` 制定。P1-P7 的历史规划归档在 `docs/history/plan-v1.md`，本文件只覆盖本轮 4 项新功能。
> 开发模式：分支 `feature/update-requirements`，4 个逻辑提交，完成后 `--no-ff` 合并回 main 并删分支。

## 总览

- **零新增依赖**：Anthropic 走 Node fetch、短语拖选用原生 DOM 事件、Select 组件 P6 已有
- 无破坏性契约变更：`VocabEntry`/`VocabSortBy`/`LlmSettings` 均为向后兼容扩展；DB 走既有 MIGRATIONS 版本机制
- 已确认的取舍：
  - 已收录 Chip 的划线拦截保持不变（点击仍提示已在生词本）；count+1 由 addVocab 内部完成（短语拖选包含已收录词时自然触发）
  - 重复加入 failed 词仅 count+1，不自动重试详情（手动「重试」入口保留）
  - 极简模式开关：标题栏按钮 + 设置页「外观」Card 双入口

---

## 功能 1：Anthropic API 支持

**共享契约**（`src/shared/types.ts`）
- `ApiType = 'openai' | 'anthropic'`
- `LlmProviderConfig = { baseURL, apiKey, model }`
- `LlmSettings` 重构为嵌套式：`{ type: ApiType, openai: LlmProviderConfig, anthropic: LlmProviderConfig }`
  - 默认：openai=`https://api.openai.com/v1` / gpt-4o-mini；anthropic=`https://api.anthropic.com/v1` / claude-sonnet-4-20250514
- 新增 `src/shared/llm.ts`：纯函数 `getActiveLlm(llm)` → 返回生效 provider（主/渲染两端共用）

**settings.json 一次性迁移**（`src/main/settings.ts`）
- 检测旧平铺结构（`raw.llm.baseURL` 存在但无 `openai` 键）→ 映射为 `{ type:'openai', openai:{旧值}, anthropic:默认 }`

**主进程 LLM 层**
- `llm/client.ts` `chatCompletion` 按 provider 分发：
  - openai：现有逻辑不变
  - anthropic：`POST {base}/messages`；headers `x-api-key` + `anthropic-version: 2023-06-01`；body `{model, max_tokens, system(顶层，从 messages 提取), messages:[{role,content}]}`；响应取 `content[].text` 拼接
  - 错误映射复用 `describeHttpError`（Anthropic 错误体同为 `{error:{message}}`）
- `llm/translate.ts` 流式按 provider 分支：
  - anthropic：`content_block_delta` + `delta.type==='text_delta'` → 累加 `delta.text`（忽略 thinking 块 / message_stop）；body 必带 `max_tokens`（2000）
- `wordDetail.ts` / `vocabService.ts` / `ipc.ts` 签名不变，经 chatCompletion 分发自动生效

**渲染端**
- `SettingsView` 大模型卡片顶部加 API 类型 Select；三个字段绑定当前类型草稿；切换类型 = 草稿切到该类型已存配置 + 立即保存 type；占位符/提示随类型变化
- `settingsStore.saveLlm` 适配新形状；翻译前「未配置 Key」检查改用 `getActiveLlm`

---

## 功能 2：固定短语拖选

**translateStore**
- 新增 `phraseRange: {start,end} | null`（单词 token 序号闭区间，start≤end）
- `setPhraseRange`；拖选完成清空 `selectedWords`（短语替代单词选择）；`toggleWord`/`setInput`/`clear` 清空 phraseRange
- `addToVocab` 条目 = `selectedWords ∪ {短语}`（短语 = tokenize 按区间原序取词、空格连接、保留原大小写）；短语整体为一条生词记录，共用加入/详情流程（main 零改动）
- 按钮计数 = `selectedWords.size + (phraseRange ? 1 : 0)`

**WordChips 拖拽交互**（原生 DOM）
- 单词 chip：`onMouseDown` 记录起点；拖动中 `onMouseEnter` 实时更新终点；window mousemove/mouseup 结束：有位移 → 提交 phraseRange；无位移 → 现有 toggleWord
- 拖拽期间容器 `select-none`；已收录 chip 不可作拖拽起点（保持拦截），可被短语范围覆盖高亮
- 高亮：selectedWords 或区间内 → primary 样式（区间内覆盖划线弱化）；文案改「点击多选，按住拖动选短语」
- 已收录 Chip 交互维持现状

**AddConfirmDialog**
- 列表项 = 单词 chips + 短语 chip（带「短语」标记）；toast 文案见功能 4

---

## 功能 3：极简模式

- `AppSettings.ui.minimal: boolean`（默认 false，持久化）
- **开关两处**：TitleBar 深浅色旁图标按钮（Minimize2/Maximize2）+ 设置页「外观」Card Switch；`settingsStore.setMinimal`（乐观更新 + setSettings，沿用 setAlwaysOnTop 模式）
- **TranslateView 极简渲染**：
  - 隐藏 WordChips / AddConfirmDialog / 译文卡片
  - `showTranslation` 本地状态：点翻译置 false；done 事件置 true（原句被译文替换）；输出非空时显示「原句/译文」切换按钮
  - 文本框受控显示当前侧：显示译文时 readOnly，编辑即切回输入侧（写 input）；Ctrl+Enter / 停止 / 清空不变；清空复位 showTranslation
- 关闭恢复完整界面；生词本/设置页不受影响

---

## 功能 4：生词 count 与频率排序

**DB**（`db/database.ts` 追加 MIGRATION v2）
- `ALTER TABLE vocabulary ADD COLUMN count INTEGER NOT NULL DEFAULT 1`

**vocabRepo**
- `addVocab`：已存在 → `UPDATE vocabulary SET count = count + 1, updated_at = ? WHERE word_lower = ?`，词归入返回的 `existed`（含义变为「次数+1」）
- `SELECT_COLUMNS` + `count`；`toVocabEntry` 映射；`listVocab` 增加 `sortBy='count'` → `ORDER BY count DESC, updated_at DESC`

**共享/UI**
- `VocabEntry.count`；`VocabSortBy = 'time' | 'alpha' | 'count'`
- VocabToolbar Select 加「出现次数」；VocabCard 时间旁显示 `×count` 徽标
- AddConfirmDialog toast：「已加入 n 个生词，m 个已存在（次数 +1）」
- 详情生成仅新记录入队

---

## 文件变更清单

| 文件 | 变更 |
|---|---|
| `src/shared/types.ts` | ApiType / LlmProviderConfig / LlmSettings 重构 / VocabEntry.count / VocabSortBy / DEFAULT_SETTINGS |
| `src/shared/llm.ts` | 新增：getActiveLlm |
| `src/main/settings.ts` | 默认值 + 旧结构迁移 |
| `src/main/llm/client.ts` | provider 分发（anthropic 分支） |
| `src/main/llm/translate.ts` | SSE provider 分支 |
| `src/main/db/database.ts` | MIGRATION v2（count） |
| `src/main/db/vocabRepo.ts` | count 增量 / SELECT / 排序 |
| `src/renderer/src/stores/settingsStore.ts` | saveLlm 形状 / setMinimal |
| `src/renderer/src/stores/translateStore.ts` | phraseRange / addToVocab |
| `src/renderer/src/components/settings/SettingsView.tsx` | API 类型 Select / 外观 Card |
| `src/renderer/src/components/TitleBar.tsx` | 极简模式按钮 |
| `src/renderer/src/components/translate/TranslateView.tsx` | 极简渲染 / 原句译文切换 |
| `src/renderer/src/components/translate/WordChips.tsx` | 拖拽选短语 |
| `src/renderer/src/components/translate/AddConfirmDialog.tsx` | 短语条目 + toast 文案 |
| `src/renderer/src/components/vocab/VocabToolbar.tsx` | 出现次数排序项 |
| `src/renderer/src/components/vocab/VocabCard.tsx` | ×count 徽标 |

## 测试与验证

1. node 独立测试（esbuild bundle + mock fetch）：Anthropic 流式 SSE / 非流式提取 / settings 迁移 / SQL v2 迁移 + count 增量 + count 排序
2. `pnpm typecheck` + `pnpm build`
3. dev 冒烟（4 进程存活、无 stderr）
4. 用户目视验收（清单写入 docs/进度.md）

## 风险点

- Anthropic `max_tokens`/`system` 格式严格 → 顶层 system + 必填 max_tokens；thinking 块已在流式解析中过滤
- 拖拽 vs 点击边界 → 无位移视为点击
- settings 迁移只认「旧平铺 + 无新键」形态，避免误迁移
