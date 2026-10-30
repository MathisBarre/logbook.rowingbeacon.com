# Les mises à jour passent par le plugin updater de Tauri, après une sauvegarde

L'application cherche une nouvelle version au démarrage puis toutes les 6 heures, dans le `latest.json` de la dernière release publique (`MathisBarre/logbook.rowingbeacon.com`). Une nouvelle version est annoncée une fois par lancement ; l'installation reste un geste d'administrateur (Gestion > Paramètres divers, ou le message d'annonce avec le mot de passe). Une fois la mise à jour téléchargée, une sauvegarde `before-update` (ADR 0005) est faite juste avant l'installation, pour qu'elle contienne aussi les sorties saisies pendant le téléchargement : si la sauvegarde échoue, rien n'est installé. L'application redémarre ensuite sur la nouvelle version.

## Considered Options

- Installer sans rien demander : le poste du hangar reste allumé des jours, mais un redémarrage pendant une saisie de sortie surprendrait un rameur.
- Seulement afficher un lien vers la page de téléchargement : les clubs ne réinstallent pas, les correctifs n'arrivent pas.
- Serveur de mises à jour dédié : inutile, les releases GitHub du miroir public suffisent.

## Consequences

- Chaque build est signé par une clé de mise à jour (`TAURI_SIGNING_PRIVATE_KEY`, secret du dépôt miroir) dont la clé publique est dans `tauri.conf.json`. Perdre la clé privée oblige chaque club à réinstaller à la main.
- Les postes en 2.0.1 ou avant n'ont pas l'updater : ils passent une fois à la main à la première version qui l'embarque.
- Une sauvegarde faite avant une mise à jour se restaure dans la nouvelle version (les migrations s'appliquent à sa copie) ; revenir à l'ancienne version demande de la réinstaller.
- Sous Windows, le plugin lance l'installateur NSIS puis ferme l'application sans attendre : si l'installateur ne démarre pas (antivirus), l'application reste fermée et se relance à la main ; les données sont intactes et la sauvegarde `before-update` existe.
- Une vérification sans réponse abandonne après 30 s et un téléchargement après 30 min : la fenêtre de mise à jour ne reste jamais bloquée.
