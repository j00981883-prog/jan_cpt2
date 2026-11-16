(function (root) {
  'use strict';

  function h(type, props) {
    return root.React.createElement.apply(root.React, arguments);
  }
  function uid() {
    return root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() :
      'risk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function text(value) { return value == null ? '' : String(value); }
  function dateLabel(value) {
    if (!value) return 'Not scheduled';
    var raw = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw + ' (invalid date)';
    var parsed = new Date(raw + 'T12:00:00Z');
    return isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? raw + ' (invalid date)' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function money(value) {
    if (value === '' || value == null) return 'Not estimated';
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : 'Needs review';
  }
  function StatusBadge(props) {
    var assessment = root.JANRiskRegister.assess(props.item);
    return h('span', { className: 'rr-badge rr-badge-' + assessment.kind },
      assessment.level, assessment.score == null ? '' : ' · ' + assessment.score + '/25');
  }
  function Metric(props) {
    return h('div', { className: 'rr-metric' }, h('strong', null, props.value), h('span', null, props.label));
  }
  function Methodology() {
    return h('details', { className: 'rr-methodology' },
      h('summary', null, 'How risks are rated'),
      h('div', { className: 'rr-methodology-body' },
        h('p', null, 'Score = likelihood × impact. Rate each from 1 (lowest) to 5 (highest), considering the risk before mitigation.'),
        h('div', { className: 'rr-rating-key' },
          h('span', { className: 'rr-badge rr-badge-green' }, 'Low · 1–4'),
          h('span', { className: 'rr-badge rr-badge-amber' }, 'Moderate · 5–9'),
          h('span', { className: 'rr-badge rr-badge-red' }, 'High · 10–25')),
        h('p', { className: 'rr-muted' }, 'These thresholds are a tracking convention for this register; they are not an approved organizational risk policy. Closed risks remain in the register and are excluded from active totals.')));
  }
  function RiskCard(props) {
    var item = props.item;
    var assessment = root.JANRiskRegister.assess(item);
    var closed = item.status === 'closed';
    var status = closed ? 'Closed' : item.status === 'monitoring' ? 'Monitoring' : item.status === 'open' ? 'Open' : 'Status needs review';
    return h('article', { className: 'rr-risk rr-risk-' + (closed ? 'closed' : assessment.kind) },
      h('div', { className: 'rr-risk-heading' },
        h('div', { className: 'rr-risk-title' },
          h('span', { className: 'rr-status' }, status),
          h('h3', null, item.title || 'Untitled risk')),
        h(StatusBadge, { item: item })),
      item.description ? h('p', { className: 'rr-copy' }, item.description) : null,
      h('dl', { className: 'rr-facts' },
        h('div', null, h('dt', null, 'Rating'), h('dd', null, assessment.score == null ? 'Not rated' : item.likelihood + ' likelihood × ' + item.impact + ' impact')),
        h('div', null, h('dt', null, 'Owner'), h('dd', null, item.owner || 'Unassigned')),
        h('div', null, h('dt', null, 'Review date'), h('dd', null, dateLabel(item.reviewDate))),
        h('div', null, h('dt', null, 'Contingency estimate'), h('dd', null, money(item.contingencyDollars)))),
      h('div', { className: 'rr-mitigation' }, h('strong', null, 'Mitigation'),
        h('p', null, item.mitigation || 'No mitigation recorded.')),
      item.resolution ? h('div', { className: 'rr-resolution' }, h('strong', null, closed ? 'Resolution' : 'Previous resolution / notes'), h('p', null, item.resolution)) : null,
      props.attention && props.attention.length ? h('p', { className: 'rr-attention' },
        h('strong', null, 'Needs attention: '), props.attention.join(' · ')) : null,
      h('div', { className: 'rr-risk-footer' },
        h('span', { className: 'rr-muted' }, item.updatedAt ? 'Updated ' + dateLabel(text(item.updatedAt).slice(0, 10)) : 'Update date not recorded'),
        props.isEditor ? h('div', { className: 'rr-actions' },
          h('button', { type: 'button', className: 'rr-button rr-button-quiet', disabled: props.disabled, onClick: function () { props.onEdit(item, 'edit'); }, 'aria-label': 'Edit risk: ' + item.title }, 'Edit'),
          h('button', { type: 'button', className: 'rr-button rr-button-secondary', disabled: props.disabled, onClick: function () { props.onEdit(item, closed ? 'reopen' : 'close'); }, 'aria-label': (closed ? 'Reopen risk: ' : 'Close risk: ') + item.title }, closed ? 'Reopen' : 'Close risk')) : null));
  }

  function RiskRegister(props) {
    var R = root.React;
    var core = root.JANRiskRegister;
    var summary = core.summarize(props.value);
    var state = R.useState(null), draft = state[0], setDraft = state[1];
    var errorsState = R.useState([]), errors = errorsState[0], setErrors = errorsState[1];
    var savingState = R.useState(false), saving = savingState[0], setSaving = savingState[1];
    var noticeState = R.useState(''), notice = noticeState[0], setNotice = noticeState[1];
    var busy = R.useRef(false);
    var prefix = R.useRef('rr-' + uid());
    var formHeading = R.useRef(null);
    var errorsRef = R.useRef(null);
    var dirtyCallback = R.useRef(props.onDirtyChange);
    dirtyCallback.current = props.onDirtyChange;
    R.useEffect(function () {
      return function () { if (typeof dirtyCallback.current === 'function') dirtyCallback.current(false); };
    }, []);
    R.useEffect(function () {
      if (draft && formHeading.current) formHeading.current.focus();
    }, [draft && draft.key]);
    R.useEffect(function () {
      if (errors.length && errorsRef.current) errorsRef.current.focus();
    }, [errors]);
    function setSession(next) {
      setDraft(next);
      if (typeof dirtyCallback.current === 'function') dirtyCallback.current(!!(next && next.dirty));
    }
    function begin(item, mode) {
      if (!props.isEditor || busy.current || draft) return;
      var next = item ? Object.assign({}, item) : {
        id: uid(), title: '', description: '', likelihood: '', impact: '', owner: '', mitigation: '',
        contingencyDollars: '', reviewDate: '', status: 'open', resolution: '', createdAt: '', updatedAt: ''
      };
      if (mode === 'close') next.status = 'closed';
      if (mode === 'reopen') next.status = 'open';
      setSession({ key: uid(), item: next, originalId: item ? item.id : null, mode: mode, dirty: !item || mode !== 'edit' });
      setErrors([]);
      setNotice('');
    }
    function change(field, value) {
      if (!props.isEditor || busy.current || !draft) return;
      setSession(Object.assign({}, draft, { item: Object.assign({}, draft.item, { [field]: value }), dirty: true }));
    }
    function cancel() {
      if (busy.current) return;
      setSession(null);
      setErrors([]);
      setNotice('Changes canceled.');
    }
    async function submit(event) {
      if (event && event.preventDefault) event.preventDefault();
      if (!props.isEditor || busy.current || !draft) return;
      var validation = core.validate(draft.item);
      if (validation.length) { setErrors(validation); return; }
      if (typeof props.onSave !== 'function') { setErrors(['Saving is unavailable. Your draft is still here; try again when the project is connected.']); return; }
      var current = core.normalize(props.value);
      // Reuse the draft id on retry, including when a parent published an
      // optimistic value before the persistence request failed.
      var targetId = draft.originalId || draft.item.id;
      var currentItem = current.items.find(function (risk) { return risk.id === targetId; });
      if (draft.originalId && !currentItem) { setErrors(['This risk has changed outside this view. Your draft is still here. Reload the project before retrying.']); return; }
      var now = new Date().toISOString();
      var item = Object.assign({}, currentItem || {}, draft.item, {
        title: text(draft.item.title).trim(),
        likelihood: Number(draft.item.likelihood), impact: Number(draft.item.impact),
        contingencyDollars: text(draft.item.contingencyDollars).trim() === '' ? '' : Number(draft.item.contingencyDollars),
        createdAt: (currentItem && currentItem.createdAt) || draft.item.createdAt || now,
        updatedAt: now
      });
      var items = currentItem ? current.items.map(function (risk) { return risk.id === targetId ? item : risk; }) : current.items.concat([item]);
      var next = Object.assign({}, current, { items: items, updatedAt: now });
      busy.current = true;
      setSaving(true);
      setErrors([]);
      try {
        var result = await props.onSave(next);
        if (result === false) throw new Error('The save was not confirmed.');
        setSession(null);
        setNotice(item.status === 'closed' ? 'Risk closed and saved. Its record is retained below.' : draft.mode === 'reopen' ? 'Risk reopened and saved.' : 'Risk saved.');
      } catch (error) {
        setErrors(['Could not save this risk. Your draft is preserved. ' + (error && error.message ? error.message : 'Check your connection and try again.')]);
      } finally {
        busy.current = false;
        setSaving(false);
      }
    }
    function field(name, label, type, options) {
      options = options || {};
      var id = prefix.current + '-' + name;
      var hintId = id + '-hint';
      var common = {
        id: id, name: name, value: text(draft.item[name]), required: !!options.required,
        onChange: function (event) { change(name, event.target.value); },
        'aria-describedby': options.hint ? hintId : undefined
      };
      // Date pickers may emit native input before React receives a change
      // event. Capture that value immediately so Save includes the selection.
      if (type === 'date') common.onInput = function (event) { change(name, event.target.value); };
      var control;
      if (type === 'textarea') control = h('textarea', Object.assign({}, common, { rows: options.rows || 3 }));
      else if (type === 'select') control = h('select', common, options.options.map(function (option) {
        return h('option', { key: option.value, value: option.value }, option.label);
      }));
      else control = h('input', Object.assign({}, common, { type: type || 'text', min: options.min, step: options.step, inputMode: options.inputMode }));
      return h('div', { className: 'rr-field' + (options.wide ? ' rr-field-wide' : '') },
        h('label', { htmlFor: id }, label, options.required ? h('span', { className: 'rr-required' }, ' (required)') : null),
        control,
        options.hint ? h('span', { className: 'rr-hint', id: hintId }, options.hint) : null);
    }
    var ratingOptions = [{ value: '', label: 'Select a rating' }, { value: '1', label: '1 — Lowest' }, { value: '2', label: '2 — Low' }, { value: '3', label: '3 — Medium' }, { value: '4', label: '4 — High' }, { value: '5', label: '5 — Highest' }];
    var attentionById = Object.create(null);
    summary.attention.forEach(function (entry) { attentionById[entry.id] = entry.reasons; });
    var activeBySeverity = summary.active.slice().sort(function (a, b) {
      var scoreA = core.assess(a).score, scoreB = core.assess(b).score;
      return (scoreB == null ? -1 : scoreB) - (scoreA == null ? -1 : scoreA);
    });
    var externalStatus = typeof props.saveStatus === 'string' ? props.saveStatus : props.saveStatus && props.saveStatus.message;
    var editTitle = draft && (draft.mode === 'add' ? 'Add a risk' : draft.mode === 'close' ? 'Close risk' : draft.mode === 'reopen' ? 'Reopen risk' : 'Edit risk');
    return h('section', { className: 'rr-register', 'aria-label': 'Project risk register' },
      h('div', { className: 'rr-header' },
        h('div', null,
          h('p', { className: 'rr-eyebrow' }, props.projectTitle || 'Project controls'),
          h('h2', null, 'Risk register'),
          h('p', { className: 'rr-muted' }, 'Track what could affect delivery, who owns the response, and when to review it.')),
        props.isEditor ? h('button', { className: 'rr-button rr-button-primary', type: 'button', disabled: !!draft || saving, onClick: function () { begin(null, 'add'); } }, '+ Add risk') : h('span', { className: 'rr-viewer' }, 'View only')),
      h('div', { className: 'rr-metrics', 'aria-label': 'Risk totals' },
        h(Metric, { value: summary.counts.active, label: 'Active risks' }),
        h(Metric, { value: summary.counts.high, label: 'High priority' }),
        h(Metric, { value: summary.counts.needsAttention, label: 'Need attention' }),
        h(Metric, { value: summary.counts.closed, label: 'Closed risks' })),
      h(Methodology),
      h('div', { className: 'rr-live', role: 'status', 'aria-live': 'polite' }, saving ? 'Saving risk…' : notice || externalStatus || ''),
      draft ? h('form', { className: 'rr-form', onSubmit: submit, noValidate: true, 'aria-labelledby': prefix.current + '-form-title', 'aria-busy': saving },
        h('div', { className: 'rr-form-heading' },
          h('h3', { id: prefix.current + '-form-title', ref: formHeading, tabIndex: -1 }, editTitle),
          h('span', { className: 'rr-muted' }, 'Changes are saved only when you select Save risk.')),
        !props.isEditor ? h('p', { className: 'rr-attention' }, 'Your editing access changed. This draft is retained, but it cannot be saved with view-only access.') : null,
        errors.length ? h('div', { className: 'rr-error', role: 'alert', tabIndex: -1, ref: errorsRef },
          h('strong', null, 'Please review before saving'),
          h('ul', null, errors.map(function (error, i) { return h('li', { key: i }, error); }))) : null,
        h('fieldset', { disabled: saving || !props.isEditor, className: 'rr-fieldset' },
          h('legend', { className: 'rr-sr-only' }, 'Risk details'),
          h('div', { className: 'rr-form-grid' },
            field('title', 'Risk title', 'text', { required: true, wide: true, hint: 'Describe the uncertain event and its likely effect.' }),
            field('description', 'Description', 'textarea', { wide: true }),
            field('likelihood', 'Likelihood', 'select', { required: true, options: ratingOptions, hint: '1 = least likely; 5 = most likely.' }),
            field('impact', 'Impact', 'select', { required: true, options: ratingOptions, hint: '1 = lowest effect; 5 = highest effect on delivery.' }),
            h('div', { className: 'rr-field-wide rr-score-preview' }, h('span', null, 'Risk score'), h(StatusBadge, { item: draft.item })),
            field('owner', 'Risk owner', 'text', { hint: !text(draft.item.owner).trim() ? 'Needs attention: assign someone to manage the response.' : 'Person accountable for managing this risk.' }),
            field('reviewDate', 'Next review date', 'date'),
            field('mitigation', 'Mitigation / response', 'textarea', { wide: true, hint: !text(draft.item.mitigation).trim() ? 'Needs attention: record the actions that will reduce the risk.' : 'Actions to reduce likelihood or impact.' }),
            field('contingencyDollars', 'Contingency estimate ($)', 'number', { min: '0', step: 'any', inputMode: 'decimal', hint: 'Optional. Leave blank if unknown. This does not change the project budget.' }),
            field('status', 'Status', 'select', { required: true, options: [{ value: '', label: 'Select a status' }, { value: 'open', label: 'Open' }, { value: 'monitoring', label: 'Monitoring' }, { value: 'closed', label: 'Closed' }] }),
            field('resolution', draft.item.status === 'closed' ? 'Resolution' : 'Resolution / history notes', 'textarea', { wide: true, required: draft.item.status === 'closed', hint: draft.item.status === 'closed' ? 'Explain why this risk is closed. Its record will remain available.' : 'Previous resolution notes are retained when a risk is reopened.' }))),
        h('div', { className: 'rr-form-actions' },
          h('button', { className: 'rr-button rr-button-primary', type: 'submit', disabled: saving || !props.isEditor }, saving ? 'Saving…' : 'Save risk'),
          h('button', { className: 'rr-button rr-button-secondary', type: 'button', disabled: saving, onClick: cancel }, 'Cancel')),
        h('p', { className: 'rr-hint' }, 'Closing a risk preserves its information. Risks cannot be deleted from this register.')) : null,
      h('div', { className: 'rr-section-heading' }, h('h3', null, 'Active risks'), h('span', { className: 'rr-muted' }, 'Highest score first')),
      activeBySeverity.length ? h('div', { className: 'rr-risk-list' }, activeBySeverity.map(function (item) {
        return h(RiskCard, { key: item.id, item: item, attention: attentionById[item.id], isEditor: props.isEditor, disabled: !!draft || saving, onEdit: begin });
      })) : h('div', { className: 'rr-empty' },
        h('strong', null, summary.closed.length ? 'No active risks.' : 'No risks recorded yet.'),
        h('p', null, summary.closed.length ? 'Closed risks are retained below. Add a new risk as conditions change.' : props.isEditor ? 'Use Add risk to record a delivery concern, rate its likelihood and impact, and name an owner.' : 'An editor can add project risks, response actions, and review dates here.')),
      summary.closed.length ? h('details', { className: 'rr-closed' },
        h('summary', null, 'Closed risks (' + summary.closed.length + ')'),
        h('p', { className: 'rr-muted' }, 'Retained for reference. Reopening a risk brings it back into active totals.'),
        h('div', { className: 'rr-risk-list' }, summary.closed.map(function (item) {
          return h(RiskCard, { key: item.id, item: item, isEditor: props.isEditor, disabled: !!draft || saving, onEdit: begin });
        }))) : null);
  }

  function RiskRegisterPreview(props) {
    var summary = root.JANRiskRegister.summarize(props.value);
    return h('section', { className: 'rr-preview', 'aria-label': 'Risk register overview' },
      h('div', { className: 'rr-preview-header' },
        h('div', null, h('p', { className: 'rr-eyebrow' }, 'Delivery oversight'), h('h3', null, 'Project risks')),
        h('span', { className: 'rr-badge rr-badge-' + summary.kind }, summary.counts.active ? summary.level : 'No active risks')),
      h('p', { className: 'rr-preview-counts' },
        h('strong', null, summary.counts.active), ' active · ', h('strong', null, summary.counts.high), ' high · ', h('strong', null, summary.counts.needsAttention), ' need attention'),
      summary.topRisks.length ? h('ol', { className: 'rr-preview-list' }, summary.topRisks.map(function (item) {
        return h('li', { key: item.id }, h('div', null, h('strong', null, item.title || 'Untitled risk'), h('span', { className: 'rr-muted' }, item.owner || 'Owner unassigned')), h(StatusBadge, { item: item }));
      })) : h('p', { className: 'rr-preview-empty' }, summary.closed.length ? 'All recorded risks are closed. Review the register as project conditions change.' : 'No risks recorded yet. Open the register to capture concerns, owners, and response actions.'),
      h('button', { type: 'button', className: 'rr-button rr-button-secondary', disabled: typeof props.onOpen !== 'function', onClick: function () { if (typeof props.onOpen === 'function') props.onOpen(); } }, 'Open risk register'));
  }

  root.JANRiskRegisterUI = { RiskRegister: RiskRegister, RiskRegisterPreview: RiskRegisterPreview };
})(typeof window !== 'undefined' ? window : globalThis);
