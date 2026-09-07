# CAHIER DES CHARGES — PORTAIL RH V2

## Modules : Congés · Permissions · Évaluations du Personnel

> **Entreprise** : SIM ASSURANCES CI
> **Version** : 2.0
> **Date** : Septembre 2026
> **Prérequis** : Module Pointage V1 validé et déployé

---

## 1. CONTEXTE ET OBJECTIFS

### 1.1 Rappel V1
La V1 du portail couvre :
- **Module Trésorerie** : demandes d'achat, validation, règlement, retour de caisse, journal
- **Module Pointage** : pointage QR Code / ordinateur, retards, absences, reporting RH

### 1.2 Objectif V2
Ajouter trois nouveaux modules RH au portail existant :

| Module | Objectif |
|--------|----------|
| **Congés** | Gérer les demandes de congé (annuel, maladie, maternité, etc.) avec validation hiérarchique et suivi du solde |
| **Permissions** | Gérer les absences courtes autorisées (rendez-vous médical, raison familiale, etc.) avec plafond mensuel |
| **Évaluations** | Évaluer les collaborateurs de façon structurée (périodique ou ponctuelle) avec grille de compétences |

### 1.3 Principes directeurs
1. Réutiliser l'architecture existante (Next.js, Prisma, PostgreSQL, NextAuth, système de modules/rôles/permissions)
2. S'appuyer sur le modèle `User` existant (avec `service`, `role`, `isActive`)
3. Traçabilité complète (historique de chaque action via `HistoriqueEntry`)
4. Interface responsive (téléphone et ordinateur)
5. Exportation Excel disponible pour tous les reportings

---

## 2. UTILISATEURS ET RÔLES

Les rôles existants sont réutilisés. La V2 ajoute de nouvelles **permissions** rattachées à de nouveaux **modules**.

### 2.1 Collaborateur
- Soumet des demandes de congé et de permission
- Consulte ses soldes (congés restants, permissions utilisées)
- Consulte ses évaluations passées
- Peut répondre / commenter son auto-évaluation (si configuré)

### 2.2 RH
- Valide ou rejette les demandes de congé et de permission
- Paramètre les types de congés et les soldes initiaux
- Paramètre les plafonds de permissions
- Crée et gère les campagnes d'évaluation
- Définit les grilles de compétences
- Consulte tous les reportings
- Peut accorder un congé ou une permission d'office (cas exceptionnel)

### 2.3 Direction / Responsable (DG)
- Première validation des demandes de congé (avant RH)
- Consultation des évaluations de ses collaborateurs
- Évalue les collaborateurs sous sa responsabilité
- Consultation des reportings selon droits accordés

### 2.4 Admin
- Gestion des types de congés et permissions dans la console d'administration
- Accès à la configuration des grilles d'évaluation

---

## 3. MODULE CONGÉS

### 3.1 Types de congés

Le système doit prendre en charge les types de congés suivants (paramétrables par la RH) :

| Type | Durée par défaut/an | Décompte | Justificatif |
|------|---------------------|----------|--------------|
| Congé annuel | 30 jours calendaires (ou selon convention) | Jours calendaires | Non |
| Congé maladie | Selon certificat | Jours calendaires | Certificat médical obligatoire |
| Congé maternité | 14 semaines | Semaines | Certificat médical obligatoire |
| Congé paternité | 3 jours | Jours ouvrables | Acte de naissance |
| Congé mariage | 4 jours | Jours ouvrables | Acte de mariage |
| Congé décès | 3 à 5 jours (selon lien) | Jours ouvrables | Acte de décès |
| Congé exceptionnel | Selon motif | Variable | Selon cas |
| Congé sans solde | Selon accord | Jours calendaires | Non |

> **Paramétrable** : la RH peut ajouter, modifier ou désactiver des types de congés.
> Le nombre de jours par défaut et les règles de décompte sont configurables par type.

### 3.2 Solde de congés

#### 3.2.1 Initialisation
- Au début de chaque exercice (1er janvier par défaut, paramétrable), chaque collaborateur actif reçoit automatiquement son solde initial de congé annuel
- La RH peut ajuster manuellement le solde d'un collaborateur (report de l'année précédente, ajustement d'ancienneté, etc.)
- Tout ajustement manuel est historisé avec motif obligatoire

