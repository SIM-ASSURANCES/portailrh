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
    title: "Absences",
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
  },
  {
    title: "Géolocalisation",
    description: "Pointage hors réseau par GPS — configurez les coordonnées du bureau et le rayon autorisé.",
    href: "/pointage/rh/geolocalisation",
    icon: "map-pin",
    available: true,
  }
];

export default async function RHToolsPage() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-2 font-sans sm:px-6 md:space-y-8 md:py-8">
      <div className="hidden md:block">
        <PageHeader
          title="Boîte à Outils RH"
          description="Accédez à l'ensemble des modules d'administration pour la gestion des pointages."
        />
      </div>
      {/* Mobile : titre compact en gras, sans description (même traitement que le tableau de bord). */}
      <h1 className="text-xl font-black tracking-tight text-foreground md:hidden">Boîte à outils RH</h1>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
          {tools.map((tool) => {
            if (tool.available) {
              return (
                <Link key={tool.href} href={tool.href} className="group">
                  <Card className="h-full flex flex-col items-start p-3 hover:border-primary/50 hover:bg-primary/5 transition-colors border-border/80 md:p-4">
                    <div className="p-1.5 bg-primary/10 rounded-lg text-primary mb-2 group-hover:scale-105 transition-transform md:p-2 md:mb-3">
                      <Icon name={tool.icon} className="size-4 md:size-5" />
                    </div>
                    <h3 className="font-bold text-sm leading-tight text-foreground md:mb-1">{tool.title}</h3>
                    <p className="hidden text-xs text-muted-foreground md:block">{tool.description}</p>
                  </Card>
                </Link>
              );
            }

            return (
              <Card key={tool.href} className="h-full flex flex-col items-start p-3 border-dashed border-border/50 bg-surface/50 opacity-70 md:p-4">
                <div className="p-1.5 bg-muted rounded-lg text-muted-foreground mb-2 md:p-2 md:mb-3">
                  <Icon name={tool.icon} className="size-4 md:size-5" />
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-sm text-muted-foreground">{tool.title}</h3>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Bientôt</span>
                </div>
                <p className="hidden text-xs text-muted-foreground/80 md:block">{tool.description}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
