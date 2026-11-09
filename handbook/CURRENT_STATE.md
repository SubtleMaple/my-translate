# 当前开发状态

> 最后核对：2026-11-10。此页是**有日期的交接快照**，不是运行时状态接口。开始工作仍需执行下方 Git 命令。

- 当前代码 package.version：**0.3.0**（[package.json](../package.json)）。
- 数据库 schema：**v5**（[唯一迁移定义](../src/shared/databaseSchema.ts)）。
- Android versionCode：**300**；minSdk 26 / targetSdk 35（[Manifest](../android/app/src/main/AndroidManifest.xml)）。
- 本手册依据的产品代码提交：`c65f0b1`；本轮按用户“合并并推送”授权，将文档分支及其前置产品修复整合到 `main`。本次合并只协调文档，产品实现仍与该提交一致；实际主线提交与远端同步状态用下方Git命令核对。

## 代码与发布基线必须区分

| 层级 | 代码基线 | 能力/状态 |
|---|---|---|
| 已公开发布 | `v0.3.0` → `1eb0527` | Windows 桌面版，包含查词、语境摘录、推荐、FSRS、自测、导出和多视图；[正式 Release](https://github.com/SubtleMaple/my-translate/releases/tag/v0.3.0) |
| 当前主线交付内容 | `main`，产品基线 `c65f0b1` | 包含Android首版、十词推荐队列与开发手册；是本轮合并推送目标，不等同于已有Release |
| 已纳入的产品提交 | Android `44ea9d6` / 原合并 `f34e909`；推荐 `b3d9fa4` → `c65f0b1` | 推荐最终规则为“10候选、3展示、成功查询本地补位”；旧固定三词阶段不再适用 |
| 已纳入的文档提交 | 手册 `2d40108`；远端文档边界 `84fc040` | 保留handbook公开入口，同时保留本地资料可访问性、隐私与专项红队缺口约束 |

合并前本地main=`f34e909`、远端main=`84fc040`，超前2个且落后1个。本轮先以 `--no-ff` 整合远端文档更新，再以 `--no-ff` 合入 `feature/ai-handoff-docs`；唯一冲突文件AGENTS已综合两边规则处理。原文档/推荐分支名是开发历史定位，合并后可安全删除，新克隆直接从main接手。

版本号没有在每次本地构建后递增，**不能用0.3.0判断是否包含Android或新推荐队列**。推送源码不会自动更新Release、标签或安装包。

```powershell
git status --short --branch
git branch -vv
git log --oneline -8
git log --oneline origin/main..main
git log --oneline --left-right main...origin/main
git ls-remote --heads origin main
git show --no-patch --oneline v0.3.0
```

若分支名、提交或文件已变化，先更新此快照。浅克隆可能缺历史对象，需要追溯时再获取对应历史；不要凭缺少旧对象就推断代码丢失。

## 当前最容易误改的规则

当前工作基线的推荐流程以 [推荐候选队列](BUSINESS_RULES.md#推荐候选队列) 为准：

- 每批至多10个有效候选；显示队列前3个，剩余数量包含这3个。
- 成功查词才消费；失败/取消不消费；消费后仅从本批补位。
- 批次耗尽后维持空队列，只有手动刷新才生成后续批次；从未初始化时允许首次生成。
- 模型/难度变化、缓存过期、导航和重启不自动付费补充；已消费词不会因撤销反馈重插本批。

**发布标签中的自动补充规则、旧主线行为，以及 b3d9fa4 的“固定三词”阶段，都不能覆盖当前主线的队列规则。** 后续若在较旧分支工作，先明确是否需要带入队列修复。

其他必须保留的约定：逐位置选词、词头入库去重、摘录计数与自测次数分离、正常关闭/评分后的持久化、Android省略参数编码、UI不直接访问外部模型。

## 待处理事项

1. HarmonyOS 4.2 真机验收：安装、输入法/字体、后台恢复、真实服务商网络、触屏选词、十词队列和系统导出。用户已授权本轮合并，不能据此补记未执行的真机测试。
2. 后续正式发布须确认新版本号、Android versionCode、签名连续性与资产来源；本地同名安装包可能比公开Release新。

## 验证记录的适用范围

- 已发布Windows批次：历史记录47组逻辑测试及七套Electron回归通过。
- Android合入时：历史记录53组逻辑测试，Android 11 / WebView 83和Android 15 / WebView 124的模拟器验证通过。
- 产品代码 `c65f0b1`：最近完成记录为 **58/58**，双端类型检查、Windows构建/推荐集成/dev冒烟、Android 15推荐队列与新进程恢复通过。
- **以上是既有完成记录，本次文档整理未重跑产品测试、真实外部模型或真机验收。** 按 [验证矩阵](TESTING_RELEASE.md#验证矩阵) 复验新改动；测试数量以后可变，不能把一个旧数字当成通过条件。
- 本轮文档整理已完成，`pnpm docs:check` 与Git差异空白检查通过（新增文件另行检查）。校验覆盖11份文档、本地链接/源码路径/标题锚点、命令及5个基础版本字段。
- 已从可纳入Git的当前源码生成独立快照，排除 `docs/`、node_modules、.git及构建产物，直接用Node运行文档检查通过；缺失文件、错误大小写、错误锚点、无效命令、本机资料依赖、绝对路径、版本漂移七类反例均被拦截。该验证覆盖文档可迁移性，产品发布状态仍见上表。

## 环境与资料

Windows、Android数据独立；开发/打包Windows的userData也分离，见 [数据模型](DATA_MODEL.md#平台持久化)。Android普通App与HarmonyOS NEXT原生应用不是同一交付目标。

本地 `docs/` 和临时验证profile可能不存在。测试源码及运行入口已随项目保存，见 [测试手册](TESTING_RELEASE.md)。签名、真实Key、用户词库不属于可克隆的开发资料。
