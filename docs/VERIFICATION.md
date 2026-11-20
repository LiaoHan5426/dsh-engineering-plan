# 验证记录

环境：Windows，DSH 0.2.2-rc.5，desktop profile，Node.js（DSH 自带运行时）。

## 最新修复：跨进程锁释放窗口与执行参数记录

2026-11-20完整回归曾出现一项失败：file locks serialize separate Node processes 实际得到 `ENOENT` 而非 `REVISION_CONFLICT`。根因是等待者在 `fs.open(lock,'wx')` 得到 `EEXIST` 后、`lstat` 之前，持有者已关闭并 `unlink` 锁；旧的 `safeFile(lock)` 把锁消失当成路径错误。修复位于 src/core.js:150-153：锁文件不存在表示“已释放”，继续下一轮独占打开；其他 `PATH_UNSAFE` 情况（符号链接、目录、硬链接）仍然抛错。

回归由两个真实多进程测试固定：tests/core.test.js:58 的并发保存，以及 tests/core.test.js:67 通过 IPC 精确制造“持有者已改名并释放、等待者正停在 lstat”的交错，断言等待者随后得到 `REVISION_CONFLICT`；tests/core.test.js:137 断言争用状态下硬链接与目录锁仍被 `PATH_UNSAFE` 拒绝且不被删除。修复后完整套件 `node --test --test-reporter=dot tests/*.test.js` 退出码 0。

同一阶段新增验证执行参数记录：`verification-runner.js` 从 `shell.resolve()` 的返回值白名单复制 `workdir/timeoutMs/onExpiry/stdoutMaxBytes`，与 `starting`+`jobId` 同一次写入，成功后才 `shell.execute()`；`verification-store.js` 只允许该字段在 `reserved → starting` 时写一次，重复写入返回 `IMMUTABLE_EXECUTION`，旧 schema-1 记录可继续读取。质量门禁展示这四项并注明“Shell 身份未记录（当前执行接口未提供）”，旧记录显示“执行参数未记录”；未从 job kind、平台或 stderr 推断解释器。Host 56 项、Client 31 项相关测试通过。

命令可移植性也已实测：PowerShell 下 `echo ep-positive-smoke` 输出标记且退出码 0；`printf` 在该环境不存在。规划与评审技能已加入“验证命令在宿主 Shell 中执行、优先跨 Shell 通用写法、失败不得静默替换”的约束。

## 真实验收：2026-11-20 原生派发与验证

用户批准变更3c83caa4-1249-4752-a4cf-59eaab8d83d5 Plan v1（approvalRevision3）。派发run 2d330e17-9c17-4ff9-8902-8c9854e473fa、childId b6d4fb3c-7def-45a5-bdb8-da69065e210c真实返回包名@local/dsh-engineering-planner和版本0.3.0，stopReason completed；相同requestId重放返回同runId。子任务报告未改文件；该自报不替代全工作树前后字节比较。

验证run f9d8b388-3a87-4eaf-80b2-5577fc136476/job bash-ec62fbd3397c432f执行获批printf ep-positive-smoke，stderr为PowerShell CommandNotFoundException，exitCode1、timedOut=false、aborted=false、stdout为空。按已批准失败停止规则，没有替换命令或重跑。失败证据已入库，任务failed（revision7），deliveryAcceptance=null。真实验证器失败记录已验证，完整成功闭环尚未通过。

原生shell.resolve/execute公开契约未包含每次执行的解释器身份。job kind bash仅为任务分类；不得将其当作Bash执行证据。当前正补充resolved参数的白名单记录，Shell身份仍应标记未记录；历史执行记录不回填猜测信息。

## 历史验证：Git 采集基础模块（当时尚未接入）

父 Agent 独立运行 tests/git-collector.test.js：33 passed、0 failed、0 skipped，退出码0。子 Agent 最终联合比较模块49/49通过。覆盖固定原生Shell命令、每次策略根绑定、两次完整采样、unborn判定、父仓库停止、NUL路径、输出截断/超时/取消、累计1MiB预算及实际schema校验。此为模拟原生Shell契约测试，未进行真实仓库端到端采集；尚未注册模型工具或接入持久化与UI。

采集器明确保留限制：继承GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_CONFIG_*与Git配置可影响观测；未实现环境清洗，结果不证明规范完整工作树覆盖。未跟踪内容和ignored内容不采集，两次采样不是事务锁，原生执行器可能生成spill文件。后续接入必须继续展示这些限制，并验证实际Host链路。

## 历史验证：Git 观测比较基础模块

2026-11-19 父 Agent 独立执行 tests/git-comparison.test.js，16 passed、0 failed、0 skipped，退出码0。核对同HEAD工作树变化、暂存/工作树独立比较、partial不证明一致、缺项/范围/时间不匹配返回不可比、getter不执行及深拷贝。随后执行 `node --test --test-reporter=dot tests/*.test.js` 全套回归，退出码0（可选浏览器测试仍按其环境条件跳过，未据dot输出宣称全部用例实际执行）。该模块仅纯校验与比较，未接入Git采集、持久化、UI或验收状态；本次未更新安装。

## 历史验证：离线资源可复现重建

父Agent独立执行 tests/embed-mermaid.test.js：7 passed、0 failed、0 skipped，退出码0；打包资源校验通过。临时目录中的placeholder和真实client副本均可重建、node --check通过、嵌入值与vendor逐字节一致、二次重建结果完全相同。Unicode分隔符、字面转义及换行保持原值；错误SHA和缺失marker均非零退出且原client字节不变。未重写运行中的client。打包清单加入scripts/embed-mermaid.mjs并移除无效JS资产导出，保留vendor与许可证。此7项为专项结果，不将其冒充重新执行过的全套回归。

## 最新验证：Mermaid 真实宿主三图及错误恢复

2026-11-19 父Agent在真实 dsh-app://app/ 标准测试夹具中输入架构 flowchart、sequenceDiagram、数据流 flowchart，三个隔离iframe均在图像解码成功后变为visible，尺寸约363×420，sandbox仅allow-scripts。编辑框稳定为7个（加新建目标共8个）。将架构源码改为非法语法后真实显示Parse error，修复源码后三个预览重新visible。测试源码已清空还原，未保存或批准计划。此证据覆盖真实宿主加载、三类图渲染就绪和错误恢复，不代表全部图类型或全部主题的视觉验收。

两处集成缺陷已修复：同级React key改为document-/diagram-命名空间；DSH图片asset路由不支持JS，改为构建期嵌入可信完整Mermaid源码，仅隔离frame执行。scripts/embed-mermaid.mjs按SHA校验重建，nonce CSP且无外部脚本请求。插件已重新安装applied；专项默认3 passed/1 skipped，子Agent显式Chromium4/4通过。

## 历史问题：Mermaid 预览真实宿主集成

离线 Mermaid 11.17.2 及三个预览入口已加入并安装，plugin_manager 返回 applied。默认全套测试共241项，其中浏览器用例默认跳过（不能按241项全部通过计）；新增本地HTTP/Chromium用例由子Agent显式启用运行，3/3通过，资源验证通过。

父Agent在真实 dsh-app://app/ 进入标准夹具架构页后，观察到 textarea 从正常7个扩增为80余个，多数标签为架构，browser_type 返回元素已离开页面。尚未输入或保存图源，也未批准任何计划。已回到聊天页并交回组件集成排查；因此预览尚未通过真实宿主验收。独立HTTP渲染成功不代表React工作台集成成功。

## 历史增量：结案确认身份与过期草稿修复

派发过期结案草稿在独立区域保留，可复制或逐条丢弃；revision变化、终态、缺失记录和已结案均有覆盖。Verification确认绑定changeId/runId/runRevision；刷新与缓存恢复撤销确认，保留文字，提交再次核对身份。子Agent客户端27/27通过；父Agent独立完整回归238/238通过、退出码0，并检查核心绑定与分类代码。通过plugin_manager remove/install更新0.3.0，application=applied、enabled=true；实际engineering_plan list保留原两个draft及revision3/2，warnings为空。这些结果不代表真实unknown表单或获批正向执行已验证。

## 历史增量：派发 unknown 人工结案集成

Client表单已接入既有human command，按changeId/runId/runRevision分离草稿，刷新撤销旧确认；只清理提交成功的表单。结案历史及派发资格判断使用精确history匹配。父Agent完整集成回归232/232通过，退出码0。随后plugin_manager remove/install返回applied、enabled=true，实际engineering_plan list正常读取两个原草稿且warnings为空。尚无真实unknown运行用于表单正向交互验证，未进行人工结案，实际停止执行也未由此证明。

### 核心阶段验证

新增human-only resolveDispatchUnknown，双CAS、精确runId/runRevision历史匹配及结构化终止核查声明；只解除对应unknown，不修改run、任务、批准、验收或计划版本，active仍阻塞。子Agent最终报告全套223 passed、0 failed、check通过；父Agent独立复跑dispatch-resolution、dispatch-coordination、verification-coordination及host四组，53项通过、退出码0。运行文件字节不变、并发六次仅一次提交、旧版本与其他运行继续阻塞均有测试覆盖。

核心阶段曾尚未安装；其后的表单集成与安装结果见本节顶部。终止核查是人工声明，不是查询job缺失或child inactive推导出的结论，不会主动停止执行。

## 历史阶段：清理失败保留派发阻塞

父Agent完整回归197/197通过，退出码0。dispose失败采用粘性cleanupFailed标记并记录unknown；unknown持久化失败保留原活动状态，不回退为error。专项覆盖正常返回、取消、running写入失败叠加清理失败及unknown写入失败，真实EngineeringStore重新派发均报DISPATCH_RUN_BLOCKED。执行服务为模拟，不代表真实子Agent异常链路已验证。

修复后通过plugin_manager remove/install重新加载0.3.0，返回application=applied、enabled=true。实际engineering_plan list成功读取两个原测试变更，revision分别为3与2，均保持draft且warnings为空。此检查证明安装后工具可调用及状态保留，不代表运行过清理失败路径。

## 历史阶段：任务卡片派发请求入口

父 Agent 完整回归194/194通过，退出码0。新增填入/复制派发请求入口，严格五字段payload及按change/version/revision/task缓存requestId；前端检查批准、pending、依赖、交付冻结、记录加载/过期和活动/unknown状态，Host仍最终核验。实际DSH页面已观察到最新Client：标准未批准夹具的三个任务均显示原生派发请求区，六个填入/复制按钮全部disabled，审批提示可见。未点击批准，未实际派发；获批情况下的真实草稿插入仍待验证。

## 历史阶段：派发工具已安装与真实负向验证

父 Agent 独立完整回归191/191通过，退出码0。engineering_dispatch已注册，五个严格参数经正常工具入口进入core原子准入，仅created=true启动原生生命周期；重放返回原记录。plugin_manager remove/install更新本地0.3.0，application=applied。

真实调用：对未批准标准测试变更511370f8-7448-4bb9-9071-78bdb771cafb（revision3/planVersion1、ANALYZE）调用engineering_dispatch，返回`Current plan must have human approval`；前后dispatchRuns均为[]，证明未创建运行。真实DSH任务看板打开“子 Agent 派发记录”并手动重新加载，显示该变更暂无记录及returned/unknown说明。该验证未实际启动子Agent，也未替代人工审批后的正向链路、真实取消与交付验收。

## 历史阶段：原生生命周期适配与只读查询

父 Agent 独立完整回归 `node --test --test-reporter=dot tests/*.test.js`：181/181通过，退出码0。原生适配器专项33项采用真实DispatchRunStore与模拟subagents/jobs，覆盖启动失败、结果拒绝、取消前后及late activation、清理失败、持久化失败、owner/child/preset/route/cwd绑定，以及显式resolveMaxDepth。正常返回和取消均等待dispose；返回不自动变更任务或写验收证据。进入终态写入后到来的取消不会改写已提交returned。

Host新增只读dispatchRuns，任务看板新增手动查询区域；查询与Client联合10项回归通过，包含工作区隔离、跨change及请求乱序、刷新失败保留数据。此阶段尚未注册公开派发工具、安装最新源码或执行真实子Agent。工具入口集成仍在进行。

## 历史阶段：派发存储与原子准入

父 Agent 独立复跑 `node --test --test-reporter=dot tests/*.test.js`：142/142 通过，退出码 0。另独立运行派发存储与既有验证存储联合测试30/30通过。新增 DispatchRunStore 和 EngineeringStore.reserveDispatch，覆盖快照哈希、同请求幂等、并发CAS、change锁内批准/版本检查、同变更派发串行、同任务验证双向互斥、修改阻塞、终态释放、unknown跨版本保留和字面反斜线零保真。

这批代码尚未注册公开派发工具或启动真实子 Agent，也未更新运行中的 Host；测试通过仅证明内部存储与准入契约。仍须实现原生生命周期适配、取消与异常收尾、只读运行查询和真实链路验证。

## 最新增量：交付历史与派发请求契约

父 Agent 完整回归 `node --test --test-reporter=dot tests/*.test.js`：109 项通过，退出码 0。包含 Client 确认绑定 changeId/planVersion、跨版本撤销勾选、历史快照独立读取、交付后实现/验证草稿拦截，以及派发请求严格字段、审批/依赖/文件冲突校验和固定任务快照哈希。派发模块尚未接入持久执行记录或真实子 Agent 启动，不代表自动执行闭环完成。

随后补充派发提示真实 LF、无字面反斜线 n、title 含 NUL 被校验拦截的断言，派发模块 8/8 通过。0.3.0 再次由 plugin_manager 安装，application=applied。实际 DSH 页面选择标准测试夹具并打开质量门禁，DOM 确认新增“历史版本与重启任务记录（只读）”区域；夹具没有历史记录，未验证真实历史数据渲染，也未进行人工审批/交付确认。

## 自动检查

0.2.0 历史基线：`node --test tests/core.test.js tests/host.test.js`，24 项通过，0 失败，0 跳过。另覆盖显式 planning 状态的旧数据兼容、嵌套校验、部分合并、版本审批生命周期，以及三个原生工程 Skill 的注册和清理。

覆盖：工作区隔离、revision 冲突、同进程/跨进程互斥、DAG、审批身份、依赖门禁、声明文件排他、验收证据、重新执行清理证据、重新规划和历史保留、路径与链接、导出重建、实际 LF/NUL/反斜线字节行为、损坏列表容错、Host 工具与人工命令共用核心、资源释放。

`node scripts/validate-package.mjs`：资源路径、清单导出及双语元数据检查通过。

0.3.0 开发中回归（本轮协作报告，文档子 Agent 未重复执行测试）：

- 历史阶段父 Agent 完整回归 71 项通过，工具入口子 Agent 后续报告 80 项通过；再上一 Agent 报告完整 86/86 通过。这些是对应当时源码的阶段结果。
- 本轮父 Agent 执行 `node --test tests/*.test.js` 得到 86 项中 85 pass / 1 fail。唯一失败是 Host Skill 测试仍匹配旧字面 `executor`；该测试已修，Host 3/3 复测通过。
- 随后父 Agent 已完成最终完整 86/86 复跑（修正 Host 旧字面断言后，compact dot，退出码 0）。这是本轮最终完整回归结果；先前 85/1、3/3 和上一 Agent 的 86/86 保留为阶段记录。
- 覆盖结果分类、持久 run、跨进程幂等/CAS、精确命令与人工批准版本绑定、change 锁内原子预留及 blocker、历史 run 阻塞、unknown 人工结案、工作目录漂移保护、verificationRuns 只读接口，以及 registered tool body → core → runner → store 生命周期。
- runner/tool 测试采用真实记录存储和模拟 shell/jobs。它们未证明真实 tools pipeline 准入、真实进程、jobs 取消/重启及完整 UI 执行链通过。

本轮源码核对：`index.js` 已注册 `engineering_verify` 与 `verificationRuns`；`src/core.js` 在 change 锁内预留与检查 blocker；`src/verification-request.js` 校验 exact command/revision/planVersion、人工批准及 verifying；runner 使用 shell/jobs 并绑定工作区；store 独立持久 runs。store 的 recover 未由 Host/UI 自动调用；unknown 结案只追加人工历史、不改 run 成功、不重跑。`client.js` 已实现真实记录读取、输出/截断字段和精确命令草稿入口；这是源码证据，不是新 UI 的实测通过证明。

此前实际工作台空状态检查（当时未创建业务数据）：点击四个视图能分别显示开发规划、架构设计、任务看板、质量门禁的对应指引。未创建业务数据；有数据后的编辑、审批、DAG 和证据操作仍需单独验收。

## 轻量模式增量验证

父 Agent 复跑 `node --test --test-reporter=dot tests/*.test.js`：90/90 通过，退出码 0。新增覆盖轻量必选5文件、空白过滤、非空原内容保真、任务DAG条件、历史文件保留、state不变及standard14文件兼容。

通过 plugin_manager remove/install 更新本地0.3.0，application为applied。真实页面DOM确认提案/实施/验收三文档展开，高级规划区域折叠，模式说明可见。实际 engineering_plan export 对revision2 smoke返回6个文件（5必选+任务DAG），revision和批准状态不变。该记录证明当前轻量表单与导出已生效，不代替编辑保存、跨会话或执行正向链路验收。

## 用户交付确认增量

父 Agent 最终完整回归95/95通过（dot reporter，exit0），重新安装返回applied。acceptDelivery仅人工入口，校验当前版本批准、至少一项completed、其余completed/cancelled、非空备注及无active/unresolved unknown；确认后transition/evidence锁定，人工replan清当前确认并保留历史。自动测试覆盖旧state兼容、双边身份检查、版本、重复确认及导出。

真实standard夹具 `511370f8-7448-4bb9-9071-78bdb771cafb` revision2，三任务ANALYZE→API→CHECK，均pending且未批准。真实质量门禁页显示「技术任务尚未收尾」「当前版本待用户确认交付」，确认按钮disabled。未代用户确认交付；正向人工确认、跨会话表单及多节点DAG仍需后续验收。

## 真实保存、三节点DAG与context修复

standard夹具 `511370f8-7448-4bb9-9071-78bdb771cafb` 通过真实页面编辑评审要求并保存，revision由2变3；工具get确认持久化，页面重新加载后评审文本与revision3保留。任务看板SVG含3个rect节点，ANALYZE→API→CHECK两条竖向连接及对应箭头（4个path）。审批仍为空，任务全部pending。

真实context调用曾失败：`tool "engineering_plan" returned invalid output: value is not lossless JSON`。原因是可选task.reason返回undefined；改为null并加pending/blocked的JSON往返与读取不修改state测试。父完整回归96/96通过，重新安装applied后真实context成功返回revision3和reason:null。此实测证明保存/重新加载及三节点图，不等于跨会话和复杂DAG验收完成。

## 审查

核心只读审查发现损坏条目影响整个列表；已修复为逐项 warnings，增加回归测试。

Host/Client 集成检查发现任务保存包含只读状态字段，已修复为仅提交规划字段。UI/UX 静态专家审查后已补齐会话内存草稿恢复、跨变更资料表单清理与未提交内容守卫。最终 client.js 语法检查通过。

## 安装与运行

当前仓库包版本为 `0.3.0`（开发中）。父 Agent 后续通过 plugin_manager remove/install 安装 0.3.0，返回 `application: applied`、`enabled: true`。以下 0.2.0 安装记录保留为历史，不用于证明新版本验收。

0.3.0 真实 smoke：父 Agent 在真实页面创建并读到变更 `85b71c73-9741-45fa-b6aa-f97ee79e2318`，revision 2 / planVersion 1，仅配置 `printf engineering-verifier-smoke`。计划保持未批准草稿，未由 Agent 代批；实际 `engineering_verify` 返回 `Current plan must have human approval`，`verificationRuns` 返回 `[]`。页面质量门禁真实记录空态与矩阵可见。这证明未审批门禁与读取链生效，不证明正向命令执行成功；正向验证待用户 approve。

父 Agent 收到 CC Safety Net 提示后执行 `npx -y cc-safety-net rule tool add engineering_verify`，user scope 添加成功，list 确认 `ops_bash` 与 `engineering_verify`；未执行破坏性测试。此配置记录不等于真实工具策略全路径已验证。

unknown 多记录结案表单已改为按 runId 的字典隔离草稿，`node --check client.js` 通过；真实多记录交互尚未验收。

后续真实页面点击任务看板，读取到 aria-label 为「任务依赖图」的 SVG，viewBox 为 `0 0 760 140`，节点文本包含任务 `VERIFY-SMOKE`、标题及「待执行」。这补充了有数据的单节点 DAG 渲染证据；多任务边线、依赖状态和交互仍待验收。

已通过 plugin_manager 将 @local/dsh-engineering-planner 0.2.0 重新安装到 desktop profile，返回 application: applied、enabled: true。调用实际 engineering_plan list 返回 changes: []、warnings: []。运行时技能目录出现 engineering-planning、architecture-design、engineering-review，且实际加载 engineering-review 成功。此前 0.1.0 Client Inspect 确认 conversation.view 中 engineering-planner 条目 active: true、order: 40；新版实际页面点击验收仍待完成。原生会话入口采用插入并保存输入草稿，不自动提交，也不把准备请求标为任务已执行。

新版界面静态审查修复了三项草稿问题：资料尚未加入时禁用保存；运行状态与证据表单独立缓存并保护未提交内容；开发规划显示原生会话请求入口。最终 client.js 语法检查通过。

## 实际页面验证限制与修复历史

以下按发生顺序保留历史阻塞和空态检查；当前新增的 0.3.0 smoke 页面证据见上节。

首次 browser_open 返回：`the DSH window did not answer in time. Is the app window open?`；安装后重试返回：`the tab opened but no page appeared for http://127.0.0.1:60069 within 10 s`。未使用模拟页面替代真实运行界面。明暗主题、实际图标呈现、点击交互与页面控制台尚待真实页面验证。

