import { revalidatePath } from "next/cache";

import { changerResponsableService, prisma, type ActionState } from "backend";

import { logAuditAction } from "@/lib/auditLog";
import { publishDataChanged } from "@/lib/eventBus";

type SessionAuteur = { user: { id: string; fullName: string; email: string } };

/**
 * Désigne `nouveauResponsableId` responsable du service (écran Services, liste et formulaire des utilisateurs). Seule
 * porte d'écriture du responsable : l'appelant a déjà vérifié la permission (`isAdmin`, gestion des utilisateurs et des
 * services). Si un autre responsable existe, `confirmerRemplacement` est exigé et le message le nomme : il reste
 * membre de son service, il n'en est plus responsable. Le changement est journalisé (qui, quand, ancien, nouveau) et
 * les demandes à l'étape Service passent au nouveau responsable (une ligne d'historique chacune).
 */
export async function designerResponsableService(
  session: SessionAuteur,
  serviceId: string,
  nouveauResponsableId: string,
  confirmerRemplacement: boolean
): Promise<ActionState> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { name: true, responsableId: true, responsable: { select: { fullName: true } } },
  });
  if (!service) return { status: "error", message: "Service introuvable." };
  if (service.responsableId && service.responsableId !== nouveauResponsableId && !confirmerRemplacement) {
    return {
      status: "error",
      message: `${service.responsable?.fullName} est actuellement responsable du service « ${service.name} » : confirmez le remplacement (il reste membre de son service, il n'en est plus responsable).`,
    };
  }

  const r = await prisma.$transaction((tx) =>
    changerResponsableService(tx, { serviceId, nouveauResponsableId, auteurId: session.user.id })
  );
  if (!r.ok) return { status: "error", message: r.message };
  if (r.inchange) return { status: "success", message: `${r.nouveau.fullName} est déjà responsable du service « ${r.serviceNom} ».` };

  await logAuditAction({
    entity: "Service",
    entityId: serviceId,
    action: "CHANGE_RESPONSABLE",
    detail: `Responsable du service « ${r.serviceNom} » : ${r.ancien?.fullName ?? "aucun"} → ${r.nouveau.fullName} (${r.demandesTransferees} demande(s) à l'étape Service transférée(s))`,
    userId: session.user.id,
    userFullName: session.user.fullName,
    userEmail: session.user.email,
    logFileName: "services.log",
  });

  revalidatePath("/admin/services");
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  revalidatePath("/", "layout");
  publishDataChanged();

  const transfert = r.demandesTransferees > 0 ? ` ${r.demandesTransferees} demande(s) à l'étape Service lui sont transférées.` : "";
  // Personne ne valide sa propre demande (règle du circuit, inchangée) : on le signale sans rien bloquer.
  const propres =
    r.demandesDuNouveauResponsable > 0
      ? ` Attention : ${r.demandesDuNouveauResponsable} de ces demandes sont les siennes, il ne pourra pas les valider lui-même.`
      : "";
  return { status: "success", message: `${r.nouveau.fullName} est désormais responsable du service « ${r.serviceNom} ».${transfert}${propres}` };
}
