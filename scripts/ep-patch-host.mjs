import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../index.js", import.meta.url);
let source = readFileSync(file, "utf8");

const anchor = "export function codedError(error) {";
if (!source.includes("export async function terminateRun(")) {
  const block = [
    "// 人工释放「已启动但句柄不在本进程」的运行：先向 jobs 注册表确认不可达，再由用户提供终止声明，",
    "// 最后由 core 记入历史并结算为 cancelled。插件不假装自己观察到进程已停——只记录人工核查。",
    "export async function terminateRun(ctx, agent, signal, input, hostInstanceId) {",
    "  const allowed = ['action', 'changeId', 'kind', 'runId', 'expectedRevision', 'expectedRunRevision', 'reason', 'terminationEvidence'];",
    "  if (Object.keys(input).some(key => !allowed.includes(key))) fail('ENGINEERING_INVALID_INPUT');",
    "  if (!input.changeId || typeof input.changeId !== 'string' || !input.runId || typeof input.runId !== 'string') fail('ENGINEERING_INVALID_INPUT');",
    "  if (!['verification', 'dispatch'].includes(input.kind)) fail('ENGINEERING_INVALID_INPUT');",
    "  const admitted = await admittedWorkspace(ctx, agent, signal);",
    "  const runs = input.kind === 'dispatch' ? new DispatchRunStore(admitted) : new VerificationRunStore(admitted);",
    "  const record = await runs.get(input.changeId, input.runId);",
    "  if (!['starting', 'running'].includes(record.state)) fail('ENGINEERING_RUN_NOT_RUNNING');",
    "  if (!record.jobId) fail('ENGINEERING_RUN_WITHOUT_JOB');",
    "  // 关键判据：句柄若仍在本进程注册表里，就不该走「无法触达」这条路，应当用 cancelRun 正常终止。",
    "  // 注册表是进程级的，因此这里只能证伪「本进程可触达」，不能证明别的宿主进程已死——后者靠人工声明。",
    "  const caller = typeof record.ownerSessionId === 'string' && record.ownerSessionId ? record.ownerSessionId : agent.id;",
    "  let kill;",
    "  try {",
    "    kill = ctx.jobs.kill(record.jobId, caller, input.reason);",
    "  } catch (error) {",
    "    if (error?.code === 'JOB_NOT_FOUND') kill = 'missing';",
    "    else throw error;",
    "  }",
    "  if (kill === 'requested') fail('ENGINEERING_RUN_STILL_ATTACHED');",
    "  const operations = createOperations(ctx, (a, s) => admittedWorkspace(ctx, a, s));",
    "  const result = await operations.execute(input, { kind: 'user', id: agent.id });",
    "  return { ...result, kill, sameHost: record.hostInstanceId === hostInstanceId };",
    "}",
    "",
  ].join("\n");
  source = source.replace(anchor, block + anchor);
}

const humanGate = "input.action === 'cancelRun'";
if (!source.includes("input.action === 'terminateRun'")) {
  const marker = "      if (input.action === 'cancelRun') return cancelRun(ctx, invocation.agent, invocation.signal, input, hostInstanceId);";
  if (!source.includes(marker)) throw new Error("cancelRun dispatch marker not found");
  source = source.replace(
    marker,
    marker + "\n      if (input.action === 'terminateRun') return terminateRun(ctx, invocation.agent, invocation.signal, input, hostInstanceId);",
  );
}

writeFileSync(file, source);
console.log("index.js updated");
