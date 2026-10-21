import { chargerSignaturesDocument, prisma, type SignatureDocument } from "backend";

/** Signature d'une étape, prête à imprimer (octets PNG joints). */
export interface SignatureImprimee extends SignatureDocument {
  image: Buffer | null;
}

/**
 * Lot L — signatures imprimées sur un reçu : celle de chaque personne qui a validé une étape (Service, Finance, DG) puis de celle qui a
 * fait l'action du document, dans l'ordre du circuit. Les actions d'avant la mise en service sont mentionnées « Antérieur à la signature ».
 */
export async function chargerSignaturesImprimees(
  demandeId: string,
  execution: { action: string; entiteId: string; etape: string; repli?: { nom: string; fonction: string; date: Date } | null }
): Promise<SignatureImprimee[]> {
  const lignes = await chargerSignaturesDocument(prisma, demandeId, execution);
  const ids = Array.from(new Set(lignes.map((l) => l.signatureId).filter((x): x is string => x !== null)));
  const images = new Map<string, Buffer>();
  if (ids.length > 0) {
    for (const v of await prisma.signatureUtilisateur.findMany({ where: { id: { in: ids } }, select: { id: true, image: true } })) {
      images.set(v.id, Buffer.from(v.image));
    }
  }
  return lignes.map((l) => ({ ...l, image: l.signatureId ? (images.get(l.signatureId) ?? null) : null }));
}
