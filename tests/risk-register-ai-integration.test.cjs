const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'JAN_CPT.html'), 'utf8');
function excerpt(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'Expected integration source markers: ' + start);
  return html.slice(from, to);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function review(unchanged = false) {
  const baseRegister = { version: 1, items: [{ id: 'manual', title: 'Keep manual risk', status: 'open' }] };
  return { unchanged, baseRegister, riskRegister: {
    version: 1, items: [...baseRegister.items, { id: 'ai-risk-utilities', title: 'Verify utility locations', status: 'open', ai: { key: 'utilities' } }],
    aiReview: { summary: 'Utility evidence needs review.', inputFingerprint: 'evidence-v1' }
  } };
}

function requestEnv(response = { data: review(), error: null }, options = {}) {
  const calls = [];
  const c = {
    sb: { functions: { invoke(name, payload) { calls.push({ name, payload }); return options.invoke ? options.invoke() : Promise.resolve(response); } } },
    async requestWithTimeout(promise, label, milliseconds) { calls.push({ label, milliseconds }); return promise; }
  };
  vm.createContext(c);
  vm.runInContext(excerpt('async function requestProjectRiskReview(', '// PROJECT_RISK_AI_REQUEST_END'), c);
  return { c, calls };
}

test('risk request targets the open project, forwards cancellation and force, and accepts a valid empty review', async () => {
  const output = review(); output.riskRegister.items = [];
  const env = requestEnv({ data: output, error: null }), controller = new AbortController();
  assert.equal(await env.c.requestProjectRiskReview('project-current', { force: true, signal: controller.signal }), output);
  const invocation = env.calls.find(call => call.payload);
  assert.equal(invocation.name, 'assistant');
  assert.equal(invocation.payload.signal, controller.signal);
  assert.deepEqual(plain(invocation.payload.body.targetProject), { id: 'project-current' });
  assert.equal(invocation.payload.body.mode, 'risk-register');
  assert.equal(invocation.payload.body.force, true);
  assert.equal('history' in invocation.payload.body, false);
  assert.equal('documentRefs' in invocation.payload.body, false);
  assert.equal(env.calls.find(call => call.milliseconds).milliseconds, 90000);
  await env.c.requestProjectRiskReview('project-current', { force: 'true' });
  assert.equal(env.calls.filter(call => call.payload)[1].payload.body.force, false);
});

test('risk request preserves server failure details and rejects incomplete response shapes', async () => {
  const responses = [
    [{ data: null, error: { message: 'Gateway error', context: { json: async () => ({ error: 'AI provider unavailable' }) } } }, /AI provider unavailable/],
    [{ data: null, error: { message: 'Network offline', context: { json: async () => { throw Error('Not JSON'); } } } }, /Network offline/],
    [{ data: { error: 'Read access changed' }, error: null }, /Read access changed/],
    ...[null, {}, { ...review(), unchanged: 'yes' }, { ...review(), riskRegister: {} }, { ...review(), baseRegister: null }, { ...review(), baseRegister: [] }]
      .map(data => [{ data, error: null }, /incomplete risk review/])
  ];
  for (const [response, message] of responses) {
    const env = requestEnv(response);
    await assert.rejects(env.c.requestProjectRiskReview('project-current'), error => message.test(error.message));
  }
});

test('risk request discards a successful response delivered after cancellation', async () => {
  const gate = deferred(), controller = new AbortController();
  const env = requestEnv(null, { invoke: () => gate.promise });
  const pending = env.c.requestProjectRiskReview('project-current', { signal: controller.signal });
  controller.abort(); gate.resolve({ data: review(), error: null });
  await assert.rejects(pending, /canceled/);
});

