import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";

export async function GET() {
  const session = await getSession();
  
  if (!session) {
    return NextResponse.json({ error: "Vous devez être connecté" }, { status: 401 });
  }

  // Crée une notification pour l'utilisateur connecté
  const notif = await createNotification({
    userId: session.user.id,
    titre: "🎉 Système opérationnel",
    message: "Ceci est une notification de test pour valider le fonctionnement du système !",
    lien: "/profil",
  });

  if (notif) {
    return NextResponse.json({ 
      success: true, 
      message: "Notification envoyée ! Regardez la cloche dans la Topbar." 
    });
  }

  return NextResponse.json({ error: "Erreur lors de la création" }, { status: 500 });
}
