# Cahier des charges V2.6 — Module Encaissements, taxes (reçu le 2026-09-28)

> Remplace entièrement le cahier V1 et le document « Réponses aux questions » du 2026-09-28. En cas de différence avec la maquette (docs/Maquette_registre_paiements.html), ce cahier fait foi.

## 1. Objet et principes

Le module suit, police par police et branche par branche, les encaissements des clients et ce qui en découle : taxes à reverser, commissions, honoraires et accessoires dus. Il remplace le classeur Excel actuel (colonnes A à AH). Ce n’est pas un outil comptable : il n’y a ni écritures comptables ni clôture de période. La maquette jointe (Maquette_registre_paiements.html) montre le fonctionnement attendu pour les fonctions F1 à F7, F9 et F10 et les états de la section 6. Elle ne couvre pas : les annulations (F8), les taux de contrôle, les droits par profil, le journal d’audit, l’option de reprise initiale (F1.5), les totaux de contrôle d’import (F1.2), la référence du paiement saisie en cochant « payé » (F7.1) ni la correction et la contre-passation d’un encaissement (F3.5), ni l’historique des bénéficiaires d’honoraires (3.6). En cas de différence, ce cahier fait foi.

Ce document remplace entièrement la version 1 et le document « Réponses aux questions » : en cas de différence, seul ce document compte.

Six principes guident tout le document :

1.  **Le fichier de production fait foi.** L’équipe technique transmet chaque mois, par branche, un fichier de production. Les contrats et leurs montants (prime TTC, prime nette, accessoires, taxes, commission, honoraires) en viennent. Ces montants ne sont jamais recalculés ni saisis à la main.
2.  **L’utilisateur ne saisit que des encaissements** : ceux qui ont échappé à l’équipe technique, et la confirmation de ceux que l’équipe technique a indiqués. Aucun contrat n’est créé à l’écran. Les encaissements entrent par trois voies seulement : le fichier de production (F1), la saisie à l’écran (F3, F4, F6) et le relevé mobile money ou bancaire (F5) ; il n’y a pas d’autre import d’encaissements.
3.  **Seul un encaissement confirmé compte.** Un paiement indiqué dans le fichier de production reste « à confirmer » et n’entre dans aucun calcul tant que l’utilisateur ne l’a pas vérifié (relevé Wave, banque, chèque).
4.  **Chaque encaissement reçoit sa part au prorata** de chaque élément de la prime (colonnes Z à AD, commission, honoraires, accessoires).
5.  **La taxe est calculée à la production mais exigible à l’encaissement** : un encaissement du mois N rend sa taxe exigible en N+1, à reverser avant le 20. Un encaissement pris en compte en retard est reporté sur la déclaration suivante (section 5.3).
6.  **Tout se suit par branche.**

L’application calcule ce qui est dû. Elle n’exécute aucun paiement : les commissions, honoraires, accessoires et taxes sont payés hors application, selon le circuit de signatures multiples de la compagnie, puis marqués « payés » dans l’application. Aucun encaissement ne se fait en espèces.

## 2. Utilisateurs et droits

| **Profil**       | **Peut faire**                                                                                                                                                                                                                                                                                                                                                                                                    | **Ne peut pas faire**                                                                           |
|------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Équipe technique | Produire le fichier de production ; l’importer ; annuler un contrat (dans le fichier ou à l’écran) ; consulter les signalements                                                                                                                                                                                                                                                                                   | Saisir, confirmer, corriger un encaissement ; marquer un montant payé ; modifier les paramètres |
| Finance          | Tout le reste : importer le fichier de production transmis par l’équipe technique ; appeler une police ; saisir, confirmer, déclarer non reçu, corriger ou contre-passer un encaissement ; gérer l’argent non identifié ; marquer payés (et décocher) taxes, commissions, honoraires et accessoires ; modifier les paramètres (partage des accessoires, bénéficiaire des honoraires, taux de contrôle) ; exporter | Annuler un contrat ; modifier les montants venant du fichier de production                      |
| Consultation     | Consulter et exporter                                                                                                                                                                                                                                                                                                                                                                                             | Toute modification                                                                              |

Chaque action est tracée : qui, quand, valeur avant, valeur après.

## 3. Données

## 3.1 Contrat

Toutes les informations du contrat viennent du fichier de production (section 7) et s’affichent en lecture seule.

| **Donnée**                                                         | **Colonne du fichier**                                              | **Règle**                                                                                                                         |
|--------------------------------------------------------------------|---------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| N° de police                                                       | C                                                                   | Clé unique : le numéro complet, tel que fourni par la production (le suffixe, par exemple « I00000 », peut identifier un avenant) |
| Branche                                                            | Colonne « Branche » si elle existe, sinon choisie à l’import        | Obligatoire                                                                                                                       |
| Type de contrat, produit (libellé, code), type d’opération         | D, E, F, G                                                          | —                                                                                                                                 |
| Client (ID, nom), partenaire                                       | H, I, J                                                             | Le partenaire est le bénéficiaire des commissions                                                                                 |
| Date d’effet, date d’échéance                                      | O, P                                                                | La date d’effet est la date de production                                                                                         |
| Prime TTC, prime nette, accessoires, taxes, commission, honoraires | S, T, U, V, W, X                                                    | Font foi ; jamais recalculés                                                                                                      |
| Type police                                                        | Y                                                                   | —                                                                                                                                 |
| Statut d’annulation, date, motif                                   | Colonnes du fichier ou saisie par l’équipe technique                | Voir F8                                                                                                                           |
| Part partenaire et part SIM sur accessoires (%)                    | Saisie facultative dans la fiche de la police (les deux font 100 %) | Passe avant le taux du partenaire (section 5.4)                                                                                   |

