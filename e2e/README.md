# Tests de bout en bout (Playwright)

Scripts lancés **à la main**, uniquement contre une base PostgreSQL **jetable** (jamais la base de dev). Playwright
n'est pas une dépendance du projet : l'installer sans l'enregistrer, puis le retirer.

```bash
npm i --no-save playwright          # à la racine (Chromium déjà en cache ou téléchargé)
bash e2e/base-jetable.sh             # conteneur postgres:16, migrations, seed, `next start` sur le port 3100
node e2e/pointage-lot3bis.mjs        # pointage : jour non ouvré, départ avant 30 min, double départ
node e2e/pointage-decision-dg.mjs    # justifications : retardataire seul RH, décision du DG
node e2e/soumission-dg-article.mjs   # Trésorerie : bouton « Soumettre au DG » par article, phrases de refus
node e2e/articles-beneficiaire-pieces.mjs  # Trésorerie : bénéficiaire et pièces par article, « Appliquer à tous », correction
node e2e/articles-decision-finance.mjs     # Trésorerie (lot B) : décision par article, statut « En cours », files, frise, reprise
node e2e/reglement-par-article.mjs     # Trésorerie (lot D) : règlement par article, parcours, garde 8 par article, reprise, PDF (pdftotext requis)
node e2e/regularisation-par-article.mjs # Trésorerie (lot E) : retour de caisse et régularisation par article, retour exceptionnel par article
node e2e/lot-g.mjs                  # Trésorerie (lot G) : date de livraison par article, règlements Caisse + Banque, retour d'un fonds bancaire, reçus détaillés, récapitulatif, reporting des retours (pdftotext et unzip requis)
node e2e/lot-g-bis.mjs              # Trésorerie (lot G bis) : retour d'un fonds bancaire = retour externe rattaché à la demande et à l'article (Finance), compte comme retour reçu (pdftotext et unzip requis)
node e2e/lot-g-ter.mjs              # Trésorerie (lot G ter) : article réglé Caisse + Banque (471 000 + 100 000) — reste non détaillé incluant le fonds banque, sous-bloc par règlement, « Détailler » du fonds banque, solde 0 et « Régularisé », bande « Total de l'article » (lot G quater) (pdftotext requis)
node e2e/lot-h.mjs                  # Trésorerie (lot H) : libellés de dates (Demande créée le / Livraison prévue le / Géré le) sur écrans, listes, PDF, Excel ; libellés du menu par rôle (Accueil, Accueil Finance), infobulles (pdftotext et unzip requis)
node e2e/lot-c.mjs                  # Trésorerie (lot C) : décision du DG par article, notifications nommant l'article, clôture « tous les articles terminés » (message de blocage), clôture forcée (motif, garde 8, historique, notifications, reporting/export), rappel unique (unzip requis)
node e2e/lot-f.mjs                  # Trésorerie (lot F) : reporting et export en UN seul tableau (demande → articles → événements) : classeur relu avec exceljs (niveaux, filtre, volets, formats numériques, totaux par devise SUMIFS, liens des justificatifs des retours externes), page dépliable, filtres communs, cohérence avec l'écran de la demande (exceljs requis)
node e2e/lot-i.mjs                  # Trésorerie (lot I) : « Montant retourné », motif / nature du règlement obligatoire (serveur + écran, anciens « Non renseigné »), catégorisation obligatoire à partir d'une date (nulle / future / aujourd'hui), reçu PDF, parcours, reporting (pdftotext et exceljs requis)
node e2e/lot-j-ter.mjs              # Trésorerie (lots J ter et J quater : page Budgets en deux sections, « Budget de caisse » et « Budgets par catégorie », chacune avec ses actions, notifications, lot et historique) : budget global = solde de caisse réel (seuils en montant, sans montant saisi), soumission et décision des budgets en lot, restes et alertes orange / rouge / négatif sur le solde de caisse, règlements Caisse / Banque dans le prévisionnel, page Catégories fusionnée dans Budgets (exceljs requis)
node e2e/lot-j.mjs                  # Trésorerie (lot J, adapté au lot J quater : formulaire et actions de la section des catégories) : budgets paramétrés par la Finance, validés par le DG (date d'effet, seuils), restes global et catégorie à chaque validation, alertes ORANGE / ROUGE, confirmation du DG (demandée ou dans le même geste), parcours, reporting, migration des budgets existants (exceljs requis)
node e2e/lot-j-bis.mjs            # Trésorerie (lot J bis) : la confirmation du DG d'un dépassement rouge couvre le règlement de l'article (jusqu'au montant confirmé, trace, parcours, reporting, autre article et excédent refusés), mention « Dernier paramétrage refusé », catégories et objets désactivables / réactivables par la Finance (unzip requis)
node e2e/lot-k.mjs                # Trésorerie (lot K) : réorientation de l'étape Service vers un autre responsable disponible (demandeur et Finance, liste filtrée, motif, garde 8, ancien responsable bloqué, chronomètre et rappel, historique, notifications) et reprise avec motif obligatoire (Finance → Service, DG → Finance, validation → à décider ; interdits ; dépassement confirmé puis article repris) ; parcours et reporting (unzip requis)
node e2e/lot-l.mjs                # Trésorerie (lots L et L bis) : signature manuscrite sur les actions sensibles — enrôlement (souris et doigt), revalidation serveur de l'image, refus sans signature (appel direct), création à l'écran, trace (signataire, version, IP), délégation « au nom de », reçu PDF et reporting (page + Excel) ; L bis : action et signature dans la même transaction (échec simulé par déclencheur PostgreSQL), lien par identifiant (deux versions de signature à moins d'une minute), « Signature non rattachée » (unzip et pdftotext requis)
bash e2e/arreter.sh                  # arrête le serveur et le conteneur
npm uninstall --no-save playwright
```

