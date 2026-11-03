const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'JAN_CPT.html'), 'utf8');
const source = html.slice(html.indexOf('const FIELD_LABEL ='), html.indexOf('//  FIELD SETUP'));
const grants = html.slice(html.indexOf('const GRANT_MILESTONES ='), html.indexOf('const TUTORIAL_STEPS ='));
const sample = () => ({ meta: { title: 'Runway FY26', primeBudget: 100, engineeringBudget: 20, totalBudget: 120 }, sched: { days: 30 }, grant: {}, payApps: [{ number: 1, workCompleted: 50 }], actuals: {} });
function setup() {
  let slots = [], cursor = 0;
  const calls = [], applied = [];
  const context = { console, Date, Set, Map, setTimeout: fn => { fn(); }, window: {},
    requestWithTimeout: async p => p,
    useEffect: () => {},
    useState: init => { const i = cursor++; if (!(i in slots)) slots[i] = init; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    sb: { functions: { invoke: async (name, payload) => { calls.push(payload.body); return { data: { answer: JSON.stringify({ summary: 'What amount?', changes: [] }) } }; } } },
    React: { createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }),
      useRef: init => { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; } }
  };
  vm.createContext(context);
  vm.runInContext(grants + '\n' + source, context);
  const bridge = { projectId: 'p1', projectTitle: 'Runway FY26', snapshot: sample(), apply: changes => { applied.push(changes); return ['Saved change to open project']; } };
  context.window.JMAA_APPLY = bridge;
  function render(editor = true) { cursor = 0; return context.Assistant({ isEditor: editor }); }
  function all(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(all); return [node, ...node.children.flatMap(all)]; }
  const button = (tree, text) => all(tree).find(n => n.tag === 'button' && n.children.includes(text));
  render().props.onClick();
  async function send(text, editor = true) {
    all(render(editor)).find(n => n.tag === 'input' && n.props.value !== undefined).props.onChange({ target: { value: text } });
    await button(render(editor), 'Send').props.onClick();
    return render(editor);
  }
  return { context, bridge, calls, applied, send, render, all, button };
}
test('all application scripts have valid syntax', () => {
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});
test('plain language money command produces exact amount, not contractor name', () => {
  const { context: c } = setup();
  const p = c.directEditPlan('change prime contractor amount to 23 dollars');
  assert.equal(p.changes[0].field, 'primeBudget');
  assert.equal(p.changes[0].value, 23);
  assert.equal(c.directEditPlan('change construction budget to $23 and delete pay app 1'), null);
  assert.equal(c.directEditPlan('change construction budget to 23 for project ABC'), null);
});
test('invalid numbers, impossible dates and unsupported fields reject the entire proposal', () => {
  const { context: c } = setup();
  for (const change of [
    { type: 'meta', field: 'primeBudget', value: 'abc' },
    { type: 'meta', field: 'primeBudget', value: -1 },
    { type: 'meta', field: 'primeBudget', value: true },
    { type: 'meta', field: '__proto__', value: 'x' },
    { type: 'sched', field: 'startISO', value: '2026-02-30' },
    { type: 'payapp', number: 1, paid: true },
    { type: 'payapp', number: 1, retainagePct: 5 },
    { type: 'milestone', name: 'invented', done: true },
    { type: 'week', week: -2, spend: 1 },
    { type: 'week', week: 2, action: 'delete' }
  ]) assert.throws(() => c.validateAIChanges([change], sample()));
  assert.equal(c.validateAIChanges([{ type: 'sched', field: 'startISO', value: '2028-02-29' }], sample())[0].value, '2028-02-29');
});
test('milestones resolve to an exact section and ambiguous sections are rejected', () => {
  const { context: c } = setup();
  const name = c.grantSections({})[0].items[0];
  assert.equal(c.validateAIChanges([{ type: 'milestone', name, done: true }], sample())[0].sectionId, 'faa-1');
  const s = sample(); s.grant.sections = [{ id: 'a', items: [name] }, { id: 'b', items: [name] }];
  assert.throws(() => c.validateAIChanges([{ type: 'milestone', name, done: true }], s));
});
test('proposal waits for confirmation and shows old and new values', async () => {
  const s = setup(); const tree = await s.send('change prime contractor amount to 23 dollars');
  assert.equal(s.applied.length, 0);
  assert.ok(s.all(tree).some(n => n.tag === 'li' && n.children[0].includes('$100 → $23')));
  await s.send('yes'); assert.equal(s.applied.length, 1);
  assert.equal(s.applied[0][0].value, 23);
});
test('project navigation and changed values invalidate approval', async () => {
  const s = setup(); await s.send('set construction budget to 23');
  s.context.window.JMAA_APPLY = { ...s.bridge, projectId: 'p2' };
  await s.send('yes'); assert.equal(s.applied.length, 0);
  s.context.window.JMAA_APPLY = s.bridge; s.bridge.snapshot.meta.primeBudget = 200;
  await s.send('yes'); assert.equal(s.applied.length, 0);
});
test('follow-up carries prior question and clarification to AI in update mode', async () => {
  const s = setup(); await s.send('update the budget'); await s.send('23 dollars');
  assert.equal(s.calls[1].mode, 'update');
  assert.equal(s.calls[1].question, '23 dollars');
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[1].history)), [
    { role: 'user', content: 'update the budget' },
    { role: 'assistant', content: 'What amount?' }
  ]);
  assert.equal(s.calls[1].targetProject.id, 'p1');
  assert.equal(s.calls[1].projectContext, undefined);
  assert.equal(s.calls[1].editorCapabilities, undefined);
});

