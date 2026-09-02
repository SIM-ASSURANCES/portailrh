import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { PointagesRHFilters } from "./PointagesRHFilters";
import { PointagesRHTables, type PointageRHRow } from "./PointagesRHTables";
import { Icon } from "@/components/icons";

export const metadata = {
  title: "Tous les pointages - Portail SIM Assurances",
};

interface PointagesRHPageProps {
  searchParams: Promise<{
    du?: string;
    au?: string;
    type?: string;
    userId?: string;
  }>;
}

export default async function PointagesRHPage({ searchParams }: PointagesRHPageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  
  // Vérification de la permission pour consulter tous les pointages
  if (!hasPermission(session, "pointage.consulter_tous") && !hasPermission(session, "pointage.voir_dashboard_rh")) {
     redirect("/?error=acces_refuse");
  }

  const { du, au, type, userId } = await searchParams;

  // Construction des bornes de dates
  let dateDebut: Date | undefined = undefined;
  let dateFin: Date | undefined = undefined;

  if (du) {
    const d = new Date(du);
    d.setHours(0, 0, 0, 0);
    dateDebut = d;
  }

  if (au) {
    const d = new Date(au);
    d.setHours(23, 59, 59, 999);
    dateFin = d;
  }

  // Filtre Prisma pour les Pointages
  const pointageWhere: Record<string, unknown> = {};

  if (userId) {
    pointageWhere.userId = userId;
  }

  if (dateDebut || dateFin) {
    pointageWhere.heure = {
      ...(dateDebut ? { gte: dateDebut } : {}),
      ...(dateFin ? { lte: dateFin } : {}),
    };
  }

  if (type === "ARRIVEE") {
    pointageWhere.type = "ARRIVEE";
  } else if (type === "DEPART") {
    pointageWhere.type = "DEPART";
  } else if (type === "RETARD") {
    pointageWhere.estRetard = true;
  }

  // Récupération des données
  const [pointagesDb, usersDb] = await Promise.all([
    prisma.pointage.findMany({
      where: pointageWhere,
      orderBy: { heure: "desc" },
      include: {
        user: { select: { fullName: true } },
        effectuePar: { select: { fullName: true } },
        corrections: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  // Formatage sérialisable des lignes de pointage
  const pointages: PointageRHRow[] = pointagesDb.map((p) => ({
    id: p.id,
    heure: p.heure.toISOString(),
    type: p.type,
    source: p.source,
    estRetard: p.estRetard,
    minutesRetard: p.minutesRetard,
    motif: p.motif,
    collaborateurNom: p.user.fullName,
    effectueParNom: p.effectuePar?.fullName ?? null,
    correctionsCount: p.corrections.length,
    dernierMotifCorrection: p.corrections[0]?.motif ?? null,
    ipAddress: p.ipAddress ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Consultation des pointages"
        description="Vue globale de tous les pointages (arrivées, départs) de l'ensemble des collaborateurs."
        backHref="/pointage/rh"
        backLabel="Retour à la Boîte à Outils"
      />

      <PointagesRHFilters
        initial={{ du, au, type, userId }}
        users={usersDb}
      />

      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="file-text" className="size-5 text-primary" />
            <h2 className="text-base font-bold text-foreground">
              Pointages ({pointages.length})
            </h2>
          </div>
          {pointages.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              Trié par date décroissante
            </span>
          ) : null}
        </div>

        <PointagesRHTables pointages={pointages} />
      </div>
    </div>
  );
}
