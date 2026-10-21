# Mise en production — procédure complète (lots N et O)

Procédure **répétable**, à suivre pas à pas, sans l'équipe de développement. Elle couvre : la sauvegarde, les migrations, le rattrapage des
données existantes, la configuration des rôles, la réinitialisation des données de test, le solde d'ouverture de caisse, les tâches
planifiées, la vérification finale, le retour arrière et la levée du verrou de réinitialisation.

> **Règles qui valent pour TOUTE la procédure**
> - **Sauvegarder avant d'écrire** (étape 1). Chaque outil ci-dessous est en **simulation par défaut** (aucune écriture) ; l'écriture exige `--appliquer`
>   **et** une phrase à taper.
> - **Jamais `prisma migrate dev` ni `prisma migrate reset`** sur la base de production : uniquement `prisma migrate deploy`.
> - **Ne jamais relancer le seed en production** (il vide des tables).
> - **Ne jamais modifier à la main une écriture du journal de caisse.** La seule suppression du journal de caisse est celle de la réinitialisation
>   (étape 5), qui remet à zéro les données de test.
> - Les commandes se lancent **dans le conteneur `app`** (Dokploy : onglet « Terminal » du service `app`, ou `docker exec -it <conteneur-app> sh`),
>   depuis `/app/backend`. Les variables (`DATABASE_URL`, `AUTH_URL`, `AUTH_SECRET`, `CRON_SECRET`…) y sont déjà définies.
> - **Prérequis d'image** : les scripts importent les sources de `backend/src`. Depuis le lot N+O le `Dockerfile` les copie dans l'image
>   (`COPY … /app/backend/src`). **Déployer d'abord l'image qui contient ce lot**, sinon `npx tsx prisma/…` répond « Cannot find module ».

## Vue d'ensemble

| # | Étape | Outil | Écrit ? |
|---|---|---|---|
| 1 | Sauvegarde complète, gel des accès, variables | `pg_dump`, copie du volume `uploads` | non |
| 2 | Migrations | `prisma migrate deploy`, `prisma generate` | schéma |
| 3 | Rattrapage des données existantes | `rattrapage-production.ts` | oui (après `--appliquer`) |
| 4 | Configuration : rôles, signatures, seuils, date de catégorisation | écrans `/admin/roles`, `/profil`, `/treso/finance/budgets` | oui (config) |
| 5 | Réinitialisation des données de test, puis comptes de test | `reinitialiser-production.ts` (ou écran DG) | oui |
| 6 | Solde d'ouverture de caisse | écran `/treso/finance/solde-ouverture` | oui |
| 7 | Tâches planifiées | planificateur intégré (rien à configurer) | — |
| 8 | Vérification finale et parcours de test | `verifier-mise-en-production.ts --final` | non |
| 9 | Retour arrière | restauration de la sauvegarde | — |
| 10 | Levée du verrou de réinitialisation | une commande SQL | oui |

> **État actuel de la production.** La réinitialisation globale a **déjà été exécutée** le 26/09/2026 (ligne `ReinitialisationSysteme`, verrou actif). Pour
> purger de nouveau les données de test avant l'ouverture, il faut **lever ce verrou** (étape 10, à faire AVANT l'étape 5). La ligne d'audit du 26/09 est conservée.

---

## 1. Avant : sauvegarde complète, gel des accès, variables

1. **Prévenir les utilisateurs** et **geler les accès** : pendant l'opération, personne ne doit saisir. Le plus simple : arrêter le service `app` dans Dokploy (la base reste
   démarrée), ou afficher la page de maintenance du serveur frontal. Les scripts n'ont pas besoin du service `app` démarré.
2. **Sauvegarde de la base** (format personnalisé, restaurable table par table) — depuis le serveur :
   ```bash
   docker exec <conteneur-db> pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > sauvegarde-portail-$(date +%F-%H%M).dump
   ls -lh sauvegarde-portail-*.dump          # taille non nulle
   docker exec -i <conteneur-db> pg_restore -l < sauvegarde-portail-AAAA-MM-JJ-HHMM.dump | head   # le fichier se relit
   ```
