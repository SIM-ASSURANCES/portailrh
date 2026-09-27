# Module « Encaissements, taxes et commissions » — document de conception

> Source fonctionnelle : [cahier-des-charges-encaissements.md](cahier-des-charges-encaissements.md) (référencé ci-dessous « CDC §x »).
> Statut : **conception validée le 2026-09-26**, aucune ligne de code écrite. Les points marqués **PROVISOIRE** ou **OUVERT**
> restent à confirmer (section 10). Toute évolution de ce document se fait dans le même commit que le code qui l'applique.

## Sommaire

1. Arbitrages du 2026-09-26
2. Existant réutilisable
3. Collisions avec la Trésorerie et préfixe
4. Profils → permissions
5. Modèle de données (lots 1 à 4)
6. Mise en service, audit et séquences
7. Taux : unité et contrôle des chevauchements
8. Règle d'arrondi du prorata (PROVISOIRE)
9. Fichiers partagés avec le binôme (Pointage RH / FeedbackApp)
10. Ambiguïtés du cahier et statut
11. Découpage en commits (Lot 1)

---

## 1. Arbitrages du 2026-09-26

| # | Arbitrage |
|---|---|
| A1 | Module **autonome** : préfixe `Enc` (modèles), `enc.*` (permissions), clé de module `encaissements`, routes `/encaissements` et `/api/encaissements`. Aucun modèle de la Trésorerie n'est réutilisé pour les données métier. |
| A2 | Le module est **hors de la purge globale** (`ReinitialisationSysteme`, à usage unique, sans doute déjà consommée). Il a sa **propre remise à zéro, couplée à sa mise en service** (section 6). |
| A3 | Pièces jointes dans une table propre **`EncPieceJointe`** (la purge globale fait `pieceJointe.deleteMany()` sans filtre : partager `PieceJointe` la ferait échouer ou supprimerait les pièces du module). Le stockage disque (`uploads/`) et la route d'upload restent communs. |
| A4 | Taux stockés en **fraction décimale** `Decimal(7,6)` (0,0725 pour 7,25 %). |
| A5 | **F10 (suspens) rattaché au Lot 2**, avec le rapprochement F9. |
| A6 | **`EncLigneDue` et `EncBeneficiaire` dès le Lot 1** : chaque versement validé crée ses lignes dues (taxe, commission, honoraires, accessoires) dans la même transaction. Aucune migration de reprise au Lot 2. |
| A7 | Règle d'arrondi de la section 8 retenue **à titre provisoire** ; le cas du contrat incohérent (T + U + V ≠ S) attend la validation du client (ambiguïté 18). |

---

## 2. Existant réutilisable

| Besoin | État actuel | Verdict |
|---|---|---|
| Rôles et permissions | `Role` (`estAdmin`, `peutEtreBeneficiaireDelegation`), `Permission` → `Module`, `RolePermission`, `PermissionDelegation`, `getSession()` recalculé à chaque appel ; la matrice `/admin/roles` liste les modules génériquement | Réutilisable. Limites : **un seul rôle par utilisateur** ; délégation restreinte à `MODULES_DELEGABLES = ["tresorerie","pointage"]` |
| Cartes et navigation | Codées en dur par module (`(dashboard)/page.tsx`, `nav.ts`) | À câbler au commit « Fondations » |
| Audit | `HistoriqueEntry` (texte libre, purgeable, pas d'avant/après structuré ni d'immuabilité) | **Insuffisant** pour CDC §3.6 et §8.3 → table dédiée `EncAudit` |
| Pièces jointes | Route d'upload (10 Mo, PDF/JPG/PNG, noms UUID), `PieceJointeUpload` | Upload réutilisable ; modèle propre `EncPieceJointe` (A3) et route de téléchargement propre |
| Import Excel | Aucun ; `exceljs` ^4.4 (frontend) ne sert qu'aux exports ; aucun parseur CSV | À construire (lecture ExcelJS en flux ; parseur CSV au Lot 2 pour les relevés) |
| Exports, PDF | ExcelJS multi-feuilles, `@react-pdf/renderer` | Réutilisables (bordereaux PDF au Lot 3) |
| Montants | `Decimal(14,2)` dans tout le schéma (`Float` réservé au GPS) | Bon type ; le calcul du module se fait en `Prisma.Decimal` (decimal.js), jamais en `number` |
| Références | `generateDemandeReference()` = `count()+1` (ni atomique, ni « jamais réutilisé ») | Insuffisant → `EncSequence` (section 6) |
| Divers | Cron protégé (`CRON_SECRET`), notifications, SSE, `date-fns`, zod | Réutilisables |
| Absents | Double authentification (CDC §8.3), pagination serveur, suite de tests | À prévoir (tests dès le commit 2) |

---

## 3. Collisions avec la Trésorerie et préfixe

| Terme du cahier | Déjà utilisé en Trésorerie |
|---|---|
| Règlement (sortant) | `Reglement`, `ReglementCategorieAllocation`, `treso.effectuer_reglement` |
| Clôture (mensuelle) | `CLOTUREE`, `cloturerDemandeAction`, `treso.cloturer_demande` |
| Responsable (valideur) | « Responsable Finance » = `valider_demande` sans `approuver_validation_complete` |
| Bordereau | « bordereau de versement » d'un retour Banque, `JournalBanque` |
| Annulation, remboursement | annulation de règlement/retour, `RemboursementRetour` |
| PieceJointe, références | `PieceJointe` (liée à la Trésorerie), `DEM-…` |

