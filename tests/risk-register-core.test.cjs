const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const risk = require('../risk-register-core.js');

const today = '2026-11-16';
const row = overrides => ({ id: 'risk-a', title: 'Utility conflict', likelihood: 2, impact: 3, status: 'open', owner: 'Project manager', mitigation: 'Confirm utility survey', reviewDate: today, ...overrides });
const register = (...items) => ({ version: 1, items, updatedAt: '2026-11-16T12:00:00Z' });

test('risk matrix uses all required severity boundaries', () => {
  for (const [likelihood, impact, score, level, kind] of [[1, 1, 1, 'Low', 'green'], [1, 4, 4, 'Low', 'green'], [1, 5, 5, 'Moderate', 'amber'], [3, 3, 9, 'Moderate', 'amber'], [2, 5, 10, 'High', 'red'], [5, 5, 25, 'High', 'red']]) {
    assert.deepEqual(risk.assess({ likelihood, impact }), { score, level, kind });
  }
  assert.equal(risk.assess({ likelihood: '2', impact: '5' }).score, 10);
});

test('missing and malformed ratings never produce an invented score', () => {
  for (const value of [undefined, null, '', ' ', false, true, NaN, Infinity, -1, 0, 6, 1.5, 'high', '0x2', [], {}]) {
    assert.deepEqual(risk.assess({ likelihood: value, impact: 5 }), { score: null, level: 'Not rated', kind: 'neutral' });
    assert.equal(risk.assess({ likelihood: 5, impact: value }).score, null);
  }
  assert.equal(risk.assess(null).score, null);
});

test('closed risks do not affect active ranking, severity, or attention', () => {
  const result = risk.summarize(register(row({ id: 'closed', likelihood: 5, impact: 5, status: 'closed', resolution: 'Resolved', owner: '', mitigation: '', reviewDate: '2020-01-01' }), row({ id: 'active', likelihood: 1, impact: 2 })), today);
  assert.deepEqual(result.topRisks.map(item => item.id), ['active']);
  assert.equal(result.kind, 'green');
  assert.equal(result.attention.length, 0);
  assert.deepEqual(result.counts, { total: 2, active: 1, closed: 1, high: 0, moderate: 0, low: 1, unrated: 0, needsAttention: 0 });
  const allClosed = risk.summarize(register(row({ status: 'closed' })), today);
  assert.equal(allClosed.level, 'Not rated');
  assert.equal(allClosed.topRisks.length, 0);
});

test('top risks rank active scores, preserve ties, and include at most three', () => {
  const result = risk.summarize(register(row({ id: 'unrated', likelihood: '' }), row({ id: 'moderate' }), row({ id: 'high-a', likelihood: 5, impact: 5 }), row({ id: 'high-b', likelihood: 5, impact: 5 }), row({ id: 'low', impact: 1 })), today);
  assert.deepEqual(result.topRisks.map(item => item.id), ['high-a', 'high-b', 'moderate']);
  assert.equal(result.counts.unrated, 1);
  assert.equal(result.kind, 'red');
  const unrated = risk.summarize(register(row({ likelihood: '' })), today);
  assert.equal(unrated.kind, 'neutral');
  assert.equal(unrated.topRisks[0].id, 'risk-a');
});

test('reviews are overdue before today, with strict civil-date and leap-day validation', () => {
  const result = risk.summarize(register(row({ id: 'yesterday', reviewDate: '2026-11-15' }), row({ id: 'today' }), row({ id: 'tomorrow', reviewDate: '2026-11-17' }), row({ id: 'invalid', reviewDate: '2026-02-30' }), row({ id: 'none', reviewDate: '' })), today);
  assert.deepEqual(result.attention.map(item => item.id), ['yesterday', 'invalid', 'none']);
  assert.match(result.attention[0].reasons[0], /overdue/);
  for (const date of ['2028-02-29', '2026-11-16', '2000-02-29']) assert.deepEqual(risk.validate(row({ reviewDate: date })), []);
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '11/16/2026', '2026-11-16T00:00:00Z', '2026-1-01', true]) assert.ok(risk.validate(row({ reviewDate: date })).some(message => /Review date/.test(message)));
  assert.throws(() => risk.summarize({}, '2026-02-30'), /todayISO/);
});

test('owner and mitigation are optional for saving and separately identified for attention', () => {
  const item = row({ owner: '  ', mitigation: '' });
  assert.deepEqual(risk.validate(item), []);
  const summary = risk.summarize(register(item), today);
  assert.deepEqual(summary.attention, [{ id: 'risk-a', title: 'Utility conflict', reasons: ['Assign an owner.', 'Record a mitigation action.'] }]);
  assert.equal(summary.counts.needsAttention, 1);
});

