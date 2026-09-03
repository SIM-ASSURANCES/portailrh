import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";

import { UserCreateForm } from "./UserCreateForm";
import { UsersTable } from "./UsersTable";

export default async function AdminUsersPage() {
  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      include: { role: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Utilisateurs"
        description="Créer des comptes et gérer leur accès. Aucun compte n'est jamais supprimé, seulement désactivé."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Nouvel utilisateur</h2>
        <UserCreateForm roles={roles} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Comptes existants</h2>
        <UsersTable users={users} roles={roles} />
      </section>
    </div>
  );
}