3. **Sauvegarde des fichiers** (pièces jointes, volume `uploads`) :
   ```bash
   docker run --rm -v <projet>_uploads:/u -v "$PWD":/b alpine tar czf /b/uploads-$(date +%F-%H%M).tgz -C /u .
   ```
4. **Copier ces deux fichiers hors du serveur** (poste de la direction, stockage distinct). Une sauvegarde qui reste sur le même disque que la base n'en est pas une.
5. **Vérifier les variables d'environnement** (onglet Environment de Dokploy) — le script de l'étape 8 les contrôle aussi, mais autant le savoir tout de suite :
   `AUTH_URL` = URL **publique en https** (ex. `https://portailrh.mysimassurances.com`), `AUTH_SECRET` (≥ 32 caractères), `CRON_SECRET` (≥ 16),
   `DATABASE_URL`, `ALLOWED_OFFICE_IPS` (IP publique du bureau). Les valeurs ne sont jamais affichées par les scripts.

## 2. Migrations

Déployer l'image qui contient les lots N et O (le service `init` applique les migrations à chaque déploiement). Pour le faire ou le vérifier à la main :

```bash
cd /app/backend
npx prisma migrate deploy       # applique les migrations en attente (aucune écriture de données métier)
npx prisma generate             # régénère le client Prisma (déjà fait dans l'image ; sans danger)
npx prisma migrate status       # attendu : « Database schema is up to date! »
```

**Les lots N et O n'ajoutent aucune migration** (la dernière reste `20261029090000_motifs_echanges_finance_dg`).

## 3. Rattrapage des données existantes

Met à niveau les données créées **avant** les derniers lots (statut des demandes à articles, règlements non rattachés à un article, demandes clôturées avant la règle
« tous les articles terminés », historique non lié à sa signature). Cinq étapes, **dans cet ordre** (il compte) : comptage (lecture seule) → statuts (lot B) →
règlements (lot D) → clôture (lot C) → signatures (lot L bis).

```bash
cd /app/backend
# 3.1 SIMULATION (par défaut) : compte et liste, n'écrit RIEN
npx tsx prisma/rattrapage-production.ts
# 3.2 APPLICATION : après avoir lu la simulation ET fait la sauvegarde de l'étape 1
npx tsx prisma/rattrapage-production.ts --appliquer          # tape RATTRAPER quand le script le demande
# 3.3 CONTRÔLE : une nouvelle simulation ne doit plus rien trouver à traiter
npx tsx prisma/rattrapage-production.ts
```

Lecture du rapport : pour chaque étape, **à traiter / écrites / restant / ambigus**. Après l'application, la colonne « restant » doit être **0** partout
(« Idempotence : une nouvelle simulation ne trouve plus RIEN »). Le script **s'arrête à la première erreur** ; les étapes déjà passées restent faites mais sont
idempotentes : corriger puis relancer.

- **Cas ambigus** (jamais devinés) : un règlement sans article sur une demande dont **deux articles ou plus** sont validés. Le rapport les liste (règlement, montant,
  articles). Les rattacher **à la main**, un par un :
  `npx tsx prisma/recalculer-reglements-articles.ts --affecter ID_REGLEMENT:ID_ARTICLE` (simulation, affiche « permis »), puis le même avec `--appliquer`.
  Tant qu'un cas ambigu existe, aucun règlement ne peut être créé ni confirmé sur cette demande (l'annulation reste possible).
- **Historique à signatures multiples** : les lignes dont plusieurs signatures de versions différentes sont candidates restent « Signature non rattachée » (information, pas une erreur).
- **Étapes non défaisables par le script** : 2, 3, 4 et 5 écrivent ; le seul retour arrière est la restauration de la sauvegarde (étape 9). Elles sont **rejouables** (idempotentes) sans danger.
- Le journal de caisse n'est **jamais** touché par ces étapes.
- Chaque script de reprise reste utilisable seul (même code, simulation par défaut) : `recalculer-statuts-articles.ts`, `recalculer-reglements-articles.ts`
  (`--automatique`, `--affecter`), `simuler-cloture-articles.ts`, `rattacher-signatures.ts`, et le comptage SQL `comptage-reglements-articles.sql` (lecture seule :
  `psql "$DATABASE_URL" -f prisma/comptage-reglements-articles.sql`).

