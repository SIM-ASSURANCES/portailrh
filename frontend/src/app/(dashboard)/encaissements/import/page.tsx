import { redirect } from "next/navigation";

import { formatDateHeure } from "@/components/encaissements/libelles";
import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { HistoriqueImportsTable, type HistoriqueImportRow } from "./HistoriqueImportsTable";
import { ImportProductionForm } from "./ImportProductionForm";

/**
 * Import mensuel du fichier de production (CDC F1, commit 4d) : formulaire (Finance et Équipe technique,
 * `enc.importer_production`) et historique des imports (tout profil du module, `enc.consulter`).
 */
export default async function ImportProductionPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }
  const peutImporter = hasPermission(session, "enc.importer_production");

  const [branches, imports] = await Promise.all([
    peutImporter
      ? prisma.encBranche.findMany({ where: { actif: true }, select: { code: true, libelle: true }, orderBy: { libelle: "asc" } })
      : Promise.resolve([]),
    prisma.encImport.findMany({
      where: { type: "PRODUCTION" },
      orderBy: { importeAt: "desc" },
      take: 50,
      include: {
        importePar: { select: { fullName: true } },
        brancheParDefaut: { select: { libelle: true } },
      },
    }),
  ]);

  const rows: HistoriqueImportRow[] = imports.map((i) => ({
    id: i.id,
    importeAt: i.importeAt.toISOString(),
    importeAtLabel: formatDateHeure(i.importeAt),
    auteur: i.importePar.fullName,
    nomFichier: i.nomFichier,
    branche: i.brancheParDefaut?.libelle ?? "Colonne du fichier",
    nbLignes: i.nbLignes,
    nbContratsCrees: i.nbContratsCrees,
    nbContratsMaj: i.nbContratsMaj,
    nbPaiementsAConfirmer: i.nbPaiementsAConfirmer,
    nbATraiter: i.nbATraiter,
    totalPrimesTtc: i.totalPrimesTtc?.toString() ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Import du fichier de production"
        description="Contrats et paiements « à confirmer » issus du fichier mensuel de l'équipe technique."
        backHref="/encaissements"
        backLabel="Encaissements"
      />

      {peutImporter && (
        <ImportProductionForm branches={branches} peutGererBranches={hasPermission(session, "enc.parametrer")} />
      )}

      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground">Historique des imports</h2>
        <HistoriqueImportsTable rows={rows} />
      </section>
    </div>
  );
}
