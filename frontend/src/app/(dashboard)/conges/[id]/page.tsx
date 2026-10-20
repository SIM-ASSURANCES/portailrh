import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { DecisionConge } from "@/components/conges/DecisionConge";
import { FriseConge } from "@/components/conges/FriseConge";
import { VARIANTE_STATUT_CONGE } from "@/components/conges/statutConge";
import { getSession } from "@/lib/auth";
import { frDate, frDateHeure, libelleJours } from "@/lib/conges/format";
import { chargerDetailConge } from "@/lib/conges/lecture";
import { LIBELLE_NATURE_CONGE, LIBELLE_STATUT_CONGE } from "backend";

const LIBELLE_ACTION: Record<string, string> = {
  soumission: "Demande déposée",
  approbation_responsable: "Approuvée par le responsable du service",
  accord_rh: "Validée par la RH",
  accord_par_repli: "Validée par le décideur de repli",
  rejet: "Rejetée",
  demande_modification: "Modification demandée",
  resoumission: "Demande modifiée et renvoyée",
  annulation: "Annulée",
  saisie_rh: "Congé enregistré par la RH",
  jours_passes: "Traitement des jours déjà passés",
};

export default async function DetailCongePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await chargerDetailConge(id, session);
  if (!data) notFound();

  const { demande, statut, actions, frise, historique, decideurLibelle, estEtapeRH, joursPasses, estDemandeur } = data;
  const peutResoumettre = estDemandeur && statut === "MODIFICATION_DEMANDEE";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${LIBELLE_NATURE_CONGE[demande.nature]} — ${demande.reference}`}
        description={`Demandé par ${demande.user.fullName}${demande.user.service ? ` (${demande.user.service.name})` : ""}`}
        actions={
          <Badge variant={VARIANTE_STATUT_CONGE[statut]}>{LIBELLE_STATUT_CONGE[statut]}</Badge>
        }
      />

      <FriseConge etapes={frise} />

      {decideurLibelle ? (
        <p className="text-sm text-muted-foreground">
          En attente de : <span className="font-semibold text-foreground">{decideurLibelle}</span>.
        </p>
      ) : null}

      {statut === "MODIFICATION_DEMANDEE" && demande.motifModification ? (
        <p className="rounded-lg border border-info-border bg-info-bg px-4 py-3 text-sm text-info">
          Modification demandée : {demande.motifModification}
        </p>
      ) : null}
      {statut === "REJETEE" && demande.motifRejet ? (
        <p className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
          Motif du refus : {demande.motifRejet}
        </p>
      ) : null}
      {statut === "ANNULEE" && demande.motifAnnulation ? (
        <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
          Motif de l’annulation : {demande.motifAnnulation}
        </p>
      ) : null}

      <Card className="space-y-4 p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <Info label="Nature">{LIBELLE_NATURE_CONGE[demande.nature]}</Info>
          <Info label="Période">
            Du {frDate(demande.dateDebut)} au {frDate(demande.dateFin)}
          </Info>
          <Info label="Jours ouvrés">{libelleJours(demande.nbJoursOuvres)} (lundi à vendredi, hors jours fériés)</Info>
          <Info label="Demandeur">{demande.user.fullName}</Info>
          <Info label="Déposée le">{frDateHeure(demande.createdAt)}</Info>
          {demande.saisieParRH ? <Info label="Saisie">Saisi par la RH</Info> : null}
          {demande.saisieParRH ? <Info label="Saisi par">{demande.creePar.fullName}</Info> : null}
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motif</dt>
            <dd className="mt-1 whitespace-pre-wrap text-foreground">{demande.motif}</dd>
          </div>
          {demande.observationRH ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observation RH</dt>
              <dd className="mt-1 whitespace-pre-wrap text-foreground">{demande.observationRH}</dd>
            </div>
          ) : null}
          {demande.approuvePar ? (
            <Info label="Approuvée par le responsable">
              {demande.approuvePar.fullName}
              {demande.approuveAt ? `, le ${frDateHeure(demande.approuveAt)}` : ""}
            </Info>
          ) : null}
          {demande.validePar ? (
            <Info label="Décision RH">
              {demande.validePar.fullName}
              {demande.valideAt ? `, le ${frDateHeure(demande.valideAt)}` : ""}
            </Info>
          ) : null}
          {demande.annulePar ? (
            <Info label="Annulée par">
              {demande.annulePar.fullName}
              {demande.annuleAt ? `, le ${frDateHeure(demande.annuleAt)}` : ""}
            </Info>
          ) : null}
        </dl>
      </Card>

      {peutResoumettre ? (
        <Card className="space-y-3 p-5">
          <p className="text-sm text-foreground">
            Corrigez votre demande puis renvoyez-la. Le circuit repartira du début.
          </p>
          <Link href={`/conges/${demande.id}/modifier`}>
            <Button variant="primary">Modifier et renvoyer</Button>
          </Link>
        </Card>
      ) : null}

      <DecisionConge
        demandeId={demande.id}
        actions={actions}
        estEtapeRH={estEtapeRH}
        joursPassesProteges={joursPasses}
      />

      <section aria-label="Historique" className="space-y-2">
        <h2 className="text-base font-bold text-foreground">Historique</h2>
        {historique.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun événement enregistré.</p>
        ) : (
          <ol className="space-y-3 border-l-2 border-border pl-4">
            {historique.map((entry) => (
              <li key={entry.id} className="text-sm">
                <p className="font-semibold text-foreground">{LIBELLE_ACTION[entry.action] ?? entry.action}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.user.fullName} · {frDateHeure(entry.createdAt)}
                </p>
                {entry.detail ? <p className="whitespace-pre-wrap text-muted-foreground">{entry.detail}</p> : null}
              </li>
            ))}
          </ol>
        )}
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
