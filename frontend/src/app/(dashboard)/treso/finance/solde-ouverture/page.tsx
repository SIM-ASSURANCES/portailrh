import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { getAlimentationsCaisseHistorique, getSoldeOuvertureHistorique, getSoldeOuvertureInfo } from "backend";

import { AlimentationsCaisseHistorique } from "./AlimentationsCaisseHistorique";
import { SoldeOuvertureCorrection } from "./SoldeOuvertureCorrection";
import { SoldeOuvertureForm } from "./SoldeOuvertureForm";
import { SoldeOuvertureHistorique } from "./SoldeOuvertureHistorique";

/**
 * Écran "Solde d'ouverture de caisse" (voir CLAUDE.md) — réservé à toute
 * personne de l'équipe Finance chargée des opérations de caisse
 * (Responsable OU Assistant, jamais le DG), revérifié ici même si le
 * layout Finance partagé accepte déjà un ensemble de permissions plus
 * large.
 *
 * **Garde élargie** (Tâche "Séparation Responsable Finance / Assistant
 * Finance", voir CLAUDE.md) — accepte `treso.corriger_solde_ouverture`
 * OU `treso.alimenter_caisse` (Responsable Finance) **OU**
 * `treso.effectuer_reglement` OU `treso.receptionner_retour` (Assistant
 * Finance, qui n'a par défaut AUCUNE des deux premières) **OU**
 * `isAdmin()` : la page doit rester atteignable par un Assistant Finance
 * qui n'a reçu aucune délégation, pour qu'il voie les boutons "Nouvelle
 * alimentation de caisse"/"Corriger le solde d'ouverture" VISIBLES MAIS
 * DÉSACTIVÉS plutôt que de se heurter à une redirection — l'autorisation
 * précise reste vérifiée bouton par bouton (`SoldeOuvertureForm`/
 * `SoldeOuvertureCorrection`) ET dans chaque Server Action.
 */
export default async function SoldeOuverturePage() {
  const session = await getSession();
  const canAccess =
    !!session &&
    (isAdmin(session) ||
      hasPermission(session, "treso.corriger_solde_ouverture") ||
      hasPermission(session, "treso.alimenter_caisse") ||
      hasPermission(session, "treso.effectuer_reglement") ||
      hasPermission(session, "treso.receptionner_retour"));
  if (!canAccess) {
    redirect("/?error=acces_refuse_solde_ouverture");
  }

  const canCorriger = isAdmin(session) || hasPermission(session, "treso.corriger_solde_ouverture");
  const canAlimenter = isAdmin(session) || hasPermission(session, "treso.alimenter_caisse");

  const [info, historique, alimentations] = await Promise.all([
    getSoldeOuvertureInfo(),
    getSoldeOuvertureHistorique(),
    getAlimentationsCaisseHistorique(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Solde d'ouverture de caisse"
        description="Montant physique déjà présent en caisse avant l'utilisation du portail."
      />

      {info.existe ? (
        <SoldeOuvertureCorrection
          montantActuel={info.montantActuel}
          definiLe={info.definiLe!.toISOString()}
          canCorriger={canCorriger}
          canAlimenter={canAlimenter}
        />
      ) : (
        <SoldeOuvertureForm disabled={!canCorriger} />
      )}

      <SoldeOuvertureHistorique entries={historique} />
      <AlimentationsCaisseHistorique entries={alimentations} />
    </div>
  );
}
