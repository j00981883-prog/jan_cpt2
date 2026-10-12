# Document controls

In a capital or internal project, open Documents. Search document names,
filenames (including older revisions), categories and revision notes. PDF/Office
file contents are not yet indexed. Photos have their own category.

Choose Controls / history to rename or categorize a document, record notes,
change its review status, upload a revised file, or register a revised web link.
A new revision begins as Draft and retains every previous file. Provide a
description of what changed. Uploading a new draft does not remove the existing
approval. Approving another revision supersedes the previous approved revision.
The list identifies both the latest revision and current approved revision.
Editors may approve documents; this is not yet a routed approval workflow.

Archive hides a document and its revisions from the active register without
deleting files. Use the Archived filter to restore them as drafts. Explicitly
deleting the entire project still follows the existing project deletion workflow.
Grant-tab legacy links remain accessible but are not revision-controlled until
registered using Add link in Documents.

Activity records capture upload, revision, status and details changes, with actor
and timestamp. They start at this release and do not reconstruct older events.
Readers can view version/activity history; database rules restrict changes to
existing editor accounts. Original files and links cannot be overwritten after
attachment. Revision numbers and exclusive approval are enforced in PostgreSQL.

SharePoint links are supported. Automatic SharePoint synchronization, full-text
search inside files, assigned reviewers and reminders are later phases.

Validation: `node --test tests/*.test.cjs`; database rollback checks exercised
revision numbering, draft approval retention, approval replacement, immutable
content, archiving, activity capture, viewer rejection and project cascades.

The Supabase security advisor reported pre-existing findings in `field_last_visit`,
`touch_updated_at`, existing authorization/auth hooks and leaked-password
protection. None named the new document control functions or activity table.
These are recorded for a separate security review:
[database security advisories](https://supabase.com/docs/guides/database/database-linter)
and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
