# 工程研发插件 · 历史夹具测试计划

> 这份文件是**手动验收清单**。它对应的数据由 `scripts/test-history.mjs` 生成，源文件是 `scripts/test-plan.md`，
> 每次 `--mode seed` 会把它复制到 `.dsh/engineering/TEST-PLAN.md`（复制件不要手改，改源文件）。

数据根：`.dsh/engineering/changes/`（`.dsh/` 已在 `.gitignore` 里，改夹具不影响 git 工作区）。

---

## 0. 为什么要有这套夹具

上一轮会话（`session-41bfa2c7-…`，预设 `ops-ptc`）留下的历史是四份半成品加一个 `git-smoke` 目录：
其中一份 `running` 卡死、一份**缺 manifest.json**、两份早已 `completed`，**没有任何 `requiredApproval` 任务、
没有任何 `awaiting-review` 状态**。也就是说 0.3.0 新加的人工审核门禁、自动完成路径、自动架构图，
在旧历史里**根本点不出来**。

这四份旧历史已整体归档到 `.dsh/engineering/archive/legacy-2026-11-19/`，可 `mv` 原路恢复。

当前 `changes/` 里只有三个夹具，分别对应「对话生成规划 / 自动推进与改任务 / 人工审核门禁 + 自动架构图」。

> ⚠️ **动手之前先做第 7 节的进程/源码时间比对。** 夹具数据谁都能读，但 `requiredApproval` 门禁、
> amendTask 清证据这类**行为**由宿主模块执行；实例跑的是旧 `src/core.js` 时，界面看着对、
> Agent 一请求 `completed` 就绕过门禁。2026-11-20 就踩到了这个。

---

## 1. 夹具清单（首屏预期读数）

| 夹具 | id | 预期状态徽章 | 预期首屏读数 |
| --- | --- | --- | --- |
| A 自动闭环与自动架构图 | `c1000000-0000-4000-8000-000000000001` | 执行中 | 规划完整度 6/6；已完成 1 / 3；A1 已完成(scripts)、A2 验证中(core)、A3 待执行(docs)；架构图 3 节点 2 边 |
| B 人工审核任务停在待人工审核 | `c2000000-0000-4000-8000-000000000002` | 待人工审核 | 规划完整度 6/6；已完成 0 / 2；B1 待人工审核（需人工审批）+「确认完成」按钮；B2 待执行 |
| C 待批准的对话规划 | `c3000000-0000-4000-8000-000000000003` | 草稿 | 规划完整度 6/6；已完成 0 / 2；顶部「评审方案 / 编辑规划」可用 |

---

## 2. 第一层：数据层断言（30 秒，先跑这个）

```bash
node scripts/test-history.mjs --mode check --root "J:\Code\Engineering Planner"
```

预期 `21/21 通过`（`--mode seed` 结束时是 `22/22`，多一条归档断言）。它只读，不改数据。断言覆盖：
列表无 warnings、三 id 齐全、A 的自动完成/amendTask/证据清空/依赖阻塞/门禁非终态/架构图输入、
B1 停在 `awaiting-review` 且 `requiredApproval=true`、C 未批准时报 `APPROVAL_REQUIRED`、三夹具规划 6/6。

失败即说明插件核心行为变了，先别看界面。

---

## 3. 第二层：界面逐项点击清单

**生效方式：只刷新页面**（本轮只改 `.dsh/engineering` 数据，没改插件代码）。
打开 `http://127.0.0.1:57641` → 右侧栏「工程研发」。若右侧栏没开，在侧栏标签里找「工程研发」。
数据是宿主侧读取的，刷新页面会重新拉 `list`；若徽章还是旧值，关闭再打开「工程研发」标签即可（无需重启应用）。

### 3.1 列表

- [ ] 恰好三条，标题以「测试夹具 A/B/C：」开头
- [ ] 状态徽章依次为 `执行中` / `待人工审核` / `草稿`（新增的「待人工审核」徽章是本轮重点）
- [ ] 三条都显示 `方案版本 1`

### 3.2 夹具 A（目的 2 + 目的 4）

- [ ] 「开发规划」tab：规划完整度 **6 / 6**，六项全部「已准备」
- [ ] 面板顶部通知条：「需要你处理 · 2 项送达阻塞」（A2 verifying、A3 pending 都不是终态）
- [ ] `3 任务数 / 3 证据数 / 轻量 规划模式`
- [ ] 「任务看板」tab：`已完成 1 / 3`、`阻塞任务 0`、`当前可开始 0`
- [ ] 分组：`待执行 · 1`（复核并记录结论 / docs）、`验证中 · 1`（实现自动完成路径 / core）、`已完成 · 1`（采集工作区事实 / scripts）
- [ ] 展开 A2「任务详情」：验收标准 **3 条**，且 `验收标准变化会清空该任务证据` 有 2 条证据（说明 amend 后旧证据被清空、新证据重新积累）
- [ ] 「任务依赖图」details 可展开
- [ ] 「架构与设计文档 → Mermaid 图源」：图形预览区渲染出 3 个节点、A1→A2→A3 两条边；A1 绿（done）、A2 蓝（active）、A3 灰（idle）
  - 预览下方提示：「图形预览 · 按任务与依赖自动推导，任务一动就重画；要固定图示就在架构文档里画。」

