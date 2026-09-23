import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "backend";
import { fcmAdmin } from "@/lib/firebase/firebaseAdmin";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const body = await req.json();
    const token = body?.token;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token FCM requis" }, { status: 400 });
    }

    const userAgent = req.headers.get("user-agent") || null;

    // Enregistrement ou mise à jour du token pour cet utilisateur
    await prisma.fcmToken.upsert({
      where: { token },
      create: {
        token,
        userId: session.user.id,
        userAgent,
      },
      update: {
        userId: session.user.id,
        userAgent,
        updatedAt: new Date(),
      },
    });

    // Abonnement aux FCM Topics correspondant aux permissions actives de l'utilisateur
    if (fcmAdmin && session.permissions && session.permissions.length > 0) {
      const validTopics = session.permissions
        .map((p) => `perm-${p.replace(/[^a-zA-Z0-9-_.~%]/g, "-")}`)
        .slice(0, 50); // Limite raisonnable par appel

      for (const topic of validTopics) {
        try {
          await fcmAdmin.subscribeToTopic([token], topic);
        } catch (err) {
          console.warn(`[FCM] Échec abonnement topic ${topic}:`, err);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[FCM] Erreur dans /api/push/register:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
