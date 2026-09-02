# 🔍 Rapport d'Audit — Module Pointage de Présence

**Auditeur** : CTO / QA Senior  
**Date** : 2 septembre 2026  
**Périmètre** : Module Pointage de Présence uniquement (hors Socle Portail et module Trésorerie)  
**Références** : [cahier_de_charges_pointage.txt](file:///c:/Users/dmass/Documents/portailrh/cahier_de_charges_pointage.txt) · [ticket.txt](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/ticket.txt)

---

## 📊 État de l'avancement global

| Métrique | Valeur |
|---|---|
| **Tickets implémentés (complets)** | 9 / 11 |
| **Tickets partiels ou avec écarts** | 1 / 11 |
| **Tickets non commencés** | 0 / 11 |
| **Estimation avancement fonctionnel** | **~90%** |

> [!NOTE]
> Le module est dans un état avancé et fonctionnel. La grande majorité des exigences du cahier des charges sont couvertes. Les écarts identifiés ci-dessous sont principalement des bugs mineurs, du code mort, et un défaut de permission — rien de structurellement bloquant.

---

## ✅ Fonctionnalités Validées (conformes au cahier des charges)

### Ticket 1 — Pointage collaborateur (arrivée/départ) ✅
- [actions.ts](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/actions.ts) : Server Action complète avec validation Zod, heure serveur (`new Date()`), calcul automatique du retard, motif obligatoire.
- [SmartPointage.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/SmartPointage.tsx) : Composant intelligent qui auto-détecte le mode (arrivée à l'heure → auto, retard → formulaire avec motif, départ anticipé → motif obligatoire).
- [pointer/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/pointer/page.tsx) : Page serveur qui analyse les pointages du jour et applique le bon mode.
- **Conforme** : Heure automatique côté serveur, non modifiable, retard calculé, motif obligatoire si retard. ✅

### Ticket 2 — Pointage par QR Code ✅
- [/pointage/qr/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/pointage/qr/page.tsx) : Page de destination du QR qui redirige vers `/login` si non connecté (avec `callbackUrl`), puis vers `/pointage/pointer?source=QR_CODE`.
- [QRCodeDownload.tsx](file:///c:/Users/dmass/Documents/portailrh/src/components/ui/QRCodeDownload.tsx) : Composant de génération du QR code avec URL réseau, téléchargement PNG.
- **Conforme** : Flux complet scan → auth → pointage. ✅

### Ticket 3 — Contrôle réseau pour pointage ordinateur ✅
- [pointage-utils.ts](file:///c:/Users/dmass/Documents/portailrh/src/lib/pointage-utils.ts#L21-L53) : Vérification IP avec support CIDR via `ipaddr.js`, nettoyage IPv6-mapped.
- Actions.ts : Si `source === "ORDINATEUR"`, l'IP est vérifiée contre `ALLOWED_OFFICE_IPS`.
- **Conforme** : Refus avec message clair. ✅

### Ticket 4 — Espace collaborateur (historique) ✅
- [historique/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/historique/page.tsx) : Vue complète avec stats (arrivées, départs, retards, absences), filtres (période, type), tableaux séparés pointages/absences.
- [HistoriqueTables.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/historique/HistoriqueTables.tsx) : Colonnes détaillées (date, heure, type, statut/retard, source, corrections).
- **Conforme** : Filtrable par période, affiche motifs, corrections, source. ✅

### Ticket 5 — Pointage exceptionnel par la RH ✅
- [nouveau/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/pointages/nouveau/page.tsx) : Sélection collaborateur, heure réelle, motif obligatoire.
- [nouveau/actions.ts](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/pointages/nouveau/actions.ts) : Source `RH_EXCEPTIONNEL`, `effectueParId` tracé, historisation complète, suppression auto de l'absence `A_CONTROLER`.
- **Conforme** : Traçabilité complète (qui a saisi, quand, pourquoi). ✅

### Ticket 6 — Correction de pointage (RH) ✅
- [corrections/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/corrections/page.tsx) : Recherche par collaborateur, liste des 200 derniers pointages.
- [corrections/actions.ts](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/corrections/actions.ts) : Création d'un `CorrectionPointage` avec ancienne valeur, nouvelle valeur, motif, auteur. Recalcul automatique du retard. Historisation dans `HistoriqueEntry`.
- **Conforme** : Aucune modification sans trace, cahier des charges section 10. ✅

### Ticket 7 — Gestion des absences ✅
- [absences/actions.ts](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/absences/actions.ts) : Analyse sur N jours (par défaut 30), skip des week-ends, détection des collaborateurs sans pointage d'arrivée → création `A_CONTROLER`.
- `traiterAbsence` : RH peut confirmer ou justifier avec motif obligatoire.
- **Conforme** : Signalement automatique, traitement RH avec motif. ✅

### Ticket 8 — Dashboard RH ✅
- [rh/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/page.tsx) : 4 cartes KPI (Présents, Retardataires, Absents, Manquants), palmarès des retards du mois (jours ET minutes distinctement), listes détaillées cliquables.
- **Conforme** : Cahier des charges section 12 respecté, distinction jours/minutes. ✅

### Ticket 9 — Reporting RH ✅
- [reporting/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/reporting/page.tsx) : Filtres (période libre, collaborateur, service).
- [pointageReporting.ts](file:///c:/Users/dmass/Documents/portailrh/src/lib/pointageReporting.ts) : Résumé agrégé par collaborateur (jours travaillés, présences, absences, **jours de retard**, **minutes de retard** — deux colonnes distinctes). Détail des retards : date, heure prévue, heure réelle, minutes, motif.
- **Conforme** : Cahier des charges sections 13-14 respectées. ✅

### Ticket 10 — Export Excel ✅
- [export/route.ts](file:///c:/Users/dmass/Documents/portailrh/src/app/api/pointage/rh/reporting/export/route.ts) : API GET protégée, génération Excel avec `exceljs`, deux feuilles (Résumé + Détails des retards), mêmes filtres que le Ticket 9.
- **Conforme** : Export fonctionnel, filtres cohérents. ✅

### Ticket 11 — Paramétrage des horaires ✅
- [horaires/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/horaires/page.tsx) + [HorairesForm.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/horaires/HorairesForm.tsx) + [actions.ts](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/horaires/actions.ts) : Formulaire de modification des 4 plages horaires, validation Zod regex HH:MM, mise à jour ou création du `ParametrageHoraire`.
- **Conforme** : Cahier des charges section 5. ✅

---

## ⚠️ Écarts / À corriger

### 1. Code mort massif dans les fichiers critiques 🔴

Plusieurs fichiers contiennent d'anciennes implémentations **intégralement commentées** (L1-L224) suivies du code actif. C'est une dette technique qui nuit à la lisibilité et pourrait induire en erreur un auditeur ou un nouveau développeur.

| Fichier | Lignes commentées | Impact |
|---|---|---|
| [actions.ts](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/actions.ts#L1-L224) | L1–L224 (~224 lignes) | Action serveur de pointage |
| [PointageForm.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/PointageForm.tsx#L1-L234) | L1–L234 (~234 lignes) | Formulaire de pointage |
| [QRCodeDownload.tsx](file:///c:/Users/dmass/Documents/portailrh/src/components/ui/QRCodeDownload.tsx#L1-L85) | L1–L85 (~85 lignes) | Composant QR Code |
| [/pointage/qr/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/pointage/qr/page.tsx#L1-L24) | L1–L24 (~24 lignes) | Page de destination QR |

> **Recommandation** : Supprimer tout le code commenté. L'historique Git conserve les anciennes versions.

---

### 2. Formulaire de pointage collaborateur (PointageForm.tsx) : UX régressive 🟡

Le [PointageForm.tsx actif](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/PointageForm.tsx#L235-L277) (L235-277) est une version très simplifiée qui :
- **Rend le motif toujours obligatoire** (`required` en dur) — même pour une arrivée à l'heure ou un départ normal. Le cahier des charges (section 6) stipule que le motif n'est obligatoire **qu'en cas de retard**.
- **Ne montre pas** les horaires de référence, le statut du jour (arrivée/départ déjà pointés), ni les heures enregistrées.
- L'ancienne version commentée (L1-L234) avait un UX bien plus riche et conforme.

> **Impact** : L'UX est dégradée pour le collaborateur. Un employé ponctuel est obligé de saisir un motif inutile.
> **Recommandation** : Restaurer la logique conditionnelle du motif (obligatoire uniquement si retard ou départ anticipé).

---

### 3. Permission du Reporting commentée 🟡

Dans [reporting/page.tsx L22-25](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/reporting/page.tsx#L22-L25), la vérification de permission est commentée avec un `// TODO`:

```tsx
// TODO: Ajuster la permission exacte en fonction du cahier des charges
// if (!hasPermission(session, "pointage.reporting_rh")) {
//   redirect("/?error=acces_refuse");
// }
```

> **Impact** : N'importe quel utilisateur authentifié peut accéder au reporting RH. C'est une **faille de sécurité**.
> **Recommandation** : Activer cette vérification avec `pointage.voir_reporting` ou une permission équivalente.

---

### 4. Page QR (`/pointage/qr`) : pas de traçabilité du scan 🟡

L'ancienne version (commentée) créait un `HistoriqueEntry` de type `SCAN` lors de la visite de la page QR. La version active ne le fait plus — elle redirige directement.

> **Impact mineur** : La trace du scan en tant que tel est perdue (le pointage lui-même est bien tracé dans `actions.ts`, mais l'événement "scan du QR" n'est plus historisé séparément).

---

### 5. Répertoire vide : `pointage/qr/` dans le dashboard 🟢

Le dossier [`src/app/(dashboard)/pointage/qr/`](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/qr) est vide. Le vrai fichier QR se trouve hors du layout dashboard dans `src/app/pointage/qr/page.tsx`. Ce dossier vide peut être supprimé pour nettoyer l'arborescence.

---

### 6. Incohérence de permissions dans le layout RH vs les pages 🟡

Le [layout RH](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/layout.tsx) vérifie 6 permissions différentes (`pointage.consulter_tous`, `pointage.pointage_exceptionnel`, `pointage.corriger_pointage`, `pointage.gerer_horaires`, `pointage.voir_dashboard_rh`, `pointage.voir_reporting`).

Mais la page [pointages/page.tsx](file:///c:/Users/dmass/Documents/portailrh/src/app/(dashboard)/pointage/rh/pointages/page.tsx#L27) (Consultation globale) vérifie `pointage.gerer_parametrage` **OU** `pointage.gerer_corrections` — des permissions qui ne correspondent pas à celles du layout, et `pointage.gerer_corrections` n'apparaît pas comme une clé standard dans le reste du code. Cela devrait être harmonisé avec `pointage.consulter_tous` ou `pointage.voir_dashboard_rh`.

---

## 📋 Reste à faire

### Fonctionnel — Zéro ticket non commencé ✅

Tous les 11 tickets sont implémentés avec du code fonctionnel. Il n'y a **aucune fonctionnalité du cahier des charges qui n'a pas été commencée**.

### Qualité — Items de polish recommandés

| # | Item | Priorité |
|---|---|---|
| 1 | Supprimer tout le code commenté (actions.ts, PointageForm.tsx, QRCodeDownload.tsx, qr/page.tsx) | 🔴 Haute |
| 2 | Corriger le formulaire de pointage : motif obligatoire uniquement si retard/départ anticipé | 🔴 Haute |
| 3 | Activer la vérification de permission du reporting (`page.tsx` L22-25) | 🔴 Haute |
| 4 | Harmoniser les clés de permission entre le layout et les pages enfants | 🟡 Moyenne |
| 5 | Supprimer le dossier vide `(dashboard)/pointage/qr/` | 🟢 Basse |
| 6 | Restaurer la traçabilité du scan QR (optionnel, le pointage lui-même est tracé) | 🟢 Basse |

---

## 🏁 Conclusion

Le module de pointage est dans un **excellent état d'avancement**. Les 11 tickets sont tous implémentés avec les fondamentaux en place : modèle de données solide, Server Actions sécurisées, transactions Prisma, historisation des opérations RH. Les écarts identifiés sont principalement du nettoyage de code et un réajustement d'UX sur le formulaire de pointage collaborateur. Aucun blocage structurel.

**Note globale : 🟢 Module livrable après correction des 3 items prioritaires.**
