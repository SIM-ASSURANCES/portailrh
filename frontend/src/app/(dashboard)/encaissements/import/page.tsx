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

  // Branches lues dans la colonne du fichier : enregistrées sur l'import (`branchesFichier`, codes). Repli, SEULEMENT
  // pour les imports antérieurs à cette colonne (vide) : reconstitution depuis les signalements et les contrats créés.
  const codesFichier = (i: (typeof imports)[number]): string[] | null =>
    Array.isArray(i.branchesFichier) ? i.branchesFichier.filter((c): c is string => typeof c === "string") : null;
  const idsRepli = imports.filter((i) => !i.brancheParDefaut && codesFichier(i) === null).map((i) => i.id);
  const codesUtiles = [...new Set(imports.flatMap((i) => codesFichier(i) ?? []))];

  const branchesConnues = codesUtiles.length
    ? await prisma.encBranche.findMany({ where: { code: { in: codesUtiles } }, select: { code: true, libelle: true } })
    : [];
  const libelleDuCode = new Map(branchesConnues.map((b) => [b.code, b.libelle]));

  const repli = new Map<string, Set<string>>();
  if (idsRepli.length > 0) {
    const [sigs, contrats] = await Promise.all([
      prisma.encSignalement.findMany({
        where: { importId: { in: idsRepli }, brancheId: { not: null } },
        distinct: ["importId", "brancheId"],
        select: { importId: true, branche: { select: { libelle: true } } },
      }),
      prisma.encContrat.findMany({
        where: { creeParImportId: { in: idsRepli } },
        distinct: ["creeParImportId", "brancheId"],
        select: { creeParImportId: true, branche: { select: { libelle: true } } },
      }),
    ]);
    const ajouter = (importId: string, libelle: string | undefined) => {
      if (!libelle) return;
      if (!repli.has(importId)) repli.set(importId, new Set());
      repli.get(importId)!.add(libelle);
    };
    sigs.forEach((s) => ajouter(s.importId, s.branche?.libelle));
    contrats.forEach((c) => ajouter(c.creeParImportId, c.branche.libelle));
  }

  const libelleBranche = (i: (typeof imports)[number]) => {
    if (i.brancheParDefaut) return i.brancheParDefaut.libelle;
    const codes = codesFichier(i);
    const noms = codes ? codes.map((c) => libelleDuCode.get(c) ?? c) : [...(repli.get(i.id) ?? [])];
    noms.sort((a, b) => a.localeCompare(b, "fr"));
    return `${noms.length ? noms.join(", ") : "—"} (colonne du fichier)`;
  };

  const rows: HistoriqueImportRow[] = imports.map((i) => ({
    id: i.id,
    importeAt: i.importeAt.toISOString(),
    importeAtLabel: formatDateHeure(i.importeAt),
    auteur: i.importePar.fullName,
    nomFichier: i.nomFichier,
    branche: libelleBranche(i),
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