进一步定位：外部页面 browser_open/snapshot 成功，说明浏览器控制通道可以工作。本地裸地址在未认证浏览器返回 HTTP 401；此外 DSH 内置侧栏地址解析器 parseBrowserAddress 会对与 applicationOrigin 相同的 URL 返回 application-origin，HTTP 与 HTTPS 均如此。只提供完整认证链接不能解决侧栏同源阻止。已通过独立修复包 @local/dsh-sidebar-browser-repair@0.3.1-local.1 控制已认证 DSH 主窗口，不在侧栏递归嵌入 DSH 页面。实际 browser_open 选择 dsh-app://app/，snapshot、text、eval 均成功；点击「工程研发」后读到开发规划、架构设计、任务看板、质量门禁四个页签及空状态指引。未创建或修改规划数据。外域侧栏打开/导航/关闭回归通过，主窗口 DOM 渲染截图成功（非像素截图）。这解除页面访问阻塞，但不代表规划编辑、审批和执行全流程验收已经完成。

0.3.0 已有单命令执行适配的源码和模拟 Host 测试，验收 evidence 仍为显式自报，succeeded 不自动映射 passed。仍待真实原生 tools pipeline → shell/jobs → runs 的成功/失败/取消验证，以及有数据 UI 的保存、批准、verifying 请求、records 刷新、unknown 结案、主题和跨会话验收；自动开发 executor 与恢复编排尚未实现。EAP 项目只读参考，没有安装第三方推荐插件，也没有修改 EAP 源码。

## 跨进程锁的竞争判定（2026-11-20 第 52 轮）

完整套件曾约每三轮出现一次不稳定失败，两条真实错误：

```text
tests/dispatch-store.test.js:60 concurrent instances reserve one request exactly once
Error: EPERM: operation not permitted, open '...\dispatches\.lock'  (errno -4048, src/dispatch-store.js:164)

tests/git-observation-store.test.js:62 concurrent instances deduplicate exactly once
Error: Storage file must be an unlinked regular file  (code PATH_UNSAFE, src/git-observation-store.js:67 经 :126)
```

结论：Windows 上 `open(…, 'wx')` 对正在创建/删除的锁文件不一定返回 `EEXIST`，可能是 `EPERM/EACCES/EBUSY`；被删除中的锁文件 `lstat` 也可能瞬时报告零链接数。旧实现把这两类都当硬错误，把正常的锁交接判成了缺陷或攻击。

修复后语义（`src/lock-retry.js`，由 `src/core.js`、`src/dispatch-store.js`、`src/git-observation-store.js`、`src/verification-store.js` 共用）：

- 竞争码 `EEXIST/EPERM/EACCES/EBUSY` → 视为“他人持有”，在同一个 3 秒期限内重试独占打开；
- `lstat` 显示 `ENOENT` 或零链接数 → 视为已释放，立即重试，不消耗期限判定；
- 符号链接、目录、`nlink > 1` 的硬链接 → 写入前即 `PATH_UNSAFE`，保留原有fail-closed属性；
- 释放路径同样用 `lockFileState` 复核身份，锁被替换仍报 `PATH_UNSAFE`。

证据：`node --test tests/git-observation-store.test.js tests/dispatch-store.test.js tests/verification-store.test.js` 49/49；连续 8 轮同一组合全部通过（此前约 3 轮 1 次失败）；`node --test tests/lock-retry.test.js` 3/3（含硬链接锁 `PATH_UNSAFE` 且目标字节未被改）；`node --test tests/core.test.js` 34/34；完整 `node --test tests/*.test.js` 419 项、418 通过、1 跳过（可选真实 Chromium 的 Mermaid 用例）、退出码 0。

## 并行分支 DAG、证据矩阵空标准与任务删除依赖守卫（2026-11-20 第 53–54 轮）

夹具 `511370f8-7448-4bb9-9071-78bdb771cafb` 扩为五任务：`ANALYZE → {API, UI} → JOIN → REVIEW`（`REVIEW` 无验收标准）。未批准、未执行任何任务。

真实页面（`dsh-app://app/`，任务看板 → 任务依赖图，`viewBox="0 0 760 500"`）：

```text
分析        x=20  y=20      接口      x=20  y=140    前端原型  x=270 y=140
联调        x=20  y=260     复核      x=20  y=380
M 125 82 L 125 135   M 125 82 L 375 135   M 125 202 L 125 255
M 375 202 L 125 255  M 125 322 L 125 375
```

同层并行任务并排、分叉与汇合均为斜线，5 个节点 5 条边（另 5 个箭头 `path`），与原始设计图的并行结构一致。

同轮修复两处界面缺陷并各自留下回归测试：

1. 证据矩阵无标准行同时显示「尚未配置验收标准」和「缺少当前版本证据」→ 现在结果列为 `—`（`tests/client-matrix-empty.test.js`）。
2. 移除仍被依赖的任务会直接改草稿并留下悬空依赖 → 现在拦下并列出阻塞任务 ID（`tests/client-task-remove.test.js`）；真实页面提示「仍有任务依赖此任务，请先在这些任务里移除依赖：JOIN」，移除后看板仍为五个任务。

复核：`node --test tests/*.test.js` → 424 项、423 pass、1 skipped（可选真实 Chromium Mermaid）、退出码 0；`scripts/embed-mermaid.mjs --check`、`scripts/embed-git-comparison.mjs --check`、`scripts/validate-package.mjs` 通过。

仍未验证：用户批准 v2 后的派发→验证→证据→交付正向链路、取消运行的真实界面路径、像素级截图（本机 CDP 截图超时，仅有 DOM 读数）。

## 只读审查修复与残留预留出口（2026-11-20 第 58 轮）

两份只读审查覆盖 `src/core.js`、`index.js` 与 `client.js`。先处理可证明安全的部分：

**已修复（含回归）**

| 缺陷 | 位置 | 修复 | 回归 |
|---|---|---|---|
| `engineering_plan` 不核对工作区根，也接受无 callId 的调用，可在子目录或工作区外写出第二个 store | `index.js:77-92`（`admittedWorkspace`）、`:105` | 取根→解析 `sandboxPolicy`→`path.resolve` 比对各一次，三个工具共用；要求 `callId`/`rootCallId`/`signal` | `tests/plan-workspace-guard.test.js` 4 项 |
| 核心 `identifier` 允许 Windows 设备名，`changeId: "nul"` 可落盘 | `src/core.js:46-50` | 拒绝 `con/prn/aux/nul/com[1-9]/lpt[1-9]`，`nulx` 仍合法 | `tests/identifier-guard.test.js` |
| `locked()` 的 `finally` 删锁前不比对身份，锁被替换时会删掉别人的锁 | `src/core.js:163-181` | 以打开时的 `dev/ino` 与 `lstat` 比对且要求 `nlink === 1`，不一致保留文件并报 `PATH_UNSAFE` | `tests/core.test.js`、`tests/lock-retry.test.js` |
| `transition` 到 running 的文件冲突只看任务状态，不看未结案 run（派发后任务仍是 pending） | `src/core.js:36,561-564` | 冲突集合并入 `reserved/starting/running` run 所属任务的 `expectedFiles`，终态 run 不占位 | `tests/core-consistency.test.js` 第 1–4 项 |
| `context` 把 documents 静默截到 1000 字符，回写 save 会不可逆损坏文档 | `src/core.js:448-457` | 新增 `documentsTruncated` 与 `documentLengths`，正文截断行为不变，不落盘 | `tests/core-consistency.test.js` 第 5–6 项 |
| 完成门禁只读 `task.evidence`，`state.evidence` 无一致性断言 | `src/core.js:122-124,569-573` | `readState` 校验子集关系（不满足 `CORRUPT_STATE`，`list` 降级为 warning）；completed 要求两视图末条记录均为 passed | `tests/core-consistency.test.js` 第 7–8 项 |
| 客户端五项（轮询覆盖输入、runs 串台、replan 弹窗锁、矩阵计数、依赖图丢边） | `client.js` | 见 `docs/UI-ACCEPTANCE.md` 第 58 轮节 | 5 个 `tests/client-*.test.js` 共 30 项 |
| 恢复上下文对超长文档静默截断，界面无任何提示 | `client.js` 上下文输出 | 输出首行加截断清单（`contextTruncated`），正文仍是完整 JSON，`documentsTruncated`/`documentLengths` 由核心提供 | `tests/client-context-truncated.test.js` 2 项 + 真实页面复核（第 59 轮） |

**审查确认的边界（不是缺陷，已写入 `docs/DESIGN.md`）**

- 审批记录与计划同库明文，任何能写工作区的人（含模型的 shell 工具）都能追加。它是工作流约束，不是安全控制；要隔离需要把审批或签名密钥移出工作区。
- 残留非终态 run 的人工出口此前完全关闭。本版只开放「`reserved` 且无 `jobId`」这一可证明安全的子集（没有进程被启动过）；`starting`/`running` 仍需执行终止证据，明确未实现。

**门禁**：`node --test tests/*.test.js` 498 项（497 pass / 1 可选 Chromium skip）退出码 0；`validate-package`、`embed-mermaid --check`、`embed-git-comparison --check` 均通过。

### 英文文案完整性（第 59 轮）

界面文案是 words 里的 [中文, English] 数组，按 language 下标注册到 ctx.locale。此前只验证了中文渲染，「英文文案是否齐全」没有证据，人工切语言又会改掉用户设置。改用三条静态断言代替：

- 每个键恰好两个非空字符串（>200 个键）；
- 源码里所有字面量 t("key") 都能在字典里找到；
- 通过变量传入 t() 的枚举值（七个任务状态、两种模式、六个 planning 分区、四个页签、sequence 图源）都已定义。

tests/client-locale-coverage.test.js 3 项通过。这证明不会出现「某键缺英文而回落到键名」，但不等于真实英文页面的排版验收。

### 轮询与未提交编辑（第 59 轮）

`shouldApplyPolledChange` 的静态断言已在 `tests/client-polling.test.js`；真实页面复现：编辑提案后由外部把 revision 从 8 改到 9，等 8 秒（超过 5 秒轮询周期）读回文本域，长度 36 的输入仍在、未保存标记仍在，并出现「方案有新修订」提示。修复前的实现会在第二次 await 后只看 `available()`，把响应直接套用并清空草稿。

### 主题 token 门禁（第 59 轮）

工作台样式块约 4.5 KB，抽取后断言：无十六进制、无 rgb()/rgba()、无 CSS 具名颜色；必须使用 --dsw-alias-bg-base / bg-layer-1 / label-primary / border-l1 / brand-primary。运行页面另做 DOM 级模拟：覆盖单个 token 后 .ep-card 的背景色随之改变、移除后复原，证明颜色来自 token。真实浅色主题与对比度仍未验证。
### 语法门禁覆盖（第 59 轮）

`npm run check` 原先只对 `index.js`、`client.js`、`src/core.js` 做 `node --check`，其余 11 个 Host 模块没有任何语法门禁。新增 `scripts/check-syntax.mjs`：枚举 `index.js`、`client.js`、`src/*.js`、`scripts/*.mjs`（当前 19 个），逐个执行 `node --check`，失败时输出文件与 stderr 并以非零退出；`--list` 只列文件供测试比对，路径统一为 POSIX 分隔符。

`tests/check-syntax.test.js` 3 项：列出清单必须包含 `src` 下全部模块与两个入口；必须包含两个重建脚本且清单只含 JS/MJS；当前工作树整体检查通过（输出形如 `syntax ok: 19 files`）。

同时修正文档与元数据不一致：README 标题与入口改为「工程研发」，插件 `locale/zh.json`、`locale/en.json` 的 `meta.title` 与视图标签对齐；`docs/DELIVERY-STATUS.md` 中「残留非终态 run 仍无人工出口」「13 个 Host 模块」两处过时表述已按实际实现（`abandonRun` 仅覆盖 reserved 且无 jobId、14 个模块）更正。

## 英文界面与浅色外观实测（第 61 轮，2026-11-20）

把 DSH 设置里的语言切到 English、外观切到 Light 后读回真实主窗口 DOM；测完恢复中文 + 深色。

- 英文：四页签 `Development planning / Architecture design / Task board / Quality gates`，六项就绪 `Pending`，`Standard Planning mode`、`Recovery context`、`No current-version evidence` 等均英文，无键名回退。页签切换需等一次重渲染（读取加 800ms）。
- 浅色缺陷：`.ep-warn` `#f59e0b`（约 2.1:1）与 `.ep-success` `#22c55e`（约 2.2:1）作文字色低于 WCAG AA 小字 4.5:1，深色下可读故此前未暴露。
- 修复：状态 token 只用于边框与 `color-mix(... 10%, transparent)` 底色，文字统一 `--dsw-alias-label-primary`（DSH 主题无前景文本变体）。
- 复测：Light 下 `.ep-warn` 文字 `rgb(15,17,21)`、边框 `rgb(245,158,11)`；遍历 `.ep-layout` 内所有元素，`color` 等于状态 token 的计数为 0。恢复深色后 `.ep-card` 背景 `rgb(35,35,36)`、`.ep-warn` 文字 `rgb(249,250,251)`。
- 新增门禁 `tests/client-state-colors.test.js` 4 项。
- 未完成：像素截图（`browser_screenshot` 报窗口未响应）。

## 任务执行元数据字段（2026-11-20 第 65 轮）

按原始规格里 `EngineeringTask` 的可选字段，补上四个**规划元数据**并在真实界面完成一次往返：

| 字段 | 默认 | 校验 | 是否影响门禁 |
|---|---|---|---|
| `affectedModules` | `[]` | 字符串数组，每项 1–200 字符、无 NUL，保存前去重（保序） | 否（不参与 DAG 与文件冲突） |
| `executor` | `'local'` | `local` / `subagent` / `external` | 否（本版没有执行器读取它） |
| `requiredApproval` | `false` | 布尔 | 否（派发与验证始终要求当前方案的人工批准） |
| `maxRetries` | `0` | 0–10 的整数 | 否（本版没有自动重试） |

- 核心：`src/core.js:60-83` 的 `taskMetadata()` 负责默认值、校验与去重；`src/core.js:92` 放开白名单，未知键仍 `INVALID_INPUT`；`src/core.js:151-156` 在 `readState` 里为旧 state 补默认（缺字段正常，字段存在但非法才是 `CORRUPT_STATE`）；`src/core.js:494` 的 `context` 投影包含四键；`export` 的 `tasks.json` 直接序列化归一后的 tasks，因此天然带四键。
- 宿主：`index.js` 的工具 JSON schema 同步加入四键（`additionalProperties: false` 下若不加入会先被 schema 拦掉）。
- 客户端：`client.js` 的表单渲染「影响模块（逗号分隔）」「执行方式」「需要人工审批」「最大重试次数」，任务卡片显示紧凑元信息行，提交投影带四键且仍不含 `status`/`evidence`。
- 真实往返（夹具 `511370f8`）：界面填 `core, client,core` + 子代理 + 需审批 + 重试 2 → 保存后磁盘为 `affectedModules: ["core","client"]`（去重生效）、`executor: "subagent"`、`requiredApproval: true`、`maxRetries: 2`，revision 10→11；`tasks.json` 同步包含四键；卡片读数「影响模块: core, client · 执行方式: 子代理 · 需人工审批 · 重试次数: 2」。随后把该任务改回默认值（revision 12），夹具保持中性。
- 门禁：`node --test tests/*.test.js` 513 项（512 pass / 1 可选 Chromium skip）退出码 0；`npm run check` → `syntax ok: 19 files`；`validate-package`、两个 `--check` 一致。

## 只读交付门禁查询 gateStatus（第 67 轮）

- 新动作 `gateStatus`（`src/core.js` 的 `gateStatus(s, root)`）：读取两个运行仓库后汇总 blockers，不写入任何文件、不递增 revision。
- 与 `acceptDelivery` 共用同一套判据：当前用户审批、任务终态、至少一个 completed、逐项当前版本证据（同时检查 `task.evidence` 与 `state.evidence`）、活动运行与未结案 unknown。
- `tests/gate-status.test.js` 7 项：草稿 `APPROVAL_REQUIRED`、只读性（连续两次调用前后 state 字节等价）、全部证据齐备时 `ready: true`、手工改 planVersion 后 `MISSING_EVIDENCE`、活动派发 run 的 `ACTIVE_RUN`、unknown 经人工结案后 blocker 清空、以及参数校验（多余字段、缺 changeId、aborted）。
- 全套件 528 项（527 pass / 1 可选 Chromium skip）退出码 0；`npm run check` → `syntax ok: 19 files`。

## 界面改用核心门禁判定（第 68 轮）

- `client.js` 新增纯函数块 `BEGIN/END GATE SUMMARY`：`gateQuery`、`gateMatches`（changeId+planVersion+revision 三重绑定）、`gateBlockerKey`、`gateBlockerDetail`。
- 「用户交付评审」卡片渲染 `gateTitle/gateTruth/gateReady/gateBlocked/gateStale/gateNotQueried` 与逐条 blocker；`freshGateBlocked` 加入「确认当前版本交付」的禁用条件与提交前守卫。
- 查询挂在 `refreshRuns` 之后，随「重新加载」一起执行，不额外轮询。
- `tests/client-gate.test.js` 6 项：查询形状、三重版本绑定、六个 blocker code 均有双语键、明细拼接、界面结构与守卫、以及与 `refreshRuns` 的挂接。
- 真实页面：v1 显示「任务尚未收尾 · READONLY-SMOKE · failed / 没有已完成任务」；v2 再多一条「当前方案未获人工批准」，与原生工具返回一致。
- 全套件 534 项（533 pass / 1 可选 Chromium skip）退出码 0。

## 三类 blocker 的真机读数与 LF 门禁（第 69 轮）

- `ACTIVE_RUN`：`reserved` 运行存在时，界面读「存在活动运行 · GATE-PROBE · dispatch · <runId> · reserved」，交付按钮禁用。
- `UNRESOLVED_UNKNOWN`：同一条运行推进到 `unknown` 后，读「存在未结案 unknown 运行 · <runId> · unknown」。
- `MISSING_EVIDENCE`：合成「任务 completed + 最新证据 failed」状态后，读「缺少当前版本证据 · GATE-PROBE · 探针标准」。
- 三类明细与 `gateStatus` 原生返回逐字段一致；夹具验证后删除。
- `gateStale` 文案修正为「请先在「方案操作」里重新加载变更，再刷新运行记录后判断」，新增 1 项断言。
- 新增 `tests/line-endings.test.js`（2 项）：入口、`src/`、`scripts/`、`tests/` 共 77 个 JS/MJS 文件必须为 LF。
- 全套件 537 项（536 pass / 1 可选 Chromium skip）退出码 0；`npm run check` → `syntax ok: 19 files`。

## 超限与链接目录的列表容错（第 70 轮）

- 2,097,244 字节的 `state.json` → 列表警告 `State exceeds size limit`（`STATE_TOO_LARGE`，见 `src/core.js:142`）。
- 指向夹具的 junction 目录 → 列表警告 `Linked change directory`（`PATH_UNSAFE`，见 `src/core.js:497`）。
- 两条均只降级为警告，四个正常变更照常列出并可打开；删除条目后刷新列表即恢复。
- 未覆盖：`get` 读取损坏 id 的界面文案（列表无法进入该路径）。
- 第 72 轮补齐 `NOT_FOUND`：选中后把整个变更目录移走再「重新加载」，错误卡读到 `NOT_FOUND: Change not found`，移回并刷新列表后恢复。
- 第 71 轮补齐：先选中夹具再写坏它的 `state.json`，`方案操作 → 重新加载` 触发 `get`，错误卡读到 `CORRUPT_STATE: State JSON is corrupt`（列表侧同时出现同名警告）。顺带修掉「只有版本冲突才提示复制草稿后就地重载」的误导：`revisionConflict(error)` 只匹配 `REVISION_CONFLICT`，新增 3 项测试。
- 全套件 540 项（539 pass / 1 可选 Chromium skip）退出码 0。
- 新增 `scripts/check-doc-counts.mjs`（`npm run check:counts`）：跑一次 TAP 套件取 `1..N`，与 README、本文档的最大声明值比对，不一致即非零退出。起因是这些数字反复漂移（197 → 242 → 513 → 534 → 537 → 540）。5 项测试（当时套件为 545 项）。

## 第 74 轮：人工终止运行、只读审查修复与真机抽验

**新增人工动作 `cancelRun`**（Host `index.js`，仅 `/engineering` 命令与工作台可达，不注册为模型工具）：严格字段 `action/changeId/kind/runId/reason`；校验工作区、运行存在、`state ∈ {starting,running}`、有 `jobId`、`hostInstanceId` 与本实例一致，然后只调用 `ctx.jobs.kill`，由 runner 自己把运行结算为 `cancelled`。错误码：`ENGINEERING_INVALID_INPUT`、`ENGINEERING_RUN_NOT_RUNNING`、`ENGINEERING_RUN_WITHOUT_JOB`、`ENGINEERING_RUN_FOREIGN_HOST`。新增 5 项 Host 测试；界面侧 11 项。

**只读客户端审查（client-audit-2）**：确认无问题的范围包括轮询四门（disposed/lock/busy/visibility）、各列表响应归属、gate 三重匹配、draftCache 生命周期、任务编辑器索引、345 条 locale；撤回 4 条误报（dispatch 在飞 run 绕过交付确认、refreshRuns 不校验 revision、基线状态漏键、Mermaid nonce 错配）。

**据此修复 6 处（新增 41 项测试）**：

- 交付评审不再把「运行记录未加载」当成「有阻塞运行」：拆出 `runsLoaded` / `runsBlocked`，并在 `loadChange` 后自动刷新一次（busy 时 3×250ms 退避，失败只吞）。
- 批准按钮预判计划完整性：无目标、无任务、任务缺验收标准时直接禁用并说明，不再让核心的英文 `INCOMPLETE_PLAN` 直出。
- 轮询的 `get` 增加变更身份序列守卫，切到另一变更（即使 revision 更小）不会被旧响应拉回。
- `abandonment`（放弃残留预留的理由）纳入未提交保护、草稿缓存与「复制草稿」。
- `gateError` 在 `loadChange` 时清零，不再跨变更残留。
- Mermaid 超时提前到「无源」判断之后、`!loaded` 之前；`crypto.randomUUID` 不可用时回退到符合 frame 白名单的 `ep-<ts>-<rand>`。

