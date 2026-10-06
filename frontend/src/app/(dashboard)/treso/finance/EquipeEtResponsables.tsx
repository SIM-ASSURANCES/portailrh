import { Card } from "@/components/ui";
import { prisma } from "backend";

/**
 * Qui décide (tableau de bord Finance, 2026-10-06) : les comptes qui détiennent la décision à l'étape Finance
 * (`treso.decider_finance` par leur rôle) et le responsable de chaque service (étape « Service »). Lecture seule.
 */
export async function EquipeEtResponsables() {
  const [finance, services] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, role: { permissions: { some: { permission: { key: "treso.decider_finance" } } } } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, role: { select: { name: true } } },
    }),
    prisma.service.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, responsable: { select: { fullName: true, isActive: true } } },
    }),
  ]);

  return (
    <section aria-labelledby="equipe-titre" className="space-y-3">
      <h2 id="equipe-titre" className="text-lg font-bold text-foreground">
        Rôles et responsables
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Finance — décision à l&apos;étape Finance</h3>
          {finance.length === 0 ? (
            <p className="text-sm text-danger">Aucun compte actif ne détient cette décision.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {finance.map((u) => (
                <li key={u.id}>
                  <span className="font-medium text-foreground">{u.fullName}</span>{" "}
                  <span className="text-muted-foreground">(rôle {u.role.name})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Responsables de service</h3>
          <ul className="space-y-1 text-sm">
            {services.map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{s.name}</span>
                {s.responsable ? (
                  <span className={s.responsable.isActive ? "font-medium text-foreground" : "font-medium text-danger"}>
                    {s.responsable.fullName}
                    {s.responsable.isActive ? "" : " (compte désactivé)"}
                  </span>
                ) : (
                  <span className="font-medium text-warning">Aucun responsable</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}
