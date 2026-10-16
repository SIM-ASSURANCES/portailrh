import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { VARIANTE_STATUT_ABSENCE } from "@/components/conges/statutAbsence";
import { getSession, hasPermission } from "@/lib/auth";
import { frDateColonne, libelleJours } from "@/lib/conges/format";
import { LIBELLE_STATUT_ABSENCE, PERMISSION_DG_ABSENCE, prisma, type StatutCircuitAbsence } from "backend";

const STATUTS = ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "VALIDEE", "MODIFICATION_DEMANDEE", "REJETEE", "ANNULEE"] as const;
type StatutFiltre = (typeof STATUTS)[number];

/**
 * Toutes les demandes de congé, pour le DG (permission du RÔLE `treso.decider_dg`, sans `consulter_tous`), la RH
 * (`conges.valider_rh`) et qui consulte tout (`conges.consulter_tous`). Lecture seule : le détail porte les actions.
 */
export default async function TouteCongesPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const autorise =
    session.rolePermissions.includes(PERMISSION_DG_ABSENCE) ||
    session.rolePermissions.includes("conges.valider_rh") ||
    hasPermission(session, "conges.consulter_tous");
  if (!autorise) redirect("/?error=acces_refuse_conges");

  const { statut } = await searchParams;
  const filtre = (STATUTS as readonly string[]).includes(statut ?? "") ? (statut as StatutFiltre) : null;

  const demandes = await prisma.demandeConge.findMany({
    where: filtre ? { statut: filtre } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      typeConge: { select: { label: true } },
      user: { select: { fullName: true, service: { select: { name: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Toutes les demandes de congé" description="Les 100 demandes les plus récentes, tous services confondus. Lecture seule : ouvrez une demande pour la décider ou y ajouter une observation." />

      <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-2">
        <FiltreLien href="/conges/toutes" actif={filtre === null}>
          Toutes
        </FiltreLien>
        {STATUTS.map((s) => (
          <FiltreLien key={s} href={`/conges/toutes?statut=${s}`} actif={filtre === s}>
            {LIBELLE_STATUT_ABSENCE[s as StatutCircuitAbsence]}
          </FiltreLien>
        ))}
      </nav>

      {demandes.length === 0 ? (
        <EmptyState icon="calendar" message="Aucune demande de congé pour ce filtre." />
      ) : (
        <ul className="space-y-3" data-section="toutes-les-demandes">
          {demandes.map((d) => (
            <li key={d.id}>
              <Link href={`/conges/${d.id}`} className="block">
                <Card className="card-shadow-hover space-y-2 p-4 transition-transform motion-safe:hover:-translate-y-0.5 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-foreground">{d.user.fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.user.service?.name ?? "Aucun service"} · {d.reference}
                      </p>
                    </div>
                    <Badge variant={VARIANTE_STATUT_ABSENCE[d.statut as StatutCircuitAbsence]}>{LIBELLE_STATUT_ABSENCE[d.statut as StatutCircuitAbsence]}</Badge>
                  </div>
                  <p className="text-sm text-foreground">
                    {d.typeConge.label} · du {frDateColonne(d.dateDebut)} au {frDateColonne(d.dateFin)} · {libelleJours(d.nbJours)}
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

function FiltreLien({ href, actif, children }: { href: string; actif: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={actif ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-sm ${actif ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </Link>
  );
}
