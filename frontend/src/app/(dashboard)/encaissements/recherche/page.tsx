import { redirect } from "next/navigation";

import { EmptyState, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { rechercherResumesContrats } from "@/lib/encaissements/resumesContrats";

import { ResultatsRechercheTable } from "./ResultatsRechercheTable";

const RESULTATS_MAX = 50;

/** Résultats de la recherche (F2, commit 5a) — affichés quand Entrée est pressée sans suggestion choisie. */
export default async function RechercheContratsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }
  const { q } = await searchParams;
  const saisie = (Array.isArray(q) ? q[0] : q ?? "").trim().slice(0, 200);

  // Un résultat de plus que l'affichage, pour savoir s'il faut préciser la recherche.
  const resultats = saisie ? await rechercherResumesContrats(saisie, RESULTATS_MAX + 1) : [];
  const tronque = resultats.length > RESULTATS_MAX;
  const affiches = resultats.slice(0, RESULTATS_MAX);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Recherche de contrats"
        description={saisie ? `Résultats pour « ${saisie} »` : "Saisissez un n° de police, un client, un partenaire, un produit, une branche ou une référence de paiement."}
        backHref="/encaissements"
        backLabel="Encaissements"
      />
      {!saisie ? (
        <EmptyState icon="inbox" message="Aucune recherche en cours." />
      ) : affiches.length === 0 ? (
        <EmptyState icon="inbox" message="Aucun contrat ne correspond à cette recherche." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {tronque
              ? `Les ${RESULTATS_MAX} premiers contrats (par n° de police) sont affichés : ajoutez un mot pour préciser la recherche.`
              : `${affiches.length} contrat(s) trouvé(s).`}
          </p>
          <ResultatsRechercheTable rows={affiches} />
        </>
      )}
    </div>
  );
}
