# 数据模型与持久化

适用状态见 [CURRENT_STATE](CURRENT_STATE.md)。本章解释数据职责；完整DDL以 [databaseSchema.ts](../src/shared/databaseSchema.ts) 为唯一来源，跨进程数据以 [types.ts](../src/shared/types.ts) 为准。

## 版本与表总览

sql.js内存数据库使用 `PRAGMA user_version` 逐版本迁移，目前为v5。v1建立vocabulary，v2追加count，v3追加sources，v4增加推荐辅助表，v5增加复习表。

| 表 | 主键/约束 | 职责 |
|---|---|---|
| vocabulary | 自增id；word_lower唯一 | 词条与原始摘录资料 |
| recommendation_analysis | entry_id主键 | 单词难度/领域分析及输入指纹 |
| recommendation_candidates | id主键；word_lower唯一 | 候选的完整JSON、创建时间 |
| recommendation_history | word_lower主键 | 展示、查询与认识/跳过反馈 |
| recommendation_state | 固定id=1 | 当前画像、批次、剩余队列与生成状态 |
| review_cards | entry_id主键 | FSRS记忆状态及最近评分 |
| review_sessions | id主键 | 配置、题目、进度、加练与撤销快照 |
| review_events | id主键；未撤销的(session_id,question_id)唯一 | 每次评分/跳过前后状态、算法日志 |

主要索引：vocabulary.created_at、review_events.entry_id、review_events的未撤销题目唯一索引。当前表没有自动级联外键；删除词条要调用 [vocabRepo.deleteVocab](../src/main/db/vocabRepo.ts)，由 [reviewRepo.removeReviewEntry](../src/main/db/reviewRepo.ts) 清理记忆、日志和会话快照，不能只执行一条裸DELETE。

## 词条与来源

`vocabulary` 的字段分为：

- 身份：`id / word / word_lower`。word为词头，word_lower用于大小写归一去重；旧词条保留旧词形。
- 学习内容：`phonetic / pos / brief / detail / note`，detail为Markdown，note为用户备注。
- 生成状态：`status`为pending/ready/failed；`fail_reason`记录失败原因。
- 来源与计数：`context_sentence / sources / count`。
- 时间：`created_at / updated_at`，均为Unix毫秒。

仓储转换成camelCase的 `VocabEntry`。`sources` 是JSON数组：

```json
{
  "original": "saw",
  "word": "see",
  "explanation": "该位置为 see 的过去式",
  "context": "I saw a rusty saw.",
  "selection": { "start": 2, "end": 5 }
}
```

- `selection` 是原文UTF-16字符范围 `[start,end)`，与JS String.slice一致；不是UTF-8字节，也不是单词序号。emoji可占两个code unit。
- `VocabSelection` 的 `text` 为该范围内单词按空格连接，原范围可含标点/换行；主进程用共享分词器复验边界和文本。
- sources去重包含原词、完整原句及起止位置；同句两个saw可有独立来源。旧来源/无上下文查词允许没有selection，不能据此推断句中所有同形词已收录。
- 归一后的相同词头在同批计一次，来源可保存多处。重复摘词增加count；查词收藏已有词幂等、不增加count。
- `context_sentence`用于原有详情生成语境；新增来源数组不会把已有详情/备注替换为新模型结果。sources数量不是count的别名。

相关实现：[tokenize](../src/shared/tokenize.ts)、[normalizeWord](../src/main/llm/normalizeWord.ts)、[vocabRepo](../src/main/db/vocabRepo.ts)。

## 推荐持久状态

JSON结构定义在 [shared/recommendations.ts](../src/shared/recommendations.ts)，读写在 [recommendationRepo.ts](../src/main/db/recommendationRepo.ts)。

| 字段 | 含义/不变量 |
|---|---|
| coldLevel / adjustment | 空词库起始等级及难度偏移，偏移在±2内，目标收敛A1–C2 |
| batchIds | 当前生成批次的全部ID，至多10个；`null`=未初始化/旧数据待接入，`[]`=已有空批次 |
| queueIds | 本批尚未消费的ID，顺序保留；只能是batchIds的子集 |
| currentIds | 当前显示ID，读取时取有效queueIds前3个；消费写入与随后读取补位之间可短暂不足3个 |
| profileKey | 画像/模型/词库/反馈输入指纹；变化表示下次生成需更新，不授权自动重生成 |
| generatedAt / lastAttempt / lastError | 批次生成时间、首次初始化请求限流依据、错误反馈 |

`remainingCount` 包含正在展示的最多3个词；`batchSize` 为本批总数。`currentIds`、整个候选缓存和剩余队列不可互相替代。

- analysis payload含entryId、lemma、CEFR等级、topic、confidence、specialist；fingerprint结合有效词条证据与当前模型设置。API Key不参与指纹，备注/整份Markdown详情不发送给模型。
- candidate payload含词头、屈折变体、词族、等级、领域、拟解释词性/义项、理由和估计实用性。候选库可有历史缓存，但本批补位只读取queueIds。
- history保存kind、topic、updated_at、shown_at、looked_up_at、feedback_word；同次词形反馈用feedback_word归组撤销，不靠时间戳猜测分组。
- 查询历史和候选消费由成功查词调用 `recordLookup`；认识/不感兴趣会消费；普通收藏由词库排除逻辑在读队列时清除匹配词。不能重复将收藏计为一次查询消费。
- 新候选与激活批次在同一SQL事务提交。已消费ID从queueIds持久移除，冷却期过去也不会自动回到该批。
- 旧缓存首次读时本地接入至多10个候选；耗尽后的空数组必须保留，不能改回null，否则会错误触发付费初始化。

