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
    title: "Présence du jour",
    description: "Aperçu global des présences et absences de la journée.",
    href: "/pointage/rh",
    icon: "layout-grid",
    available: false,
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
    href: "/pointage/rh/retards",
    icon: "alert-triangle",
    available: false,
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
    available: false,
  },
  {
    title: "Horaires",
    description: "Paramétrage des règles horaires et limites de retard.",
    href: "/pointage/rh/horaires",
    icon: "settings",
    available: false,
  },
];

export default async function RHPage() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Outils RH"
        description="Gestion des pointages, absences, retards et paramétrages."
      />

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
  );
}
