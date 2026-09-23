# Architecture Technique & Référence Ingénierie — Module Pointage RH & Réalisations Transverses

> **Document de référence pour les développeurs et architectes reprenant le projet.**  
> Ce document détaille l'intégralité des fondations logicielles, des choix d'ingénierie, des algorithmes de sécurité, des flux temps réel, des règles métier et des pistes d'évolutivité (scalabilité) pour le **Module de Pointage RH** ainsi que **toutes les fonctionnalités transverses développées par Thierry Kouame**.
>
> Pour une vulgarisation fonctionnelle sans jargon technique destinée aux utilisateurs finaux, consulter : [GUIDE_FONCTIONNEL_POINTAGE.md](file:///c:/Users/dmass/Documents/portailrh/docs/GUIDE_FONCTIONNEL_POINTAGE.md).  
> Pour la vision globale du portail et des autres modules (Trésorerie, Socle), consulter : [CLAUDE.md](file:///c:/Users/dmass/Documents/portailrh/CLAUDE.md).

---

## Sommaire

1. [Vue d'Ensemble & Philosophie d'Architecture](#1-vue-densemble--philosophie-darchitecture)
2. [Modèle de Données & Schéma Prisma](#2-modèle-de-données--schéma-prisma)
3. [Matrice des Permissions & Rôles (RBAC)](#3-matrice-des-permissions--rôles-rbac)
4. [Sécurité Réseau, IP/CIDR & Géolocalisation de Secours](#4-sécurité-réseau-ipcidr--géolocalisation-de-secours)
5. [Parcours Collaborateur & Flux de Pointage](#5-parcours-collaborateur--flux-de-pointage)
6. [Moteur Automatique d'Absences & Détection des Oublis (CRON)](#6-moteur-automatique-dabsences--détection-des-oublis-cron)
7. [Console & Boîte à Outils Métier RH](#7-console--boîte-à-outils-métier-rh)
8. [Temps Réel & Architecture Événementielle (SSE & EventBus)](#8-temps-réel--architecture-événementielle-sse--eventbus)
9. [Réalisations Transverses Hors Pointage](#9-réalisations-transverses-hors-pointage)
   - 9.1 [Plateforme de Notifications Multi-Canal (FCM Web Push, In-App, Email, Audio)](#91-plateforme-de-notifications-multi-canal-fcm-web-push-in-app-email-audio)
   - 9.2 [Console Admin : Monitoring de l'Adoption Push & Export CSV](#92-console-admin--monitoring-de-ladoption-push--export-csv)
   - 9.3 [Charte Graphique des Emails & Optimisation Outlook](#93-charte-graphique-des-emails--optimisation-outlook)
   - 9.4 [Réinitialisation de Mot de Passe Sécurisée par Email](#94-réinitialisation-de-mot-de-passe-sécurisée-par-email)
   - 9.5 [Refonte de la Page Profil & Tableaux de Bord par Rôle](#95-refonte-de-la-page-profil--tableaux-de-bord-par-rôle)
   - 9.6 [Optimisation des Logs d'Audit (`LogsList`) & Traçabilité des Services](#96-optimisation-des-logs-daudit-logslist--traçabilité-des-services)
   - 9.7 [Durcissement & Notation Structurée du Module FeedbackApp](#97-durcissement--notation-structurée-du-module-feedbackapp)
10. [Configuration d'Environnement & Déploiement](#10-configuration-denvironnement--déploiement)
11. [Guide de Scalabilité & Évolutions Futures](#11-guide-de-scalabilité--évolutions-futures)

---

## 1. Vue d'Ensemble & Philosophie d'Architecture

Le module **Pointage RH** s'insère dans le portail d'entreprise de **SIM Assurances**. L'application est structurée en un monorepo comprenant :
- `backend/` : Définition des schémas de données Prisma, migrations SQL, types partagés, règles de sécurité pures et fonctions utilitaires sans dépendance au framework d'interface (voir [backend/package.json](file:///c:/Users/dmass/Documents/portailrh/backend/package.json)).
- `frontend/` : Application Next.js 16 (React 19, TypeScript strict, App Router) assurant les Server Actions, Route Handlers (SSE, CRON, Webhook), et interfaces utilisateurs Tailwind CSS v4 (voir [frontend/package.json](file:///c:/Users/dmass/Documents/portailrh/frontend/package.json)).

### Principes Directeurs d'Ingénierie

1. **Zéro Édition Silencieuse & Traçabilité Immuable** : Aucun pointage ne peut être altéré sans création d'une trace d'audit formelle (`CorrectionPointage`). Toute tentative frauduleuse ou hors périmètre est consignée dans `HistoriqueEntry` avec l'adresse IP brute, la distance calculée, et l'identité de l'utilisateur.
2. **Double Ligne de Défense (Réseau d'abord, GPS ensuite)** : Le pointage sur site est par défaut validé par la présence sur le réseau local d'entreprise (IP whitelist / CIDR). En cas de panne de Wi-Fi ou d'usage sur terminal mobile 4G/5G, le système bascule intelligemment sur la géolocalisation GPS sans bloquer l'employé, sous réserve qu'il soit dans un rayon strict autour du siège.
3. **Pénalité Juste (Fairness by Design)** : Le système protège l'employé contre les sanctions automatisées injustes :
   - Exclusion automatique des week-ends et des jours fériés.
   - **Protection de l'ancienneté (Règle Option B)** : Un collaborateur ne peut jamais être marqué absent rétroactivement pour des jours antérieurs ou contemporains à la date de création ou de réactivation de son compte.
   - Détection des oublis de départ avant enregistrement d'une pénalité, avec alerte proactive multicanale.
4. **Réactivité Temps Réel** : Les tableaux de bord RH se mettent à jour instantanément lors de chaque pointage collaborateur via Server-Sent Events (SSE), sans nécessiter de rafraîchissement manuel de la page.

```mermaid
graph TD
    User([Collaborateur / Smartphone / PC]) -->|1. Demande de Pointage| SmartPointage[SmartPointage.tsx]
    SmartPointage -->|2. Server Action| EnregistrerPointage[enregistrerPointageAction]
    
    EnregistrerPointage --> CheckIP{IP autorisée ?\nisOfficeIpAllowed}
    CheckIP -->|OUI : Wi-Fi Bureau| ValidateRules[Contrôle Horaires & Retards]
    CheckIP -->|NON : 4G ou Hors Site| CheckGeoActive{Géoloc Active ?}
    
    CheckGeoActive -->|NON| BlockPointage[Erreur : Réseau Entreprise Exigé]
    CheckGeoActive -->|OUI| CheckGPS{Distance <= Rayon ?\nisWithinRadius}
    
    CheckGPS -->|NON : Hors Périmètre| AlertRH[Notification RH Sécurité\nTentative Hors Périmètre]
    CheckGPS -->|OUI : Présent sur site| ValidateRules
    
    ValidateRules --> PrismaTx[Transaction Prisma Atomique]
    PrismaTx --> CreatePointage[Pointage Créé]
    PrismaTx --> CreateAudit[HistoriqueEntry Créé]
    
    PrismaTx --> EventBus[pointageEmitter / publishDataChanged]
    EventBus --> LiveSSE[SSE Stream /api/pointage/stream]
    LiveSSE --> DashboardRH[Dashboard RH Live Update]
    EventBus --> MultiNotif[NotificationService]
```

---

## 2. Modèle de Données & Schéma Prisma

Le modèle de données réside dans [backend/prisma/schema.prisma](file:///c:/Users/dmass/Documents/portailrh/backend/prisma/schema.prisma).

```mermaid
erDiagram
    User ||--o{ Pointage : "pointagesEffectues"
    User ||--o{ Pointage : "pointagesRealises (RH exceptionnel)"
    User ||--o{ CorrectionPointage : "correctionsEffectuees"
    User ||--o{ Absence : "absencesDeclarees"
    User ||--o{ Absence : "absencesControlees (RH)"
    User ||--o{ FcmToken : "tokens push"
    User ||--o{ PlageAbsenceAutorisee : "plages autorisées"
    
    Pointage ||--o{ CorrectionPointage : "historique corrections"
    
    ParametrageHoraire {
        string id PK
        string heureDebutMatin
        string heureFinMatin
        string heureDebutApresMidi
        string heureFinApresMidi
        boolean isActive
        int delaiAlerteOubliDepartMinutes
        boolean geolocalisationActive
        float bureauLatitude
        float bureauLongitude
        int rayonAutorise
    }
    
    Pointage {
        string id PK
        TypePointage type
        SourcePointage source
        datetime heure
        string heurePrevue
        boolean estRetard
        int minutesRetard
        boolean estDepartAnticipe
        string motif
        string ipAddress
        float geoLatitude
        float geoLongitude
        float geoPrecision
        int geoDistance
        string userId FK
        string effectueParId FK
    }

    CorrectionPointage {
        string id PK
        string pointageId FK
        string ancienneValeur
        string nouvelleValeur
        string motif
        string effectueParId FK
    }

    Absence {
        string id PK
        datetime date
        StatutAbsence statut
        string motif
        string userId FK
        string controleParId FK
    }

    JourFerie {
        string id PK
        datetime date UK
        string libelle
    }

    FcmToken {
        string id PK
        string token UK
        string userAgent
        string userId FK
    }
```

### Détail des Entités Clés

#### 1. `Pointage`
Enregistre chaque acte de présence.
- `type` : `ARRIVEE` | `DEPART`.
- `source` : 
  - `ORDINATEUR` : Pointage via navigateur PC sur le réseau de l'entreprise.
  - `QR_CODE` : Pointage mobile validé après scan du QR code officiel.
  - `RH_EXCEPTIONNEL` : Pointage saisi rétroactivement par un agent RH habilité.
  - `GEOLOCALISATION` : Pointage validé par calcul de proximité GPS (fallback).
- `heure` : Date et heure réelles constatées par le serveur au moment de l'écriture (jamais forgée par le client).
- `heurePrevue` : Heure théorique au moment du pointage (ex : `"07:45"` ou `"16:45"`), conservée pour l'historique même si les horaires de l'entreprise évoluent ultérieurement.
- `estRetard` / `minutesRetard` : Flag et nombre de minutes de retard constatées par rapport à `heureDebutMatin`.
- `estDepartAnticipe` : Détection si l'employé quitte le bureau avant `heureFinApresMidi`.
- `motif` : Motif explicatif obligatoire en cas de retard ou de départ anticipé.
- Données géographiques : `geoLatitude`, `geoLongitude`, `geoPrecision`, `geoDistance` (stockés uniquement en cas de validation GPS).
- `effectueParId` : Null si le collaborateur a pointé lui-même ; contient l'ID du gestionnaire RH s'il s'agit d'un pointage exceptionnel.

#### 2. `ParametrageHoraire`
Singleton de configuration actif (`isActive: true`).
- `heureDebutMatin` (défaut : `"07:45"`), `heureFinMatin` (défaut : `"12:15"`).
- `heureDebutApresMidi` (défaut : `"13:15"`), `heureFinApresMidi` (défaut : `"16:45"`).
- `delaiAlerteOubliDepartMinutes` (défaut : `30`) : Temporisation après la fin de journée avant de déclencher l'alerte d'oubli de départ.
- `geolocalisationActive` (booléen) : Interrupteur général du secours GPS.
- `bureauLatitude` (`5.3628189`) / `bureauLongitude` (`-3.9374753`) : Coordonnées GPS du siège SIM Assurances.
- `rayonAutorise` (défaut : `50` mètres, borné entre 30m et 200m).

#### 3. `CorrectionPointage`
Registre d'audit obligatoire de toute modification opérée par les RH.
- `ancienneValeur` / `nouvelleValeur` : Chaînes horodatées complètes (ex: `"14/09/2026 08:30"`).
- `motif` : Motif circonstancié obligatoire (au moins 3 caractères).
- `effectueParId` : Identifiant de l'agent RH responsable.

#### 4. `Absence`
Gère les journées non travaillées.
- `date` : Date normalisée à 00:00:00.
- `statut` :
  - `A_CONTROLER` : Absence générée automatiquement par le CRON de fin de journée.
  - `CONFIRMEE` : Absence validée comme injustifiée par les RH (déclenche une alerte critique).
  - `JUSTIFIEE` : Absence justifiée par un certificat médical, congé ou régularisée par un pointage exceptionnel.
- `controleParId` : Agent RH ayant statué sur l'absence.

#### 5. `JourFerie`
Table des jours chômés obligatoires (`date` unique normalisée en UTC, `libelle`). Prise en compte immédiate par le moteur d'absences et le calendrier des présences.

---

## 3. Matrice des Permissions & Rôles (RBAC)

Le contrôle d'accès s'appuie sur le système de permissions fines géré par [backend/src/permissions.ts](file:///c:/Users/dmass/Documents/portailrh/backend/src/permissions.ts) et [frontend/src/lib/auth.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/auth.ts).

### Permissions du Module Pointage

| Clé de Permission | Description | Rôles Attribués par Défaut |
|---|---|---|
| `pointage.pointer` | Pointer son arrivée et son départ | Collaborateur, RH |
| `pointage.consulter_historique` | Consulter son propre journal de pointage | Collaborateur, RH |
| `pointage.consulter_tous` | Voir les pointages de l'ensemble des employés | RH, DG |
| `pointage.pointage_exceptionnel` | Enregistrer un pointage au nom d'un tiers | RH |
| `pointage.corriger_pointage` | Modifier l'heure d'un pointage avec motif | RH |
| `pointage.gerer_horaires` | Modifier les horaires et la configuration GPS | RH |
| `pointage.voir_dashboard_rh` | Accéder à la vue de présence en direct | RH, DG |
| `pointage.voir_reporting` | Consulter les statistiques et générer les exports | RH, DG |
| `pointage.gerer_jours_feries` | Ajouter ou supprimer des jours fériés chômés | RH |

> [!NOTE]
> **Rôle Admin** : L'administrateur système technique dispose de `role.estAdmin = true`. Il a un accès complet de configuration et de supervision sur la console `/admin`, mais ne possède pas de permissions métier arbitraires sauf attribution explicite.

---

## 4. Sécurité Réseau, IP/CIDR & Géolocalisation de Secours

Le système implémente une stratégie de validation spatiale à deux niveaux dans [frontend/src/app/(dashboard)/pointage/actions.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(dashboard)/pointage/actions.ts).

### 4.1 Contrôle d'Adresse IP & Masques CIDR

L'adresse IP du client est extraite des en-têtes HTTP (`x-forwarded-for` en amont d'un reverse proxy ou `x-real-ip`).

```typescript
// Nettoyage de l'IP du client (gestion IPv4 mappée en IPv6)
let cleanClientIp = clientIp.trim();
if (cleanClientIp.startsWith('::ffff:')) {
  cleanClientIp = cleanClientIp.replace('::ffff:', '');
}
```

La fonction `isOfficeIpAllowed` ([backend/src/pointage-utils.ts](file:///c:/Users/dmass/Documents/portailrh/backend/src/pointage-utils.ts)) utilise la bibliothèque `ipaddr.js` pour valider la correspondance avec la variable `ALLOWED_OFFICE_IPS` :
- **IP fixes** : ex. `197.234.218.42, 127.0.0.1`.
- **Plages sous-réseau CIDR** : ex. `192.168.1.0/24`, `10.0.0.0/16`.

### 4.2 Fallback Géolocalisation GPS (Formule de Haversine)

Si le collaborateur n'est pas sur le réseau Wi-Fi d'entreprise (cas typique d'une connexion 4G/5G sur smartphone ou d'une défaillance de la box Internet) :
1. Le serveur vérifie si `parametrage.geolocalisationActive` est à `true`.
2. Si la géolocalisation est désactivée : Rejet immédiat + Notification d'alerte sécurité transmise aux RH.
3. Si la géolocalisation est active : Le client mobile transmet ses coordonnées issues de `navigator.geolocation.getCurrentPosition`.
4. **Contrôle de précision GPS** : Si `geoPrecision > 150 mètres`, le pointage est refusé avec le message *"Signal GPS trop faible. Déplacez-vous en extérieur et réessayez."* (évite le spoofing basé sur la localisation IP grossière des opérateurs).
5. **Calcul de distance Haversine** ([backend/src/geo-utils.ts](file:///c:/Users/dmass/Documents/portailrh/backend/src/geo-utils.ts)) :
   $$\Delta\sigma = 2 \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)} \right)$$
   $$d = R \cdot \Delta\sigma \quad (\text{avec } R = 6\,371\,000\text{ m})$$
6. Si $d \le \text{rayonAutorise}$ (ex. 50 m) : Le pointage est validé avec la source `GEOLOCALISATION`.
7. Si $d > \text{rayonAutorise}$ : **Rejet strict + Alerte de sécurité instantanée** envoyée à tous les gestionnaires RH :
   > *"🚨 Tentative de pointage non autorisée : [Nom Collaborateur] a tenté de pointer hors réseau et hors périmètre (Distance: X mètres, Rayon autorisé: Y mètres)."*

---

## 5. Parcours Collaborateur & Flux de Pointage

Le parcours de pointage repose sur le composant intelligent [SmartPointage.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(dashboard)/pointage/SmartPointage.tsx) et l'action serveur [enregistrerPointageAction](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(dashboard)/pointage/actions.ts).

```mermaid
stateDiagram-v2
    [*] --> DetectionTerminal: Accès /pointage/pointer ou /pointage
    DetectionTerminal --> ScanQR: Mobile (QR Code)
    DetectionTerminal --> DirectBrowser: Desktop (Wi-Fi)
    
    state "Vérification État de la Journée" as CheckState
    DirectBrowser --> CheckState
    ScanQR --> CheckState
    
    CheckState --> ArriveePossible: 0 pointage aujourd'hui
    CheckState --> DepartPossible: 1 pointage (ARRIVEE) existant
    CheckState --> JourneeComplete: 2 pointages complétés
    
    state ArriveePossible {
        [*] --> CheckHeureArrivee
        CheckHeureArrivee --> HeureNormale: Avant 07:45
        CheckHeureArrivee --> RetardDetecte: Après 07:45
        RetardDetecte --> SaisieMotifObligatoire: Motif >= 3 caractères requis
    }
    
    state DepartPossible {
        [*] --> CheckHeureDepart
        CheckHeureDepart --> DepartNormal: Après 16:45
        CheckHeureDepart --> DepartAnticipeDetecte: Avant 16:45
        DepartAnticipeDetecte --> SaisieMotifDepart: Motif >= 3 caractères requis
    }
    
    ArriveePossible --> PointageEnregistre: Soumission
    DepartPossible --> PointageEnregistre: Soumission
    PointageEnregistre --> NotificationFinJournee: Message chaleureux (Vendredi vs Semaine)
    PointageEnregistre --> [*]
```

### Règles Métier Implémentées

1. **Ordre Chronologique Strict** : Impossible d'enregistrer un `DEPART` sans `ARRIVEE` préalable.
2. **Unicité Quotidienne** : Maximum 1 arrivée et 1 départ par collaborateur et par date calendaire.
3. **Péremption de la Journée** : Si un collaborateur tente de pointer son arrivée après l'heure de départ de référence (`16:45`), l'arrivée est refusée car la journée de travail est considérée comme échue (l'absence automatique prend le relais).
4. **Justification des Anomalies** :
   - Arrivée en retard : Champ motif obligatoire (`motif.trim().length >= 3`).
   - Départ anticipé : Champ motif obligatoire (`motif.trim().length >= 3`).
   - Les anomalies déclenchent une notification `IMPORTANT` envoyée aux RH (`/pointage/rh/presence`).
5. **Expérience Utilisateur Chaleureuse** : La fonction `getMessageDepart()` ([backend/src/pointage-utils.ts](file:///c:/Users/dmass/Documents/portailrh/backend/src/pointage-utils.ts)) adapte le message de confirmation :
   - Le vendredi : *"Pointage validé. Bon week-end et à lundi !"*
   - Du lundi au jeudi : *"Pointage validé. Bonne fin de journée et à demain !"*

---

## 6. Moteur Automatique d'Absences & Détection des Oublis (CRON)

Le traitement des absences et anomalies est orchestré par le Route Handler [frontend/src/app/api/cron/absences/route.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/api/cron/absences/route.ts), exécuté périodiquement via un orchestrateur de tâches (Vercel Cron, Dokploy Cron ou Crontab Linux).

### 6.1 Sécurisation de la Route
La route exige un token Bearer dans l'en-tête `Authorization` correspondant à la variable secrète `CRON_SECRET`.

### 6.2 Algorithme de Détection des Absences

Pour chaque collaborateur actif disposant de la permission `pointage.pointer` :
1. **Fenêtre de Rattrapage Glissante (2 jours)** : Le script analyse aujourd'hui ($J$) et la veille ($J-1$) afin de récupérer d'éventuelles absences si le cron a subi un arrêt momentané.
2. **Exclusion des Périodes Non Ouvrées** :
   - Samedis et Dimanches ignorés (`dayOfWeek === 0 || dayOfWeek === 6`).
   - Jours fériés répertoriés dans la table `JourFerie` ignorés.
3. **Condition Horaire du Jour Courant** : L'analyse pour le jour $J$ ne s'exécute que si l'heure courante a dépassé `heureFinApresMidi` (16:45 ou 18:00 par défaut).
4. **Règle de Protection d'Ancienneté (Option B)** :
   - Le système extrait la date de référence du compte : `user.createdAt` ou la dernière date d'activation/réactivation dans `HistoriqueEntry` (`action IN ['ACTIVATE', 'INVITATION_ACTIVATED']`).
   - Si $\text{dateCible} \le \text{dateReference}$ : **Aucune absence ne peut être créée**. Un collaborateur ne peut pas être pénalisé pour des jours où son compte n'existait pas ou n'était pas encore actif.
5. **Génération d'Absence** : S'il n'existe ni pointage d'`ARRIVEE`, ni absence déjà enregistrée, une ligne `Absence` au statut `A_CONTROLER` est créée, et une notification est émise aux RH.

### 6.3 Détection des Oublis de Départ

Après expiration du délai paramétrable `delaiAlerteOubliDepartMinutes` (défaut : 30 minutes après `heureFinApresMidi`) :
1. Le système recherche les collaborateurs ayant un pointage d'`ARRIVEE` le jour même mais aucun pointage de `DEPART`.
2. S'il n'a pas encore été notifié aujourd'hui :
   - **Notification Collaborateur (Priorité CRITIQUE)** : Email + Push FCM + In-app : *"Vous avez pointé votre arrivée mais vous avez oublié de pointer votre départ aujourd'hui."*
   - **Notification RH & Administrateurs (Priorité IMPORTANT)** : Push FCM + In-app signalant l'oubli pour suivi.

### 6.4 Rattrapage Manuel des Absences

Les RH disposent sur l'écran `/pointage/rh/presence` d'un bouton d'action [RecoverAbsencesButton.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(dashboard)/pointage/rh/presence/RecoverAbsencesButton.tsx) déclenchant [recoverAbsencesAction](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(dashboard)/pointage/rh/presence/actions.ts). Il applique exactement les mêmes règles (Option B, jours fériés, week-ends, vérification de fin de journée) sur une date passée choisie.

---

## 7. Console & Boîte à Outils Métier RH

La section d'administration RH sous `/pointage/rh` offre un ensemble complet d'écrans spécialisés :

### 7.1 Suivi des Présences en Temps Réel (`/pointage/rh/presence`)
- Visualisation en direct sous forme d'onglets : **Tous**, **Présents**, **Retards**, **Absents**.
- Connecté en temps réel au flux Server-Sent Events : tout nouveau pointage s'affiche instantanément sans recharger la page.
- Visualisation des détails GPS (coordonnées, distance calculée par rapport au bureau, précision du terminal).

### 7.2 Pointage Exceptionnel (`/pointage/rh/pointages/nouveau`)
Permet aux RH de saisir un pointage à la place d'un collaborateur (oubli de badge, panne matérielle, mission extérieure) :
- Sélection du collaborateur, type (`ARRIVEE` / `DEPART`), heure effective et motif circonstancié.
- **Régularisation Automatique** : Si le pointage exceptionnel concerne une `ARRIVEE`, une transaction Prisma atomique recherche les absences du jour au statut `A_CONTROLER` pour ce collaborateur et les passe automatiquement à `JUSTIFIEE` avec le motif *"Régularisation par pointage exceptionnel"*.
- Notification de confirmation émise au collaborateur.

### 7.3 Registre de Correction Tracé (`/pointage/rh/corrections`)
- Permet de rectifier une heure de pointage erronée.
- Enregistrement obligatoire dans la table `CorrectionPointage` (ancienne heure, nouvelle heure, motif de correction, identifiant RH).
- Recalcul automatique et immédiat du statut de retard et des minutes de retard associées.

### 7.4 Triage des Absences (`/pointage/rh/absences`)
- Traitement des absences `A_CONTROLER` issues du CRON.
- Actions possibles : `CONFIRMEE` (injustifiée) ou `JUSTIFIEE` (justifiée).
- En cas de confirmation d'absence non justifiée, une notification de priorité `CRITIQUE` est envoyée à l'employé avec le motif des RH.

### 7.5 Gestion des Jours Fériés (`/pointage/rh/jours-feries`)
- Import et ajout par lot de jours fériés (avec normalisation UTC).
- Prise en compte immédiate par le moteur d'absences automatiques.

### 7.6 Moteur de Reporting & Export Excel Multi-Feuilles (`/pointage/rh/reporting`)
- Filtres combinables : période (bornée à 180 jours max), collaborateur, service.
- Route de génération de fichier : [frontend/src/app/api/pointage/rh/reporting/export/route.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/api/pointage/rh/reporting/export/route.ts) utilisant `exceljs`.
- Export binaire au format `.xlsx` comprenant 2 feuilles formatées aux couleurs institutionnelles de SIM Assurances (`#004B9C`) :
  1. **Feuille Résumé** : Collaborateur, Service, Jours travaillés, Présences, Absences, Jours de retard, Minutes totales de retard.
  2. **Feuille Détails des Retards** : Date, Collaborateur, Heure prévue, Heure réelle constatée, Minutes de retard, Motif fourni.

---

## 8. Temps Réel & Architecture Événementielle (SSE & EventBus)

Afin d'éviter tout sondage réseau répétitif (polling) consommateur de ressources, le système s'appuie sur une architecture hybride **Server-Sent Events (SSE)** et **Node.js EventEmitter**.

### 8.1 Singleton Événementiel
Fichier [frontend/src/lib/events.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/events.ts) :
- Instance `pointageEmitter` préservée sur `globalThis` pour survivre au Hot Module Reloading (HMR) en développement.
- Capacité configurée à 1000 écouteurs simultanés (`setMaxListeners(1000)`).

### 8.2 Flux de Diffusion HTTP (`/api/pointage/stream`)
Fichier [frontend/src/app/api/pointage/stream/route.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/api/pointage/stream/route.ts) :
- Établit une connexion persistante HTTP utilisant `TransformStream` avec les en-têtes :
  `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`.
- Écoute l'événement `pointage-updated` émis par `enregistrerPointageAction` et transmet instantanément `event: refresh\ndata: update\n\n` aux clients connectés.
- Gestion propre de la déconnexion via `req.signal.addEventListener("abort")`.

---

## 9. Réalisations Transverses Hors Pointage

Au cours du projet, des chantiers techniques majeurs ont été réalisés par Thierry Kouame pour moderniser l'ensemble du portail SIM Assurances.

```mermaid
graph LR
    subgraph Notifications
        NotifService[NotificationService] --> DB[(Prisma DB)]
        NotifService --> SSEBus[EventBus SSE]
        NotifService --> FCMAdmin[FCM Web Push]
        NotifService --> SMTP[Nodemailer SMTP]
    end
    
    subgraph UI Components
        FCMAdmin --> SW[Service Worker SW.js]
        SW --> OSNotif[Notification Système OS]
        SSEBus --> Drawer[NotificationDrawer.tsx]
        Drawer --> Audio[Feedback Sonore WebAudio]
        DB --> Topbar[Topbar Alerts Banner]
    end
    
    subgraph Admin & Sécurité
        FCMAdmin --> PushAdoption[Monitoring Adoption /admin]
        PushAdoption --> CSVExport[Export CSV Adoption]
        SMTP --> PasswordReset[Reset Password Flow /forgot-password]
        SMTP --> EmailLayout[Templates Outlook Calibri/CID]
    end
```

### 9.1 Plateforme de Notifications Multi-Canal (FCM Web Push, In-App, Email, Audio)

Le système de notification unifié ([frontend/src/lib/notifications/notificationService.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/notifications/notificationService.ts)) orchestre quatre canaux de diffusion selon une matrice de priorité stricte :

| Niveau de Priorité | Canaux Déclenchés | Cas d'Usage |
|---|---|---|
| `CRITIQUE` | Base DB + SSE In-app + Push FCM + **Email SMTP** | Oubli de pointage départ, absence confirmée injustifiée, réinitialisation de mot de passe, alertes sécurité |
| `IMPORTANT` | Base DB + SSE In-app + **Push FCM** | Anomalies de pointage (retard, départ anticipé), pointage exceptionnel, alertes validation RH |
| `INFO` | Base DB + SSE In-app | Informations de service, confirmations de routine |

#### Caractéristiques Techniques du Push FCM
- **Backend Firebase Admin** ([frontend/src/lib/firebase/firebaseAdmin.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/firebase/firebaseAdmin.ts)) : Utilise `sendEachForMulticast` pour adresser tous les terminaux enregistrés d'un utilisateur.
- **Auto-Nettoyage des Tokens Périmés** : Détection des erreurs `messaging/registration-token-not-registered` et `messaging/invalid-registration-token` pour supprimer automatiquement les tokens révoqués de la table `FcmToken`.
- **Service Worker Client** (`public/firebase-messaging-sw.js`) : Réception des messages data-only en arrière-plan, affichage de notifications système avec vibration et badge.
- **Audio Feedback** : Synthèse d'un bip sonore de notification discret via la Web Audio API native dans [NotificationDrawer.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/components/layout/NotificationDrawer.tsx).
- **Interface Utilisateur Moderne** : 
  - Tiroir latéral coulissant ([NotificationDrawer.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/components/layout/NotificationDrawer.tsx)) avec filtres par catégorie (`TRESORERIE`, `POINTAGE`, `RH`, `ADMIN`, `SYSTEME`).
  - Cloche animée avec badge de compteur non-lu dans la barre supérieure ([NotificationBell.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/components/layout/NotificationBell.tsx)).
  - Modale d'inspection complète ([NotificationDetailModal.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/components/layout/NotificationDetailModal.tsx)).
  - Bandeau d'alerte en Topbar pour l'oubli de départ ([frontend/src/lib/topbarAlerts.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/topbarAlerts.ts)).

### 9.2 Console Admin : Monitoring de l'Adoption Push & Export CSV

Situé sur la route `/admin/notifications` ([frontend/src/app/(dashboard)/admin/notifications/page.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(dashboard)/admin/notifications/page.tsx)) avec le composant [NotificationMonitoring.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/components/admin/NotificationMonitoring.tsx) :
- **Indicateurs Clés** : Taux d'adoption global (% des utilisateurs actifs ayant au moins 1 terminal abonné), nombre total d'appareils enregistrés, utilisateurs non abonnés.
- **Analyse des Terminaux** : Détection et affichage des navigateurs et systèmes d'exploitation (Chrome, Edge, Safari, Firefox, Android, iOS, Windows, macOS) via [userAgentParser.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/utils/userAgentParser.ts).
- **Export CSV** : Bouton d'export instantané au format CSV de l'état d'adoption avec encodage UTF-8 BOM pour compatibilité Excel.

### 9.3 Charte Graphique des Emails & Optimisation Outlook

Refonte intégrale de la couche d'envoi d'emails dans `frontend/src/lib/email/` :
- **Compatibilité Clients Stricts (Microsoft Outlook)** : Remplacement des styles modernes non supportés par un gabarit HTML tabulaire robuste ([baseEmailLayout.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/email/templates/baseEmailLayout.ts)).
- **Typographie Institutionnelle** : Police de secours universelle **Calibri**, lisible et professionnelle sur tous les clients de messagerie d'entreprise.
- **Logo CID Embarqué** : Inclusion du logo officiel SIM Assurances sous forme de pièce jointe inline (`cid:sim-logo`) pour un affichage garanti sans blocage des images distantes.
- **Gabarits Déployés** :
  - Bienvenue et activation de compte ([welcomeEmailTemplate.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/email/templates/welcomeEmailTemplate.ts)).
  - Réinitialisation de mot de passe ([resetPasswordTemplate.ts](file:///c:/Users/dmass/Documents/portailrh/frontend/src/lib/email/templates/resetPasswordTemplate.ts)).
  - Notifications d'alertes critiques (oublis, sanctions).

### 9.4 Réinitialisation de Mot de Passe Sécurisée par Email

Mise en place d'un parcours sécurisé complet sans intervention manuelle de l'administrateur :
- **Demande de réinitialisation** (`/forgot-password`, [ForgotPasswordForm.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(auth)/forgot-password/ForgotPasswordForm.tsx)) : Génération d'un token cryptographique unique (`crypto.randomBytes(32).toString("hex")`) stocké dans `User.resetPasswordToken` avec expiration à 1 heure (`User.resetPasswordExpiresAt`).
- **Saisie du nouveau mot de passe** (`/reset-password/[token]`, [ResetPasswordForm.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(auth)/reset-password/[token]/ResetPasswordForm.tsx)) : Validation de complexité Zod, hachage sécurisé bcrypt (10 rounds), révocation immédiate du jeton (`token = null`), et incrémentation de `tokenVersion` pour invalider immédiatement les éventuelles sessions actives compromises.

### 9.5 Refonte de la Page Profil & Tableaux de Bord par Rôle

Mise à jour de la route `/profil` ([frontend/src/app/(dashboard)/profil/ProfileClient.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/app/(dashboard)/profil/ProfileClient.tsx)) :
- **Tableau de Bord Contextuel par Rôle** : Affichage d'indicateurs personnalisés (ex: pointages récents pour Collaborateur, raccourcis de validation pour Finance/RH/DG).
- **Gestion des Avatars** : Intégration du composant [UserAvatar.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/components/ui/UserAvatar.tsx) avec route de téléversement sécurisée (`/api/upload-photo`) et préservation du répertoire `uploads/`.

### 9.6 Optimisation des Logs d'Audit (`LogsList`) & Traçabilité des Services

- **Élimination des Cascades de Rendu (Waterfalls)** dans [LogsList.tsx](file:///c:/Users/dmass/Documents/portailrh/frontend/src/components/logs/LogsList.tsx) : Préchargement des entrées côté serveur (`getServerSideProps`/RSC) et pagination fluide.
- **Audit des Services d'Entreprise** : Journalisation automatique dans `HistoriqueEntry` de toute création, modification ou suppression de structure organisationnelle ([Service](file:///c:/Users/dmass/Documents/portailrh/backend/prisma/schema.prisma#L675)).

### 9.7 Durcissement & Notation Structurée du Module FeedbackApp

Alignement du module FeedbackApp avec les impératifs de conformité :
- **Exclusion du Rôle Admin** : Ajout du champ `Role.peutRecevoirFeedback` (valant `false` pour le rôle technique "Admin") dans [schema.prisma](file:///c:/Users/dmass/Documents/portailrh/backend/prisma/schema.prisma#L135) afin que les comptes techniques ne figurent jamais parmi les collaborateurs évaluables.
- **Correction du Bug de Réattribution Automatique** : Correction de la régression où la permission `feedback.moderer` était réattribuée au compte Admin à chaque redémarrage.
- **Refonte de la Notation Structurée** : Formulaire à base d'étoiles, curseurs et choix prédéfinis avec génération de commentaires automatique côté serveur, renforçant l'anonymat en éliminant les marqueurs de style d'écriture.

---

## 10. Configuration d'Environnement & Déploiement

Les variables d'environnement requises pour le module de pointage et les notifications sont centralisées dans `.env` :

```env
# ── BASE DE DONNÉES ──
DATABASE_URL="postgresql://user:password@localhost:5432/sim_portail?schema=public"

# ── SÉCURITÉ DU CRON ──
# Jeton secret obligatoire pour autoriser l'exécution de /api/cron/absences
CRON_SECRET="votre_cle_secrete_cron_robuste"
SYSTEM_START_DATE="2026-09-07"

# ── CONTRÔLE RÉSEAU POINTAGE ──
# Liste blanche d'adresses IP ou plages CIDR séparées par des virgules
ALLOWED_OFFICE_IPS="197.234.218.42,127.0.0.1,::1,192.168.1.0/24"

# ── SERVEUR SMTP (NOTIFICATIONS & RESET PASSWORD) ──
SMTP_HOST="smtp.votre-serveur.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="notifications@simassurances.ci"
SMTP_PASS="votre_mot_de_passe_smtp"
SMTP_FROM="SIM Assurances <notifications@simassurances.ci>"

# ── FIREBASE CLOUD MESSAGING (WEB PUSH) ──
# Configuration Firebase Client (Public)
NEXT_PUBLIC_FIREBASE_API_KEY="AIzaSy..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="sim-portail.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="sim-portail"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="sim-portail.appspot.com"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="123456789"
NEXT_PUBLIC_FIREBASE_APP_ID="1:123456789:web:abcdef"
NEXT_PUBLIC_FIREBASE_VAPID_KEY="BEl62..."

# Configuration Firebase Admin (Serveur - JSON compacté en une ligne ou chemin de fichier)
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"sim-portail",...}'
```

---

## 11. Guide de Scalabilité & Évolutions Futures

Pour un développeur ou une équipe reprenant ce module et devant l'adapter à une entreprise de plusieurs centaines ou milliers d'employés, voici les directives d'évolution architecturale :

### 1. Passage à l'Échelle de la Couche Temps Réel (Clustering & Multi-Instances)
- **Constat Actuel** : Le bus d'événements `pointageEmitter` repose sur un singleton mémoire Node.js local au processus. Si l'application Next.js est déployée derrière un load-balancer sur plusieurs conteneurs (ex: Kubernetes ou plusieurs conteneurs Docker), un pointage enregistré sur l'instance A ne notifiera pas le client SSE connecté à l'instance B.
- **Solution de Scalabilité** : Remplacer l'EventEmitter en mémoire par un adaptateur **Redis Pub/Sub** :
  ```typescript
  // Architecture cible :
  // Instance A -> redisClient.publish("pointage-events", payload)
  // Instance B -> redisSubscriber.on("message", (ch, msg) => sseWriter.write(...))
  ```

### 2. Gestion Asynchrone des Tâches Lourdes (Queues & Workers)
- **Constat Actuel** : Les envois d'emails SMTP critiques et les requêtes push FCM multicast sont déclenchés en `Promise` asynchrones au sein de la requête HTTP du pointage (`notify`).
- **Solution de Scalabilité** : Découpler l'écriture en base de l'expédition des notifications via une file de messages persistante (ex. **BullMQ** adossé à Redis, ou **pg-boss** adossé à PostgreSQL). En cas de ralentissement du serveur SMTP ou de l'API Google Firebase, le pointage de l'utilisateur reste ultra-rapide (< 50 ms) et l'expédition des alertes est garantie avec retry automatique.

### 3. Multi-Sites & Multi-Agences
- **Constat Actuel** : `ParametrageHoraire` gère un jeu de coordonnées GPS et d'horaires d'entreprise global (siège d'Abidjan).
- **Solution de Scalabilité** : Lier `ParametrageHoraire` ou créer un modèle `Agence` (`id`, `nom`, `latitude`, `longitude`, `rayonAutorise`, `heureDebut`, `heureFin`) et associer chaque collaborateur à une agence de rattachement via `User.agenceId`. L'algorithme `isWithinRadius` calculera automatiquement la distance par rapport à l'agence de rattachement du collaborateur.

### 4. Authentification Biométrique & WebAuthn
- Pour éliminer tout risque de "buddy-punching" (un collègue scannant le QR code à la place d'un autre), intégrer la norme **WebAuthn / Passkeys** (empreinte digitale ou Face ID natif du smartphone) comme étape de validation optionnelle lors de la soumission du formulaire `SmartPointage`.
