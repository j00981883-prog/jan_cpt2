# Project risk register

The first workshop improvement adds a Risk Register tab to capital and internal projects. Editors can add, edit, close, and reopen risks. Viewers can read the register. Closed records remain available; there is no delete action.

Each risk records its description, likelihood, impact, owner, response, review date, optional contingency estimate, and resolution. The estimate does not change the project budget or approve spending. Missing ownership, response, review dates, or ratings and overdue reviews are highlighted for follow-up.

Scores use likelihood multiplied by impact, each from 1 to 5: Low is 1–4, Moderate is 5–9, and High is 10–25. These are the register's tracking thresholds, not a claim of JMAA policy approval. Closed risks do not contribute to active ratings. An active risk can raise the capital project's existing dashboard risk rating; it cannot lower a warning from another indicator. Internal projects show their register's rating separately.

## Saving and data

The register is stored in the existing `projects.meta.riskRegister` JSON block. Existing row-level permissions remain in force. No new database table or SharePoint write is introduced.

Saving a risk first finishes pending project saves. It then reads current metadata and conditionally updates only that metadata, preserving other fields. A conflicting risk change is rejected with a visible explanation. Local state is published only after confirmation. Unchanged confirmed data is not sent through the financial save path. Failed saves preserve the form draft, and retries reuse the risk's ID. A successful request whose response was lost can be recognized on retry.

The register retains closed records and current resolution notes. It is not an immutable audit log. General project edits elsewhere in the existing app still use full metadata snapshots, so they do not gain cross-session conflict resolution from this feature.

## Verification

Regression tests cover scoring, unknown values, review dates, closed records, validation, permissions, save failures, retries, concurrent changes, financial-data isolation, and dashboard navigation. Browser checks cover date and amount entry, failed-save recovery, reload persistence in an isolated preview, closing and reopening, viewer controls, and phone layout. Production project data is not populated with sample risks.