test('polite editing requests propose changes while how-to and hypothetical questions remain read-only', async () => {
  for (const question of ['Can you change the project manager to Joyce?', 'Could you please update the budget?', "I'd like you to set the start date to tomorrow."]) {
    const s = setup(); await s.send(question);
    assert.equal(s.calls[0].mode, 'update');
    assert.equal(s.applied.length, 0);
  }
  for (const question of ['How do I change the budget?', 'What would happen if I delete a pay application?']) {
    const s = setup(); await s.send(question);
    assert.equal(s.calls[0].mode, 'ask');
    assert.equal(s.applied.length, 0);
  }
  const viewer = setup(); await viewer.send('Could you update the budget?', false);
  assert.equal(viewer.calls[0].mode, 'ask');
});

test('a new question leaves an edit clarification without turning the question into an edit', async () => {
  for (const question of ['What grants need attention?', 'Tell me about this project', 'Could you explain the budget?', 'Would you please review the grant milestones?', 'Will you summarize the risks?']) {
    const s = setup(); await s.send('update the budget');
    await s.send(question);
    assert.equal(s.calls[1].mode, 'ask');
    await s.send('Tell me more');
    assert.equal(s.calls[2].mode, 'ask');
  }
});

test('change previews use readable record names, currency, percentages and dates', () => {
  const { context: c } = setup();
  const preview = c.aiPreview({ type: 'payapp', number: 1, workCompleted: 1250.5, retainagePct: 0.05, periodEnd: '2026-11-03' }, sample());
  assert.match(preview, /Pay application 1: Work completed: \$50/);
  assert.match(preview, /Work completed: \$1,250.50/);
  assert.match(preview, /Retainage: 5.00%/);
  assert.match(preview, /Period ending: 11\/03\/2026/);
  assert.doesNotMatch(preview, /payapp|workCompleted|retainagePct|periodEnd/);
  assert.throws(() => c.validateAIChanges([{ type: 'payapp', number: 1, workCompleted: -1 }], sample()), /Work completed cannot be negative/);
});

