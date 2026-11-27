# Plan de développement — module « Gestion Compta » (module indépendant du portail)

> **Statut : plan mis à jour le 2026-10-22 avec les décisions de l'équipe.** Aucun code n'est écrit. Ce plan se fonde sur le cahier des charges
> `SIM-XX-XX — Cahier des charges, application de gestion : production, encaissements, créances clients, taxes, partenaires et
> comptabilité` (version 1.0, « Manuel des procédures administratives, comptables & financières »), lu en entier le 2026-10-22.
> Les noms de tables, permissions, fichiers et lots ci-dessous restent des **propositions** (à confirmer au lot GC-0).

### Décisions validées (2026-10-22)

| # | Décision | Conséquence dans ce plan |
|---|---|---|
| **V1** | **Module indépendant : on ne touche ni ne modifie rien de ce qui existe déjà dans le portail.** Les fonctionnalités identiques à celles des autres modules (Trésorerie, Encaissements, Pointage, Congés…) sont **ajoutées de nouveau** dans ce module ; chaque module vit seul. | D2 tranchée (coexistence totale) ; le code utile est **copié** dans des fichiers `cpt*`, jamais importé depuis `enc*` ou `treso*` ; voir 2.1 pour les rares points de câblage inévitables |
| **V2** | **Nom du module : « Gestion Compta ».** | D1 tranchée : clé `compta`, préfixe de tables `Cpt`, permissions `cpt.*`, route `/compta`, lots `GC-n` |
| **V3** | **Rattachement en deux étapes** : le commercial **confirme** (avec le reçu), puis le RFCRH **valide**. | Q3 tranchée ; règle détaillée en 7.2 et 6.2 |

---

## 0. Ce qu'il faut savoir avant de lire la suite

1. **Le cahier des charges décrit de la comptabilité et de la gestion financière, pas des ressources humaines** : production,
   encaissements, créances, taxe sur les contrats (TCA), rémunération des partenaires et comptabilité Odoo. Le nom « Gestion Compta »
   correspond au contenu. Le seul lien avec « RH » est le titre de l'interlocuteur (RFCRH).
2. **Le portail contient déjà un module « Encaissements, taxes » (cahier V2.6) qui recouvre en partie ce périmètre.** Décision V1 :
   il n'est **pas touché** et les fonctions communes sont **refaites** dans Gestion Compta. Conséquence à connaître : les deux modules
   calculeront chacun une taxe et des honoraires sur leurs propres données ; **un seul des deux doit servir de référence en production
   pour la TCA**, sinon le risque est de la déclarer ou de la payer deux fois (voir risque R1, section 12). **Tranché le 2026-11-27 :
   Gestion Compta fait foi (conception, C-41).**
3. **Le périmètre est le plus gros du portail** : environ 25 tables, 5 profils, 9 règles de gestion, 14 cas de recette,
   deux lots (gestion, puis comptabilité Odoo). Le planning indicatif du cahier (21 semaines pour le lot 1) suppose une équipe
   de prestataire ; le plan estime plus long parce qu'il applique les conventions du portail (tests, base jetable,
   signatures, procédure de mise en production), et parce que l'indépendance du module oblige à **dupliquer** du code au lieu de le réutiliser.

---

## 1. Périmètre résumé (ce que le cahier demande)

| Domaine | Ce que l'application doit permettre | Lot du cahier |
|---|---|---|
| Production | Importer et contrôler les contrats et échéances ; actes (affaire nouvelle, renouvellement, tranche, avenant, retrait, ristourne, annulation) ; prime acquise / non acquise à la clôture | 1 |
| Encaissements | Importer tous les relevés (Wave Business, Wave hors business, banques, microfinances, PeyaPay, caisse) ; rattacher chaque somme ; suivre les virements entre comptes sans double comptage | 1 |
| Clients et créances | Fiche client ; qui doit quoi, depuis quand, contrat par contrat ; relevés et relances | 1 |
| Taxe (TCA) | Émise, exigible, déclarée, payée ; quittances ; jamais payée deux fois | 1 |
| Partenaires | Conventions ; commissions, accessoires reversés, honoraires : dû, exigible, payé, reste à payer, par nature ; bordereaux ; règlements ; relevés | 1 |
| Comptabilité | Champs et exports Odoo préparés au lot 1 ; écritures, lettrage, rapprochement au lot 2 | 1 (préparation) puis 2 |
| Pilotage | Contrôle hebdomadaire ; anomalies ; clôture mensuelle verrouillée ; tableaux de bord ; historique ; exports Excel | 1 |

**Exigence structurante du cahier** : le lot 1 doit être conçu pour recevoir le lot 2 **sans refonte** (comptes, tiers et pièces
Odoo dans le modèle dès le départ, section 6.6 du cahier).

---

## 2. Décisions (D1 et D2 tranchées, D3 à D8 à confirmer au lot GC-0)

D1 et D2 découlent des décisions V1 et V2. Les autres portent une **recommandation** à confirmer pendant GC-0.

