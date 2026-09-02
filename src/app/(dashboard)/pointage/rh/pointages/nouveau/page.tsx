import { Metadata } from "next";
import { getSession, hasPermission } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PointageExceptionnelForm } from "./PointageExceptionnelForm";
import { PageHeader } from "@/components/ui";

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
      <PageHeader
        title="Pointage Exceptionnel"
        description="Enregistrez un pointage manuel pour un collaborateur."
        backHref="/pointage/rh"
        backLabel="Retour à la Boîte à Outils"
      />

      <PointageExceptionnelForm users={users} />
    </div>
  );
}