## 4. Configuration (écrans de l'application)

À faire avec des **comptes réels** (pas les comptes de test), avant la réinitialisation : tout ce qui suit est **conservé** par la purge.

### 4.1 Rôles — `/admin/roles` (les cases à cocher exactes)

| Rôle | À COCHER | À DÉCOCHER |
|---|---|---|
| **Finance** | `treso.decider_finance`, `treso.soumettre_dg`, `treso.cloturer_demande`, `treso.modifier_budget_categorie`, `treso.reorienter_demande` (et `treso.valider_demande`, `treso.categoriser_demande`, `treso.annuler_reglement`, `treso.ajuster_retour`, `treso.valider_remboursement`, `treso.valider_retour_exceptionnel`, `treso.creer_retour_externe`, `treso.deleguer_acces`, `treso.modifier_description`, `treso.gerer_categories`, `treso.alimenter_caisse`, `treso.corriger_solde_ouverture`, `treso.saisir_depense_directe`, `treso.voir_dashboard_finance`, `treso.voir_reporting`) | **`treso.approuver_validation_complete`** (réservée au DG : la règle des deux personnes) |
| **DG** | `treso.approuver_validation_complete`, `treso.decider_dg`, `treso.valider_budget`, `systeme.reinitialiser`, `treso.voir_dashboard_finance`, `treso.voir_reporting` | `treso.valider_demande` (retirée du DG par la migration du 2026-10-08 ; vérifier) |
| **Assistant Finance** | `treso.effectuer_reglement`, `treso.receptionner_retour` | tout le reste |
| **RH** | `pointage.corriger_pointage` (+ le reste du pointage) | — |
| **Admin** | — | **`treso.approuver_validation_complete`** si elle y figure (anomalie connue de la production : Finance **et** Admin la portaient) |

`treso.valider_budget` ne doit être détenue **que par le DG** (le script de vérification le contrôle). Les permissions de décision (`decider_finance`, `soumettre_dg`, `decider_dg`,
`approuver_validation_complete`) ne sont **jamais délégables**.

### 4.2 Comptes et services
- **Au moins 2 Assistants Finance actifs** (continuité : personne ne règle sa propre demande) et **au moins 2 comptes RH** portant `pointage.corriger_pointage`.
- **Chaque compte actif a un service** ; **chacun des 8 services a un responsable actif** (`/admin/services`).
- **Délégations de `pointage.corriger_pointage`** : le script de vérification les liste pour contrôle manuel (`/admin/delegations`).

### 4.3 Signatures manuscrites
Chaque compte qui valide, règle, clôture ou répond à une étape (Finance, DG, Assistants Finance, responsables de service) **dessine sa signature une fois** dans
`/profil` → « Ma signature ». Sans elle, ses actions sensibles sont refusées. Ce n'est **pas** une signature électronique qualifiée : une traçabilité interne. Le script de l'étape 8 liste les
signatures manquantes. Les signatures enrôlées sont **conservées** par la purge.

### 4.4 Seuils de caisse et budgets (Finance soumet, DG valide) — `/treso/finance/budgets`
- **Budget de caisse** : la Finance soumet les **seuils** (orange **100 000 FCFA**, rouge **0 FCFA**) avec une **date d'effet** (au plus tôt aujourd'hui) ; le **DG les valide**.
  Sans seuil validé, le script répond « À CORRIGER ».