### 3.3 夹具 B（目的 3，本轮最关键）

- [ ] 徽章 `待人工审核`；规划完整度 **6 / 6**
- [ ] `2 任务数 / 1 证据数 / 标准 规划模式`
- [ ] 「任务看板」：分组 `待执行 · 1`（整理结论文档 / docs）、`待人工审核 · 1`（实现门禁归属（需要人工确认） / core · 需人工审批）
- [ ] 展开 B1「任务详情」：出现 `此刻还不能开始的原因: 任务不在待执行状态 · awaiting-review`
- [ ] 按钮 `确认完成`（只有 B1 这种 `awaiting-review` 且 `requiredApproval` 的任务才有）——**点它**，应变为 `已完成`，变更徽章随之推进
- [ ] 「质量门禁」tab：门禁未就绪，blockers 里能看到 `TASK_NOT_TERMINAL`（`awaiting-review` 不算终态）
- [ ] 架构图里 B1 应是 **review 色**（不是 active、不是 idle）

> 反向验证：在 B1 未完成前，用 Agent 工具请求 `transition → completed` 不会真的完成，
> 会被 `src/core.js:776` 改写回 `awaiting-review`；只有用户点「确认完成」（命令通道以 `user` 身份执行）才直达 `completed`。
>
> ⚠️ 这条**只有在重启过应用之后**才成立。2026-11-20 22:04 的实测发现：运行中的 node 进程启动于 20:01，
> `src/core.js` 改于 21:43，进程加载的是旧模块，Agent 请求 `completed` 直接被写成 `completed`（未改写）。
> 用磁盘代码单独跑 `node scripts/probe-approval-gate.mjs` 输出 `GATE_OK 改写成立`。详见第 7 节。

### 3.4 夹具 C（目的 1）

- [ ] 列表徽章 `草稿`，详情区徽章 `待评审`（两处文案刻意不同，别当成 bug）
- [ ] 面板顶部通知条：「计划待你评审：在工作台确认方案」
- [ ] 顶部按钮 `评审方案` `编辑规划` 可用；规划完整度 **6 / 6**、`2 任务数 / 0 证据数 / 轻量`
- [ ] 「任务看板」：两条 pending（实现批准门禁 / core、记录批准读数 / docs）
- [ ] 点 `评审方案` → `approve` 后状态应为 `已批准 / approved`（这是目的 1 的后半段）
- [ ] 未批准时对 C 的任一任务派发，应被 `APPROVAL_REQUIRED` 挡住

### 3.5 复位（点乱了就重建）

- [ ] 想回到初始读数：`node scripts/test-history.mjs --mode seed --reset --root "J:\Code\Engineering Planner"`
  - 旧夹具会整体移到 `.dsh/engineering/archive/pre-test-<时间戳>/`，可 `mv` 原路恢复
  - seed 结束会自动跑一遍断言并输出 `22/22 通过`

---

## 4. 第三层：真实对话链路（不用夹具，验四个目的串起来）

在会话里直接说需求，观察插件是否：
1. 生成规划 → 我用 `engineering_plan` 落盘（`create` + `save`），六项准备自报到位 → 你在工作台点 `评审方案` 批准；
2. 批准后我按任务派发（`engineering_dispatch`）、验证（`engineering_verify`）、写证据（`evidence`），
   证据齐全且 `requiredApproval=false` 的任务**我自己推进 `completed`**；
3. 途中发现新事实 → 我用 `amendTask` 改任务内容/验收标准，旧证据自动清空、任务退回 `running` 重做；
4. `requiredApproval=true` 的任务我推进到 `awaiting-review` 就停手，徽章变「待人工审核」，等你点 `确认完成`；
5. 架构图随任务状态自动重画，不需要我手写 mermaid 源。

判定：上面五步全绿 = 四个使用目的达成。

### 4.1 2026-11-20 22:04 实测记录（变更 `7f3a1c2e-9b4d-4f6a-8c1e-2d5b7a9c3e11`）

| 步骤 | 结果 | 证据 |
| --- | --- | --- |
| 1 生成规划 → 人工批准 | ✅ | Agent 调 `approve` 被 `ENGINEERING_HUMAN_APPROVAL_REQUIRED` 拦；用户在工作台点「批准当前方案」后 `approvals[0].actor.kind='user'` |
| 2 证据齐全自动完成 | ✅ | R1：running→verifying→`engineering_verify`(exit 0)→2 条 evidence→`completed`，Agent 自行推进 |
| 2b amendTask 改任务 | 未在本链路走到 | A 夹具已造出该形态（验收标准从 2 条变 3 条、旧证据清空、退出 verifying），但那是 seed 数据，不是行为实测 |
| 3 requiredApproval 停在待人工审核 | ✅ **重启后通过** | 2026-11-20 22:10 复测：宿主通道变更 `83383a40-…764b`，Agent 请求 completed 落在 `awaiting-review`（rev 7），人工点「确认完成」后落 `completed`。此前的失败只是因为旧实例未重启 |
| 4 架构图随状态重画 | 图源已验，像素待人眼 | 图源由 `autoArchitectureDiagram` 推导，但 iframe 跨源读不到像素 |