## 3.2 Encaissement (versement)

| **Donnée**                   | **Règle**                                                                                                                                                                                                                                                                    |
|------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| PaiementID                   | PAI-AAAA-NNNNNN, AAAA = année de saisie ; unique, jamais réutilisé                                                                                                                                                                                                           |
| Date de paiement             | Date réelle du paiement par le client ; obligatoire                                                                                                                                                                                                                          |
| Mode                         | CHQ, VIR, OM, MTN, WAVE, CB, MOB ; pas d’espèces                                                                                                                                                                                                                             |
| Référence                    | Obligatoire pour tous les nouveaux encaissements. **Wave : l’identifiant de transaction Wave** (commence par T\_, par exemple T_BFOSCYZTWBILN62K) ; chèque : numéro du chèque ; virement : référence bancaire. Les encaissements historiques sans référence restent acceptés |
| Montant reçu TTC (Z)         | Supérieur à 0 pour un encaissement ; négatif seulement pour une contre-passation ou un remboursement saisi par la finance (F3.5). Un dépassement de la prime TTC déclenche une alerte : la finance confirme ou corrige                                                       |
| Source                       | « Fichier technique » ou « Saisie manuelle »                                                                                                                                                                                                                                 |
| Statut                       | Fichier technique : « à confirmer », puis « confirmé » ou « non reçu ». Saisie manuelle : « confirmé » dès l’enregistrement                                                                                                                                                  |
| Date de saisie               | Date d’enregistrement dans l’application                                                                                                                                                                                                                                     |
| Date de confirmation         | Pour un paiement du fichier : date à laquelle l’utilisateur l’a confirmé                                                                                                                                                                                                     |
| Date de prise en compte      | Date de saisie (manuelle), de confirmation (fichier) ou d’affectation (paiement non affecté). Sert à l’exigibilité de la taxe (section 5.3)                                                                                                                                  |
| Motif de non-réception       | Obligatoire si « non reçu »                                                                                                                                                                                                                                                  |
| Référence de paiement groupé | Si le même chèque ou virement paie plusieurs contrats (F4)                                                                                                                                                                                                                   |
| Montants calculés            | Z, AA, AB, AC, AD, commission, honoraires, part accessoires partenaire et SIM, mois d’exigibilité de la taxe ; calculés à la confirmation puis figés                                                                                                                         |
| Payé                         | Pour la taxe, la commission, les honoraires et la part accessoires du partenaire : date et référence du paiement fait hors application                                                                                                                                       |

## 3.3 Argent non identifié (paiement non affecté)

Paiement reçu qu’on ne sait pas encore rattacher : numéro SUS-AAAA-NNNNNN, date de réception, mode, référence, montant, payeur présumé, statut (non affecté, affecté, classé hors prime), date d’affectation, polices et montants d’affectation, motif de classement.

## 3.4 Signalement

Trace de chaque police déjà connue qui revient dans un fichier de production : fichier, date d’import, branche, police, paiement indiqué dans le fichier, analyse (section F1), statut (à traiter, pour information, traité).

## 3.5 Frais des opérateurs

Par opérateur et par mois : nombre de paiements reçus, montant brut, frais, montant net, relevé d’origine, date d’import. Alimenté par l’import des relevés (F5.9).

## 3.6 Paramètres

- Bénéficiaire des honoraires : NOVELIA à ce jour ; modifiable, avec date de début. Les honoraires d’un encaissement reviennent au bénéficiaire en vigueur à sa **date de prise en compte** ; un changement de bénéficiaire ne modifie pas les encaissements antérieurs.
- Jour limite de reversement des taxes : **20** par défaut, paramétrable (1 à 28).
- Partage des accessoires par partenaire : pour chaque partenaire (liste illimitée, alimentée automatiquement par les imports, recherche par nom, ajout manuel possible), part partenaire et part SIM en %, dont la somme fait 100 %. Un taux par défaut s’applique aux partenaires sans taux (0 % partenaire au départ).
- Taux de contrôle (facultatif) : par produit et par partenaire, taux de taxe, de commission, d’accessoires et d’honoraires attendus. Ils servent seulement à signaler des écarts à l’import ; ils ne modifient jamais un montant.

## 4. Fonctionnalités

## F1. Import mensuel du fichier de production

1.  L’utilisateur choisit le fichier. Si le fichier n’a pas de colonne « Branche », l’application demande la branche.
2.  L’import enregistre qui l’a fait, quand, le nom du fichier et ses totaux de contrôle (nombre de lignes, total des primes TTC), pour comparaison avec l’état de production de l’équipe technique.
3.  **Police nouvelle** : le contrat est créé. Si la ligne contient un paiement, il est créé « à confirmer ».
4.  **Police déjà connue** : les informations du contrat sont mises à jour. Si la prime a changé, c’est signalé (avenant possible) ; les encaissements déjà confirmés gardent leurs montants figés, les suivants utilisent les nouveaux montants. Si la ligne contient un paiement :

