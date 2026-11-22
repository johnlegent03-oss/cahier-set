# Recette fonctionnelle — phases 1, 2 et 3

Cette branche contient les trois premières phases de stabilisation. **Ne pas fusionner sur `main` avant la validation manuelle.**

La phase 4 (sauvegardes atomiques) est volontairement exclue car elle dépend d'une fonction SQL absente de la base tant que son installation n'est pas vérifiée.

## Préparation

- Utiliser des données de test ou un environnement Supabase de préproduction si disponible.
- Sauvegarder les données avant les essais ; ne pas créer de données artificielles dans les dossiers réels des élèves.
- Ne pas tester l'atelier sur le même cahier ouvert simultanément avant le déploiement ultérieur de la protection des conflits.
- Tester sur Mac/Safari et, si possible, sur un second navigateur.

## Cas à vérifier : notes et QCU

| Données d'essai | Résultat attendu |
| --- | --- |
| 6e, TP 10/20, aucune évaluation théorique, QCU 14/20 | Théorie 14/20 ; moyenne Sciences 12/20 |
| 6e, TP 10/20, théorie 10/20, QCU 14/20 | Théorie 12/20 ; moyenne Sciences 11/20 |
| 6e, TP 10/20, théorie 16/20, QCU 14/20 | QCU écarté ; moyenne Sciences 13/20 |
| 6e, aucune note sauf QCU 17,33/20 | Théorie 17/20 et Sciences 17/20 |
| 6e, aucune note sauf QCU 17,50/20 | Théorie et Sciences 17,5/20 |
| 6e, aucune note sauf QCU 17,66/20 | Théorie et Sciences 18/20 |
| Note absente ou non renseignée | Ne doit pas devenir un zéro artificiel |
| Note explicitement égale à 0/20 | Doit être conservée |

Vérifier l'égalité des moyennes affichées dans le **suivi de classe**, le **suivi individuel**, et le résultat théorique utilisé pour les **appréciations**. Tester une élève sans évaluation de chapitre. Vérifier les données au passage T1/T2, notamment les QCU de novembre.

## Cas à vérifier : performances

- Ouvrir une classe une première fois puis une seconde fois ; noter les délais observés et les erreurs de console.
- Ouvrir un suivi individuel via le nom d'élève ; vérifier qu'aucun double clic n'est requis.
- Vérifier les QCU multi-sessions et les questions réparties sur plusieurs chapitres.
- Contrôler le nombre d'événements comportementaux visibles, notamment au-delà de 1 000 observations.
- Vérifier que les appréciations continuent de tenir compte du comportement sans inventer des observations non enregistrées.

## Cas à vérifier : planning

- Si aucune année scolaire n'est configurée, vérifier que l'écran renvoie vers les **Paramètres**.
- Si les créneaux manquent, vérifier la consigne d'initialisation.
- Si les créneaux existent mais pas les occurrences, vérifier le message de génération.
- Afficher plusieurs semaines A/B et les vacances scolaires.
- Modifier une séance et vérifier qu'elle est réellement persistante après actualisation.
- Simuler une erreur d'écriture avec un environnement de test : l'interface doit afficher une erreur, pas « Séance mise à jour ».
- Vérifier que les séances au-delà de la 1 000e peuvent être affichées.

## Hors champ de ces tests

- La sécurité effective des politiques RLS Supabase.
- Les conflits d'édition simultanée de `Cahier.contenu` (phase 4).
- L'export PDF dans Safari et l'intégralité des défauts de l'atelier.
- Les tests automatiques GitHub ne remplacent pas les essais avec les véritables interfaces et autorisations.