**真机抽验（`dsh-app://app/`，夹具 `511370f8`，1707×912）**：

- 批准门禁：`评审方案` 卡显示「批准前每个任务至少需要一条验收标准。」，`批准当前方案` `disabled=true`（该夹具的 `REVIEW` 无验收标准）。
- 交付评审：初始显示「运行记录尚未加载：先刷新运行记录，再确认交付。」+「先刷新运行记录」按钮，不再冒充"有阻塞"；点击后替换为核心判定列表「当前方案未获人工批准 / 任务尚未收尾 · ANALYZE、API、UI、JOIN、REVIEW · pending / 没有已完成任务」。
- 自动刷新在该次导航里未生效（交互占用 `lock.current`，退避后放弃），手动入口文案如实说明，未虚报状态。
- `browser_screenshot` 仍返回 `the DSH window did not answer in time`，本轮无像素证据。

**未验证**：`cancelRun` 没有在真实运行上提交过（会真的 kill 一个已批准运行，需人工发起）；自动刷新成功路径只有静态断言；P1-3 竞态未用真实 IPC 复现；双语文案措辞未逐条核对。

- 全套件 604 项（603 pass / 1 可选 Chromium skip）退出码 0；`npm run check` → `syntax ok: 20 files`；`validate-package` 通过；`clientBytes 3952095`。

## 第 75 轮：核心拒绝码的本地化显示

界面此前只在 `INCOMPLETE_PLAN` 一处做了翻译，其余拒绝（`REVISION_CONFLICT`、`PLAN_LOCKED`、`DEPENDENCY_BLOCKED`、`FILE_CONFLICT`、`EVIDENCE_REQUIRED`、`VERIFICATION_RUN_BLOCKED`、`ABANDON_NOT_RESERVED`、`LOCK_BUSY`、`NOT_FOUND`、`CORRUPT_STATE`、`PATH_UNSAFE`、`ENGINEERING_WORKSPACE_MISMATCH` 等）都把核心的英文原文直出。

- 新增 `/* BEGIN ERROR MESSAGE SUMMARY */` 纯函数块：`errorParts(message)` 把 `CODE: detail` 拆开，`ERROR_KEYS` 覆盖 21 个人类可触发的码，`errorDisplay(message)` 输出本地化句子。
- 只有 `DEPENDENCY_BLOCKED`、`FILE_CONFLICT`、`VERIFICATION_RUN_BLOCKED`、`DISPATCH_RUN_BLOCKED` 追加 detail——这四类 detail 是任务 id 或 runId，人类需要据此行动；其余 detail 是英文散文，追加只会制造中英混排。`INVALID_TRANSITION` 特判为「当前状态只允许这些流转：」+ 目标列表。
- **未映射的码保持原文**，不做猜测性翻译；这样新增的拒绝码不会显示成错的句子。
- `run()` 的统一漏斗改为 `setError(errorDisplay(message))`，此前只走 `planErrorKey`。新增 `tests/client-error-messages.test.js`（8 项，含「未映射码保留原文」与「每个映射码都有双语条目」）。
- 同步把 `tests/client-approve-guard.test.js` 的漏斗断言改为「走 `errorDisplay`、不再出现裸 `setError(message)`」。

**真机尝试（未取得读数，如实记录）**：在夹具上分别尝试用「外部改 revision 后保存」「隐藏选中变更后重新加载」「外部改 revision 后重新规划」触发核心拒绝，三次都被界面自己的提交前守卫先拦住（显示「方案有新修订。当前编辑已保留…」「此操作会替换当前未保存的编辑…」），核心根本没被调用。这说明守卫生效，但没有拿到一条「核心拒绝 → 中文句子」的界面读数；该项目前只有单元测试与源码断言支撑。

- 全套件 612 项（611 pass / 1 可选 Chromium skip）退出码 0。

## 第 76 轮：标签页可访问性与派发前的同任务验证检查

只读审查（client-audit-2）留下的两条 P2 项在本轮落地。

**标签页语义**：四个视图此前是一排 `aria-pressed` 的切换按钮，对屏幕阅读器而言是「四个独立开关」，不是「一个标签组」。现改为 `role="tablist"` + `role="tab"` + `aria-selected` + `aria-controls="ep-tabpanel"`，面板侧两种状态（空态与正常）都带 `id="ep-tabpanel"`、`role="tabpanel"`、`aria-labelledby` 指向当前标签；配合 roving `tabIndex`（选中 0、其余 -1）与 ←/→/Home/End 键移动焦点。

**禁用按钮的说明**：`button()` 现在把禁用原因镜像到 `aria-disabled` 与 `title`，调用方可传 `{"data-reason": …}`；批准按钮已接上（未保存 / 计划不完整 / 基线未确认三类原因）。

**派发前的同任务验证检查**：核心 `reserveDispatch` 会拒绝「同一任务已有未结案验证运行」的请求，界面此前看不到这条，会给出一个必然被拒的请求入口。`dispatchRequestBlock` 新增第五个参数 `verifyList`，同任务的非终态验证运行（`unknown` 须人工结案才算解除）直接返回 `dispatchVerificationRunning`；两处调用点都传入验证列表，且用 `typeof verificationRuns === "undefined" ? null : verificationRuns` 兼容只抽取单个函数的窄测试。

**真机读数（夹具 511370f8，`dsh-app://app/`）**：

- `nav.ep-tabs` 的 `role=tablist`；四个按钮 `role=tab`，`aria-selected` 为 `true/false/false/false`，`tabIndex` 为 `0/-1/-1/-1`；`#ep-tabpanel` 的 `role=tabpanel`、`aria-labelledby=ep-tab-overview`。
- 在第一个标签上派发 `ArrowRight`：选中态移到「架构设计」，焦点跟随到该按钮，面板 `aria-labelledby` 变为 `ep-tab-plan`。
- 「批准当前方案」`disabled=true`、`aria-disabled="true"`、`title="批准前每个任务至少需要一条验收标准。"`。
- 四张卡片正常渲染，说明用 `div` 包住原本的 `Fragment` 没有破坏布局（样式里没有直接子元素选择器）。

- 全套件 625 项（624 pass / 1 可选 Chromium skip）退出码 0；新增 `tests/client-tabs-aria.test.js`（6 项）与 `tests/client-dispatch-verify-guard.test.js`（7 项）。

## 第 77 轮：三个技能与当前能力对齐

技能正文是模型读到的操作说明书，比代码更容易过时。本轮逐条核对后改了三处：

- **architecture-design 开头**原写「插件尚无自动 executor 或独立验证能力」——在派发与验证都已落地之后这句话是错的。改为说明现有能力是单任务子 Agent 派发与单条已批准命令的执行记录，并强调二者都不替代对设计结论的独立验证。
- **engineering-review** 补了一节「交付门禁与运行处置」：用 `gateStatus` 读核心判定而不是看界面文案；同一任务已有未结案验证运行时的派发拒绝；starting/running 只能人工终止（`cancelRun` 是人工动作，模型工具没有）；unknown 须用户确认停止后结案。
- **engineering-review 的执行环境段**补上 `printf`/`grep`/`sed` 这类 POSIX 命令在 PowerShell 下不存在——这条来自 v1 真实验证失败（`printf` 在 pwsh 里是 `CommandNotFoundException`），此前只写在 planning 技能里。

新增 `tests/skill-content.test.js`（5 项）把这类漂移变成失败：技能必须有标题、不得含占位符；三个技能必须提到实际存在的工具名；`gateStatus` 与 `cancelRun` 必须在 planning/review 里可检索；过时句「尚无自动 executor 或独立验证能力」「未提供自动开发调度器」不得回归；两个面向执行的技能都必须带 PowerShell 警告。

技能正文在 `apply` 时读盘，所以改完必须重装。本次 `remove_bundle` → `install_bundle` 后，运行时 `architecture-design` 技能返回的正文已是新版本（开头那句即改动后的文本），三个技能重新出现在技能目录中。

- 全套件 630 项（629 pass / 1 可选 Chromium skip）退出码 0；`syntax ok: 20 files`。

## 第 78 轮：验证列表未加载时不再放行派发

上一轮补的「同任务验证互斥」还有一个缺口：它读的是 `verifyList.runs`。如果验证列表没加载（`null`）、正在加载或已过期，`?.runs` 会得到空数组——检查通过，按钮可用，然后被核心以 `VERIFICATION_RUN_BLOCKED` 拒绝。这正是之前修交付按钮时同一类问题（把「不知道」当成「没有」）。

- 新增前置判定：`verifyList` 是对象但 `changeId` 不匹配、`runs === null`、`loading` 或 `stale` 时返回 `dispatchVerificationLoading`，提示先刷新运行记录。
- 省略该参数（`undefined`）仍走旧路径，只为了让「只抽取单个函数求值」的窄测试能继续工作；界面两处调用点显式传 `typeof verificationRuns === "undefined" ? void 0 : verificationRuns`，真实运行时该变量一旦是 `null`（初始值或刷新失败）就会拦住按钮。
- 新增双语键 `dispatchVerificationLoading`；`tests/client-dispatch-verify-guard.test.js` 补 6 个断言（缺失、`runs: null`、`loading`、`stale`、`changeId` 不符、正常空列表仍放行），并修正一条旧断言（省略参数不再视为「已加载」）。

- 全套件 631 项（630 pass / 1 可选 Chromium skip）退出码 0。
- 未取得界面读数：`dispatchVerificationLoading` 只在「派发列表加载成功、验证列表加载失败」时出现，客户端没有构造这种半加载状态的入口；本条只有单元测试支撑。

## 第 80 轮：让 Git 观测在这个仓库上真的跑通

第 19 轮那次真实 `engineering_git capture` 返回 `output_truncated`，此后 Git 功能一直只有单元测试与"失败读数"两类证据。本轮定位到两个真实成因，修完后首次拿到完整的正向读数。

**成因一：diff 与"留存的证据文本"共用同一个 1 MiB 预算。**
采集器对每条 Git 命令都用"剩余预算"作为 `stdoutMaxBytes`，而 `git diff --binary` 要输出整个工作树。本仓库里 `client.js` 一个文件就 3.9 MB（内嵌 Mermaid），diff 必然超过 1 MiB，于是 `truncated: true`，采集按"输出不完整"失败闭合。
修复：diff 流单独给 16 MiB 上限，且不计入留存预算——diff 只用于算 sha256，算完即丢弃，从不作为证据文本保留；一旦超过 16 MiB 仍然 `output_truncated` 失败闭合（不拿半截内容算摘要）。

**成因二：`core.autocrlf` 让 `git diff` 在 exit 0 时向 stderr 打警告。**
采集器原先规定"exit 0 时 stderr 必须为空"，于是被
`warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it`
判为 `git_diagnostic`。
修复：只放行这一族行尾警告（逐行严格匹配），并在 `limitations` 记一条 `eol-normalization: …`；其它任何 stderr 诊断仍然失败闭合。

**正向读数（本工作区，`511370f8`，revision 12）**：

- capture：`status ok`、`head ddd4bdc14d2df9e1d6aa128fe939d9bc3d0b1c6e`、`headState commit`、`dirty true`、`stagedDiffSha256 e3b0c44…`（即空 diff 的 sha256）、`worktreeDiffSha256 5e0b036…`、`untrackedCount 93`、`error null`。
- compare（同一基线、未改动工作区）：`comparable true`、四项 `*Changed` 全 `false`、`observedEqual true`。
- compare（给已跟踪文件 `docs/DESIGN.md` 追加一行后）：`worktreeChanged true`、`observedEqual false`、`worktreeDiffSha256` 变为 `cb6d1fb…`。随后已把该文件按备份原样还原（`cmp` 校验字节一致）。
- 第一次漂移实验用了 `src/lock-retry.js`，结果 `worktreeChanged false`——因为该文件是**未跟踪**文件，不在 `git diff` 范围；这也顺带证明了"未跟踪文件只比路径不比内容"的既有limitation。

**新增测试（3 项）**：大 diff 被摘要而不消耗留存预算；超过自身上限的 diff 仍失败闭合；行尾警告被记为 limitation 而其它诊断仍报 `git_diagnostic`。`tests/git-collector.test.js` 现为 36 项。

- 全套件 634 项（633 pass / 1 可选 Chromium skip）退出码 0；`clientBytes 3961018`；`syntax ok: 20 files`。

## 第 81 轮：观测保留路径清单，并据此审计计划声明范围

**动机**：Git 观测此前只保存摘要（四项 sha256 + 未跟踪计数），没有任何路径事实，因此「这个改造动到的文件是否都在任务声明的范围内」只能靠人肉比对。

**采集器**：`src/git-collector.js` 从既有的 `status --porcelain=v2` 记录里提取路径（不新增命令、不读内容），输出 `changedPaths` 与 `untrackedPaths` 两个数组，去重排序后各截断到 2000 条；发生截断时追加 limitation `changed-paths: lists are capped at 2000 entries`。路径名本身是证据，文件内容仍然不采集。

**校验**：`src/git-comparison.js` 把两个数组作为**两者皆有或皆无**的可选字段——旧记录（不含这两字段）依旧可读，新记录两者必须同时存在；数组要求元素为非空且不含 NUL 的字符串，上限 2000。这样 v1 观测不需要迁移。

**审计**：新增纯函数 `src/scope-audit.js`，导出 `auditScope({ tasks, changedPaths, untrackedPaths })`：把每个观测到的路径归到声明它的任务（精确匹配；声明以 `/` 结尾时按目录前缀匹配），返回 `entries`（含 `kind` 与 `declaredBy`）、`undeclared`、`untouched`（声明了但没动到的）。路径做反斜杠归一与去重，非法输入（空串、NUL、超限、非数组）直接拒绝。

**接入**：`engineering_plan {action:"scopeAudit", changeId, observationId?}`，只读、不需要 `expectedRevision`、已加入 `isConcurrencySafe`。未指定 `observationId` 时取 `finishedAt` 最新的一条；没有观测返回 `state:"no_observation"`，观测不含路径清单（旧记录或失败观测）返回 `state:"observation_incomplete"`，两种情况都不猜。条目超过 200 时截断并在 `entriesOmitted` 报告省略数量。

**真机读数**（夹具 `511370f8`，观测 `65b1b407-b983-4cf4-a848-ecc547968828`）：`state:"compared"`，`sourceRevision 12`，17 个已跟踪变更路径 + 95 个未跟踪路径，`declaredCount 0`、`undeclared` 列出全部 112 个路径——与事实相符：该夹具的任务没有声明 `expectedFiles`，审计如实报告「没有一条观测路径落在声明范围内」。

**测试**：`tests/scope-audit.test.js` 9 项（归因、目录前缀、未声明、未动到的声明、点段不折叠、反斜杠归一与去重、kind 区分、非法输入、一个路径归两个任务）；`tests/scope-audit-core.test.js` 5 项（真实 store 里的归因、审计不写 state、无观测/旧观测不猜、最新观测与指定观测、未知观测与多余字段拒绝）。采集器与比较器测试同步调整（路径保留断言、可选字段兼容）。

- 全套件 648 项（647 pass / 1 可选 Chromium skip）退出码 0。

## 第 82 轮：改动范围审计进入工作台

`scopeAudit` 上一轮只有工具入口，本轮补上界面：质量门禁里新增「改动范围审计」卡片，按钮调用 `engineering_plan {action:"scopeAudit"}`，展示已声明/总路径数、未声明路径（前 12 条 + 余量计数）、以及「已声明但未出现」的悬空声明。

四种状态分别有措辞，不用同一种失败掩盖差异：未审计、结果属于另一个版本（`scopeStale`）、没有观测（`scopeNoObservation`）、观测不含路径清单（`scopeIncomplete`）。卡片只渲染，不参与任何 disabled 判定——审计是证据，不是许可。

**真机读数（夹具 511370f8，`dsh-app://app/` → 质量门禁）**：

- 初始：「改动范围审计 … 尚未审计。点击按钮后读取最近一次观测。」
- 点击后：「与当前版本一致 · 已声明 0 / 共 112 条路径 · 未声明路径 CHANGELOG.md README.md client.js docs/DESIGN.md … 另有 100 条未显示 · 已声明但未出现 没有悬空声明。」
- 该夹具的任务没有写 `expectedFiles`，所以全部 112 条都是未声明——这是事实读数，不是渲染缺陷。

- 新增 `tests/client-scope-audit.test.js`（10 项：请求形状、身份匹配、状态映射、列表预览、四种状态渲染、不参与门禁、按钮禁用条件、响应校验、挂载位置、双语齐全）。
- 全套件 658 项（657 pass / 1 可选 Chromium skip）退出码 0；`clientBytes 3967544`；`syntax ok: 21 files`。

## 第 83 轮：审计卡片三种状态的界面读数与一处徽章缺陷

上一轮记录「`scopeStale`/`scopeNoObservation`/`scopeIncomplete` 无界面读数」，本轮补齐，并因此在真实读数里抓到一个渲染缺陷。

- `scopeStale`：在夹具 511370f8 上先审计（结果绑定 revision 12），外部把 revision 推到 13 后刷新列表并进入质量门禁，卡片读「这份结果属于另一个版本，请重新审计。」
- `scopeNoObservation`：切到没有任何 Git 观测的夹具（`85b71c73`），点审计读「还没有 Git 观测。先在架构设计里采集一次。」
- `scopeIncomplete`：建一次性探针变更并用 `GitObservationStore.create` 写入一条 `status: "partial"`、不含路径清单的观测（合成夹具，验证后整目录删除），点审计读「最近一次观测没有保留路径清单（旧记录或采集失败），无法审计。」

**缺陷**：`no_observation` 与 `observation_incomplete` 两种状态下，按钮旁仍显示「与当前版本一致」徽章——徽章只判断「结果是否属于当前版本」，没判断「结果里有没有可比对的内容」。已改为仅 `state === "compared"` 时显示，并补一项反向断言（`assert.doesNotMatch` 旧写法）。

- 全套件 659 项（658 pass / 1 可选 Chromium skip）退出码 0。

## 第 84 轮：把范围审计写进工作流，并标出一处契约错位

- 技能正文补齐：`engineering-review` 新增「对照声明的改动范围」一节（怎么调 `scopeAudit`、三个返回字段的含义、`no_observation` / `observation_incomplete` 时不得下「范围正确」的结论、字面比较与目录声明不可用）；`engineering-planning` 新增「声明文件要经得起对照」（`expectedFiles` 只收具体文件，漏写不会阻止保存但会被审计标成未声明）。
- 契约错位：纯函数审计支持以 `/` 结尾的目录前缀，但核心的 `fileName` 校验会以 `PATH_UNSAFE` 拒绝目录声明，所以这条能力目前无法从任何已保存计划触发。本轮补了一条测试把它固定下来（声明 `docs/` 必须被拒），避免它变成没人知道来路的死代码。
- 运行时确认：重装后读取 `engineering-review` 技能正文，包含新的 `scopeAudit` 一节。
- 新增 `tests/skill-content.test.js` 第 6 项（两个技能都必须提到 `scopeAudit` 与 `expectedFiles`，review 必须写明「不拦截」）；`tests/scope-audit-core.test.js` 6 项。

- 全套件 661 项（660 pass / 1 可选 Chromium skip）退出码 0；`syntax ok: 21 files`。

## 第 85 轮：目录声明真正可用，冲突判定按前缀

上一轮把「审计支持目录前缀、但核心拒绝目录声明」记成契约错位并加了固定测试。本轮把这个错位消掉，而不是继续记录它。

- `src/core.js` 的 `fileName`：允许以 `/` 结尾声明目录（`docs/`、`docs/nested/`），其余规则不变——空段、`.`、`..`、盘符、Windows 保留名、尾随点或空格仍然 `PATH_UNSAFE`。
- 新增 `scopeOverlap(a, b)`：完全相等，或一方是以 `/` 结尾的目录且另一方以它为前缀，即视为同一范围。文件冲突判定改用该函数，`docs/` 与 `docs/a.md` 因此会互相冲突。
- 新增 `tests/scope-conflict.test.js`（4 项）：目录与目录内文件冲突、互不相干的目录可并行、反斜杠目录声明归一、五种非法目录写法仍被拒。
- `tests/scope-audit-core.test.js` 第 6 项从「必须被拒」改为「被接受并正确归因」：`docs/` 声明后，`docs/a.md` 与 `docs/deep/b.md` 都算已声明，`src/z.js` 算未声明。
- 两个技能正文同步改口径（`expectedFiles` 可以写目录、目录声明与其中文件同范围）。

**工具级确认**：新建一次性变更后调用 `engineering_plan save`，`expectedFiles: ["docs/"]` 被原样接受（revision 1 → 2）；探针变更随后删除，四个既有夹具未动。

- 全套件 665 项（664 pass / 1 可选 Chromium skip）退出码 0。

## 第 86 轮：文件冲突给出可定位的明细

上一轮留下的缺口：进入「执行中」被文件冲突拦下时，界面只有一句「预计文件已被占用」，不说是哪两个任务、哪两条路径撞上了。用户只能自己翻两个任务的 expectedFiles 去猜。

- `src/core.js` 的冲突判定改为收集所有碰撞对（任务 id、对方的路径、自己的路径），最多列出 3 对，超出部分标注 `(+N more)`。
- 错误消息只放明细本身（`docs/a.md overlaps DOCS docs/`），代码仍是 `FILE_CONFLICT`；界面的 `errorDisplay` 会把它渲染成本地化句子 + 明细，既有映射规则不用改。
- 新增 1 项测试：`tests/scope-conflict.test.js` 第 5 项断言错误消息同时含 `docs/a.md`、`DOCS`、`docs/`，且单条冲突时不出现 `(+N more)`。

- 全套件 666 项（665 pass / 1 可选 Chromium skip）退出码 0。

**未取得界面读数**：触发这条路径需要「已批准方案 + 两个声明范围重叠的任务」，批准只能由用户完成，因此本轮只有核心测试与 `errorDisplay` 的离线渲染验证（`<errFileConflict> docs/a.md overlaps DOCS docs/`）。

## 第 87 轮：交付门禁带上改动范围摘要（信息，不是阻塞）

