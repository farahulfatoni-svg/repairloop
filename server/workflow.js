// Workflow rules shared by the API's case and quotation endpoints.
export const REQUIRED_CHECKS = ['Power-on and charging', 'Core functionality', 'Final visual inspection'];
export const CLOSED_STATES = ['Ready for return', 'Closed - unrepairable', 'Repair unsuccessful'];
export function fail(message, status = 400) { throw Object.assign(new Error(message), { statusCode: status }); }
export function requireText(value, label, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} is required (up to ${max} characters).`);
  return value.trim();
}
export function latestQuote(repair) { return repair.quotations?.[repair.quotations.length - 1]; }
export function requireOpen(repair) {
  if (CLOSED_STATES.includes(repair.status)) fail('This case is already closed or ready for return. Its quotation cannot be changed.', 409);
}
export function quotationInput(body, now = Date.now()) {
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) fail('Add between 1 and 50 quotation items.');
  let cents = 0;
  const items = body.items.map(item => {
    if (!item || !['Part', 'Labour'].includes(item.type)) fail('Each quotation item must be a Part or Labour.');
    const quantity = item.quantity;
    const unitPrice = item.unitPrice;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) fail('Item quantities must be positive whole numbers.');
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000000 || Math.abs(unitPrice * 100 - Math.round(unitPrice * 100)) > 0.00001) fail('Prices must be non-negative amounts with at most two decimal places.');
    cents += Math.round(unitPrice * 100) * quantity;
    if (!Number.isSafeInteger(cents) || cents > 100000000000000) fail('Quotation total is too large.');
    return { description: requireText(item.description, 'Item description', 500), type: item.type, quantity, unitPrice };
  });
  const until = new Date(body.validUntil);
  if (!body.validUntil || !Number.isFinite(until.getTime()) || until.getTime() <= now) fail('Choose a quotation validity date in the future.');
  return { items, total: cents / 100, validUntil: until, warrantyTerms: requireText(body.warrantyTerms, 'Warranty terms'), scope: requireText(body.scope, 'Repair scope') };
}
export function requireAssessment(repair) {
  if (!repair.intake?.receivedAt) fail('Confirm physical receipt before issuing a quotation.');
  const received = new Date(repair.intake.receivedAt).getTime();
  if (!Number.isFinite(received) || received > Date.now()) fail('Physical receipt must be a valid date that is not in the future.');
  requireText(repair.intake.physicalCondition, 'Physical condition');
  requireText(repair.diagnosis?.findings, 'Diagnostic findings');
  if (repair.diagnosis?.unrepairable) fail('An unrepairable device must be closed with a reason, without a new quotation.', 409);
}
export function requireApproval(repair) {
  if (latestQuote(repair)?.status !== 'Accepted') fail('The latest quotation must be accepted before repair work can be saved.', 409);
}
export function requireQuality(execution) {
  const checks = execution?.checks;
  if (!Array.isArray(checks) || !checks.length || checks.some(check => check.result !== 'Pass') || REQUIRED_CHECKS.some(name => !checks.some(check => check.name === name && check.result === 'Pass'))) {
    fail('Every required quality check must pass before the device is ready for return.', 409);
  }
  requireText(execution.technician, 'Assigned technician', 200);
}

// Apply execution changes without trusting client-supplied history or outcome status.
export function updateExecution(repair, input, requestedStatus, makeId = () => globalThis.crypto.randomUUID()) {
  requireOpen(repair);
  requireApproval(repair);
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Execution must be an object.');
  const editable = ['technician', 'tasks', 'progress', 'workNotes', 'delayReason', 'stage', 'checks', 'outcome', 'outcomeReason'];
  const readOnly = ['partsUsed', 'checkHistory', 'workLog'];
  if (Object.keys(input).some(key => !editable.includes(key) && !readOnly.includes(key))) fail('Unsupported execution field.');
  const previous = JSON.parse(JSON.stringify(repair.execution || {}));
  if (input.partsUsed && JSON.stringify(input.partsUsed) !== JSON.stringify(previous.partsUsed || [])) fail('Parts consumption requires the inventory integration.', 409);
  const next = { ...previous };
  for (const field of editable) if (Object.hasOwn(input, field)) next[field] = input[field];
  next.technician = requireText(next.technician, 'Assigned technician', 200);
  for (const [key, label, max] of [['workNotes', 'Work notes', 8000], ['delayReason', 'Delay reason', 4000], ['outcomeReason', 'Outcome reason', 4000]]) {
    if (next[key] !== undefined && (typeof next[key] !== 'string' || next[key].length > max)) fail(`${label} must be text of at most ${max} characters.`);
    next[key] = (next[key] || '').trim();
  }
  if (typeof next.progress !== 'number' || !Number.isFinite(next.progress) || next.progress < 0 || next.progress > 100) fail('Progress must be between 0 and 100.');
  const tasks = next.tasks || [];
  const oldTasks = previous.tasks || [];
  if (!Array.isArray(tasks) || tasks.length > 100 || tasks.length < oldTasks.length) fail('Keep recorded tasks and use at most 100 tasks.');
  if (oldTasks.some((old, index) => old.id ? !tasks.some(task => task.id === old.id) : !tasks[index])) fail('Recorded tasks cannot be removed.');
  const seenIds = new Set();
  next.tasks = tasks.map((task, index) => {
    if (!task || typeof task !== 'object') fail('Each task must have a title and status.');
    const old = task.id ? oldTasks.find(item => item.id === task.id) : oldTasks[index]?.id ? null : oldTasks[index];
    if (task.id && !old) fail('Unknown task identifier. Reopen the case and try again.', 409);
    const id = old?.id || makeId();
    if (seenIds.has(id)) fail('Duplicate task identifier.');
    seenIds.add(id);
    if (!['Pending', 'In progress', 'Done', 'Blocked'].includes(task.status)) fail('Choose a valid task status.');
    const title = requireText(task.title, 'Task title', 300);
    for (const key of ['notes', 'blockedReason']) if (task[key] !== undefined && (typeof task[key] !== 'string' || task[key].length > 4000)) fail('Task notes and blocking reasons must be text of at most 4000 characters.');
    const notes = (task.notes || '').trim();
    const blockedReason = (task.blockedReason || '').trim();
    if (task.status === 'Blocked' && !blockedReason) fail('Give a blocking reason for every blocked task.');
    const changed = !old || ['title', 'status', 'notes', 'blockedReason'].some(key => (old[key] || '') !== ({ title, status: task.status, notes, blockedReason }[key] || ''));
    return { id, title, status: task.status, notes, blockedReason, updatedAt: changed ? new Date() : old.updatedAt || new Date() };
  });
  const stage = next.stage || (requestedStatus === 'Quality check' ? 'Quality check' : 'In repair');
  if (!['In repair', 'Quality check'].includes(stage)) fail('Choose In repair or Quality check as the work stage.');
  next.stage = stage;
  if (!Array.isArray(next.checks) || next.checks.length > 50) fail('Use a valid quality checklist (up to 50 checks).');
  const names = new Set();
  next.checks = next.checks.map(check => {
    const name = requireText(check?.name, 'Quality check name', 200);
    if (names.has(name)) fail('Quality check names must be unique.');
    names.add(name);
    if (!['Pending', 'Pass', 'Fail'].includes(check.result)) fail('Choose a valid quality-check result.');
    if (check.notes !== undefined && (typeof check.notes !== 'string' || check.notes.length > 4000)) fail('Quality notes must be text of at most 4000 characters.');
    return { name, result: check.result, notes: check.notes || '' };
  });
  const outcome = next.outcome || 'Pending';
  let status;
  if (outcome === 'Repaired') {
    requireQuality(next);
    if (next.tasks.some(task => task.status !== 'Done')) fail('Complete every recorded repair task before marking the device ready for return.', 409);
    next.progress = 100; next.stage = 'Quality check'; next.outcomeReason = '';
    status = 'Ready for return';
  } else if (outcome === 'Unsuccessful' || outcome === 'Unrepairable') {
    requireText(next.outcomeReason, 'Reason for closing the repair');
    status = outcome === 'Unsuccessful' ? 'Repair unsuccessful' : 'Closed - unrepairable';
    // Keep actual progress and pass/fail/pending results; closure never fabricates passes.
  } else if (outcome === 'Pending') {
    if (['Ready for return', 'Repair unsuccessful', 'Closed - unrepairable'].includes(requestedStatus)) fail('Choose and record the matching repair outcome before closing.', 409);
    next.outcomeReason = '';
    status = next.stage;
  } else fail('Choose a valid repair outcome.');
  next.outcome = outcome;
  const checksOnly = checks => (checks || []).map(({ name, result, notes }) => ({ name, result, notes: notes || '' }));
  const oldChecks = checksOnly(previous.checks);
  if (JSON.stringify(oldChecks) !== JSON.stringify(checksOnly(next.checks)) && oldChecks.some(check => check.result !== 'Pending')) {
    repair.execution.checkHistory.push({ checks: oldChecks, recordedAt: new Date() });
  }
  const summary = value => JSON.stringify({ technician: value.technician || '', tasks: value.tasks || [], progress: value.progress || 0, stage: value.stage || '', workNotes: value.workNotes || '', delayReason: value.delayReason || '', checks: checksOnly(value.checks), outcome: value.outcome || 'Pending', outcomeReason: value.outcomeReason || '' });
  const changed = summary(previous) !== summary(next) || status !== repair.status;
  for (const field of editable) repair.execution[field] = next[field];
  if (changed) repair.execution.workLog.push({
    recordedAt: new Date(), technician: next.technician, progress: next.progress,
    stage: next.stage, workNotes: next.workNotes, delayReason: next.delayReason,
    outcome: next.outcome, outcomeReason: next.outcomeReason, tasks: next.tasks, checks: next.checks
  });
  return status;
}