| **Cas**                                                                                   | **Traitement**         | **Signalement**                                                                                                |
|-------------------------------------------------------------------------------------------|------------------------|----------------------------------------------------------------------------------------------------------------|
| Même PaiementID, même référence, ou même date et même montant qu’un encaissement existant | Non ajouté             | Pour information : « déjà présent »                                                                            |
| Même montant (à 1 FCFA près) qu’un encaissement existant, à 7 jours près                  | Non ajouté             | À traiter : « doublon possible », avec la référence de l’encaissement existant ; bouton « Ajouter quand même » |
| Date, mode ou montant manquant                                                            | Non ajouté             | À traiter : « à compléter »                                                                                    |
| Paiement Wave dont la référence n’est pas un identifiant de transaction (T\_…)            | Ajouté « à confirmer » | À traiter : « référence Wave non conforme », il ne pourra pas être rapproché automatiquement                   |
| Autre cas                                                                                 | Ajouté « à confirmer » | Pour information                                                                                               |
| Police revenue sans aucune information de paiement                                        | —                      | À traiter : « à vérifier »                                                                                     |

5.  **Reprise initiale du classeur actuel** (une seule fois) :
    - les paiements repris sont importés directement « confirmés » ;
    - leur date de prise en compte est leur **date de paiement réelle** : la taxe reste rattachée à son mois d’origine, sans mention « Régularisation » ;
    - la finance fixe au moment de la reprise une **date de bascule par nature** (taxe, commission, honoraires, part accessoires du partenaire), qui peut être la même pour les quatre. Pour chaque nature, tout paiement repris dont la **date d’enregistrement (colonne A)** est antérieure ou égale à la date de bascule est marqué « payé » avec la mention « reprise » ; les paiements enregistrés après restent à payer. Une nature peut n’avoir aucune date de bascule : tout reste alors à payer. **Décision SIM pour la reprise : taxes, bascule au 30/09/2026 ; commissions, honoraires et accessoires, pas de bascule** ;
    - les taux de partage des accessoires par partenaire (et les exceptions par police) doivent être saisis **avant** la reprise, car ils sont figés sur chaque encaissement repris ;
    - les exceptions (montants antérieurs à la bascule mais en réalité non payés) sont corrigées ensuite par la finance en décochant « payé » (F7.4) ;
    - un rapport de reprise indique, par nature et par branche, les totaux marqués « payé (reprise) » et les totaux restant à payer, pour contrôle avant validation.
6.  Un rapport d’import s’affiche : contrats créés, mis à jour, paiements à confirmer, cas à traiter. Les lignes marquées annulées dans un fichier importé par la finance sont rejetées (annulation réservée à l’équipe technique).
7.  Les écarts avec les taux de contrôle (section 3.6) et les incohérences (prime nette + accessoires + taxes ≠ prime TTC) sont signalés sans bloquer.

## F2. Appeler une police

Une barre de recherche, accessible depuis tous les écrans, trouve une police par son numéro, le nom ou l’identifiant du client, le partenaire, le produit, la branche ou une référence de paiement (plusieurs mots possibles). Chaque résultat affiche le client, le partenaire, la branche et le reste dû. Un clic ou Entrée ouvre la fiche.

## F3. Saisir un encaissement

1.  Dans la fiche de la police : « Ajouter un versement ».
2.  L’utilisateur saisit la date de paiement, le mode, la référence et le montant. Le montant proposé est le reste dû.
3.  À l’enregistrement, l’encaissement est confirmé : ses montants au prorata sont calculés et figés, son numéro est attribué dans l’ordre de prise en compte.
4.  La ligne affiche : restant dû (AA), prime nette (AB), accessoires (AC), taxe (AD), mois d’exigibilité et date limite, date de saisie, source, et la mention « Régularisation » si la taxe est reportée (section 5.3).
5.  Un encaissement enregistré ne se supprime pas. La finance peut le **corriger** (motif obligatoire) ou le **contre-passer** par une écriture de même montant en négatif (motif obligatoire : erreur de saisie, remboursement, report de trop-perçu). La contre-passation reprend **exactement, en négatif**, les montants figés de l’encaissement d’origine (Z, AB, AC, AD, commission, honoraires, parts d’accessoires), sans nouveau calcul au prorata. Si la taxe d’origine n’est pas encore payée, elle est retirée du **même mois d’exigibilité** ; si une part (taxe, commission, honoraires, accessoires) est déjà marquée payée, l’application le signale « à régulariser » sans calcul automatique.
6.  **Chèque impayé, paiement confirmé à tort** : traités manuellement par la finance avec la contre-passation ci-dessus ; aucun traitement automatique n’est prévu.
7.  L’ordre des encaissements d’une police est l’**ordre de prise en compte** (section 3.2) : il fixe le numéro de versement, le reste dû (AA) et l’encaissement qui reçoit le reliquat (5.2).

## F4. Un paiement pour plusieurs contrats

1.  L’utilisateur saisit une fois la date, le mode, la référence (n° de chèque, Wave…) et le montant total.
2.  Il ajoute une ligne par police réglée (bouton « Ajouter une ligne ») en choisissant une police **existante** ; pour chacune, le reste dû s’affiche et le montant est proposé. Ce bouton ne crée pas de police.
3.  Un compteur affiche montant total, montant réparti et écart ; l’enregistrement exige un écart nul.
4.  Un encaissement est créé dans chaque contrat avec la même référence, chacun avec son propre calcul. Cette référence partagée n’est pas signalée comme un doublon ; elle l’est si elle réapparaît dans un autre paiement.

## F5. Confirmer les paiements du fichier technique

L’utilisateur garde toujours la main : il valide ligne par ligne, ou par lot.

