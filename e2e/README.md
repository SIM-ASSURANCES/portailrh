# Tests de bout en bout (Playwright)

Scripts lancés **à la main**, uniquement contre une base PostgreSQL **jetable** (jamais la base de dev). Playwright
n'est pas une dépendance du projet : l'installer sans l'enregistrer, puis le retirer.

```bash
npm i --no-save playwright          # à la racine (Chromium déjà en cache ou téléchargé)
bash e2e/base-jetable.sh             # conteneur postgres:16, migrations, seed, `next start` sur le port 3100
node e2e/pointage-lot3bis.mjs        # pointage : jour non ouvré, départ avant 30 min, double départ
node e2e/pointage-decision-dg.mjs    # justifications : retardataire seul RH, décision du DG
bash e2e/arreter.sh                  # arrête le serveur et le conteneur
npm uninstall --no-save playwright
```

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
