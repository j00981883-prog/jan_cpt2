const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const core = require('../risk-register-core.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'risk-register-ui.js'), 'utf8');

// A small React hook/element harness exercises the actual browser component
// callbacks, including async failures. It does not duplicate the UI logic.
function harness(initialProps = {}, component = 'RiskRegister') {
  const hooks = [];
  let cursor = 0, pendingEffects = [], tree, id = 0, focusCount = 0;
  const props = { value: { version: 1, items: [] }, isEditor: true, ...initialProps };
  const React = {
    createElement(type, attributes, ...children) {
      return { type, props: { ...attributes, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false) } };
    },
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, value => { hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: { current: initial } };
      return hooks[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        pendingEffects.push(() => {
          if (previous && previous.cleanup) previous.cleanup();
          hooks[index] = { deps, callback, cleanup: callback() };
        });
      }
    }
  };
  const context = { React, JANRiskRegister: core, crypto: { randomUUID: () => 'test-risk-' + ++id }, Date, URL, console };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'risk-register-ui.js' });
  function expand(node) {
    if (typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    const result = { ...node, props: { ...node.props, children: node.props.children.map(expand) } };
    if (node.props.ref) node.props.ref.current = { focus() { focusCount++; } };
    return result;
  }
  function render(patch) {
    Object.assign(props, patch);
    cursor = 0;
    pendingEffects = [];
    tree = expand(context.JANRiskRegisterUI[component](props));
    pendingEffects.forEach(run => run());
    return tree;
  }
  function all(predicate, node = tree, found = []) {
    if (node && typeof node === 'object') {
      if (predicate(node)) found.push(node);
      node.props.children.forEach(child => all(predicate, child, found));
    }
    return found;
  }
  function content(node = tree) {
    return node && typeof node === 'object' ? node.props.children.map(content).join('') : String(node ?? '');
  }
  function button(label) {
    return all(node => node.type === 'button' && (content(node) === label || node.props['aria-label'] === label))[0];
  }
  function change(name, value) {
    const field = all(node => node.props.name === name)[0];
    assert.ok(field, 'Expected form field ' + name);
    field.props.onChange({ target: { value } });
    render();
  }
  function click(label) {
    const target = button(label);
    assert.ok(target, 'Expected button ' + label);
    const result = target.props.onClick();
    render();
    return result;
  }
  function submit() {
    const form = all(node => node.type === 'form')[0];
    assert.ok(form, 'Expected risk form');
    const result = form.props.onSubmit({ preventDefault() {} });
    render();
    return result;
  }
  function unmount() { hooks.forEach(hook => { if (hook.cleanup) hook.cleanup(); }); }
  function replayEffects() {
    hooks.forEach(hook => { if (hook.cleanup) hook.cleanup(); });
    hooks.forEach(hook => { if (hook.callback) hook.cleanup = hook.callback(); });
  }
  render();
  return { props, render, all, content, button, click, change, submit, unmount, replayEffects, get focusCount() { return focusCount; } };
}

const risk = (patch = {}) => ({
  id: 'existing', title: 'Utility conflict', description: 'Unmapped utilities may delay excavation.',
  likelihood: 3, impact: 4, owner: 'Site lead', mitigation: 'Survey before excavation.',
  contingencyDollars: '', reviewDate: '2099-01-15', status: 'open', resolution: '',
  createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-02T12:00:00.000Z', ...patch
});
function fillRequired(ui, title = 'Long lead equipment') {
  ui.change('title', title);
  ui.change('likelihood', '4');
  ui.change('impact', '5');
}
// Automatic effects do not expose their promises; flush the cross-realm
// promise queue before inspecting the resulting state.
async function settleEffects() { await new Promise(setImmediate); }

