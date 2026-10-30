# Les statistiques lisent la base en lecture seule, et l'IA ne voit que sa structure

Les rapports, l'éditeur SQL, l'assistant IA et le serveur MCP passent tous par un moteur Rust dédié (`rb-analytics`) qui ouvre `main.db` en lecture seule à chaque requête, crée des vues temporaires, active `query_only` et installe un autorisateur SQLite : seules la lecture des vues et des tables du dictionnaire et les fonctions sont permises, les colonnes de contact sont toujours lues comme vides et les noms le sont aussi en mode pseudonymisé. L'assistant intégré envoie au fournisseur choisi (Anthropic, OpenAI ou un serveur compatible OpenAI) la question et la structure des tables, jamais de lignes ; chaque clé API reste dans le trousseau du système. Les assistants IA du poste (Claude Desktop, Claude Code, Codex, Cursor, VS Code…) lisent les statistiques par un serveur MCP intégré à l'exécutable (`--mcp`), désactivé et pseudonymisé par défaut, qui n'écrit jamais dans la base : leurs propositions passent par un dossier d'attente que l'application importe.

## Considered Options

- Exécuter les requêtes avec le plugin SQL de l'application : pas de lecture seule, pas de délai maximum ni d'annulation, colonnes de même nom fusionnées. Une requête mal écrite pourrait modifier ou bloquer la base pendant qu'on saisit des sorties au hangar.
- Créer les vues par une migration : elles voyageraient dans les sauvegardes et devraient être migrées à chaque changement ; les vues temporaires suivent toujours la version installée.
- Envelopper la requête dans `SELECT * FROM (…)` pour la limiter : contournable (`SELECT 1) UNION SELECT (2`) et fausse la position des erreurs.
- Envoyer les résultats à l'IA pour qu'elle les commente : plus riche, mais des données personnelles quitteraient le club. Écarté pour l'assistant intégré ; possible avec un assistant branché par MCP, en mode pseudonymisé par défaut.
- Un serveur MCP séparé (Node ou Python) : une installation de plus pour des bénévoles ; une option du même exécutable suffit.
- Stocker la clé API dans `main.db` : elle partirait dans les sauvegardes, les restaurations et les exports.
- Un seul fournisseur d'IA (Anthropic) : plus simple, mais le club dépendrait d'un seul acteur et ne pourrait pas garder ses questions sur le poste avec un modèle local.
- Laisser la page web envoyer l'adresse d'un serveur compatible à chaque question : une page compromise pourrait envoyer la clé enregistrée ailleurs. L'adresse est enregistrée avec la clé, côté Rust.

## Consequences

- Aucune statistique ne peut écrire, ni lire le mot de passe responsable (table `setting` refusée), même écrite par l'IA ou par un assistant branché par MCP.
- Une colonne ajoutée plus tard à une table reste masquée tant que le dictionnaire ne la déclare pas.
- Chaque requête ouvre sa propre connexion (quelques millisecondes) ; le cache des résultats suit `PRAGMA data_version`, donc une sortie saisie au hangar apparaît au calcul suivant.
- La visibilité d'un rapport (public, nominatif, responsables) se décide avant de le lancer : un rapport nominatif est verrouillé, pas filtré après coup.
- `rusqlite` doit utiliser la même version de `libsqlite3-sys` que `sqlx` : un seul SQLite est lié dans l'application.
- Sans clé API, l'assistant fonctionne en copier-coller avec n'importe quel assistant IA (claude.ai, ChatGPT, Le Chat…) ; hors ligne, les rapports et l'éditeur fonctionnent, pas l'IA.
- Les limites (durée, lignes, taille du résultat, mémoire de SQLite, requêtes en parallèle) suivent un profil de performances (`rb-analytics/src/perf`) : Économe garde les valeurs pensées pour un Raspberry Pi, Standard et Puissant donnent plus de marge à un portable ou à un poste fixe. Auto, par défaut, choisit d'après la mémoire, les cœurs et l'architecture (un Raspberry Pi reste en Économe). L'application et le serveur MCP lisent le réglage dans `main.db` et le moteur borne chaque requête à son profil : la page web ne peut que demander moins. Le plafond de mémoire de SQLite de l'application, commun avec ses propres connexions, ne dépasse jamais le quart de la mémoire de l'ordinateur (sous Linux, la limite du cgroup compte si elle est plus basse), et toute requête s'arrête 256 Mo sous ce plafond, en plus de son propre budget. SQLite ne compte la mémoire que pour tout le processus : le SQL libre (Explorer, assistant, propositions, requêtes enregistrées) et les rapports lourds passent donc seuls dans la file, et seules des requêtes prêtes et légères vont par deux. Le serveur MCP, processus à part, prend les durées du profil mais toujours la mémoire d'Économe. Un réglage illisible donne Économe, jamais Auto. Ces chiffres ne comptent que SQLite : un gros résultat coûte aussi son JSON dans Rust et dans la page.

## AI providers

| Fournisseur | Adresse | API | Clé (trousseau) |
|---|---|---|---|
| `anthropic` | `https://api.anthropic.com` (fixe) | Messages, sortie structurée | `anthropic-api-key` |
| `openai` | `https://api.openai.com/v1` (fixe) | Responses, `text.format` `json_schema` strict, `store: false` | `openai-api-key` |
| `openai_compatible` | celle enregistrée avec la clé | Chat Completions, `response_format` `json_schema`, sinon `json_object`, sinon texte libre validé | `openai-compatible-connection` (adresse + clé facultative) |

- Mêmes garde-fous pour tous : la requête est vérifiée avant de lire la clé ; seuls le prompt système, la conversation (questions, réponses de l'IA, erreurs du moteur rédigées) et le schéma de réponse partent ; jamais de lignes ; aucune redirection suivie ; aucune clé dans `main.db`, les sauvegardes ou les journaux.
- L'adresse d'un serveur compatible est en https, sauf `localhost`, `127.0.0.1` et `[::1]` ; ni identifiant, ni requête, ni fragment. Elle est enregistrée avec sa clé : la page web ne choisit jamais où part une clé, et une nouvelle adresse ne reprend pas l'ancienne clé. Les réglages préviennent quand le serveur n'est pas sur ce poste.
- Un seul schéma de réponse (`ai/fixtures/response-schema.json`) respecte à la fois les limites d'Anthropic et le mode strict d'OpenAI (toutes les propriétés requises, `additionalProperties: false`, facultatif = `anyOf [type, null]`) ; `openai_strict` le laisse identique, ce qu'un test vérifie.
- Un serveur compatible essaie `json_schema`, puis `json_object` (le schéma passe dans le prompt), puis du texte libre ; il ne descend d'un cran que sur un refus clair du format, et le mode retenu est mémorisé par adresse et par modèle jusqu'au redémarrage ; la réponse est validée par l'application comme les autres.
- Le coût n'est affiché que pour les modèles dont le prix est connu (Anthropic, OpenAI) ; jamais pour un serveur compatible.
- Le réglage `analytics.ai.provider` vaut `anthropic` s'il est absent : une installation antérieure garde sa clé et son modèle sans migration.
- Les propositions MCP gardent le `clientInfo.name` de l'assistant (colonne `analytics_query.client`, migration 12) pour l'afficher.
