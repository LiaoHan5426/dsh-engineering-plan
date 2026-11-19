# 工程规划工作台 / Engineering planner

DSH 原生插件，为软件工程变更提供可持久化的规划、任务依赖、人工评审、进度及验收证据。当前版本 `0.2.0`，面向 DSH `0.2.2-rc.5`。使用原生会话视图、工具和人工命令；没有另建 AgentLoop。

## 安装为 DSH 插件

仓库：https://github.com/LiaoHan5426/dsh-engineering-plan

这是 Cordis Host + DSH Client 原生插件 bundle，包含工程工具、会话工作台和三个 Skill。当前包名为 `@local/dsh-engineering-planner`，尚未发布到 npm；请从源码目录安装。

```sh
git clone https://github.com/LiaoHan5426/dsh-engineering-plan.git
cd dsh-engineering-plan
```

在 DSH 插件管理器添加克隆目录的绝对路径，或让 DSH Agent 调用：

```json
{"action":"install_bundle","target":"<克隆目录的绝对路径>"}
```

上述 JSON 是 `plugin_manager` 工具参数。安装到当前 profile；切换其他 profile 需单独安装。已验证环境为 Windows、DSH `0.2.2-rc.5`、desktop profile，其他版本尚待兼容验证，清单当前固定该 DSH 版本。

更新时先 `git pull --ff-only`，再通过插件管理器重新加载/安装；若管理器返回 `already-installed`，按其提示移除 bundle 后从同一目录重新安装。规划数据位于各目标工程工作区，独立于插件安装目录。若安装结果提示重启，请重启 DSH。

## 使用

在目标项目会话的视图切换中选择「工程规划」。工作台包括「开发规划」「架构设计」「任务看板」「质量门禁」四个视图。

1. 在目标项目工作区开启会话，进入工程规划视图，创建变更并填写目标。
2. 请 Agent 分析当前代码，然后调用 `engineering_plan` 保存规格文档及任务。将文档参考、源码已核实事实和待验证假设分开记录。
3. 在工作台审阅方案、任务依赖、预计修改文件及验收标准，保存后点击批准。修改规划将产生新版本并使旧批准失效。
4. Agent 用 DSH 现有文件、终端、子 Agent 工具实施开发，通过 `engineering_plan` 推进任务状态。任务依赖须全部完成；进行中任务声明的重叠文件会阻止并行启动。
5. 进入验证阶段，实际执行验收，再逐项记录通过或失败的证据及产物位置。当前版本所有验收项最近一次证据通过后，任务才能完成。
6. 导出文档，或获取上下文摘要以继续跨会话开发。

可直接给 Agent 这样的指令：

> 使用 engineering_plan 为当前需求建立开发规划。先检查当前源码和工作区状态，将历史文档作为参考；输出需求、模块边界、实现步骤、影响分析、验收标准及依赖任务。保存草稿供我在工程规划工作台评审。评审后按任务推进，只有实际检查通过才记录 passed 证据。

已有规划恢复：

> 使用 engineering_plan list 找到该变更，然后读取 context 和 get，核对当前代码是否仍符合规划。继续当前任务；不要把恢复上下文视为重新批准，也不要把历史通过结果视为这次验证已通过。

人工命令 `/engineering {"action":"list"}` 与 UI 共用操作边界。模型工具没有批准操作；批准来自人工命令/UI 路径。

## 已实现

- 工作区隔离的变更列表，精简/标准模式标记；当前两种模式均展示完整规格表单。
- 8 类规格文档、图表源码、结构化任务和分类参考来源。
- DAG 校验、依赖完成门禁、预计文件冲突检查。
- 乐观并发 revision、计划版本 planVersion、批准与证据归档历史。
- 原子状态写入与进程间互斥锁，状态持久化后可跨会话读取。
- 当前计划版本、当前任务尝试的逐项验收证据门禁。
- 原生主题与中英文界面、四视图工作台、任务依赖 SVG、七状态看板与逐项证据矩阵。
- 六项显式规划就绪状态与评审要求；状态由作者填写，不从 Markdown 推断。
- 规划、任务实施和验证请求可插入原生会话输入草稿，由用户确认发送。
- `engineering-planning`、`architecture-design`、`engineering-review` 三个运行时 Skill。
- 编辑与运行表单的会话内草稿缓存、导航保护及导出。

## 数据与恢复

权威数据在目标工作区 `.dsh/engineering/changes/<change-id>/state.json`。Markdown 是导出投影，手工编辑它不会回写规划。建议将规划纳入项目版本控制前先检查是否包含私密内容。

导出：`proposal.md`、`requirements.md`、`architecture.md`、`implementation.md`、`impact-analysis.md`、`acceptance.md`、`decisions.md`、`findings.md`、`progress.md`、`tasks.json`，以及 `diagrams/` 中 architecture、sequence、data-flow、task-dag 的 Mermaid 源码。任务 DAG 自动生成；其他图表由规划作者提供。图表源码不等于已完成渲染验证。

每次修改必须携带最新 `expectedRevision`，冲突时重新读取并合并修改。重新规划归档旧版本，保留批准及证据；当前任务状态重新建立。运行中应先将所有进行中/验证中任务转为阻塞或失败，再由用户点击「重新规划」，之后修订并重新评审。

异常退出可能留下 `.lock`。先确认锁记录的进程已退出并备份状态，再移除该变更目录中的残留锁，然后重新打开工作台。插件不会仅凭时间自动抢锁。导出多文件并非整体事务；中途失败可从权威 state 重新导出。

## 当前边界

本版是规划与过程跟踪 MVP。通过证据是带操作者来源的报告，不是独立验证器出具的证明。插件不自动执行验收命令，不自动派发子 Agent，不创建 Git worktree，也不拦截插件外的文件修改。文件冲突检测依据任务声明，无法涵盖未申报文件或 Git 分支差异。执行动作由当前会话使用 DSH 原生工具完成。

历史记录保存在同一状态文件，总大小上限 2 MiB；大型项目应拆分为多个变更。任务取消不等于通过验收，汇总完成态包括已取消任务，应同时审阅任务状态。

后续可独立扩展原生执行适配、自动检查结果采集、Git 基线绑定、用户交付验收及工作树隔离。推荐先用真实需求验证当前闭环。

EAP 可作为第一个使用项目；其工程说明是参考输入，不作为插件的硬编码规则，也未由本插件修改。

## 开发

Node.js >=22，无第三方运行依赖。

```sh
npm test
npm run check
node scripts/validate-package.mjs
```

当前 24 项核心/Host 测试通过；实际页面点击及主题验收仍待完成。详细结果见 [验证记录](docs/VERIFICATION.md)，原始需求映射见 [验收跟踪](docs/UI-ACCEPTANCE.md)。

- `src/core.js`：数据契约校验、存储、版本、依赖与证据状态机。
- `index.js`：Host 工具和人工命令适配，共用同一领域操作。
- `client.js`：DSH conversation.view 原生界面。
- `tests/`：状态机、并发、路径及 Host 接口验证。

采用单个可安装 bundle、内部模块分层，后续在契约稳定后再拆为多包，避免首版安装与跨包版本维护成本。
