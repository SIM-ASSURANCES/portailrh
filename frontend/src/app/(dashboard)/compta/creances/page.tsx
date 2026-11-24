import Link from "next/link";
import { redirect } from "next/navigation";

import { PaginationCpt } from "@/components/compta/Pagination";
import { VARIANTE_ETAT_ECHEANCE_CPT } from "@/components/compta/libellesCreances";
import { formaterDateCpt, formaterMontantCpt } from "@/components/compta/libellesProduction";
import { Badge, Button, Input, PageHeader, Select, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import {
  chargerEtatCreancesCpt,
  jourTexteCpt,
  LIBELLE_TRANCHE_CREANCE_CPT,
  LIBELLE_VUE_ECHEANCES_CPT,
  lireFiltresCreancesCpt,
  listerEcheancesProchesCpt,
  listerPartenairesFiltreCreancesCpt,
  pageDemandeeCpt,
  prisma,
  TAILLE_PAGE_DEBITEURS_CPT,
  TAILLE_PAGE_ECHEANCES_CPT,
  TRANCHES_CREANCE_CPT,
  VUES_ECHEANCES_CPT,
  type FiltresCreancesCpt,
  type RechercheCreancesBruteCpt,
} from "backend";

const montant = (centimes: bigint) => formaterMontantCpt(Number(centimes) / 100);
const TH = "px-3 py-2";

/**
 * État des créances (lot GC-7b) : par débiteur, ancienneté en 4 tranches (C-5), détail contrat par contrat ; échéances dues dans les 7 jours
 * et en retard. Lecture seule, `cpt.consulter` (layout, revérifiée ici). Aucun envoi : une « relance proposée » est un signalement.
 */
export default async function CreancesPage({ searchParams }: { searchParams: Promise<RechercheCreancesBruteCpt> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");

  const recherche = await searchParams;
  const partenaires = await listerPartenairesFiltreCreancesCpt(prisma);
  const filtres = lireFiltresCreancesCpt(recherche, partenaires.map((p) => p.id));
  const aujourdhui = jourTexteCpt(new Date());
  const pageDeb = pageDemandeeCpt(recherche.page);
  const pageEch = pageDemandeeCpt(recherche.pageEcheances);

  const [etat, echeances] = await Promise.all([chargerEtatCreancesCpt(prisma, filtres, aujourdhui), listerEcheancesProchesCpt(prisma, filtres, aujourdhui, pageEch)]);
  const nbPagesDeb = Math.max(1, Math.ceil(etat.debiteurs.length / TAILLE_PAGE_DEBITEURS_CPT));
  const debiteurs = etat.debiteurs.slice((Math.min(pageDeb, nbPagesDeb) - 1) * TAILLE_PAGE_DEBITEURS_CPT, Math.min(pageDeb, nbPagesDeb) * TAILLE_PAGE_DEBITEURS_CPT);
  const nbPagesEch = Math.max(1, Math.ceil(echeances.total / TAILLE_PAGE_ECHEANCES_CPT));

  const parametres = (f: FiltresCreancesCpt, pages: { page?: number; pageEcheances?: number } = {}) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.partenaireId) p.set("partenaire", f.partenaireId);
    if (f.tranche) p.set("tranche", f.tranche);
    if (f.vue !== "TOUTES") p.set("vue", f.vue);
    if (pages.page && pages.page > 1) p.set("page", String(pages.page));
    if (pages.pageEcheances && pages.pageEcheances > 1) p.set("pageEcheances", String(pages.pageEcheances));
    return p;
  };
  const lien = (pages: { page?: number; pageEcheances?: number }) => `/compta/creances?${parametres(filtres, pages).toString()}`;
  const exporter = (vue: "debiteurs" | "echeances") => `/api/compta/export/creances?${new URLSearchParams({ vue, format: "csv", ...Object.fromEntries(parametres(filtres)) }).toString()}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="Créances et relances" description="Ce que les clients et partenaires doivent encore payer, depuis quand, et les échéances à surveiller. Les relances se font hors de l'application." />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-totaux-creances>
        <StatCard icon="alert-triangle" label="Reste dû" value={`${montant(etat.totaux.resteDu)} FCFA`} hint={`${etat.totaux.nbDebiteurs} débiteur(s)`} tone="neutral" />
        <StatCard icon="clock" label="Dette échue" value={`${montant(etat.totaux.resteEchu)} FCFA`} hint="Échéances dont la date prévue est atteinte" tone={etat.totaux.resteEchu > BigInt(0) ? "warning" : "success"} />
        <StatCard icon="alert-triangle" label="En retard" value={`${montant(etat.totaux.resteEnRetard)} FCFA`} hint="Date prévue dépassée" tone={etat.totaux.resteEnRetard > BigInt(0) ? "danger" : "success"} />
        <StatCard icon="file-text" label="Déclaré payé, non prouvé" value={`${montant(etat.totaux.declarePayeNonProuve)} FCFA`} hint="Compté dans le reste dû" tone="neutral" />
      </section>

      <section className="grid gap-3 sm:grid-cols-4" data-repartition-tranches>
        {etat.repartition.map((r) => (
          <div key={r.tranche} className="rounded-xl border border-border bg-card p-3 text-sm shadow-elevated" data-tranche={r.tranche}>
            <p className="font-semibold text-foreground">{LIBELLE_TRANCHE_CREANCE_CPT[r.tranche]}</p>
            <p className="tabular-nums text-muted-foreground">
              {r.nbDebiteurs} débiteur(s) · {montant(r.resteEchu)} FCFA
            </p>
          </div>
        ))}
      </section>

      <form method="get" className="flex flex-wrap items-end gap-3" data-filtres-creances>
        <div className="w-full sm:w-64">
          <Input name="q" label="Client" defaultValue={filtres.q} placeholder="Nom, téléphone…" />
        </div>
        <div className="w-full sm:w-56">
          <Select label="Partenaire" name="partenaire" defaultValue={filtres.partenaireId ?? ""} placeholder="Tous les partenaires" options={partenaires.map((p) => ({ value: p.id, label: p.nom }))} />
        </div>
        <div className="w-full sm:w-48">
          <Select label="Ancienneté" name="tranche" defaultValue={filtres.tranche ?? ""} placeholder="Toutes les tranches" options={TRANCHES_CREANCE_CPT.map((t) => ({ value: t, label: LIBELLE_TRANCHE_CREANCE_CPT[t] }))} />
        </div>
        <div className="w-full sm:w-64">
          <Select label="Échéances" name="vue" defaultValue={filtres.vue} options={VUES_ECHEANCES_CPT.map((v) => ({ value: v, label: LIBELLE_VUE_ECHEANCES_CPT[v] }))} />
        </div>
        <Button type="submit" variant="secondary">
          Filtrer
        </Button>
      </form>

      <section className="space-y-3" data-etat-creances>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-foreground">Par débiteur</h2>
          <a href={exporter("debiteurs")} className="text-sm font-semibold text-primary hover:underline" data-export-debiteurs>
            Exporter (CSV)
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          Un débiteur est le client du contrat, ou le partenaire apporteur lorsqu&apos;il est lui-même client (il paie pour ses clients). L&apos;ancienneté part de la date prévue de la plus
          ancienne échéance impayée et échue ; une échéance à venir n&apos;est pas une dette en retard.
        </p>
        {debiteurs.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-liste-vide>
            Aucune créance.
          </p>
        ) : (
          <div className="space-y-3">
            {debiteurs.map((d) => (
              <details key={d.debiteur.cle} className="rounded-xl border border-border bg-card shadow-elevated" data-debiteur={d.debiteur.nom} data-tranche-debiteur={d.tranche ?? ""}>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-bold text-foreground">
                    {d.debiteur.type === "CLIENT" ? (
                      <Link href={`/compta/clients/${d.debiteur.id}`} className="text-primary hover:underline">
                        {d.debiteur.nom}
                      </Link>
                    ) : (
                      d.debiteur.nom
                    )}
                    {d.debiteur.type === "PARTENAIRE" && <span className="ml-2 text-xs font-normal text-muted-foreground">(partenaire)</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 tabular-nums">
                    <span>Reste dû {montant(d.resteDu)} FCFA</span>
                    {d.tranche && <Badge variant="danger">{LIBELLE_TRANCHE_CREANCE_CPT[d.tranche]}</Badge>}
                    {d.relanceProposee && <Badge variant="warning">Relance proposée</Badge>}
                  </span>
                </summary>
                <div className="space-y-2 border-t border-border px-4 py-3 text-sm">
                  <p className="text-muted-foreground">
                    Prime émise {montant(d.primeEmise)} · encaissé prouvé {montant(d.encaisseProuve)} · déclaré payé non prouvé {montant(d.declarePayeNonProuve)} · dû depuis le{" "}
                    {d.depuisLe ? formaterDateCpt(new Date(`${d.depuisLe}T00:00:00Z`)) : "—"}
                    {d.joursAnciennete !== null && ` (${d.joursAnciennete} jour${d.joursAnciennete > 1 ? "s" : ""})`}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left">
                      <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className={TH}>Police</th>
                          <th className={TH}>Client</th>
                          <th className={TH}>Produit</th>
                          <th className={`${TH} text-right`}>Prime</th>
                          <th className={`${TH} text-right`}>Encaissé</th>
                          <th className={`${TH} text-right`}>Reste</th>
                          <th className={TH}>Dû depuis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.contrats.map((c) => (
                          <tr key={c.contratId} className="border-b border-border last:border-0" data-contrat-creance={c.numPolice}>
                            <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{c.numPolice}</td>
                            <td className="px-3 py-1.5">
                              <Link href={`/compta/clients/${c.clientId}`} className="text-primary hover:underline">
                                {c.clientNom}
                              </Link>
                            </td>
                            <td className="px-3 py-1.5">{c.produitLibelle}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{montant(c.synthese.primeEmise)}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{montant(c.synthese.encaisseProuve)}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{montant(c.synthese.resteDu)}</td>
                            <td className="whitespace-nowrap px-3 py-1.5">
                              {c.synthese.depuisLe ? `${formaterDateCpt(new Date(`${c.synthese.depuisLe}T00:00:00Z`))} · ${c.synthese.joursAnciennete} j` : "Rien d'échu"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
        <PaginationCpt
          nom="débiteur(s)"
          total={etat.debiteurs.length}
          page={Math.min(pageDeb, nbPagesDeb)}
          nbPages={nbPagesDeb}
          precedent={pageDeb > 1 ? lien({ page: pageDeb - 1, pageEcheances: pageEch }) : null}
          suivant={pageDeb < nbPagesDeb ? lien({ page: pageDeb + 1, pageEcheances: pageEch }) : null}
        />
      </section>

      <section className="space-y-3" data-echeances-proches>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-foreground">Échéances à surveiller</h2>
          <a href={exporter("echeances")} className="text-sm font-semibold text-primary hover:underline" data-export-echeances>
            Exporter (CSV)
          </a>
        </div>
        {echeances.lignes.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-liste-vide>
            Aucune échéance en retard ou due dans les 7 jours.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className={TH}>Date prévue</th>
                  <th className={TH}>Police</th>
                  <th className={TH}>Client</th>
                  <th className={TH}>Partenaire</th>
                  <th className={`${TH} text-right`}>Reste</th>
                  <th className={TH}>État</th>
                </tr>
              </thead>
              <tbody>
                {echeances.lignes.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0" data-echeance-proche={`${e.numPolice}-${e.rang}`} data-etat={e.etat}>
                    <td className="whitespace-nowrap px-3 py-2">{formaterDateCpt(e.datePrevue)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold">
                      {e.numPolice} <span className="font-normal text-muted-foreground">n°{e.rang}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/compta/clients/${e.clientId}`} className="text-primary hover:underline">
                        {e.clientNom}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{e.partenaireNom ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formaterMontantCpt(e.resteDu)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={VARIANTE_ETAT_ECHEANCE_CPT[e.etat]}>{e.libelleEtat}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationCpt
          nom="échéance(s)"
          total={echeances.total}
          page={Math.min(pageEch, nbPagesEch)}
          nbPages={nbPagesEch}
          precedent={pageEch > 1 ? lien({ page: pageDeb, pageEcheances: pageEch - 1 }) : null}
          suivant={pageEch < nbPagesEch ? lien({ page: pageDeb, pageEcheances: pageEch + 1 }) : null}
        />
      </section>
    </div>
  );
}
