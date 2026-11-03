const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'JAN_CPT.html'), 'utf8');
const source = html.slice(html.indexOf('const FIELD_LABEL ='), html.indexOf('//  FIELD SETUP'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(all)] : [];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? (node.children || []).map(text).join(' ') : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const button = (tree, label) => all(tree).find(node => node.tag === 'button' && node.children.includes(label));
const fileButton = (tree, name, sourceName) => all(tree).find(node => node.tag === 'button' && node.props['aria-label'] === `Select ${name} (${sourceName})`);
const modified = '2026-11-03T18:00:00Z';
const dashboard = (id, name = `${id}.pdf`) => ({ id, project_id: 'p1', file_name: name, storage_path: `p1/${name}`, size_bytes: 100, review_status: 'draft', revision_no: 1, created_at: modified });
const sharepoint = (id, name = `${id}.pdf`) => ({ source_id: id, project_id: 'p1', file_name: name, modified_at: modified, source_version: '2', url: `https://jmaait.sharepoint.com/sites/CapitalProgramming/${name}` });
const cached = id => ({ source_id: id, storage_path: `sharepoint/${id}`, size_bytes: 100, source_modified_at: modified, source_version: '2', cached_at: modified });

function runtime({ tables = {}, failTable, onQuery, invoke } = {}) {
  let slots = [], cursor = 0;
  const effects = [], queries = [], calls = [], deadlines = [];
  function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  }
  function useEffect(fn, dependencies) {
    const index = cursor++, previous = slots[index];
    if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
      const slot = { dependencies, cleanup: previous?.cleanup };
      slots[index] = slot;
      effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); });
    }
  }
  const context = {
    Date, URL, Set, Map, console, useState, useEffect,
    window: { addEventListener() {}, removeEventListener() {}, JMAA_APPLY: { projectId: 'p1', projectTitle: 'Test project', snapshot: { meta: {}, sched: {}, grant: {} } } },
    setTimeout: fn => fn(),
    requestWithTimeout: async (request, _label, timeout) => { deadlines.push(timeout); return request; },
    React: { useState, useEffect, createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }),
      useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; } },
    sb: {
      from(table) {
        const query = { table, filters: [], orders: [] };
        const builder = {
          select(columns) { query.columns = columns; return this; },
          neq(field, value) { query.filters.push(['neq', field, value]); return this; },
          eq(field, value) { query.filters.push(['eq', field, value]); return this; },
          in(field, value) { query.filters.push(['in', field, value]); return this; },
          order(field, options) { query.orders.push([field, options.ascending]); return this; },
          range(start, end) { query.range = [start, end]; return this; }, limit() { return this; },
          then(resolve, reject) {
            queries.push(query);
            return Promise.resolve().then(() => {
              if (onQuery) { const custom = onQuery(query); if (custom) return custom; }
              if (table === failTable) return { error: { message: 'Unavailable' } };
              let rows = (tables[table] || []).filter(row => query.filters.every(([op, field, value]) => op === 'eq' ? row[field] === value : op === 'neq' ? row[field] !== value : value.includes(row[field])));
              rows.sort((a, b) => { for (const [field, ascending] of query.orders) { const compared = String(a[field]).localeCompare(String(b[field])); if (compared) return ascending ? compared : -compared; } return 0; });
              if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1);
              return { data: rows };
            }).then(resolve, reject);
          }
        };
        return builder;
      },
      functions: { async invoke(_name, payload) {
        calls.push(payload.body);
        return invoke ? invoke(payload.body, calls.length) : { data: { answer: 'Reviewed the selected files.', sources: [] } };
      } }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  function render(name, props) { cursor = 0; return context[name](props); }
  const runEffects = () => { while (effects.length) effects.shift()(); };
  return { context, render, runEffects, queries, calls, deadlines };
}

