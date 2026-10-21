# JAN AI evidence upgrade — October 21, 2026

JAN AI now receives richer, bounded saved-record evidence: project details, schedule, full grant sections and completion dates, funding allocations, pay applications, recent weekly logs, and document revision/attachment metadata. Calculations identify missing weekly evidence, funding gaps, past baseline completion dates, and unattached document records. An open project is prioritized in the briefing.

The assistant panel includes **Read a project document**. Select a supported uploaded PDF/text file (up to 3.6 MB), enter a question, and press Send. The server checks the caller's session and document/storage access before supplying the selected file to the existing Anthropic service. It never fetches arbitrary external URLs. Draft and approved revision labels are visible; archived documents cannot be selected. The picker loads the newest 300 records for its selection and supports filename search within those results.

The SharePoint evidence currently consists of the saved folder link and any metadata delivered to sharepoint_documents. It does not contain Microsoft file contents. Automatic SharePoint delivery remains blocked by the previously recorded Microsoft billing restriction. To review a SharePoint-only document now, download the file from SharePoint and attach it with the plus button. This upgrade does not register a Microsoft app or grant additional Microsoft permissions.

Analytical prompts distinguish evidence, calculations and missing information; project/file citations are requested. The footer lists records supplied to the model, not a claim that every listed source was cited. Existing change proposals still require review and application; the model cannot write records directly. Document text is reference material and cannot authorize actions.

No model subscription was changed. The existing claude-sonnet-5 default remains; an administrator can configure JAN_AI_MODEL. Responses have more output room and faster display animation. The Supabase library used by the assistant edge function is pinned to 2.118.0.

## Live verification status

The first live request reached Anthropic but returned HTTP 401. A later live request succeeded after the user was directed to the server secret settings. The new document picker loaded actual uploaded files, and JAN AI reviewed Summary.pdf through the deployed endpoint, identifying its signing-certificate contents and noting the filename mismatch. Authentication, storage reading, provider response, and the displayed source list were exercised together. The dashboard also reports invalid server credentials clearly if that condition returns. Never place a key in the HTML, repository or chat.

27 local tests pass, including saved-data evidence calculations, selected-document handling with mocked storage/provider, authentication and editor checks, missing-record failures, and existing edit proposal/document/reminder behavior. The live selected-document review also succeeded.

Relevant references:
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/reference/javascript/storage-from-download
- https://platform.claude.com/docs/en/models/sonnet-5/overview
