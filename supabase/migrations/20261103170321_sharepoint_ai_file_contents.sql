-- Read-only AI copies are separate from dashboard uploads, so these files never
-- enter the documents -> SharePoint outbound queue. Original files stay intact.
alter table public.sharepoint_documents add column content_version_conflict boolean not null default false;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sharepoint-ai','sharepoint-ai',false,3600000,array['application/pdf','text/plain','text/markdown','text/csv','application/json'])
on conflict(id) do update set public=false,file_size_limit=3600000,allowed_mime_types=excluded.allowed_mime_types;

create table public.sharepoint_file_contents(
 source_id text primary key references public.sharepoint_documents(source_id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 storage_path text not null unique,
 size_bytes bigint not null check(size_bytes between 1 and 3600000),
 source_modified_at timestamptz not null,
 source_version text not null default '',
 cached_at timestamptz not null default now(),
 check(storage_path ~ ('^'||project_id::text||'/[0-9a-f]{64}/[0-9a-f]{64}/[0-9a-f]{64}\.(pdf|txt|md|csv|json)$'))
);
create index sharepoint_file_contents_project on public.sharepoint_file_contents(project_id);
alter table public.sharepoint_file_contents enable row level security;
revoke all on public.sharepoint_file_contents from public,anon,authenticated;
grant select on public.sharepoint_file_contents to authenticated;
grant all on public.sharepoint_file_contents to service_role;
create policy sharepoint_file_contents_read on public.sharepoint_file_contents for select to authenticated
 using((select auth.uid()) is not null and exists(select 1 from public.projects p where p.id=project_id));

-- Restrictive guards also protect this bucket if a pre-existing permissive
-- storage policy grants broad access to other dashboard buckets.
create policy sharepoint_ai_no_anon_read on storage.objects as restrictive for select to anon
 using(bucket_id<>'sharepoint-ai');
create policy sharepoint_ai_current_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'sharepoint-ai' or ((select auth.uid()) is not null and exists(
  select 1 from public.sharepoint_file_contents c
  join public.sharepoint_documents d on d.source_id=c.source_id and d.project_id=c.project_id
  join public.projects p on p.id=c.project_id
  where c.storage_path=storage.objects.name and c.source_modified_at=d.modified_at and c.source_version=d.source_version and not d.content_version_conflict
 )));
create policy sharepoint_ai_read_current on storage.objects for select to authenticated
 using(bucket_id='sharepoint-ai' and (select auth.uid()) is not null and exists(
  select 1 from public.sharepoint_file_contents c
  join public.sharepoint_documents d on d.source_id=c.source_id and d.project_id=c.project_id
  join public.projects p on p.id=c.project_id
  where c.storage_path=storage.objects.name and c.source_modified_at=d.modified_at and c.source_version=d.source_version and not d.content_version_conflict
 ));
create policy sharepoint_ai_no_client_insert on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id<>'sharepoint-ai');
create policy sharepoint_ai_no_client_update on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'sharepoint-ai') with check(bucket_id<>'sharepoint-ai');
create policy sharepoint_ai_no_client_delete on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'sharepoint-ai');

