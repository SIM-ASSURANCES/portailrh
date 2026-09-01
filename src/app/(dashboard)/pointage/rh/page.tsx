import { getSession, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";

export default async function RHPage() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord RH"
        description="Suivi des présences et gestion des pointages"
      />

      <div className="grid gap-6">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">🚀 En construction</h2>
          <p className="mt-2 text-muted-foreground">
            Le dashboard RH sera construit avec les indicateurs de présence, absences et retards.
          </p>
          <div className="mt-4 space-y-2">
            <p className="text-sm">
              ✓ Layout RH protégé (seuls les RH voient cette section)
            </p>
            <p className="text-sm">
              ⏳ Ticket 5: Pointage exceptionnel
            </p>
            <p className="text-sm">
              ⏳ Ticket 6: Correction de pointage
            </p>
            <p className="text-sm">
              ⏳ Ticket 7: Gestion des absences
            </p>
            <p className="text-sm">
              ⏳ Ticket 8: Dashboard RH (KPI cards)
            </p>
            <p className="text-sm">
              ⏳ Ticket 9: Reporting détaillé
            </p>
            <p className="text-sm">
              ⏳ Ticket 10: Export Excel
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
