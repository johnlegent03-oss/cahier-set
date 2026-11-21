-- TEST D'UNE SAUVEGARDE ATOMIQUE ET D'UN CONFLIT (TRANSACTION ANNULÉE)
-- Supabase > SQL Editor : exécuter le script EN ENTIER.
-- Aucune donnée scolaire ne reste modifiée après ROLLBACK.
-- La requête sélectionne un professeur autorisé et un cahier existant.
-- Elle teste l'enregistrement puis une tentative obsolète sous le rôle
-- authenticated, conformément à la documentation Supabase de test RLS.
-- IMPORTANT : ne pas retirer ROLLBACK et ne pas remplacer par COMMIT.
-- Réserver ce test à un moment où personne n'édite le site simultanément.
--
-- Le résultat attendu juste avant ROLLBACK :
-- premiere_sauvegarde = 1, seconde_obsolete = 0,
-- refus_sans_acces = 0, test_concluant = true.
--
-- Si la requête échoue, ne PAS fusionner la PR GitHub n° 6.
-- Si le SQL Editor a ouvert une transaction qui reste interrompue, exécuter
-- séparément ROLLBACK pour la fermer.

BEGIN;

DO $verification$
DECLARE
  v_professeur uuid;
  v_cahier_id bigint;
  v_original jsonb;
  v_modifie jsonb;
  v_premiere integer;
  v_seconde integer;
  v_sans_acces integer;
BEGIN
  -- Cette information reste dans la requête ; aucun identifiant n'est affiché.
  SELECT pa.user_id INTO v_professeur
  FROM public.professor_access AS pa
  WHERE pa.user_id IS NOT NULL
  ORDER BY pa.user_id
  LIMIT 1;

  IF v_professeur IS NULL THEN
    RAISE EXCEPTION 'Aucun professeur autorisé trouvé : test annulé';
  END IF;

  SELECT c.id, c.contenu INTO v_cahier_id, v_original
  FROM public."Cahier" AS c
  WHERE c.contenu IS NOT NULL
    AND pg_catalog.jsonb_typeof(c.contenu)='object'
  ORDER BY c.id
  LIMIT 1;

  IF v_cahier_id IS NULL THEN
    RAISE EXCEPTION 'Aucun cahier au format JSON objet : test annulé';
  END IF;

  IF v_original ? '__svt_test_sauvegarde_atomique__' THEN
    RAISE EXCEPTION 'Nom de champ de test déjà présent : test annulé';
  END IF;

  v_modifie := pg_catalog.jsonb_set(
    v_original,
    '{__svt_test_sauvegarde_atomique__}',
    'true'::jsonb,
    true
  );

  -- Reproduire les droits d'une vraie requête de professeur connecté.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',v_professeur::text,true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub',v_professeur::text,'role','authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Premier onglet : doit écrire une ligne.
  SELECT count(*) INTO v_premiere
  FROM public.svt_cahier_cas_v1(v_cahier_id,v_original,v_modifie);

  -- Deuxième onglet : reprend l'ancienne version ; doit être refusé.
  SELECT count(*) INTO v_seconde
  FROM public.svt_cahier_cas_v1(v_cahier_id,v_original,v_original);

  -- Simuler un compte connecté SANS droit professeur, sans modifier le rôle.
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true
  );
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',
    true
  );
  SELECT count(*) INTO v_sans_acces
  FROM public.svt_cahier_cas_v1(v_cahier_id,v_modifie,v_original);

  -- Les résultats sont conservés uniquement dans des paramètres locaux
  -- pour pouvoir afficher une seule ligne de résultats après ce bloc.
  PERFORM pg_catalog.set_config('svt_test.premiere',v_premiere::text,true);
  PERFORM pg_catalog.set_config('svt_test.seconde',v_seconde::text,true);
  PERFORM pg_catalog.set_config('svt_test.sans_acces',v_sans_acces::text,true);
END;
$verification$;

SELECT
  current_setting('svt_test.premiere',true)::integer AS premiere_sauvegarde,
  current_setting('svt_test.seconde',true)::integer AS seconde_obsolete,
  current_setting('svt_test.sans_acces',true)::integer AS refus_sans_acces,
  (
    current_setting('svt_test.premiere',true) = '1'
    AND current_setting('svt_test.seconde',true) = '0'
    AND current_setting('svt_test.sans_acces',true) = '0'
  ) AS test_concluant;

-- Annulation totale, y compris le champ temporaire ajouté au cahier.
ROLLBACK;
