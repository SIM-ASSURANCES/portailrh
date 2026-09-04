import Link from "next/link";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";

interface DashboardItem {
  title: string;
  description: string;
  href: string;
  icon: IconName;
  available: boolean;
}

const tools: DashboardItem[] = [
  {
    title: "Présence du jour",
    description: "Suivi en temps réel des arrivées, retards et absences.",
    href: "/pointage/rh/presence",
    icon: "layout-grid",
    available: true,
  },
  {
    title: "Pointages",
    description: "Historique et gestion de tous les pointages enregistrés.",
    href: "/pointage/rh/pointages",
    icon: "file-text",
    available: true,
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
    available: true,
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
    available: true,
  },
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
    title: "Calendrier",
    description: "Vue d'ensemble et gestion des jours fériés et du calendrier.",
    href: "/pointage/rh/calendrier",
    icon: "calendar",
    available: true,
  }
];

export default async function RHToolsPage() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Boîte à Outils RH"
        description="Accédez à l'ensemble des modules d'administration pour la gestion des pointages."
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => {
            if (tool.available) {
              return (
                <Link key={tool.href} href={tool.href} className="group">
                  <Card className="h-full flex flex-col items-start p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors border-border/80">
                    <div className="p-2 bg-primary/10 rounded-lg text-primary mb-3 group-hover:scale-105 transition-transform">
                      <Icon name={tool.icon} className="size-5" />
                    </div>
                    <h3 className="font-bold text-sm text-foreground mb-1">{tool.title}</h3>
                    <p className="text-xs text-muted-foreground">{tool.description}</p>
                  </Card>
                </Link>
              );
            }

            return (
              <Card key={tool.href} className="h-full flex flex-col items-start p-4 border-dashed border-border/50 bg-surface/50 opacity-70">
                <div className="p-2 bg-muted rounded-lg text-muted-foreground mb-3">
                  <Icon name={tool.icon} className="size-5" />
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-sm text-muted-foreground">{tool.title}</h3>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Bientôt</span>
                </div>
                <p className="text-xs text-muted-foreground/80">{tool.description}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
