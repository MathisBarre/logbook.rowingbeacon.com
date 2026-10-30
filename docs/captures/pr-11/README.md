# Captures du mode démo (PR #11)

Captures du vrai Logbook (apps/screenshot-studio, Chromium, 1512×945, horloge figée au samedi 20 juin 2026 à 09:47, fuseau Europe/Paris), en français sauf mention contraire. Le mode démo est entré par les vrais boutons ; le club fictif est celui que l'application amorce elle-même (`seedDemoClub`).

## Entrée dans la démo

![](01-onboarding-essayer-avec-un-club-de-demo.png)
01. Écran d'accueil : la carte « Essayer avec un club de démo » au-dessus du choix du profil.

![](02-chargement-du-club-de-demo.png)
02. Écran « Préparation du club de démo… » pendant l'amorçage (amorçage ralenti de 4 s pour le photographier).

![](03-erreur-preparation-du-club-de-demo.png)
03. Échec de l'amorçage (erreur simulée) : message rassurant, « Réessayer » et « Créer mon club ».

## Ponton et guide

![](04-ponton-demo-bandeau-et-bateaux.png)
04. Ponton en démo : bandeau jaune permanent, bateaux aux noms réalistes (F101, Mistral, Odette Marsac, Emp 2x 4…), sorties en cours, avaries.

![](05-que-tester-ouverture-automatique.png)
05. Guide « Que tester ? », ouvert automatiquement à l'entrée dans la démo (0 sur 19).

![](06-que-tester-liste-complete.png)
06. Le même guide en entier (fenêtre plus haute), groupes nommés comme la barre de navigation (Boathouse, Logbook) : le groupe Statistiques compte désormais six étapes (tableau de bord, rapports, rapport annuel, requête SQL, question à l'IA avec clé API, statistiques d'un rameur), chacune avec « Y aller » vers le bon onglet.

![](07-que-tester-etapes-cochees.png)
07. Guide avec quatre étapes cochées (4 sur 19 essayés).

## Confirmations

![](08-confirmation-reinitialiser-la-demo.png)
08. Confirmation « Réinitialiser la démo ? ».

![](09-confirmation-quitter-la-demo-creer-mon-club.png)
09. Confirmation « Quitter la démo ? » quand la démo a été lancée sans club réel : bouton « Créer mon club ».

![](09b-confirmation-quitter-la-demo-revenir-a-mon-club.png)
09b. Même confirmation quand la démo a été lancée depuis un club réel : bouton « Revenir à mon club ».

## Gestion

![](11-gestion-parametres-divers-mode-demo.png)
11. Gestion › Paramètres divers en démo : la section « Mode démo en cours » avec le bouton « Réinitialiser » (remplace « Supprimer toutes les données »).

![](12-gestion-donnees-demo-sauvegardes-desactivees.png)
12. Gestion › Données en démo : la section Sauvegardes est remplacée par l'avertissement « désactivées en mode démo ».

![](13-import-efa2-avertissement-remplacement-demo.png)
13. Aperçu d'un import efa2 en démo (export puis ré-import du club fictif) : avertissement rouge « Toutes les données du club fictif seront remplacées… ».

![](14-gestion-club-reel-essayer-le-mode-demo.png)
14. Gestion › Paramètres divers pour un club réel (hors démo) : la nouvelle entrée « Mode démo › Essayer le mode démo », à côté de « Supprimer toutes les données ».

![](15-confirmation-lancer-la-demo-club-reel-garde-de-cote.png)
15. Confirmation « Essayer le mode démo ? » : le club actuel est gardé de côté, « Lancer la démo ».

## Mise à jour

![](16a-mise-a-jour-disponible-en-demo.png)
16a. Fenêtre de mise à jour (version 2.1.0 injectée dans le store pour la photo) ouverte depuis Gestion en démo.

