"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { BrandBackdrop } from "@/components/ui";

/**
 * Coquille visuelle PARTAGÉE des 3 écrans d'authentification restylés
 * (connexion, mot de passe oublié, réinitialisation) — voir CLAUDE.md
 * "Refonte visuelle des écrans d'authentification", "Animation d'entrée de
 * l'écran de connexion" et "Nouvelle disposition de l'état formulaire
 * révélé". Deux dispositions bien distinctes selon `animatedIntro` :
 * - `false` (mot de passe oublié / réinitialisation) : carte scindée en
 *   deux, panneau blanc (logo + `children`) et panneau illustré en dégradé
 *   de marque (~40% de la largeur), masqué sur mobile — inchangée depuis
 *   sa création.
 * - `true` (connexion uniquement) : fond bleu de marque TOUJOURS plein
 *   écran, avec une carte blanche flottante (logo + `children`) qui
 *   apparaît centrée PAR-DESSUS une fois révélée — jamais de colonnes qui
 *   se partagent la largeur (voir plus bas pour l'historique de cette
 *   évolution).
 *
 * **Volontairement PAS un `(auth)/layout.tsx`** : ce groupe de routes
 * contient aussi `/invitation/[token]`, un 4ᵉ écran hors périmètre de ces
 * tâches — un vrai layout Next.js l'aurait restylé du même coup sans que ce
 * soit demandé. Ce composant est donc importé explicitement par les 3 pages
 * concernées seulement ; `/invitation/[token]` garde son habillage
 * d'origine, intact.
 *
 * **`animatedIntro`** (nouveau, défaut `false`) — réserve l'animation
 * d'entrée (fond bleu plein écran -> carte flottante révélée) à l'écran de
 * connexion UNIQUEMENT (seul appelant qui le passe à `true`) :
 * `forgot-password`/`reset-password` ne le passent jamais et empruntent
 * l'ancienne branche de rendu, STRICTEMENT identique à avant cette tâche —
 * jamais de panneau plein écran ni de bouton pour eux, zéro régression
 * possible sur ces deux écrans (hors périmètre).
 *
 * **`skipIntro`** (nouveau, défaut `false`) — permet à `/login` de
 * démarrer directement en état "révélé" quand la page se recharge après
 * une soumission de formulaire (erreur de connexion, compte activé,
 * réinitialisation réussie, déconnexion pour inactivité : tous ces cas se
 * traduisent par un paramètre d'URL déjà présent après le `redirect()` du
 * Server Action). Nécessaire car l'état `revealed` (ci-dessous) ne doit
 * JAMAIS se refaire jouer l'animation lors d'une interaction normale du
 * formulaire (règle explicite de la tâche) — voir `login/page.tsx`, qui
 * calcule ce prop à partir de ses propres `searchParams`, déjà lus pour ses
 * propres besoins. Un simple rechargement (F5) de `/login` SANS paramètre
 * reste, lui, volontairement ramené à l'état plein écran (comportement
 * explicitement demandé) : `skipIntro` ne s'applique que lorsque l'URL
 * porte déjà la preuve d'une interaction précédente.
 */
