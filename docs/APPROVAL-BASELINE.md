# 可选审批代码基线

状态：核心、人工审批选择及摘要已实现，0.3.0通过plugin_manager重新安装，返回application=applied、enabled=true。核心相关116/116通过；全部Client测试52通过、0失败、1项既有可选Chromium跳过；父Agent完整tests/*.test.js使用dot reporter退出码0。真实engineering_plan approvalBaselineStatus读取standard测试计划511370f8-7448-4bb9-9071-78bdb771cafb，返回revision3/planVersion1/no_approval，未修改状态。真实页面只读选择验收通过：在session-1b48ad24-1179-497e-9eee-13b790ca2ce6的变更725825b0-ac48-4835-91a7-099a136d94f2（revision1/version1）中，默认无基线；刷新后出现两条真实ok观测且不自动选中。选择ce1b55ac-d776-4dde-92fd-7d6a7e9be016后显示dirty/unborn、scope和完整limitations，以及历史观测非完整工作区证明等提示。未点击批准，随后清除临时选择并返回父会话，原聊天草稿逐字保留。真实人工批准绑定、写入后摘要、归档历史和后续漂移正向验收尚未完成。

## 独立审查（2026-11-20）

baseline-final-review恢复并完成中断审查，核对当前core/client哈希与此前一致，未发现有充分证据的重大bug。补跑client-git、git-tool、git-collector共55项，全部通过；此前58项为2026-11-19历史执行。审查确认权限/descriptor、CAS与归档、legacy、root、三态及异步刷新保护。只读状态不重写state/observation，但通用execute仍有瞬时锁文件操作，不是零文件系统写入。

随后审批卡已增加显式approvalBaselineStatus只读查询，展示六态、四项比较三态、修订匹配与覆盖限制；请求绑定change/revision/version、列表实例及序号，旧响应失效，失败清除旧成功。客户端61项通过、1可选Chromium跳过。父完整回归发现旧并发测试错误假定批准先于保存获得锁，已修正允许任一合法赢家，并独立验证批准后stale-save失败且state字节不变；修正后完整tests/*.test.js dot退出码0。真实页面新查询验收通过：标准夹具511370f8-7448-4bb9-9071-78bdb771cafb保持revision3/version1/draft，初始没有自动请求；点击查询后DOM显示no_approval、currentObservationId=null、currentObservationMatchesRevision=null、reasons=["No current user approval"]。刷新列表后旧结果清除，恢复未查询提示。规划输入逐项不变，聊天草稿本轮开始和结束均为空，未批准/保存/发送或创建数据。新版入口已在运行页面加载，无重装或整页刷新。实际覆盖仅no_approval，其余unbound/not_checked/observed_equal/observed_drift/unknown仍只有自动化回归，待真实批准夹具验证。真实采集→人工批准绑定→写后摘要→再次采集→漂移展示完整正向仍待验，模拟shell/command测试不替代该链路。

## 绑定契约

人工 approve 可选携带 baselineObservationId 与 planVersion；未选择时兼容既有批准流程。绑定读取本工作区真实不可变 Git 观测，要求同 change、批准前 revision、planVersion，且 status=ok。dirty 与 unborn 不阻止选择；非 Git 项目不增加 Git 前置要求。

审批与绑定在同一 change 锁和一次 state 原子写中提交。approval.sourceRevision 表示批准前修订，approval.approvalRevision 表示批准写入后的修订；二者不同是正常情况。codeBaseline 放在审批记录内部，包含观测 ID 与版本定位，不接受客户端自填摘要、actor 或成功状态。

已批准方案修改或重新规划时，旧审批及基线随 snapshot 归档，当前 approvals 清空；历史观测不删除。旧版无基线字段的审批保持原含义，不推断或补选基线。

## 只读状态

approvalBaselineStatus 仅读取当前审批及显式指定的后续观测，不自动采集或挑选最近相等记录。状态区分 no_approval、unbound、not_checked、observed_equal、observed_drift、unknown。比较沿用现有 compareGitObservations 三态语义，保留 reasons、limitations 与 fullWorkspaceEquality=not-established。

代码漂移提示不自动撤销批准、不修改任务或验收证据，也不宣称独立验收通过。currentObservationMatchesRevision 只表示规划修订匹配，无法证明采样后的工作区未变化。缺失或损坏基线必须明确报错。

## UI 与验收要求

审批专用选择与历史比较选择相互独立，默认无基线。change/revision/planVersion 变化后清理选择。选中绑定时，加载中、过期或错误列表阻止提交；未选时不增加 Git 门槛。显示采样时间、dirty、HEAD/unborn 与覆盖限制。

应验证人工入口隔离、精确参数、CAS并发、失败不写、非ok/跨版本/跨修订/跨根阻断、legacy兼容、重新规划归档、读取前后字节一致及客户端选择生命周期。自动测试不替代真实人工批准和后续漂移展示验收。
