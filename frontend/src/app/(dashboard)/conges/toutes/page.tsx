import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { VARIANTE_STATUT_CONGE } from "@/components/conges/statutConge";
import { getSession } from "@/lib/auth";
import { frDate, libelleJours } from "@/lib/conges/format";
import { listerTousConges } from "@/lib/conges/lecture";
import {
  LIBELLE_NATURE_CONGE,
  LIBELLE_STATUT_CONGE,
  parseJourCivil,
  type StatutCircuitConge,
} from "backend";

const STATUTS: StatutCircuitConge[] = [
  "EN_ATTENTE_RESPONSABLE",
  "EN_ATTENTE_RH",
  "MODIFICATION_DEMANDEE",
  "VALIDEE",
  "REJETEE",
  "ANNULEE",
];

export default async function ToutesLesDemandesPage({
  searchParams,
}: {
  searchParams: Promise<{ du?: string; au?: string; statut?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const autorise =
    session.rolePermissions.includes("conges.consulter_tous") ||
    session.rolePermissions.includes("conges.valider_rh");
  if (!autorise) redirect("/?error=acces_refuse_conges");

  const { du, au, statut } = await searchParams;
  const statutValide = STATUTS.find((valeur) => valeur === statut);
  const erreurFiltre =
    (du && !parseJourCivil(du)) ||
    (au && !parseJourCivil(au))
      ? "Les dates doivent être des jours civils valides au format AAAA-MM-JJ."
      : du && au && du > au
        ? "La date de début du filtre ne peut pas dépasser sa date de fin."
        : null;

  const demandes = erreurFiltre
    ? []
    : await listerTousConges({
        ...(du ? { du } : {}),
        ...(au ? { au } : {}),
        ...(statutValide ? { statut: statutValide } : {}),
      });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Toutes les demandes"
        description="Consultez les demandes de congé, tous services confondus."
      />

      <form method="get" className="grid gap-4 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Du" type="date" name="du" defaultValue={du ?? ""} />
        <Input label="Au" type="date" name="au" defaultValue={au ?? ""} />
        <Select
          label="Statut"
          name="statut"
          defaultValue={statutValide ?? ""}
          options={STATUTS.map((value) => ({ value, label: LIBELLE_STATUT_CONGE[value] }))}
          placeholder="Tous les statuts"
        />
        <div className="flex items-end gap-2">
          <Button type="submit" variant="primary">Filtrer</Button>
          <Link href="/conges/toutes" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground">
            Effacer
          </Link>
        </div>
      </form>

      {erreurFiltre ? (
        <p role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
          {erreurFiltre}
        </p>
      ) : demandes.length === 0 ? (
        <EmptyState icon="calendar" message="Aucune demande ne correspond à ces filtres." />
      ) : (
        <ul className="space-y-3">
          {demandes.map((demande) => (
            <li key={demande.id}>
              <Link href={`/conges/${demande.id}`} className="block">
                <Card className="card-shadow-hover space-y-2 p-4 transition-transform motion-safe:hover:-translate-y-0.5 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-foreground">{demande.user.fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {demande.user.service?.name ?? "Aucun service"} · {demande.reference}
                      </p>
                    </div>
                    <Badge variant={VARIANTE_STATUT_CONGE[demande.statut]}>
                      {LIBELLE_STATUT_CONGE[demande.statut]}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">
                    {LIBELLE_NATURE_CONGE[demande.nature]} · du {frDate(demande.dateDebut)} au{" "}
                    {frDate(demande.dateFin)} · {libelleJours(demande.nbJoursOuvres)}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