#### 3.2.2 Décompte
- Le solde est diminué automatiquement à chaque congé **validé** (pas avant)
- Si un congé validé est annulé, le solde est re-crédité automatiquement
- Les jours fériés et week-ends ne sont pas décomptés (configurable selon le type de congé : calendaire vs ouvrable)

#### 3.2.3 Consultation
- Le collaborateur voit son solde restant à tout moment
- La RH voit les soldes de tous les collaborateurs

### 3.3 Circuit de validation des congés

```
Collaborateur                  DG/Responsable               RH
     |                              |                        |
     |-- Soumet la demande -------->|                        |
     |                              |                        |
     |                              |-- Approuve / Rejette ->|
     |                              |                        |
     |                              |                  Valide / Rejette
     |                              |                        |
     |<------------ Notification du résultat ----------------|
```

#### 3.3.1 Étapes détaillées

1. **Création** : le collaborateur soumet une demande avec :
   - Type de congé
   - Date de début
   - Date de fin
   - Motif (obligatoire)
   - Pièce jointe (obligatoire selon le type : maladie, maternité, décès, etc.)
   - Intérimaire désigné (facultatif, texte libre)

2. **Contrôles automatiques à la soumission** :
   - Solde suffisant (pour congé annuel)
   - Pas de chevauchement avec un autre congé déjà validé du même collaborateur
   - Dates cohérentes (fin ≥ début)
   - Pièce jointe présente si type l'exige

3. **Validation DG/Responsable** :
   - Reçoit une notification
   - Peut approuver ou rejeter avec motif
   - Peut demander une modification (la demande retourne au collaborateur)

4. **Validation RH** :
   - Après approbation du DG/Responsable
   - La RH valide définitivement ou rejette avec motif
   - La validation finale déclenche le décompte du solde

5. **Statuts possibles** :

| Statut | Description |
|--------|-------------|
| `BROUILLON` | Demande en cours de rédaction (non soumise) |
| `EN_ATTENTE_RESPONSABLE` | Soumise, en attente du responsable/DG |
| `EN_ATTENTE_RH` | Approuvée par le responsable, en attente de la RH |
| `VALIDEE` | Congé accordé, solde mis à jour |
| `REJETEE` | Refusée (par le responsable ou la RH) |
| `ANNULEE` | Annulée par le collaborateur (avant le début) ou par la RH |
| `MODIFICATION_DEMANDEE` | Renvoyée au collaborateur pour correction |

### 3.4 Règles métier des congés

1. Le collaborateur ne peut **annuler** une demande validée que si le congé **n'a pas encore commencé**
2. Après le début du congé, seule la RH peut annuler (cas exceptionnel : retour anticipé, urgence)
3. Toute annulation d'un congé validé est historisée
4. Un congé ne peut pas être modifié après validation — le collaborateur doit annuler et refaire une demande
5. Le collaborateur peut soumettre plusieurs demandes simultanément (pour des périodes différentes)
6. La RH peut accorder un congé d'office (congé exceptionnel), sans passer par le circuit de validation

### 3.5 Jours fériés

- La RH paramètre la liste des jours fériés de l'année
- Les jours fériés sont automatiquement exclus du décompte (pour les congés en jours ouvrables)
- L'interface affiche les jours fériés dans le calendrier de sélection des dates

### 3.6 Dashboard Congés (vue RH)

Le dashboard doit afficher en temps réel :
- **Collaborateurs actuellement en congé** (liste, dates, type)
- **Demandes en attente** de validation (compteur + liste)
- **Prochains congés** planifiés (calendrier visuel, 30 prochains jours)
- **Soldes faibles** : collaborateurs ayant moins de 5 jours restants
- **Taux d'absence** par service (graphique)

### 3.7 Reporting Congés

La RH et la Direction doivent pouvoir générer un reporting sur une **période librement définie** :

Pour chaque collaborateur :

