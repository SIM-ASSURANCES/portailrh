import { redirect } from "next/navigation";

import { formatDateCourte } from "@/components/encaissements/libelles";
import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { BranchesManager } from "./BranchesManager";

/**
 * Gestion minimale des branches (commit 4d) : sans branche, aucun import possible avant l'écran F9 du Lot 3. Liste,
 * ajout, désactivation/réactivation — réservées à `enc.parametrer`, revérifiée ici ET dans chaque action
 * (`parametres/actions.ts`, qui trace dans `EncAudit`).
 */
export default async function BranchesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.parametrer")) {
    redirect("/encaissements");
  }

  const branches = await prisma.encBranche.findMany({ orderBy: [{ actif: "desc" }, { libelle: "asc" }] });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Branches"
        description="Liste des branches utilisées par les imports et le suivi. Une branche désactivée reste attachée aux données existantes."
        backHref="/encaissements"
        backLabel="Encaissements"
      />
      <BranchesManager
        branches={branches.map((b) => ({ id: b.id, code: b.code, libelle: b.libelle, actif: b.actif, creeLe: formatDateCourte(b.creeAt) }))}
      />
    </div>
  );
}