test('picker loads dashboard and SharePoint files within the current project and keeps their identities distinct', async () => {
  const env = runtime({ tables: {
    documents: [dashboard('same', 'Dashboard.pdf'), { ...dashboard('other'), project_id: 'p2' }, { ...dashboard('archived'), review_status: 'archived' }],
    sharepoint_documents: [sharepoint('same', 'SharePoint.pdf'), { ...sharepoint('other'), project_id: 'p2' }],
    sharepoint_file_contents: [cached('same')]
  } });
  let selected;
  const props = { projectId: 'p1', onSelect: files => { selected = files; } };
  env.render('AssistantDocumentPicker', props); env.runEffects(); await flush();
  let tree = env.render('AssistantDocumentPicker', props);
  assert.equal(fileButton(tree, 'Dashboard.pdf', 'Dashboard').props.disabled, false);
  assert.equal(fileButton(tree, 'SharePoint.pdf', 'SharePoint').props.disabled, false);
  assert.doesNotMatch(text(tree), /other\.pdf|archived\.pdf/);
  fileButton(tree, 'Dashboard.pdf', 'Dashboard').props.onClick();
  tree = env.render('AssistantDocumentPicker', props);
  fileButton(tree, 'SharePoint.pdf', 'SharePoint').props.onClick();
  button(env.render('AssistantDocumentPicker', props), 'Use selected files').props.onClick();
  assert.deepEqual(Array.from(selected, file => [file.source, file.id]), [['dashboard', 'same'], ['sharepoint', 'same']]);
  assert.equal(env.queries.filter(query => query.table !== 'sharepoint_file_contents').every(query => query.filters.some(([op, field, value]) => op === 'eq' && field === 'project_id' && value === 'p1')), true);
  assert.deepEqual(Array.from(env.queries.find(query => query.table === 'sharepoint_file_contents').filters[0][2]), ['same']);
});

test('SharePoint files require matching cached contents and show unsupported, stale and waiting statuses', () => {
  const { context: c } = runtime();
  assert.equal(c.assistantDocumentChoice('sharepoint', sharepoint('ready'), cached('ready')).readable, true);
  assert.equal(c.assistantDocumentChoice('sharepoint', sharepoint('waiting')).reason, 'Awaiting file contents');
  assert.equal(c.assistantDocumentChoice('sharepoint', sharepoint('version'), { ...cached('version'), source_version: '1' }).readable, false);
  assert.equal(c.assistantDocumentChoice('sharepoint', sharepoint('time'), { ...cached('time'), source_modified_at: '2026-11-02T18:00:00Z' }).readable, false);
  assert.match(c.assistantDocumentChoice('sharepoint', sharepoint('word', 'notes.docx'), cached('word')).reason, /Unsupported/);
  assert.match(c.assistantDocumentChoice('sharepoint', sharepoint('large'), { ...cached('large'), size_bytes: 3600001 }).reason, /3.6 MB/);
  assert.equal(c.assistantDocumentChoice('sharepoint', sharepoint('unknown'), { ...cached('unknown'), size_bytes: null }).readable, false);
  assert.equal(c.assistantDocumentChoice('sharepoint', sharepoint('empty'), { ...cached('empty'), size_bytes: 0 }).readable, false);
  assert.equal(c.assistantDocumentChoice('dashboard', { ...dashboard('empty'), size_bytes: 0 }).readable, false);
});

test('a missing contents cache keeps SharePoint originals visible and dashboard files usable', async () => {
  const env = runtime({ failTable: 'sharepoint_file_contents', tables: { documents: [dashboard('ready')], sharepoint_documents: [sharepoint('pending')] } });
  const props = { projectId: 'p1', onSelect() {} };
  env.render('AssistantDocumentPicker', props); env.runEffects(); await flush();
  const tree = env.render('AssistantDocumentPicker', props);
  assert.equal(fileButton(tree, 'ready.pdf', 'Dashboard').props.disabled, false);
  assert.equal(fileButton(tree, 'pending.pdf', 'SharePoint').props.disabled, true);
  assert.match(text(tree), /SharePoint contents are not available/);
  assert.ok(all(tree).some(node => node.tag === 'a' && node.props.href === sharepoint('pending').url));
});