失败原因已定位（非代码缺陷）：运行中的 dsh 进程加载的是 21:43 之前的 `src/core.js`，缺 `src/core.js:776` 的改写；
而 `git show HEAD:src/core.js` 里也没有这行 —— 门禁改写是工作区未提交的新代码。临时 root 直跑
`node scripts/probe-gate-live.mjs --mode temp` → `GATE_OK 门禁生效`。**重启桌面应用后按第 7 节复测第 3 步即可。**

---

## 5. 四个使用目的 × 判定矩阵

| 目的 | 可观测判据 | 夹具 | 失败表征 |
| --- | --- | --- | --- |
| 1 对话生成规划 → 确认 → 自动生成任务 | 草稿 6/6、批准按钮可用、批准后 `approved`、未批准派发被 `APPROVAL_REQUIRED` 挡 | C | 批准按钮灰、批准后仍 draft、未批准也能派发 |
| 2 任务状态自行调整（含改任务内容） | A1 由 Agent 完成；A2 amend 后证据清空并退回重做；A3 依赖阻塞 | A | A2 证据不清空、amend 不写 history、A3 能直接派发 |
| 3 质检门禁归属 | 不需审核→自动 completed；需审核→`awaiting-review` + 工作台「确认完成」；门禁 tab 列 `TASK_NOT_TERMINAL` | A + B | B1 被 Agent 直接标完成、或「确认完成」按钮不出现 |
| 4 架构图自动生成并随任务优化 | 图源由任务与依赖推导，节点数/边数/着色随状态变化（done/active/review/idle） | A + B | 图空、需要手写 mermaid 才显示、着色不随状态变 |

---

## 6. 已知限制

- 架构图预览在 `iframe sandbox` 里渲染，图源经 `postMessage` 传入，**自动化脚本读不到像素**，视觉判定只能人眼（本次已确认预览容器高度 428×420 且无「渲染失败」提示）。
- `.dsh/engineering/archive/legacy-2026-11-19/git-smoke-…/.dsh-meow/memory.db` 曾被进程占用，可能残留空壳目录，与插件无关（插件只读 `changes/`）。

---

## 7. 运行实例 vs 磁盘代码（最重要的一条）

插件的 `client.js` 是页面资源，改完刷新页面就生效；**`index.js` / `src/*.js` 是宿主模块，进程启动时 import 一次，改完必须重启 dsh 桌面应用**。

判断当前实例加载的是哪份代码：

```bash
# 进程启动时间
powershell -NoProfile -Command "Get-Process -Name node | Select-Object Id,StartTime"
# 源码修改时间
ls -l --time-style=full-iso src/core.js index.js
```

源码 mtime 晚于进程 StartTime = 进程跑的是旧代码，此时工作台/Agent 工具的行为会与源码不一致。

2026-11-20 的实例：node PID 35304 启动 `20:01:45`，`src/core.js` 改于 `21:43:54` → 旧代码，缺门禁改写。

### 重启后复测清单（3 分钟）

1. 重启 dsh 桌面应用（关闭后重新打开），确认 `http://127.0.0.1:<新端口>` 可用。
2. `node scripts/probe-gate-live.mjs --mode temp` —— 只验磁盘代码，应输出 `GATE_OK 门禁生效`。
3. 界面上选「门禁复测：人工审核任务」→ `评审方案` → `批准当前方案`。
4. `node scripts/probe-gate-live.mjs --mode probe` —— 输出 `G1 = awaiting-review` + `GATE_OK` = 新代码生效；
   输出 `G1 = completed` + `GATE_BROKEN` = 仍是旧模块（没重启干净，或端口连的是别的实例）。
5. 回工作台点 G1 的「确认完成」，应变 `已完成`；change 徽章同步推进。
6. 若第 4 步拿到 `GATE_BROKEN`，说明这一步不能靠数据夹具绕过——**门禁是宿主行为**，必须重启。

### 已经被旧实例写脏的样本

- 变更 `7f3a1c2e-9b4d-4f6a-8c1e-2d5b7a9c3e11`「真实链路验证：夹具摘要工具」的 R3 被旧代码直接写成 `completed`，
  change 也变 `completed`（`completed: []` 无出边，改不回来）。留着它作为「旧实例行为」的证据；重建夹具时会被一起归档。
- 变更 `d3000000-0000-4000-8000-000000000004`「门禁复测：人工审核任务」是专用探针样本，批准后跑 `--mode probe` 用；
  跑脏了就重建：`rm -rf .dsh/engineering/changes/d3000000-0000-4000-8000-000000000004` 再 `--mode setup`。
