import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons";
import { BrandBackdrop } from "@/components/ui";
import { prisma } from "backend";

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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden border-[3px] border-primary bg-surface px-4 py-12">
      <BrandBackdrop className="absolute inset-0 h-full w-full" />

      <div className="animate-fade-in-up relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
        <div className="flex items-center justify-center bg-primary px-6 py-5">
          <Image
            src="/logo-sim-blanc.svg"
            alt="SIM Assurances"
            width={190}
            height={28}
            priority
          />
        </div>

        <div className="space-y-4 p-8">
          <div>
            <h1 className="text-lg font-bold text-foreground">Nouveau mot de passe</h1>
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
      </div>
    </div>
  );
}
