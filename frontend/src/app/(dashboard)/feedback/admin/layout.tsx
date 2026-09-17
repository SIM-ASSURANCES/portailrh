import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";

/**
 * Layout de l'espace de modération FeedbackApp.
 * Accessible uniquement aux utilisateurs disposant de la permission `feedback.moderer` (RH & DG).
 * Distinct du rôle technique "Admin" (`/admin/*`) pour permettre à RH et DG d'y accéder
 * sans avoir besoin du rôle Admin.
 */
export default async function FeedbackAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, "feedback.moderer")) {
    redirect("/?error=acces_refuse_moderation");
  }

  return <>{children}</>;
}
