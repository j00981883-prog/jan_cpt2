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
const dashboard = (id, name = `${id}.pdf`) => ({ id, project_id: 'p1', file_name: name, storage_path: `p1/${name}`, size_bytes: 100, review_status: 'draft', revision_no: 1 });
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
        const query = { table, filters: [] };
        const builder = {
          select(columns) { query.columns = columns; return this; },
          neq(field, value) { query.filters.push(['neq', field, value]); return this; },
          eq(field, value) { query.filters.push(['eq', field, value]); return this; },
          in(field, value) { query.filters.push(['in', field, value]); return this; },
          order() { return this; }, limit() { return this; },
          then(resolve, reject) {
            queries.push(query);
            return Promise.resolve().then(() => {
              if (onQuery) { const custom = onQuery(query); if (custom) return custom; }
              if (table === failTable) return { error: { message: 'Unavailable' } };
              return { data: (tables[table] || []).filter(row => query.filters.every(([op, field, value]) => op === 'eq' ? row[field] === value : op === 'neq' ? row[field] !== value : value.includes(row[field]))) };
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
