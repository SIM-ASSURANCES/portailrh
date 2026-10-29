# Décisions retenues (15/10/2026, session d'exécution des lots 0 à 4)

> Consignées au Lot 0. Règle : « prendre la décision recommandée », sauf D2 (option B, choix explicite de Thierry).

| # | Décision retenue | Effet concret |
|---|---|---|
| D1 | **(a)** branche `conges-permissions` depuis `origin/thierry-kouame` (`c1c4e9a`) | Migration datée `20261021090000` (> dernière de `aristide` : `20261020090000`) |
| D2 | **Option B** — permission d'absence : **responsable du service, puis RH**, comme un congé | Un seul moteur de circuit pour les deux modules (`circuitAbsence.ts`) |
| D3 | Tableau du § 3.1 **tel quel** | À confirmer par la RH avant mise en production |
| D4 | **(a)** un retard accepté reste compté dans le reporting, affiché « acceptée » | Aucun changement du reporting Pointage |
| D5 | **(a)** Pointage mis en service avant les congés ; la purge du Pointage est refusée s'il existe une demande de congé ou de permission | Garde ajoutée dans la purge au Lot 5 (hors lots 0-4) |
| D6 | Règles de solde **non devinées** : règles de la v2 conservées (dotation complète à la date anniversaire, jours entiers, pas de report), isolées dans des fonctions pures faciles à changer | **À demander à la RH** ; provisoire |
| D7 | **(b)** module et permissions renommés `absences` / `absences.*` (rien n'est en production) ; route publique inchangée `/permissions-absence` | Évite la confusion avec « Rôles & permissions » |
| D8 | **(a)** page `/conges/a-decider` (et `/permissions-absence/a-decider`) | Lien + compteur depuis « Mon équipe » au Lot 5 |
| D9 | Rappel quotidien au décideur (plafonné à un par 24 h) | Lot 6, hors périmètre de cette session |
| D10 | Les permissions d'absence réutilisent le même type de décideur que les congés ; `absences.valider_rh` non délégable | Voir `PERMISSIONS_DECISION_NON_DELEGABLES` |

**Périmètre exécuté dans cette session : Lots 0 à 4.** Lots 5 (intégration au socle), 6 (rappels, e2e, doc) et 7 (données) restent à faire.
**Aucune poussée en ligne** : Thierry fusionne et pousse lui-même.

---

# Plan de fusion — Congés et Permissions d'absence (portailRHv2) dans le portail RH

> **Version 2 du 15/10/2026.** Relue sur :
> - `skyjuan03/portailRHv2` (commit `43ea0a4`, inchangé depuis le 14/10) ;
> - `origin/thierry-kouame` (`c1c4e9a`, 14 commits de plus que la version 1 du plan) ;
> - `origin/aristide` (`60c4916`).
>
> Destinataire : la session Claude Code qui exécutera la fusion, et Thierry pour les décisions marquées **À TRANCHER**.
> Règle permanente : **aucune session ne pousse en ligne**. Thierry fusionne et pousse lui-même.

---

## 0. Ce qui a changé dans le dépôt du portail depuis la version 1

### 0.1 `thierry-kouame` : 14 commits (`d1b21cd` → `c1c4e9a`, 41 fichiers, +1041 / −378)

Tests backend sur `c1c4e9a` : **616 sur 616**. L'échec connu de `feedback.test.ts` est corrigé (`c1c4e9a`). Aucune
migration, aucun changement de schéma.

| Commit(s) | Changement | Effet sur la fusion |
|---|---|---|
| `e2b1398` | **Le retard se compte depuis la fin de la tolérance** (07:45 + 15 : 08:10 = 10 min, avant 25 min). Décision du 15/10, documentée dans `CLAUDE.md` et les guides. | Aucun code à changer côté congés. Une permission du matin repousse toujours l'heure de référence, et la tolérance s'ajoute après la fin de la permission. Le test « permission du matin puis arrivée » du Lot 6 doit attendre les minutes de la **nouvelle** règle. Les retards déjà enregistrés gardent leurs minutes (pas de recalcul) : sans effet, les données de test seront purgées. |
| `d5566f6`, `ca55c4f` | **`urlPublique()`**, règle unique des liens absolus dans les e-mails (`AUTH_URL` en production, adresse réseau local en dev), et `reseauLocal.ts` pour le QR en dev. | **Tout lien de congé ou de permission envoyé par e-mail passe par `urlPublique()`**, jamais `NEXTAUTH_URL` ni l'en-tête `host`. |
| `c39792f`, `aeb6a73` | Profil refait pour mobile ; le service n'est plus modifiable par l'utilisateur (Server Action supprimée, lecture seule en base). | La retouche v2 du profil (afficher `dateEmbauche` au lieu de `createdAt`) se reporte sur la **nouvelle** page. |
| `3b2257f` | Accueil (`(dashboard)/page.tsx`) refait pour mobile : cartes d'accès en 2 colonnes. | Les cartes de modules ajoutées par la v2 (congés, permissions d'absence) se reportent sur la **nouvelle** version, en gardant les deux affichages, mobile et bureau. |
| `b3ef3d1`, `e1cec3a`, `4208e3e`, `70cdad8`, `3c68b9c`, `4f47b23`, `2252b05` | Écrans du pointage refaits pour mobile : présence du jour, boîte à outils RH, historique, tous les pointages, absences RH. | Les retouches v2 de `PresenceTabs.tsx` et `AbsencesClient.tsx` concernaient le retard exempté, qui est abandonné. **Rien à reporter** dans ces écrans. Tout nouvel écran des congés doit suivre le même principe : desktop d'abord, puis une version mobile dédiée, vérifiée à 390 px. |

