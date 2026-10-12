alter table public.document_activity drop constraint document_activity_document_id_fkey;
alter table public.document_activity add constraint document_activity_document_id_fkey foreign key(document_id) references public.documents(id) on delete cascade;
alter table public.documents drop constraint documents_revision_parent_id_fkey;
alter table public.documents add constraint documents_revision_parent_id_fkey foreign key(revision_parent_id) references public.documents(id) on delete cascade;

create or replace function public.allow_project_document_cascade()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from public.projects where id=old.project_id) then return old; end if;
 raise exception 'Archive documents to preserve their files and revision history.';
end $$;
revoke all on function public.allow_project_document_cascade() from public,anon,authenticated;
drop trigger documents_control on public.documents;
create trigger documents_control before insert or update on public.documents for each row execute function public.enforce_document_control();
create trigger documents_preserve before delete on public.documents for each row execute function public.allow_project_document_cascade();