test('one failed file index does not hide the other available source', async () => {
  for (const failTable of ['documents', 'sharepoint_documents']) {
    const env = runtime({ failTable, tables: { documents: [dashboard('ready')], sharepoint_documents: [sharepoint('ready')], sharepoint_file_contents: [cached('ready')] } });
    const props = { projectId: 'p1', onSelect() {} };
    env.render('AssistantDocumentPicker', props); env.runEffects(); await flush();
    const tree = env.render('AssistantDocumentPicker', props);
    assert.equal(fileButton(tree, 'ready.pdf', failTable === 'documents' ? 'SharePoint' : 'Dashboard').props.disabled, false);
    assert.match(text(tree), /files could not be loaded/);
  }
});

test('large folders load every page with stable ordering and bounded contents queries', async () => {
  const ids = Array.from({ length: 423 }, (_, i) => `file-${String(i).padStart(3, '0')}`);
  const env = runtime({ tables: {
    documents: ids.slice(0, 301).map(id => dashboard(id)).reverse(),
    sharepoint_documents: ids.map(id => sharepoint(id)).reverse(),
    sharepoint_file_contents: ids.map(id => cached(id))
  } });
  let selected;
  const props = { projectId: 'p1', onSelect: files => { selected = files; } };
  env.render('AssistantDocumentPicker', props); env.runEffects(); await flush();
  const tree = env.render('AssistantDocumentPicker', props);
  assert.equal(fileButton(tree, 'file-422.pdf', 'SharePoint').props.disabled, false);
  assert.equal(fileButton(tree, 'file-300.pdf', 'Dashboard').props.disabled, false);
  assert.match(text(tree), /724 files loaded/);
  for (const [table, timestamp, idField] of [['documents', 'created_at', 'id'], ['sharepoint_documents', 'modified_at', 'source_id']]) {
    const pages = env.queries.filter(query => query.table === table);
    assert.deepEqual(pages.map(query => query.range), [[0, 299], [300, 599]]);
    assert.ok(pages.every(query => JSON.stringify(query.orders) === JSON.stringify([[timestamp, false], [idField, true]])));
  }
  const cacheQueries = env.queries.filter(query => query.table === 'sharepoint_file_contents');
  assert.deepEqual(cacheQueries.map(query => query.filters[0][2].length), [100, 100, 100, 100, 23]);
  assert.equal(new Set(cacheQueries.flatMap(query => Array.from(query.filters[0][2]))).size, 423);
  fileButton(tree, 'file-422.pdf', 'SharePoint').props.onClick();
  button(env.render('AssistantDocumentPicker', props), 'Use selected files').props.onClick();
  assert.equal(selected[0].id, 'file-422');
});

test('a failed later page or cache chunk preserves other loaded files and reports the partial result', async () => {
  const ids = Array.from({ length: 423 }, (_, i) => `file-${String(i).padStart(3, '0')}`);
  const env = runtime({ tables: {
    documents: [dashboard('ready')], sharepoint_documents: ids.map(id => sharepoint(id)), sharepoint_file_contents: ids.map(id => cached(id))
  }, onQuery(query) {
    if (query.table === 'sharepoint_documents' && query.range[0] === 300) return { error: { message: 'Unavailable' } };
    if (query.table === 'sharepoint_file_contents' && query.filters[0][2].includes('file-100')) return { error: { message: 'Unavailable' } };
  } });
  const props = { projectId: 'p1', onSelect() {} };
  env.render('AssistantDocumentPicker', props); env.runEffects(); await flush();
  const tree = env.render('AssistantDocumentPicker', props);
  assert.equal(fileButton(tree, 'ready.pdf', 'Dashboard').props.disabled, false);
  assert.equal(fileButton(tree, 'file-299.pdf', 'SharePoint').props.disabled, false);
  assert.equal(fileButton(tree, 'file-100.pdf', 'SharePoint').props.disabled, true);
  assert.equal(fileButton(tree, 'file-300.pdf', 'SharePoint'), undefined);
  assert.match(text(tree), /SharePoint files loaded only partly \(300 files\).*Refresh files/);
  assert.match(text(tree), /Some SharePoint contents are not available/);
});

