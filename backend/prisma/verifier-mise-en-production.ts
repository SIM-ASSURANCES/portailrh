// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { readdirSync } from "node:fs";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { jourCourantBudget } from "../src/budgets";
import { CLE_CATEGORISATION_OBLIGATOIRE_DES } from "../src/categorisationObligatoire";
import {
  PERMISSION_RH,
  assistantsFinanceActifs,
  codeSortie,
  comptesRHCorrection,
  formaterRapport,
  listerDelegationsPointage,
  verifierBudgetsCategories,
  verifierComptesDeTest,
  verifierDateCategorisation,
  verifierEnvironnement,
  verifierMigrations,
  verifierMinimumComptes,
  verifierPermissionsConges,
  verifierResponsablesServices,
  verifierRoleDG,
  verifierRoleFinance,
  verifierServicesDesComptes,
  verifierSeuilsCaisse,
  verifierSignatures,
  type CompteActif,
  type ParametrageLu,
  type Point,
} from "../src/miseEnProduction";

/**
 * Vérification AVANT mise en service (lot N) — LECTURE SEULE : tout se déroule dans une transaction ouverte en
 * `SET TRANSACTION READ ONLY` (PostgreSQL refuse alors toute écriture, même par erreur), puis annulée.
 *
 *   npx tsx prisma/verifier-mise-en-production.ts            # préparation : les comptes de test actifs sont un avertissement
 *   npx tsx prisma/verifier-mise-en-production.ts --final    # vérification finale : un compte de test actif est « À CORRIGER »
 *
 * Code de sortie : 0 si aucun « À CORRIGER », 1 sinon (les avertissements et les listes à contrôler ne bloquent pas).
 * Les valeurs des variables d'environnement ne sont jamais affichées. Les règles sont dans `src/miseEnProduction.ts` (testées).
 */
const jourDe = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

async function main() {
  const final = process.argv.includes("--final");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const jour = jourCourantBudget();
  try {
    const points: Point[] = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

        const attendues = readdirSync(path.resolve(__dirname, "migrations"), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
        const lignes = await tx.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
          SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
        const appliquees = lignes.filter((l) => l.finished_at && !l.rolled_back_at).map((l) => l.migration_name);
        const nonTerminees = lignes.filter((l) => !l.finished_at && !l.rolled_back_at).map((l) => l.migration_name);

        const roles = (await tx.role.findMany({ select: { name: true, estAdmin: true, permissions: { select: { permission: { select: { key: true } } } } } })).map((r) => ({
          name: r.name,
          estAdmin: r.estAdmin,
          permissions: r.permissions.map((p) => p.permission.key),
        }));
        const cataloguePermissions = (await tx.permission.findMany({ select: { key: true } })).map((p) => p.key);

        const utilisateurs = await tx.user.findMany({
          select: {
            id: true,
            fullName: true,
            email: true,
            isActive: true,
            role: { select: { name: true, permissions: { select: { permission: { select: { key: true } } } } } },
            service: { select: { name: true } },
            _count: { select: { servicesResponsable: true } },
          },
          orderBy: { fullName: "asc" },
        });
        const actifs = utilisateurs.filter((u) => u.isActive);
        const comptes: CompteActif[] = actifs.map((u) => ({
          nom: u.fullName,
          email: u.email,
          role: u.role.name,
          rolePermissions: u.role.permissions.map((p) => p.permission.key),
          serviceNom: u.service?.name ?? null,
        }));

        const avecSignature = new Set((await tx.signatureUtilisateur.findMany({ select: { userId: true }, distinct: ["userId"] })).map((s) => s.userId));
        const services = await tx.service.findMany({ select: { name: true, responsable: { select: { fullName: true, isActive: true } } }, orderBy: { name: "asc" } });

        const parametrages: ParametrageLu[] = (
          await tx.budgetParametrage.findMany({ include: { categorie: { select: { label: true } } } })
        ).map((p) => ({
          id: p.id,
          portee: p.portee,
          categorieId: p.categorieId,
          categorieNom: p.categorie?.label ?? null,
          statut: p.statut,
          repris: p.repris,
          decideParId: p.decideParId,
          dateDebut: jourDe(p.dateDebut) as string,
          dateFin: jourDe(p.dateFin),
          decideAt: p.decideAt ? p.decideAt.toISOString() : null,
          seuilOrange: p.seuilOrange === null ? null : Number(p.seuilOrange),
          seuilRouge: p.seuilRouge === null ? null : Number(p.seuilRouge),
        }));

        const regle = await tx.parametreTresorerie.findUnique({ where: { cle: CLE_CATEGORISATION_OBLIGATOIRE_DES } });

        const delegations = await tx.permissionDelegation.findMany({
          where: { estActive: true, permission: { key: PERMISSION_RH } },
          select: { createdAt: true, donneur: { select: { fullName: true } }, beneficiaire: { select: { fullName: true } } },
          orderBy: { createdAt: "asc" },
        });

        const verrou = await tx.reinitialisationSysteme.findFirst({ where: { verrou: "REINITIALISATION" }, select: { effectueeAt: true } });

        const resultat: Point[] = [
          verifierMigrations(attendues, appliquees, nonTerminees),
          verifierRoleFinance(roles),
          verifierRoleDG(roles),
          verifierMinimumComptes("assistants-finance", "Assistants Finance actifs", assistantsFinanceActifs(comptes), 2),
          verifierMinimumComptes("rh-correction", `RH avec ${PERMISSION_RH}`, comptesRHCorrection(comptes), 2),
          verifierServicesDesComptes(comptes),
          verifierResponsablesServices(
            services.map((s) => ({ nom: s.name, responsableNom: s.responsable?.fullName ?? null, responsableActif: s.responsable?.isActive ?? false }))
          ),
          verifierSignatures(
            actifs.map((u) => ({
              nom: u.fullName,
              email: u.email,
              rolePermissions: u.role.permissions.map((p) => p.permission.key),
              responsableDeServices: u._count.servicesResponsable,
              aSignature: avecSignature.has(u.id),
            }))
          ),
          ...verifierPermissionsConges({
            catalogue: cataloguePermissions,
            roles,
            comptes: actifs.map((u) => ({
              nom: u.fullName,
              email: u.email,
              rolePermissions: u.role.permissions.map((p) => p.permission.key),
              responsableDeServices: u._count.servicesResponsable,
            })),
          }),
          verifierSeuilsCaisse(parametrages, jour),
          verifierBudgetsCategories(parametrages, jour),
          verifierDateCategorisation(jourDe(regle?.valeurDate ?? null), jour),
          ...verifierEnvironnement(process.env),
          verifierComptesDeTest(utilisateurs.map((u) => ({ nom: u.fullName, email: u.email, isActive: u.isActive })), final),
          listerDelegationsPointage(
            delegations.map((d) => ({ donneur: d.donneur.fullName, beneficiaire: d.beneficiaire.fullName, depuis: jourDe(d.createdAt) as string }))
          ),
          {
            id: "reinitialisation",
            titre: "Réinitialisation globale",
            verdict: "INFO",
            detail: verrou ? `déjà effectuée le ${jourDe(verrou.effectueeAt)} (verrou actif)` : "pas encore effectuée (verrou libre) — étape 5 du runbook",
          },
        ];
        return resultat;
      },
      { timeout: 60_000, maxWait: 10_000 }
    );

    console.log(`=== Vérification avant mise en service (${final ? "FINALE" : "préparation"}) — ${jour} ===\n`);
    console.log(formaterRapport(points));
    process.exitCode = codeSortie(points);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
