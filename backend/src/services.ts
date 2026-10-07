// Services et responsables (circuit de validation des demandes de Trésorerie, commit 2, 2026-10-06).
//
// Chaque utilisateur appartient à un service ; le responsable du service valide l'étape « Service » des demandes de
// ses membres. En base, le service d'un compte et le responsable d'un service restent facultatifs (comptes créés après
// la migration) : c'est la création d'une demande qui refuse un demandeur sans service, ou dont le service n'a pas de
// responsable actif — jamais une demande bloquée plus tard dans le circuit.

import type { PrismaClient } from "./generated/prisma/client";

export type ServiceDb = Pick<PrismaClient, "user" | "service">;

/** Données utiles pour décider (lecture seule). */
export interface ServiceDuDemandeur {
  serviceNom: string | null;
  responsableId: string | null;
  responsableActif: boolean;
}

/** Message de refus de la création d'une demande, ou `null` si le service du demandeur le permet (fonction pure). */
export function messageBlocageCreationDemande(s: ServiceDuDemandeur): string | null {
  if (!s.serviceNom) {
    return "Votre compte n'est rattaché à aucun service : demandez à un administrateur de vous en attribuer un avant de créer une demande.";
  }
  if (!s.responsableId) {
    return `Le service « ${s.serviceNom} » n'a pas de responsable : votre demande ne pourrait pas être validée. Demandez à un administrateur d'en désigner un.`;
  }
  if (!s.responsableActif) {
    return `Le responsable du service « ${s.serviceNom} » a un compte désactivé : demandez à un administrateur de désigner un autre responsable.`;
  }
  return null;
}

export async function chargerServiceDuDemandeur(db: ServiceDb, userId: string): Promise<ServiceDuDemandeur> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { service: { select: { name: true, responsableId: true, responsable: { select: { isActive: true } } } } },
  });
  return {
    serviceNom: u?.service?.name ?? null,
    responsableId: u?.service?.responsableId ?? null,
    responsableActif: u?.service?.responsable?.isActive ?? false,
  };
}

