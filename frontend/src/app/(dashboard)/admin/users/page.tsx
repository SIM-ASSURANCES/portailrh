import { PageHeader } from "@/components/ui";
import { prisma } from "backend";

import { NewUserSection } from "./NewUserSection";
import { UsersTable } from "./UsersTable";

export default async function AdminUsersPage() {
  const [usersRaw, roles, services] = await Promise.all([
    prisma.user.findMany({
      include: { role: true, service: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    prisma.service.findMany({ orderBy: { name: "asc" } }),
  ]);

  // "En attente d'activation" (invitation par lien pas encore finalisée) —
  // calculé ici, jamais transmis au Client Component sous forme de
  // passwordHash/invitationToken bruts (aucune raison d'envoyer un hash ou
  // un jeton au navigateur, même pour un Admin) : uniquement le booléen
  // dérivé dont l'UI a réellement besoin. Voir CLAUDE.md "Invitation par lien".
  const users = usersRaw.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    isActive: u.isActive,
    role: u.role,
    service: u.service,
    isPending: !u.passwordHash,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Utilisateurs"
        description="Créer des comptes et gérer leur accès. Aucun compte n'est jamais supprimé, seulement désactivé."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Nouvel utilisateur</h2>
        <NewUserSection roles={roles} services={services} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Comptes existants</h2>
        <UsersTable users={users} roles={roles} services={services} />
      </section>
    </div>
  );
}
