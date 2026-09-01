import Link from "next/link";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";
import { prisma } from "@/lib/prisma";
import { startOfDay, endOfDay, startOfMonth, endOfMonth, format } from "date-fns";
import { fr } from "date-fns/locale";

interface DashboardItem {
  title: string;
  description: string;
  href: string;
  icon: IconName;
  available: boolean;
}

const tools: DashboardItem[] = [
  {
    title: "Générateur QR",
    description: "Générer un QR code pour le pointage des collaborateurs.",
    href: "/pointage/rh/generer-qr",
    icon: "qr-code",
    available: true,
  },
  {
    title: "Pointage exceptionnel",
    description: "Saisir manuellement un pointage pour un collaborateur.",
    href: "/pointage/rh/pointages/nouveau",
    icon: "plus-circle",
    available: true,
  },
  {
    title: "Pointages",
    description: "Historique et gestion de tous les pointages enregistrés.",
    href: "/pointage/rh/pointages",
    icon: "file-text",
    available: false,
  },
  {
    title: "Retards & absences",
    description: "Suivi des anomalies, validation des justifications.",
    href: "/pointage/rh/absences",
    icon: "alert-triangle",
    available: true,
  },
  {
    title: "Reporting",
    description: "Extraction de données et synthèses d'heures.",
    href: "/pointage/rh/reporting",
    icon: "download",
    available: false,
  },
  {
    title: "Corrections",
    description: "Traiter les demandes de correction de pointage.",
    href: "/pointage/rh/corrections",
    icon: "pencil",
    available: true,
  },
  {
    title: "Horaires",
    description: "Paramétrage des règles horaires et limites de retard.",
    href: "/pointage/rh/horaires",
    icon: "settings",
    available: false,
  },
];

