alter table public.documents
 add column if not exists revision_parent_id uuid references public.documents(id) on delete restrict,
 add column if not exists revision_no integer not null default 1,
 add column if not exists review_status text not null default 'draft' check (review_status in ('draft','review','approved','superseded','archived')),
 add column if not exists revision_note text not null default '',
 add column if not exists approved_at timestamptz,
 add column if not exists approved_by uuid references public.profiles(id);
create index if not exists documents_revision_parent on public.documents(revision_parent_id);
create unique index if not exists documents_one_approved on public.documents((coalesce(revision_parent_id,id))) where review_status='approved';
create unique index if not exists documents_unique_revision on public.documents((coalesce(revision_parent_id,id)),revision_no);

create table if not exists public.document_activity (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.documents(id) on delete restrict,
 project_id uuid not null references public.projects(id) on delete cascade,
 action text not null,
 actor uuid references public.profiles(id),
 actor_name text,
 detail text not null default '',
 created_at timestamptz not null default now()
);
alter table public.document_activity enable row level security;
grant select on public.document_activity to authenticated;
revoke insert,update,delete on public.document_activity from anon,authenticated;
create policy document_activity_read on public.document_activity for select to authenticated using (auth.uid() is not null);

create schema if not exists document_control_private;
revoke all on schema document_control_private from public,anon,authenticated;
create or replace function document_control_private.record_activity()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor_name_value text;
begin
 if auth.uid() is null then return new; end if;
 select full_name into actor_name_value from public.profiles where id=auth.uid();
 insert into public.document_activity(document_id,project_id,action,actor,actor_name,detail)
 values(new.id,new.project_id,
 case when TG_OP='INSERT' then case when new.revision_parent_id is null then 'uploaded' else 'revision uploaded' end
      when old.review_status is distinct from new.review_status then new.review_status else 'details updated' end,
 auth.uid(),actor_name_value,
 'Revision '||new.revision_no||' · '||new.label||case when new.revision_note<>'' then ' · '||new.revision_note else '' end);
 return new;
end $$;
revoke all on function document_control_private.record_activity() from public,anon,authenticated;
create trigger documents_activity after insert or update on public.documents for each row execute function document_control_private.record_activity();

create or replace function public.enforce_document_control()
returns trigger language plpgsql security invoker set search_path=public as $$
declare root_record public.documents; root_id uuid;
begin
 if TG_OP='DELETE' then
   raise exception 'Archive documents to preserve their files and revision history.';
 end if;
 if auth.uid() is null or not public.is_editor() then
   raise exception 'An editor account is required to change documents.';
 end if;
 root_id:=coalesce(new.revision_parent_id,new.id);
 if new.revision_parent_id is not null then
   select * into root_record from public.documents where id=new.revision_parent_id for update;
   if not found or root_record.revision_parent_id is not null or root_record.project_id<>new.project_id then
     raise exception 'Revisions must belong to an original document in the same project.';
   end if;
 elsif TG_OP='UPDATE' then
   perform 1 from public.documents where id=new.id for update;
 end if;
 if TG_OP='INSERT' then
   new.review_status:='draft';
   new.approved_at:=null; new.approved_by:=null;
   if new.revision_parent_id is null then new.revision_no:=1;
   else
     if root_record.review_status='archived' then raise exception 'Restore the original document before adding a revision.'; end if;
     if not ((new.kind='file' and coalesce(new.storage_path,'')<>'') or (new.kind='link' and new.url ~* '^https?://')) then
       raise exception 'A new revision needs a file or web link.';
     end if;
     select coalesce(max(revision_no),0)+1 into new.revision_no from public.documents where id=root_id or revision_parent_id=root_id;
   end if;
 else
   if new.id<>old.id or new.project_id<>old.project_id or new.revision_parent_id is distinct from old.revision_parent_id or new.revision_no<>old.revision_no then
     raise exception 'A document cannot move to another project or revision group.';
   end if;
   if ((old.kind='file' and coalesce(old.storage_path,'')<>'') or old.url ~* '^https?://')
      and (new.kind is distinct from old.kind or new.storage_path is distinct from old.storage_path or new.url is distinct from old.url or new.file_name is distinct from old.file_name or new.size_bytes is distinct from old.size_bytes) then
      raise exception 'Upload a new revision to change this file or link.';
   end if;
   if old.review_status='approved' and new.review_status='approved' and (new.label is distinct from old.label or new.category is distinct from old.category or new.revision_note is distinct from old.revision_note) then
      raise exception 'Return an approved document to Draft before editing its details.';
   end if;
   if new.review_status='approved' and old.review_status is distinct from 'approved' then
     if not ((new.kind='file' and coalesce(new.storage_path,'')<>'') or new.url ~* '^https?://') then raise exception 'Attach a file or link before approval.'; end if;
     update public.documents set review_status='superseded' where (id=root_id or revision_parent_id=root_id) and id<>new.id and review_status='approved';
     new.approved_at:=now(); new.approved_by:=auth.uid();
   elsif new.review_status<>'approved' then
     new.approved_at:=null; new.approved_by:=null;
   else new.approved_at:=old.approved_at; new.approved_by:=old.approved_by;
   end if;
 end if;
 new.updated_by:=auth.uid();
 return new;
end $$;
revoke all on function public.enforce_document_control() from public,anon,authenticated;
create trigger documents_control before insert or update or delete on public.documents for each row execute function public.enforce_document_control();
