import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "backend";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const token = body?.token;

    if (token && typeof token === "string") {
      await prisma.fcmToken.deleteMany({
        where: {
          token,
          userId: session.user.id,
        },
      });
    } else {
      // Si aucun token précis n'est fourni, on supprime les tokens de cet utilisateur
      await prisma.fcmToken.deleteMany({
        where: { userId: session.user.id },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[FCM] Erreur dans /api/push/unregister:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