export default async function RHPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string }>;
}) {
  const { vue } = await searchParams;
  const session = await getSession();

  if (!session) {
    return null;
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const presents = await prisma.pointage.findMany({
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

  const presentsCount = presents.length;

  let retardsCount = 0;

  presents.forEach((p) => {
    if (p.estRetard) {
      retardsCount++;
    }
  });

  const absents = await prisma.absence.findMany({
    where: {
      date: {
        gte: todayStart,
        lte: todayEnd,
      },
      user: { isActive: true },
    },
    include: { user: { select: { fullName: true, email: true } } },
  });

  const absentsCount = absents.length;

  // Calcul des manquants (ni présents, ni déclarés absents)
  const presentsIds = presents.map((p) => p.userId);
  const absentsIds = absents.map((a) => a.userId);
  const exclusIds = [...presentsIds, ...absentsIds];

  const manquants = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { notIn: exclusIds },
    },
    select: { id: true, fullName: true, email: true },
  });

  const manquantsCount = manquants.length;

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
        title="Outils RH"
        description="Gestion des pointages, absences, retards et paramétrages."
      />

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Présence du jour</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link href="?vue=presents" className="block group">
            <Card className="h-full p-4 border-l-4 border-l-primary/50 bg-surface flex flex-col justify-between group-hover:border-primary/80 group-hover:bg-primary/5 transition-colors cursor-pointer">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="check-circle" className="size-5 text-primary" />
                <span className="text-sm font-medium text-muted-foreground">Présents</span>
              </div>
              <div className="text-3xl font-bold text-foreground">{presentsCount}</div>
            </Card>
          </Link>
          
          <Link href="?vue=retards" className="block group">
            <Card className="h-full p-4 border-l-4 border-l-primary/50 bg-surface flex flex-col justify-between group-hover:border-primary/80 group-hover:bg-primary/5 transition-colors cursor-pointer">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="clock" className="size-5 text-primary" />
                <span className="text-sm font-medium text-muted-foreground">Retardataires</span>
              </div>
              <div className="text-3xl font-bold text-foreground">{retardsCount}</div>
            </Card>
          </Link>

          <Link href="?vue=absents" className="block group">
            <Card className="h-full p-4 border-l-4 border-l-primary/50 bg-surface flex flex-col justify-between group-hover:border-primary/80 group-hover:bg-primary/5 transition-colors cursor-pointer">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="x-circle" className="size-5 text-primary" />
                <span className="text-sm font-medium text-muted-foreground">Absents</span>
              </div>
              <div className="text-3xl font-bold text-foreground">{absentsCount}</div>
            </Card>
          </Link>

          <Link href="?vue=manquants" className="block group">
            <Card className="h-full p-4 border-l-4 border-l-primary/50 bg-surface flex flex-col justify-between group-hover:border-primary/80 group-hover:bg-primary/5 transition-colors cursor-pointer">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="help-circle" className="size-5 text-primary" />
                <span className="text-sm font-medium text-muted-foreground">Manquants</span>
              </div>
              <div className="text-3xl font-bold text-foreground">{manquantsCount}</div>
            </Card>
          </Link>
        </div>
      </div>

      {/* Affichage des détails selon la vue sélectionnée */}
      {vue && ["presents", "retards", "absents", "manquants"].includes(vue) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {vue === "presents" && "Liste des présents"}
              {vue === "retards" && "Liste des retardataires"}
              {vue === "absents" && "Liste des absents"}
              {vue === "manquants" && "Liste des manquants (sans pointage)"}
            </h2>
            <Link href="/pointage/rh" className="text-sm text-primary hover:underline">
              Masquer la liste
            </Link>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Collaborateur</th>
                    {(vue === "presents" || vue === "retards") && (
                      <th className="px-4 py-3 font-medium text-right">Heure d&apos;arrivée</th>
                    )}
                    {vue === "retards" && (
                      <th className="px-4 py-3 font-medium text-right">Retard</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {vue === "presents" && presents.map((p) => (
                    <tr key={p.userId} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{p.user?.fullName}</div>
                        <div className="text-xs text-muted-foreground">{p.user?.email}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {format(p.heure, "HH:mm")}
                      </td>
                    </tr>
                  ))}
                  {vue === "retards" && presents.filter(p => p.estRetard).map((p) => (
                    <tr key={p.userId} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{p.user?.fullName}</div>
                        <div className="text-xs text-muted-foreground">{p.user?.email}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {format(p.heure, "HH:mm")}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-600 font-bold">
                        {p.minutesRetard} min
                      </td>
                    </tr>
                  ))}
                  {vue === "absents" && absents.map((a) => (
                    <tr key={a.userId} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{a.user?.fullName}</div>
                        <div className="text-xs text-muted-foreground">{a.user?.email}</div>
                      </td>
                    </tr>
                  ))}
                  {vue === "manquants" && manquants.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{m.fullName}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </td>
                    </tr>
                  ))}
                  {((vue === "presents" && presentsCount === 0) ||
                    (vue === "retards" && retardsCount === 0) ||
                    (vue === "absents" && absentsCount === 0) ||
                    (vue === "manquants" && manquantsCount === 0)) && (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                          Aucun collaborateur dans cette liste.
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {retardsAvecUsers.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Palmarès des retards</h2>
            <span className="text-sm text-muted-foreground capitalize">
              {format(now, "MMMM yyyy", { locale: fr })}
            </span>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Collaborateur</th>
                    <th className="px-4 py-3 font-medium text-right">Jours de retard</th>
                    <th className="px-4 py-3 font-medium text-right">Total minutes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {retardsAvecUsers.map((retard) => (
                    <tr key={retard.userId} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{retard.user?.fullName}</div>
                        <div className="text-xs text-muted-foreground">{retard.user?.email}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 font-bold">
                          {retard._count.id} j
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {retard._sum.minutesRetard} min
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Outils & Administration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => {
            if (tool.available) {
              return (
                <Link key={tool.href} href={tool.href} className="group">
                  <Card className="h-full flex flex-col items-start p-6 hover:border-primary/50 hover:bg-primary/5 transition-colors border-border/80">
                    <div className="p-3 bg-primary/10 rounded-lg text-primary mb-4 group-hover:scale-105 transition-transform">
                      <Icon name={tool.icon} className="size-6" />
                    </div>
                    <h3 className="font-bold text-foreground mb-1">{tool.title}</h3>
                    <p className="text-sm text-muted-foreground">{tool.description}</p>
                  </Card>
                </Link>
              );
            }

            return (
              <Card key={tool.href} className="h-full flex flex-col items-start p-6 border-dashed border-border/50 bg-surface/50 opacity-70">
                <div className="p-3 bg-muted rounded-lg text-muted-foreground mb-4">
                  <Icon name={tool.icon} className="size-6" />
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-muted-foreground">{tool.title}</h3>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Bientôt</span>
                </div>
                <p className="text-sm text-muted-foreground/80">{tool.description}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
