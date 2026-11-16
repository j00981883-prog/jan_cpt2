(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.JANRiskRegister = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const STATUSES = ["open", "monitoring", "closed"];
  const TEXT_FIELDS = ["title", "description", "owner", "mitigation", "reviewDate", "status", "resolution", "createdAt", "updatedAt"];
  const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = value => typeof value === "string" ? value : value == null ? "" : String(value);
  const hasText = value => typeof value === "string" && value.trim().length > 0;
  const isEmpty = value => value == null || typeof value === "string" && value.trim() === "";

  // Do not coerce booleans, blanks, or malformed values into a rating or a cost.
  // Retaining invalid nonempty values lets validation explain what needs repair.
  function numeric(value) {
    if (isEmpty(value)) return "";
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return value;
  }

  function rating(value) {
    const parsed = numeric(value);
    return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
  }

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function localToday() {
    const now = new Date();
    return String(now.getFullYear()).padStart(4, "0") + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function normalize(raw) {
    const source = isRecord(raw) ? raw : {};
    const rows = Array.isArray(source.items) ? source.items.filter(isRecord) : [];
    // Reserve all persisted ids before creating fallbacks so a missing id cannot
    // take the identity of a later row. Duplicate persisted ids also need repair.
    const reserved = new Set(rows.map(row => text(row.id)).filter(hasText));
    const used = new Set();
    const items = rows.map((row, index) => {
      const item = { ...row };
      let id = text(row.id);
      if (!hasText(id) || used.has(id)) {
        const base = "risk-" + (index + 1);
        id = base;
        let suffix = 2;
        while (reserved.has(id) || used.has(id)) id = base + "-" + suffix++;
      }
      used.add(id);
      item.id = id;
      TEXT_FIELDS.forEach(field => { item[field] = text(row[field]); });
      item.likelihood = numeric(row.likelihood);
      item.impact = numeric(row.impact);
      item.contingencyDollars = numeric(row.contingencyDollars);
      return item;
    });
    return { ...source, version: 1, items, updatedAt: text(source.updatedAt) };
  }

  function assess(item) {
    const row = isRecord(item) ? item : {};
    const likelihood = rating(row.likelihood);
    const impact = rating(row.impact);
    if (likelihood === null || impact === null) return { score: null, level: "Not rated", kind: "neutral" };
    const score = likelihood * impact;
    if (score >= 10) return { score, level: "High", kind: "red" };
    if (score >= 5) return { score, level: "Moderate", kind: "amber" };
    return { score, level: "Low", kind: "green" };
  }

  function validate(item) {
    const row = isRecord(item) ? item : {};
    const messages = [];
    if (!hasText(row.title)) messages.push("Enter a risk title.");
    if (rating(row.likelihood) === null) messages.push("Likelihood must be a whole number from 1 to 5.");
    if (rating(row.impact) === null) messages.push("Impact must be a whole number from 1 to 5.");
    if (!STATUSES.includes(row.status)) messages.push("Choose an open, monitoring, or closed status.");
    if (!isEmpty(row.reviewDate) && !validDate(row.reviewDate)) messages.push("Review date must be a valid date in YYYY-MM-DD format.");
    if (!isEmpty(row.contingencyDollars)) {
      const amount = numeric(row.contingencyDollars);
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) messages.push("Contingency dollars must be a nonnegative number.");
    }
    if (row.status === "closed" && !hasText(row.resolution)) messages.push("Enter a resolution before closing this risk.");
    return messages;
  }

  function summarize(raw, todayISO) {
    const today = todayISO === undefined ? localToday() : todayISO;
    if (!validDate(today)) throw new RangeError("todayISO must be a valid YYYY-MM-DD date.");
    const items = normalize(raw).items;
    const active = items.filter(item => item.status !== "closed");
    const closed = items.filter(item => item.status === "closed");
    const topRisks = active.map((item, index) => ({ item, index, score: assess(item).score }))
      .sort((a, b) => (b.score === null ? -1 : b.score) - (a.score === null ? -1 : a.score) || a.index - b.index)
      .slice(0, 3).map(entry => entry.item);
    const highest = topRisks.length ? assess(topRisks[0]) : assess(null);
    const attention = active.flatMap(item => {
      const reasons = [];
      if (!hasText(item.owner)) reasons.push("Assign an owner.");
      if (!hasText(item.mitigation)) reasons.push("Record a mitigation action.");
      if (assess(item).score === null) reasons.push("Assess likelihood and impact.");
      if (isEmpty(item.reviewDate)) reasons.push("Set a review date.");
      else {
        if (!validDate(item.reviewDate)) reasons.push("Correct the invalid review date.");
        else if (item.reviewDate < today) reasons.push("Review is overdue (" + item.reviewDate + ").");
      }
      return reasons.length ? [{ id: item.id, title: item.title, reasons }] : [];
    });
    const counts = { total: items.length, active: active.length, closed: closed.length, high: 0, moderate: 0, low: 0, unrated: 0, needsAttention: attention.length };
    active.forEach(item => {
      const level = assess(item).level;
      counts[level === "Not rated" ? "unrated" : level.toLowerCase()]++;
    });
    return { items, active, closed, topRisks, level: highest.level, kind: highest.kind, attention, counts };
  }

  return Object.freeze({ normalize, assess, summarize, validate });
});
