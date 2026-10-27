# À faire plus tard

Liste vivante de ce qui est décidé ou repéré mais hors du périmètre en cours. Ajouter une ligne dès qu'un sujet est identifié, la retirer quand il est livré.

## Feuille de route v2 (après la migration SQLite et le modèle efa2)

- **Module Avaries** : déclaration avec gravité, suivi jusqu'à réparation, avertissement au départ ; remplacera le booléen « en maintenance » et pourra reprendre les incidents existants.
- **Module Réservations** : ponctuelles et hebdomadaires, bateau indisponible avant le créneau.
- **Refonte des droits** : le système actuel de niveaux (catégorie d'âge, type de pratiquant, seuils d'alerte et de blocage par type de bateau) est jugé trop complexe. Le repenser avec les groupes d'efa2 en un seul système plus simple, puis livrer le module « Groupes et droits ». Les tables de groupes existent déjà pour l'import efa2.
- **Saisie a posteriori et correction des sorties** : enregistrer une sortie déjà faite, corriger une sortie en cours ou terminée (aujourd'hui seule la suppression existe).
- **Statistiques en km et exportables** : classements par rameur et bateau, filtres, export CSV / PDF.
- **Plusieurs administrateurs** et changement du mot de passe.
- **Plusieurs cahiers par saison**, avec bascule automatique.
- **Messages et notifications** (message au responsable, alertes).
- **Recherche dans le cahier**, assistant de correction et fusion de doublons dans l'interface.
- **Saisie rapide** : équipages types, valeurs par défaut par bateau ou par rameur.
- **Alertes de sécurité au départ** (nuit, météo).
- **Mise à jour automatique** de l'application.
- **Historique des modifications lisible par fiche**, à afficher dans l'interface (la table est alimentée dès la v2).
- **Anonymisation RGPD** d'une fiche de rameur depuis l'interface (ADR 0001). La fonction `anonymizeRower` est prête : elle efface les données personnelles, archive la fiche et purge son journal des modifications ; il reste le bouton et sa confirmation.

## Suites des modules livrés en v2

- **Import efa2** : fusionner un projet efa2 dans une base qui a déjà des données (aujourd'hui l'import remplace tout) ; importer les données efa 1.x ; exporter aussi `cfg/types.efa2types` pour que les types de sortie propres au club ne redeviennent pas « NORMAL » dans un efa neuf ; exporter les incidents RB comme avaries efa ; les noms libres importés reviennent comme fiches archivées à l'export ; versionner la fiche bateau quand son gréement change dans RB (aujourd'hui les sorties créées dans RB sur un ancien gréement perdent leur variante efa) ; garder d'un export à l'autre le numéro efa des sorties créées dans RB (il est recalculé à chaque export) ; écrire le ZIP exporté sous un nom provisoire puis le renommer (la portée de « Enregistrer sous » ne couvre que le fichier choisi).
- **Sauvegardes** : restauration sélective (une partie des données seulement) ; envoi d'une sauvegarde par e-mail ; vérifier dans l'app compilée que le dossier de copie externe reste élagué après un redémarrage (plugin persisted-scope ajouté, non compilable dans l'environnement de revue) ; choisir dans une liste quand un dossier contient plusieurs projets efa (aujourd'hui on tape le nom).
- **Données efa gardées sans écran** (table `efa_record`) : réservations, avaries, messages, équipages types, plans d'eau, groupes de sorties, travail bénévole, insignes, règles d'accès des bateaux (groupes autorisés, groupe obligatoire, chef de bord obligatoire), interdiction de bateau par personne, statuts attribués selon l'âge. À reprendre par les modules correspondants et par la refonte des droits.

- **Types de sortie** : écran pour ajouter, renommer ou masquer des types (la table `outing_type` accepte déjà des libellés libres) ; regrouper les étapes d'une randonnée ou d'un stage comme efa2.
- **Chef de bord** : rendre le chef de bord obligatoire bateau par bateau (aujourd'hui l'option vaut pour tout le club).
- **Invités** : fusionner une fiche invité avec un membre existant depuis l'interface, en redirigeant ses sorties (ADR 0001) ; aujourd'hui on peut seulement passer l'invité en membre.
- **Distances** : départ / arrivée, aller-retour, écluses et plans d'eau des destinations efa2 (les plans d'eau ne sont pas modélisés) ; km par rameur et par bateau dans les fiches statistiques.
- **Fiche membre** : proposer la catégorie d'âge à partir de la date de naissance ; chercher un rameur par n° de licence.

