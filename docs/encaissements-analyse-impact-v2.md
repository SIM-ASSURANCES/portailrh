# Module Encaissements — analyse d'impact du cahier des charges V2

> Analyse du 2026-09-28, **mise à jour pour la V2.6** (la version de référence). Elle a servi à réécrire la conception
> ([encaissements-conception.md](encaissements-conception.md)), qui fait désormais foi pour tout choix technique. Les
> décisions du 2026-09-28 y sont reportées ; ce document garde le raisonnement et les écarts constatés.

## 0. Sources et versions

| Document | Emplacement | Remarque |
|---|---|---|
| Cahier des charges **V2.6** (référence) | [cahier-des-charges-encaissements-v2.md](cahier-des-charges-encaissements-v2.md) | Remplace entièrement le V1 et les « Réponses aux questions » du 28/09 ; **fait foi en cas de différence avec la maquette** |
| Maquette (référence) | [Maquette_registre_paiements.html](Maquette_registre_paiements.html) | Prototype JS autonome, sans données réelles |
| Cahier V1 | [archive/cahier-des-charges-encaissements.md](archive/cahier-des-charges-encaissements.md) | Remplacé |
| Réponses du 28/09 | [archive/encaissements-reponses-2026-09-28.md](archive/encaissements-reponses-2026-09-28.md) | Remplacées (texte extrait du document Word) |
| Relevé Wave d'août 2026 | `C:\Projets\donnees-sensibles\`, hors dépôt (voir section 6) | **Données clients, jamais dans le dépôt** |

Une première version de cette analyse portait sur la **V2.4** et une maquette antérieure. Écarts constatés avec la V2.6
(comparaison mot à mot, mise en forme ignorée) — **il n'y en a pas d'autre** :

| Point | V2.4 | V2.6 |
|---|---|---|
| Titre | « Encaissements, taxes, commissions, honoraires et accessoires » | « Module Encaissements, taxes » |
| En-tête | « remplace la version 1 et le document Réponses » | Remplace **entièrement** le V1 et les Réponses ; **fait foi face à la maquette** ; « seul ce document compte » |
| Principe 2 | L'utilisateur ne saisit que des encaissements | + **aucun contrat créé à l'écran** ; encaissements par **trois voies seulement** : fichier de production (F1), saisie à l'écran (F3, F4, F6), relevé (F5) ; **aucun autre import d'encaissements** |
| F1.5 reprise initiale | Paiements importés confirmés, sur décision au 1er import | **Entièrement réécrite** : une seule fois ; confirmés ; **prise en compte = date de paiement réelle** (pas de « Régularisation ») ; **date de bascule par nature** comparée à la **colonne A** → « payé (reprise) » ; décision SIM : taxes au 30/09/2026, les trois autres sans bascule ; **taux d'accessoires saisis avant** ; exceptions corrigées en décochant ; **rapport de reprise par nature et par branche, pour contrôle avant validation** |
| F4.2 | « Il ajoute les polices réglées » | « **Ajouter une ligne** » en choisissant une police **existante** ; **ne crée pas de police** |
| 9.13 | Annulation par le fichier, type non précisé | Données chiffrées (taxe 101,40, commission 251,75, 500 encaissés, commission 83,92 payée) et **deux cas** : sans effet + remboursement par contre-passation (taxe non encaissée 67,60 annulée ; commission due 0 → « à régulariser » 83,92) ; **non-paiement** (1 000 abandonnés, taxe 67,60 annulée, l'encaissement de 500 reste acquis avec 33,80 de taxe et 83,92 de commission, rien à régulariser) |

La maquette de référence ne diffère de celle analysée d'abord que par un libellé : « **+ Ajouter une ligne (police
existante)** » (au lieu de « Ajouter une police »).

---

## 1. Écarts V1 → V2.6, section par section

### 1.1 Principes et périmètre

| | V1 | V2.6 |
|---|---|---|
| Nature | Registre + règlements sortants, bordereaux, clôture mensuelle | « Pas un outil comptable » : **ni écritures, ni clôture**. Les paiements sortants se font hors application puis sont **cochés « payés »**. |
| Contrats | Import **ou** saisie à l'écran (saisie directe, calcul inverse) | **Uniquement le fichier de production**, jamais créés à l'écran ; montants jamais recalculés ni saisis |
| Entrée des encaissements | Saisie, import d'encaissements, remises | **Trois voies** : fichier de production (F1), saisie (F3, F4, F6), relevé (F5) ; **pas d'autre import** |
| Statut | Brouillon → Validé | Fichier : **à confirmer → confirmé / non reçu** ; saisie : confirmé dès l'enregistrement ; **seul le confirmé compte** |
| Branche | Absente | **Partout** |
| Espèces | — | Interdites |

### 1.2 Utilisateurs et droits (§2)