### 0.2 `aristide` : la Trésorerie avance en parallèle

- `aristide` **contient tout `thierry-kouame`** (PR #14 fusionnée le 15/10 à 11:09), plus les lots Trésorerie
  (169 fichiers, +14 350 / −1 803).
- Elle ajoute **8 migrations, datées jusqu'au `20261020090000`**. **La migration des congés doit donc être datée après
  `20261020090000`** : on prend `20261021090000`, et on revérifie le jour du Lot 1, car Aristide peut en ajouter d'autres.
- Elle touche 6 fichiers que la fusion des congés touche aussi : `schema.prisma` (relations du modèle `User`),
  `backend/src/index.ts`, `admin/users/actions.ts` (comptage des relations pour la suppression), `nav.ts`, `Sidebar.tsx`
  et `AppShell.tsx`. Ce sont des conflits **textuels et courts**, mais certains : voir D1.
- **Signalé à Aristide, hors périmètre de la fusion.** Deux migrations portent le même horodatage :
  - `20261014090000_articles_beneficiaire_pieces` (sur `aristide`) ;
  - `20261014090000_execution_tache` (sur `thierry-kouame`).

  Le tri par nom place la sienne **avant** une migration qui sera peut-être déjà appliquée en production. C'est contraire
  à la règle du dépôt (horodatage strictement après la dernière migration). À renommer avant sa PR vers `main`.

### 0.3 `main` n'a pas bougé (`31c0326`)

La V1 fiabilisée (`thierry-kouame`) n'est pas encore dans `main`, donc pas en production.

---

## 1. Ce que contient la v2

### 1.1 Point de départ

La v2 a été copiée du portail vers le **28/09/2026** (commit `815056f`, socle des Encaissements). Elle n'a **aucun
historique git commun** avec `portailrh` (un seul commit). Depuis cette date, `thierry-kouame` a reçu, entre autres :
- le circuit de validation de la Trésorerie ;
- les services et leurs responsables (`Service.responsableId`) ;
- Pointage V2 (justifications, décideur à trois niveaux) ;
- la fiabilisation (planificateur, journal technique, Mon équipe, purge du Pointage).

**Conséquence : on ne fusionne pas avec git.** On reporte le travail de la v2 sur `thierry-kouame`, module par module,
et on l'adapte à l'architecture actuelle.

### 1.2 Inventaire (environ 12 200 lignes nouvelles, **aucun test**)

| Bloc | Contenu v2 | Sort proposé |
|---|---|---|
| **Congés** | `TypeConge`, `SoldeConge`, `AjustementSolde`, `DemandeConge`, `PieceJointeConge` ; `backend/src/conges.ts` ; `/conges/*` (demande, détail, soldes, calendrier, paramétrage, tableau de bord, reporting) ; export ; upload | **Repris**, circuit refait |
| **Permissions d'absence** | `TypePermission`, `DemandePermission` ; `backend/src/permissions-rh.ts` ; `/permissions-absence/*` | **Repris**, circuit refait |
| **Justification de retard « mission entreprise »** | `JustificationRetard`, `Pointage.estExempte`, `/permissions-absence/retard`, `/permissions-absence/justifications` | **Abandonné** : remplacé par `JustificationPointage` (V1) |
| `PieceJointePermission` | Table créée, jamais utilisée | **Abandonnée** |
| `User.dateEmbauche` | Ancienneté et exercice de congé | **Repris** |
| Retouches du socle | `layout.tsx`, `nav.ts`, `Sidebar`, `AppShell`, `page.tsx` (accueil), `TopbarCalendar`, `admin/users`, `admin/roles` | **Reportées à la main** sur les versions V1 |
| Retouches du Pointage | Notification de retard dans `pointage/actions.ts`, tâche des absences, reporting, présence (`estExempte`) | **Abandonnées** : V1 fait déjà mieux (voir § 2.3) |
| `frontend/package.json` : `next build --webpack` | Changement de compilateur | **Non repris** (V1 est vérifiée avec Turbopack) |
| `implementation_plan_report_weekly_montly_yearly`, `docs/` | Autre sujet | Hors périmètre |

### 1.3 Les deux circuits de la v2

**Congés** : `EN_ATTENTE_RESPONSABLE` → `EN_ATTENTE_RH` → `VALIDEE`.
À la validation :
- le solde est débité (si le type est déductible) ;
- une `PlageAbsenceAutorisee` (source `CONGE`) est créée pour chaque jour.

Autres statuts : `REJETEE`, `ANNULEE` (le solde est recrédité, les plages supprimées) et `MODIFICATION_DEMANDEE`.

**Permissions d'absence** (quelques heures) : `EN_ATTENTE` → `APPROUVEE` → `CONSOMMEE` (retour marqué).
- Il y a un plafond mensuel par type.
- Une `PlageAbsenceAutorisee` (source `PERMISSION`) est créée.

---

## 2. Écarts avec l'architecture actuelle

### 2.1 Bloquants (à corriger avant toute mise en production)

| # | Écart | Pourquoi c'est grave | Correction |
|---|---|---|---|
| B1 | **Lecture de fichiers arbitraires du serveur.** `soumettreDemandeCongeAction` accepte `piecesJointes[].url` libre (`z.string().min(1)`), puis `GET /api/conges/pieces-jointes/[id]` fait `readFile(path.join(UPLOAD_DIR, piece.url))`. | Un collaborateur dépose `url: "../../../../proc/self/environ"`, puis télécharge sa propre pièce : il lit `AUTH_SECRET`, `DATABASE_URL`, le mot de passe SMTP. | N'accepter qu'un nom produit par la route d'upload (`^[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$`). Vérifier que le chemin résolu reste dans le dossier. Vérifier l'existence du fichier à la soumission. Même règle pour le congé d'office. |
| B2 | **N'importe quel porteur de `conges.approuver_responsable` approuve la demande de n'importe qui**, y compris la sienne. Aucune notion de service. | Contraire à la règle de la RH (le responsable du service d'abord) et à « personne ne décide sa propre demande ». | Décideur résolu par `Service.responsableId`, comme `resoudreDecideurJustification` (§ 3). |
| B3 | **La RH valide depuis `EN_ATTENTE_RESPONSABLE`** (`validerCongeRHAction` accepte les deux statuts). | Saute l'étape responsable, que la RH a exigée. | La RH ne valide que `EN_ATTENTE_RH`, sauf les cas de repli du § 3. |
| B4 | **Transitions non atomiques.** Le statut est lu hors transaction, puis mis à jour par `id` seul. Le solde est débité par lecture puis écriture (`soldeRestant - n`). | Deux clics simultanés débitent deux fois et créent les plages en double. | `updateMany` conditionné au statut lu (modèle V1), dans la même transaction que le débit. Débit conditionnel (`soldeRestant >= n`). Verrou `pg_advisory_xact_lock` par collaborateur pour le chevauchement et le solde. |
| B5 | **Migrations datées avant la production** (`20260915…`, `20260917…`, `20260928…`), alors que `main` a déjà des migrations jusqu'au 10/10 et `thierry-kouame` jusqu'au 14/10. | Ordre d'application faux ; règle du dépôt (horodatage strictement après la dernière migration). | Une migration neuve, datée après la dernière migration de **toutes** les branches actives : aujourd'hui `20261020090000` (sur `aristide`), donc `20261021090000` (§ 0.2, § 4 Lot 1). |
| B6 | **Permissions créées seulement dans le seed**, et `ensurePermissionsAbsenceModulePermissions()` les attribue au démarrage **par nom de rôle** (`["Collaborateur","RH","DG"]`). | La production n'est jamais re-seedée : le module serait inaccessible. L'attribution par nom de rôle est le défaut déjà corrigé sur FeedbackApp. | Migration idempotente qui crée module et permissions, et les attribue **par permission sœur**. Supprimer `ensurePermissionsAbsenceModulePermissions` et son appel dans `getSession()`. |
| B7 | **Ancienneté calculée sur `createdAt` quand `dateEmbauche` est vide.** | Tous les comptes ont été créés en septembre 2026 : tout le monde aurait 0 mois d'ancienneté, et les permissions exceptionnelles (6 mois requis) seraient refusées à tous. | `dateEmbauche` obligatoire pour pointer les congés ; écran « dates d'embauche manquantes » pour la RH ; jamais de repli silencieux sur `createdAt`. |

### 2.2 Importants

| # | Écart | Correction |
|---|---|---|
| I1 | Références `CNG-AAAAMM-NNNN` et `PRM-…` calculées par `count()+1` : deux soumissions simultanées donnent la même référence, et la seconde échoue sur l'index unique. | Calcul sous verrou consultatif dans la transaction de création. |
| I2 | Notifications à **tous** les porteurs d'une permission (`notifyByPermission`). | Destinataires ciblés : le décideur résolu (même logique que `destinatairesDecideur`), jamais le demandeur. |
| I3 | Plages rattachées au congé par le texte de la description ; suppression par plage de dates. | Colonnes `demandeCongeId` / `demandePermissionId` sur `PlageAbsenceAutorisee`, suppression par ces clés. |
| I4 | La **purge du Pointage** (V1, § 19) supprime toutes les `PlageAbsenceAutorisee`. | **À TRANCHER, D5.** |
| I5 | `supprimerUtilisateurAction` ignore les nouvelles relations vers `User`. | Compter `DemandeConge` (4 relations), `SoldeConge`, `AjustementSolde`, `DemandePermission` (3 relations). |
| I6 | Doublons de règles V1 : `estJourOuvre` dans `conges.ts` (V1 : `estJourNonOuvre`), lecture des jours fériés. | Réutiliser `estJourNonOuvre` et `lireJourNonOuvre`. |
| I7 | Les dates du formulaire sont lues en UTC (`T00:00:00.000Z`), le reste du module en heure locale du serveur. | Sans effet à Abidjan (UTC+0), mais on aligne sur les fonctions V1 pour ne pas avoir deux conventions. |
| I8 | Aucun test. | Logique pure dans `backend/src` + vitest ; un scénario Playwright par circuit dans `e2e/`. |

### 2.3 Ce que V1 fait déjà (ne pas reprendre la version v2)

- **Retard justifié** : `JustificationPointage`, avec décideur à trois niveaux, relances et clôture. La « justification de
  retard mission entreprise » de la v2 fait doublon : elle est abandonnée.
- **Absences couvertes par un congé ou une permission** : la tâche des absences V1 (`lib/taches/absences.ts`) ignore un
  jour entièrement couvert (`journeeCouverteParAbsence`). La v2 créait une absence « JUSTIFIEE » : sa version est
  abandonnée.
- **Retard avec permission du matin** : `checkLateStatus` repousse l'heure de référence à la fin de la plage.
- **Présence du jour et Mon équipe** : onglet « Absence autorisée » alimenté par les plages.

**Conclusion : le seul point de contact entre Congés/Permissions et Pointage est `PlageAbsenceAutorisee`.**
La v2 n'a rien d'autre à modifier dans le Pointage.

---

## 3. Le circuit cible (aligné sur les responsables)

### 3.1 Congés : responsable du service, puis RH

| Situation du demandeur | Étape responsable | Étape RH |
|---|---|---|
| Cas normal | Le responsable actuel de son service | Un compte dont le **rôle** porte `conges.valider_rh` |
| Il est responsable de son service, le service n'a pas de responsable, ou le responsable est désactivé | **Non requise** (affichée ainsi) | RH |
| Il est lui-même RH | Responsable de son service (s'il existe et n'est pas lui) | **Un autre** compte RH ; s'il n'y en a pas, le DG |
| Il est DG | Non requise | RH |

**À TRANCHER, D3** : on applique ce tableau, ou une variante.

Règles :
- Personne ne décide sa propre demande, à aucune étape.
- Le droit de décider se lit sur le **rôle** (`rolePermissions`), jamais par délégation (même choix que les
  justifications).
- Le responsable n'a besoin d'**aucune permission** : c'est `Service.responsableId` qui le désigne (même principe que
  « Mon service » en Trésorerie et « Mon équipe »).

### 3.2 Permissions d'absence

**À TRANCHER, D2** : qui décide ?

### 3.3 Implémentation commune

Un moteur pur `backend/src/circuitAbsence.ts`, testé, qui expose :
- `resoudreDecideurConge(demande, service, comptesRH, dg)` → `{ etape, decideurs, raison }` ;
- `transitionConge(etat, action, acteur)` → nouvel état ou refus motivé ;
- `resoudreDecideurPermission(...)` et `transitionPermission(...)`.

Réutiliser ce qui existe déjà dans `justificationPointage.ts` :
- `refusDecideur`, ou la même règle généralisée dans une fonction partagée ;
- `chargerComptesRH`, généralisé avec la permission en paramètre.

---

## 4. Plan d'exécution par lots

Chaque lot = un commit sur la branche de travail. Après chaque lot :
- `vitest` + `tsc` + `eslint` ;
- les migrations rejouées depuis zéro sur PostgreSQL 16 jetable, et `migrate diff` vide.

**Lot 0 — Préparation**
- `git fetch` puis créer la branche de travail (D1) depuis `origin/thierry-kouame` (`c1c4e9a` au 15/10). Vérifier
  d'abord `vitest` à 616 sur 616 : c'est la référence de non-régression.
- Copier la v2 dans un dossier à part, jamais dans le dépôt, pour s'y référer.
- Consigner les réponses aux décisions D1 à D9 en tête de ce plan.

**Lot 1 — Schéma et migration unique** (`20261021090000_conges_permissions_absence`)
- Avant de créer le dossier : `git fetch` et lister les migrations de `origin/aristide` et `origin/thierry-kouame`.
  Si l'une dépasse `20261021090000`, dater après elle.
- Modèles congés et permissions d'absence repris de la v2, **sans** `JustificationRetard`, `Pointage.estExempte` ni
  `PieceJointePermission`.
- `User.dateEmbauche` (`ADD COLUMN IF NOT EXISTS`).
- `PlageAbsenceAutorisee.demandeCongeId` / `demandePermissionId` (I3), clés étrangères et index.
- Colonnes du circuit : étape responsable requise ou non, `decideurResponsableId`, `decideurRhId`, dates.
- Modules `conges` et le module des permissions d'absence. Permissions créées dans la migration et attribuées par
  permission sœur :

  | Permission(s) | Attribuée aux rôles qui portent |
  |---|---|
  | `conges.soumettre`, `permissions.soumettre` | `pointage.pointer` |
  | `conges.valider_rh`, paramétrage, soldes | `pointage.corriger_pointage` |
  | Tableaux de bord DG | `treso.decider_dg` |

  La migration est idempotente. Le seed est mis à jour en parallèle.
- `conges.approuver_responsable` n'existe plus (le responsable est désigné par le service).
- `conges.valider_rh` est ajoutée à `PERMISSIONS_DECISION_NON_DELEGABLES`.
- Suppression de `ensurePermissionsAbsenceModulePermissions`.
- Vérifications : migration depuis zéro ; migration sur une base dans l'état de production (sans seed), rejouée sans
  effet.

**Lot 2 — Logique pure + tests**
- `backend/src/congesCalcul.ts` : jours (ouvrables ou calendaires, avec `estJourNonOuvre`), exercice depuis la date
  d'embauche, ancienneté, solde suffisant, chevauchement.
- `backend/src/circuitAbsence.ts` (§ 3.3).
- Tests vitest :
  - samedi, dimanche, jour férié ;
  - congé à cheval sur deux exercices (**À TRANCHER, D6**) ;
  - les 4 cas du tableau 3.1 ;
  - refus de décider pour soi ;
  - repli RH puis DG ;
  - transitions interdites.

**Lot 3 — Congés : actions et écrans**
- Actions de la v2 réécrites sur le moteur : soumission, décision du responsable, décision RH, modification demandée,
  annulation, congé d'office, soldes, types.
- Corrections B1 à B4 et I1, I2 ; notifications ciblées. Tout lien absolu d'un e-mail passe par `urlPublique()`
  (`backend/src/urlPublique.ts`), jamais `NEXTAUTH_URL`, `AUTH_URL` lu directement ni l'en-tête `host`.
- Écrans de la v2 recopiés et branchés sur les nouvelles actions. Ajout d'une file « Congés à décider » pour le
  responsable : depuis « Mon équipe » ou une page `/conges/a-decider` (**À TRANCHER, D8**).
- Historique (`HistoriqueEntry`) à chaque transition.
- Chaque écran : bureau d'abord, puis une version mobile dédiée, vérifiée à 390 px (même principe que les écrans du
  pointage refaits le 15/10). Pas de tableau à défilement horizontal sur mobile.