| Collaborateur | Service | Congés annuels pris | Congés maladie | Autres congés | Total jours | Solde restant |
|---------------|---------|---------------------|----------------|---------------|-------------|---------------|

Détail par collaborateur :
- Liste de chaque congé : dates, type, durée, statut, validé par

Export Excel avec filtres :
- Période
- Service
- Collaborateur
- Type de congé

---

## 4. MODULE PERMISSIONS

### 4.1 Définition

Une **permission** est une absence courte (quelques heures) autorisée pour un motif précis. Elle se distingue du congé par :
- Sa durée : généralement **quelques heures** (pas des journées complètes)
- Son plafond : nombre limité par mois
- Son impact : le collaborateur revient dans la journée

### 4.2 Types de permissions

| Type | Durée typique | Plafond par défaut |
|------|---------------|-------------------|
| Rendez-vous médical | 2-3 heures | 2 par mois |
| Raison familiale urgente | 2-4 heures | 1 par mois |
| Démarche administrative | 2-3 heures | 1 par mois |
| Autre (à préciser) | Variable | Selon paramétrage |

> **Paramétrable** : la RH définit les types, les durées maximales et les plafonds mensuels.

### 4.3 Circuit de validation des permissions

Le circuit est **simplifié** par rapport aux congés :

```
Collaborateur               RH
     |                       |
     |-- Soumet demande ---->|
     |                       |
     |                 Approuve / Rejette
     |                       |
     |<--- Notification -----|
```

> **Pas de validation DG** pour les permissions (absences courtes). Le DG a un droit de consultation.

#### 4.3.1 Création de la demande
Le collaborateur renseigne :
- Type de permission
- Date
- Heure de départ prévue
- Heure de retour prévue (ou durée estimée)
- Motif (obligatoire)
- Pièce jointe (facultative, sauf pour rendez-vous médical : justificatif recommandé)

#### 4.3.2 Contrôles automatiques
- Plafond mensuel non atteint pour ce type
- Pas de chevauchement avec un congé validé
- Durée dans les limites autorisées

#### 4.3.3 Statuts

| Statut | Description |
|--------|-------------|
| `EN_ATTENTE` | Soumise, en attente de la RH |
| `APPROUVEE` | Accordée |
| `REJETEE` | Refusée avec motif |
| `ANNULEE` | Annulée |
| `CONSOMMEE` | Le collaborateur est effectivement sorti et revenu (pointage confirmé) |

### 4.4 Lien avec le pointage

> [!IMPORTANT]
> **Point clé** : les permissions interagissent avec le module Pointage V1.

1. Lorsqu'une permission est **approuvée**, le système enregistre une **plage d'absence autorisée** pour la journée concernée
2. Si le collaborateur pointe un départ et un retour correspondant à la plage autorisée, la permission est marquée `CONSOMMEE`
3. Les heures d'absence liées à une permission approuvée ne sont **pas comptées comme retard** dans le reporting pointage
4. Si le collaborateur dépasse la durée autorisée, l'écart est signalé dans le dashboard RH

### 4.5 Règles métier des permissions

1. Le plafond est calculé par **mois calendaire**
2. Le collaborateur peut consulter son compteur de permissions restantes (par type) pour le mois en cours
3. La RH peut accorder une permission au-delà du plafond avec un motif obligatoire (exception historisée)
4. Une permission ne peut pas couvrir une journée entière — pour cela, utiliser le module Congés
5. Si durée demandée > 4 heures, le système affiche un avertissement et recommande de soumettre un congé

### 4.6 Dashboard Permissions (vue RH)

- **Permissions du jour** : liste des collaborateurs en permission aujourd'hui
- **Demandes en attente** de validation
- **Permissions par service** (graphique mensuel)
- **Alertes plafond** : collaborateurs approchant ou ayant atteint le plafond

### 4.7 Reporting Permissions

Reporting sur période librement définie :

Pour chaque collaborateur :

| Collaborateur | Service | Nb permissions | Heures totales | Plafond restant | Dépassements |
|---------------|---------|----------------|----------------|-----------------|--------------|

Détail :
- Date | Type | Heure départ | Heure retour | Durée réelle | Motif

Export Excel avec filtres :
- Période
- Service
- Collaborateur
- Type de permission

