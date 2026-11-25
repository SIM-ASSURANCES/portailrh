import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LIBELLE_TYPE_COMPTE_CPT } from "@/components/compta/libellesEncaissements";
import { LIBELLE_FRACTIONNEMENT_CPT, LIBELLE_STATUT_RATTACHEMENT_CPT, VARIANTE_ETAT_ECHEANCE_CPT } from "@/components/compta/libellesCreances";
import { formaterDateCpt, formaterMontantCpt, LIBELLE_STATUT_CONTRAT_CPT } from "@/components/compta/libellesProduction";
import { Badge, PageHeader, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import {
  chargerFicheClientCpt,
  jourTexteCpt,
  LIBELLE_BRANCHE_CPT,
  LIBELLE_CANAL_RELANCE_CPT,
  LIBELLE_STATUT_PROMESSE_CPT,
  LIBELLE_TRANCHE_CREANCE_CPT,
  lireSuiviRelancesClientCpt,
  prisma,
  type PaiementFicheCpt,
} from "backend";

import { FormulaireRelance, EvaluerPromessesBouton } from "./RelancesPromesses";

const TH = "px-3 py-2";

function TableauPaiements({ paiements, vide, attribut }: { paiements: PaiementFicheCpt[]; vide: string; attribut: string }) {
  if (paiements.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 px-4 py-4 text-center text-sm text-muted-foreground" data-liste-vide>
        {vide}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated" {...{ [attribut]: true }}>
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className={TH}>Date</th>
            <th className={TH}>Canal</th>
            <th className={TH}>Référence</th>
            <th className={TH}>Police</th>
            <th className={TH}>Échéance</th>
            <th className={`${TH} text-right`}>Montant</th>
            <th className={TH}>État</th>
          </tr>
        </thead>
        <tbody>
          {paiements.map((p) => (
            <tr key={p.rattachementId} className="border-b border-border last:border-0" data-paiement={p.encaissementReference}>
              <td className="whitespace-nowrap px-3 py-2">{formaterDateCpt(p.dateValeur)}</td>
              <td className="px-3 py-2">
                {LIBELLE_TYPE_COMPTE_CPT[p.canal] ?? p.canal}
                <span className="block text-xs text-muted-foreground">{p.compteLibelle}</span>
              </td>
              <td className="px-3 py-2">
                <span className="font-semibold">{p.encaissementReference}</span>
                <span className="block text-xs text-muted-foreground">{p.referenceReleve}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2">{p.numPolice}</td>
              <td className="px-3 py-2 tabular-nums">n° {p.rangEcheance}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formaterMontantCpt(p.montant)}</td>
              <td className="px-3 py-2">{LIBELLE_STATUT_RATTACHEMENT_CPT[p.statut] ?? p.statut}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Fiche client (lot GC-7a) : identité, contrats, échéances, paiements prouvés, retards, sommes qui ne sont pas des primes. Lecture seule,
 * `cpt.consulter` (layout, revérifiée ici). Chaque chiffre vient des moteurs de GC-3 et GC-5 (`chargerFicheClientCpt`) : rien n'est recalculé
 * ici. Un rattachement seulement proposé ou confirmé n'est pas un paiement prouvé (RG-01).
 */
export default async function FicheClientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");
  const { id } = await params;
  const aujourdhui = jourTexteCpt(new Date());
  const fiche = await chargerFicheClientCpt(prisma, id, aujourdhui);
  if (!fiche) notFound();
  const { client, totaux } = fiche;
  const suivi = await lireSuiviRelancesClientCpt(prisma, id, aujourdhui);
  const peutRelancer = hasPermission(session, "cpt.relancer");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10" data-fiche-client={client.id}>
      <PageHeader
        title={client.nom}
        description={[client.telephone, client.partenaireOrigine ? `Partenaire d'origine : ${client.partenaireOrigine}` : null, client.pieceIdentite ? `Pièce : ${client.pieceIdentite}` : null]
          .filter(Boolean)
          .join(" · ") || "Client sans coordonnées enregistrées"}
        actions={
          <span className="flex flex-wrap items-center gap-4">
            <a href={`/api/compta/clients/${client.id}/releve`} className="text-sm font-semibold text-primary hover:underline" data-releve-pdf>
              Relevé PDF
            </a>
            <Link href="/compta/clients" className="text-sm font-semibold text-primary hover:underline">
              ← Tous les clients
            </Link>
          </span>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-totaux-client>
        <StatCard icon="file-text" label="Prime émise" value={`${formaterMontantCpt(totaux.primeEmise)} FCFA`} hint={`${fiche.contrats.length} contrat(s)`} tone="neutral" />
        <StatCard icon="wallet" label="Encaissé prouvé" value={`${formaterMontantCpt(totaux.encaisseProuve)} FCFA`} hint="Rattachements validés" tone="success" />
        <StatCard icon="alert-triangle" label="Reste dû" value={`${formaterMontantCpt(totaux.resteDu)} FCFA`} hint={`Dont en retard : ${formaterMontantCpt(totaux.resteEnRetard)} FCFA`} tone={Number(totaux.resteDu) > 0 ? "warning" : "success"} />
        <StatCard
          icon="clock"
          label="Ancienneté de la dette"
          value={totaux.joursAnciennete === null ? "—" : `${totaux.joursAnciennete} jour${totaux.joursAnciennete > 1 ? "s" : ""}`}
          hint={totaux.tranche ? `${LIBELLE_TRANCHE_CREANCE_CPT[totaux.tranche]} · depuis le ${formaterDateCpt(new Date(`${totaux.depuisLe}T00:00:00Z`))}` : "Aucune échéance échue impayée"}
          tone={totaux.nbEcheancesEnRetard > 0 ? "danger" : "success"}
        />
      </section>
      {Number(totaux.declarePayeNonProuve) > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning" data-declare-paye-non-prouve>
          La production déclare payés des contrats de ce client pour {formaterMontantCpt(totaux.declarePayeNonProuve)} FCFA qu&apos;aucun rattachement validé ne prouve : ce montant est
          compté dans le reste dû.
        </p>
      )}

      <section className="space-y-4" data-contrats-client>
        <h2 className="text-base font-bold text-foreground">Contrats et échéances</h2>
        {fiche.contrats.length === 0 && <p className="text-sm text-muted-foreground">Aucun contrat pour ce client.</p>}
        {fiche.contrats.map((c) => (
          <div key={c.id} className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-elevated" data-contrat={c.numPolice}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold text-foreground">
                {c.numPolice}{" "}
                <span className="font-normal text-muted-foreground">
                  · {c.produitLibelle} ({LIBELLE_BRANCHE_CPT[c.branche as keyof typeof LIBELLE_BRANCHE_CPT] ?? c.branche}) · {LIBELLE_FRACTIONNEMENT_CPT[c.fractionnement] ?? c.fractionnement}
                </span>
              </h3>
              <span className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="neutral">{LIBELLE_STATUT_CONTRAT_CPT[c.statut] ?? c.statut}</Badge>
                {c.declarePaye && <Badge variant="info">Déclaré payé par la production</Badge>}
                {c.synthese.tranche && <Badge variant="danger">{LIBELLE_TRANCHE_CREANCE_CPT[c.synthese.tranche]}</Badge>}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Du {formaterDateCpt(c.dateEffet)} au {formaterDateCpt(c.dateEcheance)} · apporteur : {c.partenaireNom ?? "—"} · prime {formaterMontantCpt(c.primeTtc)} FCFA · encaissé{" "}
              {formaterMontantCpt(Number(c.synthese.encaisseProuve) / 100)} · reste dû {formaterMontantCpt(Number(c.synthese.resteDu) / 100)}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className={TH}>N°</th>
                    <th className={TH}>Date prévue</th>
                    <th className={`${TH} text-right`}>Dû</th>
                    <th className={`${TH} text-right`}>Réglé</th>
                    <th className={`${TH} text-right`}>Reste</th>
                    <th className={TH}>État</th>
                  </tr>
                </thead>
                <tbody>
                  {c.echeances.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0" data-echeance={`${c.numPolice}-${e.rang}`} data-etat={e.etat}>
                      <td className="px-3 py-1.5 tabular-nums">{e.rang}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{formaterDateCpt(e.datePrevue)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formaterMontantCpt(e.montantDu)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formaterMontantCpt(e.montantRegle)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{formaterMontantCpt(e.resteDu)}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant={VARIANTE_ETAT_ECHEANCE_CPT[e.etat]}>{e.libelleEtat}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground">Paiements prouvés</h2>
        <p className="text-sm text-muted-foreground">Chaque ligne est un rattachement validé par le RFCRH : canal, référence, date et montant rattaché à l&apos;échéance.</p>
        <TableauPaiements paiements={fiche.paiements} vide="Aucun paiement validé pour ce client." attribut="data-paiements-prouves" />
      </section>

      {fiche.paiementsEnAttente.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-bold text-foreground">En attente de validation</h2>
          <p className="text-sm text-muted-foreground">Rattachements proposés ou confirmés mais pas encore validés : ils ne comptent pas comme payés.</p>
          <TableauPaiements paiements={fiche.paiementsEnAttente} vide="" attribut="data-paiements-en-attente" />
        </section>
      )}

      <section className="space-y-3" data-relances-promesses>
        <h2 className="text-base font-bold text-foreground">Relances et promesses de paiement</h2>
        {suivi.relanceProposee && (
          <p className="rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning" data-relance-proposee>
            Relance proposée : ce client a {suivi.nbEcheancesEnRetard} échéance(s) en retard et aucune promesse de paiement en cours.
            {suivi.derniereRelance ? ` Dernière relance consignée le ${formaterDateCpt(suivi.derniereRelance)}.` : " Aucune relance n'a encore été consignée."} L&apos;application n&apos;envoie rien : la relance se fait hors de l&apos;application.
          </p>
        )}
        {peutRelancer && <FormulaireRelance clientId={client.id} aujourdhui={aujourdhui} />}
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-foreground">Promesses</h3>
          {peutRelancer && <EvaluerPromessesBouton clientId={client.id} />}
        </div>
        {suivi.promesses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune promesse de paiement.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className={TH}>Date promise</th>
                  <th className={`${TH} text-right`}>Montant promis</th>
                  <th className={TH}>Statut</th>
                  <th className={TH}>Encaissé prouvé</th>
                </tr>
              </thead>
              <tbody>
                {suivi.promesses.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0" data-promesse data-statut={p.etat} data-statut-enregistre={p.statut}>
                    <td className="whitespace-nowrap px-3 py-2">{formaterDateCpt(p.datePromise)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formaterMontantCpt(p.montant)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={p.etat === "TENUE" ? "success" : p.etat === "NON_TENUE" ? "danger" : "info"}>{LIBELLE_STATUT_PROMESSE_CPT[p.etat]}</Badge>
                      {p.statut !== p.etat && (
                        <span className="ml-2 text-xs text-muted-foreground" data-a-evaluer>
                          évaluation non enregistrée
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formaterMontantCpt(p.montantProuve ?? p.prouve)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="text-sm font-bold text-foreground">Relances consignées</h3>
        {suivi.relances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune relance consignée.</p>
        ) : (
          <ul className="space-y-1 text-sm" data-liste-relances>
            {suivi.relances.map((r) => (
              <li key={r.id} data-relance={r.canal}>
                <span className="font-semibold">{formaterDateCpt(r.faiteLe)}</span> · {LIBELLE_CANAL_RELANCE_CPT[r.canal]} · {r.auteur}
                {r.commentaire ? ` — ${r.commentaire}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" data-sommes-pas-une-prime>
        <h2 className="text-base font-bold text-foreground">Sommes qui ne sont pas des primes</h2>
        {fiche.sommesPasUnePrime.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune somme classée « pas une prime » sur les encaissements de ce client.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {fiche.sommesPasUnePrime.map((s) => (
              <li key={s.encaissementReference} data-pas-une-prime={s.encaissementReference}>
                <span className="font-semibold">{formaterMontantCpt(s.montant)} FCFA</span> sur {s.encaissementReference} ({formaterDateCpt(s.dateValeur)}) — {s.motif ?? "motif non renseigné"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