**Lot 4 — Permissions d'absence : actions et écrans**
- Même traitement, selon D2. Garder le plafond mensuel, l'exception de plafond et le retour marqué (`CONSOMMEE`).

**Lot 5 — Intégration au socle**
- Reporter à la main, sur les versions **actuelles** de `thierry-kouame` (jamais copier le fichier v2 entier) :
  `layout.tsx` (indicateurs de menu), `nav.ts`, `Sidebar`, `AppShell`, `admin/users` (date d'embauche), `admin/roles`.
- Accueil `(dashboard)/page.tsx` : ajouter les cartes des deux modules dans la version mobile (`3b2257f`, grille à
  2 colonnes) **et** dans la version bureau.
- Profil : afficher `dateEmbauche` (au lieu de `createdAt`) sur la nouvelle page (`c39792f`, `aeb6a73`). Le service y
  reste en lecture seule : ne pas réintroduire de Server Action de changement de service.
- Rien à reporter dans `PresenceTabs.tsx` ni `AbsencesClient.tsx` (les retouches v2 portaient sur le retard exempté,
  abandonné).
- `TopbarCalendar` (inchangé dans V1 depuis la copie) : reprendre la version v2 telle quelle.
- `supprimerUtilisateurAction` (I5).
- Purge du Pointage selon D5.
- Mon équipe : congés et permissions du jour déjà visibles via les plages ; ajouter le compteur « à décider ».
- Préparer les conflits avec `aristide` (§ 0.2) : dans `schema.prisma`, ajouter les relations du modèle `User` **en
  fin de bloc**, regroupées sous un commentaire `// Congés et permissions d'absence` ; dans `backend/src/index.ts`,
  les exports en fin de fichier. Les conflits se règlent alors en gardant les deux blocs.

**Lot 6 — Rappels, recette automatisée, documentation**
- Rappel des demandes en attente : une tâche dans le planificateur (`executerTache`), par exemple une fois par jour, au
  plus un rappel par 24 h et par demande (**À TRANCHER, D9**).
- Playwright `e2e/conges.mjs` et `e2e/permissions-absence.mjs` sur base jetable :
  - collaborateur → responsable → RH ;
  - responsable demandeur ;
  - RH demandeur ;
  - double clic ;
  - pièce jointe avec un chemin piégé, refusée (B1) ;
  - solde ;
  - plage visible dans Présence du jour ;
  - aucune absence créée par la tâche ;
  - permission du matin (07:30 → 10:00, elle doit couvrir 07:45) puis arrivée à 10:20 : 5 minutes de retard (référence 10:00 + 15 min de
    tolérance, nouvelle règle `e2b1398`), et non 20 ;
  - lien d'un e-mail de congé : construit par `urlPublique()`.
- `vitest` : 616 tests existants toujours verts, plus les nouveaux.
- `CLAUDE.md` : section « Module Congés et Permissions d'absence ». Guide RH dans `docs/`.

**Lot 7 — Préparation des données et livraison**
- La RH saisit toutes les dates d'embauche (B7) et les soldes de départ (reliquats de l'année en cours) avant
  l'ouverture.