function generationEnv(kind, options = {}) {
  const calls = [], published = [], statuses = [], controllerSignals = [];
  const original = {
    meta: { title: 'Current project', totalBudget: 1000, riskRegister: { version: 1, items: [] } },
    actuals: { 1: { spend: 40 } }, grant: { sections: [] }, payApps: [{ number: 1, workCompleted: 40 }], sched: { days: 70 }
  };
  const permission = { current: options.editor !== false }, request = { current: null }, lock = { current: options.locked === true };
  const savedMeta = { ...original.meta, externalField: 'preserved from server', riskRegister: review().riskRegister };
  const c = {
    projectId: 'project-current', AbortController, editing: options.editing === true, busy: false,
    riskPermission: permission, internalRiskPermission: permission,
    riskAIRequest: request, internalAIRequest: request,
    riskSavePending: lock, internalWrite: lock,
    latestProjectSnapshot: { current: original }, confirmedRiskSnapshot: { current: null },
    setRiskAIStatus(value) { statuses.push(value); },
    setSaveState(value) { calls.push(['status', value]); },
    setBusy(value) { c.busy = value; },
    setMeta(value) { calls.push(['publish', value]); published.push(value); },
    saveQueue: { current: {
      async flush() { calls.push(['flush']); if (options.flush) return options.flush(); },
      schedule() { throw new Error('Generating risks must not enqueue financial writes.'); }
    } },
    async requestProjectRiskReview(id, args) {
      calls.push(['request', id, args]); controllerSignals.push(args.signal);
      return options.provider ? options.provider(id, args) : review(options.cached);
    },
    async persistProjectRiskRegister(id, register, expected) {
      calls.push(['persist', id, register, expected]);
      return options.persist ? options.persist(id, register, expected) : { ...savedMeta, riskRegister: register };
    }
  };
  vm.createContext(c);
  const start = kind === 'capital' ? '  function cancelRiskReview(' : '  function cancelInternalRiskReview(';
  vm.runInContext(excerpt(start, '  useEffect('), c);
  const generate = (...args) => c[kind === 'capital' ? 'generateProjectRisks' : 'generateInternalRisks'](...args);
  const cancel = () => c[kind === 'capital' ? 'cancelRiskReview' : 'cancelInternalRiskReview']();
  function unmount() {
    const name = kind === 'capital' ? 'riskAIRequest' : 'internalAIRequest';
    const from = html.indexOf('  useEffect(()=>()=>{if(' + name + '.current)');
    const to = html.indexOf('\n', from);
    assert.ok(from >= 0 && to > from);
    let cleanup;
    c.useEffect = callback => { cleanup = callback(); };
    vm.runInContext(html.slice(from, to), c);
    cleanup();
  }
  return { c, calls, published, statuses, original, savedMeta, permission, request, lock, controllerSignals, generate, cancel, unmount };
}

test('capital generation flushes pending edits before requesting evidence and waits for persistence before publishing', async () => {
  const flush = deferred(), provider = deferred(), save = deferred(), output = review();
  const env = generationEnv('capital', { flush: () => flush.promise, provider: () => provider.promise, persist: () => save.promise });
  const pending = env.generate({ force: true });
  assert.deepEqual(env.calls.map(call => call[0]), ['flush']);
  assert.equal(env.lock.current, true);
  flush.resolve(); await tick();
  assert.deepEqual(env.calls.map(call => call[0]), ['flush', 'request']);
  assert.equal(env.calls[1][2].force, true);
  provider.resolve(output); await tick();
  const write = env.calls.find(call => call[0] === 'persist');
  assert.equal(write[1], 'project-current');
  assert.equal(write[2], output.riskRegister);
  assert.equal(write[3], output.baseRegister, 'CAS must use the server snapshot from before generation, not local stale state');
  assert.equal(env.published.length, 0);
  assert.equal(env.c.latestProjectSnapshot.current, env.original);
  save.resolve(env.savedMeta); const result = await pending;
  assert.equal(result.unchanged, false);
  assert.equal(env.published[0], env.savedMeta);
  const confirmed = env.c.confirmedRiskSnapshot.current;
  assert.equal(confirmed.meta, env.savedMeta);
  for (const key of ['actuals', 'grant', 'payApps', 'sched']) assert.equal(confirmed[key], env.original[key]);
  assert.equal(env.c.latestProjectSnapshot.current, confirmed);
  assert.equal(env.lock.current, false);
  assert.equal(env.request.current, null);
  assert.equal(env.controllerSignals[0].aborted, true);
});

test('capital cancellation during a pending project flush prevents an AI request entirely', async () => {
  const gate = deferred(), env = generationEnv('capital', { flush: () => gate.promise });
  const pending = env.generate();
  assert.equal(env.cancel(), true);
  gate.resolve(); await assert.rejects(pending, /canceled/);
  assert.deepEqual(env.calls.map(call => call[0]), ['flush']);
  assert.equal(env.published.length, 0);
  assert.equal(env.lock.current, false);
});

test('capital failed flush preserves project state and never asks the provider', async () => {
  const env = generationEnv('capital', { flush: () => { throw Error('Prior project save failed'); } });
  await assert.rejects(env.generate(), /Prior project save failed/);
  assert.deepEqual(env.calls.map(call => call[0]), ['flush']);
  assert.equal(env.published.length, 0);
  assert.equal(env.c.latestProjectSnapshot.current, env.original);
  assert.equal(env.lock.current, false);
});