- **Disparaissent** : Gestionnaire, Responsable, Audit, double validation, dérogation de clôture.
- **3 profils** : Équipe technique (produire, importer, annuler un contrat, consulter les signalements) ; Finance (tout le reste, **sauf** annuler un contrat et modifier les montants du fichier) ; Consultation (consulter, exporter).
- Chaque action tracée (qui, quand, avant, après).

### 1.3 Données (§3)

| Objet | V1 | V2.6 |
|---|---|---|
| Contrat | Saisi ou importé ; taux par produit/partenaire | Colonnes C à Y du fichier en **lecture seule** ; **branche obligatoire** ; seule saisie : part partenaire / SIM des accessoires propre à la police |
| Encaissement | Brouillon/Validé, rang, rapprochement | Source, statut (à confirmer / confirmé / non reçu), dates de saisie, de confirmation, **de prise en compte**, motif de non-réception, référence groupée, montants **figés à la confirmation** (dont parts d'accessoires et mois d'exigibilité), **4 marquages « payé »** (date + référence) ; référence obligatoire (Wave `T_…`) ; PAI = année de **saisie** |
| Argent non identifié | Suspens, classement non taxable / à rembourser, échéances | SUS ; non affecté / affecté / **classé hors prime** ; affectation comme F4 |
| Nouveaux | — | **Signalement** (police connue qui revient), **frais des opérateurs** (par opérateur et par mois) |
| Paramètres | Taux datés par produit/partenaire, délai d'exigibilité, clôture | **Honoraires datés** (NOVELIA) ; **jour limite 1–28** ; **partage des accessoires** (partenaire, police, défaut) ; **taux de contrôle** (signalement seulement) ; délai N+1 fixe |
| Disparaissent | — | Règlements sortants, affectations, **bordereaux**, lettrage, créances « à récupérer », **clôture**, échéancier, taux servant au calcul |

### 1.4 Fonctionnalités (§4)

| V1 | V2.6 | Impact |
|---|---|---|
| F1 import (contrats + versements) | **F1** : branche (colonne ou choix), totaux de contrôle, police nouvelle → contrat + paiement **à confirmer**, police connue → mise à jour + **table de cas** (déjà présent, doublon possible à 1 FCFA et 7 jours, à compléter, Wave non conforme, autre cas, sans paiement), **reprise initiale réécrite** (voir 0), lignes annulées importées par la Finance **rejetées**, écarts signalés sans bloquer | Signalement ; règles de doublon et de reprise en fonctions pures |
| F2 contrat (saisie directe, calcul inverse) | **F2 « Appeler une police »** : recherche globale multi-mots, reste dû | Plus de saisie de contrat |
| F3 versement | **F3** : saisie dans la fiche, reste dû proposé, confirmé et figé, **ordre de prise en compte**, « Régularisation » ; **correction (motif) ou contre-passation** (copie négative exacte, taxe retirée du même mois si non payée, sinon « à régulariser ») | Contre-passation conservée ; « correction » à définir (A8) |
| F3 bis encaissement groupé, avance partenaire | **F4** : saisie unique, « Ajouter une ligne » **sur une police existante**, écart nul exigé, référence partagée non signalée | Plus d'avance partenaire |
| F4 annulation | **F8** (équipe technique ; badge ; 3 types ; « à régulariser ») | Lot 4 |
| F5 bordereaux, F6 règlements, F7 lettrage | **F7 « Marquer payés »** (4 cases, « Tout payé » par nature, « toutes les taxes du mois », décocher tracé) | Suppression règlements/bordereaux |
| F8 échéancier | Supprimé ; §5.5 mensualités sans traitement | `repartirEnEcheances` inutile |
| F9 rapprochement | **Intégré à F5** : relevé, 4 groupes, **transaction partagée**, confirmation automatique mémorisée, **frais des opérateurs** | Relevé et frais |
| F10 suspens | **F6 « Argent non identifié »** | Plus d'échéances qui « suivent » |
| F11 clôture | Supprimé | |
| — | **F5** confirmation (ligne, lot, non reçu, finalement reçu, export) ; **F9** paramètres ; **F10** exports | Nouveaux |

### 1.5 Règles de calcul (§5)

| Règle | V1 | V2.6 |
|---|---|---|
| Ce qui compte | Validés | **Confirmés uniquement** |
| Prorata | Arrondi provisoire | Même formule ; reliquat exact au soldant ; incohérence : « **la taxe totale encaissée est celle du fichier** » |
| Ordre | Date / rang recalculé | **Ordre de prise en compte** |
| Exigibilité | N + délai ; suspens : échéance suivante | max(mois de paiement + 1 ; mois de prise en compte, ou suivant si **le jour limite ou après**) ; jour limite 1–28 ; « Régularisation » |
| Accessoires | Non défini | Police > partenaire > défaut ; **figé** ; changement de taux applicable aux parts non payées ; part payée jamais modifiée |
| Mensualités | Échéancier | Prorata simple |
| Trop-perçu | Validation du responsable | **Alerte** sur toutes les voies ; remboursement ou report (contre-passation + nouvel encaissement daté du report) |
| Commission payée puis annulée | « À récupérer » calculé | « **À régulariser** », sans calcul |

