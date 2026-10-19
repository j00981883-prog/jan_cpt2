# SharePoint document delivery

## Current status — October 19, 2026

The receiving endpoint and Documents display are deployed. Automatic delivery is **not enabled**. Microsoft saved the flow but displayed: “Your flow was saved, but could not be enabled because of billing restrictions.” No trial, purchase, or license change was made. The receiving credential is disabled until this is resolved and end-to-end testing can proceed.

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

Credential record b97ab8d4-0a44-4ed4-96ff-92afe4e6ac25 is currently disabled. Re-enable only when Microsoft delivery is ready for testing. To rotate, provision a new random key, store its hash, replace the flow header, then revoke the old record. Never put a service-role credential in Power Automate or JAN_CPT.html.

## Remaining work

1. Have JMAA's Power Platform administrator resolve the exact billing restriction for the HTTP action/flow. Do not assume access to Power Automate includes this action's entitlement.
2. Re-enable the scoped receiving credential and enable the flow without starting a trial or buying a license unless separately authorized.
3. Run a real end-to-end test and verify source fields, folder filtering, successful receipt, dashboard display, and duplicate delivery behavior. No real file delivery has been verified yet.
4. Build and run a one-time initial metadata import using Get files (properties only), with pagination and the same folder filters/authenticated receiver. Existing files have not yet been imported.
5. Verify the remaining Runway Rehabilitation folder before assigning it.

## Verification completed

- 20 Node tests passed, including existing assistant/document/reminder tests and new URL/folder/metadata validation tests.
- A rolled-back database test checked insert, duplicate, newer update, stale delivery, and two corresponding history events. No test file records were retained.
- Database grants deny anonymous file reads, client metadata writes, client credential reads, and client invocation of the receiving RPC.
- An unauthenticated request to the deployed edge function returned HTTP 401.
- Security advisor: the key table intentionally has RLS with no client policies and all client grants revoked. Other reported findings concern pre-existing database objects and were not changed in this feature.

Microsoft connector reference: https://learn.microsoft.com/en-us/sharepoint/dev/business-apps/power-automate/sharepoint-connector-actions-triggers
