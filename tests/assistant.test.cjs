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
  assert.match(s.calls[1].question, /update the budget/);
  assert.match(s.calls[1].question, /What amount/);
  assert.match(s.calls[1].question, /23 dollars/);
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
test('fresh chat clears a pending proposal and conversation', async () => {
  const s = setup(); await s.send('set construction budget to 23');
  s.button(s.render(), 'New chat').props.onClick();
  await s.send('yes');
  assert.equal(s.applied.length, 0);
  assert.doesNotMatch(s.calls[0].question, /set construction budget to 23/);
});
