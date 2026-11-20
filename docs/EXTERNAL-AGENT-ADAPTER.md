# P2 外部 Agent 适配实施约束

状态：2026-11-20只读调查完成，尚未实现外部派发。运行时DSH 0.2.2-rc.5，工程插件0.3.0。以下结论来自运行时Inspect与安装源码；两个外部包未安装，其具体注册名、配置、权限和Windows清理行为未验证。

## 能力与复用边界

官方目录提供 @deepseek-ai/dsh-subagent-codex@0.2.2-rc.5 与 @deepseek-ai/dsh-subagent-claude-code@0.2.2-rc.5，当时均missing/installed:false/enabled:false。目录可安装不等于运行时可派发。复用ctx.subagents.startActivation与native jobs，不引入另一套SDK或CLI进程管理器。

公开服务有getProvider(name)、registerProvider；没有公开全量backend枚举。维护受支持配置项并逐项getProvider探测，provider-added/provider-removed事件只触发刷新。LLM路由provider与subagent backend是两种概念。

## 实施前必须处理的契约差异

1. 当前本地派发预留childId；没有prepareContinuable的backend拒绝预留ID。外部必须省略childId，收到activation后一次性绑定实际执行ID。
2. agentPreset/agentOptions/outputSchema/maxDepth按provider能力传递。外部权限和模型配置不得假定继承父Session；空agentOptions也会触发能力检查。
3. delivery:'caller'复用工作台结果通道，外部没有本地Session或inbox messageId，不展示虚构子会话链接。
4. cwd继续绑定store workspace root，启动前重验sandboxPolicy根。外部自身权限映射需核实provider实现，现有根检查不等于其所有内部工具受同一权限约束。
5. returned仅表示返回结果，不改变任务状态、验收证据或交付确认。

## 数据迁移方案（待实现）

任务execution纳入规划版本与canonical task snapshot/hash，至少描述backend、local/external、模型策略及经核实的执行配置引用/指纹。配置漂移停止新派发并要求重新评审。工具继续五个参数，执行配置只取已批准任务。

run schema v2区分reservedChildId与backendChildId；后者仅允许绑定一次。记录实际backend、能力快照、cwd及执行配置指纹。保留v1读取与原始hash；历史记录不补默认execution或重算hash。旧任务仍是legacy spawn/current-parent，变更backend走新planVersion。

变更位置：src/core.js、src/dispatch-request.js、src/dispatch-store.js、src/dispatch-runner.js、index.js，以及Client任务编辑、审批展示、运行记录和导出。

## 幂等及清理

先查requestId，再做新请求预检；匹配旧请求即返回旧run，即使provider卸载或Host重启也不自动重发。只有created:true进入启动。

保留job linkage先落盘、独立取消控制器、立即观察result rejection、await dispose后才终态的顺序。dispose失败粘性unknown；unknown持久化失败保留旧active阻塞，不降级成error。

外部启动异常存在特殊盲点：原生startExternalNamed在已启动后的admission失败中尝试dispose，清理再次失败仅warning，调用方只收到原始异常。进入外部startActivation但未收到handle的异常应保守记unknown，不能假设进程已退出。更精确处理需要原生公开机器可读cleanup disposition。此问题针对拟新增外部路径，不代表当前本地spawn已复现同一问题。

人工解除unknown仍需runId/runRevision绑定，并核查child-and-descendants-and-processes；本地Session缺失不是外部进程退出证据。

## 验收清单

- fake external provider不同ID、无messageId、无可选能力：断言spec省略childId/name/agentPreset/agentOptions/maxDepth。
- v1/v2兼容、原hash不变、execution影响新hash、实际ID一次绑定、配置漂移和卸载后幂等。
- 启动无handle异常unknown、ID绑定失败触发dispose、清理失败及unknown写失败仍阻塞。
- provider变更不自动fallback；输出64KiB UTF-8有界；returned不等同验收。
- 真实provider安装配置后，独立验证只读任务、取消清理、重启记录、模型和权限行为。

## 源码依据

安装根 H:/developerTools/ai/DeepseekHarness/resources/app/dsh/node_modules/：

- @deepseek-ai/dsh-subagent/src/index.ts:267：预留childId与本地backend限制。
- @deepseek-ai/dsh-subagent/src/index.ts:543：provider查询及能力校验。
- @deepseek-ai/dsh-subagent/src/manager.ts:429：external admission；:481启动失败清理；:494 cwd处理。
- @deepseek-ai/dsh-subagent/src/out-of-process.ts:50：外部helper默认能力。
- @deepseek-ai/dsh-subagent/src/child-agent.ts:249：本地权限seed，不作为外部权限证据。
- @deepseek-ai/dsh-subagent-spawn-in-process/src/index.ts:32：本地spawn能力。

本轮只完成设计调查，无外部包安装、无外部运行测试、无审批操作。