export function AuthShell({
  tagline,
  children,
  animatedIntro = false,
  skipIntro = false,
}: {
  /** Sous-phrase courte du panneau illustré, adaptée au contexte de l'écran. */
  tagline: string;
  /** Contenu du panneau blanc (titre + formulaire propre à chaque écran). */
  children: ReactNode;
  /** Active l'animation d'entrée (réservée à `/login`). */
  animatedIntro?: boolean;
  /** Démarre directement en état "révélé" (voir JSDoc ci-dessus). */
  skipIntro?: boolean;
}) {
  const [revealed, setRevealed] = useState(!animatedIntro || skipIntro);

  // Détecte le palier `sm:` (≥640px, celui de tout le reste de ce fichier)
  // côté client uniquement — voir la garde `inert={isDesktop && !revealed}`
  // plus bas (sur la carte) pour pourquoi c'est nécessaire. Défaut `false`
  // (= mobile) : ne casse jamais le rendu serveur/l'hydratation, et surtout
  // ne rend jamais le formulaire inerte sur mobile par erreur avant que
  // cette détection n'ait pu s'exécuter.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ---------- Cas non animé (mot de passe oublié / réinitialisation) ----------
  // Rendu STRICTEMENT identique à l'implémentation d'avant cette tâche.
  if (!animatedIntro) {
    return (
      <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-app-bg px-4 py-10 sm:py-14">
        <BrandBackdrop className="absolute inset-0 h-full w-full" watermarkOpacityClassName="opacity-[0.05]" />

        <div className="animate-fade-in-up relative grid w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-surface shadow-elevated-lg sm:grid-cols-5">
          <div className="flex flex-col justify-center gap-6 px-6 py-10 sm:col-span-3 sm:px-10 sm:py-12">
            <Image src="/logo-sim-couleur.svg" alt="SIM Assurances" width={176} height={26} priority />
            {children}
          </div>

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

  // ---------- Cas animé (connexion uniquement) ----------
  // Fond bleu de marque TOUJOURS plein écran (jamais rétréci) — voir
  // CLAUDE.md "Nouvelle disposition de l'état formulaire révélé". Deux
  // calques `absolute inset-0` (accueil / carte) se superposent SUR ce
  // fond permanent, chacun centrant son propre contenu par flexbox.
  //
  // **Remplace l'ancienne architecture "grille fixe + calque de
  // recouvrement à largeur variable"** (panneau bleu ~57% / formulaire
  // ~43%, voir historique CLAUDE.md pour les deux pièges déjà rencontrés
  // et corrigés sur cette version précédente) — devenue inutile : plus
  // aucune largeur n'est jamais animée, donc plus aucun risque de
  // reformatage/saut de hauteur du type déjà documenté. Le conteneur
  // externe garde une taille fixe (`min-h-full flex-1`, hauteur du
  // viewport) en TOUTE circonstance ; les 3 calques (fond, accueil, carte)
  // sont tous `absolute inset-0` et ne contribuent donc JAMAIS à cette
  // taille — la carte peut apparaître/disparaître sans le moindre effet
  // sur la mise en page environnante.
  //
  // **Logo/accroche du hero : disparaissent en fondu** (plutôt que de se
  // repositionner en haut de l'écran) — voir CLAUDE.md pour la
  // justification complète : un simple fondu croisé est robuste (aucun
  // calcul de position dépendant de la taille du contenu/du viewport,
  // aucun risque de chevauchement pendant la transition) et laisse un
  // arrière-plan bleu épuré une fois la carte affichée, cohérent avec
  // "la carte flotte SUR le fond bleu" demandé.
  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-app-bg">
      {/* Calque 1 — fond bleu permanent, plein écran en toute circonstance,
          masqué sur mobile (`hidden sm:block`) : sur un petit écran, la
          disposition reste blanche avec la carte directement visible,
          exactement comme avant cette tâche (voir CLAUDE.md "comportement
          mobile... ne pas régresser"). Filigrane VOLONTAIREMENT plus marqué
          ici que partout ailleurs dans l'app (`opacity-[0.32]` contre
          `0.16` avant, et `0.05`/`0.09`/`0.16` pour les autres usages de
          `BrandBackdrop` — AppShell, cartes "Vos accès" (qui n'utilisent
          d'ailleurs pas ce composant), `/forgot-password`/`/reset-password`)
          — changement scopé à CET unique appel via le prop déjà existant
          `watermarkOpacityClassName`, sans toucher `BrandBackdrop.tsx` ni
          aucun autre appel : le composant reste inchangé, seule la VALEUR
          passée ici diffère. Contraste vérifié par capture d'écran réelle
          (voir résumé de la tâche) : le titre/l'accroche/le logo blanc
          restent parfaitement lisibles par-dessus. */}
      <div className="brand-gradient-bg absolute inset-0 hidden sm:block">
        <BrandBackdrop
          className="absolute inset-0 h-full w-full"
          watermarkColorClassName="text-white"
          watermarkOpacityClassName="opacity-[0.32]"
          watermarkPosition="corner-br"
          showBottomAccent={false}
        />
      </div>

      {/* Calque 2 — accueil (logo blanc, titre, accroche, bouton), centré
          sur tout l'écran, s'efface en fondu une fois révélé. Masqué sur
          mobile (`hidden sm:flex`) : jamais d'interstitiel sur petit écran,
          la carte (calque 3) y est immédiatement visible. `inert` une fois
          révélé — retire le bouton de l'ordre de tabulation, jamais un
          arrêt fantôme derrière la carte. */}
      <div
        inert={revealed}
        className={`absolute inset-0 z-10 hidden flex-col items-center justify-center gap-6 p-8 text-center text-white transition-opacity duration-200 ease-out sm:flex sm:p-12 ${
          revealed ? "opacity-0" : "opacity-100"
        }`}
      >
        <Image src="/logo-sim-blanc.svg" alt="SIM Assurances" width={220} height={32} priority />
        <div className="space-y-3">
          <h1 className="text-3xl font-black leading-tight sm:text-4xl">Bienvenue sur le portail SIM Assurances</h1>
          <p className="mx-auto max-w-md text-sm text-white/85 sm:text-base">{tagline}</p>
        </div>
        {/* Point d'entrée cliquable — un vrai <button>, focusable et
            activable au clavier (Entrée/Espace) nativement, jamais un
            <div onClick>. `inert` sur le calque parent (ci-dessus) retire
            déjà ce bouton de l'ordre de tabulation une fois révélé — pas
            besoin d'un `tabIndex` séparé ici. */}
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/40 bg-white/15 px-6 py-2.5 text-sm font-semibold text-white transition-colors duration-150 ease-out-strong hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Se connecter
          <Icon name="arrow-right" className="size-4" />
        </button>
      </div>

      {/* Calque 3 — carte blanche flottante (formulaire), toujours centrée,
          toujours dans le DOM (jamais montée tardivement — nécessaire pour
          que sa transition d'apparition puisse réellement s'animer, voir
          CLAUDE.md). Toujours pleinement visible/interactive sur mobile
          (classes de base `opacity-100 scale-100`, jamais recouvertes par
          un préfixe `max-sm:`) puisque le calque "accueil" y est de toute
          façon masqué — seuls les préfixes `sm:` conditionnent l'apparence
          sur desktop.
          **`inert` tant que non révélée, DESKTOP UNIQUEMENT**
          (`isDesktop && !revealed`, voir plus haut pour `isDesktop`) — même
          piège déjà rencontré et corrigé sur l'ancienne disposition (un
          utilisateur clavier tombait sur les champs cachés avant d'atteindre
          le bouton) : sur mobile, ce formulaire doit rester TOUJOURS
          pleinement interactif, jamais concerné par cette garde. */}
      <div
        inert={isDesktop && !revealed}
        className="absolute inset-0 z-10 flex items-center justify-center p-4 sm:p-8"
      >
        <div
          className={`w-full max-w-sm space-y-6 rounded-2xl border border-border bg-surface p-8 opacity-100 shadow-elevated-lg transition-[opacity,transform] duration-300 ease-out ${
            revealed ? "sm:opacity-100 sm:scale-100 sm:delay-150" : "sm:opacity-0 sm:scale-95"
          }`}
        >
          <Image src="/logo-sim-couleur.svg" alt="SIM Assurances" width={176} height={26} priority />
          {children}
        </div>
      </div>
    </div>
  );
}
