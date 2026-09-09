import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { prisma } from "backend";
import { redirect } from "next/navigation";
import { ProfileClient } from "./ProfileClient";

export const metadata = {
  title: "Mon Profil | SIM Assurances",
  description: "Gérez vos informations personnelles, votre activité et vos paramètres de sécurité.",
};

export default async function ProfilPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Bornes du mois en cours
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Données utilisateur complètes (service)
  const userDb = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { service: true, createdAt: true },
  });

  const canSeePointage =
    hasPermission(session, "pointage.pointer") ||
    hasPermission(session, "pointage.voir_dashboard_rh");

  const canSeeTreso =
    hasPermission(session, "treso.creer_demande") ||
    hasPermission(session, "treso.voir_dashboard_finance");

  // Statistiques pointage du mois (seulement si pertinent pour ce rôle)
  const [nbRetardsMois, nbAbsencesMois] = canSeePointage && !isAdmin(session)
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
  const nbDemandesEnCours = canSeeTreso && !isAdmin(session)
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
        service={userDb?.service ?? null}
        membreDepuis={userDb?.createdAt?.toISOString() ?? null}
        showPointageStats={canSeePointage && !isAdmin(session)}
        showTresoStats={canSeeTreso && !isAdmin(session)}
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