test('edit starter prompts fill the composer without requesting or applying sample changes', () => {
  const s = setup(); s.button(s.render(), 'Update data').props.onClick();
  s.button(s.render(), 'Change a budget').props.onClick();
  const input = s.all(s.render()).find(n => n.tag === 'input' && n.props.value !== undefined);
  assert.equal(input.props.value, 'Change the construction budget to ');
  assert.equal(s.calls.length, 0);
  assert.equal(s.applied.length, 0);
});
test('cancel and revoked editor access cannot apply proposals', async () => {
  const s = setup(); await s.send('set construction budget to 23'); await s.send('cancel'); await s.send('yes');
  assert.equal(s.applied.length, 0);
  await s.send('set construction budget to 23'); await s.send('yes', false);
  assert.equal(s.applied.length, 0);
});
test('real bridge updates displayed grant sections and completion date', () => {
  const s = setup(), c = s.context, state = sample();
  Object.assign(c, state, { isEditor: true, projectId: 'p1', DEFAULT_RETAINAGE: 0.05 });
  for (const [key, setter] of Object.entries({ meta: 'setMeta', sched: 'setSched', grant: 'setGrant', actuals: 'setActuals', payApps: 'setPayApps' })) c[setter] = fn => { c[key] = fn(c[key]); };
  c.useEffect = fn => fn();
  const start = html.indexOf('  // Bridge for the AI assistant:');
  vm.runInContext(html.slice(start, html.indexOf('  const closeTutorial', start)), c);
  const name = c.grantSections({})[0].items[0];
  c.window.JMAA_APPLY.apply([{ type: 'milestone', name, done: true, date: '2026-10-12' }]);
  assert.equal(c.grant.sections[0].done[name], true);
  assert.equal(c.grant.sections[0].completionDates[name], '2026-10-12');
});
test('budget preview includes recalculated total and detects changed engineering budget', async () => {
  const s = setup(); const tree = await s.send('set construction budget to 23');
  assert.ok(s.all(tree).some(n => n.tag === 'li' && n.children[0].includes('$120 → $43')));
  s.bridge.snapshot.meta.engineeringBudget = 500;
  await s.send('yes'); assert.equal(s.applied.length, 0);
});
test('failed AI service request unlocks the form for retry', async () => {
  const s = setup();
  s.context.sb.functions.invoke = async () => { throw new Error('Request timed out'); };
  await s.send('review project risks');
  assert.equal(s.button(s.render(), 'Send').props.disabled, true); // Empty input, not busy.
  await s.send('set construction budget to 23');
  await s.send('yes'); assert.equal(s.applied.length, 1);
});

test('retry resends the failed question but cannot retarget a different project', async () => {
  const s = setup(); let failures = 0;
  s.context.sb.functions.invoke = async (_name, payload) => { failures++; s.calls.push(payload.body); throw new Error('Request timed out'); };
  await s.send('review project risks');
  assert.ok(s.all(s.render()).some(n => n.children.some(child => typeof child === 'string' && child.includes('That took longer than expected'))));
  await s.button(s.render(), 'Try again').props.onClick();
  assert.equal(failures, 2);
  assert.equal(s.calls[1].question, 'review project risks');
  assert.ok(s.calls[1].history.every(turn => !turn.content.includes('That took longer')));
  s.context.window.JMAA_APPLY = { ...s.bridge, projectId: 'p2' };
  const retry = s.button(s.render(), 'Try again');
  assert.equal(retry.props.disabled, true);
  await retry.props.onClick();
  assert.equal(failures, 2);
  assert.equal(s.applied.length, 0);
});

test('retrying an old yes never approves a newer proposal', async () => {
  const s = setup();
  s.context.sb.functions.invoke = async () => { throw new Error('Request timed out'); };
  await s.send('yes');
  await s.send('set construction budget to 23');
  assert.ok(s.button(s.render(), 'Apply change'));
  assert.equal(s.applied.length, 0);
  await s.button(s.render(), 'Try again').props.onClick();
  assert.equal(s.applied.length, 0);
  assert.equal(s.button(s.render(), 'Apply change'), undefined);
});
test('fresh chat clears a pending proposal and conversation', async () => {
  const s = setup(); await s.send('set construction budget to 23');
  s.button(s.render(), 'New chat').props.onClick();
  await s.send('yes');
  assert.equal(s.applied.length, 0);
  assert.doesNotMatch(s.calls[0].question, /set construction budget to 23/);
  assert.equal(s.calls[0].history.length, 0);
});
