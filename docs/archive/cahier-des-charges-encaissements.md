> **Remplacé par la V2.6** — [cahier-des-charges-encaissements-v2.md](../cahier-des-charges-encaissements-v2.md), reçue le 2026-09-28. Document conservé pour l’historique uniquement.

# 1. Contexte, objet et périmètre

L’application remplace le classeur Excel de suivi des paiements (colonnes A à AH). Elle doit gérer les contrats payés en plusieurs versements et en déduire, pour chaque versement, la part de prime nette, d’accessoires, de taxes, de commission et d’honoraires.

Elle doit aussi suivre, à toute date, ce qui est dû et ce qui a été payé ou reversé : taxes, commissions, honoraires. Les contrats annulés doivent être identifiés et leurs impacts tracés.

**Dans le périmètre :**

- Import d’un fichier Excel au format actuel, sans ressaisie.
- Création et modification des contrats.
- Saisie de versements échelonnés illimités par contrat (date, mode, référence, montant).
- Calcul automatique au prorata des colonnes Z à AD, plus commission et honoraires reçus.
- Suivi des taxes : taxes à la production (non exigibles) et taxes exigibles à l’encaissement, avec la règle N → N+1.
- Suivi des commissions dues / payées et des honoraires dus / payés.
- Annulation de contrat avec motif, date et effets sur les montants.
- États de suivi, tableaux de bord et export Excel.

Font aussi partie du périmètre : l’encaissement groupé (un chèque ou une référence pour plusieurs polices), l’échéancier prévu des contrats échelonnés (F8) et le rapprochement avec la banque et le mobile money (F9). Les autres améliorations sont décrites en options (section 11).

**Hors périmètre (sauf décision contraire) :** émission des polices, comptabilité générale, paiement en ligne, télédéclaration fiscale.

**Monnaie :** FCFA, montants stockés avec 2 décimales, affichés arrondis à l’unité.

# 2. Utilisateurs et profils d’accès

Cinq profils suffisent. L’équipe technique et la finance peuvent importer la production ; seule l’équipe technique annule un contrat. Les encaissements relèvent de la gestion. Chaque action est rattachée à l’utilisateur qui l’a faite.

| **Profil**                       | **Peut faire**                                                                                                                                                                                                     | **Ne peut pas faire**                                                                |
|----------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| Équipe technique                 | Importer la production, créer et corriger des contrats (y compris leurs taux en saisie directe), paramétrer les taux par produit et par partenaire, annuler un contrat (à l’écran ou par import)                   | Saisir ou valider des encaissements et des règlements                                |
| Gestionnaire encaissements       | Appeler une police, saisir les versements et les encaissements groupés, importer des encaissements                                                                                                                 | Annuler un contrat, modifier une prime ou un montant du contrat                      |
| Finance (comptable / trésorerie) | Importer le fichier de production transmis par l’équipe technique, saisir les reversements de taxes, les paiements de commissions, d’honoraires et d’accessoires, rapprocher les relevés, consulter tous les états | Annuler un contrat (y compris par import), modifier une prime ou un versement validé |
| Responsable (valideur)           | Corriger un versement validé, annuler un règlement, clôturer et déclôturer un mois (F11)                                                                                                                           | Annuler un contrat (réservé à l’équipe technique)                                    |
| Consultation / audit             | Consulter et exporter                                                                                                                                                                                              | Toute modification                                                                   |

Un mois clôturé ne peut plus être modifié, sauf déclôture par le responsable (F11). Sinon, une correction se fait par écriture de régularisation sur le mois ouvert.

# 3. Modèle de données

Six objets principaux. Un contrat a plusieurs versements ; un règlement sortant (taxe, commission, honoraires) est affecté à un ou plusieurs versements.

## 3.1 Contrat

| **Champ**                                   | **Colonne Excel** | **Type**                                           | **Règle**                                                                         |
|---------------------------------------------|-------------------|----------------------------------------------------|-----------------------------------------------------------------------------------|
| N° police                                   | C                 | Texte, unique                                      | Obligatoire                                                                       |
| Type de contrat                             | D                 | Liste : I, G                                       | Obligatoire                                                                       |
| Libellé produit, code produit               | E, F              | Référentiel produits                               | Obligatoire                                                                       |
| Type d’opération                            | G                 | Liste : Nouvelle Affaire, Renouvellement, Avenant… | Obligatoire                                                                       |
| Client ID, nom client / souscripteur        | H, I              | Texte                                              | Obligatoire                                                                       |
| Partenaire                                  | J                 | Référentiel partenaires                            | Obligatoire (bénéficiaire des commissions)                                        |
| Date d’effet, date d’échéance               | O, P              | Date                                               | Échéance ≥ effet                                                                  |
| Date de production (émission)               | nouveau           | Date                                               | Par défaut = date d’effet ; fait naître la taxe                                   |
| Prime TTC                                   | S                 | Montant                                            | \> 0                                                                              |
| Prime nette HT                              | T                 | Montant                                            | Calculée ou saisie                                                                |
| Accessoires HT                              | U                 | Montant                                            | ≥ 0                                                                               |
| Taxes                                       | V                 | Montant                                            | Calculée ou saisie                                                                |
| Commission                                  | W                 | Montant                                            | Calculée ou saisie                                                                |
| Honoraires (gestion)                        | X                 | Montant                                            | Calculée ou saisie                                                                |
| Type police                                 | Y                 | Liste                                              | —                                                                                 |
| Taux accessoires, taxe, commission, gestion | nouveau           | %                                                  | Déduits du fichier à l’import ; saisis séparément en saisie directe (section 3.7) |
| Statut contrat                              | Q                 | Calculé                                            | Voir section 5.6                                                                  |
| Statut annulation                           | nouveau           | Liste : Actif, Annulé                              | Défaut Actif                                                                      |
| Date, motif, type et pièce d’annulation     | nouveau           | Date, liste, liste, texte                          | Obligatoires si annulé                                                            |

## 3.2 Versement (encaissement client)

| **Champ**             | **Colonne Excel**  | **Règle**                                                                                                                                               |
|-----------------------|--------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| PaiementID            | B                  | Généré : PAI-AAAA-NNNNNN, unique, jamais réutilisé                                                                                                      |
| Date d’enregistrement | A                  | Date système de saisie                                                                                                                                  |
| Date de paiement      | K                  | Obligatoire, ≤ date du jour                                                                                                                             |
| Mode de paiement      | L                  | Liste : CHQ, VIR, OM, MTN, WAVE, CB, MOB (aucun encaissement en espèces)                                                                                |
| Référence de paiement | M                  | Obligatoire pour tous les modes ; peut être partagée par les versements d’un même encaissement groupé ; doublon contrôlé entre encaissements différents |
| N° de versement       | R                  | Calculé : rang chronologique dans le contrat                                                                                                            |
| Montant reçu TTC      | Z                  | \> 0, total ≤ prime TTC                                                                                                                                 |
| Observations          | AF                 | Texte libre                                                                                                                                             |
| Montants calculés     | AA à AD + nouveaux | Voir section 5 ; figés à la validation                                                                                                                  |
| Statut                | nouveau            | Brouillon, Validé, Annulé (contre-passé)                                                                                                                |

