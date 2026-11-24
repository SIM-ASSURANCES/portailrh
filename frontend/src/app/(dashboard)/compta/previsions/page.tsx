import Link from "next/link";
import { redirect } from "next/navigation";

import { formaterDateCpt, formaterMontantCpt } from "@/components/compta/libellesProduction";
import { Badge, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { chargerPrevisionCpt, jourTexteCpt, prisma, type GranulariteCpt } from "backend";

const montant = (centimes: bigint) => formaterMontantCpt(Number(centimes) / 100);
const TH = "px-3 py-2";

/**
 * Prévision d'encaissements (lot GC-7e) : par semaine ou par mois, ce qui est PRÉVU (échéances), ce qu'il en reste à encaisser, et ce qui est
 * ENCAISSÉ (rattachements validés, par date de valeur). Mêmes sources que l'état des créances (`chargerPrevisionCpt`). Lecture seule, `cpt.consulter`.
 */
export default async function PrevisionsPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");
  const { vue } = await searchParams;
  const granularite: GranulariteCpt = vue === "mois" ? "MOIS" : "SEMAINE";
  const aujourdhui = jourTexteCpt(new Date());
  const lignes = await chargerPrevisionCpt(prisma, granularite, aujourdhui);
  const max = lignes.reduce((m, l) => (l.prevu > m ? l.prevu : l.reel > m ? l.reel : m), BigInt(1));
  const pct = (v: bigint) => `${Math.min(100, Math.round((Number(v) / Number(max)) * 100))}%`;
  const totalPrevu = lignes.reduce((s, l) => s + l.prevu, BigInt(0));
  const totalReel = lignes.reduce((s, l) => s + l.reel, BigInt(0));
  const onglet = (actif: boolean) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${actif ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:bg-muted/40"}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="Prévision d'encaissements" description="Ce qui est attendu par période (échéances) comparé à ce qui est réellement encaissé et prouvé (rattachements validés)." />
      <nav className="flex gap-2" data-vues-prevision>
        <Link href="/compta/previsions" className={onglet(granularite === "SEMAINE")} data-vue="semaine">
          Par semaine
        </Link>
        <Link href="/compta/previsions?vue=mois" className={onglet(granularite === "MOIS")} data-vue="mois">
          Par mois
        </Link>
      </nav>
      <p className="text-sm text-muted-foreground">
        <strong>Prévu</strong> : montants dus des échéances dont la date prévue tombe dans la période. <strong>Reste à encaisser</strong> : ce qu&apos;il en reste à payer. <strong>Encaissé</strong> :
        paiements prouvés dont la date de valeur tombe dans la période, y compris le paiement d&apos;un retard. <strong>Promesses</strong> : montants promis en cours (déjà compris dans le
        prévu, jamais ajoutés).
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated" data-prevision={granularite}>
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className={TH}>Période</th>
              <th className={`${TH} text-right`}>Prévu</th>
              <th className={`${TH} text-right`}>Reste à encaisser</th>
              <th className={`${TH} text-right`}>Encaissé (prouvé)</th>
              <th className={`${TH} text-right`}>Promesses en cours</th>
              <th className={TH}>Prévu / encaissé</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.debut} className="border-b border-border last:border-0" data-periode={l.debut} data-position={l.position}>
                <td className="whitespace-nowrap px-3 py-2 font-semibold">
                  {l.libelle}
                  {l.position === "COURANTE" && (
                    <span className="ml-2">
                      <Badge variant="info">En cours</Badge>
                    </span>
                  )}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {formaterDateCpt(new Date(`${l.debut}T00:00:00Z`))} – {formaterDateCpt(new Date(`${l.fin}T00:00:00Z`))}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums" data-prevu>
                  {montant(l.prevu)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums" data-reste>
                  {l.position === "PASSEE" && l.resteAEncaisser > BigInt(0) ? <span className="font-semibold text-danger">{montant(l.resteAEncaisser)} en retard</span> : montant(l.resteAEncaisser)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums" data-reel>
                  {l.position === "FUTURE" ? "—" : montant(l.reel)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums" data-promesses>
                  {montant(l.promesses)}
                </td>
                <td className="w-48 px-3 py-2">
                  <div className="h-2 rounded bg-muted" title="Prévu">
                    <div className="h-2 rounded bg-primary/40" style={{ width: pct(l.prevu) }} />
                  </div>
                  <div className="mt-1 h-2 rounded bg-muted" title="Encaissé">
                    <div className="h-2 rounded bg-success" style={{ width: l.position === "FUTURE" ? "0%" : pct(l.reel) }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/40 text-sm font-semibold">
            <tr>
              <td className={TH}>Total affiché</td>
              <td className={`${TH} text-right tabular-nums`} data-total-prevu>
                {montant(totalPrevu)}
              </td>
              <td className={TH} />
              <td className={`${TH} text-right tabular-nums`} data-total-reel>
                {montant(totalReel)}
              </td>
              <td className={TH} colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
