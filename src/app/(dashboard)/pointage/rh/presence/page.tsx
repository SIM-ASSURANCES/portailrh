import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { StatCard } from "@/components/ui/StatCard";
import { prisma } from "@/lib/prisma";
import { startOfDay, endOfDay, startOfMonth, endOfMonth, format } from "date-fns";
import { fr } from "date-fns/locale";
import { PresenceTabs, PresenceData } from "./PresenceTabs";
import { Card } from "@/components/ui/Card";

export default async function PresenceDuJourPage() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const presentsDb = await prisma.pointage.findMany({
    where: {
      type: "ARRIVEE",
      heure: {
        gte: todayStart,
        lte: todayEnd,
      },
      user: { isActive: true },
    },
    distinct: ["userId"],
    select: {
      userId: true,
      estRetard: true,
      minutesRetard: true,
      heure: true,
      user: { select: { fullName: true, email: true } }
    },
  });

  const presentsCount = presentsDb.length;
  let retardsCount = 0;

  presentsDb.forEach((p) => {
    if (p.estRetard) {
      retardsCount++;
    }
  });

  const absentsDb = await prisma.absence.findMany({
    where: {
      date: {
        gte: todayStart,
        lte: todayEnd,
      },
      user: { isActive: true },
    },
    include: { user: { select: { fullName: true, email: true } } },
  });

  const absentsCount = absentsDb.length;

  // Calcul des manquants (ni présents, ni déclarés absents)
  const presentsIds = presentsDb.map((p) => p.userId);
  const absentsIds = absentsDb.map((a) => a.userId);
  const exclusIds = [...presentsIds, ...absentsIds];

  const manquantsDb = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { notIn: exclusIds },
    },
    select: { id: true, fullName: true, email: true },
  });

  const manquantsCount = manquantsDb.length;

  // Formatage pour les onglets
  const presents: PresenceData[] = presentsDb.map(p => ({
    userId: p.userId,
    fullName: p.user.fullName,
    email: p.user.email,
    heure: p.heure,
    estRetard: p.estRetard,
    minutesRetard: p.minutesRetard
  }));

  const retards: PresenceData[] = presents.filter(p => p.estRetard);

  const absents: PresenceData[] = absentsDb.map(a => ({
    userId: a.userId,
    fullName: a.user.fullName,
    email: a.user.email
  }));

  const manquants: PresenceData[] = manquantsDb.map(m => ({
    userId: m.id,
    fullName: m.fullName,
    email: m.email
  }));

  // Top retards du mois
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const retardsDuMois = await prisma.pointage.groupBy({
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
  });

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

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Présence du jour"
        description="Suivi en temps réel des arrivées, retards et absences de la journée."
        backHref="/pointage/rh"
        backLabel="Retour à la Boîte à Outils"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon="check-circle"
          tone="success"
          label="Présents"
          value={presentsCount}
        />
        <StatCard
          icon="clock"
          tone={retardsCount > 0 ? "warning" : "success"}
          label="Retardataires"
          value={retardsCount}
        />
        <StatCard
          icon="x-circle"
          tone={absentsCount > 0 ? "danger" : "success"}
          label="Absents"
          value={absentsCount}
        />
        <StatCard
          icon="help-circle"
          tone={manquantsCount > 0 ? "warning" : "success"}
          label="Manquants"
          value={manquantsCount}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold text-foreground mb-4">Détails de la présence</h2>
          <PresenceTabs 
            presents={presents} 
            retards={retards} 
            absents={absents} 
            manquants={manquants} 
          />
        </div>
        
        <div className="lg:col-span-1">
          {retardsAvecUsers.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Palmarès des retards</h2>
                <span className="text-sm text-muted-foreground capitalize">
                  {format(now, "MMMM", { locale: fr })}
                </span>
              </div>
              <Card className="overflow-hidden p-0">
                <table className="w-full text-sm text-left">
                  <tbody className="divide-y divide-border">
                    {retardsAvecUsers.map((retard) => (
                      <tr key={retard.userId} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{retard.user?.fullName}</div>
                          <div className="text-xs text-muted-foreground">
                            {retard._count.id} retards ({retard._sum.minutesRetard} min)
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          ) : (
             <div className="space-y-4">
               <h2 className="text-lg font-semibold text-foreground">Palmarès des retards</h2>
               <Card className="p-4 text-center text-sm text-muted-foreground">
                 Aucun retard ce mois-ci.
               </Card>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
