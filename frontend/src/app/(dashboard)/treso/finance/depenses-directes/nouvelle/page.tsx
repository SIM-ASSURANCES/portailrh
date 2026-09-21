import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { DepenseDirecteForm } from "./DepenseDirecteForm";

/**
 * Saisie directe d'une dépense (Phase F, cahier des charges section 11) —
 * l'action elle-même reste réservée à `treso.saisir_depense_directe`
 * (Responsable Finance dans le seed actuel, pas Collaborateur, DG, ni
 * Assistant Finance par défaut — voir CLAUDE.md pour le choix documenté).
 * Revérifiée dans la Server Action, jamais uniquement via la garde
 * partagée de `finance/layout.tsx` (qui accepte plusieurs permissions
 * Finance différentes).
 *
 * **Garde de PAGE élargie** (Tâche "Séparation Responsable Finance /
 * Assistant Finance", voir CLAUDE.md) — accepte en plus
 * `treso.effectuer_reglement`/`treso.receptionner_retour` : la page doit
 * rester atteignable par un Assistant Finance sans délégation, pour qu'il
 * voie le bouton "Créer la dépense directe" VISIBLE MAIS DÉSACTIVÉ plutôt
 * que de se heurter à une redirection — l'autorisation précise
 * (`treso.saisir_depense_directe`) reste vérifiée sur le bouton lui-même
 * ET dans la Server Action.
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
  const canAccess =
    !!session &&
    (hasPermission(session, "treso.saisir_depense_directe") ||
      hasPermission(session, "treso.effectuer_reglement") ||
      hasPermission(session, "treso.receptionner_retour"));
  if (!canAccess) {
    redirect("/?error=acces_refuse_saisir_depense_directe");
  }
  const canSaisir = hasPermission(session, "treso.saisir_depense_directe");

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
        disabled={!canSaisir}
      />
    </div>
  );
}