test('the folder limit is visible and refresh picks up new contents while preserving selected files', async () => {
  const ids = Array.from({ length: 3001 }, (_, i) => `file-${String(i).padStart(4, '0')}`);
  const tables = { documents: [dashboard('ready')], sharepoint_documents: ids.map(id => sharepoint(id)), sharepoint_file_contents: [] };
  const env = runtime({ tables });
  const props = { projectId: 'p1', onSelect() {} };
  env.render('AssistantDocumentPicker', props); env.runEffects(); await flush();
  let tree = env.render('AssistantDocumentPicker', props);
  assert.match(text(tree), /3,000-file limit.*Search covers loaded files only/);
  assert.equal(env.queries.filter(query => query.table === 'sharepoint_documents').length, 10);
  assert.equal(fileButton(tree, 'file-2999.pdf', 'SharePoint').props.disabled, true);
  fileButton(tree, 'ready.pdf', 'Dashboard').props.onClick();
  tables.sharepoint_file_contents.push(cached('file-2999'));
  button(env.render('AssistantDocumentPicker', props), 'Refresh files').props.onClick();
  env.render('AssistantDocumentPicker', props); env.runEffects();
  assert.equal(button(env.render('AssistantDocumentPicker', props), 'Refresh files').props.disabled, true);
  await flush();
  tree = env.render('AssistantDocumentPicker', props);
  assert.equal(fileButton(tree, 'file-2999.pdf', 'SharePoint').props.disabled, false);
  assert.match(text(tree), /1 of 3 selected/);
});

test('picker limits selection to three files and reports an empty search', async () => {
  const env = runtime({ tables: { documents: ['one', 'two', 'three', 'four'].map(id => dashboard(id)) } });
  let selected;
  const props = { projectId: 'p1', onSelect: files => { selected = files; } };
  env.render('AssistantDocumentPicker', props); env.runEffects(); await flush();
  for (const name of ['one.pdf', 'two.pdf', 'three.pdf']) fileButton(env.render('AssistantDocumentPicker', props), name, 'Dashboard').props.onClick();
  let tree = env.render('AssistantDocumentPicker', props);
  const fourth = fileButton(tree, 'four.pdf', 'Dashboard');
  assert.equal(fourth.props.disabled, true);
  fourth.props.onClick(); // The handler also enforces the limit.
  button(env.render('AssistantDocumentPicker', props), 'Use selected files').props.onClick();
  assert.equal(selected.length, 3);
  tree = env.render('AssistantDocumentPicker', props);
  all(tree).find(node => node.tag === 'input').props.onChange({ target: { value: 'does not exist' } });
  assert.match(text(env.render('AssistantDocumentPicker', props)), /No files match your search/);
});

test('switching project hides old choices immediately and ignores the previous request result', async () => {
  let resolveOld;
  const env = runtime({ onQuery(query) {
    if (query.table === 'documents' && query.filters.some(([, field, value]) => field === 'project_id' && value === 'p1')) return new Promise(resolve => { resolveOld = resolve; });
  }, tables: { documents: [{ ...dashboard('new'), project_id: 'p2' }] } });
  const props = { projectId: 'p1', onSelect() {} };
  env.render('AssistantDocumentPicker', props); env.runEffects(); await flush();
  const newProps = { ...props, projectId: 'p2' };
  assert.match(text(env.render('AssistantDocumentPicker', newProps)), /Loading project files/);
  env.runEffects(); await flush();
  resolveOld({ data: [dashboard('old')] }); await flush();
  const tree = env.render('AssistantDocumentPicker', newProps);
  assert.ok(fileButton(tree, 'new.pdf', 'Dashboard'));
  assert.doesNotMatch(text(tree), /old\.pdf/);
});

