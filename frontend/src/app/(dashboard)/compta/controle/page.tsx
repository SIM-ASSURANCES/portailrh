import Link from "next/link";
import { redirect } from "next/navigation";

import { formaterDateCpt, formaterMontantCpt } from "@/components/compta/libellesProduction";
import { Badge, Button, PageHeader, Select } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import {
  BRANCHES_CPT,
  chargerOptionsFiltresSuiviCpt,
  libelleAgeCpt,
  LIBELLE_BRANCHE_CPT,
  lireFiltresSuiviCpt,
  listerContratsSansEncaissementCpt,
  listerEncaissementsSansContratCpt,
  pageDemandeeCpt,
  prisma,
  TAILLE_PAGE_SUIVI_CPT,
  type FiltresSuiviCpt,
  type RechercheBruteCpt,
} from "backend";

/**
 * Contrôle hebdomadaire (lot GC-6, docs/PLAN_GESTION_COMPTA.md) : les deux listes de travail issues du rapprochement. Lecture :
 * `cpt.consulter` (layout, revérifiée ici). Aucune action n'est exposée sur cet écran : les lignes se traitent depuis « Rattachements »
 * (encaissements) et « Production » (contrats). Le filtre « compte » ne vise que les encaissements, « partenaire » et « branche » que
 * les contrats : une liste dont le filtre ne s'applique pas le dit.
 */
