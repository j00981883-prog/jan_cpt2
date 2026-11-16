const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../risk-register-core.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'JAN_CPT.html'), 'utf8');

function excerpt(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'Expected integration source markers: ' + start);
  return html.slice(from, to);
}
const plain = value => JSON.parse(JSON.stringify(value));
const newRegister = () => ({ version: 1, updatedAt: '2026-11-16T12:00:00Z', items: [{ id: 'risk-1', title: 'Utility conflict', likelihood: 4, impact: 5, status: 'open', owner: 'Project manager', mitigation: 'Verify utilities', reviewDate: '2026-12-01' }] });
const snapshot = () => ({
  meta: { title: 'Runway project', totalBudget: 500, primeBudget: 450, engineeringBudget: 50, funding: [{ source: 'FAA', amount: 450 }], custom: { preserve: true }, riskRegister: { version: 1, items: [] } },
  sched: { startISO: '2026-10-01', days: 60 },
  grant: { docs: { agreement: { url: 'https://example.org/grant' } }, changeOrders: [{ number: 1, cost: -25 }] },
  payApps: [{ id: 'pay-1', number: 1, workCompleted: 100, retainagePct: 0.05, paid: '2026-11-01' }],
  actuals: { 1: { spend: 100, daysLost: 0 } }
});

function trackerEnv(options = {}) {
  const original = snapshot(), scheduled = [], local = [], writes = [], statuses = [];
  let flushes = 0;
  const c = {
    isEditor: options.isEditor ?? true,
    projectId: 'project-1',
    riskSavePending: { current: false },
    confirmedRiskSnapshot: { current: null },
    latestProjectSnapshot: { current: original },
    setMeta: value => local.push(value),
    setSaveState: value => statuses.push(value),
    async persistProjectRiskRegister(id, register, expected) {
      writes.push({ id, register, expected, flushes });
      return options.persist ? options.persist(id, register, expected) : { ...original.meta, riskRegister: register };
    },
    saveQueue: { current: {
      schedule: value => scheduled.push(value),
      async flush() { flushes++; if (options.flush) return options.flush(); }
    } }
  };
  vm.createContext(c);
  vm.runInContext(excerpt('  async function saveRiskRegister(', '  useEffect('), c);
  return { c, original, scheduled, local, writes, statuses, get flushes() { return flushes; } };
}

test('Tracker flushes existing edits, writes risks narrowly, and preserves the complete local financial snapshot', async () => {
  const env = trackerEnv();
  const before = plain(env.original), riskRegister = newRegister();
  // A newer financial edit must win over the snapshot at initial render.
  const latest = { ...env.original, payApps: [...env.original.payApps, { id: 'pay-2', number: 2, workCompleted: 25 }] };
  env.c.latestProjectSnapshot.current = latest;
  await env.c.saveRiskRegister(riskRegister);
  assert.equal(env.scheduled.length, 0, 'A risk-only write must not schedule financial table writes');
  assert.equal(env.flushes, 1);
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].flushes, 1, 'Existing edits are flushed before writing the risk');
  assert.equal(env.writes[0].expected, latest.meta.riskRegister);
  assert.equal(env.writes[0].id, 'project-1');
  const saved = env.c.latestProjectSnapshot.current;
  for (const field of ['actuals', 'sched', 'grant', 'payApps']) assert.equal(saved[field], latest[field], field + ' must be preserved');
  assert.deepEqual(plain(saved.meta), { ...before.meta, riskRegister });
  assert.equal(env.local[0], saved.meta);
  assert.equal(env.c.latestProjectSnapshot.current.meta, saved.meta);
  assert.equal(env.c.confirmedRiskSnapshot.current, saved);
  assert.deepEqual(env.original, before, 'The original project snapshot is not mutated');
  assert.equal(env.c.riskSavePending.current, false);
});

test('Tracker risk writes reject viewers before touching state or the save queue', async () => {
  const env = trackerEnv({ isEditor: false });
  await assert.rejects(env.c.saveRiskRegister(newRegister()), /Editor access/);
  assert.equal(env.scheduled.length, 0);
  assert.equal(env.local.length, 0);
  assert.equal(env.flushes, 0);
  assert.equal(env.writes.length, 0);
});

