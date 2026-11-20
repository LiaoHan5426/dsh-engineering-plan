window.__ModuleLoader__.load({
  id: "@local/dsh-engineering-planner",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const NS = "engineering-planner";
    const STATE_DIRECTORY = ".dsh/engineering/changes";
    function mermaidFrameRuntime(nonce) {
      let latest = 0;
      let queue = Promise.resolve();
      const report = (data) => parent.postMessage({ kind: "ep-mermaid", nonce, ...data }, "*");
      window.addEventListener("message", (event) => {
        if (event.source !== parent || event.data?.kind !== "ep-mermaid-render" || event.data?.nonce !== nonce) return;
        const request = event.data;
        latest = request.revision;
        queue = queue.catch(() => {}).then(async () => {
          if (request.revision !== latest) return;
          const stage = document.getElementById("stage");
          try {
            if (!window.mermaid) throw new Error("Offline Mermaid renderer did not load");
            window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: request.dark ? "dark" : "default",
              maxTextSize: 50000, maxEdges: 500, suppressErrorRendering: true,
              flowchart: { htmlLabels: false }, htmlLabels: false,
              secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels"] });
            const result = await window.mermaid.render("ep-" + request.revision, request.source, stage);
            if (request.revision !== latest) return;
            // Display SVG in image context: scripts, links and foreignObject are inert.
            const image = document.getElementById("diagram");
            image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(result.svg);
            image.alt = request.label;
            await image.decode();
            if (request.revision !== latest) return;
            document.body.style.background = request.dark ? "#171717" : "#ffffff";
            report({ revision: request.revision, status: "ready" });
          } catch (error) {
            if (request.revision === latest) report({ revision: request.revision, status: "error", error: String(error.message || error).slice(0, 1200) });
          } finally { stage.replaceChildren(); }
        });
      });
      report({ status: "loaded" });
    }
    function mermaidFrameDocument(asset, nonce) {
      if (!/^[a-zA-Z0-9-]+$/.test(nonce)) throw new Error("Invalid preview nonce");
      const escaped = asset.replace(/<\/script/gi, "<\\/script");
      return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"><style>body{margin:0;padding:12px}#diagram{display:block;max-width:100%;height:auto;margin:auto}#stage{position:absolute;left:-100000px;top:0;width:1200px}</style><div id="stage"></div><img id="diagram"><script nonce="${nonce}">${escaped}<\/script><script nonce="${nonce}">(${mermaidFrameRuntime.toString()})(${JSON.stringify(nonce)})<\/script>`;
    }
    const words = {      replan: ["重新规划", "Replan"],
      describeRequest: ["描述需求，生成规划", "Describe a request"],
      describePrompt: ["请使用 engineering_plan 为以下研发需求创建变更并编写结构化方案。请先澄清关键约束，再形成规划与验收标准。需求：", "Use engineering_plan to create a change and write a structured plan for the following request. Clarify key constraints first and include acceptance criteria. Request:"],
      reviseSection: ["请在当前方案中修改以下规划章节，先说明建议变更，范围：", "Suggest edits to this section of the current plan. Scope:"],
      changeActions: ["方案操作", "Plan actions"],
      editPlanning: ["编辑规划", "Edit plan"],
      finishEditing: ["结束编辑", "Finish editing"],
      readyForReview: ["待评审", "Ready for review"],
      reviseWithAgent: ["请求修改本节", "Request edits to this section"],
      reviewPlan: ["评审方案", "Review plan"],
      advancedInfo: ["高级信息与诊断", "Advanced information and diagnostics"],
      allStatuses: ["全部状态", "All statuses"],
      taskDetails: ["任务详情", "Task details"],
      nextTask: ["下一项依赖已满足的任务", "Next task with dependencies met"],
      blockedCount: ["阻塞任务", "Blocked tasks"],
      waitingForPlan: ["正在等待对话写入方案", "Waiting for the conversation to save the plan"],
      planLink: ["创建时请将以下 UUID 原样作为 engineering_plan create 的 changeId，然后保存方案。", "Pass this UUID unchanged as changeId to engineering_plan create, then save the plan."],
      changedRemotely: ["方案有新修订。当前编辑已保留，可使用方案操作中的重新加载。", "A newer revision is available. Your edits are preserved. Use the plan actions to reload."],
      deliveredDecisions: ["已交付版本的架构决策", "Architecture decisions from accepted deliveries"],
      pendingCriteria: ["待验证", "Awaiting evidence"],
      boardLayout: ["看板", "Board"],
      listLayout: ["列表", "List"],
      currentRuns: ["执行记录", "Execution records"],
      documentEmpty: ["尚未填写", "No content yet"],
      replanConfirm: ["确认重新规划", "Confirm replanning"],
      replanHint: [
        "重新规划会归档当前版本并重置任务状态、审批与证据。确认后再编辑新方案。",
        "Replanning archives this version and resets task statuses, approvals, and evidence. Confirm to edit a new plan.",
      ],
      replanLockedTasks: [
        "仍有任务处于进行中或验证中，此时重新规划会被拒绝。请先把这些任务转为阻塞或失败，再确认重新规划。",
        "Tasks are still running or verifying, so replanning would be rejected. Block or fail those tasks first, then confirm.",
      ],
      locked: [
        "执行期间方案已锁定；结束运行或验证中的任务后，可重新规划。",
        "The plan is locked during execution. Finish running or verifying tasks before replanning.",
      ],
      listWarnings: ["部分变更读取失败", "Some changes could not be read"],
      changes: ["变更", "Changes"],
      newChange: ["新建变更", "New change"],
      name: ["标题", "Title"],
      goal: ["目标", "Goal"],
      mode: ["规划模式", "Planning mode"],
      lite: ["轻量", "Lite"],
      standard: ["标准", "Standard"],
      liteEssentials: ["轻量交付核心文档", "Lite delivery essentials"],
      advancedPlanning: ["六项准备、评审要求与高级规划文档（展开编辑）", "Readiness, review requirements & advanced planning (expand to edit)"],
      create: ["创建", "Create"],
      refreshList: ["刷新列表", "Refresh list"],
      emptyList: [
        "尚无变更。填写标题与目标，创建第一份工程计划。",
        "No changes yet. Enter a title and goal to create your first plan.",
      ],
      save: ["保存草稿", "Save draft"],
      refresh: ["重新加载", "Reload"],
      approve: ["批准当前方案", "Approve current plan"],
      approved: ["当前方案已批准", "Current plan approved"],
      approvalRequired: [
        "运行前需批准当前方案。修改规划内容会使原审批失效。",
        "Approve the current plan before running. Editing the plan invalidates its approval.",
      ],
      transitionApprovedHint: [
        "当前方案已批准。任务状态按下方状态图推进；失败或已阻塞的任务可先回到待执行再重试。派发与验证仍受各自门禁约束。",
        "The current plan is approved. Advance task states with the map below; failed or blocked tasks can return to pending before retrying. Dispatch and verification keep their own gates.",
      ],
      transitionUnapprovedHint: [
        "任务状态流转不要求批准；原生派发与命令验证需要先人工批准当前方案。",
        "Task state transitions do not require approval; native dispatch and command verification need a human-approved current plan.",
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
      acceptance: ["验收方案", "Acceptance"],
      decisions: ["决策记录", "Decisions"],
      findings: ["发现记录", "Findings"],
      diagrams: ["Mermaid 图源", "Mermaid sources"],
      sequence: ["时序图", "Sequence diagram"],
      addTask: ["添加任务", "Add task"],
      edit: ["编辑", "Edit"],
      remove: ["移除", "Remove"],
      taskHasDependents: [
        "仍有任务依赖此任务，请先在这些任务里移除依赖：",
        "Other tasks still depend on this one; remove those dependencies first: ",
      ],
      taskId: ["任务 ID", "Task ID"],
      description: ["说明", "Description"],
      dependencies: [
        "依赖任务 ID（逗号或换行分隔）",
        "Dependency IDs (comma or newline separated)",
      ],
      expectedFiles: ["预期文件（每行一项）", "Expected files (one per line)"],
      acceptanceCriteria: ["验收标准（每行一项）", "Acceptance criteria (one per line)"],
      verificationCommands: ["验证命令（每行一项）", "Verification commands (one per line)"],
      affectedModules: ["影响模块（逗号分隔）", "Affected modules (comma separated)"],
      affectedModulesLabel: ["影响模块", "Modules"],
      executor: ["执行方式", "Executor"],
      executorLocal: ["本地", "Local"],
      executorSubagent: ["子代理", "Subagent"],
      executorExternal: ["外部", "External"],
      requiresApproval: ["需要人工审批", "Requires human approval"],
      approvalRequiredNote: ["需人工审批", "Approval required"],
      maxRetries: ["最大重试次数", "Max retries"],
      retriesLabel: ["重试次数", "Retries"],
      modulesTooLong: [
        "影响模块名不能超过 200 字符，也不能包含空字符。",
        "A module name cannot exceed 200 characters or contain a NUL character.",
      ],
      retriesRange: [
        "最大重试次数必须是 0 到 10 的整数。",
        "Max retries must be an integer between 0 and 10.",
      ],
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
      "awaiting-review": ["待人工审核", "Awaiting review"],
      cancelled: ["已取消", "Cancelled"],
      reserved: ["已预留", "Reserved"],
      starting: ["启动中", "Starting"],
      returned: ["已返回", "Returned"],
      succeeded: ["执行成功", "Succeeded"],
      timed_out: ["已超时", "Timed out"],
      unknown: ["状态未定", "Unknown"],
      error: ["执行出错", "Errored"],
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
      evidencePostMortem: ["该任务处于失败或阻塞状态，只能补记失败证据：用于留下失败原因与现场，不会让任务变成已完成。", "This task is failed or blocked, so only failure evidence can be appended: it records why it failed and cannot complete the task."],
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
      missingDependency: [
        "依赖任务不存在：",
        "Dependency task does not exist: ",
      ],
      saveFirst: [
        "请先保存草稿，再执行审批、运行或验收操作。",
        "Save the draft before approving, executing, or recording evidence.",
      ],
      taskCount: ["任务数", "Tasks"],
      evidenceCount: ["证据数", "Evidence entries"],
      exported: ["导出文件", "Exported files"],
      exportStale: ["另有旧导出的文件未被本次导出更新：", "Files from an earlier export that this run did not rewrite:"],
      exportManifest: ["导出清单：", "Export manifest:"],
      modeLiteHint: ["轻量模式：导出时只写有内容的文档与图源；上次导出留下、本次未重写的文件会列在导出清单的 stale 里。", "Lite mode: an export writes only documents and diagrams that have content; files left from an earlier export are listed as stale in the manifest."],
      modeStandardHint: ["标准模式：导出时无条件写入全部八篇文档与四张图源。", "Standard mode: an export always writes all eight documents and all four diagram sources."],
      noFiles: ["未返回文件路径。", "No file paths returned."],
      prompt: [
        "请完善工程变更 {id} 的方案。先读取工程规划上下文，核对目标、需求、架构、影响分析与验收标准；拆分有明确依赖、预期文件及验证命令的任务，标注资料和待验证假设，保存修改。不要代替用户批准方案，批准前不要开始实现。",
        "Refine engineering change {id}. Read its planning context first, verify the goal, requirements, architecture, impact, and acceptance criteria; create tasks with dependencies, expected files, and verification commands. Label references and assumptions, and save the changes. Do not approve on behalf of the user or begin implementation before approval.",
      ],
      dispatchResolutionReason: ["人工结案原因（必填）", "Human resolution reason (required)"],
      dispatchResolutionBasis: ["停止核查依据（必填）", "Termination inspection basis (required)"],
      dispatchResolutionReferences: ["核查资料（每行一项）", "Inspection references (one per line)"],
      dispatchResolutionConfirm: ["我已明确核查子 Agent、所有后代及相关进程均已停止。", "I explicitly checked that the child agent, all descendants and associated processes have stopped."],
      dispatchResolutionHint: ["仅记录人工核查结案，原运行保持 unknown；不会自动核查、停止、重跑或批准。刷新记录后需重新勾选确认。", "Records human resolution only; the run remains unknown. No automatic inspection, stopping, replay or approval. Confirm again after refreshing records."],
      dispatchResolutionActor: ["结案人", "Resolved by"],
      dispatchResolutionTime: ["结案时间", "Resolved at"],
      dispatchResolutionCheckedAt: ["核查确认时间", "Inspection confirmed at"],
      dispatchResolutionHistory: ["派发 unknown 人工结案历史", "Dispatch unknown human resolution history"],
      dispatchExpiredDrafts: ["过期结案草稿（已保留）", "Expired resolution drafts (retained)"],
      dispatchExpiredHint: ["运行修订、状态或记录列表已变化。以下草稿不参与提交，文本仍保留并计入未保存编辑；可复制备份或逐条明确丢弃。", "The run revision, state or record list changed. These drafts are excluded from submission and retained as unsaved edits. Copy a backup or explicitly discard each draft."],
      dispatchDiscardDraft: ["丢弃此过期草稿", "Discard this expired draft"],
      dispatchNative: ["原生子 Agent 派发请求", "Native child agent dispatch request"],
      dispatchFill: ["填入派发请求", "Fill dispatch request"],
      dispatchCopy: ["复制派发请求", "Copy dispatch request"],
      dispatchPendingOnly: ["仅已保存的 pending 任务可生成派发请求。", "Only saved pending tasks can request dispatch."],
      dispatchDependencies: ["先完成全部依赖任务。", "Complete every dependency first."],
      dispatchRefreshRequired: ["请先刷新派发记录，等待加载成功。", "Refresh dispatch records and wait for a successful load."],
      dispatchRunBlocked: ["存在活跃或 unknown 派发记录，请先核查运行状态。", "Active or unknown dispatch records require review first."],
      dispatchRequestHint: ["只生成 engineering_dispatch 请求，不执行派发或自动发送。Host 最终核对审批、版本与运行状态；返回结果仍需评审。派发与验证请求都在本插件加载期内复用各自的 requestId（重挂载视图不会换号），换版本、换任务或换命令才会生成新请求；请保留 requestId 以重放原尝试。", "Generates an engineering_dispatch request only; no dispatch or automatic send. The Host checks approval, version and run state; returned results still need review. Both dispatch and verification requests reuse their own requestId for as long as the plugin stays loaded; remounting the view does not change it, while a new plan version, task or command does. Retain the requestId to replay that attempt."],
      dispatchPrompt: ["请调用 engineering_dispatch，严格使用以下参数：\n{payload}\n保留 requestId 重放此尝试；returned 不等于任务完成或验收通过，请评审结果再记录证据。", "Call engineering_dispatch with exactly these parameters:\n{payload}\nRetain requestId to replay this attempt. Returned does not mean task completion or acceptance; review results before recording evidence."],
      dispatchRuns: ["子 Agent 派发记录", "Child agent dispatch records"],
      dispatchTruth: ["运行记录：returned 仅代表子 Agent 返回，不代表任务完成或验收通过；unknown 可人工核查结案，原记录保持 unknown。此处不派发任务，也不自动改变任务状态。", "Run records: returned means the child agent returned, not task completion or acceptance. Unknown runs can be resolved after human inspection and remain unknown. This view does not dispatch or change tasks."],
      dispatchNotLoaded: ["尚未加载派发记录，请手动刷新。", "Dispatch records are not loaded. Refresh manually."],
      dispatchEmpty: ["此变更暂无子 Agent 派发记录。", "No child agent dispatch records for this change."],
      dispatchStale: ["刷新失败；保留的同一变更记录已标记过期，请重试刷新。", "Refresh failed. Retained records for this change are stale; retry to refresh."],
      dispatchLoading: ["正在加载派发记录…", "Loading dispatch records…"],
      deliveryReview: ["用户交付评审", "User delivery review"],
      archivedReviews: ["历史版本与重启任务记录（只读）", "Archived versions and restarted tasks (read only)"],
      archivedReviewHint: ["以下记录按归档版本展示，不参与当前版本验收矩阵或交付门禁。", "These records belong to their archived versions and do not contribute to current evidence or delivery gates."],
      noArchivedReviews: ["尚无归档版本或任务重启记录。重新规划或重启任务后，可在此查看历史。", "No archived versions or task restart records yet. History appears after replanning or restarting a task."],
      archivedApprovals: ["历史审批", "Archived approvals"],
      archivedTasks: ["历史任务与证据", "Archived tasks and evidence"],
      deliveryReconfirm: ["交付确认所对应的变更或版本已更新，请重新审阅并勾选确认；备注已保留。", "The change or version associated with confirmation changed. Review and check the confirmation again; your note is retained."],
      deliveryTruth: ["技术任务完成与用户交付确认分别记录；任务完成不会自动确认交付。Host 会在提交时核对最新状态。", "Technical task completion and user delivery acceptance are separate records. Completion never accepts delivery automatically; the Host checks the latest state on submission."],
      technicalComplete: ["技术任务已收尾", "Technical tasks finalized"],
      technicalIncomplete: ["技术任务尚未收尾", "Technical tasks not finalized"],
      deliveryAccepted: ["当前版本已确认交付", "Current delivery accepted"],
      deliveryFrozen: ["当前版本已确认交付，任务状态已冻结；如需继续调整，请先人工重新规划。", "Delivery of this version is accepted and task statuses are frozen. Replan manually before further changes."],
      deliveryPending: ["当前版本待用户确认交付", "Current delivery awaits user acceptance"],
      gateTitle: ["交付门禁（核心判定）","Delivery gate (core verdict)"],
      gateTruth: ["该结果由核心按当前版本计算：审批、任务终态、逐项验收证据、活动与未结案运行。它不改变执行门禁，也不代表交付已确认。","Computed by the core for the current version: approval, task terminality, per-criterion evidence, active and unresolved runs. It changes no execution gate and does not confirm delivery."],
      gateNotQueried: ["尚未查询。刷新运行记录时会一并查询。","Not queried yet. Refreshing run records also queries it."],
      gateStale: ["下面显示的是旧版本的门禁结果。请先在「方案操作」里重新加载变更，再刷新运行记录后判断。","The gate result below belongs to an older version. Reload the change under Plan actions first, then refresh run records."],
      gateReady: ["核心判定：技术侧已就绪（仍需你本人确认交付）。","Core verdict: technically ready (your delivery confirmation is still required)."],
      gateWarnNoSucceededCommand: ["证据已通过，但当前版本没有任何命令成功执行：{task}（仅提示，不拦截交付）。", "Evidence passed while no command succeeded in this version: {task} (informational only, it does not block delivery)."],
      gateApprovalRequired: ["当前方案未获人工批准","Current plan has no human approval"],
      gateActiveRun: ["存在活动运行","An active run exists"],
      gateUnresolvedUnknown: ["存在未结案 unknown 运行","An unknown run is unresolved"],
      gateTaskNotTerminal: ["任务尚未收尾","Task is not terminal"],
      gateNoCompletedTask: ["没有已完成任务","No completed task"],
      gateMissingEvidence: ["缺少当前版本证据","No current-version evidence"],
      gateUnknownBlocker: ["未识别的阻塞项","Unrecognised blocker"],
      deliveryEligibility: ["提交需当前方案已获人工批准、至少一个任务 completed、其余任务 completed/cancelled，且无活动运行或未结案 unknown。请刷新运行记录后核对。", "Submission requires current human approval, at least one completed task, every other task completed/cancelled, and no active or unresolved unknown runs. Refresh runs to review."],
      deliveryBlockedRuns: ["仍有活动运行或未结案 unknown 运行，需先处置。", "Active or unresolved unknown runs remain and must be handled first."],
      deliveryRunsUnloaded: ["运行记录尚未加载：先刷新运行记录，再确认交付。", "Run records are not loaded yet: refresh run records before accepting delivery."],
      refreshRunsFirst: ["先刷新运行记录", "Refresh run records first"],
      planNoGoal: ["批准前需要方案目标。", "The plan needs a goal before approval."],
      planNoTasks: ["批准前至少需要一个任务。", "The plan needs at least one task before approval."],
      planTaskNoCriteria: ["批准前每个任务至少需要一条验收标准。", "Every task needs at least one acceptance criterion before approval."],
      planIncompleteError: ["核心拒绝批准：方案缺少目标、任务或每个任务的验收标准。请补全后再批准。", "The core refused approval: the plan needs a goal, tasks and one acceptance criterion per task. Complete the plan first."],
      errApprovalRequired: ["当前方案未获人工批准。", "The plan has no current human approval."],
      errRevisionConflict: ["方案已有新修订，请重新加载后再操作。", "The plan has a newer revision; reload before retrying."],
      errPlanLocked: ["有任务仍在执行或验证中，需等其结束或由人工终止后再试。", "A task is still running or verifying; wait for it or terminate the run as a human."],
      errDeliveryLocked: ["交付已确认，方案被冻结，无法再修改。", "Delivery is accepted, so the plan is frozen."],
      errDependencyBlocked: ["前置任务尚未完成，无法开始该任务。", "A dependency is not completed yet."],
      errFileConflict: ["与另一个执行中的任务申报了相同文件。", "Another running task claims the same files."],
      errEvidenceRequired: ["完成该任务前，每条验收标准都需要当前版本的最新证据。", "Every acceptance criterion needs current-version evidence before completion."],
      errEvidenceEmpty: ["证据需要备注或产物路径，不能为空白。", "Evidence needs a note or an artifact path."],
      errInvalidTransition: ["当前状态不允许这个流转。", "The current status does not allow that transition."],
      errInvalidTransitionWith: ["当前状态只允许这些流转：", "The current status only allows: "],
      errVerificationRunBlocked: ["该变更还有未结案的验证运行，需先完成或人工结案。", "The change still has unresolved verification runs."],
      errDispatchRunBlocked: ["该变更还有未结案的派发运行，需先完成或人工结案。", "The change still has unresolved dispatch runs."],
      errAbandonNotReserved: ["只有从未启动的预留运行可以被放弃；已启动的运行请使用终止。", "Only a reserved run that never started can be abandoned."],
      errLockBusy: ["存储被另一个进程占用，稍后重试。", "The store is locked by another process; retry shortly."],
      errNotFound: ["找不到该变更。", "The change does not exist."],
      errCorruptState: ["变更状态文件已损坏，需要人工检查。", "The change state file is corrupt and needs a human look."],
      errStateTooLarge: ["状态或导出超出大小上限。", "The state or export exceeds the size limit."],
      errPathUnsafe: ["路径不安全（链接、设备名或非法相对路径）。", "The path is unsafe (link, device name or invalid relative path)."],
      errWorkspaceMismatch: ["工作目录与会话工作区不一致，操作被拒绝。", "The working directory does not match the session workspace."],
      errForbidden: ["该动作只允许人工发起。", "This action is human-only."],
      errRequestConflict: ["该请求 id 已绑定另一份快照，无法重放。", "That request id is bound to another snapshot."],
      errSessionRequired: ["缺少会话身份，操作被拒绝。", "No session identity was available, so the operation was refused."],
      errCancelled: ["操作已取消。", "The operation was cancelled."],
      errInvalidInput: ["参数不符合要求，请检查字段与取值。", "The arguments do not fit the contract; check the fields and values."],
      errUnknownAction: ["无法识别的操作。", "That action is not recognised."],
      errHumanOnlyAction: ["该动作只能由用户本人发起。", "Only the user can start this action."],
      errToolExecutionRequired: ["该工具需要在模型执行上下文中调用。", "This tool must be called from an admitted model execution."],
      errRunNotRunning: ["该运行已不在启动中或运行中，无需终止。", "That run is no longer starting or running."],
      errRunWithoutJob: ["该运行没有 jobId，从未真正启动；可在工作台中标记放弃。", "That run has no jobId and never started; abandon it from the workbench instead."],
      errRunForeignHost: ["该运行由另一个宿主实例创建，本页面无法终止。", "Another host instance owns that run, so this page cannot stop it."],
      errInputTooLarge: ["输入过大，请拆分后再提交。", "The input is too large; split it and submit again."],
      dispatchVerificationLoading: ["验证记录尚未加载，先刷新运行记录，再确认同任务没有未结案验证。", "Verification runs are not loaded. Refresh run records first so a live verification on this task is not missed."],
      dispatchVerificationRunning: ["该任务已有未结束的验证运行，先等它结束或由人工终止后再派发。", "This task already has a live verification run; wait for it or terminate it as a human."],
      deliveryCancelled: ["以下任务已取消；请审阅其对交付范围的影响，并在确认备注中说明。", "These tasks were cancelled. Review their effect on delivery scope and explain it in your acceptance note."],
      deliveryConfirm: ["我已审阅交付成果、验证记录及取消任务的影响，确认接受当前版本交付。", "I reviewed the deliverables, verification records and cancelled tasks, and accept delivery of this version."],
      deliveryNote: ["交付确认备注（必填）", "Delivery acceptance note (required)"],
      acceptDelivery: ["确认当前版本交付", "Accept current delivery"],
      deliveryActor: ["交付确认人", "Accepted by"],
      deliveryAcceptedAt: ["交付确认时间", "Accepted at"],
      deliveryHistorical: ["历史版本交付确认（不代表当前版本）", "Historical acceptance (not the current version)"],
      runs: ["真实验证运行记录", "Verification runs"],
      noRuns: ["尚未读取运行记录，请刷新。", "Refresh to load verification runs."],
      emptyRuns: ["此变更暂无验证运行记录。", "No verification runs for this change."],
      executionNotRecorded: ["执行参数未记录", "Execution parameters not recorded"],
      shellNotRecorded: ["Shell身份未记录（当前执行接口未提供）", "Shell identity not recorded (not provided by the current execution interface)"],
      executionWorkdir: ["工作目录（workdir）", "Working directory (workdir)"],
      executionTimeout: ["超时（timeoutMs，毫秒）", "Timeout (timeoutMs, milliseconds)"],
      executionOnExpiry: ["超时处理（onExpiry）", "Expiry behavior (onExpiry)"],
      executionStdoutMaxBytes: ["标准输出上限（stdoutMaxBytes，字节）", "Standard output limit (stdoutMaxBytes, bytes)"],
      runTruth: [
        "命令 succeeded 仅代表执行成功，不代表验收标准 passed。历史版本记录仅供追溯；active 不等于 unknown，不自动恢复或重跑。",
        "A succeeded command is not a passed acceptance criterion. Historical versions are for audit only; active is not unknown and runs are never automatically recovered or replayed.",
      ],
      commandChoice: ["选择已保存的验证命令", "Select a saved verification command"],
      verifyEligibility: [
        "仅当前方案已获用户批准且处于 verifying 的任务可请求执行验证命令。",
        "Command requests require current human approval and a task in verifying state.",
      ],
      unknownResolve: ["人工核查结案", "Resolve after human inspection"],
      unknownConfirm: [
        "我确认旧 Host 已停止，残留 job/process 和工作区影响已检查。",
        "I confirm the old Host has stopped and remaining jobs/processes and workspace effects have been inspected.",
      ],
      unknownHint: [
        "此操作只记录人工结案原因，不把运行改为成功，也不自动重跑。",
        "This only records a human resolution reason. It does not mark the run successful or rerun it.",
      ],
      resolvedRun: ["已有人工结案记录", "Human resolution recorded"],
      runVersion: ["记录所属版本", "Recorded plan version"],
      abandonRun: ["放弃残留预留", "Abandon stranded reservation"],
      abandonReason: ["放弃理由（必填）", "Abandonment reason (required)"],
      abandonConfirm: [
        "我确认该预留从未启动（无 jobId），放弃为终态且不可恢复。",
        "I confirm this reservation never started (no jobId); abandonment is terminal and cannot be undone.",
      ],
      abandonHint: [
        "只记录人工放弃：运行记为 cancelled 并追加历史；不改变任务状态、证据、审批与交付确认。",
        "Records human abandonment only: the run becomes cancelled and history is appended. Task status, evidence, approvals and delivery acceptance are unchanged.",
      ],
      abandonedRecorded: ["已有人工放弃记录", "Human abandonment recorded"],
      abandonActor: ["放弃人", "Abandoned by"],
      abandonAt: ["放弃时间", "Abandoned at"],
      cancelRunningTitle: ["终止当前运行", "Stop this run"],
      cancelRunningTruth: [
        "终止只调用原生 jobs.kill：运行由 runner 结算为 cancelled，不改变任务状态、证据、审批与交付确认。",
        "Stopping only calls the native jobs.kill: the runner settles the run as cancelled. Task status, evidence, approvals and delivery acceptance are unchanged.",
      ],
      cancelRunningReason: ["终止理由（必填）", "Stop reason (required)"],
      cancelRunningConfirm: [
        "我确认终止这次运行：结束时只停止执行，运行由 runner 结算为 cancelled，不改任务状态、证据、审批与交付。",
        "I confirm stopping this run: it only ends the execution, the runner settles the run as cancelled, and task status, evidence, approvals and delivery stay unchanged.",
      ],
      cancelRunningSubmit: ["终止运行", "Stop run"],
      cancelRunningDone: [
        "已请求终止；运行记录由 runner 结算为 cancelled。",
        "Stop requested; the runner settles the run record as cancelled.",
      ],
      errRunStillAttached: ["该运行的句柄仍在本进程里，请用「终止当前运行」而不是人工终止。", "This process still holds the run's handle; cancel it rather than terminating it by hand."],
      terminateRun: ["确认终止（句柄不在本进程）", "Confirm termination (handle not in this process)"],
      terminateHint: [
        "这条运行已启动，但任务句柄不在当前进程里，无法按普通方式取消。只有在你已确认子 Agent 及其后代进程都已停止时，才填写下面的核实说明并终止；插件不会自行判断进程是否存活。",
        "This run started, but its job handle is not in this process, so it cannot be cancelled normally. Fill in the check below only after you have confirmed the child agent and its descendant processes are gone; the plugin does not judge liveness itself.",
      ],
      terminateReason: ["终止理由（必填）", "Reason (required)"],
      terminateBasis: ["核实依据（必填，写清你查了什么、看到什么）", "What you checked and saw (required)"],
      terminateReferences: ["核查资料（每行一项，可留空）", "References (one per line, optional)"],
      terminateConfirm: ["我已确认该子 Agent 及其后代进程均已停止。", "I confirm the child agent and its descendant processes have stopped."],
      terminatedRecorded: ["已记录人工终止", "Termination recorded"],
      errRunExecutorGone: ["找不到该运行的执行句柄（应用可能重启过），记录不会被自动改写；请确认进程已不存在后由人工按 unknown 结案。", "This process no longer holds that run's executor handle, so the record is not rewritten; confirm the process is gone and close it as unknown by hand."],
      cancelRunningForeign: [
        "该运行由另一个宿主实例创建，本页面无法终止；请在创建它的宿主实例中操作。",
        "This run was created by another Host instance, so this page cannot stop it. Use the Host instance that created it.",
      ],
      contextTruncated: [
        "以下文档在恢复上下文中被截断（每篇上限 1000 字符），完整内容请用读取文档或导出 Markdown：",
        "These documents were truncated in the context (1000 characters each). Read the documents or export Markdown for the full text:",
      ],
      strandedNeedsEvidence: [
        "此残留运行已进入启动或运行状态：解除需要执行终止证据，本版未提供该人工动作，也不会自动恢复或重跑。请勿手改运行文件。",
        "This stranded run already reached starting or running. Releasing it requires execution termination evidence, which this version does not provide; runs are never recovered or replayed automatically. Do not edit run files by hand.",
      ],
      executePrompt: [
        "使用 engineering_plan get/context 核对此变更的最新方案版本、修订、用户审批、任务依赖及 verifying 状态；不匹配时报告差异并停止本请求。调用 engineering_verify，参数如下：\n{payload}\nrequestId 对应这一次显式请求。网络重试或工具重放必须复用同一个 requestId，不生成新ID重跑。检查实际退出码及输出；命令 succeeded 不等于 criteria passed，不伪造验收证据。",
        "Use engineering_plan get/context to check latest plan version, revision, human approval, dependencies and verifying status. Report mismatches and stop this request. Call engineering_verify with:\n{payload}\nThis requestId identifies this explicit request. Network retries and tool replay must reuse it rather than generate a new ID and rerun. Inspect actual exit code and output; succeeded does not mean criteria passed, and do not fabricate evidence.",
      ],
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
      frontierCount: ["当前可开始", "Ready to start"],
      matrix: ["逐项验收证据矩阵", "Acceptance evidence matrix"],
      missingEvidence: ["缺少当前版本证据", "No current-version evidence"],
      commandNeverRan: ["尚未运行", "Not run yet"],
      noCriteria: ["尚未配置验收标准", "No acceptance criteria configured"],
      readyBlockedReasons: ["此刻还不能开始的原因", "Why this task cannot start yet"],
      readyApprovalRequired: ["当前方案未获人工批准", "The current plan has no human approval"],
      readyNotPending: ["任务不在待执行状态", "The task is not pending"],
      readyDependency: ["前置任务未完成", "An upstream task is not completed"],
      readyConflict: ["预计文件与在执行的别的任务重叠", "Expected files overlap a running task"],
      readyActiveRun: ["该任务已有未结束的运行", "This task already has an unfinished run"],
      readyUnresolvedUnknown: ["存在未结案的 unknown 运行", "An unknown run is still unresolved"],
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
      diagramPreview: ["图形预览", "Diagram preview"],
      diagramEmpty: ["尚无图源，输入 Mermaid 后显示预览。", "Enter Mermaid source to preview a diagram."],
      diagramLoading: ["正在渲染图形…", "Rendering diagram…"],
      diagramError: ["图形渲染失败，请检查下方图源：", "Diagram rendering failed; check the source below:"],
      diagramTimeout: ["离线渲染器加载或渲染超时。", "Offline renderer loading or rendering timed out."],
      diagramUnavailable: ["当前运行时未提供本地资源解析能力，图源仍可编辑。", "Local asset resolution is unavailable; source remains editable."],
      diagramLimit: ["预览上限为 50,000 字符，请精简图源。", "Preview is limited to 50,000 characters; shorten the source."],
      emptyPlanning: [
        "先创建或选择变更，再填写六项规划准备状态和评审要求。",
        "Create or select a change to edit six readiness sections and review requirements.",
      ],
      emptyTasks: [
        "选择变更后按真实运行状态查看任务看板、依赖与阻塞。",
        "Select a change to view the task board, dependencies and blockers by actual status.",
      ],
      emptyQuality: [
        "选择变更后逐项查看任务验收标准与最新证据。",
        "Select a change to inspect acceptance criteria and latest evidence.",
      ],
      confirmTask: ["确认完成", "Confirm done"],
      noticeReviewTasks: ["{count} 项待你确认完成", "{count} awaiting your confirmation"],
      autoDiagramHint: [
        "按任务与依赖自动推导，任务一动就重画；要固定图示就在架构文档里画。",
        "Derived from the tasks and their dependencies, redrawn whenever a task moves. Draw in the architecture document to pin a diagram.",
      ],
      autoDiagramWorkspace: ["其他", "workspace"],
      goDelivery: ["去确认交付", "Review delivery"],
      openInSidebar: ["在侧边栏打开", "Open in side panel"],
      sidebarHint: ["侧边栏可与会话并排显示：打开后左侧仍可继续对话。", "The side panel sits beside the conversation, so chatting stays visible."],
      sidebarCopied: ["侧边栏里没有会话输入框，已改为复制到剪贴板。", "The side panel has no chat composer here, so the request went to the clipboard."],
      sidebarTabDescription: ["工程研发规划、任务看板与交付门禁", "Engineering plan, task board and delivery gates"],
      toolReady: ["可开始", "ready"],
      toolRunning: ["执行中", "running"],
      toolFailed: ["失败", "failed"],
      cmdChanges: ["{count} 个变更", "{count} changes"],
      cmdRuns: ["{count} 条运行", "{count} runs"],
      cmdTasks: ["{count} 个任务", "{count} tasks"],
      cmdTasksDone: ["完成 {done}", "{done} done"],
      cmdBlockers: ["{count} 个阻塞", "{count} blockers"],
      cmdWarnings: ["{count} 条告警", "{count} warnings"],
      cmdMore: ["另有 {count} 项，见工作台", "{count} more in the workbench"],
      cmdActList: ["变更列表", "Change list"],
      cmdActGet: ["变更详情", "Change detail"],
      cmdActGate: ["门禁检查", "Gate check"],
      cmdActReady: ["可开始任务", "Ready tasks"],
      cmdActRuns: ["运行记录", "Run records"],
      cmdActContext: ["恢复上下文", "Context"],
      cmdActExport: ["导出", "Export"],
      cmdActQuery: ["状态查询", "State query"],
      cmdNeedsHuman: ["{count} 项需要你处理", "{count} need your action"],
      cmdDetailMore: ["展开看工作台", "Open the workbench for details"],
      archSection: ["架构与设计文档", "Architecture and design documents"],
      noticeTitle: ["需要你处理", "Needs your action"],
      noticeReview: ["计划待你评审：在工作台确认方案", "Plan awaits your review in the workbench"],
      noticeBlockers: ["{count} 项送达阻塞", "{count} delivery blockers"],
      noticeUnknown: ["有运行状态待确认", "A run state needs resolution"],
      moreActions: ["更多操作", "More actions"],
    };
    Object.assign(words, {
  gateBlocked: ["核心判定：尚未就绪，原因如下。","Core verdict: not ready, for the reasons below."],
      errUnknownCode: ["操作被拒绝（代码：", "The operation was refused (code: "],
      runTruth: [
        "命令 succeeded 仅代表执行成功，不代表验收标准 passed。历史版本记录仅供追溯；active 不等于 unknown，不自动恢复或重跑。",
        "A succeeded command is not a passed acceptance criterion. Historical versions are for audit only; active is not unknown and runs are never automatically recovered or replayed.",
      ],
      commandRequest: ["验证命令请求", "Verification command request"],
      verifyEligibility: [
        "仅当前方案已获用户批准且处于 verifying 的任务可请求执行验证命令。",
        "Command requests require current human approval and a task in verifying state.",
      ],
      unknownConfirm: [
        "我确认旧 Host 已停止，残留 job/process 和工作区影响已检查。",
        "I confirm the old Host has stopped and remaining jobs/processes and workspace effects have been inspected.",
      ],
      unknownHint: [
        "此操作只记录人工结案原因，不把运行改为成功，也不自动重跑。",
        "This only records a human resolution reason. It does not mark the run successful or rerun it.",
      ],
      abandonConfirm: [
        "我确认该预留从未启动（无 jobId），放弃为终态且不可恢复。",
        "I confirm this reservation never started (no jobId); abandonment is terminal and cannot be undone.",
      ],
      abandonHint: [
        "只记录人工放弃：运行记为 cancelled 并追加历史；不改变任务状态、证据、审批与交付确认。",
        "Records human abandonment only: the run becomes cancelled and history is appended. Task status, evidence, approvals and delivery acceptance are unchanged.",
      ],
      cancelRunningTruth: [
        "终止只调用原生 jobs.kill：运行由 runner 结算为 cancelled，不改变任务状态、证据、审批与交付确认。",
        "Stopping only calls the native jobs.kill: the runner settles the run as cancelled. Task status, evidence, approvals and delivery acceptance are unchanged.",
      ],
      cancelRunningConfirm: [
        "我确认终止这次运行：结束时只停止执行，运行由 runner 结算为 cancelled，不改任务状态、证据、审批与交付。",
        "I confirm stopping this run: it only ends the execution, the runner settles the run as cancelled, and task status, evidence, approvals and delivery stay unchanged.",
      ],
      cancelRunningDone: [
        "已请求终止；运行记录由 runner 结算为 cancelled。",
        "Stop requested; the runner settles the run record as cancelled.",
      ],
      terminateHint: [
        "这条运行已启动，但任务句柄不在当前进程里，无法按普通方式取消。只有在你已确认子 Agent 及其后代进程都已停止时，才填写下面的核实说明并终止；插件不会自行判断进程是否存活。",
        "This run started, but its job handle is not in this process, so it cannot be cancelled normally. Fill in the check below only after you have confirmed the child agent and its descendant processes are gone; the plugin does not judge liveness itself.",
      ],
      cancelRunningForeign: [
        "该运行由另一个宿主实例创建，本页面无法终止；请在创建它的宿主实例中操作。",
        "This run was created by another Host instance, so this page cannot stop it. Use the Host instance that created it.",
      ],
      contextTruncated: [
        "以下文档在恢复上下文中被截断（每篇上限 1000 字符），完整内容请用读取文档或导出 Markdown：",
        "These documents were truncated in the context (1000 characters each). Read the documents or export Markdown for the full text:",
      ],
      strandedNeedsEvidence: [
        "此残留运行已进入启动或运行状态：解除需要执行终止证据，本版未提供该人工动作，也不会自动恢复或重跑。请勿手改运行文件。",
        "This stranded run already reached starting or running. Releasing it requires execution termination evidence, which this version does not provide; runs are never recovered or replayed automatically. Do not edit run files by hand.",
      ],
      executePrompt: [
        "使用 engineering_plan get/context 核对此变更的最新方案版本、修订、用户审批、任务依赖及 verifying 状态；不匹配时报告差异并停止本请求。调用 engineering_verify，参数如下：\n{payload}\nrequestId 对应这一次显式请求。网络重试或工具重放必须复用同一个 requestId，不生成新ID重跑。检查实际退出码及输出；命令 succeeded 不等于 criteria passed，不伪造验收证据。",
        "Use engineering_plan get/context to check latest plan version, revision, human approval, dependencies and verifying status. Report mismatches and stop this request. Call engineering_verify with:\n{payload}\nThis requestId identifies this explicit request. Network retries and tool replay must reuse it rather than generate a new ID and rerun. Inspect actual exit code and output; succeeded does not mean criteria passed, and do not fabricate evidence.",
      ],

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
      readinessHint: [
        "状态由规划作者明确标记，代表准备情况；不代表测试或独立验收通过。",
        "Readiness is explicitly declared by the plan author, not a test or independent verification result.",
      ],
      evidenceTruth: [
        "展示当前方案版本的最新记录。结果来自记录者的报告，工作台未自动执行检查或独立验证。",
        "Shows the latest record for this plan version. Results are attributed reports; the workbench does not run checks or independently verify them.",
      ],
      dependencyHint: [
        "箭头从前置任务指向依赖它的任务，基于当前草稿。此图不代表模块架构。",
        "Arrows run from prerequisites to dependent tasks in the current draft. This is not a module architecture diagram.",
      ],
      emptyPlanning: [
        "先创建或选择变更，再填写六项规划准备状态和评审要求。",
        "Create or select a change to edit six readiness sections and review requirements.",
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
      "awaiting-review",
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
    /* BEGIN GATE SUMMARY */
// The delivery gate belongs to the core, not the browser: the local task/run checks below cannot
// see dispatch runs or per-criterion evidence, so the UI must not claim readiness on its own.
function gateQuery(input) { return { action: "gateStatus", changeId: input }; }
function gateMatches(record, change) {
  return !!record && !!change && record.changeId === change.id &&
    record.planVersion === change.planVersion && record.revision === change.revision;
}
function gateBlockerKey(code) {
  return {
    APPROVAL_REQUIRED: "gateApprovalRequired",
    ACTIVE_RUN: "gateActiveRun",
    UNRESOLVED_UNKNOWN: "gateUnresolvedUnknown",
    TASK_NOT_TERMINAL: "gateTaskNotTerminal",
    NO_COMPLETED_TASK: "gateNoCompletedTask",
    MISSING_EVIDENCE: "gateMissingEvidence",
  }[code] || null;
}
function gateBlockerDetail(blocker) {
  if (!blocker || typeof blocker !== "object") return "";
  return [blocker.taskId, blocker.status, blocker.criterion, blocker.kind, blocker.runId, blocker.state]
    .filter((value) => typeof value === "string" && value.length > 0).join(" · ");
}
// Warnings are informational: the core never lets them block delivery, because a manual check
// can be legitimate. They exist so a passed criterion cannot quietly hide that no command ran.
function gateWarningKey(code) { return { NO_SUCCEEDED_COMMAND: "gateWarnNoSucceededCommand" }[code] || null; }
function gateWarnings(list) {
  return list.map((warning) => {
    const key = gateWarningKey(warning?.code);
    return key ? t(key).replace("{task}", String(warning.taskId ?? "")) : String(warning?.code ?? "");
  }).join("；");
}
/* END GATE SUMMARY */
/* BEGIN READY SUMMARY */
// The board's "next task" hint used to be a local guess. The core now answers the same question
// (readyTasks) with the very rules transition enforces, so the board reads that instead of guessing.
function readyQuery(input) { return { action: "readyTasks", changeId: input }; }
function readyMatches(record, change) {
  return !!record && !!change && record.changeId === change.id && record.revision === change.revision;
}
function readySet(record) {
  return new Set(Array.isArray(record?.ready) ? record.ready : []);
}
function readyReasons(record, taskId) {
  const task = (Array.isArray(record?.tasks) ? record.tasks : []).find((item) => item.id === taskId);
  return Array.isArray(task?.reasons) ? task.reasons : [];
}
const READY_REASON_KEYS = {
  APPROVAL_REQUIRED: "readyApprovalRequired",
  TASK_NOT_PENDING: "readyNotPending",
  DEPENDENCY_BLOCKED: "readyDependency",
  FILE_CONFLICT: "readyConflict",
  ACTIVE_RUN: "readyActiveRun",
  UNRESOLVED_UNKNOWN: "readyUnresolvedUnknown",
};

function readyReasonKey(code) {
  return READY_REASON_KEYS[code] || null;
}

// Which command of a task has actually been run, and how did the last attempt end.
function latestCommandRun(runs, taskId, index) {
  if (!Array.isArray(runs)) return null;
  let best = null;
  for (const run of runs) {
    if (!run || run.taskId !== taskId || run.commandIndex !== index) continue;
    if (!best || String(run.updatedAt || "") >= String(best.updatedAt || "")) best = run;
  }
  return best;
}
/* END READY SUMMARY */
/* BEGIN DELIVERY RUNS SUMMARY */
// A null list means "not loaded yet", which is not the same as "a run is still active": the delivery
// card must not disguise a missing refresh as a blocked verdict.
function runsLoadedOf(records) { return Array.isArray(records); }
function runsBlockedOf(records, history) {
  if (!Array.isArray(records)) return false;
  return records.some((record) =>
    ["reserved", "starting", "running"].includes(record.state) ||
    (record.state === "unknown" && !(Array.isArray(history) ? history : []).some((entry) =>
      entry.kind === "verification-unknown-resolved" &&
      entry.runId === record.runId && entry.runRevision === record.revision &&
      entry.actor?.kind === "user")));
}
/* END DELIVERY RUNS SUMMARY */
/* BEGIN PLAN COMPLETENESS SUMMARY */
// Mirrors the core approve() precondition so the button can explain itself instead of surfacing the
// engine's English INCOMPLETE_PLAN text.
function planIncomplete(draft) {
  if (!draft) return "";
  if (typeof draft.goal !== "string" || !draft.goal.trim()) return "planNoGoal";
  const tasks = Array.isArray(draft.tasks) ? draft.tasks : [];
  if (!tasks.length) return "planNoTasks";
  if (tasks.some((task) => !Array.isArray(task?.acceptanceCriteria) || !task.acceptanceCriteria.length)) return "planTaskNoCriteria";
  return "";
}

/* END PLAN COMPLETENESS SUMMARY */
/* BEGIN TAB SEMANTICS */
// One tab stop for the whole strip; arrow / Home / End move between panels (ARIA tabs pattern).
const TABS = ["plan", "tasks", "resources"];
/* END TAB SEMANTICS */
/* BEGIN ERROR MESSAGE SUMMARY */
// Core refusals arrive as "CODE: English detail". The workspace is bilingual, so the codes a human can
// actually hit get a localized sentence; anything unmapped keeps the raw text rather than inventing a
// translation for a code nobody has seen.
const ERROR_KEYS = {
  APPROVAL_REQUIRED: "errApprovalRequired",
  REVISION_CONFLICT: "errRevisionConflict",
  PLAN_LOCKED: "errPlanLocked",
  DELIVERY_LOCKED: "errDeliveryLocked",
  DEPENDENCY_BLOCKED: "errDependencyBlocked",
  FILE_CONFLICT: "errFileConflict",
  EVIDENCE_REQUIRED: "errEvidenceRequired",
  EVIDENCE_EMPTY: "errEvidenceEmpty",
  INVALID_TRANSITION: "errInvalidTransition",
  VERIFICATION_RUN_BLOCKED: "errVerificationRunBlocked",
  DISPATCH_RUN_BLOCKED: "errDispatchRunBlocked",
  ABANDON_NOT_RESERVED: "errAbandonNotReserved",
  LOCK_BUSY: "errLockBusy",
  NOT_FOUND: "errNotFound",
  CORRUPT_STATE: "errCorruptState",
  STATE_TOO_LARGE: "errStateTooLarge",
  PATH_UNSAFE: "errPathUnsafe",
  ENGINEERING_WORKSPACE_MISMATCH: "errWorkspaceMismatch",
  FORBIDDEN: "errForbidden",
  REQUEST_CONFLICT: "errRequestConflict",
  ENGINEERING_SESSION_REQUIRED: "errSessionRequired",
  ENGINEERING_CANCELLED: "errCancelled",
  ENGINEERING_INVALID_INPUT: "errInvalidInput",
  ENGINEERING_UNKNOWN_ACTION: "errUnknownAction",
  ENGINEERING_HUMAN_APPROVAL_REQUIRED: "errHumanOnlyAction",
  ENGINEERING_TOOL_EXECUTION_REQUIRED: "errToolExecutionRequired",
  ENGINEERING_RUN_NOT_RUNNING: "errRunNotRunning",
  ENGINEERING_RUN_WITHOUT_JOB: "errRunWithoutJob",
  ENGINEERING_RUN_FOREIGN_HOST: "errRunForeignHost",
  ENGINEERING_RUN_EXECUTOR_GONE: "errRunExecutorGone",
  ENGINEERING_RUN_STILL_ATTACHED: "errRunStillAttached",
  ENGINEERING_INPUT_TOO_LARGE: "errInputTooLarge",
  INCOMPLETE_PLAN: "planIncompleteError",
};
// Only these details carry identifiers a human needs to act on.
const ERROR_DETAIL_CODES = ["DEPENDENCY_BLOCKED", "FILE_CONFLICT", "VERIFICATION_RUN_BLOCKED", "DISPATCH_RUN_BLOCKED"];
function errorParts(message) {
  const text = String(message || "").trim();
  const at = text.indexOf(":");
  if (at < 0) return { code: text, detail: "" };
  return { code: text.slice(0, at).trim(), detail: text.slice(at + 1).trim() };
}

function errorMessageKey(message) {
  const { code } = errorParts(message);
  return ERROR_KEYS[code] || "";
}
function errorDisplay(message) {
  const text = String(message || "");
  const { code, detail } = errorParts(text);
  const key = ERROR_KEYS[code];
  if (!key) return text;
  const head = t(key);
  if (code === "INVALID_TRANSITION" && detail) return head + t("errInvalidTransitionWith") + detail;
  if (detail && ERROR_DETAIL_CODES.includes(code)) return head + " " + detail;
  return head;
}
/* END ERROR MESSAGE SUMMARY */
/* BEGIN POLL IDENTITY SUMMARY */
// A poll answer can arrive after the human switched change, or after a newer poll started: the sequence
// catches the switch, the id catches a body that belongs to another change.
function pollTargetIsCurrent(sequence, currentSequence, liveId, targetId) {
  return typeof targetId === "string" && targetId.length > 0 && sequence === currentSequence && liveId === targetId;
}
// Same rule as the stop drafts: only the visible change's abandonment draft blocks polling.
function abandonmentDirty(forms, changeId) {
  if (!changeId) return false;
  return Object.values(forms || {}).some((form) => {
    if (!form || !(form.reason || form.confirmed)) return false;
    try {
      const identity = JSON.parse(form.key);
      return Array.isArray(identity) && identity[0] === changeId;
    } catch (_) {
      return false;
    }
  });
}
/* END POLL IDENTITY SUMMARY */
/* BEGIN TASK EXECUTION FIELDS */
    // Core-accepted task execution fields. Missing or malformed values read as the core defaults.
    const EXECUTORS = ["local", "subagent", "external"];
    const EXECUTOR_LABELS = {
      local: "executorLocal",
      subagent: "executorSubagent",
      external: "executorExternal",
    };
    const RETRY_LIMIT = 10;
    // Accepts the form text (ASCII or full width comma, newlines) as well as the stored array.
    const parseModules = (value) =>
      Array.isArray(value)
        ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
        : [
            ...new Set(
              String(value ?? "")
                .split(/[,，\r\n]/)
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ];
    const executorOf = (value) => (EXECUTORS.includes(value) ? value : "local");
    const approvalOf = (value) => value === true;
    const retriesOf = (value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return 0;
      return Math.min(RETRY_LIMIT, Math.max(0, Math.trunc(number)));
    };
    const taskExecution = (task) => ({
      affectedModules: parseModules(task?.affectedModules),
      executor: executorOf(task?.executor),
      requiredApproval: approvalOf(task?.requiredApproval),
      maxRetries: retriesOf(task?.maxRetries),
    });
    const MODULE_LIMIT = 200;
    // Returns a locale key when the raw form values would be rejected or silently clamped by core.
    const executionProblem = (task) => {
      const modules = parseModules(task?.affectedModules);
      if (modules.some((item) => item.length > MODULE_LIMIT || item.includes("\0"))) return "modulesTooLong";
      const raw = String(task?.maxRetries ?? "").trim();
      if (raw !== "" && !/^\d+$/.test(raw)) return "retriesRange";
      if (raw !== "" && Number(raw) > RETRY_LIMIT) return "retriesRange";
      return null;
    };
    // Compact single line summary for the task card; absent values are dropped.
    const taskMetaText = (task, translate) => {
      const execution = taskExecution(task);
      const parts = [];
      if (execution.affectedModules.length) {
        parts.push(translate("affectedModulesLabel") + ": " + execution.affectedModules.join(", "));
      }
      parts.push(translate("executor") + ": " + translate(EXECUTOR_LABELS[execution.executor]));
      if (execution.requiredApproval) parts.push(translate("approvalRequiredNote"));
      if (execution.maxRetries > 0) {
        parts.push(translate("retriesLabel") + ": " + String(execution.maxRetries));
      }
      return parts.join(" · ");
    };
    /* END TASK EXECUTION FIELDS */
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
    function planApproved(change) {
      return !!change?.approvals?.some((item) => item.planVersion === change.planVersion && item.actor?.kind === "user");
    }
    // 只有版本冲突才需要「复制草稿后重新加载」的提示；损坏、权限、路径等错误给出这句会误导。
    function revisionConflict(error) {
      return typeof error === "string" && error.startsWith("REVISION_CONFLICT");
    }
    function dispatchRequestBlock(change, taskId, list, unsettled, verifyList) {
      if (unsettled) return "saveFirst";
      if (!change || !change.approvals?.some((item) => item.planVersion === change.planVersion && item.actor?.kind === "user")) return "approvalRequired";
      if (change.deliveryAcceptance?.planVersion === change.planVersion) return "deliveryFrozen";
      const task = change.tasks.find((item) => item.id === taskId);
      if (!task || task.status !== "pending") return "dispatchPendingOnly";
      if ((task.dependencies || []).some((id) => change.tasks.find((item) => item.id === id)?.status !== "completed")) return "dispatchDependencies";
      if (!list || list.changeId !== change.id || list.runs === null || list.stale || list.loading || list.error) return "dispatchRefreshRequired";
      if (list.runs.some((record) => record.changeId !== change.id ||
        (!["returned", "failed", "cancelled", "error"].includes(record.state) &&
          !(record.state === "unknown" && (change.history || []).some((entry) =>
            entry.kind === "dispatch-unknown-resolved" && entry.runId === record.runId &&
            entry.runRevision === record.revision && entry.actor?.kind === "user"))))) return "dispatchRunBlocked";
      // The verification list is stored as a plain array, while test harnesses pass an envelope; both
      // shapes are accepted, and "unknown" is never mistaken for "no runs".
      if (verifyList !== undefined) {
        const runs = Array.isArray(verifyList) ? verifyList : verifyList && verifyList.runs;
        const owner = Array.isArray(verifyList) ? null : verifyList && verifyList.changeId;
        const busyList = Array.isArray(verifyList) ? false : Boolean(verifyList && (verifyList.loading || verifyList.stale));
        if (runs === null || runs === undefined || busyList || (owner !== null && owner !== change.id))
          return "dispatchVerificationLoading";
        if (runs.some((record) => record.changeId === change.id && record.taskId === taskId &&
          !["succeeded", "failed", "cancelled", "timed_out", "error"].includes(record.state) &&
          !(record.state === "unknown" && (change.history || []).some((entry) =>
            entry.kind === "verification-unknown-resolved" && entry.runId === record.runId &&
            entry.runRevision === record.revision && entry.actor?.kind === "user"))))
          return "dispatchVerificationRunning";
      }
      const liveVerification = (verifyList?.runs || []).some((record) =>
        record.taskId === taskId &&
        !["succeeded", "failed", "error", "cancelled", "timed_out"].includes(record.state) &&
        !(record.state === "unknown" && (change.history || []).some((entry) =>
          entry.kind === "verification-unknown-resolved" && entry.runId === record.runId &&
          entry.runRevision === record.revision && entry.actor?.kind === "user")));
      if (liveVerification) return "dispatchVerificationRunning";
      return "";
    }
    function dispatchResolutionKey(change, record) {
      return JSON.stringify([change.id, record.runId, record.revision]);
    }
    function dispatchResolutionHistory(change, record) {
      return (change.history || []).find((entry) => entry.kind === "dispatch-unknown-resolved" &&
        entry.runId === record.runId && entry.runRevision === record.revision && entry.actor?.kind === "user");
    }
    function resetDispatchConfirmations(forms) {
      if (!Object.values(forms).some((form) => form.confirmed)) return forms;
      return Object.fromEntries(Object.entries(forms).map(([key, form]) => [key, { ...form, confirmed: false }]));
    }
    function bindVerificationResolution(form, change, record) {
      const key = JSON.stringify([change.id, record.runId, record.revision]);
      return { key, reason: form?.reason || "", confirmed: form?.key === key && form.confirmed === true };
    }
    // A stranded reservation can be abandoned by a human only while it never started: state reserved and no jobId.
    // starting / running records are never eligible here; releasing those needs execution termination evidence.
    function abandonmentEligible(record) {
      return record?.state === "reserved" && (record.jobId === null || record.jobId === undefined);
    }
    function strandedNotice(record) {
      if (!record) return "";
      if (["starting", "running"].includes(record.state)) return terminationEligible(record) ? "terminateRun" : "strandedNeedsEvidence";
      return abandonmentEligible(record) ? "abandonRun" : "";
    }
    function abandonmentKey(change, kind, record) {
      return JSON.stringify([change.id, kind, record.runId, record.revision]);
    }
    function bindAbandonment(form, change, kind, record) {
      const key = abandonmentKey(change, kind, record);
      return { key, reason: form?.reason || "", confirmed: form?.key === key && form.confirmed === true };
    }
    function abandonmentHistory(change, kind, record) {
      return (change.history || []).find((entry) => entry.kind === "run-abandoned" && entry.runKind === kind &&
        entry.runId === record.runId && entry.runRevision === record.revision && entry.actor?.kind === "user");
    }
    function abandonmentPayload(change, kind, record, form) {
      if (!change || !record || record.changeId !== change.id || !["dispatch", "verification"].includes(kind) ||
        !abandonmentEligible(record) ||
        !Number.isSafeInteger(change.revision) || change.revision < 1 ||
        !Number.isSafeInteger(record.revision) || record.revision < 1 ||
        form?.key !== abandonmentKey(change, kind, record) ||
        !form.reason?.trim() || form.confirmed !== true ||
        abandonmentHistory(change, kind, record)) return null;
      return {
        action: "abandonRun", changeId: change.id, kind, runId: record.runId,
        expectedRevision: change.revision, expectedRunRevision: record.revision, reason: form.reason.trim(),
      };
    }
    // A run that started but whose job handle is not in this process cannot be cancelled normally:
    // cancelRun reports ENGINEERING_RUN_EXECUTOR_GONE. The human path is terminateRun, which records an
    // attestation instead of pretending the plugin observed the process exit.
    function terminationEligible(record) {
      return !!record && ["starting", "running"].includes(record.state) &&
        typeof record.jobId === "string" && record.jobId.length > 0;
    }
    function terminationKey(change, kind, record) {
      return JSON.stringify(["terminate", change.id, kind, record.runId, record.revision]);
    }
    function bindTermination(form, change, kind, record) {
      const key = terminationKey(change, kind, record);
      const same = form?.key === key;
      return {
        key,
        reason: same ? form.reason || "" : "",
        basis: same ? form.basis || "" : "",
        references: same ? form.references || "" : "",
        confirmed: same && form.confirmed === true,
      };
    }
    function terminationHistory(change, kind, record) {
      return (change.history || []).find((entry) => entry.kind === "run-terminated-unattached" &&
        entry.runKind === kind && entry.runId === record.runId && entry.actor?.kind === "user");
    }
    function terminationPayload(change, kind, record, form) {
      if (!change || !record || record.changeId !== change.id || !["dispatch", "verification"].includes(kind) ||
        !terminationEligible(record) ||
        !Number.isSafeInteger(change.revision) || change.revision < 1 ||
        !Number.isSafeInteger(record.revision) || record.revision < 1 ||
        form?.key !== terminationKey(change, kind, record) ||
        !form.reason?.trim() || !form.basis?.trim() || form.confirmed !== true ||
        terminationHistory(change, kind, record)) return null;
      const references = String(form.references || "").split("\n").map((line) => line.trim()).filter(Boolean);
      return {
        action: "terminateRun", changeId: change.id, kind, runId: record.runId,
        expectedRevision: change.revision, expectedRunRevision: record.revision,
        reason: form.reason.trim(),
        terminationEvidence: {
          confirmed: true, checkedAt: new Date().toISOString(),
          scope: "child-and-descendants-and-processes",
          basis: form.basis.trim(), references,
        },
      };
    }
    // The Host instance that owns this page is never sent to the client, so the newest loaded run record
    // is used as the page's own instance marker: it is the record the current Host just wrote.
    function runsHostInstance(records) {
      if (!Array.isArray(records)) return "";
      const usable = records.filter((record) => record && typeof record.hostInstanceId === "string" &&
        record.hostInstanceId.length > 0);
      if (usable.length === 0) return "";
      const ordered = usable.slice().sort((left, right) =>
        String(right.createdAt || "").localeCompare(String(left.createdAt || "")) ||
        String(right.runId || "").localeCompare(String(left.runId || "")));
      return ordered[0].hostInstanceId;
    }
    // A live run can be stopped by a human only while it still owns a job on this page's Host instance.
    // Reserved runs have no jobId (they use abandonment) and terminal runs have nothing left to kill.
    function cancelRunningEligible(record, pageHost) {
      return !!record && !!pageHost && ["starting", "running"].includes(record.state) &&
        typeof record.jobId === "string" && record.jobId.length > 0 &&
        typeof record.hostInstanceId === "string" && record.hostInstanceId === pageHost;
    }
    // No revision in the key: the runner bumps record.revision on every state change, and a typed
    // reason must survive starting -> running instead of being silently dropped.
    function cancelRunningKey(change, kind, record) {
      return JSON.stringify([change.id, kind, record.runId]);
    }
    function bindCancelRunning(form, change, kind, record) {
      const key = cancelRunningKey(change, kind, record);
      const matched = form?.key === key;
      return { key, reason: matched ? form.reason || "" : "", confirmed: matched && form.confirmed === true };
    }
    function cancelRunningPayload(change, kind, record, form, pageHost) {
      if (!change || !record || record.changeId !== change.id || !["dispatch", "verification"].includes(kind) ||
        !cancelRunningEligible(record, pageHost) ||
        form?.key !== cancelRunningKey(change, kind, record) ||
        !form.reason?.trim() || form.confirmed !== true) return null;
      return { action: "cancelRun", changeId: change.id, kind, runId: record.runId, reason: form.reason.trim() };
    }
    function cancelRunErrorKey(message) {
      const text = String(message || "");
      if (text.includes("ENGINEERING_RUN_EXECUTOR_GONE")) return "errRunExecutorGone";
      if (text.includes("ENGINEERING_RUN_FOREIGN_HOST")) return "cancelRunningForeign";
      return "";
    }
    // Drafts belong to a change; a draft typed on another change must never block this change's
    // polling, while the visible change's draft keeps polling paused like every other runtime draft.
    function cancelRunningDirty(forms, changeId) {
      if (!changeId) return false;
      return Object.values(forms || {}).some((form) => {
        if (!form || !(form.reason || form.confirmed)) return false;
        try {
          const identity = JSON.parse(form.key);
          return Array.isArray(identity) && identity[0] === changeId;
        } catch (_) {
          return false;
        }
      });
    }
    // A draft is dropped only once its run is positively loaded and no longer stoppable, so a typed
    // reason never disappears during a list reload that has not answered yet.
    function cancelRunningPrune(forms, change, verificationRuns, dispatchList) {
      const entries = Object.entries(forms || {});
      if (!change || entries.length === 0) return forms;
      const recordsFor = (kind) => {
        if (kind === "verification") return Array.isArray(verificationRuns) ? verificationRuns : null;
        if (dispatchList?.changeId !== change.id || !Array.isArray(dispatchList.runs)) return null;
        return dispatchList.runs;
      };
      const kept = entries.filter(([key]) => {
        let identity;
        try { identity = JSON.parse(key); } catch (_) { return false; }
        if (!Array.isArray(identity) || identity.length < 3) return false;
        // Another change's draft is kept in memory; it is simply not the visible change's draft.
        if (identity[0] !== change.id) return true;
        const records = recordsFor(identity[1]);
        if (records === null) return true;
        const record = records.find((entry) => entry && entry.runId === identity[2]);
        if (!record) return true;
        return cancelRunningEligible(record, runsHostInstance(records));
      });
      return kept.length === entries.length ? forms : Object.fromEntries(kept);
    }
    function expiredDispatchDrafts(change, list, forms) {
      if (list.changeId !== change.id || !Array.isArray(list.runs)) return [];
      return Object.entries(forms).flatMap(([key, form]) => {
        let identity;
        try { identity = JSON.parse(key); } catch (_) { return []; }
        if (!Array.isArray(identity) || identity[0] !== change.id ||
          !(form.reason || form.basis || form.references || form.confirmed)) return [];
        const record = list.runs.find((run) => run.changeId === change.id &&
          run.runId === identity[1] && run.revision === identity[2]);
        if (record?.state === "unknown" && !dispatchResolutionHistory(change, record)) return [];
        return [{ key, changeId: identity[0], runId: identity[1], runRevision: identity[2], form }];
      });
    }
    function dispatchResolutionPayload(change, record, form, checkedAt) {
      if (!change || record.changeId !== change.id || record.state !== "unknown" ||
        !Number.isSafeInteger(change.revision) || change.revision < 1 ||
        !Number.isSafeInteger(record.revision) || record.revision < 1 ||
        form?.key !== JSON.stringify([change.id, record.runId, record.revision]) ||
        !form.reason?.trim() || !form.basis?.trim() || form.confirmed !== true ||
        (change.history || []).some((entry) => entry.kind === "dispatch-unknown-resolved" &&
          entry.runId === record.runId && entry.runRevision === record.revision && entry.actor?.kind === "user")) return null;
      return { action: "resolveDispatchUnknown", changeId: change.id, expectedRevision: change.revision,
        runId: record.runId, expectedRunRevision: record.revision, reason: form.reason.trim(),
        terminationEvidence: { confirmed: true, checkedAt, scope: "child-and-descendants-and-processes",
          basis: form.basis.trim(), references: String(form.references || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean) } };
    }
    function cachedDispatchRequest(cache, change, taskId, makeId) {
      const key = JSON.stringify([change.id, change.planVersion, change.revision, taskId]);
      if (!cache.has(key)) cache.set(key, {
        changeId: change.id, taskId, expectedRevision: change.revision,
        planVersion: change.planVersion, requestId: makeId(),
      });
      return cache.get(key);
    }
    // Verification requests reuse one id for the same (change, plan version, revision, task, command)
    // attempt, matching the dispatch path: remounting the view must not mint a new attempt.
    function cachedVerifyRequest(cache, change, taskId, commandIndex, makeId) {
      const key = JSON.stringify([change.id, change.planVersion, change.revision, taskId, commandIndex]);
      if (!cache.has(key)) cache.set(key, {
        changeId: change.id, taskId, expectedRevision: change.revision,
        planVersion: change.planVersion, commandIndex, requestId: makeId(),
      });
      return cache.get(key);
    }
    function dispatchListState(state, event) {
      if (event.type === "select") {
        if (state.changeId === event.changeId) return state;
        return { changeId: event.changeId, runs: null, loading: false, stale: false, error: "", requestId: null };
      }
      if (state.changeId !== event.changeId) return state;
      if (event.type === "start") return { ...state, loading: true, error: "", requestId: event.requestId };
      if (state.requestId !== event.requestId) return state;
      if (event.type === "success") return { ...state, runs: event.runs, loading: false, stale: false, error: "", requestId: null };
      if (event.type === "error") return { ...state, loading: false, stale: state.runs !== null, error: event.error, requestId: null };
      return state;
    }
    function dispatchRecordFields(record) {
      return {
        metadata: Object.entries({
          runId: record.runId, taskId: record.taskId, planVersion: record.planVersion,
          state: record.state, childId: record.childId, jobId: record.jobId,
          createdAt: record.createdAt, finishedAt: record.finishedAt, truncated: record.truncated,
        }).map(([key, value]) => [key, value == null ? "—" : String(value)]),
        output: [
          ["result.text", record.result?.text], ["stopReason", record.result?.stopReason],
          ["diagnostic", record.result?.diagnostic], ["error", record.error], ["reason", record.reason],
        ].map(([key, value]) => [key, value == null || value === "" ? "—" : String(value)]),
      };
    }
    function bindDelivery(form, change, reset = false) {
      const matches = form?.changeId === change?.id && form?.planVersion === change?.planVersion;
      return {
        note: form?.note || "", changeId: change?.id, planVersion: change?.planVersion,
        confirmed: !reset && matches && !!form?.confirmed,
        reconfirm: !!form?.reconfirm || (!!form?.confirmed && (reset || !matches)),
      };
    }
    function deliveryRequestAllowed(kind, change) {
      return !["task", "verify"].includes(kind) ||
        change?.deliveryAcceptance?.planVersion !== change?.planVersion;
    }
    function archivedReviews(change) {
      return (change.history || []).filter((entry) => entry.snapshot || entry.kind === "task-restarted")
        .map((entry) => {
          const snapshot = entry.snapshot;
          const evidence = [...(snapshot?.evidence || entry.evidence || [])];
          for (const task of snapshot?.tasks || []) {
            for (const item of task.evidence || []) {
              if (!evidence.some((existing) => item.id ? existing.id === item.id : JSON.stringify(existing) === JSON.stringify(item)))
                evidence.push({ ...item, taskId: item.taskId || task.id });
            }
          }
          return {
            kind: entry.kind, planVersion: snapshot?.planVersion ?? entry.planVersion,
            recordedAt: entry.recordedAt, actor: entry.actor, taskId: entry.taskId,
            deliveryAcceptance: snapshot?.deliveryAcceptance || null,
            approvals: snapshot?.approvals || [], tasks: snapshot?.tasks || [], evidence,
          };
        });
    }
    // Polled snapshots must never overwrite unsubmitted input. `live` is the state at
    // the moment the response arrives; `latest` is the freshly read snapshot.
    function shouldApplyPolledChange(live, latest) {
      if (!live || !latest || !live.changeId) return false;
      if (live.unsettled || live.runtimeDirty) return false;
      if (latest.changeId !== live.changeId) return false;
      if (!Number.isSafeInteger(latest.revision)) return false;
      const known = Number.isSafeInteger(live.revision) ? live.revision : 0;
      return latest.revision > known;
    }
    // A verificationRuns response may only be used when it still belongs to the change
    // that asked for it and every record carries that change.
    function acceptRunsFor(changeId, data, currentId) {
      if (!changeId || currentId !== changeId) return { accepted: false, reason: "stale" };
      if (!Array.isArray(data?.runs)) return { accepted: false, reason: "invalidResponse" };
      if (data.runs.some((record) => record?.changeId !== changeId))
        return { accepted: false, reason: "invalidResponse" };
      return { accepted: true, runs: data.runs };
    }
    function activeReplanTasks(change) {
      return (change?.tasks || []).filter((task) => ["running", "verifying"].includes(task.status));
    }
    function replanBlocked(change) {
      return activeReplanTasks(change).length > 0;
    }
    function missingDependencies(tasks, dependencies) {
      const known = new Set((tasks || []).map((task) => task?.id).filter(Boolean));
      return (dependencies || []).filter((id) => !known.has(id));
    }
    // Rows without an acceptance criterion can never receive evidence; they are counted
    // apart instead of inflating the pending-evidence badge.
    function matrixTallies(rows) {
      const list = rows || [];
      const withCriterion = list.filter((row) => !!row.criterion);
      const count = (outcome) => withCriterion.filter((row) => row.latest?.outcome === outcome).length;
      return {
        passed: count("passed"),
        failed: count("failed"),
        pending: withCriterion.filter((row) => row.latest?.outcome === undefined).length,
        noCriteria: list.length - withCriterion.length,
      };
    }
    const css = `
.ep{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:auto}
.ep *{box-sizing:border-box}
.ep-layout{display:grid;grid-template-columns:228px minmax(0,1fr);min-height:0;flex:1}
.ep-side{padding:16px;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;background:var(--dsw-alias-bg-layer-1)}
.ep-main{padding:20px 24px 32px;min-width:0;overflow:auto;scroll-padding-bottom:32px}
.ep-workspace{max-width:1160px;margin-inline:auto}
.ep .ep-change-title{font-size:24px;line-height:1.25;margin:0;overflow-wrap:anywhere}
.ep-heading{display:grid;gap:8px}
.ep-goal,.ep-review-copy{white-space:pre-wrap;overflow-wrap:anywhere}
.ep-checklist{display:grid;margin:6px 0 12px}
.ep-checklist details{border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}
.ep-checklist summary{padding:9px 0}
.ep-checklist summary .ep-badge{float:right;margin-left:8px}
.ep-tools{margin-top:16px}
.ep-navigation{margin-bottom:12px}
.ep-board.ep-task-list{display:block}
.ep-task-summary{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ep-dag-node{cursor:pointer}
.ep-dag-node:focus-visible rect,.ep-dag-node:hover rect{stroke-width:3}
.ep-task-list .ep-column{min-height:0;margin-bottom:8px}
.ep-task-list .ep-column:not(:has(article)){display:none}
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
.ep-notices{display:grid;gap:6px;margin:10px 0 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);max-width:1160px;margin-inline:auto}
.ep-notices strong{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600}
.ep-notice-item{text-align:left;border:0;background:none;padding:2px 0;min-height:0;cursor:pointer;font:inherit;color:var(--dsw-alias-brand-primary)}
.ep-notice-item:hover:not(:disabled){text-decoration:underline;background:none}
.ep-command-quiet,.ep-tool-quiet{opacity:0.55;font-size:12px}
.ep-command-quiet summary,.ep-tool-quiet summary{font-size:12px}
.ep-command-alert,.ep-tool-alert{border-left:2px solid var(--dsw-alias-brand-primary);padding-left:8px}
.ep-command-alert summary,.ep-tool-alert summary{font-weight:600}
.ep-card{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin:12px 0;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}
.ep-list{display:flex;flex-direction:column;gap:8px;margin:14px 0}
.ep-list button{text-align:left;overflow-wrap:anywhere}
.ep-list small{display:block;color:var(--dsw-alias-label-secondary)}
.ep-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:16px}
.ep-badge{display:inline-block;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:2px 7px;font-size:12px}
.ep-error,.ep-success,.ep-warn{color:var(--dsw-alias-label-primary)}
.ep-error{border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.ep-success{border-color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
.ep-warn{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
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
.ep-next{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);font-size:13px}
@media(max-width:850px){.ep-readiness{grid-template-columns:1fr}.ep-board{grid-template-columns:repeat(7,minmax(205px,1fr))}}
.ep-compact .ep-layout{display:block}
.ep-compact .ep-side{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);padding-right:0;padding-bottom:12px;margin-bottom:12px}
.ep-compact .ep-readiness{grid-template-columns:1fr}
.ep-compact .ep-matrix{min-width:0}
.ep-compact .ep-tabs button{flex:1 1 auto}
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
        const pendingPlans = new Map();
        // Request ids must survive a view remount: a draft the user already inserted still names an
        // attempt, and returning to the workbench must reuse that attempt instead of inventing a new one.
        const requestMaps = new Map();
        function requestMapFor(sessionId, kind) {
          const key = String(sessionId) + "|" + kind;
          const existing = requestMaps.get(key);
          if (existing) return existing;
          const created = new Map();
          requestMaps.set(key, created);
          return created;
        }
        // Every command execution appends a line to the session transcript, and this workbench mounts
        // twice at once (the conversation view and the sidebar tab), so one human click used to run
        // the same read twice and each run left its own line behind. Reads now share one in-flight
        // promise and one short-lived result across mounts: a click costs the one command it actually
        // needs, and a panel that merely re-renders costs nothing.
        const readCache = new Map();
        const writeMarks = new Map();
        const READ_TTL = {
          list: 1500, get: 800, gateStatus: 1500, readyTasks: 1500,
          verificationRuns: 1200, dispatchRuns: 1200,
        };
        const WRITE_ACTIONS = new Set([
          "create", "save", "approve", "replan", "acceptDelivery", "resolveUnknown",
          "resolveDispatchUnknown", "abandonRun", "terminateRun", "transition", "amendTask",
          "evidence", "cancelRun",
        ]);
        function readKey(sessionId, input) {
          return [sessionId, input.action, input.changeId || "", input.taskId || ""].join("|");
        }
        function sharedRead(key, ttl, produce) {
          const hit = readCache.get(key);
          if (hit?.inflight) return hit.inflight;
          if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
          const inflight = produce().then((value) => {
            readCache.set(key, { at: Date.now(), value });
            return value;
          }, (cause) => {
            if (readCache.get(key)?.inflight === inflight) readCache.delete(key);
            throw cause;
          });
          readCache.set(key, { at: Date.now(), value: hit?.value, inflight });
          return inflight;
        }
        function markWrite(sessionId) {
          writeMarks.set(String(sessionId), Date.now());
        }
        // A write already returned the authoritative change, so the panel that made it can update the
        // list locally; the file watch would otherwise re-read the same state a moment later.
        function wroteRecently(sessionId, windowMs = 1200) {
          return Date.now() - (writeMarks.get(String(sessionId)) || 0) < windowMs;
        }
        // Mirrors the list projection in src/core.js:562 so a returned change can stand in for the
        // list row instead of paying for another read.
        function summaryOf(change) {
          return {
            id: change.id, title: change.title, goal: change.goal, mode: change.mode,
            revision: change.revision, planVersion: change.planVersion, status: change.status,
            updatedAt: change.updatedAt, taskCount: (change.tasks || []).length,
            completedTasks: (change.tasks || []).filter((task) => task.status === "completed").length,
          };
        }
        function mergeSummary(items, change) {
          const list = Array.isArray(items) ? items : [];
          if (!change?.id) return list;
          const index = list.findIndex((item) => item.id === change.id);
          const next = list.slice();
          if (index < 0) next.push(summaryOf(change));
          else next[index] = { ...list[index], ...summaryOf(change) };
          return next.sort((left, right) => String(left.id).localeCompare(String(right.id)));
        }
        ctx.effect(() => () => {
          draftCache.clear();
          pendingPlans.clear();
          requestMaps.clear();
          readCache.clear();
          writeMarks.clear();
        });
        const graph = {
          pending: ["running", "blocked", "cancelled"],
          running: ["verifying", "blocked", "failed", "cancelled"],
          verifying: ["running", "blocked", "failed", "completed", "awaiting-review", "cancelled"],
          "awaiting-review": ["running", "blocked", "cancelled", "completed"],
          blocked: ["pending", "running", "cancelled"],
          failed: ["pending", "running", "cancelled"],
          completed: [],
          cancelled: ["pending"],
        };
        // Deliberately not cryptographic: the value only correlates postMessage traffic with its own
        // iframe, and a missing secure context must not blank the panel.
        function previewNonce() {
          const provider = window.crypto;
          if (provider && typeof provider.randomUUID === "function") {
            try {
              return provider.randomUUID();
            } catch (_) {
              // A partially implemented crypto object must not take the whole panel down.
            }
          }
          return "ep-" + Date.now().toString(36) + "-" +
            Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        }
        let mermaidPromise;
        function loadMermaid(command) {
          mermaidPromise ??= (async () => {
            const chunks = [];
            for (let offset = 0; ; offset++) {
              const { chunk, done } = await command({ action: "mermaidAsset", offset });
              if (typeof chunk !== "string" || typeof done !== "boolean" || offset >= 32)
                throw new Error("Invalid Mermaid asset response");
              chunks.push(chunk);
              if (done) return chunks.join("");
            }
          })().catch((error) => {
            mermaidPromise = undefined;
            throw error;
          });
          return mermaidPromise;
        }
        function MermaidPreview({ source, label, command }) {
          const [mermaidAsset, setMermaidAsset] = React.useState("");
          const [assetFailed, setAssetFailed] = React.useState(false);
          const needsAsset = !!source?.trim() && source.length <= 50000;
          React.useEffect(() => {
            if (!needsAsset) return;
            let active = true;
            loadMermaid(command).then(
              (asset) => { if (active) setMermaidAsset(asset); },
              () => { if (active) setAssetFailed(true); },
            );
            return () => { active = false; };
          }, [needsAsset]);
          const frame = React.useRef(null);
          const revision = React.useRef(0);
          const [state, setState] = React.useState({ status: "loading" });
          const [loaded, setLoaded] = React.useState(0);
          const [dark, setDark] = React.useState(false);
          const nonce = React.useRef(null);
          if (!nonce.current) nonce.current = previewNonce();
          const documentText = React.useMemo(() => mermaidAsset ? mermaidFrameDocument(mermaidAsset, nonce.current) : "", [mermaidAsset]);
          React.useEffect(() => {
            const update = () => {
              const color = getComputedStyle(document.documentElement).getPropertyValue("color-scheme");
              setDark(color.trim() === "dark" || document.documentElement.getAttribute("data-theme") === "dark" || document.documentElement.classList.contains("dark"));
            };
            update();
            const observer = new MutationObserver(update);
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
            return () => observer.disconnect();
          }, []);
          React.useEffect(() => {
            const receive = (event) => {
              if (event.source !== frame.current?.contentWindow || event.data?.kind !== "ep-mermaid" || event.data?.nonce !== nonce.current) return;
              if (event.data.status === "loaded") { setLoaded((value) => value + 1); return; }
              if (event.data.revision === revision.current) setState({ status: event.data.status, error: event.data.error });
            };
            window.addEventListener("message", receive);
            return () => window.removeEventListener("message", receive);
          }, []);
          React.useEffect(() => {
            const current = ++revision.current;
            setState({ status: "loading" });
            if (!source?.trim()) return;
            // Armed before the frame reports itself: an iframe that never fires onLoad (or a vendor file
            // that never answers) must not leave the panel on "loading" forever.
            const timeout = setTimeout(() => setState((value) => value.status === "loading" ? { status: "error", error: t("diagramTimeout") } : value), 20000);
            if (!loaded) return () => clearTimeout(timeout);
            const timer = setTimeout(() => frame.current?.contentWindow.postMessage({ kind: "ep-mermaid-render", nonce: nonce.current, revision: current, source, dark, label }, "*"), 350);
            return () => { clearTimeout(timer); clearTimeout(timeout); };
          }, [source, dark, label, loaded, mermaidAsset]);
          if (!source?.trim()) return h("p", { className: "ep-muted" }, t("diagramEmpty"));
          if (assetFailed || source.length > 50000) return h("p", { role: "alert", className: "ep-error" }, t(assetFailed ? "diagramUnavailable" : "diagramLimit"));
          return h("section", { className: "ep-mermaid-preview", "aria-label": label + " " + t("diagramPreview") },
            h("strong", null, t("diagramPreview")),
            state.status === "loading" && h("p", { role: "status" }, t("diagramLoading")),
            state.status === "error" && h("p", { role: "alert", className: "ep-error" }, t("diagramError"), " ", state.error),
            documentText && h("iframe", { ref: frame, title: label + " " + t("diagramPreview"), sandbox: "allow-scripts", referrerPolicy: "no-referrer", srcDoc: documentText,
              onLoad: () => setLoaded((value) => value + 1),
              style: { width: "100%", height: "420px", border: "1px solid var(--dsw-alias-border-l2)", visibility: state.status === "ready" ? "visible" : "hidden" } }));
        }
        function Workbench(props) {
          return h(Panel, { ...props, key: props.sessionId || "none" });
        }
        function Panel(props) {
          const compact = !!props.compact;
          React.useSyncExternalStore(
            (fn) => ctx.locale.subscribe(fn),
            () => ctx.locale.getSnapshot(),
          );
          const restored = React.useRef(draftCache.get(props.sessionId));
          const [changes, setChanges] = React.useState([]);
          const [warnings, setWarnings] = React.useState([]);
          const [editingPlan, setEditingPlan] = React.useState(false);
          const [taskFilter, setTaskFilter] = React.useState("");
          const taskDetails = React.useRef(new Map());
          const [diagram, setDiagram] = React.useState("architecture");
          // The architecture block is the heaviest subtree on the page; it mounts only when unfolded.
          const [archOpen, setArchOpen] = React.useState(false);
          const [reviewOpen, setReviewOpen] = React.useState(false);
          // A list is the default: the seven-column board only pays off on a wide screen and pushes
          // every other task action out of view. The toggle beside the filter still offers it.
          const [taskLayout, setTaskLayout] = React.useState("list");
          const [replanConfirm, setReplanConfirm] = React.useState(false);
          const [change, setChange] = React.useState(null);
          const [draft, setDraft] = React.useState(null);
          const [dirty, setDirty] = React.useState(false);
          const [busy, setBusy] = React.useState(false);
          const lock = React.useRef(false);
          const mounted = React.useRef(true);
          const liveState = React.useRef({ change: null, unsettled: false, runtimeDirty: false });
          const [error, setError] = React.useState("");
          const [notice, setNotice] = React.useState("");
          const [tab, setTab] = React.useState("plan");
          const [creation, setCreation] = React.useState({ title: "", goal: "", mode: "lite" });
          const [pending, setPending] = React.useState(null);
          const [taskEdit, setTaskEdit] = React.useState(null);
          const [requestTaskId, setRequestTaskId] = React.useState("");
          const [verificationRuns, setVerificationRuns] = React.useState(null);
          const [dispatchList, setDispatchList] = React.useState(() => dispatchListState({}, { type: "select", changeId: null }));
          const dispatchSequence = React.useRef(0);
          const dispatchRequests = React.useRef(requestMapFor(props.sessionId, "dispatch"));
          const verifyRequests = React.useRef(requestMapFor(props.sessionId, "verify"));
          const [commandChoice, setCommandChoice] = React.useState("");
          const [resolution, setResolution] = React.useState({});
          const [dispatchResolution, setDispatchResolution] = React.useState({});
          const [abandonment, setAbandonment] = React.useState({});
          const [termination, setTermination] = React.useState({});
          // Human "stop this run" drafts, keyed by change + run kind + runId, plus the per-run submit error text.
          const [cancelRunning, setCancelRunning] = React.useState({});
          const [cancelErrors, setCancelErrors] = React.useState({});
          React.useEffect(() => {
            setDispatchResolution(resetDispatchConfirmations);
          }, [dispatchList]);
          const [delivery, setDelivery] = React.useState({ note: "", confirmed: false });
          // Authoritative delivery gate from the core; null means "not queried for this version yet".
          const [gate, setGate] = React.useState(null);
          const [gateError, setGateError] = React.useState("");
          const [ready, setReady] = React.useState(null);
          const [readyError, setReadyError] = React.useState("");
          const [readyBusy, setReadyBusy] = React.useState(false);
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
          const deliveryAccepted = !!change && change.deliveryAcceptance?.planVersion === change.planVersion;
          const editable = !change || ["draft", "approved"].includes(change.status);
          const referenceDirty = !!(reference.title || reference.source || reference.note);
          const unsettled = dirty || !!taskEdit || referenceDirty;
          const transitionDirty = !!(transition.taskId || transition.reason);
          const evidenceDirty = !!(
            evidence.taskId ||
            evidence.criterion ||
            evidence.note ||
            evidence.artifact
          );
          const runtimeDirty =
            transitionDirty || evidenceDirty || !!(delivery.note || delivery.confirmed) ||
            Object.values(resolution).some(form => form.reason || form.confirmed) ||
            cancelRunningDirty(cancelRunning, change?.id) ||
            abandonmentDirty(abandonment, change?.id) ||
            Object.keys(termination).length > 0 ||
            Object.values(dispatchResolution).some(form => form.reason || form.basis || form.references || form.confirmed);
          const edit = (patch) => {
            if (busy || !editable) return;
            setDraft((current) => ({ ...current, ...patch }));
            setDirty(true);
          };
          // Synchronised on every render so awaited poll responses compare against the
          // live draft instead of the closure captured when the interval was created.
          liveState.current = { change, unsettled, runtimeDirty };
          // The synchronisation effect no longer re-creates itself on every state change, so the
          // busy flag it guards against has to be read through a ref instead of a closure.
          const busyRef = React.useRef(busy);
          busyRef.current = busy;
          React.useEffect(() => {
            if (restored.current) {
              const cached = restored.current;
              setChange(cached.change);
              setDispatchList((previous) => dispatchListState(previous, { type: "select", changeId: cached.change.id }));
              setDraft(cached.draft);
              setDirty(cached.dirty);
              setTaskEdit(cached.taskEdit);
              setReference(cached.reference);
              if (cached.transition) setTransition(cached.transition);
              if (cached.evidence) setEvidence(cached.evidence);
              if (cached.delivery) setDelivery(bindDelivery(cached.delivery, cached.change));
              if (cached.dispatchResolution) setDispatchResolution(resetDispatchConfirmations(cached.dispatchResolution));
              if (cached.cancelRunning) setCancelRunning(cached.cancelRunning);
              if (cached.abandonment) setAbandonment(cached.abandonment);
              if (cached.resolution) setResolution(resetDispatchConfirmations('runId' in cached.resolution
                ? (cached.resolution.runId ? { [cached.resolution.runId]: cached.resolution } : {})
                : cached.resolution));
              restored.current = null;
            }
          }, []);
          React.useEffect(() => {
            if (change)
              draftCache.set(props.sessionId, {
                change,
                draft,
                dirty,
                taskEdit,
                reference,
                transition,
                evidence,
                resolution,
                dispatchResolution,
                cancelRunning,
                abandonment,
                delivery,
              });
          }, [change, draft, dirty, taskEdit, reference, transition, evidence, resolution, dispatchResolution, cancelRunning, abandonment, delivery]);
          // A stop draft survives change switches and list reloads; it is dropped only once its run is
          // loaded and no longer stoppable, so nothing is cleared while a list answer is still pending.
          React.useEffect(() => {
            if (!change) return;
            setCancelRunning((previous) => cancelRunningPrune(previous, change, verificationRuns, dispatchList));
          }, [change?.id, change?.revision, verificationRuns, dispatchList]);
          // Identity of what is on screen: a poll answer or an automatic run refresh that started
          // before a switch must never write into the view the human switched to.
          const changeSequence = React.useRef(0);
          const runsRefresh = React.useRef("");
          function noteChangeLoaded(next) {
            changeSequence.current += 1;
            if (next?.id) autoRefreshRuns(next.id, changeSequence.current);
          }
          // Loads the run list for the change that was just loaded, so the delivery card does not stay at
          // "not loaded" until the human clicks refresh. Failures stay silent on purpose: the card offers
          // the manual refresh anyway and nothing else may be blocked by this.
          function autoRefreshRuns(targetId, sequence, attempt = 0) {
            if (!mounted.current || runsRefresh.current === targetId) return;
            runsRefresh.current = targetId;
            Promise.resolve()
              .then(() => {
                if (sequence !== changeSequence.current) return "stale";
                // Background refresh only reads, so it does not wait for the human action lock; it
                // settles through acceptRunsFor plus the change sequence instead.
                return refreshRuns(targetId).then((outcome) => {
                  // The dispatch request form needs both lists; load them together so a fresh visit to
                  // the task board can offer the request without a detour to the records cards.
                  if (outcome === "applied" && typeof refreshDispatchRuns === "function" && mounted.current)
                    return refreshDispatchRuns(targetId).then(() => outcome);
                  return outcome;
                });
              })
              .catch(() => "failed")
              .then((outcome) => {
                if (runsRefresh.current === targetId) runsRefresh.current = "";
                // The first attempt can beat the render that publishes the new identity, and a save can
                // still hold the lock; both are retried briefly.
                if ((outcome === "stale" || outcome === "busy") && attempt < 2 && mounted.current &&
                  sequence === changeSequence.current && liveState.current.change?.id === targetId)
                  window.setTimeout(() => autoRefreshRuns(targetId, sequence, attempt + 1), 250);
              });
          }
          const loadChange = (value, { preserveRuntime = false, submitted = "", abandonedKey = "" } = {}) => {
            const next = normalize(value);
            setChange(next);
            if (!preserveRuntime) {
              setEditingPlan(false);
              setDiagram("architecture");
              setTaskFilter("");
              setReviewOpen(false);
            }
            setDispatchList((previous) => dispatchListState(previous, { type: "select", changeId: next.id }));
            setDraft(clone(next));
            setDirty(false);
            setTaskEdit(null);
            setReference({ title: "", source: "", kind: "reference", note: "" });
            setReplanConfirm(false);
            if (!["resolveDispatchUnknown", "resolveUnknown"].includes(submitted)) {
              setRequestTaskId("");
              setVerificationRuns(null);
              setCommandChoice("");
            }
            if (!preserveRuntime) setResolution({});
            if (!preserveRuntime) setDispatchResolution({});
            if (submitted === "abandonRun") {
              // Only the abandoned run's draft is cleared; every other run keeps whatever the human typed.
              if (abandonedKey) setAbandonment((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== abandonedKey)));
            } else if (!preserveRuntime) setAbandonment({});
            setDelivery((previous) => bindDelivery(
              !preserveRuntime || submitted === "acceptDelivery" ? { note: "", confirmed: false } : previous,
              next, submitted === "replan",
            ));
            setOutput(null);
            if (!preserveRuntime || submitted === "transition")
              setTransition({ taskId: "", status: "running", reason: "" });
            if (!preserveRuntime || submitted === "evidence")
              setEvidence({ taskId: "", criterion: "", outcome: "passed", note: "", artifact: "" });
            // The gate verdict was computed for the version that was queried; a load always replaces it.
            setGate(null);
            setGateError("");
            // The frontier is a verdict about one revision; a load always invalidates it.
            setReady(null);
            setReadyError("");
            // typeof keeps narrow harnesses that evaluate loadChange alone from failing here.
            if (typeof noteChangeLoaded === "function") noteChangeLoaded(next);
          };
          async function sendCommand(input) {
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
          async function command(input) {
            if (!props.sessionId) throw new Error(t("missingSession"));
            const action = input && input.action;
            if (WRITE_ACTIONS.has(action)) {
              markWrite(props.sessionId);
              return sendCommand(input);
            }
            const ttl = READ_TTL[action];
            if (!ttl) return sendCommand(input);
            return sharedRead(readKey(props.sessionId, input), ttl, () => sendCommand(input));
          }
          async function run(action) {
            if (lock.current) {
              if (mounted.current) setNotice(t("busy"));
              return;
            }
            lock.current = true;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await action();
            } catch (cause) {
              const message = String(cause?.message || cause);
              if (mounted.current) setError(errorDisplay(message));
            } finally {
              lock.current = false;
              if (mounted.current) setBusy(false);
            }
          }
          async function list(merged) {
            const data = await command({ action: "list" });
            if (mounted.current) {
              setChanges(merged ? mergeSummary(data.changes || [], merged) : (data.changes || []));
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
          React.useEffect(() => {
            let disposed = false;
            let reading = false;
            let lastRead = 0;
            const available = () => !disposed && !lock.current && !busyRef.current &&
              document.visibilityState !== "hidden";
            const synchronize = async () => {
              // A write this panel just made already returned the authoritative state, and its own file
              // change is about to arrive here; re-reading it would only add a transcript line for a
              // state nobody changed.
              if (!available() || reading || wroteRecently(props.sessionId)) return;
              reading = true;
              const sequence = changeSequence.current;
              try {
                const data = await command({ action: "list" });
                if (!available()) return;
                const items = data.changes || [];
                setChanges(items);
                setWarnings(data.warnings || []);
                const pendingId = pendingPlans.get(props.sessionId);
                const pendingItem = pendingId &&
                  items.find((item) => item.id === pendingId && item.revision > 1);
                if (pendingItem) {
                  const opening = liveState.current;
                  if (sequence !== changeSequence.current) return;
                  if (!shouldApplyPolledChange({ changeId: pendingId, revision: 0,
                    unsettled: opening.unsettled, runtimeDirty: opening.runtimeDirty }, pendingItem)) return;
                  const planned = await command({ action: "get", changeId: pendingId });
                  const settled = liveState.current;
                  if (available() && sequence === changeSequence.current &&
                      pendingPlans.get(props.sessionId) === pendingId &&
                      shouldApplyPolledChange({ changeId: pendingId, revision: 0,
                        unsettled: settled.unsettled, runtimeDirty: settled.runtimeDirty }, planned.change || {})) {
                    pendingPlans.delete(props.sessionId);
                    loadChange(planned.change);
                    setTab("plan");
                  }
                  return;
                }
                const targetId = liveState.current.change?.id;
                if (!targetId) return;
                const summary = items.find((item) => item.id === targetId);
                if (!summary) return;
                const current = liveState.current;
                if (!shouldApplyPolledChange({ changeId: targetId, revision: current.change?.revision,
                  unsettled: current.unsettled, runtimeDirty: current.runtimeDirty }, summary)) return;
                const latest = await command({ action: "get", changeId: targetId });
                const after = liveState.current;
                if (available() && pollTargetIsCurrent(sequence, changeSequence.current, after.change?.id, targetId) &&
                  shouldApplyPolledChange({ changeId: targetId,
                    revision: after.change?.revision, unsettled: after.unsettled,
                    runtimeDirty: after.runtimeDirty }, latest.change || {}))
                  loadChange(latest.change, { preserveRuntime: true });
              } catch {
                // Keep the last snapshot. Explicit reload reports errors through run().
              } finally {
                reading = false;
                lastRead = Date.now();
              }
            };
            // A file change is the only event that can make this panel stale, so the state directory
            // is watched instead of polled: polling ran one command every five seconds and every
            // execution is written into the transcript, which is what read as a looping output.
            let settle = 0;
            const queue = () => {
              if (settle) window.clearTimeout(settle);
              settle = window.setTimeout(() => {
                settle = 0;
                void synchronize();
              }, 700);
            };
            const controller = new AbortController();
            void Promise.resolve()
              .then(() => {
                let frames;
                try {
                  frames = ctx.remote.workspaceFiles.changes(props.sessionId, STATE_DIRECTORY, controller.signal);
                } catch (_) {
                  return undefined;
                }
                if (!frames || typeof frames[Symbol.asyncIterator] !== "function") return undefined;
                return (async () => {
                  try {
                    for await (const frame of frames) {
                      if (disposed) break;
                      // ready/changed/refresh are the frames a real state write produces.
                      if (frame && (frame.kind === "changed" || frame.kind === "refresh" || frame.kind === "ready"))
                        queue();
                    }
                  } catch (_) {
                    // A refused watch falls back to the low-frequency interval below.
                  }
                })();
              })
              .catch(() => undefined);
            // A background window pauses streams and timers, so returning to the tab is the second
            // signal; the interval only covers a watch that never started.
            const fallback = window.setInterval(() => {
              if (document.visibilityState === "visible") queue();
            }, 120000);
            // Focus and tab switches are not evidence that the plan changed, so they only nudge a read
            // when the snapshot has actually gone stale.
            const wake = () => {
              if (Date.now() - lastRead > 30000) queue();
            };
            window.addEventListener("focus", wake);
            document.addEventListener("visibilitychange", wake);
            return () => {
              disposed = true;
              if (settle) window.clearTimeout(settle);
              controller.abort();
              window.clearInterval(fallback);
              window.removeEventListener("focus", wake);
              document.removeEventListener("visibilitychange", wake);
            };
          }, [props.sessionId]);
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
            await list(data.change);
          }
          function openSidebar() {
            try {
              betterSidebar.openTab({ type: SIDEBAR_TAB });
            } catch (cause) {
              setError(String(cause?.message || cause));
            }
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
            if (busy || unsettled || !change || !deliveryRequestAllowed(kind, change)) return;
            if (kind !== "plan" && !change.tasks.some((task) => task.id === taskId)) return;
            insertChatText(requestText(kind, taskId));
          }
          function insertChatText(request) {
            if (compact && !props.inputActions) {
              copy(request);
              setNotice(t("sidebarCopied"));
              return true;
            }
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
              const text = "\n" + request + "\n";
              const span = actions.captureInsertion();
              if (!actions.insertText(text, span)) {
                setError(t("insertionConflict"));
                return;
              }
              actions.persistDraft();
              props.openView("chat", "");
              return true;
            } catch (cause) {
              setError(String(cause?.message || cause));
            }
          }
          function describeRequest() {
            const id = globalThis.crypto.randomUUID();
            const request = t("planLink") + " " + id + "\n" + t("describePrompt");
            if (insertChatText(request)) pendingPlans.set(props.sessionId, id);
          }
          async function approvePlan() {
            if (busy || approved) return;
            if (unsettled) throw new Error(t("saveFirst"));
            await mutate("approve", {});
          }
          function nativeDispatchRequest(taskId, target) {
            if (busy || dispatchRequestBlock(change, taskId, dispatchList, unsettled, typeof verificationRuns === "undefined" ? void 0 : verificationRuns)) return;
            const payload = cachedDispatchRequest(dispatchRequests.current, change, taskId, () => crypto.randomUUID());
            const text = t("dispatchPrompt", { payload: JSON.stringify(payload, null, 2) });
            if (target === "fill") insertChatText(text);
            else if (target === "copy") return copy(text);
          }
          function nativeDispatchControls(taskId) {
            if (!change?.tasks.some((task) => task.id === taskId)) return null;
            const blocked = dispatchRequestBlock(change, taskId, dispatchList, unsettled, typeof verificationRuns === "undefined" ? void 0 : verificationRuns);
            return h("div", { className: "ep-section" },
              h("strong", null, t("dispatchNative")),
              h("p", { className: "ep-muted" }, t("dispatchRequestHint")),
              blocked && h("p", { className: "ep-warn" }, t(blocked)),
              h("div", { className: "ep-row" },
                button("dispatchFill", () => nativeDispatchRequest(taskId, "fill"), busy || !!blocked),
                button("dispatchCopy", () => nativeDispatchRequest(taskId, "copy"), busy || !!blocked)));
          }
          function requestControls(kind, taskId = "") {
            const deliveryBlocked = !deliveryRequestAllowed(kind, change);
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
                  deliveryBlocked || unsettled ||
                    (kind !== "plan" && !change.tasks.some((task) => task.id === taskId)),
                ),
                button(
                  "copy",
                  () => { if (deliveryRequestAllowed(kind, change)) copy(requestText(kind, taskId)); },
                  deliveryBlocked || unsettled ||
                    (kind !== "plan" && !change.tasks.some((task) => task.id === taskId)),
                ),
              ),
              h("p", { className: "ep-muted" }, t(deliveryBlocked ? "deliveryFrozen" : unsettled ? "saveFirst" : "fillHint")),
            );
          }
          function button(label, onClick, disabled, primary, extra) {
            // "disabled" alone is invisible to keyboard users and says nothing about why, so the caller's
            // reason is mirrored into aria-disabled plus a title.
            // Locking every button while one remote call is in flight made the panel feel frozen: the
            // human could not switch tabs, copy text or read another card for the whole round trip. The
            // re-entry guard lives in run() (lock ref), so only the caller's own disabled reason locks.
            const locked =
              disabled ||
              (!editable && ["save", "addTask", "edit", "remove"].includes(label));
            const reason = typeof extra?.["data-reason"] === "string" ? extra["data-reason"] : "";
            return h(
              "button",
              {
                type: "button",
                onClick,
                disabled: locked,
                "aria-disabled": locked ? "true" : undefined,
                title: locked && reason ? reason : undefined,
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
                  const problem = executionProblem(task);
                  if (problem) {
                    setError(t(problem));
                    return;
                  }
                  const missing = missingDependencies(draft.tasks, deps);
                  if (missing.length) {
                    setError(t("missingDependency") + missing.join(", "));
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
                    ...taskExecution(task),
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
                  field(
                    "affectedModules",
                    taskEdit.affectedModules ?? "",
                    (affectedModules) => patch({ affectedModules }),
                    { className: "ep-full" },
                  ),
                  field(
                    "executor",
                    executorOf(taskEdit.executor),
                    (executor) => patch({ executor }),
                    { choices: EXECUTORS.map((id) => [id, t(EXECUTOR_LABELS[id])]) },
                  ),
                  field(
                    "maxRetries",
                    taskEdit.maxRetries ?? 0,
                    (maxRetries) => patch({ maxRetries }),
                    { type: "number", min: 0, max: RETRY_LIMIT, step: 1 },
                  ),
                ),
                h(
                  "label",
                  { className: "ep-row" },
                  h("input", {
                    type: "checkbox",
                    style: { width: "auto" },
                    disabled: busy,
                    checked: !!taskEdit.requiredApproval,
                    onChange: (event) => patch({ requiredApproval: event.target.checked }),
                  }),
                  t("requiresApproval"),
                ),
                h(
                  "div",
                  { className: "ep-row" },
                  h(
                    "button",
                    { type: "submit", disabled: busy || !!executionProblem(taskEdit), className: "ep-primary" },
                    t("updateTask"),
                  ),
                  button("cancel", () => setTaskEdit(null)),
                ),
                executionProblem(taskEdit) &&
                  h("p", { className: "ep-error" }, t(executionProblem(taskEdit))),
              ),
            );
          }
          function taskEditor(task, index) {
            const execution = taskExecution(task);
            setTaskEdit({
              ...task,
              ...execution,
              index,
              affectedModules: execution.affectedModules.join(", "),
              maxRetries: execution.maxRetries,
              dependencies: (task.dependencies || []).join("\n"),
              expectedFiles: (task.expectedFiles || []).join("\n"),
              acceptanceCriteria: (task.acceptanceCriteria || []).join("\n"),
              verificationCommands: (task.verificationCommands || []).join("\n"),
            });
          }
          async function refreshDispatchRuns(target = null) {
            const changeId = target || change?.id;
            if (!changeId) return;
            const requestId = ++dispatchSequence.current;
            setDispatchList((previous) => dispatchListState(previous, { type: "start", changeId, requestId }));
            try {
              const data = await command({ action: "dispatchRuns", changeId });
              if (!Array.isArray(data.runs) || data.runs.some((record) => record.changeId !== changeId))
                throw new Error(t("invalidResponse"));
              if (mounted.current) setDispatchList((previous) => dispatchListState(previous, {
                type: "success", changeId, requestId, runs: data.runs,
              }));
            } catch (cause) {
              if (mounted.current) setDispatchList((previous) => dispatchListState(previous, {
                type: "error", changeId, requestId, error: String(cause?.message || cause),
              }));
            }
          }
          async function resolveDispatchUnknown(record) {
            if (busy || unsettled || dispatchList.changeId !== change.id || dispatchList.loading ||
              dispatchList.stale || dispatchList.error || !dispatchList.runs?.includes(record)) return;
            const key = dispatchResolutionKey(change, record);
            const payload = dispatchResolutionPayload(change, record, dispatchResolution[key], new Date().toISOString());
            if (!payload) return;
            const data = await command(payload);
            if (mounted.current) {
              loadChange(data.change, { preserveRuntime: true, submitted: "resolveDispatchUnknown" });
              setDispatchResolution((previous) => {
                const next = { ...previous };
                delete next[key];
                return next;
              });
              setNotice(t("saved"));
            }
            await list(data.change);
          }
          function dispatchResolutionSummary(entry) {
            return h("div", { className: "ep-section" },
              h("strong", null, t("resolvedRun")),
              h("p", null, t("dispatchResolutionActor"), ": ", entry.actor?.kind, " · ", entry.actor?.id || "—"),
              h("p", null, t("dispatchResolutionTime"), ": ", entry.recordedAt || "—"),
              h("p", null, t("dispatchResolutionCheckedAt"), ": ", entry.terminationEvidence?.checkedAt || "—"),
              h("p", null, t("dispatchResolutionReason"), ": ", entry.reason),
              h("p", null, t("dispatchResolutionBasis"), ": ", entry.terminationEvidence?.basis || "—"),
              h("pre", null, (entry.terminationEvidence?.references || []).join("\n") || "—"));
          }
          function dispatchResolutionForm(record, list) {
            const key = dispatchResolutionKey(change, record);
            const form = dispatchResolution[key] || { key, reason: "", basis: "", references: "", confirmed: false };
            const update = (patch) => setDispatchResolution((previous) => ({ ...previous,
              [key]: { ...previous[key], key, ...patch } }));
            const disabled = busy || unsettled || list.loading || list.stale || !!list.error;
            return h("details", null,
              h("summary", null, t("unknownResolve")),
              h("p", { className: "ep-muted" }, t("dispatchResolutionHint")),
              h("fieldset", { disabled },
                field("dispatchResolutionReason", form.reason, (reason) => update({ reason }), { multiline: true }),
                field("dispatchResolutionBasis", form.basis, (basis) => update({ basis }), { multiline: true }),
                field("dispatchResolutionReferences", form.references, (references) => update({ references }), { multiline: true }),
                h("label", { className: "ep-row" },
                  h("input", { type: "checkbox", style: { width: "auto" }, disabled,
                    checked: !!form.confirmed, onChange: (event) => update({ confirmed: event.target.checked }) }),
                  t("dispatchResolutionConfirm")),
                button("unknownResolve", () => run(() => resolveDispatchUnknown(record)),
                  disabled || !dispatchResolutionPayload(change, record, form, ""))));
          }
          function expiredDispatchDraftsView(list) {
            const drafts = expiredDispatchDrafts(change, list, dispatchResolution);
            if (!drafts.length) return null;
            return h("details", { className: "ep-card", open: true },
              h("summary", null, t("dispatchExpiredDrafts")),
              h("p", { className: "ep-warn" }, t("dispatchExpiredHint")),
              ...drafts.map(({ key, changeId, runId, runRevision, form }) =>
                h("article", { className: "ep-card", key },
                  h("p", null, "runId: ", runId, " · runRevision: ", runRevision),
                  h("pre", null, JSON.stringify({ changeId, runId, runRevision,
                    reason: form.reason || "", basis: form.basis || "", references: form.references || "" }, null, 2)),
                  button("copyDraft", () => copy(JSON.stringify({ changeId, runId, runRevision, ...form }, null, 2))),
                  button("dispatchDiscardDraft", () => setDispatchResolution((previous) => {
                    const next = { ...previous };
                    delete next[key];
                    return next;
                  })))));
          }
          function dispatchRunsView() {
            const list = dispatchList.changeId === change.id ? dispatchList
              : dispatchListState({}, { type: "select", changeId: change.id });
            return h("section", { className: "ep-card" },
              h("div", { className: "ep-row ep-between" },
                h("h3", null, t("dispatchRuns")),
                button("refresh", refreshDispatchRuns, list.loading)),
              h("p", { className: "ep-muted" }, t("dispatchTruth")),
              list.loading && h("p", { role: "status" }, t("dispatchLoading")),
              list.error && h("p", { role: "alert", className: "ep-error" }, list.error),
              list.stale && h("p", { className: "ep-warn" }, t("dispatchStale")),
              expiredDispatchDraftsView(list),
              list.runs === null ? h("p", null, t("dispatchNotLoaded"))
                : list.runs.length === 0 ? h("p", null, t("dispatchEmpty"))
                : list.runs.map((record) => {
                  const fields = dispatchRecordFields(record);
                  const resolved = dispatchResolutionHistory(change, record);
                  return h("article", { className: "ep-card", key: record.runId },
                    h("dl", { className: "ep-grid" }, ...fields.metadata.map(([key, value]) =>
                      h("div", { key }, h("dt", { className: "ep-muted" }, key),
                        h("dd", { style: { margin: "0 0 8px", overflowWrap: "anywhere" } }, value)))),
                    ...fields.output.map(([key, value]) => h("details", { key, open: key === "result.text" },
                      h("summary", null, key), h("pre", null, value))),
                    resolved && dispatchResolutionSummary(resolved),
                    record.state === "unknown" && !resolved && dispatchResolutionForm(record, list),
                    // typeof keeps narrow harnesses that evaluate this view alone from throwing on the newer renderer.
                    typeof strandedNoticeView === "function"
                      ? strandedNoticeView(record, list.loading || list.stale || !!list.error, "dispatch")
                      : null,
                    typeof cancelRunningView === "function"
                      ? cancelRunningView(record, list.loading || list.stale || !!list.error, "dispatch")
                      : null,
                  );
                }),
            );
          }
          function tasksView() {
            const savedTasks = new Map(change.tasks.map((task) => [task.id, task]));
            const blockedTasks = change.tasks.filter((task) => task.status === "blocked");
            // Fresh core verdict wins; the local guess stays only as a pre-load fallback.
            const readyFresh = typeof readyMatches === "function" && readyMatches(ready, change);
            const readyIds = readyFresh ? readySet(ready) : null;
            const next = !unsettled && !deliveryAccepted && (readyIds
              ? change.tasks.find((task) => readyIds.has(task.id))
              : approved && change.tasks.find((task) =>
                task.status === "pending" &&
                task.dependencies.every((id) => savedTasks.get(id)?.status === "completed"),
              ));
            return h(
              React.Fragment,
              null,
              h("section", { className: "ep-card ep-task-summary" },
                h("span", null, t("completed"), " ", change.tasks.filter((task) => task.status === "completed").length,
                  " / ", change.tasks.length),
                h("span", null, t("blockedCount"), " ", blockedTasks.length),
                readyFresh && h("span", null, t("frontierCount"), " ", ready.ready.length),
                readyError && h("span", { className: "ep-error" }, readyError),
                next && h("button", { type: "button", onClick: () => revealTask(next.id) },
                  t("nextTask"), " · ", next.title),
              ),
              h("details", { className: "ep-card" }, h("summary", null, t("currentRuns")), dispatchRunsView()),
              h(
                "div",
                { className: "ep-row" },
                field("status", taskFilter, setTaskFilter, {
                  choices: [["", t("allStatuses")], ...statuses.map((status) => [status, textStatus(status)])],
                }),
                ...[["list", "listLayout"], ["board", "boardLayout"]].map(([value, label]) =>
                  button(label, () => setTaskLayout(value), false, taskLayout === value, {
                    key: value, "aria-pressed": taskLayout === value,
                  }),
                ),
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
                { className: taskLayout === "board" && !taskFilter ? "ep-board" : "ep-board ep-task-list", "aria-label": t("tasks") },
                ...statuses.filter((status) => !taskFilter || status === taskFilter).map((status) =>
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
                          h("p", { className: "ep-muted" }, taskMetaText(task, t)),
                          task.reason && h("p", { className: "ep-warn" }, task.reason),
                          h("details", { ref: (node) => {
                            if (node) taskDetails.current.set(task.id, node);
                            else taskDetails.current.delete(task.id);
                          } },
                          h("summary", null, t("taskDetails")),
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
                          readyFresh &&
                            readyReasons(ready, task.id).length > 0 &&
                            h(
                              "div",
                              { className: "ep-section" },
                              h("strong", null, t("readyBlockedReasons")),
                              h(
                                "ul",
                                null,
                                ...readyReasons(ready, task.id).map((reason, index) =>
                                  h(
                                    "li",
                                    { key: index },
                                    t(readyReasonKey(reason.code) || "readyUnresolvedUnknown"),
                                    reason.detail ? " · " + reason.detail : "",
                                  ),
                                ),
                              ),
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
                                        ? h(
                                            React.Fragment,
                                            null,
                                            h("code", null, value),
                                            (() => {
                                              const run =
                                                typeof latestCommandRun === "function"
                                                  ? latestCommandRun(
                                                      typeof verificationRuns === "undefined" ? null : verificationRuns,
                                                      task.id,
                                                      i,
                                                    )
                                                  : null;
                                              if (!run) return h("span", { className: "ep-muted" }, " · ", t("commandNeverRan"));
                                              return h(
                                                React.Fragment,
                                                null,
                                                " · ",
                                                badge(run.state),
                                                run.exitCode === null || run.exitCode === undefined
                                                  ? null
                                                  : h("span", { className: "ep-muted" }, " · exit ", run.exitCode),
                                              );
                                            })(),
                                          )
                                        : value,
                                    ),
                                  ),
                                ),
                              ),
                          ),
                          h(
                            "div",
                            { className: "ep-row" },
                            // A gated task stops at awaiting-review on purpose: the agent did the work and
                            // the evidence is in, so the only thing left is a human saying "done".
                            task.status === "awaiting-review" &&
                              button(
                                "confirmTask",
                                () => run(() => mutate("transition", { taskId: task.id, status: "completed" })),
                                false,
                                true,
                              ),
                            button(
                              "edit",
                              () => taskEditor(task, draft.tasks.indexOf(task)),
                              !!taskEdit,
                            ),
                            button(
                              "remove",
                              () => {
                                const dependents = draft.tasks.filter(
                                  (item) => item !== task && item.dependencies.includes(task.id),
                                );
                                if (dependents.length) {
                                  setError(
                                    t("taskHasDependents") +
                                      dependents.map((item) => item.id).join(", "),
                                  );
                                  return;
                                }
                                setError("");
                                edit({ tasks: draft.tasks.filter((item) => item !== task) });
                              },
                              !!taskEdit,
                            ),
                          ),
                          requestControls("task", task.id),
                          nativeDispatchControls(task.id),
                          ),
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
                    if (deliveryAccepted) return;
                    run(() => mutate("transition", transition));
                  },
                },
                h("h3", null, t("transition")),
                h("p", { className: "ep-muted" }, t(deliveryAccepted ? "deliveryFrozen" : unsettled ? "saveFirst" : planApproved(change) ? "transitionApprovedHint" : "transitionUnapprovedHint")),
                h(
                  "fieldset",
                  { disabled: busy || unsettled || deliveryAccepted },
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
                        deliveryAccepted ||
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
          function documentPreview(value) {
            if (!value?.trim()) return h("p", { className: "ep-muted" }, t("documentEmpty"));
            return h("div", { className: "ep-review-copy" },
              ...value.split(/(`{3}[\s\S]*?`{3})/).flatMap((part, partIndex) => {
                if (part.startsWith("```"))
                  return [h("pre", { key: partIndex }, part.replace(/^`{3}[^\n]*\n?|`{3}$/g, ""))];
                return part.trim().split(/\r?\n\s*\r?\n/).filter(Boolean).map((block, index) => {
                  const key = partIndex + "-" + index;
                  const heading = block.match(/^#{1,6}\s+([^\n]+)(?:\n|$)/);
                  if (heading) return h("div", { key }, h("h4", null, heading[1]),
                    block.slice(heading[0].length));
                  const lines = block.split(/\r?\n/);
                  if (lines.every((line) => /^\s*[-*+]\s+/.test(line)))
                    return h("ul", { key }, ...lines.map((line, item) =>
                      h("li", { key: item }, line.replace(/^\s*[-*+]\s+/, ""))));
                  return h("p", { key }, block);
                });
              }),
            );
          }
          function documentEditor(key, open = false) {
            return h(
              "details",
              { key: `document-${key}`, open },
              h("summary", null, t(key)),
              field(
                key,
                draft.documents[key],
                (value) => edit({ documents: { ...draft.documents, [key]: value } }),
                { multiline: true, rows: 9, disabled: busy || !editable },
              ),
            );
          }
          function planningChecklist() {
            const lite = draft.mode === "lite";
            const planning = planningDefaults(draft.planning);
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
              // Readiness is a claim the agent makes about its own plan, so it is display-only here: nobody
              // should have to tick six checkboxes before the work can start.
              h(
                "div",
                { className: "ep-readiness" },
                ...sectionKeys.map((key) =>
                  h(
                    "div",
                    { key, className: "ep-readiness-item" },
                    h(
                      "span",
                      { className: "ep-badge" },
                      t(planning.sections[key].status === "ready" ? "readinessReady" : "readinessPending"),
                    ),
                    h("span", null, " ", t(key)),
                    planning.sections[key].note
                      ? h("span", { className: "ep-muted" }, " · ", planning.sections[key].note)
                      : null,
                  ),
                ),
              ),
              planning.reviewRequirements
                ? h("p", { className: "ep-muted" }, planning.reviewRequirements)
                : null,
              ...(lite ? ["requirements", "findings"] : ["proposal", "requirements", "findings", "acceptance"]).map((key) =>
                documentEditor(key),
              ),
            );
          }
          function revealTask(id) {
            setTaskFilter("");
            window.requestAnimationFrame(() => {
              const details = taskDetails.current.get(id);
              if (!details) return;
              details.open = true;
              details.querySelector("summary")?.focus();
              details.scrollIntoView({ block: "nearest" });
            });
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
                  role: "group",
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
                    { key: task.id, role: "button", tabIndex: 0, "aria-label": task.title,
                      className: "ep-dag-node",
                      onClick: () => revealTask(task.id),
                      onKeyDown: (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        revealTask(task.id);
                      },
                    },
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
          function planningView() {
            const planning = planningDefaults(draft.planning);
            const documentKey = {
              requirements: "requirements", analysis: "findings", architecture: "architecture",
              interfaces: "implementation", acceptance: "acceptance",
            };
            return h(React.Fragment, null,
              h("section", { className: "ep-card" },
                h("div", { className: "ep-row ep-between" },
                  h("h3", null, t("completeness")),
                  h("span", { className: "ep-badge" },
                    sectionKeys.filter((key) => planning.sections[key].status === "ready").length,
                    " / ", sectionKeys.length, " ", t("readyCount")),
                ),
                h("div", { className: "ep-checklist" },
                  ...sectionKeys.map((key) => {
                    const section = planning.sections[key];
                    const body = draft.documents[documentKey[key]];
                    return h("details", { key: change.id + key },
                      h("summary", null, t(key), h("span", {
                        className: "ep-badge " + (section.status === "ready" ? "ep-success" : "ep-muted"),
                      }, t(section.status === "ready" ? "readinessReady" : "readinessPending"))),
                      section.note && h("p", { className: "ep-review-copy" }, section.note),
                      key === "tasks"
                        ? h("ul", null, ...draft.tasks.map((task) => h("li", { key: task.id }, task.title)))
                        : documentPreview(body),
                      button("reviseWithAgent", () => insertChatText(
                        t("reviseSection") + " " + t(key) + "\n" +
                          JSON.stringify({ changeId: change.id, planVersion: change.planVersion, expectedRevision: change.revision }),
                      ), unsettled),
                    );
                  }),
                ),
                h("p", { className: "ep-review-copy" }, h("strong", null, t("reviewRequirements")),
                  " · ", planning.reviewRequirements || t("documentEmpty")),
              ),
              editingPlan && planningEditor(),
            );
          }
          function planningEditor() {
            if (draft.mode !== "lite") return planningChecklist();
            return h(
              React.Fragment,
              null,
              h(
                "section",
                { className: "ep-card" },
                h("h3", null, t("liteEssentials")),
                h(
                  "fieldset",
                  { disabled: busy || !editable },
                  ...["proposal", "implementation", "acceptance"].map((key) =>
                    documentEditor(key, true),
                  ),
                ),
              ),
              h(
                "details",
                { key: `${change.id}-advanced-planning`, className: "ep-card" },
                h("summary", null, t("advancedPlanning")),
                planningChecklist(),
              ),
            );
          }
          function deliveredDecisionsView() {
            const versions = new Map();
            for (const snapshot of [...(change.history || []).map((entry) => entry.snapshot), change]) {
              if (!snapshot || snapshot.deliveryAcceptance?.planVersion !== snapshot.planVersion) continue;
              const decisions = snapshot.documents?.decisions;
              if (decisions?.trim()) versions.set(snapshot.planVersion, decisions);
            }
            if (!versions.size) return null;
            return h("details", { className: "ep-card" },
              h("summary", null, t("deliveredDecisions")),
              ...Array.from(versions).sort(([a], [b]) => b - a).map(([version, decisions]) =>
                h("details", { key: version },
                  h("summary", null, t("planVersion"), " ", version),
                  documentPreview(decisions),
                  button("copy", () => copy(decisions)),
                ),
              ),
            );
          }
          // The architecture picture is a fact about the plan, not something to type: it is derived from the
          // task graph and colored by task status, so it re-renders the moment a task moves. Writing a diagram
          // into the architecture document still wins — that is how you pin a drawing the derivation cannot make.
          function autoArchitectureDiagram(view) {
            const tasks = (view && view.tasks) || [];
            if (!tasks.length) return "";
            const label = (value) =>
              String(value || "")
                .replace(/[\r\n]+/g, " ")
                .replace(/"/g, "'")
                .replace(/[\[\]{}]/g, "")
                .slice(0, 48);
            const lines = ["flowchart LR"];
            const ids = new Map();
            const groups = new Map();
            for (const task of tasks) {
              const module = (task.affectedModules || [])[0] || t("autoDiagramWorkspace");
              if (!groups.has(module)) groups.set(module, []);
              groups.get(module).push(task);
            }
            let n = 0;
            let g = 0;
            for (const [module, list] of groups) {
              lines.push('  subgraph g' + g++ + '["' + label(module) + '"]');
              for (const task of list) {
                const id = "t" + n++;
                ids.set(task.id, id);
                lines.push('    ' + id + '["' + label(task.title) + "<br/>" + label(textStatus(task.status)) + '"]');
              }
              lines.push("  end");
            }
            for (const task of tasks) {
              for (const dependency of task.dependencies || []) {
                if (ids.has(dependency)) lines.push("  " + ids.get(dependency) + " --> " + ids.get(task.id));
              }
            }
            lines.push("  classDef done fill:#e6f4ea,stroke:#2f7d4f,color:#12331f");
            lines.push("  classDef active fill:#e8f0fe,stroke:#2b5fd9,color:#12224a");
            lines.push("  classDef review fill:#fff4e0,stroke:#c47f17,color:#3d2a05");
            lines.push("  classDef idle fill:#f3f3f4,stroke:#9a9aa0,color:#2c2c31");
            for (const task of tasks) {
              const tone =
                task.status === "completed"
                  ? "done"
                  : task.status === "awaiting-review"
                    ? "review"
                    : task.status === "running" || task.status === "verifying"
                      ? "active"
                      : "idle";
              lines.push("  class " + ids.get(task.id) + " " + tone);
            }
            return lines.join("\n");
          }
          function architectureView() {
            const designSections = ["architecture", "implementation", "impact-analysis", "decisions"];
            return h(React.Fragment, null,
              h("section", { className: "ep-card" },
                h("h3", null, t("diagrams")),
                h("div", { className: "ep-row" },
                  ...["architecture", "sequence", "data-flow"].map((key) =>
                    button(key, () => setDiagram(key), false, key === diagram, {
                      key, "aria-pressed": key === diagram,
                    }),
                  ),
                ),
                h(MermaidPreview, {
                  source: draft.diagrams[diagram] || (diagram === "architecture" ? autoArchitectureDiagram(draft) : ""),
                  label: t(diagram),
                  command,
                }),
                diagram === "architecture" &&
                  !draft.diagrams.architecture &&
                  h("p", { className: "ep-muted" }, t("autoDiagramHint")),
                h("details", null,
                  h("summary", null, t("source")),
                  editingPlan
                    ? field(diagram, draft.diagrams[diagram],
                        (value) => edit({ diagrams: { ...draft.diagrams, [diagram]: value } }),
                        { multiline: true, rows: 7, disabled: busy || !editable })
                    : h("pre", null, draft.diagrams[diagram] || t("documentEmpty")),
                ),
              ),
              h("section", { className: "ep-card" },
                ...designSections.map((key) => editingPlan
                  ? documentEditor(key, key === "architecture")
                  : h("details", { key, open: key === "architecture" },
                      h("summary", null, t(key)),
                      documentPreview(draft.documents[key])),
                ),
              ),
              deliveredDecisionsView(),
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
            const tallies = matrixTallies(rows);
            return h(
              "section",
              { className: "ep-card" },
              h("h3", null, t("matrix")),
              rows.length > 0 && h("div", { className: "ep-row" },
                ...[["passed", tallies.passed], ["failed", tallies.failed], ["pendingCriteria", tallies.pending]].map(([label, total]) =>
                  h("span", { key: label, className: "ep-badge" }, t(label), " ", total),
                ),
                tallies.noCriteria > 0 &&
                  h("span", { key: "noCriteria", className: "ep-badge ep-muted" },
                    t("noCriteria"), " ", tallies.noCriteria),
              ),
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
                              !criterion
                                ? "—"
                                : latest
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
          async function refreshReady(targetId) {
            if (!targetId) return "missing";
            setReadyBusy(true);
            try {
              const result = await command(readyQuery(targetId));
              if (!mounted.current) return "stale";
              if (!result || result.changeId !== targetId || !Number.isSafeInteger(result.revision)
                || !Array.isArray(result.ready))
                throw new Error(t("invalidResponse"));
              setReady(result);
              setReadyError("");
              return "applied";
            } catch (cause) {
              if (mounted.current) setReadyError(errorDisplay(String(cause?.message || cause)));
              return "failed";
            } finally {
              if (mounted.current) setReadyBusy(false);
            }
          }

          async function refreshGate(targetId) {
            if (!targetId) return;
            const data = await command(gateQuery(targetId));
            if (!mounted.current) return;
            const valid = data && typeof data.changeId === "string" && Number.isSafeInteger(data.revision) &&
              Number.isSafeInteger(data.planVersion) && typeof data.ready === "boolean" && Array.isArray(data.blockers);
            if (!valid) { setGateError(t("invalidResponse")); return; }
            setGateError("");
            setGate(data);
          }
          // Returns "applied" | "stale" | "missing" so the automatic refresh can tell a lost race from a
          // real answer. Nothing is rewritten before the answer lands: a failed request keeps whatever the
          // human already typed or ticked.
          async function refreshRuns(target = null) {
            const targetId = target || change?.id;
            if (!targetId) return "missing";
            const data = await command({ action: "verificationRuns", changeId: targetId });
            const result = acceptRunsFor(targetId, data, mounted.current ? liveState.current.change?.id : null);
            if (!result.accepted) {
              if (result.reason === "invalidResponse") throw new Error(t("invalidResponse"));
              return "stale";
            }
            setResolution(resetDispatchConfirmations);
            setVerificationRuns(result.runs);
            // typeof keeps narrow harnesses that evaluate refreshRuns alone from failing on the gate loader.
            if (typeof refreshGate === "function") await refreshGate(targetId);
            if (typeof refreshReady === "function") await refreshReady(targetId);
            return "applied";
          }
          async function resolveVerificationUnknown(record) {
            const form = bindVerificationResolution(resolution[record.runId], change, record);
            if (busy || unsettled || record.changeId !== change.id || record.state !== "unknown" ||
              !verificationRuns?.includes(record) || !form.confirmed || !form.reason.trim()) return;
            await mutate("resolveUnknown", { runId: record.runId,
              expectedRunRevision: record.revision, reason: form.reason });
            if (mounted.current) setResolution((previous) => {
              const next = { ...previous };
              delete next[record.runId];
              return next;
            });
          }
          async function abandonRun(kind, record) {
            const key = abandonmentKey(change, kind, record);
            const payload = abandonmentPayload(change, kind, record, abandonment[key]);
            // The payload is the single gate: eligible reservation, matched key, non-empty reason, explicit confirmation.
            if (busy || !payload) return;
            const data = await command(payload);
            if (!mounted.current) return;
            loadChange(data.change, { preserveRuntime: true, submitted: "abandonRun", abandonedKey: key });
            setNotice(t("saved"));
            await list(data.change);
            if (!mounted.current) return;
            if (kind === "verification") await refreshRuns();
            else await refreshDispatchRuns();
          }
          async function terminateStrandedRun(kind, record) {
            const key = terminationKey(change, kind, record);
            const payload = terminationPayload(change, kind, record, termination[key]);
            // The payload is the single gate: started-but-unattached run, matched key, reason, basis, confirmation.
            if (busy || !payload) return;
            const data = await command(payload);
            if (!mounted.current) return;
            loadChange(data.change, { preserveRuntime: true, submitted: "terminateRun", terminatedKey: key });
            setNotice(t("terminatedRecorded"));
            await list(data.change);
            if (!mounted.current) return;
            if (kind === "verification") await refreshRuns();
            else await refreshDispatchRuns();
          }
          function terminationSummary(entry) {
            return h("div", { className: "ep-section" },
              h("strong", null, t("terminatedRecorded")),
              h("p", null, t("abandonActor"), ": ", entry.actor?.id || entry.actor?.kind || ""),
              h("p", null, t("terminateReason"), ": ", entry.reason),
              h("p", null, t("terminateBasis"), ": ", entry.terminationEvidence?.basis || ""),
              h("p", null, t("abandonAt"), ": ", entry.at));
          }
          function terminationForm(kind, record, disabled) {
            const form = bindTermination(termination[terminationKey(change, kind, record)], change, kind, record);
            const key = form.key;
            const update = (patch) => setTermination((previous) => ({
              ...previous, [key]: { ...bindTermination(previous[key], change, kind, record), ...patch, key },
            }));
            return h("details", { className: "ep-section" },
              h("summary", null, t("terminateRun")),
              h("p", { className: "ep-warn" }, t("terminateHint")),
              h("fieldset", { disabled: busy },
                field("terminateReason", form.reason, (value) => update({ reason: value }), { multiline: true }),
                field("terminateBasis", form.basis, (value) => update({ basis: value }), { multiline: true }),
                field("terminateReferences", form.references, (value) => update({ references: value }), { multiline: true }),
                h("label", { className: "ep-row" },
                  h("input", {
                    type: "checkbox", checked: form.confirmed, disabled: busy,
                    onChange: (event) => update({ confirmed: event.target.checked }),
                  }),
                  t("terminateConfirm")),
                button("terminateRun", () => guarded(() => terminateStrandedRun(kind, record)),
                  disabled || !terminationPayload(change, kind, record, form))));
          }
          function abandonmentSummary(entry) {
            return h("div", { className: "ep-section" },
              h("strong", null, t("abandonedRecorded")),
              h("p", null, t("abandonActor"), ": ", entry.actor?.id || entry.actor?.kind || ""),
              h("p", null, t("abandonReason"), ": ", entry.reason),
              h("p", null, t("abandonAt"), ": ", entry.at));
          }
          function abandonmentForm(kind, record, disabled) {
            const form = bindAbandonment(abandonment[abandonmentKey(change, kind, record)], change, kind, record);
            const key = form.key;
            const update = (patch) => setAbandonment((previous) => ({
              ...previous, [key]: { ...bindAbandonment(previous[key], change, kind, record), ...patch, key },
            }));
            return h("details", { className: "ep-section" },
              h("summary", null, t("abandonRun")),
              h("p", null, t("abandonHint")),
              h("fieldset", { disabled: busy },
                field("abandonReason", form.reason, (value) => update({ reason: value }), { multiline: true }),
                h("label", { className: "ep-row" },
                  h("input", {
                    type: "checkbox", checked: form.confirmed, disabled: busy,
                    onChange: (event) => update({ confirmed: event.target.checked }),
                  }),
                  t("abandonConfirm")),
                button("abandonRun", () => guarded(() => abandonRun(kind, record)),
                  disabled || !abandonmentPayload(change, kind, record, form))));
          }
          function strandedNoticeView(record, disabled, kind) {
            const notice = strandedNotice(record);
            if (notice === "strandedNeedsEvidence") return h("p", { className: "ep-warn" }, t(notice));
            if (notice === "terminateRun") {
              const terminated = terminationHistory(change, kind, record);
              if (terminated) return terminationSummary(terminated);
              return terminationForm(kind, record, disabled);
            }
            if (notice !== "abandonRun") return null;
            const entry = abandonmentHistory(change, kind, record);
            if (entry) return abandonmentSummary(entry);
            return abandonmentForm(kind, record, disabled);
          }
          function cancelRunningPageHost(kind) {
            // The page never receives its own Host id, so the newest record of the list in view stands
            // in for it: that is the record this Host wrote most recently.
            if (kind === "dispatch")
              return runsHostInstance(dispatchList.changeId === change?.id ? dispatchList.runs : null);
            return runsHostInstance(verificationRuns);
          }
          async function stopRunningRun(kind, record) {
            const key = cancelRunningKey(change, kind, record);
            const form = bindCancelRunning(cancelRunning[key], change, kind, record);
            const payload = cancelRunningPayload(change, kind, record, form, cancelRunningPageHost(kind));
            // The payload is the single gate: live run, own jobId, own host instance, matched draft,
            // non-empty reason, explicit confirmation.
            if (busy || !payload) return;
            const fail = (text) => {
              if (mounted.current) setCancelErrors((previous) => ({ ...previous, [key]: text }));
            };
            fail("");
            try {
              await command(payload);
            } catch (cause) {
              fail((() => {
                const text = String(cause?.message || cause || "");
                const mapped = cancelRunErrorKey(text);
                return mapped ? t(mapped) : text;
              })());
              return;
            }
            if (!mounted.current) return;
            // Only this run's draft goes away; every other run keeps whatever the human typed.
            setCancelRunning((previous) => Object.fromEntries(Object.entries(previous).filter(([entry]) => entry !== key)));
            setCancelErrors((previous) => {
              const next = { ...previous };
              delete next[key];
              return next;
            });
            setNotice(t("cancelRunningDone"));
            if (kind === "verification") await refreshRuns();
            else await refreshDispatchRuns();
          }
          function submitCancelRunning(kind, record) {
            const action = () => run(() => stopRunningRun(kind, record));
            // This form's own draft must not raise the discard prompt that runtime drafts normally get;
            // only unsaved plan edits still ask the human first.
            if (unsettled) setPending(action);
            else action();
          }
          function cancelRunningView(record, disabled, kind) {
            const pageHost = cancelRunningPageHost(kind);
            if (!cancelRunningEligible(record, pageHost)) return null;
            const key = cancelRunningKey(change, kind, record);
            const form = bindCancelRunning(cancelRunning[key], change, kind, record);
            const update = (patch) => setCancelRunning((previous) => ({
              ...previous, [key]: { ...bindCancelRunning(previous[key], change, kind, record), ...patch, key },
            }));
            const failure = cancelErrors[key] || "";
            return h("details", { className: "ep-section" },
              h("summary", null, t("cancelRunningTitle")),
              h("p", null, t("cancelRunningTruth")),
              h("fieldset", { disabled: busy },
                field("cancelRunningReason", form.reason, (value) => update({ reason: value }), { multiline: true }),
                h("label", { className: "ep-row" },
                  h("input", {
                    type: "checkbox", checked: form.confirmed, disabled: busy, style: { width: "auto" },
                    onChange: (event) => update({ confirmed: event.target.checked }),
                  }),
                  t("cancelRunningConfirm")),
                failure ? h("p", { className: "ep-error", role: "alert" }, failure) : null,
                button("cancelRunningSubmit", () => submitCancelRunning(kind, record),
                  disabled || !cancelRunningPayload(change, kind, record, form, pageHost))));
          }
          function verificationRunsView() {
            const eligible = approved
              ? change.tasks.filter((task) => task.status === "verifying")
              : [];
            const options = eligible.flatMap((task) =>
              task.verificationCommands.map((command, index) => [
                JSON.stringify([task.id, index]),
                task.title + " · " + command,
              ]),
            );
            const selected = options.some(([value]) => value === commandChoice);
            const requestCommand = () => {
              if (busy || unsettled || !selected) return;
              const [taskId, commandIndex] = JSON.parse(commandChoice);
              const task = eligible.find((item) => item.id === taskId);
              if (!task) return;
              const attempt = cachedVerifyRequest(verifyRequests.current, change, taskId, commandIndex, () => crypto.randomUUID());
              const payload = {
                changeId: attempt.changeId,
                taskId: attempt.taskId,
                expectedRevision: attempt.expectedRevision,
                planVersion: attempt.planVersion,
                commandIndex,
                command: task.verificationCommands[commandIndex],
                requestId: attempt.requestId,
              };
              insertChatText(t("executePrompt", { payload: JSON.stringify(payload, null, 2) }));
            };
            return h(
              "section",
              { className: "ep-card" },
              h(
                "div",
                { className: "ep-row ep-between" },
                h("h3", null, t("runs")),
                button("refresh", () => run(refreshRuns)),
              ),
              h("p", { className: "ep-muted" }, t("runTruth")),
              h("p", { className: "ep-muted" }, t("verifyEligibility")),
              options.length > 0 &&
                h(
                  "div",
                  null,
                  field("commandChoice", commandChoice, setCommandChoice, {
                    choices: [["", t("commandChoice")], ...options],
                  }),
                  button("fillChat", requestCommand, unsettled || !selected),
                  h("p", { className: "ep-muted" }, t(unsettled ? "saveFirst" : "fillHint")),
                ),
              verificationRuns === null
                ? h("p", null, t("noRuns"))
                : verificationRuns.length === 0
                  ? h("p", null, t("emptyRuns"))
                  : verificationRuns.map((record) => {
                      const execution = record.execution?.resolved;
                      const executionFields = [
                        ["executionWorkdir", execution?.workdir, typeof execution?.workdir === "string"],
                        ["executionTimeout", execution?.timeoutMs, Number.isFinite(execution?.timeoutMs)],
                        ["executionOnExpiry", execution?.onExpiry, ["kill", "none"].includes(execution?.onExpiry)],
                        ["executionStdoutMaxBytes", execution?.stdoutMaxBytes, Number.isFinite(execution?.stdoutMaxBytes)],
                      ].filter(([, , recorded]) => recorded);
                      const resolutionForm = bindVerificationResolution(resolution[record.runId], change, record);
                      const resolved = (change.history || []).find(
                        (entry) =>
                          entry.kind === "verification-unknown-resolved" &&
                          entry.runId === record.runId &&
                          entry.runRevision === record.revision,
                      );
                      return h(
                        "article",
                        { key: record.runId, className: "ep-card" },
                        h("strong", null, record.command),
                        h(
                          "p",
                          null,
                          t("taskId"),
                          ": ",
                          record.taskId,
                          " · ",
                          t("runVersion"),
                          ": ",
                          record.planVersion,
                          " · ",
                          t("planVersion"),
                          ": ",
                          change.planVersion,
                        ),
                        h('dl', { className: 'ep-grid' },
                          ...Object.entries({
                            runId: record.runId, state: record.state, revision: record.revision,
                            exitCode: record.exitCode ?? '—', timedOut: record.timedOut ?? '—',
                            aborted: record.aborted ?? '—', jobId: record.jobId ?? '—',
                            truncated: record.truncated ?? false,
                            stdoutTruncated: record.stdout?.truncated ?? false,
                            stderrTruncated: record.stderr?.truncated ?? false
                          }).map(([key, value]) => h('div', { key },
                            h('dt', { className: 'ep-muted' }, key),
                            h('dd', { style: { margin: '0 0 8px', overflowWrap: 'anywhere' } }, String(value))))) ,
                        executionFields.length > 0
                          ? h("dl", { className: "ep-grid" },
                              ...executionFields.map(([key, value]) => h("div", { key },
                                h("dt", { className: "ep-muted" }, t(key)),
                                h("dd", { style: { margin: "0 0 8px", overflowWrap: "anywhere" } }, String(value)))))
                          : h("p", { className: "ep-muted" }, t("executionNotRecorded")),
                        h("p", { className: "ep-muted" }, t("shellNotRecorded")),
                        h(
                          "details",
                          null,
                          h("summary", null, "stdout"),
                          h("pre", null, record.stdout?.text || "—"),
                        ),
                        h(
                          "details",
                          null,
                          h("summary", null, "stderr"),
                          h("pre", null, record.stderr?.text || "—"),
                        ),
                        record.error &&
                          h(
                            "pre",
                            { className: "ep-error" },
                            typeof record.error === "string"
                              ? record.error
                              : JSON.stringify(record.error),
                          ),
                        resolved && h("p", null, t("resolvedRun"), ": ", resolved.reason),
                        record.state === "unknown" &&
                          !resolved &&
                          h(
                            "details",
                            null,
                            h("summary", null, t("unknownResolve")),
                            h("p", { className: "ep-muted" }, t("unknownHint")),
                            field(
                              "reason",
                              resolutionForm.reason,
                              (reason) =>
                                setResolution((previous) => ({
                                  ...previous,
                                  [record.runId]: { ...bindVerificationResolution(previous[record.runId], change, record), reason },
                                })),
                              { multiline: true },
                            ),
                            h(
                              "label",
                              { className: "ep-row" },
                              h("input", {
                                type: "checkbox",
                                style: { width: "auto" },
                                disabled: busy,
                                checked: resolutionForm.confirmed,
                                onChange: (event) =>
                                  setResolution((previous) => ({
                                    ...previous,
                                    [record.runId]: { ...bindVerificationResolution(previous[record.runId], change, record), confirmed: event.target.checked },
                                  })),
                              }),
                              t("unknownConfirm"),
                            ),
                            button(
                              "unknownResolve",
                              () => run(() => resolveVerificationUnknown(record)),
                              unsettled || !resolutionForm.reason.trim() || !resolutionForm.confirmed,
                            ),
                          ),
                        // typeof keeps narrow harnesses that evaluate this view alone from throwing on the newer renderer.
                        typeof strandedNoticeView === "function"
                          ? strandedNoticeView(record, busy, "verification")
                          : null,
                        typeof cancelRunningView === "function"
                          ? cancelRunningView(record, busy, "verification")
                          : null,
                      );
                    }),
            );
          }
          function deliveryReviewView() {
            const confirmation = bindDelivery(delivery, change);
            const tasksFinalized = change.tasks.some((task) => task.status === "completed") &&
              change.tasks.every((task) => ["completed", "cancelled"].includes(task.status));
            const acceptance = change.deliveryAcceptance;
            const accepted = acceptance?.planVersion === change.planVersion;
            const cancelled = change.tasks.filter((task) => task.status === "cancelled");
            const runsLoaded = runsLoadedOf(verificationRuns);
            const runsBlocked = runsBlockedOf(verificationRuns, change.history);
            const eligible = approved && tasksFinalized && runsLoaded && !runsBlocked && !accepted && !unsettled;
            // A fresh core verdict overrides the local approximation; a stale one never blocks acceptance
            // silently, the card says the result belongs to another version.
            const freshGateBlocked = !!gate && gateMatches(gate, change) && !gate.ready;
            return h(
              "section",
              { className: "ep-card" },
              h("h3", null, t("deliveryReview")),
              h("p", { className: "ep-muted" }, t("deliveryTruth")),
              h("p", { className: tasksFinalized ? "ep-success" : "ep-warn" },
                t(tasksFinalized ? "technicalComplete" : "technicalIncomplete")),
              h("p", { className: accepted ? "ep-success" : "ep-warn" },
                t(accepted ? "deliveryAccepted" : "deliveryPending")),
              accepted && h("p", { className: "ep-muted" }, t("deliveryFrozen")),
              acceptance && h("div", null,
                !accepted && h("p", { className: "ep-warn" }, t("deliveryHistorical")),
                h("dl", { className: "ep-grid" },
                  ...[
                    ["planVersion", acceptance.planVersion],
                    ["deliveryActor", acceptance.actor ? acceptance.actor.kind + ": " + acceptance.actor.id : "—"],
                    ["deliveryAcceptedAt", acceptance.acceptedAt],
                    ["note", acceptance.note],
                  ].map(([key, value]) => h("div", { key },
                    h("dt", { className: "ep-muted" }, t(key)),
                    h("dd", { style: { margin: "0 0 8px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, String(value ?? "—")))))),
              cancelled.length > 0 && h("div", { className: "ep-warn" },
                h("p", null, t("deliveryCancelled")),
                h("ul", null, ...cancelled.map((task) =>
                  h("li", { key: task.id }, task.id + " · " + task.title)))),
              h("p", { className: "ep-muted" }, t("deliveryEligibility")),
              !runsLoaded && h("p", { className: "ep-warn" }, t("deliveryRunsUnloaded")),
              runsBlocked && h("p", { className: "ep-warn" }, t("deliveryBlockedRuns")),
              h("div", { className: "ep-section" },
                h("h4", null, t("gateTitle")),
                h("p", { className: "ep-muted" }, t("gateTruth")),
                gateError && h("p", { className: "ep-error" }, gateError),
                gate && !gateMatches(gate, change) && h("p", { className: "ep-warn" }, t("gateStale")),
                gate && gateMatches(gate, change) && h("p", { className: gate.ready ? "ep-success" : "ep-warn" },
                  t(gate.ready ? "gateReady" : "gateBlocked")),
                gate && gateMatches(gate, change) && gate.blockers.length > 0 && h("ul", null,
                  ...gate.blockers.map((blocker, index) => h("li", { key: index },
                    t(gateBlockerKey(blocker.code) || "gateUnknownBlocker"),
                    gateBlockerDetail(blocker) ? " · " + gateBlockerDetail(blocker) : ""))),
                !gate && !gateError && h("p", { className: "ep-muted" }, t("gateNotQueried"))),
                gate && gateMatches(gate, change) && Array.isArray(gate.warnings) && gate.warnings.length > 0 &&
                  h("p", { className: "ep-warn" }, gateWarnings(gate.warnings)),
              button(runsLoaded ? "refresh" : "refreshRunsFirst", () => run(refreshRuns)),
              field("deliveryNote", delivery.note, (note) =>
                setDelivery((previous) => ({ ...previous, note })), { multiline: true, required: true, disabled: busy || accepted }),
              h("label", { className: "ep-row" },
                h("input", {
                  type: "checkbox", style: { width: "auto" }, disabled: busy || accepted,
                  checked: confirmation.confirmed,
                  onChange: (event) => setDelivery((previous) => ({ ...bindDelivery(previous, change), confirmed: event.target.checked, reconfirm: false })),
                }),
                t("deliveryConfirm")),
              confirmation.reconfirm && h("p", { className: "ep-warn" }, t("deliveryReconfirm")),
              button("acceptDelivery", () => {
                if (!eligible || freshGateBlocked || !confirmation.confirmed || !delivery.note.trim()) return;
                run(() => mutate("acceptDelivery", { note: delivery.note.trim() }));
              }, !eligible || freshGateBlocked || !confirmation.confirmed || !delivery.note.trim()),
              unsettled && h("p", { className: "ep-warn" }, t("saveFirst")),
            );
          }
          function archivedReviewsView() {
            const archives = archivedReviews(change);
            return h("details", { className: "ep-card" },
              h("summary", null, t("archivedReviews")),
              h("p", { className: "ep-muted" }, t("archivedReviewHint")),
              !archives.length && h("p", null, t("noArchivedReviews")),
              ...archives.map((archive, index) => h("article", { className: "ep-card", key: index },
                h("h3", null, t("planVersion") + ": " + archive.planVersion + " · " + archive.kind),
                h("p", null, archive.recordedAt || "—", " · ",
                  archive.actor ? archive.actor.kind + ": " + archive.actor.id : "—"),
                archive.taskId && h("p", null, t("taskId") + ": " + archive.taskId),
                h("h4", null, t("deliveryHistorical")),
                h("pre", null, JSON.stringify(archive.deliveryAcceptance, null, 2)),
                h("details", null, h("summary", null, t("archivedApprovals")),
                  h("pre", null, JSON.stringify(archive.approvals, null, 2))),
                h("details", null, h("summary", null, t("archivedTasks")),
                  h("pre", null, JSON.stringify(archive.tasks, null, 2))),
                h("details", null, h("summary", null, t("evidence")),
                  h("pre", null, JSON.stringify(archive.evidence, null, 2))),
              )),
            );
          }
          function resourcesView() {
            // 验收证据在 verifying 记录；失败/阻塞后的复盘也要能记，且只允许记失败，
            // 否则可以从 failed 直接写一条「通过」绕过 verifying。
            const EVIDENCE_TASK_STATES = ["verifying", "failed", "blocked"];
            const selectedTask = change.tasks.find((task) => task.id === evidence.taskId);
            const postMortem = !!selectedTask && (selectedTask.status === "failed" || selectedTask.status === "blocked");
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
              deliveryReviewView(),
              archivedReviewsView(),
              h("details", { className: "ep-card" },
                h("summary", null, t("dispatchResolutionHistory")),
                ...(change.history || []).filter((entry) => entry.kind === "dispatch-unknown-resolved").map((entry, index) =>
                  h("article", { className: "ep-card", key: index },
                    h("p", null, "runId: ", entry.runId, " · runRevision: ", entry.runRevision),
                    dispatchResolutionSummary(entry)))),
              verificationRunsView(),
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
                          .filter((task) => approved && EVIDENCE_TASK_STATES.includes(task.status))
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
                    {
                      choices: (postMortem ? ["failed"] : ["passed", "failed"]).map((value) => [value, t(value)]),
                    },
                  ),
                  postMortem && h("p", { className: "ep-warn" }, t("evidencePostMortem")),
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
                      disabled: busy || unsettled || !evidence.taskId || !evidence.criterion ||
                        (postMortem && evidence.outcome !== "failed"),
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
          // Notifications belong in the workbench, not in the transcript: the panel sits beside the
          // conversation, so anything that needs a human decision is listed here once and the chat
          // stays quiet. An empty list renders nothing at all.
          const openItems = [];
          if (change) {
            if (change.status === "draft" && !approved) openItems.push({ key: "review", text: t("noticeReview"), tab: "plan" });
            const awaitingReview = (change.tasks || []).filter((task) => task.status === "awaiting-review").length;
            if (awaitingReview > 0)
              openItems.push({ key: "reviewTasks", text: t("noticeReviewTasks", { count: awaitingReview }), tab: "tasks" });
            // A draft is expected to be blocked (no approval, no finished task yet), and so is any
            // plan still in progress: listing those blockers would make the strip permanent noise
            // instead of a reminder, so only a blocker a human must clear reaches it.
            const running = gate && gateMatches(gate, change) && change.status !== "draft";
            const needsHuman = running ? alertBlockers(gate) : [];
            if (needsHuman.length > 0) openItems.push({ key: "blockers", text: t("noticeBlockers", { count: needsHuman.length }), tab: "resources" });
            if (needsHuman.some((blocker) => blocker && blocker.code === "UNRESOLVED_UNKNOWN")) openItems.push({ key: "unknown", text: t("noticeUnknown"), tab: "resources" });
          }
          const noticesView = openItems.length === 0 ? null : h(
            "div",
            { className: "ep-notices", role: "status", "aria-label": t("noticeTitle") },
            h("strong", null, t("noticeTitle")),
            ...openItems.map((item) => h("button", { key: item.key, type: "button", className: "ep-notice-item", onClick: () => setTab(item.tab) }, item.text)),
          );
          return h(
            "section",
            { className: "ep", "aria-label": t("title"), "aria-busy": busy },
            h("style", null, css + viewCss),
            noticesView,
            h(
              "div",
              { className: compact ? "ep-layout ep-compact" : "ep-layout" },
              h(
                "aside",
                { className: "ep-side" },
                h("details", { className: "ep-navigation", open: !globalThis.matchMedia?.("(max-width: 620px)").matches },
                  h("summary", null, t("changes")),
                h(
                  "div",
                  { className: "ep-row ep-between" },
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
                        t("planVersion"),
                        " ",
                        item.planVersion,
                      ),
                    ),
                  ),
                ),
                ),
                button("describeRequest", describeRequest, unsettled || runtimeDirty, true),
                pendingPlans.has(props.sessionId) && h("div", { className: "ep-row ep-muted" },
                  h("span", { role: "status" }, t("waitingForPlan")),
                  button("cancel", () => {
                    pendingPlans.delete(props.sessionId);
                    run(list);
                  }),
                ),
                h("details", { className: "ep-tools" },
                  h("summary", null, t("newChange")),
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
                          setTab("plan");
                        }
                        await list(data.change);
                      });
                    },
                  },
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
              ),
              h(
                "main",
                { className: "ep-main" },
                h("div", { className: "ep-workspace" },
                busy && h("p", { role: "status", "aria-live": "polite" }, t("busy")),
                error &&
                  h(
                    "div",
                    { role: "alert", className: "ep-card ep-error" },
                    h("p", null, error),
                    draft && revisionConflict(error) && h("p", null, t("conflictHint")),
                    draft &&
                      button("copyDraft", () =>
                        copy(
                          JSON.stringify(
                            { draft, taskEdit, reference, transition, evidence, resolution, dispatchResolution, abandonment, delivery },
                            null,
                            2,
                          ),
                        ),
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
                h("header", { className: "ep-heading" },
                  !change && h("h2", null, t("title")),
                  change && h("div", { className: "ep-row ep-between" },
                    h("h2", { className: "ep-change-title" }, change.title),
                    change.status === "draft" &&
                      sectionKeys.every((key) => change.planning?.sections?.[key]?.status === "ready")
                      ? h("span", { className: "ep-badge ep-warn" }, t("readyForReview"))
                      : badge(change.status),
                  ),
                  change && h("div", { className: "ep-row ep-muted" },
                    h("span", null, t("planVersion"), " ", change.planVersion),
                    (unsettled || runtimeDirty) && h("span", { className: "ep-warn" }, t("unsaved")),
                  ),
                  change && (unsettled || runtimeDirty) &&
                    changes.some((item) => item.id === change.id && item.revision > change.revision) &&
                    h("p", { className: "ep-warn", role: "status" }, t("changedRemotely")),
                  change && h("p", { className: "ep-goal" }, change.goal),
                  // One visible next step with its own button: the header used to say what to do in muted
                  // text while the matching control sat in a different row, which is what made the panel
                  // feel like a puzzle rather than a workbench.
                  change && h("div", { className: "ep-next" },
                    h("span", null,
                      t(change.status === "completed" ? "nextComplete"
                        : change.status === "running" ? "nextRunning" : approved ? "nextApproved" : "nextDraft")),
                    change.status === "draft" && !approved &&
                      button("reviewPlan", () => setReviewOpen(true), false, true, { "aria-expanded": reviewOpen }),
                    approved && change.status !== "completed" &&
                      button("tasks", () => setTab("tasks")),
                    change.status === "completed" && !deliveryAccepted &&
                      button("goDelivery", () => setTab("resources")),
                  ),
                  change && h("div", { className: "ep-row" },
                    editable && button(
                      editingPlan ? "finishEditing" : "editPlanning",
                      () => setEditingPlan(!editingPlan), false, false, { "aria-expanded": editingPlan }),
                  ),
                  change && reviewOpen && h("section", { className: "ep-card" },
                    h("h3", null, t("reviewPlan")),
                    h("p", { className: "ep-review-copy" }, change.planning?.reviewRequirements),
                    change.status === "draft" && planIncomplete(change) &&
                      h("p", { className: "ep-warn" }, t(planIncomplete(change))),
                    change.status === "draft" && button("approve", () => run(approvePlan),
                      unsettled || !!planIncomplete(change), true,
                      { "data-reason": unsettled ? t("saveFirst")
                        : planIncomplete(change) ? t(planIncomplete(change)) : "" }),
                  ),
                ),
                h(
                  "nav",
                  {
                    className: "ep-tabs",
                    role: "tablist",
                    "aria-label": t("title"),
                    onKeyDown: (event) => {
                      const at = TABS.indexOf(tab);
                      let next = -1;
                      if (event.key === "ArrowRight") next = (at + 1) % TABS.length;
                      else if (event.key === "ArrowLeft") next = (at - 1 + TABS.length) % TABS.length;
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = TABS.length - 1;
                      if (at < 0 || next < 0) return;
                      event.preventDefault();
                      const value = TABS[next];
                      setTab(value);
                      const node = document.getElementById("ep-tab-" + value);
                      if (node && typeof node.focus === "function") node.focus();
                    },
                  },
                  ...TABS.map((value) =>
                    h(
                      "button",
                      {
                        key: value,
                        type: "button",
                        id: "ep-tab-" + value,
                        role: "tab",
                        className: tab === value ? "ep-selected" : "",
                        "aria-selected": tab === value ? "true" : "false",
                        "aria-controls": "ep-tabpanel",
                        tabIndex: tab === value ? 0 : -1,
                        onClick: () => setTab(value),
                      },
                      // The merged planning view keeps the wording the human already knows from the
                      // former overview tab; the architecture documents live inside it as a fold.
                      t(value === "plan" ? "overview" : value),
                    ),
                  ),
                ),
                !draft
                  ? h(
                      "div",
                      {
                        className: "ep-empty",
                        id: "ep-tabpanel",
                        role: "tabpanel",
                        "aria-labelledby": "ep-tab-" + tab,
                      },
                      h("h3", null, t(tab)),
                      h(
                        "p",
                        null,
                        t(
                          {
                            plan: "emptyPlanning",
                            tasks: "emptyTasks",
                            resources: "emptyQuality",
                          }[tab],
                        ),
                      ),
                    )
                  : h(
                      "div",
                      {
                        id: "ep-tabpanel",
                        role: "tabpanel",
                        "aria-labelledby": "ep-tab-" + tab,
                      },
                      h(
                        "div",
                        { className: "ep-row ep-section" },
                        dirty && button(
                          "save",
                          () =>
                            run(async () => {
                              const patch = {
                                title: draft.title,
                                goal: draft.goal,
                                planning: draft.planning,
                                documents: draft.documents,
                                diagrams: draft.diagrams,
                                tasks: draft.tasks.map((task) => ({
                                  ...Object.fromEntries(
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
                                  ...taskExecution(task),
                                })),
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
                              await list(data.change);
                            }),
                          !dirty ||
                            !!taskEdit ||
                            referenceDirty ||
                            !draft.title.trim() ||
                            !draft.goal.trim(),
                          true,
                        ),
                        h("details", { className: "ep-action-menu" },
                          h("summary", null, t("changeActions")),
                          button("refresh", () => guarded(() => get(change.id))),
                          button(
                            "replan",
                            () => setReplanConfirm(true),
                            unsettled || replanBlocked(change),
                          ),
                        ),
                      ),
                      replanConfirm &&
                        h(
                          "div",
                          { className: "ep-card ep-warn" },
                          h("p", null, t("replanHint")),
                          replanBlocked(change) &&
                            h("p", { role: "alert", className: "ep-warn" }, t("replanLockedTasks")),
                          button("replanConfirm", () => run(() => mutate("replan")), unsettled || replanBlocked(change)),
                          button("cancel", () => setReplanConfirm(false)),
                        ),
                      tab === "plan" &&
                        h(
                          React.Fragment,
                          null,
                          planningView(),
                          editingPlan && h(
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
                            "p",
                            { className: "ep-muted" },
                            t(change.mode === "lite" ? "modeLiteHint" : "modeStandardHint"),
                          ),
                          h(
                            "details",
                            { className: "ep-card ep-tools" },
                            h("summary", null, t("moreActions")),
                            h(
                            "div",
                            { className: "ep-row" },
                            button("context", () =>
                              run(async () => {
                                const data = await command({
                                  action: "context",
                                  changeId: change.id,
                                });
                                if (mounted.current) {
                                  const truncated = Array.isArray(
                                    data?.documentsTruncated,
                                  )
                                    ? data.documentsTruncated
                                    : [];
                                  setOutput({
                                    title: t("context"),
                                    text:
                                      (truncated.length
                                        ? `${t("contextTruncated")} ${truncated.join(", ")}\n\n`
                                        : "") + JSON.stringify(data, null, 2),
                                  });
                                }
                              }),
                            ),
                            button("export", () =>
                              run(async () => {
                                const data = await command({
                                  action: "export",
                                  changeId: change.id,
                                  expectedRevision: change.revision,
                                });
                                const stale = Array.isArray(data?.stale) ? data.stale : [];
                                const manifest = typeof data?.manifest === "string" ? data.manifest : "";
                                const listing = data.files
                                  ? JSON.stringify(data.files, null, 2)
                                  : t("noFiles");
                                if (mounted.current)
                                  setOutput({
                                    title: t("exported"),
                                    text:
                                      (stale.length
                                        ? `${t("exportStale")} ${stale.join(", ")}\n\n`
                                        : "") +
                                      listing +
                                      (manifest ? `\n\n${t("exportManifest")} ${manifest}` : ""),
                                  });
                              }),
                            ),
                            button("agent", () => copy(t("prompt", { id: change.id })), unsettled),
                          ),
                          h("p", { className: "ep-muted" }, t("savedOnly")),
                          h("p", { className: "ep-muted" }, t("agentHint")),
                          ),
                          requestControls("plan"),
                          h(
                            "details",
                            {
                              className: "ep-card",
                              open: archOpen,
                              onToggle: (event) => setArchOpen(event.currentTarget.open),
                            },
                            h("summary", null, t("archSection")),
                            archOpen && architectureView(),
                          ),
                        ),
                      tab === "tasks" && tasksView(),
                      tab === "resources" && resourcesView(),
                      !compact && betterSidebar?.openTab && h("div", { className: "ep-card" },
                        h("div", { className: "ep-row ep-between" },
                          h("p", { className: "ep-muted" }, t("sidebarHint")),
                          button("openInSidebar", () => openSidebar()),
                        ),
                      ),
                      h("details", { className: "ep-card ep-tools", key: change.id },
                        h("summary", null, t("advancedInfo")),
                        h("p", { className: "ep-muted" }, change.id, " · ", t("revision"), " ", change.revision),
                      ),
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
            ),
          );
        }
        // The side panel is a sibling plugin, so it is an optional dependency: declare it with
        // ctx.inject, which runs this callback only once the service exists and leaves the rest of
        // the workbench loading when it does not. Reading an undeclared service off ctx would throw.
        let betterSidebar = null;
        const SIDEBAR_TAB = "engineering-planner:workbench";
        ctx.inject(["betterSidebar"], (sidebarCtx) => {
          const service = sidebarCtx.betterSidebar;
          if (!service || typeof service.registerTab !== "function") return;
          betterSidebar = service;
          sidebarCtx.effect(() =>
            service.registerTab({
              id: SIDEBAR_TAB,
              title: () => t("entry"),
              description: () => t("sidebarTabDescription"),
              order: 60,
              single: true,
              component: ({ scope }) => h(Panel, { sessionId: scope.sessionId, compact: true, sidebarMode: true }),
            }),
          );
        });
          /* BEGIN TOOL ROWS */
  // A settled call arrives as a ToolResultNode: it carries args/call/content, never a `result`
  // field, and the payload is the text block the tool rendered. Reading block.result left every
  // row blank, which is why the row summary never showed up in the transcript.
  const ENGINEERING_TOOLS = ["engineering_plan", "engineering_dispatch", "engineering_verify"];
  const TOOL_RAW_LIMIT = 1200;
  function toolArgs(block) {
    if (!block || typeof block !== "object") return {};
    const raw = block.args ?? block.arguments;
    return raw && typeof raw === "object" ? raw : {};
  }
  function toolTexts(block) {
    const content = block && Array.isArray(block.content) ? block.content : [];
    const texts = [];
    for (const item of content) {
      if (item && item.type === "text" && typeof item.text === "string" && item.text) texts.push(item.text);
    }
    return texts;
  }
  function toolResult(block) {
    if (!block || typeof block !== "object") return null;
    const direct = block.result ?? block.output;
    if (direct && typeof direct === "object") return direct;
    for (const text of toolTexts(block)) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (cause) {
        // Not JSON: the row falls back to the raw text, which toolRaw already caps.
      }
    }
    return null;
  }
  function toolSummary(block) {
    const args = toolArgs(block);
    const result = toolResult(block);
    const parts = [];
    if (typeof args.action === "string" && args.action) parts.push(args.action);
    if (typeof args.changeId === "string" && args.changeId) parts.push(args.changeId.slice(0, 8));
    if (typeof args.taskId === "string" && args.taskId) parts.push(args.taskId);
    const view = Array.isArray(result) ? { count: result.length } : result;
    if (view) {
      if (Array.isArray(view.changes)) parts.push(t("cmdChanges", { count: view.changes.length }));
      if (Array.isArray(view.runs)) parts.push(t("cmdRuns", { count: view.runs.length }));
      if (Array.isArray(view.tasks)) parts.push(t("cmdTasks", { count: view.tasks.length }));
      if (typeof view.count === "number") parts.push(t("cmdTasks", { count: view.count }));
      if (typeof view.state === "string" && view.state) parts.push(view.state);
      if (typeof view.status === "string" && view.status) parts.push(view.status);
      if (typeof view.exitCode === "number") parts.push(`exit ${view.exitCode}`);
      if (view.ready === true) parts.push(t("toolReady"));
      if (!draftGate(view) && Array.isArray(view.blockers) && view.blockers.length) parts.push(t("cmdBlockers", { count: view.blockers.length }));
    }
    return parts.join(" · ");
  }
  function toolRaw(block) {
    try {
      const argsRaw = block && block.call && typeof block.call.argsRaw === "string" ? block.call.argsRaw : "";
      const argsText = argsRaw || JSON.stringify(toolArgs(block), null, 1);
      const texts = toolTexts(block);
      const resultText = texts.length ? texts.join("\n") : JSON.stringify(toolResult(block), null, 1);
      const payload = [
        argsText && argsText !== "{}" ? `arguments ${argsText}` : "",
        resultText && resultText !== "null" ? `result ${resultText}` : "",
      ].filter(Boolean).join("\n");
      return payload.length > TOOL_RAW_LIMIT ? `${payload.slice(0, TOOL_RAW_LIMIT)}…` : payload;
    } catch (error) {
      return "";
    }
  }
  // Notifications, not a log: a routine call earns one dim line with everything behind the
  // disclosure, while a call that failed or that reports blockers/warnings is highlighted and open.
  // A draft plan is blocked by definition: nobody approved it and nothing is finished yet. Counting
  // those expected blockers as notifications would flag every routine answer, which is the noise
  // this panel is supposed to stop making.
  function draftGate(view) {
    return !!view && typeof view === "object" && view.status === "draft";
  }
  // A gate blocker is not automatically news: a task that is not finished yet and a plan without a
  // completed task are the normal shape of work in progress. Only a blocker that a human has to
  // resolve is worth a line in the conversation.
  const ALERT_BLOCKER_CODES = new Set(["UNRESOLVED_UNKNOWN", "MISSING_EVIDENCE", "APPROVAL_REQUIRED"]);
  function alertBlockers(view) {
    if (!view || typeof view !== "object" || draftGate(view)) return [];
    const blockers = Array.isArray(view.blockers) ? view.blockers : [];
    return blockers.filter((blocker) => ALERT_BLOCKER_CODES.has(String(blocker?.code ?? blocker)));
  }
  function toolSeverity(block) {
    if (!block || typeof block !== "object") return "quiet";
    if (block.isError === true) return "alert";
    const result = toolResult(block);
    const view = result && !Array.isArray(result) ? result : null;
    if (!view) return "quiet";
    if (Array.isArray(view.warnings) && view.warnings.length) return "alert";
    if (alertBlockers(view).length) return "alert";
    if (Array.isArray(view.runs) && view.runs.some((run) => run && run.state === "unknown")) return "alert";
    return "quiet";
  }
  function toolAlert(block) {
    const result = toolResult(block);
    const view = result && !Array.isArray(result) ? result : {};
    const parts = [];
    // The failed state is already in the label, so only the actionable counts are appended here.
    if (!draftGate(view) && Array.isArray(view.blockers) && view.blockers.length) parts.push(t("cmdBlockers", { count: view.blockers.length }));
    if (Array.isArray(view.warnings) && view.warnings.length) parts.push(t("cmdWarnings", { count: view.warnings.length }));
    if (Array.isArray(view.runs) && view.runs.some((run) => run && run.state === "unknown")) parts.push(t("noticeUnknown"));
    return parts.filter(Boolean).join(" · ");
  }
  function EngineeringToolRow(props) {
    const rawName = String(props.toolName || (props.block && props.block.name) || "");
    const name = rawName.replace("engineering_", "") || "engineering";
    const summary = toolSummary(props.block);
    const settled = props.phase === "result";
    const failed = settled && props.block && props.block.isError === true;
    const severity = settled ? toolSeverity(props.block) : "quiet";
    const state = settled ? (failed ? t("toolFailed") : "") : t("toolRunning");
    const alert = settled ? toolAlert(props.block) : "";
    const label = [t("entry"), name, summary, state].filter(Boolean).join(" · ");
    const head = severity === "alert" && alert ? label + " · " + alert : label;
    const raw = settled && severity === "alert" ? toolRaw(props.block) : "";
    return h("details", { className: "ep-tool ep-tool-" + severity, open: severity === "alert", style: { margin: "2px 0" } },
      h("summary", { className: "ep-tool-summary", style: { cursor: "pointer" } }, head),
      raw && severity === "alert" ? h("pre", { className: "ep-tool-raw", style: { maxHeight: "240px", overflow: "auto", fontSize: "12px", margin: "4px 0 0" } }, raw) : null);
  }
  for (const toolName of ENGINEERING_TOOLS) {
    ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({ name: "tool.call.toolview", key: toolName }, EngineeringToolRow));
  }
  /* END TOOL ROWS */
  /* BEGIN COMMAND ROW */
  // The command answers with the whole state as JSON because that text is a machine contract used by
  // tests and scripts, so the transcript folds it into one line: this row parses the recorded outcome
  // and shows a few human sentences, never the payload.
  function commandArgs(node) {
    const raw = node && typeof node.args === "string" ? node.args.trim() : "";
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (cause) {
      return {};
    }
  }
  function commandPayload(node) {
    const text = node && node.outcome && typeof node.outcome.text === "string" ? node.outcome.text : "";
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (cause) {
      return null;
    }
  }
  // The command record carries no args (`recordInput: false` keeps the payload out of the log), so the
  // action is recovered from the answer's shape; without that every read was titled "list".
  function inferAction(payload) {
    if (!payload) return "query";
    if (Array.isArray(payload.changes)) return "list";
    if (payload.gate && payload.documents) return "context";
    // gateStatus answers with blockers (the readyTasks answer has none), readyTasks with a ready list.
    if (Array.isArray(payload.blockers)) return "gateStatus";
    if (Array.isArray(payload.runs)) return payload.runs.some((run) => run && typeof run.dispatch === "object") ? "dispatchRuns" : "verificationRuns";
    if (Array.isArray(payload.ready)) return "readyTasks";
    if (payload.change && typeof payload.change === "object") return "get";
    return "query";
  }
  function commandAction(node) {
    const args = commandArgs(node);
    if (typeof args.action === "string" && args.action) return args.action;
    return inferAction(commandPayload(node));
  }
  const COMMAND_ACTION_LABELS = {
    list: "cmdActList",
    get: "cmdActGet",
    gateStatus: "cmdActGate",
    readyTasks: "cmdActReady",
    verificationRuns: "cmdActRuns",
    dispatchRuns: "cmdActRuns",
    context: "cmdActContext",
    export: "cmdActExport",
  };
  function commandTitle(node) {
    const action = commandAction(node);
    return [t("entry"), t(COMMAND_ACTION_LABELS[action] || "cmdActQuery")].join(" · ");
  }
  // Counts the row keeps in its one-line summary: only numbers a reader can act on, never a zero.
  function commandCountParts(node) {
    const payload = commandPayload(node);
    if (!payload) return [];
    const parts = [];
    if (Array.isArray(payload.changes)) parts.push(t("cmdChanges", { count: payload.changes.length }));
    if (Array.isArray(payload.ready)) parts.push(t("cmdTasks", { count: payload.ready.length }));
    if (Array.isArray(payload.runs) && payload.runs.length) parts.push(t("cmdRuns", { count: payload.runs.length }));
    // Warnings are counted once, in the alert suffix, so the row never repeats "1 条告警 · 1 条告警".
    return parts;
  }
  function commandChangeParts(change) {
    if (!change || typeof change !== "object") return [];
    const parts = [String(change.id || change.changeId || "").slice(0, 8), change.title, change.status ?? change.state];
    if (change.planVersion !== undefined) parts.push(`v${change.planVersion}`);
    if (typeof change.revision === "number") parts.push(`rev ${change.revision}`);
    const tasks = Array.isArray(change.tasks) ? change.tasks : [];
    const taskCount = tasks.length || (typeof change.taskCount === "number" ? change.taskCount : 0);
    if (taskCount) {
      const done = tasks.filter((task) => task && (task.status === "completed" || task.status === "done")).length;
      parts.push(t("cmdTasks", { count: taskCount }));
      if (done) parts.push(t("cmdTasksDone", { done }));
    }
    return parts.filter(Boolean).map((part) => String(part));
  }
  // Detail lines are written for a human: one line per change, one per blocker or warning code, the
  // runs when there are any. The raw answer never reaches the row.
  function commandDetail(node) {
    const payload = commandPayload(node);
    if (!payload) {
      const text = node && node.outcome && typeof node.outcome.text === "string" ? node.outcome.text.trim() : "";
      return text ? text.split(/\r?\n/u).slice(0, 6).join("\n") : "";
    }
    const lines = [];
    const changes = Array.isArray(payload.changes) ? payload.changes : null;
    if (changes) {
      for (const change of changes.slice(0, 8)) lines.push(commandChangeParts(change).join(" · "));
      if (changes.length > 8) lines.push(t("cmdMore", { count: changes.length - 8 }));
    } else if (payload.change && typeof payload.change === "object") {
      lines.push(commandChangeParts(payload.change).join(" · "));
    } else if (payload.changeId || payload.id) {
      lines.push(commandChangeParts(payload).join(" · "));
    }
    for (const blocker of alertBlockers(payload).slice(0, 6)) {
      lines.push([blocker.code, blocker.taskId].filter(Boolean).join(" · "));
    }
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    for (const warning of warnings.slice(0, 4)) {
      lines.push([warning.code, warning.taskId].filter(Boolean).join(" · "));
    }
    if (Array.isArray(payload.runs) && payload.runs.length) {
      for (const run of payload.runs.slice(0, 4)) {
        const parts = [run.runId, run.state, run.command].filter(Boolean).map(String);
        if (parts.length) lines.push(parts.join(" · "));
      }
    }
    if (!lines.length) lines.push(t("cmdDetailMore"));
    return lines.filter(Boolean).join("\n");
  }
  // The command is the noisiest surface: it runs once per step and answers with the whole state.
  // Routine answers therefore collapse to one dim line (never expanded, never a wall of JSON), and
  // only an error, a warning, a blocker or an unresolved run raises the row into a notification.
  function commandSeverity(node) {
    if (!node || !node.outcome) return "quiet";
    if (node.outcome.kind === "error") return "alert";
    const payload = commandPayload(node);
    if (!payload) return "quiet";
    if (Array.isArray(payload.warnings) && payload.warnings.length) return "alert";
    if (alertBlockers(payload).length) return "alert";
    if (Array.isArray(payload.runs) && payload.runs.some((run) => run && run.state === "unknown")) return "alert";
    return "quiet";
  }
  function commandAlert(node) {
    const payload = commandPayload(node) || {};
    const parts = [];
    const blockers = alertBlockers(payload).length;
    if (blockers) parts.push(t("cmdNeedsHuman", { count: blockers }));
    if (Array.isArray(payload.warnings) && payload.warnings.length) parts.push(t("cmdWarnings", { count: payload.warnings.length }));
    if (Array.isArray(payload.runs) && payload.runs.some((run) => run && run.state === "unknown")) parts.push(t("noticeUnknown"));
    return parts.filter(Boolean).join(" · ");
  }
  // Reading the plan is the panel keeping itself current, not something the conversation did: the
  // transcript keeps the record, but a routine read earns a line in the chat flow only when it has
  // something a human must act on (an error, a warning, a blocker, an unresolved run).
  const QUIET_ACTIONS = new Set([
    "list", "get", "gateStatus", "readyTasks", "verificationRuns", "dispatchRuns", "context", "export", "query",
  ]);
  // One dim line like every other command row, and never auto-expanded: the row is a record, not an
  // alert dialog, so only a click opens the human-readable detail (no raw JSON in the chat flow).
  function EngineeringCommandRow(props) {
    const node = props.node;
    const running = !node || !node.outcome;
    if (QUIET_ACTIONS.has(commandAction(node)) && commandSeverity(node) === "quiet") return null;
    const failed = !!node && !!node.outcome && node.outcome.kind === "error";
    const severity = running ? "quiet" : commandSeverity(node);
    const title = running ? t("entry") : commandTitle(node);
    const state = failed ? t("toolFailed") : running ? t("toolRunning") : "";
    const alert = running ? "" : commandAlert(node);
    const counts = running ? [] : commandCountParts(node).filter(Boolean).join(" · ");
    const detail = running ? "" : commandDetail(node);
    const label = [title, counts, state].filter(Boolean).join(" · ");
    const head = severity === "alert" && alert ? label + " · " + alert : label;
    return h("details", { className: "ep-command ep-command-" + severity, style: { margin: "2px 0" } },
      h("summary", { className: "ep-command-summary", style: { cursor: "pointer" } }, head),
      detail ? h("pre", { className: "ep-command-detail", style: { whiteSpace: "pre-wrap", fontSize: "12px", margin: "4px 0 0" } }, detail) : null);
  }
  ctx.slots.inject("conversation.chat.commandview", () =>
    ctx.slots.register({ name: "conversation.chat.commandview", key: "engineering" }, EngineeringCommandRow),
  );
  /* END COMMAND ROW */
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
