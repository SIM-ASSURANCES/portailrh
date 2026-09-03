import Image from "next/image";

import { Icon } from "@/components/icons";
import { BrandBackdrop } from "@/components/ui";
import { prisma } from "@/lib/prisma";

import { InvitationForm } from "./InvitationForm";

/**
 * Page PUBLIQUE de finalisation d'un compte invité par lien (voir
 * CLAUDE.md "Invitation par lien") — aucune session requise, accessible
 * depuis `(auth)` comme `/login` (pas de garde dans ce groupe de routes).
 *
 * Trois états déterminés côté serveur, pour un affichage immédiat correct
 * sans dépendre d'une première soumission ratée du formulaire :
 * - `invalide` — jeton introuvable (jamais existé, ou déjà consommé par
 *   une activation précédente : `activerInvitationAction` remet
 *   `invitationToken` à `null` à l'activation, les deux cas deviennent
 *   donc indiscernables et partagent le même message).
 * - `expire` — jeton trouvé mais `invitationExpiresAt` dépassé.
 * - `ok` — formulaire de mot de passe affiché.
 *
 * Mêmes contrôles revérifiés intégralement côté serveur dans
 * `activerInvitationAction` (défense en profondeur, jamais uniquement cet
 * affichage qui a pu devenir obsolète entre le chargement de la page et la
 * soumission — le lien a pu expirer ou être utilisé entre-temps).
 */
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const user = await prisma.user.findUnique({ where: { invitationToken: token } });

  const etat: "ok" | "invalide" | "expire" =
    !user || user.passwordHash
      ? "invalide"
      : !user.invitationExpiresAt || user.invitationExpiresAt < new Date()
        ? "expire"
        : "ok";

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden border-[3px] border-primary bg-surface px-4 py-12">
      <BrandBackdrop className="absolute inset-0 h-full w-full" />

      <div className="animate-fade-in-up relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
        <div className="flex items-center justify-center bg-primary px-6 py-5">
          <Image src="/logo-sim-blanc.svg" alt="SIM Assurances" width={190} height={28} priority />
        </div>

        <div className="space-y-4 p-8">
          <div>
            <h1 className="text-lg font-bold text-foreground">Finaliser mon compte</h1>
            <p className="mt-1 text-sm text-muted-foreground">Portail interne SIM Assurances</p>
          </div>

          {etat === "invalide" ? (
            <p className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
              Ce lien d&apos;invitation est invalide ou a déjà été utilisé. Contactez un administrateur
              pour en obtenir un nouveau.
            </p>
          ) : etat === "expire" ? (
            <p className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
              Ce lien d&apos;invitation a expiré. Contactez un administrateur pour qu&apos;il vous en
              génère un nouveau.
            </p>
          ) : (
            <>
              <p className="text-sm text-foreground">
                Bonjour <span className="font-semibold">{user!.fullName}</span>, choisissez votre mot de
                passe pour activer votre compte ({user!.email}).
              </p>
              <InvitationForm token={token} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
