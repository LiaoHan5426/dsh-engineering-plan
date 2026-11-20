const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// Used before admission and again immediately before launch. Does not grant tool permission.
export function resolveVerificationRequest(change, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('INVALID_INPUT', 'Verification request is required');
  const allowed = ['changeId', 'taskId', 'expectedRevision', 'planVersion', 'commandIndex', 'command', 'requestId'];
  if (Object.keys(request).some(key => !allowed.includes(key))) fail('INVALID_INPUT', 'Unexpected verification request field');
  if (!change || request.changeId !== change.id) fail('CHANGE_MISMATCH', 'Change does not match request');
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision !== change.revision) fail('REVISION_CONFLICT', 'Refresh the current change revision');
  if (!Number.isSafeInteger(request.planVersion) || request.planVersion !== change.planVersion) fail('PLAN_VERSION_CONFLICT', 'Plan version changed');
  if (!change.approvals?.some(approval => approval.planVersion === change.planVersion && approval.actor?.kind === 'user')) fail('APPROVAL_REQUIRED', 'Current plan must have human approval');
  const task = change.tasks?.find(item => item.id === request.taskId);
  if (!task) fail('TASK_NOT_FOUND', 'Verification task not found');
  if (task.status !== 'verifying') fail('INVALID_STATE', 'Task must be verifying before command execution');
  if (!Number.isSafeInteger(request.commandIndex) || request.commandIndex < 0 || request.commandIndex >= task.verificationCommands.length) fail('INVALID_COMMAND_INDEX', 'Invalid verification command index');
  const command = task.verificationCommands[request.commandIndex];
  if (typeof command !== 'string' || !command.trim() || command.includes('\0')) fail('INVALID_COMMAND', 'Approved verification command is empty or invalid');
  // The displayed tool input must match the exact stored command; no hidden command substitution.
  if (request.command !== command) fail('COMMAND_MISMATCH', 'Displayed command differs from the approved plan');
  if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(request.requestId)) fail('INVALID_REQUEST_ID', 'Stable request identifier is required');
  return { changeId: change.id, taskId: task.id, planVersion: change.planVersion, commandIndex: request.commandIndex, command, requestId: request.requestId };
}