**Encaissement groupé (remise).** Un paiement reçu qui couvre plusieurs versements : N° d’encaissement, payeur, date, mode, N° de chèque ou référence, montant total, pièce jointe, statut (Brouillon, Validé, Rapproché). La somme des versements rattachés est égale au montant total. Un versement porte au plus un encaissement groupé.

## 3.3 Règlement sortant

Un règlement enregistre un paiement fait par la compagnie : taxe reversée à l’administration fiscale, commission payée au partenaire, honoraires payés au bénéficiaire.

| **Champ**                      | **Règle**                                                                      |
|--------------------------------|--------------------------------------------------------------------------------|
| Type                           | Liste : Taxe, Commission, Honoraires, Accessoires                              |
| Bénéficiaire                   | Administration fiscale, partenaire, bénéficiaire d’honoraires ou d’accessoires |
| Date, mode, référence, montant | Obligatoires                                                                   |
| Période concernée              | Mois d’exigibilité (taxes) ou période de calcul                                |
| Pièce jointe                   | Quittance, bordereau, reçu (PDF ou image)                                      |

## 3.4 Affectation (lettrage)

Une ligne relie un règlement à un versement, avec le montant affecté. C’est ce qui permet de dire, versement par versement et contrat par contrat, ce qui est payé et ce qui reste dû. La somme des affectations d’un règlement est égale à son montant.

**Bordereau.** Regroupement des lignes dues d’un bénéficiaire, pour une nature et une période : numéro, bénéficiaire, nature, période, date de génération, total, montant payé, statut (Émis, Partiellement payé, Payé, Annulé). Une ligne due appartient à un seul bordereau à la fois. Un règlement peut porter sur un ou plusieurs bordereaux.

## 3.5 Référentiels

- Produits : code, libellé.
- Partenaires : liste illimitée ; nom, identifiant unique, coordonnées de paiement, statut (actif, inactif). Ajout à l’écran ou par import Excel.
- Modes de paiement, types d’opération, motifs d’annulation.
- Paramètres : délai d’exigibilité des taxes (1 mois), date limite de reversement (le 20), date de clôture des mois.

## 3.6 Journal d’audit

Chaque création, modification, annulation et import est tracé : qui, quand, valeur avant, valeur après.

## 3.7 Montants et taux : fichier de production ou saisie directe

Les taux se paramètrent par produit et par partenaire (section 3.8). Deux modes de production existent.

**Import (cas normal).** Les montants de chaque contrat (prime TTC, prime nette, accessoires, taxes, commission, honoraires) viennent du fichier de production et font foi. Aucun taux n’est saisi.

- L’application ne recalcule pas ces montants : elle les compare aux taux paramétrés et signale les écarts (section 3.8).
- Les taux implicites (taxe ÷ (prime nette + accessoires), commission ÷ prime nette, honoraires ÷ prime nette) sont seulement affichés, pour information.
- Contrôle de cohérence, en plus de la comparaison aux taux : prime nette + accessoires + taxes = prime TTC, à 1 FCFA près. Un écart est signalé dans le rapport d’import, sans bloquer.
- Les prorata de chaque versement (section 5.2) partent de ces montants du fichier.

**Saisie directe (au cas où).** Quand la production saisit un contrat à l’écran, elle renseigne des taux propres à ce contrat, indépendants les uns des autres :

| **Taux saisi**            | **Base par défaut**       | **Montant calculé**                              |
|---------------------------|---------------------------|--------------------------------------------------|
| Taux accessoires          | Prime nette               | U = T × taux accessoires (ou montant fixe saisi) |
| Taux taxe                 | Prime nette + accessoires | V = (T + U) × taux taxe                          |
| Taux commission           | Prime nette               | W = T × taux commission                          |
| Taux gestion (honoraires) | Prime nette               | X = T × taux gestion                             |

- L’utilisateur part soit de la prime nette (calcul vers la prime TTC), soit de la prime TTC (calcul inverse vers la prime nette, section 5.1).
- La base de chaque taux est modifiable : prime nette, prime nette + accessoires ou prime TTC.
- Les taux sont pré-remplis depuis le paramétrage produit × partenaire (section 3.8) ; à défaut, avec ceux du dernier contrat du même produit et du même partenaire. L’utilisateur peut les changer ; un taux différent du paramétrage est signalé.
- Les montants calculés restent modifiables (arrondi, cas particulier). Taux et montants sont enregistrés sur le contrat et tracés.
- L’équipe technique peut corriger de la même façon un contrat importé, avec motif.

## 3.8 Paramétrage des taux par produit et par partenaire

L’équipe technique paramètre, pour chaque produit, des taux par défaut et des taux propres à chaque partenaire. Le nombre de partenaires n’est pas limité.

| **Niveau**           | **Contenu**                                                                                                                                                  |
|----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Produit              | Taux par défaut : accessoires, taxe, commission, gestion, avec leur base de calcul                                                                           |
| Produit × partenaire | Autant de lignes que de partenaires. Chaque ligne remplace les taux par défaut du produit pour ce partenaire ; un taux laissé vide reprend celui du produit. |

Chaque ligne porte une date de début et une date de fin (vide = en cours). Le taux retenu est celui valable à la date de production : la ligne produit × partenaire si elle existe, sinon le taux du produit.

- Écran de saisie : un tableau par produit, bouton « Ajouter un partenaire » sans limite, recherche et filtre par partenaire.
- Import et export Excel de tout le paramétrage (produit, partenaire, quatre taux, bases, dates).
- Historique conservé : ancienne valeur, nouvelle valeur, auteur, date. Une modification ne change pas les contrats déjà enregistrés.

**Erreurs signalées**

| **Moment**            | **Erreur**                                                                                                                                  | **Traitement**                                                                                             |
|-----------------------|---------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Saisie du paramétrage | Taux négatif ou supérieur à 100 %, produit ou partenaire inconnu, deux lignes qui se chevauchent pour le même produit et le même partenaire | Refusé, avec un message précis                                                                             |
| Import de production  | Partenaire absent du référentiel                                                                                                            | Ligne signalée, création du partenaire proposée                                                            |
| Import de production  | Produit ou partenaire sans taux paramétré                                                                                                   | Ligne signalée « taux non paramétré »                                                                      |
| Import de production  | Montant du fichier différent du montant attendu avec le taux paramétré (écart supérieur à 1 FCFA)                                           | Ligne importée avec le montant du fichier ; écart signalé avec montant du fichier, montant attendu et taux |
| Saisie directe        | Taux saisi différent du taux paramétré                                                                                                      | Avertissement ; saisie possible avec un motif                                                              |

