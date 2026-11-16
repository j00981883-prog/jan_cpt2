# Project risk register

The first workshop improvement adds a Risk Register tab to capital and internal projects. Opening the tab as an editor automatically reviews that project's saved evidence and saves supported AI risks. Editors can also add, edit, close, and reopen risks. Viewers can read the register. Closed records remain available; there is no delete action.

Each risk records its description, likelihood, impact, owner, response, review date, optional contingency estimate, and resolution. The estimate does not change the project budget or approve spending. Missing ownership, response, review dates, or ratings and overdue reviews are highlighted for follow-up.

Scores use likelihood multiplied by impact, each from 1 to 5: Low is 1–4, Moderate is 5–9, and High is 10–25. These are the register's tracking thresholds, not a claim of JMAA policy approval. Closed risks do not contribute to active ratings. An active risk can raise the capital project's existing dashboard risk rating; it cannot lower a warning from another indicator. Internal projects show their register's rating separately.

## Saving and data

The register is stored in the existing `projects.meta.riskRegister` JSON block. Existing row-level permissions remain in force. No new database table or SharePoint write is introduced.

Saving a risk first finishes pending project saves. It then reads current metadata and conditionally updates only that metadata, preserving other fields. The conditional write compares the exact database `updated_at` timestamp, avoiding URL limits from filtering on large metadata. The existing database trigger updates this timestamp on every project change. A conflicting risk change is rejected with a visible explanation. Local state is published only after confirmation. Unchanged confirmed data is not sent through the financial save path. Failed saves preserve the form draft, and retries reuse the risk's ID. A successful request whose response was lost can be recognized on retry.

The register retains closed records and current resolution notes. It is not an immutable audit log. General project edits elsewhere in the existing app still use full metadata snapshots, so they do not gain cross-session conflict resolution from this feature.

## Automatic AI review

The authenticated `assistant` Edge Function supports a separate `risk-register` mode for editors. It loads only the requested project's records using the caller's existing database and storage permissions. It reads at most three supported dashboard or current synced SharePoint files (PDF or UTF-8 text, up to 3.6 MB each). Selection favors relevant recent files and includes both sources when readable candidates exist. Files without current contents and unsupported files are disclosed as unread; a filename is never treated as content evidence.

The model returns zero to six grounded risk assessments. Strict validation checks ratings, dates, text lengths, source IDs, and allowed fields before any persistence. AI output cannot supply an owner, spending amount, approval, status, arbitrary source URL, or a different project. Sources are server supplied. Documents and project text are untrusted evidence, not instructions. `Why this risk` displays the supporting facts and rating rationale, while review coverage lists actual files read and limitations.

The browser saves validated results through the same narrow conditional metadata write. The backend does not write. Manual risks, closed risks, and AI risks that a person edited are retained. Stable keys and titles avoid exact duplicates; unresolved risks omitted by a later review remain visible. Semantic duplication is still possible when a model describes the same issue differently, so the register remains reviewable and editable by the team. Missing evidence does not establish a project failure or a risk-free project.

Automatic openings reuse a saved review when its evidence fingerprint, model, and Chicago calendar day have not changed. Refresh AI review explicitly rechecks. Reviews run on opening, not on a background schedule. The tab shows progress and an actionable error on failure; it does not retry endlessly. Leaving during analysis cancels the local request and prevents a late analysis result from saving. Once the brief database save starts, navigation waits for it to finish. Failed generation does not replace existing risks.

Risk reviews have a dedicated 100-second provider deadline that covers both response headers and the body, with a 135-second browser deadline allowing time for evidence loading. Concise output guidance and a 4,800-token response limit reduce long report generation. Sonnet 5 requests explicitly disable its default extended thinking so that the response allowance is available for the bounded risk report; unknown or later model overrides do not receive this model-specific flag. A true timeout is distinguished from a connection failure and incomplete output. Server diagnostics contain only mode, model, source counts, elapsed time, provider status, completion reason, and output token count; they exclude project records, file contents, identifiers, and credentials.

Deployment requires uploading `index.ts`, `context.mjs`, `documents.mjs`, and `risks.mjs` together, keeping JWT verification enabled. The existing server-only `ANTHROPIC_API_KEY` and optional `JAN_AI_MODEL` configuration are reused.

## Verification

Regression tests cover scoring, unknown values, review dates, closed records, validation, permissions, save failures, retries, concurrent changes, financial-data isolation, and dashboard navigation. AI tests cover project scoping, file eligibility, strict source validation, provider failures, cache reuse, protected merging, automatic-on-open behavior, cancellation, and evidence display. Earlier manual-register browser checks covered date and amount entry, failed-save recovery, reload persistence in an isolated preview, closing and reopening, viewer controls, and phone layout. Production project data is not populated with sample risks.
