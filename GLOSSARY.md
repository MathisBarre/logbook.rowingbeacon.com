# Rowing Beacon Desktop

Cahier de sortie installé sur un poste du club, utilisé au ponton par les rameurs et administré par les responsables. Le vocabulaire Cloud est défini séparément dans `CONTEXT.md` à la racine du dépôt.

## Cahier

**Sortie** :
Départ d'un bateau avec un équipage, puis son retour. Une sortie sans retour est une sortie en cours.
_Éviter_ : session, trajet, fahrt

**Équipage** :
Ensemble des rameurs d'une sortie, barreur compris.
_Éviter_ : crew

**Barreur** :
Membre de l'équipage qui dirige un bateau barré sans ramer.
_Éviter_ : cox, rameur (pour le barreur)

**Chef de bord** :
Membre de l'équipage responsable du bateau pendant la sortie.
_Éviter_ : obmann, capitaine, responsable

**Parcours** :
Destination ou itinéraire habituel d'une sortie, avec sa distance éventuelle.
_Éviter_ : route, destination, ziel

**Type de sortie** :
Nature d'une sortie : entraînement, régate, randonnée, initiation, etc.
_Éviter_ : catégorie de sortie, fahrtart

**Sortie de plusieurs jours** :
Sortie dont le retour a lieu un autre jour que le départ, comme une randonnée ou un stage.
_Éviter_ : sortie longue

**Incident** :
Événement signalé à la fin d'une sortie.
_Éviter_ : avarie (pour un événement), problème

**Avarie** :
Dégât constaté sur un bateau, suivi jusqu'à sa réparation.
_Éviter_ : incident (pour un dégât), schaden, dommage

## Flotte

**Bateau** :
Embarcation du club utilisable pour une sortie.
_Éviter_ : boot, coque

**Configuration** :
Façon de gréer un bateau, définie par son nombre de places, son armement et la présence d'un barreur, par exemple 4x ou 4-.
_Éviter_ : variante, type de bateau

**Armement** :
Manière de ramer d'une configuration : couple (deux avirons par rameur) ou pointe (un aviron).
_Éviter_ : rigging, gréement

## Personnes

**Rameur** :
Fiche d'une personne pouvant faire partie d'un équipage, membre du club ou non.
_Éviter_ : personne, membre (pour la fiche), athlète

**Statut** :
Relation d'un rameur avec le club : membre, invité ou autre.
_Éviter_ : type de membre

**Invité** :
Rameur extérieur au club, dont la fiche est créée à la volée lors d'une sortie ou d'un import.
_Éviter_ : nom libre, inconnu

**Archivage** :
Retrait d'une fiche des choix proposés, sans toucher aux sorties qui la référencent.
_Éviter_ : suppression

**Fusion** :
Rattachement des sorties d'une fiche en double à la fiche conservée.
_Éviter_ : regroupement

**Anonymisation** :
Effacement des données personnelles d'une fiche de rameur, qui reste référencée par ses sorties.
_Éviter_ : suppression RGPD

## Application

**Core** :
Fonctionnalités toujours actives, utiles à tous les clubs et sans saisie supplémentaire au ponton.
_Éviter_ : base, socle

**Module** :
Ensemble de fonctionnalités facultatif, activable dans les paramètres, qui masque ses écrans sans effacer ses données quand il est désactivé.
_Éviter_ : plugin, option, extension

**Profil de club** :
Choix fait à l'onboarding qui détermine les modules activés au départ : simple, club complet ou import efa2.
_Éviter_ : mode

## Données

**Sauvegarde** :
Copie complète et datée des données du club, faite automatiquement ou à la demande, qui permet de revenir à un état antérieur.
_Éviter_ : export, backup

**Copie externe** :
Second exemplaire de chaque sauvegarde, écrit dans un dossier choisi hors du poste (clé USB, dossier synchronisé).
_Éviter_ : miroir, sauvegarde distante

**Restauration** :
Remplacement de toutes les données du club par celles d'une sauvegarde.
_Éviter_ : import (pour une sauvegarde), récupération

**Projet efa2** :
Ensemble des fichiers d'un club tenu sous efa2 (bateaux, personnes, destinations, cahiers…), ou la sauvegarde ZIP qui les contient.
_Éviter_ : base efa, fichier efa

**Import efa2** :
Remplacement des données du club par celles d'un projet efa2, sans rien perdre de ce que le projet contient.
_Éviter_ : migration, restauration (pour un projet efa2)

**Export efa2** :
Production, à partir des données du club, d'un projet efa2 qu'efa2 sait rouvrir.
_Éviter_ : sauvegarde (pour un projet efa2)

## Statistiques

**Rapport** :
Statistique prête à l'emploi, avec ses paramètres et son graphique, que l'on peut personnaliser.
_Éviter_ : requête prédéfinie, report

**Tableau de bord** :
Page d'accueil des statistiques, faite des graphiques épinglés.
_Éviter_ : dashboard, accueil

**Requête** :
Instruction SQL de lecture, écrite dans l'Explorer, par l'IA ou par un assistant IA branché par MCP, enregistrée avec ses paramètres et son graphique.
_Éviter_ : query, script

**Épingler** :
Ajouter un rapport ou une requête au tableau de bord.
_Éviter_ : mettre en favori

**Saison** :
Période de douze mois qui commence le premier jour du mois choisi dans Gestion › Statistiques et IA (août par défaut), désignée par ses deux années, par exemple 2025-2026.
_Éviter_ : exercice, année (pour une saison)

**Rameur actif** :
Rameur présent dans au moins une sortie d'aviron pendant la période, hors bateaux et rameurs exclus des statistiques.
_Éviter_ : membre actif (un invité peut être actif), pratiquant

**Participation** :
Place d'un rameur ou d'un barreur dans l'équipage d'une sortie ; un huit barré compte neuf participations.
_Éviter_ : présence, passage

**Pseudonymisation** :
Remplacement des noms des rameurs par un code stable (`R-1A2B3C4D`) dans les statistiques lues par un assistant IA branché par MCP. Contrairement à l'anonymisation, le club peut retrouver la personne.
_Éviter_ : anonymisation (pour ce cas)

**Proposition** :
Requête et graphique envoyés par un assistant IA du poste (Claude Desktop, Claude Code, Codex, Cursor…) par MCP, en attente d'acceptation dans l'Explorer, avec le nom de l'assistant.
_Éviter_ : suggestion

**Fournisseur d'IA** :
Service qui répond aux questions de l'assistant intégré : Anthropic, OpenAI ou un serveur compatible OpenAI. Chaque fournisseur a sa propre clé sur chaque poste.
_Éviter_ : modèle (un fournisseur propose plusieurs modèles), IA (pour le fournisseur)

**Serveur compatible OpenAI** :
Serveur qui parle l'API Chat Completions d'OpenAI (Mistral, OpenRouter, ou un modèle local avec Ollama, LM Studio…), désigné par son adresse ; il ne reçoit la structure des tables que s'il n'est pas sur ce poste.
_Éviter_ : serveur OpenAI, API locale
