# Proposition : sauvegardes atomiques du cahier numérique

## Statut

**Ne pas fusionner la PR n° 6 ni exécuter le SQL sans vérification préalable des droits Supabase et sauvegarde de la base.** Ce dossier n'est pas une migration automatiquement déployée. La base Supabase réelle n'a pas été modifiée.

## Risque évité

L'ancien fonctionnement relisait `Cahier.contenu` puis exécutait un `UPDATE` séparé. Si deux onglets éditaient le même cahier, le second pouvait écraser la version du premier entre ces deux opérations. L'atelier utilisait également une mise à jour non conditionnelle de tout le JSON pour insérer un lien de fiche.

## Fonction proposée

Le fichier `propositions-sql/svt_cahier_cas_v1.sql` crée la fonction `public.svt_cahier_cas_v1` :

- paramètres `p_id bigint`, `p_original jsonb`, `p_nouveau jsonb` ;
- une seule instruction `UPDATE ... WHERE contenu IS NOT DISTINCT FROM p_original RETURNING ...` ;
- résultat : une ligne pour un enregistrement réussi, zéro ligne en cas de contenu modifié, d'absence ou de droit RLS insuffisant ;
- exécution **SECURITY INVOKER** (les politiques RLS de `Cahier` restent applicables) ;
- droit d'exécution accordé uniquement au rôle `authenticated`, révoqué de `PUBLIC` et `anon`.

Le contenu **anciennement enregistré comme chaîne JSON** est conservé sous la même forme dans les deux interfaces.

## Ordre de déploiement impératif

1. Faire une sauvegarde de `Cahier` et vérifier les politiques RLS `SELECT` et `UPDATE` pour le compte professeur. Vérifier qu'une session élève ou anonyme ne peut pas exécuter une modification.
2. Vérifier que les colonnes `id` et `contenu` ont bien respectivement les types `bigint` et `jsonb`.
3. Tester et installer la fonction SQL **dans un environnement de préproduction**, sous un compte disposant des droits requis. Rafraîchir le schéma PostgREST.
4. Effectuer **deux lectures sur le même cahier**, puis une écriture depuis l'onglet A, puis une tentative depuis l'onglet B avec l'ancienne version : l'onglet B doit recevoir **zéro ligne modifiée**, sans perdre les changements de A.
5. Tester la création d'un cahier, la sauvegarde manuelle, l'autosauvegarde, l'archivage, l'ajout de séance, le déplacement, et l'ajout d'un lien depuis l'atelier.
6. Tester un appel sans authentification, un compte non habilité, une ligne absente, un cahier stocké comme objet JSON et un cahier stocké comme chaîne JSON.
7. Seulement après ces tests, installer la fonction sur le projet de production, puis déployer simultanément les fichiers frontaux des deux interfaces.

**Sans la fonction SQL**, les deux interfaces de la proposition refusent la mise à jour d'un cahier existant et affichent une erreur explicite. Elles n'effectuent pas de retour au vieux `UPDATE` non protégé.

## Limites

- La fonction empêche l'écrasement ; elle ne fusionne pas automatiquement deux éditions concurrentes.
- Une ligne manquante et un refus RLS renvoient le même résultat vide que le conflit. Le message utilisateur reste volontairement prudent.
- Les autres applications, scripts ou versions anciennes du site qui font encore un `UPDATE` non conditionnel ne sont **pas** protégés contre l'écrasement. Il faudra supprimer ces anciens chemins avant de revendiquer une protection de bout en bout.
- La sauvegarde de `atelier_documents` est indépendante de l'insertion du lien dans `Cahier` ; si celle-ci échoue, le document peut être conservé dans la banque sans lien.
- La migration et les tests RLS SQL ne peuvent pas être exécutés avec l'accès GitHub seul.

## Contrôles Supabase réalisés le 21 novembre 2026

Résultats fournis par le professeur à partir des requêtes de lecture seule :

- `public."Cahier"` contient bien `id bigint` et `contenu jsonb`.
- Aucun doublon de `classe` constaté à la date du contrôle ; il n'existe cependant pas de contrainte SQL UNIQUE `classe` dans les contraintes remontées. Ne pas ajouter automatiquement cette contrainte sans vérifier les flux existants.
- Les 11 cahiers ont `jsonb_typeof(contenu) = 'object'`. Le code de compatibilité avec les anciens objets enregistrés sous forme de chaîne JSON reste présent, mais ce format n'existe pas dans les 11 lignes vérifiées.
- Les tables concernées ont RLS activé. `Cahier` autorise les lectures publiques, ainsi que les écritures authentifiées si `professor_access` contient le compte utilisateur. Ces politiques doivent rester valides pour le RPC `SECURITY INVOKER`.
- `svt_cahier_cas_v1` est absent de la liste des fonctions installées. Le SQL est une **proposition non appliquée**.
- Les fonctions `rls_auto_enable()` et `svt_lire_fiche_publiee_v1(text,text)` sont marquées `SECURITY DEFINER`. La seconde est exécutée anonymement pour la lecture de fiches : inspecter ses garde-fous avant tout changement de droits.
- La requête précédente cherchait les déclencheurs de table (`pg_trigger`) et non les déclencheurs d'événement (`pg_event_trigger`). L'absence de déclencheur dans sa réponse n'autorise pas à conclure que `rls_auto_enable()` est inutilisée. Le contrôle correct est dans `docs/audit-supabase-fonctions-publiques.sql`.
- Le bucket `documents` est public et `qcu-copies` est privé. Ne pas déposer d'évaluations ou de corrections nominatives dans un bucket public.

### Point restant à examiner

Exécuter **uniquement en lecture seule** `docs/audit-supabase-fonctions-publiques.sql`, puis examiner ses résultats en masquant toute valeur confidentielle éventuellement incluse dans le code SQL de la fonction publique.

Les vérifications de concurrence et RLS en conditions réelles ne sont pas encore réalisées. **Interdiction de fusionner cette phase tant qu'elles n'ont pas été validées.**