for (const kind of ['capital', 'internal']) {
  test(kind + ' generation rejects viewers and concurrent work before any request or write', async () => {
    for (const options of [{ editor: false }, { locked: true }, ...(kind === 'internal' ? [{ editing: true }] : [])]) {
      const env = generationEnv(kind, options);
      await assert.rejects(env.generate(), /Editor access|current save|Finish saving/);
      assert.equal(env.calls.length, 0);
      assert.equal(env.published.length, 0);
      assert.equal(env.request.current, null);
    }
  });

  test(kind + ' cached reviews still recheck the server register before publishing', async () => {
    const output = review(true), gate = deferred();
    const env = generationEnv(kind, { provider: () => output, persist: () => gate.promise });
    const pending = env.generate(); await tick();
    const write = env.calls.find(call => call[0] === 'persist');
    assert.ok(write, 'A cached response still requires conflict detection');
    assert.equal(write[3], output.baseRegister);
    assert.equal(env.published.length, 0);
    gate.resolve(env.savedMeta);
    const result = await pending;
    assert.equal(result.unchanged, true);
    assert.equal(env.published[0], env.savedMeta);
    assert.equal(env.lock.current, false);
    assert.equal(env.c.busy, false);
  });

  test(kind + ' provider and persistence errors preserve existing state and release the busy guard', async () => {
    for (const step of ['provider', 'persist']) {
      const env = generationEnv(kind, { [step]: () => { throw Error(step === 'provider' ? 'Provider unavailable' : 'Another person updated the risk register'); } });
      await assert.rejects(env.generate(), /Provider unavailable|Another person updated/);
      assert.equal(env.published.length, 0);
      assert.equal(env.c.latestProjectSnapshot.current, env.original);
      assert.equal(env.c.confirmedRiskSnapshot.current, null);
      assert.equal(env.lock.current, false);
      assert.equal(env.request.current, null);
      assert.equal(env.c.busy, false);
      assert.equal(env.controllerSignals[0].aborted, true);
      if (step === 'provider') assert.equal(env.calls.some(call => call[0] === 'persist'), false);
    }
  });

  test(kind + ' cancellation ignores a late response and an old cleanup cannot unlock a newer review', async () => {
    const firstProvider = deferred(), secondProvider = deferred(); let attempts = 0;
    const env = generationEnv(kind, { provider: () => (++attempts === 1 ? firstProvider.promise : secondProvider.promise) });
    const first = env.generate(); await tick();
    const firstSignal = env.controllerSignals[0];
    assert.equal(env.cancel(), true);
    assert.equal(firstSignal.aborted, true);
    const second = env.generate({ force: true }); await tick();
    const active = env.request.current;
    firstProvider.resolve(review()); await assert.rejects(first, /canceled/);
    assert.equal(env.calls.some(call => call[0] === 'persist'), false);
    assert.equal(env.request.current, active);
    assert.equal(env.lock.current, true);
    assert.equal(env.controllerSignals[1].aborted, false);
    secondProvider.resolve(review()); await second;
    assert.equal(env.calls.filter(call => call[0] === 'persist').length, 1);
    assert.equal(env.published.length, 1);
    assert.equal(env.lock.current, false);
  });

  test(kind + ' role loss or unmount while awaiting the provider prevents persistence', async () => {
    for (const change of ['role', 'unmount']) {
      const gate = deferred(), env = generationEnv(kind, { provider: () => gate.promise });
      const pending = env.generate(); await tick();
      if (change === 'role') env.permission.current = false;
      else env.unmount();
      gate.resolve(review()); await assert.rejects(pending, /canceled/);
      assert.equal(env.calls.some(call => call[0] === 'persist'), false);
      assert.equal(env.published.length, 0);
      assert.equal(env.controllerSignals[0].aborted, true);
    }
  });

  test(kind + ' persistence cannot be canceled or overlapped once a save starts', async () => {
    const gate = deferred(), env = generationEnv(kind, { persist: () => gate.promise });
    const pending = env.generate(); await tick();
    assert.equal(env.request.current.saving, true);
    assert.equal(env.cancel(), false);
    assert.equal(env.lock.current, true);
    await assert.rejects(env.generate(), /current save|Finish saving/);
    assert.equal(env.published.length, 0);
    gate.resolve(env.savedMeta); await pending;
    assert.equal(env.calls.filter(call => call[0] === 'persist').length, 1);
    assert.equal(env.published[0], env.savedMeta);
  });

  test(kind + ' a save already in flight cannot publish into a view that lost editor access or unmounted', async () => {
    for (const change of ['role', 'unmount']) {
      const gate = deferred(), env = generationEnv(kind, { persist: () => gate.promise });
      const pending = env.generate(); await tick();
      assert.equal(env.calls.filter(call => call[0] === 'persist').length, 1);
      if (change === 'role') env.permission.current = false;
      else env.unmount();
      gate.resolve(env.savedMeta); await pending;
      assert.equal(env.published.length, 0);
      assert.equal(env.c.confirmedRiskSnapshot.current, null);
    }
  });
}
