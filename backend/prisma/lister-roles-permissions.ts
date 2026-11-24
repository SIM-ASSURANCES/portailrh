// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import fs from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { comparaisonVide, comparerAvecCible, genererMarkdownBase, type PermissionLue, type RoleLu } from "../src/rolesComparaison";

/**
 * Liste RÉELLE des rôles et de leurs permissions (lot R) — LECTURE SEULE : tout se déroule dans une transaction
 * `SET TRANSACTION READ ONLY` (PostgreSQL refuse toute écriture), puis annulée. Compare avec `docs/roles-et-permissions.md`.
 *
 *   npx tsx prisma/lister-roles-permissions.ts                       # écrit ./roles-et-permissions-base.md
 *   npx tsx prisma/lister-roles-permissions.ts --sortie chemin.md
 *
 * Aucune donnée personnelle dans le fichier (noms de rôles, clés de permissions, nombre de comptes actifs). Code de sortie :
 * 0, ou 1 s'il existe une alerte à corriger (couple interdit, permission réservée au DG portée par un autre rôle).
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");
  const i = process.argv.indexOf("--sortie");
  const sortie = path.resolve(process.cwd(), i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "roles-et-permissions-base.md");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const { roles, permissions } = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const rolesLus = await tx.role.findMany({
          orderBy: { name: "asc" },
          include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { users: { where: { isActive: true } } } } },
        });
        const permsLues = await tx.permission.findMany({ orderBy: { key: "asc" }, include: { module: { select: { key: true } } } });
        const roles: RoleLu[] = rolesLus.map((r) => ({
          name: r.name,
          description: r.description,
          estAdmin: r.estAdmin,
          peutEtreBeneficiaireDelegation: r.peutEtreBeneficiaireDelegation,
          peutRecevoirFeedback: r.peutRecevoirFeedback,
          nbComptesActifs: r._count.users,
          permissions: r.permissions.map((rp) => rp.permission.key).sort(),
        }));
        const permissions: PermissionLue[] = permsLues.map((p) => ({ key: p.key, label: p.label, moduleKey: p.module.key }));
        return { roles, permissions };
      },
      { timeout: 60_000 }
    );
    const comparaison = comparerAvecCible(roles, permissions);
    fs.writeFileSync(sortie, genererMarkdownBase(roles, permissions, comparaison, new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"), "utf-8");
    console.log(`Écrit : ${sortie}`);
    console.log(`${roles.length} rôle(s), ${permissions.length} permission(s).`);
    console.log(comparaisonVide(comparaison) ? "Aucun écart avec docs/roles-et-permissions.md." : `Écarts avec le document : ${comparaison.ecarts.length} rôle(s), ${comparaison.permissionsAbsentes.length} permission(s) absente(s), ${comparaison.alertes.length} alerte(s).`);
    process.exitCode = comparaison.alertes.length ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
