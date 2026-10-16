import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { FriseAbsence } from "@/components/conges/FriseAbsence";
import { VARIANTE_STATUT_ABSENCE } from "@/components/conges/statutAbsence";
import { DecisionAbsence } from "@/components/conges/DecisionAbsence";
import { getSession } from "@/lib/auth";
import { frDateColonne, frDateHeure, libelleJours } from "@/lib/conges/format";
import { chargerDemandeConge } from "@/lib/conges/lecture";
import { LIBELLE_DECOMPTE_CONGE, LIBELLE_STATUT_ABSENCE } from "backend";

import { ObservationsAbsence } from "@/components/conges/ObservationsAbsence";
import { ObservationDGForm } from "@/components/conges/ObservationDGForm";

import { ajouterObservationCongeAction, annulerCongeAction, approuverCongeAction, demanderModificationCongeAction, rejeterCongeAction } from "../actions";

const LIBELLE_ACTION: Record<string, string> = {
  soumission: "Demande déposée",
  approbation_responsable: "Approuvée par le responsable du service",
  accord_rh: "Validée par la RH",
  accord_par_repli: "Validée (la RH a décidé à la place du responsable)",
  rejet: "Rejetée",
  demande_modification: "Modification demandée",
  resoumission: "Demande modifiée et renvoyée",
  annulation: "Annulée",
  conge_office: "Congé accordé d'office par la RH",
  rappel: "Rappel envoyé",
  observation: "Observation ajoutée",
};

export default async function DetailCongePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await chargerDemandeConge(id, session);
  if (!data) notFound();
  const { demande: d, statut, actions, frise, historique, decideurLibelle, estDemandeur, observations, peutObserverDG } = data;

  // Le demandeur ne voit que l'annulation de SA demande (jamais des boutons de décision grisés) ; les autres comptes voient
  // les boutons tant qu'une décision est attendue, ou l'annulation d'une absence validée si leur rôle le permet.
  const afficherDecision = estDemandeur ? actions.annuler === null : decideurLibelle !== null || actions.annuler === null;
  const peutResoumettre = estDemandeur && statut === "MODIFICATION_DEMANDEE";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${d.typeConge.label} — ${d.reference}`}
        description={`Demandé par ${d.user.fullName}${d.user.service ? ` (${d.user.service.name})` : ""}`}
        actions={<Badge variant={VARIANTE_STATUT_ABSENCE[statut]}>{LIBELLE_STATUT_ABSENCE[statut]}</Badge>}
      />

      <FriseAbsence etapes={frise} />

      {decideurLibelle ? (
        <p className="text-sm text-muted-foreground">
          En attente de : <span className="font-semibold text-foreground">{decideurLibelle}</span>.
        </p>
      ) : null}

      {statut === "MODIFICATION_DEMANDEE" && d.motifModification ? (
        <p className="rounded-lg border border-info-border bg-info-bg px-4 py-3 text-sm text-info">Modification demandée : {d.motifModification}</p>
      ) : null}
      {statut === "REJETEE" && d.motifRejet ? (
        <p className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">Motif du rejet : {d.motifRejet}</p>
      ) : null}
      {statut === "ANNULEE" && d.motifAnnulation ? (
        <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">Motif de l&apos;annulation : {d.motifAnnulation}</p>
      ) : null}

      <Card className="space-y-3 p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Période">
            du {frDateColonne(d.dateDebut)} au {frDateColonne(d.dateFin)}
          </Info>
          <Info label="Jours décomptés">
            {libelleJours(d.nbJours)} ({LIBELLE_DECOMPTE_CONGE[d.typeConge.decompteType]})
          </Info>
          <Info label="Impact sur le solde">
            {d.typeConge.nonDeductibleSolde ? "Non déduit du solde annuel" : d.joursDebites > 0 ? `${libelleJours(d.joursDebites)} débité(s)` : "Sera débité à la validation"}
          </Info>
          <Info label="Intérimaire">{d.interimaire ?? "—"}</Info>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motif</dt>
            <dd className="mt-1 whitespace-pre-wrap text-foreground">{d.motif}</dd>
          </div>
          {d.approuvePar ? <Info label="Approuvée par le responsable">{d.approuvePar.fullName}{d.approuveAt ? `, le ${frDateHeure(d.approuveAt)}` : ""}</Info> : null}
          {d.validePar ? <Info label="Validée par">{d.validePar.fullName}{d.valideAt ? `, le ${frDateHeure(d.valideAt)}` : ""}</Info> : null}
          {d.annulePar ? <Info label="Annulée par">{d.annulePar.fullName}{d.annuleAt ? `, le ${frDateHeure(d.annuleAt)}` : ""}</Info> : null}
        </dl>

        {d.piecesJointes.length > 0 ? (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pièces justificatives</p>
            <ul className="mt-2 space-y-1">
              {d.piecesJointes.map((p) => (
                <li key={p.id}>
                  <a href={`/api/conges/pieces-jointes/${p.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
                    {p.nomFichier ?? "Pièce jointe"}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {peutResoumettre ? (
        <Card className="space-y-3 p-5">
          <p className="text-sm text-foreground">Corrigez votre demande puis renvoyez-la : elle repartira du début du circuit.</p>
          <Link href={`/conges/${d.id}/modifier`}>
            <Button variant="primary">Modifier et renvoyer</Button>
          </Link>
        </Card>
      ) : null}

      {afficherDecision ? (
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-bold text-foreground">Décision</h2>
          <DecisionAbsence
            demandeId={d.id}
            possibles={actions}
            seulementAnnuler={estDemandeur}
            actions={{
              approuver: approuverCongeAction,
              rejeter: rejeterCongeAction,
              demanderModification: demanderModificationCongeAction,
              annuler: annulerCongeAction,
            }}
          />
        </Card>
      ) : null}

      <ObservationsAbsence
        observations={observations}
        formulaire={peutObserverDG ? <ObservationDGForm demandeId={d.id} ajouter={ajouterObservationCongeAction} /> : undefined}
      />

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