/** Services sans responsable (alertes de l'administration). */
export async function getServicesSansResponsable(db: Pick<PrismaClient, "service">): Promise<{ id: string; name: string }[]> {
  return db.service.findMany({ where: { responsableId: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** Noms des services dont ce compte est le responsable (garde de désactivation et de suppression d'un compte). */
export async function getServicesDontResponsable(db: Pick<PrismaClient, "service">, userId: string): Promise<string[]> {
  const services = await db.service.findMany({ where: { responsableId: userId }, orderBy: { name: "asc" }, select: { name: true } });
  return services.map((s) => s.name);
}

// ---------------------------------------------------------------------------------------------------------------------
// Désignation du responsable (2026-10-08) : visible et attribuable depuis les écrans Services et Utilisateurs. La logique
// du circuit ne change pas : l'étape « Service » lit toujours le responsable ACTUEL du service du demandeur, donc les
// demandes en cours passent d'elles-mêmes au nouveau responsable ; on trace seulement ce transfert dans leur historique.
// ---------------------------------------------------------------------------------------------------------------------

export type ActionSurResponsable = "desactiver" | "supprimer" | "changer_service";

/**
 * Refus d'une action sur un compte qui est le seul responsable d'un ou plusieurs services sans remplaçant (fonction
 * pure). `services` : noms des services concernés ; vide → `null` (action permise).
 */
export function messageRefusResponsableSansRemplacant(
  nomCompte: string,
  services: string[],
  action: ActionSurResponsable
): string | null {
  if (services.length === 0) return null;
  const liste = services.map((s) => `« ${s} »`).join(", ");
  const verbe = action === "desactiver" ? "désactiver" : action === "supprimer" ? "supprimer" : "changer de service";
  const ces = services.length > 1 ? "des services" : "du service";
  return `Impossible de ${verbe} ${nomCompte} : c'est le seul responsable ${ces} ${liste}, sans remplaçant. Désignez d'abord un autre responsable (Administration › Services), sinon les demandes de ses membres resteraient bloquées à l'étape Service.`;
}

/**
 * Services que ce compte quitterait sans remplaçant en changeant de service : seulement le service dont il est membre
 * ET responsable (un responsable peut être extérieur au service ; ses autres responsabilités ne sont pas touchées).
 */
export function servicesQuittesSansRemplacant(
  user: { serviceId: string | null },
  servicesDontResponsable: { id: string; name: string }[],
  nouveauServiceId: string
): string[] {
  if (!user.serviceId || user.serviceId === nouveauServiceId) return [];
  return servicesDontResponsable.filter((s) => s.id === user.serviceId).map((s) => s.name);
}

export type DbChangementResponsable = Pick<PrismaClient, "service" | "user" | "demande" | "historiqueEntry">;

export type ResultatChangementResponsable =
  | {
      ok: true;
      inchange: boolean;
      serviceNom: string;
      ancien: { id: string; fullName: string } | null;
      nouveau: { id: string; fullName: string };
      /** Demandes à l'étape Service désormais pour le nouveau responsable (une ligne d'historique chacune). */
      demandesTransferees: number;
      /** Parmi elles, celles dont il est lui-même le demandeur : personne ne valide sa propre demande. */
      demandesDuNouveauResponsable: number;
    }
  | { ok: false; message: string };

/**
 * Remplace le responsable d'un service, dans la transaction de l'appelant. Compte actif exigé ; changement conditionné
 * au responsable lu (deux changements simultanés : un seul passe). Chaque demande à l'étape Service d'un membre du
 * service reçoit une ligne d'historique : la validation passe au nouveau responsable. La journalisation de l'action
 * elle-même (qui, quand, ancien, nouveau) reste à l'appelant.
 */
export async function changerResponsableService(
  db: DbChangementResponsable,
  p: { serviceId: string; nouveauResponsableId: string; auteurId: string }
): Promise<ResultatChangementResponsable> {
  if (!p.nouveauResponsableId) return { ok: false, message: "Le responsable du service est obligatoire." };
  const [service, nouveau] = await Promise.all([
    db.service.findUnique({
      where: { id: p.serviceId },
      select: { name: true, responsableId: true, responsable: { select: { id: true, fullName: true } } },
    }),
    db.user.findUnique({ where: { id: p.nouveauResponsableId }, select: { id: true, fullName: true, isActive: true } }),
  ]);
  if (!service) return { ok: false, message: "Service introuvable." };
  if (!nouveau || !nouveau.isActive) return { ok: false, message: "Le responsable choisi doit être un compte actif." };
  const ancien = service.responsable ?? null;
  const base = { serviceNom: service.name, ancien, nouveau: { id: nouveau.id, fullName: nouveau.fullName } };
  if (service.responsableId === nouveau.id) {
    return { ok: true, inchange: true, ...base, demandesTransferees: 0, demandesDuNouveauResponsable: 0 };
  }

  const maj = await db.service.updateMany({
    where: { id: p.serviceId, responsableId: service.responsableId },
    data: { responsableId: nouveau.id },
  });
  if (maj.count !== 1) return { ok: false, message: "Le responsable de ce service a changé entre-temps : rechargez la page." };

  const demandes = await db.demande.findMany({
    where: { etapeCircuit: "SERVICE", createur: { serviceId: p.serviceId } },
    select: { id: true, createurId: true },
  });
  for (const d of demandes) {
    await db.historiqueEntry.create({
      data: {
        entity: "Demande",
        entityId: d.id,
        action: "changement_responsable_service",
        detail: `Responsable du service « ${service.name} » : ${ancien?.fullName ?? "aucun"} → ${nouveau.fullName}. La validation de l'étape Service passe à ${nouveau.fullName}.`,
        userId: p.auteurId,
      },
    });
  }
  return {
    ok: true,
    inchange: false,
    ...base,
    demandesTransferees: demandes.length,
    demandesDuNouveauResponsable: demandes.filter((d) => d.createurId === nouveau.id).length,
  };
}

/** Comptes responsables d'au moins un service : `userId` → noms des services (badges de la liste des utilisateurs). */
export async function getResponsabilitesParUtilisateur(db: Pick<PrismaClient, "service">): Promise<Map<string, string[]>> {
  const services = await db.service.findMany({
    where: { responsableId: { not: null } },
    orderBy: { name: "asc" },
    select: { name: true, responsableId: true },
  });
  const parUser = new Map<string, string[]>();
  for (const s of services) parUser.set(s.responsableId!, [...(parUser.get(s.responsableId!) ?? []), s.name]);
  return parUser;
}
