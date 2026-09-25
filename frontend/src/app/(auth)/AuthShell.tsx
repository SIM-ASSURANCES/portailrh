import Image from "next/image";
import type { ReactNode } from "react";

import { BrandBackdrop } from "@/components/ui";

/**
 * Coquille visuelle PARTAGÉE des 3 écrans d'authentification restylés
 * (connexion, mot de passe oublié, réinitialisation) : une carte blanche
 * unique et centrée (logo + `children`, le formulaire propre à chaque écran)
 * sur le fond de page blanc avec le filigrane discret de la marque. Le
 * panneau bleu illustré qui existait à droite a été retiré (décision produit
 * du 2026-09-25).
 *
 * **Volontairement PAS un `(auth)/layout.tsx`** : ce groupe de routes
 * contient aussi `/invitation/[token]`, un 4ᵉ écran hors périmètre — un vrai
 * layout Next.js l'aurait restylé du même coup sans que ce soit demandé. Ce
 * composant est donc importé explicitement par les 3 pages concernées seulement.
 *
 * Purement présentationnel : ne contient aucune logique métier, aucun
 * Server Action, aucune validation — chaque page continue de porter
 * l'intégralité de son propre comportement (formulaire, erreurs, redirections).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-app-bg px-4 py-10 sm:py-14">
      {/* Papier à en-tête institutionnel en arrière-plan de PAGE (voir
          CLAUDE.md "Logo vectoriel et fond de marque"). */}
      <BrandBackdrop className="absolute inset-0 h-full w-full" watermarkOpacityClassName="opacity-[0.05]" />

      <div className="animate-fade-in-up relative flex w-full max-w-md flex-col justify-center gap-6 overflow-hidden rounded-3xl border border-border bg-surface px-6 py-10 shadow-elevated-lg sm:px-10 sm:py-12">
        <Image src="/logo-sim-couleur.svg" alt="SIM Assurances" width={176} height={26} priority />
        {children}
      </div>
    </div>
  );
}
