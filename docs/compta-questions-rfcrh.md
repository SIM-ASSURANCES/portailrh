# Gestion Compta — questions pour le Responsable Finances, Comptabilité & RH

> Document prêt à être envoyé. Il est écrit en langage métier, sans terme technique. Il accompagne le cahier des charges
> `SIM-XX-XX` v1.0 et le plan de développement (`PLAN_GESTION_COMPTA.md`). Les réponses sont à reporter dans
> `compta-conception.md` (section 1.3) avec la date.

## Ce qui est déjà décidé (pour information)

1. Le module s'appelle **« Gestion Compta »** et fonctionne **indépendamment** des autres modules du portail.
2. Un rattachement d'encaissement à un contrat se fait **en deux étapes** : le commercial **confirme** avec le reçu, puis le RFCRH **valide**. Un rattachement qui s'appuie sur une preuve directe (référence exacte ou référence incomplète avec même montant) n'a pas besoin de la confirmation du commercial et passe directement à la validation du RFCRH.
3. Tant qu'un rattachement n'est pas **validé**, le contrat n'est pas considéré comme payé et aucune taxe ni commission n'est calculée sur lui.

## Questions à traiter en premier (elles bloquent la préparation des accès)

| # | Question | Pourquoi nous en avons besoin |
|---|---|---|
| **Q4** | Le cahier dit que le **Directeur général « tranche les litiges »**. De quels litiges s'agit-il (par exemple un désaccord sur un rattachement, un écart avec un partenaire, un écart avec Odoo) ? Que doit-il pouvoir faire à l'écran (donner une décision écrite, valider un montant, autre) ? | Prévoir l'écran et la trace de sa décision |
| **Q5** | Qui occupe chaque profil ? **Responsable Finances, Comptabilité & RH** ; **responsable commercial** et **3 managers** ; **actuaire** et **chargée des études techniques** ; **stagiaire comptable** ; **Directeur général**. Quelqu'un cumule-t-il plusieurs profils (par exemple le RFCRH est aussi chargé de la RH) ? | Dans le portail, une personne a **un seul rôle** : les cumuls demandent un rôle combiné préparé à l'avance |
| **Q3 bis** | Si le commercial est absent, le RFCRH peut-il **confirmer à sa place** un rattachement (avec un motif écrit), ou le dossier attend-il le retour du commercial ? Le commercial qui confirme doit-il être celui du partenaire concerné, ou n'importe lequel des quatre ? | Définir qui peut faire l'étape 1 |

## Questions à traiter avant le lot concerné

### Production et contrats

| # | Question | Lot |
|---|---|---|
| **Q7** | Pour le produit **SECURPRO** (incendie, plusieurs garanties), le taux de taxe est « lu au contrat ». Où le trouve-t-on : dans une colonne du bordereau de production, ou faut-il le saisir sur le contrat ? | Taxe |
| **Q8** | **Prime acquise et non acquise à la clôture** : quelle méthode utilise-t-on (au prorata des jours courus, sur 360 jours, autre) ? Quels sont exactement « les éléments nécessaires aux écritures de fin de période » ? | Production, clôture |
| **Q9** | **Retrait d'assurés avec ristourne** : comment est fixé le « taux de ristourne » (valeur unique, par produit, par contrat) et qui le décide ? | Production |
| **Q15** | L'état de déclaration de la taxe demande les **primes remboursées**. Où ces remboursements sont-ils enregistrés aujourd'hui (ristourne, annulation, autre) ? | Taxe |

### Encaissements et rattachement

| # | Question | Lot |
|---|---|---|
| **Q11** | Quand un client paie **plus** que l'échéance la plus ancienne, que fait-on par défaut de l'excédent : l'affecter à l'échéance suivante, ou le laisser « à rattacher » en attendant la décision du RFCRH ? *Notre proposition : l'application propose l'échéance suivante, et ce qui reste attend.* | Rattachement |
| **Q16** | Les seuils du rapprochement automatique (même montant à 1 FCFA près ; entre 3 jours avant et 5 jours après ; ±2 % sur ±45 jours ; 12 premiers caractères de la référence) sont-ils **fixes** ou le RFCRH doit-il pouvoir les **modifier** ? *Notre proposition : modifiables par le RFCRH, avec une trace.* | Rattachement |

### Contrôle hebdomadaire

