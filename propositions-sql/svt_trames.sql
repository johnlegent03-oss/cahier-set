-- À exécuter une seule fois dans Supabase > SQL Editor.
-- Bibliothèque personnelle de trames pédagogiques ; aucun accès élève.
create table if not exists public.svt_trames (
  owner_id uuid not null references auth.users(id) on delete cascade,
  niveau text not null check (niveau in ('6e','5e','4e','3e')),
  contenu jsonb not null default '{"chapitres":[]}'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id,niveau),
  constraint svt_trames_contenu_objet check (jsonb_typeof(contenu) = 'object')
);
alter table public.svt_trames enable row level security;
drop policy if exists svt_trames_select_own on public.svt_trames;
drop policy if exists svt_trames_insert_own on public.svt_trames;
drop policy if exists svt_trames_update_own on public.svt_trames;
drop policy if exists svt_trames_delete_own on public.svt_trames;
create policy svt_trames_select_own on public.svt_trames
 for select to authenticated using (owner_id = (select auth.uid()));
create policy svt_trames_insert_own on public.svt_trames
 for insert to authenticated with check (owner_id = (select auth.uid()));
create policy svt_trames_update_own on public.svt_trames
 for update to authenticated using (owner_id = (select auth.uid()))
 with check (owner_id = (select auth.uid()));
create policy svt_trames_delete_own on public.svt_trames
 for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.svt_trames from anon;
grant select,insert,update,delete on public.svt_trames to authenticated;

-- Contrôle : les politiques doivent être actives et la table accessible.
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname='public' and tablename='svt_trames';