| # | Décision | Options | Recommandation |
|---|---|---|---|
| **D1** | **Nom et clé technique du module** | Tranchée (V2) | **« Gestion Compta »** : clé de module `compta`, préfixe de tables `Cpt`, permissions `cpt.*`, route `/compta`. Aucune collision avec l'existant (vérifié : aucun modèle, permission ni route `compta`/`cpt` dans le dépôt). |
| **D2** | **Sort du module « Encaissements » existant** | Tranchée (V1) | **Coexistence totale et indépendance** : Encaissements et tous les modules existants restent **strictement inchangés** ; Gestion Compta est ajouté à côté avec ses propres tables, permissions, écrans et moteurs, même quand une fonction existe déjà ailleurs. Les commits Encaissements en cours ne sont **pas** gelés par ce plan. |
| **D3** | **Profils → rôles du portail** (un seul rôle par utilisateur) | Un rôle par profil du cahier (Production, Commercial, RFCRH, Comptable stagiaire, Direction) ; **rôles combinés** pour les personnes qui cumulent | Cinq rôles de départ + **rôle combiné pour le RFCRH** (qui est à la fois finance, comptabilité et RH : sans rôle combiné il n'aurait pas accès à Pointage RH et à Gestion Compta). Les droits sont des **permissions explicites** (voir 6), jamais déduits d'une combinaison de permissions ni d'un nom de rôle. Un module indépendant n'empêche pas ce cumul : c'est le rôle de l'utilisateur qui le porte. |
| **D4** | **Arrondi et stockage des montants** | (a) entiers FCFA partout ; (b) `Decimal(14,2)` avec arrondi à l'unité à la figeure | **(b)**, cohérent avec le moteur existant (`encCalcul.ts`) : calcul au centime, **arrondi à l'unité à la figeure de chaque ligne, reliquat exact sur la dernière ligne** pour que les totaux d'un contrat se retrouvent (12 mensualités de taxe ne doivent jamais dériver de 1 ou 2 FCFA). Affichage sans décimales, saisie via le composant `InputMontant` existant. |
| **D5** | **Signature manuscrite sur les actions sensibles** (lot L du portail) | Oui / non | **Oui** pour : valider un rattachement, classer « pas une prime », déclarer et payer la TCA, régler un partenaire, compenser, clôturer. Elle prouve l'auteur de l'action sans second geste. Contrainte : le RFCRH et le DG doivent avoir enrôlé leur signature avant la mise en service. |
| **D6** | **Envoi réel de SMS** pour les relances | (a) suivi manuel (« relance faite par SMS, le … ») ; (b) passerelle SMS | **(a) au lot 1.** Le portail n'a aucune passerelle SMS (e-mail et notifications push seulement) ; en ajouter une est un sujet distinct (fournisseur, coût, consentement). Voir Q10. |
| **D7** | **Stockage des relevés et pièces** | Table `Cpt…` propre | **Copier le patron** d'`EncPieceJointe` dans `CptPieceJointe` (table propre au module, `PieceJointe` de la Trésorerie intact). Relevés bancaires et Wave = **données clients : jamais dans le dépôt, ni dans `docs/`, ni dans les tests** (jeux synthétiques seulement). |
| **D8** | **Solution technique du cahier** (« A : modules Odoo, B : application web reliée à Odoo ») | A / B | **B est déjà tranchée de fait** (c'est le portail). À noter dans l'offre ; le lot 2 sera une interface (fichier d'import Odoo d'abord, connexion directe ensuite), jamais une réécriture du modèle. |

### 2.1 Indépendance : règle de copie et points de câblage inévitables

**Règle de copie (V1).** Ce qui est **métier** est **copié** dans des fichiers `cpt*` : le moteur de calcul (`encCalcul.ts` → `cptCalcul.ts`), la lecture de tableurs (`encImportLecture.ts` → `cptImportLecture.ts`), l'audit immuable, les séquences, les pièces jointes, l'index de recherche par mots. Un changement futur dans Encaissements ou la Trésorerie ne peut alors jamais modifier Gestion Compta, et inversement.
Ce qui est **infrastructure générique** est **utilisé tel quel, sans modification** : `getSession()` / `hasPermission()`, le client `prisma`, `notify`, `executerTache`, `avecSignature`, les composants `@/components/ui`, `InputMontant`, les bibliothèques SheetJS et ExcelJS.

**Points de câblage inévitables.** Un nouveau module ne peut pas exister sans être branché dans quelques fichiers partagés. Je les interprète comme permis par V1 à une condition : **ajouts seulement (nouvelles lignes), aucun comportement existant changé, non-régression prouvée** par le rejeu des tests et des scripts e2e existants. **Cette interprétation est à confirmer.**

| Fichier partagé | Ajout nécessaire | Pourquoi on ne peut pas l'éviter |
|---|---|---|
| `backend/prisma/schema.prisma` | Modèles `Cpt*`, valeurs d'enum de tâches planifiées, **champs de relation inverse sur `User`** | Les clés étrangères vers `User` imposent une relation inverse. Variante stricte : stocker l'identifiant sans clé étrangère (perd l'intégrité référentielle et le blocage de suppression de compte). **Recommandé : relations réelles.** |
| `backend/prisma/migrations/` et `seed.ts` | Nouvelles migrations (fichiers neufs) ; module, permissions et rôles dans le seed | Obligation du portail : toute permission du seed a sa migration |
| `components/layout/nav.ts`, `(dashboard)/layout.tsx`, `AppShell.tsx`, `Sidebar.tsx` | Branche de navigation « Gestion Compta » et ses drapeaux de visibilité | Le menu est codé par module |
| `(dashboard)/page.tsx` | Carte du module sur la page d'accueil | Les cartes sont codées par module |
| `reinitialisationClassification.ts` et `reinitialisation.ts` | Classement des tables `Cpt*` (conservées ou purgées) et purge correspondante | Un test échoue tant qu'un modèle n'est pas classé |
| `supprimerUtilisateurAction` | Comptage des nouvelles relations vers `User` | Sinon un compte utilisé pourrait être supprimé |
| `planificateur.ts`, `executer.ts` | Nouvelles tâches (relances, alertes d'ancienneté, rappel TCA) | Le planificateur est un registre unique |

**Évité** : les permissions `cpt.*` ne sont **pas délégables** sans rien changer (le module `compta` n'est simplement pas ajouté à `MODULES_DELEGABLES`, comme l'est déjà `encaissements`). Aucune table, permission, route ni fonction de Trésorerie, Pointage, Congés, FeedbackApp ou Encaissements n'est lue ni écrite par Gestion Compta.

---

## 3. Analyse d'écart avec l'existant

### 3.1 Ce que le portail apporte déjà : infrastructure utilisée telle quelle, métier dupliqué

| Besoin du cahier | Existant | Traitement (règle de copie, 2.1) |
|---|---|---|
| Comptes nominatifs, droits par rôle | `Role`, `Permission`, `RolePermission`, `getSession()`, `hasPermission()` | **Utilisé tel quel** ; nouvelles permissions `cpt.*` (avec migration) |
| Journal de toutes les opérations (qui, quand, avant, après) | `EncAudit` (immuable par trigger) | **Copié** : table `CptAudit`, immuable une fois le module en service |
| Séquences atomiques, références | `EncSequence` | **Copié** : `CptSequence` |
| Lecture de tableurs (`.xls`, `.xlsx`, `.csv`) | `encImportLecture.ts` + SheetJS CE 0.20.3 vendue | **Copié** dans `cptImportLecture.ts` ; la bibliothèque SheetJS est partagée ; **formats d'import paramétrables** à construire |
| Écriture Excel | ExcelJS | **Utilisé tel quel**, avec **mode flux** pour 100 000 lignes (code propre au module) |
| Prorata, exigibilité de la taxe, partage des accessoires, contre-passation | `encCalcul.ts` (moteur pur testé) | **Copié et étendu** dans `cptCalcul.ts`, avec ses propres tests |
| Recherche rapide par mots | `EncContratMot` (index btree, 4 ms à 150 000 contrats) | **Copié** : `CptContratMot` et équivalents pour clients et références |
| Tâches planifiées, notifications, rappels | `planificateur.ts`, `executerTache`, `notify` | **Utilisé tel quel** ; nouvelles tâches ajoutées (point de câblage) |
| Signatures, transaction unique action + signature | `avecSignature`, lot L / L bis | **Utilisé tel quel** sur les actions de D5 |
| Réinitialisation de mise en production | `reinitialisation.ts` + classement table par table | **Point de câblage** : chaque nouvelle table doit être classée |
| Mobile / tablette | `DataTable` bascule en cartes sous `md` | **Utilisé tel quel** ; écrans du commercial conçus mobile d'abord |
| PDF | `@react-pdf/renderer` | **Utilisé tel quel** ; modèles propres au module (relevé client, relevé partenaire) |
| Montants | `InputMontant`, `lireMontant` (lot M) | **Utilisé tel quel** |

### 3.2 Pourquoi un modèle propre : écarts avec le module Encaissements actuel (laissé intact)

| Sujet | Encaissements (V2.6) | Gestion (ce cahier) | Conséquence |
|---|---|---|---|
| Qui apporte la preuve du paiement | Le fichier de production déclare un paiement « à confirmer » ; la Finance le confirme | **« Le relevé fait foi »** (RG-01) ; le « payé » du bordereau n'est jamais une preuve | Le sens de la preuve s'inverse : l'encaissement vient du relevé, le contrat vient de la production, le **rattachement** les relie |
| Lien paiement ↔ contrat | Un paiement = une ligne d'encaissement d'un contrat | Table **Rattachement** (N encaissements ↔ N échéances, montant par ligne) | Nouveau modèle ; un paiement peut couvrir plusieurs contrats et l'inverse |
| Échéancier | Absent (une ligne par paiement du fichier) | **Échéancier par contrat** (mensuel, trimestriel, libre, avenants) | Nouvel objet central |
| Qui valide | Finance seule (`enc.confirmer_paiement`) | Production saisit, **Commercial identifie, RFCRH valide** | Trois profils, séparation des tâches plus fine |
| Créances, relances | Absentes | Fiche client, ancienneté, promesses, relances | Nouveau |
| TCA | Taxe figée par encaissement, exigibilité N+1 | Déclaration, quittances, imputation, crédits, état de déclaration par taux | Plus large |
| Clôture | Absente (« pas un outil comptable ») | Clôture mensuelle verrouillée, tâches, contrôles bloquants | Nouveau |
| Odoo | Hors périmètre | Champs dès le lot 1, exports, lot 2 d'écritures et de rapprochement | Nouveau |

Ces écarts confirment qu'il ne s'agit pas d'une simple extension : Gestion Compta a son **propre modèle** (relevé → encaissement → rattachement → échéance), sans lien de données avec Encaissements.

---

## 4. Architecture cible

### 4.1 Conventions du portail à respecter (toutes déjà en vigueur)

- **Monorepo** : logique pure et accès base dans `backend/src/cpt*.ts` ; pages, Server Actions et routes API dans
  `frontend/src/app/(dashboard)/compta/…`. Sens de dépendance `frontend → backend` uniquement. Les Client Components importent leurs valeurs
  depuis `backend/client`, jamais `backend`.
- **Moteurs purs d'abord** (sans base, sans `Date.now()` caché : l'horloge est un paramètre), testés par vitest, **puis** couche base, **puis** écrans.
  C'est la méthode qui a donné les lots J à M sans régression.
- **Permissions explicites** : chaque action a sa permission ; aucune garde ne déduit un acteur d'une combinaison de permissions.
  **Toute permission ajoutée au seed a sa migration.** Les permissions de décision sont **non délégables**.
- **Migrations** écrites à la main, additives, idempotentes quand c'est possible, horodatées **strictement après `20261030090000`**
  (vérifier avec `ls backend/prisma/migrations | tail -3` avant chaque création), `prisma migrate diff` vide.
- **Vocabulaire** : « Rejeter » partout (jamais refuser, refus, refusé dans un texte visible : un test le vérifie). Pour T4 du cahier
  (« saisie refusée »), l'écran dit « Saisie impossible : référence déjà utilisée ».
- **Historisation** : toute opération importante écrit une trace (qui, quand, avant, après) dans la même transaction.
- **Indépendance** : aucun import depuis `enc*`, `treso*`, `pointage*`, `conges*` ; aucun lien de données avec les tables des autres modules (sauf `User` et `Role`).
- **Un fichier de documentation par chantier** : `docs/compta-conception.md` (arbitrages datés, comme `encaissements-conception.md`),
  mis à jour **dans le même commit que le code**, et la section correspondante de `CLAUDE.md`.

### 4.2 Arborescence proposée

```
backend/src/
  cptCalcul.ts            # prorata, arrondi à la figeure, reliquat au soldant (étend encCalcul)
  cptTca.ts               # taux par branche et date d'effet, taxe contenue dans un TTC, imputation, état de déclaration
  cptEcheancier.ts        # création d'échéancier, affectation d'un paiement, statuts, ancienneté
  cptRattachement.ts      # 5 méthodes de proposition, niveaux de preuve, reste à rattacher
  cptRemuneration.ts      # dû / exigible / payable / payé / reste, par nature, fait générateur, prorata
  cptActes.ts             # avenant, retrait + ristourne, annulation, prime acquise / non acquise
  cptImportFormats.ts     # définitions de colonnes paramétrables (production, relevés, bordereaux)
  cptReleves.ts           # lecture relevés (Wave, banques, PeyaPay), références, remboursements, tests
  cptCreances.ts          # état par débiteur, tranches d'ancienneté, relances, promesses
  cptCloture.ts           # tâches du mois, contrôles bloquants, verrouillage
  cptAnomalies.ts         # règles de détection
  cptPermissions.ts       # clés et profils (source unique, vérifiée contre seed et migration par un test)
  cpt*Db.ts               # couche base : une transaction, verrous, audit
frontend/src/app/(dashboard)/compta/
  page.tsx                # accueil du module (cartes, compteurs de travail)
  production/ clients/ partenaires/ produits/ conventions/ comptes/
  encaissements/ rattachements/ a-identifier/ echeancier/ creances/
  tca/ remunerations/ bordereaux/ controle-hebdo/ anomalies/ cloture/ tableaux-de-bord/ exports/ parametres/
frontend/src/app/api/compta/…   # dépôt de fichiers, exports massifs en flux, téléchargements
```

---

## 5. Modèle de données

Toutes les tables portent le préfixe `Ges`. Montants `Decimal(14,2)`, taux en fraction `Decimal(7,6)`, dates en `DATE` pour les
faits comptables (jour de comptabilité) et `TIMESTAMP` pour les traces. Les tables marquées **(Odoo)** portent dès le lot 1 les champs de préparation du lot 2.

| Table | Champs principaux | Notes |
|---|---|---|
| `CptClient` | nom, téléphone, pièce d'identité, partenaire d'origine, **tiers Odoo (Odoo)** | Index de recherche par mots |
| `CptPartenaire` | nom, **rôles** (apporteur, bénéficiaire, gestionnaire, client), coordonnées, **tiers Odoo (Odoo)** | Une fiche unique par partenaire (6.5) |
| `CptProduit` | code, libellé, branche (accidents, santé, incendie, décès), tarif de référence, **compte Odoo (Odoo)** | Taux de TCA **hors** de cette table (historisé à part) |
| `CptTauxTca` | produit ou branche, nature de contrat (individuel/groupe), taux, **date d'effet** | Paramètre modifiable par le RFCRH, jamais modifié en place : nouvelle ligne datée. SECURPRO : taux lu au contrat |
| `CptContrat` | n° de police (unique), produit, individuel/groupe, client, partenaire apporteur, dates d'effet et d'échéance, statut, **contrat d'origine** (acte), taux de TCA lu au contrat si besoin | Jusqu'à 50 000 nouveaux contrats par an |
| `CptActe` | contrat, type (affaire nouvelle, renouvellement, tranche, avenant, retrait, ristourne, annulation), date, montants, lien vers l'acte d'origine | Chaque acte garde le lien vers le contrat d'origine (6.1) |
| `CptEcheance` | contrat, rang, période couverte, prime TTC, prime HT, accessoires, taxe, montant dû, statut (à venir, due, payée, partiellement payée, en retard, annulée) | Jusqu'à plusieurs millions de lignes sur 10 ans |
| `CptCompteEncaissement` | libellé, type (Wave Business, Wave hors business, banque, microfinance, agrégateur, caisse), **journal Odoo + compte (Odoo)** | Un compte par canal |
| `CptEncaissement` | compte, date, **référence unique**, montant, payeur, téléphone, statut (voir 7.2), motif si « pas une prime », reste à rattacher, **n° de pièce Odoo + date de comptabilisation (Odoo)**, relevé et ligne d'origine, flag `reprise` | Référence unique par compte ; 100 000 par an |
| `CptRattachement` | encaissement, échéance, **montant affecté**, méthode, niveau de preuve, **statut** (proposé, confirmé, validé, rejeté), proposé par, **confirmé par (commercial) + date + reçu**, **validé par (RFCRH) + date**, motif de rejet, justification, flag `reprise` | Contraintes : Σ par encaissement ≤ montant (RG-04) ; Σ par échéance ≤ montant dû |
| `CptTransfertInterne` | encaissement sortant, encaissement entrant, compte source, compte cible | Jamais compté deux fois comme encaissement |
| `CptCheque` | encaissement, date de réception, n° de chèque, tireur, date de remise en banque, statut | Suivi réception → remise → encaissement banque |
| `CptDeclarationTca` | mois, montant déclaré, statut, **quittance** (n°, date, montant, période, **pièce Odoo (Odoo)**), date de paiement | Une ligne déclarée est verrouillée |
| `CptLigneTaxe` | encaissement ou échéance, base, taux, montant, **mois de déclaration**, imputée sur (échéance) | Jamais payée deux fois (RG-05) |
| `CptCreditTaxe` | origine (payé en trop, correction de taux), montant, statut (à récupérer, récupéré) | Crédits suivis à part (6.4) |
| `CptConvention` | partenaire, produit, **nature** (commission, accessoires reversés, honoraires), taux, base (prime nette, nette + accessoires, TTC), **fait générateur** (émission ou encaissement), selon l'apporteur du contrat, **mode de règlement** (en une fois / au prorata des encaissements), date d'effet | La convention signée prime |
| `CptLigneRemuneration` | contrat (et échéance), partenaire bénéficiaire, nature, dû, exigible, payé, reste, part « sur primes encaissées » / « non encaissées » | Calculée, figée par ligne |
| `CptReglementPartenaire` | partenaire, **nature obligatoire**, montant, date, mode, référence, **pièce Odoo (Odoo)**, affectations | Affecté aux montants exigibles les plus anciens |
| `CptCompensation` | partenaire, natures concernées, montant, motif, validée par | Seule voie de compensation entre natures (jamais automatique) |
| `CptBordereauPartenaire` + `CptBordereauLigne` | partenaire, import, lignes, résultat de comparaison avec la production | Contrats « à saisir », écarts à justifier |
| `CptPeriode` | mois, statut (ouverte, clôturée), clôturée par / le | Verrou (RG-08) |
| `CptTacheCloture` | période, libellé, état, bloquante ou non | Liste des tâches du mois |
| `CptPrimeAcquise` | période, contrat, prime acquise, prime non acquise (à reporter) | Photo à la clôture |
| `CptRelance` + `CptPromesse` | débiteur, échéances, canal, date, résultat, date promise | Suivi manuel au lot 1 (D6) |
| `CptAnomalie` | type, objet concerné, statut (à traiter, traitée), traitée par / le, résolution | Détection permanente |
| `CptImport`, `CptFormatImport` | fichier, type, empreinte (anti-doublon d'import), résultat ; définition des colonnes | Formats paramétrables (exigence 8) |
| `CptAudit`, `CptSequence`, `CptPieceJointe`, `CptMiseEnService`, `CptParametre` | patrons d'`Enc*` | Audit immuable après mise en service |

**Index et volumétrie** (100 000 encaissements et 50 000 contrats par an, **au moins 10 ans**, soit ~1 million d'encaissements,
~500 000 contrats et plusieurs millions d'échéances) : index sur `CptEncaissement(compte, référence)` (unique),
`(statut, date)`, `CptEcheance(contrat, rang)`, `(statut, datePrévue)`, `CptRattachement(encaissement)` et `(échéance)`,
mots de recherche en collation « C ». **Pagination côté serveur obligatoire** sur toutes les listes. Mesurer chaque requête
critique avec `EXPLAIN` sur des données synthétiques (méthode des mesures D38 d'Encaissements). Partitionnement : non prévu,
à réévaluer si les mesures à 10 ans l'exigent.

---

## 6. Profils, rôles et permissions (proposition)

### 6.1 Rôles de départ

| Rôle du portail | Profil du cahier | Remarque |
|---|---|---|
| Compta — Production | Service technique (actuaire, études techniques) | Importe et corrige les contrats |
| Compta — Commercial | Responsable commercial et 3 managers | Écrans mobiles ; identifie, ne saisit pas de contrat |
| Compta — RFCRH | RFCRH | Valide, déclare la TCA, règle, clôture, paramètre ; **rôle combiné** avec Finance et RH si nécessaire (D3) |
| Compta — Comptable | Stagiaire comptable | Importe les relevés, prépare listes et écritures ; ne valide pas, ne paramètre pas |
| Compta — Direction | Directeur général | Consulte tout, tranche les litiges, ne saisit rien |

### 6.2 Permissions proposées

| Permission | Production | Commercial | RFCRH | Comptable | Direction |
|---|:-:|:-:|:-:|:-:|:-:|
| `cpt.consulter` (lecture, exports) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `cpt.importer_production` | ✓ | | | ✓ | |
| `cpt.saisir_contrat` (saisie, correction des contrats signalés) | ✓ | | | | |
| `cpt.importer_releves` | | | | ✓ | |
| `cpt.identifier_encaissement` (produit, client, partenaire, contrat existant ou non) | | ✓ | ✓ | | |
| `cpt.confirmer_rattachement` (**étape 1** : déduction, probable, identification manuelle, avec le reçu : RG-06) | | ✓ | | | |
| `cpt.valider_rattachement` (**étape 2** : tous les rattachements : RG-02) | | | ✓ | | |
| `cpt.classer_pas_une_prime` (motif obligatoire) | | | ✓ | | |
| `cpt.declarer_tca` · `cpt.payer_tca` | | | ✓ | | |
| `cpt.regler_partenaire` · `cpt.compenser` | | | ✓ | | |
| `cpt.gerer_conventions` · `cpt.parametrer` (taux, formats, comptes) | | | ✓ | | |
| `cpt.preparer_ecritures` (exports Odoo, liste des non comptabilisés) | | | ✓ | ✓ | |
| `cpt.relancer` (relances, promesses) | ✓ | ✓ | ✓ | | |
| `cpt.cloturer_periode` | | | ✓ | | |
| `cpt.trancher_litige` | | | | | ✓ |
| `cpt.mettre_en_service` (module technique, DG seul, comme `enc.mettre_en_service`) | | | | | ✓ |

- **Non délégables** : `cpt.valider_rattachement`, `cpt.declarer_tca`, `cpt.payer_tca`, `cpt.regler_partenaire`, `cpt.compenser`,
  `cpt.cloturer_periode`, `cpt.trancher_litige` (même logique que `PERMISSIONS_DECISION_NON_DELEGABLES`).
- **Séparation des tâches** à coder côté serveur, pas seulement à l'écran : la personne qui **confirme** un rattachement
  (Commercial) n'est pas celle qui le **valide** (RFCRH). Le RFCRH ne porte **pas** `cpt.confirmer_rattachement` : il ne peut donc
  pas sauter l'étape 1 quand elle est requise (voir 7.2 et la question Q3 bis).
- Chaque action a un bouton **grisé avec la raison** (convention du portail) plutôt que masqué.
- La migration des permissions suit le patron `20261006100000` (attribution par permission « sœur », jamais par nom de rôle).

---

## 7. Règles métier à coder (moteurs purs)

### 7.1 Taxe sur les contrats (TCA) — section 6.4 du cahier

| Branche | Taux | Taxe contenue dans 2 500 FCFA | Vérification (arithmétique contrôlée) |
|---|---|---|---|
| Accidents (RELAX…, INDIVIDUELLE CONDUCTEUR) | 7,25 % | 169 | 2 500 × 7,25 ÷ 107,25 = 169,0 |
| Santé, contrat groupe | 1,5 % | 37 | 36,95 arrondi |
| Santé, contrat individuel ; COUPS DURS | 4 % | 96 | 96,15 arrondi |
| Incendie | 12,5 % (SECURPRO : taux lu au contrat) | 278 | 277,8 arrondi |
| Décès | 0 % | 0 | — |

- Cas de calcul : rattaché (taxe du contrat au prorata) ; sans contrat, produit connu (`montant × taux ÷ (1 + taux)`) ; contrat
  existant pas encore rattaché (même calcul, imputé au rattachement) ; non identifié (aucune taxe) ; pas une prime (aucune taxe).
- **Jamais payée deux fois** : une ligne de taxe porte son mois de déclaration et est **verrouillée** une fois déclarée ; au
  rattachement d'un encaissement déjà taxé, la taxe déjà payée s'impute sur la taxe du contrat.
- Calcul du mois = taxe due sur tout l'encaissé depuis le début − taxe déjà payée (quittances) − corrections validées ; trop-payé
  reporté. **État de déclaration par taux** (primes et accessoires hors taxe, primes remboursées, base, taux, impôt). Crédits suivis à part.
- Taux à **date d'effet** (nouvelle ligne datée, jamais de modification en place). Exigible à l'encaissement, payable avant le 20 du mois suivant (rappel planifié).
- Suivi par contrat et par mois : émise, exigible, déclarée, payée, payée d'avance et imputée.

### 7.2 Rattachement — section 6.2 du cahier

Propositions dans cet ordre (le moteur ne rattache **jamais** automatiquement ; tout rattachement finit par la **validation du RFCRH**) :

| Ordre | Méthode | Règle | Niveau de preuve |
|---|---|---|---|
| 1 | Référence exacte | référence du contrat = référence de l'encaissement | Preuve |
| 2 | Référence incomplète | 12 premiers caractères identiques et même montant | Preuve, référence à corriger |
| 3 | Montant et date | même montant à 1 FCFA près, encaissement entre 3 jours avant et 5 jours après la date déclarée, un encaissement pour un contrat | Déduction |
| 4 | Groupe | plusieurs contrats d'un même partenaire le même jour dont la somme = un encaissement | Déduction |
| 5 | Probable | même nom, ou montant à ±2 % sur ±45 jours | À confirmer avec le reçu |

**Validation en deux étapes (décision V3).**

| Étape | Qui | Quand elle est requise | Ce qui est enregistré |
|---|---|---|---|
| **1. Confirmation** | Commercial (`cpt.confirmer_rattachement`) | Propositions de niveau **Déduction** (méthodes 3 et 4) et **Probable** (méthode 5), et **toute identification manuelle** | Qui, quand, **le reçu** (pièce jointe ou référence du reçu, obligatoire) et un commentaire |
| **2. Validation** | RFCRH (`cpt.valider_rattachement`) | **Tous** les rattachements, y compris ceux de niveau **Preuve** (méthodes 1 et 2), qui n'ont pas d'étape 1 | Qui, quand ; signature (D5) |

- États d'un rattachement : **Proposé** → **Confirmé** (seulement si l'étape 1 est requise) → **Validé** ; ou **Rejeté** à tout moment par le RFCRH, avec motif, ce qui renvoie le dossier au commercial.
- **Impossible de valider** un rattachement dont l'étape 1 est requise et non faite : le bouton est grisé avec la raison, et le serveur rejette l'appel direct.
- Seul un rattachement **Validé** rend la prime payée (RG-01) ; un rattachement Proposé ou Confirmé n'a aucun effet sur le reste dû, la taxe ni les rémunérations.
- Le commercial qui confirme ne peut pas valider (permission distincte, non cumulée sur son rôle) ; deux validations simultanées : une seule passe (verrou).

Statuts d'un encaissement : **Rattaché**, **Contrat trouvé à rattacher**, **Identifié à rattacher**, **À identifier**, **Pas une prime**
(motif obligatoire). Un surplus (4 500 reçus pour 2 500 dus) reste visible comme **reste à rattacher**. Chaque identification enregistre
qui l'a faite (commercial, RFCRH, déduction automatique) et sa justification.

### 7.3 Échéancier — section 6.2 bis

Création à la saisie du contrat (comptant, mensuel, trimestriel, semestriel, libre) ; modification par avenant avec historique ;
affectation d'un paiement à l'échéance la plus ancienne non soldée (ou au choix du RFCRH) ; paiement partiel = échéance ouverte
pour le reste ; surplus = échéance suivante ou reste à rattacher (jamais perdu) ; statuts à venir / due / payée / partiellement
payée / en retard (nombre de jours) / annulée ; **aide au rattachement** par montant (échéance, solde ou fraction de prime) et nom.

### 7.4 Rémunération des partenaires — section 6.5

- Quatre soldes séparés par partenaire : commission, accessoires reversés, honoraires de gestion, créance. **Aucune compensation automatique.**
- Pour chaque ligne : dû, exigible, **payable aujourd'hui** (= dû × part de la prime encaissée si règlement au prorata), payé, reste payable, reste dû, avance.
- **Honoraires de gestion** : exigibles dès l'émission pour les contrats apportés par SIM ou un autre apporteur ; après encaissement, au prorata, pour ceux
  apportés par le gestionnaire (NOVELIA). Le fait générateur est un **paramètre de la convention** (partenaire, produit, nature, apporteur).
  Toujours distinguer « sur primes encaissées » et « sur primes non encaissées » (avec reste dû du client et ancienneté) ; signaler pour régularisation
  les honoraires d'une prime finalement jamais encaissée.
- Bénéficiaire ≠ apporteur possible ; la convention signée prime, avec **alerte** si le taux appliqué par le technique diffère.
- Choix « en une fois / au prorata » modifiable par décision du RFCRH sur un contrat ou un règlement, avec motif.

### 7.5 Créances et ancienneté — section 6.3

Tranches 0–30, 31–90, 91–180, plus de 180 jours, **calculées depuis la date prévue de la plus ancienne échéance impayée** (pas la date de saisie) ;
une échéance non encore arrivée n'est pas une dette en retard ; taxe non exigible sur le reste dû ; un débiteur peut être un client direct ou un partenaire qui paie pour ses clients.

### 7.6 Actes, prime acquise, clôture — sections 6.1 et 6.8

- Actes : avenant d'incorporation, **retrait d'assurés avec ristourne** (jours non courus × taux de ristourne), annulation, tous liés au contrat d'origine.
- **Prime acquise / non acquise** à la clôture (à reporter sur la période suivante) : la méthode exacte n'est pas dans le cahier (Q8).
- Clôture : tâches du mois avec état, **contrôles bloquants**, verrouillage (RG-08), historique ; corrections sur la période ouverte avec motif.

---

## 8. Plan de développement par lots

Convention de nommage : **GC-n** (Gestion Compta), pour ne pas se confondre avec les lots A à Q de la Trésorerie. Chaque lot se termine par les
mêmes critères (section 10). Les estimations sont des **ordres de grandeur en semaines de travail**, à recaler après GC-0 ; la colonne « Phase du cahier »
donne le rapprochement avec le planning indicatif du prestataire.

| Lot | Contenu | Phase du cahier | Estimation |
|---|---|---|---|
| **GC-0** | Cadrage et arbitrages | 1 (2 sem.) | 1,5 – 2 |
| **GC-1** | Socle du module | 2 | 1,5 – 2 |
| **GC-2** | Référentiels | 2 | 2 |
| **GC-3** | Production, actes, échéancier | 2 | 3 – 4 |
| **GC-4** | Comptes et import des relevés | 2 | 3 |
| **GC-5** | Rattachement et identification | 2 | 3 – 4 |
| **GC-6** | Contrôle hebdomadaire | 2 | 1 |
| **GC-7** | Clients et créances | 3 | 2 – 3 |
| **GC-8** | Taxe sur les contrats (TCA) | 3 | 3 |
| **GC-9** | Rémunération des partenaires | 4 (5 sem.) | 4 – 5 |
| **GC-10** | Anomalies, clôture, tableaux de bord, exports | 5 | 3 – 4 |
| **GC-11** | Reprise des données, recette, formation, mise en service | 5 | 3 – 4 |
| **GC-12** | Lot 2 : comptabilité Odoo | Lot 2 (4–6 sem.) | à chiffrer à part |
| | **Total lot 1** | **21 sem. dans le cahier** | **≈ 27 – 34** |

### GC-0 — Cadrage et arbitrages

- Obtenir les réponses aux questions de la section 11 (au minimum Q4 et Q5, qui bloquent le modèle).
- Confirmer D3 à D8 (section 2) et consigner D1 à D8 avec V1 à V3 dans `docs/compta-conception.md` avec la date.
- Écrire la **conception détaillée** : modèle de données définitif (section 5 ajustée), permissions (6), règles de calcul (7), découpage en commits.
- **Maquettes** des écrans clés (liste des rattachements, écran mobile du commercial, fiche client, état de déclaration TCA, tableau de clôture).
- Dresser l'**inventaire de duplication** (V1) : liste exacte des fichiers `enc*` à **copier** en `cpt*` (calcul, lecture de tableurs, audit, séquences, pièces jointes, recherche par mots), et la liste des **points de câblage** de la section 2.1 à faire valider ; rien n'est importé ni modifié dans l'existant.
- Collecter les **échantillons anonymisés** (relevés Wave, BNI, PeyaPay, bordereaux de partenaires) dans un dossier **hors du dépôt**.
- *Sortie* : documents validés par le RFCRH ; aucun code applicatif.

**Avancement GC-0 (2026-10-22) : livrables rédigés, validation du RFCRH en attente.**
- Conception détaillée : [compta-conception.md](compta-conception.md) (arbitrages datés, registre des règles provisoires C-1 à C-14, inventaire de duplication, 11 points de câblage vérifiés dans le code, permissions, modèle de données définitif, règles de calcul, découpage en commits, branchement du lot 2).
- Maquettes de 7 écrans : [maquettes-compta.html](maquettes-compta.html).
- Questions prêtes à envoyer : [compta-questions-rfcrh.md](compta-questions-rfcrh.md).
- **Reste à faire pour clore GC-0** : réponses de Q4 et Q5 ; accord sur l'interprétation des points de câblage (section 2.1) et sur D3 à D6 ; collecte des échantillons anonymisés hors dépôt.

### GC-1 — Socle du module

- Module `compta` (Module + permissions `cpt.*` en migration **et** seed, test de synchronisation comme `congesPermissions.test.ts`), rôles de départ, carte sur `/`, branche de navigation, garde de layout.
- `CptAudit` immuable (trigger posé à la mise en service), `CptSequence`, `CptPieceJointe`, `CptParametre`, `CptMiseEnService`, `CptPeriode`.
- Étendre `reinitialisationClassification.ts` (chaque table classée : référentiels et configuration **conservés**, données de production **purgées**) et `supprimerUtilisateurAction` (nouvelles relations vers `User`).
- Cadre des **formats d'import paramétrables** (`CptFormatImport`) et des **exports en flux**.
- Extension de l'énumération des tâches planifiées (`ALTER TYPE "TacheNom" ADD VALUE …`, comme pour `RAPPELS_CONGES`).
- *Tests* : permissions et rôles, audit non modifiable, classement de reset, e2e d'accès par rôle (base jetable).

### GC-2 — Référentiels

- Écrans : clients, partenaires (rôles multiples), produits (branche, tarif), **taux de TCA datés**, comptes d'encaissement, **conventions** (nature, base, fait générateur, apporteur, mode de règlement, date d'effet), correspondances Odoo (compte, tiers, journal).
- Contrôles : partenaire et produit inconnus signalés à l'import ; une seule convention en vigueur par partenaire × produit × nature à une date.
- Recherche rapide (index de mots).
- *Tests* : historique de taux (nouvelle ligne datée, ancienne intacte), chevauchement de conventions, droits.

### GC-3 — Production, actes, échéancier

- **Import du bordereau de production** (colonnes du paragraphe 4.1 du cahier : PaiementID, NumPolice, TypeDeContrat, produit, TypeOpération, client, partenaire, dates, mode et référence déclarés, prime TTC / HT / accessoires / taxe, commission, gestion, montants déclarés), format **paramétrable**.
- **Comparaison avec l'import précédent** : lignes nouvelles, modifiées, supprimées ; **lignes saisies après une clôture avec une date antérieure** signalées.
- **Contrôles à la saisie** (6.1) : référence obligatoire pour un contrat déclaré payé ; une référence = un contrat (sauf paiement groupé déclaré) ; montant ≠ tarif ; mode incohérent avec la référence (cas T2 : Wave saisi comme chèque) ; doublons ; partenaire ou produit inconnu ; dates manquantes ; **prime offerte signalée**.
- **Actes** : affaire nouvelle, renouvellement, tranche, avenant d'incorporation, retrait avec ristourne, annulation, avec lien vers le contrat d'origine.
- **Échéancier** : création à la saisie (comptant, mensuel, trimestriel, semestriel, libre), modification par avenant avec historique, statuts.
- **Vue de la production** par branche, produit, partenaire et période (nombre de contrats, prime HT, accessoires, taxe, TTC).
- *Tests* : T2, T3 (partie échéancier), T12 (échéancier de 12 lignes, 506 486 × 12 = 6 077 832), retrait avec ristourne ; **performance** : import de 10 000 lignes.

### GC-4 — Comptes et import des relevés

- Lecture des relevés : **Wave Business** (horodatage, identifiant `T_…`, type merchant_payment / api_checkout / refund, brut, frais, net, contrepartie, session `cos-…`, référence client), **Wave hors business**, **banques et microfinances** (date, libellé, référence, montant), **PeyaPay** (`API-PEYAPAY-…`), **chèques et espèces** (saisie : date de réception, n°, tireur, montant, remise en banque).
- **Référence unique** : un relevé importé deux fois ne crée aucun doublon (empreinte du fichier **et** référence par compte) ; **remboursements et transactions test reconnus**.
- **Virements internes** (Wave → BNI…) reconnus et rapprochés ; **contrôle par compte et par mois : crédits du relevé = primes + virements internes reçus + autres crédits**.
- Chèques : réception → remise en banque ; espèces : reçu de caisse.
- *Tests* : T9 (relevé importé deux fois, virement Wave → BNI) ; T1 (partie « pas une prime ») ; **performance : 10 000 lignes + rapprochement en moins de 2 minutes**.

### GC-5 — Rattachement et identification

- Moteur des **5 méthodes** (7.2), propositions classées par niveau de preuve ; **étape 1 : confirmation du commercial avec le reçu** (niveaux Déduction et Probable, identifications manuelles) ; **étape 2 : validation du RFCRH** ligne par ligne et par lot (jamais automatique, RG-02).
- Écran de **rattachement** (un encaissement ↔ plusieurs échéances, et l'inverse, montant par ligne) ; **reste à rattacher** toujours visible.
- **Écran mobile du commercial** : liste « encaissements sans contrat » avec le numéro du payeur, identification (produit, client, partenaire, contrat existant ou non), justification enregistrée ; production alertée seulement si le contrat n'existe pas.
- **« Pas une prime »** avec motif écrit obligatoire (RG-03).
- **Aide au rattachement** sans référence : propose les contrats dont une échéance en cours correspond au montant et au nom (T13).
- Signature des validations (D5) ; la confirmation du commercial est tracée (audit, reçu joint) mais **sans signature** pour ne pas imposer l'enrôlement aux managers ; historique de chaque proposition, confirmation, validation et rejet.
- *Tests* : T1, T2, T3, T4 (référence déjà utilisée : saisie impossible), T13 ; rejet serveur par appel direct (valider sans confirmation requise ; confirmer sans la permission ; RFCRH qui tente de confirmer) ; deux validations simultanées (une seule passe) ; rejet renvoyé au commercial.

### GC-6 — Contrôle hebdomadaire

- Le lundi : deux listes de travail issues du rapprochement — **encaissements sans contrat** (vers le commercial) et **contrats déclarés payés sans encaissement** (vers la production).
- **Relance automatique à 7 jours, alerte à 30 jours, escalade à 60 jours** (tâche planifiée + notifications du portail).
- Indicateurs de la semaine : encaissements sans contrat (+ de 7 et + de 30 jours), contrats sans encaissement, taxe payée d'avance non encore imputée, écart technique / réel depuis le début de l'année.
- *Tests* : planificateur à horloge simulée (7, 30, 60 jours), idempotence (pas de double relance).

### GC-7 — Clients et créances

- **Fiche client** : identité, téléphone, partenaire, contrats, échéances, tous les paiements (canal, référence, date, montant), retards, sommes qui ne sont pas des primes, relances et échanges.
- **État des créances par débiteur** : prime émise, encaissé prouvé, **déclaré payé par le technique mais non prouvé**, reste dû, date depuis laquelle la dette est due, ancienneté (4 tranches) ; détail contrat par contrat.
- **Relevé imprimable** (PDF) ; relances programmées ; **promesses de paiement** suivies ; liste des échéances dues dans les 7 jours et en retard (par client, partenaire, commercial).
- **Prévision d'encaissements** par semaine et par mois, comparée au réel.
- *Tests* : T7 (3 échéances, la plus ancienne à 120 jours → tranche 91–180), T12 (août en retard, reste dû 5 064 860).

### GC-8 — Taxe sur les contrats (TCA)

- Moteur 7.1 (taux datés, taxe contenue, prorata, imputation de la taxe déjà payée) ; `CptLigneTaxe`, `CptDeclarationTca`, quittances, `CptCreditTaxe`.
- Écran **calcul du mois** (taxe due depuis le début − payée − corrections = à payer, report du trop-payé) ; **état de déclaration par taux** à reporter sur le formulaire de l'administration ; verrouillage des lignes déclarées.
- Suivi par contrat et par mois (émise, exigible, déclarée, payée, payée d'avance et imputée) ; rappel avant le 20.
- Préparation Odoo : comptes 4352 (non exigible) et 4351 (exigible), champ pièce sur la quittance.
- *Tests* : T1 (taxe sur 2 500 seulement), T3 (1,5 %), **T5 (1 500 → taxe 101, non redemandée au rattachement)**, tableau des cinq taux, report d'un trop-payé.

### GC-9 — Rémunération des partenaires

- Calcul **contrat par contrat** (moteur 7.4) pour les quatre soldes ; honoraires scindés **encaissés / non encaissés** ; règlement **en une fois ou au prorata** ; alerte d'écart de taux face à la convention.
- **Bordereaux des partenaires** : import (formats variables), comparaison avec la production et avec le calcul de l'application, contrats manquants des deux côtés, écarts à justifier.
- **Règlements** (nature obligatoire, mode, référence, pièce Odoo, affectation aux montants exigibles les plus anciens) ; **relevé par partenaire et par nature** ; compensation explicite validée.
- Signature des règlements et compensations (D5).
- *Tests* : T6, **T6 ter** (commission 12 000 sur 120 000 en 12 mensualités : payable 3 000 après 3 mensualités, reste payable 0 et reste dû 9 000 après règlement), **T6 bis** (NOVELIA), T8 (5 contrats absents de la production : « à saisir », pas de commission).

### GC-10 — Anomalies, clôture, tableaux de bord, exports

- **Anomalies** détectées en permanence : référence utilisée plusieurs fois, contrat déclaré payé sans encaissement, encaissement sans contrat, montant hors tarif, double comptage possible entre comptes, partenaire ou produit inconnu (écarts avec Odoo au lot 2).
- **Clôture mensuelle** : liste des tâches avec état, contrôles bloquants, **verrouillage de la période**, historique des clôtures ; correction sur période ouverte avec motif (RG-08) ; **photo prime acquise / non acquise**.
- **Tableaux de bord** : encaissé par canal, par partenaire et en vente directe ; rattaché / sans contrat ; créances par ancienneté ; taxe ; dû aux partenaires par nature ; écart production / encaissé ; indicateurs par commercial et pour la production. Graphiques SVG tracés à la main (pas de `<title>` SVG : piège d'hydratation React 19 déjà documenté).
- **Exports Excel de toute liste et de tout état**, avec les filtres appliqués ; **mode flux** (ExcelJS streaming) et **CSV** au-delà du plafond Excel ; **100 000 lignes en moins d'une minute**.
- **Préparation Odoo** : exports au format d'import Odoo (encaissements par compte avec **compte d'attente** pour les sommes non rattachées, taxe émise 4352 / exigible 4351 / payée, production par branche, rémunérations dues et réglées) ; **liste des encaissements, règlements et quittances sans n° de pièce Odoo**.
- *Tests* : T11 (export de 100 000 encaissements filtrés), clôture bloquée par un contrôle, période verrouillée (modification impossible).

### GC-11 — Reprise des données, recette, formation, mise en service

- **Reprise depuis 2025** : bordereaux de production, relevés Wave et bancaires, quittances de TCA, partenaires et conventions, règlements aux partenaires, rattachements déjà validés. Les **rattachements anciens faits sans information précise sur décision du RFCRH sont repris tels quels et marqués comme tels** (`reprise`, jamais corrigés). Scripts en **simulation par défaut**, `--appliquer` explicite, idempotents (modèle `rattrapage-production.ts`).
- **Recette** : les 14 cas T1 à T13 (section 9) sur base jetable, plus les mesures de performance (section 10).
- **Formation** des cinq profils, documentation utilisateur et technique, procédure de **sauvegarde quotidienne, conservation 10 ans et restauration testée**.
- **Mise en service** : procédure du runbook existant (`docs/mise-en-production.md`) étendue : vérification avant mise en service (rôles, comptes de test neutralisés, signatures enrôlées, taux de TCA en vigueur, correspondances Odoo), purge des données de test, mise en service du module (audit immuable).

### GC-12 — Lot 2 : comptabilité Odoo (sur décision de SIM)

À chiffrer à part (4 à 6 semaines dans le cahier). **Condition de départ** : le modèle du lot 1 ne bouge pas (champs Odoo déjà en place).
Contenu : génération des écritures (fichier d'import Odoo d'abord, connexion directe ensuite) ; **lettrage** paiement ↔ pièce Odoo avec proposition automatique ;
écritures Odoo sans paiement correspondant et inversement ; **rapprochement application / Odoo** par rubrique (production par branche, encaissements, taxe, rémunérations, créances), par compte et par tiers, pour la période et en cumul ;
écarts à justifier avec commentaire ; **contrôle de clôture avec Odoo** (T10 : clôture impossible tant qu'un écart n'est pas justifié ; RG-09).
**Décrire dans l'offre comment le lot 2 se branche sur le lot 1** (exigence du cahier) : le plan de branchement est un livrable de GC-0.

---

## 9. Cas de recette (T1 à T13) → lot et type de test

| Cas | Situation (résumé) | Lot | Test |
|---|---|---|---|
| T1 | RELAXMOTO 2 500 par mois, 4 500 payés dont 2 000 de frais de carte santé | GC-4, GC-5, GC-8 | Moteur + e2e : 2 500 rattachés, 2 000 « pas une prime », taxe sur 2 500 |
| T2 | Contrat payé par Wave en 2 fois, saisi comme chèque | GC-3, GC-5 | Contrôle de saisie (mode incohérent) + rattachement des 2 paiements |
| T3 | Groupe santé 250 000 en échéances de 50 000 | GC-3, GC-5, GC-8 | Reste dû 200 000 après le 1er paiement, taxe 1,5 % |
| T4 | Référence Wave déjà utilisée sur un 2ᵉ contrat | GC-3, GC-5 | Saisie impossible ou alerte bloquante |
| T5 | 1 500 sans contrat, INDIVIDUELLE CONDUCTEUR | GC-8 | Taxe 101 dans le mois, non redemandée au rattachement |
| T6 | Courtier (commissions) et gestionnaire santé (honoraires) | GC-9 | Deux soldes distincts, aucun effet croisé |
| T6 ter | 120 000 en 12 mensualités, commission 12 000 au prorata | GC-9 | Payable 3 000, puis reste payable 0 et reste dû 9 000 |
| T6 bis | Deux contrats santé gérés par NOVELIA, non encaissés | GC-9 | Honoraires exigibles sur le contrat SIM (colonne « non encaissées »), rien sur le contrat NOVELIA ; bascule à l'encaissement |
| T7 | Client avec 3 échéances dont une à 120 jours | GC-7 | Tranche 91–180, relevé imprimable, relance proposée |
| T8 | Bordereau partenaire avec 5 contrats absents de la production | GC-9 | « À saisir », aucune commission |
| T9 | Relevé importé deux fois ; virement Wave → BNI | GC-4 | Aucun doublon, transfert interne |
| T10 (lot 2) | Clôture avec écart application / Odoo non justifié | GC-12 | Clôture impossible |
| T11 | Export de 100 000 encaissements filtrés | GC-10 | Moins d'une minute, mêmes filtres |
| T12 | Groupe 6 077 832 en 12 × 506 486, 2 payées | GC-3, GC-7 | 12 échéances, août en retard, reste dû 5 064 860, relance |
| T13 | 150 000 sans référence, contrat groupe 250 000 ayant reçu 100 000 | GC-5 | Contrat proposé (montant = solde exact), échéance soldée |

*Contrôle d'arithmétique fait sur le texte du cahier : les exemples chiffrés (169, 37, 96, 278, 101 ; 506 486 × 12 ; 1 980 + 351 + 169 = 2 500 ; 12 000 ÷ 12 × 3 = 3 000) sont tous cohérents.*

---

## 10. Exigences transverses et critères de sortie d'un lot

### 10.1 Exigences techniques du cahier → mesures

| Exigence | Mesure retenue |
|---|---|
| Navigateur web, **écrans adaptés au téléphone pour les commerciaux** | Écrans du commercial conçus mobile d'abord ; tests Playwright à 390 px (sans défilement horizontal) ; **corriger aussi les tableaux larges sous 768 px** (dette déjà notée pour Encaissements) |
| Français, FCFA sans décimales, dates jj/mm/aaaa | Libellés et formats centralisés ; `InputMontant` ; dates formatées côté serveur (fuseau Africa/Abidjan) |
| 100 000 encaissements et 50 000 contrats par an, 10 ans | Index (section 5), pagination serveur, `EXPLAIN` sur données synthétiques à 10 ans |
| Import de 10 000 lignes + rapprochement < 2 min | Insertions par lots (`createMany`), rapprochement en mémoire sur index, mesuré sur PostgreSQL 16 jetable |
| Export de 100 000 lignes < 1 min | ExcelJS en flux, CSV au-delà |
| Sécurité : comptes nominatifs, droits par rôle, **journal de toutes les opérations et des connexions** | Permissions explicites, `CptAudit`, journal de connexion existant (`logAuditAction`) ; **2FA** : absente du portail, à traiter au niveau du portail avant la production (déjà notée dans Encaissements) |
| Sauvegarde quotidienne, conservation 10 ans, restauration testée | Procédure documentée (Dokploy / PostgreSQL) et **test de restauration** réalisé avant la mise en service ; les fichiers de `uploads/` et les tables binaires (signatures) incluses |
| Imports paramétrables | `CptFormatImport` (GC-1), utilisé par production, relevés et bordereaux |
| Intégration Odoo : exports (lot 1), interface (lot 2) sans changer le modèle | Champs Odoo dès GC-1/GC-2 ; exports GC-10 ; GC-12 |

### 10.2 Définition de « terminé » pour chaque lot

1. `tsc` (backend et frontend), `eslint`, `vitest`, `next build` sans erreur.
2. Migration testée **depuis zéro** sur une base PostgreSQL 16 jetable, rejouée sans effet, `prisma migrate diff` vide.
3. Moteurs purs couverts par des tests d'exemples chiffrés du cahier ; couche base testée avec concurrence quand elle existe (verrous).
4. **Refus serveur prouvés par rejeu direct de la Server Action** pour chaque permission (pas seulement bouton grisé).
5. Script e2e Playwright sur base jetable (`e2e/compta-gcN.mjs`), régressions des lots précédents relancées.
6. `docs/compta-conception.md` et la section de `CLAUDE.md` mises à jour **dans le même commit**.
7. Classement de réinitialisation à jour (le test échoue sinon) ; relations vers `User` comptées dans la suppression de compte.

---

## 11. Questions à poser au client / au RFCRH

Les questions **Q4 et Q5 bloquent GC-0** (Q1, Q2 et Q3 sont tranchées par V1 à V3) ; les autres peuvent être posées au fil des lots mais avant celui qui les concerne.

| # | Question | Bloque |
|---|---|---|
| ~~Q1~~ | *Tranchée (V1) : Gestion Compta est un module indépendant ; Encaissements n'est ni remplacé ni modifié.* | — |
| ~~Q2~~ | *Tranchée (V2) : le module s'appelle « Gestion Compta ».* | — |
| ~~Q3~~ | *Tranchée (V3) : deux étapes, confirmation du commercial puis validation du RFCRH (7.2).* | — |
| **Q3 bis** | Si le commercial est absent, le RFCRH peut-il **saisir lui-même la confirmation** (exception tracée, avec motif) ou le dossier attend-il ? **Défaut proposé : il attend** (le RFCRH ne porte pas la permission de confirmer). Le commercial qui confirme doit-il être celui du partenaire du contrat, ou n'importe lequel des quatre ? | GC-5 |
| **Q4** | Que signifie concrètement « le directeur général **tranche les litiges** » dans l'application (quels écrans, quels litiges, quelle trace) ? | GC-1 |
| **Q5** | Noms et comptes : qui occupe chaque profil (RFCRH, responsable commercial, 3 managers, actuaire, chargée des études, stagiaire) ? Un utilisateur a **un seul rôle** dans le portail : quels cumuls réels ? | GC-1 |
| Q6 | **Échantillons** anonymisés des relevés (Wave Business, Wave hors business, BNI, autres banques, microfinances, PeyaPay) et des bordereaux de partenaires (formats variables) | GC-4, GC-9 |
| Q7 | **SECURPRO** : où lit-on le taux de TCA « au contrat » (colonne du bordereau, saisie, paramètre) ? | GC-8 |
| Q8 | **Prime acquise / non acquise** : méthode de calcul (prorata temporis journalier, 1/360, autre) et « éléments nécessaires aux écritures de fin de période » (le cahier ne les détaille pas) | GC-3, GC-10 |
| Q9 | **Ristourne** : base et valeur du « taux de ristourne » ; qui le fixe ? | GC-3 |
| Q10 | **Relances** : suivi manuel (SMS passé hors application) ou **envoi réel par passerelle SMS** ? Relevé « envoyé » : par e-mail ? | GC-7 |
| Q11 | Quand un paiement dépasse l'échéance la plus ancienne : le surplus va-t-il **par défaut** à l'échéance suivante ou reste-t-il « à rattacher » ? | GC-5 |
| Q12 | **Contrôles bloquants** de la clôture : lesquels exactement ? Qui peut lever un blocage ? | GC-10 |
| Q13 | **Reprise** : date de départ (« depuis 2025 »), volumes, et marquage exact des rattachements « sans information précise » | GC-11 |
| Q14 | **Odoo** : version, édition, plan comptable des assurances, format d'import exact, journaux et comptes à renseigner | GC-2, GC-10, GC-12 |
| Q15 | Remboursements de primes (nécessaires à l'état de déclaration de la TCA) : où sont-ils enregistrés (acte de ristourne ou d'annulation) ? | GC-8 |
| Q16 | Les **tolérances** du rapprochement (1 FCFA, −3 / +5 jours, ±2 % sur ±45 jours, 12 caractères) sont-elles **paramétrables** par le RFCRH ou figées ? | GC-5 |

*Remarques de forme sur le cahier* : la section « 6.2 » est numérotée deux fois (6.2 et 6.2 bis) ; les cas de recette ne sont pas dans l'ordre (T6 bis / T6 ter / T10 / T12 / T13 / T11) ;
« saisie refusée » (T4) devra devenir « saisie impossible » à l'écran pour respecter le vocabulaire du portail.

---

## 12. Risques

| Risque | Gravité | Parade |
|---|---|---|
| **R1** — Deux modules (Encaissements et Gestion Compta) qui calculent chacun la TCA et les honoraires sur leurs propres données : TCA **déclarée ou payée deux fois**, ou chiffres différents | **Élevée** | **Tranché le 2026-11-27 (conception, C-41) : Gestion Compta fait foi pour la TCA, les honoraires et la rémunération des partenaires.** Reste, dans une tâche séparée du module Encaissements, à rendre ses calculs de taxe et d'honoraires indicatifs ou à les retirer |
| Dette de duplication : un même défaut corrigé dans un module doit l'être aussi dans l'autre | Moyenne | Inventaire de duplication en GC-0 ; chaque copie garde en en-tête de fichier son origine (fichier et date) pour retrouver l'équivalent ; tests propres à chaque module |
| Câblage dans des fichiers partagés (2.1) pouvant casser un module existant | Moyenne | Ajouts seulement ; rejeu des tests et e2e existants à chaque lot ; revue ciblée de chaque fichier partagé touché |
| Périmètre très large, estimation du cahier (21 semaines) optimiste | **Élevée** | Livrer **par lots utilisables** (GC-1 à GC-6 donnent déjà le contrôle hebdomadaire) ; recaler l'estimation à la fin de GC-0 |
| Formats de relevés qui changent | Moyenne | Formats paramétrables, jeux d'échantillons en recette, lecture permissive avec signalements |
| Performance à 10 ans de volumes | Moyenne | Index, pagination serveur, mesures `EXPLAIN` dès GC-3, jeu de données synthétique à 10 ans |
| Règles ambiguës figées trop tôt (rattachement, prime acquise, honoraires) | Moyenne | Questions Q3 bis, Q8, Q9, Q11 ; paramètres datés plutôt que constantes ; section « arbitrages datés » dans la conception |
| Données clients (relevés) dans le dépôt | **Élevée** | Dossier hors dépôt, jeux synthétiques, revue avant chaque commit |
| Signataires sans signature enrôlée au démarrage | Faible | Vérification de mise en service (`verifier-mise-en-production`) étendue |
| 2FA absente | Moyenne | Chantier portail distinct, à planifier avant la production |

---

## 13. Ordre recommandé et premiers pas

1. **Cette semaine** : valider ce plan, notamment l'interprétation des points de câblage (2.1) ; poser Q4 et Q5 ; aucune modification des modules existants.
2. **GC-0** (≈ 2 semaines) : conception, maquettes, échantillons, inventaire de duplication, plan de branchement du lot 2.
3. **GC-1 → GC-6** : un module utilisable pour le **contrôle hebdomadaire**, avec production, relevés, rattachement et listes de travail.
4. **GC-7 → GC-9** : créances, TCA, rémunérations.
5. **GC-10 → GC-11** : clôture, tableaux de bord, exports Odoo, reprise, recette, mise en service.
6. **GC-12** : lot 2 sur décision de SIM.

**Premier commit conseillé après validation** : `docs/compta-conception.md` (arbitrages V1 à V3 et D1 à D8, modèle de données définitif, permissions), puis le socle GC-1.