状态转移见 [推荐候选队列](BUSINESS_RULES.md#推荐候选队列)。

## 复习与学习摘要

- [reviewScheduler.ts](../src/main/services/reviewScheduler.ts) 把FSRS Card中的Date转换为毫秒存储；card含due、last_review、stability、difficulty、state、reps、lapses、学习步骤等，外层另存lastRating与engine。
- [reviewRepo.ts](../src/main/db/reviewRepo.ts) 的会话payload存config、seed、parameters、baseIds、queue、current、attempts、unavailableIds、deferredIds和上一题undo快照。当前题保存答案快照，揭晓前返回DTO不暴露答案。
- session状态为active/completed/ended；读取与提交检查最新会话，不能让旧会话操作作用于新轮次。
- 每个 `ReviewCommand` 带sessionId、questionId、revision。相同题目/版本/评分重放不重复记次，冲突评分或旧revision拒绝。
- rating为1–4；跳过日志rating为null，不更新记忆。撤销把事件标为reverted并恢复beforeMemory/beforeSession，同时提升revision。
- `review_cards.card.reps`、有效评分日志次数、首次评分统计、额外加练次数、vocabulary.count是不同语义；FSRS lapses也不是所有“忘了”按钮次数。

[vocabViewService.ts](../src/main/services/vocabViewService.ts) 和 [learning.ts](../src/shared/learning.ts) 派生LearningSummary：长期阶段、S、即时R/risk、有效评分数、最近评分与到期信息。聚合排除跳过/撤销，跨日依据要求成功自评至少相隔24小时。派生摘要按统一evaluatedAt计算，不写回词条，不因浏览修改复习安排。

## 平台持久化

| 项目 | Windows | Android |
|---|---|---|
| DB加载 | [main/db/database.ts](../src/main/db/database.ts) 读取WASM与userData数据库 | [android/database.ts](../src/android/database.ts) 从NativeHost读加密存储解出的base64，选择WASM或JS引擎 |
| DB保存 | [persist.ts](../src/main/db/persist.ts)：markDirty后800ms防抖，export→tmp→rename；正常退出强制flush | markDirty标记并排0ms保存；RPC成功响应与事件发送前同步flush，经Java AES-GCM + AtomicFile写盘 |
| 设置 | [main/settings.ts](../src/main/settings.ts)：内存缓存、300ms防抖JSON原子替换 | [android/settings.ts](../src/android/settings.ts)：先同步原生写入，再更新内存cache |
| 损坏加载 | 现有实现捕获加载/迁移异常，尝试重命名corrupt备份后建空库 | integrity_check/解密失败会报错保留原文件；高于v5拒绝启动 |
| 数据位置 | dev与packaged userData分离；开发可指定隔离目录 | App私有files目录中的settings.enc/database.enc，Keystore密钥留在设备 |

Windows默认位置见 [README](../README.md#数据与配置位置)。Android实现见 [native.ts](../src/android/native.ts)、[host.ts](../src/android/host.ts) 和 [Java宿主](../android/app/src/main/java/com/mytranslate/mobile/MainActivity.java)。两平台没有自动同步。

### 事务与保存失败不是一回事

SQL事务保证内存中候选/评分等多表更新一致；平台落盘发生在提交后。Windows写盘失败会记录日志并保持dirty等待后续保存；Android可能在SQL已提交后因同步写盘失败返回错误，内存变更仍存在，dirty保留。

因此“RPC报错”不总等于“业务已回滚”，不能盲目重放会增加计数的操作。评分有幂等事件、批次刷新有事务，其他操作应核对实际状态；验证写失败时同时检查内存、磁盘、错误与重试行为。

## 迁移与删除的修改步骤

1. 在shared schema追加版本；不得改旧迁移来假装升级已经运行的用户库。
2. 同步仓储映射、默认JSON字段、共享类型、Android较新版本拒绝条件；尤其检查当前Android代码中的版本上限。
3. JSON payload加字段要在默认对象/读取合并中兼容旧值，并区分null、空数组和缺失属性。
4. 所有SQL写入经过仓储/业务事务并markDirty；通知放在业务提交后。
5. 使用合成旧库验证跨版本升级、原字段不变、损坏/写失败、重启复读；跑两端对应测试，见 [验证矩阵](TESTING_RELEASE.md#验证矩阵)。

## 导出不是完整备份

[vocabExport.ts](../src/shared/vocabExport.ts) 的JSON格式版本为1，CSV列固定、sources_json保留完整来源；不含设置/API Key、推荐队列或完整复习会话。读取示例见 [README](../README.md#词库导出格式与分析)。

Windows在保存位置确认后取全量快照并临时文件替换；Android在启动导出时取快照，交给系统文档选择器保存，返回的filePath是URI。不要把Android URI当Node文件路径处理。