test('Tracker failed flushes and failed risk writes never publish or queue an unsaved register', async () => {
  for (const options of [{ flush: () => { throw new Error('Offline'); } }, { persist: () => { throw new Error('Offline'); } }]) {
    const env = trackerEnv(options);
    await assert.rejects(env.c.saveRiskRegister(newRegister()), /Offline/);
    assert.equal(env.c.riskSavePending.current, false);
    assert.equal(env.c.latestProjectSnapshot.current, env.original);
    assert.equal(env.c.confirmedRiskSnapshot.current, null);
    assert.equal(env.scheduled.length, 0);
    assert.equal(env.local.length, 0);
    assert.equal(env.statuses.length, 0);
    if (options.flush) assert.equal(env.writes.length, 0);
  }
});

test('Tracker blocks overlapping risk saves until the pending flush finishes', async () => {
  let release;
  const env = trackerEnv({ flush: () => new Promise(resolve => { release = resolve; }) });
  const first = env.c.saveRiskRegister(newRegister());
  assert.equal(env.c.riskSavePending.current, true);
  await assert.rejects(env.c.saveRiskRegister(newRegister()), /already in progress/);
  assert.equal(env.scheduled.length, 0);
  assert.equal(env.writes.length, 0);
  release();
  await first;
  assert.equal(env.c.riskSavePending.current, false);
  assert.equal(env.writes.length, 1);
});

test('a confirmed risk-only render skips financial autosave while a later financial edit still saves', async () => {
  const env = trackerEnv();
  await env.c.saveRiskRegister(newRegister());
  Object.assign(env.c, env.c.latestProjectSnapshot.current, { loaded: true, firstSave: { current: false }, useEffect: fn => fn() });
  const source = excerpt('    if (!loaded) return;', '  }, [actuals, grant, payApps, sched, meta, loaded, isEditor, projectId]);');
  vm.runInContext('function autosaveEffect(){' + source + '}', env.c);
  env.c.autosaveEffect();
  assert.equal(env.scheduled.length, 0);
  assert.equal(env.c.confirmedRiskSnapshot.current, null);
  env.c.actuals = { ...env.c.actuals, 2: { spend: 25, daysLost: 1 } };
  env.c.autosaveEffect();
  assert.equal(env.scheduled.length, 1);
  assert.equal(env.scheduled[0].actuals[2].spend, 25);
  assert.equal(env.scheduled[0].payApps, env.original.payApps);
});

function internalEnv(options = {}) {
  const calls = [], timers = new Map(), original = snapshot().meta;
  let nextTimer = 1;
  const c = {
    window: { JANRiskRegister: model },
    projectId: 'project-1', meta: original, isEditor: options.isEditor ?? true,
    busy: options.busy ?? false, editing: options.editing ?? false, internalWrite: { current: false },
    AbortController,
    setBusy(value) { c.busy = value; },
    setMeta(value) { c.meta = value; calls.push(['setMeta', value]); },
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    sb: { from(table) {
      calls.push(['from', table]);
      let operation = 'read';
      const query = {
        update(value) { operation = 'update'; calls.push(['update', value]); return query; },
        eq(key, value) { calls.push(['eq', key, value]); return query; },
        is(key, value) { calls.push(['is', key, value]); return query; },
        select(value) { calls.push(['select', value]); return query; },
        single() { calls.push(['single']); return query; },
        abortSignal(signal) {
          calls.push(['signal', signal]);
          if (operation === 'read') return options.readResponse ? options.readResponse(signal) : Promise.resolve({ data: { id: 'project-1', updated_at: '2026-11-16T14:22:23.123456+00:00', meta: Object.prototype.hasOwnProperty.call(options, 'serverMeta') ? options.serverMeta : original }, error: null });
          return options.response ? options.response(signal) : Promise.resolve({ data: { id: 'project-1' }, error: null });
        }
      };
      return query;
    } }
  };
  vm.createContext(c);
  vm.runInContext(excerpt('function riskRegistersMatch(', '// PROJECT_RISK_PERSISTENCE_END') + '\n' + excerpt('  async function saveInternalRisks(', '  useEffect('), c);
  return { c, calls, timers, original };
}

