import { PageHeader } from "@/components/ui";
import { FILES_FINANCE_WHERE, getBeneficiaireNom } from "backend";
import { prisma } from "backend";

import { DemandesACategoriserTable } from "./DemandesACategoriserTable";

/**
 * Files de la Finance par étape du circuit de validation (2026-10-06) — cible de l'indicateur « À traiter » n° 1 du
 * tableau de bord, qui compte exactement les mêmes demandes (`DEMANDES_A_TRAITER_FINANCE_WHERE`, `tresorerie.ts`) :
 * étape Finance (à décider ou à soumettre au DG, plus le reliquat d'une dépense directe partiellement validée),
 * rejet du DG (resoumettre ou renvoyer au demandeur), décision finale après l'approbation du DG. Les demandes qui
 * attendent le responsable de service ou le DG n'y figurent pas (« Toutes les demandes » les montre). Chaque file
 * est triée par ancienneté, les plus anciennes en premier.
 */
export default async function FinanceDemandesPage() {
  const charger = (where: object) =>
    prisma.demande.findMany({
      where,
      include: { createur: true, beneficiaireUser: true },
      orderBy: { createdAt: "asc" },
    });
  const [etapeFinance, reliquats, rejetDG, decisionFinale] = await Promise.all([
    charger(FILES_FINANCE_WHERE.FINANCE),
    charger(FILES_FINANCE_WHERE.RELIQUAT),
    charger(FILES_FINANCE_WHERE.REJET_DG),
    charger(FILES_FINANCE_WHERE.DECISION_FINALE),
  ]);

  const lignes = (demandes: Awaited<ReturnType<typeof charger>>) =>
    demandes.map((d) => ({
      id: d.id,
      reference: d.reference,
      createurNom: d.createur.fullName,
      beneficiaireNom: getBeneficiaireNom(d),
      montant: Number(d.montant),
      description: d.description,
      createdAt: d.createdAt,
      statut: d.statut,
      typeDemande: d.typeDemande,
      natureDepenseDirecte: d.natureDepenseDirecte,
    }));

  const files = [
    {
      id: "file-etape-finance",
      titre: "Étape Finance",
      description: "À décider ligne par ligne, à rejeter ou à soumettre au DG.",
      vide: "Aucune demande à l'étape Finance.",
      demandes: lignes([...etapeFinance, ...reliquats]),
    },
    {
      id: "file-rejet-dg",
      titre: "Rejetées par le DG",
      description: "À resoumettre au DG ou à renvoyer au demandeur, avec un motif.",
      vide: "Aucune demande rejetée par le DG.",
      demandes: lignes(rejetDG),
    },
    {
      id: "file-decision-finale",
      titre: "Décision finale",
      description: "Approuvées par le DG : à décider ligne par ligne (décision finale).",
      vide: "Aucune demande en attente de décision finale.",
      demandes: lignes(decisionFinale),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Demandes en attente de validation"
        description="Les demandes où la Finance doit agir, par étape du circuit de validation. Les plus anciennes en premier."
      />
      {files.map((file) => (
        <section key={file.id} aria-labelledby={file.id} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={file.id} className="text-lg font-bold text-foreground">
              {file.titre}{" "}
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums text-muted-foreground">
                {file.demandes.length}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">{file.description}</p>
          </div>
          <DemandesACategoriserTable demandes={file.demandes} emptyMessage={file.vide} />
        </section>
      ))}
    </div>
  );
}