test('new risks require explicit ratings, keep unknown cost blank, and report validation accessibly', async () => {
  let calls = 0;
  const dirty = [];
  const ui = harness({ onSave() { calls++; }, onDirtyChange(value) { dirty.push(value); } });
  assert.match(ui.content(), /No risks recorded yet/);
  ui.click('+ Add risk');
  assert.equal(ui.all(node => node.props.name === 'likelihood')[0].props.value, '');
  assert.equal(ui.all(node => node.props.name === 'impact')[0].props.value, '');
  assert.equal(ui.all(node => node.props.name === 'contingencyDollars')[0].props.value, '');
  await ui.submit(); ui.render();
  assert.equal(calls, 0);
  assert.match(ui.content(), /Enter a risk title/);
  assert.match(ui.content(), /Likelihood must be a whole number/);
  assert.equal(ui.all(node => node.props.role === 'alert').length, 1);
  assert.ok(ui.focusCount >= 2, 'Form heading and validation summary receive focus');
  assert.equal(dirty.at(-1), true);
  for (const field of ui.all(node => ['input', 'select', 'textarea'].includes(node.type))) {
    assert.ok(ui.all(node => node.type === 'label' && node.props.htmlFor === field.props.id).length, 'Visible label for ' + field.props.name);
  }
});

test('saving adds one risk, preserves unknown register fields and existing rows, and clears dirty state only after persistence', async () => {
  const original = { version: 1, futureConfig: { owner: 'Airport' }, items: [risk({ futureRowField: { kept: true } })] };
  const snapshot = JSON.stringify(original);
  let saved, finish;
  const dirty = [];
  const ui = harness({ value: original, onSave(value) { saved = value; return new Promise(resolve => { finish = resolve; }); }, onDirtyChange(value) { dirty.push(value); } });
  ui.click('+ Add risk');
  fillRequired(ui, '  Long lead equipment  ');
  const save = ui.submit();
  assert.equal(ui.button('Saving…').props.disabled, true);
  assert.equal(ui.button('Cancel').props.disabled, true);
  assert.equal(dirty.at(-1), true);
  assert.equal(saved.items.length, 2);
  assert.equal(saved.items[1].title, 'Long lead equipment');
  assert.equal(saved.items[1].likelihood, 4);
  assert.equal(saved.items[1].contingencyDollars, '', 'Unknown contingency must never become zero');
  assert.ok(saved.items[1].createdAt);
  assert.deepEqual(saved.futureConfig, original.futureConfig);
  assert.deepEqual(saved.items[0].futureRowField, { kept: true });
  assert.equal(JSON.stringify(original), snapshot, 'The component must not mutate supplied records');
  finish(); await save; ui.render({ value: saved });
  assert.equal(ui.all(node => node.type === 'form').length, 0);
  assert.equal(dirty.at(-1), false);
  assert.match(ui.content(), /Risk saved/);
});

test('failed saves retain drafts, block duplicate submits, and retry the same risk id without duplicate rows', async () => {
  let calls = 0, rejectSave, saved;
  const ui = harness({ onSave(next) {
    calls++; saved = next;
    ui.props.value = next; // Model an optimistic parent update before failure.
    if (calls === 1) return new Promise((_, reject) => { rejectSave = reject; });
    return Promise.resolve();
  } });
  ui.click('+ Add risk'); fillRequired(ui);
  ui.change('description', 'Supplier needs 24 weeks.');
  const first = ui.submit();
  await ui.submit();
  assert.equal(calls, 1, 'The immediate busy ref prevents two persistence calls');
  const id = saved.items[0].id;
  rejectSave(new Error('Network unavailable'));
  await first; ui.render();
  assert.match(ui.content(), /Your draft is preserved.*Network unavailable/);
  assert.equal(ui.all(node => node.props.name === 'description')[0].props.value, 'Supplier needs 24 weeks.');
  assert.equal(ui.button('Save risk').props.disabled, false);
  await ui.submit(); ui.render({ value: saved });
  assert.equal(calls, 2);
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].id, id);
  assert.equal(ui.all(node => node.type === 'form').length, 0);
});

