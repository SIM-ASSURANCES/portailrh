import type { Metadata } from "next";
import Image from "next/image";
import { BrandBackdrop } from "@/components/ui";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Mot de passe oublié | SIM Assurances",
  description: "Réinitialisation de mot de passe pour le portail interne SIM Assurances",
};

export default async function ForgotPasswordPage() {
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
            <h1 className="text-lg font-bold text-foreground">Mot de passe oublié</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Saisissez votre adresse email institutionnelle pour recevoir un lien de réinitialisation sécurisé.
            </p>
          </div>

          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  );
}
