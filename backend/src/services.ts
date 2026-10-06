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
