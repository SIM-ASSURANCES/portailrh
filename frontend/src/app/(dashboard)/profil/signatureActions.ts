"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getSession } from "@/lib/auth";
import { ajouterVersionSignature, decoderDataUrlPng, getTrustedClientIp, prisma, validerImageSignature } from "backend";

export type ResultatSignature = { status: "success"; message: string; version: number } | { status: "error"; message: string };

/**
 * Enrôle (ou remplace par une NOUVELLE VERSION) la signature manuscrite du compte connecté. L'image est entièrement revalidée ici :
 * PNG seulement, 100 Ko maximum, dimensions bornées, tracé non vide ; elle est reconstruite sans métadonnées. Les versions précédentes
 * ne sont jamais modifiées : les actions déjà signées gardent la signature qu'elles ont utilisée.
 */
export async function enregistrerSignatureAction(dataUrl: string): Promise<ResultatSignature> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Action non autorisée." };

  const decode = decoderDataUrlPng(dataUrl);
  if (!decode.ok) return { status: "error", message: decode.message };
  const image = validerImageSignature(decode.octets);
  if (!image.ok) return { status: "error", message: image.message };

  const ip = getTrustedClientIp(await headers());
  const cree = await prisma.$transaction(async (tx) => {
    const v = await ajouterVersionSignature(tx, session.user.id, image);
    await tx.historiqueEntry.create({
      data: {
        entity: "User",
        entityId: session.user.id,
        action: "enregistrement_signature",
        detail: `Signature manuscrite enregistrée (version ${v.version}, empreinte ${image.empreinte.slice(0, 12)})`,
        ipAddress: ip,
        userId: session.user.id,
      },
    });
    return v;
  });

  revalidatePath("/profil");
  return { status: "success", message: `Signature enregistrée (version ${cree.version}).`, version: cree.version };
}