1.  **Liste des paiements en attente**, avec filtres : période de paiement, mode, partenaire, statut (à confirmer, non reçus, tous), recherche (police, client, référence), et la branche choisie en haut de l’écran. Le nombre et le total des paiements affichés sont indiqués.
2.  **Validation ligne par ligne** : bouton « Reçu » ou « Non reçu » sur chaque ligne.
3.  **Validation par lot** : une case par ligne, une case d’en-tête pour tout cocher (sur la liste filtrée), puis « Confirmer la sélection » ou « Déclarer non reçue la sélection » (un seul motif pour tout le lot). Une confirmation est demandée avant d’appliquer un lot.
4.  **Reçu** : le paiement devient confirmé à la date du jour et entre dans les calculs. **Non reçu** : motif obligatoire ; le paiement reste visible, grisé, et ne compte pas ; « Finalement reçu » le rétablit.
5.  **Export** Excel des paiements « non reçus » pour l’équipe technique (police, client, partenaire, branche, date, mode, référence, montant, motif).
6.  **Import d’un relevé mobile money** (Wave, Orange Money, MTN) ou bancaire (format en 7.2). L’application compare les références du relevé avec celles saisies par la production (sans tenir compte des majuscules, espaces et signes ; une référence d’au moins 6 caractères contenue dans l’autre est acceptée) et présente le résultat en quatre groupes, chacun avec cases à cocher, « tout cocher » et un bouton de validation du lot :

| **Groupe**                                              | **Contenu**                                                                                                                                                                                                                                                                                                                                                                                  | **Pré-coché** |
|---------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------|
| 1\. Correspondances exactes                             | Même référence et même montant (brut ou net) à 1 FCFA près                                                                                                                                                                                                                                                                                                                                   | Oui           |
|                                                         | **Transaction partagée** : quand plusieurs paiements « à confirmer » (plusieurs polices) portent la même référence, ils sont comparés **ensemble** à la ligne du relevé ; si leur total égale le montant de la ligne, toutes les polices vont dans le groupe 1, sinon toutes vont dans le groupe 2 avec l’écart sur le total. La mention « transaction partagée par N polices » est affichée |               |
| 2\. Même référence, montant différent                   | Frais de l’opérateur, erreur de saisie ; l’écart est affiché                                                                                                                                                                                                                                                                                                                                 | Non           |
| 3\. Même montant à 3 jours près, sans référence commune | Suggestions, surtout pour les anciens paiements sans référence ; le nom du payeur est affiché                                                                                                                                                                                                                                                                                                | Non           |
| 4\. Reçus sur le relevé sans paiement correspondant     | Lignes dont la référence n’est connue nulle part ; « Noter la sélection en argent non identifié » (F6)                                                                                                                                                                                                                                                                                       | Non           |

7.  **Rien n’est confirmé sans l’utilisateur**, sauf s’il coche l’option « Confirmer automatiquement les correspondances exactes » (décochée par défaut, mémorisée par utilisateur). Les paiements restant « à confirmer » après l’import se traitent comme aux points 2 et 3.
8.  Chaque confirmation enregistre qui l’a faite, quand, et, si elle vient d’un relevé, le nom du relevé et la ligne rapprochée.
9.  **Frais des opérateurs** : à chaque import de relevé, l’application enregistre, par mois et par opérateur, le nombre de paiements reçus, le montant brut payé par les clients, les frais retenus et le net reçu par SIM (toutes les entrées du relevé, rapprochées ou non). Réimporter le relevé d’un même mois et d’un même opérateur remplace ses chiffres (pas de double comptage).

## F6. Argent non identifié (paiements non affectés)

1.  Enregistrement : date de réception, **canal d’arrivée** (Wave, chèque, virement, Orange Money, MTN Money, carte bancaire, autre mobile money ; obligatoire), référence, montant, payeur présumé. Aucune taxe ni commission n’est calculée. Un paiement créé depuis un relevé (F5) reçoit automatiquement le canal du relevé, le nom et le téléphone du payeur.
2.  **Affecter** : le paiement est réparti sur une ou plusieurs polices, comme en F4. Les encaissements créés gardent la date de réception comme date de paiement ; la date d’affectation est leur date de prise en compte.
3.  **Classer hors prime** : pour une somme sans lien avec une prime (remboursement au payeur, erreur) ; motif obligatoire.
4.  Aucun délai limite. La liste affiche le nombre de jours d’attente, en rouge au-delà de 60 jours.
5.  En tête d’écran : total non identifié, puis total et nombre de paiements par canal ; un filtre par canal (Tous, Wave, Chèque, Virement…).

## F7. Marquer payés taxes, commissions, honoraires et accessoires

1.  Sur chaque encaissement confirmé, quatre cases : taxe payée, commission payée, honoraires payés, part accessoires du partenaire payée. Cocher enregistre la date et la référence du paiement fait hors application.
2.  Sur la fiche de la police, un bouton « Tout payé » par nature coche toutes les lignes (pour la taxe, seulement les lignes déjà exigibles).
3.  Dans le suivi des taxes, « Marquer toutes les taxes de ce mois comme payées » coche toutes les lignes d’un mois d’exigibilité (dans la branche choisie).
4.  Décocher une case est possible (finance) et tracé.

## F8. Annulation d’un contrat

1.  Faite par l’équipe technique, dans le fichier de production (colonnes statut, date, motif) ou à l’écran.
2.  Le contrat affiche un badge « Annulé » partout et n’accepte plus d’encaissement, sauf un remboursement (montant négatif).
3.  Trois types : **sans effet** (tout l’encaissé est remboursé), **résiliation en cours de contrat** (prime acquise = prime TTC × jours couverts ÷ durée ; la ristourne est la part encaissée au-delà), **non-paiement** (la part non encaissée est abandonnée, pas de remboursement).
4.  La taxe à la production non encaissée est annulée. Si une taxe, une commission, des honoraires ou une part d’accessoires déjà marqués payés dépassent le nouveau dû, l’application les signale « à régulariser » ; la finance traite la régularisation manuellement.

