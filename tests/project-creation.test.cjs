const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'JAN_CPT.html'), 'utf8');
const helperStart = html.indexOf('function ensureNewProjectCreated(');
assert.notEqual(helperStart, -1, 'Creation recovery helper must be present');
const start = html.slice(helperStart - 6, helperStart) === 'async ' ? helperStart - 6 : helperStart;
const source = html.slice(start, html.indexOf('function NewProjectModal(', start));
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const projectRecord = () => ({ title: 'Terminal repairs', meta: { title: 'Terminal repairs', primeBudget: 1250 }, sched: { days: 30 } });

function setup({ onQuery, timed = false } = {}) {
  const rows = new Map(), queries = [], deadlines = [], wrapped = [];
  let generated = 0;
  function execute(query) {
    if (query.table === 'documents') return { data: null, error: null };
    if (query.action === 'insert') {
      if (rows.has(query.record.id)) return { data: null, error: { code: '23505', message: 'Duplicate project ID' } };
      rows.set(query.record.id, clone(query.record));
      return { data: { id: query.record.id }, error: null };
    }
    assert.deepEqual(query.filters.map(([key]) => key), ['id'], 'Recovery reads only the exact draft ID');
    const row = rows.get(query.filters[0][1]);
    return { data: row ? { id: row.id } : null, error: null };
  }
  const sb = {
    from(table) {
      assert.ok(['projects', 'documents'].includes(table));
      const query = { table, action: 'select', filters: [] };
      const builder = {
        insert(record) { query.action = 'insert'; query.record = clone(record); return this; },
        select(columns) { query.columns = columns; return this; },
        eq(key, value) { query.filters.push([key, value]); return this; },
        single() { query.single = true; return this; },
        maybeSingle() { query.maybeSingle = true; return this; },
        abortSignal(signal) { query.signal = signal; return this; },
        then(resolve, reject) {
          queries.push(query);
          return Promise.resolve().then(() => onQuery ? onQuery(query, { rows, queries, execute }) : execute(query)).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  const context = {
    sb, console, AbortController,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++generated).padStart(12, '0')}` },
    requestWithTimeout(request, label) {
      wrapped.push(label);
      const result = Promise.resolve(request);
      return timed ? Promise.race([result, new Promise((_, reject) => deadlines.push(() => reject(new Error(`${label} timed out`))))]) : result;
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, create: context.ensureNewProjectCreated, rows, queries, deadlines, wrapped, generated: () => generated };
}

test('creation rejects insert failures without claiming success and retains its retry identity', async () => {
  for (const thrown of [false, true]) {
    const env = setup({ onQuery() {
      if (thrown) throw new Error('Network unavailable');
      return { data: null, error: { message: 'Network unavailable' } };
    } });
    const draft = {};
    await assert.rejects(env.create(draft, projectRecord()), { message: /Network unavailable/ });
    assert.equal(draft.attempted, true);
    assert.equal(draft.created == null, true);
    assert.equal(draft.record.id, env.queries[0].record.id);
    assert.equal(env.generated(), 1);
    assert.equal(env.wrapped.length, 1);
  }
});

test('a hanging project insert reaches the deadline instead of waiting forever', async () => {
  const env = setup({ timed: true, onQuery: () => new Promise(() => {}) });
  const draft = {};
  const rejected = assert.rejects(env.create(draft, projectRecord()), /timed out/);
  await flush();
  assert.equal(env.queries.length, 1);
  assert.equal(env.deadlines.length, 1);
  env.deadlines[0]();
  await rejected;
  assert.equal(draft.created == null, true);
  assert.equal(draft.attempted, true);
  assert.equal(env.queries[0].signal.aborted, true);
});

test('late insert success is reconciled on retry without creating a second project', async () => {
  let commit;
  const env = setup({ timed: true, onQuery(query, state) {
    if (query.action === 'insert') return new Promise(resolve => { commit = () => resolve(state.execute(query)); });
    return state.execute(query);
  } });
  const draft = {};
  const rejected = assert.rejects(env.create(draft, projectRecord()), /timed out/);
  await flush();
  env.deadlines[0]();
  await rejected;
  commit();
  await flush();
  const created = await env.create(draft, { title: 'Edited after timeout', meta: { primeBudget: 9999 } });
  assert.equal(created.id, draft.record.id);
  assert.equal(env.rows.size, 1);
  assert.equal(env.rows.get(created.id).title, 'Terminal repairs');
  assert.equal(env.rows.get(created.id).meta.primeBudget, 1250);
  assert.deepEqual(env.queries.map(query => query.action), ['insert', 'select']);
  assert.equal(env.queries[1].maybeSingle, true);
  assert.equal(env.generated(), 1);
  assert.equal(env.wrapped.length, env.queries.length);
});

test('an uncommitted retry inserts the original record with the same project ID', async () => {
  let first = true;
  const env = setup({ onQuery(query, state) {
    if (query.action === 'insert' && first) { first = false; throw new Error('Connection lost before insert'); }
    return state.execute(query);
  } });
  const draft = {};
  await assert.rejects(env.create(draft, projectRecord()), /Connection lost/);
  const created = await env.create(draft, { title: 'Changed form title', meta: { primeBudget: 7000 } });
  assert.deepEqual(env.queries.map(query => query.action), ['insert', 'select', 'insert']);
  assert.deepEqual(env.queries[0].record, env.queries[2].record);
  assert.equal(env.rows.get(created.id).title, 'Terminal repairs');
  assert.equal(env.generated(), 1);
  assert.equal(env.wrapped.length, env.queries.length);
});

test('a duplicate ID race re-reads the existing row and never overwrites it', async () => {
  const env = setup({ onQuery(query, state) {
    if (query.action === 'insert') {
      state.rows.set(query.record.id, { ...query.record, title: 'Already saved project' });
      return { data: null, error: { code: '23505', message: 'Duplicate project ID' } };
    }
    return state.execute(query);
  } });
  const draft = {};
  const created = await env.create(draft, projectRecord());
  assert.equal(created.id, draft.record.id);
  assert.deepEqual(env.queries.map(query => query.action), ['insert', 'select']);
  assert.equal(env.rows.size, 1);
  assert.equal(env.rows.get(created.id).title, 'Already saved project');
  assert.equal(env.wrapped.length, env.queries.length);
});

test('a failed reconciliation never proceeds to another insert', async () => {
  const env = setup({ onQuery(query) {
    return { data: null, error: { message: query.action === 'insert' ? 'Insert uncertain' : 'Recovery read unavailable' } };
  } });
  const draft = {};
  await assert.rejects(env.create(draft, projectRecord()), { message: /Insert uncertain/ });
  await assert.rejects(env.create(draft, projectRecord()), { message: /Recovery read unavailable/ });
  assert.deepEqual(env.queries.map(query => query.action), ['insert', 'select']);
  assert.equal(draft.created == null, true);
  assert.equal(env.wrapped.length, env.queries.length);
});

test('confirmed creation is cached and repeated saves do not query or insert again', async () => {
  const env = setup(), draft = {};
  const first = await env.create(draft, projectRecord());
  const second = await env.create(draft, { title: 'Another title' });
  assert.equal(first, second);
  assert.equal(second, draft.created);
  assert.equal(env.queries.length, 1);
  assert.equal(env.rows.size, 1);
});

test('missing confirmation data is an error, not a successful project creation', async () => {
  const env = setup({ onQuery: () => ({ data: null, error: null }) });
  const draft = {};
  await assert.rejects(env.create(draft, projectRecord()));
  assert.equal(draft.created == null, true);
});

function modalSetup(options = {}, draft = {}) {
  const env = setup(options);
  let slots = [], cursor = 0, closed = 0;
  const done = [];
  Object.assign(env.context, {
    docCategory: () => 'General',
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    React: {
      createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }),
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      }
    }
  });
  const componentStart = html.indexOf('function NewProjectModal(');
  vm.runInContext(html.slice(componentStart, html.indexOf('//  ROOT', componentStart)), env.context);
  const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : [];
  function render() {
    cursor = 0;
    return env.context.NewProjectModal({ draft, initialCategory: 'internal', onClose: () => closed++, onDone: category => done.push(category) });
  }
  const button = text => all(render()).find(node => node.tag === 'button' && node.children.includes(text));
  const titleInput = () => all(render()).find(node => node.tag === 'input' && node.props.placeholder === 'e.g. Terminal lighting repair');
  return { ...env, draft, done, render, all, button, titleInput, closed: () => closed, reopen: () => { slots = []; return render(); } };
}

test('failed creation releases the modal save button and keeps the entered title with a visible error', async () => {
  const env = modalSetup({ onQuery: () => { throw new Error('Network unavailable'); } });
  env.titleInput().props.onChange({ target: { value: 'Repair office lighting' } });
  await env.button('Create project').props.onClick();
  assert.equal(env.button('Retry save').props.disabled, false);
  assert.equal(env.titleInput().props.value, 'Repair office lighting');
  assert.ok(env.all(env.render()).some(node => node.props.role === 'alert' && node.children.some(text => typeof text === 'string' && text.includes('Network unavailable'))));
  assert.equal(env.done.length, 0);
});

test('repeated clicks cannot create twice and dismissal is guarded until the request completes', async () => {
  let complete;
  const env = modalSetup({ onQuery(query, state) {
    return new Promise(resolve => { complete = () => resolve(state.execute(query)); });
  } });
  env.titleInput().props.onChange({ target: { value: 'Repair office lighting' } });
  const save = env.button('Create project').props.onClick;
  const first = save(), second = save();
  await flush();
  assert.equal(env.queries.length, 1);
  assert.equal(env.button('Saving…').props.disabled, true);
  const close = env.all(env.render()).find(node => node.props['aria-label'] === 'Close new project');
  assert.equal(close.props.disabled, true);
  close.props.onClick();
  env.render().props.onClick();
  assert.equal(env.closed(), 0);
  complete();
  await Promise.all([first, second]);
  assert.deepEqual(env.done, ['internal']);
  assert.equal(env.rows.size, 1);
});

test('closing and reopening a failed creation resumes the same draft and saved form', async () => {
  let rejectInsert = true;
  const env = modalSetup({ onQuery(query, state) {
    if (query.action === 'insert' && rejectInsert) throw new Error('Connection failed');
    return state.execute(query);
  } });
  env.titleInput().props.onChange({ target: { value: 'Resume this project' } });
  await env.button('Create project').props.onClick();
  const originalId = env.draft.record.id;
  env.button('Close for now').props.onClick();
  assert.equal(env.closed(), 1);
  env.reopen();
  assert.equal(env.titleInput().props.value, 'Resume this project');
  assert.equal(env.button('Retry save').props.disabled, false);
  rejectInsert = false;
  await env.button('Retry save').props.onClick();
  assert.deepEqual(env.queries.map(query => query.action), ['insert', 'select', 'insert']);
  assert.equal(env.queries[2].record.id, originalId);
  assert.equal(env.rows.size, 1);
  assert.equal(env.rows.get(originalId).title, 'Resume this project');
  assert.deepEqual(env.done, ['internal']);
});

test('a stalled attachment finishes with a recoverable result and keeps the created project', async () => {
  const env = modalSetup({ timed: true }, { scan: { files: [{ name: 'first.pdf', size: 100 }, { name: 'second.pdf', size: 100 }] } });
  let uploads = 0;
  env.context.sb.storage = { from(bucket) {
    assert.equal(bucket, 'project-docs');
    return { upload() { uploads++; return new Promise(() => {}); } };
  } };
  env.titleInput().props.onChange({ target: { value: 'Project with attachments' } });
  const saving = env.button('Create project').props.onClick();
  await flush();
  assert.equal(env.rows.size, 1);
  assert.equal(uploads, 1);
  assert.equal(env.button('Uploading files…').props.disabled, true);
  env.deadlines.at(-1)();
  await saving;
  assert.equal(env.button('View projects').props.disabled, false);
  assert.equal(env.draft.result.uploaded, 0);
  assert.equal(env.draft.result.failed.length, 1);
  assert.equal(env.draft.result.unattempted, 1);
  assert.equal(uploads, 1, 'A stalled connection does not wait through every remaining file');
  assert.equal(env.rows.size, 1);
  assert.equal(env.done.length, 0, 'The upload summary remains visible until dismissed');
  env.button('View projects').props.onClick();
  assert.deepEqual(env.done, ['internal']);
});

test('a returned registration network error retains uploaded files and stops the remaining batch', async () => {
  const env = modalSetup({ onQuery(query, state) {
    return query.table === 'documents' ? { data: null, error: { message: 'Failed to fetch' } } : state.execute(query);
  } }, { scan: { files: [{ name: 'first.pdf', size: 100 }, { name: 'second.pdf', size: 200 }] } });
  const uploads = [], removals = [];
  env.context.sb.storage = { from(bucket) {
    assert.equal(bucket, 'project-docs');
    return {
      async upload(storagePath, file) { uploads.push({ storagePath, file }); return { error: null }; },
      async remove(paths) { removals.push(paths); return { error: null }; }
    };
  } };
  env.titleInput().props.onChange({ target: { value: 'Project with uncertain document save' } });
  await env.button('Create project').props.onClick();
  assert.equal(env.rows.size, 1);
  assert.equal(uploads.length, 1);
  assert.equal(env.queries.filter(query => query.table === 'documents').length, 1);
  assert.equal(removals.length, 0, 'A registration that may have committed must not lose its stored file');
  assert.equal(env.draft.result.uploaded, 0);
  assert.equal(env.draft.result.unattempted, 1);
  assert.match(env.draft.result.failed[0], /first\.pdf: Failed to fetch/);
  assert.equal(env.button('View projects').props.disabled, false);
  assert.equal(env.done.length, 0);
});

test('two successful files upload and register sequentially before completing creation', async () => {
  const events = [];
  const env = modalSetup({ onQuery(query, state) {
    if (query.table === 'documents') events.push('register:' + query.record.file_name);
    return state.execute(query);
  } }, { scan: { files: [{ name: 'first.pdf', size: 100 }, { name: 'second.pdf', size: 200 }] } });
  env.context.sb.storage = { from(bucket) {
    assert.equal(bucket, 'project-docs');
    return { async upload(_storagePath, file) { events.push('upload:' + file.name); return { error: null }; } };
  } };
  env.titleInput().props.onChange({ target: { value: 'Project with both files' } });
  await env.button('Create project').props.onClick();
  assert.deepEqual(events, ['upload:first.pdf', 'register:first.pdf', 'upload:second.pdf', 'register:second.pdf']);
  assert.deepEqual(env.done, ['internal']);
  assert.equal(env.rows.size, 1);
  const documents = env.queries.filter(query => query.table === 'documents').map(query => query.record);
  assert.deepEqual(documents.map(document => document.file_name), ['first.pdf', 'second.pdf']);
  assert.deepEqual(documents.map(document => document.size_bytes), [100, 200]);
  assert.ok(documents.every(document => document.project_id === env.draft.created.id && document.kind === 'file'));
  assert.equal(new Set(documents.map(document => document.storage_path)).size, 2);
  assert.equal(env.draft.result, undefined);
});
