import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AvertissementHonoraires } from "@/components/compta/AvertissementHonoraires";
import { dateIsoAfficheeCpt, montantCentimesCpt } from "@/components/compta/libellesRemuneration";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { peutVoirRemunerationCpt } from "@/lib/compta/droitsRemuneration";
import { chargerReleveRemunerationCpt, LIBELLE_NATURE_REMUNERATION_CPT, NATURES_REMUNERATION_CPT, prisma, titreMouvementReleveCpt } from "backend";

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground";
const TD = "px-3 py-2 text-sm tabular-nums align-top";
const SECTION = "space-y-3 rounded-xl border border-border bg-card p-4 shadow-elevated";
/** Au-delà, l'écran le dit : l'export CSV / Excel, lui, contient toutes les lignes. */
const LIGNES_ECRAN_MAX = 500;

/** Relevé d'un partenaire pour une nature (lot GC-9g). Mêmes données que les exports et le PDF (`chargerReleveRemunerationCpt`). */
export default async function ReleveRemunerationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nature?: string }> }) {
  const session = await getSession();
  if (!session || !peutVoirRemunerationCpt(session)) redirect("/?error=acces_refuse_compta");
  const { id } = await params;
  const { nature: demandee } = await searchParams;
  const nature = NATURES_REMUNERATION_CPT.find((n) => n === demandee) ?? "COMMISSION";
  const donnees = await chargerReleveRemunerationCpt(prisma, id, nature, new Date().toISOString().slice(0, 10));
  if (!donnees) notFound();
  const { releve, partenaire } = donnees;
  const s = releve.solde;
  const exportUrl = (format: "csv" | "xlsx") => `/api/compta/export/remuneration?partenaire=${id}&nature=${nature}&format=${format}`;
  const bouton = "rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground hover:bg-primary-bg";
  const totaux: [string, string, bigint][] = [
    ["du", "Dû", s.du],
    ["exigible", "Exigible", s.exigible],
    ["payable", "Payable", s.payable],
    ["paye", "Payé", s.paye],
    ["reste-payable", "Net à verser aujourd'hui", s.montantReglable],
    ["reste-du", "Reste dû", s.resteDu],
    ["avance", "Avance", s.avanceNette],
    ["a-regulariser", "À régulariser", s.aRegulariser],
    ...(releve.honoraires
      ? ([
          ["encaissees", "Sur primes encaissées", releve.honoraires.surPrimesEncaissees],
          ["non-encaissees", "Sur primes non encaissées", releve.honoraires.surPrimesNonEncaissees],
        ] as [string, string, bigint][])
      : []),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title={`Relevé — ${partenaire.nom}`} description={`${releve.libelleNature} : échéances, règlements et compensations. Montants en FCFA.`} />
      <p>
        <Link href={`/compta/partenaires/${id}`} className="text-sm font-semibold text-primary hover:underline">
          ← Fiche du partenaire
        </Link>
      </p>
      <AvertissementHonoraires />

      <nav className="flex flex-wrap gap-2" aria-label="Nature du relevé">
        {NATURES_REMUNERATION_CPT.map((n) => (
          <Link
            key={n}
            href={`/compta/partenaires/${id}/releve?nature=${n}`}
            aria-current={n === nature ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${n === nature ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground"}`}
          >
            {LIBELLE_NATURE_REMUNERATION_CPT[n]}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap gap-2">
        <a href={exportUrl("xlsx")} className={bouton} data-export="xlsx">
          Exporter (Excel)
        </a>
        <a href={exportUrl("csv")} className={bouton} data-export="csv">
          Exporter (CSV)
        </a>
        <a href={`/api/compta/partenaires/${id}/releve?nature=${nature}`} className={bouton} data-export="pdf">
          Relevé PDF
        </a>
      </div>

      <section className={SECTION} data-total-releve>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {totaux.map(([cle, libelle, v]) => (
            <div key={cle}>
              <dt className="text-muted-foreground">{libelle}</dt>
              <dd className="text-lg font-black tabular-nums" data-total={cle}>
                {montantCentimesCpt(v)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={SECTION}>
        <h2 className="text-base font-bold text-foreground">Échéances</h2>
        {releve.lignes.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-releve-vide>
            Aucune échéance de cette nature.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full" data-releve-lignes>
              <thead className="border-b border-border">
                <tr>
                  {["Police", "Échéance", "Prévue le", "Client", "Dû", "Exigible", "Payé", "Reste payable", "Reste dû", "Avance", ...(releve.honoraires ? ["Encaissées", "Non encaissées"] : [])].map((t) => (
                    <th key={t} className={TH}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {releve.lignes.slice(0, LIGNES_ECRAN_MAX).map((l) => (
                  <tr key={l.cle} data-releve-ligne={`${l.numPolice}-${l.rang}`}>
                    <td className={`${TD} whitespace-nowrap`}>{l.numPolice}</td>
                    <td className={TD}>{l.rang}</td>
                    <td className={TD}>{dateIsoAfficheeCpt(l.datePrevue)}</td>
                    <td className={TD}>{l.clientNom}</td>
                    {[l.du, l.exigible, l.paye, l.restePayable, l.resteDu, l.avance, ...(releve.honoraires ? [l.surPrimesEncaissees!, l.surPrimesNonEncaissees!] : [])].map((v, i) => (
                      <td key={i} className={TD}>
                        {montantCentimesCpt(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {releve.lignes.length > LIGNES_ECRAN_MAX && (
          <p className="text-sm text-muted-foreground">
            {LIGNES_ECRAN_MAX} échéances affichées sur {releve.lignes.length} : l&apos;export contient toutes les lignes.
          </p>
        )}
      </section>

      <section className={SECTION}>
        <h2 className="text-base font-bold text-foreground">Règlements et compensations</h2>
        {releve.mouvements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun mouvement.</p>
        ) : (
          <ul className="divide-y divide-border text-sm" data-releve-mouvements>
            {releve.mouvements.map((m, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2" data-mouvement={m.type}>
                <span>
                  {dateIsoAfficheeCpt(m.date)} · {titreMouvementReleveCpt(m)}
                  <span className="block text-xs text-muted-foreground">{m.detail}</span>
                </span>
                <strong className="tabular-nums" data-montant-mouvement>
                  {montantCentimesCpt(m.montant)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
