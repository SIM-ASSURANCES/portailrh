import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import type { NotificationPriority } from "backend";

export async function GET(request: Request) {
  const session = await getSession();
  
  if (!session) {
    return NextResponse.json({ error: "Vous devez être connecté" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const priorityParam = (searchParams.get("priority") || "IMPORTANT").toUpperCase() as NotificationPriority;
  const validPriorities: NotificationPriority[] = ["CRITIQUE", "IMPORTANT", "INFO"];
  const priority = validPriorities.includes(priorityParam) ? priorityParam : "IMPORTANT";

  // Crée une notification pour l'utilisateur connecté
  const notif = await notify({
    userId: session.user.id,
    titre: priority === "CRITIQUE" ? "🚨 Test Alerte Critique" : "🎉 Test Notification Push",
    message: `Notification de test (${priority}) envoyée le ${new Date().toLocaleTimeString("fr-FR")} pour valider les canaux Push, In-App et Email.`,
    lien: "/profil",
    priority: priority,
    category: "SYSTEME",
  });

  if (notif) {
    return NextResponse.json({ 
      success: true, 
      priority,
      message: `Notification (${priority}) envoyée ! Vérifiez la cloche, le toast, le son et vos notifications système.` 
    });
  }

  return NextResponse.json({ error: "Erreur lors de l'envoi" }, { status: 500 });
}
