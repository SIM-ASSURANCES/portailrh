import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { StatCard } from "@/components/ui/StatCard";
import { prisma } from "backend";
import { chargerPresenceJour } from "@/lib/presenceJour";
import { startOfDay, startOfMonth, endOfMonth, format } from "date-fns";
import { PresenceTabs } from "./PresenceTabs";
import { Card } from "@/components/ui/Card";
import { MonthFilter } from "./MonthFilter";
import { RecoverAbsencesButton } from "./RecoverAbsencesButton";

export default async function PresenceDuJourPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const resolvedParams = await searchParams;
  const dateParam = resolvedParams.date as string;
  const moisParam = resolvedParams.mois as string;
  const now = dateParam ? new Date(dateParam) : new Date();
  
  const palmaresDate = moisParam ? new Date(`${moisParam}-01`) : now;
  const monthStart = startOfMonth(palmaresDate);
  const monthEnd = endOfMonth(palmaresDate);

  // Présence de la journée : lecture partagée avec « Mon équipe » (`chargerPresenceJour`, tous les comptes ici).
  const [{ presents, retards, absents, autorises, manquants, isJourNonOuvre, jourFerie, parametrage }, retardsDuMois] = await Promise.all([
    chargerPresenceJour(now),
    prisma.pointage.groupBy({
      by: ["userId"],
      where: {
        estRetard: true,
        heure: {
          gte: monthStart,
          lte: monthEnd,
        },
        user: { isActive: true },
      },
      _sum: {
        minutesRetard: true,
      },
      _count: {
        id: true,
      },
    }),
  ]);
  const presentsCount = presents.length;
  const retardsCount = retards.length;
  const absentsCount = absents.length;
  const manquantsCount = manquants.length;

  const users = await prisma.user.findMany({
    where: { id: { in: retardsDuMois.map((r) => r.userId) } },
    select: { id: true, fullName: true, email: true },
  });

  const retardsAvecUsers = retardsDuMois
    .map((r) => ({
      ...r,
      user: users.find((u) => u.id === r.userId),
    }))
    .sort((a, b) => b._count.id - a._count.id);

  let isEndOfDayPassed = false;
  const realNow = new Date();
  const isToday = now.toDateString() === realNow.toDateString();

  if (!isJourNonOuvre) {
    if (now < startOfDay(realNow)) {
      isEndOfDayPassed = true;
    } else if (isToday) {
      if (parametrage && parametrage.heureFinApresMidi) {
        const [endHour, endMinute] = parametrage.heureFinApresMidi.split(":").map(Number);
        if (realNow.getHours() > endHour || (realNow.getHours() === endHour && realNow.getMinutes() >= endMinute)) {
          isEndOfDayPassed = true;
        }
      } else if (realNow.getHours() >= 18) {
        isEndOfDayPassed = true;
      }
    }
  }

  const pageDescription = isJourNonOuvre
    ? (jourFerie ? `Jour férié (${jourFerie.libelle}) — Aucun pointage attendu.` : "Jour de repos (week-end) — Aucun pointage attendu.")
    : "Suivi en temps réel des arrivées, retards et absences de la journée.";

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title={dateParam ? `Présence du ${format(now, "dd/MM/yyyy")}` : "Présence du jour"}
          description={pageDescription}
          backHref="/pointage/rh"
          backLabel="Retour à la Boîte à Outils"
        />
        <RecoverAbsencesButton dateStr={format(now, "yyyy-MM-dd")} isEndOfDayPassed={isEndOfDayPassed} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          icon="check-circle"
          tone="info"
          label="Présents"
          value={presentsCount}
        />
        <StatCard
          icon="clock"
          tone="info"
          label="Retardataires"
          value={retardsCount}
        />
        <StatCard
          icon="x-circle"
          tone="info"
          label="Absents"
          value={absentsCount}
        />
        <StatCard
          icon="calendar"
          tone="info"
          label="Absences autorisées"
          value={autorises.length}
        />
        <StatCard
          icon="help-circle"
          tone="info"
          label="Manquants"
          value={manquantsCount}
        />
      </div>

      <div className="space-y-8">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">Détails de la présence</h2>
          <PresenceTabs 
            presents={presents} 
            retards={retards} 
            absents={absents} 
            autorises={autorises}
            manquants={manquants} 
          />
        </div>
        
        <div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Palmarès des retards</h2>
              <MonthFilter dateParam={dateParam} defaultValue={moisParam || format(now, "yyyy-MM")} />
            </div>
            
            {retardsAvecUsers.length > 0 ? (
              <Card className="overflow-hidden p-0">
                <table className="w-full text-xs text-left">
                  <tbody className="divide-y divide-border">
                    {retardsAvecUsers.map((retard) => (
                      <tr key={retard.userId} className="hover:bg-muted/50 transition-colors">
                        <td className="px-3 py-2 flex justify-between items-center">
                          <div className="font-medium text-foreground">{retard.user?.fullName}</div>
                          <div className="text-[10px] font-semibold text-primary">
                            {retard._count.id} retards ({retard._sum.minutesRetard} min)
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : (
              <Card className="p-4 text-center text-sm text-muted-foreground">
                Aucun retard ce mois-ci.
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