Le rapport d’erreurs s’affiche à l’écran, s’exporte en Excel et reste consultable dans l’historique des imports. Un état « Écarts de taux » liste les contrats concernés, par produit et par partenaire.

# 4. Fonctionnalités

## F1. Import d’un fichier Excel

1.  L’utilisateur dépose un fichier .xlsx au format du classeur actuel (section 7).
2.  L’application affiche un aperçu : nombre de contrats, de versements, lignes en erreur avec le motif.
3.  Les lignes sont regroupées par N° de police. Un contrat existant n’est pas recréé : ses nouveaux versements lui sont ajoutés.
4.  Un versement dont le PaiementID existe déjà est ignoré (pas de doublon en cas de réimport).
5.  Les montants Z à AD présents dans le fichier sont recalculés ; tout écart supérieur à 1 FCFA est signalé.
6.  L’utilisateur confirme l’import. Un rapport d’import est conservé.

**Montants de la production importée.** Dans la majorité des cas, la production arrive par import. Les montants du fichier (prime TTC, prime nette, accessoires, taxes, commission, honoraires) font foi et ne sont pas recalculés. Les montants sont contrôlés : prime nette + accessoires + taxes = prime TTC, et comparaison avec les taux paramétrés (section 3.8). Chaque écart est signalé dans le rapport d’import, sans bloquer. Une ligne à laquelle il manque un montant est rejetée avec le motif « montant manquant ».

**Qui importe.** L’import de production est ouvert à l’équipe technique et à la finance. La finance n’importe que le fichier transmis par l’équipe technique : l’import enregistre qui l’a transmis, quand, et ses totaux de contrôle (nombre de contrats, total des primes TTC), à comparer à l’état de production du technique. Un fichier de production importé par la finance ne peut pas contenir d’annulations : les lignes marquées annulées sont rejetées dans le rapport d’import, avec le motif « annulation réservée à l’équipe technique ».

## F2. Création et modification d’un contrat

1.  Saisie des champs de la section 3.1.
2.  À la saisie de la prime TTC, l’utilisateur saisit les taux du contrat (accessoires, taxe, commission, gestion) et l’application calcule les montants (section 3.7) ; il peut aussi saisir directement les montants. Cas rare : la production arrive normalement par import.
3.  Contrôle : prime nette + accessoires + taxes = prime TTC (écart toléré 1 FCFA).
4.  Un contrat ayant des versements validés ne peut plus changer de prime que par l’équipe technique, avec motif ; les versements déjà saisis sont alors recalculés et les écarts tracés.

## F3. Versements échelonnés : appeler une police, saisir chaque règlement

C’est l’écran le plus utilisé. Un même N° de police peut être réglé plusieurs fois ; chaque saisie calcule immédiatement ses éléments Z à AD.

1.  L’utilisateur tape le N° de police (ou le nom du client) dans la barre de recherche ; la fiche du contrat s’ouvre directement, avec l’historique de tous ses versements.
2.  Bouton « Ajouter un versement », sans limite de nombre.
3.  Champs saisis : date de paiement, montant réglé TTC, mode, référence, observations.
4.  Le montant proposé par défaut est le solde restant dû (ou l’échéance prévue, voir F8) ; l’utilisateur le modifie pour un paiement partiel.
5.  Dès la saisie, la ligne affiche ses calculs propres : Z montant reçu, AA restant dû après ce versement, AB prime nette reçue, AC accessoires reçus, AD taxe, plus commission, honoraires et mois d’exigibilité de la taxe.
6.  Chaque versement est calculé sur sa propre date : un versement de septembre et un d’octobre du même contrat ont des mois d’exigibilité différents.
7.  À l’enregistrement : attribution du PaiementID et du N° de versement, montants figés.
8.  Une barre de progression montre chaque versement et le solde restant.
9.  Un versement validé ne se supprime pas : il se contre-passe (versement négatif lié, avec motif).

## F3 bis. Encaissement groupé : un chèque ou une référence pour plusieurs lignes

Un partenaire peut régler plusieurs contrats, ou plusieurs lignes d’une même production, avec un seul chèque ou un seul virement.

1.  L’utilisateur crée un encaissement groupé : payeur (partenaire ou client), date, mode, N° de chèque ou référence, montant total.
2.  Il ajoute les lignes couvertes : N° police et montant pour chacune. Aides à la saisie : coller une liste de polices, importer le bordereau du partenaire en Excel, ou sélectionner les contrats non soldés du partenaire et cocher.
3.  Un compteur affiche : montant du chèque, total ventilé, écart. La validation exige un écart nul ; un reliquat peut être enregistré en « avance partenaire ».
4.  À la validation, l’application crée un versement dans chaque contrat, avec la même référence, la même date et le même mode. Chaque versement calcule ses propres Z à AD.
5.  Depuis la fiche d’un contrat, le versement affiche le lien vers l’encaissement groupé ; depuis l’encaissement groupé, on voit toutes les polices réglées.
6.  La même référence n’est pas une anomalie à l’intérieur d’un encaissement groupé. Elle en est une si elle réapparaît dans un autre encaissement.

## F4. Annulation d’un contrat

1.  Action réservée à l’équipe technique : depuis la fiche contrat, ou en masse par import d’un fichier d’annulations (N° police, date, type, motif), avec aperçu et rapport d’erreurs comme en F1.
2.  Saisie obligatoire : date d’annulation, type (sans effet / résiliation / ristourne), motif, pièce justificative.
3.  Selon le type, l’application calcule la prime acquise, la prime à rembourser et les montants à régulariser (section 5.7).
4.  Le contrat passe au statut Annulé, visible partout par un badge rouge. Il n’accepte plus de nouveau versement.
5.  Les remboursements au client se saisissent comme des versements négatifs.

## F5. Règlements de masse (taxes, commissions, honoraires, accessoires)

L’utilisateur ne coche jamais ligne par ligne dans le cas normal. Il règle un bordereau ; la coche sert aux exceptions. Une ligne due = un versement client × une nature. Statuts de ligne : Due, En attente, Partiellement payée, Payée.

### F5.1 Bordereaux mensuels (mode principal)

1.  À la clôture du mois, l’application génère un bordereau par bénéficiaire et par nature : commissions par partenaire, honoraires, accessoires, déclaration de taxes par mois d’exigibilité.
2.  Le bordereau reprend toutes les lignes dues de la période, hors lignes En attente. Il porte un numéro unique (BRD-AAAA-MM-NNNN) et s’exporte en Excel et en PDF pour être envoyé au bénéficiaire.
3.  Les lignes dues après la génération (encaissement tardif) vont au bordereau du mois suivant.
4.  Payer le bordereau en totalité solde toutes ses lignes en une seule validation.

### F5.2 Répartition automatique d’un paiement partiel

Si le montant payé est inférieur au bordereau, l’utilisateur choisit une règle de répartition :

