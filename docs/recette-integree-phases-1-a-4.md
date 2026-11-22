# Recette intégrée : phases 1 à 4

## État des prérequis vérifiés

La fonction PostgreSQL `public.svt_cahier_cas_v1(bigint,jsonb,jsonb)` a été installée par l'utilisateur sur son projet Supabase et vérifiée à l'aide de la requête de contrôle des autorisations :

| Contrôle | Résultat |
| --- | --- |
| Fonction installée | true |
| SECURITY INVOKER | true |
| Exécution authentifiée | true |
| Exécution anon bloquée | true |
| Exécution PUBLIC bloquée | true |
| RLS sur Cahier | true |
| Configuration attendue | true |

Le test transactionnel avec `ROLLBACK` a également obtenu :
- première écriture : 1 ;
- deuxième écriture fondée sur une ancienne version : 0 ;
- écriture sans autorisation professeur : 0 ;
- `test_concluant` : true.

**Ces résultats confirment le comportement de la fonction dans les conditions SQL simulées, mais ne suffisent pas à valider l'interface navigateur, la session réelle et les droits de tous les utilisateurs.**

## Ce que contient la branche intégrée

La branche `stabilisation/recette-phases-1-a-4` part de la branche de recette 1 à 3 et ajoute :
- `prof.html` : sauvegarde du cahier avec RPC atomique ; erreur claire en cas de conflit ;
- `atelier.html` : ajout de lien à une séance via RPC, avec contrôle de l'identité de séance ;
- `tests/cahier-concurrence.test.cjs` : tests simulés des enregistrements concurrents.

Les correctifs 1 à 3 demeurent identiques dans cette branche. La protection n'est effective **que pour le code de ces interfaces**, et pas pour des anciennes copies du site qui écrivent encore le JSON directement.

## Préparer la recette sans risquer les données

**Ne pas fusionner cette PR, ne pas déployer GitHub Pages sur cette branche directement et ne pas tester dans une classe active.**

1. Vérifier qu'une sauvegarde vérifiée de `Cahier` existe.
2. Utiliser un environnement de préproduction Supabase ou une classe dédiée `TEST` si cette classe n'est pas utilisée dans la vraie scolarité. La branche contient toujours les paramètres du client Supabase de production : un aperçu statique ouvert en local pourrait se connecter à la vraie base !
3. Lors d'un essai via un vrai navigateur, confirmer la connexion professeur à deux facteurs, la lecture de la classe test et une première sauvegarde.
4. Ouvrir le cahier test dans deux onglets A et B. Dans A, modifier puis enregistrer. Dans B, modifier depuis l'ancienne version et enregistrer. B **doit refuser l'écriture** et conserver une copie locale ; recharger seulement après sauvegarde des modifications non enregistrées.
5. Tester une sauvegarde après rechargement, l'ajout d'une séance, l'archivage et l'ajout de lien de l'atelier à la séance test.
6. Recharger la classe et vérifier le contenu du cahier étudiant sans exposer de données personnelles.
7. Rejouer les tests des moyennes QCU, du suivi de classe et du planning décrits dans `docs/recette-phases-1-2-3.md`.
8. Vérifier les logs du navigateur (pas d'erreur JavaScript, ni `PGRST202`) et la persistance des documents après rechargement.

## Conditions avant toute fusion

- Tests GitHub Actions réussis.
- Recette sur une classe test et compte professeur réels réussie.
- Contrôle que les anciennes interfaces ouvertes avant déploiement ne sont pas encore utilisées en écriture.
- Vérification des chemins `Cahier` supplémentaires dans d'autres pages/scripts et nettoyage des écritures non protégées.
- Préparer un retour arrière : sauvegarde et restauration vérifiables.
- Autorisation explicite du propriétaire pour fusionner vers `main`.

**Important :** la base a déjà été modifiée par l'installation manuelle du RPC ; GitHub `main` reste encore inchangée.
