import { redirect } from "next/navigation";

import { AvertissementTaxe, OngletsTaxe } from "@/components/compta/AvertissementTaxe";
import { formaterMontantCpt } from "@/components/compta/libellesProduction";
import { Badge, Input, Button, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { chargerEtatParTauxCpt, LIBELLE_PRIMES_REMBOURSEES_CPT, prisma } from "backend";

const montant = (centimes: bigint) => formaterMontantCpt(Number(centimes) / 100);
const MOIS = /^\d{4}-\d{2}$/;
const TH = "px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground";
const TD = "px-3 py-2 text-right text-sm tabular-nums";

function moisDemande(brut: string | undefined, maintenant: Date): string {
  if (brut && MOIS.test(brut)) return `${brut}-01`;
  const annee = maintenant.getUTCFullYear();
  const m = maintenant.getUTCMonth() + 1;
  return m === 1 ? `${annee - 1}-12-01` : `${annee}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * État de déclaration par taux (lot GC-8e) : de quoi remplir le formulaire de l'administration. Les montants viennent des lignes de taxe du mois
 * (`etatParTauxCpt`), les mêmes que l'export. `cpt.consulter`, lecture seule.
 */
export default async function EtatParTauxPage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");
  const mois = moisDemande((await searchParams).mois, new Date());
  const e = await chargerEtatParTauxCpt(prisma, mois);
  const exporter = (format: "csv" | "xlsx") => `/api/compta/export/tca?mois=${mois.slice(0, 7)}&format=${format}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="État de déclaration par taux" description="Primes et accessoires encaissés hors taxe, base d'imposition et impôt, à reporter sur le formulaire de l'administration." />
      <AvertissementTaxe />
      <OngletsTaxe actif="etat" mois={mois} />

      <form method="get" className="flex flex-wrap items-end gap-3" data-choix-mois>
        <div className="w-full sm:w-56">
          <Input name="mois" label="Mois" type="month" defaultValue={mois.slice(0, 7)} />
        </div>
        <Button type="submit" variant="secondary">
          Afficher
        </Button>
        {e.declaration && (
          <p className="text-sm text-muted-foreground" data-etat-declaration>
            Déclaration <strong>{e.declaration.reference}</strong> · <Badge variant={e.declaration.statut === "PAYEE" ? "success" : "warning"}>{e.declaration.statut === "PAYEE" ? "Payée" : "À payer"}</Badge>
          </p>
        )}
      </form>
      {!e.declaration && <p className="text-sm text-muted-foreground" data-etat-provisoire>Ce mois n&apos;est pas encore déclaré : l&apos;état peut encore changer.</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated" data-etat-par-taux>
        <table className="min-w-full divide-y divide-border">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Taux</th>
              <th className={TH}>Primes hors taxe</th>
              <th className={TH}>Accessoires hors taxe</th>
              <th className={TH}>Primes remboursées</th>
              <th className={TH}>Base d&apos;imposition</th>
              <th className={TH}>Impôt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {e.etat.lignes.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground" data-etat-vide>
                  Aucune ligne de taxe pour ce mois.
                </td>
              </tr>
            ) : (
              e.etat.lignes.map((l) => (
                <tr key={l.taux} data-taux={l.libelleTaux}>
                  <td className={`${TD} text-left font-semibold`}>{l.libelleTaux}</td>
                  <td className={TD} data-primes>{montant(l.primesHt)}</td>
                  <td className={TD} data-accessoires>{montant(l.accessoiresHt)}</td>
                  <td className={`${TD} text-muted-foreground`} data-remboursees>{LIBELLE_PRIMES_REMBOURSEES_CPT}</td>
                  <td className={TD} data-base>{montant(l.baseImposition)}</td>
                  <td className={`${TD} font-bold`} data-impot>{montant(l.impot)}</td>
                </tr>
              ))
            )}
          </tbody>
          {e.etat.lignes.length > 0 && (
            <tfoot>
              <tr className="bg-muted/40 font-bold" data-etat-total>
                <td className={`${TD} text-left`}>Total</td>
                <td className={TD}>{montant(e.etat.total.primesHt)}</td>
                <td className={TD}>{montant(e.etat.total.accessoiresHt)}</td>
                <td className={`${TD} text-muted-foreground`}>{LIBELLE_PRIMES_REMBOURSEES_CPT}</td>
                <td className={TD}>{montant(e.etat.total.baseImposition)}</td>
                <td className={TD} data-impot-total>{montant(e.etat.total.impot)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Base d&apos;imposition = primes + accessoires hors taxe. L&apos;impôt est la somme des lignes de taxe du taux (la taxe de chaque ligne est arrondie à l&apos;unité : il peut différer de quelques FCFA du produit base × taux). Les primes remboursées ne sont pas calculées : question Q15 en attente.
      </p>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-elevated" data-credits-part>
        <h2 className="text-base font-bold text-foreground">Crédits (à part)</h2>
        <p className="text-sm tabular-nums">
          Trop-payé né de ce mois : <strong data-credit-mois>{montant(e.creditsDuMois)} FCFA</strong> · Crédits encore à récupérer : <strong data-credit-ouvert>{montant(e.creditsAReporter)} FCFA</strong>
        </p>
      </section>

      <p className="flex gap-4 text-sm font-semibold">
        <a href={exporter("csv")} className="text-primary hover:underline" data-export-csv>
          Exporter (CSV)
        </a>
        <a href={exporter("xlsx")} className="text-primary hover:underline" data-export-xlsx>
          Exporter (Excel)
        </a>
      </p>
    </div>
  );
}
