# Le modèle de données est complet, l'interface est modulaire

Rowing Beacon Desktop doit pouvoir importer un projet efa2 sans perte tout en restant simple pour un petit club. Le schéma SQLite couvre donc d'emblée tout le modèle utile d'efa2, tandis que l'interface n'affiche que le core et les modules activés. Désactiver un module masque ses écrans et ses champs, sans jamais effacer de données ; un import efa2 active les modules dont il apporte des données.
