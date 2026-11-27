import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AvertissementHonoraires } from "@/components/compta/AvertissementHonoraires";
import { formaterDateCpt, formaterDateHeureCpt, formaterMontantCpt } from "@/components/compta/libellesProduction";
import { dateIsoAfficheeCpt, montantCentimesCpt } from "@/components/compta/libellesRemuneration";
import { PaginationCpt } from "@/components/compta/Pagination";
import { Badge, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { peutVoirRemunerationCpt } from "@/lib/compta/droitsRemuneration";
import {
  chargerOperationsRemunerationCpt,
  chargerRemunerationPartenaireCpt,
  LIBELLE_FAIT_GENERATEUR_CPT,
  LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT,
  LIBELLE_MODE_REGLEMENT_CPT,
  LIBELLE_NATURE_REMUNERATION_CPT,
  LIBELLE_TRANCHE_CREANCE_CPT,
  NATURES_REMUNERATION_CPT,
  prisma,
  raisonBlocageAnnulationCpt,
  type NatureRemunerationCpt,
  type TypeOperationRemunerationCpt,
  type SoldeNatureCpt,
} from "backend";

import { AnnulationOperation, CompensationForm, DecisionModeForm, ReglementPartenaireForm } from "../FormulairesRemuneration";

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground";
const TD = "px-3 py-2 text-sm tabular-nums align-top";
const SECTION = "space-y-3 rounded-xl border border-border bg-card p-4 shadow-elevated";
const PAR_PAGE = 50;

function CarteSolde({ solde }: { solde: SoldeNatureCpt }) {
  const lignes: [string, string, bigint][] = [
    ["du", "Dû", solde.du],
    ["exigible", "Exigible", solde.exigible],
    ["payable", "Payable", solde.payable],
    ["paye", "Payé", solde.paye],
    ["reste-payable", "Net à verser aujourd'hui", solde.montantReglable],
    ["reste-du", "Reste dû", solde.resteDu],
    ["avance", "Avance", solde.avanceNette],
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-elevated" data-carte-solde={solde.nature}>
      <h2 className="text-sm font-bold text-foreground">{LIBELLE_NATURE_REMUNERATION_CPT[solde.nature]}</h2>
      <dl className="mt-2 space-y-1 text-sm">
        {lignes.map(([cle, libelle, valeur]) => (
          <div key={cle} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{libelle}</dt>
            <dd className={`tabular-nums ${cle === "reste-payable" ? "text-base font-black text-foreground" : "text-foreground"}`} data-montant={cle}>
              {montantCentimesCpt(valeur)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MentionAnnulation({ annulation }: { annulation: { date: Date; motif: string; pieceOdoo: string | null; creePar: { fullName: string } } }) {
  return (
    <span className="block text-xs" data-annule>
      <Badge variant="danger">{`Annulé le ${formaterDateCpt(annulation.date)}`}</Badge>
      <span className="block text-muted-foreground">
        {annulation.motif} — {annulation.creePar.fullName}
        {annulation.pieceOdoo ? ` · Odoo ${annulation.pieceOdoo}` : ""}
      </span>
    </span>
  );
}

/**
 * Rémunération d'un partenaire : quatre soldes, honoraires ventilés, détail par échéance, règlements (`cpt.regler_partenaire`) et
 * décisions de mode. Lecture `cpt.consulter` (layout, revérifiée ici) ; chaque écriture est revérifiée par son action.
 */
export default async function PartenaireRemunerationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nature?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session || !peutVoirRemunerationCpt(session)) redirect("/?error=acces_refuse_compta");
  const { id } = await params;
  const recherche = await searchParams;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const r = await chargerRemunerationPartenaireCpt(prisma, id, aujourdhui);
  if (!r) notFound();
  const compensations = await prisma.cptCompensation.findMany({
    where: { partenaireId: id },
    orderBy: { creeAt: "desc" },
    take: 50,
    include: { valideePar: { select: { fullName: true } }, annulation: { include: { creePar: { select: { fullName: true } } } } },
  });
  const reglements = await prisma.cptReglementPartenaire.findMany({
    where: { partenaireId: id },
    orderBy: [{ date: "desc" }, { reference: "desc" }],
    take: 50,
    include: {
      creePar: { select: { fullName: true } },
      annulation: { include: { creePar: { select: { fullName: true } } } },
      _count: { select: { affectations: true } },
    },
  });
  const { operations, dus } = await chargerOperationsRemunerationCpt(prisma, id);

  const peutRegler = hasPermission(session, "cpt.regler_partenaire");
  const peutCompenser = hasPermission(session, "cpt.compenser");
  const peutTrancher = hasPermission(session, "cpt.trancher_litige");
  // Même fonction que le serveur : le bouton « Annuler » grisé dit exactement ce qu'il répondrait.
  const raisonAnnulation = (type: TypeOperationRemunerationCpt, operationId: string): string | null => {
    if (!(peutTrancher || (type === "REGLEMENT" ? peutRegler : peutCompenser))) return "Votre rôle ne permet pas d'annuler cette opération.";
    const operation = operations.find((o) => o.type === type && o.id === operationId)!;
    return raisonBlocageAnnulationCpt({ operation, operations, dus, userId: session.user.id });
  };
  const avances = NATURES_REMUNERATION_CPT.filter((n) => r.soldes[n].avanceNette > BigInt(0));
  const aVerser = NATURES_REMUNERATION_CPT.filter((n) => r.soldes[n].montantReglable > BigInt(0));
  const compensable = avances.some((a) => aVerser.some((b) => a !== b));
  const raisonCompensation = compensable ? null : "Rien à compenser : il faut une avance sur une nature et un montant à verser sur une autre.";
  const nature: NatureRemunerationCpt =
    NATURES_REMUNERATION_CPT.find((n) => n === recherche.nature) ?? NATURES_REMUNERATION_CPT.find((n) => r.lignes.some((l) => l.nature === n)) ?? "COMMISSION";
  const lignes = r.lignes.filter((l) => l.nature === nature);
  const nbPages = Math.max(1, Math.ceil(lignes.length / PAR_PAGE));
  const page = Math.min(nbPages, Math.max(1, Number.parseInt(recherche.page ?? "1", 10) || 1));
  const lien = (n: NatureRemunerationCpt, p = 1) => `/compta/partenaires/${id}?nature=${n}${p > 1 ? `&page=${p}` : ""}`;
  const contrats = [...r.contrats.entries()].map(([contratId, c]) => ({ contratId, numPolice: c.numPolice })).sort((a, b) => a.numPolice.localeCompare(b.numPolice));

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title={r.partenaire.nom} description="Rémunération du partenaire : quatre soldes distincts. Montants en FCFA." />
      <p className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/compta/partenaires" className="text-sm font-semibold text-primary hover:underline">
          ← Tous les partenaires
        </Link>
        <Link href={`/compta/partenaires/${id}/releve?nature=${nature}`} className="text-sm font-semibold text-primary hover:underline" data-lien-releve>
          Relevés par nature (écran, Excel, CSV, PDF) →
        </Link>
      </p>
      <AvertissementHonoraires />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {NATURES_REMUNERATION_CPT.map((n) => (
          <CarteSolde key={n} solde={r.soldes[n]} />
        ))}
        <div className="rounded-xl border border-border bg-card p-4 shadow-elevated" data-carte-creance>
          <h2 className="text-sm font-bold text-foreground">Créance</h2>
          {r.partenaire.estClient ? (
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Reste dû</dt>
                <dd className="text-base font-black tabular-nums" data-montant="creance">
                  {montantCentimesCpt(r.creance.resteDu)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Dont en retard</dt>
                <dd className="tabular-nums">{montantCentimesCpt(r.creance.resteEnRetard)}</dd>
              </div>
              <p className="text-xs text-muted-foreground">
                {r.creance.nbContrats} contrat(s) dont il est le débiteur
                {r.creance.joursAnciennete !== null ? `, dette la plus ancienne : ${r.creance.joursAnciennete} jour(s)` : ""}. Jamais compensée avec sa rémunération.
              </p>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Ce partenaire n&apos;est pas client : il ne paie pas pour ses clients.</p>
          )}
        </div>
      </section>

      {r.conflits.length > 0 && (
        <section className={SECTION} data-conflits>
          <h2 className="text-base font-bold text-danger">Conventions en conflit : aucune rémunération calculée</h2>
          <ul className="list-disc pl-5 text-sm">
            {r.conflits.map((c) => (
              <li key={`${c.contratId}-${c.nature}`}>
                {c.numPolice} — {LIBELLE_NATURE_REMUNERATION_CPT[c.nature]} : deux conventions désignent ce bénéficiaire. Fermez l&apos;une d&apos;elles dans les référentiels.
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.honoraires.contrats.length > 0 && (
        <section className={SECTION} data-honoraires>
          <h2 className="text-base font-bold text-foreground">Honoraires de gestion : primes encaissées et non encaissées</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-border">
                <tr>
                  {["Police", "Client", "Exigibles", "Sur primes encaissées", "Sur primes non encaissées", "Reste dû du client", "Ancienneté", "À régulariser"].map((t) => (
                    <th key={t} className={TH}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.honoraires.contrats.map((c) => (
                  <tr key={c.contratId} data-honoraire={c.numPolice}>
                    <td className={`${TD} whitespace-nowrap`}>{c.numPolice}</td>
                    <td className={TD}>{c.clientNom}</td>
                    <td className={TD} data-exigible>{montantCentimesCpt(c.exigible)}</td>
                    <td className={TD} data-encaissees>{montantCentimesCpt(c.surPrimesEncaissees)}</td>
                    <td className={TD} data-non-encaissees>{montantCentimesCpt(c.surPrimesNonEncaissees)}</td>
                    <td className={TD} data-reste-client>{montantCentimesCpt(c.resteDuClient)}</td>
                    <td className={TD}>
                      {c.ancienneteClientJours === null ? "—" : `${c.ancienneteClientJours} j (${c.trancheClient ? LIBELLE_TRANCHE_CREANCE_CPT[c.trancheClient] : ""})`}
                    </td>
                    <td className={TD} data-a-regulariser>
                      {c.aRegulariser > BigInt(0) ? <Badge variant="danger">{`À régulariser ${montantCentimesCpt(c.aRegulariser)}`}</Badge> : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="font-bold" data-total-honoraires>
                  <td className={TD} colSpan={2}>
                    Total
                  </td>
                  <td className={TD}>{montantCentimesCpt(r.honoraires.total.exigible)}</td>
                  <td className={TD}>{montantCentimesCpt(r.honoraires.total.surPrimesEncaissees)}</td>
                  <td className={TD}>{montantCentimesCpt(r.honoraires.total.surPrimesNonEncaissees)}</td>
                  <td className={TD} colSpan={2} />
                  <td className={TD}>{montantCentimesCpt(r.honoraires.total.aRegulariser)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={SECTION} data-detail>
        <h2 className="text-base font-bold text-foreground">Détail par échéance</h2>
        <nav className="flex flex-wrap gap-2" aria-label="Nature affichée">
          {NATURES_REMUNERATION_CPT.map((n) => (
            <Link
              key={n}
              href={lien(n)}
              aria-current={n === nature ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${n === nature ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground"}`}
            >
              {LIBELLE_NATURE_REMUNERATION_CPT[n]}
            </Link>
          ))}
        </nav>
        {lignes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune ligne de cette nature.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-border">
                <tr>
                  {["Police", "Échéance", "Prévue le", "Règle", "Dû", "Exigible", "Payable", "Payé", "Reste payable", "Reste dû", "Avance"].map((t) => (
                    <th key={t} className={TH}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lignes.slice((page - 1) * PAR_PAGE, page * PAR_PAGE).map((l) => (
                  <tr key={l.cle} data-ligne={`${l.numPolice}-${l.rang}`}>
                    <td className={`${TD} whitespace-nowrap`}>{l.numPolice}</td>
                    <td className={TD}>{l.rang}</td>
                    <td className={TD}>{dateIsoAfficheeCpt(l.datePrevue)}</td>
                    <td className={`${TD} text-xs`}>
                      {LIBELLE_FAIT_GENERATEUR_CPT[l.faitGenerateur]} · {LIBELLE_MODE_REGLEMENT_CPT[l.mode]}
                      {l.modeDecide && <Badge variant="info">Décidé</Badge>}
                      {l.primeAbandonnee && <Badge variant="warning">Prime abandonnée</Badge>}
                    </td>
                    {([["du", l.du], ["exigible", l.exigible], ["payable", l.payable], ["paye", l.paye], ["reste-payable", l.restePayable], ["reste-du", l.resteDu], ["avance", l.avance]] as const).map(([cle, v]) => (
                      <td key={cle} className={TD} data-montant={cle}>
                        {montantCentimesCpt(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nbPages > 1 && (
          <PaginationCpt nom="échéances" total={lignes.length} page={page} nbPages={nbPages} precedent={page > 1 ? lien(nature, page - 1) : null} suivant={page < nbPages ? lien(nature, page + 1) : null} />
        )}
      </section>

      <section className={SECTION}>
        <h2 className="text-base font-bold text-foreground">Nouveau règlement</h2>
        <p className="text-sm text-muted-foreground">
          Affecté aux montants payables les plus anciens de la nature choisie. Au-delà du payable, il n&apos;est jamais enregistré.
        </p>
        <ReglementPartenaireForm partenaireId={id} aujourdhui={aujourdhui} autorise={peutRegler} />
      </section>

      <section className={SECTION} data-compensation>
        <h2 className="text-base font-bold text-foreground">Compensation entre natures</h2>
        <p className="text-sm text-muted-foreground">
          Jamais automatique : l&apos;avance d&apos;une nature est reprise et imputée sur ce qu&apos;il reste à verser d&apos;une autre, avec un motif. La créance du partenaire n&apos;est pas compensée.
        </p>
        <CompensationForm partenaireId={id} autorise={peutCompenser} raison={raisonCompensation} />
        {compensations.length > 0 && (
          <ul className="divide-y divide-border text-sm" data-liste-compensations>
            {compensations.map((x) => (
              <li key={x.id} className="py-2" data-compensation-faite>
                <strong className="tabular-nums">{formaterMontantCpt(x.montant.toString())} FCFA</strong> : {LIBELLE_NATURE_REMUNERATION_CPT[x.natureSource]} → {LIBELLE_NATURE_REMUNERATION_CPT[x.natureCible]}
                <span className="block text-xs text-muted-foreground">
                  {x.motif} — {x.valideePar.fullName}, {formaterDateHeureCpt(x.creeAt)}
                </span>
                <div className="mt-1">
                  {x.annulation ? <MentionAnnulation annulation={x.annulation} /> : <AnnulationOperation type="COMPENSATION" operationId={x.id} raison={raisonAnnulation("COMPENSATION", x.id)} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={SECTION}>
        <h2 className="text-base font-bold text-foreground">En une fois ou au prorata, contrat par contrat</h2>
        <p className="text-sm text-muted-foreground">La convention fixe la règle ; le RFCRH peut la changer pour un contrat, avec un motif. La décision la plus récente s&apos;applique.</p>
        {contrats.length === 0 ? <p className="text-sm text-muted-foreground">Aucun contrat rémunéré.</p> : <DecisionModeForm partenaireId={id} contrats={contrats} autorise={peutRegler} />}
      </section>

      <section className={SECTION} data-reglements>
        <h2 className="text-base font-bold text-foreground">Règlements enregistrés</h2>
        {reglements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun règlement.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-border">
                <tr>
                  {["Référence", "Date", "Nature", "Montant", "Avance", "Paiement", "Mode décidé", "Motif", "Saisi par", "Annulation"].map((t) => (
                    <th key={t} className={TH}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reglements.map((x) => (
                  <tr key={x.id} data-reglement={x.reference}>
                    <td className={`${TD} whitespace-nowrap font-semibold`}>{x.reference}</td>
                    <td className={TD}>{formaterDateCpt(x.date)}</td>
                    <td className={TD}>{LIBELLE_NATURE_REMUNERATION_CPT[x.nature]}</td>
                    <td className={TD} data-montant-reglement>{formaterMontantCpt(x.montant.toString())}</td>
                    <td className={TD}>{Number(x.montantAvance.toString()) > 0 ? formaterMontantCpt(x.montantAvance.toString()) : "—"}</td>
                    <td className={TD}>
                      {LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT[x.mode]} · {x.referenceReglement}
                      {x.pieceOdoo ? ` · Odoo ${x.pieceOdoo}` : ""}
                    </td>
                    <td className={TD}>{x.modeDerogation ? LIBELLE_MODE_REGLEMENT_CPT[x.modeDerogation] : "—"}</td>
                    <td className={TD}>{x.motif ?? "—"}</td>
                    <td className={`${TD} text-xs`}>
                      {x.creePar.fullName}, {formaterDateHeureCpt(x.creeAt)} · {x._count.affectations} affectation(s)
                    </td>
                    <td className={TD}>
                      {x.annulation ? <MentionAnnulation annulation={x.annulation} /> : <AnnulationOperation type="REGLEMENT" operationId={x.id} raison={raisonAnnulation("REGLEMENT", x.id)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
