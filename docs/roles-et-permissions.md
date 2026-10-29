# Rôles et permissions du portail — liste à cocher pour la production

> Document **généré** à partir de `backend/src/rolesCibles.ts` (`npx tsx prisma/generer-doc-roles.ts`). Ne pas le modifier à la main : un test échoue s'il n'est plus à jour.

**Pour qui ?** Le DG ou l'Admin qui règle les rôles de la production dans l'application (`/admin/roles`). La production n'est pas re-seedée : ce document dit ce que chaque rôle doit porter.

**Comment l'utiliser.**

1. Lancer `npx tsx prisma/lister-roles-permissions.ts` (lecture seule) pour obtenir `roles-et-permissions-base.md`, l'état réel de la production, et le comparer à ce document ; le script signale lui-même les écarts.
2. Dans `/admin/roles`, ouvrir chaque rôle et cocher ou décocher pour que la section du rôle ci-dessous soit respectée exactement. Chaque case s'applique tout de suite (pas de bouton « Enregistrer »).
3. Lire les encadrés « Permissions réservées » et « Vérifier avant de cocher » avant de commencer.

Les permissions du module « Système » (`systeme.reinitialiser`, `enc.mettre_en_service`) n'apparaissent **pas** dans `/admin/roles` : elles sont posées par le seed ou la migration et ne se cochent pas à la main.

Total : **52 permissions** réparties ainsi : Trésorerie 27, Pointage 9, Congés 4, Encaissements 9, Feedback 1, Système 2.

## Permissions réservées

> ⚠️ **Ne doivent être portées que par le DG :**
>
> - `treso.valider_budget` — le DG valide les budgets et les seuils ; la Finance les paramètre sans pouvoir les valider (séparation des tâches).
> - `treso.approuver_validation_complete` — verrou de clôture : si la Finance la porte, elle approuve ce qu'elle clôture.
> - `treso.decider_dg` — étape DG du circuit de validation.
> - `systeme.reinitialiser` — remise à zéro globale à usage unique.
> - `enc.mettre_en_service` — mise en service du module Encaissements (usage unique).
>
> **Couples INTERDITS (jamais sur le même rôle) :**
>
> - Le rôle **Finance** ne doit **pas** porter `treso.approuver_validation_complete` — la Finance clôture : elle ne doit pas aussi approuver la clôture.
> - Le rôle **Admin** ne doit **pas** porter `treso.approuver_validation_complete` — compte technique : aucun pouvoir de décision métier.
> - Le rôle **Finance** ne doit **pas** porter `treso.decider_dg` — la Finance décide à l'étape Finance, le DG à l'étape DG.
> - Le rôle **Finance** ne doit **pas** porter `treso.valider_budget` — la Finance paramètre les budgets, le DG les valide.
> - Le rôle **DG** ne doit **pas** porter `treso.valider_demande` — retirée du DG depuis le 2026-10-08 (le DG décide par `treso.decider_dg`).
> - Le rôle **DG** ne doit **pas** porter `conges.valider_rh` — l'étape RH des congés est celle de la RH ; le DG n'y décide qu'en repli, par `treso.decider_dg`.
> - Le rôle **Assistant Finance** ne doit **pas** porter `treso.decider_finance` — l'Assistant exécute (règlement, retours), il ne décide pas : séparation des tâches.
> - Le rôle **Assistant Finance** ne doit **pas** porter `treso.valider_demande` — même raison : valider et régler ne doivent pas être la même personne.
> - Le rôle **Admin** ne doit **pas** porter `systeme.reinitialiser` — la remise à zéro globale est réservée au DG.
>
> **Sur la production déjà en service, vérifier en priorité** : d'anciennes bases ont vu **Finance et Admin porter `treso.approuver_validation_complete`** et le DG porter `treso.valider_demande`. Aucune migration ne retire la première ; la migration `20261008090000_valider_demande_retiree_du_dg` retire la seconde. Décocher à la main si besoin.

