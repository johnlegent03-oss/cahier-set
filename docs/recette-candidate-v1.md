# Recette de la V1 intégrée — cahier numérique SVT

**Statut : candidate en test. Ne pas fusionner dans main avant validation manuelle.**

## 1. Périmètre gelé

Cette candidate regroupe les correctifs des phases 1 à 10 sur une branche GitHub unique issue de la phase 10.
Le périmètre est limité aux corrections, à la stabilité, aux performances et à la sécurisation des écritures.
Les fonctionnalités demandées ultérieurement sont reportées après une V1 stable.

## 2. Règles de sécurité

- Ne pas lancer de requête SQL ni de migration à partir d'un dossier de test.
- Le serveur local lit la base Supabase de production : **les écritures effectuées dans l'interface sont réelles**.
- Ne jamais régénérer les cours de l'année scolaire, réinitialiser les créneaux, ni écraser un cahier pour tester.
- Pour les essais en lecture seule, ne pas cliquer sur Enregistrer / Supprimer / Générer.
- Si un test de persistance est indispensable, utiliser uniquement une modification scolaire réelle voulue, puis en vérifier le résultat.
- Le code de main et les fichiers existants sur l'ordinateur restent intacts tant que la candidate n'est pas approuvée.
- Préserver un point de retour arrière (branche main avant fusion et ZIP antérieur fonctionnel).

## 3. Tests automatiques

GitHub Actions doit valider :
- La syntaxe de **tous les fichiers JS du répertoire racine**.
- Les références de scripts JS et de feuilles CSS locaux, dans les pages HTML.
- Les tests node --test tests/*.test.cjs : chargements, moyennes, QCU, sauvegardes de cahier et gestion de concurrence, copies locales, planning, associations, suivi, remarques et dates.

Un résultat CI vert ne valide **pas** l'authentification réelle, les droits Supabase, les exports PDF ni l'ergonomie sur navigateur ou smartphone.

## 4. Recette fonctionnelle en navigateur — à valider un bloc à la fois

| Ordre | Module | Contrôles | État initial |
| --- | --- | --- | --- |
| A | Accès général | Connexion professeur, accueil, navigation entre les espaces, classes visibles, absence d'erreurs bloquantes | À vérifier |
| B | Cahier numérique | Consultation d'un chapitre existant, séances, schéma-bilan, ressources/images, rendu élève, absence de contenu manquant | À vérifier |
| C | Évaluations et QCU | Affichage d'évaluations existantes, deux domaines en 6e, arrondis, chapitres QCU, trimestre, résultats individuels | À vérifier |
| D | Comportement et appréciations | Observations existantes par élève/classe, dates, communications non doublonnées, appréciations, exclusion d'une seule observation isolée | À vérifier |
| E | Planning | Grille et alternance A/B, associations, événements, suivi par classe, confirmation explicite des cours effectués | Phases 6–8 testées isolément |
| F | Remarques du planning | Total et répartition par classe, historique daté, filtre de période, Voir cette semaine | Phase 10 testée isolément |
| G | Atelier et PDF | Affichage/réédition des documents existants, images, impression PDF sans pages parasites, téléchargement ZIP | À vérifier |
| H | Robustesse | Navigation rapide, changements d'onglets, rechargement, conflits de sauvegarde, comportement sur mobile | À vérifier |

Les tests E et F ont été réalisés sur les phases individuelles ; ils doivent être recontrôlés en V1 intégrée.

## 5. Critères de sortie

La candidate n'est prête à être fusionnée que si :
1. GitHub Actions est vert sur le commit candidat final ;
2. les modules A à H sont vérifiés sur la **même version intégrée** ;
3. aucune erreur bloquante ni perte de données n'est observée ;
4. les exports importants sont contrôlés sur de vrais contenus **sans écriture de test dans Supabase** ;
5. l'utilisateur autorise explicitement la fusion sur main.

Le premier essai de cette candidate doit être **en lecture seule** : lancer la page prof.html dans un dossier séparé puis vérifier la navigation, sans modifier les données.
