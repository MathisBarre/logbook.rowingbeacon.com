# Les sorties référencent des fiches jamais supprimées, sans copie des noms

efa2 recopie le nom du bateau et des rameurs dans chaque sortie et versionne ses fiches (valable du… au…). Rowing Beacon garde une seule source de vérité : une sortie ne stocke que des identifiants, et une fiche référencée par une sortie n'est jamais supprimée. Elle est archivée, fusionnée (ses sorties sont rattachées à la fiche conservée) ou anonymisée. Un nom inconnu, saisi au ponton ou lu dans un import, crée une fiche d'invité plutôt qu'un texte libre.

## Considered Options

- Copier les noms dans chaque sortie (comme efa2) : historique robuste, mais donnée dupliquée et renommages incohérents.
- Versionner les fiches (comme efa2) : fidèle à l'époque, mais obscur pour les utilisateurs et coûteux partout dans les requêtes.

## Consequences

- Renommer une fiche renomme tout son historique, ce qui est voulu.
- La configuration utilisée (4x ou 4-) est une donnée de la sortie, référencée par identifiant.
- À l'import efa2, la version la plus récente d'une fiche devient la fiche Rowing Beacon ; les versions antérieures ne sont pas conservées comme fiches.
