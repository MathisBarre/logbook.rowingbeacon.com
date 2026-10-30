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

`node scripts/logbook-release.mjs bump patch` (ou `minor`, `major`, `X.Y.Z`) monte la version et crée `v<version>.md` à remplir. Merger cette PR dans `main` publie la version : le tag `logbook-v<version>` est créé par la CI (voir `docs/desktop-releases.md`). La CI refuse une PR dont les notes manquent ou contiennent encore une puce vide.

Relancer la publication sur une release déjà publique ne met à jour que le texte de la page GitHub : les notes de `latest.json`, celles que l'application affiche, restent celles de la première publication. La release du miroir publie les installeurs, leurs signatures et `latest.json`, que les postes des clubs lisent.
