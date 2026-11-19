# 首版设计与扩展边界

## 目标

把研发规划从聊天文字变成可读取、可评审、可推进并留有证据的工程状态。以用户提供的 DSH-plugin-engineering-plan.md 为产品方向，优先实现可安装、可验证的最小闭环。

## 与原方案的对应

| 领域 | 当前实现 | 后续扩展 |
| --- | --- | --- |
| contract | 运行时严格校验、schemaVersion、任务和证据契约 | 独立类型包、显式迁移 |
| planner | 模型工具写入详细方案，工作台编辑和审阅 | 原生流程中的分阶段分析与评审模板 |
| storage | 工作区 JSON、原子更新、版本记录、导出 | 独立历史存储、大规模查询 |
| policy | 人工批准、版本失效、任务依赖、声明文件冲突 | 对实际修改和运行环境的策略适配 |
| workflow | 状态机及恢复读取 | 官方 workflow/subagent 服务委派 |
| verifier | 逐项证据记录及完成门禁 | 执行日志可信采集、Git SHA 与运行环境绑定 |
| UI | 原生会话视图、表单、任务、证据及来源 | 图形 DAG、图表渲染、差异审阅 |
| agent adapter / knowledge | 复用现有会话工具、分类来源 | 外部 Agent 与知识库接入 |

首版只安装一个 bundle，领域核心与 Host/Client 分离。把不稳定接口过早拆成多个 npm 包会增加版本协调成本；领域契约稳定后可按上述边界提取。

## 状态模型

`revision` 是每次权威状态变更的乐观锁；`planVersion` 表示审批所针对的方案版本。批准后编辑规划会撤销当前批准并递增方案版本。已经开始的计划通过人工 `replan` 返回草稿，保留旧快照，全部任务重新开始。

任务 pending → running → verifying → completed；异常路径使用 blocked/failed/cancelled。依赖任务必须 completed，cancelled 不满足依赖。running/verifying 占用预计文件。重跑任务清空当前尝试证据并保留历史；每条验收标准最新的当前版本证据均为 passed 才允许完成。

取消操作是过程记录，非验收成功。完成汇总必须结合 completed/cancelled 数量读取。

## 信任与一致性

- actor 由 Host 适配器决定，不从工具参数接受。模型工具不包含 approve/replan。
- `/engineering` 属于 DSH 人工命令，UI 通过官方 remote.commands.execute 调用。
- 文件存储可由项目拥有者修改，本插件不是防篡改审计系统，也不提供机器级访问隔离。
- 验收证据是归因的自报记录；UI/Agent 的 passed 不替代真实命令输出或独立审查。
- 短暂锁用于防止不同会话/进程覆盖；进程退出遗留锁需确认后清理。
- 导出不是权威源，部分导出可重建；无需修改 revision。
- 会话恢复只恢复项目状态，不自动恢复或重新执行开发命令。

## EAP 适配方式

在 J:/Code/Engineering-Automation-Platform 对应的 DSH 会话创建变更，数据自然保存到该工作区。先分析当前源代码，再把工程文档分类为 reference；实际核对过的结论才记 verified，未验证设计记 assumption。插件不写死 EAP 的模块、命令、技术栈和流程政策。

## 已知规模约束

200 个任务、每次输入/状态约 2 MiB，文本及数组有长度限制；大需求拆分变更。状态机不自动计算文件真实影响范围，不检查未申报的代码修改。工作树并行隔离、跨任务代码基线失效和独立用户交付验收是后续能力。
