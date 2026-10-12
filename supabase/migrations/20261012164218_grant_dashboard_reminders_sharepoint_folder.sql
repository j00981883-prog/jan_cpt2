alter table public.profiles add column if not exists dashboard_designation text;
alter table public.profiles add column if not exists grant_daily_reminder boolean not null default false;
alter table public.profiles add column if not exists grant_weekly_reminder boolean not null default false;
alter table public.projects add column if not exists sharepoint_folder_url text;
create table public.grant_checkins (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 cadence text not null check(cadence in ('daily','weekly')),
 period_start date not null,
 completed_at timestamptz not null default now(),
 note text not null default '',
 unique(user_id,cadence,period_start)
);
alter table public.grant_checkins enable row level security;
revoke all on public.grant_checkins from anon;
grant select,insert,update on public.grant_checkins to authenticated;
create policy grant_checkins_read on public.grant_checkins for select to authenticated using(user_id=(select auth.uid()));
create policy grant_checkins_insert on public.grant_checkins for insert to authenticated with check(user_id=(select auth.uid()));
create policy grant_checkins_update on public.grant_checkins for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
update public.profiles set dashboard_designation='Boss / Grants',grant_daily_reminder=true,grant_weekly_reminder=true
where id in(select id from auth.users where lower(email)='jtillman@jmaa.com');