test('missing review dates and unrated active risks require follow-up without invented severity', () => {
  const summary = risk.summarize(register(row({ id: 'no-date', reviewDate: '' }), row({ id: 'unrated', likelihood: '' }), row({ id: 'closed', status: 'closed', reviewDate: '', likelihood: '' })), today);
  assert.deepEqual(summary.attention, [
    { id: 'no-date', title: 'Utility conflict', reasons: ['Set a review date.'] },
    { id: 'unrated', title: 'Utility conflict', reasons: ['Assess likelihood and impact.'] }
  ]);
  assert.equal(summary.counts.needsAttention, 2);
  assert.equal(summary.counts.unrated, 1);
  assert.equal(summary.kind, 'amber');
  const unknown = risk.summarize(register(row({ likelihood: '', reviewDate: '' })), today);
  assert.equal(unknown.kind, 'neutral');
  assert.equal(unknown.counts.needsAttention, 1);
  assert.equal(unknown.attention[0].reasons.length, 2);
});

test('validation requires title, ratings, status, and resolution when closing', () => {
  assert.equal(risk.validate({}).length, 4);
  assert.ok(risk.validate(row({ title: ' ' })).some(message => /title/.test(message)));
  assert.ok(risk.validate(row({ status: 'invalid' })).some(message => /status/.test(message)));
  assert.ok(risk.validate(row({ status: 'closed', resolution: '' })).some(message => /resolution/.test(message)));
  assert.deepEqual(risk.validate(row({ status: 'closed', resolution: 'Utility relocated.' })), []);
  assert.deepEqual(risk.validate(row({ status: 'monitoring' })), []);
});

test('contingency keeps zero and decimals but rejects credits, booleans, and malformed amounts', () => {
  for (const value of [undefined, null, '', ' ', 0, '0', 1250.25, '1250.25']) assert.deepEqual(risk.validate(row({ contingencyDollars: value })), []);
  for (const value of [-1, '-0.01', '1,000', 'not known', NaN, Infinity, true, false, [], {}]) assert.ok(risk.validate(row({ contingencyDollars: value })).some(message => /Contingency/.test(message)));
  const normalized = risk.normalize(register(row({ contingencyDollars: '' }), row({ contingencyDollars: '0' }), row({ contingencyDollars: 'unknown' })));
  assert.deepEqual(normalized.items.map(item => item.contingencyDollars), ['', 0, 'unknown']);
});

test('malformed register containers and array entries are handled without crashing', () => {
  for (const raw of [undefined, null, false, 7, 'risk', [], {}, { items: {} }, { items: 'bad' }]) {
    assert.equal(risk.normalize(raw).items.length, 0);
    assert.equal(risk.summarize(raw, today).kind, 'neutral');
  }
  const normalized = risk.normalize({ items: [null, 'bad', [], 2, row()] });
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.version, 1);
});

test('normalization preserves unknown fields and never mutates stored metadata', () => {
  const raw = { version: 1, extra: { source: 'import' }, items: [row({ likelihood: '3', impact: '', contingencyDollars: '', customField: { link: 'doc-1' } })] };
  const before = JSON.stringify(raw);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  freeze(raw);
  const normalized = risk.normalize(raw);
  assert.equal(normalized.items[0].likelihood, 3);
  assert.equal(normalized.items[0].impact, '');
  assert.deepEqual(normalized.extra, { source: 'import' });
  assert.deepEqual(normalized.items[0].customField, { link: 'doc-1' });
  assert.notEqual(normalized.items, raw.items);
  assert.notEqual(normalized.items[0], raw.items[0]);
  risk.summarize(raw, today);
  risk.validate(raw.items[0]);
  assert.equal(JSON.stringify(raw), before);
});

test('normalization gives missing and duplicate ids stable, distinct identities', () => {
  const raw = register(row({ id: '' }), row({ id: 'risk-1' }), row({ id: 'risk-1' }), row({ id: null }));
  const first = risk.normalize(raw);
  assert.equal(new Set(first.items.map(item => item.id)).size, 4);
  assert.equal(first.items[1].id, 'risk-1');
  assert.deepEqual(risk.normalize(raw), first);
  assert.deepEqual(risk.normalize(first), first);
});

test('browser API is exported and omitted today uses local calendar date near UTC midnight', () => {
  class LocalClock extends Date {
    constructor(value) { super(value === undefined ? '2026-11-17T01:00:00Z' : value); }
    getFullYear() { return 2026; }
    getMonth() { return 10; }
    getDate() { return 16; }
  }
  const context = { window: {}, Date: LocalClock };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'risk-register-core.js'), 'utf8'), context);
  const api = context.window.JANRiskRegister;
  assert.equal(typeof api.summarize, 'function');
  assert.equal(api.summarize(register(row({ reviewDate: '2026-11-16' }))).attention.length, 0);
  assert.equal(api.summarize(register(row({ reviewDate: '2026-11-15' }))).attention.length, 1);
});
