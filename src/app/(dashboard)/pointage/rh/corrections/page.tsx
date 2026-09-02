import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/ui";
import { CorrectionsClient, type PointageCorrectionRow } from "@/app/(dashboard)/pointage/rh/corrections/CorrectionsClient";

interface CorrectionsPageProps {
  searchParams: Promise<{
    search?: string;
  }>;
}

export default async function CorrectionsPage({ searchParams }: CorrectionsPageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!hasPermission(session, "pointage.corriger_pointage")) {
    redirect("/?error=acces_refuse");
  }

  const { search } = await searchParams;

  const whereClause: Prisma.PointageWhereInput = {};

  if (search) {
    whereClause.user = {
      fullName: {
        contains: search,
        mode: "insensitive",
      },
    };
  }

  const pointagesDb = await prisma.pointage.findMany({
    where: whereClause,
    orderBy: { heure: "desc" },
    include: {
      user: { select: { fullName: true, service: true } },
      effectuePar: { select: { fullName: true } },
    },
    take: 200, // On récupère les 200 derniers par défaut
  });

  const pointages: PointageCorrectionRow[] = pointagesDb.map((p) => ({
    id: p.id,
    heure: p.heure.toISOString(),
    type: p.type,
    source: p.source,
    estRetard: p.estRetard,
    minutesRetard: p.minutesRetard,
    motif: p.motif,
    collaborateurNom: p.user.fullName,
    collaborateurService: p.user.service,
    effectueParNom: p.effectuePar?.fullName ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Corrections"
        description="Traitez les demandes de correction des pointages."
        backHref="/pointage/rh"
        backLabel="Retour à la Boîte à Outils"
      />
      <CorrectionsClient initialData={pointages} search={search} />
    </div>
  );
}
