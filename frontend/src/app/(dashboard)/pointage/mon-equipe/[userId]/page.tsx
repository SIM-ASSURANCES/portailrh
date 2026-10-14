import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { VARIANTE_STATUT_JUSTIFICATION } from "@/components/pointage/justificationStatut";
import { getSession } from "@/lib/auth";
import { chargerEquipeResponsable } from "@/lib/equipe";
import { justificationAffichee, periodeEquipe, prisma } from "backend";

export const metadata = { title: "Historique d'un membre - Mon équipe" };
export const dynamic = "force-dynamic";

/** Historique d'un membre de l'équipe, en LECTURE SEULE : introuvable (404) pour tout compte qui n'en est pas le responsable. */
export default async function HistoriqueMembrePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ du?: string; au?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { userId } = await params;

  const equipe = await chargerEquipeResponsable(session.user.id);
  const membre = equipe.membres.find((m) => m.id === userId);
  if (!membre) notFound();

  const sp = await searchParams;
  const periode = periodeEquipe(sp.du, sp.au, new Date());
  const fin = new Date(periode.au);
  fin.setHours(23, 59, 59, 999);
  const pointages = await prisma.pointage.findMany({
    where: { userId, heure: { gte: new Date(periode.du), lte: fin } },
    orderBy: { heure: "desc" },
    select: {
      id: true,
      type: true,
      heure: true,
      estRetard: true,
      minutesRetard: true,
      estDepartAnticipe: true,
      motif: true,
      justification: { select: { statut: true, motif: true, decideur: { select: { fullName: true } } } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title={membre.fullName}
        description={`Historique du ${periode.du} au ${periode.au} (lecture seule).`}
        backHref={`/pointage/mon-equipe?du=${periode.du}&au=${periode.au}`}
        backLabel="Retour à mon équipe"
      />
      {pointages.length === 0 ? (
        <EmptyState icon="clock" message="Aucun pointage sur cette période." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Pointage</th>
                <th className="px-3 py-2 font-medium">Heure</th>
                <th className="px-3 py-2 font-medium">Anomalie</th>
                <th className="px-3 py-2 font-medium">Justification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pointages.map((p) => {
                const j = p.justification ? justificationAffichee(p) : null;
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2 tabular-nums">{format(p.heure, "dd/MM/yyyy")}</td>
                    <td className="px-3 py-2">{p.type === "ARRIVEE" ? "Arrivée" : "Départ"}</td>
                    <td className="px-3 py-2 tabular-nums">{format(p.heure, "HH:mm")}</td>
                    <td className="px-3 py-2">
                      {p.estRetard ? `Retard · ${p.minutesRetard ?? 0} min` : p.estDepartAnticipe ? "Départ anticipé" : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {j?.statut ? <Badge variant={VARIANTE_STATUT_JUSTIFICATION[j.statut]}>{j.libelle}</Badge> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
