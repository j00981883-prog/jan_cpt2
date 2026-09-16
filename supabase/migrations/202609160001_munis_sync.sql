-- Preview-only staging for automated MUNIS reports.
-- Raw report data is visible only to editors. The Edge Function writes with
-- the service role; browser clients cannot insert or alter sync runs.

create table if not exists public.munis_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  report_name    text not null,
  report_hash    text not null unique,
  source         text not null default 'SharePoint / OneDrive',
  status         text not null default 'preview'
                 check (status in ('preview', 'approved', 'rejected', 'applied', 'error')),
  report_date    date,
  row_count      integer not null default 0,
  matched_count  integer not null default 0,
  change_count   integer not null default 0,
  preview        jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid references public.profiles (id)
);

alter table public.munis_sync_runs enable row level security;

drop policy if exists munis_sync_editor_read on public.munis_sync_runs;
create policy munis_sync_editor_read on public.munis_sync_runs
  for select using (public.is_editor());

comment on table public.munis_sync_runs is
  'Preview-only staging and audit records for MUNIS report imports.';