test('editing preserves unknown row fields and original creation time', async () => {
  const original = risk({ futureDetails: { ref: 'keep-me' }, contingencyDollars: 2500 });
  let saved;
  const ui = harness({ value: { items: [original] }, onSave(next) { saved = next; } });
  ui.click('Edit risk: Utility conflict');
  ui.change('mitigation', 'Complete utility survey and trial pits.');
  ui.change('contingencyDollars', '0');
  await ui.submit(); ui.render();
  assert.equal(saved.items.length, 1);
  assert.deepEqual(saved.items[0].futureDetails, { ref: 'keep-me' });
  assert.equal(saved.items[0].createdAt, original.createdAt);
  assert.equal(saved.items[0].contingencyDollars, 0, 'An explicit zero is permitted');
  assert.notEqual(saved.items[0].updatedAt, original.updatedAt);
});

test('closing requires a resolution; reopening retains the same record and resolution', async () => {
  let saved, calls = 0;
  const ui = harness({ value: { items: [risk()] }, onSave(next) { calls++; saved = next; } });
  ui.click('Close risk: Utility conflict');
  await ui.submit(); ui.render();
  assert.equal(calls, 0);
  assert.match(ui.content(), /Enter a resolution before closing/);
  ui.change('resolution', 'Utilities verified and relocated.');
  await ui.submit(); ui.render({ value: saved });
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].status, 'closed');
  assert.match(ui.content(), /Closed risks \(1\)/);
  assert.equal(ui.all(node => node.type === 'details' && node.props.open === true).length, 0, 'Closed section starts collapsed');
  ui.click('Reopen risk: Utility conflict');
  assert.equal(ui.all(node => node.props.name === 'resolution')[0].props.value, 'Utilities verified and relocated.');
  await ui.submit(); ui.render({ value: saved });
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].id, 'existing');
  assert.equal(saved.items[0].status, 'open');
  assert.equal(saved.items[0].resolution, 'Utilities verified and relocated.');
});

test('cancel discards a local draft without calling save and unmount resets dirty state', () => {
  let calls = 0;
  const dirty = [];
  const ui = harness({ onSave() { calls++; }, onDirtyChange(value) { dirty.push(value); } });
  ui.click('+ Add risk'); fillRequired(ui); ui.click('Cancel');
  assert.equal(calls, 0);
  assert.equal(dirty.at(-1), false);
  assert.equal(ui.all(node => node.type === 'form').length, 0);
  ui.click('+ Add risk');
  assert.equal(dirty.at(-1), true);
  ui.unmount();
  assert.equal(dirty.at(-1), false);
});

test('viewers have no mutation controls and losing editor access guards active draft callbacks', async () => {
  let calls = 0;
  const ui = harness({ value: { items: [risk()] }, isEditor: false, onSave() { calls++; } });
  assert.equal(ui.all(node => node.type === 'button').length, 0);
  assert.match(ui.content(), /View only/);
  ui.render({ isEditor: true });
  ui.click('Edit risk: Utility conflict');
  ui.change('title', 'Updated conflict');
  ui.render({ isEditor: false });
  assert.equal(ui.button('Save risk').props.disabled, true);
  await ui.submit(); ui.render();
  ui.change('title', 'Unauthorized change');
  assert.equal(calls, 0);
  assert.equal(ui.all(node => node.props.name === 'title')[0].props.value, 'Updated conflict');
  assert.match(ui.content(), /editing access changed/);
});

test('invalid dates and negative cost are rejected without saving or silently clearing the draft', async () => {
  let calls = 0;
  const ui = harness({ onSave() { calls++; } });
  ui.click('+ Add risk'); fillRequired(ui);
  ui.change('reviewDate', '2026-02-30');
  ui.change('contingencyDollars', '-10');
  await ui.submit(); ui.render();
  assert.equal(calls, 0);
  assert.match(ui.content(), /valid date in YYYY-MM-DD/);
  assert.match(ui.content(), /nonnegative number/);
  assert.equal(ui.all(node => node.props.name === 'reviewDate')[0].props.value, '2026-02-30');
});

test('native date input events persist the selected review date when no change event is emitted', async () => {
  let saved;
  const ui = harness({ onSave(next) { saved = next; } });
  ui.click('+ Add risk'); fillRequired(ui);
  const dateField = ui.all(node => node.props.name === 'reviewDate')[0];
  assert.equal(typeof dateField.props.onInput, 'function');
  dateField.props.onInput({ target: { value: '2026-11-20' } });
  ui.render();
  await ui.submit(); ui.render();
  assert.equal(saved.items[0].reviewDate, '2026-11-20');
});

