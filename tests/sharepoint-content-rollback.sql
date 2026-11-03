-- Synthetic database metadata fixtures only. Nothing commits and no original
-- project, SharePoint file, or storage file is changed. The temporary storage
-- metadata row is NOT an uploaded file; end-to-end byte delivery is a separate
-- Storage API / Power Automate check.
begin;
do $$
declare p uuid:=gen_random_uuid(); src text:=gen_random_uuid()::text||':1'; folder text;
 request jsonb; cached jsonb; result jsonb; object_path text;
begin
 folder:='https://jmaait.sharepoint.com/sites/CapitalProgramming/Shared%20Documents/JAN-CPT-rollback-'||p::text;
 insert into public.projects(id,title,sharepoint_folder_url) values(p,'JAN CPT rollback verification',folder);
 request:=jsonb_build_object('source_id',src,'project_id',p,'mapping_url',folder,'file_name','fixture.txt','url',folder||'/fixture.txt',
  'source_path','/sites/CapitalProgramming/Shared Documents/JAN-CPT-rollback-'||p::text||'/fixture.txt','modified_at','2026-11-01T12:00:00Z','source_version','1.9');
 result:=public.receive_sharepoint_document(request);
 if result->>'status'<>'added' then raise exception 'Initial metadata did not add'; end if;
 if public.receive_sharepoint_document(request)->>'status'<>'unchanged' then raise exception 'Duplicate metadata not ignored'; end if;
 request:=request||jsonb_build_object('source_version','1.10');
 if public.receive_sharepoint_document(request)->>'status'<>'updated' then raise exception 'Numeric 1.10 must follow 1.9 at equal time'; end if;
 if public.receive_sharepoint_document(request||jsonb_build_object('source_version','1.2'))->>'status'<>'unchanged' then raise exception 'Older equal-time version accepted'; end if;
 object_path:=p::text||'/'||repeat('a',64)||'/'||repeat('b',64)||'/'||repeat('c',64)||'.txt';
 insert into storage.objects(bucket_id,name,metadata) values('sharepoint-ai',object_path,'{"size":5,"mimetype":"text/plain"}');
 cached:=jsonb_build_object('source_id',src,'project_id',p,'storage_path',object_path,'size_bytes',5,'source_modified_at',request->>'modified_at','source_version','1.10','file_name','fixture.txt');
 if public.cache_sharepoint_file_contents(cached)->>'content_status'<>'cached' then raise exception 'Current contents were not linked'; end if;
 if public.cache_sharepoint_file_contents(cached)->>'content_status'<>'unchanged' then raise exception 'Identical retry did not reuse pointer'; end if;
 if public.cache_sharepoint_file_contents(cached||jsonb_build_object('source_version','1.9'))->>'content_status'<>'stale' then raise exception 'Older version was linked'; end if;
 if public.cache_sharepoint_file_contents(cached||jsonb_build_object('source_modified_at','2026-10-31T12:00:00Z'))->>'content_status'<>'stale' then raise exception 'Older timestamp was linked'; end if;
 if public.cache_sharepoint_file_contents(cached||jsonb_build_object('size_bytes',6))->>'content_status'<>'conflict' then raise exception 'Conflicting bytes replaced same-version pointer'; end if;
 if (select size_bytes from public.sharepoint_file_contents where source_id=src)<>5 then raise exception 'Conflict changed cache'; end if;
 perform set_config('jan.test.source',src,true);perform set_config('jan.test.path',object_path,true);
 perform set_config('jan.test.request',request::text,true);perform set_config('jan.test.cached',cached::text,true);
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
end $$;

set local role authenticated;
do $$
begin
 if (select count(*) from public.sharepoint_file_contents where source_id=current_setting('jan.test.source'))<>1 then raise exception 'Visible project cache is unreadable'; end if;
 if (select count(*) from storage.objects where bucket_id='sharepoint-ai' and name=current_setting('jan.test.path'))<>1 then raise exception 'Current linked object is unreadable'; end if;
 if has_table_privilege(current_user,'public.sharepoint_file_contents','INSERT,UPDATE,DELETE') then raise exception 'Client has cache write grants'; end if;
 if has_function_privilege(current_user,'public.cache_sharepoint_file_contents(jsonb)','EXECUTE') then raise exception 'Client can invoke cache RPC'; end if;
 begin
  perform public.cache_sharepoint_file_contents(current_setting('jan.test.cached')::jsonb);
  raise exception 'Client cache RPC unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
 begin
  insert into storage.objects(bucket_id,name) values('sharepoint-ai',current_setting('jan.test.path')||'-denied');
  raise exception 'Client storage insert unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Changing the metadata version immediately makes old storage bytes invisible.
select public.receive_sharepoint_document(current_setting('jan.test.request')::jsonb||'{"source_version":"2.0"}'::jsonb);
set local role authenticated;
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='sharepoint-ai' and name=current_setting('jan.test.path')) then raise exception 'Stale storage object stayed visible'; end if;
end $$;
reset role;

-- Unknown same-time version ordering fails closed and cannot be reopened by
-- replaying the former version. Only a strictly newer timestamp resolves it.
do $$
declare request jsonb:=current_setting('jan.test.request')::jsonb; cached jsonb:=current_setting('jan.test.cached')::jsonb;
begin
 if public.receive_sharepoint_document(request||'{"source_version":"unknown-version"}'::jsonb)->>'status'<>'conflict' then raise exception 'Unknown equal-time version did not fail closed'; end if;
 if not (select content_version_conflict from public.sharepoint_documents where source_id=current_setting('jan.test.source')) then raise exception 'Conflict flag missing'; end if;
 if exists(select 1 from public.sharepoint_file_contents where source_id=current_setting('jan.test.source')) then raise exception 'Conflict cache stayed linked'; end if;
 if public.receive_sharepoint_document(request||'{"source_version":"2.0"}'::jsonb)->>'status'<>'conflict' then raise exception 'Replay cleared conflict'; end if;
 if public.cache_sharepoint_file_contents(cached||'{"source_version":"2.0"}'::jsonb)->>'content_status'<>'stale' then raise exception 'Conflicted metadata accepted contents'; end if;
 if public.receive_sharepoint_document(request||'{"source_version":"2.1","modified_at":"2026-11-02T12:00:00Z"}'::jsonb)->>'status'<>'updated' then raise exception 'New timestamp did not resolve conflict'; end if;
 if (select content_version_conflict from public.sharepoint_documents where source_id=current_setting('jan.test.source')) then raise exception 'Conflict flag remained after new timestamp'; end if;
end $$;

set local role anon;
do $$ begin
 if has_table_privilege(current_user,'public.sharepoint_file_contents','SELECT') then raise exception 'Anonymous cache read granted'; end if;
 if has_function_privilege(current_user,'public.cache_sharepoint_file_contents(jsonb)','EXECUTE') then raise exception 'Anonymous cache RPC granted'; end if;
 if exists(select 1 from storage.objects where bucket_id='sharepoint-ai' and name=current_setting('jan.test.path')) then raise exception 'Anonymous storage bytes visible'; end if;
end $$;
reset role;
select 'PASS: metadata versions, cache retry/conflict, authenticated RLS, stale-content denial, anonymous denial; all fixtures rolled back' as verification;
rollback;
