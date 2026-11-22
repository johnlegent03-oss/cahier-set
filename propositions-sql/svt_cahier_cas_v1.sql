-- PROPOSITION À VALIDER — ne s'exécute pas automatiquement.
-- Pré-requis :
--   public."Cahier"(id bigint, contenu jsonb)
--   RLS et politiques SELECT/UPDATE vérifiées sur public."Cahier"
--
-- Une seule instruction UPDATE atomique compare l'ancienne version du JSONB
-- et écrit la nouvelle version. Si la ligne a changé, 0 ligne est renvoyée :
-- les clients prof.html et atelier.html refusent alors la sauvegarde.
--
-- Ce script ne crée ni ne modifie les politiques RLS.
-- La fonction s'exécute en SECURITY INVOKER, donc avec les droits du demandeur.
-- ATTENTION : avant toute mise en production, tester les rôles et le conflit
-- dans le projet Supabase (aucun test SQL live n'est exécuté dans cette PR).

BEGIN;

CREATE OR REPLACE FUNCTION public.svt_cahier_cas_v1(
    p_id bigint,
    p_original jsonb,
    p_nouveau jsonb
)
RETURNS TABLE(cahier_id bigint, cahier_contenu jsonb)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    UPDATE public."Cahier" AS c
       SET contenu = p_nouveau
     WHERE c.id = p_id
       AND c.contenu IS NOT DISTINCT FROM p_original
       AND (SELECT auth.uid()) IS NOT NULL
    RETURNING c.id, c.contenu;
$$;

-- Ne pas laisser l'exécution publique implicite par défaut.
REVOKE ALL ON FUNCTION public.svt_cahier_cas_v1(bigint, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.svt_cahier_cas_v1(bigint, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.svt_cahier_cas_v1(bigint, jsonb, jsonb) TO authenticated;

COMMIT;

-- Rafraîchissement du cache de schéma PostgREST.
NOTIFY pgrst, 'reload schema';