test('active cards sort by severity and invalid dates remain visibly invalid', () => {
  const ui = harness({ value: { items: [
    risk({ id: 'low', title: 'Low risk', likelihood: 1, impact: 2 }),
    risk({ id: 'closed', title: 'Closed high risk', likelihood: 5, impact: 5, status: 'closed', resolution: 'Done' }),
    risk({ id: 'high', title: 'High risk', likelihood: 4, impact: 5, reviewDate: '2026-02-30' }),
    risk({ id: 'unrated', title: 'Unrated risk', likelihood: '' })
  ] } });
  const cards = ui.all(node => node.type === 'article');
  assert.match(ui.content(cards[0]), /High risk/);
  assert.match(ui.content(cards[1]), /Low risk/);
  assert.match(ui.content(cards[2]), /Unrated risk/);
  assert.match(ui.content(cards[0]), /2026-02-30 \(invalid date\)/);
  assert.match(ui.content(cards[0]), /Not estimated/);
  assert.match(ui.content(), /tracking convention/);
});

test('a risk removed externally is not recreated from an old edit draft', async () => {
  let calls = 0;
  const ui = harness({ value: { items: [risk()] }, onSave() { calls++; } });
  ui.click('Edit risk: Utility conflict');
  ui.change('title', 'Retained draft');
  ui.render({ value: { items: [] } });
  await ui.submit(); ui.render();
  assert.equal(calls, 0);
  assert.match(ui.content(), /changed outside this view/);
  assert.equal(ui.all(node => node.props.name === 'title')[0].props.value, 'Retained draft');
});

test('malformed imported costs and unusual persisted ids render without invented amounts or object-key collisions', () => {
  const ui = harness({ value: { items: [
    risk({ id: 'toString', title: 'Unusual id', owner: '', contingencyDollars: true }),
    risk({ id: '__proto__', title: 'Second unusual id', mitigation: '', contingencyDollars: {} })
  ] } });
  assert.equal(ui.all(node => node.type === 'article').length, 2);
  assert.match(ui.content(), /Needs review/);
  assert.doesNotMatch(ui.content(), /\$1\.00|\$0\.00/);
  assert.match(ui.content(), /Assign an owner/);
});

test('preview shows up to three active risks and its navigation action works for viewers', () => {
  let opened = 0;
  const ui = harness({ value: { items: [
    risk({ id: 'low', title: 'Low one', likelihood: 1, impact: 1 }),
    risk({ id: 'high', title: 'High one', likelihood: 5, impact: 5 }),
    risk({ id: 'moderate', title: 'Moderate one', likelihood: 3, impact: 3 }),
    risk({ id: 'low2', title: 'Low two', likelihood: 1, impact: 2 }),
    risk({ id: 'closed', title: 'Closed one', status: 'closed', resolution: 'Done' })
  ] }, onOpen() { opened++; } }, 'RiskRegisterPreview');
  const rows = ui.all(node => node.type === 'li');
  assert.equal(rows.length, 3);
  assert.match(ui.content(rows[0]), /High one/);
  assert.doesNotMatch(ui.content(), /Closed one/);
  assert.match(ui.content(), /4 active · 1 high/);
  ui.click('Open risk register');
  assert.equal(opened, 1);
});

test('AI review runs once on open, including StrictMode effect replay and changing parent callbacks or values', async () => {
  let calls = 0, finish;
  const ui = harness({ onGenerate(options) {
    calls++; assert.equal(options.force, false);
    return new Promise(resolve => { finish = resolve; });
  } });
  assert.equal(calls, 1);
  ui.render();
  assert.match(ui.content(), /Reviewing project records and available files/);
  ui.replayEffects();
  ui.render({ value: { items: [risk()] }, onGenerate() { calls++; return {}; } });
  assert.equal(calls, 1);
  finish({ unchanged: true });
  await settleEffects(); ui.render();
  assert.match(ui.content(), /review inputs are unchanged/);
  assert.equal(calls, 1);
});