export default async function ControleHebdomadairePage({ searchParams }: { searchParams: Promise<RechercheBruteCpt> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");

  const recherche = await searchParams;
  const options = await chargerOptionsFiltresSuiviCpt(prisma);
  const filtres = lireFiltresSuiviCpt(recherche, { comptesIds: options.comptes.map((c) => c.id), partenairesIds: options.partenaires.map((p) => p.id) });
  const pageEnc = pageDemandeeCpt(recherche.page);
  const pageCon = pageDemandeeCpt(recherche.pageContrats);
  const maintenant = new Date();

  const [encaissements, contrats] = await Promise.all([
    listerEncaissementsSansContratCpt(prisma, filtres, maintenant, pageEnc),
    listerContratsSansEncaissementCpt(prisma, filtres, maintenant, pageCon),
  ]);

  const lien = (f: FiltresSuiviCpt, pages: { page: number; pageContrats: number }) => {
    const p = new URLSearchParams();
    if (f.du) p.set("du", f.du);
    if (f.au) p.set("au", f.au);
    if (f.compteId) p.set("compte", f.compteId);
    if (f.partenaireId) p.set("partenaire", f.partenaireId);
    if (f.branche) p.set("branche", f.branche);
    if (pages.page > 1) p.set("page", String(pages.page));
    if (pages.pageContrats > 1) p.set("pageContrats", String(pages.pageContrats));
    const q = p.toString();
    return `/compta/controle${q ? `?${q}` : ""}`;
  };
  const nbPagesEnc = Math.max(1, Math.ceil(encaissements.total / TAILLE_PAGE_SUIVI_CPT));
  const nbPagesCon = Math.max(1, Math.ceil(contrats.total / TAILLE_PAGE_SUIVI_CPT));
  const champ = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Contrôle hebdomadaire"
        description="Ce qui reste à traiter : l'argent reçu qu'aucun contrat n'a encore absorbé, et les contrats déclarés payés dont on ne voit pas l'argent."
      />

      <form method="get" className="flex flex-wrap items-end gap-3" data-filtres-controle>
        <label className="block w-full text-sm sm:w-40">
          <span className="mb-1 block font-semibold text-foreground">Du</span>
          <input type="date" name="du" defaultValue={filtres.du ?? ""} className={champ} />
        </label>
        <label className="block w-full text-sm sm:w-40">
          <span className="mb-1 block font-semibold text-foreground">Au</span>
          <input type="date" name="au" defaultValue={filtres.au ?? ""} className={champ} />
        </label>
        <div className="w-full sm:w-56">
          <Select
            label="Compte (encaissements)"
            name="compte"
            defaultValue={filtres.compteId ?? ""}
            placeholder="Tous les comptes"
            options={options.comptes.map((c) => ({ value: c.id, label: c.libelle }))}
          />
        </div>
        <div className="w-full sm:w-56">
          <Select
            label="Partenaire (contrats)"
            name="partenaire"
            defaultValue={filtres.partenaireId ?? ""}
            placeholder="Tous les partenaires"
            options={options.partenaires.map((p) => ({ value: p.id, label: p.nom }))}
          />
        </div>
        <div className="w-full sm:w-44">
          <Select
            label="Branche (contrats)"
            name="branche"
            defaultValue={filtres.branche ?? ""}
            placeholder="Toutes les branches"
            options={BRANCHES_CPT.map((b) => ({ value: b, label: LIBELLE_BRANCHE_CPT[b] }))}
          />
        </div>
        <Button type="submit" variant="secondary">
          Filtrer
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          La période porte sur la date de valeur de l&apos;encaissement et sur la date de paiement déclarée du contrat. Le compte ne filtre que les
          encaissements ; le partenaire et la branche ne filtrent que les contrats.
        </p>
      </form>

      <section className="space-y-3" data-liste-encaissements-sans-contrat>
        <h2 className="text-base font-bold text-foreground">
          Encaissements sans contrat <span className="text-sm font-normal text-muted-foreground">({encaissements.total.toLocaleString("fr-FR")})</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Argent reçu dont aucune part n&apos;est encore rattachée à une échéance par une validation. À traiter par le commercial depuis « Rattachements ». L&apos;âge compte
          depuis la date de valeur.
        </p>
        {encaissements.lignes.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-liste-vide>
            Aucun encaissement sans contrat.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Âge</th>
                  <th className="px-3 py-2">Encaissement</th>
                  <th className="px-3 py-2">Date de valeur</th>
                  <th className="px-3 py-2">Compte</th>
                  <th className="px-3 py-2">Payeur</th>
                  <th className="px-3 py-2">Référence client</th>
                  <th className="px-3 py-2 text-right">Reste à rattacher</th>
                  <th className="px-3 py-2">Rapprochement</th>
                </tr>
              </thead>
              <tbody>
                {encaissements.lignes.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0" data-encaissement-sans-contrat={e.reference} data-age={e.age}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums">{libelleAgeCpt(e.age)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-foreground">{e.reference}</td>
                    <td className="whitespace-nowrap px-3 py-2">{formaterDateCpt(e.dateValeur)}</td>
                    <td className="px-3 py-2">{e.compteLibelle}</td>
                    <td className="px-3 py-2">
                      {e.payeur ?? "—"}
                      {e.telephone && <span className="block text-xs text-muted-foreground">{e.telephone}</span>}
                    </td>
                    <td className="px-3 py-2">{e.referenceClient ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formaterMontantCpt(e.resteARattacher)}</td>
                    <td className="px-3 py-2">
                      {e.propositionEnCours ? <Badge variant="info">Proposition en cours</Badge> : <Badge variant="warning">Aucune proposition</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          nom="encaissement(s)"
          total={encaissements.total}
          page={Math.min(pageEnc, nbPagesEnc)}
          nbPages={nbPagesEnc}
          precedent={pageEnc > 1 ? lien(filtres, { page: pageEnc - 1, pageContrats: pageCon }) : null}
          suivant={pageEnc < nbPagesEnc ? lien(filtres, { page: pageEnc + 1, pageContrats: pageCon }) : null}
        />
      </section>

      <section className="space-y-3" data-liste-contrats-sans-encaissement>
        <h2 className="text-base font-bold text-foreground">
          Contrats déclarés payés sans encaissement <span className="text-sm font-normal text-muted-foreground">({contrats.total.toLocaleString("fr-FR")})</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Contrats que la production déclare payés et qu&apos;aucun rattachement (proposé, confirmé ou validé) n&apos;appuie. À traiter par la production depuis « Production ». L&apos;âge
          compte depuis la date de paiement déclarée, à défaut depuis l&apos;import du contrat ; les contrats sans date déclarée sont listés à la fin.
        </p>
        {contrats.lignes.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-liste-vide>
            Aucun contrat déclaré payé sans encaissement.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Âge</th>
                  <th className="px-3 py-2">Police</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Partenaire</th>
                  <th className="px-3 py-2">Produit</th>
                  <th className="px-3 py-2">Paiement déclaré</th>
                  <th className="px-3 py-2">Référence déclarée</th>
                  <th className="px-3 py-2 text-right">Prime TTC</th>
                </tr>
              </thead>
              <tbody>
                {contrats.lignes.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0" data-contrat-sans-encaissement={c.numPolice} data-age={c.age}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums">{libelleAgeCpt(c.age)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-foreground">{c.numPolice}</td>
                    <td className="px-3 py-2">{c.clientNom}</td>
                    <td className="px-3 py-2">{c.partenaireNom ?? "—"}</td>
                    <td className="px-3 py-2">
                      {c.produitLibelle}
                      <span className="block text-xs text-muted-foreground">{LIBELLE_BRANCHE_CPT[c.branche as keyof typeof LIBELLE_BRANCHE_CPT] ?? c.branche}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formaterDateCpt(c.datePaiement)}
                      {c.dateParDefaut && <span className="block text-xs text-muted-foreground">date d&apos;import</span>}
                    </td>
                    <td className="px-3 py-2">{c.referencePaiementDeclaree ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formaterMontantCpt(c.primeTtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          nom="contrat(s)"
          total={contrats.total}
          page={Math.min(pageCon, nbPagesCon)}
          nbPages={nbPagesCon}
          precedent={pageCon > 1 ? lien(filtres, { page: pageEnc, pageContrats: pageCon - 1 }) : null}
          suivant={pageCon < nbPagesCon ? lien(filtres, { page: pageEnc, pageContrats: pageCon + 1 }) : null}
        />
      </section>
    </div>
  );
}

function Pagination({ nom, total, page, nbPages, precedent, suivant }: { nom: string; total: number; page: number; nbPages: number; precedent: string | null; suivant: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span data-pagination-total>
        {total.toLocaleString("fr-FR")} {nom} · page {page} sur {nbPages}
      </span>
      <span className="flex gap-3">
        {precedent && (
          <Link href={precedent} className="font-semibold text-primary hover:underline">
            ← Précédente
          </Link>
        )}
        {suivant && (
          <Link href={suivant} className="font-semibold text-primary hover:underline">
            Suivante →
          </Link>
        )}
      </span>
    </div>
  );
}
