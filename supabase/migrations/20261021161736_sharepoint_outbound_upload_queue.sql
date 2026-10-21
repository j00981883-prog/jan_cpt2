-- Outbound copies are separate from the read-only SharePoint index.
create schema if not exists jan_private;
revoke all on schema jan_private from public,anon,authenticated;
create table public.sharepoint_uploads(
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.documents(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 storage_path text not null,
 file_name text not null,
 category text not null,
 project_title text not null,
 status text not null default 'queued' check(status in ('queued','sending','delivered','error')),
 attempts integer not null default 0,
 leased_until timestamptz,
 destination_url text,
 error_message text,
 created_at timestamptz not null default now(),
 delivered_at timestamptz,
 unique(document_id,storage_path)
);
create index sharepoint_uploads_project on public.sharepoint_uploads(project_id,created_at desc);
alter table public.sharepoint_uploads enable row level security;
revoke all on public.sharepoint_uploads from public,anon,authenticated;
grant select on public.sharepoint_uploads to authenticated;
grant all on public.sharepoint_uploads to service_role;
create policy sharepoint_uploads_read on public.sharepoint_uploads for select to authenticated
 using((select auth.uid()) is not null and exists(select 1 from public.projects p where p.id=project_id));

-- Only new file registrations/path changes are copied, not historical uploads.
create function jan_private.queue_sharepoint_upload() returns trigger language plpgsql security definer set search_path='' as $$
declare title text;
begin
 if new.kind is distinct from 'file' or coalesce(new.storage_path,'')='' then return new; end if;
 if tg_op='UPDATE' and old.storage_path is not distinct from new.storage_path then return new; end if;
 if not (new.storage_path like new.project_id::text||'/%' or new.storage_path like 'field/'||new.project_id::text||'/%')
 or new.storage_path ~ '(^|/)\.\.(/|$)' then return new; end if;
 select p.title into title from public.projects p where p.id=new.project_id;
 insert into public.sharepoint_uploads(document_id,project_id,storage_path,file_name,category,project_title)
 values(new.id,new.project_id,new.storage_path,coalesce(nullif(new.file_name,''),'document'),coalesce(new.category,'General'),coalesce(title,'Project'))
 on conflict(document_id,storage_path) do nothing;
 return new;
end $$;
revoke all on function jan_private.queue_sharepoint_upload() from public,anon,authenticated;
create trigger queue_sharepoint_upload after insert or update of storage_path on public.documents for each row execute function jan_private.queue_sharepoint_upload();

create function public.claim_sharepoint_uploads() returns setof public.sharepoint_uploads language sql security invoker set search_path='' as $$
 update public.sharepoint_uploads set status='sending',attempts=attempts+1,leased_until=now()+interval '15 minutes'
 where id in (select id from public.sharepoint_uploads where status='queued' or (status='sending' and leased_until<now()) order by created_at for update skip locked limit 3)
 returning *;
$$;
revoke all on function public.claim_sharepoint_uploads() from public,anon,authenticated;
grant execute on function public.claim_sharepoint_uploads() to service_role;
