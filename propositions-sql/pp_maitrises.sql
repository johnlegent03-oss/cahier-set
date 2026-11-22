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

-- Répartitions des évaluations par composante du socle commun : saisie manuelle depuis ÉcoleDirecte.
-- Ces quatre pourcentages ne doivent jamais être inférés des notes.
create table if not exists public."PP_Socle" (
  id uuid primary key default gen_random_uuid(),
  eleve_id text not null,
  classe text not null,
  periode text not null check (periode in ('T1','T2','T3')),
  composante text not null check (composante in ('1.a','1.b','1.c','1.d','2','3','4','5')),
  non_atteint integer not null check (non_atteint between 0 and 100),
  partiellement_atteint integer not null check (partiellement_atteint between 0 and 100),
  atteint integer not null check (atteint between 0 and 100),
  depasse integer not null check (depasse between 0 and 100),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  check (non_atteint+partiellement_atteint+atteint+depasse between 98 and 102),
  unique(created_by,eleve_id,periode,composante)
);
alter table public."PP_Socle" enable row level security;
grant select,insert,update,delete on public."PP_Socle" to authenticated;
drop policy if exists "pp_socle_select_owner" on public."PP_Socle";
create policy "pp_socle_select_owner" on public."PP_Socle"
  for select to authenticated using (created_by=(select auth.uid()));
drop policy if exists "pp_socle_insert_owner" on public."PP_Socle";
create policy "pp_socle_insert_owner" on public."PP_Socle"
  for insert to authenticated with check (created_by=(select auth.uid()));
drop policy if exists "pp_socle_update_owner" on public."PP_Socle";
create policy "pp_socle_update_owner" on public."PP_Socle"
  for update to authenticated using (created_by=(select auth.uid()))
  with check (created_by=(select auth.uid()));
drop policy if exists "pp_socle_delete_owner" on public."PP_Socle";
create policy "pp_socle_delete_owner" on public."PP_Socle"
  for delete to authenticated using (created_by=(select auth.uid()));
