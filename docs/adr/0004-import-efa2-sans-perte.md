# Un import efa2 remplace les données du club et garde chaque enregistrement efa tel quel

Un projet efa2 contient bien plus que ce que Rowing Beacon affiche (réservations, messages, équipages types, plans d'eau, travail bénévole, règles d'accès des bateaux, champs libres…). L'import remplace toutes les données du club, après une sauvegarde automatique, et range chaque enregistrement efa lu, tel quel, dans une table dédiée (`efa_record`) reliée à la fiche Rowing Beacon qu'il a produite. Rien n'est perdu : les futurs modules (Réservations, Avaries, Groupes et droits) reprendront ces données, et l'export efa2 réécrit les champs que Rowing Beacon ne modélise pas.

## Considered Options

- Fusionner l'import avec les données existantes : utile à un club déjà sous Rowing Beacon, mais impose de rapprocher les doublons ; reporté.
- N'importer que ce qui a un écran : simple, mais un aller-retour efa → Rowing Beacon → efa perdrait des données.
- Modéliser tout efa2 en tables Rowing Beacon dès maintenant : coûteux, et figerait des modèles (droits, avaries) qui doivent encore être repensés.

## Consequences

- Les identifiants efa (UUID) deviennent les identifiants Rowing Beacon ; une sortie reçoit un UUID dérivé de son cahier et de son numéro, si bien qu'un ré-import retombe sur les mêmes fiches.
- Tous les cahiers d'un projet sont réunis dans l'historique unique ; chaque sortie garde le nom de son cahier d'origine pour l'export.
- Les noms libres d'efa créent des fiches d'invité (rameurs) ou des bateaux archivés (bateaux extérieurs), conformément à l'ADR 0001.
