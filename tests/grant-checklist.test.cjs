const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'JAN_CPT.html'), 'utf8');
const helpers = html.slice(html.indexOf('const GRANT_MILESTONES ='), html.indexOf('const TUTORIAL_STEPS ='));
const tabSource = html.slice(html.indexOf('function GrantTab('), html.indexOf('function Contracts('));
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(all)] : [];
function setup(initial, isEditor = true) {
  let grant = initial;
  const context = {
    Date, confirm: () => true, PROJECT_DOCS: ['Letter'], Field: 'Field',
    fmtMoney: value => String(value), fmtMoney2: value => String(value),
    React: { createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }) }
  };
  vm.createContext(context); vm.runInContext(helpers + '\n' + tabSource, context);
  const render = () => context.GrantTab({ grant, setGrant: next => { grant = typeof next === 'function' ? next(grant) : next; }, isEditor, execSum: { msDone: 0, msTotal: 35 }, meta: { funding: [], fundingTotal: 0, totalBudget: 0 } });
  const sections = () => context.grantSections(grant);
  const milestone = name => all(render()).find(node => node.props.className?.startsWith('ms-row') && all(node).some(child => child.props.className === 'ms-label' && child.children.includes(name)));
  return { context, render, sections, milestone, get: () => grant };
}

test('legacy flat checklist completion and dates survive the detailed FAA checklist migration', () => {
  const original = { milestones: { 'Application Submitted': true, 'Grant Executed': true }, milestoneDates: { 'Grant Executed': '2026-10-15' }, docs: { Letter: 'https://example.com/letter' } };
  const before = JSON.stringify(original);
  const env = setup(original), section = env.sections()[0];
  assert.equal(section.items.length, 35);
  assert.equal(section.items.filter(item => section.done[item]).length, 2);
  assert.equal(section.done['Executed Grant Agreement'], true);
  assert.equal(section.completionDates['Executed Grant Agreement'], '2026-10-15');
  assert.equal(JSON.stringify(original), before, 'Reading migrated state must not mutate the saved record');
});

test('unchecking a migrated milestone clears its date without the legacy date returning on rerender', () => {
  const env = setup({ milestones: { 'Grant Executed': true }, milestoneDates: { 'Grant Executed': '2026-10-15' }, docs: {} });
  const name = 'Executed Grant Agreement';
  all(env.milestone(name)).find(node => node.props.type === 'checkbox').props.onChange();
  const row = env.milestone(name);
  assert.equal(all(row).find(node => node.props.type === 'checkbox').props.checked, false);
  assert.equal(all(row).find(node => node.props.type === 'date').props.value, '');
  assert.equal(env.sections()[0].completionDates[name], '');
});

test('editing and then clearing a completion date preserves the user choice over legacy values', () => {
  const name = 'Executed Grant Agreement';
  const env = setup({ sections: [{ id: 'faa-1', type: 'FAA AIG', name: 'FAA', done: { 'Grant Executed': true }, completionDates: { 'Grant Executed': '2026-10-15' } }], docs: {} });
  all(env.milestone(name)).find(node => node.props.type === 'date').props.onChange({ target: { value: '2026-11-03' } });
  assert.equal(env.sections()[0].completionDates[name], '2026-11-03');
  assert.equal(env.sections()[0].done[name], true);
  all(env.milestone(name)).find(node => node.props.type === 'date').props.onChange({ target: { value: '' } });
  assert.equal(env.sections()[0].completionDates[name], '');
  assert.equal(env.sections()[0].done[name], false);
});

test('removing the final grant leaves no grants and adding a new one starts with a fresh checklist', () => {
  const env = setup({ milestones: { 'Grant Executed': true }, milestoneDates: { 'Grant Executed': '2026-10-15' }, docs: { Letter: 'https://example.com/letter' } });
  all(env.render()).find(node => node.tag === 'button' && node.children.includes('Remove')).props.onClick();
  assert.equal(env.get().sections.length, 0);
  assert.equal(env.sections().length, 0);
  assert.equal(all(env.render()).some(node => node.props.type === 'checkbox'), false);
  assert.equal(env.get().docs.Letter, 'https://example.com/letter');
  all(env.render()).find(node => node.tag === 'button' && node.children.includes('FAA AIP')).props.onClick();
  assert.equal(env.sections().length, 1);
  assert.equal(env.sections()[0].type, 'FAA AIP');
  assert.equal(Object.keys(env.sections()[0].done).length, 0);
  assert.equal(Object.keys(env.sections()[0].completionDates).length, 0);
});