此前要看「改动是否越出声明范围」，得在质量门禁里另点一次「审计改动范围」；而判断能不能交付时，人又在看另一张卡片。两处证据分开摆，容易只看其中一处。

- `gateStatus` 现在附带 `scope` 摘要：`state` 为 `included` 或 `no_observation`，以及 `observationId`、`planVersion`、`sourceRevision`、`changedCount`、`untrackedCount`、`pathCount`、`declaredCount`、`undeclaredCount`。
- **它不产生 blocker**：未声明路径可能是合法的（工具生成、格式化、文档），把范围漂移变成交付阻塞会让门禁变成猜疑。摘要放在这里只是让评估交付的人一眼看到差距。
- 只采用 `status === "ok"` 且保留路径清单的观测；没有这样的观测就说 `no_observation`，不用旧记录或失败记录凑数。
- 界面在核心判定列表下面加一行「改动范围：已声明 X / 共 Y 条路径（观测 Z）」；无观测时显示「尚无可用观测（不影响交付判定）」。

**真机读数（夹具 511370f8 → 质量门禁 → 重新加载）**：「改动范围：已声明 0 / 共 112 条路径（观测 65b1b407-b983-4cf4-a848-ecc547968828）」，与同一夹具上单独执行 `scopeAudit` 的 `changedCount 17 + untrackedCount 95` 一致。

- 过程中发现一处口径错误：摘要最初只用 `changedCount` 作为总数，界面显示「共 17 条路径」，漏掉了 95 条未跟踪路径。已改为 `pathCount = changedCount + untrackedCount`，测试与界面同步。
- 全套件 667 项（666 pass / 1 可选 Chromium skip）退出码 0。

## 第 88 轮：只读的「现在能开哪些任务」

此前要知道某个任务能不能开始，只能自己去读依赖、看有没有在跑的运行、比对 expectedFiles 有没有重叠——三处规则分散在核心的 transition 分支里，界面和模型都只能靠猜。

- 抽出 `startConstraints(s, task, runs)`：依赖缺失列表 + 文件重叠对。`transition` 与新的 `readyTasks` 共用同一实现，避免「预览说能开、真开却被拒」。
- 新增只读动作 `engineering_plan { action: "readyTasks", changeId }`：返回 `ready`（可立即开始的任务 id）与逐任务的 `reasons`，每个 reason 带具体明细（缺少哪个依赖、与哪个任务的哪条路径重叠、哪个运行占着）。
- 原因覆盖：`APPROVAL_REQUIRED`（整份计划未批准）、`TASK_NOT_PENDING`、`DEPENDENCY_BLOCKED`、`FILE_CONFLICT`、`ACTIVE_RUN`、`UNRESOLVED_UNKNOWN`。规则与 transition 的拒绝理由一一对应。
- 两个存储的记录本来没有 `kind` 字段，`readyTasks` 读入时补上，报告里才能说清是派发还是验证占着任务。

**真机读数（夹具 511370f8，revision 13，未批准）**：`ready: []`；`ANALYZE` 只有 `APPROVAL_REQUIRED`；`API`/`UI` 多一条 `DEPENDENCY_BLOCKED detail: "ANALYZE"`；`JOIN` 的是 `"API, UI"`；`REVIEW` 的是 `"JOIN"`。依赖链与夹具的 DAG 一致。

- 新增 `tests/ready-tasks.test.js` 6 项（全空前沿、未批准、依赖链推进、文件重叠定位、在飞派发占用、只读与多余字段拒绝）。
- 全套件 673 项（672 pass / 1 可选 Chromium skip）退出码 0。

## 第 89 轮：任务看板改用核心的「可开始」判定

任务看板原来自己算「下一项依赖已满足的任务」：读 `dependencies` 状态、忽略审批、忽略文件冲突与在飞运行。规则和 `transition` 各写一遍，两边迟早不一致。

- 客户端新增 `/* BEGIN READY SUMMARY */` 纯函数块（`readyQuery`/`readyMatches`/`readySet`/`readyReasons`/`readyCodes`），`refreshReady(targetId)` 走 `/engineering` 命令读 `readyTasks`。
- 有当前 revision 的结果时，看板的「下一项」直接取核心给出的 `ready` 集合；没有时回退到原来的本地推断，且不显示任何计数——不把「不知道」显示成「没有可开始」。
- 任务摘要里新增「当前可开始 N」，与运行记录同一个刷新入口（`重新加载`）更新；切换变更时清空，避免把上一份计划的前沿挂在新计划上。
- 一处必须避开的撞名：`readyCount` 早已表示「已准备项目」（六项规划就绪度），拿它显示任务前沿会让两个数字共用一个标签。新键是 `frontierCount`。

**真机读数（夹具 511370f8 → 任务看板）**：`已完成 0 / 5 阻塞任务 0 当前可开始 0`——该计划未批准，与 `readyTasks` 的「每项都是 APPROVAL_REQUIRED」一致。

- 新增 `tests/client-ready-tasks.test.js` 9 项（查询形状、修订绑定、集合语义、原因取值、看板优先使用核心结果、回退分支、加载器校验、变更加载时清空、摘要只在新鲜时显示且不复用 `readyCount`）。
- 全套件 682 项（681 pass / 1 可选 Chromium skip）退出码 0。

**未取得**：有可开始任务的真机读数（需要已批准计划）。

**第 90 轮修正**：当时记录的「导航时需手点一次重新加载」不是设计意图，而是背景刷新被人工动作锁挡住，见下一节。

## 第 90 轮：背景刷新不再排队等人工动作锁

第 88、89 两轮都记录过一个现象：切换变更后，运行记录、交付门禁、当前可开始都要手动点一次「重新加载」才出现。当时的推测是「自动刷新被交互锁挡住」。本轮确认这就是原因，并且它是实现问题，不是产品选择。

- `autoRefreshRuns` 里有 `if (lock.current) return "busy";`，随后最多重试 2 次、每次 250ms。点击变更会走 `run(action)`，整个 `list + get` 期间都持有 `lock.current`；等锁释放时，两次重试早已用尽。
- 该守卫的初衷是避免后台读与人工动作互相干扰，但后台刷新只读，且响应归属已经由 `acceptRunsFor`（变更身份 + revision）与 `changeSequence` 双重校验，不需要靠锁来保证正确性。
- 因此删除这条锁检查，保留「一次只刷一个目标」（`runsRefresh`）与「过期响应丢弃」。人工动作仍然串行，只是不再阻塞读取。

**真机读数**：重载页面 → 进入工作台 → 点开夹具 511370f8 → 切到任务看板，不做任何点击，2.5 秒内摘要已是 `已完成 0 / 5 阻塞任务 0 当前可开始 0`；再切到夹具「插件 0.3.0 真实链路验收」，摘要同样自动变成 `已完成 0 / 1 阻塞任务 0 当前可开始 0`。修复前这两处都需要手点「重新加载」。

- 既有测试 `tests/client-poll-identity.test.js` 中「a human action is never overtaken」断言随之翻转：现在是 `assert.doesNotMatch(body, /if (lock.current) return "busy";/)`，并注明正确性由 `acceptRunsFor` + 序列保证。
- 全套件 682 项（681 pass / 1 可选 Chromium skip）退出码 0。

## 第 91 轮：派发请求按钮解锁，以及「前沿 > 0」的第一个读数

两件事：拿到「当前可开始 > 0」的真实界面读数；查清派发请求按钮在已批准、pending、没有活动运行的情况下仍然禁用的原因。

**读数**：把已批准的 v1 变更里那个 failed 任务放回 pending（`transition` 到 pending，revision 7 → 8，理由写明只为验证计数），`readyTasks` 返回 `approved: true / ready: ["READONLY-SMOKE"] / dispatchable: true`；任务看板自动刷新后读到 `已完成 0 / 1 阻塞任务 0 当前可开始 1 下一项依赖已满足的任务 · 只读派发与固定输出验证`。

**缺陷（真机才发现）**：`dispatchRequestBlock` 的「同任务验证互斥」检查期望的是信封 `{ changeId, runs }`，而组件里 `verificationRuns` 存的是**普通数组**（`setVerificationRuns(result.runs)`）。于是 `verifyList.runs` 恒为 `undefined` → 每个任务都被判成「验证记录尚未加载」，按钮永远禁用。这条分支此前只有单测（用信封形状喂进去），所以一直显示为通过。

- 修复：守卫同时接受两种形状——数组按数组读，信封按信封读；`loading`/`stale`/`changeId` 只在信封形状下判断。
- 同时补上真正缺失的分支：同任务存在非终态验证运行时返回 `dispatchVerificationRunning`（此前只判「未加载」，不判「有运行」）。
- 按任务过滤：只有 `record.taskId === taskId` 的验证运行才算互斥，别的任务在跑不影响本任务派发。

**真机复验（夹具 3c83caa4，已批准，任务 pending）**：「填入派发请求 / 复制派发请求」由 `disabled: true` 变为 `disabled: false`。

- 客户端 248 项全过；全套件 682 项（681 pass / 1 可选 Chromium skip）退出码 0；`clientBytes 3972550`。

## 第 92 轮：点「填入派发请求」到底填了什么

上一轮只验证到按钮可用。本轮点了它，读回真实草稿内容。

**草稿全文（夹具 3c83caa4，READONLY-SMOKE，revision 8）**：

```text
请调用 engineering_dispatch，严格使用以下参数：
{
  "changeId": "3c83caa4-1249-4752-a4cf-59eaab8d83d5",
  "taskId": "READONLY-SMOKE",
  "expectedRevision": 8,
  "planVersion": 1,
  "requestId": "4ba58cb7-145f-48c4-9c94-56cffd8315e7"
}
保留 requestId 重放此尝试；returned 不等于任务完成或验收通过，请评审结果再记录证据。
```

- 五个字段齐全，`expectedRevision` 取的是当前 revision（8），不是缓存的旧值。
- 填入后视图切到会话，草稿落在输入框里（`contenteditable`），不会自动发送。
- 连续点击不会把提示词叠加成两份：实测同一次填入后 `请调用 engineering_dispatch` 只出现一次。

**一处需要说清的行为**：离开工作台再回来重新点「填入」，`requestId` 会变（`4ba58cb7…` → `1420bfa3…`）。缓存在组件状态里，视图重挂载即丢失。这不影响正确性——`requestId` 的意义是「这一次尝试」的标识，要保留就该连草稿一起保留；但如果用户期望「同一个任务反复填都拿同一个 id」，现在的实现不满足，已记入未覆盖项而不假装一致。

- 本轮未改代码，仅真实读数与文档。全套件 682 项（681 pass / 1 可选 Chromium skip）。

## 第 93 轮：派发 requestId 在视图重挂载后仍然一致

第 92 轮记录过一处不一致：离开工作台再回来重新点「填入派发请求」，`requestId` 会变。原因是缓存挂在组件内的 `React.useRef(new Map())`，视图卸载即丢。

**修复**：把缓存提到插件作用域（与 `draftCache` 同层），用 `requestMaps` 按 `sessionId|kind` 保存，`requestMapFor(sessionId, kind)` 首次取用时创建；`ctx.effect` 的清理函数里与 `draftCache`、`pendingPlans` 一起 `requestMaps.clear()`。组件的 `gitRequests`/`dispatchRequests` 改为 `React.useRef(requestMapFor(props.sessionId, "git" | "dispatch"))`，`cachedDispatchRequest` 的键仍然是 `[change.id, change.planVersion, change.revision, taskId]`，因此换版本、换任务依然产生新的 id。

**真机验证**：点「填入派发请求」得到 `requestId: a74c4d50-b7c0-45bc-8bb9-11d131cc86f8`；清空输入框、回到会话、再进工作台重新点一次，得到的仍是 `a74c4d50-b7c0-45bc-8bb9-11d131cc86f8`（`expectedRevision` 都是 8）。视图重挂载不再换 id。

**新增测试** `tests/client-request-id.test.js` 4 项：缓存位于插件作用域且随插件清理；键含 change/planVersion/revision/taskId；`requestId` 每次缓存条目只生成一次（`nativeDispatchRequest` 内不直接调 `randomUUID`）；组件不再各自 `new Map()`（唯一剩下的 `React.useRef(new Map())` 是任务详情展开状态）。

- 全套件 686 项（685 pass / 1 可选 Chromium skip）。

## 第 94 轮：终止运行的表单、双门禁与跨宿主拒绝（真实读数）

`cancelRun` 此前只有 Host 侧单元测试，界面从未被读过。本轮用一次性夹具把它跑通。

**夹具构造**（`21e54470-0edd-432e-b866-9f403e6bfbba`，验证后整目录删除）：`create` + `save`（单任务 `RUNNING-PROBE`）→ `DispatchRunStore.reserve()` → `update({state:"starting", jobId:"bash-fixture-cancel-0001"})` → `update({state:"running"})`。`reserve` 是 **async**，第一版漏了 `await`，拿到的 `{}` 让后续 `runId` 全是 `undefined`。

**读数**（任务看板 → 执行记录 → 运行卡片）：`state running`、`jobId bash-fixture-cancel-0001`，卡片内出现「终止当前运行」折叠区，说明为「终止只调用原生 jobs.kill：运行由 runner 结算为 cancelled，不改变任务状态、证据、审批与交付确认。」，表单含「终止理由（必填）」textarea 与确认项「我确认终止这次运行…」，按钮初始 `disabled: true`。

**双门禁**：只填理由 → 仍 `disabled: true`；再勾确认 → `disabled: false`。两项都是必要条件。

**跨宿主拒绝**：故意提交（该运行记录 `hostInstanceId` 为夹具值，不属于当前 apply），界面回「该运行由另一个宿主实例创建，本页面无法终止；请在创建它的宿主实例中操作。」——Host 的 `ENGINEERING_RUN_FOREIGN_HOST` 有可读文案，且拒绝发生在任何 `jobs.kill` 之前。

**仍未被真实覆盖的**：成功终止（需要当前宿主真的在跑该 job，只能由真实派发或验证产生，而两者都要用户批准）。`starting`/`running` 的「需执行终止证据，本版未提供」文案已在本轮之前读到过，本轮补的是「可终止」路径。

- 本轮未改代码；全套件 686 项（685 pass / 1 可选 Chromium skip）。夹具已清理，`.dsh/engineering/changes` 恢复四个。

## 第 95 轮：工具动作与 README 的对齐门禁

起因：`gateStatus`、`readyTasks`、`scopeAudit` 三个动作早已注册，README 里却一个都没有；与此同时「哪些动作只读、哪些只对人工开放」只散落在代码里。Agent 读 README 会漏掉三分之一的查询能力。

**改了 README**：新增「只读查询（Agent 与界面共用）」一节，逐个说明 `gateStatus`（含六类 blocker 与 `scope` 摘要不产生阻塞）、`readyTasks`（六种 `reasons`）、`scopeAudit`（三态与「不能下范围正确结论」）、`approvalBaselineStatus`，以及 `list` / `get` / `context` 三个通用只读动作；并写明写操作需要 `expectedRevision`、哪些动作只对人工入口开放。

**新增门禁** `tests/readme-actions.test.js` 3 项：

1. `index.js` 里 `const actions = [...]` 的每一项都必须以反引号形式出现在 README 中（首次运行即抓到 `list`、`get`、`context`、`dispatchRuns` 四处缺失）。
2. 人工专属动作（`approve`、`replan`、`acceptDelivery`、`resolveUnknown`、`resolveDispatchUnknown`、`abandonRun`、`cancelRun`）不得出现在模型工具的动作枚举里，但 README 必须仍然记录它们。
3. 只读动作必须在 `isConcurrencySafe` 白名单里，写动作（`save`/`transition`/`evidence`/`create`/`export`）必须不在。

这条门禁的价值不在当下——而在下一次新增动作时，忘记更新文档会直接红。

- 第 95 轮开始前为 686 项，本轮增至 689 项（688 pass / 1 可选 Chromium skip）。
- 全套件 689 项。

## 第 96 轮：导出目录不再「看起来都对」

起因：`export` 从不删除文件（有测试明确固定了这一行为）。于是一个目录在标准模式导出、后来改成轻量模式再导出时，`requirements.md`、`architecture.md` 等仍留在磁盘上——读目录的人无法分辨哪些属于当前版本。

**改动（`src/core.js` 的 export 分支）**：写完投影后枚举目录（含 `diagrams/`），把「已知投影名 ∩ 在磁盘上 ∩ 本次未写」算成 `stale`，写入 `manifest.json`：`{schemaVersion, changeId, planVersion, revision, mode, exportedAt, files, stale}`。返回值新增 `manifest` 与 `stale`，**`files` 仍只含本次写入的投影**，所以既有的 14/13/5 项计数断言与「保留旧文件」语义都不变。

**界面**：导出卡片末尾追加「导出清单：<路径>」，`stale` 非空时在文件列表之前先给一行「另有旧导出的文件未被本次导出更新：…」。

**新增测试**：`tests/export-manifest.test.js` 3 项（manifest 内容与 `files` 一一对应、`stale` 精确列出被清理的旧投影且旧文件仍在磁盘上、每次导出重写 manifest 且不递增 revision）、`tests/client-export-manifest.test.js` 2 项（卡片读取 `stale`/`manifest` 两个字段且仍展示文件列表、两个新文案都有中英双语）。`tests/core.test.js` 中「空轻量导出」的目录清单断言补上 `manifest.json`。

**真实读数**（夹具 `511370f8`，standard，revision 13）：导出后卡片尾部为「导出清单：J:\Code\Engineering Planner\.dsh\engineering\changes\511370f8-…\manifest.json」，磁盘上的 `manifest.json` 为 `mode: standard`、14 个文件、`stale: []`。`stale` 非空时的界面行只有单元测试支撑（需要「先写过某份文档、后清空再导出」的夹具，本轮未造）。

- 第 96 轮开始前为 689 项，本轮增至 694 项（693 pass / 1 可选 Chromium skip）。
- 全套件 694 项。

## 第 97 轮：`stale` 的真实触发条件（并更正第 96 轮的说法）

第 96 轮我在 README 里写过「标准模式导出后改用轻量模式，`requirements.md` 会留在目录里」。这句话是错的：`mode` 在 `create` 时固定，`save` 不接受它，因此**不存在中途切换模式**这回事。

真实触发条件是轻量模式下的「有内容才写」：`export` 对可选文档和图源只在非空时写文件，所以先导出、再把某篇文档或某张图源清空、再导出，旧文件就留在磁盘上并被列入 `stale`。

**两次真实夹具**：

1. standard 模式（change `e5efa220`，已删除）：第一次导出 14 个文件、`stale: []`；清空 `findings` 与 `sequence` 后再导出仍是 14 个文件、`stale: []`——因为标准模式无条件写全部八篇文档与四张图源。这个反例说明第 96 轮的「模式切换」解释站不住。
2. lite 模式（change `fc4a2347`，验证后删除）：第一次导出 8 个文件、`stale: []`；清空 `findings` 与 `sequence` 后再导出 6 个文件、`stale: ["diagrams/sequence.mmd", "findings.md"]`，两个旧文件确实仍在磁盘上。

**界面读数**：同一 lite 夹具点「导出 Markdown」，输出末尾为「另有旧导出的文件未被本次导出更新： diagrams/sequence.mmd, findings.md」，随后是「导出清单：…\manifest.json」。第 96 轮记为「只有单测支撑」的那一行，现在有真实读数了。

- 本轮未改代码，只有文档更正与真实读数；全套件 694 项（693 pass / 1 可选 Chromium skip）。

## 第 98 轮：按原方案重写交付状态表

`docs/DELIVERY-STATUS.md` 的阶段表停在一个多月前的样子：P0 policy 仍写「未批准真实门禁」（此后来过多次真实读数）、P1 UI 的验证证据只列到「三图/错误恢复/Git 比较」，而实际上英文界面、浅色对比度、ARIA、导出清单、范围审计、门禁三态、派发草稿、requestId 稳定都已取得读数。表格落后于证据日志，读起来像是「这些都没验」。

本轮按证据重写整张表，规则是：「验证证据」一列只写真实发生过的读数——真实界面 DOM、原生工具返回、真实子 Agent/命令运行；只有单元测试支撑的，明确写「仅测试」。同时把「剩余工作」写具体（例如 P1 workflow 的「成功终止」注明需要当前宿主真正持有 job）。

「当前下一验收顺序」也重写为五步：批准 v2 → 跑正向链 → 取得成功终止读数 → 补齐三处仅测试支撑的分支 → 再谈自动编排与隔离。并明确「在单任务执行尚未取得完整成功链之前不扩展」。

**新增门禁** `tests/delivery-status.test.js` 3 项：九个阶段行必须齐全；文件必须保留「不作为整体完成声明」与「只有单元测试支撑的」两句（防止把限定语删掉变成完成声明）；必须指向待批准的 v2 变更并要求用户本人点交付，且不得出现「正向闭环已完成」。

- 第 98 轮开始前为 694 项，本轮增至 697 项（696 pass / 1 可选 Chromium skip）。
- 全套件 697 项。

## 第 99 轮：`dispatchVerificationRunning` 终于有真实读数

这条分支第 76 轮就写好了，此后一直只有单测支撑：它要求「方案已批准 + 该任务存在未结案验证运行」，而这两件事我在前几轮都没法同时造出来——合成运行放在未批准的草稿上，会被审批门禁先拦下。

**这次的条件**：夹具 `3c83caa4` 本来就是已批准方案（`approvals` 里有 `planVersion 1` 的人工批准，revision 8，任务 `READONLY-SMOKE` 处于 `pending`）。用 `VerificationRunStore(root).reserve({ changeId, taskId, planVersion, commandIndex: 0, command, requestId, hostInstanceId, ownerSessionId })` 直接造一条 `reserved` 运行（runId `4a9191a1-0d2b-414f-8412-ca8bf1bea970`），不改 `state.json`。

**界面读数**：该任务的「填入派发请求 / 复制派发请求」两个按钮都变 `disabled`，卡片给出「该任务已有未结束的验证运行，先等它结束或由人工终止后再派发。」——门禁顺序也得到验证：批准已满足，才轮到同任务验证互斥。

