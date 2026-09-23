import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/icons";
import { prisma } from "backend";

import { AuthShell } from "../../AuthShell";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Réinitialiser mon mot de passe | SIM Assurances",
  description: "Définissez un nouveau mot de passe pour votre compte SIM Assurances",
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const user = await prisma.user.findUnique({
    where: { resetPasswordToken: token },
  });

  const etat: "ok" | "invalide" | "expire" = !user
    ? "invalide"
    : !user.resetPasswordExpiresAt || user.resetPasswordExpiresAt < new Date()
      ? "expire"
      : "ok";

  return (
    <AuthShell tagline="Choisissez un nouveau mot de passe robuste pour sécuriser votre compte.">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Nouveau mot de passe</h1>
          <p className="mt-1 text-sm text-muted-foreground">Portail interne SIM Assurances</p>
        </div>

        {etat === "invalide" ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
              Ce lien de réinitialisation est invalide ou a déjà été utilisé.
            </p>
            <div className="pt-2 text-center">
              <Link
                href="/forgot-password"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Icon name="arrow-left" className="size-4" />
                Demander un nouveau lien
              </Link>
            </div>
          </div>
        ) : etat === "expire" ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
              Ce lien de réinitialisation a expiré (validité de 1 heure). Veuillez effectuer une nouvelle demande.
            </p>
            <div className="pt-2 text-center">
              <Link
                href="/forgot-password"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Icon name="arrow-left" className="size-4" />
                Demander un nouveau lien
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground">
              Bonjour <span className="font-semibold">{user!.fullName}</span>, choisissez votre nouveau
              mot de passe pour votre compte ({user!.email}).
            </p>
            <ResetPasswordForm token={token} />
          </>
        )}
      </div>
    </AuthShell>
  );
}
