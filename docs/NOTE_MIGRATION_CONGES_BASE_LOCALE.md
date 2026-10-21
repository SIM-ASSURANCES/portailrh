# Note : erreur après un `pull` (module congés), base locale désynchronisée

## Symptôme
Le lancement de l'app (`npm run dev`) marche. À la connexion, la page `/` répond 500 :

```
PrismaClientKnownRequestError P2022
The column `(not available)` does not exist in the current database.
  at chargerFileDecisionConges (src/lib/conges/lecture.ts)
  at chargerNavConges (src/lib/conges/navigation.ts)
  at DashboardLayout (src/app/(dashboard)/layout.tsx)
```

La tâche `RAPPELS_CONGES` échoue aussi (« Échec de l'exécution », « Impossible d'enregistrer l'exécution »).

## Cause
La migration `backend/prisma/migrations/20261021090000_conges_permissions_absence/migration.sql` n'est pas déployée : elle a été **réécrite sur place** (voir son en-tête). Les bases locales qui avaient déjà appliqué l'ancienne version ont :

- la migration marquée comme appliquée ;
- l'ancienne table `DemandeConge`, avec un schéma différent.

Conséquences :
- `npx prisma migrate status` répond « Database schema is up to date! » à tort, car Prisma ne revérifie pas le contenu d'une migration déjà appliquée.
- `npx prisma db execute --file …/migration.sql` échoue avec `la colonne « creeParId » référencée dans la contrainte de clé étrangère n'existe pas`, car l'ancienne table existe encore.
- `npx prisma generate` n'y change rien : le client est bon, c'est la base qui est en retard.

## Correction (base de dev uniquement)
Recréer la base locale. **Cela efface ses données.**

```powershell
cd backend
npx prisma migrate reset
npx prisma generate
```

Puis relancer `npm run dev` à la racine et se reconnecter.

> [!WARNING]
> Ne jamais faire `migrate reset` sur une base partagée ou de production. La migration n'est pas déployée : le renommage ou la réécriture reste sans risque tant qu'elle n'est pas en production.

## Bruit sans importance dans les logs
- `JWTSessionError: no matching decryption secret` : ancien cookie de session. Se reconnecter ou vider les cookies de `localhost`.
- `next/font/google ... exactly one entry` (Turbopack) : cache corrompu ou Google Fonts injoignable. Arrêter le serveur, puis `Remove-Item -Recurse -Force frontend\.next` et relancer.

## À prévoir à la fusion
L'en-tête de la migration le rappelle : son horodatage (`20261021090000`) est antérieur aux migrations `20261022*` de la branche `aristide`. Renommer le dossier de la migration au moment de la fusion, après un dernier `git fetch`.

