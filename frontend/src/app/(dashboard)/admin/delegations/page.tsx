import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "backend";

import { RevoquerDelegationButton } from "./RevoquerDelegationButton";

/**
 * Vue Admin de toutes les délégations individuelles de permission
 * accordées par n'importe quel utilisateur (voir CLAUDE.md "Délégation
 * individuelle de permissions") — point 3 des règles non négociables :
 * l'Admin voit et peut révoquer toute délégation, pas seulement les
 * siennes. Gardée par `admin/layout.tsx` (isAdmin()), comme le reste de la
 * console.
 */
export default async function AdminDelegationsPage() {
  const delegations = await prisma.permissionDelegation.findMany({
    include: {
      beneficiaire: { select: { fullName: true, email: true } },
      donneur: { select: { fullName: true, email: true } },
      permission: { select: { label: true, module: { select: { label: true } } } },
      revokedBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const actives = delegations.filter((d) => d.estActive);
  const revoquees = delegations.filter((d) => !d.estActive);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Délégations"
        description="Toutes les délégations individuelles de permission accordées par un utilisateur Trésorerie/Pointage RH à un autre compte — consultables et révocables ici, quel que soit le donneur."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Actives ({actives.length})
        </h2>
        {actives.length === 0 ? (
          <EmptyState
            icon="shield"
            message="Aucun utilisateur n'a encore délégué d'accès à un autre compte."
          />
        ) : (
          <div className="space-y-2">
            {actives.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
              >
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">
                    {d.permission.label}{" "}
                    <span className="text-muted-foreground">({d.permission.module.label})</span>
                  </p>
                  <p className="text-muted-foreground">
                    Accordé par <strong>{d.donneur.fullName}</strong> ({d.donneur.email}) à{" "}
                    <strong>{d.beneficiaire.fullName}</strong> ({d.beneficiaire.email}) le{" "}
                    {d.createdAt.toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <RevoquerDelegationButton delegationId={d.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Révoquées ({revoquees.length})
        </h2>
        {revoquees.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune délégation révoquée pour l&apos;instant.</p>
        ) : (
          <div className="space-y-2">
            {revoquees.map((d) => (
              <div key={d.id} className="rounded-lg border border-border p-4 opacity-70">
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">
                    <Badge variant="neutral">Révoquée</Badge> {d.permission.label}{" "}
                    <span className="text-muted-foreground">({d.permission.module.label})</span>
                  </p>
                  <p className="text-muted-foreground">
                    Accordé par <strong>{d.donneur.fullName}</strong> à{" "}
                    <strong>{d.beneficiaire.fullName}</strong> le {d.createdAt.toLocaleDateString("fr-FR")}
                    {d.revokedAt ? (
                      <>
                        {" "}
                        — révoqué le {d.revokedAt.toLocaleDateString("fr-FR")}
                        {d.revokedBy ? ` par ${d.revokedBy.fullName}` : ""}
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
