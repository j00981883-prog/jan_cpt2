# SharePoint document delivery

## Current status — October 21, 2026

The user obtained Power Automate Premium. Microsoft reported that the previous license suspension was resolved, and the automatic update flow was enabled (Status: On). The scoped receiving credential is enabled. No trial or purchase was started by the agent.

A separate instant flow, `JAN CPT - Initial SharePoint file index` (`6e10d889-7abb-4cc9-8a1b-18ce25d7a522`), now reads existing files using Get files (properties only), pagination threshold 5000, nested items, and filters for the five mapped project folders. Its first run started October 21 at 10:48 AM Central and found 607 files. All 607 records were confirmed in the database later that morning. Real file metadata is visible under Documents → Files from SharePoint, including source version and modification dates.

Initial run: https://make.gov.powerautomate.us/environments/Default-9788b7ae-68dd-475a-963f-aaaba469f043/flows/6e10d889-7abb-4cc9-8a1b-18ce25d7a522/runs/08584090091843471025040856384CU17

Flow: JAN CPT - SharePoint document updates

https://make.gov.powerautomate.us/environments/Default-9788b7ae-68dd-475a-963f-aaaba469f043/flows/0d707df3-0548-4044-ba62-c99bba78213d/details

Source: Capital Programming / Documents, library 55306a22-0a0e-4b2b-b0a9-041dda3e637f.

Receiver: https://thbptghdspfweogjufun.supabase.co/functions/v1/sharepoint-sync

## Behavior

- Five existing project folder URLs were saved: Apron Lighting (001-23), Badging Relocation (100 Cross Street), Threshold Lighting (005-25), RSA Improvements (008-23), and PBB Gate 4 (CP 004-24).
- Runway Rehabilitation remains unmapped because its project number is N/A and the observed folder titles are ambiguous.
- Trigger conditions restrict delivery to files in the five mapped folders. Adding another project requires updating the flow's folder condition as well as the project mapping.
- Only metadata and authenticated SharePoint links are delivered. No file content, source modifications, source deletion, or sharing-permission changes are part of this flow.
- Files appear in Documents → Files from SharePoint. That list refreshes every 30 seconds while open and shows source modification and delivery timestamps in Central time.
- The separate metadata index does not overwrite existing JAN CPT documents, approvals, uploads, budgets, or grant data.
- Stable library/item identifiers prevent duplicates. Atomic processing ignores older or repeated timestamps and records accepted changes in sharepoint_document_events.
- Deleted source files are not removed automatically; source SharePoint versions remain in SharePoint. A saved link is not an immutable approved revision.

## Authentication

The HTTP action uses x-jan-cpt-sharepoint-key. Its random 256-bit value lives in the Microsoft flow; Secure inputs is enabled so run history does not expose it. The database stores only its SHA-256 hash. The value is not stored in this repository or the frontend.

The edge function validates this credential itself; platform JWT validation is disabled for this webhook. The built-in service-role credential is used only inside the edge function. Browser users cannot read credentials, insert/update metadata, or execute the receiving RPC. Authenticated dashboard users can read indexed files for projects visible through existing project policies.

Credential record b97ab8d4-0a44-4ed4-96ff-92afe4e6ac25 is enabled. To rotate, provision a new random key, store its hash, replace the flow header, then revoke the old record. Never put a service-role credential in Power Automate or JAN_CPT.html.

## Remaining work

1. Review any subsequent Microsoft delivery failures in run history. The initial 607-file index count is reconciled.
2. Verify a future create/modify event through the separate automatic flow. Initial import receipt and dashboard display are verified, but a new source modification has not been made just to trigger a test.
3. Verify repeat delivery remains unchanged in a real flow run; database duplicate/stale handling already passed rolled-back tests.
4. Verify the remaining Runway Rehabilitation folder before assigning it.
5. SharePoint file content extraction for AI remains separate work: this integration sends metadata and links only, not document contents.

## Verification completed

- 20 Node tests passed, including existing assistant/document/reminder tests and new URL/folder/metadata validation tests.
- A rolled-back database test checked insert, duplicate, newer update, stale delivery, and two corresponding history events. No test file records were retained.
- Database grants deny anonymous file reads, client metadata writes, client credential reads, and client invocation of the receiving RPC.
- An unauthenticated request to the deployed edge function returned HTTP 401.
- Security advisor: the key table intentionally has RLS with no client policies and all client grants revoked. Other reported findings concern pre-existing database objects and were not changed in this feature.

Microsoft connector reference: https://learn.microsoft.com/en-us/sharepoint/dev/business-apps/power-automate/sharepoint-connector-actions-triggers