test('answer source labels show only supplied contents and links allow only the JMAA SharePoint host', () => {
  const env = runtime();
  const sources = [
    { id: 'p1', name: 'Project records', kind: 'project records' },
    { id: 'd1', name: 'Budget.pdf', kind: 'document contents', source: 'dashboard', url: 'javascript:alert(1)' },
    { id: 's1', name: 'Contract.pdf', kind: 'document contents', source: 'sharepoint', version: '3', excerpt: true, url: 'https://jmaait.sharepoint.com/sites/CapitalProgramming/Contract.pdf' },
    { id: 's2', name: 'Other.pdf', kind: 'document contents', source: 'sharepoint', url: 'https://jmaait.sharepoint.com.attacker.invalid/file' }
  ];
  const tree = env.context.AssistantAnswerSources({ sources });
  assert.match(text(tree), /Dashboard.*Budget\.pdf.*SharePoint.*Contract\.pdf.*version 3/);
  assert.match(text(tree), /excerpt read/);
  assert.doesNotMatch(text(tree), /Project records/);
  assert.deepEqual(all(tree).filter(node => node.tag === 'a').map(node => node.props.href), [sources[2].url]);
  for (const url of ['http://jmaait.sharepoint.com/file', 'https://user:pw@jmaait.sharepoint.com/file', 'https://jmaait.sharepoint.com:8443/file', 'data:text/html,x']) assert.equal(env.context.assistantSharePointUrl(url), null);
});

function assistantSetup(options) {
  const env = runtime(options);
  const render = () => env.render('Assistant', { isEditor: true });
  render().props.onClick();
  async function send(question) {
    all(render()).find(node => node.tag === 'input' && node.props.value !== undefined).props.onChange({ target: { value: question } });
    await button(render(), 'Send').props.onClick();
    return render();
  }
  function choose(files) {
    button(render(), 'Read project files').props.onClick();
    const picker = all(render()).find(node => node.tag === env.context.AssistantDocumentPicker);
    picker.props.onSelect(files);
  }
  return { ...env, render, send, choose };
}

test('selected files from both sources use documentRefs and persist for follow-ups with per-answer citations', async () => {
  const supplied = [{ id: 'dashboard:d1', name: 'Budget.pdf', kind: 'document contents', source: 'dashboard' }, { id: 'sharepoint:s1', name: 'Contract.pdf', kind: 'document contents', source: 'sharepoint' }];
  const env = assistantSetup({ invoke: (_body, count) => ({ data: { answer: `Answer ${count}`, sources: count === 1 ? supplied : supplied.slice(0, 1) } }) });
  env.choose([{ source: 'dashboard', id: 'd1', name: 'Budget.pdf' }, { source: 'sharepoint', id: 's1', name: 'Contract.pdf' }]);
  await env.send('Compare these files');
  const tree = await env.send('What about the total?');
  for (const request of env.calls) {
    assert.deepEqual(Array.from(request.documentRefs, ref => [ref.source, ref.id]), [['dashboard', 'd1'], ['sharepoint', 's1']]);
    assert.equal(request.document, undefined);
    assert.equal(request.documentId, undefined);
  }
  assert.ok(env.deadlines.every(timeout => timeout === 90000));
  const citations = all(tree).filter(node => node.tag === env.context.AssistantAnswerSources && node.props.sources?.length);
  assert.equal(citations.length, 2);
  assert.equal(citations[0].props.sources.length, 2, 'Earlier citations stay attached to their original answer');
  assert.equal(citations[1].props.sources.length, 1);
});

