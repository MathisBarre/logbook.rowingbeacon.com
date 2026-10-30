# Captures de la PR #8

Captures faites dans l'interface sans Tauri, avec des données fictives (club d'aviron imaginaire, base SQLite en mémoire, date fixée au 28/10/2026 à 11h, fuseau Europe/Paris). Les champs date et heure s'affichent au format du navigateur de test (anglais américain), pas celui de l'application compilée.

## Sortie déjà faite

Le ponton : le bouton « Sortie déjà faite » est dans l'en-tête des bateaux disponibles.

![Ponton avec le bouton Sortie déjà faite](1-ponton.png)

L'éditeur en mode « Sortie déjà faite », rempli : bateau, armement, parcours, quatre rameurs et un barreur, chef de bord, horaires, distance, commentaire.

![Éditeur en mode sortie déjà faite](2-sortie-deja-faite.png)

Après « Enregistrer la sortie » : la fenêtre se ferme et un message confirme l'ajout à l'historique.

![Sortie déjà faite enregistrée](3-sortie-deja-faite-enregistree.png)

## Corriger une sortie terminée (cahier)

Le cahier : le bouton « Sortie déjà faite » est aussi dans l'en-tête de l'historique, et chaque sortie a un crayon à côté de la corbeille.

![Cahier avec le bouton Sortie déjà faite et les crayons](4-cahier.png)

Le crayon demande le mot de passe admin, comme la suppression.

![Mot de passe admin demandé par le crayon](5-cahier-mot-de-passe.png)

L'éditeur d'une sortie terminée, avec ses valeurs enregistrées.

![Éditeur d'une sortie terminée](6-sortie-terminee.png)

## Corriger une sortie en cours

La fenêtre de retour d'une sortie en cours, avec le lien « Modifier la sortie » en bas.

![Fenêtre de retour avec le lien Modifier la sortie](7-fenetre-retour.png)

L'éditeur d'une sortie en cours : retour prévu au lieu de la fin, sans mot de passe admin.

![Éditeur d'une sortie en cours](8-sortie-en-cours.png)

## Erreurs qui bloquent l'enregistrement

Formulaire vide : bateau et réponse sur l'encadrement obligatoires.

![Erreur : bateau et encadrement manquants](9-erreur-champs-vides.png)

Fin avant le début.

![Erreur : fin avant le début](10-erreur-fin-avant-debut.png)

Aucun rameur.

![Erreur : aucun rameur](11-erreur-aucun-rameur.png)

Début dans le futur (une sortie déjà faite ne peut pas commencer après maintenant).

![Erreur : début dans le futur](12-erreur-debut-futur.png)

Correction d'une sortie en cours vers un bateau qui est déjà sur une autre sortie en cours.

![Erreur : bateau déjà en sortie](13-erreur-bateau-deja-sorti.png)

## Alertes avec « Enregistrer quand même »

Nombre de rameurs différent du nombre de places du bateau.

![Alerte : nombre de rameurs](14-alerte-nombre-de-rameurs.png)

Bateau et rameurs déjà sur une autre sortie aux mêmes horaires.

![Alerte : chevauchement d'horaires](15-alerte-chevauchement.png)
