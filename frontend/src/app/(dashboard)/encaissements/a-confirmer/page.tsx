import Link from "next/link";
import { redirect } from "next/navigation";

import { formatDateCourte, formatDateHeure, formatFcfa, libelleMode, libelleSource, OPTIONS_MODE } from "@/components/encaissements/libelles";
import { Button, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { clauseFiltres, lireFiltres, versRecherche } from "@/lib/encaissements/filtresAConfirmer";
import { calculerSituationContrat, prisma } from "backend";

import { PaiementsAConfirmer, type PaiementAConfirmerRow } from "./PaiementsAConfirmer";

const PAR_PAGE = 50;
type Params = Record<string, string | string[] | undefined>;

/**
 * Confirmation des paiements (F5, commit 6b) : paiements « à confirmer » (ou « non reçus »), plus anciens d'abord,
 * 50 par page ; filtres période, mode, partenaire, branche, recherche ; nombre et total. « Reçu », « Non reçu »
 * (motif obligatoire), « Finalement reçu », ligne par ligne ou par lot. Réservé à `enc.confirmer_paiement`.
 */
export default async function AConfirmerPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.confirmer_paiement")) {
    redirect("/encaissements?error=acces_refuse_confirmation");
  }
  const sp = await searchParams;
  const filtres = lireFiltres(sp);
  const page = Math.max(1, Number.parseInt(String(Array.isArray(sp.page) ? sp.page[0] : (sp.page ?? "")), 10) || 1);

  const where = await clauseFiltres(filtres);
  const [branches, partenaires, agregat, paiements] = await Promise.all([
    prisma.encBranche.findMany({ orderBy: { code: "asc" }, select: { id: true, libelle: true } }),
    prisma.encPartenaire.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    where ? prisma.encEncaissement.aggregate({ where, _count: { _all: true }, _sum: { Z: true } }) : null,
    where
      ? prisma.encEncaissement.findMany({
          where,
          orderBy: [{ datePaiement: "asc" }, { paiementId: "asc" }],
          skip: (page - 1) * PAR_PAGE,
          take: PAR_PAGE,
          select: {
            id: true,
            paiementId: true,
            datePaiement: true,
            mode: true,
            reference: true,
            Z: true,
            source: true,
            motifNonReception: true,
            nonRecuAt: true,
            nonRecuPar: { select: { fullName: true } },
            contrat: { select: { id: true, numPolice: true, clientNom: true, S: true, partenaire: { select: { nom: true } } } },
            branche: { select: { libelle: true } },
          },
        })
      : [],
  ]);
  const total = agregat?._count._all ?? 0;
  const nbPages = Math.max(1, Math.ceil(total / PAR_PAGE));

  // Reste dû actuel de chaque police (paiements confirmés seulement) : signale à l'avance un trop-perçu possible.
  const contratIds = [...new Set(paiements.map((p) => p.contrat.id))];
  const sommes = contratIds.length
    ? await prisma.encEncaissement.groupBy({ by: ["contratId"], where: { contratId: { in: contratIds }, statut: "CONFIRME" }, _sum: { Z: true } })
    : [];
  const encaisse = new Map(sommes.map((s) => [s.contratId, s._sum.Z?.toString() ?? "0"]));

  const rows: PaiementAConfirmerRow[] = paiements.map((p) => {
    const situation = calculerSituationContrat(p.contrat.S.toString(), [encaisse.get(p.contrat.id) ?? "0"]);
    return {
      id: p.id,
      paiementId: p.paiementId,
      contratId: p.contrat.id,
      numPolice: p.contrat.numPolice,
      client: p.contrat.clientNom,
      partenaire: p.contrat.partenaire?.nom ?? null,
      branche: p.branche.libelle,
      datePaiement: formatDateCourte(p.datePaiement),
      mode: libelleMode(p.mode),
      reference: p.reference,
      montant: p.Z.toString(),
      montantAffiche: formatFcfa(p.Z.toString()),
      resteDu: formatFcfa(situation.resteDu.toFixed(2)),
      tropPercuPossible: p.Z.toNumber() > situation.resteDu.toNumber(),
      source: libelleSource(p.source),
      nonRecu: p.motifNonReception
        ? { motif: p.motifNonReception, par: p.nonRecuPar?.fullName ?? "—", le: p.nonRecuAt ? formatDateHeure(p.nonRecuAt) : "—" }
        : null,
    };
  });

  const recherche = versRecherche(filtres);
  const lienPage = (n: number) => {
    const q = new URLSearchParams(recherche);
    if (n > 1) q.set("page", String(n));
    const s = q.toString();
    return s ? `/encaissements/a-confirmer?${s}` : "/encaissements/a-confirmer";
  };
  const exportNonRecus = `/api/encaissements/non-recus/export${versRecherche(filtres, true).size ? `?${versRecherche(filtres, true)}` : ""}`;
  const filtreActif = recherche.toString() !== "";
  const nonRecus = filtres.statut === "NON_RECU";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Confirmation des paiements"
        description="Paiements du fichier de production à confirmer d'après les relevés : « Reçu » fige les montants (taxe, commission, honoraires) ; « Non reçu » ne compte rien."
        backHref="/encaissements"
        backLabel="Encaissements"
        actions={
          nonRecus ? (
            <a href={exportNonRecus}>
              <Button type="button" variant="secondary">
                Exporter les non reçus (Excel)
              </Button>
            </a>
          ) : undefined
        }
      />

      <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          name="statut"
          label="Statut"
          defaultValue={filtres.statut}
          options={[
            { value: "A_CONFIRMER", label: "À confirmer" },
            { value: "NON_RECU", label: "Non reçus" },
          ]}
        />
        <Input name="du" type="date" label="Payé du" defaultValue={filtres.du} />
        <Input name="au" type="date" label="au" defaultValue={filtres.au} />
        <Select name="mode" label="Mode" defaultValue={filtres.mode} options={[{ value: "", label: "Tous les modes" }, ...OPTIONS_MODE]} />
        <Select
          name="partenaire"
          label="Partenaire"
          defaultValue={filtres.partenaire}
          options={[{ value: "", label: "Tous les partenaires" }, ...partenaires.map((p) => ({ value: p.id, label: p.nom }))]}
        />
        <Select
          name="branche"
          label="Branche"
          defaultValue={filtres.branche}
          options={[{ value: "", label: "Toutes les branches" }, ...branches.map((b) => ({ value: b.id, label: b.libelle }))]}
        />
        <Input name="q" label="Recherche" placeholder="N° de police, client, référence…" defaultValue={filtres.q} />
        <div className="flex items-end gap-3">
          <Button type="submit" variant="secondary">
            Filtrer
          </Button>
          {filtreActif ? (
            <Link href="/encaissements/a-confirmer" className="pb-2 text-sm text-primary hover:underline">
              Effacer
            </Link>
          ) : null}
        </div>
      </form>

      <p data-totaux className="text-sm text-foreground">
        <span className="font-bold tabular-nums">{total.toLocaleString("fr-FR")}</span> paiement(s) {nonRecus ? "non reçu(s)" : "à confirmer"} — total{" "}
        <span className="font-bold tabular-nums">{formatFcfa(agregat?._sum.Z?.toString() ?? "0")}</span>
        {nbPages > 1 ? ` — page ${page} sur ${nbPages}, plus anciens d'abord.` : "."}
      </p>

      {rows.length === 0 ? (
        <EmptyState icon="circle-check" message={filtreActif ? "Aucun paiement pour ces filtres." : nonRecus ? "Aucun paiement non reçu." : "Aucun paiement à confirmer."} />
      ) : (
        <>
          <PaiementsAConfirmer rows={rows} statut={filtres.statut} />
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
