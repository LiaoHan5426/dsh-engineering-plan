window.__ModuleLoader__.load({
  id: "@local/dsh-engineering-planner",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const NS = "engineering-planner";
    const words = {
      replan: ["重新规划", "Replan"],
      replanConfirm: ["确认重新规划", "Confirm replanning"],
      replanHint: [
        "重新规划会归档当前版本并重置任务状态、审批与证据。确认后再编辑新方案。",
        "Replanning archives this version and resets task statuses, approvals, and evidence. Confirm to edit a new plan.",
      ],
      locked: [
        "执行期间方案已锁定；结束运行或验证中的任务后，可重新规划。",
        "The plan is locked during execution. Finish running or verifying tasks before replanning.",
      ],
      listWarnings: ["部分变更读取失败", "Some changes could not be read"],
      title: ["工程规划", "Engineering planner"],
      changes: ["变更", "Changes"],
      newChange: ["新建变更", "New change"],
      name: ["标题", "Title"],
      goal: ["目标", "Goal"],
      mode: ["规划模式", "Planning mode"],
      lite: ["轻量", "Lite"],
      standard: ["标准", "Standard"],
      create: ["创建", "Create"],
      refreshList: ["刷新列表", "Refresh list"],
      emptyList: [
        "尚无变更。填写标题与目标，创建第一份工程计划。",
        "No changes yet. Enter a title and goal to create your first plan.",
      ],
      selectChange: [
        "选择或创建变更，逐步完善方案、任务和验收证据。",
        "Select or create a change to develop a plan, tasks, and acceptance evidence.",
      ],
      overview: ["概览", "Overview"],
      plan: ["方案", "Plan"],
      tasks: ["任务", "Tasks"],
      resources: ["证据与资料", "Evidence & references"],
      save: ["保存草稿", "Save draft"],
      refresh: ["重新加载", "Reload"],
      approve: ["批准当前方案", "Approve current plan"],
      approved: ["当前方案已批准", "Current plan approved"],
      approvalRequired: [
        "运行前需批准当前方案。修改规划内容会使原审批失效。",
        "Approve the current plan before running. Editing the plan invalidates its approval.",
      ],
      saved: ["已保存", "Saved"],
      unsaved: ["有未保存编辑", "Unsaved edits"],
      busy: ["处理中…", "Working…"],
      revision: ["修订", "Revision"],
      planVersion: ["方案版本", "Plan version"],
      status: ["状态", "Status"],
      context: ["恢复上下文", "Recovery context"],
      export: ["导出 Markdown", "Export Markdown"],
      agent: ["复制「让 Agent 完善方案」提示", "Copy “Ask agent to refine plan” prompt"],
      agentHint: [
        "此按钮仅复制提示；粘贴到对话并发送后，Agent 才会处理。",
        "This button only copies a prompt. Paste and send it in chat for the agent to act.",
      ],
      savedOnly: ["上下文和导出使用已保存版本。", "Context and exports use the saved version."],
      copy: ["复制", "Copy"],
      copied: ["已复制", "Copied"],
      copyFailed: [
        "复制失败，请手动选择下方文本复制。",
        "Copy failed. Select and copy the text below manually.",
      ],
      result: ["操作结果", "Result"],
      discard: ["放弃草稿并继续", "Discard draft and continue"],
      keep: ["保留草稿", "Keep draft"],
      discardHint: [
        "此操作会替换当前未保存的编辑。请先保存，或明确放弃草稿。",
        "This action replaces unsaved edits. Save first, or explicitly discard the draft.",
      ],
      missingSession: ["请先打开一个会话。", "Open a session first."],
      invalidResponse: ["命令返回格式异常。", "Unexpected command response."],
      operationFailed: ["操作失败。", "Operation failed."],
      conflictHint: [
        "草稿已保留。若是版本冲突，可先复制草稿，再重新加载并合并修改。",
        "Your draft is preserved. For a revision conflict, copy the draft before reloading and merging changes.",
      ],
      copyDraft: ["复制草稿备份", "Copy draft backup"],
      proposal: ["提案", "Proposal"],
      requirements: ["需求", "Requirements"],
      architecture: ["架构", "Architecture"],
      implementation: ["实现方案", "Implementation"],
      "impact-analysis": ["影响分析", "Impact analysis"],
      acceptance: ["验收方案", "Acceptance"],
      decisions: ["决策记录", "Decisions"],
      findings: ["发现记录", "Findings"],
      diagrams: ["Mermaid 图源", "Mermaid sources"],
      diagramHint: [
        "编辑图源，导出后可由 Markdown 阅读器渲染；任务依赖在任务页展示。",
        "Edit Mermaid sources for rendering in an exported Markdown reader. Task dependencies appear in Tasks.",
      ],
      sequence: ["时序图", "Sequence diagram"],
      "data-flow": ["数据流图", "Data flow diagram"],
      addTask: ["添加任务", "Add task"],
      edit: ["编辑", "Edit"],
      remove: ["移除", "Remove"],
      taskId: ["任务 ID", "Task ID"],
      description: ["说明", "Description"],
      dependencies: [
        "依赖任务 ID（逗号或换行分隔）",
        "Dependency IDs (comma or newline separated)",
      ],
      expectedFiles: ["预期文件（每行一项）", "Expected files (one per line)"],
      acceptanceCriteria: ["验收标准（每行一项）", "Acceptance criteria (one per line)"],
      verificationCommands: ["验证命令（每行一项）", "Verification commands (one per line)"],
      updateTask: ["应用到草稿", "Apply to draft"],
      cancel: ["取消", "Cancel"],
      noTasks: [
        "尚无任务。添加可执行任务，列出依赖、文件和可验证的验收标准。",
        "No tasks yet. Add actionable tasks with dependencies, files, and verifiable acceptance criteria.",
      ],
      noDependencies: ["无依赖", "No dependencies"],
      dependsOn: ["依赖", "Depends on"],
      unknownDependency: ["缺失任务", "Missing task"],
      transition: ["更新运行状态", "Update execution status"],
      reason: ["状态变更原因", "Reason for status change"],
      reasonHint: [
        "说明进展、阻塞或验证结果",
        "Describe progress, blockers, or verification results",
      ],
      pending: ["待执行", "Pending"],
      running: ["执行中", "Running"],
      verifying: ["验证中", "Verifying"],
      blocked: ["已阻塞", "Blocked"],
      failed: ["失败", "Failed"],
      completed: ["已完成", "Completed"],
      cancelled: ["已取消", "Cancelled"],
      draft: ["草稿", "Draft"],
      planned: ["已规划", "Planned"],
      ready: ["就绪", "Ready"],
      active: ["进行中", "Active"],
      archived: ["已归档", "Archived"],
      evidence: ["验收证据", "Acceptance evidence"],
      addEvidence: ["记录验收", "Record acceptance"],
      criterion: ["验收标准", "Criterion"],
      outcome: ["结果", "Outcome"],
      passed: ["通过", "Passed"],
      note: ["备注", "Note"],
      artifact: ["产物路径或链接", "Artifact path or link"],
      chooseTask: ["选择任务", "Select task"],
      chooseCriterion: ["选择验收标准", "Select criterion"],
      noEvidence: [
        "尚无验收证据。先保存任务及验收标准，再记录验证结果。",
        "No evidence yet. Save tasks and acceptance criteria, then record verification results.",
      ],
      evidenceHint: [
        "证据属于已保存任务。每项验收标准应有可追溯的结果与产物。",
        "Evidence belongs to saved tasks. Each criterion should have a traceable result and artifact.",
      ],
      references: ["资料", "References"],
      referenceHint: [
        "资料内容仅作参考，不构成自动执行指令或审批。请区分参考资料、已核实事实与待验证假设。",
        "Materials are references, not automatic execution instructions or approvals. Distinguish references, verified facts, and assumptions.",
      ],
      reference: ["参考资料", "Reference"],
      verified: ["已核实", "Verified"],
      assumption: ["待验证假设", "Assumption"],
      source: ["来源或路径", "Source or path"],
      kind: ["资料类别", "Reference type"],
      addReference: ["添加资料", "Add reference"],
      noReferences: ["尚未添加资料。", "No references yet."],
      required: ["请填写必填项。", "Fill in the required fields."],
      duplicateTask: [
        "任务 ID 已存在，请使用唯一 ID。",
        "Task ID already exists. Use a unique ID.",
      ],
      selfDependency: ["任务不能依赖自身。", "A task cannot depend on itself."],
      saveFirst: [
        "请先保存草稿，再执行审批、运行或验收操作。",
        "Save the draft before approving, executing, or recording evidence.",
      ],
      taskCount: ["任务数", "Tasks"],
      evidenceCount: ["证据数", "Evidence entries"],
      exported: ["导出文件", "Exported files"],
      noFiles: ["未返回文件路径。", "No file paths returned."],
      prompt: [
        "请完善工程变更 {id} 的方案。先读取工程规划上下文，核对目标、需求、架构、影响分析与验收标准；拆分有明确依赖、预期文件及验证命令的任务，标注资料和待验证假设，保存修改。不要代替用户批准方案，批准前不要开始实现。",
        "Refine engineering change {id}. Read its planning context first, verify the goal, requirements, architecture, impact, and acceptance criteria; create tasks with dependencies, expected files, and verification commands. Label references and assumptions, and save the changes. Do not approve on behalf of the user or begin implementation before approval.",
      ],
    };
    Object.assign(words, {
      fillChat: ["填入会话", "Insert into chat"],
      fillHint: [
        "仅填入会话草稿，保留已有输入；检查后由你发送，不自动开始任务。",
        "Inserts into the existing chat draft. Review and send it yourself; tasks do not start automatically.",
      ],
      insertionConflict: [
        "会话输入发生冲突，请回到会话确认当前草稿后重试。",
        "The chat draft changed. Review the current draft in chat and retry.",
      ],
      inputUnavailable: [
        "当前视图未连接会话输入，请使用复制提示。",
        "Chat input is not connected to this view. Use the copy prompt action.",
      ],
      requestPlan: ["规划请求", "Planning request"],
      requestTask: ["任务实施请求", "Task implementation request"],
      requestVerify: ["质量验证请求", "Quality verification request"],
      planRequest: [
        "加载 engineering-planning skill。使用 engineering_plan get/context 读取变更 {id}；本请求基于方案版本 {version}、修订 {revision}，先核对最新状态，若已变化说明差异并重新读取。核实源码与需求，完善六项显式 planning 准备状态、评审要求、架构、依赖任务和验收标准，区分参考资料/事实/假设。保存草稿供用户评审，不代替用户批准或开始实施。",
        "Load the engineering-planning skill. Read change {id} using engineering_plan get/context. This request is based on plan version {version}, revision {revision}; check the latest state and re-read/report differences if it changed. Inspect source and requirements, refine the six explicit planning readiness sections, review requirements, architecture, dependent tasks and acceptance criteria. Distinguish references, facts and assumptions. Save a draft for human review without approving or starting implementation.",
      ],
      taskRequest: [
        "使用 engineering_plan get/context 读取变更 {id}，处理任务 {taskId}。本请求基于方案版本 {version}、修订 {revision}；先核对最新版本、当前用户审批、任务状态、前置依赖及文件冲突。版本不一致时先说明差异；审批或依赖未满足时报告阻塞。满足条件后使用 DSH 原生工具实施任务，按真实进展调用 transition，不把本请求或填入动作视为已开始。完成实现后进入 verifying，并保留实际修改与验证记录。",
        "Read change {id} with engineering_plan get/context and work on task {taskId}. This request is based on plan version {version}, revision {revision}. First check latest versions, current human approval, task status, prerequisite dependencies and file conflicts. Report version differences or unmet approval/dependencies. When conditions are met, implement with native DSH tools and update transitions according to actual progress; this request or insertion does not itself start the task. Enter verifying after implementation and retain actual changes and verification records.",
      ],
      verifyRequest: [
        "使用 engineering_plan get/context 读取变更 {id}，验证任务 {taskId}。本请求基于方案版本 {version}、修订 {revision}；先核对当前审批、版本、依赖与 verifying 状态。按每项 acceptanceCriteria 和 verificationCommands 执行实际检查，记录真实命令、退出码、关键输出与产物；逐项 evidence 使用当前版本及实际 passed/failed 结果。未执行的检查明确标记未验证，不虚构自动验收或独立验证。仅在所有当前标准的最新证据通过后尝试 completed。",
        "Read change {id} with engineering_plan get/context and verify task {taskId}. This request is based on plan version {version}, revision {revision}; first check current approval, versions, dependencies and verifying status. Run actual checks for each acceptanceCriteria and verificationCommands; record real commands, exit codes, relevant output and artifacts. Submit criterion evidence for the current version with actual passed/failed outcomes. Mark checks not run as unverified; do not claim automatic acceptance or independent verification. Attempt completed only after the latest evidence passes every current criterion.",
      ],
      title: ["工程研发工作台", "Engineering workbench"],
      entry: ["工程研发", "Engineering"],
      overview: ["开发规划", "Development planning"],
      plan: ["架构设计", "Architecture design"],
      tasks: ["任务看板", "Task board"],
      resources: ["质量门禁", "Quality gates"],
      implementation: ["接口与数据库设计 / 实现方案", "Interfaces, database & implementation"],
      stages: ["规划 → 评审批准 → 执行 → 验收", "Plan → Review & approve → Execute → Accept"],
      nextDraft: [
        "下一步：完善六项准备状态、任务和验收标准，保存后交由用户评审批准。",
        "Next: complete readiness, tasks and criteria, save, then request user review and approval.",
      ],
      nextApproved: [
        "下一步：在任务看板选择任务，由 Agent 使用 DSH 工具执行并更新运行状态。",
        "Next: select a task on the board; the agent executes with DSH tools and updates its status.",
      ],
      nextRunning: [
        "下一步：跟踪任务阻塞；进入验证后在质量门禁记录实际验收证据。",
        "Next: track blockers, then record actual evidence in Quality gates when verifying.",
      ],
      nextComplete: [
        "当前任务流程已结束。可检查质量证据并导出；新一轮修改请重新规划。",
        "The task flow is finished. Review evidence and export, or replan for another iteration.",
      ],
      completeness: ["规划完整度", "Planning readiness"],
      readinessHint: [
        "状态由规划作者明确标记，代表准备情况；不代表测试或独立验收通过。",
        "Readiness is explicitly declared by the plan author, not a test or independent verification result.",
      ],
      reviewRequirements: ["评审要求", "Review requirements"],
      analysis: ["代码分析", "Code analysis"],
      interfaces: ["接口与数据库设计", "Interfaces & database"],
      readinessPending: ["待准备", "Pending"],
      readinessReady: ["已准备", "Ready"],
      readyCount: ["已准备项目", "Ready sections"],
      matrix: ["逐项验收证据矩阵", "Acceptance evidence matrix"],
      missingEvidence: ["缺少当前版本证据", "No current-version evidence"],
      noCriteria: ["尚未配置验收标准", "No acceptance criteria configured"],
      evidenceTruth: [
        "展示当前方案版本的最新记录。结果来自记录者的报告，工作台未自动执行检查或独立验证。",
        "Shows the latest record for this plan version. Results are attributed reports; the workbench does not run checks or independently verify them.",
      ],
      recorder: ["记录者", "Recorded by"],
      recordedAt: ["记录时间", "Recorded at"],
      history: ["全部证据记录", "All evidence records"],
      dependencyMap: ["任务依赖图", "Task dependency map"],
      dependencyHint: [
        "箭头从前置任务指向依赖它的任务，基于当前草稿。此图不代表模块架构。",
        "Arrows run from prerequisites to dependent tasks in the current draft. This is not a module architecture diagram.",
      ],
      sourceOnly: [
        "架构、时序和数据流为 Mermaid 图源码编辑；当前未内置 Mermaid 渲染器。",
        "Architecture, sequence and data flow are editable Mermaid sources; an inline Mermaid renderer is not included.",
      ],
      emptyPlanning: [
        "先创建或选择变更，再填写六项规划准备状态和评审要求。",
        "Create or select a change to edit six readiness sections and review requirements.",
      ],
      emptyArchitecture: [
        "选择变更后编辑架构、接口数据库、影响分析、ADR 和图源码。",
        "Select a change to edit architecture, interfaces, database, impact, ADRs and diagram sources.",
      ],
      emptyTasks: [
        "选择变更后按真实运行状态查看任务看板、依赖与阻塞。",
        "Select a change to view the task board, dependencies and blockers by actual status.",
      ],
      emptyQuality: [
        "选择变更后逐项查看任务验收标准与最新证据。",
        "Select a change to inspect acceptance criteria and latest evidence.",
      ],
    });
    const sectionKeys = [
      "requirements",
      "analysis",
      "architecture",
      "interfaces",
      "tasks",
      "acceptance",
    ];
    const planningDefaults = (planning) => ({
      reviewRequirements: planning?.reviewRequirements || "",
      sections: Object.fromEntries(
        sectionKeys.map((key) => [
          key,
          {
            status: planning?.sections?.[key]?.status === "ready" ? "ready" : "pending",
            note: planning?.sections?.[key]?.note || "",
          },
        ]),
      ),
    });
    const statuses = [
      "pending",
      "running",
      "verifying",
      "blocked",
      "failed",
      "completed",
      "cancelled",
    ];
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const lines = (value) =>
      String(value || "")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
    const normalize = (value) => ({
      ...value,
      planning: planningDefaults(value.planning),
      documents: value.documents || {},
      diagrams: value.diagrams || {},
      tasks: value.tasks || [],
      references: value.references || [],
      approvals: value.approvals || [],
      evidence: value.evidence || [],
    });
    const css = `
.ep{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:auto}
.ep *{box-sizing:border-box}
.ep-layout{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:0;flex:1}
.ep-side{padding:16px;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;background:var(--dsw-alias-bg-layer-1)}
.ep-main{padding:20px;min-width:0;overflow:auto}
.ep h2{font-size:18px;margin:0 0 12px}
.ep h3{font-size:14px;margin:0 0 10px}
.ep p{margin:8px 0}
.ep label{display:flex;flex-direction:column;gap:5px;margin:10px 0}
.ep input,.ep textarea,.ep select{width:100%;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px;min-width:0}
.ep textarea{resize:vertical;min-height:90px}
.ep textarea.ep-document{min-height:220px;font-family:inherit}
.ep button{font:inherit;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 10px;cursor:pointer;min-height:32px}
.ep button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.ep button:disabled{opacity:.5;cursor:default}
.ep :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ep .ep-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.ep .ep-selected{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.ep-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ep-between{justify-content:space-between}
.ep-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
.ep-card{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin:12px 0;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}
.ep-list{display:flex;flex-direction:column;gap:8px;margin:14px 0}
.ep-list button{text-align:left;overflow-wrap:anywhere}
.ep-list small{display:block;color:var(--dsw-alias-label-secondary)}
.ep-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:16px}
.ep-badge{display:inline-block;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:2px 7px;font-size:12px}
.ep-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.ep-success{color:var(--dsw-alias-state-success-primary)}
.ep-warn{color:var(--dsw-alias-state-warn-primary)}
.ep-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}
.ep-full{grid-column:1/-1}
.ep-empty{padding:28px 12px;color:var(--dsw-alias-label-secondary)}
.ep pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:360px;overflow:auto}
.ep ul{padding-left:20px}
.ep code{overflow-wrap:anywhere}
.ep details{margin:10px 0}
.ep summary{cursor:pointer}
.ep-output{min-height:160px!important;font-family:monospace!important}
.ep fieldset{border:0;padding:0;margin:0;min-width:0}
.ep-stats{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0}
.ep-stats strong{display:block;font-size:22px}
.ep-section{margin-top:20px}
@media(max-width:850px){.ep-layout{grid-template-columns:210px minmax(0,1fr)}
.ep-main{padding:14px}
.ep-grid{grid-template-columns:1fr}
}
@media(max-width:620px){.ep-layout{display:flex;flex-direction:column}
.ep-side{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:360px;overflow:auto}
.ep-main{overflow:visible}
.ep-tabs button{flex:1}
.ep-grid{display:block}
}

`;
    const viewCss = `
.ep-board{display:grid;grid-template-columns:repeat(7,minmax(240px,1fr));gap:12px;overflow-x:auto;align-items:start;padding:12px 0}
.ep-column{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px;min-height:180px}
.ep-column .ep-card{margin:10px 0;padding:10px}
.ep-column-title{position:sticky;top:0;padding:4px 0}
.ep-readiness{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.ep-readiness-item{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:8px 12px}
.ep-table-scroll,.ep-diagram{overflow:auto;max-height:600px}
.ep-matrix{width:100%;border-collapse:collapse;min-width:800px;font-size:12px}
.ep-matrix th,.ep-matrix td{padding:10px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;overflow-wrap:anywhere;max-width:280px}
.ep-matrix small{display:block;color:var(--dsw-alias-label-secondary)}
.ep-stage{padding:10px 12px;border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
@media(max-width:850px){.ep-readiness{grid-template-columns:1fr}}
`;
    return {
      inject: ["slots", "locale", "remote", "remote.commands"],
      apply(ctx) {
        for (const [language, index] of [
          ["zh", 0],
          ["en", 1],
        ])
          ctx.effect(() =>
            ctx.locale.register(
              NS,
              language,
              Object.fromEntries(Object.entries(words).map(([key, pair]) => [key, pair[index]])),
            ),
          );
        const t = ctx.locale.bind(NS);
        const draftCache = new Map();
        ctx.effect(() => () => draftCache.clear());
        const graph = {
          pending: ["running", "blocked", "cancelled"],
          running: ["verifying", "blocked", "failed", "cancelled"],
          verifying: ["running", "blocked", "failed", "completed", "cancelled"],
          blocked: ["pending", "running", "cancelled"],
          failed: ["pending", "running", "cancelled"],
          completed: [],
          cancelled: ["pending"],
        };
        function Workbench(props) {
          return h(Panel, { ...props, key: props.sessionId || "none" });
        }
        function Panel(props) {
          React.useSyncExternalStore(
            (fn) => ctx.locale.subscribe(fn),
            () => ctx.locale.getSnapshot(),
          );
          const restored = React.useRef(draftCache.get(props.sessionId));
          const [changes, setChanges] = React.useState([]);
          const [warnings, setWarnings] = React.useState([]);
          const [replanConfirm, setReplanConfirm] = React.useState(false);
          const [change, setChange] = React.useState(null);
          const [draft, setDraft] = React.useState(null);
          const [dirty, setDirty] = React.useState(false);
          const [busy, setBusy] = React.useState(false);
          const lock = React.useRef(false);
          const mounted = React.useRef(true);
          const [error, setError] = React.useState("");
          const [notice, setNotice] = React.useState("");
          const [tab, setTab] = React.useState("overview");
          const [creation, setCreation] = React.useState({ title: "", goal: "", mode: "lite" });
          const [pending, setPending] = React.useState(null);
          const [taskEdit, setTaskEdit] = React.useState(null);
          const [requestTaskId, setRequestTaskId] = React.useState("");
          const [output, setOutput] = React.useState(null);
          const [transition, setTransition] = React.useState({
            taskId: "",
            status: "running",
            reason: "",
          });
          const [evidence, setEvidence] = React.useState({
            taskId: "",
            criterion: "",
            outcome: "passed",
            note: "",
            artifact: "",
          });
          const [reference, setReference] = React.useState({
            title: "",
            source: "",
            kind: "reference",
            note: "",
          });
          const textStatus = (value) => (words[value] ? t(value) : String(value || ""));
          const approved =
            !!change &&
            change.approvals.some(
              (a) => a.planVersion === change.planVersion && a.actor?.kind === "user",
            );
          const editable = !change || ["draft", "approved"].includes(change.status);
          const referenceDirty = !!(reference.title || reference.source || reference.note);
          const unsettled = dirty || !!taskEdit || referenceDirty;
          const transitionDirty = !!(transition.taskId || transition.reason);
          const evidenceDirty = !!(evidence.taskId || evidence.criterion || evidence.note || evidence.artifact);
          const runtimeDirty = transitionDirty || evidenceDirty;
          const edit = (patch) => {
            if (busy || !editable) return;
            setDraft((current) => ({ ...current, ...patch }));
            setDirty(true);
          };
          React.useEffect(() => {
            if (restored.current) {
              const cached = restored.current;
              setChange(cached.change);
              setDraft(cached.draft);
              setDirty(cached.dirty);
              setTaskEdit(cached.taskEdit);
              setReference(cached.reference);
              if (cached.transition) setTransition(cached.transition);
              if (cached.evidence) setEvidence(cached.evidence);
              restored.current = null;
            }
          }, []);
          React.useEffect(() => {
            if (change)
              draftCache.set(props.sessionId, { change, draft, dirty, taskEdit, reference, transition, evidence });
          }, [change, draft, dirty, taskEdit, reference, transition, evidence]);
          const loadChange = (value, { preserveRuntime = false, submitted = '' } = {}) => {
            const next = normalize(value);
            setChange(next);
            setDraft(clone(next));
            setDirty(false);
            setTaskEdit(null);
            setReference({ title: "", source: "", kind: "reference", note: "" });
            setReplanConfirm(false);
            setRequestTaskId("");
            setOutput(null);
            if (!preserveRuntime || submitted === 'transition')
              setTransition({ taskId: "", status: "running", reason: "" });
            if (!preserveRuntime || submitted === 'evidence')
              setEvidence({ taskId: "", criterion: "", outcome: "passed", note: "", artifact: "" });
          };
          async function command(input) {
            if (!props.sessionId) throw new Error(t("missingSession"));
            const envelope = await ctx.remote.commands.execute(
              props.sessionId,
              "/engineering " + JSON.stringify(input),
              [],
            );
            if (!envelope || !envelope.ok)
              throw new Error(envelope?.error?.message || envelope?.error || t("operationFailed"));
            const result = envelope.value?.result;
            if (!result || !["success", "error"].includes(result.kind))
              throw new Error(t("invalidResponse"));
            let data;
            try {
              data = JSON.parse(result.text);
            } catch (_) {
              throw new Error(result.kind === "error" ? result.text : t("invalidResponse"));
            }
            if (result.kind === "error")
              throw new Error(data.error?.message || data.error || data.message || result.text);
            return data;
          }
          async function run(action) {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await action();
            } catch (cause) {
              if (mounted.current) setError(String(cause?.message || cause));
            } finally {
              lock.current = false;
              if (mounted.current) setBusy(false);
            }
          }
          async function list() {
            const data = await command({ action: "list" });
            if (mounted.current) {
              setChanges(data.changes || []);
              setWarnings(data.warnings || []);
            }
          }
          React.useEffect(() => {
            mounted.current = true;
            run(list);
            return () => {
              mounted.current = false;
            };
          }, []);
          async function get(id) {
            const data = await command({ action: "get", changeId: id });
            if (mounted.current) loadChange(data.change);
          }
          function guarded(action) {
            if (unsettled || runtimeDirty) setPending(() => action);
            else run(action);
          }
          async function mutate(action, extra) {
            if (unsettled) throw new Error(t("saveFirst"));
            const data = await command({
              action,
              changeId: change.id,
              expectedRevision: change.revision,
              ...extra,
            });
            if (mounted.current) {
              loadChange(data.change, { preserveRuntime: true, submitted: action });
              setNotice(t("saved"));
            }
            await list();
          }
          async function copy(text) {
            setOutput({ title: t("result"), text });
            try {
              await navigator.clipboard.writeText(text);
              setNotice(t("copied"));
            } catch (_) {
              setError(t("copyFailed"));
            }
          }
          function requestText(kind, taskId = "") {
            return t(kind + "Request", {
              id: change.id,
              taskId,
              version: change.planVersion,
              revision: change.revision,
            });
          }
          function fillRequest(kind, taskId = "") {
            if (busy || unsettled || !change) return;
            if (kind !== "plan" && !change.tasks.some((task) => task.id === taskId)) return;
            const actions = props.inputActions;
            if (
              !actions?.captureInsertion ||
              !actions?.insertText ||
              !actions?.persistDraft ||
              !props.openView
            ) {
              setError(t("inputUnavailable"));
              return;
            }
            try {
              const text = "\n" + requestText(kind, taskId) + "\n";
              const span = actions.captureInsertion();
              if (!actions.insertText(text, span)) {
                setError(t("insertionConflict"));
                return;
              }
              actions.persistDraft();
              props.openView("chat", "");
            } catch (cause) {
              setError(String(cause?.message || cause));
            }
          }
          function requestControls(kind, taskId = "") {
            return h(
              "div",
              { className: "ep-section" },
              h(
                "div",
                { className: "ep-row" },
                h(
                  "strong",
                  null,
                  t(
                    kind === "plan"
                      ? "requestPlan"
                      : kind === "task"
                        ? "requestTask"
                        : "requestVerify",
                  ),
                ),
                button(
                  "fillChat",
                  () => fillRequest(kind, taskId),
                  unsettled ||
                    (kind !== "plan" && !change.tasks.some((task) => task.id === taskId)),
                ),
                button(
                  "copy",
                  () => copy(requestText(kind, taskId)),
                  unsettled ||
                    (kind !== "plan" && !change.tasks.some((task) => task.id === taskId)),
                ),
              ),
              h("p", { className: "ep-muted" }, t(unsettled ? "saveFirst" : "fillHint")),
            );
          }
          function button(label, onClick, disabled, primary, extra) {
            return h(
              "button",
              {
                type: "button",
                onClick,
                disabled:
                  busy ||
                  disabled ||
                  (!editable && ["save", "addTask", "edit", "remove"].includes(label)),
                className: primary ? "ep-primary" : "",
                ...extra,
              },
              t(label),
            );
          }
          function field(label, value, onChange, options = {}) {
            const { multiline, choices, className, ...rest } = options;
            if (rest.disabled === undefined) rest.disabled = busy;
            return h(
              "label",
              { className },
              h("span", null, t(label)),
              choices
                ? h(
                    "select",
                    { value, onChange: (e) => onChange(e.target.value), ...rest },
                    choices.map(([id, title]) => h("option", { key: id, value: id }, title)),
                  )
                : h(multiline ? "textarea" : "input", {
                    value: value ?? "",
                    onChange: (e) => onChange(e.target.value),
                    ...rest,
                  }),
            );
          }
          const badge = (status) =>
            h(
              "span",
              {
                className:
                  "ep-badge " +
                  (["failed", "blocked"].includes(status)
                    ? "ep-error"
                    : ["completed", "passed", "approved", "verified"].includes(status)
                      ? "ep-success"
                      : ""),
              },
              textStatus(status),
            );
          function taskForm() {
            if (!taskEdit) return null;
            const patch = (value) => setTaskEdit((current) => ({ ...current, ...value }));
            return h(
              "form",
              {
                className: "ep-card",
                onSubmit: (event) => {
                  event.preventDefault();
                  const task = taskEdit;
                  if (!task.id.trim() || !task.title.trim()) {
                    setError(t("required"));
                    return;
                  }
                  if (
                    draft.tasks.some(
                      (item, index) => item.id === task.id.trim() && index !== task.index,
                    )
                  ) {
                    setError(t("duplicateTask"));
                    return;
                  }
                  const deps = [
                    ...new Set(
                      String(task.dependencies)
                        .split(/[,\n]/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    ),
                  ];
                  if (deps.includes(task.id.trim())) {
                    setError(t("selfDependency"));
                    return;
                  }
                  const next = {
                    ...(task.index >= 0 ? draft.tasks[task.index] : {}),
                    id: task.id.trim(),
                    title: task.title.trim(),
                    description: task.description,
                    dependencies: deps,
                    expectedFiles: lines(task.expectedFiles),
                    acceptanceCriteria: lines(task.acceptanceCriteria),
                    verificationCommands: lines(task.verificationCommands),
                    status: task.status || "pending",
                    evidence: task.evidence || [],
                  };
                  edit({
                    tasks:
                      task.index >= 0
                        ? draft.tasks.map((item, index) => (index === task.index ? next : item))
                        : [...draft.tasks, next],
                  });
                  setTaskEdit(null);
                  setError("");
                },
              },
              h("h3", null, t(taskEdit.index >= 0 ? "edit" : "addTask")),
              h(
                "fieldset",
                { disabled: busy },
                h(
                  "div",
                  { className: "ep-grid" },
                  field("taskId", taskEdit.id, (id) => patch({ id }), {
                    required: true,
                    disabled: taskEdit.index >= 0,
                  }),
                  field("name", taskEdit.title, (title) => patch({ title }), { required: true }),
                  field(
                    "description",
                    taskEdit.description,
                    (description) => patch({ description }),
                    { multiline: true, className: "ep-full" },
                  ),
                  ...[
                    "dependencies",
                    "expectedFiles",
                    "acceptanceCriteria",
                    "verificationCommands",
                  ].map((key) =>
                    h(
                      React.Fragment,
                      { key },
                      field(key, taskEdit[key], (value) => patch({ [key]: value }), {
                        multiline: true,
                      }),
                    ),
                  ),
                ),
                h(
                  "div",
                  { className: "ep-row" },
                  h(
                    "button",
                    { type: "submit", disabled: busy, className: "ep-primary" },
                    t("updateTask"),
                  ),
                  button("cancel", () => setTaskEdit(null)),
                ),
              ),
            );
          }
          function taskEditor(task, index) {
            setTaskEdit({
              ...task,
              index,
              dependencies: (task.dependencies || []).join("\n"),
              expectedFiles: (task.expectedFiles || []).join("\n"),
              acceptanceCriteria: (task.acceptanceCriteria || []).join("\n"),
              verificationCommands: (task.verificationCommands || []).join("\n"),
            });
          }
          function tasksView() {
            return h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "ep-row" },
                button(
                  "addTask",
                  () =>
                    taskEditor(
                      {
                        id: "task-" + Date.now().toString(36),
                        title: "",
                        description: "",
                        status: "pending",
                      },
                      -1,
                    ),
                  !!taskEdit,
                  true,
                ),
              ),
              taskForm(),
              h(
                "details",
                { className: "ep-card" },
                h("summary", null, t("dependencyMap")),
                h("p", { className: "ep-muted" }, t("dependencyHint")),
                dependencyDiagram(),
              ),
              !draft.tasks.length && h("p", { className: "ep-empty" }, t("noTasks")),
              h(
                "div",
                { className: "ep-board", "aria-label": t("tasks") },
                ...statuses.map((status) =>
                  h(
                    "section",
                    { key: status, className: "ep-column" },
                    h(
                      "h3",
                      { className: "ep-column-title" },
                      textStatus(status),
                      " · ",
                      draft.tasks.filter((task) => task.status === status).length,
                    ),
                    ...draft.tasks
                      .filter((task) => task.status === status)
                      .map((task) =>
                        h(
                          "article",
                          { key: task.id, className: "ep-card" },
                          h(
                            "div",
                            { className: "ep-row ep-between" },
                            h("h3", null, task.title),
                            badge(task.status),
                          ),
                          h("p", { className: "ep-muted" }, task.id),
                          h("p", null, task.description),
                          h(
                            "p",
                            null,
                            t("dependsOn"),
                            ": ",
                            (task.dependencies || []).length
                              ? task.dependencies
                                  .map((id) => {
                                    const dep = draft.tasks.find((x) => x.id === id);
                                    return (
                                      (dep ? dep.title : t("unknownDependency")) + " (" + id + ")"
                                    );
                                  })
                                  .join(", ")
                              : t("noDependencies"),
                          ),
                          ...["expectedFiles", "acceptanceCriteria", "verificationCommands"].map(
                            (key) =>
                              (task[key] || []).length > 0 &&
                              h(
                                "details",
                                { key, open: key === "acceptanceCriteria" },
                                h("summary", null, t(key)),
                                h(
                                  "ul",
                                  null,
                                  task[key].map((value, i) =>
                                    h(
                                      "li",
                                      { key: i },
                                      key === "verificationCommands"
                                        ? h("code", null, value)
                                        : value,
                                    ),
                                  ),
                                ),
                              ),
                          ),
                          h(
                            "div",
                            { className: "ep-row" },
                            button(
                              "edit",
                              () => taskEditor(task, draft.tasks.indexOf(task)),
                              !!taskEdit,
                            ),
                            button(
                              "remove",
                              () => edit({ tasks: draft.tasks.filter((item) => item !== task) }),
                              !!taskEdit,
                            ),
                          ),
                          task.reason && h("p", { className: "ep-warn" }, task.reason),
                          requestControls("task", task.id),
                        ),
                      ),
                  ),
                ),
              ),
              h(
                "form",
                {
                  className: "ep-card",
                  onSubmit: (event) => {
                    event.preventDefault();
                    run(() => mutate("transition", transition));
                  },
                },
                h("h3", null, t("transition")),
                h("p", { className: "ep-muted" }, t(unsettled ? "saveFirst" : "approvalRequired")),
                h(
                  "fieldset",
                  { disabled: busy || unsettled },
                  field(
                    "tasks",
                    transition.taskId,
                    (taskId) =>
                      setTransition({
                        ...transition,
                        taskId,
                        status:
                          (graph[change.tasks.find((task) => task.id === taskId)?.status] ||
                            [])[0] || "",
                      }),
                    {
                      choices: [
                        ["", t("chooseTask")],
                        ...change.tasks.map((task) => [task.id, task.title]),
                      ],
                      required: true,
                    },
                  ),
                  field(
                    "status",
                    transition.status,
                    (status) => setTransition({ ...transition, status }),
                    {
                      choices: (
                        graph[change.tasks.find((task) => task.id === transition.taskId)?.status] ||
                        []
                      ).map((value) => [value, t(value)]),
                    },
                  ),
                  field(
                    "reason",
                    transition.reason,
                    (reason) => setTransition({ ...transition, reason }),
                    {
                      multiline: true,
                      placeholder: t("reasonHint"),
                      required: transition.status === "blocked",
                    },
                  ),
                  h(
                    "button",
                    {
                      type: "submit",
                      disabled:
                        busy ||
                        unsettled ||
                        !transition.taskId ||
                        !transition.status ||
                        (transition.status === "running" && !approved),
                    },
                    t("transition"),
                  ),
                ),
              ),
            );
          }
          function documentEditor(key, open = false) {
            return h(
              "details",
              { key, open },
              h("summary", null, t(key)),
              field(
                key,
                draft.documents[key],
                (value) => edit({ documents: { ...draft.documents, [key]: value } }),
                { multiline: true, rows: 9 },
              ),
            );
          }
          function planningChecklist() {
            const planning = planningDefaults(draft.planning);
            const updateSection = (key, patch) =>
              edit({
                planning: {
                  ...planning,
                  sections: {
                    ...planning.sections,
                    [key]: { ...planning.sections[key], ...patch },
                  },
                },
              });
            return h(
              "section",
              { className: "ep-card" },
              h(
                "div",
                { className: "ep-row ep-between" },
                h("h3", null, t("completeness")),
                h(
                  "span",
                  { className: "ep-badge" },
                  sectionKeys.filter((key) => planning.sections[key].status === "ready").length,
                  " / 6 ",
                  t("readyCount"),
                ),
              ),
              h("p", { className: "ep-stage" }, t("stages")),
              h(
                "p",
                null,
                t(
                  change.status === "completed"
                    ? "nextComplete"
                    : change.status === "running"
                      ? "nextRunning"
                      : approved
                        ? "nextApproved"
                        : "nextDraft",
                ),
              ),
              h("p", { className: "ep-muted" }, t("readinessHint")),
              h(
                "fieldset",
                { disabled: busy || !editable },
                h(
                  "div",
                  { className: "ep-readiness" },
                  ...sectionKeys.map((key) =>
                    h(
                      "div",
                      { key, className: "ep-readiness-item" },
                      field(
                        key,
                        planning.sections[key].status,
                        (status) => updateSection(key, { status }),
                        {
                          choices: [
                            ["pending", t("readinessPending")],
                            ["ready", t("readinessReady")],
                          ],
                        },
                      ),
                      field("note", planning.sections[key].note, (note) =>
                        updateSection(key, { note }),
                      ),
                    ),
                  ),
                ),
                field(
                  "reviewRequirements",
                  planning.reviewRequirements,
                  (reviewRequirements) => edit({ planning: { ...planning, reviewRequirements } }),
                  { multiline: true },
                ),
                ...["proposal", "requirements", "findings", "acceptance"].map((key) =>
                  documentEditor(key),
                ),
              ),
            );
          }
          function dependencyDiagram() {
            const tasks = draft.tasks;
            if (!tasks.length) return h("p", { className: "ep-muted" }, t("noTasks"));
            const byId = new Map(tasks.map((task) => [task.id, task]));
            const levels = new Map();
            const depth = (id, trail = new Set()) => {
              if (levels.has(id)) return levels.get(id);
              if (trail.has(id) || !byId.has(id)) return 0;
              const next = new Set([...trail, id]);
              const level = Math.max(
                0,
                ...byId.get(id).dependencies.map((dep) => depth(dep, next) + 1),
              );
              levels.set(id, level);
              return level;
            };
            const counts = new Map();
            const positions = new Map(
              tasks.map((task) => {
                const level = depth(task.id);
                const column = counts.get(level) || 0;
                counts.set(level, column + 1);
                return [task.id, { x: 20 + column * 250, y: 20 + level * 120 }];
              }),
            );
            const height = (Math.max(...levels.values()) + 1) * 120 + 20;
            const width = Math.max(760, Math.max(...counts.values()) * 250 + 20);
            return h(
              "div",
              { className: "ep-diagram" },
              h(
                "svg",
                {
                  width,
                  height,
                  viewBox: "0 0 " + width + " " + height,
                  role: "img",
                  "aria-label": t("dependencyMap"),
                },
                ...tasks.flatMap((task) =>
                  task.dependencies.map((id) => {
                    const start = positions.get(id),
                      end = positions.get(task.id);
                    if (!start || !end) return null;
                    return h(
                      "g",
                      { key: id + ":" + task.id },
                      h("path", {
                        d: `M ${start.x + 105} ${start.y + 62} L ${end.x + 105} ${end.y - 5}`,
                        fill: "none",
                        stroke: "var(--dsw-alias-label-secondary)",
                        strokeWidth: 1.5,
                      }),
                      h("path", {
                        d: `M ${end.x + 100} ${end.y - 10} L ${end.x + 105} ${end.y - 5} L ${end.x + 110} ${end.y - 10}`,
                        fill: "none",
                        stroke: "var(--dsw-alias-label-secondary)",
                        strokeWidth: 1.5,
                      }),
                    );
                  }),
                ),
                ...tasks.map((task) => {
                  const { x, y } = positions.get(task.id);
                  return h(
                    "g",
                    { key: task.id },
                    h("title", null, task.title + " (" + task.id + ")"),
                    h("rect", {
                      x,
                      y,
                      width: 210,
                      height: 62,
                      rx: 7,
                      fill: "var(--dsw-alias-bg-layer-1)",
                      stroke: "var(--dsw-alias-brand-primary)",
                    }),
                    h(
                      "text",
                      {
                        x: x + 10,
                        y: y + 25,
                        fill: "var(--dsw-alias-label-primary)",
                        fontSize: 12,
                      },
                      task.title.length > 22 ? task.title.slice(0, 21) + "…" : task.title,
                    ),
                    h(
                      "text",
                      {
                        x: x + 10,
                        y: y + 46,
                        fill: "var(--dsw-alias-label-secondary)",
                        fontSize: 11,
                      },
                      textStatus(task.status),
                    ),
                  );
                }),
              ),
            );
          }
          function architectureView() {
            return h(
              React.Fragment,
              null,
              h(
                "fieldset",
                { disabled: busy || !editable },
                ...["architecture", "implementation", "impact-analysis", "decisions"].map((key) =>
                  documentEditor(key, key === "architecture"),
                ),
                h("h3", { className: "ep-section" }, t("diagrams")),
                h("p", { className: "ep-muted" }, t("sourceOnly")),
                ...["architecture", "sequence", "data-flow"].map((key) =>
                  h(
                    "details",
                    { key },
                    h("summary", null, t(key)),
                    field(
                      key,
                      draft.diagrams[key],
                      (value) => edit({ diagrams: { ...draft.diagrams, [key]: value } }),
                      { multiline: true, rows: 7 },
                    ),
                  ),
                ),
              ),
              h(
                "section",
                { className: "ep-card" },
                h("h3", null, t("dependencyMap")),
                h("p", { className: "ep-muted" }, t("dependencyHint")),
                dependencyDiagram(),
              ),
            );
          }
          function evidenceMatrix() {
            const rows = change.tasks.flatMap((task) => {
              if (!task.acceptanceCriteria.length) return [{ task, criterion: null, latest: null }];
              return task.acceptanceCriteria.map((criterion) => ({
                task,
                criterion,
                latest: (task.evidence || [])
                  .filter(
                    (item) =>
                      item.criterion === criterion && item.planVersion === change.planVersion,
                  )
                  .at(-1),
              }));
            });
            return h(
              "section",
              { className: "ep-card" },
              h("h3", null, t("matrix")),
              h("p", { className: "ep-muted" }, t("evidenceTruth")),
              !rows.length
                ? h("p", null, t("noTasks"))
                : h(
                    "div",
                    { className: "ep-table-scroll" },
                    h(
                      "table",
                      { className: "ep-matrix" },
                      h(
                        "thead",
                        null,
                        h(
                          "tr",
                          null,
                          ...[
                            "taskId",
                            "criterion",
                            "outcome",
                            "note",
                            "artifact",
                            "recorder",
                            "recordedAt",
                          ].map((key) => h("th", { key, scope: "col" }, t(key))),
                        ),
                      ),
                      h(
                        "tbody",
                        null,
                        ...rows.map(({ task, criterion, latest }, index) =>
                          h(
                            "tr",
                            { key: task.id + ":" + index },
                            h("th", { scope: "row" }, task.title, h("small", null, task.id)),
                            h("td", null, criterion || t("noCriteria")),
                            h(
                              "td",
                              null,
                              latest
                                ? badge(latest.outcome)
                                : h("span", { className: "ep-warn" }, t("missingEvidence")),
                            ),
                            h("td", null, latest?.note || "—"),
                            h("td", null, latest?.artifact || "—"),
                            h(
                              "td",
                              null,
                              latest?.actor ? latest.actor.kind + ": " + latest.actor.id : "—",
                            ),
                            h("td", null, latest?.recordedAt || "—"),
                          ),
                        ),
                      ),
                    ),
                  ),
            );
          }
          function resourcesView() {
            const selectedTask = change.tasks.find((task) => task.id === evidence.taskId);
            const allEvidence = [...change.evidence];
            for (const task of change.tasks)
              for (const item of task.evidence || [])
                if (
                  !allEvidence.some(
                    (x) =>
                      (item.id && x.id === item.id) || JSON.stringify(x) === JSON.stringify(item),
                  )
                )
                  allEvidence.push({ ...item, taskId: item.taskId || task.id });
            return h(
              React.Fragment,
              null,
              evidenceMatrix(),
              h(
                "section",
                { className: "ep-card" },
                field("tasks", requestTaskId, setRequestTaskId, {
                  choices: [
                    ["", t("chooseTask")],
                    ...change.tasks.map((task) => [task.id, task.title]),
                  ],
                }),
                requestControls("verify", requestTaskId),
              ),
              h(
                "details",
                null,
                h("summary", null, t("history")),
                h("p", { className: "ep-muted" }, t("evidenceHint")),
                !allEvidence.length && h("p", null, t("noEvidence")),
                ...allEvidence.map((item, i) =>
                  h(
                    "article",
                    { className: "ep-card", key: item.id || i },
                    h(
                      "div",
                      { className: "ep-row" },
                      badge(item.outcome),
                      h("strong", null, item.criterion),
                    ),
                    h("p", { className: "ep-muted" }, item.taskId),
                    h("p", null, item.note),
                    item.artifact && h("code", null, item.artifact),
                  ),
                ),
              ),
              h(
                "form",
                {
                  className: "ep-card",
                  onSubmit: (event) => {
                    event.preventDefault();
                    run(() => mutate("evidence", evidence));
                  },
                },
                h("h3", null, t("addEvidence")),
                h(
                  "fieldset",
                  { disabled: busy || unsettled },
                  field(
                    "tasks",
                    evidence.taskId,
                    (taskId) => setEvidence({ ...evidence, taskId, criterion: "" }),
                    {
                      choices: [
                        ["", t("chooseTask")],
                        ...change.tasks
                          .filter((task) => approved && task.status === "verifying")
                          .map((task) => [task.id, task.title]),
                      ],
                      required: true,
                    },
                  ),
                  field(
                    "criterion",
                    evidence.criterion,
                    (criterion) => setEvidence({ ...evidence, criterion }),
                    {
                      choices: [
                        ["", t("chooseCriterion")],
                        ...(selectedTask?.acceptanceCriteria || []).map((value) => [value, value]),
                      ],
                      required: true,
                    },
                  ),
                  field(
                    "outcome",
                    evidence.outcome,
                    (outcome) => setEvidence({ ...evidence, outcome }),
                    { choices: ["passed", "failed"].map((value) => [value, t(value)]) },
                  ),
                  field("note", evidence.note, (note) => setEvidence({ ...evidence, note }), {
                    multiline: true,
                    required: !evidence.artifact.trim(),
                  }),
                  field("artifact", evidence.artifact, (artifact) =>
                    setEvidence({ ...evidence, artifact }),
                  ),
                  h(
                    "button",
                    {
                      type: "submit",
                      disabled: busy || unsettled || !evidence.taskId || !evidence.criterion,
                    },
                    t("addEvidence"),
                  ),
                ),
              ),
              h(
                "details",
                { className: "ep-section" },
                h("summary", null, t("references")),
                h("p", { className: "ep-muted" }, t("referenceHint")),
                !draft.references.length && h("p", null, t("noReferences")),
                ...draft.references.map((item, index) =>
                  h(
                    "div",
                    { key: item.id || index, className: "ep-card" },
                    badge(item.kind),
                    ...["title", "source", "kind", "note"].map((key) =>
                      h(
                        React.Fragment,
                        { key },
                        field(
                          key === "title" ? "name" : key,
                          item[key],
                          (value) =>
                            edit({
                              references: draft.references.map((ref, i) =>
                                i === index ? { ...ref, [key]: value } : ref,
                              ),
                            }),
                          key === "kind"
                            ? {
                                choices: ["reference", "verified", "assumption"].map((value) => [
                                  value,
                                  t(value),
                                ]),
                                disabled: busy || !editable,
                              }
                            : { multiline: key === "note", disabled: busy || !editable },
                        ),
                      ),
                    ),
                    button("remove", () =>
                      edit({ references: draft.references.filter((_, i) => i !== index) }),
                    ),
                  ),
                ),
                h(
                  "form",
                  {
                    className: "ep-card",
                    onSubmit: (event) => {
                      event.preventDefault();
                      edit({
                        references: [
                          ...draft.references,
                          { ...reference, id: "ref-" + Date.now().toString(36) },
                        ],
                      });
                      setReference({ title: "", source: "", kind: "reference", note: "" });
                    },
                  },
                  h("h3", null, t("addReference")),
                  h(
                    "fieldset",
                    { disabled: busy || !editable },
                    field(
                      "name",
                      reference.title,
                      (title) => setReference({ ...reference, title }),
                      { required: true },
                    ),
                    field(
                      "source",
                      reference.source,
                      (source) => setReference({ ...reference, source }),
                      { required: true },
                    ),
                    field("kind", reference.kind, (kind) => setReference({ ...reference, kind }), {
                      choices: ["reference", "verified", "assumption"].map((value) => [
                        value,
                        t(value),
                      ]),
                    }),
                    field("note", reference.note, (note) => setReference({ ...reference, note }), {
                      multiline: true,
                    }),
                    h("button", { type: "submit", disabled: busy }, t("addReference")),
                  ),
                ),
              ),
            );
          }
          return h(
            "section",
            { className: "ep", "aria-label": t("title"), "aria-busy": busy },
            h("style", null, css + viewCss),
            h(
              "div",
              { className: "ep-layout" },
              h(
                "aside",
                { className: "ep-side" },
                h(
                  "div",
                  { className: "ep-row ep-between" },
                  h("h2", null, t("changes")),
                  button("refreshList", () => run(list)),
                ),
                warnings.length > 0 &&
                  h(
                    "div",
                    { className: "ep-warn", role: "status" },
                    h("p", null, t("listWarnings")),
                    ...warnings.map((warning, i) =>
                      h("p", { key: i }, warning.changeId, ": ", warning.message || warning.code),
                    ),
                  ),
                h(
                  "div",
                  { className: "ep-list" },
                  !changes.length && h("p", { className: "ep-muted" }, t("emptyList")),
                  ...changes.map((item) =>
                    h(
                      "button",
                      {
                        key: item.id,
                        type: "button",
                        disabled: busy,
                        className: item.id === change?.id ? "ep-selected" : "",
                        "aria-pressed": item.id === change?.id,
                        onClick: () => guarded(() => get(item.id)),
                      },
                      item.title,
                      h(
                        "small",
                        null,
                        textStatus(item.status),
                        " · ",
                        t("revision"),
                        " ",
                        item.revision,
                      ),
                    ),
                  ),
                ),
                h(
                  "form",
                  {
                    onSubmit: (event) => {
                      event.preventDefault();
                      guarded(async () => {
                        const data = await command({ action: "create", ...creation });
                        if (mounted.current) {
                          loadChange(data.change);
                          setCreation({ title: "", goal: "", mode: "lite" });
                          setTab("overview");
                        }
                        await list();
                      });
                    },
                  },
                  h("h3", null, t("newChange")),
                  h(
                    "fieldset",
                    { disabled: busy },
                    field("name", creation.title, (title) => setCreation({ ...creation, title }), {
                      required: true,
                    }),
                    field("goal", creation.goal, (goal) => setCreation({ ...creation, goal }), {
                      multiline: true,
                      required: true,
                    }),
                    field("mode", creation.mode, (mode) => setCreation({ ...creation, mode }), {
                      choices: ["lite", "standard"].map((value) => [value, t(value)]),
                    }),
                    h(
                      "button",
                      {
                        type: "submit",
                        disabled: busy || !creation.title.trim() || !creation.goal.trim(),
                        className: "ep-primary",
                      },
                      t("create"),
                    ),
                  ),
                ),
              ),
              h(
                "main",
                { className: "ep-main" },
                busy && h("p", { role: "status", "aria-live": "polite" }, t("busy")),
                error &&
                  h(
                    "div",
                    { role: "alert", className: "ep-card ep-error" },
                    h("p", null, error),
                    draft && h("p", null, t("conflictHint")),
                    draft &&
                      button("copyDraft", () =>
                        copy(JSON.stringify({ draft, taskEdit, reference, transition, evidence }, null, 2)),
                      ),
                  ),
                notice && h("p", { role: "status", className: "ep-success" }, notice),
                pending &&
                  h(
                    "div",
                    { className: "ep-card ep-warn", role: "alert" },
                    h("p", null, t("discardHint")),
                    h(
                      "div",
                      { className: "ep-row" },
                      button("keep", () => setPending(null)),
                      button("discard", () => {
                        const action = pending;
                        setPending(null);
                        run(action);
                      }),
                    ),
                  ),
                h("h2", null, t("title")),
                h(
                  "nav",
                  { className: "ep-tabs", "aria-label": t("title") },
                  ...["overview", "plan", "tasks", "resources"].map((value) =>
                    h(
                      "button",
                      {
                        key: value,
                        type: "button",
                        className: tab === value ? "ep-selected" : "",
                        "aria-pressed": tab === value,
                        onClick: () => setTab(value),
                      },
                      t(value),
                    ),
                  ),
                ),
                !draft
                  ? h(
                      "div",
                      { className: "ep-empty" },
                      h("h3", null, t(tab)),
                      h(
                        "p",
                        null,
                        t(
                          {
                            overview: "emptyPlanning",
                            plan: "emptyArchitecture",
                            tasks: "emptyTasks",
                            resources: "emptyQuality",
                          }[tab],
                        ),
                      ),
                    )
                  : h(
                      React.Fragment,
                      null,
                      h(
                        "div",
                        { className: "ep-row ep-between" },
                        h("h2", null, change.title),
                        badge(change.status),
                      ),
                      h(
                        "div",
                        { className: "ep-row ep-muted" },
                        h("span", null, change.id),
                        h("span", null, t("revision"), " ", change.revision),
                        h("span", null, t("planVersion"), " ", change.planVersion),
                        h(
                          "span",
                          { className: unsettled || runtimeDirty ? "ep-warn" : "ep-success" },
                          t(unsettled || runtimeDirty ? "unsaved" : "saved"),
                        ),
                      ),
                      h(
                        "div",
                        { className: "ep-row ep-section" },
                        button(
                          "save",
                          () =>
                            run(async () => {
                              const patch = {
                                title: draft.title,
                                goal: draft.goal,
                                planning: draft.planning,
                                documents: draft.documents,
                                diagrams: draft.diagrams,
                                tasks: draft.tasks.map((task) =>
                                  Object.fromEntries(
                                    [
                                      "id",
                                      "title",
                                      "description",
                                      "dependencies",
                                      "expectedFiles",
                                      "acceptanceCriteria",
                                      "verificationCommands",
                                    ].map((key) => [key, task[key]]),
                                  ),
                                ),
                                references: draft.references,
                              };
                              const data = await command({
                                action: "save",
                                changeId: change.id,
                                expectedRevision: change.revision,
                                patch,
                              });
                              if (mounted.current) {
                                loadChange(data.change, { preserveRuntime: true });
                                setNotice(t("saved"));
                              }
                              await list();
                            }),
                          !dirty || !!taskEdit || referenceDirty || !draft.title.trim() || !draft.goal.trim(),
                          true,
                        ),
                        button("refresh", () => guarded(() => get(change.id))),
                        button(
                          "approve",
                          () => run(() => mutate("approve")),
                          approved || unsettled,
                        ),
                        button(
                          "replan",
                          () => setReplanConfirm(true),
                          unsettled ||
                            change.tasks.some((task) =>
                              ["running", "verifying"].includes(task.status),
                            ),
                        ),
                      ),
                      replanConfirm &&
                        h(
                          "div",
                          { className: "ep-card ep-warn" },
                          h("p", null, t("replanHint")),
                          button("replanConfirm", () => run(() => mutate("replan")), unsettled),
                          button("cancel", () => setReplanConfirm(false)),
                        ),
                      !editable && h("p", { className: "ep-muted" }, t("locked")),
                      h(
                        "p",
                        { className: approved && !dirty ? "ep-success" : "ep-muted" },
                        t(approved && !dirty ? "approved" : "approvalRequired"),
                      ),
                      tab === "overview" &&
                        h(
                          React.Fragment,
                          null,
                          planningChecklist(),
                          h(
                            "fieldset",
                            { disabled: busy || !editable },
                            field("name", draft.title, (title) => edit({ title }), {
                              required: true,
                            }),
                            field("goal", draft.goal, (goal) => edit({ goal }), {
                              multiline: true,
                              required: true,
                            }),
                          ),
                          h(
                            "div",
                            { className: "ep-stats" },
                            h("div", null, h("strong", null, draft.tasks.length), t("taskCount")),
                            h(
                              "div",
                              null,
                              h("strong", null, change.evidence.length),
                              t("evidenceCount"),
                            ),
                            h("div", null, h("strong", null, t(change.mode)), t("mode")),
                          ),
                          h(
                            "div",
                            { className: "ep-row" },
                            button("context", () =>
                              run(async () => {
                                const data = await command({
                                  action: "context",
                                  changeId: change.id,
                                });
                                if (mounted.current)
                                  setOutput({
                                    title: t("context"),
                                    text: JSON.stringify(data, null, 2),
                                  });
                              }),
                            ),
                            button("export", () =>
                              run(async () => {
                                const data = await command({
                                  action: "export",
                                  changeId: change.id,
                                  expectedRevision: change.revision,
                                });
                                if (mounted.current)
                                  setOutput({
                                    title: t("exported"),
                                    text: data.files
                                      ? JSON.stringify(data.files, null, 2)
                                      : t("noFiles"),
                                  });
                              }),
                            ),
                            button("agent", () => copy(t("prompt", { id: change.id })), unsettled),
                          ),
                          h("p", { className: "ep-muted" }, t("savedOnly")),
                          h("p", { className: "ep-muted" }, t("agentHint")),
                          requestControls("plan"),
                        ),
                      tab === "plan" && architectureView(),
                      tab === "tasks" && tasksView(),
                      tab === "resources" && resourcesView(),
                    ),
                output &&
                  h(
                    "section",
                    { className: "ep-card" },
                    h(
                      "div",
                      { className: "ep-row ep-between" },
                      h("h3", null, output.title),
                      button("copy", () => copy(output.text)),
                    ),
                    h(
                      "label",
                      null,
                      h("span", { className: "ep-muted" }, output.title),
                      h("textarea", {
                        className: "ep-output",
                        value: output.text,
                        readOnly: true,
                        onFocus: (event) => event.target.select(),
                      }),
                    ),
                  ),
              ),
            ),
          );
        }
        ctx.slots.inject("conversation.view", () =>
          ctx.slots.register(
            {
              name: "conversation.view",
              id: "engineering-planner",
              order: 40,
              label: () => t("entry"),
            },
            Workbench,
          ),
        );
      },
    };
  },
});
