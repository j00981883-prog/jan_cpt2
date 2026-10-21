# JAN CPT → SharePoint uploads

Enabled October 21, 2026 with user approval to copy new dashboard uploads to Capital Programming / Documents / JAN CPT.

## Destination

`JAN CPT/<project title> - <first eight project ID characters>/Photos` or `Files`.
Project IDs distinguish projects with the same name. Each filename retains its original name plus a unique delivery ID before the extension, preventing unrelated same-name files from being overwritten. Project titles are snapshotted at upload time; renaming a project later does not move earlier copies.

## Delivery

The `documents` insert/storage-path-change trigger queues new registered files, including walkthrough photos, ordinary uploads, attached listed files, and new file revisions. It does not backfill historical uploads, copy URL-only links, or convert notes/budget records to files. JAN CPT retains its private original.

Flow: `JAN CPT - Upload files to SharePoint`

https://make.gov.powerautomate.us/environments/Default-9788b7ae-68dd-475a-963f-aaaba469f043/flows/d9a5477d-7fd8-4beb-ab32-9417548d8ecb/details

Every minute: authenticated HTTP claim → Apply to each → SharePoint Create new folder → HTTP GET private signed file URL → SharePoint Create file → authenticated HTTP completion receipt. Three files per claim. Failed/unacknowledged deliveries retry after a 15-minute lease; invalid/missing storage files show an error and need investigation. Microsoft run history remains the source of connector errors. Do not manually mark a failed upload delivered.

The destination is constrained by server-generated paths. Nothing deletes, moves, or changes existing SharePoint source files or permissions. Microsoft connection permissions remain unchanged; writes inherit the target library's existing access. SharePoint-only file contents are not passed to AI by this feature.

## Create folder button and incoming links

Documents now includes a JAN CPT project folder panel. Editors can request a folder with **Create project folder in SharePoint**. It shows a pending status until Microsoft's confirmation and then an **Open JAN CPT project folder** link. Repeated requests cannot create another project mapping. The request sends only the project ID; client column grants/RLS prevent changing destination paths, completion status, or another arbitrary SharePoint location.

Separate folder-only worker: `JAN CPT - Create project folders`, flow `d679c0d5-b43e-4c95-a6a3-e66b05b9cdab`. It runs every minute and uses authenticated HTTP `claimfolders` → Apply to each → SharePoint Create new folder → authenticated `completefolder`. No download/file creation action is present. Confirmed folder paths stay stable if a project is renamed later.

The existing incoming SharePoint watcher now includes `Shared Documents/JAN CPT/` in addition to its five original scopes. The receiver matches files to confirmed `sharepoint_project_folders` mappings, not arbitrary folder names. Unknown folders remain unmapped. Source changes update link metadata only: no new `documents` upload rows are created and nothing is copied back to SharePoint. Existing files are not renamed, moved, deleted, or automatically backfilled from the new workspace. Use the folder button on each project to establish/confirm its workspace; file uploads also establish a mapping automatically.

End-to-end pilot: Apron Lighting folder request was submitted through the actual dashboard button, Microsoft created its empty folder, and JAN CPT displayed the confirmed link. A harmless SharePoint-native `JAN-CPT-incoming-link-test.txt` created inside it arrived in `sharepoint_documents` at 12:34 PM Central on October 21, 2026; the dashboard displayed its link. Incoming flow history showed Succeeded. The upload queue did not grow, verifying no feedback loop. This test document remains available for inspection.

The three existing JAN CPT workspaces evidenced by successful outbound receipts (Threshold Lighting, RSA Improvements, and Runway Rehabilitation) were registered as ready mappings using their validated actual destination URLs. This changed dashboard metadata only and did not recreate, move, or alter their SharePoint files. Future uploads and direct SharePoint additions in those workspaces can use the established mappings. All 32 tests passed; column-grant checks confirmed editors can submit a project ID but cannot set a URL, complete a folder job, or claim jobs, and anonymous folder reads are denied. No outbound job was created for the SharePoint-native inbound test file.

## Security

The receiver validates the existing private flow credential against its enabled SHA-256 record. No service-role key is in the browser or flow. The queue has RLS and authenticated project-visible read access only; clients cannot claim/acknowledge/write jobs. The narrow trigger function is in `jan_private`, fixed search path, no client execution grants. Storage paths are checked against the project's UUID before privileged signing. Download URLs expire after 20 minutes. HTTP download inputs and outputs are secured in run history; authenticated HTTP actions have secure inputs enabled.

The database advisor reported no new feature-specific warnings. Pre-existing findings remain on field_last_visit, touch_updated_at, public auth helpers, and leaked-password protection. See https://supabase.com/docs/guides/database/database-linter for remediation guidance; this work does not silently alter those unrelated objects.

## Verification

A harmless text file uploaded through the actual dashboard on the RSA project was automatically delivered on the first attempt. Microsoft run `08584090070039972090194270107CU21` succeeded, including the SharePoint write and completion receipt. A gallery screenshot uploaded as an image also reached Photos on its first attempt and opened correctly in SharePoint's image viewer. The new dashboard delivery list displayed both files as Saved to SharePoint. Both originals remain in JAN CPT. The two test artifacts (`JAN-CPT-SharePoint-connection-test.txt` and `walkthrough-gallery.png`) remain available for inspection; they may be archived/deleted later through normal recovery flows.

Local tests cover destination scope, project path validation, image routing, stable collision-safe naming, and existing application regression tests.

All 30 tests passed. A controlled repeat delivery of the same text test job completed with attempts=2 and the same destination filename, exercising already-existing folder/file handling. Anonymous queue reads, authenticated queue updates/claims, and anonymous execution of the private trigger function were verified denied.