---

## 5. MODULE ÉVALUATIONS

### 5.1 Principes

Le module Évaluations permet de mesurer la performance et les compétences des collaborateurs de manière **structurée et périodique**. Deux modes sont prévus :

| Mode | Description | Fréquence |
|------|-------------|-----------|
| **Évaluation périodique** | Campagne organisée (annuelle, semestrielle) concernant tous les collaborateurs ou un service | Configurable |
| **Évaluation ponctuelle** | Évaluation individuelle hors campagne (fin de période d'essai, promotion, etc.) | À la demande |

### 5.2 Grille de compétences

#### 5.2.1 Structure
La grille est composée de **catégories** et de **critères** :

```
Catégorie : "Compétences techniques"
  ├── Critère : "Maîtrise des outils métier"
  ├── Critère : "Qualité du travail produit"
  └── Critère : "Respect des procédures"

Catégorie : "Compétences comportementales"
  ├── Critère : "Ponctualité et assiduité"
  ├── Critère : "Travail en équipe"
  ├── Critère : "Initiative et proactivité"
  └── Critère : "Communication"

Catégorie : "Résultats et objectifs"
  ├── Critère : "Atteinte des objectifs fixés"
  ├── Critère : "Respect des délais"
  └── Critère : "Capacité d'adaptation"
```

#### 5.2.2 Barème de notation
Chaque critère est noté sur une échelle paramétrable (par défaut : 1 à 5) :

| Note | Appréciation |
|------|-------------|
| 1 | Insuffisant |
| 2 | À améliorer |
| 3 | Satisfaisant |
| 4 | Bon |
| 5 | Excellent |

> **Paramétrable** : la RH peut modifier l'échelle, les libellés des appréciations, et les pondérations par catégorie.

#### 5.2.3 Pondération
- Chaque catégorie peut avoir un **coefficient de pondération** (ex : Compétences techniques ×3, Comportement ×2, Résultats ×5)
- La note finale pondérée est calculée automatiquement

### 5.3 Campagne d'évaluation

#### 5.3.1 Création (par la RH)
1. Titre de la campagne (ex : « Évaluation annuelle 2026 »)
2. Type : annuelle, semestrielle, fin de période d'essai, autre
3. Période évaluée (du – au)
4. Date limite de soumission
5. Grille de compétences à utiliser (sélection parmi les grilles actives)
6. Périmètre : tous les collaborateurs, un service spécifique, ou sélection manuelle
7. Inclure l'auto-évaluation : oui / non

#### 5.3.2 Déroulement

```
RH                    Évaluateur (DG/Resp.)        Collaborateur
 |                          |                           |
 |-- Lance la campagne ---->|                           |
 |                          |                           |
 |                          |     (si auto-évaluation)  |
 |                          |-------------------------->|
 |                          |                           |
 |                          |<-- Auto-évaluation -------|
 |                          |                           |
 |                          |-- Remplit l'évaluation     |
 |                          |-- Commentaires & objectifs |
 |                          |                           |
 |<-- Soumet l'évaluation --|                           |
 |                          |                           |
 |-- Valide & clôture       |                           |
 |                          |                           |
 |-- Notification --------->|                           |
 |-- Notification ----------------------------------- ->|
```

#### 5.3.3 Statuts d'une évaluation individuelle

| Statut | Description |
|--------|-------------|
| `NON_DEMARREE` | La campagne est lancée mais l'évaluateur n'a pas commencé |
| `AUTO_EVALUATION_EN_COURS` | En attente de l'auto-évaluation du collaborateur |
| `EN_COURS` | L'évaluateur est en train de remplir la grille |
| `SOUMISE` | L'évaluateur a soumis son évaluation à la RH |
| `VALIDEE` | La RH a validé l'évaluation |
| `ENTRETIEN_PLANIFIE` | Un entretien de restitution est planifié |
| `CLOTUREE` | Le processus est terminé |

#### 5.3.4 Statuts d'une campagne

| Statut | Description |
|--------|-------------|
| `BROUILLON` | En cours de préparation |
| `ACTIVE` | Lancée, les évaluateurs peuvent remplir |
| `EN_COURS_CLOTURE` | Date limite dépassée, en cours de finalisation |
| `CLOTUREE` | Toutes les évaluations sont clôturées |

### 5.4 Contenu d'une évaluation

Pour chaque collaborateur évalué, l'évaluation contient :

#### 5.4.1 Notation
- Note par critère (selon la grille sélectionnée)
- Commentaire par critère (facultatif)
- Note par catégorie (moyenne automatique)
- Note finale pondérée (calculée automatiquement)
- Appréciation générale (texte libre)

#### 5.4.2 Auto-évaluation (si activée)
- Le collaborateur remplit la même grille de son côté
- L'évaluateur voit les deux notations côte à côte
- La note finale retenue est celle de l'évaluateur (l'auto-évaluation est consultative)

