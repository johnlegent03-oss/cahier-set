-- PP : compétences ÉcoleDirecte, données privées par compte et année scolaire.
begin;
create table if not exists public."PP_Competences" (
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  eleve_id text not null,
  classe text not null,
  annee text not null check (annee ~ '^[0-9]{4}/[0-9]{4}$'),
  periode text not null check (periode in ('T1','T2','T3')),
  competences jsonb not null check (jsonb_typeof(competences) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, eleve_id, classe, annee, periode)
);
alter table public."PP_Competences" enable row level security;
revoke all on public."PP_Competences" from public, anon, authenticated;
grant select, insert, update on public."PP_Competences" to authenticated;
drop policy if exists pp_comp_select on public."PP_Competences";
drop policy if exists pp_comp_insert on public."PP_Competences";
drop policy if exists pp_comp_update on public."PP_Competences";
create policy pp_comp_select on public."PP_Competences" for select to authenticated
using ((select auth.uid()) = owner_id and (select auth.jwt()->>'aal') = 'aal2');
create policy pp_comp_insert on public."PP_Competences" for insert to authenticated
with check ((select auth.uid()) = owner_id and (select auth.jwt()->>'aal') = 'aal2');
create policy pp_comp_update on public."PP_Competences" for update to authenticated
using ((select auth.uid()) = owner_id and (select auth.jwt()->>'aal') = 'aal2')
with check ((select auth.uid()) = owner_id and (select auth.jwt()->>'aal') = 'aal2');
commit;
