# Pointage V2 — plan d'exécution (passage de relais Thierry → Aristide)

> Destinataire : Claude Code d'Aristide. Rédigé le 2026-10-08 à partir de l'analyse de la branche
> `thierry-kouame` et de la branche `aristide` (responsables de service, circuit de validation).
> Les lots 1 et 2 sont **déjà codés et commités** sur la branche `pointage-v2` (voir §1). Il reste les lots 3 à 7.
> Les règles métier du §2 ont été arrêtées par Thierry à partir des retours du DG et de la RH : ne pas les
> rediscuter, poser la question à Thierry si un cas n'est pas couvert.

## 0. Le besoin en bref

La RH et le DG ont revu la logique du pointage. On passe de « motif obligatoire au moment du pointage » à :

1. **Le scan pointe tout de suite**, même en retard, sans formulaire.
2. **15 minutes après**, le collaborateur reçoit un lien pour justifier son retard (email + push + notification
   interne), puis des relances.
3. **Son responsable de service** (modèle d'Aristide, `Service.responsableId`) est prévenu, et c'est lui qui
   **accepte ou refuse** le motif. Les alertes de retard ne vont plus à la RH.
4. Une **tolérance** paramétrable par la RH (15 min par défaut) avant d'être en retard.
5. Le **départ anticipé** se confirme explicitement, puis suit le même circuit de justification.
6. Un collaborateur **en congé** n'est plus marqué absent (faille signalée par la RH).
7. « Se souvenir de moi » : l'utilisateur ne doit plus ressaisir ses accès à chaque scan.

## 1. Récupérer le travail déjà fait

Thierry transmet le fichier `pointage-v2.bundle` (paquet git). Il contient la branche `pointage-v2` :

- `4b90cc5` merge de `origin/aristide` dans `origin/thierry-kouame` (aucun conflit) ;
- `f07893c` lot 1 ;
- `da1d53c` lot 2 ;
- le commit qui ajoute ce plan.

Prérequis du paquet : les commits `21d6a7f` (`origin/thierry-kouame`) et `b587469` (`origin/aristide`), tous deux
déjà sur GitHub.

```
git fetch origin
git fetch /chemin/vers/pointage-v2.bundle pointage-v2:pointage-v2
git checkout pointage-v2
cd backend && npx prisma migrate deploy && npx prisma generate
```

Puis, en local seulement, `npx prisma migrate dev` doit répondre que le schéma est **déjà synchronisé** : la
migration du lot 2 a été écrite à la main (le moteur de schéma Prisma n'était pas téléchargeable dans la session de
Thierry). Si Prisma propose une nouvelle migration, c'est une dérive à corriger dans
`20261010090000_pointage_justification`, pas une migration de plus.

Pour réintégrer dans `aristide` ensuite : `git checkout aristide && git merge pointage-v2` (apporte aussi les
13 commits de `thierry-kouame` absents de `aristide`, sans conflit au 2026-10-08).

## 2. Règles métier arrêtées (2026-10-08)

| Sujet | Règle |
|---|---|
| Tolérance | Arrivée jusqu'à `heureDebutMatin` + `toleranceRetardMinutes` **incluse** = à l'heure. Au-delà, retard compté **depuis `heureDebutMatin`** (07:45 + 15 : arrivée 07:58 à l'heure, 08:10 = 25 min de retard). La tolérance est réglée par la RH. |
| Pointage | Le scan enregistre l'arrivée immédiatement, sans motif, même en retard. |
| Départ anticipé | Jamais automatique : bouton puis **confirmation explicite** (sinon un collaborateur qui ouvre juste l'écran serait dépointé). Refusé moins de 30 min après l'arrivée. Ensuite, même circuit de justification que le retard. Pas de motif au moment du départ. |
| Qui décide | Le **responsable du service** du collaborateur accepte ou refuse le motif (refus avec motif obligatoire). |
| Pas de responsable | Collaborateur lui-même responsable de son service, DG, service sans responsable, responsable inactif → la **RH** (détenteurs de `pointage.corriger_pointage`) reçoit l'alerte et décide. Le message le dit explicitement (ex. « X, responsable du service Commercial, est arrivé en retard de 25 min »). |
| Envois au collaborateur | 1er envoi à `pointage + délai` (15 min) : **email + push + interne** (`priority: "CRITIQUE"`). Envois suivants toutes les 30 min : **push + interne** (`"IMPORTANT"`). 3 envois au total, premier compris. Les trois valeurs sont paramétrables par la RH. |
| Envois au responsable | **Push + interne** (`"IMPORTANT"`) : au 1er envoi (« X est en retard, il doit justifier ») et à la clôture (« X n'a pas justifié »). Pas à chaque relance. |
| Clôture | À la fin de journée (`heureFinApresMidi` du jour du pointage), au moins un intervalle après le dernier envoi : statut `NON_JUSTIFIEE` + alerte au décideur. Le collaborateur **peut encore justifier** après la clôture. |
| Congés | Un jour entièrement couvert par une `PlageAbsenceAutorisee` n'est jamais une absence (fait, lot 1). |
| Session | « Se souvenir de moi » = 30 jours **glissants** depuis la dernière visite, déjà en place (`frontend/src/lib/auth.config.ts`). Ne pas changer la durée. |

Correspondance des canaux avec le service existant (`frontend/src/lib/notifications/notificationService.ts`) :
`CRITIQUE` = interne + push + email, `IMPORTANT` = interne + push, `INFO` = interne. Aucun nouveau canal n'est
nécessaire.

## 3. Ce qui est fait (lots 1 et 2)

**Lot 1 — failles existantes** (`f07893c`)
- `backend/src/pointage-utils.ts` :
  - `PERMISSION_RH_POINTAGE = "pointage.corriger_pointage"` (détenue par le seul rôle RH) ;
  - `journeeCouverteParAbsence(plages, horaires)` ;
  - `heureReferenceArriveeMinutes(horaires, plages)` : l'heure de début repoussée à la fin d'une permission du matin ;
  - tests dans `pointage-utils.test.ts`.
- Le cron `/api/cron/absences`, `enregistrerAbsenceAutomatiqueAction` et `pointage/pointer/page.tsx` ignorent un
  jour couvert par un congé ou une permission. Côté écran, c'est le mode `NON_OUVRABLE` avec un message dédié.
- Toutes les alertes RH du pointage passent par `notifyByPermission(PERMISSION_RH_POINTAGE, …)` au lieu des noms de
  rôle en dur. L'ancien ciblage `["ADMIN", "RH"]` du cron ne trouvait jamais le rôle « Admin » (casse), qui n'a de
  toute façon aucune permission `pointage.*`.
- **Dépendance non couverte** : aucune interface ne crée encore de `PlageAbsenceAutorisee`. Le module congés et
  permissions de Thierry (local, non poussé) devra en créer une à la validation finale d'un congé.

**Lot 2 — données** (`da1d53c`)
- `ParametrageHoraire` reçoit quatre champs, modifiables sur `/pointage/rh/horaires` (formulaire et action à jour) :
  - `toleranceRetardMinutes` (15) ;
  - `delaiDemandeJustificationMinutes` (15) ;
  - `intervalleRelanceJustificationMinutes` (30) ;
  - `nombreMaxRelancesJustification` (3, premier envoi compris).
- Nouveau modèle `JustificationPointage`, une par pointage :
  - relation `Pointage.justification`, en `CASCADE` depuis `Pointage` ;
  - décideur `decideurId` en `RESTRICT`, relation `User.justificationsDecidees` ;
  - champs `statut`, `motif`, `soumiseAt`, `nombreEnvois`, `dernierEnvoiAt`, `clotureeAt`, `decisionAt`, `motifRefus`.
- Enum `StatutJustificationPointage` : `EN_ATTENTE`, `SOUMISE`, `ACCEPTEE`, `REFUSEE`, `NON_JUSTIFIEE`.
- Migration `20261010090000_pointage_justification` : additive et rejouable. Les pointages existants ne reçoivent
  pas de justification, donc aucune relance ne partira sur l'historique.
- La table est aussi couverte par :
  - la suppression d'un compte (`admin/users/actions.ts`, nouveau motif de blocage) ;
  - le seed (`deleteMany`) ;
  - `backend/src/reinitialisation.ts`.

**Lot 3 — une seule règle de retard, pointage automatique, départ confirmé** (non commité, 2026-10-08)
- `pointage-utils.ts` : `checkLateStatus(now, horaires, plages)` avec tolérance et permission du matin,
  `heureReferenceDepartMinutes`, `estDepartAnticipe`, `departTropTot`, `DELAI_MINIMUM_DEPART_MINUTES`,
  `horairesPointage` / `HORAIRES_PAR_DEFAUT` ; tests dans `pointage-utils.test.ts`.
- Règle utilisée par `pointer/page.tsx`, `enregistrerPointageAction`, `rh/corrections/actions.ts`,
  `rh/pointages/nouveau/actions.ts` (ces deux dernières chargent les permissions du jour du collaborateur).
- `enregistrerPointageAction` : sans motif, départ refusé à moins de 30 min de l'arrivée, `JustificationPointage`
  EN_ATTENTE créée dans la transaction, alerte « Anomalie » retirée.
- `SmartPointage.tsx` : RETARD_ARRIVEE automatique, départ anticipé confirmé, `PointageForm.tsx` supprimé.

**Lot 4 — justification et décision** (non commité, 2026-10-08)
- `backend/src/justificationPointage.ts` (décideur, droit de décider, transitions, messages) et ses tests ;
  `backend/src/cheminRetour.ts` (retour après connexion sur un lien profond).
- Actions : `pointage/justifier/[pointageId]/actions.ts`, `pointage/justifications/actions.ts` ; lecture :
  `frontend/src/lib/justificationsPointage.ts` ; écrans `/pointage/justifier/[pointageId]`, `/pointage/justifications`,
  colonne « Justification » de l'historique, menu « Justifications ». Détail et limites : `CLAUDE.md`, section 8.

**Lot 5 — envois, relances et clôture** (non commité, 2026-10-09)
- `prochaineActionJustification` et les messages des envois dans `justificationPointage.ts` (tests :
  `relancesJustification.test.ts`) ; contrôle du secret extrait dans `backend/src/cronAuth.ts` et
  `frontend/src/lib/cronAuth.ts`, utilisé par les deux routes ; route `api/cron/relances-justification`. Exploitation :
  `DEPLOIEMENT.md` §7 (cron-job.org toutes les 5 minutes, `CRON_SECRET`, `AUTH_URL`). Détail : `CLAUDE.md`, section 9.

**Lot 6 — « Se souvenir de moi »** (non commité, 2026-10-09)
- Case cochée par défaut sur la connexion quand le chemin de retour validé commence par `/pointage/`
  (`seSouvenirDeMoiParDefaut`, `cheminRetour.ts`) ; durées inchangées ; « Session mémorisée jusqu'au … » non affiché
  (pas simple sans exposer `rememberMe`). Test sur téléphone à faire par Thierry ou Aristide. Détail : `CLAUDE.md`,
  section 10.

## 4. Lots restants

Chaque lot fait l'objet d'un commit séparé, testé, avec un message au format des commits existants. La logique
métier pure va dans `backend/src` avec ses tests vitest, sur le modèle de `circuitDemande.ts` et
`circuitNotifications.ts`. L'accès base et les envois restent dans `frontend`.

### Lot 3 — une seule règle de retard, pointage automatique, départ confirmé

**Backend (`pointage-utils.ts`)**
1. Faire évoluer `checkLateStatus(now, config, plages = [])` :
   - `reference = heureReferenceArriveeMinutes(config, plages)` ;
   - retard si `minutes > reference + config.toleranceRetardMinutes` ;
   - `minutesRetard = minutes - reference`.
2. Ajouter `heureReferenceDepartMinutes(horaires, plages)`, symétrique : `heureFinApresMidi` ramenée au début d'une
   permission qui couvre la fin de journée. Ajouter aussi `estDepartAnticipe(now, config, plages)`.
3. Ajouter la constante `DELAI_MINIMUM_DEPART_MINUTES = 30`.
4. Tests :
   - 07:45 et 08:00 à l'heure, 08:01 = 16 min de retard, 08:10 = 25 min ;
   - tolérance 0 ;
   - permission 07:45-10:00 : arrivée 10:10 à l'heure, 10:20 = 20 min de retard ;
   - départ 16:00 anticipé, sauf si une permission couvre 16:00-16:45.

**Utiliser cette règle partout** (aujourd'hui chaque fichier recalcule à sa façon) :
- `frontend/src/app/(dashboard)/pointage/pointer/page.tsx` : le choix `AUTO_ARRIVEE` / `RETARD_ARRIVEE` passe par
  `checkLateStatus`, plus par `currentMinutes <= limiteArriveeMinutes`. Charger les plages du jour, déjà lues pour
  le lot 1.
- `frontend/src/app/(dashboard)/pointage/rh/corrections/actions.ts` et `.../rh/pointages/nouveau/actions.ts` :
  même calcul de retard et de départ anticipé.

**`frontend/src/app/(dashboard)/pointage/actions.ts` — `enregistrerPointageAction`**
1. Supprimer le motif obligatoire, pour le retard comme pour le départ anticipé, et le champ `motif` du schéma zod.
2. Refuser un `DEPART` moins de `DELAI_MINIMUM_DEPART_MINUTES` après l'`ARRIVEE`, avec un message clair.
3. Si `estRetard || estDepartAnticipe`, créer `justification: { create: {} }` (statut `EN_ATTENTE`) **dans la même
   transaction** que le pointage.
4. Supprimer l'alerte RH « Anomalie de pointage signalée » : le responsable prend le relais au lot 5. Garder les
   alertes de sécurité (hors réseau, hors périmètre) et l'information « pointage par géolocalisation ».

**Client (`SmartPointage.tsx`)**
- Ajouter `RETARD_ARRIVEE` à la liste des modes envoyés automatiquement (`useEffect`) et à l'écran « Analyse en
  cours ».
- Message de succès : « Arrivée enregistrée à HH:MM, N min de retard. Un lien pour justifier vous sera envoyé. »
  L'action renvoie les minutes dans son `message`, ou dans un champ dédié.
- Mode `EN_POSTE` : le bouton « Pointer mon départ anticipé » ouvre une **confirmation** (« Confirmer mon départ
  maintenant ? » / Annuler), puis appelle `submitPointage()`, sans motif. Message : « Départ enregistré. Un lien pour
  justifier votre départ anticipé vous sera envoyé. »
- Supprimer `PointageForm.tsx`, qui devient inutile, et le bloc « formulaire motif » en fin de composant.

**Critères**
- Scan à 07:55 : à l'heure, aucune justification.
- Scan à 08:10 : enregistré sans formulaire, `minutesRetard = 25`, une `JustificationPointage` `EN_ATTENTE`.
- Ouvrir l'écran de pointage à 10:00 après l'arrivée ne crée rien.
- Un départ à 15:00 n'est créé qu'après confirmation.

### Lot 4 — justification et décision

**Backend pur, nouveau fichier `backend/src/justificationPointage.ts` (exporté par `index.ts`)**
- `resoudreDecideurJustification({ collaborateurId, service })`, où
  `service = { name, responsableId, responsableActif } | null`. Elle renvoie :
  - `{ type: "RESPONSABLE", responsableId }` ;
  - ou `{ type: "RH", raison: "SANS_SERVICE" | "SANS_RESPONSABLE" | "RESPONSABLE_INACTIF" | "EST_RESPONSABLE" }`.
  - Le DG tombe dans `EST_RESPONSABLE` (responsable de « Direction DG ») ou `SANS_SERVICE`.
  - S'appuyer sur `chargerServiceDuDemandeur` (`backend/src/services.ts`) côté base.
- Transitions, sur le principe du moteur pur d'Aristide :
  - **soumission** par le collaborateur : depuis `EN_ATTENTE` ou `NON_JUSTIFIEE` vers `SOUMISE`, motif nettoyé de
    3 à 500 caractères ;
  - **décision** : depuis `SOUMISE` vers `ACCEPTEE` ou `REFUSEE`, motif de refus d'au moins 3 caractères ;
  - le décideur n'est jamais le collaborateur ;
  - `REFUSEE` et `ACCEPTEE` sont définitifs.
- Messages des notifications, construits ici (purs, testables), avec la variante RH « X, responsable du service Y… ».
- Tests vitest pour chaque cas.

**Application en base**
- Écritures **conditionnelles** : `updateMany({ where: { id, statut: <statut attendu> }, … })`. Un `count === 0`
  veut dire « déjà traitée par quelqu'un d'autre ».
- Chaque transition écrit une `HistoriqueEntry` (`entity: "JustificationPointage"`). Ajouter cette entité à
  `ENTITES_HISTORIQUE_POINTAGE` dans `reinitialisation.ts`.
- **Autorisation recalculée à chaque action** à partir du responsable **actuel** (même principe que le circuit) :
  - cas `RESPONSABLE` : `session.user.id === responsableId` ;
  - cas `RH` : `hasPermission(session, PERMISSION_RH_POINTAGE)`.
  - Pas de suppléant : si un responsable est absent, l'Admin change le responsable du service.

**Écrans**
- `/pointage/justifier/[pointageId]` : page serveur, formulaire client et Server Action.
  - Réservé au propriétaire du pointage, avec la permission `pointage.pointer`.
  - Affiche la date, l'heure, les minutes de retard (ou l'heure de départ), le statut et le motif de refus éventuel.
  - Formulaire actif en `EN_ATTENTE` ou `NON_JUSTIFIEE`.
  - Vérifier qu'un visiteur non connecté est renvoyé vers `/login` puis ramené sur la page : c'est le lien de
    l'email.
- `/pointage/justifications` : file du décideur. Elle liste les `SOUMISE` dont il est le décideur selon
  `resoudreDecideurJustification` ; les volumes sont faibles, on peut filtrer en code.
  - Boutons Accepter / Refuser, ce dernier avec un motif.
  - Onglet « Traitées » en lecture.
  - Entrée de navigation visible si l'utilisateur est responsable d'au moins un service (`getServicesDontResponsable`)
    ou détient `PERMISSION_RH_POINTAGE`. Utiliser `frontend/src/components/layout/nav.ts`.
- Historique collaborateur (`pointage/historique`) : un badge de statut par pointage concerné, et un bouton
  « Justifier » tant que le statut le permet.

**Notifications**
- À la soumission : le décideur reçoit `IMPORTANT`, avec un lien vers `/pointage/justifications`.
- À la décision : le collaborateur reçoit `IMPORTANT`, avec le motif du refus le cas échéant.

### Lot 5 — envois, relances et clôture (tâche planifiée)

**Moteur pur, dans `justificationPointage.ts`**

`prochaineActionJustification(etat, params, now)` renvoie `ENVOI(n)`, `CLOTURE` ou `AUCUNE` :

1. Si le statut n'est pas `EN_ATTENTE` : `AUCUNE`.
2. Si `nombreEnvois === 0` et `now ≥ heurePointage + delaiDemandeJustificationMinutes` : `ENVOI(1)`.
3. Si `0 < nombreEnvois < nombreMaxRelancesJustification`, `now < finJournee` et
   `now ≥ dernierEnvoiAt + intervalleRelanceJustificationMinutes` : `ENVOI(nombreEnvois + 1)`.
4. Si `nombreEnvois ≥ 1`, `now ≥ finJournee` et `now ≥ dernierEnvoiAt + intervalle` : `CLOTURE`.
5. Sinon : `AUCUNE`.

`finJournee` = jour du pointage à `heureFinApresMidi`, en heure locale du serveur. Rester cohérent avec le reste du
module, qui calcule en heure locale (`getHours`). Le conteneur est en UTC, ce qui correspond à Abidjan.

Tests :
- retard 08:10 : envois à 08:25, 08:55 et 09:25, clôture à 16:45 ;
- départ 16:40 : envoi à 16:55, clôture à 17:25 ;
- statut déjà `SOUMISE` ;
- maximum d'envois atteint ;
- tâche planifiée en panne la veille (rattrapage le lendemain).

**Route `frontend/src/app/api/cron/relances-justification/route.ts`**
- `GET` protégé par `Authorization: Bearer ${CRON_SECRET}`. Extraire d'abord le contrôle à temps constant de
  `/api/cron/absences` dans `frontend/src/lib/cronAuth.ts`, et l'utiliser dans les deux routes.
- Charger les `JustificationPointage` `EN_ATTENTE` avec le pointage, le collaborateur, son service et le responsable.
  Calculer l'action de chacune.
- **Idempotence** : réserver chaque envoi par
  `updateMany({ where: { id, statut: "EN_ATTENTE", nombreEnvois: n }, data: { nombreEnvois: n + 1, dernierEnvoiAt: now } })`.
  N'envoyer que si `count === 1`. Même principe pour la clôture (`EN_ATTENTE` vers `NON_JUSTIFIEE`, `clotureeAt`).
  Deux exécutions simultanées n'envoient ainsi jamais deux fois.
- Les envois suivent le §2. Le lien de l'email est relatif (`/pointage/justifier/{pointageId}`) : le gabarit le
  préfixe par `NEXTAUTH_URL` / `AUTH_URL`, à vérifier en production.
- Renvoyer un JSON récapitulatif (envois, clôtures), comme la route des absences.

**Exploitation** (à faire par le superviseur, Thierry et Aristide n'ont pas accès au serveur)
- Créer sur cron-job.org une tâche **toutes les 5 minutes** vers `/api/cron/relances-justification`, avec l'en-tête
  `Authorization`. Sans elle, aucune demande de justification ne part.
- Le documenter dans `DEPLOIEMENT.md`.
- Vérifier sur `/admin/notifications` que les responsables ont activé le push.

### Lot 6 — « Se souvenir de moi »

- `frontend/src/app/(auth)/login/page.tsx` : cocher la case par défaut quand `callbackUrl` commence par
  `/pointage/`, ce qui est le cas de l'arrivée depuis le QR (`frontend/src/app/pointage/qr/page.tsx`).
- Ne pas toucher aux durées de `auth.config.ts`.
- Afficher « Session mémorisée jusqu'au … » sur la page de pointage seulement si c'est simple. `rememberMe`
  n'est volontairement pas exposé sur `session.user`, ne pas l'y ajouter juste pour ça.
- Test manuel sur téléphone, à faire par Thierry ou Aristide : scanner, se connecter case cochée, fermer le
  navigateur, rescanner le lendemain.
- Causes à vérifier si la session saute quand même :
  - lecteur QR qui ouvre un autre navigateur ;
  - `tokenVersion` incrémenté (changement de rôle, désactivation) ;
  - `AUTH_SECRET` changé au redéploiement.

### Lot 7 — écrans RH, reporting, documentation

- **Présence du jour** (`pointage/rh/presence/page.tsx`, `PresenceTabs.tsx`) :
  - statut de justification et motif lu dans `JustificationPointage`, avec repli sur `Pointage.motif` pour
    l'historique ;
  - un collaborateur couvert par une absence autorisée apparaît comme tel, pas comme absent.
- **Reporting et export Excel** (`backend/src/pointageReporting.ts`, `api/pointage/rh/reporting/export/route.ts`) :
  colonnes « Justification » (statut), « Motif » (justification, sinon ancien motif) et « Décidée par ».
- **Documentation** :
  - `docs/GUIDE_FONCTIONNEL_POINTAGE.md` et `docs/POINTAGE_ARCHITECTURE.md` : retirer « motif obligatoire » ;
    décrire le circuit, les paramètres et la tâche planifiée ;
  - `CLAUDE.md`, section « Module Pointage RH » et aide-mémoire : nouveau modèle, nouvelle route, permission de repli
    RH.

## 5. Vérifications avant de pousser

- `cd backend && npm test`. Un test est **déjà en échec avant ces travaux** :
  `feedback.test.ts > modererFeedback > rejette si le motif fait moins de 3 caractères`. Il interroge une vraie base.
  Il n'est pas lié au pointage ; ne pas le masquer.
- `cd frontend && npx next typegen && npx tsc --noEmit`, puis `npm run build` à la racine.
- Scénarios en local, avec les comptes du seed (mot de passe `password123`) :
  - **arrivée en retard** de `collaborateur@simassurances.test`, service Commercial : relances, puis justification,
    puis acceptation par `responsable-commercial@` ;
  - **retard d'un responsable** (`responsable-commercial@`) : alerte et décision par `rh@` ;
  - **refus avec motif** ;
  - **clôture en fin de journée**, puis justification tardive ;
  - **départ anticipé** : confirmation, puis justification ;
  - **jour de congé** : aucune absence.
- Pour tester les relances sans attendre : appeler la route avec `curl -H "Authorization: Bearer $CRON_SECRET"` après
  avoir réduit les délais sur `/pointage/rh/horaires`.

## 6. Conventions du dépôt à respecter

- Dépendances toujours `frontend → backend`, jamais l'inverse. Un Client Component importe ses valeurs depuis
  `backend/client`, jamais `backend`.
- Jamais de nom de rôle en dur : permissions (`PERMISSION_RH_POINTAGE`) ou relation (responsable du service).
- Ne jamais relancer le seed en production (voir `CLAUDE.md`, « Déploiement »).
- Commentaires et messages en français, décisions datées dans `CLAUDE.md`.
