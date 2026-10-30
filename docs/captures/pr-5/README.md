# Captures de la PR #5

Captures faites dans l'interface sans Tauri, avec une version 2.1.0 simulée et des données fictives (le plugin updater, la sauvegarde et la version de l'app sont remplacés par des faux).

**Message dans le hangar.** Un message en bas de l'écran annonce la nouvelle version, avec le bouton « Voir la mise à jour ».

![Message « La version 2.1.0 est disponible » dans le hangar](1-ponton-message-version-disponible.png)

**Gestion > Paramètres divers.** La section « Mises à jour » montre la version installée et le bouton « Rechercher une mise à jour ». Quand l'app est à jour, un message le confirme.

![Section Mises à jour, app à jour](2-parametres-recherche-a-jour.png)

Quand une version est disponible, la section l'annonce et le bouton devient « Voir la mise à jour ».

![Section Mises à jour, version disponible](3-parametres-version-disponible.png)

**Boîte de mise à jour.** Elle montre les notes de version, le lien vers les nouveautés et le bouton « Installer et redémarrer ».

![Boîte de mise à jour avec les notes de version](4-boite-notes-de-version.png)

**Depuis le hangar.** Un clic sur « Installer et redémarrer » ferme la boîte le temps de saisir le mot de passe admin.

![Demande du mot de passe admin depuis le hangar](5-ponton-mot-de-passe-admin.png)

**Étapes de l'installation.** Les boutons sont bloqués pendant que la mise à jour avance.

![Téléchargement à 42 %](6-telechargement.png)

![Sauvegarde des données](7-sauvegarde.png)

![Installation](8-installation.png)

**Échecs.** Le téléchargement coupé ramène la boîte à l'état normal avec un message d'erreur.

![Échec de la mise à jour](9-echec-mise-a-jour.png)

Si la sauvegarde échoue, rien n'est installé et un message le dit.

![Échec de la sauvegarde avant l'installation](10-echec-sauvegarde.png)
