import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";
import { PageHeader, StatCard } from "@/components/ui";
import { HistoriqueFilters } from "./HistoriqueFilters";

import { Icon } from "@/components/icons";
import { AbsencesTable, PointagesTable, type AbsenceRow, type PointageRow } from "./HistoriqueTables";

interface HistoriquePageProps {
  searchParams: Promise<{
    du?: string;
    au?: string;
    type?: string;
  }>;
}

export default async function PointageHistoriquePage({ searchParams }: HistoriquePageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pointage.consulter_historique")) redirect("/?error=acces_refuse_historique");

  const { du, au, type } = await searchParams;

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
  const pointageWhere: Record<string, unknown> = {
    userId: session.user.id,
  };

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

  // Filtre Prisma pour les Absences
  const absenceWhere: Record<string, unknown> = {
    userId: session.user.id,
  };

  if (dateDebut || dateFin) {
    absenceWhere.date = {
      ...(dateDebut ? { gte: dateDebut } : {}),
      ...(dateFin ? { lte: dateFin } : {}),
    };
  }

  const showPointages = type !== "ABSENCE";
  const showAbsences = type === "ALL" || type === "ABSENCE" || !type;

  // Récupération concurrente des données
  const [pointagesDb, absencesDb, allUserPointagesForStats, allUserAbsencesForStats] = await Promise.all([
    showPointages
      ? prisma.pointage.findMany({
        where: pointageWhere,
        orderBy: { heure: "desc" },
        include: {
          effectuePar: { select: { fullName: true } },
          corrections: {
            orderBy: { createdAt: "asc" },
          },
        },
      })
      : Promise.resolve([]),
    showAbsences
      ? prisma.absence.findMany({
        where: absenceWhere,
        orderBy: { date: "desc" },
        include: {
          controlePar: { select: { fullName: true } },
        },
      })
      : Promise.resolve([]),
    // Calcul des statistiques globales sur la période filtrée (sans filtre de type)
    prisma.pointage.findMany({
      where: {
        userId: session.user.id,
        ...(dateDebut || dateFin
          ? {
            heure: {
              ...(dateDebut ? { gte: dateDebut } : {}),
              ...(dateFin ? { lte: dateFin } : {}),
            },
          }
          : {}),
      },
      select: {
        type: true,
        estRetard: true,
        minutesRetard: true,
        heure: true,
      },
    }),
    prisma.absence.findMany({
      where: {
        userId: session.user.id,
        ...(dateDebut || dateFin
          ? {
            date: {
              ...(dateDebut ? { gte: dateDebut } : {}),
              ...(dateFin ? { lte: dateFin } : {}),
            },
          }
          : {}),
      },
      select: {
        statut: true,
      },
    }),
  ]);

  function parseFrenchDate(dateStr: string) {
    const parts = dateStr.split(" ");
    if (parts.length !== 2) return new Date();
    const [day, month, year] = parts[0].split("/");
    const [hours, minutes] = parts[1].split(":");
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
  }

  const pointages: PointageRow[] = [];
  pointagesDb.forEach((p) => {
    // Si le pointage a été corrigé, on ajoute d'abord la ligne d'origine
    if (p.corrections.length > 0) {
      const firstCorrection = p.corrections[0];
      const originalDate = parseFrenchDate(firstCorrection.ancienneValeur);
      
      pointages.push({
        id: p.id + "-original",
        heure: originalDate.toISOString(),
        heurePrevue: p.heurePrevue,
        type: p.type,
        source: p.source,
        estRetard: false, // Inconnu à l'origine (ou on peut le calculer, mais simplifié ici)
        minutesRetard: null,
        motif: "Pointage d'origine avant correction",
        effectueParNom: p.effectuePar?.fullName ?? null,
        correctionsCount: 0,
        dernierMotifCorrection: null,
        isOriginal: true,
        groupId: p.id,
        sortTime: p.heure.toISOString(),
      });
    }

    // Puis on ajoute la ligne actuelle (corrigée ou normale)
    pointages.push({
      id: p.id,
      heure: p.heure.toISOString(),
      heurePrevue: p.heurePrevue,
      type: p.type,
      source: p.source,
      estRetard: p.estRetard,
      minutesRetard: p.minutesRetard,
      motif: p.motif,
      effectueParNom: p.effectuePar?.fullName ?? null,
      correctionsCount: p.corrections.length,
      dernierMotifCorrection: p.corrections.length > 0 ? p.corrections[p.corrections.length - 1].motif : null,
      isOriginal: false,
      groupId: p.id,
      sortTime: p.heure.toISOString(),
    });
  });

  // Formatage sérialisable des lignes d'absence
  const absences: AbsenceRow[] = absencesDb.map((a) => ({
    id: a.id,
    date: a.date.toISOString(),
    statut: a.statut,
    motif: a.motif,
    controleParNom: a.controlePar?.fullName ?? null,
  }));

  // Statistiques
  const retardsList = allUserPointagesForStats.filter((p) => p.estRetard);
  const nombreJoursRetard = retardsList.length;
  const totalMinutesRetard = retardsList.reduce((acc, p) => acc + (p.minutesRetard || 0), 0);
  const totalAbsences = allUserAbsencesForStats.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Mon Historique de Pointage"
        description="Consultez l'ensemble de vos pointages d'arrivée, de départ, vos retards et vos absences."
      />

      {/* Cartes d'indicateurs / KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon="alert-triangle"
          tone={nombreJoursRetard > 0 ? "primary" : "info"}
          label="Jours de retard"
          value={nombreJoursRetard}
          hint={nombreJoursRetard > 0 ? `${totalMinutesRetard} min de retard au total` : "Aucun retard sur la période"}
        />
        <StatCard
          icon="calendar"
          tone={totalMinutesRetard > 0 ? "primary" : "info"}
          label="Minutes de retard"
          value={`${totalMinutesRetard} min`}
          hint="Cumul du temps de retard"
        />
        <StatCard
          icon="inbox"
          tone={totalAbsences > 0 ? "primary" : "info"}
          label="Absences signalées"
          value={totalAbsences}
          hint="Sur la période sélectionnée"
        />
      </div>

      {/* Barre de filtres par période et type */}
      <HistoriqueFilters
        initial={{
          du,
          au,
          type,
        }}
      />

      {/* Tableau des Pointages */}
      {showPointages ? (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="clock" className="size-5 text-primary" />
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

          <PointagesTable pointages={pointages} />
        </div>
      ) : null}

      {/* Tableau des Absences */}
      {showAbsences ? (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="alert-triangle" className="size-5 text-primary" />
              <h2 className="text-base font-bold text-foreground">
                Absences ({absences.length})
              </h2>
            </div>
            {absences.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                Signalements d&apos;absence
              </span>
            ) : null}
          </div>

          <AbsencesTable absences={absences} />
        </div>
      ) : null}
    </div>
  );
}
