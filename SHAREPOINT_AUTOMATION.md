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
- Trigger conditions restrict delivery to the five original mapped folders plus the separate JAN CPT workspace. New JAN CPT project folders are matched using confirmed folder-request records; adding another legacy departmental folder still requires updating the watcher scope and mapping.
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
2. A real create event inside the confirmed Apron Lighting JAN CPT workspace was verified through the automatic flow, database index, and dashboard on October 21. Monitor subsequent connector errors in Microsoft run history.
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

## Optional file contents for JAN AI — November 3, 2026

The receiving code and migration now support a private AI copy alongside the
existing metadata index. Migration `sharepoint_ai_file_contents` was applied
and `sharepoint-sync` version 4 deployed on November 3. Both the automatic
updates flow (`0d707df3-0548-4044-ba62-c99bba78213d`) and initial index flow
(`6e10d889-7abb-4cc9-8a1b-18ce25d7a522`) were saved with the content-delivery
stage. The existing metadata HTTP actions remain in place.

The initial backfill found **691 files**. Its first run was cancelled after
4 minutes 14 seconds and replaced by a run with Apply to each concurrency set
to **4**, started at **11:20 AM Central on November 3**:

https://make.gov.powerautomate.us/environments/Default-9788b7ae-68dd-475a-963f-aaaba469f043/flows/6e10d889-7abb-4cc9-8a1b-18ce25d7a522/runs/08584078804298409993308008415CU13

At **11:24 AM Central (17:24:30 UTC)**, the replacement run was
still processing and **246 files were cached**. All 246 matched their current
SharePoint metadata; none were stale. These are dated progress counts, not a
claim that all 691 files are ready. Unsupported or oversized files remain
link-only. The first confirmed delivery was RSA's
`RFQ Runway 16L 34R Safety Area Improvements at JAN.pdf` (860,212 bytes).

A real authenticated dashboard test also passed: JAN AI read the Dashboard
and SharePoint copies of
`RWY 16L-34R Threshold Lighting at JAN_Project Detail Summary.PDF` together,
identified and cited both source versions, and correctly compared their
contents. This test made no changes to project records.

The initial index now includes the `Shared Documents/JAN CPT/` workspace
alongside its five legacy project folder scopes. The receiver still requires
a confirmed project mapping. A replayed automatic trigger completed all
actions but was unmapped, so that particular replay was not used as proof of
mapped file-content delivery.

Keep the existing `sharepoint-sync` URL, scoped header, and metadata fields.
Add an optional `content_base64` field containing the unmodified base64
`$content` value from SharePoint **Get file content**. Do not send a data URL,
a serialized binary object, or a browser download URL. Never place a service
role key in the flow. Secure the content action's outputs and the receiving
HTTP action's inputs/outputs in run history.

The payload remains:

```json
{
  "site_url": "https://jmaait.sharepoint.com/sites/CapitalProgramming",
  "library_id": "<existing library UUID>",
  "item_id": "<existing SharePoint item ID>",
  "file_name": "Scope.pdf",
  "url": "<direct file URL under the mapped project folder>",
  "modified_at": "<ISO modified timestamp with timezone>",
  "version": "<the version whose bytes were fetched>",
  "content_base64": "<raw base64 from Get file content>"
}
```

Fetch metadata before and after reading the bytes. Deliver contents only when
the file's modification time and version stayed the same; otherwise retry the
file using its newer metadata. The receiver verifies metadata identity but
cannot independently identify the SharePoint version of arbitrary bytes.

The saved flow stage gets file metadata, checks the metadata HTTP status is
`added`, `updated`, or `unchanged`, and filters by supported extension and size.
It then gets file contents with secured outputs, re-reads properties, and sends
the final HTTP request with secured inputs. `content_base64` is included only
when Modified, VersionNumber, and FullPath still match the original metadata;
otherwise the flow sends an empty value and no bytes are cached. `unchanged`
must remain eligible so already-indexed files can receive their first contents.

Only PDF and UTF-8 TXT, MD, CSV, or JSON files up to **3,600,000 decoded bytes**
are accepted. PDF bytes must have a PDF header; text cannot contain binary
control characters or invalid UTF-8. Office documents and larger files still
receive their normal metadata/link; they need a supported export for AI
reading. Filter these before Get file content to avoid sending oversized
requests. The total HTTP JSON body is limited to 4,850,000 bytes. Metadata-only
requests retain their existing 16,384-byte limit.

The receiver first processes metadata through the original RPC, then handles
optional contents. It accepts a first content copy even if that file's
timestamp was already indexed. Thus an initial backfill can reuse existing
file metadata without creating duplicate index records. Response `status`
retains its existing meaning and `content_status` reports:

| Value | Meaning |
| --- | --- |
| `not_provided` | Normal metadata-only delivery. |
| `cached` | Contents stored and linked to the current indexed version. |
| `unchanged` | The same content version is already linked. |
| `stale` | A newer or different indexed version exists; no old copy was linked. |
| `conflict` | Different bytes arrived for an identical version/time; existing contents were preserved. |
| `unsupported`, `invalid`, `too_large` | Metadata accepted, contents rejected with a safe explanation. |
| `error` | Metadata accepted, transient content-storage failure; HTTP 503 asks the flow to retry. |

For equal modification timestamps, the metadata receiver accepts a strictly
higher numeric SharePoint `major.minor` version and ignores older numeric
versions. Unknown ordering, or different file identity with the same version
and timestamp, sets `content_version_conflict`. Its cache pointer is removed
and AI access stays blocked even if the old event is replayed. A delivery with
a strictly newer modification timestamp resolves the conflict; source files
and privately retained cache objects are not deleted. Such a metadata response
has `status: "conflict"`.

Contents go to private bucket `sharepoint-ai`, with pointers in
`sharepoint_file_contents`. Immutable object paths contain project identity,
hashed source identity, hashed version/time, and the byte hash. A locked,
service-only RPC refuses stale metadata and never overwrites an immutable file.
The assistant must match project, modification timestamp, and version before
reading. Storage policies independently enforce that current-version match
and the caller's existing project access. Anonymous reads and client writes
to this bucket are denied even when another storage policy is permissive.

These copies never become `documents` rows, so they cannot enter the outbound
SharePoint upload queue. Existing dashboard documents remain separately
available to AI. SharePoint originals, permissions, file revisions, and other
dashboard data are unchanged. Superseded or race-lost cache objects may remain
privately stored, but client policies do not expose them after their pointer
is no longer current. No source deletion or automatic cache cleanup is added.

Local validation: `node --test tests/sharepoint-content.test.cjs
tests/sharepoint.test.cjs` covers byte limits, malformed content, stable paths,
metadata-only compatibility, backfill/retry, stale-version races, and failures.
The live rollback-only script `tests/sharepoint-content-rollback.sql` passed
numeric-version ordering, duplicate and stale cache requests, conflicting
content rejection, authenticated current-content reads, denied client writes
and RPC invocation, stale-content denial, anonymous denial, and conflict
recovery. Its synthetic database metadata fixtures were rolled back and a
follow-up query confirmed zero retained test projects, metadata, or objects.
The separate Microsoft deliveries and authenticated dashboard comparison
described above verify actual file-byte delivery and reading.

The deployed receiver returned HTTP 401 to an unauthenticated request. Security
advisors reported no new feature findings; existing unrelated findings remain.
Immediately after deployment, the new project lookup index was reported unused
before real content traffic began. The bucket is private with its
3,600,000-byte limit.
