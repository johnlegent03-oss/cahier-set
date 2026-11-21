-- Contrôle ciblé après l'audit des politiques Supabase.
-- LECTURE SEULE : aucune ligne n'est créée, modifiée ou supprimée.
-- Résultat : métadonnées des fonctions, doublons de classes et formats JSON.
-- Ne contient aucun nom, note, observation ou document d'élève.

WITH fonctions AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', p.oid::regprocedure::text,
    'return_type', pg_get_function_result(p.oid),
    'security_definer', p.prosecdef,
    'search_path_config', p.proconfig,
    'anonymous_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) ORDER BY p.proname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('rls_auto_enable', 'svt_lire_fiche_publiee_v1', 'svt_cahier_cas_v1')
),
declencheurs AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'function', p.proname, 'trigger', t.tgname, 'table', c.relname
  ) ORDER BY p.proname, t.tgname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE NOT t.tgisinternal
    AND n.nspname='public'
    AND p.proname IN ('rls_auto_enable', 'svt_lire_fiche_publiee_v1')
),
doublons AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'classe', classe, 'nombre', nombre
  ) ORDER BY classe), '[]'::jsonb) AS details
  FROM (
    SELECT classe, count(*) AS nombre
    FROM public."Cahier"
    GROUP BY classe
    HAVING count(*)>1
  ) q
),
formats AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'format_json', format_json, 'nombre', nombre
  ) ORDER BY format_json), '[]'::jsonb) AS details
  FROM (
    SELECT COALESCE(jsonb_typeof(contenu),'sql_null') AS format_json,
           count(*) AS nombre
    FROM public."Cahier"
    GROUP BY 1
  ) q
)
SELECT '01_functions_metadata' AS section, details FROM fonctions
UNION ALL SELECT '02_trigger_usages', details FROM declencheurs
UNION ALL SELECT '03_duplicate_classes', details FROM doublons
UNION ALL SELECT '04_Cahier_json_formats', details FROM formats
ORDER BY section;

-- Contrôle facultatif après vérification du résultat précédent :
-- Examiner manuellement le code des fonctions SECURITY DEFINER.
-- Certains corps de fonctions peuvent contenir des constantes sensibles ;
-- NE PAS partager un résultat contenant des secrets d'administration.
--
-- SELECT p.oid::regprocedure::text AS signature,
--        pg_get_functiondef(p.oid) AS definition
-- FROM pg_catalog.pg_proc p
-- JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public'
--   AND p.proname IN ('rls_auto_enable', 'svt_lire_fiche_publiee_v1');
