# Le mode démo ouvre une base séparée, recréée à chaque entrée

En mode démo, l'application ouvre `demo.db` au lieu de `main.db`. Le mode est un drapeau du localStorage (`rowingbeacon.demo`), lu une seule fois par `database.ts` à l'ouverture de la base : on n'en change qu'en rechargeant la fenêtre (`enterDemo`, `exitDemo` et `resetDemo` vident les écritures en attente, écrivent le drapeau, ferment la base puis rechargent ; si le drapeau ne peut pas être écrit, rien ne change). Le vrai club n'est donc jamais lu ni écrit pendant la démo, et le chargement des stores (ADR 0003) repart d'un état propre sur la bonne base.

À chaque entrée en démo et à chaque « Réinitialiser », `demo.db` reçoit un club fictif neuf (`seedDemoClub`, chargé par `import()` pour rester hors du lot principal) : les dates sont toujours actuelles. Le remplissage est un seul script SQL (`BEGIN` … `COMMIT` en un appel : le plugin SQL répartit les appels séparés sur plusieurs connexions) ; s'il échoue, la base est fermée, ce qui annule la transaction restée ouverte. Le drapeau « à remplir » reste posé jusqu'à la fin du remplissage, donc un remplissage interrompu est refait au démarrage suivant ; un simple redémarrage de l'application en démo garde le club tel quel. Le schéma de `demo.db` vient des migrations JavaScript seules (les migrations Rust ne concernent que `main.db`).

Le club fictif a aussi de quoi montrer les Statistiques (ADR 0008) : trois saisons, d'anciens membres archivés, des invités, des requêtes enregistrées et le tableau de bord de départ (le profil `analytics` du club fictif des captures, avec tous les modules activés).

Les statistiques sont lues par le moteur Rust (ADR 0008), qui ouvre le fichier lui-même : la fenêtre lui dit lequel (`main.db` ou `demo.db`) dans l'argument `database` de `analytics_run_query` et `analytics_list_objects`, d'après le même drapeau que `database.ts`. Le moteur n'accepte que ces deux noms (`paths::db_path_for`, jamais un chemin) et rejette les autres avec `invalid_param` ; sans argument, c'est `main.db`. Les rapports, l'éditeur SQL et l'assistant IA de la démo lisent donc `demo.db`, et le profil de performances aussi.

## Considered Options

- Écrire les données fictives dans `main.db` (l'ancien mode démo, avec `faker`) : le club doit tout supprimer ensuite, et un oubli mélange vrai et faux.
- Garder la démo d'une session à l'autre : les dates vieillissent (« sortie en cours » d'il y a trois mois) et une démo abîmée ne se répare pas.
- Une démo en ligne dans le navigateur : utile pour les clubs qui n'ont pas installé l'application, mais hors du périmètre (voir `A-FAIRE-PLUS-TARD.md`).

## Consequences

- Désactivé en démo : migration v1 (elle lit et efface les clés localStorage du vrai club), élagage et suppression des sauvegardes v1, sauvegardes automatiques et copies externes, `runBackup` (sans effet), restauration d'une sauvegarde (la section « Sauvegardes » de Gestion > Données est remplacée par une explication), installation d'une mise à jour (la sauvegarde préalable ne protégerait que la démo ; la vérification de mise à jour reste active), lecture et suppression de l'ancien indicateur d'onboarding du localStorage.
- « Supprimer toutes les données » n'existe plus en démo : il est remplacé par « Réinitialiser », qui recrée le club fictif sans sauvegarde.
- L'import et l'export efa2 restent actifs et n'écrivent que dans `demo.db` : importer son vrai projet efa2 dans la démo est une façon d'essayer l'application sur ses données sans toucher à `main.db` (aucune sauvegarde n'est faite avant, la démo se recrée à volonté).
- Les préférences du poste du localStorage (langue, zoom, format de l'heure, dossier de copie externe) sont communes aux deux modes.
- Pour savoir où « Quitter la démo » ramène (« Revenir à mon club » ou « Créer mon club »), l'existence du vrai club est notée dans le drapeau à l'entrée en démo.
- Le serveur MCP (`<exécutable> --mcp`, un autre processus lancé par une application d'IA externe) lit toujours `main.db`, jamais `demo.db` : une application d'IA branchée pendant la démo interroge le vrai club. Le réglage « autoriser l'accès MCP » de la démo est écrit dans `demo.db` et le serveur lit celui de `main.db` : l'activer depuis la démo n'ouvre rien. La clé d'API de l'assistant (trousseau de l'ordinateur) est commune aux deux modes. Le dossier des propositions de Claude (`analytics-inbox`) est celui du vrai club : la démo ne le relève pas, sinon elle importerait dans `demo.db` (et effacerait du dossier) des propositions faites sur `main.db`.
- Ce que les Statistiques retiennent sur le poste (requête en cours et historique de l'éditeur SQL, questions déjà posées à l'assistant, dernier onglet : clés `rb.analytics.*`) a sa copie propre en démo (`rb.analytics.demo.*`), vidée à l'entrée, à la réinitialisation et à la sortie de la démo : les requêtes et questions du vrai club n'apparaissent pas dans la démo, et la démo ne les écrase pas.
- `demo.db` reste sur le disque après la sortie de la démo : il est écrasé à la démo suivante.