Préfixe retenu : `Enc` (A1). Identifiants métier conservés : `PAI-`, `SUS-`, `BRD-` ; ajout de `RGS-` pour les règlements sortants.

---

## 4. Profils → permissions

Chaque profil du CDC §2 devient un **jeu de permissions positives** (jamais « l'absence d'une permission »). Aucune permission `enc.*` n'est accordée par le contournement `estAdmin` ; cinq rôles de départ sont créés par le seed et restent modifiables.

| Permission | Technique | Gestionnaire | Finance | Responsable | Audit |
|---|---|---|---|---|---|
| `enc.consulter` (lecture, export) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `enc.importer_production` | ✓ | | ✓ | | |
| `enc.gerer_contrats` (créer, corriger, taux en saisie directe) | ✓ | | | | |
| `enc.parametrer_taux` | ✓ | | | | |
| `enc.annuler_contrat` (écran ou import) | ✓ | | | | |
| `enc.saisir_versement`, `enc.saisir_remise`, `enc.importer_encaissements` | | ✓ | | | |
| `enc.saisir_suspens` (saisie et identification) | | ✓ | ✓ | | |
| `enc.classer_suspens` (non taxable, à rembourser) | | | ✓ | | |
| `enc.regler_sortant`, `enc.rapprocher` | | | ✓ | | |
| `enc.corriger_versement_valide`, `enc.annuler_reglement`, `enc.cloturer_mois`, `enc.decloturer_mois`, `enc.deroger` | | | | ✓ | |
| `enc.mettre_en_service` (section 6) | DG seul, jamais héritée d'`estAdmin` | | | | |

Les cumuls (ex. Finance + Responsable) passent par un rôle composite, ou par la délégation si `"encaissements"` est ajouté à `MODULES_DELEGABLES`. La séparation des tâches est revérifiée dans chaque action serveur.

---

## 5. Modèle de données (lots 1 à 4)

