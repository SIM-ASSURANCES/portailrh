"use server";

import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

/**
 * Déconnecte l'utilisateur puis renvoie vers /login. Utilisé par le bouton
 * « Déconnexion » de la sidebar (formulaire server action).
 */
export async function signOutAction() {
  const session = await auth();
  
  if (session?.user?.id) {
    const headersList = await headers();
    let rawIp = headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "Inconnue";
    if (rawIp.includes(",")) rawIp = rawIp.split(",")[0].trim();
    const ip = rawIp.replace(/^::ffff:/i, "");

    await prisma.historiqueEntry.create({
      data: {
        entity: "Auth",
        entityId: session.user.id,
        action: "LOGOUT",
        detail: `Déconnexion réussie. IP: ${ip}`,
        ipAddress: ip,
        userId: session.user.id,
      },
    });
  }

  await signOut({ redirectTo: "/login" });
}