### 1.6 États, formats, contrôles, lots

Inchangés entre V2.4 et V2.6 : 7 onglets ; états par branche ; relevés (§7.2) ; export A–AH + 16 colonnes (§7.3) ;
contrôles §8.1 ; exigences §8.2 (double authentification au niveau du portail, compte applicatif, audit 10 ans,
50 000 contrats et 200 000 encaissements/an, recherche < 1 s, fiche < 2 s, import de 5 000 lignes < 2 min) ; 16 cas
de recette ; 4 lots.

---

## 2. Code déjà committé : garder / adapter / supprimer

Règle : **aucune migration poussée n'est modifiée** ; tout passe par une **migration corrective**.

### 2.1 Moteur de calcul (`encCalcul.ts`, `encCalcul.test.ts`)

Le moteur actuel reproduit déjà **9.8** (AD 67,60 × 3 puis 608,39, total 811,19) et **9.6** (AC 50 ; 20/30 ; 35/15 ;
25/25).

| Élément | Décision |
|---|---|
| `EncDecimal`, `montant`, `arrondirCentime`, dates UTC, `MontantsContrat` | **Garder** |
| `regleArrondiProvisoire` | **Garder, devient définitive** (arbitrage du 2026-09-28 : calcul et stockage au centime, AB et AC arrondis half-up, AD = Z − AB − AC, commission et honoraires arrondis indépendamment, reliquat exact au soldant ; affichage arrondi à l'unité). Renommer en conséquence. |
| `calculerVersement` | **Adapter** : ordre de prise en compte (le cumul reste fourni par l'appelant) ; trop-perçu **autorisé sur demande explicite** (ventilation de l'excédent : A6) ; nouvelle prime d'un avenant (A4 tranchée : reliquat sur les nouveaux totaux ; prime inférieure à l'encaissé → alerte trop-perçu) |
| `contrepasser` | **Garder** ; reporter le mois d'exigibilité d'origine |
| `calculerExigibilite` / `calculerExigibiliteSuspens` | **Remplacer** par une fonction unique (paiement, prise en compte, jour limite 1–28) ; le cas « pile le jour limite → mois suivant » devient une règle du cahier |
| `semaineIso`, `calculerDdf`, `statutContrat`, `statutPaiement`, `calculerEffetAnnulation` | **Garder** (effet d'annulation : Lot 4, vérifié par 9.13) |
| `situationNature` | **Adapter** : « à récupérer » → signal « à régulariser » |
| `decomposerDepuisPrimeTtc`, saisie directe, `repartirEnEcheances` | **Supprimer** |
| `decomposerDepuisPrimeNette` | Supprimer, ou isoler pour les **taux de contrôle** quand leur base sera connue (A20) |
| Nouveau | `partagerAccessoires` (arrondi : A7), résolution du taux (police > partenaire > défaut), bénéficiaire des honoraires à une date, règles de doublon F1, règles de reprise F1.5, rapprochement F5 (4 groupes, transaction partagée), agrégation des frais |

**Tests renumérotés selon la recette V2.6** : 9.1 (inchangé) ; ancien 9.7 → **9.4** ; ancien 9.9 → **9.5** ; **9.6**
et **9.8** ajoutés ; ancien 9.8 (calcul inverse) et « échéancier » supprimés ; « exigibilité » remplacé par le tableau
§5.3 ; prime acquise → cas limites du Lot 4 avec **9.13** (sans effet et non-paiement) ; 9.3, 9.7, 9.10, 9.11 en
fonctions pures au fil des commits.

### 2.2 Commit 3a — permissions et rôles

- `encPermissions.ts` : 3 rôles, 3 comptes de test (jamais en production), **9 permissions validées** le 2026-09-28 (section 8).
- **Migration corrective** : nouvelles permissions ; retrait des obsolètes et de leurs attributions ; rôles « Gestionnaire » et « Responsable » **supprimés s'ils n'ont aucun compte, sinon la migration s'arrête avec un message** (décision du 2026-09-28) ; arrêt aussi si une délégation pointe sur une permission `enc.*` supprimée.
- `encPermissions.test.ts` réécrit sur l'état final ; seed adapté ; navigation et garde de la matrice gardées ; libellé du module « Encaissements, taxes » (A32 tranchée).

### 2.3 Commit 3b — socle

| Élément | Décision |
|---|---|
| `EncSequence` | Garder ; **retirer RGS et BRD** ; `remonterSequence` **sert** à la reprise (A1, A1b tranchées) |
| `EncAudit` + triggers, `EncMiseEnService` | Garder (remise à zéro avant production conservée) |
| `EncParametre` | Retirer `taxe.delai_exigibilite_mois` (ligne supprimée par la migration corrective) ; jour limite **1–28** ; ajouter `accessoires.part_partenaire_defaut` (0) |
| Honoraires, accessoires | Table `EncBeneficiaireHonoraires` datée ; colonnes de partage sur partenaire et contrat — **nécessaires dès le Lot 1** (montants figés à la confirmation, reprise) |
| `EncPieceJointe` | Garder : **conserve les fichiers importés** comme preuve ; **relevés téléchargeables par la Finance seulement**, **fichiers de production par la Finance et l'équipe technique** (données clients) |

---

## 3. Modèle Prisma V2

Le modèle détaillé est dans la conception, section 5 (à jour des décisions du 2026-09-28). Changements par rapport à la
première version de cette analyse :

- `EncImport` : statut **APERÇU / VALIDÉ / ABANDONNÉ** (le rapport de reprise se contrôle **avant validation**) et, pour la reprise, les **quatre dates de bascule** par nature.
- Marquages « payé » : une **source** (MANUEL / REPRISE) par nature, pour la mention « reprise ».
- `EncBranche` : liste **paramétrée par la Finance** (provisoire) ; une valeur inconnue dans un fichier est signalée au lieu de créer une branche.
- `EncEncaissement.paiementId` = **notre numéro PAI** (repris du classeur à la reprise, généré sinon) ; **`paiementIdFichier`** (champ séparé) = PaiementID d'un fichier mensuel, clé anti-doublon seulement ; l'export écrit notre numéro en colonne B.

---

## 4. Maquette : apports et écarts avec le cahier

### 4.1 Au-delà du cahier (à reprendre sauf décision contraire)

Liste de polices avec filtres et barre de versements ; fiche en lecture seule avec quatre cadres et « Tout payé » ;
onglet Taxes riche (indicateurs, tableau mensuel, reversements par mois avec statut en retard) ; normalisation des modes à
l'import et mode inconnu affiché « (à corriger) » ; contrôle de référence par ligne (manquante / en double / OK) ;
recherche F2 (2 caractères, tous les mots, 15 résultats) ; lecture des relevés (en-tête sur 15 lignes, colonnes par
mots-clés, Wave reconnu par ses en-têtes, opérateur déduit du nom de fichier) ; groupe 3 limité à une suggestion par
ligne ; lignes du relevé déjà confirmées ignorées ; paramètres (part partenaire ou SIM, l'autre se complète ; nombre de
polices par partenaire ; ajout manuel).

### 4.2 Écarts maquette ↔ cahier (le cahier fait foi)

| # | Maquette | Cahier | Statut |
|---|---|---|---|
| M1 | Ordre par date de paiement | Ordre de prise en compte | Suivre le cahier |
| M2 | Recalcul à l'affichage, flottants | Figé à la confirmation, décimal exact | Suivre le cahier |
| M3 | Versement et contrat supprimables, versement modifiable | Jamais supprimé ; correction ou contre-passation | Suivre le cahier |
| M4 | « Nouveau contrat » avec calcul inverse | Aucun contrat créé à l'écran (principe 2) | Ne pas reprendre |
| M5 | Dépassement bloquant dans la fiche | Alerte, la Finance confirme | Suivre le cahier |
| M6 | Motif de non-réception facultatif | Obligatoire | Suivre le cahier |
| M7 | « Ajouter quand même » crée un encaissement confirmé | Non précisé | OUVERT (A11) |
| M8 | « Payé » = date du jour, sans référence | Date et référence | Suivre le cahier |
| M9 | Honoraires non datés | Datés | Suivre le cahier |
| M10 | Paiements d'une police nouvelle sans contrôle | Non précisé | OUVERT (A10) |
| M11 | PaiementID du fichier conservé comme numéro | — | **TRANCHÉ autrement** : repris comme numéro à la reprise seulement ; champ séparé pour les fichiers mensuels (A1, A1b) |
| M12 | Rapprochement limité à la branche affichée | Non précisé | OUVERT (A21) |
| M13 | Frais : paiements de test comptés | — | **Confirmé** par le relevé réel : comptés dans les frais, ignorés au rapprochement (section 6) |
| M14 | États filtrés par date de paiement | Non précisé | OUVERT (A19) |
| M15 | « Qui nous doit » : dernier paiement parmi tous | Seuls les confirmés comptent | Suivre le cahier |
| M16 | Export : A–AH + 2 colonnes | A–AH + 16 colonnes | Suivre le cahier |
| M17 | SUS : année de réception | Non précisé | OUVERT (A18) |
| M18 | Affichage en francs entiers | — | **Conforme** à l'arbitrage (affichage à l'unité, stockage au centime) |
| M19 | Pas d'annulation, contre-passation, taux de contrôle, droits, audit, reprise, totaux de contrôle, historique des honoraires | Hors maquette selon le cahier | Normal |
| M20 | Collection « reversements » jamais alimentée | Absent | Vestige |
| M21 | « + Ajouter une ligne (police existante) » | F4.2 | Conforme |