Conventions : montants `Decimal(14,2)` (signés quand une régularisation ou une contre-passation l'exige), taux `Decimal(7,6)` en fraction, mois stockés en `Date` au 1er du mois. Le lot où chaque modèle devient utile est indiqué entre crochets.

### 5.1 Socle technique

```prisma
model EncMiseEnService { id Int @id @default(1)  activeeAt  activeeParId  sauvegardeSha256 }              // [L1, fin] une seule ligne (section 6)
model EncSequence      { cle String @id  valeur Int }                                                  // [L1] "PAI-2026", "SUS-2026", "RGS-2026", "BRD-2026-09"
model EncParametre     { cle String @id  valeur  majParId  majAt }                                     // [L1] délai d'exigibilité (1), jour limite (20), tolérances, seuils
model EncAudit {                                                                                        // [L1] ajout seul (section 6)
  id BigInt @id @default(autoincrement())
  entite  entiteId  action  avant Json?  apres Json?  motif?
  mois DateTime? @db.Date                                     // mois de rattachement (rapport « changements depuis la clôture », F11.4)
  userId  ip?  at DateTime @default(now())
  @@index([entite, entiteId]) @@index([mois, at]) @@index([at])
}
model EncPieceJointe { id  url  nomOrigine  mime  taille  sha256  deposeeParId  deposeeAt }             // [L1] référencée par clé unique côté porteur
model EncImport {                                                                                       // [L1 production ; L2 relevés ; L3 règlements, bordereaux partenaire ; L4 annulations]
  id  type(PRODUCTION|ENCAISSEMENTS|BORDEREAU_PARTENAIRE|PARAMETRAGE_TAUX|PARTENAIRES|RELEVE|REGLEMENTS|ANNULATIONS)
  nomFichier  sha256  fichierId  statut(APERCU|CONFIRME|ABANDONNE|ECHEC)  importeParId  creeAt  confirmeAt?
  transmisParId?  transmisAt?  totalContratsControle?  totalPrimesTtcControle?   // F1 « qui importe »
  nbLignes  nbCrees  nbIgnores  nbErreurs  nbEcarts
  @@index([type, creeAt]) @@index([sha256])
}
model EncImportLigne { id  importId  numeroLigne  severite(ERREUR|ECART|INFO)  code  message  donnees Json  @@index([importId, severite]) }   // [L1]
```

### 5.2 Référentiels

```prisma
model EncProduit        { id  code @unique  libelle  actif }                                            // [L1]
model EncPartenaire     { id  code @unique  nom  coordonneesPaiement Json?  actif  importId? }          // [L1]
model EncTypeOperation  { id  code @unique  libelle  actif }                                            // [L1]
model EncTaux {                                                                                          // [L1] partenaireId NULL = taux par défaut du produit
  id  produitId  partenaireId?  dateDebut @db.Date  dateFin? @db.Date                                   // intervalle fermé [début, fin] ; fin vide = en cours
  tauxAccessoires? baseAccessoires?  tauxTaxe? baseTaxe?  tauxCommission? baseCommission?  tauxGestion? baseGestion?
  montantFixeAccessoires?  creeParId  creeAt
  @@index([produitId, partenaireId, dateDebut])
  // + 2 index uniques partiels (section 7)
}
model EncBeneficiaire {                                                                                  // [L1] (A6)
  id  type(ADMIN_FISCALE|PARTENAIRE|HONORAIRES|ACCESSOIRES)  partenaireId? @unique  nom  actif
}
model EncMotifAnnulation { id  code @unique  libelle  actif }                                           // [L4]
```

`EncBeneficiaire` : un bénéficiaire `PARTENAIRE` est créé avec chaque partenaire ; `ADMIN_FISCALE`, `HONORAIRES` et `ACCESSOIRES` sont créés par le seed (bénéficiaires uniques, **provisoire**, ambiguïté 12).

### 5.3 Contrats, versements, encaissements, lignes dues

```prisma
model EncContrat {                                                                                       // [L1]
  id  numPolice @unique  typeContrat(I|G)  produitId  typeOperationId  clientId  clientNom  partenaireId
  dateEffet  dateEcheance  dateProduction  typePolice?
  primeTtc  primeNette  accessoires  taxes  commission  honoraires              // S T U V W X
  tauxAccessoires? baseAccessoires? tauxTaxe? baseTaxe? tauxCommission? baseCommission? tauxGestion? baseGestion?   // saisie directe
  tauxParametresSnapshot Json?                                                  // taux retenus à dateProduction (état « Écarts de taux »)
  modeSaisie(IMPORT|SAISIE_DIRECTE)  importId?  echelonne Boolean
  statutAnnulation(ACTIF|ANNULE)  dateAnnulation?                               // dénormalisés ; détail dans EncAnnulation [L4]
  totalEncaisse  nbVersements  dernierVersementAt?                              // dénormalisés dans la transaction du versement
  creeParId  creeAt  majAt
  @@index([clientNom]) @@index([clientId]) @@index([partenaireId, produitId]) @@index([dateProduction]) @@index([dateEcheance]) @@index([statutAnnulation])
}
model EncRemise {                                                                                        // [L1] encaissement groupé (F3 bis)
  id  numero @unique  payeurType(PARTENAIRE|CLIENT)  partenaireId?  payeurNom  datePaiement  modePaiement  reference
  montantTotal  statut(BROUILLON|VALIDE|RAPPROCHE)  pieceJointeId? @unique  suspensId?  compteTresorerieId?
  creeParId  valideParId?  valideAt?
  @@index([reference]) @@index([partenaireId, datePaiement])
}
model EncVersement {                                                                                     // [L1]
  id  paiementId @unique  contratId  remiseId?
  origine(SAISIE|REMISE|IMPORT|SUSPENS|CONTREPASSATION|REMBOURSEMENT)
  datePaiement @db.Date  enregistreAt  modePaiement  referencePaiement  observations?  compteTresorerieId?
  statut(BROUILLON|VALIDE|ANNULE)  rapprocheAt?  rapprochementId?              // « Rapproché » = attribut (ambiguïté 6)
  rang Int?                                                                     // N° de versement (ambiguïté 2)
  contrepasseDeId? @unique  motifContrepassation?
  dateIdentification? @db.Date  suspensId?                                     // [L2] versement né d'un suspens identifié
  moisRattachement @db.Date                                                     // mois de datePaiement ; mois d'identification pour un suspens (F10.5)
  montantRecu                                                                   // Z (négatif : contre-passation ou remboursement)
  // FIGÉS à la validation (section 8)
  restantDu  primeNetteRecue  accessoiresRecus  taxe  commissionDue  honorairesDus   // AA AB AC AD, commission, honoraires
  estSoldant Boolean  moisEncaissement @db.Date  moisExigibiliteTaxe @db.Date  dateLimiteReversement @db.Date
  assiettes Json                                                                // S T U V W X utilisés au calcul
  creeParId  valideParId?  valideAt?
  @@index([contratId, datePaiement, id]) @@index([remiseId]) @@index([suspensId]) @@index([referencePaiement])
  @@index([datePaiement]) @@index([moisRattachement]) @@index([moisExigibiliteTaxe]) @@index([statut, moisRattachement])
}
model EncAvancePartenaire   { id  partenaireId  remiseId  montant  montantUtilise  creeAt  @@index([partenaireId]) }   // [L1] reliquat de remise (F3 bis.3)
model EncUtilisationAvance  { id  avanceId  versementId @unique  montant }                                              // [L1]
model EncEcheance           { id  contratId  numero  dateEcheance @db.Date  montant  montantImpute  @@unique([contratId, numero]) @@index([dateEcheance]) }  // [L1]
model EncImputationEcheance { versementId  echeanceId  montant  @@id([versementId, echeanceId]) @@index([echeanceId]) }  // [L1]

model EncLigneDue {                                                                                      // [L1] (A6) une ligne = un versement × une nature
  id  versementId?  contratId  beneficiaireId  nature(TAXE|COMMISSION|HONORAIRES|ACCESSOIRES)
  origine(VERSEMENT|REGULARISATION_ANNULATION|REGULARISATION_DECLOTURE)
  montantDu  montantPaye                                                        // montantPaye = somme des affectations actives (dénormalisé)
  statut(DUE|EN_ATTENTE|PARTIELLEMENT_PAYEE|PAYEE)  motifAttente?  attenteParId?  attenteAt?
  dateEncaissement @db.Date  moisExigibilite? @db.Date  moisOrigine? @db.Date   // « encaissement de N identifié en N+x »
  bordereauId?  declarationId?                                                 // une seule appartenance courante
  @@index([beneficiaireId, nature, statut, dateEncaissement]) @@index([nature, moisExigibilite, statut])
  @@index([bordereauId]) @@index([contratId, nature]) @@index([versementId])
}
```

**Création des lignes dues (A6).** À la validation d'un versement, dans la même transaction : une ligne `origine = VERSEMENT` par nature, montants repris des valeurs figées (taxe = AD, commission, honoraires, accessoires = AC). **Aucune ligne due n'est créée pour un montant nul** (ex. accessoires = 0 ; ambiguïté 20 tranchée le 2026-09-26). Une contre-passation (versement négatif) crée ses propres lignes `VERSEMENT`, négatives ; leur traitement face à la ligne d'origine (compensation ou montant à récupérer) est l'ambiguïté 21, à trancher avant le Lot 3.

**Contrainte d'unicité (correction du 2026-09-26).** L'ancienne contrainte `@@unique([versementId, nature, origine])` interdisait deux régularisations de même nature sur un même versement (deux déclôtures successives, ou déclôture puis annulation). Elle est remplacée par :

```sql
-- une seule ligne « née du versement » par nature ; les régularisations sont illimitées
CREATE UNIQUE INDEX "EncLigneDue_versement_nature_uniq"
  ON "EncLigneDue" ("versementId", "nature") WHERE "origine" = 'VERSEMENT';
```

Chaque ligne de régularisation est reliée à son `EncRegularisation` (`ligneDueId @unique` côté régularisation, section 5.6), ce qui garantit qu'une régularisation ne crée qu'une ligne.

### 5.4 Rapprochement et suspens [L2] (A5)

```prisma
model EncCompteTresorerie { id  code @unique  libelle  type(BANQUE|ORANGE_MONEY|MTN|WAVE|AUTRE)  actif }
model EncReleve           { id  compteId  importId @unique  periodeDebut  periodeFin  soldeDebut?  soldeFin? }
model EncReleveOperation {
  id  releveId  dateOperation  montant  sens(CREDIT|DEBIT)  reference?  libelle
  statut(A_RAPPROCHER|RAPPROCHEE|NON_SAISIE|IGNOREE)
  @@index([releveId, statut]) @@index([reference]) @@index([dateOperation, montant])
}
model EncRapprochement {
  id  operationId  versementId?  remiseId?  suspensId?  montant  mode(AUTO|MANUEL)  parId  at  annuleAt?  annuleParId?
  @@index([operationId]) @@index([versementId]) @@index([remiseId])
}
model EncSuspens {
  id  numero @unique  dateReception @db.Date  montant  modePaiement  reference?  payeurPresume?  compteTresorerieId
  pieceJointeId? @unique  operationReleveId?  statut(EN_SUSPENS|PARTIELLEMENT_IDENTIFIE|SOLDE)  montantTraite  creeParId  creeAt
  @@index([statut, dateReception])
}
model EncSuspensTraitement {
  id  suspensId  type(POLICE|NON_TAXABLE|A_REMBOURSER|RECLASSEMENT|REMBOURSE)  montant
  versementId?  remiseId?  dateTraitement @db.Date  parId  motif?
  @@index([suspensId])
}
```

Un versement issu d'un suspens garde `datePaiement` = date réelle (N) et reçoit `dateIdentification` et `suspensId`. Son `moisRattachement` (verrou de clôture) est le mois d'identification, et son exigibilité se calcule depuis la date d'identification (F10.6 : identifié le 10/11 → à reverser avant le 20/11 ; le 25/11 → avant le 20/12), **pas** par la règle N+1.

### 5.5 Règlements sortants, bordereaux, créances [L2 taxes ; L3 le reste]

```prisma
model EncDeclarationTaxe {                                                                               // [L2] jamais modifiée une fois déclarée (F11.5)
  id  moisExigibilite @db.Date @unique  dateLimite @db.Date  montantDu  montantRegularisations  montantCredits
  statut(PREPAREE|DECLAREE|PAYEE)  declareeAt?  declareeParId?
}
model EncReglementSortant {                                                                              // [L2 taxe ; L3 commissions, honoraires, accessoires]
  id  numero @unique  nature  beneficiaireId  dateReglement @db.Date  modePaiement  reference  montant  periode? @db.Date
  statut(BROUILLON|VALIDE|ANNULE)  regleRepartition(PLUS_ANCIENNES|PRORATA|CONTRATS_CHOISIS|COCHES|IMPORT)?
  estAcompte Boolean  montantAffecte  pieceJointeId? @unique  importId?                                   // acompte : ambiguïté 14
  creeParId  valideParId?  valideAt?  annuleParId?  annuleAt?  motifAnnulation?
  @@index([beneficiaireId, nature, dateReglement]) @@index([reference])
}
model EncAffectation {                                                                                   // lettrage ; jamais supprimée, désactivée à l'annulation du règlement
  id  reglementId  ligneDueId  montant  bordereauId?  creeAt  annuleeAt?
  @@index([ligneDueId, annuleeAt]) @@index([reglementId])
}
model EncBordereau {                                                                                     // [L3]
  id  numero @unique  beneficiaireId  nature  periode @db.Date  genereAt  genereParId
  total  montantPaye  statut(EMIS|PARTIELLEMENT_PAYE|PAYE|ANNULE)
  @@index([statut])
}
model EncBordereauLigne     { id  bordereauId  ligneDueId  montantInitial  retireeAt?  @@index([bordereauId]) @@index([ligneDueId]) }   // [L3] historique
model EncReglementBordereau { reglementId  bordereauId  montant  @@id([reglementId, bordereauId]) }                                  // [L3]
model EncCreance {                                                                                       // [L3 surpaiement ; L4 annulation]
  id  beneficiaireId  nature  type(CREDIT_TAXE|A_RECUPERER)  montant  montantImpute
  origine(ANNULATION|SURPAIEMENT|REGULARISATION)  annulationId?  regularisationId?  statut(OUVERTE|SOLDEE)  creeAt
  @@index([beneficiaireId, nature, statut])
}
model EncImputationCreance { id  creanceId  reglementId?  declarationId?  montant  at  annuleeAt? }       // [L3/L4]
```

**Unicité du bordereau (correction du 2026-09-26).** La contrainte incluant `numero` était inutile (`numero` est déjà unique). Elle est remplacée par « un seul bordereau non annulé par bénéficiaire, nature et période » :

```sql
CREATE UNIQUE INDEX "EncBordereau_beneficiaire_nature_periode_actif_uniq"
  ON "EncBordereau" ("beneficiaireId", "nature", "periode") WHERE "statut" <> 'ANNULE';
```

Un bordereau annulé libère ses lignes (`EncLigneDue.bordereauId` remis à NULL, `EncBordereauLigne.retireeAt` renseigné) et un nouveau bordereau peut être généré pour la même période.

### 5.6 Annulations, régularisations, clôture [L4]

```prisma
model EncAnnulation {
  id  contratId @unique  type(SANS_EFFET|RESILIATION|NON_PAIEMENT)  dateAnnulation @db.Date  motifId  pieceJointeId? @unique
  primeAcquise  encaisseALaDate  remboursementDu  restantDuRamene  importId?  creeParId  creeAt
}
model EncRegularisation {                                                  // datée du jour d'annulation ou de la re-clôture ; les versements restent intacts (§5.7)
  id  annulationId?  clotureId?  contratId  versementId?  nature(PRIME|TAXE|COMMISSION|HONORAIRES|ACCESSOIRES)
  montant(signé)  dateEffet @db.Date  moisRattachement @db.Date  ligneDueId? @unique  creanceId? @unique
  @@index([contratId]) @@index([moisRattachement])
}
model EncMois    { mois @db.Date @id  statut(OUVERT|CLOTURE)  versionCourante Int  clotureAt?  clotureParId? }
model EncCloture {
  id  mois  version  action(CLOTURE|DECLOTURE)  parId  at  motif?  checklist Json  derogations Json?
  @@index([mois, version])
}
model EncEtatFige {                                                        // « tel que déclaré » (F11.2) et version corrigée (F11.6)
  id  mois  version  etat(TABLEAU_BORD|TAXES|DETAIL_TAXES|COMMISSIONS|HONORAIRES|ENCAISSEMENTS|IMPAYES|ANNULES|REFERENCES)
  parametres Json  contenu Json  sha256  genereAt
  @@unique([mois, version, etat])
}
```

**Verrou de clôture.** Toute écriture détermine son `moisRattachement` (versement, régularisation) ou sa date (règlement, contrat) et refuse si `EncMois.statut = CLOTURE`. Pour un suspens identifié, c'est le mois d'identification qui compte : les états de N ne bougent pas.

### 5.7 Volumétrie

Environ 200 000 versements et 800 000 lignes dues par an, soit 2 M et 8 M sur dix ans, plus le journal d'audit.
- **Concurrence** : un verrou de ligne sur le contrat (`SELECT … FOR UPDATE`) pendant le calcul et le figement d'un versement (AA et le reliquat dépendent du cumul).
- **Fiche contrat < 2 s** : totaux dénormalisés sur `EncContrat`.
- **Listes** : pagination côté serveur uniquement, recherche par index (police, `PaiementID`, référence).
- **Répartition d'un bordereau de 1 000 lignes < 5 s** : s'appuie sur l'index `(bénéficiaire, nature, statut, dateEncaissement)`.

---

## 6. Mise en service, audit et séquences

1. **Hors purge globale (A2).** `ReinitialisationSysteme` ne touche aucune table `Enc*` et on n'y ajoute rien.
2. **Mise en service = remise à zéro + activation, en une seule action** : permission `enc.mettre_en_service` (DG seul, hors `estAdmin`), même protocole que la réinitialisation globale (sauvegarde JSON liée par empreinte SHA-256, mot de confirmation, une transaction sérialisable).
   - **Purgé** : toutes les tables transactionnelles `Enc*`, `EncAudit` (hors lignes des référentiels), `EncSequence`, `EncPieceJointe` (fichiers supprimés après le commit).
   - **Conservé** : référentiels (produits, partenaires, bénéficiaires, taux, types d'opération, comptes, motifs, paramètres) et leurs lignes d'audit, pour garder l'historique des taux (CDC §3.8).
   - **En fin de transaction** : création de la ligne `EncMiseEnService`.
3. **Immuabilité de l'audit.** Les triggers existent dès la migration du Lot 1, mais sont **conditionnels** :
   - `EncAudit` : `UPDATE` toujours interdit ; `DELETE` interdit dès qu'une ligne `EncMiseEnService` existe. La recette peut donc nettoyer avant la mise en service, plus rien ne s'efface ensuite.
   - `EncMiseEnService` : `UPDATE` et `DELETE` toujours interdits.
   - **Limite** : l'application se connecte en `postgres` (superutilisateur), qui peut désactiver un trigger. Le trigger protège des erreurs de code, pas d'un administrateur de base. Une vraie immuabilité sur 10 ans exige un rôle PostgreSQL applicatif avec `INSERT`/`SELECT` seulement sur `EncAudit` (décision d'infrastructure, à prendre avec le binôme).
4. **Séquences.** `UPDATE "EncSequence" SET valeur = valeur + 1 WHERE cle = $1 RETURNING valeur` (verrou de ligne implicite), jamais `count()+1`.
   - **Clés** : `PAI-AAAA`, `SUS-AAAA`, `RGS-AAAA` par année ; `BRD-AAAA-MM` par mois (numérotation `BRD-AAAA-MM-NNNN` qui repart à 1 chaque mois).
   - **Mise en service** : séquences purgées (aucun numéro de recette n'a de valeur réelle).
   - **Après mise en service** : trigger interdisant `DELETE` et toute baisse de `valeur`.
   - **Import** : les `PaiementID` du classeur (colonne B) sont conservés ; l'import remonte la séquence au maximum importé de chaque année, sinon la première saisie à l'écran reprendrait un numéro existant.
   - **Année du numéro** : ambiguïté 15.

---

## 7. Taux : unité et contrôle des chevauchements

**Unité (A4).** Fraction décimale `Decimal(7,6)` : `0.072500` pour 7,25 %. Contrôle 0 ≤ taux ≤ 1 (CDC §3.8). Saisie et affichage en %, conversion à la frontière (action serveur, import). Les taux implicites (CDC §3.7) ne sont jamais stockés. Si le fichier de paramétrage est fourni en % (« 7,25 »), l'import le convertit.

**Chevauchements.** Une contrainte d'exclusion PostgreSQL est écartée : avec `partenaireId` NULL, l'opérateur `=` vaut NULL et les taux par défaut du produit ne seraient jamais protégés ; de plus `btree_gist` demande un `CREATE EXTENSION` en superutilisateur. À la place :
- **Contrôle applicatif transactionnel** : chaque écriture de taux commence par `SELECT … FROM "EncProduit" WHERE id = $1 FOR UPDATE` (sérialise toutes les écritures d'un produit, quel que soit le partenaire), puis cherche un chevauchement avec `"partenaireId" IS NOT DISTINCT FROM $2` et `COALESCE("dateFin", 'infinity')`, sur des intervalles fermés.
- **Filet en base, sans extension** (migration SQL, Prisma n'exprime pas les index partiels) :
  ```sql
  CREATE UNIQUE INDEX "EncTaux_produit_defaut_en_cours_uniq"
    ON "EncTaux" ("produitId") WHERE "partenaireId" IS NULL AND "dateFin" IS NULL;
  CREATE UNIQUE INDEX "EncTaux_produit_partenaire_en_cours_uniq"
    ON "EncTaux" ("produitId", "partenaireId") WHERE "partenaireId" IS NOT NULL AND "dateFin" IS NULL;
  ```
- **Import du paramétrage** : une seule transaction, produits verrouillés dans un ordre fixe (par `id`) pour éviter tout interblocage.

Résolution d'un taux à la date de production : la ligne produit × partenaire valable, champ par champ, à défaut la ligne produit valable (« un taux laissé vide reprend celui du produit »).

---

## 8. Règle d'arrondi du prorata — PROVISOIRE (A7)

Calcul en `Prisma.Decimal`, arrondi `toDecimalPlaces(2, ROUND_HALF_UP)`.

- **Versement non soldant** : AB = arrondi(T·Z/S) ; AC = arrondi(U·Z/S) ; **AD = Z − AB − AC** ; commission = arrondi(W·Z/S) ; honoraires = arrondi(X·Z/S), arrondis indépendamment.
- **Versement soldant** (AA = 0) : chaque composante = total du contrat − somme des versements précédents (reliquat exact).
- **Contre-passation** : copie négative exacte des valeurs figées, jamais recalculée (évite l'asymétrie de l'arrondi sur les négatifs).

### Vérification manuelle

**CDC §9.1** (S = 1 500 ; T = 1 398,60 ; U = 0 ; V = 101,40 ; W = 251,75 ; X = 34,97)

| Vers. | Z | AB | AD = Z − AB | Commission | Honoraires | Conforme |
|---|---|---|---|---|---|---|
| 1 | 500 | 466,20 (exact) | 33,80 | 83,9166… → 83,92 | 11,6566… → 11,66 | oui |
| 2 | 700 | 9 790,2 ÷ 15 = 652,68 (exact) | 47,32 | 117,4833… → 117,48 | 16,3193… → 16,32 | oui |
| 3 (soldant) | 300 | 1 398,60 − 466,20 − 652,68 = 279,72 | 101,40 − 33,80 − 47,32 = 20,28 | 251,75 − 83,92 − 117,48 = 50,35 | 34,97 − 11,66 − 16,32 = 6,99 | oui |

Contrôles : 279,72 + 0 + 20,28 = 300 = Z. §9.3 : 83,92 + 117,48 = 201,40 dus ; non acquis 251,75 − 201,40 = 50,35. §9.4 : 1 500 × 15 ÷ 31 = 725,806 → 725,81.

**CDC §9.7** (taxe 7,25 %, pas d'accessoires, T/S = 1/1,0725 = 0,9324009324…)

| Police | Z | T·Z/S exact | AB | AD | Conforme |
|---|---|---|---|---|---|
| A | 100 000 | 93 240,0932… | 93 240,09 | 6 759,91 | oui |
| B | 90 000 | 83 916,0839… | 83 916,08 | 6 083,92 | oui |
| C | 60 000 | 55 944,0559… | 55 944,06 | 4 055,94 | oui |
| Total | 250 000 | | 233 100,23 | 16 899,77 | oui |

**CDC §9.9** : 200 000 / 1,0725 = 186 480,1865… → AB = 186 480,19 ; AD = 13 519,81. Conforme. Les 100 000 non taxables ne créent aucun versement.

### Divergences signalées

1. **§9.7 et §9.9 ne donnent pas la prime S des contrats** (ambiguïté 19). Le calcul ci-dessus suppose T/S = 1/1,0725 exact ; en réalité T est stocké au centime (ou pris du fichier). L'écart, au plus 0,005 × Z/S, peut faire basculer un arrondi proche de la demi-unité : police C à 0,0009 du seuil (bascule vers 55 944,05 dès que Z/S > 0,18 avec un T arrondi par défaut), police B à 0,0011. Aucun risque si ces versements soldent leur contrat. Dans la tolérance de recette (1 FCFA).
2. **Contrat incohérent, T + U + V ≠ S** (ambiguïté 18, en attente du client) : toléré à 1 FCFA en saisie, **accepté à l'import quel que soit l'écart** (§9.8 : 50 FCFA). Hors versement soldant, AD = Z − AB − AC diffère de V·Z/S. Sur le versement soldant, les deux invariants du CDC §5.2 ne peuvent plus tenir ensemble : soit ΣAD = V (reliquat exact de V) mais AB + AC + AD ≠ Z, soit AB + AC + AD = Z mais ΣAD ≠ V.

### Moteur de calcul (`backend/src/encCalcul.ts`, commit 2)

Fonctions pures, aucun accès à la base, couvertes par `backend/src/encCalcul.test.ts` (vitest, `npm test`).
- **Décimal** : clone local de decimal.js (`EncDecimal`, arrondi half-up), jamais `Decimal.set` global. Entrées : chaînes ou
  objets « Decimal.js-like » (dont `Prisma.Decimal`, converti par `toFixed()` : le `Decimal` embarqué par Prisma n'est pas
  reconnu comme instance par un autre clone). Un `number` est refusé à la compilation et à l'exécution. Sorties acceptées
  telles quelles par Prisma.
- **Paramètres en arguments** : délai d'exigibilité et jour limite (viendront d'`EncParametre`).
- **Règle d'arrondi** : isolée dans `regleArrondiProvisoire` (seule fonction à modifier si l'ambiguïté 18 est tranchée
  autrement) ; `calculerVersement` accepte une autre règle en paramètre.
- **Saisie directe** : base « prime TTC » refusée pour la taxe et les accessoires (circulaire, ambiguïté 7), acceptée pour la
  commission et les honoraires.
- **Calcul inverse** : défini seulement pour les bases par défaut et des accessoires en taux (refus explicite sinon) ;
  V = S − T − U pour que la prime TTC saisie reste exacte.
- **Trop-perçu** : refusé par le moteur ; sa validation par le responsable est un circuit à part (ambiguïté 16).
- **Échéancier** : montants **tronqués** au centime, reliquat sur la dernière (la dernière ne peut jamais être négative) ;
  jour de la date d'effet conservé, ramené au dernier jour du mois s'il n'existe pas (31/01 → 28/02 → 31/03).
- **Semaine ISO** : libellé « Sem N - AAAA » sans zéro devant le numéro, année ISO.

---

## 9. Fichiers partagés avec le binôme (Pointage RH / FeedbackApp)

Auteurs d'après `git log` au 2026-09-26.

| Fichier | Auteurs | Modification nécessaire |
|---|---|---|
| `backend/prisma/schema.prisma` | Arist 19, Thierry 5 | Modèles `Enc*`, relations inverses sur `User` (≈ 20), valeur `ENCAISSEMENTS` dans `NotificationCategory` |
| `backend/prisma/migrations/` | les deux | Nouvelles migrations : coordonner l'ordre des horodatages (une migration insérée avant une migration déjà appliquée est refusée) |
| `backend/prisma/seed.ts` | Arist 9, Thierry 2 | Module `encaissements`, permissions `enc.*`, 5 rôles, bénéficiaires uniques, comptes de test |
| `backend/src/index.ts`, `client-safe.ts` | les deux | Exports du module |
| `frontend/src/app/(dashboard)/page.tsx` | Thierry 6, Arist 3 | Carte du module (lien, icône, raison d'accès) |
| `nav.ts`, `Sidebar.tsx`, `AppShell.tsx`, `(dashboard)/layout.tsx` | Arist majoritaire, Thierry 2 à 5 | Branche « Encaissements » et booléens de permission |
| `frontend/src/lib/topbarAlerts.ts` | Thierry | Alertes « taxes à reverser avant le 20 », « échéances en retard » |
| `NotificationDetailModal.tsx`, `NotificationDrawer.tsx`, `lib/notifications/notificationService.ts` | Thierry | La modale a un type union de catégories codé en dur ; le tiroir affiche selon la catégorie : ajouter `ENCAISSEMENTS` |
| `lib/auth.ts`, `auth.config.ts`, `proxy.ts`, `(auth)/*` | les deux (+ 2) | Double authentification du Responsable (CDC §8.3) : champs sur `User`, étape après le mot de passe, exemption du middleware |
| `app/api/cron/*` + planification (`docker-compose.*.yml`, `DEPLOIEMENT.md`) | Thierry (cron absences) | Crons : échéances en retard, rappels de taxes, alertes de suspens (même `CRON_SECRET`) |
| `delegations/actions.ts` | Arist | `MODULES_DELEGABLES` : ajouter `"encaissements"` si la délégation est voulue |
| `admin/users/actions.ts` | Arist | `supprimerUtilisateurAction` : compter les nouvelles relations vers `User` |
| `package.json` (racine, backend, frontend), lockfile | les deux | vitest (commit 2), parseur CSV (Lot 2) |
| `CLAUDE.md` | les deux | Section du module |

Sans modification : `admin/roles/page.tsx` et `/admin/modules` (génériques), `getAccessibleModules` (le module apparaît par ses permissions), `reinitialisation.ts` (A2).

---

## 10. Ambiguïtés du cahier et statut

Statuts : **OUVERT** (à trancher), **PROVISOIRE** (retenu en attendant confirmation), **TRANCHÉ** (daté).

| # | Sujet | Statut |
|---|---|---|
| 1 | Un import de production par l'équipe technique ou la finance crée des versements (colonne Z), alors que la technique ne peut pas « saisir ou valider des encaissements » (§2) | OUVERT |
| 2 | Versements « figés à la validation » (§3.2) mais « recalculés » si la prime change (F2.4) ; rang « recalculé » (col. R) : un versement antidaté décale rangs et reliquat ; la correction d'un versement validé par le Responsable n'est pas décrite | OUVERT |
| 3 | Types d'annulation : F4.2 « sans effet / résiliation / ristourne » ; §5.7 « sans effet / résiliation / non-paiement » | OUVERT |
| 4 | Double source du statut Annulé (§3.1 statut d'annulation, §5.6 statut calculé) | OUVERT |
| 5 | Aucun profil n'a la validation d'un versement (Brouillon → Validé) ; F3.7 suggère une validation immédiate à l'enregistrement | OUVERT |
| 6 | Statut « Rapproché » d'un versement (F9.5) absent de la liste §3.2 — proposition : attribut `rapprocheAt`, le statut reste Validé | PROVISOIRE |
| 7 | Base de taux « prime TTC » (§3.7) : calcul circulaire, aucune formule inverse (§5.1) | OUVERT |
| 8 | Règle d'arrondi du prorata non définie | PROVISOIRE (2026-09-26, section 8) |
| 9 | §9.6 : bordereau « de 1 000 000 » alors que 12 000 de lignes En attente « n'y figurent pas » (988 000 ?) | OUVERT |
| 10 | Renouvellements et avenants : même police ou nouvelle ? évolution de la prime ? | OUVERT |
| 11a | Lot de rattachement de F10 (suspens) | TRANCHÉ 2026-09-26 : Lot 2 |
| 11b | Date de situation D (§5.4) « hors annulations » : traitement d'une annulation datée après D | OUVERT |
| 12 | Divers : « six objets principaux » (§3) ; bénéficiaires des honoraires et accessoires non définis (provisoire : bénéficiaires uniques créés par le seed) ; option O2 absente du §11 ; avances et acomptes sans règle détaillée | OUVERT |
| 13 | Double authentification du Responsable (§8.3) : absente du projet, dans aucun lot | OUVERT |
| 14 | Acompte non affecté (F5.6) vs « somme des affectations = montant du règlement » (§8.1) | OUVERT |
| 15 | Année des numéros `PAI-AAAA` / `SUS-AAAA` : année de saisie ou de paiement | OUVERT |
| 16 | Trop-perçu (§5.3) : « report sur un autre contrat » non décrit ; soumis à la clôture du mois d'origine ? | OUVERT |
| 17 | Régularisation après déclôture (F11.5) : née automatiquement à la re-clôture ou saisie ? | OUVERT |
| 18 | Contrat incohérent (T + U + V ≠ S) : invariant prioritaire au versement soldant (ΣAD = V ou AB + AC + AD = Z) | OUVERT — en attente du client |
| 19 | §9.7 et §9.9 ne donnent pas la prime S : écart possible de 0,01 sur une ligne (dans la tolérance) | OUVERT (non bloquant) |
| 20 | Lignes dues à montant nul (ex. accessoires = 0) : créées ou non ? | TRANCHÉ 2026-09-26 : aucune ligne due créée pour un montant nul |
| 21 | Lignes dues négatives issues d'une contre-passation : compensation avec la ligne d'origine si elle n'est pas payée, montant à récupérer si elle est payée ? | OUVERT — à trancher avant le Lot 3 |
| 22 | Suspens identifié PILE le jour limite (le 20) : déclaration du mois ou du mois suivant ? L'échéance du jour même « suit »-elle l'identification (F10.6) ? Choix provisoire du moteur : mois suivant | OUVERT (choix provisoire documenté par un test) |

---

## 11. Découpage en commits (Lot 1)

1. **Docs** : cahier des charges, ce document, section du module dans `CLAUDE.md`.
2. **Moteur de calcul pur** : vitest, `encCalcul.ts` (clone local de decimal.js, compatible `Prisma.Decimal`, aucune dépendance à la base), tests sur §9.1, 9.3, 9.4 (prime acquise), 9.7, 9.8 (saisie directe et calcul inverse), 9.9 et cas limites.
3. **Fondations** : module `encaissements`, permissions `enc.*`, 5 rôles, `EncSequence`, `EncAudit` + triggers conditionnels, `EncPieceJointe` et sa route, `EncParametre`, `EncMiseEnService`, câblage navigation et tableau de bord.
4. **Référentiels** : produits, partenaires (+ bénéficiaires), types d'opération, taux (contrôle de chevauchement de la section 7), écrans, import/export Excel du paramétrage.
5. **Contrat** : création et modification (saisie directe, calcul inverse), fiche, recherche paginée, contrôles bloquants §8.1.
6. **Versement** (F3) : verrou, valeurs figées, `PaiementID`, **lignes dues créées dans la même transaction**, contre-passation, alerte de référence en double, trop-perçu.
7. **Échéancier** (F8).
8. **Encaissement groupé** (F3 bis) et avance partenaire.
9. **Import de production** (F1) : aperçu puis confirmation, rapport, remontée des séquences.
10. **Export Excel** du registre (§7, colonnes A à AH) et états du Lot 1.
11. **Mise en service et recette du Lot 1** : action `enc.mettre_en_service`, scripts sur les cas chiffrés, jeu de 200 000 versements pour les temps de réponse, documentation.
