import { Badge, PageHeader } from "@/components/ui";
import { prisma } from "backend";

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

              {/* estAdmin : affichage en LECTURE SEULE — ce champ ne se
                  règle plus qu'à la création du rôle (voir CLAUDE.md
                  "estAdmin figé après création"), jamais modifiable
                  ensuite. Aucune case à cocher ici, volontairement. */}
              <div className="mt-3">
                {role.estAdmin ? (
                  <>
                    <Badge variant="info">Accès administrateur</Badge>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ce rôle a un accès total et permanent à la console
                      d&apos;administration, indépendamment des permissions
                      de module ci-dessous — non modifiable après sa
                      création (voir isAdmin() dans CLAUDE.md).
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground/80">
                    Accès administrateur : non accordé. Ce statut ne peut
                    être défini qu&apos;à la création d&apos;un rôle.
                  </p>
                )}
              </div>

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
