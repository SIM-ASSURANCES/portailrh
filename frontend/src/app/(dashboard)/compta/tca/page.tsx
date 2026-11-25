import { redirect } from "next/navigation";

import { AvertissementTaxe, OngletsTaxe } from "@/components/compta/AvertissementTaxe";
import { formaterDateCpt, formaterDateHeureCpt, formaterMontantCpt } from "@/components/compta/libellesProduction";
import { Badge, Button, Input, PageHeader, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { chargerCalculMoisCpt, chargerParametresCpt, dateLimiteTcaCpt, listerTauxManquantsCpt, prisma } from "backend";

import { AvanceForm, DeclarerMoisBouton, PaiementForm, RattraperBouton } from "./TaxeActions";

const montant = (centimes: bigint) => formaterMontantCpt(Number(centimes) / 100);
const MOIS = /^\d{4}-\d{2}$/;
const TH = "px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground";
const TD = "px-3 py-2 text-sm tabular-nums";

/** Mois choisi (`?mois=AAAA-MM`) ou, par défaut, le mois précédent : la taxe d'un mois se déclare le mois suivant. */
function moisDemande(brut: string | undefined, maintenant: Date): string {
  if (brut && MOIS.test(brut)) return `${brut}-01`;
  const courant = `${maintenant.toISOString().slice(0, 7)}-01`;
  const annee = Number(courant.slice(0, 4));
  const m = Number(courant.slice(5, 7));
  return m === 1 ? `${annee - 1}-12-01` : `${annee}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * Taxe sur les contrats d'assurance : calcul du mois (lot GC-8c) et déclaration, paiement et quittance (lot GC-8d). `cpt.consulter` (layout,
 * revérifiée ici) ; déclarer = `cpt.declarer_tca`, payer = `cpt.payer_tca`, chacune revérifiée par l'action.
 */
export default async function TaxePage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");
  const peutDeclarer = hasPermission(session, "cpt.declarer_tca");
  const peutPayer = hasPermission(session, "cpt.payer_tca");
  const peutTaxer = peutDeclarer || hasPermission(session, "cpt.identifier_encaissement");

  const maintenant = new Date();
  const mois = moisDemande((await searchParams).mois, maintenant);
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  const [etat, parametres, manquants, declarations] = await Promise.all([
    chargerCalculMoisCpt(prisma, mois, maintenant),
    chargerParametresCpt(prisma),
    listerTauxManquantsCpt(prisma, 50),
    prisma.cptDeclarationTca.findMany({ orderBy: { mois: "desc" }, take: 12 }),
  ]);
  const c = etat.calcul;
  const dateLimite = dateLimiteTcaCpt(mois, parametres["tca.jour_limite_paiement"]);
  const declaration = etat.declaration ? await prisma.cptDeclarationTca.findUnique({ where: { id: etat.declaration.id } }) : null;
  const credits = await prisma.cptCreditTaxe.aggregate({ where: { statut: "A_RECUPERER" }, _sum: { montant: true } });
  const creditOuvert = Number(credits._sum.montant?.toString() ?? 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="Taxe sur les contrats d'assurance" description="Taxe due sur tout ce qui est encaissé, déjà payée, et ce qui reste à déclarer et à payer pour un mois." />
      <AvertissementTaxe />
      <OngletsTaxe actif="calcul" mois={mois} />

      <form method="get" className="flex flex-wrap items-end gap-3" data-choix-mois>
        <div className="w-full sm:w-56">
          <Input name="mois" label="Mois" type="month" defaultValue={mois.slice(0, 7)} />
        </div>
        <Button type="submit" variant="secondary">
          Afficher
        </Button>
        <p className="text-sm text-muted-foreground">
          Déclaration et paiement avant le <strong>{formaterDateCpt(new Date(`${dateLimite}T00:00:00.000Z`))}</strong>.
        </p>
      </form>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-calcul-mois>
        <StatCard icon="scroll-text" label="Taxe due cumulée" value={`${montant(c.montantDu)} FCFA`} hint="Tous les mois jusqu'à celui-ci, corrections comprises" tone="neutral" />
        <StatCard icon="wallet" label="Déjà payée" value={`${montant(c.montantDejaPaye)} FCFA`} hint="Déclarations antérieures (quittance si payée)" tone="neutral" />
        <StatCard icon="alert-triangle" label="À payer" value={<span data-a-payer>{`${montant(c.montantAPayer)} FCFA`}</span>} hint={`${c.nbLignesDuMois} ligne(s) de taxe ce mois-ci`} tone={c.montantAPayer > BigInt(0) ? "warning" : "success"} />
        <StatCard icon="trending-up" label="Crédit à reporter" value={<span data-credit-calcule>{`${montant(c.credit)} FCFA`}</span>} hint={`Dont corrections : ${montant(c.corrections)} FCFA`} tone={c.credit > BigInt(0) ? "info" : "neutral"} />
      </section>
      <p className="text-sm text-muted-foreground" data-formule-mois>
        À payer = taxe due cumulée − taxe déjà payée (quittances). Un trop-payé est reporté sur le mois suivant : le cumul le déduit lui-même, il n&apos;est jamais déduit deux fois.
        {creditOuvert > 0 && <> Crédit en attente de récupération : {formaterMontantCpt(creditOuvert)} FCFA.</>}
      </p>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-elevated" data-declaration>
        <h2 className="text-base font-bold text-foreground">Déclaration du mois</h2>
        {declaration ? (
          <div className="space-y-3 text-sm" data-declaration-existante>
            <p>
              <strong data-reference-declaration>{declaration.reference}</strong> · déclarée le {formaterDateHeureCpt(declaration.declareAt)} · <Badge variant={declaration.statut === "PAYEE" ? "success" : "warning"}>{declaration.statut === "PAYEE" ? "Payée" : "À payer"}</Badge>
            </p>
            <p className="tabular-nums">
              Due {formaterMontantCpt(declaration.montantDu.toString())} − déjà payée {formaterMontantCpt(declaration.montantDejaPaye.toString())} = <strong>{formaterMontantCpt(declaration.montantAPayer.toString())} FCFA</strong> ({declaration.nbLignes} ligne(s) verrouillée(s)).
            </p>
            {declaration.statut === "PAYEE" ? (
              <p data-quittance>
                Quittance <strong>{declaration.quittanceNumero}</strong> du {formaterDateCpt(declaration.quittanceDate)} : {formaterMontantCpt(declaration.quittanceMontant?.toString())} FCFA, payée le {formaterDateCpt(declaration.datePaiement)}
                {declaration.pieceOdoo ? ` · pièce ${declaration.pieceOdoo}` : ""}.
              </p>
            ) : peutPayer ? (
              <PaiementForm declarationId={declaration.id} montantAPayer={declaration.montantAPayer.toFixed(2)} aujourdhui={aujourdhui} />
            ) : (
              <p className="text-muted-foreground">Le paiement est enregistré par un compte qui porte « enregistrer le paiement de la taxe ».</p>
            )}
          </div>
        ) : peutDeclarer ? (
          <DeclarerMoisBouton mois={mois} raison={etat.refus} />
        ) : (
          <p className="text-sm text-muted-foreground" data-declaration-lecture>
            Seul un compte qui porte « déclarer la taxe du mois » peut déclarer. {etat.refus ?? ""}
          </p>
        )}
      </section>

      <section className="space-y-3" data-taux-manquants>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-foreground">Taux manquant ({manquants.total})</h2>
          {peutDeclarer && manquants.total > 0 && <RattraperBouton />}
        </div>
        <p className="text-sm text-muted-foreground">
          Rattachements validés pour lesquels aucun taux de TCA ne s&apos;applique (ni sur le contrat, ni au référentiel à la date de valeur) : aucune taxe n&apos;est calculée, jamais un zéro deviné. Saisissez le taux dans les référentiels puis recalculez ; le mois ne se déclare pas tant qu&apos;il en reste.
        </p>
        {manquants.total === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-4 text-center text-sm text-muted-foreground" data-taux-manquants-vide>
            Aucun taux manquant.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="min-w-full divide-y divide-border">
              <thead>
                <tr>
                  <th className={TH}>Police</th>
                  <th className={TH}>Produit</th>
                  <th className={TH}>Encaissement</th>
                  <th className={TH}>Valeur</th>
                  <th className={`${TH} text-right`}>Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {manquants.lignes.map((l) => (
                  <tr key={l.rattachementId} data-taux-manquant={l.numPolice}>
                    <td className={TD}>{l.numPolice}</td>
                    <td className={TD}>{l.produit}</td>
                    <td className={TD}>{l.encaissementReference}</td>
                    <td className={TD}>{l.dateValeur}</td>
                    <td className={`${TD} text-right`}>{formaterMontantCpt(l.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {peutTaxer && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-elevated" data-section-avance>
          <h2 className="text-base font-bold text-foreground">Taxer un encaissement avant son rattachement</h2>
          <p className="text-sm text-muted-foreground">
            Pour un encaissement sans contrat dont on connaît le produit, ou dont le contrat n&apos;est pas encore rattaché : la taxe contenue est calculée et déclarée dans le mois. Au rattachement, elle est imputée et jamais redemandée.
          </p>
          <AvanceForm />
        </section>
      )}

      <section className="space-y-3" data-historique-declarations>
        <h2 className="text-base font-bold text-foreground">Déclarations</h2>
        {declarations.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-4 text-center text-sm text-muted-foreground">Aucune déclaration pour l&apos;instant.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="min-w-full divide-y divide-border">
              <thead>
                <tr>
                  <th className={TH}>Déclaration</th>
                  <th className={TH}>Mois</th>
                  <th className={`${TH} text-right`}>À payer</th>
                  <th className={TH}>Statut</th>
                  <th className={TH}>Quittance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {declarations.map((d) => (
                  <tr key={d.id} data-declaration-ligne={d.reference}>
                    <td className={TD}>{d.reference}</td>
                    <td className={TD}>{d.mois.toISOString().slice(0, 7)}</td>
                    <td className={`${TD} text-right`}>{formaterMontantCpt(d.montantAPayer.toString())}</td>
                    <td className={TD}>{d.statut === "PAYEE" ? "Payée" : "À payer"}</td>
                    <td className={TD}>{d.quittanceNumero ?? "—"}</td>
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

