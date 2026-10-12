create table public.grant_update_routes(
 sender_id uuid not null references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 primary key(sender_id,recipient_id)
);
alter table public.grant_update_routes enable row level security;
grant select on public.grant_update_routes to authenticated;
revoke insert,update,delete on public.grant_update_routes from anon,authenticated;
create policy grant_routes_read on public.grant_update_routes for select to authenticated using(sender_id=(select auth.uid()) or recipient_id=(select auth.uid()));
insert into public.grant_update_routes(sender_id,recipient_id)
select j.id,w.id from auth.users j cross join auth.users w where lower(j.email)='jtillman@jmaa.com' and lower(w.email)='swashington@jmaa.com'
on conflict do nothing;
alter table public.profiles add column if not exists grant_update_inbox boolean not null default false;
update public.profiles set grant_update_inbox=true where id in(select id from auth.users where lower(email)='swashington@jmaa.com');
alter table public.grant_checkins add column if not exists no_updates boolean not null default false;
alter table public.grant_checkins add column if not exists project_id uuid references public.projects(id) on delete set null;
create index grant_checkins_project_idx on public.grant_checkins(project_id);
create table public.grant_update_notifications(
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 sender_name text not null,
 project_id uuid references public.projects(id) on delete set null,
 project_title text,
 event_type text not null check(event_type in('grant_change','checkin','no_updates')),
 memo text not null default '',
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index grant_notifications_recipient_time on public.grant_update_notifications(recipient_id,created_at desc);
create index grant_notifications_sender_idx on public.grant_update_notifications(sender_id);
create index grant_notifications_project_idx on public.grant_update_notifications(project_id);
create index grant_routes_recipient_idx on public.grant_update_routes(recipient_id);
alter table public.grant_update_notifications enable row level security;
grant select,update(read_at) on public.grant_update_notifications to authenticated;
revoke insert,delete on public.grant_update_notifications from anon,authenticated;
revoke update on public.grant_update_notifications from anon,authenticated;
grant update(read_at) on public.grant_update_notifications to authenticated;
create policy grant_notifications_read on public.grant_update_notifications for select to authenticated using(sender_id=(select auth.uid()) or recipient_id=(select auth.uid()));
create policy grant_notifications_ack on public.grant_update_notifications for update to authenticated using(recipient_id=(select auth.uid())) with check(recipient_id=(select auth.uid()));
create or replace function document_control_private.grant_update_notice()
returns trigger language plpgsql security definer set search_path='' as $$
declare sender_label text; project_label text; target_project uuid; event_kind text; body text;
begin
 if auth.uid() is null then return new; end if;
 if TG_TABLE_NAME='projects' then
  if old.grant_info is not distinct from new.grant_info then return new; end if;
  target_project:=new.id; project_label:=new.title; event_kind:='grant_change'; body:='Grant information was updated for '||new.title||'.';
 else
  if new.user_id<>auth.uid() then raise exception 'Cannot submit another user''s grant update.'; end if;
  target_project:=new.project_id;
  select title into project_label from public.projects where id=target_project;
  event_kind:=case when new.no_updates then 'no_updates' else 'checkin' end;
  body:=case when new.no_updates then 'There are no updates at this time.' else 'Grant '||new.cadence||' check-in submitted.' end;
  if new.note<>'' then body:=body||E'\n\nMemo: '||new.note; end if;
 end if;
 select full_name into sender_label from public.profiles where id=auth.uid();
 insert into public.grant_update_notifications(sender_id,recipient_id,sender_name,project_id,project_title,event_type,memo)
 select auth.uid(),recipient_id,coalesce(sender_label,'Grant staff'),target_project,project_label,event_kind,body
 from public.grant_update_routes where sender_id=auth.uid();
 return new;
end $$;
revoke all on function document_control_private.grant_update_notice() from public,anon,authenticated;
create trigger grant_changes_notify after update of grant_info on public.projects for each row execute function document_control_private.grant_update_notice();
create trigger grant_checkins_notify after insert or update on public.grant_checkins for each row execute function document_control_private.grant_update_notice();