test('internal risk save only updates project metadata and verifies an affected project row', async () => {
  const env = internalEnv(), register = newRegister(), before = plain(env.original);
  await env.c.saveInternalRisks(register);
  assert.deepEqual(env.calls.filter(call => call[0] === 'from'), [['from', 'projects'], ['from', 'projects']]);
  const payload = env.calls.find(call => call[0] === 'update')[1];
  assert.deepEqual(Object.keys(payload), ['meta']);
  assert.deepEqual(plain(payload.meta), { ...before, riskRegister: register });
  assert.deepEqual(env.calls.find(call => call[0] === 'eq'), ['eq', 'id', 'project-1']);
  assert.deepEqual(env.calls.filter(call => call[0] === 'select'), [['select', 'id,meta,updated_at'], ['select', 'id']]);
  assert.equal(env.calls.filter(call => call[0] === 'single').length, 2);
  assert.deepEqual(env.calls.find(call => call[0] === 'eq' && call[1] === 'updated_at'), ['eq', 'updated_at', '2026-11-16T14:22:23.123456+00:00']);
  assert.equal(env.calls.some(call => call[0] === 'eq' && call[1] === 'meta'), false);
  assert.deepEqual(env.original, before);
  assert.equal(env.c.meta, payload.meta);
  assert.equal(env.c.busy, false);
  assert.equal(env.c.internalWrite.current, false);
  assert.equal(env.timers.size, 0);
});

test('internal risk save rejects viewer, busy, and unsaved overview edits before any write', async () => {
  for (const [options, message] of [[{ isEditor: false }, /Editor access/], [{ busy: true }, /current save/], [{ editing: true }, /Save project details/]]) {
    const env = internalEnv(options);
    await assert.rejects(env.c.saveInternalRisks(newRegister()), error => message.test(error.message));
    assert.equal(env.calls.length, 0);
    assert.equal(env.timers.size, 0);
  }
});

test('internal risk save rejects database errors and missing affected rows without reporting local success', async () => {
  for (const [response, message] of [
    [{ data: null, error: { message: 'Access denied' } }, /Access denied/],
    [{ data: null, error: { message: 'No rows', code: 'PGRST116' } }, /project changed while saving/],
    [{ data: null, error: null }, /save was not confirmed/],
    [{ data: {}, error: null }, /save was not confirmed/]
  ]) {
    const env = internalEnv({ response: async () => response });
    await assert.rejects(env.c.saveInternalRisks(newRegister()), error => message.test(error.message));
    assert.equal(env.c.meta, env.original);
    assert.equal(env.calls.some(call => call[0] === 'setMeta'), false);
    assert.equal(env.c.busy, false);
    assert.equal(env.c.internalWrite.current, false);
    assert.equal(env.timers.size, 0);
  }
});

test('internal risk save blocks overlapping writes and aborts timed-out requests', async () => {
  let signal;
  const env = internalEnv({ response: currentSignal => {
    signal = currentSignal;
    return new Promise((resolve, reject) => currentSignal.addEventListener('abort', () => reject(new Error('Request aborted'))));
  } });
  const first = env.c.saveInternalRisks(newRegister());
  await assert.rejects(env.c.saveInternalRisks(newRegister()), /current save/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.calls.filter(call => call[0] === 'update').length, 1);
  assert.equal(signal.aborted, false);
  const timer = [...env.timers.values()][0];
  assert.equal(timer.delay, 15000);
  timer.callback();
  await assert.rejects(first, /timed out.*draft is preserved/);
  assert.equal(signal.aborted, true);
  assert.equal(env.c.meta, env.original);
  assert.equal(env.c.busy, false);
  assert.equal(env.c.internalWrite.current, false);
  assert.equal(env.timers.size, 0);
});