## F9. Paramètres

Écran de gestion du bénéficiaire des honoraires, du partage des accessoires par partenaire et des taux de contrôle (section 3.6), modifiables par la finance. Pour le partage des accessoires, l’écran liste tous les partenaires avec leur nombre de polices ; on saisit la part partenaire ou la part SIM, l’autre se complète automatiquement. Toute modification est tracée et suit la règle 5.4 pour les encaissements déjà enregistrés.

## F10. Exports

Chaque écran s’exporte en Excel. L’export du registre reprend les colonnes A à AH du classeur actuel, suivies des colonnes de la section 7.3.

## 5. Règles de calcul

## 5.1 Ce qui compte

Seuls les encaissements **confirmés** entrent dans les calculs : reste dû, taxes, commissions, honoraires, accessoires, états. Les paiements « à confirmer » et « non reçus » sont affichés à part.

## 5.2 Prorata d’un encaissement

Les montants S (prime TTC), T (prime nette), U (accessoires), V (taxes), W (commission) et X (honoraires) viennent du fichier. Pour un encaissement de montant Z :

**AB = T × Z ÷ S   AC = U × Z ÷ S   AD = V × Z ÷ S**

**Commission = W × Z ÷ S   Honoraires = X × Z ÷ S**

**AA = S − total des encaissements confirmés jusqu’à celui-ci inclus (dans l’ordre de prise en compte)**

L’encaissement qui solde le contrat (AA = 0) reçoit le reliquat exact de chaque élément, pour que la somme des encaissements soit toujours égale aux montants du fichier. Les montants sont calculés à la confirmation puis figés.

Si le fichier contient une incohérence (T + U + V ≠ S), le calcul reste le même : la taxe totale encaissée est celle du fichier, la ventilation peut s’écarter de quelques francs.

## 5.3 Exigibilité de la taxe

La taxe d’un encaissement est exigible le mois qui suit la date de paiement, à reverser avant le jour limite (le 20 par défaut, paramétrable, section 3.6 ; « le 20 » dans la suite du document désigne ce jour limite). Si l’encaissement est pris en compte trop tard (saisie, confirmation ou affectation), la taxe va sur la première déclaration qui suit la date de prise en compte : le mois de prise en compte si elle a lieu avant le 20, sinon le mois suivant.

**Mois d’exigibilité = le plus tardif de : (mois de paiement + 1) et (mois de prise en compte, ou mois suivant si prise en compte le 20 ou après)**

| **Paiement** | **Pris en compte le** | **Taxe exigible en**       | **À reverser avant le** |
|--------------|-----------------------|----------------------------|-------------------------|
| 10 septembre | 12 septembre          | octobre                    | 20 octobre              |
| 28 septembre | 2 octobre             | octobre                    | 20 octobre              |
| 28 septembre | 25 octobre            | novembre (régularisation)  | 20 novembre             |
| 15 juillet   | 10 septembre          | septembre (régularisation) | 20 septembre            |
| 15 juillet   | 20 septembre          | octobre (régularisation)   | 20 octobre              |

Aucune taxe n’est calculée sur un paiement non affecté, ni sur un paiement à confirmer. Une taxe reportée porte la mention « Régularisation » avec la date de paiement et la date de prise en compte.

## 5.4 Partage des accessoires

La part d’accessoires d’un encaissement (AC) est partagée entre le partenaire et SIM. Le taux retenu est, dans l’ordre :

1.  le taux saisi dans la fiche de la police (part partenaire et part SIM) ;
2.  sinon, le taux du partenaire (paramètres) ;
3.  sinon, le taux par défaut.

Le taux est figé sur chaque encaissement au moment où il est enregistré ou confirmé. Quand l’utilisateur change un taux (sur une police ou sur un partenaire), l’application lui demande s’il faut l’appliquer aussi aux encaissements déjà enregistrés dont la part partenaire n’est pas encore payée ; sinon, le nouveau taux ne vaut que pour les encaissements suivants. Une part déjà payée n’est jamais modifiée.

## 5.5 Contrats payables par mensualités

Le fichier de production donne la prime de toute la période ; le client peut la payer par mensualités, en une fois, ou en combinant les deux. Aucun traitement particulier : chaque encaissement reçoit sa part au prorata (5.2), et celui qui solde le contrat reçoit le reliquat. Le montant proposé à la saisie est toujours le reste dû, ce qui permet de solder en une fois. La taxe suit la règle 5.3 pour chaque encaissement.

## 5.6 Statut de paiement d’une police

Non payé (aucun encaissement confirmé), partiellement payé, totalement payé, trop-perçu (alerte à la saisie, quelle que soit la voie : fiche, paiement pour plusieurs contrats, affectation d’argent non identifié ; la finance décide : remboursement au payeur ou report sur un autre contrat, par contre-passation puis nouvel encaissement daté du jour du report), annulé.

## 6. États

L’application s’organise en sept onglets, avec des libellés simples et un compteur rouge quand il reste quelque chose à faire : **Polices**, **À vérifier** (paiements du fichier à confirmer, relevés, signalements), **Argent non identifié**, **Encaissements**, **Taxes**, **Qui nous doit**, **Ce que je dois** ; les paramètres sont accessibles par une icône. La recherche d’une police (F2) est toujours visible en haut. Les modes de paiement sont affichés en clair (« Chèque », « Virement », « Orange Money »), jamais en code.

Tous les états respectent la branche choisie (ou toutes les branches) et s’exportent en Excel.

