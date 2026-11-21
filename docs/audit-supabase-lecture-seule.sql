-- AUDIT SUPABASE EN LECTURE SEULE — pas de données d'élèves, ni modifications.
-- Supabase Dashboard -> SQL Editor -> exécuter ce bloc entier.
-- Le résultat contient 7 lignes (section + details au format JSON).
-- Il est possible de copier ces résultats dans ChatGPT pour vérifier les droits.
-- Ne pas copier de clés secrètes, de tokens ni de données nominatives.

WITH
rls AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity,
    'anon_select', has_table_privilege('anon', c.oid, 'SELECT'),
    'anon_insert', has_table_privilege('anon', c.oid, 'INSERT'),
    'anon_update', has_table_privilege('anon', c.oid, 'UPDATE'),
    'anon_delete', has_table_privilege('anon', c.oid, 'DELETE'),
    'authenticated_select', has_table_privilege('authenticated', c.oid, 'SELECT'),
    'authenticated_update', has_table_privilege('authenticated', c.oid, 'UPDATE')
  ) ORDER BY c.relname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
),
policies AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', tablename, 'name', policyname, 'command', cmd,
    'roles', roles, 'using', qual, 'with_check', with_check
  ) ORDER BY tablename, policyname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
),
cahier_columns AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'column', column_name,
    'data_type', data_type,
    'udt_name', udt_name,
    'nullable', is_nullable
  ) ORDER BY ordinal_position), '[]'::jsonb) AS details
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Cahier'
),
cahier_constraints AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', con.conname,
    'definition', pg_catalog.pg_get_constraintdef(con.oid)
  ) ORDER BY con.conname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname='Cahier'
),
public_functions AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', p.oid::regprocedure::text,
    'security_definer', p.prosecdef,
    'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) ORDER BY p.proname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.prosecdef OR p.proname LIKE 'svt_%' OR p.proname LIKE 'planning_%')
),
buckets AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'public', public
  ) ORDER BY id), '[]'::jsonb) AS details
  FROM storage.buckets
),
storage_policies AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', tablename,'name', policyname,'command', cmd,
    'roles', roles,'using', qual,'with_check', with_check
  ) ORDER BY tablename, policyname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
)
SELECT '01_public_tables_rls_and_grants' AS section, details FROM rls
UNION ALL SELECT '02_public_policies', details FROM policies
UNION ALL SELECT '03_Cahier_columns', details FROM cahier_columns
UNION ALL SELECT '04_Cahier_constraints', details FROM cahier_constraints
UNION ALL SELECT '05_public_functions', details FROM public_functions
UNION ALL SELECT '06_storage_buckets', details FROM buckets
UNION ALL SELECT '07_storage_objects_policies', details FROM storage_policies
ORDER BY section;
