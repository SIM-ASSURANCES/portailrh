# Module « Encaissements, taxes » — document de conception (V2)

> **Source fonctionnelle** : [cahier-des-charges-encaissements-v2.md](cahier-des-charges-encaissements-v2.md) (**V2.6**,
> reçue le 2026-09-28, référencée ci-dessous « CDC §x ») et la maquette
> [Maquette_registre_paiements.html](Maquette_registre_paiements.html) (le cahier fait foi en cas de différence).
> Raisonnement détaillé, écarts et vérifications : [encaissements-analyse-impact-v2.md](encaissements-analyse-impact-v2.md).
> Le cahier V1 et les réponses du 28/09 sont dans [archive/](archive/) (remplacés).
>
> **Statut** : conception V2 du **2026-09-28**. Elle remplace la conception V1 du 2026-09-26 (historique dans git).
> Les points marqués **PROVISOIRE** ou **OUVERT** sont à confirmer (section 10). Toute évolution de ce document se fait dans
> le même commit que le code qui l'applique.

## Sommaire

1. Arbitrages datés
2. Existant réutilisable
3. Préfixe et collisions avec la Trésorerie
4. Profils → permissions
5. Modèle de données
6. Mise en service, audit, séquences et fichiers
7. Règles de calcul
8. Imports et relevés
9. Fichiers partagés avec le binôme
10. Ambiguïtés et statut
11. Découpage en commits

---

## 1. Arbitrages datés

### 2026-09-26 (conception V1, toujours valables sauf mention)

