import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { getSoldeOuvertureInfo } from "backend";

import { SoldeOuvertureCorrection } from "./SoldeOuvertureCorrection";
import { SoldeOuvertureForm } from "./SoldeOuvertureForm";

/**
 * Écran "Solde d'ouverture de caisse" (voir CLAUDE.md) — réservé à
 * Finance/Admin (`treso.effectuer_reglement` OU `isAdmin()`, jamais le DG
 * seul), revérifié ici même si le layout Finance partagé accepte déjà un
 * ensemble de permissions plus large : ne jamais supposer cette
 * permission précise acquise du simple fait d'avoir passé cette garde.
 */
export default async function SoldeOuverturePage() {
  const session = await getSession();
  if (!session || !(isAdmin(session) || hasPermission(session, "treso.effectuer_reglement"))) {
    redirect("/?error=acces_refuse_solde_ouverture");
  }

  const info = await getSoldeOuvertureInfo();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Solde d'ouverture de caisse"
        description="Montant physique déjà présent en caisse avant l'utilisation du portail."
      />

      {info.existe ? (
        <SoldeOuvertureCorrection montantActuel={info.montantActuel} definiLe={info.definiLe!.toISOString()} />
      ) : (
        <SoldeOuvertureForm />
      )}
    </div>
  );
}