---

## 5. Ambiguïtés et contradictions

Statuts : **TRANCHÉ** (date), **RÉSOLU V2.6** (réglé par le texte de la V2.6), **PROVISOIRE** (proposé au client, sans
réponse écrite), **OUVERT**.

### 5.1 Internes au V2

| # | Sujet | Statut |
|---|---|---|
| A1 | Numéro PAI d'un paiement importé | **TRANCHÉ 2026-09-28 (décision révisée le même jour)** : **à la reprise**, les PaiementID du classeur deviennent nos numéros PAI (séquence remontée au maximum repris) ; **pour les fichiers mensuels**, le PaiementID du fichier est stocké dans un champ séparé (anti-doublon) et chaque encaissement reçoit notre propre numéro ; l'export écrit notre numéro en colonne B |
| A1b | PaiementID du fichier et de l'application dans la même série | **TRANCHÉ 2026-09-28** par la décision A1 révisée (plus de conflit possible) |
| A1c | Origine des PaiementID des fichiers mensuels | OUVERT — question posée au client |
| A2 | Ordre de deux prises en compte le même jour ; « Finalement reçu » | OUVERT |
| A3 | Arrondi | **TRANCHÉ 2026-09-28** : calcul et stockage au centime (règle actuelle du moteur), affichage arrondi à l'unité FCFA ; la recette au centime porte sur les valeurs stockées |
| A4 | Avenant (prime modifiée) | **TRANCHÉ 2026-09-28** : confirmés figés ; les suivants utilisent les nouveaux montants ; reliquat du soldant sur les nouveaux totaux ; nouvelle prime inférieure à l'encaissé → alerte trop-perçu |
| A5 | Changement de partenaire ou de branche d'une police connue | OUVERT |
| A6 | Ventilation de l'excédent d'un trop-perçu accepté | OUVERT |
| A7 | Arrondi et reliquat des parts d'accessoires ; T et V absents du 9.6 | OUVERT (proposition : part partenaire arrondie half-up, part SIM = AC − part partenaire) |
| A8 | Correction d'un encaissement : champs, recalcul | OUVERT |
| A9 | Contre-passation d'une taxe déjà payée : mois du négatif, levée du « à régulariser », où il s'affiche | OUVERT |
| A10 | Police nouvelle avec paiement incomplet ou Wave non conforme ; plusieurs lignes dans le fichier | OUVERT |
| A11 | « Ajouter quand même » : à confirmer ou confirmé | OUVERT |
| A12 | Doublons : encaissements comparés (statuts, contre-passations), ordre des règles, portée de « même référence » | OUVERT |
| A13 | Date de début de NOVELIA | OUVERT (nécessaire avant la reprise) |
| A14 | Lignes annulées importées par la Finance (ligne entière ou annulation seule) ; valeurs de la colonne statut | OUVERT |
| A15 | Liste des branches | **PROVISOIRE** : paramétrée par la Finance |
| A16 | Argent non identifié affecté en partie et classé en partie (9.5) | OUVERT |
| A17 | Source d'un encaissement issu d'une affectation | OUVERT |
| A18 | Année du numéro SUS | OUVERT |
| A19 | Dates de référence des états (paiement ou prise en compte) | OUVERT |
| A20 | Base et tolérance des taux de contrôle ; lot | OUVERT |
| A21 | Relevé : toutes les branches ou la branche choisie | OUVERT |
| A22 | Groupe 4 du relevé en Lot 1 (argent non identifié = Lot 2) | OUVERT |
| A23 | Frais des opérateurs | **Paiements de test : RÉSOLU** par le relevé réel (comptés dans les frais). **Reste ouvert** : deux relevés partiels du même mois et du même opérateur (le second remplace le premier). |
| A24 | Annulation | **RÉSOLU V2.6 en partie** (9.13 : sans effet et non-paiement chiffrés). Reste : reste dû après une résiliation ; effet sur la taxe à la production des états. |
| A25 | Paiement mobile saisi au net : quel Z ? | OUVERT |
| A26 | Ligne du relevé qui correspond à un paiement « non reçu » | OUVERT |
| A27 | Reprise initiale | **RÉSOLU V2.6** (F1.5 : prise en compte = date de paiement, bascule par nature sur la colonne A ; décision SIM : taxes au 30/09/2026, autres natures sans bascule). Précisions encore nécessaires : A27b à A27e ci-dessous. Reprise réservée à la Finance (`enc.importer_production` et `enc.marquer_paye`). |
| A27b | Reprise « une seule fois » : pour tout le classeur ou par branche ? Le classeur n'a pas de colonne « Branche » : comment affecter les branches ? | OUVERT — question posée au client |
| A27c | « Payé (reprise) » : quelle date et quelle référence de paiement enregistrer (la date de bascule, « reprise ») ? | OUVERT |
| A27d | **Contradiction avec la règle provisoire** « taxe payée non cochable tant qu'elle n'est pas exigible » : les paiements enregistrés en septembre 2026 ont une taxe exigible en octobre, mais la bascule du 30/09 les marque payés. La reprise doit-elle échapper à la règle, ou la bascule ne vise-t-elle que les taxes déjà exigibles ? | OUVERT — question posée au client (bascule au 30/09 ou au 31/08) ; en attendant, la règle provisoire ne s'applique qu'aux actions de l'utilisateur (F7), **la reprise en est exclue** |
| A27e | Paiement repris sans date en colonne A | OUVERT |
| A28 | Référence obligatoire et date non future pour les paiements du fichier | OUVERT |
| A29 | Export : lignes à confirmer, non reçus, contre-passations, polices sans encaissement | OUVERT |
| A30 | L'équipe technique voit-elle l'onglet « À vérifier » (sans les boutons) ? | OUVERT |
| A31 | Mise en service | **TRANCHÉ 2026-09-28** : remise à zéro avant production conservée |
| A32 | Libellé du module | **TRANCHÉ 2026-09-28** : « Encaissements, taxes » (titre de la V2.6) |
| A33 | Téléchargement des fichiers de production (données clients) | **TRANCHÉ 2026-09-28** : Finance et équipe technique seulement, jamais la Consultation |
| A34 | Case « taxe payée » non cochable tant que la taxe n'est pas exigible | **PROVISOIRE** : actions de l'utilisateur (F7) seulement, reprise exclue |