- Démonstration à la RH sur la recette, puis déploiement par le superviseur.

---

## 5. Décisions à prendre

| # | Question | Options | Recommandation |
|---|---|---|---|
| **D1** | D'où part la branche dédiée (ex. `conges-permissions`), fusionnée dans `thierry-kouame` une fois prête ? | (a) Depuis `origin/thierry-kouame`. Indépendante de la Trésorerie ; un correctif du pointage peut toujours partir seul. Coût : 6 conflits courts à régler le jour où `aristide` et les congés se rejoignent. (b) Depuis `origin/aristide`. Aucun conflit plus tard. Coût : le module des congés dépend d'un travail encore en cours, non relu, qui n'est pas dans `main` ; impossible de livrer les congés sans livrer aussi la Trésorerie d'Aristide. | **(a)**, avec la migration datée après la dernière d'`aristide` (§ 0.2). Le conflit se règle une fois, à la main ; une dépendance à un lot non terminé bloque toute la livraison. |
| **D2** | Qui décide une permission d'absence (quelques heures) ? | (a) Le responsable seul, repli RH puis DG ; la RH est informée. (b) Responsable puis RH, comme un congé. (c) La RH seule (v2 actuelle). | **(a)** : décision rapide pour une sortie de quelques heures, et cohérente avec les justifications de retard. **À demander à la RH.** |
| **D3** | Le tableau du § 3.1 convient-il ? | Tel quel, ou variante. | Tel quel. À confirmer par la RH. |
| **D4** | Un retard accepté par le responsable doit-il sortir des totaux de retard du reporting (ce que faisait `estExempte`) ? | (a) Non, il reste compté et affiché « acceptée » (V1 actuelle). (b) Oui, exclu des totaux d'après `JustificationPointage.statut = ACCEPTEE`. | **(a)** tant que la RH ne le demande pas ; (b) se fait plus tard sans migration. |
| **D5** | Purge du Pointage et congés | (a) Mettre le Pointage en service **avant** de déployer les congés (la purge est alors verrouillée) et faire refuser la purge si une demande de congé existe. (b) La purge garde les plages liées à une demande. | **(a)** : le plus simple, et c'est l'ordre naturel. |
| **D6** | Règles de solde | Dotation annuelle complète à la date anniversaire (v2) ou acquisition mensuelle ; demi-journées ou non ; report des jours non pris ; congé à cheval sur deux exercices. | **Ne pas deviner : à demander à la RH.** Le moteur doit suivre sa réponse. |
| **D7** | Clé du module des permissions d'absence | (a) Garder `permissions.*`. (b) Renommer en `absences.*` tant que rien n'est en production. | (b) si c'est fait au Lot 1 (recherche et remplacement, aucune donnée) : `permissions.approuver` se confond avec « Rôles & permissions ». Sinon (a). |
| **D8** | Où le responsable décide-t-il ? | (a) Page `/conges/a-decider`. (b) Onglet dans « Mon équipe ». | **(a)** avec un lien et un compteur depuis Mon équipe. |
| **D9** | Rappels | Aucun, ou rappel quotidien au décideur. | Rappel quotidien via le planificateur, plafonné à un par 24 h. |

---

## 6. Ce que la session ne fait pas

- Elle ne pousse **aucune** branche. Thierry fusionne dans `thierry-kouame` puis pousse lui-même.
- Elle ne touche pas aux modules Trésorerie et Encaissements, ni au circuit des justifications de pointage, sauf pour
  généraliser une fonction et en ajouter les tests.
- Elle ne reprend pas `next build --webpack`, la notification de retard ajoutée dans `pointage/actions.ts`, ni la
  version v2 de la tâche des absences.
- Elle ne touche pas à la branche `aristide` et ne renomme pas sa migration en collision : c'est Aristide qui le fait
  (§ 0.2).

---

## 7. Rappels hors fusion (V1 à déployer)

La V1 fiabilisée n'est pas encore dans `main`. Les congés ne doivent pas partir avant elle :
1. PR `thierry-kouame` → `main`, relue par le superviseur.
2. Avant le déploiement : désactiver (jamais supprimer) les comptes de test, supprimer les tâches cron-job.org
   (le planificateur intégré les remplace), renseigner le SMTP dans Dokploy, finir le transfert Firebase.
3. Mise en service du Pointage (purge puis verrou), **avant** le déploiement des congés (D5).
