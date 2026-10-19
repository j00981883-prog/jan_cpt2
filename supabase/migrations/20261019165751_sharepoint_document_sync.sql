-- Additive SharePoint metadata index. Existing documents are not modified.
create table public.sharepoint_sync_keys (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique,
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.sharepoint_sync_keys enable row level security;
revoke all on public.sharepoint_sync_keys from public,anon,authenticated;
grant select on public.sharepoint_sync_keys to service_role;

create table public.sharepoint_documents (
 source_id text primary key,
 project_id uuid not null references public.projects(id) on delete cascade,
 file_name text not null,
 url text not null,
 source_path text not null,
 modified_at timestamptz not null,
 source_version text not null default '',
 received_at timestamptz not null default now()
);
create index sharepoint_documents_project on public.sharepoint_documents(project_id,modified_at desc);
alter table public.sharepoint_documents enable row level security;
revoke all on public.sharepoint_documents from public,anon,authenticated;
grant select on public.sharepoint_documents to authenticated;
grant all on public.sharepoint_documents to service_role;
create policy sharepoint_documents_read on public.sharepoint_documents for select to authenticated
 using ((select auth.uid()) is not null and exists(select 1 from public.projects p where p.id=project_id));

create table public.sharepoint_document_events (
 id bigint generated always as identity primary key,
 source_id text not null references public.sharepoint_documents(source_id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 file_name text not null,
 source_version text not null,
 modified_at timestamptz not null,
 received_at timestamptz not null default now(),
 action text not null check(action in ('added','updated'))
);
create index sharepoint_events_project on public.sharepoint_document_events(project_id,received_at desc);
create index sharepoint_events_source on public.sharepoint_document_events(source_id);
alter table public.sharepoint_document_events enable row level security;
revoke all on public.sharepoint_document_events from public,anon,authenticated;
grant select on public.sharepoint_document_events to authenticated;
grant all on public.sharepoint_document_events to service_role;
grant usage,select on sequence public.sharepoint_document_events_id_seq to service_role;
create policy sharepoint_events_read on public.sharepoint_document_events for select to authenticated
 using ((select auth.uid()) is not null and exists(select 1 from public.projects p where p.id=project_id));

-- Only the authenticated receiving function can invoke this atomic write.
create function public.receive_sharepoint_document(payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.sharepoint_documents; target uuid; mapped_url text; change text;
begin
 select id,sharepoint_folder_url into target,mapped_url from public.projects
 where id=(payload->>'project_id')::uuid;
 if target is null or mapped_url is distinct from payload->>'mapping_url' then
   raise exception 'Project folder mapping changed; retry delivery';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payload->>'source_id',0));
 select * into previous from public.sharepoint_documents where source_id=payload->>'source_id';
 if found and previous.modified_at >= (payload->>'modified_at')::timestamptz then
   return jsonb_build_object('status','unchanged');
 end if;
 change:=case when previous.source_id is null then 'added' else 'updated' end;
 insert into public.sharepoint_documents(source_id,project_id,file_name,url,source_path,modified_at,source_version)
 values(payload->>'source_id',target,payload->>'file_name',payload->>'url',payload->>'source_path',
        (payload->>'modified_at')::timestamptz,coalesce(payload->>'source_version',''))
 on conflict(source_id) do update set project_id=excluded.project_id,file_name=excluded.file_name,
 url=excluded.url,source_path=excluded.source_path,modified_at=excluded.modified_at,
 source_version=excluded.source_version,received_at=now();
 insert into public.sharepoint_document_events(source_id,project_id,file_name,source_version,modified_at,action)
 values(payload->>'source_id',target,payload->>'file_name',coalesce(payload->>'source_version',''),
        (payload->>'modified_at')::timestamptz,change);
 return jsonb_build_object('status',change,'project_id',target);
end $$;
revoke all on function public.receive_sharepoint_document(jsonb) from public,anon,authenticated;
grant execute on function public.receive_sharepoint_document(jsonb) to service_role;
