import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { prisma } from "backend";
import { redirect } from "next/navigation";
import { ProfileClient } from "./ProfileClient";

import { format } from "date-fns";

export const metadata = {
  title: "Mon Profil | SIM Assurances",
  description: "Gérez vos informations personnelles, votre activité et vos paramètres de sécurité.",
};

export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const resolvedParams = await searchParams;
  const moisParam = resolvedParams.mois as string;

  // Bornes du mois sélectionné (ou actuel)
  const now = new Date();
  const referenceDate = moisParam ? new Date(`${moisParam}-01T00:00:00`) : now;
  const startOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const endOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999);
  const selectedMonth = format(referenceDate, "yyyy-MM");

  // Données utilisateur complètes (service)
  const userDb = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { service: { select: { name: true } }, createdAt: true },
  });

  const canPointer = hasPermission(session, "pointage.pointer");
  const canCreerDemande = hasPermission(session, "treso.creer_demande");

  // Statistiques pointage du mois (seulement si pertinent pour ce rôle)
  const [nbRetardsMois, nbAbsencesMois] = canPointer
    ? await Promise.all([
        prisma.pointage.count({
          where: {
            userId: session.user.id,
            estRetard: true,
            heure: { gte: startOfMonth, lte: endOfMonth },
          },
        }),
        prisma.absence.count({
          where: {
            userId: session.user.id,
            date: { gte: startOfMonth, lte: endOfMonth },
          },
        }),
      ])
    : [0, 0];

  // Demandes de trésorerie en cours (seulement si pertinent)
  const nbDemandesEnCours = canCreerDemande
    ? await prisma.demande.count({
        where: {
          createurId: session.user.id,
          statut: {
            in: [
              "EN_ATTENTE_VALIDATION",
              "VALIDEE",
              "PARTIELLEMENT_VALIDEE",
              "VALIDEE_NON_REGLEE",
              "PARTIELLEMENT_REGLEE",
            ],
          },
        },
      })
    : 0;

  // Historique des 5 dernières connexions réussies
  const dernieresConnexions = await prisma.historiqueEntry.findMany({
    where: {
      userId: session.user.id,
      entity: "Auth",
      action: "LOGIN_SUCCESS",
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      ipAddress: true,
      createdAt: true,
      detail: true,
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <ProfileClient
        user={session.user}
        role={session.role}
        service={userDb?.service?.name ?? null}
        membreDepuis={userDb?.createdAt?.toISOString() ?? null}
        selectedMonth={selectedMonth}
        showPointageStats={canPointer}
        showTresoStats={canCreerDemande}
        nbRetardsMois={nbRetardsMois}
        nbAbsencesMois={nbAbsencesMois}
        nbDemandesEnCours={nbDemandesEnCours}
        dernieresConnexions={dernieresConnexions.map((c) => ({
          id: c.id,
          ipAddress: c.ipAddress ?? "Inconnue",
          createdAt: c.createdAt.toISOString(),
          detail: c.detail ?? "",
        }))}
      />
    </div>
  );
}
