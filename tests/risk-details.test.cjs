const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'JAN_CPT.html'), 'utf8');
const grants = html.slice(html.indexOf('const GRANT_MILESTONES ='), html.indexOf('const TUTORIAL_STEPS ='));
const helper = html.slice(html.indexOf('function buildProjectRiskExplanation('), html.indexOf('// PROJECT_RISK_DETAILS_END'));
const summary = html.slice(html.indexOf('  const execSum = useMemo('), html.indexOf('  const hardStop ='));
function explanation(patch = {}) {
  const context = {
    current: { budgetBreach: false, cumVariance: 0, scheduleBreach: false, cumDaysLost: 0, daysPerWeek: 0, weeksComplete: 2, ...patch.current },
    meta: { budgetVarianceLimit: 0.05, timeVarianceLimitPerWeek: 1, ...patch.meta },
    grant: { sections: [], safetyIncidents: 0, ...patch.grant },
    pay: { receivedCount: 1, submittedCount: 1, pendingAmount: 0, ...patch.pay },
    useMemo: fn => fn(), fmtPct: value => (value * 100).toFixed(1) + '%', fmtMoney: value => '$' + Number(value).toFixed(2)
  };
  vm.createContext(context);
  vm.runInContext(grants + '\n' + helper + '\n' + summary + '\nglobalThis.inputs={execSum,grant,meta,current,pay};', context);
  const before = JSON.stringify(context.inputs);
  const result = context.buildProjectRiskExplanation(context.inputs);
  assert.equal(JSON.stringify(context.inputs), before, 'Explaining risk must not change project records');
  const actualRisk = context.inputs.execSum.rows.find(row => row[0] === 'Risk Level');
  assert.equal(result.kind, actualRisk[1], 'Risk explanation must preserve the displayed rating');
  assert.equal(result.level, actualRisk[2]);
  return result;
}
const item = (result, label) => [...result.attention, ...result.checks].find(entry => entry.label === label);

test('the explanation uses the existing six checks and prioritizes red before amber', () => {
  const result = explanation({ current: { budgetBreach: true, cumVariance: 0.06, cumDaysLost: 2, daysPerWeek: 0.5 }, pay: { submittedCount: 0, receivedCount: 0 }, grant: { coCount: 1 } });
  assert.equal(result.level, 'High');
  assert.deepEqual(Array.from(result.attention, entry => entry.label), ['Budget', 'Schedule', 'Reimbursements', 'Change Orders']);
  assert.equal(result.attention[0].kind, 'red');
  assert.equal(result.attention.slice(1).every(entry => entry.kind === 'amber'), true);
  assert.match(result.summary, /High because Budget is red/);
  assert.equal(result.attention.length + result.checks.length, 6);
  for (const entry of [...result.attention, ...result.checks]) {
    assert.ok(entry.status && entry.reason && entry.action && entry.actionLabel);
    assert.ok(['log', 'grant', 'pay'].includes(entry.tab));
  }
});

test('an amber reimbursement check with no requests does not claim overdue money', () => {
  const result = explanation({ pay: { submittedCount: 0, receivedCount: 0, pendingAmount: 250 } });
  const reimbursement = item(result, 'Reimbursements');
  assert.equal(result.level, 'Moderate');
  assert.equal(reimbursement.kind, 'amber');
  assert.match(reimbursement.reason, /No reimbursement requests are recorded/);
  assert.match(reimbursement.reason, /does not establish that any payment is overdue/);
  assert.match(reimbursement.reason, /\$250\.00.*may include applications not yet requested/);
  assert.equal(reimbursement.tab, 'pay');
});

test('a green executed grant explains its unfinished checklist rather than claiming full compliance', () => {
  const result = explanation({ grant: { sections: [{ id: 'faa', type: 'FAA AIG', done: { 'Executed Grant Agreement': true } }] } });
  const grant = item(result, 'Grant Compliance');
  assert.equal(result.level, 'Low');
  assert.equal(grant.kind, 'green');
  assert.match(grant.reason, /1 of 35 checklist items/);
  assert.match(grant.reason, /34 checklist items remain/);
  assert.match(grant.reason, /green does not mean every grant task is finished/);
  assert.match(grant.action, /remaining checklist/);
});

test('red grant and safety indicators explain recorded conditions without implying overdue filings or incident severity', () => {
  const result = explanation({ grant: { sections: [{ id: 'faa', type: 'FAA AIG', done: {} }], safetyIncidents: 2 } });
  assert.deepEqual(Array.from(result.attention, entry => entry.label), ['Grant Compliance', 'Safety']);
  assert.match(item(result, 'Grant Compliance').reason, /does not establish that a filing is overdue/);
  assert.match(item(result, 'Safety').reason, /2 safety incident\(s\).*does not describe severity or resolution/);
  assert.equal(item(result, 'Safety').tab, 'grant');
});

test('an intentionally empty grant list remains neutral and does not raise the risk rating', () => {
  const result = explanation();
  const grant = item(result, 'Grant Compliance');
  assert.equal(result.level, 'Low');
  assert.equal(grant.kind, 'neutral');
  assert.equal(result.attention.length, 0);
  assert.match(grant.reason, /No grant sections are configured/);
  assert.match(grant.action, /Confirm whether this project has grant obligations/);
  assert.match(result.rule, /Gray indicators do not raise the rating/);
});

test('budget and delay details explain the actual logged-week thresholds', () => {
  const result = explanation({ current: { cumVariance: 0.04, scheduleBreach: true, daysPerWeek: 1.5, cumDaysLost: 3 } });
  const budget = item(result, 'Budget'), schedule = item(result, 'Schedule');
  assert.equal(budget.kind, 'amber');
  assert.match(budget.reason, /plan for logged weeks/);
  assert.match(budget.reason, /Variance is 4\.0%; amber starts above 3\.0% and the limit is 5\.0%/);
  assert.equal(schedule.kind, 'red');
  assert.match(schedule.reason, /average is 1\.5 days; the limit is 1 days/);
  assert.match(schedule.reason, /uses weeks with recorded spending/);
  assert.equal(budget.tab, 'log');
  assert.equal(schedule.tab, 'log');
});

test('green budget and schedule without weekly entries do not claim verified progress', () => {
  const result = explanation({ current: { weeksComplete: 0 } });
  assert.match(item(result, 'Budget').reason, /No weekly spending entries.*does not verify actual costs/);
  assert.match(item(result, 'Schedule').reason, /No weekly spending entries.*does not verify schedule progress/);
  assert.match(result.summary, /not proof that every project task is complete/);
});

test('reimbursement receipts remain independent recorded counts, and change orders are not assumed approved', () => {
  const result = explanation({ pay: { receivedCount: 2, submittedCount: 1 }, grant: { changeOrders: [{ number: '1', cost: '', days: '' }] } });
  const reimbursement = item(result, 'Reimbursements'), changes = item(result, 'Change Orders');
  assert.equal(reimbursement.kind, 'green');
  assert.match(reimbursement.reason, /2 reimbursement receipt records and 1 request records/);
  assert.match(reimbursement.reason, /each receipt still needs to be matched/);
  assert.equal(changes.kind, 'amber');
  assert.match(changes.reason, /1 change order record\(s\).*does not verify approval or execution/);
  assert.match(changes.reason, /\$0\.00 and 0 calendar days/);
  assert.equal(changes.tab, 'grant');
});
