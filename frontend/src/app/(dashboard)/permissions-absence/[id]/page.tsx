import { notFound, redirect } from "next/navigation";

import { Badge, Card, PageHeader } from "@/components/ui";
import { FriseAbsence } from "@/components/conges/FriseAbsence";
import { VARIANTE_STATUT_ABSENCE } from "@/components/conges/statutAbsence";
import { DecisionAbsence } from "@/components/conges/DecisionAbsence";
import { getSession } from "@/lib/auth";
import { frDateColonne, frDateHeure } from "@/lib/conges/format";
import { chargerDemandePermission } from "@/lib/absences/lecture";
import { LIBELLE_STATUT_ABSENCE, calculerEcartRetour, formatMinutesEnHeures } from "backend";

import { annulerPermissionAction, approuverPermissionAction, rejeterPermissionAction } from "../actions";
import { DerogationPlafond, RetourReel } from "./ActionsPermission";

const LIBELLE_ACTION: Record<string, string> = {
  soumission: "Demande déposée",
  approbation_responsable: "Approuvée par le responsable du service",
  accord_rh: "Accordée par la RH",
  accord_par_repli: "Accordée (la RH a décidé à la place du responsable)",
  rejet: "Rejetée",
  annulation: "Annulée",
  retour_marque: "Retour enregistré",
  rappel: "Rappel envoyé",
};

export default async function DetailPermissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await chargerDemandePermission(id, session);
  if (!data) notFound();
  const { demande: d, statut, actions, frise, historique, decideurLibelle, estDemandeur, derogation, peutMarquerRetour } = data;

  // Le demandeur ne voit que l'annulation de SA demande ; les autres comptes voient les boutons tant qu'une décision
  // est attendue, ou l'annulation d'une permission accordée si leur rôle le permet.
  const afficherDecision = estDemandeur ? actions.annuler === null : decideurLibelle !== null || actions.annuler === null;
  const ecart = d.heureRetourReelle ? calculerEcartRetour(d.heureRetourPrevue, d.heureRetourReelle) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${d.typePermission.label} — ${d.reference}`}
        description={`Demandée par ${d.user.fullName}${d.user.service ? ` (${d.user.service.name})` : ""}`}
        actions={<Badge variant={VARIANTE_STATUT_ABSENCE[statut]}>{LIBELLE_STATUT_ABSENCE[statut]}</Badge>}
      />

      <FriseAbsence etapes={frise} />

      {decideurLibelle ? (
        <p className="text-sm text-muted-foreground">
          En attente de : <span className="font-semibold text-foreground">{decideurLibelle}</span>.
        </p>
      ) : null}

      {statut === "REJETEE" && d.motifRejet ? (
        <p className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">Motif du rejet : {d.motifRejet}</p>
      ) : null}
      {statut === "ANNULEE" && d.motifAnnulation ? (
        <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">Motif de l&apos;annulation : {d.motifAnnulation}</p>
      ) : null}

      <Card className="space-y-3 p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Date">{frDateColonne(d.date)}</Info>
          <Info label="Horaire">
            de {d.heureDepart} à {d.heureRetourPrevue} ({formatMinutesEnHeures(d.dureeMinutes)})
          </Info>
          <Info label="Maximum pour ce type">{d.typePermission.dureeMaxHeures} h</Info>
          <Info label="Plafond mensuel du type">{d.typePermission.plafondMensuel} par mois</Info>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motif</dt>
            <dd className="mt-1 whitespace-pre-wrap text-foreground">{d.motif}</dd>
          </div>
          {d.approuvePar ? <Info label="Approuvée par le responsable">{d.approuvePar.fullName}{d.approuveAt ? `, le ${frDateHeure(d.approuveAt)}` : ""}</Info> : null}
          {d.validePar ? <Info label="Accordée par">{d.validePar.fullName}{d.valideAt ? `, le ${frDateHeure(d.valideAt)}` : ""}</Info> : null}
          {d.annulePar ? <Info label="Annulée par">{d.annulePar.fullName}{d.annuleAt ? `, le ${frDateHeure(d.annuleAt)}` : ""}</Info> : null}
          {d.motifExceptionPlafond ? <Info label="Dérogation au plafond mensuel">{d.motifExceptionPlafond}</Info> : null}
          {d.heureRetourReelle ? (
            <Info label="Retour réel">
              {d.heureRetourReelle}
              {ecart?.depassement ? <span className="font-medium text-warning"> — {ecart.minutesEcart} min après l&apos;heure prévue</span> : " — dans les temps"}
            </Info>
          ) : null}
        </dl>
      </Card>

      {peutMarquerRetour ? (
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-bold text-foreground">Retour</h2>
          <p className="text-sm text-muted-foreground">Indiquez l&apos;heure à laquelle {estDemandeur ? "vous êtes" : "le collaborateur est"} revenu. La permission devient alors consommée.</p>
          <RetourReel demandeId={d.id} heureRetourPrevue={d.heureRetourPrevue} />
        </Card>
      ) : null}

      {derogation ? (
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-bold text-foreground">Accord avec dérogation</h2>
          <DerogationPlafond demandeId={d.id} utilise={derogation.utilise} plafond={derogation.plafond} />
        </Card>
      ) : null}

      {afficherDecision ? (
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-bold text-foreground">Décision</h2>
          <DecisionAbsence
            demandeId={d.id}
            possibles={actions}
            seulementAnnuler={estDemandeur}
            actions={{ approuver: approuverPermissionAction, rejeter: rejeterPermissionAction, annuler: annulerPermissionAction }}
          />
        </Card>
      ) : null}

      <section aria-label="Historique" className="space-y-2">
        <h2 className="text-base font-bold text-foreground">Historique</h2>
        <ol className="space-y-2 border-l-2 border-border pl-4">
          {historique.map((h) => (
            <li key={h.id} className="text-sm">
              <p className="font-semibold text-foreground">{LIBELLE_ACTION[h.action] ?? h.action}</p>
              <p className="text-xs text-muted-foreground">
                {h.user.fullName} · {frDateHeure(h.createdAt)}
              </p>
              {h.detail ? <p className="text-muted-foreground">{h.detail}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-foreground">{children}</dd>
    </div>
  );
}