| **État**                                | **Contenu**                                                                                                                                                                                                                                                                    |
|-----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Fiche police                            | Encaissé, reste dû, barre des versements ; quatre cadres Taxes (production, exigible, payée, reste, non exigible), Commissions, Honoraires, Accessoires (partage, part partenaire due, payée, reste, part SIM) ; liste des encaissements avec source, statut et cases « payé » |
| Suivi des encaissements                 | Filtres période, mode, partenaire, produit, recherche ; totaux ; répartition par mois, mode, partenaire, produit, semaine ou mois d’exigibilité ; détail                                                                                                                       |
| Frais des opérateurs par mois           | Par mois et par opérateur (Wave, Orange Money, MTN, banque) : paiements reçus, brut payé par les clients, frais retenus, net reçu par SIM, pourcentage de frais ; total ; export Excel                                                                                         |
| Situation des taxes par branche         | À une date de situation : taxe à la production, exigible, payée, reste à payer, non exigible (dont encaissée, dont non encaissée), taxe des paiements à confirmer                                                                                                              |
| Taxes exigibles par branche et par mois | Pour une période : mois d’exigibilité, mois d’encaissement, date limite du 20, branche, exigible, payée, reste, statut (payée, à payer avant le 20, en retard) ; totaux par branche                                                                                            |
| Détail d’un mois d’exigibilité          | Lignes d’encaissement concernées, taxe de chacune, payée ou non                                                                                                                                                                                                                |
| Qui nous doit                           | Polices avec reste dû, par client, partenaire ou branche ; dernier paiement ; jours sans paiement (alertes à 30 et 90 jours)                                                                                                                                                   |
| Ce que je dois                          | Par bénéficiaire (chaque partenaire : commissions et part accessoires ; NOVELIA : honoraires), par partenaire et par branche : dû, payé, reste ; part SIM des accessoires pour information                                                                                     |
| À vérifier                              | Paiements du fichier à confirmer (ligne par ligne ou par lot), import de relevé, signalements d’import (doublons possibles, cas à vérifier, paiements ajoutés depuis le fichier)                                                                                               |
| Argent non identifié                    | Totaux par canal (Wave, chèque, virement…), filtre par canal, liste, ancienneté, affectation, classement                                                                                                                                                                       |

## 7. Format des fichiers

## 7.1 Fichier de production (import)

Le fichier mensuel contient **la nouvelle production du mois** (et non tout le portefeuille). Une police déjà connue n’y revient que pour un paiement ou un avenant ; c’est pourquoi son retour est signalé (F1.4). Une ligne par contrat ou par paiement, en-têtes en ligne 1, colonnes A à AH du classeur actuel (lues par position ; les en-têtes servent de contrôle). Une colonne « Branche » peut être ajoutée à n’importe quelle position : elle est reconnue par son en-tête. Les colonnes calculées (N, Q, R, AA à AH) sont ignorées à l’import et recalculées.

## 7.2 Relevé Wave, mobile money ou bancaire

Fichier .xlsx, .xls ou .csv. La ligne d’en-têtes est recherchée dans les 15 premières lignes : une colonne de date (« Date » ou « Horodatage »), une colonne de montant et, si possible, une ou plusieurs colonnes de référence.

**Relevé Wave (export marchand, une feuille par période)** : colonnes Horodatage, Identifiant de transaction, Type de transaction, Montant net, Montant brut, Frais, Solde, Devise, Nom de contrepartie, Numéro de téléphone de contrepartie, Compte payeur, Référence client, Identifiant de session API. Règles de lecture :

- Montant retenu : le **montant brut**, c’est-à-dire le montant payé par le client ; Wave retient environ 1 % de frais (montant net = brut − frais). Un paiement saisi au montant net est aussi reconnu.
- Références comparées : **Identifiant de transaction** (T\_…, celui qui figure sur le reçu Wave du client), **Référence client** et **Identifiant de session API** (paiements par le site).
- Lignes ignorées : montants négatifs (transferts vers la banque, retraits : type « agent_transaction ») et paiements de moins de 100 FCFA (paiements de test). Leur nombre est affiché.
- Le nom et le téléphone de la contrepartie sont affichés pour aider à identifier un paiement, et repris comme payeur présumé d’un paiement non affecté.
- Le total des frais retenus par l’opérateur sur la période est affiché.

**Règle** : pour un paiement Wave, la référence saisie par la production et par la finance est l’**Identifiant de transaction** Wave complet (T\_…). C’est la référence utilisée pour le rapprochement ; la Référence client et l’Identifiant de session API ne servent qu’en complément.

Les autres relevés (Orange Money, MTN, banque) suivent les mêmes principes ; leurs colonnes seront ajustées à réception d’un exemple.

## 7.3 Export du registre

Colonnes A à AH, puis : mois d’exigibilité de la taxe, date limite de reversement, source, statut de confirmation, date de prise en compte, commission, honoraires, part accessoires partenaire, part accessoires SIM, taxe payée le, commission payée le, honoraires payés le, accessoires payés le, statut d’annulation, N° de paiement non affecté d’origine.

## 8. Contrôles et exigences techniques

## 8.1 Contrôles

- Encaissement : date, mode, référence et montant obligatoires ; date de paiement (ou de réception) jamais dans le futur ; montant supérieur à 0 (sauf contre-passation) ; alerte en cas de dépassement de la prime TTC, sur toutes les voies de saisie (fiche, paiement pour plusieurs contrats, affectation d’argent non identifié, confirmation).
- Paiement Wave saisi à l’écran (encaissement, paiement pour plusieurs contrats, argent non identifié) : refusé si la référence n’est pas un identifiant de transaction Wave (T\_ suivi d’au moins 10 lettres ou chiffres).
- Référence déjà utilisée dans un autre paiement : alerte.
- Aucun encaissement sur un contrat annulé, sauf remboursement.
- Taxes : rappel 5 jours avant le 20, alerte en retard après le 20.