-- One locked metadata row decides which immutable object is current. The
-- service credential is confined to the authenticated receiving function.
create function public.cache_sharepoint_file_contents(payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source public.sharepoint_documents; previous public.sharepoint_file_contents;
 target_project uuid; target_modified timestamptz; target_size bigint; target_version text; target_path text;
begin
 if jsonb_typeof(payload)<>'object' then raise exception 'File content metadata required'; end if;
 target_project:=(payload->>'project_id')::uuid;
 target_modified:=(payload->>'source_modified_at')::timestamptz;
 target_size:=(payload->>'size_bytes')::bigint;
 target_version:=payload->>'source_version';
 target_path:=payload->>'storage_path';
 if target_project is null or target_modified is null or target_version is null or target_path is null
 or target_size is null or target_size<1 or target_size>3600000
 or target_path !~ ('^'||target_project::text||'/[0-9a-f]{64}/[0-9a-f]{64}/[0-9a-f]{64}\.(pdf|txt|md|csv|json)$') then
  raise exception 'Invalid file content metadata';
 end if;
 select * into source from public.sharepoint_documents where source_id=payload->>'source_id' for update;
 if not found or source.content_version_conflict or source.project_id<>target_project or source.modified_at<>target_modified
 or source.source_version<>target_version or source.file_name is distinct from payload->>'file_name' then
  return jsonb_build_object('content_status','stale');
 end if;
 if not exists(select 1 from storage.objects where bucket_id='sharepoint-ai' and name=target_path) then
  raise exception 'Cached object is unavailable';
 end if;
 select * into previous from public.sharepoint_file_contents where source_id=source.source_id;
 if found then
  if previous.source_modified_at>target_modified then return jsonb_build_object('content_status','stale'); end if;
  if previous.project_id=target_project and previous.source_modified_at=target_modified and previous.source_version=target_version then
   if previous.storage_path<>target_path or previous.size_bytes<>target_size then
    return jsonb_build_object('content_status','conflict');
   end if;
   return jsonb_build_object('content_status','unchanged');
  end if;
 end if;
 insert into public.sharepoint_file_contents(source_id,project_id,storage_path,size_bytes,source_modified_at,source_version)
 values(source.source_id,target_project,target_path,target_size,target_modified,target_version)
 on conflict(source_id) do update set project_id=excluded.project_id,storage_path=excluded.storage_path,size_bytes=excluded.size_bytes,
  source_modified_at=excluded.source_modified_at,source_version=excluded.source_version,cached_at=now()
 where public.sharepoint_file_contents.source_modified_at<=excluded.source_modified_at;
 if not found then return jsonb_build_object('content_status','stale'); end if;
 return jsonb_build_object('content_status','cached');
end $$;
revoke all on function public.cache_sharepoint_file_contents(jsonb) from public,anon,authenticated;
grant execute on function public.cache_sharepoint_file_contents(jsonb) to service_role;

-- SharePoint can issue multiple numeric versions with the same modified time.
-- Unknown ordering fails closed instead of leaving yesterday's copy readable.
create or replace function public.receive_sharepoint_document(payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.sharepoint_documents; target uuid; mapped_url text; change text; had_previous boolean;
 incoming_time timestamptz; incoming_version text; newer_version boolean;
begin
 select id,sharepoint_folder_url into target,mapped_url from public.projects where id=(payload->>'project_id')::uuid;
 if target is null or (mapped_url is distinct from payload->>'mapping_url' and not exists(
  select 1 from public.sharepoint_project_folders f where f.project_id=target and f.status='ready' and f.url=payload->>'mapping_url'
 )) then raise exception 'Project folder mapping changed; retry delivery'; end if;
 incoming_time:=(payload->>'modified_at')::timestamptz;
 incoming_version:=coalesce(payload->>'source_version','');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payload->>'source_id',0));
 select * into previous from public.sharepoint_documents where source_id=payload->>'source_id' for update;
 had_previous:=found;
 if had_previous and previous.modified_at>incoming_time then return jsonb_build_object('status','unchanged'); end if;
 if had_previous and previous.modified_at=incoming_time then
  if previous.content_version_conflict then return jsonb_build_object('status','conflict','project_id',target); end if;
  if previous.source_version=incoming_version and previous.project_id=target and previous.file_name=payload->>'file_name'
   and previous.url=payload->>'url' and previous.source_path=payload->>'source_path' then
   return jsonb_build_object('status','unchanged');
  end if;
  newer_version:=false;
  if previous.source_version ~ '^[0-9]{1,9}\.[0-9]{1,9}$' and incoming_version ~ '^[0-9]{1,9}\.[0-9]{1,9}$' then
   if array[split_part(incoming_version,'.',1)::bigint,split_part(incoming_version,'.',2)::bigint]
    < array[split_part(previous.source_version,'.',1)::bigint,split_part(previous.source_version,'.',2)::bigint] then
    return jsonb_build_object('status','unchanged');
   end if;
   newer_version:=array[split_part(incoming_version,'.',1)::bigint,split_part(incoming_version,'.',2)::bigint]
    > array[split_part(previous.source_version,'.',1)::bigint,split_part(previous.source_version,'.',2)::bigint];
  end if;
  if not newer_version then
   update public.sharepoint_documents set content_version_conflict=true where source_id=previous.source_id;
   delete from public.sharepoint_file_contents where source_id=previous.source_id;
   return jsonb_build_object('status','conflict','project_id',target);
  end if;
 end if;
 change:=case when had_previous then 'updated' else 'added' end;
 insert into public.sharepoint_documents(source_id,project_id,file_name,url,source_path,modified_at,source_version,content_version_conflict)
 values(payload->>'source_id',target,payload->>'file_name',payload->>'url',payload->>'source_path',incoming_time,incoming_version,false)
 on conflict(source_id) do update set project_id=excluded.project_id,file_name=excluded.file_name,url=excluded.url,source_path=excluded.source_path,
  modified_at=excluded.modified_at,source_version=excluded.source_version,received_at=now(),content_version_conflict=false;
 insert into public.sharepoint_document_events(source_id,project_id,file_name,source_version,modified_at,action)
 values(payload->>'source_id',target,payload->>'file_name',incoming_version,incoming_time,change);
 return jsonb_build_object('status',change,'project_id',target);
end $$;
revoke all on function public.receive_sharepoint_document(jsonb) from public,anon,authenticated;
grant execute on function public.receive_sharepoint_document(jsonb) to service_role;
