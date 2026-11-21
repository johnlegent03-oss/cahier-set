-- CONTRÔLE DE SÉCURITÉ CIBLÉ — LECTURE SEULE
-- À exécuter dans Supabase SQL Editor. N'effectue aucune modification.
-- Avant de partager les résultats, retirer toute clé, tout code d'accès
-- ou toute information sensible éventuellement inscrite dans une définition.

WITH declencheurs_evenement AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'nom', evt.evtname,
    'evenement', evt.evtevent,
    'actif', evt.evtenabled,
    'fonction', p.oid::regprocedure::text
  ) ORDER BY evt.evtname), '[]'::jsonb) AS details
  FROM pg_catalog.pg_event_trigger evt
  JOIN pg_catalog.pg_proc p ON p.oid = evt.evtfoid
  WHERE p.proname = 'rls_auto_enable'
),
fonction_fiche_publique AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', p.oid::regprocedure::text,
    'code_sql', pg_catalog.pg_get_functiondef(p.oid)
  )), '[]'::jsonb) AS details
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'svt_lire_fiche_publiee_v1'
)
SELECT '01_declencheurs_evenement' AS section, details FROM declencheurs_evenement
UNION ALL
SELECT '02_definition_fiche_publique', details FROM fonction_fiche_publique
ORDER BY section;
