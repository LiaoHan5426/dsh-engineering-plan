# Engineering review

用于规划评审与实现验收。审查意见是有来源的判断，不等于人工批准，也不等于自动或独立验证；插件尚无自动 executor。

## 恢复待评审对象

先调用 engineering_plan list/get/context，确认变更 id、当前 planVersion、revision、审批和任务状态。每次写入以最新 revision 作为 expectedRevision，遇冲突重新 get/context 后复核。不用过期摘要批准新版本，不把历史 evidence 当作当前版本结果。

读取真实相关代码、调用方、配置、测试与变更内容；将设计文档与实现逐项比较。实际追踪控制流、数据流、异常与边界行为，而不是仅检查标题或文件数量。references 分别标记 reference（外部或历史资料）、verified（实际源码/运行证据）、assumption（尚待核实）；每项发现附路径、行号或实际命令结果及适用范围。

## 规划评审

核对用户原始需求是否覆盖，假设是否清楚，现状分析是否有代码证据，架构边界和接口契约是否完整。检查任务 DAG、依赖、共享文件冲突、分阶段顺序和逐项验收条件。任务应能按调查与契约、实现、集成、验证交付推进，验收标准与实际需求对应。

核对 planning.reviewRequirements 和六项 planning.sections（requirements、analysis、architecture、interfaces、tasks、acceptance）。这些状态是自报；不从 Markdown 推断，不因全部 ready 自动批准。发现缺口时在 note 与 findings 中说明依据，必要时将相关项置 pending。规划修改会沿用现有版本递增和审批失效规则；运行中先报告问题，需人工 replan 后才能修改受锁规划。

## 实施验收

复核当前任务的预期文件、实现差异、依赖状态和验收条件。可在用户已有授权范围内使用 DSH 原生工具运行适当验证，收集真实退出码、输出、产物路径及时间/版本信息。尚未执行的命令标明未执行，失败如实记录；禁止捏造测试成功、审查通过、截图或覆盖率。

任务进入 verifying 后才提交 evidence，每个 criterion 对应实际 observation，outcome 为 passed 或 failed，至少提供非空 note 或 artifact。产物引用本身不证明成功；区分本人报告与独立复核。符合所有当前版本条件后再 transition completed；受阻用 blocked 和具体 reason，保留未完成项。

## 给用户的结果

按影响列出发现、证据、建议修复和未验证部分。无发现也说明实际审查范围与验证局限。记录结果到适用文档或 evidence，按需 export。人工 approve/replan 只由用户在工作台操作，Agent 不走人类命令路径冒充用户。审查不启动第二个 AgentLoop，也不承诺自动执行或自动隔离。