#### 5.4.3 Objectifs
- **Bilan des objectifs précédents** : pour chaque objectif fixé lors de l'évaluation précédente, indiquer le niveau d'atteinte (atteint / partiellement atteint / non atteint)
- **Nouveaux objectifs** : liste d'objectifs pour la prochaine période, avec :
  - Libellé
  - Indicateur de mesure
  - Échéance

#### 5.4.4 Plan de développement
- Points forts identifiés
- Axes d'amélioration
- Besoins en formation (texte libre)

### 5.5 Entretien de restitution

- L'évaluateur peut planifier un entretien avec le collaborateur (date/heure)
- Après l'entretien, l'évaluateur peut ajouter un compte-rendu
- Le collaborateur peut ajouter ses observations après l'entretien
- La signature électronique (accusé de lecture) du collaborateur est enregistrée

### 5.6 Lien avec le pointage

> [!IMPORTANT]
> **Enrichissement automatique** : le module évaluation peut récupérer les données du pointage pour alimenter automatiquement le critère « Ponctualité et assiduité ».

Données récupérables pour la période évaluée :
- Nombre total de jours de retard
- Total de minutes de retard
- Nombre d'absences (confirmées + justifiées + non justifiées)
- Taux de présence

Ces données sont affichées à titre **indicatif** à côté du critère. L'évaluateur reste libre de sa notation.

### 5.7 Dashboard Évaluations (vue RH)

- **Campagnes en cours** : avancement (X/Y évaluations soumises)
- **Évaluations en retard** : évaluateurs n'ayant pas soumis avant la date limite
- **Répartition des notes** : histogramme des notes finales (campagne en cours ou dernière campagne)
- **Comparaison par service** : moyenne des notes par service

### 5.8 Reporting Évaluations

Reporting par campagne :

| Collaborateur | Service | Note finale | Appréciation | Évaluateur | Statut |
|---------------|---------|-------------|--------------|------------|--------|

Détail par collaborateur :
- Notes par catégorie et par critère
- Objectifs fixés et leur suivi
- Commentaires

Export Excel + possibilité d'exporter la **fiche d'évaluation individuelle en PDF**.

---

## 6. NOTIFICATIONS

### 6.1 Principe

