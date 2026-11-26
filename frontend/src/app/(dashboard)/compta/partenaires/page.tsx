import Link from "next/link";
import { redirect } from "next/navigation";

import { AvertissementHonoraires } from "@/components/compta/AvertissementHonoraires";
import { montantCentimesCpt } from "@/components/compta/libellesRemuneration";
import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { chargerRemunerationPartenaireCpt, LIBELLE_NATURE_REMUNERATION_CPT, listerPartenairesRemuneresCpt, NATURES_REMUNERATION_CPT, prisma } from "backend";

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground";
const TD = "px-3 py-2 text-sm tabular-nums align-top";

/**
 * Rémunération des partenaires (lot GC-9) : les QUATRE soldes de chacun, toujours séparés (commission, accessoires reversés,
 * honoraires de gestion, créance). Lecture : `cpt.consulter` (layout, revérifiée ici).
 */
export default async function PartenairesRemunerationPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const partenaires = await listerPartenairesRemuneresCpt(prisma);
  const etats = [];
  for (const p of partenaires) etats.push((await chargerRemunerationPartenaireCpt(prisma, p.id, aujourdhui))!);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="Rémunération des partenaires" description="Commission, accessoires reversés, honoraires de gestion et créance : quatre soldes distincts, jamais compensés automatiquement." />
      <AvertissementHonoraires />
      {etats.length === 0 ? (
        <p data-aucun-partenaire className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Aucun partenaire n&apos;a de convention de rémunération ni de créance. Les conventions se saisissent dans les référentiels.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
          <table className="min-w-full" data-liste-partenaires>
            <thead className="border-b border-border">
              <tr>
                <th className={TH}>Partenaire</th>
                {NATURES_REMUNERATION_CPT.map((n) => (
                  <th key={n} className={TH}>
                    {LIBELLE_NATURE_REMUNERATION_CPT[n]}
                    <span className="block font-normal normal-case">net à verser · reste dû</span>
                  </th>
                ))}
                <th className={TH}>
                  Créance
                  <span className="block font-normal normal-case">ce qu&apos;il doit</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {etats.map((e) => (
                <tr key={e.partenaire.id} data-partenaire={e.partenaire.nom}>
                  <td className={TD}>
                    <Link href={`/compta/partenaires/${e.partenaire.id}`} className="font-semibold text-primary hover:underline">
                      {e.partenaire.nom}
                    </Link>
                  </td>
                  {NATURES_REMUNERATION_CPT.map((n) => (
                    <td key={n} className={TD} data-solde={n}>
                      <strong data-net>{montantCentimesCpt(e.soldes[n].montantReglable)}</strong> · <span data-reste-du>{montantCentimesCpt(e.soldes[n].resteDu)}</span>
                    </td>
                  ))}
                  <td className={TD} data-creance>
                    {e.partenaire.estClient ? montantCentimesCpt(e.creance.resteDu) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Montants en FCFA, calculés à l&apos;affichage d&apos;après les rattachements validés.</p>
    </div>
  );
}
