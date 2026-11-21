-- CONTRÔLE APRÈS INSTALLATION : lecture seule
-- À exécuter après propositions-sql/svt_cahier_cas_v1.sql.
-- Ce script ne modifie aucune ligne de Cahier ni les droits.
WITH func AS (
 SELECT p.oid, p.prosecdef, p.provolatile, p.proconfig
 FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
 AND p.proname='svt_cahier_cas_v1'
 AND pg_catalog.pg_get_function_identity_arguments(p.oid)='p_id bigint, p_original jsonb, p_nouveau jsonb'
),
checks AS (
 SELECT
  EXISTS(SELECT 1 FROM func) AS fonction_installee,
  COALESCE((SELECT NOT prosecdef FROM func LIMIT 1), false) AS utilise_security_invoker,
  COALESCE((SELECT has_function_privilege('authenticated', oid, 'EXECUTE') FROM func LIMIT 1), false) AS execute_authentifie,
  COALESCE((SELECT NOT has_function_privilege('anon', oid, 'EXECUTE') FROM func LIMIT 1), false) AS bloque_anonyme,
  COALESCE((SELECT NOT has_function_privilege('PUBLIC', oid, 'EXECUTE') FROM func LIMIT 1), false) AS bloque_public,
  EXISTS(
   SELECT 1
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='Cahier' AND c.relrowsecurity
  ) AS cahier_rls_active
)
SELECT *, (
 fonction_installee
 AND utilise_security_invoker
 AND execute_authentifie
 AND bloque_anonyme
 AND bloque_public
 AND cahier_rls_active
) AS configuration_attendue
FROM checks;
