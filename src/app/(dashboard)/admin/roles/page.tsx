import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";

import { PermissionToggle } from "./PermissionToggle";
import { RoleCreateForm } from "./RoleCreateForm";

export default async function AdminRolesPage() {
  const [roles, modules] = await Promise.all([
    prisma.role.findMany({
      include: { permissions: { select: { permissionId: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.module.findMany({
      include: { permissions: { orderBy: { label: "asc" } } },
      orderBy: { label: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Rôles"
        description="Cocher ou décocher les permissions accordées à chaque rôle, groupées par module."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Nouveau rôle</h2>
        <RoleCreateForm />
      </section>

      <div className="space-y-6">
        {roles.map((role) => {
          const grantedIds = new Set(role.permissions.map((rp) => rp.permissionId));

          return (
            <section key={role.id} className="rounded-md border border-border p-5">
              <h2 className="font-semibold text-foreground">{role.name}</h2>
              {role.description ? (
                <p className="text-sm text-muted-foreground">{role.description}</p>
              ) : null}
              {role.name === "Admin" ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Le rôle Admin a de toute façon un accès total à la console
                  d&apos;administration, indépendamment des permissions ci-dessous
                  (voir isAdmin() dans CLAUDE.md).
                </p>
              ) : null}

              {modules.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Aucun module.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {modules.map((module_) => (
                    <div key={module_.id} className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        {module_.label}
                      </h3>
                      <div className="space-y-1">
                        {module_.permissions.map((permission) => (
                          <PermissionToggle
                            key={permission.id}
                            roleId={role.id}
                            permissionId={permission.id}
                            label={permission.label}
                            defaultChecked={grantedIds.has(permission.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
