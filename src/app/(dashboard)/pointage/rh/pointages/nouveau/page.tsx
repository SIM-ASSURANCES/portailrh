import { Metadata } from "next";
import { getSession, hasPermission } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PointageExceptionnelForm } from "./PointageExceptionnelForm";

export const metadata: Metadata = {
  title: "Pointage Exceptionnel - SIM PORTAIL",
  description: "Saisie d'un pointage exceptionnel par les Ressources Humaines",
};

export default async function PointageExceptionnelPage() {
  const session = await getSession();
  
  if (!session || !session.user) {
    redirect("/auth/login");
  }

  // Vérifier la permission
  if (!hasPermission(session, "pointage.pointage_exceptionnel")) {
    redirect("/pointage");
  }

  // Récupérer la liste des collaborateurs actifs, triés par nom
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      fullName: true,
      service: true,
    },
    orderBy: {
      fullName: "asc",
    },
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pointage Exceptionnel</h1>
          <p className="text-muted-foreground mt-1">
            Enregistrez un pointage manuel pour un collaborateur.
          </p>
        </div>
      </div>

      <PointageExceptionnelForm users={users} />
    </div>
  );
}