| **Règle**                       | **Effet**                                                                                            |
|---------------------------------|------------------------------------------------------------------------------------------------------|
| Plus anciennes d’abord (défaut) | Lignes soldées par date d’encaissement croissante jusqu’au montant ; la dernière peut être partielle |
| Prorata                         | Chaque ligne reçoit le même pourcentage (montant payé ÷ total du bordereau)                          |
| Contrats choisis                | L’utilisateur coche les contrats à solder ; le reste est réparti selon la règle par défaut           |

Le résultat s’affiche avant validation et reste modifiable. Les lignes non soldées restent sur le bordereau, qui passe au statut Partiellement payé.

### F5.3 Sélection par groupe

L’écran de règlement est regroupé par mois, puis par contrat, puis par versement. Une case au niveau mois ou contrat coche toutes les lignes du groupe. Boutons « Tout cocher », « Tout décocher », « Cocher jusqu’au montant ». Un compteur affiche : montant payé, total coché, écart ; la validation exige un écart nul.

### F5.4 Import d’un fichier de règlement

1.  L’utilisateur importe un fichier Excel (N° police, PaiementID facultatif, montant, nature).
2.  L’application rapproche chaque ligne du fichier avec les lignes dues.
3.  Elle affiche seulement les anomalies : police introuvable, montant différent du dû, ligne déjà payée, ligne En attente.
4.  L’utilisateur corrige ou écarte les anomalies, puis valide.

### F5.5 Lignes en attente

Une ligne peut être mise En attente, avec un motif : contrat en cours d’annulation, litige, référence manquante. Elle est exclue des bordereaux, de la répartition automatique et de « Tout cocher ». Un contrat annulé met automatiquement ses lignes non payées En attente.

### F5.6 Règles communes

- L’application calcule et prépare les montants à payer ; elle n’exécute aucun paiement. Le paiement suit le circuit de signatures multiples de la compagnie, puis il est enregistré dans l’application avec date, mode, référence, montant et pièce signée (ordre de virement ou chèque).
- Chaque ligne soldée garde la référence du règlement et du bordereau (lettrage).
- Un règlement validé ne peut être annulé que par le responsable, avec motif ; ses lignes redeviennent dues.
- Une avance sans ligne se saisit en « Acompte non affecté » et se lettre plus tard.

## F6. Recherche et consultation

Recherche par N° de police, client, partenaire, PaiementID, référence de paiement. Filtres : statut de paiement, statut d’annulation, produit, période.

## F7. Export

Export Excel de tout ou partie du registre au format de la section 7, et export de chaque état de la section 6.

## F8. Échéancier prévu des contrats échelonnés

1.  À la création d’un contrat échelonné, l’utilisateur saisit les échéances attendues : date et montant de chacune. Aide : « Répartir en N échéances mensuelles » à partir de la date d’effet.
2.  La somme des échéances est égale à la prime TTC.
3.  Chaque versement saisi (F3 ou F3 bis) est imputé sur l’échéance la plus ancienne non soldée.
4.  Statut de chaque échéance : À venir, Payée, Partiellement payée, En retard (date dépassée, non soldée).
5.  Liste quotidienne des échéances en retard, avec le nombre de jours de retard, par partenaire et par gestionnaire.
6.  Prévision de trésorerie par mois : encaissements attendus, taxes à reverser avant le 20, commissions et honoraires à payer.

## F9. Rapprochement avec la banque et le mobile money

1.  Import des relevés : banques, Orange Money, MTN Money, Wave (formats Excel ou CSV des opérateurs).
2.  L’application rapproche chaque opération du relevé avec les versements ou encaissements groupés, par référence puis par montant et date (tolérance paramétrable).
3.  Trois listes de résultat : rapprochés automatiquement ; sur le relevé mais non saisis (encaissement à enregistrer) ; saisis mais absents du relevé (à vérifier).
4.  Rapprochement manuel possible pour les cas restants, avec trace de l’utilisateur.
5.  Un versement rapproché passe au statut Rapproché et ne peut plus être modifié sans validation du responsable.
6.  État mensuel de rapprochement par compte et par opérateur, requis pour la clôture du mois.

## F10. Paiements non identifiés (suspens)

Un paiement reçu en N qu’on ne sait pas rattacher reste en suspens, sans aucun calcul ni taxe, jusqu’à son identification. Aucune taxe n’est déclarée sur un suspens : il peut porter sur des sommes non taxables.

1.  **Enregistrement en N.** Saisie manuelle ou création depuis le rapprochement F9 : date réelle de réception, montant, mode, référence, payeur présumé, compte bancaire ou opérateur, pièce jointe. Numéro unique SUS-AAAA-NNNNNN.
2.  **Aucun calcul en suspens.** Pas de ventilation Z à AD, pas de taxe, pas de commission ni d’honoraires. Le suspens figure seulement dans le rapprochement et dans l’état des suspens.
3.  **Identification en N+x.** L’utilisateur rattache le suspens à une ou plusieurs polices, comme un encaissement groupé (F3 bis). Il peut aussi le classer en « non taxable » (somme sans lien avec une prime) ou en « à rembourser ».
4.  **Dates.** Le versement créé garde la date de paiement réelle (N, colonne K) et reçoit une date d’identification (nouvelle colonne). Le calcul Z à AD se fait à l’identification.
5.  **Mois clôturés intouchés.** Les états et déclarations de N ne changent pas. Le rattachement apparaît dans le mois d’identification comme régularisation « encaissement de N identifié en N+x ».
6.  **Taxe.** La taxe naît à l’identification. Elle est portée sur la première déclaration dont l’échéance (le 20) suit la date d’identification, avec la mention du mois d’encaissement d’origine. Exemple : identifié le 10/11 → déclaration à reverser avant le 20/11 ; identifié le 25/11 → avant le 20/12.
7.  **Commissions et honoraires.** Dus à l’identification ; ils entrent dans le bordereau du mois d’identification.
8.  **Échéancier et relances.** Tant qu’un suspens existe pour un partenaire ou un montant proche d’une échéance en retard, la relance du client est marquée « suspens possible » et n’est pas envoyée automatiquement.
9.  **Suivi.** État des suspens par ancienneté (moins de 30 jours, 30–60, 60–90, plus de 90), alerte au-delà de 60 jours. Aucun délai limite : un suspens reste en suspens jusqu’à son identification. La finance peut à tout moment le classer en remboursement au payeur ou en reclassement.

Droits : saisie et identification par la gestion et la finance ; classement « non taxable » ou « à rembourser » par la finance uniquement.

## F11. Clôture et déclôture mensuelles

La clôture mensuelle fait partie de l’application (elle n’est plus une option).

