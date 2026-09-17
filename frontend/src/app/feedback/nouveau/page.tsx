import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons";
import { BrandBackdrop } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { getFeedbackRecipients } from "backend";

import { FeedbackForm } from "./FeedbackForm";

/**
 * Page de soumission FeedbackApp (accessible aussi bien publiquement qu'en interne).
 * Si un collaborateur est connecté, il ne peut pas se choisir lui-même comme destinataire.
 * RÈGLE ABSOLUE : anonymat complet préservé, aucune information de l'expéditeur n'est stockée.
 */
export default async function NouveauFeedbackPage() {
  const session = await getSession();
  const recipients = await getFeedbackRecipients(session?.user?.id);

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden border-[3px] border-primary bg-surface px-4 py-12">
      <BrandBackdrop className="absolute inset-0 h-full w-full" />

      <div className="animate-fade-in-up relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
        <div className="flex items-center justify-center bg-primary px-6 py-5">
          <Image src="/logo-sim-blanc.svg" alt="SIM Assurances" width={190} height={28} priority />
        </div>

        <div className="space-y-4 p-8">
          <div className="flex items-center justify-between gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"
            >
              <Icon name="arrow-left" className="size-3.5" />
              Retour au portail
            </Link>
          </div>

          <div>
            <h1 className="text-lg font-bold text-foreground">Laisser un message constructif</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Votre message est totalement anonyme : aucune information vous concernant n&apos;est
              enregistrée, ni conservée d&apos;aucune façon.
            </p>
          </div>

          <FeedbackForm recipients={recipients} />

          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <Link href="/feedback" className="font-medium text-primary hover:underline">
              Voir les messages publics
            </Link>
            <span>•</span>
            <Link href="/" className="font-medium text-primary hover:underline">
              Retour au portail
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