## 8.2 Exigences techniques

| **Exigence**     | **Niveau attendu**                                                                                                                             |
|------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| Accès            | Module du portail web ; utilisable sur tablette                                                                                                |
| Authentification | Comptes nominatifs ; double authentification traitée au niveau du portail, avant la mise en production du module                               |
| Base de données  | Connexion par un compte applicatif aux droits limités (décision du responsable informatique) ; journal d’audit non modifiable, conservé 10 ans |
| Calculs          | Décimal exact, 2 décimales, arrondi à l’affichage                                                                                              |
| Volumétrie       | 50 000 contrats et 200 000 encaissements par an                                                                                                |
| Performance      | Recherche d’une police \< 1 s ; fiche \< 2 s ; import de 5 000 lignes \< 2 min                                                                 |
| Sauvegarde       | Quotidienne, restauration testée chaque trimestre                                                                                              |

## 9. Cas de recette

L’application est acceptée si elle reproduit ces résultats (à 1 FCFA près).

## 9.1 Prorata sur trois encaissements

Contrat IRO-2026-000843-I00000 : prime TTC 1 500 ; prime nette 1 398,60 ; accessoires 0 ; taxes 101,40 ; commission 251,75 ; honoraires 34,97. Encaissements saisis le jour même.

| **N°**    | **Date**   | **Z**    | **AA**   | **AB**   | **AD** | **Commission** | **Honoraires** | **Taxe exigible en** |
|-----------|------------|----------|----------|----------|--------|----------------|----------------|----------------------|
| 1         | 10/07/2026 | 500,00   | 1 000,00 | 466,20   | 33,80  | 83,92          | 11,66          | août 2026            |
| 2         | 20/08/2026 | 700,00   | 300,00   | 652,68   | 47,32  | 117,48         | 16,32          | septembre 2026       |
| 3         | 05/09/2026 | 300,00   | 0,00     | 279,72   | 20,28  | 50,35          | 6,99           | octobre 2026         |
| **Total** |            | 1 500,00 |          | 1 398,60 | 101,40 | 251,75         | 34,97          |                      |

## 9.2 Paiement du fichier technique

Un fichier indique 500 FCFA sur une police. Attendu : paiement « à confirmer », reste dû inchangé, aucune taxe. Après « Reçu » : AA à AD calculés. Après « Non reçu » (motif « absent du relevé Wave ») : rien ne compte ; la ligne figure dans l’export des non reçus.

## 9.3 Doublon

La finance a saisi un paiement Wave de 400 FCFA le 03/09/2026 (réf. T_MANUEL12345A). Le fichier suivant indique 400 FCFA le 31/08/2026 (réf. T_TECHREF6789B) sur la même police. Attendu : paiement non ajouté ; signalement « doublon possible » avec la référence T_MANUEL12345A.

## 9.4 Un chèque pour trois polices

Chèque n° 1234567 de 250 000 FCFA reçu le 15/09/2026 et saisi le jour même, réparti sur trois polices dont la taxe vaut 7,25 % de la prime nette (sans accessoires).

| **Police** | **Z**   | **AB**     | **AD**    | **Taxe exigible en** |
|------------|---------|------------|-----------|----------------------|
| A          | 100 000 | 93 240,09  | 6 759,91  | octobre 2026         |
| B          | 90 000  | 83 916,08  | 6 083,92  | octobre 2026         |
| C          | 60 000  | 55 944,06  | 4 055,94  | octobre 2026         |
| **Total**  | 250 000 | 233 100,23 | 16 899,77 |                      |

Attendu : trois encaissements avec la référence 1234567, sans alerte de doublon.

## 9.5 Argent non identifié en septembre, affecté en novembre

300 000 FCFA reçus par virement le 12/09/2026, enregistrés en argent non identifié avec le canal « Virement », affectés le 10/11/2026 : 200 000 à la police A (taxe 7,25 %), 100 000 classés hors prime. Attendu : aucune taxe en septembre et octobre ; encaissement de la police A daté du 12/09/2026, pris en compte le 10/11/2026, AD = 13 519,81, exigible en novembre 2026, à reverser avant le 20/11/2026, avec la mention « Régularisation ».

## 9.6 Partage des accessoires

Partenaire WIASSUR : 40 % partenaire, 60 % SIM. Deux polices WIASSUR, prime TTC 1 600 dont 100 d’accessoires ; la police P2 a un taux propre de 70 % partenaire, 30 % SIM. Un encaissement de 800 sur chacune (AC = 50). Attendu : P1, part partenaire 20, part SIM 30 ; P2, part partenaire 35, part SIM 15 ; « Ce que je dois » : accessoires dus à WIASSUR 55. Si le taux de WIASSUR passe ensuite à 50 % avec « appliquer aussi aux encaissements non payés », P1 passe à 25 / 25 ; P2 reste à 35 / 15 (taux de la police).

## 9.7 Relevé Wave

