# Notes de version et mises à jour

`v<version>.md` (par exemple `v2.0.2.md`) devient le texte de la release GitHub du miroir et les notes que l'application affiche avant d'installer la mise à jour (ADR 0006). Sans fichier, la release reçoit des notes générées et l'application n'affiche que le lien vers les nouveautés du site.

Écrire quelques lignes courtes, pour un responsable de club : ce qui change pour lui, pas le détail technique.

## Clé de signature (une seule fois)

Le plugin updater refuse une mise à jour qui n'est pas signée par la clé du projet.

1. Générer la clé : `pnpm tauri signer generate -w ~/.tauri/rowingbeacon-updater.key` (choisir un mot de passe), et la garder en lieu sûr : la perdre oblige chaque club à réinstaller à la main.
2. Copier la clé publique (`~/.tauri/rowingbeacon-updater.key.pub`) dans `src-tauri/tauri.conf.json`, à la place de `A_REMPLACER_PAR_LA_CLE_PUBLIQUE_DE_SIGNATURE`.
3. Dans le dépôt miroir `MathisBarre/logbook.rowingbeacon.com` (Settings > Secrets and variables > Actions), créer `TAURI_SIGNING_PRIVATE_KEY` (contenu du fichier `.key`) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Sans ces deux étapes, la publication échoue dès le build avec un message qui le dit.

## Publier une version

Commiter `release-notes/v<version>.md` **avant** de lancer `scripts/release-logbook.sh` : le tag pointe sur le commit du script, une note ajoutée après n'est pas publiée (la release reçoit alors des notes générées, sans erreur). Le script monte la version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json` et crée le tag `logbook-v<version>`.

Relancer la publication sur une release déjà publique ne met à jour que le texte de la page GitHub : les notes de `latest.json`, celles que l'application affiche, restent celles de la première publication. La release du miroir publie les installeurs, leurs signatures et `latest.json`, que les postes des clubs lisent.
