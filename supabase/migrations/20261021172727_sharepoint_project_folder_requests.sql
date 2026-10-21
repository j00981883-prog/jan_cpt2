-- Project-scoped folder requests; clients can submit only a project ID.
create table public.sharepoint_project_folders(
 project_id uuid primary key references public.projects(id) on delete cascade,
 folder_path text unique,
 url text unique,
 status text not null default 'queued' check(status in ('queued','sending','ready')),
 attempts integer not null default 0,
 leased_until timestamptz,
 created_at timestamptz not null default now(),
 ready_at timestamptz
);
alter table public.sharepoint_project_folders enable row level security;
revoke all on public.sharepoint_project_folders from public,anon,authenticated;
grant select on public.sharepoint_project_folders to authenticated;
grant insert(project_id) on public.sharepoint_project_folders to authenticated;
grant all on public.sharepoint_project_folders to service_role;
create policy sharepoint_project_folders_read on public.sharepoint_project_folders for select to authenticated
using((select auth.uid()) is not null and exists(select 1 from public.projects p where p.id=project_id));
create policy sharepoint_project_folders_request on public.sharepoint_project_folders for insert to authenticated
with check((select public.is_editor()) and exists(select 1 from public.projects p where p.id=project_id));
create function public.claim_sharepoint_folders() returns setof public.sharepoint_project_folders language sql security invoker set search_path='' as $$
 update public.sharepoint_project_folders set status='sending',attempts=attempts+1,leased_until=now()+interval '15 minutes'
 where project_id in (select project_id from public.sharepoint_project_folders where status='queued' or (status='sending' and leased_until<now()) order by created_at for update skip locked limit 3)
 returning *;
$$;
revoke all on function public.claim_sharepoint_folders() from public,anon,authenticated;
grant execute on function public.claim_sharepoint_folders() to service_role;

create or replace function public.receive_sharepoint_document(payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.sharepoint_documents; target uuid; mapped_url text; change text;
begin
 select id,sharepoint_folder_url into target,mapped_url from public.projects where id=(payload->>'project_id')::uuid;
 if target is null or (mapped_url is distinct from payload->>'mapping_url' and not exists(
   select 1 from public.sharepoint_project_folders f where f.project_id=target and f.status='ready' and f.url=payload->>'mapping_url'
 )) then raise exception 'Project folder mapping changed; retry delivery'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payload->>'source_id',0));
 select * into previous from public.sharepoint_documents where source_id=payload->>'source_id';
 if found and previous.modified_at >= (payload->>'modified_at')::timestamptz then return jsonb_build_object('status','unchanged'); end if;
 change:=case when previous.source_id is null then 'added' else 'updated' end;
 insert into public.sharepoint_documents(source_id,project_id,file_name,url,source_path,modified_at,source_version)
 values(payload->>'source_id',target,payload->>'file_name',payload->>'url',payload->>'source_path',(payload->>'modified_at')::timestamptz,coalesce(payload->>'source_version',''))
 on conflict(source_id) do update set project_id=excluded.project_id,file_name=excluded.file_name,url=excluded.url,source_path=excluded.source_path,
 modified_at=excluded.modified_at,source_version=excluded.source_version,received_at=now();
 insert into public.sharepoint_document_events(source_id,project_id,file_name,source_version,modified_at,action)
 values(payload->>'source_id',target,payload->>'file_name',coalesce(payload->>'source_version',''),(payload->>'modified_at')::timestamptz,change);
 return jsonb_build_object('status',change,'project_id',target);
end $$;
