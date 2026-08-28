import Link from "next/link";

import { PageHeader } from "@/components/ui";

const sections = [
  {
    href: "/admin/users",
    title: "Utilisateurs",
    description: "Créer des comptes, activer ou désactiver un accès.",
  },
  {
    href: "/admin/roles",
    title: "Rôles",
    description: "Consulter et modifier les permissions de chaque rôle.",
  },
  {
    href: "/admin/modules",
    title: "Modules",
    description: "Activer ou désactiver les modules du portail.",
  },
];

export default function AdminHomePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title="Administration"
        description="Gestion des utilisateurs, des rôles et des modules du portail."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      </div>
    </div>
  );
}
