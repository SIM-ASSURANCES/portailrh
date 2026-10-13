# Tests de bout en bout (Playwright)

Scripts lancés **à la main**, uniquement contre une base PostgreSQL **jetable** (jamais la base de dev). Playwright
n'est pas une dépendance du projet : l'installer sans l'enregistrer, puis le retirer.

```bash
npm i --no-save playwright          # à la racine (Chromium déjà en cache ou téléchargé)
bash e2e/base-jetable.sh             # conteneur postgres:16, migrations, seed, `next start` sur le port 3100
node e2e/pointage-lot3bis.mjs        # pointage : jour non ouvré, départ avant 30 min, double départ
node e2e/pointage-decision-dg.mjs    # justifications : retardataire seul RH, décision du DG
node e2e/soumission-dg-article.mjs   # Trésorerie : bouton « Soumettre au DG » par article, phrases de refus
bash e2e/arreter.sh                  # arrête le serveur et le conteneur
npm uninstall --no-save playwright
```

`next build` doit avoir été lancé avant `base-jetable.sh`. Le script écrit seulement dans la base jetable
(`E2E_DATABASE_URL`, par défaut `postgresql://postgres:pw@localhost:55497/e2e`).