**清理**：删掉合成的 `runs/4a9191a1-….json`，`runs/` 只剩两条真实记录（失败的验证 `f9d8b388`、返回的派发 `2d330e17`）。

- 本轮未改代码；全套件 697 项（696 pass / 1 可选 Chromium skip）。

## 第 100 轮：范围审计与冲突判定的比较口径统一

`scopeOverlap`（文件冲突判定，核心）早就是大小写不敏感的：`SRC/A.js` 与 `src/a.js` 视为同一文件。而 `src/scope-audit.js` 的 `declares()` 是严格字符串比较。同一个仓库里两处相邻判定对「是不是同一个文件」给出相反答案：任务声明 `CLIENT.JS`、Git 报告 `client.js` 时，冲突门禁认为撞上了，范围审计却说「未声明」——审计会制造假阳性，而它存在的意义正是让评审者相信结论。

**改动**：`src/scope-audit.js` 引入 `fold(value) = value.toLowerCase()`，声明与观测路径都折叠后比较；**输出仍保留观测到的原始大小写**（证据不该被我改写）。点段仍然不折叠——`src/../client.js` 与 `client.js` 依旧是不同字符串，这条原有语义与测试都没动。

**测试**：`tests/scope-audit.test.js` 10 → 11 项，新增两条——声明 `SRC/Core.js` + `Docs/` 对观测 `src/core.js` + `DOCS/guide.md` 全部归因且 `entries[].path` 保留观测写法；以及「只是大小写不同但仍未命中」时仍进 `undeclared` 与 `untouched`。原「字面比较」用例改名为「点段不折叠」，避免与新口径混淆。

**重装与真机**：remove → install（0.3.0，四工具与三技能恢复）。真实 `scopeAudit`（夹具 511370f8，观测 `65b1b407`）：`state: compared`、`changedCount 17`、`untrackedCount 95`、`entriesOmitted 0`，条目与改动前一致（本仓库路径无大小写差异，属预期）。

- 第 100 轮开始前为 697 项，本轮增至 699 项（698 pass / 1 可选 Chromium skip）。
- 全套件 699 项。

## 第 101 轮：任务卡片直接说明「此刻为什么还不能开始」

`readyTasks` 早就返回了每个任务不能开始的六种原因，但界面只用它算了看板顶部的一个计数（「当前可开始 N」）。用户看到某个任务没开始，还是得自己读依赖、翻运行记录、回想方案有没有批准。

**实现**：`client.js` 新增 `READY_REASON_KEYS`（六码 → locale 键）与 `readyReasonKey(code)`；任务详情的依赖行之后渲染「此刻还不能开始的原因」列表，逐条显示原因，`DEPENDENCY_BLOCKED` 这类带 `detail` 的追加 ` · ANALYZE`。整块以 `readyFresh` 为门——查询结果过期就不显示，避免拿旧版本的理由误导。

**真机读数**（夹具 511370f8，未批准，revision 13）：

- `ANALYZE`：「此刻还不能开始的原因 / 当前方案未获人工批准」
- `API`：「当前方案未获人工批准」「前置任务未完成 · ANALYZE」

**同一轮修掉一处过时文案**：派发提示原本写「刷新页面或重新挂载视图会生成新请求」——第 93 轮已把 requestId 缓存提到插件作用域，重挂载不再换号，这句话会让人误以为必须靠复制来固定 id。改为「在本插件加载期内复用 requestId（重挂载视图不会换号），换版本或换任务才会生成新请求」。

**测试**：`tests/client-ready-reasons.test.js` 3 项——六个码都有映射、映射到的键在双语字典里都有两条字符串、渲染块以 `readyFresh` 为门且拼 `detail`。

- 第 101 轮开始前为 699 项，本轮增至 702 项（701 pass / 1 可选 Chromium skip）。
- 全套件 702 项。

## 第 102 轮：任务详情显示每条验证命令的最近一次运行

任务可以有多条验证命令（`verificationCommands`），但界面此前只列出命令文本：某条命令跑过没有、上次是失败还是成功、退出码多少，都得去运行记录里翻 `commandIndex` 对照。

**实现**：新增纯函数 `latestCommandRun(runs, taskId, index)`——按 `taskId` 与 `commandIndex` 过滤，取 `updatedAt` 最新的一条；命令列表里每条后面追加该状态徽章与退出码，从未运行过则显示「尚未运行」。运行记录未加载时（`verificationRuns` 为 `undefined`）返回 `null`，不会凭空显示状态。

**真机读数**（夹具 `3c83caa4`，任务 `READONLY-SMOKE`）：「验证命令（每行一项） printf ep-positive-smoke · 失败 · exit 1」——对应真实的失败运行 `f9d8b388`。

**过程中撞到的真实缺陷**：第一版用 `h(null, null, ...)` 作多子节点包裹，运行时抛 “Element type is invalid”，整个工作台视图白屏。改为 `React.Fragment` 后恢复。并加了门禁 `assert.equal(source.includes("h(null"), false)`——这类错误 `node --check` 抓不到，只有渲染时才炸。

**测试**：`tests/client-command-runs.test.js` 5 项（最新一条胜出、不串任务/命令、列表缺失不抛、渲染接线、禁止 `h(null`）。

- 第 102 轮开始前为 702 项，本轮增至 707 项（706 pass / 1 可选 Chromium skip）。
- 全套件 707 项。

## 第 103 轮：验证请求也复用同一个 requestId（并修正一处不准确的文案）

第 93 轮把派发请求的 id 缓存提到插件作用域，但**验证请求仍在每次点击时 `crypto.randomUUID()`**。两种请求走同一套提示语，提示语却说「同一变更/版本/修订/任务复用 requestId」——对验证路径并不成立：重挂载后再点，会拿到新 id，于是同一次尝试被当成两次。

**实现**：新增 `cachedVerifyRequest(cache, change, taskId, commandIndex, makeId)`，键为 `[change.id, change.planVersion, change.revision, taskId, commandIndex]`，缓存挂在 `requestMapFor(props.sessionId, "verify")` 上（与派发、Git 同一层，随插件清理）。验证请求的 payload 改为整份取自缓存条目，不再逐次铸造 id。

**语义**：换方案版本、换任务、换命令都会得到新 id——它们是不同的尝试；同一尝试在插件加载期内保持同一个 id，重放才有意义。

**文案**：派发提示改为「派发与验证请求都在本插件加载期内复用各自的 requestId（重挂载视图不会换号），换版本、换任务或换命令才会生成新请求」。

**测试**：`tests/client-verify-request-id.test.js` 5 项——同任务同命令复用同一 id；换命令得到新 id；换版本/修订得到新 id；payload 不再逐点击铸造 id；两种请求的缓存都在插件作用域。

- 第 103 轮开始前为 707 项，本轮增至 712 项（711 pass / 1 可选 Chromium skip）。
- 全套件 712 项。

未取得界面读数：验证入口只在「方案已批准 + 任务处于 verifying」时出现，这两件事都需要用户本人操作。

## 第 104 轮：运行状态标签补齐（含一次真实渲染验证）

第 102 轮给每条验证命令加了「最近一次运行」徽章，徽章走 `textStatus(value)`——它在 `words` 里找不到键时**原样回退英文**。而 `words` 只有七个任务状态（`pending`…`cancelled`）和 `passed`，缺运行专有的七个状态：`reserved`、`starting`、`returned`、`succeeded`、`timed_out`、`error`、`unknown`。中文界面里因此会看到 `succeeded`、`timed_out` 这类原始值。

**修复**：`words` 补七个双语音条（已预留 / 启动中 / 已返回 / 执行成功 / 已超时 / 执行出错 / 状态未定）。键名必须与 store 里的状态值逐字相同，因为 `textStatus` 是 `words[value]` 直接查表。

**门禁**：新增 `tests/client-run-state-labels.test.js` 3 项——十个运行状态每个恰好两条非空、中英不相同的标签；确认查询走 `textStatus` 而不是硬编码列表；确认命令徽章与任务徽章都经 `badge()` 渲染。默认套件 712 → 715 项。

**真实读数**（夹具 `3c83caa4`，任务 `READONLY-SMOKE`）：用 `VerificationRunStore` 依次推进 `reserved → starting → running → succeeded` 造一条成功运行（`requestId fixture-verify-succeeded-0002`，`hostInstanceId fixture-host-succeeded`），重载后任务详情的命令行徽章显示 **「执行成功」** 与 `· exit 0`——修复前该位置显示原始值 `succeeded`。

**副作用与清理**：这条合成运行让 `readyTasks` 立刻把任务标成「该任务已有未结束的运行 · verification … running」（另有一条脚本中途失败留下的 `running` 记录），说明运行状态确实参与可开始性判定。两条合成记录已删除，`runs/` 只剩真实失败运行 `f9d8b388`，夹具 `state.json` 未改动（revision 8，任务 pending）。

- 第 104 轮开始前为 712 项，本轮增至 715 项（714 pass / 1 可选 Chromium skip）。
- 全套件 715 项。

## 第 105 轮：把交付状态文档的数字也纳入门禁

第 73 轮加的 `scripts/check-doc-counts.mjs` 只比对两处：README 的「当前完整套件为 N 项」和 `docs/VERIFICATION.md` 里最后一次「全套件 N 项」。`docs/DELIVERY-STATUS.md` 顶部那句「套件 N 项（…）」和「更新：…（第 N 轮）」不在校验范围内，于是它一路停在 **694 项 / 第 98 轮**，而实际已经是 715 项 / 第 104 轮。

这是本项目第二次出现同类问题（第 96、97 轮是 `stale` 的错误解释）。共同点：**没有任何机制能发现"文档说的"与"实际是的"不一致**——只有人恰好重读那一段才会发现。

**改动**：`scripts/check-doc-counts.mjs` 新增三个纯函数 `deliveryStatusClaim`（读交付状态文档的套件数）、`deliveryStatusRound`（读「更新：…（第 N 轮）」）、`latestVerificationRound`（取 VERIFICATION 里最大的轮号标题）；CLI 把交付状态文档的套件数并入 `compareClaims`，并新增一条不变量：**交付状态文档声明的轮号必须等于 VERIFICATION 的最新轮号**——否则说明改了一处忘了另一处。

**门禁首次运行的输出**（真实捕获，非构造）：

```text
doc-count: docs/DELIVERY-STATUS.md claims 694, actual is 715
doc-count: docs/DELIVERY-STATUS.md says round 98, latest round in VERIFICATION.md is 104
```

修正后：`doc counts ok: 720 tests, round 105`。

**测试**：`tests/doc-rounds.test.js` 5 项——头部两处声明都能解析；轮号只从「更新：」行读、不会被证据条目里的「第 99 轮」误导；最新轮号取标题最大值；两份真实文档的轮号一致；`compareClaims` 同时报「数字漂移」与「缺少声明」两类问题。

- 第 105 轮开始前为 715 项，本轮增至 720 项（719 pass / 1 可选 Chromium skip）。
- 全套件 720 项。

## 第 106 轮：失败/阻塞后仍可补记复盘证据（且只能记失败）

原来的门禁是 `if (t.status !== "verifying") fail(...)`：任务一旦从 verifying 推到 failed 或 blocked，就再也写不进任何证据。可现实里顺序常常相反——先发现命令炸了、把任务标成 failed，再回头写「为什么失败、现场是什么」。这条路径此前是堵死的，逼着人要么在 verifying 里抢着记，要么把复盘写进规划文档（那里没有版本与 criterion 归属）。

**核心改动**（`src/core.js` 的 evidence 分支）：允许 `verifying`、`failed`、`blocked` 三种状态记录证据，但后者**只接受 `outcome: "failed"`**——否则就可以从 failed 直接写一条「通过」，绕开 verifying 与逐项验收。任务状态、`completed` 门禁、交付门禁都不因此放宽：`completed` 仍要求当前版本每项标准的最新证据为 passed。

**客户端**（`client.js` 证据表单）：任务下拉从「仅 verifying」扩为 `EVIDENCE_TASK_STATES = ["verifying", "failed", "blocked"]`；选中失败/阻塞任务时，outcome 只剩 `failed`，并显示提示「该任务处于失败或阻塞状态，只能补记失败证据：用于留下失败原因与现场，不会让任务变成已完成。」；提交按钮额外要求 `evidence.outcome === "failed"`。

**真实工具读数**（已批准夹具 `3c83caa4`，任务 `READONLY-SMOKE`）：

- `transition` pending → running（revision 8 → 9）→ failed（9 → 10）。
- 在 failed 上 `engineering_plan {action:"evidence", outcome:"failed"}` → 接受，revision 10 → 11，证据 `a25efd0e-b8e9-422d-87fd-b57ead56ee03` 同时进入 `task.evidence` 与 `state.evidence`，**任务状态仍为 failed**。
- 同一条 criterion 再提交 `outcome:"passed"` → 拒绝，原文：`A failed or blocked task only accepts failed evidence`。

**测试**：`tests/evidence-task-states.test.js` 5 项（failed/blocked 接受失败证据且不改状态；failed 拒绝 passed；pending 与 running 仍拒绝任何证据；失败证据不满足完成门禁）+ `tests/client-evidence-postmortem.test.js` 3 项（任务下拉含三态、失败任务只剩 failed、提示文案双语）。第 106 轮开始前为 720 项，本轮增至 728 项。

- 全套件 728 项。

**未取得界面读数**：本轮浏览器 IPC 在切换到该夹具时持续超时（`the DSH window did not answer in time`），表单提示与只剩 `failed` 的下拉只有源码与单测支撑，已如实记录在 UI-ACCEPTANCE。

## 第 107 轮：工作区根守卫的真实读数，以及守卫错误丢失错误码

### 一、把 P1-a 从单测搬到真实工具调用

第 58 轮加的工作区根校验（`admittedWorkspace`）此前只有单元测试。这轮用真实工具调用验证：把会话工作目录切到工作区的子目录 `docs`，再调用三个工具。

| 调用 | 返回 |
| --- | --- |
| `engineering_plan {action:"list"}` | `ENGINEERING_WORKSPACE_MISMATCH` |
| `engineering_verify {...}` | `ENGINEERING_WORKSPACE_MISMATCH` |
| `engineering_git {action:"capture"}` | `Workspace policy changed`（同一个 `ENGINEERING_WORKSPACE_MISMATCH`，消息更具体） |

随后检查 `docs/.dsh`：**不存在**——拒绝发生在任何写入之前，没有产生第二个不可见的 store。把目录切回工作区根后 `list` 立即恢复，四个夹具原样返回（`3c83caa4` rev 11、`511370f8` rev 13、`85b71c73` rev 3、`9dd058d6` rev 2）。

### 二、守卫错误此前没有错误码

顺着上面第三条读数发现的问题：工具层只渲染 `error.message`，而 `index.js` 的 25 处守卫全写成 `throw new Error("ENGINEERING_XXX")`，**没有 `code` 属性**。命令通道的包装是

```js
return { kind: 'error', text: `${error.code || 'ENGINEERING_ERROR'}: ${error.message}` };
```

于是界面收到的是 `ENGINEERING_ERROR: ENGINEERING_WORKSPACE_MISMATCH`——首段是兜底码，而 `client.js` 的 `ERROR_KEYS` 是按第二段建表的，**映射永远命中不了**，用户看到的是原始英文码。第 75 轮加的 20 多条本地化句子，对这些守卫错误一条都没生效。

改法：

1. `index.js` 增加 `const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };`，25 处 `throw new Error("ENGINEERING_…")` 全部改为 `fail(...)`，错误码随错误对象走。
2. 命令通道包装去重：`error.message === error.code` 时只输出一个码，避免 `CODE: CODE`。
3. `client.js` 的 `ERROR_KEYS` 补 10 个此前未映射的守卫码（会话缺失、取消、非法输入、未知动作、人工专属、工具执行上下文、运行未在运行、无 jobId、异宿主、输入过大），并补 10 对双语句子。

### 三、门禁

新增 `tests/guard-error-codes.test.js` 5 项：守卫错误在命令通道只输出一个码、不出现 `ENGINEERING_ERROR`；核心错误保留自己的码与明细（`REVISION_CONFLICT: …`）；**每一个 Host 守卫码都必须在 `ERROR_KEYS` 里有映射**（源码扫描，防止下次新增守卫时又漏掉）；每个映射键在 `words` 里都有两条非空且互不相同的文案；`errorDisplay("ENGINEERING_RUN_FOREIGN_HOST")` 渲染成中文句子而不是码，未映射的码仍原样透出。

第 107 轮开始前为 728 项，本轮增至 733 项。

- 全套件 733 项。

**局限**：模型侧看到的 `engineering_git` 报错仍是 `Workspace policy changed`（工具层只打印 message，不打印 code），本轮改善的是工作台界面侧；界面读数因 webview IPC 仍在超时未取得，`ERROR_KEYS` 的新条目只有单测支撑。

## 第 108 轮：工具侧错误也带错误码，以及「轻量/标准」到底差在哪

### 一、模型侧错误码（第 107 轮遗留的局限）

第 107 轮修好了工作台界面侧的守卫错误，但留下一条限制：模型通过工具调用看到的错误仍然只有 `error.message`。于是同一个 `ENGINEERING_WORKSPACE_MISMATCH`，在 `engineering_plan` 里显示成裸码（因为 message 就是码），在 `engineering_git` 里却显示成 `Workspace policy changed`——**码丢了**，模型无从判断是哪一类拒绝。

改法：`index.js` 增加 `codedError(error)`，把 `code` 补到 message 前面（`ENGINEERING_XXX: 明细`），并对「message 已等于 code」或「已有 `CODE:` 前缀」的情况保持原样；四个工具统一经 `toolExecute(fn)` 包装，命令通道的格式化逻辑不动（它自己会拼出同样形状，重复前缀会被 `codedError` 幂等吸收）。

真实读数（把会话目录切到工作区子目录 `docs` 后）：

| 调用 | 改前 | 改后 |
| --- | --- | --- |
| `engineering_git capture` | `Workspace policy changed` | `ENGINEERING_WORKSPACE_MISMATCH: Workspace policy changed` |
| `engineering_plan list` | `ENGINEERING_WORKSPACE_MISMATCH` | `ENGINEERING_WORKSPACE_MISMATCH`（幂等，未变成 `CODE: CODE`） |

切回工作区根后 `list` 恢复，四个夹具 revision 未变（11 / 13 / 3 / 2）。

### 二、「轻量/标准」的差别没有写在界面上

第 96–97 轮查明：标准模式导出时无条件写全部八篇文档与四张图源；轻量模式只写有内容的，上次留下、本次未重写的文件会进 `manifest.stale`。这个差别此前只存在于文档与我的记忆里，界面只有一个「轻量 / 标准」徽章。

现在规划视图的统计行下面按 `change.mode` 显示一行说明（`modeLiteHint` / `modeStandardHint`），轻量模式那句直接点明 stale 的来历，避免用户把「8 篇只出来 6 篇」当成 bug。

### 三、门禁

新增 `tests/tool-error-code.test.js` 5 项（message 等于 code 时不动、有自定义 message 时前置 code、无 code 的错误原样透出含 AbortError、四个工具都经 `toolExecute` 包装且无人绕过、命令通道格式未被改动）与 `tests/client-mode-hint.test.js` 3 项（两条文案都有双语、按 mode 选择、轻量那句必须提到 stale）。第 108 轮开始前为 733 项，本轮增至 741 项。

- 全套件 741 项。

**未取得界面读数**：`browser_eval` 仍 `the DSH window did not answer in time`，模式说明那行没有真实渲染证据。

## 第 109 轮：修掉「重建脚本」的两个真问题（--check 是假的、重建会改坏内嵌库）

### 一、`--check` 一直是假的

`scripts/embed-mermaid.mjs` 从来没有解析过命令行参数：**任何调用都会重写 `client.js`**，`--check` 只是被忽略的字符串。我在第 103、108 轮记的「两次 `--check` 输出一致，说明幂等」其实是「写了两次，结果一样」。

这条错误的代价不在于多写一次文件，而在于它会掩盖差异：一个本该报「内嵌块已过期」的检查，反而在每次运行时把过期内容默默改成最新——检查器变成了写入器。

### 二、重建会改坏内嵌库

加上真正的 `--check` 后立刻暴露：`changed: true`。继续查，问题在转义这一步：

```js
JSON.stringify(vendor).replace(/\\u2028/g, '\\\\u2028')
```

这个正则匹配的是**两字符文本 `\u2028`**，而它恰好大量出现在 mermaid 自身的源码字符串里（`JSON.stringify` 已把反斜杠转义成 `\\`，于是 `\\u2028` 里含有可被匹配的 `\u2028`）。替换给它再加一层反斜杠——重建一次，内嵌库的字面量就长出 21 个多余的反斜杠，**被嵌进去的代码内容被悄悄改了**。

当前仓库里的 `client.js` 是更早一版脚本写出来的，所以它解析回来仍与 vendor 完全一致；一旦用旧脚本重建，就会变成被改坏的那一版，而且检查器还不会告警。

### 三、改法

1. 真正实现 `--check`：只比较、不写盘；内容不一致时以非零退出并提示「to rebuild」。
2. 比较改成**内容相等**而非字节相等：同一个 vendor 可以用不同转义形式表达（`\uXXXX` 与原字符），字节不同不等于内容漂移，避免无意义的整文件重写。
3. 转义只处理 `JSON.stringify` 唯一会留下、且放进 JS 字符串字面量不安全的字符——**原始 U+2028 / U+2029**；不再去碰字面文本 `\u2028`。
4. 重建后自检：把生成的块解析回来必须与 vendor 完全相等，否则报错并且不写盘。
5. 兼容旧调用：仍接受一个可选的位置参数，但只有它解析后等于本仓库的 `client.js` 才继续，避免误重建别的文件。

### 四、验证

| 场景 | 结果 |
| --- | --- |
| 真实仓库 `--check` | `{"check":true,"changed":false,"clientBytes":3982884}`，退出 0，`client.js` 哈希不变 |
| 临时副本：把内嵌块里的 `mermaid` 改成 `mermAid` | 退出 1，stderr 含「differs from the vendor asset」与「to rebuild」，文件字节未变 |
| 临时副本：把内嵌块换成占位符 | `--check` 退出 1 且不写盘；不带参数运行则重建，重建后解析结果与 vendor 完全一致 |

