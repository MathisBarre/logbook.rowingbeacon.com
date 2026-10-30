# Les avaries remplacent le drapeau « en maintenance »

Un bateau n'est plus marqué « en maintenance » par une case à cocher : il est hors service tant qu'il a une avarie ouverte de gravité « inutilisable ». Une avarie (`boat_damage`) a une gravité (utilisable, limitée, inutilisable), un déclarant, une date, et se suit jusqu'à sa réparation (date, réparateur, note, coût). Une mise hors service sans dégât (hivernage, prêt) est une entrée de type « indisponible », toujours inutilisable : c'est l'équivalent du statut NOTAVAILABLE d'efa2. Les incidents restent ce qu'ils sont : un événement signalé à la fin d'une sortie, qui peut donner lieu à une avarie.

## Considered Options

- Garder la case « en maintenance » à côté des avaries : deux sources de vérité qui se contredisent (bateau réparé mais toujours bloqué, ou l'inverse).
- Ajouter la gravité et le suivi à la table `incident` : mélange l'événement (une sortie) et l'état du bateau (jusqu'à réparation), que le glossaire distingue.

## Consequences

- `boat.is_in_maintenance` n'est plus écrit. Au démarrage, `upgradeToBoatDamages` transforme un drapeau restant en entrée « indisponible » (aussi après la restauration d'une ancienne sauvegarde), et les avaries efa2 gardées par un import 2.0 (ouvertes, alors reprises comme incidents, ou réparées, alors cachées) en avaries.
- Sans le module Avaries, la case « hors service » de la fiche bateau reste : cochée, elle crée une entrée « indisponible » ; décochée, elle clôt les entrées qui bloquent le bateau.
- L'export efa2 écrit les avaries en `efa2boatdamages` et les entrées « indisponible » en statut NOTAVAILABLE.