![](16-mise-a-jour-bloquee-en-demo.png)
16. « Installer et redémarrer » en démo : rien n'est installé, toast « Quittez le mode démo pour installer la mise à jour… ».

## Un club bien rempli

![](17-logbook-demo-historique-des-sorties.png)
17. Logbook : historique des sorties (247 pages), chefs de bord, sorties encadrées ou non, types de sortie, parcours ; onglet Avaries ouvert.

![](18-logbook-demo-avaries-toutes.png)
18. Logbook › Avaries, filtre « Toutes » : hors service, précaution, utilisable, réparations.

![](19-statistiques-demo.png)
19. Statistiques en démo, onglet « Tableau de bord » (atteint par « Y aller ») : chiffres clés de la saison 2025-2026 comparés à la précédente, cartes de rapports, bandeau démo visible.

![](19b-statistiques-demo-tableau-de-bord-en-modification.png)
19b. Le tableau de bord en modification (« Modifier », après le mot de passe admin) : placer avant ou après, taille d'une carte, « Ajouter une carte », « Terminer ».

![](23-statistiques-demo-rapports.png)
23. Onglet « Rapports » : les 29 rapports du club classés par thème (Flotte, Rameurs, Fidélisation, Fréquentation…), recherche et « Demander à l'IA ».

![](24-statistiques-demo-rapport-classement-des-bateaux.png)
24. Un rapport ouvert, « Classement des bateaux » : graphique, « Épingler au tableau de bord », « Personnaliser » et filtre par type de bateau.

![](25-statistiques-demo-rapport-annuel.png)
25. Onglet « Rapport annuel » : document prêt pour l'assemblée générale, avec « Imprimer ou enregistrer en PDF », « Exporter en Excel » et « Présenter ».

![](26-statistiques-demo-explorer-requete-enregistree.png)
26. Onglet « Explorer » (déverrouillé avec le mot de passe admin) : la requête enregistrée « Mardi soir : sorties par mois » (dates de modification avant le jour de la démo), son SQL, le paramètre de saison et le graphique obtenu.

![](27-statistiques-demo-assistant-ia.png)
27. Explorer, assistant « Demander à l'IA » sans clé API : mode copier-coller (« Copier la demande », « Configurer l'IA ») et mention que l'IA ne connaît pas les noms des rameurs.

![](20-reservations-demo.png)
20. Réservations : créneaux hebdomadaires, sorties uniques, régate sur deux jours, créneau limité à une période.

![](21-gestion-rameurs-demo.png)
21. Gestion › Rameurs : une large base de rameurs fictifs.

![](22-gestion-bateaux-demo.png)
22. Gestion › Bateaux : flotte variée (codes de type F101 / V1x 4 / W 4x 1, prénoms, noms de lieux, noms de personnes), avec un bateau hors service.

## Traductions (en-US)

![](30-en-us-onboarding-try-with-a-demo-club.png)
30. en-US : carte « Try it with a demo club » à l'accueil.

![](31-en-us-demo-guide-what-to-try.png)
31. en-US : guide « What to try? ».

![](31b-en-us-demo-guide-full-list.png)
31b. en-US : le guide en entier, avec le groupe « Statistics » à six étapes.

![](32-en-us-demo-boathouse-banner.png)
32. en-US : bandeau « Demo mode · fictional club · admin password: admin » sur le ponton (heures en 12 h, noms de bateaux anglo-saxons).

![](33-en-us-leave-the-demo-confirmation.png)
33. en-US : confirmation « Leave the demo? ».

![](33b-en-us-reset-the-demo-confirmation.png)
33b. en-US : confirmation « Reset the demo? » (« with current dates »).

![](34-en-us-management-demo-mode-section.png)
34. en-US : Management › Miscellaneous settings, section « Demo mode is on » (« You are using a fictional club… »).

![](35-en-us-management-data-in-demo.png)
35. en-US : Management › Data en démo, sauvegardes désactivées.
