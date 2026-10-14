import Link from "next/link";

import { ServicesSansResponsableBanniere } from "@/components/admin/ServicesSansResponsableBanniere";
import { PageHeader } from "@/components/ui";
import { resumeJournalTechnique } from "@/lib/moniteurTaches";
import { getServicesSansResponsable, prisma } from "backend";

const sections = [
  {
    href: "/admin/users",
    title: "Utilisateurs",
    description: "Créer des comptes, activer ou désactiver un accès.",
  },
  {
    href: "/admin/notifications",
    title: "Notifications Push",
    description: "Superviser l'adoption des alertes et les terminaux enregistrés.",
  },
  {
    href: "/admin/roles",
    title: "Rôles",
    description: "Consulter et modifier les permissions de chaque rôle.",
  },
  {
    href: "/admin/services",
    title: "Services",
    description: "Gérer les services de l'entreprise et les affectations.",
  },
  {
    href: "/admin/modules",
    title: "Modules",
    description: "Activer ou désactiver les modules du portail.",
  },
];

export default async function AdminHomePage() {
  const [sansResponsable, journal] = await Promise.all([getServicesSansResponsable(prisma), resumeJournalTechnique()]);
  const tachesOk = journal.tachesEnRetard.length === 0;
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title="Administration"
        description="Gestion des utilisateurs, des rôles et des modules du portail."
      />
      <ServicesSansResponsableBanniere services={sansResponsable} lienServices />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-lg border border-border bg-surface p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <h2 className="font-semibold text-foreground">{section.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
          </Link>
        ))}
        <Link
          href="/admin/journal-technique"
          data-carte="journal-technique"
          className={`rounded-lg border p-5 shadow-sm transition-shadow hover:shadow-md ${
            tachesOk && journal.erreurs24h === 0 ? "border-border bg-surface" : "border-danger-border bg-danger-bg"
          }`}
        >
          <h2 className="font-semibold text-foreground">Journal technique</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {journal.erreurs24h} erreur{journal.erreurs24h > 1 ? "s" : ""} sur 24 h
          </p>
          <p className={`mt-1 text-sm font-medium ${tachesOk ? "text-success" : "text-danger"}`}>
            {tachesOk ? "Tâches planifiées à jour" : `${journal.tachesEnRetard.length} tâche${journal.tachesEnRetard.length > 1 ? "s" : ""} en retard`}
          </p>
        </Link>
      </div>
    </div>
  );
}