新增 `tests/embed-mermaid-check.test.js` 3 项覆盖上面三行；原有 `tests/embed-mermaid.test.js` 7 项（含 U+2028/U+2029、CRLF、`$&` 特殊替换符）在新逻辑下仍全过。第 109 轮开始前为 741 项，本轮增至 744 项。

- 全套件 744 项。

**更正**：第 103、108 轮文档里「`embed-mermaid --check` 幂等/只读」的说法不成立，那时的 `--check` 等于一次重写。

## 第 110 轮：清掉一个卡了五天的扫描障碍，并给它加上门禁

### 一、仓库根上有一个 `CON`

在 `src` 里搜 `TODO` 时，工具报告了一个跳过原因：`invalid-path: J:\Code\Engineering Planner\CON`。也就是说，**整个工作区根目录的遍历被一个文件挡掉了一部分**，而这个文件已经在根目录里躺了五天（2026-11-19 11:15 创建）。

打开看，内容是 `Username for 'https://github.com': `——那是某次 `git push` 要求输入凭据时被重定向落盘留下的。`.gitignore` 里早有 `/CON` 一行（第 13 轮的记录），但「已被忽略」不等于「不该在那儿」：它既不是插件资源，也不是构建产物，而且名字是 Windows 的保留设备名。

### 二、为什么设备名文件会伤到工具

Windows 把 `CON`、`PRN`、`AUX`、`NUL`、`COM1..9`、`LPT1..9` 当作设备而不是普通文件。列出目录没问题，但打开/读取它们会命中设备语义，于是批量遍历要么跳过整棵树、要么报错中断——本轮 `ops_grep` 因此以 `scanComplete=false` 收场。对需要「全仓扫描」的检查（依赖清单、路径审计、密钥扫描）来说，这是静默的盲区。

### 三、清理与门禁

删除该文件后根目录只剩预期条目。为防再次发生，新增 `tests/repo-root.test.js` 3 项：

1. 根目录条目必须落在白名单内（`.git`、`src`、`tests`、`assets`、`client.js`、`docs`、`scripts` 等 20 项），多出任何东西就失败；
2. 任何条目都不得匹配 Windows 设备名（`con|prn|aux|nul|com[1-9]|lpt[1-9]`）；
3. 三个入口文件（`index.js`、`client.js`、`package.json`）存在且未明显截断。

**门禁本身也验证过**：把 `CON` 重新造出来跑一次，前两项都红并报 `Unexpected top-level entries: CON`；删掉后 3/3 绿。否则这只是个永远为真的断言。

第 110 轮开始前为 744 项，本轮增至 747 项。

- 全套件 747 项。

**教训**：`2>CON` 这种写法在 MSYS 下会真的创建一个叫 `CON` 的文件，而不是写控制台；一次性急的凭据重定向，会在几天后以「某个扫描器莫名跳过」的形式回来。

## 第 111 轮：context 恢复时直接给出「现在卡在哪」，并把浏览器桥的故障定性

### 一、`context` 现在带门禁摘要

`context` 是上下文被压缩后唯一的恢复入口。此前它给了目标、六项就绪度、任务与证据 —— 但**不给交付门禁的结论**：模型恢复后还得再查 `gateStatus`、`readyTasks` 和两个运行列表，才知道「现在能不能交付、卡在哪」。

现在 `context` 附带一个紧凑的 `gate` 块（不复制历史记录）：

```json
{ "ready": false, "approved": true, "deliveryAccepted": false,
  "blockerCodes": ["TASK_NOT_TERMINAL", "NO_COMPLETED_TASK"],
  "activeRuns": [], "unresolvedUnknownRuns": [] }
```

它复用 `gateStatus` 的同一套判定（不是第二套规则），只把结论投影出来：阻塞码去重、活动运行保留 `kind/runId/taskId/state/jobId`、未结案 unknown 单独列。

**真实读数**（已批准夹具 `3c83caa4`，revision 11，任务 failed）：`approved: true`、`deliveryAccepted: false`、`ready: false`、`blockerCodes: ["TASK_NOT_TERMINAL","NO_COMPLETED_TASK"]`、两个运行列表均为空——与第 107 轮单独调用 `gateStatus` 的结论逐项一致，且 `context` 前后 revision 未变（只读）。

新增 `tests/context-gate.test.js` 3 项：门禁结论与阻塞码；活动运行同时出现在 `blockerCodes` 与 `activeRuns`，且 `context` 不移动 revision、不清运行记录；**体积护栏**——`gate` 块里不得出现完整 `runs` 或 `blockers` 原文，序列化后小于 400 字符（防止有人日后把整张表塞回来）。第 111 轮开始前为 747 项，本轮增至 750 项。

- 全套件 750 项。

### 二、浏览器桥的故障定性（为什么不是插件的锅）

工作台的浏览器工具从第 106 轮起持续返回 `the DSH window did not answer in time`。为了不让「界面没验」变成含糊的借口，这轮做了三项排查：

| 检查 | 结果 |
| --- | --- |
| HTTP 服务 | `127.0.0.1:56356` 有 ESTABLISHED 连接，服务在跑 |
| CDP 调试端口 9222 | 无响应，拿不到第二条通道 |
| CPU 采样（5 秒） | 主进程 +0.55s（约 11% 单核）、另外两个进程 +0.02s；无空转 |

结论：**应用活着、没有死循环**——如果是插件里的渲染环，主进程会持续吃满一个核。这是主窗口控制通道（webview IPC）层面的偶发不应答，与第 79 轮同型。真实界面读数因此继续缺口，已在 UI-ACCEPTANCE 按「未取得」记录，不按「已验收」处理。

## 第 112 轮：范围数字必须带上「什么时候看到的」

交付门禁里那行「已声明 0 / 共 112 条路径（观测 65b1b407…）」有个隐患：**它没有时间**。一个三天前、四十个 revision 之前采的观测，和一个刚采的观测，长得完全一样。读者无从判断这组数字还能不能代表现在的工作树。

改法：`scopeSummary` 在 `included` 分支补 `observedAt`（取观测的 `finishedAt`，回退 `capturedAt`），`no_observation` 分支明确给 `null`；工作台把它渲染在观测 id 后面，缺失时降级成 `—` 而不是 `undefined`。

**真实读数**（夹具 `511370f8`，revision 13，未批准）：

```json
"scope": {
  "state": "included",
  "observationId": "65b1b407-b983-4cf4-a848-ecc547968828",
  "observedAt": "2026-11-20T05:45:33.745Z",
  "sourceRevision": 12, "changedCount": 17, "untrackedCount": 95, "pathCount": 112,
  "declaredCount": 0, "undeclaredCount": 112
}
```

注意 `sourceRevision: 12` 与当前 `revision: 13` 的差别——这正说明「数字属于哪一版」需要和「什么时候采的」一起看。

新增 `tests/client-scope-time.test.js` 3 项：核心两个分支分别给时间和 `null`；中文模板暴露 `{at}` 且渲染时从 `scope.observedAt` 取值；缺失时降级为 `—`，且不允许无保护的直接插值。第 112 轮开始前为 750 项，本轮增至 753 项。

- 全套件 753 项。

**本轮的一个操作失误**：为找时间格式化函数，我对 `client.js` 用了 `grep`，命中第 10 行那条约 3.7 MB 的内嵌 Mermaid 字面量，一次就把大量上下文烧掉。规矩早就写过——`client.js` 只能按行读（`ops_inspect_local_file`）或用极窄锚定，不能整文件搜索。这次是自己踩了自己写的坑。

## 第 113 轮：把「这组数字是旧的」直接说出来

上一轮把观测时间放进了 `gateStatus.scope`，但读者仍要自己比对两个数字（`sourceRevision` 与当前 `revision`）才能发现差异。这轮让门禁自己说。

`scopeSummary` 的 `included` 分支增加 `stale: latest.sourceRevision !== s.revision`；工作台在摘要下方按 `gate.scope.stale === true` 渲染一行警示：「该观测采集于修订 {observed}，当前是修订 {current}；之后的改动没有被这次观测覆盖，必要时重新采集。」

**真实读数**（夹具 `511370f8`）：

```json
"scope": {
  "state": "included",
  "observationId": "65b1b407-b983-4cf4-a848-ecc547968828",
  "observedAt": "2026-11-20T05:45:33.745Z",
  "stale": true,
  "sourceRevision": 12,
  "changedCount": 17, "untrackedCount": 95, "pathCount": 112,
  "declaredCount": 0, "undeclaredCount": 112
}
```

`stale: true` 来自 `sourceRevision 12` 与当前 `revision 13` 的差异——不需要读者自己发现。

刻意保持的性质：**它是信息，不是阻塞项**。`blockers` 里没有它，`ready` 不受它影响；观测过期只说明这组数字不覆盖最新改动，规划本身可能仍然可交付。测试里专门加了一条断言，防止以后被谁顺手塞进 `blockers`。

新增 `tests/client-scope-stale.test.js` 3 项：核心按版本差计算 `stale`；文案同时点名两个修订号，且渲染受 `gate.scope.stale === true` 与 `gateMatches` 双重约束；`stale` 提示不得与 blocker 文案混用。第 113 轮开始前为 753 项，本轮增至 756 项。

- 全套件 756 项。

**未取得界面读数**：`browser_eval` 仍 `the DSH window did not answer in time`（第 111 轮已定性为 webview IPC 通道故障），这行警示文字只有源码与单测支撑。工具侧的 `stale: true` 是真实读数。

## 第 114 轮：文档里写着「还没做」的两处功能其实已经做了

起因是一次全仓 `TODO|FIXME|未实现` 扫描（第 110 轮清掉 `CON` 之后才能扫全）。16 条命中里有两处不是待办，而是**过时断言**：

1. `docs/DESIGN.md` 的残留运行段仍写「既不能自动恢复，也不能用 `resolveUnknown` 结案，`replan` 同样被拦，只能手工删除 `runs/*.json`……当前版本尚未实现」。实际上第 58 轮已实现 `abandonRun`（`reserved` 且无 `jobId`），第 74 轮已实现 `cancelRun`（本宿主的 `starting`/`running`）。照这段文档行事，读者会去 `rm` 而不是走会写历史的命令。
2. `docs/UI-ACCEPTANCE.md` 有一段 700 字的「剩余UI验收」，把「跨会话读取、未保存内容保护、取消/失败反馈、明暗主题」列为待验——这四项后来分别在真机或门禁层完成（第 53–56、61、91、94 轮）。它混着十几轮的历史结论，读起来像当前状态。

改法：DESIGN 的残留运行段改成三档表（`reserved`→`abandonRun`、`starting`/`running`→`cancelRun`、`unknown`→人工结案），并明确写出**仍缺的一档**：`starting`/`running` 且 `hostInstanceId` 属于别的宿主实例——jobs 注册表是进程内的，句柄不可达，也没有终止证据，所以不给出口。UI-ACCEPTANCE 的那段替换为一句历史说明加当前真实边界（只有两类读数缺失：必须由用户操作的路径，以及第 79 轮起 IPC 不应答期间新增的文案）。

新增 `tests/design-claims.test.js` 3 项把这三件事钉住：DESIGN 必须写出三档出口且不得再出现「当前版本尚未实现」；必须点明跨宿主这一档仍无出口、`recover` 仍无调用点；UI-ACCEPTANCE 不得再以「剩余UI验收：」开头列出已完成的项，必须带历史标记。

第 114 轮开始前为 756 项，本轮增至 759 项。

- 全套件 759 项。

本轮未改功能代码；三个夹具状态未变（`3c83caa4` rev 11、`511370f8` rev 13、`85b71c73` rev 3、`9dd058d6` rev 2）。

## 第 115 轮：两次独立审查指出的三条真缺陷

`host-audit`（只读审查 `index.js`，那个在二十轮里改得最频繁、最少被独立看过的文件）报了 10 条，其中三条我核对后确认为真，本轮全部修掉。

### 1. 验证被取消后，命令仍然执行

`src/verification-runner.js` 建了 `const controller = new AbortController()`，但全文件没有一处把 `exec.signal` 接上来。于是 `if (controller.signal.aborted)` 那道「spawn 之前就取消」的检查对调用方取消**永远不可达**——用户按了取消、父会话被拆掉，命令照旧执行（验证命令会写盘、跑 git）。同一仓库的 `dispatch-runner.js:116-121` 是正确接法，两者行为相反。

修复：补 `exec.signal.addEventListener("abort", onCallerAbort, { once: true })`、已 abort 时立即触发、`done` 的 `finally` 与准入失败路径里 `detachCaller()`。修完那条测试的旧断言（「取消后 `request.signal.aborted` 必须仍是 false」）正好把缺陷写成了期望，一并改正：现在断言调用方 abort 会传到 runner 控制器、进程被 kill、记录落 `cancelled`。

### 2. 取消被重新包装成「失败」

`src/dispatch-runner.js` 两处 catch 用 `new Error(detail)` 重建错误，只抄了数值 `code`、丢了 `name`。`AbortError` 变成普通 `Error`，工具层因此把用户取消报成失败。改为 `persistThenRethrow`：先把 detail 持久化，`AbortError` 原样重抛，其它错误仍构造带 code 的新错误（第二处此前连 code 都丢，一并补上）。新增测试断言 `name === "AbortError"`、`code === 20` 都还在。

### 3. 插件重载后，运行既不能终止也不能放弃

`cancelRun` 用 apply 级的 `hostInstanceId`（每次 apply 一个新 UUID）当闸门，而 DSH 的 jobs 注册表是**进程级**的——重载前创建的 job 句柄仍然有效。旧逻辑一律判 `ENGINEERING_RUN_FOREIGN_HOST`，而唯一的兜底 `abandonRun` 只接受 `reserved` 且无 `jobId`，于是这条 run 永久卡死，`save`/`transition`/`evidence` 全被阻断。

修复：`hostInstanceId` 降级为告警字段（结果里新增 `sameHost`），真正的判据交给注册表——`jobs.kill` 抛 `JOB_NOT_FOUND` 时返回新的 `ENGINEERING_RUN_EXECUTOR_GONE`（明确告诉用户：进程里已无句柄，记录不会被自动改写，需人工确认后按 unknown 结案）；`already-finished` 也单独作为 `outcome` 上报，不再与「已请求终止」同形。顺带修了调用方身份：`jobs.kill` 的 caller 改用记录里持久化的 `ownerSessionId`，而不是发命令的会话 id——跨会话终止此前必然 `JOB_FOREIGN_SESSION`。

这三条都有新测试：`tests/cancel-run.test.js` 增「上一次 apply 创建的运行仍可终止」「句柄消失报 EXECUTOR_GONE」「已结束的运行报 already-finished」；`tests/dispatch-runner.test.js` 增「取消保留 AbortError 身份」；`tests/verification-runner.test.js` 的旧断言改为验证取消真的传到了控制器。

### 未采纳的两条

- **git 路径绕过 `admittedWorkspace`**（P2）：审查指出 git 操作在 `createGitOperations` 内部自己 `ensure` 再内联比对 policy，少了 `sandboxPolicy` 存在性守卫、错误码也不是 `ENGINEERING_WORKSPACE_MISMATCH`。属实，但改动会牵动 `src/git-operations.js` 的注入签名与现有 git 测试，且第 107 轮已用真实调用验证过它确实会拒绝工作区外目录——本轮不动，记入待办。
- **plan schema 的 `expectedRevision` 缺 `minimum: 1`**（P3）：schema 放行、核心再拒，多一次往返但不会出错。留作后续。

第 115 轮开始前为 759 项，本轮增至 762 项。

- 全套件 762 项。

## 第 116 轮：工作区准入只剩一份实现

上一轮 `host-audit` 指出的 P2：`engineering_plan` / `engineering_verify` / `engineering_dispatch` 都走 `admittedWorkspace`，只有 Git 路径在 `createGitOperations` 内部自己 `workingDirectory.ensure` 再内联比一遍 `sandboxPolicy`。

这看着只是重复，实际上是两套授权检查：

- 少了 `typeof ctx.sandboxPolicy?.resolve === "function"` 的守卫——摘掉 `sandboxPolicy` 时抛 `TypeError` 而不是 `ENGINEERING_SESSION_REQUIRED`；
- 错误码对不上——同样是工作区不符，另外三个工具是 `ENGINEERING_WORKSPACE_MISMATCH`（裸码，工作台能本地化），Git 这里带自定义文案 `Workspace policy changed`，于是同一件事在两条通道上呈现不同；
- 没法注入，所以这条准入逻辑在测试里根本测不到。

改法：`createGitOperations(ctx, admitted)` 接受宿主注入的准入函数，`index.js` 传 `(agent, signal) => admittedWorkspace(ctx, agent, signal)`；模块内保留一个自带 policy 校验的兜底（供独立使用与既有单测），但**只有一处** `sandboxPolicy?.resolve`，并由测试钉住这个数量。

**真实读数**（把 `working_directory` 切到 `J:\Code\Engineering Planner\docs` 后调 `engineering_git capture`）：

```text
改前：ENGINEERING_WORKSPACE_MISMATCH: Workspace policy changed
改后：ENGINEERING_WORKSPACE_MISMATCH
```

改后与另外三个工具完全同形；切回工作区根后 `engineering_plan list` 恢复四个夹具（rev 11 / 13 / 3 / 2）。

新增 `tests/git-admission.test.js` 3 项：宿主确实把 `admittedWorkspace` 注入给 Git 工具；注入后 Git 工具只调它、不再碰 `workingDirectory.ensure`（用计数断言 `admitted === 1 && ensured === 0`，并让 `sandboxPolicy.resolve` 一被调用就抛错）；`src/git-operations.js` 里 `sandboxPolicy?.resolve` 只出现一次。

第 116 轮开始前为 762 项，本轮增至 765 项。

- 全套件 765 项。

## 第 117 轮：四个工具 schema 的同一条线

上一轮收尾时留下的 P3 是件小事，但它反映的是一类更常见的问题：**同一条规则在四处各写一遍，其中一处漏了**。

`engineering_verify` / `engineering_dispatch` / `engineering_git` 的 `expectedRevision` 都写了 `minimum: 1`，只有 `engineering_plan` 是光秃秃的 `{ type: "integer" }`。于是模型传 `0` 或 `-1` 时，schema 放行、核心以 `REVISION_REQUIRED` 拒绝——多一次往返，且错误信息指向的不是"你传了个不可能的值"。

改法是补上 `minimum: 1`，并把两件事写进 schema 和工具描述：

- `expectedRevision` 的描述：「Required by mutating actions (save, transition, evidence, export); read-only actions must omit it.」
- 工具描述加一句：「every action rejects fields that belong to another action, so pass only what that action documents (read-only actions take action plus changeId, and omit expectedRevision)」

第二句解决的是同一个 schema 的另一半毛病：`engineering_plan` 是扁平 schema，`title`/`goal`/`patch` 对 `list`/`get`/`gateStatus` 这些动作也可见，但核心会用 `keys(input, actions[action])` 把它们判 `INVALID_INPUT`。schema 层面无法按 action 分支（JSON Schema 也可以，但会把一个 15 项枚举写成 15 个 `oneOf` 分支，可读性反而更差），所以至少让调用方在描述里读到这条规则。

新增 `tests/schema-bounds.test.js` 4 项：三个带 `expectedRevision` 的 schema 都必须 `minimum: 1`；带 `planVersion` 的三个 schema 同理；plan schema 的描述必须写明只读动作要省略；描述里必须区分「写动作需要」与「只读动作省略」。

第 117 轮开始前为 765 项，本轮增至 769 项。

两点真实读数，其中一点是**对我自己说法的更正**：

```text
engineering_plan { action: "get", changeId: <9dd058d6>, expectedRevision: 0 }
→ INVALID_INPUT: Invalid action fields          # 只读动作不接受该字段（核心拦）

engineering_plan { action: "transition", changeId: <9dd058d6>, expectedRevision: 0, ... }
→ REVISION_REQUIRED: expectedRevision is required   # 0 仍然到达了核心
```

注意第二行：DSH **没有**在运行期校验 `minimum: 1`，`0` 一路到了核心，由核心的 `REVISION_REQUIRED` 拒绝。所以这一轮的改动实际是**给模型看的契约**（少一次无效往返的前提是模型读 schema），真正的门禁一直是核心那一行。这与第 75/107 轮的教训同型：schema 描述用于让调用方少犯错，不能当成运行时校验。


- 全套件 769 项。

## 第 118 轮：三处文档还在描述上一轮已经改掉的行为

上一轮把 `cancelRun` 的判据从「apply 实例相同」换成「job 句柄仍在注册表里」，但三处文档继续描述旧行为：

| 位置 | 旧说法（已过期） |
| --- | --- |
| `README.md:47` | 「属于另一个宿主实例的运行会返回 `ENGINEERING_RUN_FOREIGN_HOST`——jobs 注册表是进程内的，跨实例无从终止」 |
| `docs/DESIGN.md:52` | 出口表条件写「有 `jobId` 且 `hostInstanceId` 等于当前 apply 实例」 |
| `docs/DESIGN.md:103` | 「记录的 `hostInstanceId` 必须等于当前宿主实例……早拒绝比让用户看到"未知 job"更清楚」 |

三处都指向同一个已经不存在的行为。按 README 操作的人会以为插件重载后只能手动删文件；按 DESIGN 读代码的人会以为那道闸门还在。

改后的口径：

- 能否终止取决于**句柄是否仍在当前进程的 jobs 注册表里**（注册表是进程级的，插件重载前创建的运行仍可 kill）；
- `hostInstanceId` 与当前 apply 不同只返回 `sameHost: false` 告警，不再拒绝；
- 句柄不在进程里 → `ENGINEERING_RUN_EXECUTOR_GONE`，记录保持原状（没有终止证据，不能凭空写 `cancelled` 或 `unknown`）；
- job 已自然结束 → `outcome: "already-finished"`，不伪装成「已请求终止」；
- kill 的 caller 用记录里持久化的 `ownerSessionId`；
- `ENGINEERING_RUN_FOREIGN_HOST` 与界面文案保留为**历史兼容**（旧宿主仍可能返回），不再是判据。

