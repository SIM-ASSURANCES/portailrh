import { affichageStatutDemande } from "@/components/tresorerie/demandeStatut";
import { PageHeader } from "@/components/ui";
import { FILES_FINANCE_WHERE, nomBeneficiaireDemande, resumeMotifDemande } from "backend";
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
      include: { createur: true, beneficiaireUser: true, lignes: { select: { libelle: true, motif: true, statutValidation: true, beneficiaireType: true, beneficiaireUserId: true, beneficiaireNom: true, beneficiaireUser: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } } },
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
      beneficiaireNom: nomBeneficiaireDemande(d, d.lignes),
      montant: Number(d.montant),
      description: resumeMotifDemande(d.description, d.lignes),
      createdAt: d.createdAt,
      statut: d.statut,
      statutAffiche: affichageStatutDemande(d.statut, d.lignes),
      typeDemande: d.typeDemande,
      natureDepenseDirecte: d.natureDepenseDirecte,
    }));

  // Lot B : une demande peut avoir des articles dans plusieurs files (à décider, refusés par le DG, validés par le DG) :
  // elle figure dans la première file où elle a quelque chose à faire — jamais deux fois dans la page.
  const dejaListees = new Set<string>();
  const sansDoublon = (liste: ReturnType<typeof lignes>) =>
    liste.filter((d) => {
      if (dejaListees.has(d.id)) return false;
      dejaListees.add(d.id);
      return true;
    });

  const files = [
    {
      id: "file-etape-finance",
      titre: "Étape Finance",
      description: "Articles à décider (valider, rejeter) ou à soumettre au DG — article par article.",
      vide: "Aucune demande à l'étape Finance.",
      demandes: sansDoublon(lignes([...etapeFinance, ...reliquats])),
    },
    {
      id: "file-rejet-dg",
      titre: "Rejetées par le DG",
      description: "Articles refusés par le DG : à resoumettre au DG ou à rejeter définitivement.",
      vide: "Aucune demande rejetée par le DG.",
      demandes: sansDoublon(lignes(rejetDG)),
    },
    {
      id: "file-decision-finale",
      titre: "Décision finale",
      description: "Articles validés par le DG : à confirmer par la Finance.",
      vide: "Aucune demande en attente de décision finale.",
      demandes: sansDoublon(lignes(decisionFinale)),
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
