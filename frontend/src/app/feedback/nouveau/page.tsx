import Image from "next/image";
import Link from "next/link";

import { BrandBackdrop } from "@/components/ui";
import { getFeedbackRecipients } from "backend";

import { FeedbackForm } from "./FeedbackForm";

/**
 * Page PUBLIQUE de soumission FeedbackApp — accessible sans compte, sans
 * session (voir `auth.config.ts`, exception `isFeedbackPublicRoute`, et
 * CLAUDE.md "FeedbackApp : anonymat total"). Aucun `getSession()` appelé
 * ici : peu importe qui visite cette page, connecté ou non, elle se
 * comporte à l'identique — jamais de comportement différent selon une
 * identité qui, par construction, n'est d'ailleurs jamais lue ni stockée
 * pour ce message.
 */
export default async function NouveauFeedbackPage() {
  const recipients = await getFeedbackRecipients();

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden border-[3px] border-primary bg-surface px-4 py-12">
      <BrandBackdrop className="absolute inset-0 h-full w-full" />

      <div className="animate-fade-in-up relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
        <div className="flex items-center justify-center bg-primary px-6 py-5">
          <Image src="/logo-sim-blanc.svg" alt="SIM Assurances" width={190} height={28} priority />
        </div>

        <div className="space-y-4 p-8">
          <div>
            <h1 className="text-lg font-bold text-foreground">Laisser un message constructif</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Votre message est totalement anonyme : aucune information vous concernant n&apos;est
              enregistrée, ni conservée d&apos;aucune façon.
            </p>
          </div>

          <FeedbackForm recipients={recipients} />

          <p className="text-center text-xs text-muted-foreground">
            <Link href="/feedback" className="font-medium text-primary hover:underline">
              Voir les messages publics
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
