import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { DepenseDirecteForm } from "./DepenseDirecteForm";

/**
 * Saisie directe d'une dépense (Phase F, cahier des charges section 11) —
 * réservée à `treso.saisir_depense_directe` (Finance dans le seed actuel,
 * pas Collaborateur ni DG — voir CLAUDE.md pour le choix documenté).
 * Gardée ici (page) et revérifiée dans la Server Action, jamais uniquement
 * via la garde partagée de `finance/layout.tsx` (qui accepte plusieurs
 * permissions Finance différentes).
 *
 * Liste des utilisateurs actifs proposée pour le sélecteur "compte
 * existant" (Collaborateur/Stagiaire) : pas de distinction de rôle en
 * base entre "Collaborateur" et "Stagiaire" (un stagiaire avec compte
 * reçoit simplement un compte de rôle Collaborateur) — tous les
 * utilisateurs actifs sont donc proposés, quel que soit leur rôle
 * applicatif, y compris Finance/DG/RH (rien n'empêche de saisir une
 * dépense pour l'un d'eux).
 */
export default async function NouvelleDepenseDirectePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.saisir_depense_directe")) {
    redirect("/?error=acces_refuse_saisir_depense_directe");
  }

  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { fullName: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Nouvelle dépense directe"
        description="Saisie d'une dépense pour un bénéficiaire qui n'intervient pas lui-même dans la création (prime de stage, dotation carburant, dépense entreprise, dépense collective...)."
      />
      <DepenseDirecteForm
        users={users.map((u) => ({ id: u.id, label: `${u.fullName} (${u.email})` }))}
      />
    </div>
  );
}
