import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { AbsencesClient } from "@/app/(dashboard)/pointage/rh/absences/AbsencesClient";

export default async function AbsencesPage() {
  const session = await getSession();

  if (!session || !hasPermission(session, "pointage.voir_dashboard_rh")) {
    redirect("/pointage/pointer?error=acces_refuse_absences");
  }

  // Fetch absences and related user information
  const absences = await prisma.absence.findMany({
    orderBy: { date: "desc" },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      controlePar: {
        select: {
          id: true,
          fullName: true,
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Gestion des Absences"
        description="Analysez les pointages manquants et traitez les justificatifs d'absence."
        backHref="/pointage/rh"
        backLabel="Retour RH"
      />
      <AbsencesClient initialAbsences={absences} />
    </div>
  );
}
