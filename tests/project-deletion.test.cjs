const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'JAN_CPT.html'), 'utf8');
const start = html.indexOf('  async function deleteProject(');
assert.notEqual(start, -1, 'Project deletion handler must be present');
const source = html.slice(start, html.indexOf('  const counts =', start));
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup({ editor = true, password = 'deletion-test-password', confirmed = true, result, onQuery, timed = false } = {}) {
  const project = { id: 'p1', title: 'Runway project' };
  let projects = [project, { id: 'p2', title: 'Keep this project' }], refreshes = 0, deletingId = null;
  const queries = [], prompts = [], confirmations = [], alerts = [], deadlines = [], wrapped = [], busyIds = [];
  const lock = { current: false };
  const context = {
    isEditor: editor,
    DELETE_PASSWORD: 'deletion-test-password',
    deletingProject: lock,
    AbortController,
    prompt: message => { prompts.push(message); return password; },
    confirm: message => { confirmations.push(message); return confirmed; },
    alert: message => alerts.push(message),
    setProjects: update => { projects = typeof update === 'function' ? update(projects) : update; },
    setDeletingProjectId: value => { deletingId = value; busyIds.push(value); },
    bump: () => refreshes++,
    requestWithTimeout(request, label) {
      wrapped.push(label);
      const promise = Promise.resolve(request);
      return timed ? Promise.race([promise, new Promise((_, reject) => deadlines.push(() => reject(new Error(`${label} timed out`))))]) : promise;
    },
    sb: { from(table) {
      const query = { table, filters: [] };
      const builder = {
        delete() { query.action = 'delete'; return this; },
        eq(field, value) { query.filters.push([field, value]); return this; },
        select(columns) { query.columns = columns; return this; },
        abortSignal(signal) { query.signal = signal; return this; },
        then(resolve, reject) {
          queries.push(query);
          return Promise.resolve().then(() => onQuery ? onQuery(query) : result || { data: [{ id: 'p1' }], error: null }).then(resolve, reject);
        }
      };
      return builder;
    } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    project, queries, prompts, confirmations, alerts, deadlines, wrapped, busyIds, lock,
    projects: () => projects, refreshes: () => refreshes, deletingId: () => deletingId,
    run: () => context.deleteProject({ stopPropagation() {} }, project)
  };
}

test('confirmed project deletion issues one parent delete and removes only its confirmed row', async () => {
  const env = setup();
  await env.run();
  assert.equal(env.queries.length, 1);
  const query = env.queries[0];
  assert.equal(query.table, 'projects', 'Child records must cascade within the database transaction');
  assert.equal(query.action, 'delete');
  assert.deepEqual(query.filters, [['id', 'p1']]);
  assert.equal(query.columns, 'id', 'The response must confirm which authorized row was deleted');
  assert.deepEqual(env.projects().map(project => project.id), ['p2']);
  assert.match(env.alerts[0], /was deleted/);
  assert.match(env.confirmations[0], /Uploaded files and SharePoint originals will not be deleted/);
  assert.equal(env.refreshes(), 0);
  assert.equal(env.wrapped.length, 1);
  assert.equal(query.signal.aborted, true);
  assert.equal(env.lock.current, false);
  assert.equal(env.deletingId(), null);
  assert.deepEqual(env.busyIds, ['p1', null]);
});

test('zero authorized rows, wrong rows, or multiple rows never produce a deletion success', async () => {
  for (const data of [[], [{ id: 'p2' }], [{ id: 'p1' }, { id: 'p2' }], null]) {
    const env = setup({ result: { data, error: null } });
    await env.run();
    assert.deepEqual(env.projects().map(project => project.id), ['p1', 'p2']);
    assert.equal(env.refreshes(), 1, 'Reconcile the project list after an uncertain or RLS-filtered result');
    assert.ok(env.alerts.some(message => /couldn't confirm.*deletion/i.test(message)));
    assert.equal(env.alerts.some(message => /was deleted/i.test(message)), false);
    assert.equal(env.lock.current, false);
    assert.equal(env.deletingId(), null);
  }
});

test('returned database errors keep the project visible and refresh without deleting child tables', async () => {
  const env = setup({ result: { data: null, error: { message: 'Archive documents to preserve their files and revision history.' } } });
  await env.run();
  assert.deepEqual(env.queries.map(query => query.table), ['projects']);
  assert.deepEqual(env.projects().map(project => project.id), ['p1', 'p2']);
  assert.equal(env.refreshes(), 1);
  assert.match(env.alerts[0], /Archive documents/);
  assert.equal(env.lock.current, false);
  assert.equal(env.deletingId(), null);
});

test('thrown network errors release deletion state and request an authoritative list refresh', async () => {
  const env = setup({ onQuery: () => { throw new Error('Failed to fetch'); } });
  await env.run();
  assert.equal(env.projects().length, 2);
  assert.equal(env.refreshes(), 1);
  assert.match(env.alerts[0], /Failed to fetch/);
  assert.equal(env.queries[0].signal.aborted, true);
  assert.equal(env.lock.current, false);
  assert.equal(env.deletingId(), null);
});

test('a stalled delete reaches its deadline, preserves the displayed project and releases the guard', async () => {
  const env = setup({ timed: true, onQuery: () => new Promise(() => {}) });
  const pending = env.run();
  await flush();
  assert.equal(env.lock.current, true);
  assert.equal(env.deletingId(), 'p1');
  assert.equal(env.projects().length, 2, 'Do not optimistically remove a row while the delete is uncertain');
  env.deadlines[0]();
  await pending;
  assert.equal(env.projects().length, 2);
  assert.equal(env.refreshes(), 1);
  assert.match(env.alerts[0], /timed out/);
  assert.equal(env.queries[0].signal.aborted, true);
  assert.equal(env.lock.current, false);
  assert.equal(env.deletingId(), null);
});

test('viewer access, cancelled passwords, wrong passwords and rejected confirmation never delete', async () => {
  for (const options of [{ editor: false }, { password: null }, { password: 'wrong' }, { confirmed: false }]) {
    const env = setup(options);
    await env.run();
    assert.equal(env.queries.length, 0);
    assert.equal(env.projects().length, 2);
    assert.equal(env.refreshes(), 0);
    assert.equal(env.busyIds.length, 0);
    if (options.editor === false) assert.equal(env.prompts.length, 0);
    if (options.password === null || options.password === 'wrong') assert.equal(env.confirmations.length, 0);
  }
});

test('a second click during deletion cannot prompt again or send a second delete', async () => {
  let complete;
  const env = setup({ onQuery: () => new Promise(resolve => { complete = resolve; }) });
  const first = env.run();
  const second = env.run();
  await flush();
  assert.equal(env.prompts.length, 1);
  assert.equal(env.confirmations.length, 1);
  assert.equal(env.queries.length, 1);
  complete({ data: [{ id: 'p1' }], error: null });
  await Promise.all([first, second]);
  assert.deepEqual(env.projects().map(project => project.id), ['p2']);
  assert.equal(env.alerts.length, 1);
  assert.equal(env.lock.current, false);
});
