# SQLite est la seule source de vérité des données du club

Jusqu'à la v1, bateaux, rameurs, parcours, sorties en cours et incidents vivaient dans le localStorage de la WebView, et seules les sorties terminées étaient en SQLite. Toutes les données du club sont désormais en SQLite ; les stores zustand ne sont plus qu'un cache en mémoire chargé au démarrage et mis à jour à chaque écriture. Le localStorage ne garde que les préférences du poste (langue, format horaire, zoom, onboarding). Ce choix prépare les sauvegardes, l'import efa2 et la synchronisation Cloud.

## Consequences

- Au premier lancement de la v2, les données v1 sont copiées du localStorage vers SQLite après l'écriture d'un fichier JSON de secours dans le dossier de données de l'application ; le localStorage n'est vidé qu'après vérification.
- Les identifiants deviennent des UUID sans préfixe ; la migration réécrit les anciens identifiants et toutes leurs références.