1.  **Liste de contrôle avant clôture :** rapprochement bancaire et mobile money fait, écarts d’import traités, bordereaux générés, déclaration de taxes préparée, suspens revus. Un point non fait bloque la clôture, sauf dérogation motivée du responsable.
2.  **Effets de la clôture :** plus aucune création ni modification de versement, de règlement ou de contrat daté du mois. Les états du mois sont figés en version « tel que déclaré ».
3.  **Déclôture :** réservée au responsable, avec motif obligatoire. Seul le dernier mois clôturé peut être rouvert ; pour rouvrir un mois plus ancien, on rouvre les mois suivants un par un.
4.  **Pendant la déclôture :** chaque modification est tracée et listée dans un rapport « changements depuis la clôture ».
5.  **Taxes déjà déclarées :** une déclôture ne modifie jamais une déclaration déjà faite. Si la taxe du mois change, l’écart est porté en régularisation sur la déclaration suivante (échéance du 20), avec une alerte au responsable.
6.  **Re-clôture :** la liste de contrôle est refaite. L’application garde les deux versions des états (avant et après déclôture) et l’historique des clôtures (date, auteur, motif).

# 5. Règles de calcul

Notations : S = prime TTC, T = prime nette HT, U = accessoires HT, V = taxes, W = commission, X = honoraires (colonne « MontantGestion »), Z = montant d’un versement.

## 5.1 Décomposition de la prime

Les taux observés dans le fichier actuel sont : taxe 7,25 % de (T + U), commission 18 % de T, honoraires 2,5 % de T. À l’import, l’application ne les applique pas : les montants du fichier font foi. En saisie directe, chaque taux est saisi séparément sur le contrat et les formules ci-dessous calculent les montants (section 3.7).

**U = T × taux accessoires   V = (T + U) × taux taxe   S = T + U + V**

**W = T × taux commission   X = T × taux gestion**

**Calcul inverse depuis la prime TTC : T = S ÷ \[(1 + taux accessoires) × (1 + taux taxe)\]**

## 5.2 Prorata de chaque versement (colonnes Z à AD et nouvelles colonnes)

Chaque versement porte la même fraction Z / S de chaque composante de la prime.

**AA = S − somme des Z des versements jusqu’à celui-ci**

**AB = T × Z ÷ S   AC = U × Z ÷ S   AD = V × Z ÷ S**

**Commission due = W × Z ÷ S   Honoraires dus = X × Z ÷ S**

Le versement qui solde le contrat (AA = 0) reçoit le reliquat exact de chaque composante (T, U, V, W, X moins la somme des versements précédents). Ainsi, la somme des versements égale toujours le contrat, sans écart d’arrondi.

## 5.3 Statut du paiement (colonne AE)

| **Condition**            | **Statut**                                                                                                                     |
|--------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| Aucun versement          | Non payé                                                                                                                       |
| 0 \< total encaissé \< S | Partiellement payé                                                                                                             |
| Total encaissé = S       | Totalement payé                                                                                                                |
| Total encaissé \> S      | Trop-perçu (bloquant à la saisie, sauf validation) ; la finance choisit remboursement au payeur ou report sur un autre contrat |
| Contrat annulé           | Annulé                                                                                                                         |

## 5.4 Taxes : production et exigibilité

- **Taxe à la production** : V naît à la date de production du contrat. Elle est non exigible tant que la prime n’est pas encaissée.
- **Taxe encaissée** : AD du versement, rattachée au mois de la date de paiement (mois N).
- **Taxe exigible** : la taxe d’un versement du mois N devient exigible le mois N+1 et doit être reversée avant le 20 de ce mois. Exemple : encaissement en septembre → taxe exigible en octobre, à reverser avant le 20 octobre.
- **Taxe payée** : taxe exigible affectée à un règlement de type Taxe (section 3.4).

**Paiement identifié tardivement.** Un paiement reçu en N mais identifié en N+x (F10) ne génère aucune taxe tant qu’il est en suspens. Sa taxe devient exigible à l’identification et est portée sur la déclaration suivante (échéance du 20), comme régularisation de l’encaissement de N. Les déclarations des mois déjà clôturés ne sont pas modifiées.

À toute date de situation D (mois M) :

| **Indicateur**                             | **Calcul**                                                            |
|--------------------------------------------|-----------------------------------------------------------------------|
| Taxes à la production                      | Somme des V des contrats produits au plus tard en D, hors annulations |
| Taxes non exigibles                        | Taxes à la production − taxes exigibles                               |
| dont non encaissées                        | Taxes à la production − taxes encaissées                              |
| dont encaissées, exigibles le mois suivant | Taxes des versements du mois M                                        |
| Taxes exigibles                            | Taxes des versements des mois antérieurs à M                          |
| Taxes à reverser en M                      | Taxes des versements du mois M−1                                      |
| Taxes exigibles restant à payer            | Taxes exigibles − taxes payées                                        |

## 5.5 Commissions, honoraires et accessoires : dus et payés

- **Acquis (dus)** au fur et à mesure des encaissements : commission et honoraires de chaque versement (section 5.2).
- **Non acquis** : W et X de la part de prime non encaissée. Ils ne sont pas dus.
- **Payés** : montants affectés à des règlements de type Commission ou Honoraires.
- **Restant à payer** = dus − payés, par versement, par contrat, par partenaire.
- Un paiement supérieur au dû (par exemple après annulation) crée un **montant à récupérer** sur le partenaire.

Les accessoires suivent la même règle : l’accessoire dû d’un versement est sa colonne AC. Il est payé quand il est affecté à un règlement de type Accessoires.

## 5.6 Statut du contrat (colonne Q)

| **Condition**                          | **Statut** |
|----------------------------------------|------------|
| Annulation enregistrée                 | Annulé     |
| Date du jour \< date d’effet           | À venir    |
| Date d’effet ≤ date du jour ≤ échéance | En cours   |
| Date du jour \> échéance               | Expiré     |

DDF (colonne N) = échéance − date d’effet, en jours.

## 5.7 Effets d’une annulation

Trois types d’annulation existent.

| **Type**                                  | **Prime acquise**        | **Effet sur les montants**                                                                                   |
|-------------------------------------------|--------------------------|--------------------------------------------------------------------------------------------------------------|
| Sans effet (annulation à la date d’effet) | 0                        | Tout l’encaissé est à rembourser. Taxes, commissions et honoraires ramenés à 0.                              |
| Résiliation en cours de contrat           | S × jours couverts ÷ DDF | Ristourne = encaissé − prime acquise si positif. Sinon, le restant dû est ramené à prime acquise − encaissé. |
| Annulation pour non-paiement              | Montant encaissé         | Pas de remboursement. La part non encaissée est abandonnée.                                                  |

Dans tous les cas :

- La taxe à la production non encaissée est annulée (elle ne devient jamais exigible).
- Une taxe déjà reversée sur une prime remboursée devient un **crédit de taxe**, imputé sur le reversement du mois suivant.
- Une commission ou des honoraires déjà payés au-delà du nouveau dû deviennent un **montant à récupérer**, imputé sur les paiements suivants du même bénéficiaire.
- Les versements existants ne sont pas modifiés. L’annulation crée des écritures de régularisation datées du jour d’annulation.

