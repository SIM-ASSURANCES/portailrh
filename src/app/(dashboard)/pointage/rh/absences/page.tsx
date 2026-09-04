import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { AbsencesClient } from "@/app/(dashboard)/pointage/rh/absences/AbsencesClient";
import { startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns";

export default async function AbsencesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();

  if (!session || !hasPermission(session, "pointage.voir_dashboard_rh")) {
    redirect("/pointage/pointer?error=acces_refuse_absences");
  }

  // Fetch absences and related user information
  const resolvedParams = await searchParams;
  const debut = resolvedParams.debut as string;
  const fin = resolvedParams.fin as string;

  const now = new Date();
  const dateDebut = debut ? startOfDay(new Date(debut)) : startOfMonth(now);
  const dateFin = fin ? endOfDay(new Date(fin)) : endOfMonth(now);

  const absences = await prisma.absence.findMany({
    where: {
      date: {
        gte: dateDebut,
        lte: dateFin,
      },
    },
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
        title="Retards & Absences"
        description="Consultez et validez les anomalies de pointage (retards, absences non justifiées)."
        backHref="/pointage/rh"
        backLabel="Retour à la Boîte à Outils"
      />
      <AbsencesClient 
        initialAbsences={absences} 
        defaultDebut={debut || dateDebut.toISOString().split("T")[0]} 
        defaultFin={fin || dateFin.toISOString().split("T")[0]} 
      />
    </div>
  );
}
