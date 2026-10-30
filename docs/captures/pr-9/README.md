# Captures de la PR #9

Module Avaries. Captures faites avec les vrais composants du Logbook, sans Tauri, sur un club fictif (français, samedi 20 juin 2026, 09h47).

## Ponton

Le ponton : un indicateur sur les bateaux avec une avarie non bloquante (gris pour « Utilisable », jaune pour « Précaution »), et la raison affichée pour un bateau hors service (Ouessant).

![Ponton avec indicateurs d'avarie](01-ponton-indicateur-avarie.png)

Au départ, l'encadré jaune « Avaries ouvertes sur ce bateau » liste les avaries sans bloquer la sortie.

![Départ avec encadré d'avertissement](02-depart-encadre-avertissement.png)

En fin de sortie, la case « Le bateau est endommagé » demande la gravité de l'avarie.

![Fin de sortie avec bateau endommagé](03-fin-de-sortie-bateau-endommage.png)

Sans le module, quand on coche un incident, une suggestion discrète propose d'activer « Avaries ».

![Suggestion du module sans le module](04-suggestion-module-sans-module.png)

## Cahier

L'onglet Avaries du Cahier, filtre « Ouvertes » : gravité, déclarant, « Modifier » et « Marquer réparée ».

![Cahier, onglet Avaries](05-cahier-onglet-avaries.png)

Le filtre « Toutes » garde l'historique : date, réparateur, note et coût de la réparation, et « Rouvrir ».

![Cahier, avaries réparées](06-cahier-avaries-historique.png)

L'onglet Incidents, avec « Déclarer une avarie » sur les incidents qui n'en ont pas encore.

![Cahier, onglet Incidents](07-cahier-onglet-incidents.png)

## Formulaires

Le formulaire de déclaration : bateau, gravité avec son explication, description, déclarant et date.

![Formulaire de déclaration d'une avarie](08-formulaire-declarer-avarie.png)

Depuis un incident, le bateau est verrouillé, et la description et la date viennent de l'incident.

![Déclaration depuis un incident](09-declarer-depuis-incident.png)

Le formulaire « Marquer l'avarie comme réparée » : date, réparateur, note et coût.

![Formulaire de réparation](10-formulaire-reparation.png)

## Gestion

La liste des bateaux a un badge de gravité (« Utilisable », « Précaution », « Hors service »).

![Liste des bateaux avec badges](11-liste-bateaux-badges.png)

La fiche bateau liste les avaries ouvertes, avec « Marquer réparée » et « Déclarer une avarie ».

![Fiche bateau avec avaries ouvertes](12-fiche-bateau-avaries-ouvertes.png)

La case « Hors service » est cochée et verrouillée tant qu'une avarie hors service est ouverte : il faut la marquer réparée.

![Case Hors service verrouillée](13-hors-service-verrouille.png)

Les statistiques d'un bateau montrent l'historique des avaries par date, réparées comprises, puis les incidents.

![Statistiques d'un bateau avec l'historique des avaries](14-stats-bateau-historique.png)
