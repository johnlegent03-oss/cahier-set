# Contrôle des droits Supabase avant toute mise en production

**Ce contrôle est uniquement en lecture.** Il ne modifie aucune donnée Supabase.

1. Ouvrir le projet Supabase qui héberge le cahier numérique.
2. Dans **SQL Editor**, créer une nouvelle requête.
3. Copier tout le fichier `docs/audit-supabase-lecture-seule.sql` et lancer **Run**.
4. Le résultat doit contenir 7 lignes : tables/RLS, politiques, colonnes et contraintes de `Cahier`, fonctions, buckets et politiques Storage.
5. Transmettre les résultats pour vérifier les autorisations sans envoyer de données personnelles d’élèves ni de secrets.

## Vérifications à effectuer

- Le schéma de `public."Cahier"` doit contenir `id bigint` et `contenu jsonb` ; vérifier aussi la contrainte d'unicité de `classe`.
- Les tables avec les élèves, corrections, événements comportementaux et QCU doivent avoir des politiques RLS appropriées à chaque action.
- Les accès publics `anon` à `Cahier` destinés à l'affichage des documents doivent être évalués séparément des écritures : lecture publique et écriture publique ne sont pas équivalentes.
- Les utilisateurs du portail élève ne doivent pas avoir accès aux observations et évaluations des autres élèves.
- Les fonctions `SECURITY DEFINER` existantes méritent un contrôle individuel : elles peuvent contourner des politiques RLS.
- Vérifier si le bucket `documents` est public ; n'y placer aucune correction contenant des données personnelles d'élèves.
- Pour la PR n° 6, vérifier la disponibilité de `svt_cahier_cas_v1`, ses droits `EXECUTE` et le bon fonctionnement du `UPDATE` sous RLS.

**Limite :** le SQL Editor s'exécute avec les privilèges de son rôle SQL. Ses résultats indiquent les politiques et grants, mais ne remplacent pas des tests de requêtes réelles avec les JWT `anon`, professeur et élève.

Le projet peut avoir désactivé l'exposition automatique des tables/fonctions via la Data API. Vérifier également les paramètres Data API en cas d'erreur de fonction introuvable.