test('risk persistence merges the latest server metadata and protects it with a compare-and-swap filter', async () => {
  const serverMeta = { ...snapshot().meta, title: 'Renamed by another editor', additionalField: { preserve: true }, totalBudget: 750 };
  const env = internalEnv({ serverMeta });
  await env.c.saveInternalRisks(newRegister());
  const saved = env.calls.find(call => call[0] === 'update')[1].meta;
  assert.equal(saved.title, serverMeta.title);
  assert.equal(saved.totalBudget, 750);
  assert.deepEqual(saved.additionalField, { preserve: true });
  assert.deepEqual(env.calls.find(call => call[0] === 'eq' && call[1] === 'updated_at'), ['eq', 'updated_at', '2026-11-16T14:22:23.123456+00:00']);
  assert.equal(env.calls.every(call => call[0] !== 'from' || call[1] === 'projects'), true);
});

test('a concurrently changed risk register is rejected without overwriting any project data', async () => {
  const otherRegister = newRegister();
  otherRegister.items[0].title = 'Different saved risk';
  const env = internalEnv({ serverMeta: { ...snapshot().meta, riskRegister: otherRegister } });
  await assert.rejects(env.c.saveInternalRisks(newRegister()), /Another person updated the risk register/);
  assert.equal(env.calls.some(call => call[0] === 'update'), false);
  assert.equal(env.c.meta, env.original);
  assert.equal(env.c.busy, false);
  assert.equal(env.c.internalWrite.current, false);
  assert.equal(env.timers.size, 0);
});

test('retry confirms an already saved risk without a duplicate write despite changed audit timestamps or object key order', async () => {
  const saved = newRegister(), retry = newRegister();
  saved.items[0] = { ...saved.items[0], createdAt: '2026-11-16T10:00:00Z', updatedAt: '2026-11-16T11:00:00Z' };
  retry.items[0] = Object.fromEntries(Object.entries({ ...retry.items[0], createdAt: '2026-11-16T12:00:00Z', updatedAt: '2026-11-16T12:01:00Z' }).reverse());
  retry.updatedAt = '2026-11-16T12:01:00Z';
  const serverMeta = { ...snapshot().meta, riskRegister: saved, serverOnly: true };
  const env = internalEnv({ serverMeta });
  await env.c.saveInternalRisks(retry);
  assert.equal(env.calls.some(call => call[0] === 'update'), false);
  assert.equal(env.c.meta, serverMeta);
  assert.equal(env.c.meta.serverOnly, true);
});

test('empty server metadata uses the same compact revision comparison before its first risk write', async () => {
  const env = internalEnv({ serverMeta: null });
  await env.c.saveInternalRisks(newRegister());
  assert.deepEqual(env.calls.find(call => call[0] === 'eq' && call[1] === 'updated_at'), ['eq', 'updated_at', '2026-11-16T14:22:23.123456+00:00']);
  assert.deepEqual(Object.keys(env.c.meta), ['riskRegister']);
});

test('missing revision fails closed before an update', async () => {
  const env = internalEnv({ readResponse: async () => ({ data: { id: 'project-1', meta: snapshot().meta }, error: null }) });
  await assert.rejects(env.c.saveInternalRisks(newRegister()), /revision could not be verified/);
  assert.equal(env.calls.some(call => call[0] === 'update'), false);
  assert.equal(env.c.meta, env.original);
});

test('large AI evidence is kept out of the conditional update URL', async () => {
  const serverMeta = { ...snapshot().meta, unrelatedText: 'x'.repeat(40000) };
  const env = internalEnv({ serverMeta });
  const register = newRegister();
  register.items[0].ai = { evidence: [{ detail: 'Evidence '.repeat(4000) }] };
  await env.c.saveInternalRisks(register);
  const filters = env.calls.filter(call => call[0] === 'eq' || call[0] === 'is');
  assert.ok(JSON.stringify(filters).length < 200);
  assert.equal(env.c.meta.unrelatedText.length, 40000);
  assert.equal(env.c.meta.riskRegister.items[0].ai.evidence[0].detail.length, 36000);
});

test('risk persistence read failures and missing projects stop before any update', async () => {
  for (const [response, message] of [
    [{ data: null, error: { message: 'Read unavailable' } }, /Read unavailable/],
    [{ data: null, error: null }, /project is unavailable/],
    [{ data: {}, error: null }, /project is unavailable/]
  ]) {
    const env = internalEnv({ readResponse: async () => response });
    await assert.rejects(env.c.saveInternalRisks(newRegister()), error => message.test(error.message));
    assert.equal(env.calls.some(call => call[0] === 'update'), false);
    assert.equal(env.c.meta, env.original);
    assert.equal(env.timers.size, 0);
  }
});

