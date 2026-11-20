# Git 观测接入契约（开发中）

## 已实现与待接入

纯比较模块 git-comparison.js 已独立验证16项；原生Shell采集适配器 git-collector.js 已独立验证33项。测试使用模拟Shell契约，不代表真实Host采集通过。不可变记录存储已实现；父 Agent 联合运行存储、比较和采集专项60/60通过（0跳过，退出码0）。存储使用真实临时文件及跨进程竞争测试，采集仍使用模拟Shell。模型工具、读取接口和Client展示已接入，并于2026-11-19重新安装，application=applied。全套回归退出码0，打包校验通过。真实工程仓库采集返回error/output_truncated（worktree stdout），摘要均null；观测1fa47b60-ef55-4139-aee5-d3843c67ebae已持久化。同requestId git-live-smoke-20261119-01重放返回同记录、created=false。真实架构页刷新后显示output_truncated。尚未验证真实小仓库完整成功采集；此结果证明错误与重放链路，不代表正向完整观测已通过。

## 观测范围

分别记录HEAD、暂存区差异摘要、工作树差异摘要、未跟踪路径摘要及数量。未跟踪内容、ignored内容及.dsh/engineering/**不覆盖。两轮匹配不是事务锁。输出截断或累计超过1MiB时不发布完整摘要。Git继承环境和配置仍可能影响观测，不将结果解释为规范完整工作区一致。

比较仅在绑定及完整事实适合时进行；partial可以报告已观测变化，但不证明一致。所有结果固定 fullWorkspaceEquality=not-established。观测时间必须显示，不表示持续实时检查。

## 持久化与请求重放

记录存于各变更的git-observations目录，使用不可变envelope，包含requestId、ownerSessionId和严格校验的observation。请求重放返回原观测，新的采集必须使用新requestId。重复请求的owner/版本绑定冲突应报错；不得覆盖旧文件。最终存储层负责并发去重，Host先查询已有请求以避免无意义重复采集。

Host必须确认change存在，读取revision和planVersion，再进行采集。记录的sourceRevision指采集开始时所读状态，采集结束后需再次读取版本：若版本变更，不绑定为当前计划基线。观测记录可作为历史事实保留，但应明确标注版本不匹配。持久化不自动修改计划批准、任务、证据或交付验收。

## 入口与权限

新增模型工具通过原生工具注册进入调用链，再调用采集适配器。输入仅允许动作、changeId、expectedRevision、planVersion、requestId和比较用baselineId；不接受command、cwd、Git参数或权限升级字段。工作区由当前Agent确定，每个命令再次核对策略工作区。Client只能插入工具请求草稿或读取已保存记录。

当前宿主存在本地pipeline审批行为补丁；经过原生pipeline不等于有效人工审批已得到验证。插件自己的人工计划批准边界保持独立，不因Git采集而改变。

## 小仓库实际尝试与工作区绑定

2026-11-19 在独立fixture创建未批准change 725825b0-ac48-4835-91a7-099a136d94f2（revision1/planVersion1），首次capture返回 `Workspace policy changed`，无观测生成。源码确认这是 git-operations.js 的 ENGINEERING_WORKSPACE_MISMATCH；此前因工具仅显示message而判断“并非插件错误”已更正。

DSH 0.2.2-rc.5 的 workingDirectory.set 仅更新有效cwd，不更新权限。sandboxPolicy读取session.header.cwd；子Agent的session meta继承父header.cwd，传入子Agent cwd则另记working-directory事件。因此当前严格根相等检查下，切换到子仓库或传子Agent初始cwd都不足以通过检查。正向小仓库测试需从该仓库创建独立顶层Session；不修改现有边界检查来迁就测试。

保留fixture：`J:/Code/Engineering Planner/.dsh/engineering/git-smoke-20261119-1712-git-live-positive-7f28c3`。未commit/push、未批准或改EAP。安装实现与实际报错支持以上定位，未直接读取该子会话的live policy JSON。此首次尝试未通过；后续独立顶层会话验证如下。

### 独立顶层会话正向结果

2026-11-19 使用原生session/create传fixture cwd创建session-1b48ad24-1179-497e-9eee-13b790ca2ce6。默认ops-ptc下首次skill调用报unknown，失败即停，未调用Git；随后读取已核实绝对路径的dsh-doc/SKILL.md，执行真实get→capture→compare。未放宽strict root、未模拟ctx、未批准计划。

- capture requestId `git-live-positive-top-session-capture-01`，观测 `ce1b55ac-d776-4dde-92fd-7d6a7e9be016`，工具事件seq56。
- compare requestId `git-live-positive-top-session-compare-01`，观测 `7097ab2e-938e-4ccd-a4e7-ab5fab65871a`，baseline为上述capture，工具事件seq63。
- 两者status=ok、created=true、bindingCurrent=true、sourceRevision=1、planVersion=1、headState=unborn、head=null、dirty=true、untrackedCount=4；owner/actor均为新顶层会话，workspaceRoot/repositoryRoot均为fixture。
- compare：comparable=true，headChanged/stagedChanged/worktreeChanged/untrackedPathsChanged均false，reasons=[]，observedEqual=true，fullWorkspaceEquality=not-established。未跟踪文件仅比较路径，ignored与工程状态目录排除。
- 独立观察代理逐份读取持久观测核对请求绑定；state前后hash均 `91713f9cf69d7c4937062e3acce15bb84e25cf548ec02f61eae6556960168d64`，1366bytes，revision1/version1/draft，approvals/evidence/history为空。最终会话idle cursor69，无运行或排队消息。

这证明unborn小仓库真实采集与比较成功，不代表已提交仓库各类差异、审批基线绑定或完整研发闭环已验收。

## 独立 UI 审查

2026-11-19 git-ux-review只读审查client、Host与存储链，未发现有充分源码证据的重大缺陷。独立执行client-git与git-comparison专项23/23通过，退出码0。覆盖跨change/sequence刷新、失败stale、旧版本/error/partial显示、baseline与requestId缓存绑定、草稿保护及旧envelope兼容。属于源码与处理器测试，不等于完整React/原生输入框端到端验证；Client Inspect超时，审查者未操作实际页面。该轮审查时页面尚不展示比较结果，也不绑定审批基线，已明确引导查看工具返回。

后续已实现已保存观测的页面只读比较：基线与另一条记录双选择，显示四项Changed三态、comparable/reasons/observedEqual/fullWorkspaceEquality及覆盖限制。客户端算法从src/git-comparison.js机械嵌入，仅移除export，测试逐字对照避免语义漂移。跨change与失效选择有保护，读取比较不修改草稿/审批或采集新记录。新增6项专项测试；客户端与Git专项122项中121通过、1项既有Chromium可选测试跳过。父Agent随后执行完整tests/*.test.js（dot reporter）退出码0；真实页面比较验收通过：在上述独立会话工程研发→架构设计中，通过实际下拉控件选择ce1b55ac-d776-4dde-92fd-7d6a7e9be016与7097ab2e-938e-4ccd-a4e7-ab5fab65871a，dl[aria-label="已保存观测比较（只读）"]显示comparable=true、四项Changed=false、reasons=[]、observedEqual=true、fullWorkspaceEquality="not-established"及真实元数据/limitations。新版客户端已加载，无重装/页面刷新。返回父会话后原聊天草稿保留；测试计划仍已保存、revision1/version1。未采集新记录、批准或发送请求。实际验证覆盖中文正常比较，英文/主题切换及异常比较路径尚未逐项实测。

## 后续验收

- 存储：并发去重、原子写、路径/链接检查、损坏记录明确报错、跨工作区隔离。
- Host：重放不执行Git，版本不匹配不绑定基线，错误/取消/partial结果保持可辨识。
- 实际执行：在专用测试仓库覆盖已提交、暂存修改、未暂存修改、未跟踪路径及同路径内容变化；不操作EAP代码。
- UI：展示观测时间、版本、覆盖限制及四项差异；一致用语仅限观测范围。
- 真实链路验证后再更新安装与功能状态；不依据mock测试宣称完整闭环已完成。

## 保留的路径清单（第 81 轮）

观测现在额外保留 `changedPaths`（已跟踪文件的变更路径）与 `untrackedPaths`（未跟踪路径），各自去重排序、上限 2000 条，超过则截断并记录 `changed-paths: lists are capped at 2000 entries`。

- 仍然**不采集文件内容**，也不读 ignored 文件。
- 这两个字段是「可选且成对」的：缺少它们的旧观测照常可读，只是不能用于 `scopeAudit`（返回 `observation_incomplete`）。
- 路径来源是 `git status --porcelain=v2`，因此被 `.dsh/engineering/` 排除规则过滤的条目不会出现。
