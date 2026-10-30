# Captures de la PR #7

Module Réservations. Captures faites dans l'interface sans Tauri, avec un club fictif (samedi 20 juin 2026 à 09:47, module Réservations activé).

## Onglet Réservations

L'onglet Réservations : une réservation « En cours » (Ardèche), puis les réservations à venir triées par prochaine occurrence, avec le filtre par bateau.

![Réservations à venir et en cours](1-reservations-a-venir-en-cours.png)

Le bas de la liste, avec la section « Réservations passées » dépliée.

![Réservations passées](2-reservations-passees.png)

## Formulaire

Réservation ponctuelle sur deux jours, avec un nom libre comme titulaire et un motif.

![Formulaire de réservation ponctuelle](3-formulaire-ponctuelle.png)

Réservation hebdomadaire (jour + créneau), limitée à une période.

![Formulaire de réservation hebdomadaire](4-formulaire-hebdomadaire.png)

Un créneau qui chevauche une réservation existante du même bateau est refusé, et le message nomme la réservation en conflit.

![Erreur de chevauchement](5-erreur-chevauchement.png)

## Ponton et départ

Au ponton, les badges jaunes « réservé · fin 11:00 » (réservation en cours) et « réservé · début 10:00 » (réservation dans moins de 60 minutes), et l'onglet Réservations dans la barre.

![Badges de réservation au ponton](6-ponton-badges.png)

Au départ d'une sortie sur un bateau réservé, l'avertissement jaune non bloquant indique l'horaire et le titulaire de la réservation.

![Avertissement au départ](7-depart-avertissement.png)

## Gestion > Modules

Le module Réservations n'est pas activé : pas d'onglet Réservations dans la barre.

![Module Réservations désactivé](8-module-desactive.png)

Une fois activé, l'onglet apparaît et le réglage « Afficher un bateau comme réservé … minutes avant » (60 par défaut) s'affiche dans la carte du module.

![Module Réservations activé avec le réglage du délai](9-module-active-delai.png)
