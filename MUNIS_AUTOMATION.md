# JAN CPT free MUNIS report automation

This package implements the preview-first workflow:

`MUNIS CSV -> synced SharePoint folder -> Windows task -> Supabase preview -> JAN CPT review`

It is intentionally unable to change project financial records. It validates and stages a preview so the real MUNIS column names and matching rules can be approved first.

## What works now

- The **MUNIS report sync** screen in JAN CPT accepts a CSV and previews project matches in the browser.
- `automation/Send-MunisReport.ps1` checks a synced folder and submits new CSV reports.
- The `munis-import` Edge Function authenticates the sender, rejects invalid/oversized reports, prevents duplicate imports, matches by MUNIS project number, and stores an editor-only preview.
- The scheduled-task installer checks the folder every hour at no software-license cost.

## One-time deployment

1. Run `supabase/migrations/202609160001_munis_sync.sql` in the Supabase SQL Editor.
2. Deploy `supabase/functions/munis-import/index.ts` as the `munis-import` Edge Function.
3. Generate a long random secret and save it as the Edge Function secret `MUNIS_SYNC_SECRET`.
4. Save the same value as the Windows **user** environment variable `JAN_CPT_SYNC_SECRET`. Never put it in GitHub or the HTML file.
5. Sync the approved SharePoint library to OneDrive. The default local folder is `OneDrive - JMAA/MUNIS Reports`.
6. Run `automation/Install-MunisSyncTask.ps1` once.

## Folder layout

- `Inbox` — MUNIS or SharePoint places CSV reports here.
- `Previews` — the task writes a JSON copy of each validation result here.
- `Processed` — successfully staged source reports move here.

## Required CSV headings

Use `automation/MUNIS_REPORT_TEMPLATE.csv` until a real MUNIS export is available. Supported aliases include:

- MUNIS project number: `munis_project_number`, `project_number`, `project no`, or `project id`
- Revised budget: `revised_budget`, `project budget`, or `budget`
- Actual spending: `actual_spend`, `expenditures`, `spent`, or `ytd actual`
- Encumbrances: `encumbrances`, `encumbered`, or `open commitments`
- Available balance: `available_balance`, `available budget`, or `remaining balance`

## Safety rule

Do not add automatic database updates until a real MUNIS report has been tested, unmatched rows are resolved, and JMAA approves which field is authoritative. Approval/apply should be a separate editor action with an audit record.
