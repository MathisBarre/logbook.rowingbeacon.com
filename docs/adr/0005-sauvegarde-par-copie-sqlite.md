# Une sauvegarde est une copie du fichier SQLite, restaurée table par table

Une sauvegarde est une copie complète de `main.db`, faite par SQLite lui-même (`VACUUM INTO`), donc cohérente même pendant une écriture et sans code natif à ajouter. La restauration ne remplace pas le fichier ouvert par l'application : la sauvegarde est d'abord copiée et mise à jour au schéma courant, puis ses tables sont recopiées dans la base ouverte en une seule transaction, avant un rechargement de l'application.

## Considered Options

- Sauvegarder au format efa2 (ZIP) : lisible par efa, mais perd les données propres à Rowing Beacon.
- Remplacer le fichier `main.db` à la restauration : demande de fermer la connexion du plugin SQL et du code Rust dédié, avec un risque de base à moitié écrite.
- Exporter en JSON : lent sur de gros historiques et à maintenir à chaque évolution du schéma.

## Consequences

- Une sauvegarde d'une version plus ancienne se restaure : les migrations sont appliquées à sa copie avant la recopie.
- Les préférences du poste (dossier de copie externe, date de la dernière sauvegarde automatique) restent dans le localStorage et ne voyagent pas avec une sauvegarde.