| # | Arbitrage | Statut V2 |
|---|---|---|
| A1 | Module **autonome** : préfixe `Enc`, permissions `enc.*`, clé `encaissements`, routes `/encaissements` et `/api/encaissements` ; aucun modèle de la Trésorerie réutilisé pour les données métier | Valable |
| A2 | **Hors purge globale** (`ReinitialisationSysteme`) ; remise à zéro propre, couplée à la mise en service (section 6) | Valable |
| A3 | Pièces jointes dans une table propre **`EncPieceJointe`** ; stockage `uploads/` et route d'upload communs | Valable (sert aux fichiers importés, 2026-09-28) |
| A4 | Taux et parts en **fraction** `Decimal(7,6)` (0,4 pour 40 %) | Valable (parts d'accessoires, taux de contrôle) |
| A5 | Suspens au Lot 2 | Valable (argent non identifié = Lot 2) |
| A6 | `EncLigneDue` et `EncBeneficiaire` dès le Lot 1 | **Caduc** : plus de lignes dues ni de règlements (V2) |
| A7 | Règle d'arrondi du prorata provisoire | **Définitive** (2026-09-28, voir D3) |

### 2026-09-27

- La mise en service du module est une action de l'**espace système** (`/systeme`), à côté de la réinitialisation globale ; le DG n'a pas besoin d'`enc.consulter`.

### 2026-09-28

| # | Décision |
|---|---|
| D1 | Permissions : la liste des 9 (section 4) est **validée** ; la **reprise initiale** est réservée à la Finance (`enc.importer_production` **et** `enc.marquer_paye`) |
| D2 | Rôles V1 « Gestionnaire » et « Responsable » : **supprimés s'ils n'ont aucun compte, sinon la migration s'arrête avec un message** |
| D3 | **Arrondi** : calcul et stockage **au centime** (règle du moteur : AB et AC arrondis half-up, AD = Z − AB − AC, commission et honoraires arrondis indépendamment, reliquat exact au soldant) ; **affichage arrondi à l'unité FCFA** ; la recette au centime porte sur les valeurs stockées |
| D4 | Libellé du module : **« Encaissements, taxes »** (titre de la V2.6) |
| D5 | Remise à zéro du module avant production : **conservée** |
| D6 | Fichiers importés (production, relevés) **conservés comme preuve** (données clients) : **relevés téléchargeables par la Finance seulement** ; **fichiers de production par la Finance et l'équipe technique**, jamais par la Consultation |
| D7 | **PaiementID** (remplace la première décision du jour) : **à la reprise**, les PaiementID du classeur **deviennent nos numéros PAI** (séquence remontée au maximum repris) ; **pour les fichiers mensuels suivants**, le PaiementID du fichier est stocké dans un **champ séparé** (clé anti-doublon) et chaque encaissement reçoit **notre propre numéro PAI** ; l'export du registre écrit **notre** numéro en colonne B. Origine des PaiementID des fichiers mensuels : question posée au client (V2-A1c) |
| D8 | **Avenant** : encaissements confirmés figés ; les suivants utilisent les nouveaux montants ; reliquat du soldant calculé sur les **nouveaux totaux** ; nouvelle prime inférieure à l'encaissé → **alerte trop-perçu** |
| D9 | **Tous les montants** (exigibilité, parts d'accessoires, bénéficiaire des honoraires) sont **calculés et figés dès la confirmation, en Lot 1** ; les écrans correspondants suivent aux Lots 2 et 3 |
| D10 | **Reprise initiale** : réglée par le CDC §F1.5 (prise en compte = date de paiement réelle ; bascule par nature lue sur la colonne A) ; **décision SIM : taxes au 30/09/2026 ; commissions, honoraires et accessoires sans bascule** (la date des taxes, 30/09 ou 31/08, est reposée au client : V2-A27d). Le paramétrage des accessoires (et des honoraires) doit précéder la reprise |
| D11 | Relevés : montants **négatifs** et paiements **< 100 FCFA** ignorés pour le **rapprochement**, mais **comptés dans les frais des opérateurs** (vérifié sur le relevé Wave d'août : 110 paiements, 5 de moins de 100 FCFA, 4 négatifs `agent_transaction`) |
| P1 | **PROVISOIRE** (proposé au client, sans réponse écrite) : liste des **branches paramétrée par la Finance** |
| P2 | **PROVISOIRE** : case « taxe payée » **non cochable tant que la taxe n'est pas exigible**, pour les **actions de l'utilisateur** (F7) ; la **reprise en est exclue** en attendant la réponse du client sur V2-A27d |

### 2026-09-30 (F1 — import mensuel du fichier de production, hors reprise F1.5)

Découpage en 4 commits validé (4a lecture pure, 4b règles pures, 4c application en base, 4d écran — §11). Limites de
lecture (aucune donnée précise dans le cahier au-delà de l'objectif de performance) : **10 Mo** (comme les pièces
jointes) et **20 000 lignes**.

| # | Décision |
|---|---|
| D12 | **V2-A12 (doublon), PROVISOIRE — à confirmer par le client** : « déjà présent » compare avec **tous** les encaissements existants du contrat, y compris les « non reçus » (un paiement déclaré non reçu ne doit pas revenir silencieusement) ; « doublon possible » (±1 FCFA, ±7 jours) compare uniquement avec les encaissements **confirmés** et **à confirmer** |
| D13 | **V2-A10 tranché** : paiement incomplet sur une police **nouvelle** — le contrat est créé normalement (ses données viennent des autres colonnes, indépendantes du paiement), seul le paiement est signalé « à compléter » |
| D14 | **V2-A14 tranché** : ligne marquée annulée dans un fichier importé par la **Finance** → ligne **rejetée entièrement** (ni création ni mise à jour du contrat), signalée. Fichier importé par l'**Équipe technique** → contrat importé normalement, signalement « annulation non appliquée — en attente L4 » (les champs d'annulation ne sont pas encore construits, `EncContrat.annulationType`/etc. restent `[L4]`) |
| D15 | **V2-A28 tranché** : ligne de fichier dont la date de paiement est future → contrat importé, **paiement NON créé**, signalé « à compléter » (même contrôle que la saisie manuelle, §8.1) |
| — | **Rappel A1b** (déjà tranché, D7) : le PaiementID **du fichier** va dans `paiementIdFichier` (anti-doublon seulement) ; chaque encaissement reçoit **notre** numéro PAI (`prochainNumero`, `encSequence.ts`) |
| — | **Route de dépôt** : PAS d'élargissement de la route commune Trésorerie (`/api/treso/pieces-jointes/upload`) aux tableurs — une route **dédiée** aux imports du module (`.xls`/`.xlsx`/`.csv` acceptés SEULEMENT là), gardée par `enc.importer_production`, prévue au commit 4c |
| — | **Transaction d'import** : le timeout par défaut de `$transaction` (5 s) ne tiendra pas 5 000 lignes — timeout explicite et/ou insertions par lots, à mesurer réellement sur la base Docker (commit 4c) |

**Découverte pendant le commit 4a, bloquante pour 4b (V2-A14)** : ni le CDC (§3.1, « Statut d'annulation, date, motif |
Colonnes du fichier ou saisie par l'équipe technique | Voir F8 ») ni la maquette (34 en-têtes A à AH,
`Maquette_registre_paiements.html`) ne précisent QUELLE colonne du fichier signale qu'une ligne est annulée — F8
(annulation) est explicitement Lot 4, ses colonnes ne sont donc décrites nulle part d'accessible pour l'instant.
**Conséquence assumée pour 4b** : `encImportLecture.ts` (4a) ne lit et n'expose AUCUN indicateur d'annulation (rien à
lire, la colonne réelle est inconnue) ; la détection prévue par D14 ne pourra être codée en 4b qu'une fois cette
colonne identifiée (probablement `TypeOpération`, colonne G, à confirmer — ou une question à poser au client, à
ajouter à la section 10 le cas échéant, une fois 4b entamé).

---

## 2. Existant réutilisable

| Besoin | État actuel | Verdict |
|---|---|---|
| Rôles et permissions | `Role`, `Permission` → `Module`, `RolePermission`, `PermissionDelegation`, `getSession()` recalculé à chaque appel | Réutilisable ; un seul rôle par utilisateur ; `encaissements` non délégable |
| Cartes et navigation | Codées par module (`(dashboard)/page.tsx`, `nav.ts`) | Câblé au 3a ; les 7 onglets du CDC §6 deviennent les entrées de la branche |
| Audit | `HistoriqueEntry` insuffisant | `EncAudit` (3b) |
| Pièces jointes | Route d'upload commune, `EncPieceJointe` (3b) | Fichiers importés |
| Lecture de tableurs | **Aucune** (ExcelJS ne sert qu'à écrire et ne lit pas `.xls`) | **SheetJS CE 0.20.3** proposé (section 8.4) |
| Exports | ExcelJS | Réutilisable (export du registre A–AH + §7.3) |
| Montants | `Decimal(14,2)` | Calcul en décimal (moteur), jamais en `number` |
| Références | `count()+1` en Trésorerie | `EncSequence` (3b) |
| Divers | Cron, notifications, SSE, zod | Rappels de taxes (§8.1) : cron |
| Absents | Double authentification, pagination serveur | 2FA au niveau du portail avant la production (CDC §8.2) |

---

## 3. Préfixe et collisions avec la Trésorerie

Préfixe `Enc` (A1). La V2 supprime la plupart des collisions de vocabulaire (règlement sortant, clôture, Responsable,
bordereau). Restent : « annulation » et « remboursement » (Trésorerie : annulation de règlement, `RemboursementRetour`),
`PieceJointe` (A3). Identifiants métier : **`PAI-AAAA-NNNNNN`** (encaissements) et **`SUS-AAAA-NNNNNN`** (argent non
identifié) ; `RGS-` et `BRD-` disparaissent.

---

## 4. Profils → permissions

Trois profils (CDC §2), trois rôles de départ modifiables ensuite : **Équipe technique**, **Finance**, **Consultation**.
Chaque profil = un jeu de permissions **positives** ; aucune n'est héritée d'`estAdmin`.

**Liste validée le 2026-09-28 (D1)** :

| Permission | Technique | Finance | Consultation | Couvre |
|---|:-:|:-:|:-:|---|
| `enc.consulter` | ✓ | ✓ | ✓ | Consulter, exporter, voir les signalements |
| `enc.importer_production` | ✓ | ✓ | | F1 ; téléchargement des fichiers de production (D6) |
| `enc.annuler_contrat` | ✓ | | | F8 |
| `enc.saisir_encaissement` | | ✓ | | F3, F4 |
| `enc.confirmer_paiement` | | ✓ | | F5 (reçu, non reçu, finalement reçu, relevés, frais) ; téléchargement des relevés (D6) |
| `enc.corriger_encaissement` | | ✓ | | Correction, contre-passation |
| `enc.gerer_non_identifie` | | ✓ | | F6 |
| `enc.marquer_paye` | | ✓ | | F7, décocher compris |
| `enc.parametrer` | | ✓ | | F9 (honoraires, accessoires, taux de contrôle, branches) |

Hors liste : **`enc.mettre_en_service`** (module technique `systeme`, DG seul, jamais modifiable depuis la console,
arbitrage du 2026-09-27). **Reprise initiale** (F1.5) : Finance seule, qui doit détenir `enc.importer_production` **et**
`enc.marquer_paye` (D1).

**État en base : fait (commit « Permissions V2 »).** Migration corrective
`20260928150000_encaissements_permissions_v2`, jamais en modifiant la migration 3a déjà poussée : crée les 6
permissions nouvelles, synchronise la description des 3 rôles conservés (un simple `ON CONFLICT DO NOTHING` ne l'aurait
jamais fait sur une base déjà seedée), retire les 14 permissions obsolètes du V1 et leurs attributions, accorde à
« Encaissements – Finance » les 6 permissions qui lui manquaient, puis supprime les rôles « Gestionnaire » et
« Responsable » (D2) — après un garde-fou qui arrête toute la migration (`RAISE EXCEPTION`, transaction annulée en
entier) si l'un des deux porte encore un compte, ou qu'une délégation pointe sur une permission sur le point d'être
supprimée (défense en profondeur : `encaissements` n'a jamais figuré dans `MODULES_DELEGABLES`, aucune délégation n'y
est possible depuis l'interface). Vérifié sur trois bases jetables : neuve (3 rôles, 9 permissions, `seed.ts` s'adapte
seul au nombre de rôles) ; état 3a sans compte sur les anciens rôles (nettoyage complet) ; état 3a avec un compte sur
« Gestionnaire » (migration refusée, rien modifié, `_prisma_migrations` marque l'échec — `prisma migrate resolve
--rolled-back` puis un nouveau `deploy` après réaffectation du compte referme l'incident). Aucune permission de
« validation » : la notion disparaît en V2. Les comptes de test (un par rôle) ne sont jamais créés en production.

**Écart signalé, pas silencieusement corrigé** : la demande de ce commit parlait de « retirer les 6 permissions
obsolètes » — il y en a en réalité **14** (17 permissions du V1, 3 conservées : `consulter`, `importer_production`,
`annuler_contrat`). Le nombre « 6 » correspond aux permissions **nouvelles**. La migration retire bien les 14.

---

## 5. Modèle de données

Conventions : montants `Decimal(14,2)`, signés pour une contre-passation ou un remboursement ; parts et taux en fraction
`Decimal(7,6)` ; mois en `Date` au 1er ; **toutes les relations vers `User` en `onDelete: Restrict`** et comptées par
`supprimerUtilisateurAction`. Entre crochets : **[S]** existe déjà (3b), **[L1]** à **[L4]** lot où le modèle devient
utile.

### 5.1 Socle technique (existant)

```prisma
model EncMiseEnService { id Int @id @default(1)  activeeAt  activeeParId  sauvegardeSha256 }   // [S] une seule ligne (CHECK), immuable
model EncSequence      { cle String @id  valeur Int }                                       // [S] clés PAI-AAAA, SUS-AAAA
model EncParametre     { cle String @id  valeur  majParId?  majAt }                         // [S] voir ci-dessous
model EncAudit         { id BigInt  entite  entiteId  action  avant? apres? motif?  mois?  userId  ip?  at }   // [S] ajout seul
model EncPieceJointe   { id  url @unique  nomOrigine?  mime  taille  sha256  deposeeParId  deposeeAt }       // [S] fichiers importés (D6)
```

**Paramètres (`EncParametre`, source unique `backend/src/encParametres.ts`)** :

| Clé | Défaut | Bornes | Statut |
|---|---|---|---|
| `taxe.jour_limite_reversement` | 20 | **1–28** | Fait (2026-09-30) : borne 1–28 posée en base par un CHECK (migration `20260930000000_encaissements_parametres_v2`), en plus du contrôle applicatif |
| `controle.tolerance_fcfa` | 1 | 0–1 000 | Garder |
| `taxe.rappel_jours_avant_limite` | 5 | 0–31 | Garder |
| `suspens.alerte_jours` | 60 | 1–3 650 | Garder (argent non identifié) |
| `accessoires.part_partenaire_defaut` | 0 | 0–1 (fraction) | Fait (2026-09-30), branché sur `choisirTauxAccessoires` via `tauxAccessoiresDefaut` (`encParametres.ts`) |
| `taxe.delai_exigibilite_mois` | 1 | — | Fait (2026-09-30) : retirée (N+1 fixe), `DELETE` par la même migration corrective |

`EncAudit.mois` (ancien rapport « changements depuis la clôture ») devient inutilisé ; il reste inoffensif et n'est pas
retiré.

### 5.2 Référentiels et paramètres métier — **fait (2026-09-30)**, sans écran (F9 au Lot 3)

Migration corrective `20260930000000_encaissements_parametres_v2` (ne modifie jamais `20260927100000_encaissements_module`/
`20260927142216_encaissements_socle_technique`, déjà poussées). Fonctions pures (normalisation, bénéficiaire en vigueur,
conversion pourcentage↔fraction) dans `backend/src/encReferentiels.ts` ; Server Actions (gardées par `enc.parametrer`,
`EncAudit` avant/après) déjà écrites, avant tout écran, à `frontend/src/app/(dashboard)/encaissements/parametres/actions.ts`.

```prisma
model EncBranche {                                   // [L1] liste paramétrée par la Finance (P1)
  id  code @unique  libelle  actif Boolean  creeParId  creeAt  majAt
}
model EncPartenaire {                                // [L1] créé à l'import, ajout manuel possible
  id  cleNom @unique  nom  partAccessoiresPartenaire Decimal(7,6)?  creeParId  creeAt  majParId?  majAt   // part null = défaut
}
model EncBeneficiaireHonoraires {                    // [L1] NOVELIA ; bénéficiaire en vigueur à la date de prise en compte
  id  nom  dateDebut @unique @db.Date  creeParId?  creeAt   // creeParId nul UNIQUEMENT pour la ligne NOVELIA (posée par la migration)
}
model EncTauxControle {                              // [L1 ou L3, V2-A20] signalement seulement, jamais un montant
  id  produitCode?  partenaireId?  tauxTaxe?  tauxCommission?  tauxAccessoires?  tauxHonoraires?  majParId  majAt
  @@unique([produitCode, partenaireId])    // n'empêche que le doublon EXACT (NULL ≠ NULL en SQL) ; CHECK séparé : au moins un des deux non nul
}
```

**Écart avec le sketch d'origine** : `EncBranche` porte `code` (identifiant technique court, `A-Z0-9_-`, 2 à 20
caractères, normalisé par `normaliserCodeBranche`) **et** `libelle` (affichage), plutôt qu'un `nom @unique` unique —
plus proche de l'usage réel (« AUTO », « VIE » comme codes courts, avec un intitulé complet séparé).

**Bénéficiaire des honoraires — date de départ de NOVELIA (V2-A13, TRANCHÉ 2026-09-30)** : le client a confirmé que
NOVELIA est bénéficiaire des honoraires **depuis toujours** — la date **2000-01-01** (repère « depuis toujours »),
posée par `ENC_BENEFICIAIRE_HONORAIRES_INITIAL` (`encReferentiels.ts`) et reprise à l'identique par la migration ET
par `seed.ts` (source unique), est donc **retenue définitivement**, pas une valeur à remplacer.

### 5.3 Contrats et encaissements

```prisma
model EncContrat {                                   // [L1] uniquement issu du fichier de production
  id  numPolice @unique  brancheId
  typeContrat?  produitLibelle?  produitCode?  typeOperation?  clientId?  clientNom?  partenaireId?
  dateEffet @db.Date  dateEcheance? @db.Date  typePolice?
  S  T  U  V  W  X                                   // Decimal(14,2), mis à jour par un avenant (D8)
  partAccessoiresPartenaire Decimal(7,6)?            // taux propre à la police
  annulationType?  annulationDate?  annulationMotif?  annulationSource?  annuleParId?  annuleAt?   // [L4]
  creeParImportId  majParImportId?  creeAt  majAt
  @@index([brancheId]) @@index([partenaireId]) @@index([clientNom]) @@index([produitCode])
}

model EncEncaissement {                              // [L1]
  id  paiementId String @unique                      // NOTRE numéro PAI (repris du classeur à la reprise, généré sinon) — D7
  paiementIdFichier String?                          // PaiementID d'un fichier mensuel : clé anti-doublon seulement — D7
  contratId  source (FICHIER | MANUEL)  statut (A_CONFIRMER | CONFIRME | NON_RECU)
  datePaiement @db.Date  mode (CHQ | VIR | OM | MTN | WAVE | CB | MOB)  reference?  Z
  saisiLe  saisiParId?  confirmeLe?  confirmeParId?  datePriseEnCompte? @db.Date  ordrePriseEnCompte?
  motifNonReception?  nonRecuParId?  nonRecuAt?
  referenceGroupe?  groupeId?  nonIdentifieId?  importId?  importLigne?  releveLigneId?
  contrePasseId? @unique  motifContrePassation?      // [L4]
  // Figés à la confirmation (D9)
  AA  AB  AC  AD  commission  honoraires
  partAccessoiresTaux  partAccessoiresPartenaire  partAccessoiresSim
  moisExigibilite @db.Date  dateLimiteReversement @db.Date  estRegularisation  beneficiaireHonorairesId
  // Marquages « payé » (hors application), par nature : date, référence, auteur, source (MANUEL | REPRISE)
  taxePayee*  commissionPayee*  honorairesPayes*  accessoiresPayes*
  aRegulariser Boolean                               // [L4] contre-passation ou annulation après un marquage « payé »
  observations?
  @@index([contratId, statut, ordrePriseEnCompte]) @@index([statut, datePaiement]) @@index([reference])
  @@index([moisExigibilite]) @@index([datePriseEnCompte]) @@index([paiementIdFichier])
}
```

### 5.4 Argent non identifié

```prisma
model EncNonIdentifie {                              // [L2]
  id  numero @unique (SUS-AAAA-NNNNNN)  dateReception  mode  reference?  montant  payeurPresume?  telephone?
  source (MANUEL | RELEVE)  releveLigneId? @unique
  statut (NON_AFFECTE | AFFECTE | CLASSE)  montantClasseHorsPrime?  motifClassement?   // affectation partielle : V2-A16
  dateAffectation?  traiteParId?  traiteAt?  saisiParId  saisiAt
}
```

### 5.5 Imports, signalements, relevés, frais

```prisma
model EncImport {                                    // [L1]
  id  type (PRODUCTION | RELEVE | REPRISE)  statut (APERCU | VALIDE | ABANDONNE)
  nomFichier  sha256  fichierId? @unique             // EncPieceJointe (D6)
  brancheParDefautId?  operateur?
  basculeTaxe?  basculeCommission?  basculeHonoraires?  basculeAccessoires?   // reprise (D10)
  nbLignes  totalPrimesTtc?  nbContratsCrees  nbContratsMaj  nbPaiementsAConfirmer  nbATraiter
  importeParId  importeAt  valideParId?  valideAt?
}
model EncSignalement {                               // [L1]
  id  importId  contratId?  numPolice  brancheId?
  analyse (DEJA_PRESENT | DOUBLON_POSSIBLE | A_COMPLETER | REFERENCE_MANQUANTE | REF_WAVE_NON_CONFORME | AJOUTE
           | SANS_PAIEMENT | PRIME_MODIFIEE | INCOHERENCE | ECART_TAUX | LIGNE_ANNULEE_REJETEE
           | ANNULATION_EN_ATTENTE_L4 | BRANCHE_INCONNUE)
  niveau (A_TRAITER | INFO)  statut (A_TRAITER | INFO | TRAITE)
  paiementIndique Json?  encaissementExistantId?  encaissementCreeId?  primeAvant?  primeApres?
  traiteParId?  traiteAt?  resolution?  creeAt
}
```
**Deux valeurs ajoutées (commit 4b, 2026-09-30), absentes du sketch d'origine** — le vrai `enum` Prisma devra les
recevoir au commit 4c :
- **`ANNULATION_EN_ATTENTE_L4`** — cas « Équipe technique » de V2-A14 (D14), jamais un rejet (contrat importé
  normalement), donc distincte de `LIGNE_ANNULEE_REJETEE`.
- **`REFERENCE_MANQUANTE`** — **deux corrections post-revue successives (2026-09-30)**. Un premier essai avait fondu
  la référence manquante dans `A_COMPLETER`, au motif que CDC §3.2 l'exige pour « tout nouvel encaissement ».
  **Corrigé (1)** : le tableau F1.4 (le cas « manquant ») ne cite que date, mode et montant — l'obligation de
  référence du §3.2 vise la SAISIE À L'ÉCRAN, pas le fichier de production. Une ligne sans référence est donc
  **ajoutée « à confirmer »** (pas bloquée), avec un signalement À TRAITER dédié. Un deuxième essai sautait alors le
  contrôle « doublon possible » (fuzzy, ±1 FCFA/±7 jours) pour ces lignes, en pensant à tort que le groupe 3 du
  rapprochement (CDC F5 : « même montant à 3 jours près, sans référence commune ») en avait seul la charge.
  **Corrigé (2)** : l'ORDRE voulu est **déjà présent → doublon possible → à compléter (date/mode/montant) → puis,
  SEULEMENT si la ligne est ajoutée, `REFERENCE_MANQUANTE` (ou `REF_WAVE_NON_CONFORME`) s'ajoute au signalement
  `AJOUTE`, jamais à sa place**. Une ligne sans référence qui ressemble à un encaissement existant (±1 FCFA, ±7
  jours) reste donc un doublon possible, non ajoutée — le groupe 3 du rapprochement sert pour les cas que ce
  contrôle ne détecte pas, jamais pour le remplacer.
```prisma
model EncReleveLigne {                               // [L1]
  id  importId  numeroLigne  date  references String[]  referencePrincipale?
  montantBrut  montantNet?  frais  typeTransaction?  nomContrepartie?  telephone?
  groupe (EXACT | MEME_REF_ECART | MEME_MONTANT | INCONNU | IGNOREE_NEGATIVE | IGNOREE_TEST | DEJA_CONNUE)
  ecart?  transactionPartageeN?
  @@unique([importId, numeroLigne])
}
model EncFraisOperateur {                            // [L1] remplacé au réimport (même opérateur, même mois)
  id  operateur  mois  nbPaiements  brut  frais  net  importId  majAt
  @@unique([operateur, mois])
}
model EncPreferenceUtilisateur { userId @id  confirmationAutoReleve Boolean }   // [L1] F5.7
```

**Disparaissent** par rapport à la conception V1 : `EncProduit`, `EncTypeOperation`, `EncTaux` (périodes, bases,
chevauchements), `EncBeneficiaire` typé, `EncLigneDue`, règlements sortants et affectations, bordereaux, créances,
clôtures, régularisations, `EncMotifAnnulation`, `EncImportLigne`.

### 5.6 Volumétrie

50 000 contrats et 200 000 encaissements par an (CDC §8.2). Les montants figés à la confirmation évitent tout recalcul à
l'affichage ; les états (« Taxes », « Ce que je dois », « Qui nous doit ») agrègent `EncEncaissement` sur les index
ci-dessus. Objectifs : recherche < 1 s, fiche < 2 s, import de 5 000 lignes < 2 min.

---

## 6. Mise en service, audit, séquences et fichiers

1. **Hors purge globale (A2).** `ReinitialisationSysteme` ne touche aucune table `Enc*`.
2. **Mise en service = remise à zéro + activation** (D5) : `enc.mettre_en_service` (DG seul, espace système), même protocole que la réinitialisation globale (sauvegarde JSON liée par empreinte SHA-256, mot de confirmation, transaction sérialisable).
   - **Purgé** : contrats, encaissements, argent non identifié, imports, signalements, relevés, frais, `EncAudit`, `EncSequence`, `EncPieceJointe` (fichiers supprimés après le commit).
   - **Conservé** : branches, partenaires et leurs parts d'accessoires, bénéficiaires des honoraires, taux de contrôle, paramètres (nécessaires à la reprise, D10).
   - En fin de transaction : la ligne `EncMiseEnService`. La reprise initiale (F1.5) se fait **après** la mise en service.
3. **Immuabilité de l'audit** (triggers en place depuis le 3b) : `EncAudit` : `UPDATE` toujours interdit, `DELETE` et `TRUNCATE` interdits après la mise en service ; `EncMiseEnService` : jamais modifiée, supprimée ni vidée. **Limite** : l'application se connecte en superutilisateur ; le CDC §8.2 demande un **compte applicatif aux droits limités** (décision du responsable informatique) et un audit **conservé 10 ans**.
4. **Séquences** : incrément atomique (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), jamais `count()+1`.
   - Clés : **`PAI-AAAA`** (année de saisie, CDC §3.2) et **`SUS-AAAA`** (année : V2-A18). `RGS` et `BRD` sont retirées du code au commit du moteur.
   - Reprise : les PaiementID du classeur deviennent nos numéros ; `remonterSequence` porte la séquence au maximum repris (D7).
   - Fichiers mensuels : chaque encaissement reçoit notre numéro ; le PaiementID du fichier va dans `paiementIdFichier` (anti-doublon), jamais dans la séquence (D7).
   - Après mise en service : ni suppression, ni baisse, ni renommage (trigger).
5. **Fichiers importés** (D6) : chaque fichier de production et chaque relevé est conservé dans `EncPieceJointe` (empreinte SHA-256, qui détecte aussi un réimport à l'identique). Téléchargement : relevés réservés à la Finance (`enc.confirmer_paiement`) ; fichiers de production à la Finance et à l'équipe technique (`enc.importer_production`), jamais à la Consultation.

---

## 7. Règles de calcul

Moteur pur `backend/src/encCalcul.ts` (tests vitest `encCalcul.test.ts`), décimal exact (`EncDecimal`, clone local de
decimal.js, arrondi half-up), jamais de `number` pour un montant.

### 7.1 Prorata et arrondi (CDC §5.2, D3)

- **Non soldant** : AB = arrondi(T·Z/S) ; AC = arrondi(U·Z/S) ; **AD = Z − AB − AC** ; commission = arrondi(W·Z/S) ; honoraires = arrondi(X·Z/S).
- **Soldant** (AA = 0) : chaque élément = total du contrat − cumul (reliquat exact) → la somme des encaissements égale toujours les montants du fichier.
- **Incohérence T + U + V ≠ S** : même calcul ; la taxe totale encaissée est celle du fichier (ΣAD = V au soldant), la ventilation peut s'écarter de quelques francs (CDC §5.2).
- **Stockage au centime, affichage à l'unité FCFA** ; la recette au centime porte sur les valeurs stockées.
- **Ordre** : ordre de **prise en compte** (CDC F3.7), fourni par l'appelant (cumul des confirmés précédents).
- **Avenant** (D8) : les confirmés restent figés ; les suivants utilisent S…X à jour ; reliquat du soldant = nouveaux totaux − cumul ; nouvelle prime inférieure à l'encaissé → alerte trop-perçu.
- **Trop-perçu** : plus refusé par le moteur, qui renvoie l'excédent comme **alerte** ; la Finance décide (CDC §5.6). Ventilation **PROVISOIRE** (V2-A6) : l'encaissement solde le contrat et reçoit les reliquats exacts, l'excédent n'est ventilé sur aucun élément ; si le contrat était déjà soldé, tout le montant est excédent.
- **Contre-passation** : copie négative **exacte** des montants figés (dont parts d'accessoires), rattachée au **même mois d'exigibilité** ; « à régulariser » si une part est déjà marquée payée.

### 7.2 Exigibilité de la taxe (CDC §5.3)

`moisExigibilite = max(mois de paiement + 1 ; mois de prise en compte, ou mois suivant si prise en compte le jour limite ou après)` ;
jour limite 1–28 (défaut 20) ; `dateLimiteReversement` = jour limite du mois d'exigibilité ; **« Régularisation »** si le
résultat diffère du mois de paiement + 1. Prise en compte = saisie (manuel), confirmation (fichier), affectation (argent
non identifié), **date de paiement** pour la reprise (D10). Aucune taxe sur un paiement à confirmer ou non affecté.

Vérification du tableau du CDC §5.3 : 10/09 pris le 12/09 → octobre ; 28/09 → 02/10 → octobre ; 28/09 → 25/10 →
novembre (régularisation) ; 15/07 → 10/09 → septembre (régularisation) ; 15/07 → 20/09 → octobre (régularisation).

### 7.3 Accessoires et honoraires (CDC §5.4, §3.6)

- **Part d'accessoires** : taux de la police > taux du partenaire > taux par défaut ; **figé** à la confirmation (D9) ; changement de taux : proposition de l'appliquer aux encaissements dont la part partenaire n'est pas payée ; part payée jamais modifiée. Arrondi retenu le 2026-09-28 : part partenaire arrondie half-up au centime, part SIM = AC − part partenaire ; recalcul d'une part non payée sur le même AC figé (`recalculerPartAccessoires`).
- **Bénéficiaire des honoraires** : celui en vigueur à la **date de prise en compte**, figé ; changement non rétroactif.

### 7.4 Vérifications chiffrées (moteur actuel)

| Cas | Résultat du moteur | Conforme |
|---|---|---|
| 9.1 | AB 466,20 / 652,68 / 279,72 ; AD 33,80 / 47,32 / 20,28 ; commission 83,92 / 117,48 / 50,35 ; honoraires 11,66 / 16,32 / 6,99 | oui |
| 9.4 | AB 93 240,09 / 83 916,08 / 55 944,06 ; AD 6 759,91 / 6 083,92 / 4 055,94 | oui |
| 9.5 | AB 186 480,19 ; AD 13 519,81 | oui |
| 9.6 | AC 50 ; P1 20 / 30 ; P2 35 / 15 ; à 50 % : 25 / 25 | oui |
| 9.8 | AD 67,60 × 3 puis 608,39 (soldant) ; total 811,19 | oui |

### 7.5 Moteur V2 (`backend/src/encCalcul.ts`)

**Fait (commit « Moteur V2 »)** :
- `regleArrondi` (règle D3, définitive) ; `calculerVersement` sur les montants du contrat en vigueur (avenant D8) avec
  `tropPercu` en alerte (§7.1) ;
- `calculerExigibilite(datePaiement, datePriseEnCompte, { jourLimite })` (§7.2, jour limite 1–28, `estRegularisation`) et
  `calculerExigibiliteReprise` (prise en compte = date de paiement, jamais de régularisation) ;
- `choisirTauxAccessoires` (police > partenaire > défaut, avec la source), `partagerAccessoires`,
  `recalculerPartAccessoires` (part déjà payée jamais modifiée) ;
- `figerEncaissement` (prorata + parts d'accessoires + exigibilité) et `contrepasser` (copie négative exacte, parts
  d'accessoires comprises, même mois d'exigibilité) ; `naturesARegulariser` ;
- `situationNature` : « à récupérer » devient `aRegulariser` ;
- supprimés : calcul inverse, décomposition par taux, échéancier ;
- tests renumérotés selon la recette V2.6 : 9.1, 9.4, 9.5, 9.6, 9.8, 9.9, 9.13 (partie calcul), tableau §5.3, et cas limites.

**Reste à ajouter** (commits suivants) : règles de doublon (F1), de reprise (F1.5), de rapprochement (F5) et
d'agrégation des frais, toutes en fonctions pures testées. Bénéficiaire des honoraires à une date : fait (2026-09-30,
`encReferentiels.beneficiaireHonorairesEnVigueur`, §5.2). Les séquences `RGS`/`BRD` (`encSequence.ts`) restent à
ajouter. La ligne `taxe.delai_exigibilite_mois` (`encParametres.ts`) a bien été retirée par le commit « Paramètres
V2 » (2026-09-30, pas « Permissions et paramètres V2 » — les deux ont finalement été deux commits séparés) ; la borne
du jour limite est ramenée à 28, désormais posée en base aussi (CHECK, §5.1).

---

## 8. Imports et relevés

### 8.1 Fichier de production (CDC F1, §7.1)

Nouvelle production du mois ; colonnes A à AH lues **par position** (en-têtes = contrôle) ; colonne « Branche » reconnue
par son en-tête, sinon branche choisie à l'import ; branche inconnue de la liste (P1) → signalement ; colonnes calculées
(N, Q, R, AA à AH) ignorées. Police nouvelle → contrat + paiement **à confirmer** (notre numéro PAI ; PaiementID du fichier en `paiementIdFichier`, D7) ;
police connue → mise à jour du contrat (avenant, D8) et table de cas du CDC F1.4 (déjà présent, doublon possible à 1 FCFA
et 7 jours, à compléter, Wave non conforme, autre cas, sans paiement), chaque cas tracé en `EncSignalement`. Totaux de
contrôle (lignes, primes TTC). Lignes annulées dans un fichier importé par la Finance : rejetées. Écarts de taux de contrôle
et incohérences : signalés sans bloquer.

### 8.2 Reprise initiale (CDC F1.5, D10)

Une seule fois, en deux temps : **aperçu** puis **validation**, par la **Finance seule** (D1).
- Les PaiementID du classeur **deviennent nos numéros PAI** ; séquence remontée au maximum repris (D7).
- Paiements repris **confirmés**, **prise en compte = date de paiement réelle** (pas de « Régularisation »).
- Dates de bascule par nature (taxe, commission, honoraires, part accessoires) fixées par la Finance ; pour chaque nature, un paiement dont la **date d'enregistrement (colonne A)** est ≤ bascule est marqué « payé » avec la source **REPRISE** ; décision SIM : **taxes au 30/09/2026**, les trois autres sans bascule (tout reste à payer).
- Prérequis : partage des accessoires (partenaires et exceptions par police) et bénéficiaire des honoraires **saisis avant** (montants figés à la reprise).
- Rapport de reprise par nature et par branche (marqué « payé (reprise) » / restant à payer) avant validation ; exceptions corrigées ensuite en décochant.
- La règle P2 (taxe non cochable avant exigibilité) **ne s'applique pas** à la reprise, en attendant la réponse sur V2-A27d.
- Points ouverts : V2-A27b (branche des paiements repris) et V2-A27d (bascule des taxes au 30/09 ou au 31/08) — **questions posées au client** ; V2-A27c, A27e.

### 8.3 Relevés (CDC F5, §7.2)

Format du relevé Wave vérifié sur le relevé réel d'août (analyse §6) : `.xls` Excel 97-2003, une feuille par période,
en-têtes ligne 1, 13 colonnes du §7.2 ; horodatage = date Excel ; montants entiers ; types `api_checkout`,
`merchant_payment`, `agent_transaction` (négatifs). Opérateur reconnu par les **en-têtes**, pas par le nom du fichier.
Rapprochement sur l'identifiant de transaction (`T_…`), la référence client et l'identifiant de session API ; 4 groupes et
transaction partagée (CDC F5.6) ; D11 pour les lignes ignorées et les frais. **Le relevé réel ne va jamais dans le dépôt**
(dossier local `C:\Projets\donnees-sensibles\`, hors dépôt ; `/donnees-sensibles/` reste dans le `.gitignore` par
précaution) : tests sur un relevé synthétique au même format.

### 8.4 Bibliothèque de lecture — **fait (commit 4a, 2026-09-30)**

**SheetJS CE 0.20.3**, distribué par l'éditeur (le paquet npm `xlsx` 0.18.5 n'est plus maintenu et porte
CVE-2023-30533 et CVE-2024-22363). Archive versionnée dans le dépôt (`backend/vendor/xlsx-0.20.3.tgz`, dépendance
`file:./vendor/xlsx-0.20.3.tgz` dans `backend/package.json`), téléchargée depuis `https://cdn.sheetjs.com/xlsx-0.20.3/
xlsx-0.20.3.tgz` et vérifiée (nom `xlsx`, version `0.20.3`, auteur `sheetjs` dans son `package.json` interne) —
empreinte SHA-256 de l'archive : `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`. Lecture côté
serveur uniquement (`backend/src/encImportLecture.ts`), taille bornée à 10 Mo et nombre de lignes à 20 000 (aucune
valeur précise dans le cahier, au-delà de l'objectif « 5 000 lignes < 2 min » — ces deux plafonds sont ajustables),
formules/HTML/styles désactivés (`cellFormula: false`, `cellHTML: false`, `cellStyles: false`, `cellDates: true`),
une seule fonction d'entrée `lireTableur(buffer) → { lignes, brancheColonnePresente, nbLignesVidesIgnorees }`.
ExcelJS reste la bibliothèque d'**écriture** des exports. Détail du choix : analyse §7.

**Dockerfile** — la dépendance `file:` de `backend/vendor/` est résolue par `npm ci` RELATIVEMENT à
`backend/package.json` : les stages `deps` et `prod-deps` (copies sélectives de `package.json`, avant `npm ci`) ont
tous deux reçu un `COPY backend/vendor ./backend/vendor` juste avant leur `npm ci`/`npm ci --omit=dev` — sans quoi
l'un ou l'autre échouerait avec un fichier introuvable. Vérifié par un vrai `docker build` de l'image complète
(voir CLAUDE.md pour le résultat).

**Permissivité délibérée** : `lireTableur` ne lève une exception que pour des problèmes STRUCTURELS (en-têtes
incorrects, fichier vide/illisible, trop volumineux, trop de lignes) — un champ de contenu absent ou illisible sur
une ligne donnée (police, dates, montants, mode, référence) devient `null`, jamais une exception qui ferait échouer
tout le fichier : une ligne incomplète est une donnée métier pour les règles F1 (commit 4b, cas « à compléter »),
pas une erreur de lecture.

**Découverte, bloquante pour 4b** : aucune colonne du fichier n'est identifiée pour signaler qu'une ligne est
annulée (§3.1 renvoie à F8, Lot 4, sans préciser la colonne ; les 34 en-têtes de la maquette n'en contiennent
aucune) — `lireTableur` ne lit donc aucun indicateur d'annulation. Voir l'arbitrage D14 (2026-09-30) plus haut.

---

## 9. Fichiers partagés avec le binôme

| Fichier | Modification prévue |
|---|---|
| `backend/prisma/schema.prisma`, `migrations/` | Modèles `Enc*` et relations inverses sur `User` ; migrations horodatées après les dernières appliquées |
| `backend/prisma/seed.ts` | Ajouts groupés (permissions, rôles, paramètres, comptes de test hors production) |
| `backend/src/index.ts` | Exports du module |
| `frontend/src/app/(dashboard)/page.tsx`, `nav.ts`, `Sidebar.tsx`, `AppShell.tsx`, `(dashboard)/layout.tsx` | Onglets de la branche Encaissements |
| `frontend/src/lib/topbarAlerts.ts`, notifications, cron | Rappel des taxes 5 jours avant le jour limite, alerte de retard (CDC §8.1) |
| `admin/users/actions.ts` | Comptage des nouvelles relations vers `User` |
| `package.json`, lockfile | SheetJS CE (archive versionnée) |
| `CLAUDE.md` | Section du module |

La double authentification (CDC §8.2) est un chantier du portail, hors module.

---

## 10. Ambiguïtés et statut

Statuts : **TRANCHÉ** (daté), **RÉSOLU V2.6**, **PROVISOIRE**, **OUVERT**.

### 10.1 Ambiguïtés de la V2 (numérotation de l'analyse, préfixe « V2- »)

| # | Sujet | Statut |
|---|---|---|
| V2-A1 | PaiementID d'un paiement importé | TRANCHÉ 2026-09-28 (D7, version révisée) |
| V2-A1b | PaiementID du fichier et de l'application dans la même série (conflit d'unicité) | TRANCHÉ 2026-09-28 (D7 : numéro propre, PaiementID du fichier dans un champ séparé) |
| V2-A1c | Origine des PaiementID des fichiers mensuels (système de production ? série propre ?) | OUVERT — question posée au client |
| V2-A2 | Ordre de deux prises en compte le même jour ; « Finalement reçu » | OUVERT |
| V2-A3 | Arrondi | TRANCHÉ 2026-09-28 (D3) |
| V2-A4 | Avenant | TRANCHÉ 2026-09-28 (D8) |
| V2-A5 | Changement de partenaire ou de branche d'une police connue | OUVERT |
| V2-A6 | Ventilation de l'excédent d'un trop-perçu | PROVISOIRE (moteur, 2026-09-28) : reliquats exacts au soldant, excédent non ventilé — à confirmer par le client |
| V2-A7 | Arrondi des parts d'accessoires ; T et V absents du 9.6 | Arrondi retenu le 2026-09-28 (part partenaire half-up, part SIM = AC − part partenaire) ; T et V du 9.6 choisis dans les tests (1 400 et 100) |
| V2-A8 | Correction d'un encaissement | OUVERT |
| V2-A9 | Contre-passation d'une taxe déjà payée | OUVERT |
| V2-A10 | Paiement incomplet d'une police nouvelle | TRANCHÉ 2026-09-30 (D13) : contrat créé, paiement signalé « à compléter » |
| V2-A11 | « Ajouter quand même » : à confirmer ou confirmé | OUVERT |
| V2-A12 | Règles de doublon (statuts comparés, ordre, portée de la référence) | PROVISOIRE 2026-09-30 (D12) — à confirmer par le client |
| V2-A13 | Date de début de NOVELIA | TRANCHÉ 2026-09-30 : NOVELIA bénéficiaire depuis toujours (réponse du client) — 2000-01-01 retenue définitivement (`ENC_BENEFICIAIRE_HONORAIRES_INITIAL`, §5.2) |
| V2-A14 | Lignes annulées importées par la Finance | TRANCHÉ 2026-09-30 (D14) : rejetée entièrement si Finance, importée normalement + signalée si Équipe technique — **colonne du fichier qui porte cette information encore inconnue** (découverte 4a, voir arbitrages 2026-09-30), bloque le codage effectif de la règle en 4b |
| V2-A15 | Liste des branches | PROVISOIRE (P1) |
| V2-A16 | Affectation partielle et classement d'un même paiement non identifié | OUVERT |
| V2-A17 | Source d'un encaissement issu d'une affectation | OUVERT |
| V2-A18 | Année du numéro SUS | OUVERT |
| V2-A19 | Dates de référence des états | OUVERT |
| V2-A20 | Taux de contrôle : base, tolérance, lot | RÉSOLU 2026-09-30 pour les 4 natures : taxe = V/(T+U), commission = W/T, honoraires = X/T (base reprise de la maquette) ; accessoires = U/T (base implicite reprise du V1) — **PROVISOIRE, à confirmer par le client**. Tolérance toujours fournie par l'appelant, aucune valeur par défaut |
| V2-A21 | Relevé : toutes branches ou branche choisie | OUVERT |
| V2-A22 | Groupe 4 du relevé en Lot 1 | OUVERT |
| V2-A23 | Frais : tests comptés (RÉSOLU, D11) ; deux relevés partiels du même mois | OUVERT (en partie) |
| V2-A24 | Annulation : reste dû après résiliation ; effet sur la taxe à la production | RÉSOLU V2.6 en partie (9.13) |
| V2-A25 | Paiement mobile saisi au net | OUVERT |
| V2-A26 | Ligne de relevé correspondant à un « non reçu » | OUVERT |
| V2-A27 | Reprise initiale | RÉSOLU V2.6 (D10) |
| V2-A27b | Reprise : une fois pour tout le classeur ou par branche ; affectation des branches | OUVERT — question posée au client |
| V2-A27c | Date et référence du « payé (reprise) » | OUVERT |
| V2-A27d | Conflit entre la bascule des taxes au 30/09 et P2 (taxes de septembre exigibles en octobre) : bascule au 30/09 ou au 31/08 ? | OUVERT — question posée au client ; en attendant, P2 ne s'applique pas à la reprise |
| V2-A27e | Paiement repris sans date en colonne A | OUVERT |
| V2-A28 | Référence et date future pour les paiements du fichier | TRANCHÉ 2026-09-30 (D15) : contrat importé, paiement non créé, signalé « à compléter » |
| V2-A29 | Contenu de l'export du registre | OUVERT |
| V2-A30 | Onglet « À vérifier » pour l'équipe technique | OUVERT |
| V2-A31 | Mise en service | TRANCHÉ 2026-09-28 (D5) |
| V2-A32 | Libellé du module | TRANCHÉ 2026-09-28 : « Encaissements, taxes » (D4) |
| V2-A33 | Téléchargement des fichiers de production (données clients) | TRANCHÉ 2026-09-28 : Finance et équipe technique (D6) |
| V2-A34 | « Taxe payée » non cochable avant exigibilité | PROVISOIRE (P2) : actions de l'utilisateur seulement, reprise exclue |
| R3 | Numérotation des renouvellements (équipe technique) | OUVERT |
| R7 | Date d'effet d'une annulation « sans effet » | OUVERT |

### 10.2 Ambiguïtés de la V1 (numérotation historique, citée par le code déjà poussé)

| # V1 | Sujet | Sort |
|---|---|---|
| 1 | Import technique qui crée des versements | Remplacée (paiements « à confirmer ») |
| 2 | Figé / recalculé / rang | Tranchée (figé, ordre de prise en compte) |
| 3, 4 | Types et statut d'annulation | Tranchées (3 types) |
| 5 | Validation d'un versement | **Close** : la notion disparaît |
| 6 | « Rapproché » | Remplacée (lien vers la ligne de relevé) |
| 7 | Base « prime TTC » circulaire | Sans objet (plus de calcul de contrat) |
| 8 | Arrondi du prorata | Tranchée (D3) |
| 9, 11a, 11b, 17 | Bordereau, lot de F10, date de situation, déclôture | Sans objet |
| 10 | Avenants, renouvellements | D8 ; renouvellements : R3 |
| 12 | Bénéficiaires | Tranchée (NOVELIA daté, partage des accessoires) |
| 13 | Double authentification | Tranchée (portail, avant production) |
| 14, 16 | Acompte, trop-perçu | Tranchées ; excédent : V2-A6 |
| 15 | Année des numéros | PAI tranchée (saisie) ; SUS : V2-A18 |
| 18 | Contrat incohérent | Tranchée (ΣAD = V, CDC §5.2) |
| 19 | Prime absente des cas chiffrés | Toujours vrai pour 9.4 et 9.6 (sans effet sur les résultats) |
| 20, 21 | Lignes dues nulles ; contre-passation et lignes dues | Sans objet ; remplacée par V2-A9 |
| 22 | Identifié pile le jour limite | Tranchée : mois suivant (CDC §5.3) |

---

## 11. Découpage en commits

### Déjà poussés (conception V1)

| Commit | Contenu | Sort en V2 |
|---|---|---|
| `f7f0212` Docs | Cahier V1, conception V1 | Remplacés (archive, cette conception) |
| `422ffa7` Moteur | `encCalcul.ts` + tests | Adapté par le commit « Moteur V2 » (§7.5) |
| `e55471e` 3a | Module, 17 permissions, 5 rôles, navigation, accueil | Migration corrective (§4) |
| `815056f` 3b | Séquences, audit immuable, paramètres, pièces jointes | Gardé ; paramètres adaptés (§5.1) |

### Lot 1 V2.6

| # | Commit | Attend |
|---|---|---|
| 0 | **Docs** : V2.6 et maquette, archives, analyse, cette conception, `CLAUDE.md`, `.gitignore` | — |
| 1 | **Moteur V2** (§7.5) — fait | — |
| 2 | **Permissions V2** : migration corrective, seed, tests — fait | — |
| 2b | **Paramètres V2** : retirer la ligne `taxe.delai_exigibilite_mois`, ajouter `accessoires.part_partenaire_defaut`, borne 1–28 en base (CHECK) — fait (2026-09-30) | — |
| 3a | **Référentiels et paramétrage de base** (branches, bénéficiaire des honoraires daté, partenaires, taux de contrôle) — fait (2026-09-30), sans écran (F9 au Lot 3) | V2-A13 tranchée (NOVELIA depuis toujours), V2-A15 (branches, toujours provisoire, P1) |
| 3b | **`EncContrat`** (reste à faire) | — |
| 4a | **Lecture du fichier de production** (`lireTableur`, pure, SheetJS CE vendue) — fait (2026-09-30) | — (voir découverte "colonne d'annulation" ci-dessous, pour 4b) |
| 4b | **Règles F1** (doublon, avenant, écarts, incohérences — pures) — fait (2026-09-30) | V2-A12 (PROVISOIRE), V2-A10/A14/A28 tranchées (voir arbitrages 2026-09-30) ; V2-A20 (taux de contrôle) résolue pour taxe/commission/honoraires (base reprise de la maquette), toujours OUVERTE pour les accessoires |
| 4c | **Application en base** (`EncContrat`/`EncEncaissement`/`EncImport`/`EncSignalement`, transaction, route de dépôt dédiée) | — |
| 4d | **Écran d'import** | V2-A30 (non bloquante) |
| — | Découpage validé le 2026-09-30 (4 commits au lieu de « Lecture de tableurs et règles d'import » + « Import de production » ci-dessus, listés à titre d'historique) ; F1.5 (reprise) reste un commit séparé, plus tard, une fois A27b/A27d/A1c répondues. |
| 6 | **Recherche et fiche police (F2)** | — |
| 7 | **Saisie (F3)**, montants figés (D9) | V2-A2, A6 |
| 8 | **Paiement multiple (F4)** | — |
| 9 | **Confirmation (F5) et signalements** | V2-A11, A30 |
| 10 | **Relevés et frais (F5)** | V2-A21 à A23, A25, A26 |
| 11 | **Reprise initiale (F1.5)** | V2-A27b à A27e |
| 12 | **Recette du Lot 1** et mise en service | — |