test('local attachment replaces selected references and stays attached for its own follow-up', async () => {
  const env = assistantSetup();
  env.choose([{ source: 'sharepoint', id: 's1', name: 'Contract.pdf' }]);
  const upload = all(env.render()).find(node => node.tag === 'input' && node.props.type === 'file');
  upload.props.onChange({ target: { files: [{ name: 'Notes.txt', size: 20, type: 'text/plain', text: async () => 'Notes from the meeting.' }], value: 'Notes.txt' } });
  await flush();
  await env.send('Summarize these notes');
  await env.send('Make that shorter');
  for (const request of env.calls) {
    assert.equal(request.documentRefs, undefined);
    assert.equal(request.document.name, 'Notes.txt');
    assert.equal(request.document.text, 'Notes from the meeting.');
  }
});

test('changing project blocks references from the previous project until files are reselected', async () => {
  const env = assistantSetup();
  env.choose([{ source: 'dashboard', id: 'd1', name: 'Budget.pdf' }]);
  env.context.window.JMAA_APPLY = { ...env.context.window.JMAA_APPLY, projectId: 'p2' };
  const tree = await env.send('Read this file');
  assert.equal(env.calls.length, 0);
  assert.match(text(tree), /Choose files for this project/);
});

test('App passes the visible project to the assistant for capital, internal and viewer contexts', () => {
  const appSource = html.slice(html.indexOf('function CloudApp()'), html.indexOf('function BootError('));
  for (const category of ['capital', 'internal']) {
    for (const role of ['viewer', 'editor']) {
      let index = 0;
      const state = [{ user: { id: 'user' } }, false, { role }, 'visible-project', { meta: { title: 'Visible project', projectCategory: category } }, '', false, 0, false, false, false, null];
      const context = {
        CONFIGURED: true, BOOT_ERROR: null, window: {}, useEffect() {}, useState: () => [state[index++], () => {}],
        React: { Fragment: 'fragment', useRef: initial => ({ current: initial }), createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }) },
        Tracker: 'Tracker', InternalProject: 'InternalProject', Assistant: 'Assistant'
      };
      vm.createContext(context); vm.runInContext(appSource, context);
      const assistant = all(context.CloudApp()).find(node => node.tag === 'Assistant');
      assert.equal(assistant.props.projectId, 'visible-project');
      assert.equal(assistant.props.projectTitle, 'Visible project');
      assert.equal(assistant.props.isEditor, role === 'editor');
    }
  }
});

test('open assistant immediately follows project props even before the editor bridge publishes', async () => {
  const env = runtime();
  let props = { isEditor: false, projectId: 'p1', projectTitle: 'Threshold Lighting' };
  const render = () => env.render('Assistant', props);
  render().props.onClick();
  button(render(), 'Read project files').props.onClick();
  props = { ...props, projectId: null, projectTitle: '' };
  let tree = render();
  assert.match(text(tree), /Portfolio questions/);
  assert.equal(all(tree).find(node => node.tag === env.context.AssistantDocumentPicker).props.projectId, null);
  props = { ...props, projectId: 'p2', projectTitle: 'RSA Drainage' };
  tree = render();
  assert.match(text(tree), /Project context: RSA Drainage/);
  const picker = all(tree).find(node => node.tag === env.context.AssistantDocumentPicker);
  assert.equal(picker.props.projectId, 'p2');
  picker.props.onSelect([{ source: 'sharepoint', id: 'rsa-file', name: 'RSA.pdf' }]);
  all(render()).find(node => node.tag === 'input' && node.props.value !== undefined).props.onChange({ target: { value: 'Summarize this file' } });
  await button(render(), 'Send').props.onClick();
  assert.equal(env.context.window.JMAA_APPLY.projectId, 'p1', 'The stale editor bridge has not rerendered yet');
  assert.equal(env.calls[0].targetProject.id, 'p2');
  assert.equal(env.calls[0].documentRefs[0].id, 'rsa-file');
  props = { ...props, isEditor: true };
  all(render()).find(node => node.tag === 'input' && node.props.value !== undefined).props.onChange({ target: { value: 'Set construction budget to 23' } });
  await button(render(), 'Send').props.onClick();
  assert.equal(env.calls.length, 1, 'An edit cannot use a bridge from another project');
  assert.match(text(render()), /Open a capital project you can edit first/);
});

