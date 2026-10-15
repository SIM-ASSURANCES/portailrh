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
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-2 font-sans sm:px-6 md:space-y-8 md:py-8">
      <div className="hidden flex-col justify-between gap-4 md:flex md:flex-row md:items-center">
        <PageHeader
          title={dateParam ? `Présence du ${format(now, "dd/MM/yyyy")}` : "Présence du jour"}
          description={pageDescription}
          backHref="/pointage/rh"
          backLabel="Retour à la Boîte à Outils"
        />
        <RecoverAbsencesButton dateStr={format(now, "yyyy-MM-dd")} isEndOfDayPassed={isEndOfDayPassed} />
      </div>

      {/* Mobile : titre compact en gras + action, la description n'est gardée que pour un jour sans pointage attendu. */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-3">
          <h1 className="truncate text-xl font-black tracking-tight text-foreground">
            {dateParam ? `Présence du ${format(now, "dd/MM")}` : "Présence du jour"}
          </h1>
          <RecoverAbsencesButton dateStr={format(now, "yyyy-MM-dd")} isEndOfDayPassed={isEndOfDayPassed} />
        </div>
        {isJourNonOuvre ? <p className="mt-1 text-xs text-muted-foreground">{pageDescription}</p> : null}
      </div>

      {/* Mobile : les 5 chiffres sur une ligne, sans cartes (même traitement que l'historique de pointage). */}
      <div className="grid grid-cols-5 divide-x divide-border md:hidden">
        {[
          { libelle: "Présents", valeur: presentsCount },
          { libelle: "Retards", valeur: retardsCount },
          { libelle: "Absents", valeur: absentsCount },
          { libelle: "Autorisés", valeur: autorises.length },
          { libelle: "Manquants", valeur: manquantsCount },
        ].map((k, i) => (
          <div key={k.libelle} className={i === 0 ? "pr-1" : "px-1"}>
            <p className="text-2xl font-black leading-none tabular-nums text-foreground">{k.valeur}</p>
            <p className="mt-1 whitespace-nowrap text-[9px] font-semibold uppercase tracking-normal text-muted-foreground">{k.libelle}</p>
          </div>
        ))}
      </div>

      <div className="hidden grid-cols-5 gap-4 md:grid">
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

      <div className="space-y-6 md:space-y-8">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground md:mb-4 md:text-lg">Détails de la présence</h2>
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
              <h2 className="text-sm font-semibold text-foreground md:text-lg">Palmarès des retards</h2>
              <MonthFilter dateParam={dateParam} defaultValue={moisParam || format(now, "yyyy-MM")} />
            </div>
            
            {retardsAvecUsers.length > 0 ? (
              <>
              <ul className="divide-y divide-border border-y border-border md:hidden">
                {retardsAvecUsers.map((retard) => (
                  <li key={retard.userId} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{retard.user?.fullName}</span>
                    <span className="shrink-0 text-xs font-semibold text-primary">
                      {retard._count.id} retards ({retard._sum.minutesRetard} min)
                    </span>
                  </li>
                ))}
              </ul>
              <Card className="hidden overflow-hidden p-0 md:block">
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
              </>
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