新增 `tests/cancel-run-claims.test.js` 4 项，其中第 4 项断言 `index.js` **真的**这么做（`sameHost` 是计算而非门禁、`JOB_NOT_FOUND` 映射到 `EXECUTOR_GONE`、源码里没有 `fail('ENGINEERING_RUN_FOREIGN_HOST')`、`outcome` 三态齐全）——只改文字不改代码的话这条会红。

顺带修掉一处**测试自己过期**：第 114 轮的 `tests/design-claims.test.js` 曾断言「必须点名另一个宿主实例这一档」，而那一档在本轮被替换为「句柄缺失」。断言跟着事实走，不跟着旧结论走。

第 118 轮开始前为 769 项，本轮增至 773 项。

- 全套件 773 项。

## 第 119 轮：把「重复键」这类静默覆盖变成可检测的

第 57 轮曾手工删掉 `words` 里 6 个被同名后定义覆盖的键——那些键**从未生效**，改它们等于没改。当时靠的是人眼发现，这轮把它变成脚本。

新增 `scripts/check-locale-keys.mjs`：定位 `const words = {`、`ERROR_KEYS = {`、`READY_REASON_KEYS = {` 三个对象字面量，按声明缩进收集键名，报告在同一对象里出现两次以上的键（JS 里后者静默胜出）。`npm run check` 现在跑「语法 + 重复键」两项，`check:keys` 可单独执行。

### 第一次运行就抓到我自己写的 bug（在检查器里）

第一版把块的结束位置定为 `\n  };` 优先、否则 `\n    };`。而 `words` 实际在 326 行以 4 空格缩进结束，脚本却匹配到 1132 行的 2 空格 `};`——于是块文本多出 70KB 的后续代码，把别的对象的键也算进来，报告了 8 个「重复键」（`reviewRequirements`、`affectedModules`、`executor`、`maxRetries`、`diagrams`、`tasks`、`references`、`evidence`）。

这 8 个都是假阳性，逐行核对后每个键在 6 空格缩进下只出现一次。改法：取所有候选结束位置里**最早**的那个。修正后输出 `locale keys ok: no duplicate declarations`。

这一轮真正值得记的不是"加了个检查"，而是：**一个报错的检查器必须先证明它的报错是真的**。否则它会把 8 个假阳性变成 8 次白工。

### 让检查器自己也被检查

新增 `tests/locale-keys.test.js` 6 项：真实 `client.js` 无重复键；三个块确实都能定位（防止检查器静默跳过而永远为绿）；fixture 里构造一个重复键必须被报出且只报一次；同一键出现三次也只报一次；块缺失时报告 `block not found` 而不是通过；只读声明缩进下的键（4 空格的键属于别的对象）。

第 119 轮开始前为 773 项，本轮增至 779 项。

- 全套件 779 项。

## 第 120 轮：用覆盖率找测试盲区

`node --test --experimental-test-coverage` 全量测量时，整体行覆盖为 97.49%。`src/core.js`、`src/lock-retry.js` 已是 100%，但若干**分支**是空的，且都是「出错时怎么办」的路径：

| 位置 | 未覆盖的分支 |
| --- | --- |
| `index.js:173-174` | `jobs.kill` 报 `JOB_NOT_FOUND` → `ENGINEERING_RUN_EXECUTOR_GONE` |
| `index.js:285-287` | `/engineering` 命令的 `cancelRun` 特判分支 |
| `src/git-collector.js:174` | 采集失败后清理时 `proc.kill()` 自身抛错 |
| `src/verification-runner.js:143-144` | 取消失败时写 `cancelled` 也失败 |

前两条尤其值得注意：第 115 轮刚改掉终止语义，却没有覆盖用户真正会走的那条命令入口。

本轮补测：

1. `tests/verification-runner.test.js` 增「a caller abort between starting persistence and spawn cancels without spawning」——`starting` 落盘后、进程启动前 abort，断言 `status: killed`、`detail: Cancelled before spawn`、`spawns 0`、记录 `cancelled`。
2. `tests/ready-tasks.test.js` 增「an unresolved unknown run keeps its task out of the frontier and names the run」——造 `reserved → starting(jobId) → unknown`，断言 reasons 为 `UNRESOLVED_UNKNOWN`；人工 `resolveDispatchUnknown` 后 reasons 清空、`dispatchable true`。
3. `src/git-operations.js` 删除未注入时的本地兜底准入（9 行），改为 `TypeError`；`tests/git-admission.test.js` 翻转为「模块内不得出现 `sandboxPolicy?.resolve` 与 `workingDirectory.ensure`」「缺注入必须抛 `TypeError`」。

## 第 121 轮：把最后四条分支补齐

新增 `tests/command-cancel.test.js` 六项，走 `/engineering` 命令（`registered.command.handler`）而不是直接调函数：

- 命令入口终止运行：断言 `outcome: terminating`、`sameHost: false`（记录属另一 Host 实例仍可 kill）、`jobs.kill` 收到持久化的 `ownerSessionId` 作 caller，且**命令不改写运行状态**（记录仍 `running`，结算归 runner）。
- `JOB_NOT_FOUND` → `ENGINEERING_RUN_EXECUTOR_GONE`；`already-finished` → `outcome: already-finished`；其它异常保留自身码（`REGISTRY_BROKEN: Registry exploded`），不被借用成 gone-executor。
- 验证运行走 `VerificationRunStore` 与自己的 `ownerSessionId`；未启动的 `reserved` 运行报 `ENGINEERING_RUN_NOT_RUNNING`。

另补两条清理路径：`tests/git-collector.test.js` 增「a failing kill during cleanup is reported instead of hiding the original failure」（`cleanup_error`，消息为 `head read failed; kill failed: handle already closed`）；`tests/verification-runner.test.js` 增「a cancelled settlement failure is reported instead of claiming cancellation」（写 `cancelled` 失败时报 `failed`，不伪称已取消）。

覆盖率变化：整体 97.49% → 98.08%；`index.js`、`src/core.js`、`src/git-collector.js`、`src/verification-runner.js` 全部达到 **100% 行覆盖**。分支覆盖仍在 94% 左右，原因是不变式守卫的否定分支（如 `PATH_UNSAFE` 的类型判断）只以「被拒绝」形式被间接覆盖。

本轮未取得界面读数：`browser_tabs` 与 `browser_open` 仍返回 `the DSH window did not answer in time`。

全套件 790 项。

## 第 122 轮：整条闭环第一次在测试里走通

此前所有环节都有单测，但**没有任何一次从草稿一路走到交付**——包括测试里。这不等于坏，只是没人证明过顺序与门禁组合成立。

新增 `tests/full-loop.test.js` 两项，全部经 `ctx.tools` 注册的真实工具对象与 `/engineering` 命令驱动（执行器是假的：native jobs、subagent activation、shell 都是桩）：

1. **完整闭环**：`create` → `save`（含六项规划与一条任务）→ 未批准时 `engineering_dispatch` 被拒且 `jobs` 一次未启动 → 命令 `approve`（user）→ `gateStatus.ready=false`（`TASK_NOT_TERMINAL`、`NO_COMPLETED_TASK`）→ `readyTasks.ready=["T1"]` → 派发（`jobId` 与 `runId` 返回，子 Agent prompt 含任务）→ 运行 `returned` 但**任务仍 pending**（返回不是完成）→ `running` → `verifying` → 验证 `succeeded`、`exitCode 0` → **无证据时 `completed` 被拒** → 记 `passed` 证据 → `completed` → `gateStatus.ready=true`、`blockers=[]` → 工具侧 `acceptDelivery` 报 `HUMAN_APPROVAL` → 命令侧交付成功、`deliveryAcceptance.actor.kind=user` → 交付后 `ready=false`、`context.gate.deliveryAccepted=true`。
2. **失败与阻塞的闭环**：blocked 必须带 reason；blocked 任务只接受 `failed` 证据（`passed` 被拒，消息 `A failed or blocked task only accepts failed evidence`）；`gateStatus` 报 `TASK_NOT_TERMINAL` 与 `NO_COMPLETED_TASK`。

过程中的三处真实接口细节（都不是缺陷，是先前没写进测试的契约）：

- `engineering_dispatch` / `engineering_verify` 返回 `{ jobId, runId }`，不是运行记录本身；运行状态要另外查 `dispatchRuns` / `verificationRuns`。
- `src/dispatch-runner.js:47` 的 `currentOptions` 会读 `parent.session.requestHeader()?.config`，执行上下文必须提供该函数，否则派发在发布前就以 `error` 收尾。
- 验证要求宿主 `ctx.shell.execute` 返回**进程句柄**（`result()` 与 `done`），返回结果对象本身会直接落到 `error`。

边界照旧写清：执行器是桩，因此这两项证明的是「顺序、门禁、返回语义」，不证明任何真实命令执行过。真实闭环仍待批准 v2 变更。

全套件 792 项。

## 第 123 轮：主窗口控制为什么长期超时

第 79 轮起，`browser_tabs` / `browser_open` / `browser_eval` 一直返回 `the DSH window did not answer in time. Is the app window open?`，每次 30 秒。期间 web server 仍在监听（`127.0.0.1:56356` → 401），CPU 采样排除了死循环，9222 也没有 CDP。此前把它记作「webview IPC 偶发不应答」，本轮读到源码，结论变了。

机制：浏览器工具的宿主半边把命令压入队列，真正执行的是**应用窗口里的客户端半边**——它长轮询 `/poll` 取命令、执行、再 `POST /reply`。该循环（`package/lib/client.js:227` 的 `serve()`）只在 `stopped` 为真时退出，而 `stopped` 只由客户端插件的 `ctx.effect` 清理函数置位。

由此得到两条：

1. **任何一次插件安装/移除/热重载都会让窗口里的桥接停止轮询**，页面不重新加载就不会再注册。主窗口明明开着，工具却永远等不到 poller。
2. `alive()` 用 `parked.some(w => !w.gone)` 判断，渲染进程卡住前留下的 parked waiter 不会被清除，于是 `alive()` 说谎：请求走满 30 秒超时才报错，而错误文案把人引向「窗口没开」。

修复（修复仓库 `J:/Code/dsh-sidebar-browser-repair/package/lib/index.js`）：入队前先判 `alive()`，不活则立即以 `NOT_POLLING` 拒绝，文案直接给出「插件安装/热重载会卸载窗口半边，请 Ctrl+R 后重试」；30 秒超时文案同样补上该提示。`verify.mjs` 增加两条源码断言。

真实对比：

- 修复前：`browser_tabs` 等 30 秒 → `the DSH window did not answer in time. Is the app window open?`
- 修复后（重装本 bundle 后）：`browser_tabs` **立即**返回 `cannot reach the DSH debug port on 127.0.0.1:9222 (fetch failed)`——工具已正确跳过死桥接、落到 CDP 兜底，而本机未开调试端口。

结论与限制：恢复主窗口控制需要**一次页面重载**（Ctrl+R 或重启应用），这是代理无法代替的一步——驱动页面本身依赖这条通道。所以本轮仍未取得任何界面读数；同时说明本插件的工作台视图在每次 `plugin_manager` 安装后也需要一次重载才会换成新代码，其表现是「界面没变化」而非超时。

本轮未改工程插件代码；门禁仍为 792 项。

## 第 124 轮：门禁把「命令跑了没」也算进来

原有缺口：`gateStatus` 只看审批、任务终态、逐项证据、活动/未结案运行与范围审计。**命令运行与验收证据是两条独立记录**（这样设计是对的——人工复核也可以作为证据），但由此产生一个盲区：一个任务的每条验收标准都记为 `passed`，而它批准的命令在这个方案版本里一次都没成功执行过，门禁照样说「已就绪」。

本轮补上统计与提示，仍分两级：

- **`commands`（信息）**：`{ total, succeeded, failed, unrun, tasks: [{ taskId, succeeded, failed, unrun, entries: [{ commandIndex, command, state, runId, exitCode }] }] }`。`state` 只取**当前 `planVersion`** 下该 (task, commandIndex) 的**最后一次**尝试；`failed` 合计包含 `failed/error/timed_out/cancelled/unknown`。
- **`warnings`（提示，永不阻塞）**：任务已完成、验收标准全部 `passed`、但该任务在本版本没有任何 `succeeded` 命令时给 `{ code: "NO_SUCCEEDED_COMMAND", taskId }`。刻意不进 `blockers`：人工复核通过而命令无法在宿主运行，是完全合法的情形。

界面：交付评审的核心判定块在 blocker 列表之后追加一行 `.ep-warn`，文案为「证据已通过，但当前版本没有任何命令成功执行：{task}（仅提示，不拦截交付）。」；经 `gateWarnings()` 从 `gate.warnings` 渲染，**不从 blockers 派生**，测试专门断言二者不混用。

测试 `tests/command-summary.test.js` 六项：默认全 `unrun` 且逐条为 `null`；一次成功一次失败后计数为 `1/1/0` 且 `exitCode` 正确；同一命令两次尝试只认最后一次（`failed → succeeded` 记 succeeded、`failed` 计数归 0）；`replan` 后旧版本运行不再计入（`unrun` 回到 1）；证据通过但无成功命令 → `warnings` 有值、`blockers` 为空、`ready: true`；有成功命令 → `warnings` 为空；无命令的任务 → `total 0` 且无提示。

踩坑两条：`VerificationRunStore` 的成功判定要求 `exitCode === 0` **且** `signal` 为空、`timedOut` 与 `aborted` 均为 `false`，夹具必须显式给齐；`replan` 会被活动运行拦住，旧版本运行要先落到终态（`failed`）才能重规划。

全套件 799 项。

## 第 125 轮：导出的 progress.md 记下运行事实

第 124 轮把「命令跑了没」补进了 `gateStatus`，但 `export` 生成的 `progress.md` 仍然只有任务状态、就绪度、审批基线与交付确认——**拿到导出目录的人看不到任何运行记录**。评审者要么相信任务列表，要么回去翻 `.dsh` 里的 JSON，等于把第 124 轮的结论留在了界面里。

本轮在 `progress.md` 增加 `## Runs for this plan version` 段，来源是两个运行存储（`VerificationRunStore`、`DispatchRunStore`），只取 `planVersion` 等于当前版本的记录，逐行给出 `kind`、`runId`、`taskId`、`state`，验证运行再带 `commandIndex`、命令原文与 `exitCode`。固定附一句「runtime records are host-observed attempts, not acceptance: a succeeded command is not a passed criterion, and a returned dispatch is not a completed task.」

没有记录时**不写空表**，而是明确写：`No verification or dispatch run is recorded for this plan version. That is not proof the commands were never run elsewhere.` —— 空集合不等于「没跑过」，只是在当前宿主的记录里没有。

真实读数（夹具 `3c83caa4`，revision 11，导出后 revision 仍为 11，`stale: []`）：

```text
## Runs for this plan version

- verification f9d8b388-3a87-4eaf-80b2-5577fc136476: READONLY-SMOKE — failed (command 0: printf ep-positive-smoke), exit 1
- dispatch 2d330e17-9c17-4ff9-8902-8c9854e473fa: READONLY-SMOKE — returned
```

测试 `tests/export-runs.test.js` 三项：无运行时的说明句；当前版本运行逐条出现（`state`、`exitCode`、`runId`）；`replan` 之后旧版本运行不再出现、且导出不递增 revision。

踩坑：`VerificationRunStore` 不接受 `reserved → succeeded` 的捷径，夹具必须走 `reserved → starting(jobId) → running → succeeded`（或 `→ cancelled`），否则报 `INVALID_TRANSITION`。

全套件 802 项。

## 第 126 轮：恢复上下文也带上命令统计（只给计数）

第 124 轮给 `gateStatus` 加了 `commands`，第 125 轮把它写进导出；但 `context`（另一个入口——新会话恢复、或模型换轮后重新拿状态）里的 `gate` 块仍然只有 `blockerCodes`、`activeRuns`、`unresolvedUnknownRuns`。也就是说**恢复上下文的模型无从知道命令跑没跑过**，只能再去查一次 `gateStatus`。

本轮在 `context.gate` 增加 `commands: { total, succeeded, failed, unrun }`——只给四个计数，不含 `entries`（每条命令的 `state`/`runId`/`exitCode` 留在 `gateStatus` 里）。理由与第 111 轮相同：`context` 是恢复载荷，塞进逐条运行记录会让它膨胀，而「有没有跑、跑成没成」用计数就够做下一步判断。

真实结构（`tests/context-gate.test.js` 新增第 4 项构造 `reserved → starting → running → succeeded` 后读取）：`gate.commands` 为 `{ total: 1, succeeded: 1, failed: 0, unrun: 0 }`，`JSON.stringify(gate.commands)` 不含 `runId`，`gate` 里没有 `runs` 键。

未做：`context` 不带 `warnings`（`NO_SUCCEEDED_COMMAND`）——它针对已完成任务的人工复核提示，恢复上下文时任务状态与证据已在 `tasks` 里，重复携带会把「提示」与「阻塞」混在一起。

全套件 803 项。

## 第 127 轮：门禁只管了整篇的总数，没管同一行里的明细

`docs/DELIVERY-STATUS.md` 顶部那行同时给出三个数字：「套件 803 项（778 pass / 1 可选 Chromium skip）」。前两个是**互相矛盾**的：778 + 1 ≠ 803。实际是 802 pass / 1 skip。

原因是第 105 轮把这份文档的**套件总数**纳入门禁，但只比对总数：每次补测试时脚本把 803 改掉，pass 数没人管，于是它从 778 一路停在那里。读者按它推算会得到「还有 24 项没跑」。

本轮新增 `deliveryStatusTally(text)`（`/套件\s*(\d+)\s*项（(\d+)\s*pass\s*\/\s*(\d+)[^）]*）/`），并在 CLI 里加两条不变量：`pass + skip === total`、`total === 实测套件数`。门禁首次运行即报出真实漂移：

```text
doc-count: docs/DELIVERY-STATUS.md tally 778 pass + 1 skip != 803 total
```

同时修掉一处结构漂移：该文件里有**三个** `## 最近已核实证据` 标题——每轮都新起一节而不是续写，历史被切成三段。合并为一节（保留最早的标题，后续内容顺次归入），现在只有一处。

`tests/doc-rounds.test.js` 增至 6 项：tally 解析（含缺括号时返回 `null`）与「真实文档的 pass + skip 必须等于总数」。

全套件 804 项。

## 第 128 轮：随机操作流下的状态不变量（以及我第一版判定是错的）

单测覆盖的是我想到的路径；状态机出问题的地方往往是路径的组合。本轮新增 `tests/invariants.test.js`：用固定种子（20261120）驱动 60 步随机操作（保存、状态流转、证据、批准、重新规划、导出、`gateStatus`），每步之后读盘断言不变量。

不变量三条：

1. `status` 必须能从当前审批与任务状态推导出来；
2. 任何 `completed` 任务，其每条验收标准在**任务视图与变更视图**里都必须有当前 `planVersion`、末条为 `passed` 的证据；任务里的证据 `id` 必须在变更级证据集合中存在；
3. 被拒绝的操作不得移动 `revision`；`export` 也不得移动它。

**第一版判定是错的**：我最初写 `deliveryAcceptance ? "completed"`，把「用户确认交付」当成状态标记。实际规则在 `src/core.js:510-514`——`completed` 由「已批准 + 全部任务终态」决定，`deliveryAcceptance` 是独立字段。一个错的预言机会**静默通过**，所以这条要单独写下来。

为了确认测试不是空转，做了两件事：

- 断言随机流必须真的发生过：至少一次成功批准、一次状态流转、一次证据、一次导出、至少一个任务进入 `completed`、至少一次被合法拒绝。为此删掉了那个没有验收标准的 `T4`——它让 `approve` 永远报 `INCOMPLETE_PLAN`，整条流从未批准过。
- **变异检验**：把 `status()` 改成恒返回 `draft` 后重跑，测试立即在第 0 步报 `status must follow from approvals and task states`；恢复后重新变绿。

一处放宽：`replan` 在任务 running/verifying 时必然 `PLAN_LOCKED`，要求「必须成功 replan 一次」等于赌运气，改为要求「至少出现一次合法拒绝」。

全套件 805 项。

## 第 129 轮：三个进程同时写同一个变更，确认写入不丢

进程内队列测不出跨进程安全性。本轮新增 `tests/concurrency.test.js`：起三个独立 `node` 子进程，各自对同一变更做 12 轮「读 → 带 `expectedRevision` 保存」，遇到 `REVISION_CONFLICT` 就重读重试（每轮最多 200 次），全部结束后核账。

判据只有一条但足够锋利：**`state.revision` 必须等于 1 + 三个 worker 承认成功的写入总数**。丢一次写入，这个数就对不上；反过来如果 CAS 被绕过导致同一修订被写两次，`revision` 也会偏小。另外断言最终 `documents.proposal` 是某个 worker 的完整值（`^[abc]-\d+$`），用来发现撕裂写。

结果：36 次承认写入，`revision` 恰好 37，`list` 无警告（没有损坏条目被降级），耗时约 1 秒。

**变异检验**：把 `src/core.js` 里的 `if (action !== 'create') s.revision++;` 注释掉后重跑，测试立刻红：

```text
AssertionError: 36 acknowledged saves must each advance the revision exactly once
```

恢复后重新变绿。没有这一步，「计数一致」只是我看着顺眼。

未覆盖：真实断电/杀进程时刻的半写状态（`atomic` 用临时文件 + rename，理论上跨不过 rename，但没有做故障注入；第 52 轮的锁竞争回归是另一件事）。

全套件 806 项。

## 第 129 轮：崩溃注入与陈旧锁诊断

起因：第 128 轮的并发测试证明「两个写手不会互相覆盖」，但没有证明「写手被杀死时不会留下坏文件」。

### 崩溃注入

`tests/crash.test.js` 起子进程连续保存（`proposal` 为 2000 字符），在 120/180/240/300ms 处 `SIGKILL`，每次读回 `state.json`：

