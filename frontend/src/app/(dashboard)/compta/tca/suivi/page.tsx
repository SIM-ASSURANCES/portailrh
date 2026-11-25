import Link from "next/link";
import { redirect } from "next/navigation";

import { AvertissementTaxe, OngletsTaxe } from "@/components/compta/AvertissementTaxe";
import { PaginationCpt } from "@/components/compta/Pagination";
import { formaterMontantCpt } from "@/components/compta/libellesProduction";
import { Badge, Button, Input, PageHeader, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { chargerAvancesNonImputeesCpt, chargerSuiviTaxeCpt, LIBELLE_ETAT_SUIVI_TAXE_CPT, pageDemandeeCpt, prisma, type EtatSuiviTaxeCpt } from "backend";

const montant = (centimes: bigint) => formaterMontantCpt(Number(centimes) / 100);
const MOIS = /^\d{4}-\d{2}$/;
const TH = "px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground";
const TD = "px-3 py-2 text-right text-sm tabular-nums";
const VARIANTE: Record<EtatSuiviTaxeCpt, "neutral" | "warning" | "info" | "success"> = { NON_EXIGIBLE: "neutral", A_DECLARER: "warning", DECLAREE: "info", PAYEE: "success" };

function moisDemande(brut: string | undefined, maintenant: Date): string {
  if (brut && MOIS.test(brut)) return `${brut}-01`;
  const annee = maintenant.getUTCFullYear();
  const m = maintenant.getUTCMonth() + 1;
  return m === 1 ? `${annee - 1}-12-01` : `${annee}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * Suivi de la taxe par contrat et par mois (lot GC-8f) : émise, exigible, payée d'avance et imputée, déclarée, payée. `cpt.consulter`,
 * lecture seule. L'état d'une ligne se déduit des montants, jamais saisi.
 */
export default async function SuiviTaxePage({ searchParams }: { searchParams: Promise<{ mois?: string; q?: string; page?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");
  const recherche = await searchParams;
  const mois = moisDemande(recherche.mois, new Date());
  const q = (recherche.q ?? "").trim().slice(0, 60);
  const [suivi, avances] = await Promise.all([chargerSuiviTaxeCpt(prisma, { mois, q, page: pageDemandeeCpt(recherche.page) }), chargerAvancesNonImputeesCpt(prisma)]);
  const lien = (page: number) => `/compta/tca/suivi?${new URLSearchParams({ mois: mois.slice(0, 7), ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) }).toString()}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="Suivi de la taxe par contrat" description="Pour chaque contrat et chaque mois : la taxe émise, devenue exigible, payée d'avance et imputée, déclarée et payée." />
      <AvertissementTaxe />
      <OngletsTaxe actif="suivi" mois={mois} />

      <section className="grid gap-4 sm:grid-cols-2" data-avances-non-imputees>
        <StatCard
          icon="scroll-text"
          label="Taxe payée d'avance non encore imputée"
          value={`${formaterMontantCpt(Number(avances.montant) / 100)} FCFA`}
          hint={`${avances.nbAvances} encaissement(s) taxé(s) avant leur rattachement, taxe déjà déclarée`}
          tone={avances.montant > BigInt(0) ? "warning" : "success"}
        />
      </section>

      <form method="get" className="flex flex-wrap items-end gap-3" data-filtres-suivi>
        <div className="w-full sm:w-56">
          <Input name="mois" label="Mois" type="month" defaultValue={mois.slice(0, 7)} />
        </div>
        <div className="w-full sm:w-64">
          <Input name="q" label="Numéro de police" defaultValue={q} placeholder="POL-…" />
        </div>
        <Button type="submit" variant="secondary">
          Filtrer
        </Button>
      </form>

      {suivi.lignes.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-suivi-vide>
          Aucun contrat concerné par la taxe ce mois-ci.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated" data-suivi-taxe>
          <table className="min-w-full divide-y divide-border">
            <thead>
              <tr>
                <th className={`${TH} text-left`}>Contrat</th>
                <th className={TH}>Émise</th>
                <th className={TH}>Exigible</th>
                <th className={TH}>Payée d&apos;avance (imputée)</th>
                <th className={TH}>À déclarer</th>
                <th className={TH}>Déclarée</th>
                <th className={TH}>Payée</th>
                <th className={`${TH} text-left`}>État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {suivi.lignes.map((l) => (
                <tr key={l.contratId} data-suivi-contrat={l.numPolice} data-etat-suivi={l.etat}>
                  <td className={`${TD} text-left`}>
                    <span className="font-semibold">{l.numPolice}</span>
                    <span className="block text-xs text-muted-foreground">{l.clientNom}</span>
                  </td>
                  <td className={TD} data-emise>{montant(l.taxeEmise)}</td>
                  <td className={TD} data-exigible>{montant(l.taxeExigible)}</td>
                  <td className={TD} data-imputee>{montant(l.taxeImputee)}</td>
                  <td className={TD} data-nette>{montant(l.taxeNette)}</td>
                  <td className={TD} data-declaree>{montant(l.taxeDeclaree)}</td>
                  <td className={TD} data-payee>{montant(l.taxePayee)}</td>
                  <td className={`${TD} text-left`}>
                    <Badge variant={VARIANTE[l.etat]}>{LIBELLE_ETAT_SUIVI_TAXE_CPT[l.etat]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaginationCpt nom="contrat(s)" page={suivi.page} nbPages={suivi.nbPages} total={suivi.total} precedent={suivi.page > 1 ? lien(suivi.page - 1) : null} suivant={suivi.page < suivi.nbPages ? lien(suivi.page + 1) : null} />
      <p className="text-sm text-muted-foreground">
        Exigible = taxe de l&apos;échéance devenue due par un rattachement validé du mois. « Payée d&apos;avance (imputée) » = part déjà déclarée au titre d&apos;un encaissement taxé avant son rattachement : elle n&apos;est jamais redemandée. Une avance non rattachée à un contrat n&apos;apparaît ici qu&apos;au rattachement ; voir{" "}
        <Link href="/compta/tca" className="font-semibold text-primary hover:underline">
          le calcul du mois
        </Link>
        .
      </p>
    </div>
  );
}
