# Plan d'implémentation — fiabilisation du pointage (session, planificateur, journal technique, relances, tableau de bord responsable)

> Destinataire : session Claude Code. Rédigé le 2026-10-14 par Thierry Kouamé.
> Base : `origin/main` au commit `31c0326` (image `v12`). Pointage V2 y est entièrement inclus.
> **Avant tout code**, lire `CLAUDE.md` (sections « Module Pointage RH », « Socle Portail — Authentification »,
> « Monorepo backend/frontend », « Déploiement ») et `docs/PLAN_POINTAGE_V2.md`.
> Next.js 16 diffère de ce que tu connais : lis `node_modules/next/dist/docs/` avant d'écrire du code (en particulier
> `instrumentation`).

## 0. Règles de travail

- **Branche** : `fiabilisation-pointage`, créée depuis `origin/main`. **Un commit par phase**, au format des commits
  existants. Ne pousse rien vers `main` ni `aristide`. À la fin, livre la série par `git format-patch` (ou pousse la
  branche si Thierry le demande).
- **Logique pure** dans `backend/src` avec ses tests vitest. **Accès base et envois** dans `frontend`. Le sens de
  dépendance est toujours `frontend → backend`, jamais l'inverse.
- **Jamais de nom de rôle en dur** : passer par une permission ou par la relation responsable (`Service.responsableId`).
- **Toute migration est additive et rejouable.** Toute nouvelle permission a sa migration.
- **Vérifier sur une PostgreSQL 16 jetable**, jamais sur une base partagée : `vitest`, `tsc`, `next build`, Playwright
  (scripts dans `e2e/`, Playwright installé sans l'enregistrer dans `package.json`).
- Mettre à jour `CLAUDE.md` et `DEPLOIEMENT.md` dans le même commit que le code concerné.
- Un cas non couvert par ce plan → **demander à Thierry**, ne pas trancher seul.

## Invariant à préserver dans toutes les phases : le retard va au supérieur, pas à la RH

Vérifié sur `main` le 14/10 :
- `enregistrerPointageAction` n'envoie plus aucune alerte RH pour un retard ou un départ anticipé.
- Les seules alertes RH restantes sont la sécurité (hors réseau, hors périmètre), l'information géolocalisation et
  l'absence automatique.
- La tâche des relances notifie le **décideur** (`decideurDuCollaborateur` puis `destinatairesDecideur`) :
  1. le responsable actuel du service ;
  2. sinon un autre compte RH (rôle portant `pointage.corriger_pointage`), seulement si le collaborateur n'a pas de
     service, si son service n'a pas de responsable, si ce responsable est inactif, ou si le collaborateur est
     lui-même responsable ;
  3. sinon le DG (`treso.decider_dg`).
- Personne ne décide sa propre justification.

**Aucune phase ne doit réintroduire une notification de retard vers la RH quand un responsable existe.**
Ajouter en phase 3 un test d'intégration qui le prouve : un collaborateur de Commercial en retard ne produit **aucune**
notification pour `rh@`.

---

## Phase 1 — Session : retirer la déconnexion après 1 h d'inactivité

**Décision (Thierry, 14/10)** : on supprime complètement la déconnexion pour inactivité. Seules restent les durées de
session :
- case « Se souvenir de moi » **décochée** : 1 jour **glissant** ;
- case **cochée** : 30 jours **glissants**.

La case reste cochée par défaut quand on arrive par un lien `/pointage/...` (QR).

À faire :
1. Supprimer `frontend/src/components/layout/InactivityLogout.tsx`, son montage dans `AppShell.tsx` et
   `logoutForInactivityAction` dans `components/layout/actions.ts`.
2. Page de connexion : retirer le message propre à `?error=inactivite`. Un ancien lien qui le porte doit afficher la
   page normalement, sans erreur.
3. **Vérifier le glissement réel des deux durées.** `CLAUDE.md` affirme que le middleware réécrit le cookie à chaque
   page visitée. Le prouver par un test Playwright qui lit l'expiration du jeton chiffré, pas seulement le `Max-Age`
   du cookie :
   - connexion sans la case, nouvelle visite deux heures plus tard (horloge simulée) : l'expiration a avancé ;
   - même chose avec la case : 30 jours comptés depuis la dernière visite.
   - **Si le glissement ne fonctionne pas, s'arrêter et le signaler.**
4. Ne pas modifier `auth.config.ts` : les durées y sont déjà correctes.
5. `CLAUDE.md` : la section « Déconnexion automatique après inactivité » devient « retirée le 2026-10-14 », avec la
   raison (demande du DG, fluidité du pointage). Ajouter une limite connue : sur un poste partagé, l'utilisateur doit
   décocher la case et se déconnecter lui-même.

**Fini quand** : plus aucune référence à `InactivityLogout` ; Playwright prouve que l'expiration avance pour les deux
cas ; `tsc` et `next build` passent.

---

## Phase 2 — Planificateur intégré à l'application

**Décision (Thierry, 14/10)** : le planificateur vit **dans l'application**. On ne passe ni par cron-job.org, ni par un
conteneur `cron` dans le compose.

### Deux façons de cadencer, à arbitrer

| | Option A : minuterie de 60 s + fonction pure qui dit quelles tâches sont dues | Option B : bibliothèque cron (`croner`) |
|---|---|---|
| Dépendance | aucune | une de plus |
| Tests | fonction pure, testable avec une horloge simulée | plus délicats |
| Lisibilité | deux horaires seulement, donc simple | syntaxe cron standard |

**Option A retenue.**

### À faire

1. **Extraire la logique des deux routes** (`api/cron/relances-justification`, `api/cron/absences`) dans
   `frontend/src/lib/taches/relancesJustification.ts` et `absences.ts`.
   - Chaque fonction s'appelle `executer…()` et renvoie un bilan.
   - Les routes appellent ces fonctions (déclenchement manuel et secours, toujours protégés par `CRON_SECRET`).
   - **Aucune logique dupliquée** entre la route et la fonction.
2. **Fonction pure** `tachesDues(now, dernieresExecutions)` dans `backend/src/planificateur.ts`, avec ses tests.
   - Relances : toutes les 5 minutes.
   - Absences : lundi au vendredi, à 17:30 et 20:00, heure du serveur (UTC, qui est l'heure d'Abidjan).
   - Rattrapage : une exécution d'absences manquée parce que le serveur était arrêté est relancée au redémarrage
     (la route rattrape déjà les 2 derniers jours).
3. **Démarrage** dans `frontend/src/instrumentation.ts`, fonction `register()`. Conditions :
   - seulement si `process.env.NEXT_RUNTIME === "nodejs"` ;
   - désactivable par `PLANIFICATEUR_ACTIF=false` ;
   - une seule minuterie par processus (garde sur `globalThis`, à cause du rechargement à chaud en dev) ;
   - les erreurs ne font jamais tomber le processus.
   - **Vérifier dans la documentation de Next 16 que `instrumentation` est bien exécuté en sortie `standalone`.**
4. **Une seule exécution à la fois, même avec deux instances** : chaque tâche prend
   `pg_try_advisory_lock(hashtext('tache:<nom>'))`. Si le verrou est déjà pris, l'exécution est marquée `IGNOREE`.
   Les tâches restent idempotentes (réservations déjà en place).
5. **Modèle `ExecutionTache`** (migration additive) : `tache` (enum `RELANCES_JUSTIFICATION`, `ABSENCES`, `PURGE`),
   `declenchement` (`PLANIFICATEUR` ou `MANUEL`), `debut`, `fin`, `statut` (`SUCCES`, `ECHEC`, `IGNOREE`),
   `bilan` (JSON), `erreur` (texte court, sans donnée personnelle). Index sur `(tache, debut)`.
   - Chaque exécution, planifiée ou manuelle, écrit sa ligne.
   - C'est la source du moniteur de la phase 3.
6. **Tâche `PURGE`**, une fois par jour : supprime les `ExecutionTache` et les lignes de `JournalTechnique`
   (phase 3) de plus de 90 jours.
7. `DEPLOIEMENT.md` section 7 : le planificateur est intégré. Les tâches cron-job.org **doivent être supprimées le jour
   du déploiement** (le superviseur s'en charge). `CRON_SECRET` reste utile pour le déclenchement manuel.

**Fini quand** :
- les tests de `tachesDues` couvrent les 5 minutes, 17:30, 20:00, le week-end, un redémarrage après une heure manquée
  et une double instance ;
- en local, `next start` crée une ligne `ExecutionTache` `SUCCES` toutes les 5 minutes sans aucun appel externe ;
- deux processus lancés sur la même base donnent une ligne `SUCCES` et une ligne `IGNOREE`.

---

## Phase 3 — Journal technique et moniteur des tâches

Objectif : voir dans l'admin ce qui échoue sans faire tomber l'application. Aujourd'hui, ces erreurs ne finissent que
dans les logs du serveur, auxquels on n'a pas accès.

1. **Modèle `JournalTechnique`** (migration additive) : `niveau` (`ERREUR`, `AVERTISSEMENT`), `source` (`EMAIL`, `PUSH`,
   `TACHE`, `IMPORT`, `AUTRE`), `code` (court, stable : `SMTP_ECHEC`, `SMTP_NON_CONFIGURE`, `FCM_ECHEC`,
   `FCM_JETON_INVALIDE`, `FIREBASE_NON_CONFIGURE`, `TACHE_ECHEC`…), `message`, `contexte` (JSON), `createdAt`.
   Index sur `(createdAt)` et `(source, createdAt)`.
   - **Le contexte ne contient jamais de données sensibles** : pas de mot de passe, pas de contenu d'email, pas de jeton
     FCM entier. Identifiants (`userId`, `notificationId`) et nom de la tâche seulement.
2. **Une seule fonction** `journaliserIncident()` (`frontend/src/lib/journalTechnique.ts`).
   - Elle ne lève jamais d'erreur : si l'écriture échoue, `console.error` seulement.
   - Anti-inondation : au plus une ligne par `code` et par minute ; les répétitions sont comptées dans `contexte`.
3. **Brancher la fonction là où les erreurs sont aujourd'hui avalées** :
   - `notificationService.ts` : `sendFcmPush` (échec, jetons supprimés) et `sendCriticalEmail` (échec) ;
   - `email/transporter.ts` : envoi simulé alors que `NODE_ENV === "production"` → `SMTP_NON_CONFIGURE` (avertissement) ;
   - `firebase/firebaseAdmin.ts` : JSON absent ou invalide en production ;
   - phase 2 : exécution en `ECHEC`.
4. **Écran `/admin/journal-technique`**, garde `isAdmin`, trois onglets :
   - **Moniteur des tâches** (lit `ExecutionTache`). Pour chaque tâche :
     - dernière exécution (date, déclenchement, durée, statut, bilan lisible : « 3 envois, 1 clôture, 0 erreur ») ;
     - dernière exécution réussie ;
     - prochaine exécution attendue (calculée par `tachesDues`) ;
     - badge **« En retard »** si aucune exécution réussie depuis deux intervalles (10 min pour les relances ; pour les
       absences, le créneau du jour est passé de plus de 30 min) ;
     - historique des 50 dernières exécutions ;
     - bouton « Lancer maintenant » (déclenchement `MANUEL`, même fonction, même verrou).
   - **Incidents** (lit `JournalTechnique`) : filtres niveau, source, période ; 50 par page ; plus récents d'abord.
   - **Santé de la configuration** : SMTP configuré oui/non (sans afficher aucune valeur), Firebase serveur oui/non,
     Firebase navigateur oui/non (clés `NEXT_PUBLIC_FIREBASE_*` présentes dans l'image), `AUTH_URL`, planificateur
     actif oui/non. Plus, sur 7 jours : notifications `CRITIQUE` sans email envoyé, et `IMPORTANT`/`CRITIQUE` sans push
     envoyé (lu sur `Notification.emailSent` et `pushSent`).
5. **Accueil `/admin`** : carte « Journal technique » avec le nombre d'erreurs sur 24 h et l'état des tâches (vert,
   ou rouge si une tâche est en retard).
6. **Test d'intégration de l'invariant** (voir plus haut) : retard d'un membre de Commercial → aucune notification pour
   `rh@`, une seule pour `responsable-commercial@`.

**Fini quand** :
- SMTP volontairement faux sur la base jetable → l'onglet Incidents affiche `SMTP_ECHEC` après une relance ;
- planificateur coupé (`PLANIFICATEUR_ACTIF=false`) → le moniteur passe la tâche en « En retard » ;
- « Lancer maintenant » crée une ligne `MANUEL` ;
- un compte non admin reçoit 404 ou une redirection ;
- Playwright à 390 px sans défilement horizontal.

---

## Phase 4 — Relances par email (À NE LANCER QU'APRÈS LA RÉPONSE DE LA RH)

Question posée à la RH : les relances après le premier envoi partent-elles aussi par email ? Aujourd'hui, seul le
premier envoi part par email.

- **Si la RH répond « réglable »** : champ `relancesParEmail` (booléen, `true` par défaut) dans `ParametrageHoraire`
  (migration additive), case sur `/pointage/rh/horaires`. Quand il vaut `true`, toutes les relances partent en
  `CRITIQUE` ; sinon, comportement actuel.
- **Si la RH répond « toujours » ou « jamais »** : constante, sans réglage.
- Dans tous les cas : le bilan de la tâche distingue « envoyés » et « échecs d'email », grâce au retour de
  `sendCriticalEmail` exposé par `notify()`. Les échecs vont au journal technique.

**Fini quand** : tests de `prochaineActionJustification` inchangés, nouveau test sur le choix de priorité, et
Playwright sur la page Horaires.

---

## Phase 5 — Tableau de bord du responsable

Le responsable décide des justifications. Il a besoin d'une vue sur son équipe.

1. **Accès** : être **responsable actuel d'au moins un service**, comme pour le menu « Mon service » d'Aristide.
   - Aucune nouvelle permission : le « droit responsable », c'est la désignation dans Admin > Services.
   - Revérifié côté serveur sur chaque page et chaque action.
   - Menu « Mon équipe » dans la branche Pointage, visible à cette seule condition.
2. **Périmètre** : les membres actifs des services dont il est responsable, **sans lui-même**.
   - La RH garde sa vue globale ; le DG voit son service (Direction DG) comme les autres responsables.
3. **Contenu de `/pointage/mon-equipe`** :
   - **Aujourd'hui** : pour chaque membre, son état (à l'heure, en retard avec les minutes, absence autorisée, absent,
     pas encore pointé, parti en avance), heure d'arrivée et de départ, état de sa justification.
   - **À décider** : nombre de justifications soumises en attente, avec un lien vers `/pointage/justifications`.
   - **Sur la période** (mois en cours par défaut, filtre de période en GET) : par membre, nombre de retards, total des
     minutes, départs anticipés, absences, justifications non justifiées ou refusées.
   - Lien vers l'historique d'un membre, en lecture seule.
4. **Aucun second calcul.** Réutiliser les fonctions de la page Présence RH et du reporting
   (`pointageReporting.ts`, `justificationAffichee`, `utilisateursCouvertsParAbsence`, `reglesPointage`) en les
   paramétrant par une liste de `userId`. Si une fonction n'accepte pas ce filtre, l'ajouter ; ne pas la recopier.
5. Pas d'export dans cette version.

**Fini quand** :
- `responsable-commercial@` voit les seuls membres de Commercial ;
- un collaborateur sans responsabilité reçoit 404 et ne voit pas le menu ;
- le responsable ne se voit pas lui-même ;
- après un changement de responsable dans Admin > Services, l'accès suit immédiatement ;
- les chiffres sont identiques à ceux du reporting RH sur la même période et le même service ;
- Playwright à 390 px.

---

## Livraison

Pour chaque phase, envoyer à Thierry :
- le hash du commit ;
- la sortie de `npm test` (backend) ;
- les résultats de Playwright ;
- la liste des points non tranchés.

**Configuration à demander au superviseur au déploiement** (rien de tout ça ne se fait dans le code) :
- SMTP dans l'onglet Environment de Dokploy ;
- transfert du projet Firebase sur un compte de l'entreprise, puis reconstruction de l'image avec les `--build-arg` ;
- suppression des tâches cron-job.org le jour où le planificateur intégré part en production.

---

## Décisions complémentaires de Thierry (14/10, après livraison des phases 1, 2, 3 et 5)

- **Phase 4 (relances par e-mail) : abandonnée.** On garde la règle actuelle : le 1er envoi part par e-mail, puis les
  relances par push et notification interne. Rien n'est codé.
- **Clôture initiale** au premier passage du planificateur en production : toutes les justifications `EN_ATTENTE` dont le
  pointage date d'avant le jour courant passent à `NON_JUSTIFIEE` (`clotureeAt`) sans aucun envoi ; les absences
  `A_CONTROLER` antérieures au jour courant passent à `CONFIRMEE` sans notification ; une ligne `TACHE` au journal
  technique avec le nombre de clôtures ; une seule fois (marqueur `MarqueurUnique`). Statut des absences vérifié : voir
  `CLAUDE.md` § 18.
- **Comptes RH** : un seul en production, le repli sur le DG s'applique. Rien à changer.
- **Réinitialisation du Pointage seul** (`pointage.reinitialiser`, `/admin/reinitialisation-pointage`) : voir
  `CLAUDE.md` § 19. Elle ne touche ni `systeme.reinitialiser` ni la réinitialisation globale (déjà exécutée, verrouillée).
- **Règle permanente** : aucun push, d'aucune branche. La série de commits est livrée par `git format-patch`, Thierry
  l'applique et pousse lui-même.