test('project navigation clears selected files and the picker while same-project follow-ups retain them', async () => {
  const sources = [{ id: 'dashboard:d1', name: 'Budget.pdf', kind: 'document contents', source: 'dashboard' }];
  const env = runtime({ invoke: () => ({ data: { answer: 'Reviewed the project files.', sources } }) });
  let props = { isEditor: false, projectId: 'p1', projectTitle: 'Threshold Lighting' };
  const render = () => { env.render('Assistant', props); env.runEffects(); return env.render('Assistant', props); };
  async function send(question) {
    all(render()).find(node => node.tag === 'input' && node.props.value !== undefined).props.onChange({ target: { value: question } });
    await button(render(), 'Send').props.onClick();
    return render();
  }
  render().props.onClick();
  button(render(), 'Read project files').props.onClick();
  all(render()).find(node => node.tag === env.context.AssistantDocumentPicker).props.onSelect([
    { source: 'dashboard', id: 'd1', name: 'Budget.pdf' }, { source: 'sharepoint', id: 's1', name: 'Contract.pdf' }
  ]);
  await send('Compare these files');
  props = { ...props, projectTitle: 'Threshold Lighting updated title' };
  await send('Explain the total');
  assert.equal(env.calls[1].documentRefs.length, 2, 'Same-project updates keep the selection');
  button(render(), 'Read project files').props.onClick();
  props = { ...props, projectId: null, projectTitle: '' };
  let tree = render();
  assert.equal(all(tree).some(node => node.tag === env.context.AssistantDocumentPicker), false);
  assert.equal(all(tree).some(node => node.props.className === 'ai-attached-name'), false);
  props = { ...props, projectId: 'p2', projectTitle: 'RSA Drainage' };
  tree = await send('Summarize this project');
  assert.equal(env.calls[2].targetProject.id, 'p2');
  assert.equal(env.calls[2].documentRefs, undefined);
  assert.equal(env.calls[2].document, undefined);
  assert.equal(env.calls[2].history[0].content, 'Compare these files', 'Navigation preserves chat history');
  assert.ok(all(tree).some(node => node.tag === env.context.AssistantAnswerSources && node.props.sources?.[0]?.name === 'Budget.pdf'), 'Earlier answer citations remain available');
  button(tree, 'Read project files').props.onClick();
  const picker = all(render()).find(node => node.tag === env.context.AssistantDocumentPicker);
  assert.equal(picker.props.projectId, 'p2');
  assert.equal(picker.props.initialSelection.length, 0);
});

test('a local file still loading during navigation cannot replace a file selected in the new project', async () => {
  const env = runtime();
  let props = { isEditor: false, projectId: 'p1', projectTitle: 'Threshold Lighting' }, finishOld;
  const render = () => { env.render('Assistant', props); env.runEffects(); return env.render('Assistant', props); };
  const upload = file => all(render()).find(node => node.tag === 'input' && node.props.type === 'file').props.onChange({ target: { files: [file], value: file.name } });
  render().props.onClick();
  upload({ name: 'Old notes.txt', size: 20, type: 'text/plain', text: () => new Promise(resolve => { finishOld = resolve; }) });
  props = { ...props, projectId: 'p2', projectTitle: 'RSA Drainage' };
  render();
  upload({ name: 'RSA notes.txt', size: 20, type: 'text/plain', text: async () => 'RSA notes' });
  await flush();
  finishOld('Old project notes'); await flush();
  all(render()).find(node => node.tag === 'input' && node.props.value !== undefined).props.onChange({ target: { value: 'Read this file' } });
  await button(render(), 'Send').props.onClick();
  assert.equal(env.calls[0].targetProject.id, 'p2');
  assert.equal(env.calls[0].document.name, 'RSA notes.txt');
  assert.equal(env.calls[0].document.text, 'RSA notes');
});