Le système doit informer les utilisateurs des actions les concernant via des **notifications internes** (dans l'application, cloche en haut de page).

### 6.2 Événements déclencheurs

#### Congés
| Événement | Destinataire |
|-----------|-------------|
| Nouvelle demande de congé | DG/Responsable |
| Congé approuvé par le responsable | RH |
| Congé validé | Collaborateur |
| Congé rejeté | Collaborateur |
| Modification demandée | Collaborateur |
| Annulation d'un congé | RH + Collaborateur |

#### Permissions
| Événement | Destinataire |
|-----------|-------------|
| Nouvelle demande de permission | RH |
| Permission approuvée | Collaborateur |
| Permission rejetée | Collaborateur |

#### Évaluations
| Événement | Destinataire |
|-----------|-------------|
| Campagne lancée | Évaluateurs |
| Auto-évaluation demandée | Collaborateur |
| Évaluation soumise | RH |
| Évaluation validée | Évaluateur + Collaborateur |
| Entretien planifié | Collaborateur |
| Rappel date limite approche (J-3) | Évaluateurs en retard |

### 6.3 Implémentation
- Icône cloche avec **badge compteur** (notifications non lues)
- Liste déroulante des dernières notifications
- Marquage lu / non lu
- Lien direct vers l'élément concerné

> [!NOTE]
> **V2** : notifications internes uniquement. L'envoi d'emails est prévu pour une version ultérieure.

---

## 7. CALENDRIER GLOBAL

### 7.1 Vue calendrier partagée

Un **calendrier visuel** accessible à la RH et à la Direction, affichant :
- Les congés validés (par couleur selon le type)
- Les permissions du jour
- Les jours fériés
- Les campagnes d'évaluation en cours

### 7.2 Filtres
- Par service
- Par collaborateur
- Par type d'événement (congé, permission, évaluation)
- Par mois / semaine

---

## 8. PERMISSIONS APPLICATIVES (MODULE / RÔLE)

### 8.1 Nouveau module : Congés

| Clé de permission | Libellé | Rôles |
|-------------------|---------|-------|
| `conges.soumettre` | Soumettre une demande de congé | Collaborateur, RH |
| `conges.consulter_solde` | Consulter son solde de congé | Collaborateur, RH |
| `conges.approuver_responsable` | Approuver en tant que responsable | DG |
| `conges.valider_rh` | Valider définitivement un congé | RH |
| `conges.annuler` | Annuler un congé validé | RH |
| `conges.parametrer_types` | Paramétrer les types de congés | RH, Admin |
| `conges.gerer_soldes` | Ajuster les soldes manuellement | RH |
| `conges.gerer_jours_feries` | Gérer la liste des jours fériés | RH, Admin |
| `conges.voir_dashboard` | Voir le dashboard congés | RH, DG |
| `conges.voir_reporting` | Voir le reporting congés | RH, DG |

### 8.2 Nouveau module : Permissions

| Clé de permission | Libellé | Rôles |
|-------------------|---------|-------|
| `permissions.soumettre` | Soumettre une demande de permission | Collaborateur, RH |
| `permissions.approuver` | Approuver une permission | RH |
| `permissions.consulter_compteur` | Consulter son compteur mensuel | Collaborateur |
| `permissions.consulter_tous` | Voir toutes les permissions | RH, DG |
| `permissions.parametrer` | Paramétrer types et plafonds | RH, Admin |
| `permissions.voir_dashboard` | Voir le dashboard permissions | RH, DG |
| `permissions.voir_reporting` | Voir le reporting permissions | RH, DG |

### 8.3 Nouveau module : Évaluations

| Clé de permission | Libellé | Rôles |
|-------------------|---------|-------|
| `evaluations.auto_evaluer` | Remplir son auto-évaluation | Collaborateur |
| `evaluations.evaluer` | Évaluer un collaborateur | DG, RH |
| `evaluations.creer_campagne` | Créer et gérer les campagnes | RH |
| `evaluations.gerer_grilles` | Gérer les grilles de compétences | RH, Admin |
| `evaluations.valider` | Valider une évaluation | RH |
| `evaluations.consulter_propres` | Consulter ses propres évaluations | Collaborateur |
| `evaluations.consulter_toutes` | Consulter toutes les évaluations | RH |
| `evaluations.voir_dashboard` | Voir le dashboard évaluations | RH, DG |
| `evaluations.voir_reporting` | Voir le reporting évaluations | RH, DG |

---

## 9. MODÈLE DE DONNÉES (EXTENSIONS PRISMA)

### 9.1 Module Congés

```
TypeConge
  ├── id, label, code
  ├── nbJoursDefaut (solde annuel par défaut)
  ├── decompteType (CALENDAIRE | OUVRABLE)
  ├── justificatifObligatoire (Boolean)
  ├── isActive (soft-delete)

JourFerie
  ├── id, date, label
  ├── exercice (année)

SoldeConge
  ├── id, userId, typeCongeId
  ├── exercice (année)
  ├── soldeInitial, soldeRestant
  ├── ajustements → AjustementSolde[]

AjustementSolde
  ├── id, soldeCongeId
  ├── montant (+/-), motif
  ├── effectueParId (RH), createdAt

DemandeConge
  ├── id, reference (auto)
  ├── userId (demandeur)
  ├── typeCongeId
  ├── dateDebut, dateFin
  ├── nbJours (calculé, excluant fériés/WE si ouvrable)
  ├── motif, interimaire
  ├── statut (enum StatutDemandeConge)
  ├── motifRejet
  ├── approuveParId (DG), approuveAt
  ├── valideParId (RH), valideAt
  ├── annuleParId, annuleAt, motifAnnulation
  ├── piecesJointes → PieceJointeConge[]
  ├── createdAt, updatedAt
```

### 9.2 Module Permissions

```
TypePermission
  ├── id, label
  ├── dureeMaxHeures
  ├── plafondMensuel
  ├── justificatifRecommande (Boolean)
  ├── isActive

DemandePermission
  ├── id, reference (auto)
  ├── userId
  ├── typePermissionId
  ├── date
  ├── heureDepart, heureRetourPrevue
  ├── heureRetourReelle (rempli au retour)
  ├── dureeMinutes (calculé)
  ├── motif
  ├── statut (enum StatutDemandePermission)
  ├── motifRejet
  ├── approuveParId (RH), approuveAt
  ├── piecesJointes → PieceJointePermission[]
  ├── createdAt, updatedAt
```

### 9.3 Module Évaluations

```
GrilleEvaluation
  ├── id, label, description
  ├── echelleMin, echelleMax
  ├── isActive
  ├── categories → CategorieEvaluation[]

CategorieEvaluation
  ├── id, label, coefficient
  ├── grilleId
  ├── ordre (affichage)
  ├── criteres → CritereEvaluation[]

CritereEvaluation
  ├── id, label, description
  ├── categorieId
  ├── ordre

LibelleEchelle
  ├── id, grilleId, valeur (1-5), libelle ("Insuffisant"...)

CampagneEvaluation
  ├── id, titre, type
  ├── periodeDebut, periodeFin
  ├── dateLimite
  ├── grilleId
  ├── perimetre (TOUS | SERVICE | SELECTION)
  ├── serviceFiltre (si SERVICE)
  ├── inclureAutoEvaluation (Boolean)
  ├── statut (enum StatutCampagne)
  ├── createdAt

Evaluation
  ├── id, campagneId (nullable pour ponctuelle)
  ├── evaluateurId
  ├── evalueId (collaborateur évalué)
  ├── grilleId
  ├── noteFinale (calculée, pondérée)
  ├── appreciationGenerale
  ├── pointsForts, axesAmelioration, besoinsFormation
  ├── statut (enum StatutEvaluation)
  ├── entretienDate, compteRenduEntretien
  ├── observationsCollaborateur
  ├── signatureCollaborateur (Boolean), signatureAt
  ├── valideParId (RH), valideAt
  ├── notes → NoteEvaluation[]
  ├── objectifsPrecedents → BilanObjectif[]
  ├── objectifsNouveaux → Objectif[]
  ├── createdAt, updatedAt

NoteEvaluation
  ├── id, evaluationId
  ├── critereId
  ├── noteEvaluateur (Int)
  ├── noteAutoEvaluation (Int, nullable)
  ├── commentaire

BilanObjectif
  ├── id, evaluationId
  ├── libelle, niveauAtteinte (ATTEINT | PARTIEL | NON_ATTEINT)
  ├── commentaire

Objectif
  ├── id, evaluationId
  ├── libelle, indicateur, echeance

Notification
  ├── id, userId (destinataire)
  ├── type (enum), titre, message
  ├── lien (URL vers l'élément)
  ├── isRead (Boolean)
  ├── createdAt
```

---

## 10. INTERFACES UTILISATEUR

### 10.1 Navigation

Le menu latéral existant accueille trois nouvelles sections :

```
📋 Trésorerie      (existant)
⏱️ Pointage        (existant)
🏖️ Congés          (nouveau V2)
   ├── Mes congés / Soldes
   ├── Nouvelle demande
   ├── Dashboard        (RH/DG)
   └── Reporting        (RH/DG)
📝 Permissions      (nouveau V2)
   ├── Mes permissions
   ├── Nouvelle demande
   ├── Dashboard        (RH/DG)
   └── Reporting        (RH/DG)
⭐ Évaluations     (nouveau V2)
   ├── Mes évaluations
   ├── Évaluer          (DG/RH)
   ├── Campagnes        (RH)
   ├── Grilles          (RH/Admin)
   ├── Dashboard        (RH/DG)
   └── Reporting        (RH/DG)
🔔 Notifications   (nouveau V2 — icône cloche dans le header)
📅 Calendrier      (nouveau V2 — vue transversale)
⚙️ Administration  (existant, enrichi)
```

### 10.2 Espace collaborateur

Le collaborateur dispose d'une **page d'accueil unifiée** résumant :
- Dernier pointage (existant)
- Solde de congés
- Prochains congés planifiés
- Compteur de permissions du mois
- Évaluations en cours (si auto-évaluation demandée)
- Notifications non lues

### 10.3 Formulaires

Tous les formulaires doivent être :
- Accessibles sur téléphone (responsive)
- Avec validation côté client ET serveur
- Avec les contrôles métier (solde, plafond, dates) exécutés en temps réel

---

## 11. EXPORT ET IMPRESSION

| Élément | Excel | PDF |
|---------|-------|-----|
| Reporting congés | ✅ | ❌ |
| Reporting permissions | ✅ | ❌ |
| Reporting évaluations | ✅ | ❌ |
| Fiche d'évaluation individuelle | ❌ | ✅ |

---

## 12. RÈGLES ESSENTIELLES V2

1. Le collaborateur ne peut pas modifier le solde de congé — seul le système (validation/annulation) et la RH (ajustement avec motif) peuvent le faire
2. Le décompte du solde ne s'effectue qu'à la **validation définitive** du congé
3. Toute annulation de congé validé re-crédite le solde automatiquement
4. Les permissions sont plafonnées par mois et par type
5. Le plafond de permissions ne peut être dépassé que par la RH avec motif (exception historisée)
6. Les permissions approuvées créent une plage d'absence autorisée dans le module pointage
7. Les grilles d'évaluation sont versionnées : modifier une grille active en crée une nouvelle version
8. La note finale d'évaluation est toujours celle de l'évaluateur (l'auto-évaluation est consultative)
9. L'évaluation ne peut être clôturée qu'après validation RH
10. Toutes les actions sont tracées dans `HistoriqueEntry`
11. Les données de pointage (retards, absences) sont automatiquement accessibles dans le module évaluation
12. Les notifications sont internes à l'application (pas d'email en V2)
13. Le calendrier global agrège congés, permissions et évaluations
14. Aucune donnée ne peut être supprimée physiquement — soft-delete systématique
15. L'export Excel est disponible pour tous les reportings

---

## 13. PHASES DE LIVRAISON PROPOSÉES

| Phase | Module | Contenu | Estimation |
|-------|--------|---------|------------|
| **Phase A** | Congés | Types, soldes, demandes, circuit de validation, jours fériés | 2-3 semaines |
| **Phase B** | Congés | Dashboard, reporting, export Excel | 1 semaine |
| **Phase C** | Permissions | Types, plafonds, demandes, validation, lien pointage | 1-2 semaines |
| **Phase D** | Permissions | Dashboard, reporting, export Excel | 1 semaine |
| **Phase E** | Évaluations | Grilles, campagnes, évaluations, auto-évaluation | 2-3 semaines |
| **Phase F** | Évaluations | Dashboard, reporting, export Excel/PDF, lien pointage | 1-2 semaines |
| **Phase G** | Transversal | Notifications, calendrier global, page d'accueil unifiée | 1-2 semaines |

> **Total estimé** : 9 à 14 semaines de développement

---

## 14. V3 (PRÉVISIONS FUTURES)

- Envoi de notifications par email / SMS
- Planification automatique des congés (détection de conflits par service)
- Évaluations 360° (feedback multi-sources)
- Module formation (suivi des besoins identifiés dans les évaluations)
- Tableau de bord Direction unifié (trésorerie + RH + congés + évaluations)
- Application mobile native (PWA ou React Native)