test('projects without section data still receive the FAA default while explicit empty and MDOT lists stay distinct', () => {
  const env = setup({});
  assert.equal(env.sections()[0].items.length, 35);
  assert.equal(env.context.grantSections({ sections: [] }).length, 0);
  const mdot = { id: 'mdot', type: 'MDOT AIP-Matching', items: ['Grant Awarded', 'Quarterly Reports Submitted'], done: { 'Grant Awarded': true } };
  const section = env.context.grantSections({ sections: [mdot] })[0];
  assert.equal(section, mdot);
  assert.equal(env.context.expandItems(section.items).length, 5);
});

test('viewers cannot change grant fields or checks while saved document links remain available', () => {
  const original = { milestones: { 'Grant Executed': true }, milestoneDates: { 'Grant Executed': '2026-10-15' }, docs: { Letter: 'https://example.com/letter' } };
  const before = JSON.stringify(original), env = setup(original, false), tree = env.render();
  assert.equal(tree.tag, 'fieldset');
  assert.equal(tree.props.disabled, true);
  env.context.confirm = () => { throw Error('Viewers must not reach a delete confirmation'); };
  for (const node of all(tree)) {
    if (node.tag === 'input' && node.props.onChange) node.props.onChange({ target: { value: '2026-11-03' } });
    if (node.tag === 'button' && node.props.onClick) node.props.onClick();
  }
  assert.equal(JSON.stringify(env.get()), before, 'Handlers also reject writes if invoked directly');
  assert.ok(all(tree).some(node => node.tag === 'a' && node.props.href === original.docs.Letter && !node.props.disabled));
});

test('no configured grants produces neutral compliance and a truthful ticker rather than a phantom milestone', () => {
  const env = setup({ sections: [] });
  const context = env.context;
  Object.assign(context, { useMemo: fn => fn(), grant: { sections: [] }, current: { cumVariance: 0, cumDaysLost: 0, weeksComplete: 0 }, meta: { budgetVarianceLimit: 0.1 }, pay: { receivedCount: 0, submittedCount: 0 }, rows: [], cal: { nWeeks: 1 }, fmtPct: String });
  const summary = html.slice(html.indexOf('  const execSum = useMemo('), html.indexOf('  const hardStop ='));
  const ticker = html.slice(html.indexOf('  const tickerItems = useMemo('), html.indexOf('  return /*#__PURE__*/React.createElement("div", {', html.indexOf('  const tickerItems = useMemo(')));
  vm.runInContext(summary + '\n' + ticker + '\nglobalThis.result={execSum,tickerItems};', context);
  assert.equal(context.result.execSum.msDone, 0);
  assert.equal(context.result.execSum.msTotal, 0);
  assert.deepEqual(Array.from(context.result.execSum.rows.find(row => row[0] === 'Grant Compliance')), ['Grant Compliance', 'neutral', 'No grants configured']);
  assert.ok(context.result.tickerItems.includes('Grant — No grants configured'));
  assert.equal(context.result.execSum.rows.find(row => row[0] === 'Risk Level')[1], 'amber', 'An absent grant does not introduce red overall risk');
});

test('AI grant evidence matches migration and intentionally empty checklist behavior', async () => {
  const { grantSections, projectEvidence } = await import('../supabase/functions/assistant/context.mjs');
  const legacy = { milestones: { 'Grant Executed': true }, milestoneDates: { 'Grant Executed': '2026-10-15' } };
  assert.equal(grantSections(legacy)[0].done['Executed Grant Agreement'], true);
  assert.equal(grantSections(legacy)[0].completionDates['Executed Grant Agreement'], '2026-10-15');
  const cleared = { sections: [{ type: 'FAA AIG', done: { 'Grant Executed': true, 'Executed Grant Agreement': false }, completionDates: { 'Grant Executed': '2026-10-15', 'Executed Grant Agreement': '' } }] };
  assert.equal(grantSections(cleared)[0].completionDates['Executed Grant Agreement'], '');
  const facts = projectEvidence({ id: 'p', grant_info: { sections: [] } }, [], [], [], []);
  assert.equal(facts.grantSections.length, 0);
  assert.ok(facts.warnings.some(warning => warning.startsWith('No grants configured')));
  assert.equal(facts.warnings.some(warning => warning.includes('default checklist')), false);
});