# 6. États de suivi et tableaux de bord

Tous les états se calculent à une date de situation choisie par l’utilisateur et s’exportent en Excel.

| **État**                    | **Contenu**                                                                                                                                                                | **Filtres**                  |
|-----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------|
| Tableau de bord             | Primes émises, encaissées, restant dû ; taxes non exigibles, exigibles, payées ; commissions dues et payées ; honoraires dus et payés ; nombre de contrats annulés du mois | Période, produit, partenaire |
| Suivi des taxes par mois    | Taxes à la production, encaissées, exigibles, payées, stock non exigible fin de mois (encaissé / non encaissé), crédit de taxe                                             | Période, produit             |
| Détail des taxes à reverser | Pour un mois d’exigibilité : versements, polices, clients, références, taxe de chaque ligne, total                                                                         | Mois d’exigibilité           |
| Commissions par partenaire  | Dues, payées, restant à payer, à récupérer ; détail par contrat et par versement                                                                                           | Partenaire, période          |
| Honoraires                  | Dus, payés, restant à payer, à récupérer ; détail par contrat                                                                                                              | Bénéficiaire, période        |
| Encaissements               | Liste des versements, par mode de paiement et par semaine (colonne AG)                                                                                                     | Période, mode                |
| Impayés et échéancier       | Contrats partiellement payés, restant dû, date du dernier versement, ancienneté                                                                                            | Ancienneté, partenaire       |
| Contrats annulés            | Police, client, date, type, motif, prime acquise, remboursement, régularisations de taxe, de commission et d’honoraires                                                    | Période, type, motif         |
| Contrôle des références     | Références manquantes, ou en double entre encaissements différents (colonne AH) ; une même référence partagée par les lignes d’un encaissement groupé n’est pas signalée   | Période                      |

La fiche de chaque contrat affiche aussi, en tête : encaissé, restant dû, et pour les taxes, commissions et honoraires le triplet dû / payé / restant. Un contrat annulé porte un badge rouge « Annulé » avec la date, dans la fiche et dans toutes les listes.

## 6.1 Extraction du dû et du payé

L’extraction donne, pour chaque nature (taxes, commissions, honoraires, accessoires), le dû, le payé et le reste à payer. Elle se lance à trois niveaux, avec détail et totaux.

| **Niveau**     | **Une ligne par**   | **Totaux**                                                    |
|----------------|---------------------|---------------------------------------------------------------|
| Par partenaire | Partenaire          | Sous-total par partenaire, total général                      |
| Par contrat    | Contrat (N° police) | Sous-total par contrat, par partenaire, total général         |
| Détail         | Versement client    | Idem, avec la référence du règlement qui a soldé chaque ligne |

Colonnes de l’extraction :

| **Groupe**     | **Colonnes**                                                                                               |
|----------------|------------------------------------------------------------------------------------------------------------|
| Identification | Partenaire, N° police, client, produit, statut contrat, statut annulation, PaiementID, date d’encaissement |
| Taxes          | Dues, dont exigibles, payées, reste à payer, mois d’exigibilité                                            |
| Commissions    | Dues, payées, reste à payer, à récupérer                                                                   |
| Honoraires     | Dus, payés, reste à payer, à récupérer                                                                     |
| Accessoires    | Dus, payés, reste à payer                                                                                  |
| Règlement      | Référence, date, montant affecté, statut de ligne (Due / Partiellement payée / Payée)                      |

Filtres : période d’encaissement, date de situation, partenaire, contrat, produit, nature, statut de ligne (tout, dû seulement, payé seulement). Export Excel avec une feuille par niveau.

Depuis l’extraction, un clic sur « Régler » ouvre l’écran F5 avec les mêmes filtres, prêt à cocher les lignes.

# 7. Format d’import et d’export

L’import accepte le classeur actuel, une ligne par versement, en-têtes en ligne 1. Les colonnes sont lues par position ; les en-têtes servent de contrôle.

| **Col.** | **En-tête**                                   | **Import**                    | **Export** |
|----------|-----------------------------------------------|-------------------------------|------------|
| A        | DateEnregistrement                            | Lu                            | Écrit      |
| B        | PaiementID                                    | Lu (clé anti-doublon)         | Écrit      |
| C        | NumPolice                                     | Lu, obligatoire (clé contrat) | Écrit      |
| D à J    | TypeDeContrat … NomPartenaire                 | Lus                           | Écrits     |
| K, L, M  | DatePaiement, ModePaiement, RéférencePaiement | Lus                           | Écrits     |
| N        | DDF (jours)                                   | Recalculé                     | Écrit      |
| O, P     | Date effet, Date échéance                     | Lus                           | Écrits     |
| Q        | StatutContrat                                 | Recalculé                     | Écrit      |
| R        | N° Paiement                                   | Recalculé                     | Écrit      |
| S à X    | PrimeTTC … MontantGestion                     | Lus                           | Écrits     |
| Y        | Type Police                                   | Lu                            | Écrit      |
| Z        | Montant reçu TTC                              | Lu                            | Écrit      |
| AA à AD  | Restant dû … Taxe effective à payer           | Recalculés, écart signalé     | Écrits     |
| AE       | Statut du paiement                            | Recalculé                     | Écrit      |
| AF       | Observations                                  | Lu                            | Écrit      |
| AG       | SemaineAnnée (« Sem 27 - 2026 », semaine ISO) | Recalculé                     | Écrit      |
| AH       | Contrôle référence                            | Recalculé                     | Écrit      |

Nouvelles colonnes ajoutées à l’export, après AH (ignorées à l’import) :

| **Col.** | **En-tête**                                                                                               |
|----------|-----------------------------------------------------------------------------------------------------------|
| AI       | Mois exigibilité taxe                                                                                     |
| AJ       | Statut taxe (Non exigible / Exigible / Payée) et date limite de reversement (le 20 du mois d’exigibilité) |
| AK       | Commission due                                                                                            |
| AL       | Commission payée                                                                                          |
| AM       | Honoraires dus                                                                                            |
| AN       | Honoraires payés                                                                                          |
| AO       | Statut annulation                                                                                         |
| AP       | Date d’annulation                                                                                         |
| AQ       | Motif d’annulation                                                                                        |
| AR       | Date d’identification (vide si le paiement a été identifié dès sa réception)                              |
| AS       | N° suspens d’origine (SUS-AAAA-NNNNNN, F10)                                                               |

Formats : dates en jj/mm/aaaa, montants en « \#,##0 FCFA ». L’export contient aussi une feuille par état de la section 6 demandé.

# 8. Contrôles et exigences non fonctionnelles

## 8.1 Contrôles bloquants à la saisie

