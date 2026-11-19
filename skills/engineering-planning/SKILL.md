# Engineering planning

用于从工程需求建立可评审、可恢复的开发规划。使用现有 engineering_plan 和 DSH 原生读取、搜索、编辑、执行工具；该插件只管理规划与状态，尚无自动 executor、自动工作树隔离或独立验收执行器。

## 恢复与调查

1. 先调用 engineering_plan list，选定变更后读取 get 与 context。没有变更时 create 草稿。每次写操作使用最新返回的 revision 作为 expectedRevision；遇到 REVISION_CONFLICT 重新 get/context 并合并变更，不覆盖其他人的修改。
2. 读取用户需求及相关代码，追踪真实入口、调用链、数据流、测试和配置。文件存在或旧文档的描述并不证明当前实现行为。涉及 DSH 扩展先加载 dsh-doc 并 Inspect 实际接口。
3. references 区分 reference（历史文档或外部参考）、verified（实际读过代码或观察到行为，并附路径/行号/命令结果）、assumption（尚待验证）。源码证据只支持静态结论，运行行为需实际观察。EAP 等参考项目不构成固定流程要求。

## 形成规划

按需求澄清、现状分析、架构设计、接口契约、任务拆解、验收设计顺序推进。保存 proposal、requirements、architecture、implementation、impact-analysis、acceptance、decisions、findings 中相关文档；图表源码可保存到 diagrams.architecture、sequence、data-flow。

将待人工关注的要求保存为 planning.reviewRequirements。逐项显式填写 planning.sections 的 requirements、analysis、architecture、interfaces、tasks、acceptance，每项含 status（pending 或 ready）与 note。就绪度是自报；依据实际分析结果填写，绝不通过解析 Markdown 标题、复选框或文档长度推断。证据不足留 pending，note 说明缺口。六项 ready 不是新增审批门禁。

将工作拆为调查与契约、核心实现、集成界面、验证交付等适合本需求的阶段。任务使用唯一 id，明确 dependencies、expectedFiles、acceptanceCriteria、verificationCommands；阶段顺序用依赖表达。每个验收条件可观察、可执行，验证命令仅为计划，尚未执行就不记为通过。同文件任务避免并行。

## 评审与实施

保存草稿后交由用户在工作台人工 approve；Agent 不调用人类命令冒充批准。工程工具也不授予任意源码修改权限。经当前版本人工批准后，使用 DSH 原生工具执行任务并记录 pending → running → verifying → completed；依赖、冲突和验收门禁仍适用。遇阻记录 blocked 与具体 reason。

仅根据实际执行的测试、退出码、日志或产物登记 evidence，note 或 artifact 必须非空；禁止捏造测试成功、截图、审查结果或独立验证。自报证据与独立验证明确区分。对已批准规划的修改会失效批准并产生新版本；已启动规划修改需由用户停止活动任务并人工 replan。结束时 export，报告完成内容、实际验证和未验证项。
