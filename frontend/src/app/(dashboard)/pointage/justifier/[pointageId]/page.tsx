import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { Badge, Card, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import {
  LIBELLE_STATUT_JUSTIFICATION,
  dateCourte,
  heureCourte,
  libelleDecideur,
  peutSoumettreJustification,
  prisma,
} from "backend";
import { SELECT_COLLABORATEUR_JUSTIFICATION, chargerComptesRH, decideurDuCollaborateur } from "@/lib/justificationsPointage";
import { VARIANTE_STATUT_JUSTIFICATION } from "@/components/pointage/justificationStatut";

import { JustificationForm } from "./JustificationForm";

/**
 * Justification d'un retard ou d'un départ anticipé (Pointage V2, lot 4) : c'est la cible du lien envoyé par email,
 * push et notification interne. Réservée au propriétaire du pointage (`pointage.pointer`) ; un visiteur non connecté
 * passe par `/login` puis revient ici (callbackUrl posé par le middleware).
 */
export default async function JustifierPointagePage({ params }: { params: Promise<{ pointageId: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pointage.pointer")) redirect("/?error=acces_refuse_pointer");

  const { pointageId } = await params;
  const pointage = await prisma.pointage.findUnique({
    where: { id: pointageId },
    select: {
      id: true,
      userId: true,
      type: true,
      heure: true,
      heurePrevue: true,
      minutesRetard: true,
      justification: { include: { decideur: { select: { fullName: true } } } },
      user: { select: SELECT_COLLABORATEUR_JUSTIFICATION },
    },
  });
  // Le pointage d'un autre compte est introuvable pour ce compte.
  if (!pointage || pointage.userId !== session.user.id) notFound();

  const j = pointage.justification;
  const decideur = decideurDuCollaborateur(pointage.user, await chargerComptesRH());
  const responsableNom = pointage.user.service?.responsable?.fullName ?? null;
  const estArrivee = pointage.type === "ARRIVEE";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title={estArrivee ? "Justifier mon retard" : "Justifier mon départ anticipé"}
        description="Expliquez la raison de ce pointage. Votre justification sera examinée puis acceptée ou refusée."
      />

      <Card className="space-y-4 p-5 sm:p-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Date</dt>
            <dd className="font-bold text-foreground">{dateCourte(pointage.heure)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{estArrivee ? "Heure d'arrivée" : "Heure de départ"}</dt>
            <dd className="font-bold text-foreground tabular-nums">
              {heureCourte(pointage.heure)}
              {pointage.heurePrevue ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">(prévu {pointage.heurePrevue})</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{estArrivee ? "Retard" : "Type"}</dt>
            <dd className="font-bold text-foreground">
              {estArrivee ? `${pointage.minutesRetard ?? 0} min` : "Départ anticipé"}
            </dd>
          </div>
        </dl>

        {j ? (
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Statut :</span>
              <Badge variant={VARIANTE_STATUT_JUSTIFICATION[j.statut]}>{LIBELLE_STATUT_JUSTIFICATION[j.statut]}</Badge>
            </div>
            {j.motif ? (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Votre motif : </span>
                {j.motif}
              </p>
            ) : null}
            {j.statut === "REFUSEE" ? (
              <p className="rounded-lg border border-danger-border bg-danger-bg p-3 text-sm text-danger">
                Refusée{j.decideur ? ` par ${j.decideur.fullName}` : ""}
                {j.decisionAt ? ` le ${dateCourte(j.decisionAt)}` : ""}. Motif du refus : {j.motifRefus}
              </p>
            ) : null}
            {j.statut === "ACCEPTEE" ? (
              <p className="text-sm text-success">
                Acceptée{j.decideur ? ` par ${j.decideur.fullName}` : ""}
                {j.decisionAt ? ` le ${dateCourte(j.decisionAt)}` : ""}.
              </p>
            ) : null}
            {j.statut === "SOUMISE" ? (
              <p className="text-sm text-muted-foreground">
                En attente de la décision de {libelleDecideur(decideur, responsableNom)}.
              </p>
            ) : null}
            {j.statut === "NON_JUSTIFIEE" ? (
              <p className="text-sm text-warning">
                La journée s&apos;est terminée sans justification : vous pouvez encore l&apos;envoyer.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            Aucune justification n&apos;est demandée pour ce pointage.
          </p>
        )}
      </Card>

      {j && peutSoumettreJustification(j.statut) ? (
        <Card className="p-5 sm:p-6">
          <JustificationForm pointageId={pointage.id} decideurLibelle={libelleDecideur(decideur, responsableNom)} />
        </Card>
      ) : null}

      <Link href="/pointage/historique" className="text-sm font-medium text-primary hover:underline">
        ← Retour à mon historique
      </Link>
    </div>
  );
}