- **Budgets de catégorie** : les budgets existants ont été **repris par migration** avec des seuils par défaut (**20 % orange / 0 % rouge**) mais **sans décision du DG** : ils
  restent « à confirmer ». La Finance resoumet chaque catégorie (même montant, seuils 20 % / 0 %, date d'effet), le **DG valide en lot**. Tant que ce n'est pas fait, le script
  signale « budget en vigueur repris par migration — à confirmer par le DG ».
- Motif de 10 à 300 caractères obligatoire dans les deux sens (Finance → DG et DG → Finance).

### 4.5 Date « catégorisation obligatoire »
Onglet « Catégories » de `/treso/finance/budgets` : fixer une date **dans le futur** (laisser le temps de catégoriser). Vide = jamais obligatoire ; atteinte = obligatoire dès maintenant
(avertissement du script dans ces deux cas).

### 4.6 Vérification intermédiaire
```bash
cd /app/backend && npx tsx prisma/verifier-mise-en-production.ts      # lecture seule ; les comptes de test actifs ne sont qu'un avertissement à ce stade
```
Corriger tous les « À CORRIGER » sauf ceux qui concernent explicitement les comptes de test, qui seront traités à l'étape 5.

## 5. Réinitialisation des données de test, puis comptes de test

**Rappel : la réinitialisation globale a déjà été faite le 26/09/2026 — son verrou est actif.** Lever le verrou (étape 10) **uniquement** après avoir décidé de purger de nouveau.

Ce que fait la purge (tableau complet en annexe A) : supprime **toutes les données de test** — demandes, articles, règlements, retours, remboursements, retours exceptionnels et externes,
journaux de caisse et de banque, pièces jointes (et leurs fichiers), confirmations de dépassement, réorientations et reprises (portées par l'historique), actions signées, notifications de
Trésorerie/RH/Pointage, historiques liés, pointages, justifications, corrections, absences et plages d'absence, feedbacks, journaux techniques, et les données de test d'Encaissements
(seulement tant que le module n'est pas mis en service). Elle **conserve** les comptes, rôles, permissions, délégations, services et responsables, catégories et objets, budgets et seuils validés
(avec leur historique de validation), paramètres (dont la date de catégorisation), **signatures enrôlées**, horaires, jours fériés, jetons de notification et l'audit d'administration.

### 5.1 Simulation
```bash
cd /app/backend
npx tsx prisma/reinitialiser-production.ts           # n'écrit RIEN : nombre de lignes par table, fichiers, état du verrou, tables conservées
```
Lire le décompte. **Vérifier que le nombre de lignes correspond à ce qu'on s'attend à perdre.**

### 5.2 Purge réelle (ligne de commande) — avec tous ses garde-fous
```bash
npx tsx prisma/reinitialiser-production.ts --appliquer \
  --utilisateur <email du DG> \
  --dossier-sauvegarde /app/uploads/sauvegardes-reinitialisation \
  --uploads /app/uploads
# le script demande de taper exactement : REINITIALISER
```
Garde-fous (aucun n'est contournable) :
1. le compte `--utilisateur` doit porter `systeme.reinitialiser` **par son rôle** (le DG ; jamais une délégation, jamais l'Admin) et être actif ;
2. phrase exacte `REINITIALISER` (casse comprise) ;
3. **sauvegarde JSON complète** de ce qui va être supprimé, écrite dans le dossier indiqué, **relue et vérifiée** (empreinte) **avant** la purge — si elle échoue, **rien n'est supprimé** ;
4. la purge relit les données dans sa propre transaction et **refuse si elles ont changé depuis la sauvegarde** ; tout se passe en **une seule transaction** (tout ou rien) ;
5. **verrou** : une ligne `ReinitialisationSysteme` interdit toute seconde purge ; le verrou ne se lève que par la commande SQL de l'étape 10.

La sauvegarde JSON ne contient **pas** les fichiers de `uploads/` (seulement leurs références) : ils ont été copiés à l'étape 1. Copier ensuite le fichier
`sauvegarde-reinitialisation-AAAA-….json` hors du serveur.

**Par l'écran** (équivalent) : le DG ouvre `/systeme/reinitialisation`, télécharge la sauvegarde, tape `REINITIALISER`, confirme. Mêmes garde-fous.

### 5.3 Conséquences à connaître
- **Le solde de caisse repart à zéro** : le grand livre `JournalCaisse` est vidé, **solde d'ouverture compris** → étape 6. Tant qu'il n'est pas ressaisi, le solde de caisse affiché est 0 et
  les seuils de caisse (rouge à 0 FCFA) peuvent bloquer une validation : **saisir le solde d'ouverture avant d'ouvrir l'application**.
- La numérotation `DEM-AAAA-NNNNNN` **repart de 1**.
- Les **tâches planifiées** repartent proprement : la détection des absences ne remonte jamais avant le lendemain de la purge (la date est enregistrée à l'audit) — **aucune variable
  `SYSTEM_START_DATE` à régler**.
- Un partenaire ou une branche d'Encaissements créé(e) par un import de test est **conservé(e)** (configuration) : à contrôler à la main dans `/encaissements/branches` et les partenaires.
- Le compte du DG qui a lancé la purge ne peut plus être supprimé (il figure à l'audit).

### 5.4 Comptes de test
Désactiver **chaque** compte `*@simassurances.test` dans `/admin/users` (« Désactiver ») : connexion refusée, sessions en cours coupées, historique intact, réversible.
**Ne pas les supprimer** : la suppression est refusée pour tout compte qui a une trace d'activité (audit de connexion, signature…). Ne jamais attribuer le rôle DG à un compte de test
(la permission appartient au rôle). Vérifier ensuite : `npx tsx prisma/verifier-mise-en-production.ts --final` ne doit plus signaler de compte de test actif.

## 6. Solde d'ouverture de caisse

Après la purge, la caisse est vide. Avec un compte **Finance** (permission `treso.corriger_solde_ouverture`) : `/treso/finance/solde-ouverture` → « Définir le solde d'ouverture » : montant
physiquement présent en caisse, **pièce justificative obligatoire** (comptage signé, photo du coffre), motif facultatif. **Opération unique** : une erreur se corrige ensuite par une écriture tracée distincte
(« Corriger le solde d'ouverture »). Aucune écriture forcée en base. Les apports ultérieurs passent par « Nouvelle alimentation de caisse ».

## 7. Tâches planifiées

**Depuis le 2026-10-14 les tâches tournent dans l'application** (planificateur intégré démarré par `frontend/src/instrumentation.ts`) : **aucune configuration cron-job.org n'est nécessaire** — et il
faut même **supprimer** les anciennes tâches cron-job.org pour éviter un double appel (sans danger pour les données : verrou et idempotence, mais inutile).

| Tâche | Cadence (heure d'Abidjan) |
|---|---|
| Relances de justification du pointage | toutes les 5 minutes |
| Absences et oublis de départ | lundi-vendredi, 17:30 et 20:00 |
| Purge des journaux (> 90 jours) | chaque jour à 03:00 |

À vérifier : `/admin/journal-technique` → « Moniteur des tâches » (dernière exécution, prochaine attendue, pas de badge « En retard »), et que `PLANIFICATEUR_ACTIF` n'est **pas** à `false`.
**Secours** (si le planificateur doit rester coupé) : appeler les routes avec `CRON_SECRET`, toutes les 5 minutes pour les relances :
```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domaine>/api/cron/relances-justification
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domaine>/api/cron/absences        # lundi-vendredi 17:30 et 20:00
```
Premier passage du planificateur en production : « clôture initiale » unique, sans aucun envoi (justifications d'avant le jour courant → non justifiées ; absences à contrôler → confirmées), tracée au
journal technique (`CLOTURE_INITIALE`).

## 8. Vérification finale, puis parcours de test

```bash
cd /app/backend
npx tsx prisma/verifier-mise-en-production.ts --final       # LECTURE SEULE ; code de sortie ≠ 0 s'il reste un « À CORRIGER »
echo $?                                                      # attendu : 0
```
Ce que le script contrôle : toutes les migrations appliquées ; rôle Finance (sans `approuver_validation_complete`, avec `soumettre_dg`, `decider_finance`, `cloturer_demande`,
`modifier_budget_categorie`, `reorienter_demande`) ; rôle DG (`approuver_validation_complete`, `systeme.reinitialiser`, `valider_budget`, et `valider_budget` détenue par le DG seul) ; au moins 2
Assistants Finance et 2 RH avec `pointage.corriger_pointage` ; un service par compte actif ; un responsable actif par service ; une signature par compte qui doit signer ; seuils de caisse en vigueur et
validés par le DG ; budgets de catégorie en vigueur validés ; date de catégorisation (avertissement si absente ou non future) ; variables `AUTH_URL` (https public), `AUTH_SECRET`, `CRON_SECRET`, `DATABASE_URL`
(valeurs jamais affichées) ; comptes `*@simassurances.test` (en `--final`, un compte de test **actif** est « À CORRIGER ») ; délégations actives de `pointage.corriger_pointage` (à contrôler à la main).

**Parcours de test complet** (avec des comptes réels, montants symboliques) : un collaborateur crée une demande à plusieurs articles → son responsable de service la valide → la Finance décide (et
soumet un article au DG, qui répond) → un Assistant Finance règle (Caisse) → le collaborateur déclare son retour → l'Assistant le réceptionne → l'approbation du DG puis la clôture par la Finance ; côté pointage :
pointer par QR, justifier un retard, décision du responsable. ⚠️ **Ce parcours laisse des données dans la base réelle** (une demande, une sortie de caisse…). Le plus propre : le faire **avant l'étape 5**
(répétition générale que la purge effacera). Si vous le faites après, annulez le règlement de test (écriture compensatoire) et conservez la demande comme « TEST », ou levez le verrou (étape 10) et purgez de nouveau.

## 9. Retour arrière (si ça se passe mal)

1. **Arrêter le service `app`** (plus aucune écriture).
2. **Restaurer la base** depuis la sauvegarde de l'étape 1 :
   ```bash
   docker exec -i <conteneur-db> psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE \"$POSTGRES_DB\";" -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"
   docker exec -i <conteneur-db> pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < sauvegarde-portail-AAAA-MM-JJ-HHMM.dump
   ```
3. **Restaurer les fichiers** : `docker run --rm -v <projet>_uploads:/u -v "$PWD":/b alpine sh -c "rm -rf /u/* && tar xzf /b/uploads-AAAA-MM-JJ-HHMM.tgz -C /u"`.
4. **Redéployer l'image précédente** (tag d'avant : la base restaurée a l'ancien schéma, `migrate deploy` ne rejoue rien d'inutile).
5. Le verrou de réinitialisation et l'audit reviennent à leur état d'avant (c'est la même base). Rien à faire de plus.

Une purge **déjà faite** peut aussi se « défaire » partiellement avec la sauvegarde JSON de l'étape 5 (les lignes supprimées y figurent), mais la restauration complète du `pg_dump` reste la seule voie sûre.

## 10. Lever le verrou de réinitialisation (réinitialisation ultérieure VOLONTAIRE)

Le verrou est la ligne `ReinitialisationSysteme` dont `verrou = 'REINITIALISATION'`. Le lever **ne supprime pas** la ligne d'audit : elle reçoit une valeur `LEVE-<id>`, ce qui permet une nouvelle purge
(qui reposera un verrou et écrira une nouvelle ligne d'audit). **Faire d'abord la sauvegarde de l'étape 1.**
```bash
docker exec -it <conteneur-db> psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```
```sql
-- 1) Regarder : une ligne attendue avec verrou = 'REINITIALISATION' (qui, quand, combien de lignes supprimées)
SELECT id, "effectueeAt", verrou, "sauvegardeSha256" FROM "ReinitialisationSysteme" ORDER BY "effectueeAt";
-- 2) Lever le verrou (la ligne d'audit est CONSERVÉE)
UPDATE "ReinitialisationSysteme" SET verrou = 'LEVE-' || id WHERE verrou = 'REINITIALISATION';
-- 3) Contrôler : plus aucune ligne avec verrou = 'REINITIALISATION'
SELECT id, verrou FROM "ReinitialisationSysteme";
```
**Ne jamais** `DELETE` la ligne : l'audit des purges est permanent et le compte qui a purgé doit rester non supprimable. Après la purge suivante, un nouveau verrou est posé.
(Le Pointage a sa propre purge, `/admin/reinitialisation-pointage`, distincte : voir `DEPLOIEMENT.md`, § 8.)

---

## Annexe A — Table par table : purgée / conservée

Source unique : `backend/src/reinitialisationClassification.ts`. Un test unitaire lit `schema.prisma` et **échoue si une table n'est pas classée** (ou si une entité d'historique écrite par le code ne l'est pas) :
aucune table de données métier ne peut être oubliée quand un lot en ajoute une.

| Table | Sort | Détail |
|---|---|---|
| `Absence` | **purgée** | absences détectées |
| `BudgetDepassement` | **purgée** | confirmations de dépassement de budget (liées à des demandes de test) |
| `CorrectionPointage` | **purgée** | corrections |
| `Demande` | **purgée** | demandes (avec chronomètres, motifs d'échange, circuit) |
| `DepenseLigne` | **purgée** | dépenses détaillées |
| `EncAudit` | **purgée** | audit du module — supprimable seulement avant la mise en service d'Encaissements |
| `EncContrat` | **purgée** | contrats importés pour test — seulement avant la mise en service d'Encaissements |
| `EncContratMot` | **purgée** | index de recherche des contrats (supprimé avec eux) |
| `EncEncaissement` | **purgée** | encaissements de test — seulement avant la mise en service d'Encaissements |
| `EncImport` | **purgée** | imports de test — seulement avant la mise en service d'Encaissements |
| `EncPieceJointe` | **purgée** | fichiers déposés (imports de test) — seulement avant la mise en service d'Encaissements |
| `EncSequence` | **purgée** | compteurs PAI : remis à zéro (recréés à la demande) — seulement avant la mise en service d'Encaissements |
| `EncSignalement` | **purgée** | signalements d'import de test — seulement avant la mise en service d'Encaissements |
| `ExecutionTache` | **purgée** | historique d'exécution du planificateur (hors empreinte : réécrit en continu) |
| `Feedback` | **purgée** | avis FeedbackApp |
| `JournalBanque` | **purgée** | traçabilité des mouvements banque |
| `JournalCaisse` | **purgée** | grand livre de caisse — SEULE exception à « jamais modifié » : la remise à zéro des données de test vide aussi le solde d'ouverture, à ressaisir ensuite |
| `JournalTechnique` | **purgée** | incidents techniques (hors empreinte : réécrit en continu) |
| `JustificationPointage` | **purgée** | justifications |
| `LigneDemande` | **purgée** | articles |
| `PieceJointe` | **purgée** | pièces jointes (fichiers de uploads/ supprimés après le commit) |
| `PlageAbsenceAutorisee` | **purgée** | absences déclarées (congés, permissions) |
| `Pointage` | **purgée** | pointages |
| `Reglement` | **purgée** | règlements |
| `ReglementCategorieAllocation` | **purgée** | allocations budgétaires des règlements |
| `RemboursementRetour` | **purgée** | remboursements de retour |
| `RetourCaisse` | **purgée** | retours de caisse |
| `RetourExceptionnel` | **purgée** | retours exceptionnels post-clôture |
| `RetourExterne` | **purgée** | retours externes (rattachés ou non) |
| `SignalementRetour` | **purgée** | signalements d'erreur sur un retour |
| `ActionSignee` | partielle | supprimées : actions signées sans ligne d'historique conservée ; conservées : celles dont une ligne d'historique conservée dépend (budgets), pour que l'historique ne passe pas en « Signature non rattachée » |
| `HistoriqueEntry` | partielle | supprimées : entités Demande, LigneDemande, JournalCaisse, RetourExterne, Pointage, PointageQR, PointageGeo, JustificationPointage ; conservées : audit Admin/Auth/User/Service/Role/Module/Categorie/Objet/PermissionDelegation, budgets (BudgetParametrage, ParametreTresorerie), signatures enrôlées, verrous |
| `Notification` | partielle | supprimées : catégories TRESORERIE, RH, POINTAGE ; conservées : ADMIN, SYSTEME |
| `BudgetParametrage` | conservée | budgets validés ou en attente du DG, seuils, historique de validation |
| `Categorie` | conservée | catalogue des catégories |
| `EncBeneficiaireHonoraires` | conservée | bénéficiaire des honoraires daté |
| `EncBranche` | conservée | branches |
| `EncMiseEnService` | conservée | verrou de mise en service du module : s'il existe, TOUT le module est conservé (triggers d'immuabilité) |
| `EncParametre` | conservée | paramètres du module |
| `EncPartenaire` | conservée | partenaires et parts d'accessoires (configuration ; ceux créés par un import de test sont à contrôler à la main) |
| `EncTauxControle` | conservée | taux de contrôle |
| `FcmToken` | conservée | jetons push des appareils |
| `JourFerie` | conservée | jours fériés |
| `MarqueurUnique` | conservée | repères uniques (signatures.mise_en_service, pointage.cloture_initiale…) |
| `Module` | conservée | modules activés |
| `Objet` | conservée | catalogue des objets |
| `ParametrageHoraire` | conservée | horaires et GPS |
| `ParametreTresorerie` | conservée | paramètres (date « catégorisation obligatoire ») |
| `Permission` | conservée | catalogue des permissions |
| `PermissionDelegation` | conservée | délégations (lignes de configuration d'accès, révocations comprises) |
| `PointageMiseEnService` | conservée | verrou de mise en service du Pointage |
| `ReinitialisationPointage` | conservée | audit des purges du Pointage seul |
| `ReinitialisationSysteme` | conservée | verrou et audit de la réinitialisation globale |
| `Role` | conservée | rôles et leurs champs (estAdmin, peutEtreBeneficiaireDelegation, peutRecevoirFeedback) |
| `RolePermission` | conservée | permissions de chaque rôle |
| `Service` | conservée | services et leurs responsables |
| `SignatureUtilisateur` | conservée | signatures enrôlées dans le profil, toutes versions |
| `User` | conservée | comptes (les comptes de test se désactivent à la main après la purge) |

**Entités d'historique supprimées** (`HistoriqueEntry.entity`) : `Demande`, `LigneDemande`, `JournalCaisse`, `RetourExterne`, `Pointage`, `PointageQR`, `PointageGeo`, `JustificationPointage`.
**Conservées** : `User`, `Service`, `Auth`, `Objet`, `Categorie`, `Role`, `RolePermission`, `PermissionDelegation`, `Module`, `ReinitialisationSysteme`, `ReinitialisationPointage`, `PointageMiseEnService`,
`BudgetParametrage`, `ParametreTresorerie`, `SignatureUtilisateur`. **Notifications** : `TRESORERIE`, `RH`, `POINTAGE` supprimées ; `ADMIN`, `SYSTEME` conservées.

## Annexe B — Outils et tests

| Fichier | Rôle |
|---|---|
| `backend/prisma/reinitialiser-production.ts` | purge en ligne de commande (simulation par défaut, sauvegarde vérifiée, phrase, verrou) |
| `backend/prisma/verifier-mise-en-production.ts` | contrôle avant mise en service (lecture seule, `SET TRANSACTION READ ONLY`) |
| `backend/prisma/rattrapage-production.ts` | rattrapage chaîné (simulation par défaut, phrase `RATTRAPER`) |
| `backend/src/rattrapageEtapes.ts` | logique partagée des 4 scripts de reprise et du script chaîné |
| `e2e/lot-n.mjs` | test d'intégration de la purge sur base jetable (table par table, verrou, parcours neuf, levée du verrou, purge par l'écran) |
| `e2e/lot-o.mjs` | test d'intégration du rattrapage sur données « anciennes » (simulation, application, idempotence, cas ambigus) |
| `e2e/perf-navigation.mjs` | temps de navigation en production sur une base remplie |

Les tests e2e s'exécutent **uniquement** sur une base jetable (voir `e2e/README.md`) ; ils créent et suppriment leur propre base.
