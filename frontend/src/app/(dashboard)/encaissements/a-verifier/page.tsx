import Link from "next/link";
import { redirect } from "next/navigation";

import { formatDateHeure, libelleAnalyse, paiementLisible } from "@/components/encaissements/libelles";
import { Button, EmptyState, PageHeader, Select } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { EncAnalyseSignalement, prisma, type Prisma } from "backend";

import { SignalementsATraiterTable, type SignalementATraiterRow } from "./SignalementsATraiterTable";

const PAR_PAGE = 50;
const TYPES_VALIDES = new Set<string>(Object.values(EncAnalyseSignalement));

type Params = { branche?: string | string[]; type?: string | string[]; page?: string | string[] };
const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Onglet « À vérifier » (commit 5b) : signalements À TRAITER de tous les imports, plus anciens d'abord, 50 par page,
 * filtres branche et type (GET). Lecture pour `enc.consulter` ; « Marquer traité » pour `enc.confirmer_paiement`
 * seulement (bouton absent sinon, action revérifiée côté serveur).
 */
export default async function AVerifierPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }
  const peutTraiter = hasPermission(session, "enc.confirmer_paiement");

  const sp = await searchParams;
  const brancheId = premier(sp.branche);
  const type = premier(sp.type);
  const typeFiltre = TYPES_VALIDES.has(type) ? (type as EncAnalyseSignalement) : null;
  const page = Math.max(1, Number.parseInt(premier(sp.page), 10) || 1);

  const where: Prisma.EncSignalementWhereInput = {
    statut: "A_TRAITER",
    ...(brancheId ? { brancheId } : {}),
    ...(typeFiltre ? { analyse: typeFiltre } : {}),
  };

  const [branches, parType, total, signalements] = await Promise.all([
    prisma.encBranche.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, libelle: true } }),
    prisma.encSignalement.groupBy({ by: ["analyse"], where: { statut: "A_TRAITER" }, _count: { _all: true } }),
    prisma.encSignalement.count({ where }),
    prisma.encSignalement.findMany({
      where,
      orderBy: [{ creeAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAR_PAGE,
      take: PAR_PAGE,
      select: {
        id: true,
        numPolice: true,
        contratId: true,
        analyse: true,
        detail: true,
        paiementIndique: true,
        branche: { select: { libelle: true } },
        import: { select: { id: true, importeAt: true } },
      },
    }),
  ]);

  const totalTous = parType.reduce((s, g) => s + g._count._all, 0);
  const nbPages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const rows: SignalementATraiterRow[] = signalements.map((s) => ({
    id: s.id,
    numPolice: s.numPolice,
    contratId: s.contratId,
    analyse: s.analyse,
    branche: s.branche?.libelle ?? null,
    paiement: paiementLisible(s.paiementIndique),
    detail: s.detail,
    importId: s.import.id,
    importLabel: formatDateHeure(s.import.importeAt),
  }));

  const lienPage = (p: number) => {
    const q = new URLSearchParams();
    if (brancheId) q.set("branche", brancheId);
    if (typeFiltre) q.set("type", typeFiltre);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/encaissements/a-verifier?${s}` : "/encaissements/a-verifier";
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="À vérifier"
        description={`Signalements d'import à traiter, tous imports confondus — ${totalTous.toLocaleString("fr-FR")} au total.${
          peutTraiter ? "" : " Consultation en lecture seule."
        }`}
        backHref="/encaissements"
        backLabel="Encaissements"
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            name="branche"
            label="Branche"
            defaultValue={brancheId}
            options={[{ value: "", label: "Toutes les branches" }, ...branches.map((b) => ({ value: b.id, label: b.libelle }))]}
          />
        </div>
        <div className="w-72">
          <Select
            name="type"
            label="Type"
            defaultValue={typeFiltre ?? ""}
            options={[
              { value: "", label: "Tous les types" },
              ...parType
                .sort((a, b) => b._count._all - a._count._all)
                .map((g) => ({ value: g.analyse, label: `${libelleAnalyse(g.analyse)} (${g._count._all.toLocaleString("fr-FR")})` })),
            ]}
          />
        </div>
        <Button type="submit" variant="secondary">
          Filtrer
        </Button>
        {brancheId || typeFiltre ? (
          <Link href="/encaissements/a-verifier" className="pb-2 text-sm text-primary hover:underline">
            Effacer les filtres
          </Link>
        ) : null}
      </form>

      {total === 0 ? (
        <EmptyState icon="circle-check" message={totalTous === 0 ? "Aucun signalement à traiter." : "Aucun signalement à traiter pour ces filtres."} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString("fr-FR")} signalement(s) — page {page} sur {nbPages}, plus anciens d&apos;abord.
          </p>
          <SignalementsATraiterTable rows={rows} peutTraiter={peutTraiter} />
          {nbPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={lienPage(page - 1)} className="text-primary hover:underline">
                  ← Page précédente
                </Link>
              ) : (
                <span />
              )}
              {page < nbPages ? (
                <Link href={lienPage(page + 1)} className="text-primary hover:underline">
                  Page suivante →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