- N° de police unique ; date d’échéance ≥ date d’effet.
- Prime nette + accessoires + taxes = prime TTC (écart ≤ 1 FCFA).
- Versement : date, mode, référence et montant obligatoires ; montant \> 0 ; date ≤ date du jour.
- Total des versements ≤ prime TTC, sauf validation du responsable.
- Aucun versement sur un contrat annulé, sauf remboursement.
- Règlement : somme des affectations = montant du règlement ; pas d’affectation au-delà du dû.
- Aucune modification dans un mois clôturé.

## 8.2 Alertes non bloquantes

- Référence déjà utilisée dans un autre encaissement.
- Taxes exigibles : rappel 5 jours avant le 20 du mois d’exigibilité, alerte rouge si non payées le 20 (date paramétrable).
- Contrat partiellement payé sans versement depuis plus de 30 jours.
- Commission ou honoraires payés au-delà du dû.

## 8.3 Exigences techniques

| **Exigence**     | **Niveau attendu**                                                                       |
|------------------|------------------------------------------------------------------------------------------|
| Accès            | Application web, navigateur récent, utilisable sur tablette                              |
| Authentification | Compte nominatif, mot de passe fort ; double authentification pour le responsable        |
| Volumétrie       | 50 000 contrats et 200 000 versements par an sans dégradation                            |
| Performance      | Fiche contrat \< 2 s ; état mensuel \< 10 s ; import de 5 000 lignes \< 2 min            |
| Calculs          | Montants en décimal exact (pas de virgule flottante), 2 décimales, arrondi à l’affichage |
| Traçabilité      | Journal d’audit non modifiable, conservé 10 ans                                          |
| Sauvegarde       | Quotidienne, restauration testée chaque trimestre                                        |
| Langue           | Français ; monnaie FCFA                                                                  |

# 9. Cas de recette chiffrés

L’application est acceptée si elle reproduit exactement les résultats ci-dessous (à 1 FCFA près).

**Contrat de test** (repris du fichier actuel) : police IRO-2026-000843-I00000, effet 01/07/2026, échéance 01/08/2026, prime TTC 1 500. Prime nette 1 398,60 ; accessoires 0 ; taxes 101,40 ; commission 251,75 ; honoraires 34,97.

## 9.1 Trois versements

| **N°**    | **Date**   | **Z reçu** | **AA restant dû** | **AB prime nette** | **AD taxe** | **Commission due** | **Honoraires dus** | **Taxe exigible en** |
|-----------|------------|------------|-------------------|--------------------|-------------|--------------------|--------------------|----------------------|
| 1         | 10/07/2026 | 500,00     | 1 000,00          | 466,20             | 33,80       | 83,92              | 11,66              | août 2026            |
| 2         | 20/08/2026 | 700,00     | 300,00            | 652,68             | 47,32       | 117,48             | 16,32              | septembre 2026       |
| 3         | 05/09/2026 | 300,00     | 0,00              | 279,72             | 20,28       | 50,35              | 6,99               | octobre 2026         |
| **Total** |            | 1 500,00   |                   | 1 398,60           | 101,40      | 251,75             | 34,97              |                      |

Le versement 3 solde le contrat : il reçoit les reliquats (par exemple 1 398,60 − 466,20 − 652,68 = 279,72).

## 9.2 Suivi des taxes attendu

| **Situation au** | **Taxes à la production** | **Non exigibles (dont non encaissées / dont encaissées)** | **Exigibles cumulées** | **À reverser dans le mois** |
|------------------|---------------------------|-----------------------------------------------------------|------------------------|-----------------------------|
| 31/07/2026       | 101,40                    | 101,40 (67,60 / 33,80)                                    | 0,00                   | 0,00                        |
| 31/08/2026       | 101,40                    | 67,60 (20,28 / 47,32)                                     | 33,80                  | 33,80                       |
| 30/09/2026       | 101,40                    | 20,28 (0,00 / 20,28)                                      | 81,12                  | 47,32                       |
| 31/10/2026       | 101,40                    | 0,00                                                      | 101,40                 | 20,28                       |

## 9.3 Commissions attendues

Au 31/08/2026, commission due = 83,92 + 117,48 = 201,40. Si 83,92 a été payée au partenaire en août, le restant à payer est 117,48 et la commission non acquise est 50,35.

## 9.4 Annulation

- **Sans effet au 15/07/2026**, après le versement 1 seulement : remboursement client 500,00 ; taxe à la production restante 67,60 annulée ; taxe 33,80 non encore reversée annulée ; commission 83,92 et honoraires 11,66 ramenés à 0. Si la commission avait été payée, 83,92 apparaît en « à récupérer » sur le partenaire.
- **Résiliation au 16/07/2026**, après le versement 1 : prime acquise = 1 500 × 15 ÷ 31 = 725,81 ; restant dû ramené de 1 000,00 à 225,81 ; taxes, commission et honoraires recalculés sur 725,81.

## 9.5 Règlement partiel par lignes cochées

Le partenaire WIASSUR a 1 000 000 FCFA de commissions dues sur quatre lignes. Il reçoit un paiement de 500 000.

| **Ligne** | **Police** | **Commission due** | **Cas A : lignes cochées**  | **Cas B : lignes cochées**                                    |
|-----------|------------|--------------------|-----------------------------|---------------------------------------------------------------|
| 1         | Police 1   | 400 000            | Cochée → Payée              | Cochée → Payée                                                |
| 2         | Police 2   | 350 000            | Non cochée → Due            | Cochée, 100 000 affectés → Partiellement payée, reste 250 000 |
| 3         | Police 3   | 150 000            | Non cochée → Due            | Non cochée → Due                                              |
| 4         | Police 4   | 100 000            | Cochée → Payée              | Non cochée → Due                                              |
| **Total** |            | 1 000 000          | Payé 500 000, reste 500 000 | Payé 500 000, reste 500 000                                   |

Attendu dans les deux cas : l’extraction par partenaire affiche dû 1 000 000, payé 500 000, reste 500 000. Le détail montre la référence du règlement sur chaque ligne soldée. La même logique s’applique aux taxes, aux honoraires et aux accessoires.

## 9.6 Paiement partiel d’un bordereau de 1 000 contrats

Le bordereau de commissions WIASSUR de septembre compte 1 000 lignes pour 1 000 000 FCFA. Trois lignes sont En attente (contrats en cours d’annulation), pour 12 000 FCFA ; elles n’y figurent pas. Le partenaire reçoit 500 000.

| **Règle choisie**      | **Résultat attendu**                                                               | **Actions de l’utilisateur**                  |
|------------------------|------------------------------------------------------------------------------------|-----------------------------------------------|
| Plus anciennes d’abord | Lignes soldées par date d’encaissement jusqu’à 500 000 ; la dernière est partielle | Saisir le règlement, valider : 2 clics        |
| Prorata                | 1 000 lignes payées chacune à 50 %                                                 | Saisir le règlement, choisir Prorata, valider |
| Contrats choisis       | Contrats cochés soldés, reste réparti par ancienneté                               | Cocher quelques contrats, valider             |
| Import de fichier      | Lignes du fichier soldées ; seules les anomalies sont affichées                    | Importer, traiter les anomalies, valider      |

