import Image from "next/image";
import type { ReactNode } from "react";

import { BrandBackdrop } from "@/components/ui";

/**
 * Coquille visuelle PARTAGÉE des 3 écrans d'authentification restylés
 * (connexion, mot de passe oublié, réinitialisation) — voir CLAUDE.md
 * "Refonte visuelle des écrans d'authentification". Carte scindée en deux :
 * un panneau blanc à gauche (logo + `children`, le formulaire propre à
 * chaque écran) et un panneau illustré en dégradé de marque à droite
 * (~40% de la largeur), masqué sur mobile.
 *
 * **Volontairement PAS un `(auth)/layout.tsx`** : ce groupe de routes
 * contient aussi `/invitation/[token]`, un 4ᵉ écran hors périmètre de cette
 * tâche — un vrai layout Next.js l'aurait restylé du même coup sans que ce
 * soit demandé. Ce composant est donc importé explicitement par les 3 pages
 * concernées seulement ; `/invitation/[token]` garde son habillage
 * d'origine, intact.
 *
 * Purement présentationnel : ne contient aucune logique métier, aucun
 * Server Action, aucune validation — chaque page continue de porter
 * l'intégralité de son propre comportement (formulaire, erreurs, redirections).
 */
export function AuthShell({
  tagline,
  children,
}: {
  /** Sous-phrase courte du panneau illustré, adaptée au contexte de l'écran. */
  tagline: string;
  /** Contenu du panneau blanc (titre + formulaire propre à chaque écran). */
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-app-bg px-4 py-10 sm:py-14">
      {/* Papier à en-tête institutionnel en arrière-plan de PAGE (voir
          CLAUDE.md "Logo vectoriel et fond de marque") — intensité déjà
          abaissée, la carte ci-dessous porte l'essentiel de l'identité
          visuelle désormais (panneau illustré). */}
      <BrandBackdrop className="absolute inset-0 h-full w-full" watermarkOpacityClassName="opacity-[0.05]" />

      <div className="animate-fade-in-up relative grid w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-surface shadow-elevated-lg sm:grid-cols-5">
        {/* Panneau gauche : logo couleur + formulaire (propre à chaque écran). */}
        <div className="flex flex-col justify-center gap-6 px-6 py-10 sm:col-span-3 sm:px-10 sm:py-12">
          <Image src="/logo-sim-couleur.svg" alt="SIM Assurances" width={176} height={26} priority />
          {children}
        </div>

        {/* Panneau droit : illustré, dégradé de marque — masqué sur mobile
            (jamais empilé en bandeau réduit : la carte reste lisible sans
            lui, plus simple et tout aussi conforme à la maquette de
            référence, qui propose les deux options). */}
        <div className="brand-gradient-bg relative hidden flex-col justify-center overflow-hidden px-8 py-12 text-white sm:col-span-2 sm:flex">
          <BrandBackdrop
            className="absolute inset-0 h-full w-full"
            watermarkColorClassName="text-white"
            watermarkOpacityClassName="opacity-[0.16]"
            watermarkPosition="corner-br"
            showBottomAccent={false}
          />
          <div className="relative space-y-3">
            <h2 className="text-2xl font-black leading-tight">Bienvenue sur le portail SIM Assurances</h2>
            <p className="text-sm text-white/85">{tagline}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