Trois paiements Wave « à confirmer » : 500 réf. T_ATECUQUYKFUIXCI5 du 15/07, 500 réf. T_HNFWJQQCFHYPFILE du 01/07, 700 réf. T_KHGK2C7FZAE32ILI du 27/07. Relevé Wave : 15/07 « T_ATECUQUYKFUIXCI5 » 500 ; 03/07 « T_HNFWJQQCFHYPFILE » 490 ; 20/07 « T_LLOT5NICN2D6FBGT » 1 234. Attendu, option de confirmation automatique décochée : le premier dans le groupe 1 (pré-coché, confirmé après clic sur « Confirmer la sélection ») ; le deuxième dans le groupe 2 avec un écart de −10 FCFA ; T_LLOT5NICN2D6FBGT dans le groupe 4, notable en argent non identifié ; le troisième reste à confirmer. Option cochée : le premier est confirmé dès l’import.

## 9.8 Contrat mensuel soldé en une fois

Contrat de 12 000 FCFA (prime nette 11 188,81 ; taxe 811,19), payable par mois. Le client paie 1 000 le 05/07, 1 000 le 05/08, 1 000 le 05/09, puis 9 000 le 20/09 (saisis le jour même). Attendu : taxe de 67,60 exigible en août, septembre et octobre pour chacune des trois premières mensualités ; le quatrième encaissement reçoit le reliquat, soit une taxe de 608,39 exigible en octobre ; reste dû 0 ; total des taxes 811,19.

## 9.9 Contre-passation

Un encaissement de 500 FCFA confirmé en septembre (taxe 33,80 marquée payée) se révèle être un chèque impayé. La finance le contre-passe (motif « chèque impayé »). Attendu : reste dû de la police augmenté de 500 ; taxe, commission, honoraires et accessoires de l’encaissement annulés dans les états ; signalement « à régulariser » car la taxe était marquée payée.

## 9.10 Frais Wave du mois

Import du relevé Wave d’août 2026 (fichier ok.xls). Attendu dans « Frais des opérateurs » : août 2026, Wave, 110 paiements reçus, brut 397 900 FCFA, frais 3 977 FCFA, net 393 923 FCFA, 1,00 %. Un second import du même relevé ne change pas ces chiffres.

## 9.11 Transaction Wave partagée par plusieurs polices

La production saisit trois paiements « à confirmer » avec la même référence T_IXVGEP6EM2UWXL5P : 5 000 (police G1), 5 000 (G2), 3 395 (G3). Le relevé Wave d’août contient une seule ligne T_IXVGEP6EM2UWXL5P de 13 395 FCFA brut. Attendu : les trois polices dans le groupe 1 avec la mention « transaction partagée par 3 polices ». Variante : deux paiements de 1 000 avec la référence T_5GHD2UXL6B7JTTBD, ligne du relevé de 2 500 ; attendu : les deux dans le groupe 2, écart 500 FCFA.

## 9.12 Marquage payé

Encaissement confirmé, taxe exigible en octobre. La finance coche « taxe payée » avec la date et la référence du reversement. Attendu : la taxe passe en « payée » dans la fiche, dans la situation des taxes par branche et dans le détail du mois ; décocher remet l’état précédent ; les deux actions figurent dans le journal d’audit.

## 9.13 Annulation d’un contrat

Police de 1 500 FCFA (taxe 101,40 ; commission 251,75), dont 500 encaissés ; la commission de cet encaissement (83,92) est marquée payée.

- **Annulation sans effet** par l’équipe technique, puis remboursement de 500 saisi par la finance en contre-passation. Attendu : badge « Annulé » ; nouvel encaissement refusé ; taxe non encaissée (67,60) annulée ; commission due ramenée à 0, donc « à régulariser » sur les 83,92 déjà payés.
- **Variante : annulation pour non-paiement.** Attendu : la part non encaissée (1 000) est abandonnée, sa taxe (67,60) annulée ; l’encaissement de 500 reste acquis avec sa taxe (33,80) et sa commission (83,92) ; rien à régulariser.

## 9.14 Droits par profil

Un utilisateur de l’équipe technique ouvre une police. Attendu : aucun bouton pour saisir, confirmer, corriger un encaissement ni marquer « payé » ; accès aux paramètres refusé. Un utilisateur Consultation ne peut que consulter et exporter.

## 9.15 Export du registre

Export après les cas précédents. Attendu : colonnes A à AH identiques au classeur actuel, puis les colonnes de la section 7.3 dans l’ordre ; une ligne par encaissement ; montants et dates au format FCFA et jj/mm/aaaa.

## 9.16 Situation des taxes par branche

Deux branches, un encaissement confirmé dans chacune. Attendu : pour chaque branche et au total, taxe à la production = exigible + non exigible, et non exigible = encaissée non encore exigible + non encaissée.

## 10. Livrables et planning

| **Lot** | **Contenu**                                                                                                                                                                                                                                                                     |
|---------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Lot 1   | Import de production par branche, fiche police, recherche, saisie d’encaissement, paiement pour plusieurs contrats, prorata, confirmation des paiements du fichier (y compris import de relevé), signalements                                                                   |
| Lot 2   | Taxes : exigibilité et régularisations, situation par branche, exigibles par mois, marquage des taxes payées ; paiements non affectés                                                                                                                                           |
| Lot 3   | Commissions, honoraires, accessoires : « Ce que je dois », partage des accessoires, paramètres, marquage payé ; « Qui nous doit »                                                                                                                                               |
| Lot 4   | Annulations, correction et contre-passation, exports, journal d’audit                                                                                                                                                                                                           |
| Recette | Cas de la section 9, puis un mois réel en parallèle avec le classeur actuel ; critère d’acceptation : aucun écart sur les taxes exigibles par branche et par mois entre l’application et le classeur, et tout écart sur les commissions, honoraires et accessoires dus justifié |

Livrables : module installé en recette puis en production ; reprise du classeur actuel avec rapport d’écarts ; manuel utilisateur ; procès-verbal de recette.