| # | Question | Lot |
|---|---|---|
| **Q17** | **Écart entre le « technique » et le « réel » depuis le 1er janvier** : que doit comparer exactement cet indicateur (par exemple les primes que la production déclare payées, contre les encaissements validés par vous) ? Le cahier ne le définit pas. *Notre lecture provisoire (C-19) : le technique est la prime TTC des contrats déclarés payés depuis le 1er janvier ; le réel est la somme des rattachements validés sur ces mêmes contrats ; seuls les contrats payés **en une fois** sont comparés.* Que faire des contrats **fractionnés** (mensuel, trimestriel…) : « déclaré payé » ne dit pas quelle échéance est payée, donc nous ne les comparons pas aujourd'hui. Faut-il comparer par échéance (dès que la production indique laquelle est payée), ou garder les seuls contrats payés en une fois ? | Contrôle hebdomadaire |
| **Q18** | **Créances** : (1) un contrat n'a aujourd'hui aucun **commercial** rattaché : faut-il en désigner un (par partenaire, ou par contrat) pour filtrer les créances et les relances par commercial ? (2) Qui est le **débiteur** quand un partenaire paie pour ses clients ? *Notre lecture provisoire (C-20) : le partenaire apporteur marqué « client » est le débiteur de tous ses contrats ; sinon le client du contrat.* Est-ce la bonne règle ? | Créances |
| **Q19** | **Rémunération des partenaires** : le bordereau de production contient des colonnes de commission et de frais de gestion, que l'application lit sans les enregistrer. Faut-il les enregistrer pour être alerté quand le taux appliqué par le technique diffère de la convention signée ? | Rémunération |
| **Q20** | **Rémunération** : à quelle date choisit-on la convention (date d'effet du contrat, de l'échéance, de l'encaissement) ? Une convention de commission sans apporteur désigné vaut-elle pour tous les contrats ? Après une résiliation, la rémunération des primes jamais encaissées disparaît-elle, même pour la période déjà courue ? *Lecture provisoire : C-31 de la conception.* | Rémunération |
| **Q21** | **Honoraires** : la séparation « sur primes encaissées » / « sur primes non encaissées » doit-elle porter sur les honoraires exigibles (notre lecture) ou sur la totalité des honoraires dus, même non exigibles ? | Rémunération |
| **Q22** | **Règlements aux partenaires** : un versement supérieur au montant payable doit-il être impossible, ou accepté comme avance avec motif, dans la limite du reste dû (notre lecture) ? Comment voulez-vous corriger un règlement saisi par erreur ? | Rémunération |

### Relances, clôture et mise en service

| # | Question | Lot |
|---|---|---|
| **Q10** | **Relances** : les SMS sont-ils envoyés **hors de l'application** (l'application enregistre seulement « relance faite le … ») ou souhaite-t-on un **envoi automatique** par une passerelle SMS (fournisseur et coût à prévoir) ? Le relevé client « envoyé » doit-il partir par e-mail ? | Créances |
| **Q12** | **Escalade** : à 7 jours une relance, à 30 jours une alerte, à 60 jours une escalade. À qui va l'alerte à 30 jours et l'escalade à 60 jours ? *Notre proposition : RFCRH à 30 jours, Directeur général à 60 jours.* **Clôture mensuelle** : quels sont les contrôles qui doivent **bloquer** la clôture, et qui peut lever un blocage ? | Contrôle hebdomadaire, clôture |
| **Q13** | **Reprise de l'historique depuis 2025** : date exacte de départ, volumes approximatifs, et comment reconnaître les rattachements anciens faits « sans information précise sur décision du RFCRH » (liste, colonne, autre) ? | Reprise |
| **Q14** | **Odoo** : quelle version et quelle édition ? Quel plan comptable des assurances ? Quel **format d'import** utilise-t-on aujourd'hui (colonnes) ? Quels journaux et comptes faut-il associer à chaque compte d'encaissement, produit et nature de rémunération ? | Exports Odoo, lot 2 |

### Exploitation

| # | Question | Pourquoi |
|---|---|---|
| **E1** | Le portail contient déjà un module **« Encaissements, taxes »** qui calcule aussi la taxe sur les contrats. Pour la **mise en production**, quel module doit **faire foi** pour la déclaration de la taxe et les honoraires (un seul des deux, pour ne jamais déclarer ou payer deux fois) ? | Éviter un double paiement de la taxe |

## Documents à nous transmettre (anonymisés)

Les données clients (noms, numéros de téléphone) doivent être **remplacées** avant l'envoi ; elles ne sont **jamais** conservées dans le dépôt du projet, mais dans un dossier séparé sur le poste de développement.

| Document | Pour quoi faire |
|---|---|
| Un **relevé Wave Business** d'un mois | Définir les colonnes et reconnaître remboursements, tests et frais |
| Un relevé **Wave hors business** | Idem |
| Un relevé **BNI**, un d'une **autre banque**, un de **microfinance** | Idem |
| Un export **PeyaPay** | Idem |
| Le **bordereau de production** d'un mois | Définir les colonnes et les contrôles |
| **Deux bordereaux de partenaires** de formats différents | Définir l'import et la comparaison avec la production |
| Un **état de déclaration de la taxe** et sa **quittance** | Reproduire l'état par taux |
| Les **conventions** de deux partenaires (par exemple un courtier et NOVELIA) | Paramétrer commissions, accessoires et honoraires |

## Ce que nous ferons avec vos réponses

Les réponses aux questions du premier tableau déterminent les **rôles et comptes de départ** ; elles sont nécessaires avant le lot
« Permissions et rôles ». Les autres réponses sont attendues **avant le lot concerné** : le développement commence par le socle et
les référentiels, qui n'en dépendent pas.
