import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { LIBELLE_STATUT_JUSTIFICATION, dateCourte, descriptionAnomalie, presentationCollaborateur } from "backend";
import {
  chargerComptesRH,
  chargerJustificationsDecideur,
  decideurDuCollaborateur,
  estDecideurJustifications,
  type JustificationAvecContexte,
} from "@/lib/justificationsPointage";
import { VARIANTE_STATUT_JUSTIFICATION } from "@/components/pointage/justificationStatut";

import { DecisionJustification } from "./DecisionJustification";

/**
 * File des justifications à décider (Pointage V2, lot 4) : celles dont le compte est le décideur ACTUEL — responsable
 * du service du collaborateur, ou RH du pointage quand il n'y a pas de responsable utilisable. Onglet « Traitées » en
 * lecture seule (décisions prises par ce compte, ou portant sur des collaborateurs dont il est aujourd'hui décideur).
 */
export default async function JustificationsPage({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await estDecideurJustifications(session))) redirect("/?error=acces_refuse_justifications");

  const { onglet } = await searchParams;
  const traitees = onglet === "traitees";

  const [aTraiter, dejaTraitees, comptesRH] = await Promise.all([
    chargerJustificationsDecideur(session, ["SOUMISE"]),
    traitees
      ? chargerJustificationsDecideur(session, ["ACCEPTEE", "REFUSEE"], { inclureDecideesPar: true, ordre: "desc", limite: 300 })
      : Promise.resolve([]),
    chargerComptesRH(),
  ]);

  const lignes = traitees ? dejaTraitees.slice(0, 100) : aTraiter;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Justifications à traiter"
        description="Retards et départs anticipés justifiés par les collaborateurs dont vous êtes le décideur. Les plus anciennes en premier."
      />

      <nav className="flex gap-2 border-b border-border" aria-label="Onglets">
        <Onglet href="/pointage/justifications" actif={!traitees}>
          À traiter ({aTraiter.length})
        </Onglet>
        <Onglet href="/pointage/justifications?onglet=traitees" actif={traitees}>
          Traitées
        </Onglet>
      </nav>

      {lignes.length === 0 ? (
        <EmptyState
          icon="check-circle"
          message={traitees ? "Aucune justification traitée pour le moment." : "Aucune justification à traiter : vous êtes à jour."}
        />
      ) : (
        <ul className="space-y-4">
          {lignes.map((j) => (
            <li key={j.id}>
              <CarteJustification justification={j} lectureSeule={traitees} comptesRH={comptesRH} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Onglet({ href, actif, children }: { href: string; actif: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={actif ? "page" : undefined}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        actif ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

function CarteJustification({
  justification: j,
  lectureSeule,
  comptesRH,
}: {
  justification: JustificationAvecContexte;
  lectureSeule: boolean;
  comptesRH: readonly string[];
}) {
  const collaborateur = j.pointage.user;
  const decideur = decideurDuCollaborateur(collaborateur, comptesRH);
  const serviceNom = collaborateur.service?.name ?? null;
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-foreground">
            {presentationCollaborateur(collaborateur.fullName, serviceNom, decideur).replace(/,$/, "")}
          </p>
          <p className="text-xs text-muted-foreground">
            {serviceNom ? `Service ${serviceNom}` : "Aucun service"}
            {decideur.type === "RH"
              ? " · décision RH"
              : decideur.type === "DG"
                ? " · décision DG (aucun autre compte RH)"
                : ""}
          </p>
        </div>
        <Badge variant={VARIANTE_STATUT_JUSTIFICATION[j.statut]}>{LIBELLE_STATUT_JUSTIFICATION[j.statut]}</Badge>
      </div>
      <p className="text-sm text-foreground">
        {descriptionAnomalie(j.pointage).replace(/^./, (c) => c.toUpperCase())}
      </p>
      <blockquote className="rounded-lg border border-border bg-app-bg p-3 text-sm text-foreground">
        « {j.motif} »
        {j.soumiseAt ? (
          <span className="mt-1 block text-xs text-muted-foreground">Envoyée le {dateCourte(j.soumiseAt)}</span>
        ) : null}
      </blockquote>
      {lectureSeule ? (
        <p className="text-sm text-muted-foreground">
          {j.statut === "ACCEPTEE" ? "Acceptée" : "Refusée"}
          {j.decideur ? ` par ${j.decideur.fullName}` : ""}
          {j.decisionAt ? ` le ${dateCourte(j.decisionAt)}` : ""}
          {j.statut === "REFUSEE" && j.motifRefus ? `. Motif : ${j.motifRefus}` : "."}
        </p>
      ) : (
        <DecisionJustification justificationId={j.id} />
      )}
    </Card>
  );
}
