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