**Lot L** : les actions sensibles de la Trésorerie sont signées et le serveur refuse toute action signée d'un compte sans signature enrôlée. Chaque script Trésorerie appelle donc `assurerSignatures(db)` (`e2e/signatures-auto.mjs`) juste après sa connexion à la base :
cela enrôle une signature de test pour tous les comptes et crée un déclencheur PostgreSQL qui le fait pour les comptes créés ensuite. Un script qui supprime un compte qu'il a créé doit d'abord supprimer ses lignes `ActionSignee` et `SignatureUtilisateur`.

`next build` doit avoir été lancé avant `base-jetable.sh`. Le script écrit seulement dans la base jetable
(`E2E_DATABASE_URL`, par défaut `postgresql://postgres:pw@localhost:55497/e2e`).

## Fiabilisation du pointage (2026-10-14)

```bash
node e2e/session-glissante.mjs        # durées de session glissantes (1 jour / 30 jours), ancien lien ?error=inactivite
# Serveur lancé avec un SMTP volontairement faux, pour voir l'incident SMTP_ECHEC au journal technique :
SMTP_HOST=127.0.0.1 SMTP_PORT=1 SMTP_USER=x SMTP_PASS=y bash e2e/base-jetable.sh
node e2e/planificateur-journal.mjs    # planificateur intégré, verrou, journal technique, moniteur, invariant « le retard va au supérieur »
node e2e/mon-equipe.mjs               # « Mon équipe » du responsable (à lancer sur une base neuve)
# Planificateur coupé : le moniteur passe la tâche « En retard » (base neuve).
PLANIFICATEUR_ACTIF=false bash e2e/base-jetable.sh && node e2e/planificateur-retard.mjs
```

`E2E_ATTENDRE_CRENEAU=1 node e2e/planificateur-journal.mjs` attend en plus le prochain créneau de 5 minutes du planificateur.

### Clôture initiale, purge du Pointage, page « Présence du jour »

```bash
# Base neuve, planificateur actif :
node e2e/cloture-initiale.mjs          # clôture initiale (relance le serveur via e2e/redemarrer-serveur.sh)
# Base neuve, planificateur COUPÉ (sinon la tâche des absences recrée des lignes après chaque purge) :
PLANIFICATEUR_ACTIF=false bash e2e/base-jetable.sh && node e2e/reinitialisation-pointage.mjs
# Après une base peuplée par les autres scripts :
E2E_CAPTURES=./e2e-captures node e2e/presence-rh.mjs   # page « Présence du jour » de la RH (capture dans e2e-captures/, non versionné)
```