## Dette et défauts repérés

- Le mot de passe admin est haché en SHA-256 sans sel ; passer à une dérivation salée (argon2 ou PBKDF2) lors du chantier des administrateurs.
- L'import / export efa2 et les sauvegardes sont testés sur la base (Node) et validés par efa lui-même, mais pas encore dans l'application Tauri compilée (sélecteurs de fichiers, « Enregistrer sous » de l'export, portée fs, rechargement après restauration ou après un import échoué, raccourci Ctrl+Z).
- Le store « admin edit mode » et `EditBoatRow` ne sont jamais déclenchés : code mort à supprimer ou à brancher.
- Supprimer une sortie laisse son incident orphelin.
- Plusieurs textes restent en français en dur malgré l'i18n (libellé « Autre » des types de bateau, messages Zod). Voir `I18N_IMPLEMENTATION.md`.
- La dépendance `xlsx` est téléchargée depuis `cdn.sheetjs.com`, hors du registre npm : une installation échoue si ce domaine est bloqué.
- Les catégories d'âge (J10 à Senior) sont figées et propres à la France.
- Pas de build macOS documenté.
- Les statistiques par période comparent des dates ISO en UTC (`toISOString`) à des heures locales stockées en base : les sorties proches des bornes de période peuvent tomber du mauvais côté.
- `drizzle-gen/` et `schema.ts` ne décrivent que les sorties ; les migrations SQL écrites à la main font foi. Régénérer ou retirer `drizzle-gen/`.
- Les anciennes tables `session` et `session_rowers` restent en base après la migration v2 (copiées dans `outing`) ; les supprimer dans une version ultérieure, une fois la migration éprouvée chez les clubs.
- L'import / export JSON maison (`importExport.ts`) ne reprend pas les armements ni les fiches membres complètes.
- Avertissements React en console : `Button` ne transmet pas sa `ref` (utilisé avec `DialogTrigger asChild`) et le formulaire d'onboarding passe d'un champ non contrôlé à contrôlé.
- Écritures non atomiques : le plugin SQL de Tauri passe par un pool de connexions, une transaction ne peut donc pas couvrir plusieurs appels. Si `saveBoat` (bateau puis armements) ou « Supprimer les données » échoue au milieu, la base peut garder une partie de l'écriture ; l'écran est rechargé depuis la base. À traiter par une commande Rust transactionnelle.
- Aucun test de bout en bout : un banc d'essai navigateur (IPC Tauri simulé avec sql.js + Playwright) a servi pendant le développement de la v2 ; l'ajouter au dépôt permettrait de tester les parcours en CI.
- Une date de départ saisie très loin dans le futur (année erronée) est acceptée ; le retour est ensuite refusé tant que l'heure de fin ne la dépasse pas. Borner le départ (par exemple 24 h au plus dans le futur). Déjà le cas avant la v2.
- Renommer un rameur, un bateau ou un parcours pendant une sortie laisse l'ancien nom affiché sur le ponton jusqu'au redémarrage (copie des noms dans le store des sorties en cours) ; résoudre les noms par id à l'affichage. Déjà le cas avant la v2.
- L'import JSON maison compare les noms de rameurs à toutes les fiches, invités et archivés compris, et en tenant compte des accents : un membre homonyme d'un invité est ignoré sans message.
- Sans le module Fiche membre, modifier le nom d'un rameur redécoupe prénom et nom au premier espace (« Jean Pierre » / « Dupont » devient « Jean » / « Pierre Dupont »).
- Au départ, un nom tapé qui correspond à un membre archivé crée un nouvel invité (la recherche ne porte que sur les membres actifs) ; proposer plutôt de réactiver le membre.
- Une écriture qui échoue de façon passagère (base verrouillée) peut être réappliquée par l'écriture suivante de la même fiche, faite avant le rechargement : chaque écriture réécrit la fiche entière. N'écrire que les champs modifiés, ou bloquer les modifications tant qu'un rechargement est en attente.
- Les saisons finissent le 31 juillet à 00:00 (`getSeasonDate`) : les sorties du 31 juillet ne comptent dans aucune saison. Déjà le cas avant la v2.
- La durée d'une sortie de plusieurs jours compte les nuits (fin moins début) dans les statistiques.
- Les sorties migrées de la v1 ont tous leurs équipiers en rôle « rameur », barreur compris (la v1 ne notait pas qui barrait) : temps de barreur et nombre de colonnes rameurs de l'export sont faussés pour l'historique d'avant la v2. Le dire dans le message de fin de migration.
- Le cahier n'affiche pas l'armement de la sortie (il est enregistré et exporté).
- Les messages de succès des paramètres (bateau, rameur, parcours) s'affichent avant le résultat de l'écriture ; en cas d'échec on voit le succès puis l'erreur.
- Un invité créé ou réactivé au départ reste en base si l'enregistrement de la sortie échoue ensuite (fiche archivée seulement, sans sortie).
- Le message de fin de migration v1 ne s'affiche qu'une fois : le réafficher tant qu'il n'a pas été lu (Router).
- La modification groupée de rameurs (`BulkUpdateRower`) n'a pas de valeurs par défaut. Déjà le cas avant la v2.
- `StopSession.execute` n'est pas idempotent : deux appels terminent deux fois la sortie. Le formulaire bloque le double clic ; ajouter la garde dans le cas d'usage.
- Les comparatifs rameurs affichent le nombre de sorties comme barreur mais pas leur durée (visible seulement dans la fiche du rameur).
- Bornes de saison des stats bateaux / rameurs : la date locale des sorties est comparée à une borne en UTC (`toISOString`), une sortie tardive du 30 juillet tombe hors saison.
- Une distance de 0 km est acceptée et affichée « 0 km » au lieu de « pas de distance ».
- Paramètres > Rameurs : après l'archivage du dernier invité, la vue invités se rouvre seule au prochain invité créé.
- Migration v1 : le message « éléments illisibles » compte aussi les simples notes (doublon exact entre table et localStorage, valeur abandonnée sur une ligne gardée) ; séparer les deux. Les rameurs d'une sortie de table ignorée mais reprise depuis le localStorage ne sont pas notés.
- Import efa2, fichiers abîmés : une date impossible (« 32.13.2025 ») sur une sortie dont l'heure de fin précède le départ bloque tout l'import (valider les dates pour classer l'entrée comme illisible) ; une variante répétée dans `TypeVariant` (« 1;1 ») fait échouer l'import (dédoublonner) ; une référence `&#0;` donne un caractère NUL qui casse le script SQL ; un fichier de données vide ou tronqué fait refuser tout le projet avec « pas un projet efa » sans essayer la copie `.s0` d'efa ; un nom de fichier à accent décomposé (macOS HFS+) n'est pas reconnu (comparer en NFC).
- Import efa2 : deux bateaux ou parcours actifs du même nom reçoivent les noms libres au hasard ; une sortie de plusieurs jours encore en cours le jour de l'import est fermée à sa fin prévue ; l'heure de fin efa d'une sortie encore ouverte n'alimente pas le retour estimé ; le plan d'import tourne trois fois sur le fil principal (choix, aperçu, import) et `readFolder` lit tous les projets d'un dossier avant de demander lequel.
- Export efa2 : une adresse ou un nom efa avec une espace en trop, ou une date d'achat illisible, est vu comme modifié et crée une nouvelle version ; un bateau bloqué seulement par une avarie et sans statut efa sort « NOTAVAILABLE » ; `LastVariant` peut réutiliser le numéro d'une variante supprimée encore citée par d'anciennes sorties ; l'anonymisation ne retire pas un éventuel `FixedByPersonName` des avaries.
- Sauvegardes : le nettoyage du démarrage tourne en même temps que la première sauvegarde automatique et peut effacer son `.part` (attendre l'un puis l'autre) ; une horloge remise dans le passé fait élaguer aussitôt la sauvegarde qui vient d'être écrite ; restaurer depuis une clé en lecture seule échoue (sqlx ouvre le fichier en WAL) ; exclure `_sqlx_migrations` et `users` de la restauration ; un échec durable de la sauvegarde automatique affiche un message toutes les heures ; un `machineId` perdu (localStorage vidé) laisse les anciennes sauvegardes de ce poste sans élagage.
- RGPD : « Supprimer toutes les données » et l'anonymisation laissent la personne dans les sauvegardes existantes (l'avertissement le dit désormais) ; proposer d'effacer aussi les sauvegardes, et un écran d'anonymisation (la fonction existe sans bouton).
- Onboarding efa : fermer l'app entre la fin de l'import et l'enregistrement de « onboarding terminé » rouvre l'accueil, et choisir alors un autre profil efface le club importé (poser le drapeau dans le script d'import) ; le choix du dossier de copie externe n'attrape pas une erreur du sélecteur.
