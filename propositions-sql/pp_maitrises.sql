-- À exécuter dans l'éditeur SQL Supabase AVANT d'activer la fonctionnalité.
-- Les notes PP_Moyennes restent inchangées. Les maîtrises sont indépendantes.
create table if not exists public."PP_Maitrises" (
  id uuid primary key default gen_random_uuid(),
  eleve_id text not null,
  classe text not null,
  periode text not null check (periode in ('T1','T2','T3')),
  discipline text not null,
  niveau text not null check (niveau in ('TBM','MS','MF','MI')),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (created_by,eleve_id,periode,discipline)
);
alter table public."PP_Maitrises" enable row level security;
grant select,insert,update,delete on table public."PP_Maitrises" to authenticated;
drop policy if exists "pp_maitrises_select_owner" on public."PP_Maitrises";
create policy "pp_maitrises_select_owner" on public."PP_Maitrises"
  for select to authenticated using (created_by=(select auth.uid()));
drop policy if exists "pp_maitrises_insert_owner" on public."PP_Maitrises";
create policy "pp_maitrises_insert_owner" on public."PP_Maitrises"
  for insert to authenticated with check (created_by=(select auth.uid()));
drop policy if exists "pp_maitrises_update_owner" on public."PP_Maitrises";
create policy "pp_maitrises_update_owner" on public."PP_Maitrises"
  for update to authenticated using (created_by=(select auth.uid()))
  with check (created_by=(select auth.uid()));
drop policy if exists "pp_maitrises_delete_owner" on public."PP_Maitrises";
create policy "pp_maitrises_delete_owner" on public."PP_Maitrises"
  for delete to authenticated using (created_by=(select auth.uid()));