- 可解析、`id` 正确、`revision` 不回退；
- `proposal` 为空或恰好 2000 字符的完整值（半截写入会表现为长度不足）；
- `list` 不因残留文件报 `CORRUPT_STATE`；
- 断言「写手确实写过」（`revision` 增长），否则这条测试只证明了「没动过的文件不会坏」。

### 两个真实发现

1. **临时文件会永久累积**。`atomic()` 先写 `state.json.<uuid>.tmp` 再 `rename`；被 `SIGKILL` 的进程无法执行 `finally` 里的清理。新增 `cleanTemporaries(directory)`：只删匹配 `state\.json\.[0-9a-f-]+\.tmp`、`mtime` 超过 10 分钟的普通文件（符号链接跳过、`ENOENT` 容忍），在 mutation 路径、原子写之前调用——阈值保证不会动到并发写手的活文件。测试把残留文件的 `mtime` 回拨 1 小时，断言下一次保存必须删掉它。
2. **陈旧锁会让变更永久不可写**。`locked()` 在 `finally` 里 `unlink` 锁，被杀的写手同样执行不到，于是 `.lock` 留存、后续所有 mutation 在 3 秒后报 `LOCK_BUSY`。

   插件**不自动删除**这把锁：锁里只有 `pid` 与 `createdAt`，而 PID 会被复用，「这个 pid 不在了」比它看起来更弱——这与派发恢复里「不推断进程已停止」是同一条原则。改成**让拒绝可诊断**：超时后读锁内容，报

   ```
   LOCK_BUSY: Change is locked by pid 2220 since 2026-11-20T09:14:18.797Z; that process is no longer running, so the lock is probably stale. Remove .lock only after confirming the holder is gone
   ```

   第二条测试用「一个已退出的真实 pid」造锁，断言消息点名该 pid、说明存活判断、且措辞不含自动删除的含义；并断言拒绝之后锁仍在（决定权留给人）。

### 门禁

第 129 轮开始前为 806 项，本轮增至 808 项（`tests/crash.test.js` 2 项）。`node --test tests/*.test.js`：807 pass / 0 fail / 1 可选 Chromium skip；`npm run check` → `syntax ok: 22 files` + `locale keys ok`。


### 真实读数（store 层调用，非 Host 工具）

用与 Host 相同的 `EngineeringStore` 在一个临时工作区里造锁（`pid` 取自一个已退出的真实进程），然后保存：

```json
{
  "deadPid": 20420,
  "waitedMs": 3015,
  "code": "LOCK_BUSY",
  "message": "Change is locked by pid 20420 since 2026-11-20T09:17:25.310Z; that process is no longer running, so the lock is probably stale. Remove .lock only after confirming the holder is gone",
  "lockStillThere": true
}
```

确认 3.0 秒超时后才拒绝（不是立即失败）、消息点名真实 pid、锁在拒绝后仍存在；删除锁后同一次保存成功（revision 前进）。工具层读数（重装后 `engineering_plan save`，probe 变更 `c32154b5…`，锁内 pid `424242`）：

```
Error: LOCK_BUSY: Change is locked by pid 424242 since 2026-01-01T00:00:00.000Z; that process is no longer running, so the lock is probably stale. Remove .lock only after confirming the holder is gone
```

说明码前缀由 Host 的 `codedError` 补上（`message` 本身不含 `LOCK_BUSY:` 时前置），界面 `errorDisplay` 因此能映射到中文句。probe 变更与其锁在读数后整目录删除，夹具仍为四个。
全套件 808 项

## 第 130 轮：运行记录存储的崩溃性质与状态文件一致

第 129 轮只验证了 `state.json`。运行记录（`runs/`、`dispatches/`、`git-observations/`）各自有一份锁与原子写，同样会在 `SIGKILL` 后留下陈锁与临时文件；一份卡住的验证运行会让该变更既不能派发也不能再验证。

### 改法：把两件重复的逻辑收到一处

第 129 轮把 `lockHolder`、`staleLockMessage`、`cleanTemporaries` 写在 `src/core.js` 内部。三个 store 各自又有一份 `atomic()` 和 `locked()`，于是同一套判断会出现四份实现——正是第 116 轮在 Git 准入上刚消除过的问题。

现在三个函数落在 [src/lock-retry.js](src/lock-retry.js)（已有 `isLockContention`/`lockFileState` 的位置），`src/core.js` 与三个 store 都从它导入：

- `lockHolder(file)`：读 `{ pid, createdAt }`，用 `process.kill(pid, 0)` 得到 `alive`（`EPERM` 视为存活，未知为 `null`）。
- `staleLockMessage(subject, holder)`：`holder` 为 `null` 时给「锁文件不可读，检查后再删」，存活为 `true` 时写「该进程仍在运行」，未知时写「无法检查」，只有 `false` 才说「大概已陈旧」。
- `cleanTemporaries(directory, ttlMs)`：只删 `*.tmp`、普通文件、`mtime` 超过 10 分钟者。

三个 store 的 `atomic()` 在写临时文件前调用 `cleanTemporaries(path.dirname(file))`；`LOCK_BUSY` 改为 `staleLockMessage(<store 名>, await lockHolder(lock))`。

### 测试

`tests/run-store-crash.test.js` 3 项：用「已退出的真实 pid」造锁后 `reserve` 报 `LOCK_BUSY`，消息点名 pid、说明存活判断、措辞不含自动删除，且拒绝之后锁仍在；`cleanTemporaries` 只删超龄的 `*.tmp`，保留阈值内的（可能是并发写手的活文件）与无关文件，并断言 `dispatch-store.js` 仍在写前清理；`staleLockMessage` 在 `holder` 为 null/未知/存活三种情况下分别给出不误导的措辞。

踩坑：`VerificationRunStore` 的目录是 `<change>/runs`（不是 `verifications`），`DispatchRunStore` 是 `<change>/dispatches`；放错目录时锁形同不存在，测试会「通过」但什么也没验到——这正是第一次运行 `Missing expected rejection` 的原因。

### 门禁

第 130 轮开始前为 808 项，本轮增至 811 项。`node --test tests/*.test.js`：810 pass / 0 fail / 1 可选 Chromium skip；`npm run check` → `syntax ok: 22 files` + `locale keys ok`。

全套件 811 项

## 第 131 轮：`SIGKILL` 打断运行记录写入

第 130 轮给了运行记录 store 与 `state.json` 相同的锁诊断和临时文件清理，但没有真的在写运行记录时杀进程。一条撕裂的运行记录比一条缺失的记录更坏：之后每次派发与验证都要读它，`list` 会把整个变更报成损坏。

### 测试

`tests/run-record-crash.test.js`：父进程先 `reserve` 一条验证运行并推进到 `running`，子进程在同一记录上循环 `update`（`stdout` 1500 字符），在 140/200/260ms 处 `SIGKILL`。每次之后：

- 若 store 被残留锁占住，必须报 `LOCK_BUSY` 且**能说明持有者**（`pid`，或空锁时的最后修改时间），随后由测试扮演人工删除锁；
- `list` 只返回一条记录，`state` 仍在合法集合内，`revision` 不回退，`runId`/`taskId`/`planVersion`/`command`/`hostInstanceId`/`ownerSessionId`/`createdAt` 全部还在；
- 目录里每个 `.json` 仍以 `{` 开头（撕裂写入会是半截文本）。

### 三个真实缺陷，都是测试先红

1. **空锁说不出任何信息**。被杀写手可能在 `open()` 之后、写入 `{pid,createdAt}` 之前死掉，留下一个 0 字节锁。第 130 轮的实现对此返回「锁文件不可读」，操作者无法判断该不该删。现在 `lockHolder` 在文件存在但解析失败时返回 `{ pid: null, createdAt: <mtime ISO>, alive: null, unreadable: true }`，消息变成「the lock file names no holder (last modified …)」——仍然不自动删除，但至少给出时间点。
2. **子进程 `close` 监听器挂得太晚**。`child.kill()` 之后才 `child.on('close', …)`：如果子进程在 kill 之前就已退出，`close` 只触发一次，晚注册的监听器永远等不到，测试整个挂住（本轮第一次运行 120 秒无输出）。改为在 `spawn` 之后立即建 promise；`tests/crash.test.js` 有同样写法，一并修掉。
3. **`update` 的 PATCH 是白名单**。第一版子进程传 `note`，被 `INVALID_INPUT: Unexpected fields` 拒绝；改成 `state` 又撞 `Invalid run state`（运行记录的合法状态里没有 `verifying`，那是任务状态）。最后改为只写 `stdout`，与第 104 轮的结论一致：`VerificationRunStore.update` 只接受扁平字段。

### 门禁

第 131 轮开始前为 811 项，本轮增至 812 项。`node --test tests/*.test.js`：811 pass / 0 fail / 1 可选 Chromium skip；`npm run check` → `syntax ok: 22 files` + `locale keys ok`。

全套件 812 项

## 第 132 轮：派发记录同样经得起打断，以及一条不稳定的断言

第 131 轮把注入加到了验证记录。派发记录有自己的一份 `atomic()`/`locked()`，而撕裂的派发记录会被之后的派发、验证与交付判定读到，所以这条性质要在这一侧单独证明，不能靠「共用 helper」推断。

### 新增

`tests/dispatch-record-crash.test.js`：`reserve` 一条派发运行（含 `taskSnapshot` 与 sha256）→ `starting`（带 `jobId`）→ `running`，子进程循环 `update` 写 `result.text`（1500 字符），在 150/210ms 处 `SIGKILL`。每次之后：

- 被残留锁占住时报 `LOCK_BUSY`，消息含 `pid` 或「names no holder」；测试扮演人工删锁；
- `list` 只返回一条记录，`state` 合法、`revision` 不回退，`taskId`/`requestId`/`taskSnapshotHash` 都在（`requestId` 丢失会让重放变成第二次派发）；
- 目录内 `.json` 均为完整对象。

### 修掉一条会偶发失败的断言（`tests/crash.test.js`）

原断言写死总长度「prefix + 2000 = 2008」，而写手的轮次号会从个位涨到两位（`round-10-…` 为 2009）。这是**测试的**缺陷，不是产品的：断言应来自值本身。改为用 `^round-(\d+)-(x+)$` 解析后断言载荷恰为 2000 字符。连跑三次稳定通过。

### 门禁

第 132 轮开始前为 812 项，本轮增至 813 项。`node --test tests/*.test.js`：812 pass / 0 fail / 1 可选 Chromium skip；`npm run check` → `syntax ok: 22 files` + `locale keys ok`。

全套件 813 项

## 第 133 轮：观测记录的写入被打断

三个 store 里只剩 Git 观测没有注入。它没有 `update`，写入窗口是每个请求一次 `create`，但一条撕裂的观测会同时打断三件事：`list`、审批基线比较、范围审计。

`tests/observation-record-crash.test.js`：子进程循环 `create`（每次新 `requestId`、`limitations` 里 1200 字符），在 150/220ms 处 `SIGKILL`。每次之后：

- 被残留锁占住时报 `LOCK_BUSY`，消息含 `pid` 或「names no holder」，然后由测试删锁；
- 已写出的观测数只增不减，每条 `changeId` 正确、`requestId` 存在、`head` 仍是 40 字符、`limitations` 仍是数组、`id` 仍是 uuid；
- 一个 `requestId` 不产生两条观测（重放绑定未被撕裂）；
- 目录内 `.json` 均为完整对象。

至此四个写入面（`state.json`、`runs/`、`dispatches/`、`git-observations/`）都有了同样的注入证据，而不是「共用 helper 所以应该没问题」。

### 门禁

第 133 轮开始前为 813 项，本轮增至 814 项。`node --test tests/*.test.js`：813 pass / 0 fail / 1 可选 Chromium skip；`npm run check` → `syntax ok: 22 files` + `locale keys ok`。

全套件 814 项

## 第 134 轮：文档数字的第二个面，以及两个「时间当事实」的测试

### 只比总数会漏掉通过数

`check-doc-counts.mjs` 以前只比对三处套件总数。第 127 轮交付状态头部的「N 项（P pass / S skip）」中 pass 独自漂到 778 时，是人工发现的；这一轮 README 又出现同类问题：总数 814 对，括号里写着「681 通过」。

新增 `readmeTally()` 解析 README 的「N 项（P 通过、S 项…跳过）」，并加三条校验：`P + S === N`、`N === 实测总数`、`P === 实测通过数`。`runSuiteCounts()` 同时返回 TAP 的 `# pass`/`# skipped`。门禁当场报出：

```text
doc-count: README.md tally 681 pass + 1 skip != 814 total
doc-count: README.md tally says 681 pass, actual is 813
```

（第二条的 812/813 波动来自下面那个不稳定测试，见下文。）

### 两个把「时间」当事实的测试

全量套件出现过 3 次里 2 次失败，单跑崩溃套件却 5/5 通过——并行负载下才暴露：

1. `tests/crash.test.js` 断言被杀写手留下的锁「必须点名 pid」。而 `open(lock, 'wx')` 与写入 holder 之间有一个窗口，进程恰好死在那里就留下**零字节锁**。这不是产品缺陷，是断言比现实强：`lockHolder()` 早已把这种锁报成 `{ pid: null, unreadable: true }`，消息是「names no holder (last modified …)」。测试改为：有内容才要求 pid 与存活判断，空锁只要求消息说明「没有持有者」。
2. `tests/observation-record-crash.test.js` 在固定 150/220ms 后 `SIGKILL`。全量并行时子进程还没启动完就已被杀，于是「被杀的写手必须写过东西」失败。改为**先等到磁盘上的观测数超过快照**，再按 0/40ms 抖动后杀——判据从墙钟换成事实。注意第二轮不能沿用「文件存在」：第一轮已经留下文件，必须比数量。

### 证据

- 连续 4 次 `node --test tests/*.test.js` 全绿（此前 3 次里 2 次红）。
- 门禁：`doc counts ok: 815 tests, round 134`；`npm run check` → `syntax ok: 22 files` + `locale keys ok`。

全套件 815 项

## 第 138 轮：正向闭环首次跑通（人工批准 → 派发 → 验证 → 证据 → 完成）

第 137 轮完成的状态与运行记录（夹具 `9dd058d6-8a19-4c3c-b8bc-11a1d7dc6a4c`）：

- 用户本人批准：`approvals[0] = { planVersion: 1, actor: { kind: "user", id: "session-d428891f-…" }, sourceRevision: 2, approvalRevision: 3, codeBaseline: null }`，`recordedAt 2026-11-20T09:45:05.104Z`。
- 派发 `ep2-dispatch-20261120-01`：runId `42a53888-3a81-4691-b159-17f9ee0408d7`、childId `08472fc1-3907-4550-9c6b-950fd9d5ac8c`、jobId `bash-e5a53705277f4f58`、state `returned`；子 Agent 报告 `@local/dsh-engineering-planner` `0.3.0` 与读取路径。同 requestId 重放返回同一 runId/childId。
- 验证 `ep2-verify-20261120-01`：runId `5f4858d2-37b5-4e3a-81cd-3d277acf5914`、jobId `bash-08792ca6d8544a95`、state `succeeded`、`exitCode 0`、`stdout "ep-positive-smoke\r\n"`、`stderr ""`、`timedOut/aborted false`、`sandbox {mode:"danger-full-access",denied:false,runnerFailed:false}`、`execution.resolved {workdir:"J:\\Code\\Engineering Planner",timeoutMs:120000,onExpiry:"kill",stdoutMaxBytes:64000}`。重放同 runId，未重跑。
- 四条验收标准各一条 `passed` 证据（`d5c41669…`、`65176db7…`、`7446a116…`、`868e5f78…`），change revision 6 → 9。
- `transition READONLY-SMOKE → completed`：revision 10，change `status: completed`，`deliveryAcceptance` 仍为 `null`。
- `gateStatus`（revision 10）：`ready: true`、`blockers: []`、`tasks.completed 1`、`commands { total 1, succeeded 1, failed 0, unrun 0 }`、`warnings: []`、`scope.state "no_observation"`（该工作区未采集 Git 观测，不是阻塞）。

因此「批准 → 派发 → 验证 → 证据 → 任务完成 → 门禁就绪」这一段第一次由真实工具调用串通，执行者仍是宿主自己的命令与子 Agent，不是桩。**交付确认尚未发生**：`acceptDelivery` 只对人类通道开放，必须由用户在工作台点击。

浏览器一侧的复现路径与限制：插件重装会 dispose 页面内那半边桥，`browser_eval` 从此报 `bridge is unloaded`；`location.reload()` 后重新点「工程研发」即可恢复（本轮实测如此）。`browser_history` 在主窗口模式下不支持，只能走 `location.reload()`。

第 138 轮结束时的全套件 820 项（819 通过、1 项跳过）。

## 第 139 轮：客户端视图停用（界面异常）的定位

**现象**：用户切换到「质量门禁」页签时界面异常。当时页面停在会话列表壳层，`browser_eval` 只能读到侧栏文本，点击会话行不触发导航。

**定位手段**：`cordis_inspect_query(client, Slots, listSubTree, {root:'conversation.view'})` 读实时插槽占用。

- 重载前：`{registrant:'WC', id:'engineering-planner', order:40, active:false}`
- 重载后：同一条记录 `active:true`

宿主侧同一时刻 `plugin_manager list_plugins` 显示 `include:engineering-planner` `enabled:true` / `fiberPhase:active`——插件本身在运行，缺的是**页面里那份客户端注册**。

**成因**：第 138 轮为让新建的 DAG 测试与导出改动生效，对 bundle 做了 `set_bundle false → true`。客户端半边在禁用时被销毁，重新启用只更新宿主与资源，页内已加载的注册不会自己复活，于是一个 `active:false` 的占位符留在插槽里：页签可见、内容空白。

**结论**：不是渲染代码抛错（`window.__epErr` 全程为空），而是「插件热启停后客户端注册失效」。修复方式是页面重新加载一次，不需要改动源码。

**仍未取得**：重载后我无法用合成事件驱动会话行导航（`pointerdown`/`pointerup`/`click` 均不触发壳层路由），因此「质量门禁」页签在重载后的实际渲染仍需要用户本人点一次确认。这条限制已写入 `docs/UI-ACCEPTANCE.md`。

本轮开始前套件为 820 项，本轮增至 821 项（新增 `tests/core.test.js` 的 DAG 状态标签用例）。

全套件 821 项。

## 第 140 轮：「质量门禁」页签崩溃——渲染期 TDZ

**用户读到的原文**（浏览器控制台，2026-11-20）：

```text
ReferenceError: Cannot access 'selectedTask' before initialization
    at resourcesView (client.js:4037:1)
    at Panel (client.js:4665:1)
client.js:22 slot entry crashed in 'conversation.view': ReferenceError: Cannot access 'selectedTask' before initialization
```

**成因**：第 106 轮给证据表单加「失败/阻塞后补记复盘证据」时，把 `const postMortem = !!selectedTask && ...` 插在 `const selectedTask = change.tasks.find(...)` 之上。两条是同一块内的兄弟声明，前者初始化时读取后者 → 暂时性死区（TDZ）。`node --check` 看不出（语法合法），单元测试也看不出（视图函数从未在 Node 里执行），只有切到该页签、React 真正调用 `resourcesView()` 时抛错，错误被插槽边界接住，于是整个 `conversation.view` 变成空白。

**修复**：把 `const selectedTask = ...` 提到 `const postMortem = ...` 之前（`client.js:4036-4038`）。

**防回归**：新增 `scripts/check-declaration-order.mjs`，扫描每个函数的**组件级兄弟声明**：若某条 `const/let` 的初始化式读取了同块内更晚声明的名字，即报错并退出 1。已排除三类合法情形——回调体内的读取（`() => f(x)`）、嵌套函数的同名参数、对象字面量的属性键。

- `npm run check` 现在串联三步：`check-syntax`（23 个文件）→ `check-locale-keys` → `check-declaration-order`。
- `tests/declaration-order.test.js` 5 项：真实 `client.js` 无该类缺陷；构造本轮这条缺陷必须被报出（`resourcesView` / `selectedTask` / 行号 2→3）；顺序正确不报；回调体内读取不报；对象字面量属性键不算读取。

**判据边界**：该检查只覆盖「同一函数体内、同缩进的兄弟声明」，不覆盖跨块、类字段、参数默认值里的 TDZ。本轮这条缺陷属于覆盖范围，故能拦住。

本轮开始前套件为 821 项，本轮增至 826 项（新增 `tests/declaration-order.test.js` 5 项）。

全套件 826 项。

## 第 142 轮：正向闭环收尾——用户已确认交付

**界面读数**（`dsh-app://app/` → 工程研发 → 质量门禁，选中 `9dd058d6-8a19-4c3c-b8bc-11a1d7dc6a4c`）：

```text
技术任务已收尾
当前版本已确认交付
当前版本已确认交付，任务状态已冻结；如需继续调整，请先人工重新规划。
方案版本 1
交付确认人 user: session-d428891f-d9a2-4d51-bc7d-7d4c81be76f9
交付确认时间 2026-11-20T10:27:49.649Z
备注 确认
```

**磁盘核对**（`state.json`）：`revision 11`、`status "completed"`、`deliveryAcceptance = { planVersion: 1, actor: { kind: "user", id: "session-d428891f-…" }, acceptedAt: "2026-11-20T10:27:49.649Z", note: "确认" }`、任务 `READONLY-SMOKE` 为 `completed` 且带 4 条证据。

**这意味着整条链第一次由用户本人走完**：人工批准（10:45:05Z 之前的批准，`approvalRevision 3`）→ 派发子 Agent（`42a53888`，`returned`）→ 状态流转 → 命令验证（`5f4858d2`，`exit 0`）→ 四条证据 → `gateStatus.ready true` → 用户点「确认当前版本交付」。代理全程没有调用 `acceptDelivery`（该动作不在模型工具枚举里）。

**同轮修复验证**：TDZ 修复后，工作台首次在真实页面正常挂载（`.ep-layout` 存在）、「质量门禁」页签渲染出上述内容且 `window.__epErr` 为空——第 139/140 两轮记录的两条成因（注册失效、渲染崩溃）都已消除。

本轮开始前套件为 826 项，本轮未新增用例（仅文档与读数）。

全套件 826 项。
