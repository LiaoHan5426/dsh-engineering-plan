# Architecture design

用于对当前代码库进行架构分析并产生可执行设计。此技能只提供分析方法。插件已有的原生能力是单任务子 Agent 派发（engineering_dispatch）与单条已批准命令的执行记录（engineering_verify），两者都要求当前方案已获人工批准，也都不替代对设计结论的独立验证。

## 建立事实基线

先 engineering_plan list/get/context 恢复目标、文档、任务和版本。所有写操作带最新 revision 对应的 expectedRevision；冲突后重新 get/context 再合并。实际读取相关源码、配置、接口定义、调用方及测试，追踪入口到持久层或外部服务的调用链。记录代码路径与行号，区分源码描述和实际运行观察。

references 中将用户提供的历史工程文档、EAP 示例或外部设计记为 reference；经实际源码检查或运行核对的结论记为 verified，并写明证据与局限；未证实内容记为 assumption。不要把参考项目的模块、命令、流程强加给当前项目。涉及 DSH 接口时先用 dsh-doc 与运行时 Inspect，其他库按需核实当前版本文档。

## 设计与权衡

1. 梳理当前模块职责、边界和耦合，定位需求涉及的实际读写路径、兼容要求与失败场景。
2. 比较可行方案，记录选择理由、替代方案、成本及未解问题。不要仅从目录名臆测模块职责。
3. 写明接口输入输出、错误码、版本、状态转换、幂等与并发条件；明确存储权威来源、迁移、回滚和兼容行为。
4. 保存 documents.architecture、implementation、impact-analysis、decisions、findings 及相应 Mermaid architecture/sequence/data-flow 源码。图表应能追溯到源码事实或明确标注的拟议设计。
5. 分阶段拆为契约与迁移、核心实现、调用端适配、集成验证。每项任务包含依赖、预计文件和可观察验收条件；共享文件任务串行化，验证命令与执行证据分开。

## 就绪度与交接

planning.reviewRequirements 记录需要用户决策的架构问题。仅根据实际工作显式填写 planning.sections.analysis、architecture、interfaces 等 status（pending/ready）与 note；六项就绪度均为自报，绝不解析 Markdown 推断。未决问题保留 pending。其余就绪项保持原值或依实际核对结果更新。

更新规划沿用现有审批和版本规则；新设计保存后交由用户人工 approve，不通过人类命令代为批准。已启动规划需用户停止活动任务并 replan 后修改。实施仍通过 DSH 原生工具完成；真正执行后才记录验证证据。禁止捏造测试成功、运行性能或兼容性结论。交付时指出设计已验证范围、待验证假设和迁移风险，必要时 export 当前规划。
