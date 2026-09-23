import type { Metadata } from "next";

import { AuthShell } from "../AuthShell";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Mot de passe oublié | SIM Assurances",
  description: "Réinitialisation de mot de passe pour le portail interne SIM Assurances",
};

export default async function ForgotPasswordPage() {
  return (
    <AuthShell tagline="Nous vous envoyons un lien sécurisé pour réinitialiser votre accès en toute confidentialité.">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Mot de passe oublié</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saisissez votre adresse email institutionnelle pour recevoir un lien de réinitialisation sécurisé.
          </p>
        </div>

        <ForgotPasswordForm />
      </div>
    </AuthShell>
  );
}
