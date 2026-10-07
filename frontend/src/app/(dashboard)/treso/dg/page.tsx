import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { demandesEtapeDGWhere, prisma, resumeMotifDemande } from "backend";

import { DemandesDGTable } from "./DemandesDGTable";

/**
 * Étape DG du circuit de validation (commit 4) : les demandes que la Finance a soumises au DG (décision sur la
 * demande entière) et celles émises par la Finance (cas b : décision ligne par ligne, finale). Réservée à
 * `treso.decider_dg`. Les plus anciennes en premier. L'approbation de clôture des demandes jamais soumises reste dans
 * « Validations complètes en attente ».
 */
export default async function EtapeDGPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "treso.decider_dg")) redirect("/?error=acces_refuse_dg");

  const demandes = await prisma.demande.findMany({
    where: demandesEtapeDGWhere(session.user.id),
    include: {
      createur: { select: { fullName: true, service: { select: { name: true } } } },
      lignes: { select: { libelle: true, motif: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  const ligne = (d: (typeof demandes)[number]) => ({
    id: d.id,
    reference: d.reference,
    demandeur: d.createur.fullName,
    service: d.createur.service?.name ?? "—",
    montant: Number(d.montant),
    motif: resumeMotifDemande(d.description, d.lignes),
    createdAt: d.createdAt.toISOString(),
  });
  const soumises = demandes.filter((d) => d.modeEtapeDG !== "OBLIGATOIRE").map(ligne);
  const finance = demandes.filter((d) => d.modeEtapeDG === "OBLIGATOIRE").map(ligne);

  const sections = [
    {
      id: "dg-soumises",
      titre: "Soumises par la Finance",
      description: "Valider ou rejeter la demande entière ; la Finance prend ensuite la décision finale.",
      vide: "Aucune demande soumise par la Finance.",
      demandes: soumises,
    },
    {
      id: "dg-finance",
      titre: "Demandes de la Finance",
      description: "Émises par la Finance : décision ligne par ligne, finale.",
      vide: "Aucune demande de la Finance à décider.",
      demandes: finance,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="Étape DG" description="Les demandes qui attendent votre décision. Les plus anciennes en premier." />
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={s.id} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={s.id} className="text-lg font-bold text-foreground">
              {s.titre}{" "}
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums text-muted-foreground">
                {s.demandes.length}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">{s.description}</p>
          </div>
          <DemandesDGTable demandes={s.demandes} emptyMessage={s.vide} />
        </section>
      ))}
    </div>
  );
}