test('failed automatic AI review keeps saved risks and requires explicit retry', async () => {
  let calls = 0;
  const forces = [];
  const original = { items: [risk()] };
  const before = JSON.stringify(original);
  const ui = harness({ value: original, onGenerate(options) {
    calls++; forces.push(options.force);
    return calls === 1 ? Promise.reject(new Error('AI service unavailable')) : Promise.resolve({ added: 2, updated: 1 });
  } });
  await settleEffects(); ui.render();
  assert.match(ui.content(), /AI review could not finish.*AI service unavailable/);
  assert.match(ui.content(), /Utility conflict/);
  assert.equal(JSON.stringify(original), before);
  ui.render(); ui.replayEffects(); ui.render();
  assert.equal(calls, 1, 'Failure must not trigger automatic retries');
  await ui.click('Retry AI review'); ui.render();
  assert.equal(calls, 2);
  assert.deepEqual(forces, [false, true]);
  assert.match(ui.content(), /AI review saved\. 2 added; 1 updated/);
});

test('AI generation and risk edits are mutually exclusive, including disabled button callback guards', async () => {
  let calls = 0, finish;
  const ui = harness({ autoGenerate: false, value: { items: [risk()] }, onGenerate() {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  ui.click('Edit risk: Utility conflict');
  assert.equal(ui.button('Refresh AI risks').props.disabled, true);
  await ui.click('Refresh AI risks');
  assert.equal(calls, 0);
  ui.click('Cancel');
  const pending = ui.click('Refresh AI risks');
  assert.equal(calls, 1);
  assert.equal(ui.button('+ Add risk').props.disabled, true);
  assert.equal(ui.button('Edit risk: Utility conflict').props.disabled, true);
  ui.click('+ Add risk'); ui.click('Edit risk: Utility conflict');
  assert.equal(ui.all(node => node.type === 'form').length, 0);
  await ui.click('Reviewing…');
  assert.equal(calls, 1);
  finish({ added: 0, updated: 0 });
  await pending; ui.render();
  assert.equal(ui.button('+ Add risk').props.disabled, false);
});

test('automatic AI review waits for an existing draft to be saved or canceled', async () => {
  let calls = 0;
  const ui = harness();
  ui.click('+ Add risk'); fillRequired(ui);
  ui.render({ onGenerate() { calls++; return Promise.resolve({ unchanged: true }); } });
  assert.equal(calls, 0);
  assert.match(ui.content(), /Save or cancel your draft/);
  ui.click('Cancel');
  assert.equal(calls, 1);
  await settleEffects(); ui.render();
  assert.equal(calls, 1);
});

test('viewers never invoke AI generation and pending results are ignored after editor access is lost', async () => {
  let calls = 0, finish;
  const ui = harness({ isEditor: false, onGenerate() {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  ui.replayEffects(); ui.render();
  assert.equal(calls, 0);
  assert.equal(ui.button('Refresh AI risks'), undefined);
  ui.render({ isEditor: true }); ui.render();
  assert.equal(calls, 1);
  ui.render({ isEditor: false });
  finish({ added: 1, updated: 0 });
  await settleEffects(); ui.render();
  assert.doesNotMatch(ui.content(), /AI review saved/);
  assert.equal(ui.button('Refresh AI risks'), undefined);
});

test('canceling AI review discards late result notices without affecting a later review', async () => {
  const finishes = [];
  let cancellations = 0;
  const ui = harness({ onGenerate() { return new Promise(resolve => { finishes.push(resolve); }); }, onCancelGenerate() { cancellations++; } });
  ui.render();
  ui.click('Cancel review');
  assert.equal(cancellations, 1);
  assert.match(ui.content(), /AI review canceled/);
  assert.equal(ui.button('+ Add risk').props.disabled, false);
  const second = ui.click('Refresh AI risks');
  finishes[0]({ added: 9, updated: 9 });
  await settleEffects(); ui.render();
  assert.equal(ui.button('+ Add risk').props.disabled, true, 'Late canceled request must not unlock the current request');
  assert.doesNotMatch(ui.content(), /9 added/);
  finishes[1]({ added: 1, updated: 0 });
  await second; ui.render();
  assert.match(ui.content(), /1 added; 0 updated/);
});

test('the persistence phase shows root status and blocks cancellation until saving finishes', async () => {
  let finish, cancellations = 0;
  const ui = harness({ onGenerate() { return new Promise(resolve => { finish = resolve; }); }, onCancelGenerate() { cancellations++; } });
  ui.render({ generationStatus: 'Saving AI risks…' });
  assert.match(ui.content(), /Saving AI risks/);
  assert.equal(ui.button('Cancel review').props.disabled, true);
  ui.click('Cancel review');
  assert.equal(cancellations, 0);
  finish({ added: 1, updated: 0 });
  await settleEffects(); ui.render();
  assert.equal(ui.button('Cancel review'), undefined);
});

test('manual editing protects an AI risk while preserving all provenance and review metadata', async () => {
  const ai = { key: 'utility-conflict', generatedAt: '2026-11-16T12:00:00Z', userEdited: false, ratingReason: 'Unmapped utilities could stop work.', evidence: [{ sourceId: 'schedule', detail: 'Excavation begins next month.' }] };
  const aiReview = { generatedAt: '2026-11-16T12:00:00Z', summary: 'One risk identified.', documentsRead: [], limitations: ['No supported file contents available.'] };
  let saved;
  const ui = harness({ value: { items: [risk({ ai })], aiReview }, onSave(next) { saved = next; } });
  ui.click('Edit risk: Utility conflict');
  ui.change('owner', 'Engineering lead');
  await ui.submit(); ui.render({ value: saved });
  assert.equal(saved.items[0].ai.userEdited, true);
  assert.equal(ai.userEdited, false, 'Source provenance is not mutated');
  assert.deepEqual(saved.items[0].ai.evidence, ai.evidence);
  assert.equal(saved.items[0].ai.key, ai.key);
  assert.deepEqual(saved.aiReview, aiReview);
  assert.match(ui.content(), /Edited by project team/);
});

test('AI evidence renders as text and links only valid HTTP source URLs, never the source label', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const ui = harness({ value: { items: [risk({ ai: {
    ratingReason: malicious,
    evidence: [
      { name: malicious, detail: '<script>bad()</script>', url: 'https://example.com/verified.pdf' },
      { source: 'javascript:alert(1)', detail: 'Not a link.', url: 'javascript:alert(1)' },
      { name: 'Bad data URL', url: 'data:text/html,bad' },
      { name: 'Misleading credential URL', url: 'https://trusted.example@evil.example/file' },
      { name: 'Control character URL', url: 'https://example.com/\nfile' },
      null
    ]
  } })] } });
  assert.match(ui.content(), /AI identified/);
  assert.match(ui.content(), /Why this risk/);
  assert.ok(ui.content().includes(malicious), 'React receives the evidence as literal text');
  const links = ui.all(node => node.type === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, 'https://example.com/verified.pdf');
  assert.equal(links[0].props.rel, 'noopener noreferrer');
  assert.equal(ui.all(node => node.props.dangerouslySetInnerHTML || ['script', 'img'].includes(node.type)).length, 0);
});

test('AI review coverage reports actual files read, local review time, and limited evidence without claiming all files were read', () => {
  const ui = harness({ isEditor: false, value: { items: [], aiReview: {
    generatedAt: '2026-11-16T12:00:00Z', summary: 'No evidence-supported risks were identified in the available inputs.',
    documentsRead: [], limitations: ['The signed construction contract could not be read.']
  } } });
  assert.match(ui.content(), /Last AI review: Nov 16, 2026/);
  assert.match(ui.content(), /0 file contents read/);
  assert.match(ui.content(), /up to 3 supported file contents/);
  assert.match(ui.content(), /not confirmation that the project is risk-free/);
  assert.match(ui.content(), /construction contract could not be read/);
  assert.doesNotMatch(ui.content(), /all files (?:were )?read/i);
  assert.equal(ui.button('Refresh AI risks'), undefined);
});
