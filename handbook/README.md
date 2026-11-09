# 开发手册入口

> 面向没有聊天上下文的新开发者/AI。维护基线与待办以 [CURRENT_STATE](CURRENT_STATE.md) 为准；这些文件应随源码进入 Git，而不是依赖本机 `docs/`。

## 最短接手路径

1. 阅读 [AGENTS](../AGENTS.md) 的约束和权限，再读 [当前状态](CURRENT_STATE.md)。
2. 在仓库根核对真实状态：

   ```powershell
   git status --short --branch
   git branch -vv
   git log --oneline -8
   git log --oneline main..HEAD
   ```

   文档记录的是快照。`origin/main` 也是本地缓存；未 fetch 时不要宣称已核对远端最新状态。
3. 阅读 [架构](ARCHITECTURE.md) 的总图，确认这项需求会影响哪一端、哪条业务链。
4. 在 [现行业务规则](BUSINESS_RULES.md) 找对应章节，再用 [开发定位表](DEVELOPMENT.md#需求定位) 定位实现与测试。
5. 按 [验证矩阵](TESTING_RELEASE.md#验证矩阵) 选择检查；涉及数据时先读 [数据模型](DATA_MODEL.md)。

**先能回答三个问题再编辑：当前实现基线是什么？用户要求改变哪条规则？需要联动哪些平台和验证？**

## 文档地图

| 文档 | 回答的问题 | 何时阅读 |
|---|---|---|
| [CURRENT_STATE](CURRENT_STATE.md) | 已发布、已合并、待验收分别是什么？接下来有什么不能误处理？ | 每次新会话 |
| [ARCHITECTURE](ARCHITECTURE.md) | Windows/Android 怎样共用代码？调用链与平台边界在哪里？ | 新会话先看总图，改架构时深读 |
| [DATA_MODEL](DATA_MODEL.md) | 哪些表、JSON、时间/位置单位、事务与持久化约束？ | 改数据、查询、迁移、导出时 |
| [BUSINESS_RULES](BUSINESS_RULES.md) | 功能现在应该怎样表现？哪些看似合理的改法会破坏约定？ | 改相应功能前 |
| [DEVELOPMENT](DEVELOPMENT.md) | 需求通常改哪些文件？怎样改接口并兼顾双端？ | 实现新需求时 |
| [TESTING_RELEASE](TESTING_RELEASE.md) | 跑什么测试、如何隔离数据、构建和发布？ | 验证/交付时 |
| [根 README](../README.md) | 用户功能与使用说明 | 了解产品或更新用户文档 |
| [Android README](../android/README.md) | 手机安装、SDK、签名、设备验证 | 手机工作时 |
| [CHANGELOG](../CHANGELOG.md) | 公开版本发布了什么？ | 判断已发布能力时 |

## 文档与代码的关系

- 手册描述**当前开发基线**，不自动等同于最新 GitHub Release；具体差异见当前状态页。
- 当前用户明确需求决定本次变更目标；代码与测试用于确认实现事实。遇到冲突先核对分支/提交、历史确认与源码，不按旧计划盲改。
- schema、API、脚本等都附源码链接，详细字段以这些定义为单一事实来源；手册负责解释关联、不变量和修改入口。
- 本地 `docs/进度.md`、旧需求/计划、`docs/qa-*` 是可选历史资料。新克隆没有它们，也应能按本手册开发和复现测试。
- 历史通过记录只说明对应代码当时通过；本次任务是否运行过、模拟还是实机，必须明确区分。

## 可直接给新 AI 的接手提示

```text
请先读 AGENTS.md、handbook/README.md 和 handbook/CURRENT_STATE.md，
用 Git 状态确认当前分支与文档基线，然后阅读本需求对应的架构、业务规则、数据模型和测试矩阵。
请先说明你理解的当前行为、要改变的规则、涉及的平台和验证范围，再实现需求。
不要把历史计划或版本号当成当前代码事实；保留待验收分支及已有工作。
完成后更新当前状态与相关主题手册，区分已验证、未验证、待用户验收及发布状态。
```

## 维护方式

当前状态只在 CURRENT_STATE 维护；规则变化更新 BUSINESS_RULES；模块/适配变化更新 ARCHITECTURE；表或 payload 变化更新 DATA_MODEL；命令/测试变化更新 TESTING_RELEASE。然后运行 `pnpm docs:check`。新文档入口和源码链接应能在没有本地历史资料的检出目录中解析。