function dashboard(register, options = {}) {
  const c = {
    window: options.missingModel ? {} : { JANRiskRegister: model },
    meta: { budgetVarianceLimit: 0.05, timeVarianceLimitPerWeek: 1, riskRegister: register },
    current: { budgetBreach: false, cumVariance: 0, scheduleBreach: false, cumDaysLost: 0, daysPerWeek: 0, weeksComplete: 2, ...options.current },
    grant: { sections: [], safetyIncidents: 0 },
    pay: { submittedCount: 1, receivedCount: 1, pendingAmount: 0 },
    useMemo: fn => fn(), fmtPct: n => (n * 100).toFixed(1) + '%', fmtMoney: n => '$' + n.toFixed(2)
  };
  vm.createContext(c);
  vm.runInContext(excerpt('const GRANT_MILESTONES =', 'const TUTORIAL_STEPS =') + '\n' + excerpt('function buildProjectRiskExplanation(', '// PROJECT_RISK_DETAILS_END') + '\n' + excerpt('  const execSum = useMemo(', '  const hardStop =') + '\nglobalThis.summary=execSum;globalThis.explanation=buildProjectRiskExplanation({execSum,meta,current,grant,pay});', c);
  return { summary: c.summary, explanation: c.explanation };
}
const riskLevel = result => result.summary.rows.find(item => item[0] === 'Risk Level');

test('an active high project risk raises the executive rating and explanation routes to the risk register', () => {
  const result = dashboard(newRegister());
  assert.deepEqual(Array.from(riskLevel(result)), ['Risk Level', 'red', 'High']);
  assert.equal(result.explanation.kind, 'red');
  const projectRisk = result.explanation.attention.find(item => item.label === 'Project risks');
  assert.equal(projectRisk.tab, 'risks');
  assert.equal(projectRisk.actionLabel, 'Open risk register');
  assert.match(projectRisk.reason, /highest active rating/);
  assert.match(result.explanation.summary, /Project risks is red/);
});

test('closed high project risks do not raise executive risk or appear as active checks', () => {
  const register = newRegister();
  register.items[0].status = 'closed';
  register.items[0].resolution = 'Utility relocated';
  const result = dashboard(register);
  assert.deepEqual(Array.from(riskLevel(result)), ['Risk Level', 'green', 'Low']);
  assert.equal(result.summary.rows.some(item => item[0] === 'Project risks'), false);
  assert.equal([...result.explanation.attention, ...result.explanation.checks].some(item => item.label === 'Project risks'), false);
});

test('low project risks never lower an existing red budget indicator', () => {
  const register = newRegister();
  register.items[0].likelihood = 1;
  register.items[0].impact = 1;
  const result = dashboard(register, { current: { budgetBreach: true, cumVariance: 0.1 } });
  assert.deepEqual(Array.from(riskLevel(result)), ['Risk Level', 'red', 'High']);
  assert.equal(result.explanation.kind, 'red');
  assert.ok(result.explanation.attention.some(item => item.label === 'Budget'));
  assert.ok(result.explanation.checks.some(item => item.label === 'Project risks' && item.kind === 'green'));
});

test('unrated active risks remain neutral with explicit follow-up and missing model retains existing dashboard', () => {
  const register = newRegister();
  register.items[0].likelihood = '';
  register.items[0].reviewDate = '';
  const result = dashboard(register);
  const check = result.summary.rows.find(item => item[0] === 'Project risks');
  assert.equal(check[1], 'neutral');
  assert.match(check[2], /Not rated.*1 need follow-up/);
  assert.equal(result.explanation.checks.find(item => item.label === 'Project risks').tab, 'risks');
  const fallback = dashboard(register, { missingModel: true });
  assert.deepEqual(Array.from(riskLevel(fallback)), ['Risk Level', 'green', 'Low']);
  assert.equal(fallback.summary.rows.some(item => item[0] === 'Project risks'), false);
});