### 5.2 Contradictions avec les réponses du 28/09 (remplacées par la V2.6)

| R | Réponse du 28/09 | V2.6 | Statut |
|---|---|---|---|
| R1 | Import d'un fichier d'encaissements par la gestion | **Trois voies seulement, pas d'autre import** (principe 2) | **RÉSOLU V2.6** : abandonné |
| R2 | Seul le Responsable corrige | La Finance corrige et contre-passe | Changement assumé par la V2.6 |
| R4 | Report si le mois est « déjà déclaré ou clôturé » | Report selon la prise en compte et le jour limite | Règle de la V2.6 |
| R7 | Annulation sans effet : effet à la date d'effet | Non repris | OUVERT (toujours valable ?) |
| R11 | Accessoires par produit et par partenaire | Par partenaire, par police, défaut | Règle de la V2.6 (plus par produit) |
| R15 | « À récupérer » sur le partenaire | « À régulariser » sans calcul | Règle de la V2.6 |
| R3 | Numérotation des renouvellements à confirmer par l'équipe technique | Rien | OUVERT |
| Autres | R5, R8, R10, R16 sans objet ; R6, R9, R12, R13, R14, R17, R18, R19 concordants | | |

---

## 6. Relevé Wave d'août 2026 (données réelles)

**Emplacement : `C:\Projets\donnees-sensibles\`, hors du dépôt.** Il a d'abord été trouvé à l'intérieur du dossier du
dépôt sans être ignoré par git ; il a été déplacé le 2026-09-28, et la ligne `/donnees-sensibles/` du `.gitignore` est
gardée par précaution. Aucun tableur n'est suivi par git ni présent dans `docs/`. Aucune donnée personnelle n'est
reproduite ici.

**Format constaté** (`Releve_Wave_aout_2026_2809.xls`, 51 712 octets) :

| Élément | Constat |
|---|---|
| Conteneur | **Excel 97-2003 (BIFF, OLE2)** : signature `D0 CF 11 E0 A1 B1 1A E1` — ExcelJS ne le lit pas |
| Feuilles | Une seule, nommée d'après la période : `2026-08-01_à_2026-08-31` |
| En-têtes | **Ligne 1**, 13 colonnes : Horodatage, Identifiant de transaction, Type de transaction, Montant net, Montant brut, Frais, Solde, Devise, Nom de contrepartie, Numéro de téléphone de contrepartie, Compte payeur, Référence client, Identifiant de session API (conformes au §7.2) |
| Types | Horodatage = **date Excel** (à la seconde) ; montants = **nombres entiers** ; devise `XOF` ; les autres colonnes en texte |
| Lignes | 114 : **81 `api_checkout`**, **29 `merchant_payment`**, **4 `agent_transaction`** (montants négatifs) ; période du 01/08 au 31/08 |
| Frais | Positifs (0 pour les très petits montants) ; **net = brut − frais** sur toutes les lignes positives |
| Identifiant de transaction | `T_` + 16 caractères (18 au total) ; **110/110** conformes à `^T_[A-Z0-9]{10,}$` |
| Référence client, session API | Renseignées sur les **81** `api_checkout` seulement (paiements par le site) |

**Cas 9.10 reproduit** : en comptant **toutes les entrées positives** — 110 paiements, brut **397 900**, frais **3 977**,
net **393 923**, **1,00 %**. Dont 5 paiements de moins de 100 FCFA (brut total 5 FCFA, frais 0). Les 4 négatifs sont les
`agent_transaction`.

**Règle retenue** (vérifiée sur le relevé complet) : les montants **négatifs** et les paiements **de moins de 100 FCFA**
sont **ignorés pour le rapprochement** (§7.2), mais **comptés dans les frais des opérateurs** (F5.9) → 105 lignes au
rapprochement, 110 dans les frais.

**Cas 9.11** : `T_IXVGEP6EM2UWXL5P` présente une seule fois (`merchant_payment`, 04/08, brut **13 395**, frais 134, net
13 261) ✓ ; la variante `T_5GHD2UXL6B7JTTBD` est aussi présente (brut **2 500**) ✓.

**Nom de fichier** : le cahier cite « ok.xls » ; le fichier réel s'appelle autrement. L'opérateur ne doit donc pas être
déduit du nom de fichier (comme dans la maquette) mais des **en-têtes** (Wave : « Montant brut » + « Identifiant de
transaction »).

**Tests** : le relevé réel ne va jamais dans le dépôt. Les tests automatiques utiliseront un **relevé synthétique** au
même format (généré en `.xls`), et la vérification sur le vrai relevé reste un script lancé à la main, hors dépôt.

---

## 7. Bibliothèque de lecture `.xls` / `.xlsx` / `.csv`

| Option | `.xls` | `.xlsx` | `.csv` | Verdict |
|---|:-:|:-:|:-:|---|
| `xlsx` sur npm (0.18.5) | ✓ | ✓ | ✓ | **Écarté** : non maintenu sur npm ; failles connues **CVE-2023-30533** (pollution de prototype à la lecture, corrigée en 0.19.3) et **CVE-2024-22363** (ReDoS, corrigée en 0.20.2) |
| **SheetJS CE 0.20.3**, distribué par l'éditeur (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) | ✓ | ✓ | ✓ | **Proposé** : même API, failles corrigées, lit le vrai relevé (vérifié) |
| ExcelJS (déjà utilisé pour les exports) | ✗ | ✓ | ✓ | Garder pour **écrire** les exports ; ne lit pas `.xls` |
| `node-xlsx` | ✓ | ✓ | ✓ | Écarté : embarque `xlsx` 0.18.5 |
| `read-excel-file` | ✗ | ✓ | ✗ | Insuffisant |
| Conversion par LibreOffice en ligne de commande | ✓ | ✓ | ✓ | Écarté : lourd dans l'image Docker |
| `csv-parse` / Papa Parse | ✗ | ✗ | ✓ | Inutile si SheetJS lit le CSV |

**Proposition** : SheetJS CE 0.20.3, avec :
- **archive `.tgz` versionnée dans le dépôt** (dépendance `file:`) et empreinte vérifiée, pour ne pas dépendre du CDN de l'éditeur au build Docker ni d'une substitution de paquet ;
- lecture **uniquement côté serveur**, fichier limité en taille (10 Mo, comme les pièces jointes) et en nombre de lignes (`sheetRows`) ;
- options `cellFormula: false`, `cellHTML: false`, `cellStyles: false`, `cellDates: true` ; aucune conversion en HTML ; valeurs lues comme des données, jamais évaluées ;
- une seule fonction d'entrée (`lireTableur(buffer) → lignes`), pour pouvoir changer de bibliothèque sans toucher aux règles d'import.

---

## 8. Décisions du 2026-09-28 et permissions validées

| # | Décision |
|---|---|
| 1 | Permissions : les 9 ci-dessous sont **validées** ; reprise réservée à la Finance (`enc.importer_production` **et** `enc.marquer_paye`) |
| 2 | Rôles « Gestionnaire » et « Responsable » : supprimés s'ils n'ont aucun compte, sinon arrêt de la migration avec message |
| 3 | Arrondi : TRANCHÉ (A3) |
| 4 | Libellé : « Encaissements, taxes » (A32) |
| 5 | Remise à zéro avant production : conservée |
| 6 | Fichiers importés conservés comme preuve ; relevés téléchargeables par la Finance seulement ; fichiers de production par la Finance et l'équipe technique (A33) |
| A1, A1b, A4 | TRANCHÉES (A1 révisée : voir section 5) ; A1c (origine des PaiementID mensuels) posée au client |
| Lots | Tous les montants (exigibilité, parts d'accessoires, bénéficiaire des honoraires) **calculés et figés dès la confirmation, en Lot 1** ; les écrans suivent aux Lots 2 et 3 |
| A27 | Résolue par la V2.6 ; la reprise exige le paramétrage des accessoires avant → l'ordre des commits en tient compte ; A27b et A27d posées au client |
| Provisoires | Liste des branches paramétrée par la Finance ; « taxe payée » non cochable avant exigibilité, pour les actions de l'utilisateur seulement (reprise exclue) |

**Les 9 permissions validées** :

| Permission | Technique | Finance | Consultation | Couvre |
|---|:-:|:-:|:-:|---|
| `enc.consulter` | ✓ | ✓ | ✓ | Consulter, exporter, voir les signalements |
| `enc.importer_production` | ✓ | ✓ | | F1 ; téléchargement des fichiers de production |
| `enc.annuler_contrat` | ✓ | | | F8 |
| `enc.saisir_encaissement` | | ✓ | | F3, F4 |
| `enc.confirmer_paiement` | | ✓ | | F5 : reçu, non reçu, finalement reçu, relevés, frais ; **téléchargement des relevés** |
| `enc.corriger_encaissement` | | ✓ | | Correction, contre-passation |
| `enc.gerer_non_identifie` | | ✓ | | F6 |
| `enc.marquer_paye` | | ✓ | | F7, y compris décocher |
| `enc.parametrer` | | ✓ | | F9 (honoraires, accessoires, taux de contrôle, branches) |

Hors liste : `enc.mettre_en_service` (DG, module technique `systeme`, inchangée). **Reprise initiale** (F1.5) : Finance
seule, qui doit détenir `enc.importer_production` **et** `enc.marquer_paye` (elle fixe les dates de bascule, un geste de
« marquer payé »).

---

## 9. Découpage en commits du Lot 1 (V2.6)

Chaque commit : tsc, eslint, vitest, `next build`, Playwright sur base jetable ; message qui explique le pourquoi ;
l'utilisateur committe. Ordre revu pour que **le paramétrage des accessoires et des honoraires précède la reprise**.

| # | Commit | Contenu | Attend |
|---|---|---|---|
| 0 | **Docs** (ce commit) | V2.6 et maquette dans `docs/`, archives, analyse, conception V2, `CLAUDE.md`, `.gitignore` | — |
| 1 | Moteur V2 | Exigibilité §5.3, arrondi définitif, trop-perçu sur demande, avenant (A4), contre-passation, partage des accessoires, honoraires à une date ; retrait du calcul inverse, de l'échéancier, de RGS/BRD ; tests renumérotés (9.1, 9.4, 9.5, 9.6, 9.8, 9.9, 9.13, §5.3) | A6, A7 |
| 2 | Permissions et paramètres V2 | Migration corrective (9 permissions, 3 rôles, suppression conditionnelle des 2 rôles, paramètres) ; seed ; tests | — (permissions validées) |
| 3 | Référentiels, contrat, paramètres de base | `EncBranche` (liste Finance), `EncPartenaire`, `EncContrat`, `EncBeneficiaireHonoraires` ; écran minimal de paramétrage (branches, honoraires, partage des accessoires) | A13, A15 |
| 4 | Lecture de tableurs et règles d'import | SheetJS 0.20.3 versionné ; `lireTableur` ; règles F1 (table de cas) et F1.5 (bascule) en fonctions pures ; relevé synthétique ; tests 9.3 | A1c, A10, A12, A14, A28 |
| 5 | Import de production (F1) | `EncImport`, `EncSignalement`, paiements « à confirmer » ; rapport ; fichier conservé ; 5 000 lignes < 2 min | — |
| 6 | Recherche et fiche police (F2) | < 1 s, < 2 s ; cadres en lecture | — |
| 7 | Saisie (F3) | Confirmé et figé (exigibilité, parts, bénéficiaire), PAI, ordre de prise en compte, contrôles §8.1, audit | A2, A6 |
| 8 | Paiement multiple (F4) | « Ajouter une ligne » sur police existante ; écart nul ; 9.4 | — |
| 9 | Confirmation (F5 hors relevés) et signalements | Reçu, non reçu, lot, finalement reçu, export ; signalements ; 9.2 | A11, A30 |
| 10 | Relevés et frais (F5) | 4 groupes, transaction partagée, confirmation automatique mémorisée, frais (règle de la section 6) ; téléchargement réservé à la Finance ; 9.7, 9.10, 9.11 | A21, A22, A23, A25, A26 |
| 11 | Reprise initiale (F1.5) | Aperçu, dates de bascule par nature, « payé (reprise) », rapport par nature et par branche, validation ; PaiementID du classeur repris comme numéros | A27b à A27e, A13 |
| 12 | Recette du Lot 1 | Cas du Lot 1 de bout en bout, 9.14 (droits), volumétrie ; mise en service | — |