Attendu dans tous les cas : bordereau Partiellement payé, 500 000 payés, 500 000 restant dus ; extraction par partenaire cohérente ; chaque ligne soldée porte la référence du règlement et du bordereau. Temps de traitement de la répartition sur 1 000 lignes : moins de 5 secondes.

## 9.7 Un chèque pour plusieurs polices

Le 15/09/2026, WIASSUR remet le chèque n° 1234567 de 250 000 FCFA pour trois polices. Taux de taxe 7,25 %, pas d’accessoires.

| **Police** | **Montant ventilé (Z)** | **AB prime nette** | **AD taxe** | **Taxe exigible en** | **À reverser avant le** |
|------------|-------------------------|--------------------|-------------|----------------------|-------------------------|
| Police A   | 100 000                 | 93 240,09          | 6 759,91    | octobre 2026         | 20/10/2026              |
| Police B   | 90 000                  | 83 916,08          | 6 083,92    | octobre 2026         | 20/10/2026              |
| Police C   | 60 000                  | 55 944,06          | 4 055,94    | octobre 2026         | 20/10/2026              |
| **Total**  | 250 000                 | 233 100,23         | 16 899,77   |                      |                         |

Attendu : un encaissement groupé de 250 000 et trois versements portant tous la référence 1234567, sans alerte de doublon. Chaque fiche contrat montre son versement et le lien vers le chèque. Une nouvelle saisie de la référence 1234567 dans un autre encaissement déclenche l’alerte de doublon.

## 9.8 Production importée et annulations

Paramétrage : produit IRO, commission par défaut 18 % ; WIASSUR 20 % ; PARTX 15 %. Un fichier de production de 4 contrats IRO est importé. Attendu : contrat WIASSUR à 20 %, aucune alerte ; contrat PARTX à 18 %, importé avec le montant du fichier et signalé (attendu 15 %) ; contrat d’un partenaire absent du référentiel, signalé avec proposition de création ; contrat dont prime nette + taxes ≠ prime TTC (écart de 50 FCFA), importé et signalé. L’ajout de 60 partenaires sur le produit IRO est accepté sans limite.

Saisie directe : prime nette 100 000, taux accessoires 5 %, taux taxe 7,25 %, taux commission 18 %, taux gestion 2,5 %. Attendu : accessoires 5 000 ; taxe 7 612,50 ; prime TTC 112 612,50 ; commission 18 000 ; gestion 2 500. En partant de la prime TTC 112 612,50 avec les mêmes taux, l’application retrouve une prime nette de 100 000.

Annulation : un fichier d’annulations de 50 polices est importé par l’équipe technique. Attendu : 50 contrats au statut Annulé, leurs lignes non payées mises En attente ; un utilisateur du profil Gestionnaire encaissements ne voit pas l’action « Annuler ».

Profil Finance : l’import d’un fichier de production de 200 contrats aboutit. Le même fichier contenant 3 lignes marquées annulées est importé pour les 197 autres ; les 3 lignes sont rejetées avec le motif « annulation réservée à l’équipe technique ». L’action « Annuler » n’apparaît pas pour la finance.

## 9.9 Paiement non identifié en septembre, identifié en novembre

Le 12/09/2026, un virement de 300 000 FCFA arrive sans référence exploitable. Il est enregistré en suspens SUS-2026-000001. Le 10/11/2026, il est identifié : 200 000 pour la police A (taxe 7,25 %) et 100 000 non taxables.

| **Moment**                                 | **Attendu**                                                                                                                                                                                 |
|--------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Septembre et octobre                       | Suspens de 300 000 visible dans le rapprochement et l’état des suspens. Aucune taxe, commission ni honoraires. Déclaration d’octobre (pour les encaissements de septembre) sans ce montant. |
| Identification le 10/11                    | Versement police A : date de paiement 12/09/2026, date d’identification 10/11/2026, Z = 200 000, AB = 186 480,19, AD = 13 519,81. Les 100 000 classés non taxables par la finance.          |
| Déclaration à reverser avant le 20/11/2026 | 13 519,81 ajoutés en régularisation « encaissement de septembre 2026 identifié en novembre 2026 ».                                                                                          |
| Bordereau de commissions de novembre       | Commission de la police A sur 200 000 incluse.                                                                                                                                              |
| États de septembre                         | Inchangés en vue « tel que déclaré » ; la vue « corrigée » montre les 200 000 rattachés à septembre.                                                                                        |

# 10. Livrables et planning

## 10.1 Livrables attendus de l’informatique

- Application web installée en recette puis en production.
- Reprise des données : import du classeur existant, rapport d’écarts.
- Manuel utilisateur et formation des profils de la section 2.
- Documentation technique et du modèle de données.
- Procès-verbal de recette signé sur la base de la section 9.

## 10.2 Planning indicatif

| **Lot** | **Contenu**                                                                                                  | **Durée indicative** |
|---------|--------------------------------------------------------------------------------------------------------------|----------------------|
| Lot 1   | Contrats, versements échelonnés, encaissements groupés, échéancier prévu, prorata Z à AD, import / export    | 4 à 6 semaines       |
| Lot 2   | Suivi des taxes (production, exigibilité N+1, reversement avant le 20), rapprochement banque et mobile money | 3 à 4 semaines       |
| Lot 3   | Commissions, honoraires et accessoires dus / payés, extractions, règlements par lignes cochées               | 3 à 4 semaines       |
| Lot 4   | Annulations et régularisations, tableaux de bord, clôture mensuelle                                          | 3 à 4 semaines       |
| Recette | Tests sur le cas de la section 9 et sur un mois réel                                                         | 2 semaines           |

Une maquette fonctionnelle couvrant les lots 1 et 2 existe déjà et peut servir de référence visuelle aux développeurs.

# 11. Options (à chiffrer séparément)

Ces fonctions ne sont pas obligatoires pour la première version. L’informatique les chiffre à part ; la direction choisit lesquelles réaliser.

| **Option**                               | **Contenu**                                                                                                                    | **Bénéfice attendu**              |
|------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|-----------------------------------|
| O1. Relances automatiques                | SMS, WhatsApp ou e-mail au client avant chaque échéance (F8) et en cas de retard ; liste « à relancer » pour les gestionnaires | Moins d’impayés                   |
| O3. Espace partenaire                    | Le partenaire consulte en ligne ses commissions dues et payées, ses bordereaux, ses relevés                                    | Moins de réclamations             |
| O4. Écritures comptables automatiques    | Une écriture par encaissement, bordereau, reversement et annulation, exportable vers le logiciel comptable                     | Plus de double saisie             |
| O5. Double validation au-delà d’un seuil | Règlements au-dessus d’un montant paramétrable (ex. 5 000 000 FCFA) et annulations validés par une deuxième personne           | Protection contre erreurs et abus |