Ne sont **jamais délégables** (même cochées, l'octroi est impossible) : `treso.decider_finance`, `treso.soumettre_dg`, `treso.decider_dg`, `treso.approuver_validation_complete`, `conges.valider_rh`, `pointage.reinitialiser`.

## Vérifier avant de cocher

> Une permission **absente de `/admin/roles`** signifie que **sa migration n'est pas encore appliquée** : la personne qui déploie doit lancer `prisma migrate deploy` avant de régler les rôles. Permissions créées par les migrations récentes :
>
> - **Circuit de validation (2026-10-06 à 2026-10-08)** — migration `20261006100000_tresorerie_permissions_explicites, 20261006120000_circuit_validation_demandes` : `treso.decider_finance`, `treso.soumettre_dg`, `treso.annuler_reglement`, `treso.ajuster_retour`, `treso.valider_remboursement`, `treso.valider_retour_exceptionnel`, `treso.creer_retour_externe`, `treso.modifier_budget_categorie`, `treso.deleguer_acces`, `treso.modifier_description`, `treso.decider_dg`.
> - **Lot J — budgets** — migration `20261023090000_budgets_parametrage` : `treso.valider_budget`.
> - **Lot K — réorientation et reprise** — migration `20261026090000_circuit_reorientation_reprise` : `treso.reorienter_demande`.
> - **Pointage — purge du Pointage seul** — migration `20261014120000_pointage_reinitialisation` : `pointage.reinitialiser`.
> - **Module Congés** — migration `20261030090000_conges_permissions_absence` : `conges.soumettre`, `conges.valider_rh`, `conges.annuler`, `conges.consulter_tous`.
>
> Après `prisma migrate deploy`, ces permissions existent mais **les rôles ne les portent que si la migration les a données** (par permission « sœur », jamais par nom de rôle). Vérifier chaque section de rôle ci-dessous.

## Rôles

Tous les rôles du seed (6 rôles du portail puis les 3 rôles Encaissements). « Responsable de service » n'est pas un rôle (voir point V7).

### Collaborateur

Collaborateur pouvant créer des demandes.

- Accès à la console d'administration (« Administrateur », fixé à la création) : **non**
- Peut être bénéficiaire d'une délégation : **oui**
- Peut recevoir un feedback (FeedbackApp) : **oui**
- Nombre de permissions à cocher : **5**

**Trésorerie** (2)

- [ ] `treso.creer_demande` — Créer une demande d'achat (« Nouvelle demande ») et voir ses propres demandes.
- [ ] `treso.declarer_retour` — Déclarer un retour de caisse sur ses propres demandes réglées (date et montant).

**Pointage** (2)

- [ ] `pointage.pointer` — Pointer son arrivée et son départ (QR code, ordinateur, géolocalisation).
- [ ] `pointage.consulter_historique` — Consulter son propre historique de pointage.

**Congés** (1)

- [ ] `conges.soumettre` — Demander un congé et consulter les siens.

### Finance

Équipe finance / trésorerie : décide (valide, rejette, clôture).

- Accès à la console d'administration (« Administrateur », fixé à la création) : **non**
- Peut être bénéficiaire d'une délégation : **non**
- Peut recevoir un feedback (FeedbackApp) : **oui**
- Nombre de permissions à cocher : **23**

**Trésorerie** (22)

- [ ] `treso.creer_demande` — Créer une demande d'achat (« Nouvelle demande ») et voir ses propres demandes.
- [ ] `treso.declarer_retour` — Déclarer un retour de caisse sur ses propres demandes réglées (date et montant).
- [ ] `treso.categoriser_demande` — Choisir la catégorie et l'objet de chaque article d'une demande (et en créer à la volée).
- [ ] `treso.valider_demande` — Ouvre les écrans Finance des demandes (liste « Toutes les demandes », reçus, pièces jointes, retours en lecture seule) et permet de valider ou rejeter une dépense directe. La décision sur les articles d'une demande passe par `treso.decider_finance`.
- [ ] `treso.cloturer_demande` — Clôturer une demande (totale, partielle ou forcée) une fois tous les articles terminés et le DG ayant approuvé.
- [ ] `treso.alimenter_caisse` — Enregistrer une alimentation de caisse (apport d'argent physique, pièce justificative obligatoire).
- [ ] `treso.corriger_solde_ouverture` — Définir puis corriger le solde d'ouverture de la caisse (pièce justificative et motif).
- [ ] `treso.voir_dashboard_finance` — Voir l'Accueil Finance (indicateurs, graphiques, solde de caisse) et consulter les listes Finance.
- [ ] `treso.voir_reporting` — Voir et exporter le reporting Trésorerie (tableau unique et fichier Excel).
- [ ] `treso.saisir_depense_directe` — Créer une dépense directe (prime, dotation carburant…) pour un bénéficiaire qui n'intervient pas.
- [ ] `treso.gerer_categories` — Créer et supprimer des catégories et des objets d'achat, les désactiver ou réactiver, régler la date de catégorisation obligatoire.
- [ ] `treso.decider_finance` — Décider à l'étape Finance : valider ou rejeter chaque article d'une demande. Non délégable.
- [ ] `treso.soumettre_dg` — Soumettre (ou resoumettre) un article ou une demande au DG, avec le motif. Non délégable.
- [ ] `treso.annuler_reglement` — Annuler un règlement confirmé (écriture compensatoire dans la caisse).
- [ ] `treso.ajuster_retour` — Ajuster le total déclaré d'un retour de caisse.
- [ ] `treso.valider_remboursement` — Valider ou rejeter un remboursement de retour (correction d'un retour déjà réceptionné).
- [ ] `treso.valider_retour_exceptionnel` — Valider ou rejeter un retour exceptionnel après clôture (entrée en caisse à la validation).
- [ ] `treso.creer_retour_externe` — Enregistrer un retour externe (argent revenu hors demande, ex. chèque), rattaché ou non à une demande.
- [ ] `treso.modifier_budget_categorie` — Paramétrer les budgets de catégorie et les seuils du budget de caisse (soumis ensuite à la validation du DG).
- [ ] `treso.deleguer_acces` — Ouvrir l'écran « Déléguer des accès » et déléguer certaines permissions à un autre compte.
- [ ] `treso.modifier_description` — Modifier la description d'une demande et le libellé de ses articles (les deux versions restent visibles).
- [ ] `treso.reorienter_demande` — Réorienter l'étape Service d'une demande vers un autre responsable (le demandeur peut réorienter la sienne sans cette permission).

**Congés** (1)

- [ ] `conges.soumettre` — Demander un congé et consulter les siens.

### DG

Direction générale.

- Accès à la console d'administration (« Administrateur », fixé à la création) : **non**
- Peut être bénéficiaire d'une délégation : **non**
- Peut recevoir un feedback (FeedbackApp) : **oui**
- Nombre de permissions à cocher : **15**

**Trésorerie** (7)

- [ ] `treso.voir_dashboard_finance` — Voir l'Accueil Finance (indicateurs, graphiques, solde de caisse) et consulter les listes Finance.
- [ ] `treso.voir_reporting` — Voir et exporter le reporting Trésorerie (tableau unique et fichier Excel).
- [ ] `treso.approuver_validation_complete` — Approuver la validation complète d'une demande (verrou de clôture) ; le rejeter ou l'annuler. Réservée au DG.
- [ ] `treso.decider_dg` — Décider à l'étape DG : valider ou rejeter les articles soumis, confirmer un dépassement de budget, renvoyer à la Finance. Non délégable.
- [ ] `treso.valider_budget` — Valider ou rejeter un paramétrage de budget (catégories et seuils de caisse). Réservée au DG.
- [ ] `treso.creer_demande` — Créer une demande d'achat (« Nouvelle demande ») et voir ses propres demandes.
- [ ] `treso.declarer_retour` — Déclarer un retour de caisse sur ses propres demandes réglées (date et montant).

**Pointage** (3)

- [ ] `pointage.consulter_tous` — Consulter les pointages de tous les employés (présence du jour).
- [ ] `pointage.voir_dashboard_rh` — Voir le tableau de bord RH (présences, retards, absences).
- [ ] `pointage.voir_reporting` — Voir et exporter le reporting RH du pointage.

**Congés** (2)

- [ ] `conges.soumettre` — Demander un congé et consulter les siens.
- [ ] `conges.consulter_tous` — Consulter les congés de tous les employés et les exporter.

**Feedback** (1)

- [ ] `feedback.moderer` — Modérer les messages de FeedbackApp (masquer, rétablir) et exporter.

**Système** (2)

- [ ] `systeme.reinitialiser` — Remise à zéro globale de mise en production (écran « Réinitialisation »), usage unique. DG seul, jamais déléguée, jamais cochable dans /admin/roles.
- [ ] `enc.mettre_en_service` — Encaissements : mettre le module en service (remise à zéro à usage unique). Aucun écran ne l'utilise encore. DG seul.

### Admin

Administrateur du portail.

- Accès à la console d'administration (« Administrateur », fixé à la création) : **oui**
- Peut être bénéficiaire d'une délégation : **non**
- Peut recevoir un feedback (FeedbackApp) : **non**
- Nombre de permissions à cocher : **2**

**Pointage** (1)

- [ ] `pointage.reinitialiser` — Purger les données du Pointage avant sa mise en service, puis le mettre en service. Jamais délégable.

**Feedback** (1)

- [ ] `feedback.moderer` — Modérer les messages de FeedbackApp (masquer, rétablir) et exporter.

L'accès à la console `/admin` vient du réglage « Administrateur » du rôle, pas d'une case à cocher. Ce rôle ne doit porter aucune autre permission métier que celles ci-dessus.

### RH

Gère le pointage, les retards, absences et reportings RH.

- Accès à la console d'administration (« Administrateur », fixé à la création) : **non**
- Peut être bénéficiaire d'une délégation : **non**
- Peut recevoir un feedback (FeedbackApp) : **oui**
- Nombre de permissions à cocher : **13**

**Pointage** (8)

- [ ] `pointage.pointer` — Pointer son arrivée et son départ (QR code, ordinateur, géolocalisation).
- [ ] `pointage.consulter_historique` — Consulter son propre historique de pointage.
- [ ] `pointage.consulter_tous` — Consulter les pointages de tous les employés (présence du jour).
- [ ] `pointage.pointage_exceptionnel` — Pointer à la place d'un collaborateur (régularisation exceptionnelle).
- [ ] `pointage.corriger_pointage` — Corriger un pointage (registre tracé), traiter les absences, décider les justifications en repli du responsable de service.
- [ ] `pointage.gerer_horaires` — Régler les horaires de référence, la tolérance et la géolocalisation du bureau.
- [ ] `pointage.voir_dashboard_rh` — Voir le tableau de bord RH (présences, retards, absences).
- [ ] `pointage.voir_reporting` — Voir et exporter le reporting RH du pointage.

**Congés** (4)

- [ ] `conges.soumettre` — Demander un congé et consulter les siens.
- [ ] `conges.valider_rh` — Valider un congé à l'étape RH et enregistrer un congé pour un salarié. Non délégable, lue sur le rôle.
- [ ] `conges.annuler` — Annuler un congé, même déjà commencé (demandeur : seulement avant le début, sans cette permission).
- [ ] `conges.consulter_tous` — Consulter les congés de tous les employés et les exporter.

**Feedback** (1)

- [ ] `feedback.moderer` — Modérer les messages de FeedbackApp (masquer, rétablir) et exporter.

### Assistant Finance

Exécute les règlements/décaissements et réceptionne les retours de caisse (séparation des tâches).

- Accès à la console d'administration (« Administrateur », fixé à la création) : **non**
- Peut être bénéficiaire d'une délégation : **oui**
- Peut recevoir un feedback (FeedbackApp) : **oui**
- Nombre de permissions à cocher : **6**

**Trésorerie** (5)

- [ ] `treso.effectuer_reglement` — Créer, modifier, confirmer (décaisser) un règlement, Caisse ou Banque. Jamais sur sa propre demande.
- [ ] `treso.receptionner_retour` — Réceptionner un retour de caisse, détailler les dépenses d'un fonds remis, marquer une dépense « sans pièce formelle », déclarer à la place du collaborateur, saisir un retour exceptionnel après clôture.
- [ ] `treso.modifier_description` — Modifier la description d'une demande et le libellé de ses articles (les deux versions restent visibles).
- [ ] `treso.creer_demande` — Créer une demande d'achat (« Nouvelle demande ») et voir ses propres demandes.
- [ ] `treso.declarer_retour` — Déclarer un retour de caisse sur ses propres demandes réglées (date et montant).

**Congés** (1)

- [ ] `conges.soumettre` — Demander un congé et consulter les siens.

### Encaissements – Équipe technique

Produit et importe le fichier de production, annule un contrat, consulte les signalements.

- Accès à la console d'administration (« Administrateur », fixé à la création) : **non**
- Peut être bénéficiaire d'une délégation : **non**
- Peut recevoir un feedback (FeedbackApp) : **oui**
- Nombre de permissions à cocher : **3**

**Encaissements** (3)

- [ ] `enc.consulter` — Encaissements : consulter les polices, le registre, les signalements et exporter.
- [ ] `enc.importer_production` — Encaissements : déposer le fichier de production et la reprise ; télécharger les fichiers importés.
- [ ] `enc.annuler_contrat` — Encaissements : annuler un contrat. Sert aussi à reconnaître un import de l'Équipe technique.

### Encaissements – Finance

Importe la production, appelle une police, saisit/confirme/corrige/contre-passe un encaissement, gère l'argent non identifié, marque payés taxes/commissions/honoraires/accessoires, paramètre le module, exporte.

- Accès à la console d'administration (« Administrateur », fixé à la création) : **non**
- Peut être bénéficiaire d'une délégation : **non**
- Peut recevoir un feedback (FeedbackApp) : **oui**
- Nombre de permissions à cocher : **8**

**Encaissements** (8)

- [ ] `enc.consulter` — Encaissements : consulter les polices, le registre, les signalements et exporter.
- [ ] `enc.importer_production` — Encaissements : déposer le fichier de production et la reprise ; télécharger les fichiers importés.
- [ ] `enc.saisir_encaissement` — Encaissements : saisir un versement depuis la fiche d'une police.
- [ ] `enc.confirmer_paiement` — Encaissements : confirmer ou marquer « non reçu » les paiements, ligne par ligne ou par lot ; importer un relevé.
- [ ] `enc.corriger_encaissement` — Encaissements : corriger ou contre-passer un encaissement. Aucun écran ne l'utilise encore (prévu au lot 4 du module).
- [ ] `enc.gerer_non_identifie` — Encaissements : gérer l'argent non identifié (affecter, classer hors prime). Aucun écran ne l'utilise encore.
- [ ] `enc.marquer_paye` — Encaissements : marquer payés taxes, commissions, honoraires et accessoires. Aucun écran ne l'utilise encore (prévu au lot 4).
- [ ] `enc.parametrer` — Encaissements : paramétrer branches, honoraires, partage des accessoires et taux de contrôle.

### Encaissements – Consultation

Consultation et export, aucune modification.

- Accès à la console d'administration (« Administrateur », fixé à la création) : **non**
- Peut être bénéficiaire d'une délégation : **non**
- Peut recevoir un feedback (FeedbackApp) : **oui**
- Nombre de permissions à cocher : **1**

**Encaissements** (1)

- [ ] `enc.consulter` — Encaissements : consulter les polices, le registre, les signalements et exporter.

### Responsable de service (pas un rôle)

Un responsable de service est désigné dans **Admin > Services** (champ responsable). Il n'a besoin d'**aucune permission** pour valider l'étape Service des demandes de son équipe, décider les justifications de pointage de son équipe, décider les congés de son service et consulter « Mon équipe ». Son compte porte un rôle ordinaire (Collaborateur dans le seed). **Rien à cocher.**

## Synthèse : nombre de permissions par rôle et par module

| Rôle | Trésorerie | Pointage | Congés | Encaissements | Feedback | Système | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| Collaborateur | 2 | 2 | 1 | 0 | 0 | 0 | 5 |
| Finance | 22 | 0 | 1 | 0 | 0 | 0 | 23 |
| DG | 7 | 3 | 2 | 0 | 1 | 2 | 15 |
| Admin | 0 | 1 | 0 | 0 | 1 | 0 | 2 |
| RH | 0 | 8 | 4 | 0 | 1 | 0 | 13 |
| Assistant Finance | 5 | 0 | 1 | 0 | 0 | 0 | 6 |
| Encaissements – Équipe technique | 0 | 0 | 0 | 3 | 0 | 0 | 3 |
| Encaissements – Finance | 0 | 0 | 0 | 8 | 0 | 0 | 8 |
| Encaissements – Consultation | 0 | 0 | 0 | 1 | 0 | 0 | 1 |
| **Catalogue** | 27 | 9 | 4 | 9 | 1 | 2 | 52 |

## À VALIDER PAR LE DG

Cas où le code ne tranche pas : une décision de l'organisation est nécessaire avant de régler la production.

- **À VALIDER PAR LE DG — V1. Pointage des équipes Finance, Assistant Finance, DG et Encaissements.** Ces rôles ne portent ni `pointage.pointer` ni `pointage.consulter_historique`. Si leurs membres doivent pointer, créer un rôle combiné ou cocher ces deux permissions sur le rôle. Le code ne décide pas qui pointe ; c'est une décision d'organisation.
- **À VALIDER PAR LE DG — V2. Compte Admin : `feedback.moderer` et `pointage.reinitialiser`.** Le rôle Admin porte ces deux permissions par décision datée (17/09/2026 et 14/10/2026), contrairement à la règle « Admin sans permission métier ». Conséquence : tout compte du rôle Admin peut modérer FeedbackApp et purger le Pointage tant qu'il n'est pas en service. À confirmer, ou à décocher dans /admin/roles.
- **À VALIDER PAR LE DG — V3. Permissions Encaissements sans écran.** `enc.corriger_encaissement`, `enc.gerer_non_identifie`, `enc.marquer_paye` et `enc.mettre_en_service` ne sont lues par aucun écran à ce jour (lots 3 et 4 du module non livrés). Elles sont cochées sur Encaissements – Finance (les trois premières) et sur le DG (la dernière) d'après le cahier des charges ; rien ne dépend d'elles tant que les écrans n'existent pas.
- **À VALIDER PAR LE DG — V4. Qui accède à l'Accueil Finance.** L'Assistant Finance n'a pas `treso.voir_dashboard_finance` : il n'a donc pas d'« Accueil Finance » (seulement « Accueil »). Le DG et la Finance l'ont. Décision de permission, pas de libellé : à confirmer.
- **À VALIDER PAR LE DG — V5. Congés des rôles estAdmin.** Un rôle « Administrateur » (`estAdmin`) ne reçoit que `conges.soumettre`. `conges.valider_rh`, `conges.annuler` et `conges.consulter_tous` se cochent à la main ; ils ne doivent pas l'être pour un compte technique. Vérifier quels comptes de la production portent un rôle `estAdmin` : ils pourront demander un congé.
- **À VALIDER PAR LE DG — V6. Un seul rôle par compte et rôles combinés.** Un compte n'a qu'un rôle. Une personne qui cumule des fonctions (ex. Finance et RH, Encaissements et Collaborateur) exige un rôle combiné créé dans /admin/roles. Éviter les combinaisons qui contournent la séparation des tâches : `treso.decider_finance` avec `treso.decider_dg`, ou `treso.decider_finance` avec `treso.effectuer_reglement`. Le code applique la règle « deux personnes » par compte, mais un rôle combiné rend la séparation fragile.
- **À VALIDER PAR LE DG — V7. Responsable de service.** « Responsable de service » n'est pas un rôle : il est désigné dans Admin > Services (`Service.responsableId`) et n'a besoin d'aucune permission pour valider l'étape Service, décider les justifications de pointage de son équipe et les congés de son service. Les comptes responsables du seed portent le rôle Collaborateur. À confirmer qu'aucun rôle dédié n'est voulu.
- **À VALIDER PAR LE DG — V8. Rôle RH et DG sur les congés.** La RH décide l'étape RH des congés (`conges.valider_rh`, `conges.annuler`). Le DG n'y décide qu'en repli, quand aucun autre compte RH n'existe (point ouvert O1 du module Congés, provisoire). À confirmer.
- **À VALIDER PAR LE DG — V9. Rôles Encaissements.** Trois rôles de départ (Équipe technique : consulter, importer la production, annuler un contrat ; Finance : tout le reste sauf l'annulation de contrat ; Consultation : consulter seulement). Le DG n'a aucune permission `enc.*` hormis `enc.mettre_en_service` : il ne consulte pas le module Encaissements avec son rôle actuel. Si le DG ou une autre personne doit y accéder, créer un rôle combiné. À confirmer.
- **À VALIDER PAR LE DG — V10. Permissions attribuées par la migration sur une production déjà seedée.** La production n'est plus re-seedée : seules les migrations y ajoutent des permissions, en les donnant aux rôles qui portent la permission « sœur ». Si un rôle de la production a été modifié à la main depuis le premier seed (cases cochées ou décochées dans /admin/roles), il peut différer de ce document. Comparer avec `roles-et-permissions-base.md` (script `lister-roles-permissions.ts`) avant de cocher.

## Écarts entre le seed et les migrations

Vérifié le 2026-10-22 sur deux bases jetables : (1) toutes les migrations seules ; (2) une simulation de production (seed du 2026-09-17, puis toutes les migrations). Résultat :

- Les **76 attributions rôle ↔ permission** de la simulation de production sont **identiques** à celles d'une base neuve seedée (donc à ce document), sauf ce qui suit.
- **Rôles créés par le seed seulement** : Collaborateur, Finance, DG, Admin, RH. Aucune migration ne les crée : sur une base vide migrée sans seed, ils n'existent pas. Les rôles **Assistant Finance** et **Encaissements** (3) sont créés par des migrations (et par le seed).
- **Permissions créées par le seed seulement** : les 8 permissions `pointage.*` d'origine (le module Pointage est posé par le seed). `pointage.reinitialiser` est créée par migration à condition que le module `pointage` existe ; les 43 autres permissions sont créées par des migrations.
- **Libellés** : identiques entre le seed et les migrations pour les 43 permissions créées par les deux.
- **Non modifié par les migrations** : `treso.approuver_validation_complete` n'est jamais retirée à Finance ou Admin si une ancienne base la leur avait donnée (voir « Permissions réservées »).
- **Libellé de module** : le module Congés s'appelle « Congés » ; le module Trésorerie « Gestion des demandes et trésorerie » ; Encaissements « Encaissements, taxes et commissions ».

## Tableau des permissions

| Clé | Module | Libellé dans /admin/roles | Ce qu'elle permet | Rôles qui la portent |
|---|---|---|---|---|
| `treso.creer_demande` | Gestion des demandes et trésorerie | Créer une demande | Créer une demande d'achat (« Nouvelle demande ») et voir ses propres demandes. | Collaborateur, Finance, DG, Assistant Finance |
| `treso.categoriser_demande` | Gestion des demandes et trésorerie | Catégoriser une demande | Choisir la catégorie et l'objet de chaque article d'une demande (et en créer à la volée). | Finance |
| `treso.valider_demande` | Gestion des demandes et trésorerie | Valider une demande | Ouvre les écrans Finance des demandes (liste « Toutes les demandes », reçus, pièces jointes, retours en lecture seule) et permet de valider ou rejeter une dépense directe. La décision sur les articles d'une demande passe par `treso.decider_finance`. | Finance |
| `treso.effectuer_reglement` | Gestion des demandes et trésorerie | Effectuer un règlement | Créer, modifier, confirmer (décaisser) un règlement, Caisse ou Banque. Jamais sur sa propre demande. | Assistant Finance |
| `treso.declarer_retour` | Gestion des demandes et trésorerie | Déclarer un retour de caisse | Déclarer un retour de caisse sur ses propres demandes réglées (date et montant). | Collaborateur, Finance, DG, Assistant Finance |
| `treso.receptionner_retour` | Gestion des demandes et trésorerie | Réceptionner un retour de caisse | Réceptionner un retour de caisse, détailler les dépenses d'un fonds remis, marquer une dépense « sans pièce formelle », déclarer à la place du collaborateur, saisir un retour exceptionnel après clôture. | Assistant Finance |
| `treso.cloturer_demande` | Gestion des demandes et trésorerie | Clôturer une demande | Clôturer une demande (totale, partielle ou forcée) une fois tous les articles terminés et le DG ayant approuvé. | Finance |
| `treso.approuver_validation_complete` | Gestion des demandes et trésorerie | Approuver la validation complète (verrou de clôture) | Approuver la validation complète d'une demande (verrou de clôture) ; le rejeter ou l'annuler. Réservée au DG. | DG |
| `treso.saisir_depense_directe` | Gestion des demandes et trésorerie | Saisir une dépense directe | Créer une dépense directe (prime, dotation carburant…) pour un bénéficiaire qui n'intervient pas. | Finance |
| `treso.alimenter_caisse` | Gestion des demandes et trésorerie | Enregistrer une alimentation de caisse | Enregistrer une alimentation de caisse (apport d'argent physique, pièce justificative obligatoire). | Finance |
| `treso.corriger_solde_ouverture` | Gestion des demandes et trésorerie | Définir/corriger le solde d'ouverture de caisse | Définir puis corriger le solde d'ouverture de la caisse (pièce justificative et motif). | Finance |
| `treso.voir_dashboard_finance` | Gestion des demandes et trésorerie | Voir le dashboard finance | Voir l'Accueil Finance (indicateurs, graphiques, solde de caisse) et consulter les listes Finance. | Finance, DG |
| `treso.voir_reporting` | Gestion des demandes et trésorerie | Voir le reporting | Voir et exporter le reporting Trésorerie (tableau unique et fichier Excel). | Finance, DG |
| `treso.gerer_categories` | Gestion des demandes et trésorerie | Gérer les catégories et objets d'achat (créer/supprimer) | Créer et supprimer des catégories et des objets d'achat, les désactiver ou réactiver, régler la date de catégorisation obligatoire. | Finance |
| `treso.decider_finance` | Gestion des demandes et trésorerie | Décider à l'étape Finance (valider ou rejeter les lignes) | Décider à l'étape Finance : valider ou rejeter chaque article d'une demande. Non délégable. | Finance |
| `treso.soumettre_dg` | Gestion des demandes et trésorerie | Soumettre ou resoumettre une demande au DG | Soumettre (ou resoumettre) un article ou une demande au DG, avec le motif. Non délégable. | Finance |
| `treso.annuler_reglement` | Gestion des demandes et trésorerie | Annuler un règlement confirmé | Annuler un règlement confirmé (écriture compensatoire dans la caisse). | Finance |
| `treso.ajuster_retour` | Gestion des demandes et trésorerie | Ajuster le total déclaré d'un retour de caisse | Ajuster le total déclaré d'un retour de caisse. | Finance |
| `treso.valider_remboursement` | Gestion des demandes et trésorerie | Valider ou rejeter un remboursement de retour | Valider ou rejeter un remboursement de retour (correction d'un retour déjà réceptionné). | Finance |
| `treso.valider_retour_exceptionnel` | Gestion des demandes et trésorerie | Valider ou rejeter un retour exceptionnel post-clôture | Valider ou rejeter un retour exceptionnel après clôture (entrée en caisse à la validation). | Finance |
| `treso.creer_retour_externe` | Gestion des demandes et trésorerie | Enregistrer un retour externe (hors demande) | Enregistrer un retour externe (argent revenu hors demande, ex. chèque), rattaché ou non à une demande. | Finance |
| `treso.modifier_budget_categorie` | Gestion des demandes et trésorerie | Modifier le budget d'une catégorie | Paramétrer les budgets de catégorie et les seuils du budget de caisse (soumis ensuite à la validation du DG). | Finance |
| `treso.deleguer_acces` | Gestion des demandes et trésorerie | Déléguer des accès | Ouvrir l'écran « Déléguer des accès » et déléguer certaines permissions à un autre compte. | Finance |
| `treso.decider_dg` | Gestion des demandes et trésorerie | Décider à l'étape DG (valider ou rejeter une demande soumise) | Décider à l'étape DG : valider ou rejeter les articles soumis, confirmer un dépassement de budget, renvoyer à la Finance. Non délégable. | DG |
| `treso.reorienter_demande` | Gestion des demandes et trésorerie | Réorienter l'étape Service d'une demande vers un autre responsable | Réorienter l'étape Service d'une demande vers un autre responsable (le demandeur peut réorienter la sienne sans cette permission). | Finance |
| `treso.valider_budget` | Gestion des demandes et trésorerie | Valider ou refuser un paramétrage de budget (DG) | Valider ou rejeter un paramétrage de budget (catégories et seuils de caisse). Réservée au DG. | DG |
| `treso.modifier_description` | Gestion des demandes et trésorerie | Modifier la description d'une demande et le libellé de ses lignes | Modifier la description d'une demande et le libellé de ses articles (les deux versions restent visibles). | Finance, Assistant Finance |
| `pointage.pointer` | Pointage RH | Pointer (arrivée / départ) | Pointer son arrivée et son départ (QR code, ordinateur, géolocalisation). | Collaborateur, RH |
| `pointage.consulter_historique` | Pointage RH | Consulter son propre historique de pointage | Consulter son propre historique de pointage. | Collaborateur, RH |
| `pointage.consulter_tous` | Pointage RH | Consulter les pointages de tous les employés | Consulter les pointages de tous les employés (présence du jour). | DG, RH |
| `pointage.pointage_exceptionnel` | Pointage RH | Pointer à la place d'un collaborateur | Pointer à la place d'un collaborateur (régularisation exceptionnelle). | RH |
| `pointage.corriger_pointage` | Pointage RH | Corriger un pointage | Corriger un pointage (registre tracé), traiter les absences, décider les justifications en repli du responsable de service. | RH |
| `pointage.gerer_horaires` | Pointage RH | Paramétrer les horaires de référence | Régler les horaires de référence, la tolérance et la géolocalisation du bureau. | RH |
| `pointage.voir_dashboard_rh` | Pointage RH | Voir le dashboard RH | Voir le tableau de bord RH (présences, retards, absences). | DG, RH |
| `pointage.voir_reporting` | Pointage RH | Voir le reporting RH | Voir et exporter le reporting RH du pointage. | DG, RH |
| `pointage.reinitialiser` | Pointage RH | Réinitialiser les données du Pointage avant sa mise en service | Purger les données du Pointage avant sa mise en service, puis le mettre en service. Jamais délégable. | Admin |
| `conges.soumettre` | Congés | Demander un congé, consulter les siens | Demander un congé et consulter les siens. | Collaborateur, Finance, DG, RH, Assistant Finance |
| `conges.valider_rh` | Congés | Valider un congé (étape RH), enregistrer un congé pour un salarié | Valider un congé à l'étape RH et enregistrer un congé pour un salarié. Non délégable, lue sur le rôle. | RH |
| `conges.annuler` | Congés | Annuler un congé, même commencé | Annuler un congé, même déjà commencé (demandeur : seulement avant le début, sans cette permission). | RH |
| `conges.consulter_tous` | Congés | Consulter les congés de tous les employés et les exporter | Consulter les congés de tous les employés et les exporter. | DG, RH |
| `enc.consulter` | Encaissements, taxes et commissions | Encaissements : consulter et exporter | Encaissements : consulter les polices, le registre, les signalements et exporter. | Encaissements – Équipe technique, Encaissements – Finance, Encaissements – Consultation |
| `enc.importer_production` | Encaissements, taxes et commissions | Encaissements : importer le fichier de production | Encaissements : déposer le fichier de production et la reprise ; télécharger les fichiers importés. | Encaissements – Équipe technique, Encaissements – Finance |
| `enc.annuler_contrat` | Encaissements, taxes et commissions | Encaissements : annuler un contrat (écran ou import) | Encaissements : annuler un contrat. Sert aussi à reconnaître un import de l'Équipe technique. | Encaissements – Équipe technique |
| `enc.saisir_encaissement` | Encaissements, taxes et commissions | Encaissements : saisir un encaissement (fiche police, paiement pour plusieurs contrats) | Encaissements : saisir un versement depuis la fiche d'une police. | Encaissements – Finance |
| `enc.confirmer_paiement` | Encaissements, taxes et commissions | Encaissements : confirmer les paiements du fichier technique, importer un relevé, les frais des opérateurs | Encaissements : confirmer ou marquer « non reçu » les paiements, ligne par ligne ou par lot ; importer un relevé. | Encaissements – Finance |
| `enc.corriger_encaissement` | Encaissements, taxes et commissions | Encaissements : corriger ou contre-passer un encaissement | Encaissements : corriger ou contre-passer un encaissement. Aucun écran ne l'utilise encore (prévu au lot 4 du module). | Encaissements – Finance |
| `enc.gerer_non_identifie` | Encaissements, taxes et commissions | Encaissements : gérer l'argent non identifié (affecter, classer hors prime) | Encaissements : gérer l'argent non identifié (affecter, classer hors prime). Aucun écran ne l'utilise encore. | Encaissements – Finance |
| `enc.marquer_paye` | Encaissements, taxes et commissions | Encaissements : marquer payés (et décocher) taxes, commissions, honoraires et accessoires | Encaissements : marquer payés taxes, commissions, honoraires et accessoires. Aucun écran ne l'utilise encore (prévu au lot 4). | Encaissements – Finance |
| `enc.parametrer` | Encaissements, taxes et commissions | Encaissements : paramétrer les honoraires, le partage des accessoires, les taux de contrôle et les branches | Encaissements : paramétrer branches, honoraires, partage des accessoires et taux de contrôle. | Encaissements – Finance |
| `feedback.moderer` | FeedbackApp | Modérer les messages FeedbackApp | Modérer les messages de FeedbackApp (masquer, rétablir) et exporter. | DG, Admin, RH |
| `systeme.reinitialiser` | Système | *(non affichée : module Système)* | Remise à zéro globale de mise en production (écran « Réinitialisation »), usage unique. DG seul, jamais déléguée, jamais cochable dans /admin/roles. | DG |
| `enc.mettre_en_service` | Système | *(non affichée : module Système)* | Encaissements : mettre le module en service (remise à zéro à usage unique). Aucun écran ne l'utilise encore. DG seul. | DG |
