alter policy document_activity_read on public.document_activity using ((select auth.uid()) is not null);
create index if not exists document_activity_document_time on public.document_activity(document_id,created_at desc);
create index if not exists document_activity_project_time on public.document_activity(project_id,created_at desc);
create index if not exists document_activity_actor_idx on public.document_activity(actor);
create index if not exists documents_approved_by_idx on public.documents(approved_by);
create index if not exists documents_project_idx on public.documents(project_id);
